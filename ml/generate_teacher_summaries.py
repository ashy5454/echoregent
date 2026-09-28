# -*- coding: utf-8 -*-
"""
CTS Teacher Summary Generator
=============================

Reads weak CTS summarization pairs and upgrades them into higher-quality
teacher examples using OpenRouter. This is for one-time training data creation,
not runtime CTS inference.

Input row formats supported:
  {"input_text": "...", "target_text": "..."}
  {"input": "...", "target": "..."}

Output rows:
  {
    "id": "...",
    "domain": "coding",
    "input_text": "...",
    "target_text": "natural-language CTS memory summary",
    "must_keep": ["..."],
    "should_drop": ["..."],
    "quality_notes": "...",
    "teacher_model": "openai/gpt-4o-mini"
  }

Usage from PowerShell:
  cd "C:\\Users\\ASHMITH ATMURI\\Documents\\Codex\\2026-04-29\\cts"
  $env:OPENROUTER_API_KEY="PASTE_KEY_HERE"
  python ml/generate_teacher_summaries.py --limit 5000

Recommended first run:
  python ml/generate_teacher_summaries.py `
    --input data/t5_compression/train.jsonl `
    --output ml/data/t5_teacher_train.jsonl `
    --limit 5000 `
    --model openai/gpt-4o-mini
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import threading
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Set

OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_URL     = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
DEFAULT_MODEL  = "openai/gpt-4o-mini"
DEFAULT_INPUT = Path("data/t5_compression/train.jsonl")
DEFAULT_OUTPUT = Path("ml/data/t5_teacher_train.jsonl")
DEFAULT_FAILED = Path("ml/data/t5_teacher_failed.jsonl")

JSON_BLOCK_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)
SPACE_RE = re.compile(r"\s+")


def clean_text(value: Any, max_chars: int = 6000) -> str:
    text = "" if value is None else str(value)
    text = SPACE_RE.sub(" ", text.replace("\r", " ").replace("\t", " ")).strip()
    return text[:max_chars].strip()


def read_jsonl(path: Path) -> Iterator[Dict[str, Any]]:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        for line_no, line in enumerate(handle, start=1):
            line = line.strip()
            if not line:
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Bad JSONL at {path}:{line_no}: {exc}") from exc
            if isinstance(row, dict):
                yield row


def append_jsonl(path: Path, row: Dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(row, ensure_ascii=False) + "\n")
        handle.flush()


def existing_ids(path: Path) -> Set[str]:
    if not path.exists():
        return set()
    ids: Set[str] = set()
    for row in read_jsonl(path):
        row_id = row.get("id")
        if row_id:
            ids.add(str(row_id))
    return ids


def normalize_row(row: Dict[str, Any], fallback_id: int) -> Dict[str, Any]:
    input_text = row.get("input_text") or row.get("input") or row.get("source_text") or ""
    weak_target = row.get("target_text") or row.get("target") or row.get("summary") or ""
    domain = row.get("domain") or infer_domain(str(input_text))
    row_id = row.get("id") or f"teacher_{fallback_id:06d}"
    return {
        "id": str(row_id),
        "domain": str(domain),
        "input_text": clean_text(input_text, 7000),
        "weak_target": clean_text(weak_target, 1000),
        "source": row.get("source"),
        "meta": row.get("meta") or {},
    }


def infer_domain(text: str) -> str:
    match = re.search(r"DOMAIN\s*:?\s*([a-zA-Z_]+)", text)
    if match:
        return match.group(1).lower()
    return "general"


def build_prompt(row: Dict[str, Any]) -> str:
    return f"""
You are creating training labels for CTS, a conversation compression layer.
Your job is to rewrite messy conversation history into a compact memory summary.

Rules:
- Output ONLY valid JSON. No markdown, no explanation outside JSON.
- target_text must be natural language, not keywords.
- Preserve concrete facts: product names, errors, IDs, dates, deadlines, constraints, symptoms, legal/medical cautions, user goals, previous attempts.
- Drop irrelevant chatter and distractors.
- Do not invent facts that are not present.
- Keep target_text between 25 and 90 words.
- Use the weak target only as a hint; improve it if it is too thin.

Return this exact JSON shape:
{{
  "target_text": "compact CTS memory summary",
  "must_keep": ["fact 1", "fact 2"],
  "should_drop": ["noise 1", "noise 2"],
  "quality_notes": "short reason this is a good training target"
}}

DOMAIN: {row['domain']}
WEAK_TARGET_HINT: {row['weak_target']}
INPUT_TO_COMPRESS:
{row['input_text']}
""".strip()


def openrouter_chat(api_key: str, model: str, prompt: str, temperature: float, max_tokens: int, timeout: int, base_url: str = OPENROUTER_URL) -> str:
    payload = {
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You write precise JSON training labels for conversation memory compression.",
            },
            {"role": "user", "content": prompt},
        ],
        "temperature": temperature,
        "max_tokens": max_tokens,
        "response_format": {"type": "json_object"},
    }
    body    = json.dumps(payload).encode("utf-8")
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }
    if base_url == OPENROUTER_URL:
        headers["HTTP-Referer"] = "http://localhost/cts-teacher-generator"
        headers["X-Title"]      = "CTS Teacher Summary Generator"

    request = urllib.request.Request(base_url, data=body, method="POST", headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
    data = json.loads(raw)
    return data["choices"][0]["message"]["content"]


def parse_teacher_json(text: str) -> Dict[str, Any]:
    text = text.strip()
    match = JSON_BLOCK_RE.search(text)
    if match:
        text = match.group(1)
    try:
        parsed = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            raise
        parsed = json.loads(text[start:end + 1])
    if not isinstance(parsed, dict):
        raise ValueError("Teacher response was not a JSON object")
    return parsed


def normalize_teacher(row: Dict[str, Any], teacher: Dict[str, Any], model: str) -> Dict[str, Any]:
    target_text = clean_text(teacher.get("target_text"), 1200)
    if len(target_text) < 20:
        raise ValueError("Teacher target_text too short")

    must_keep = teacher.get("must_keep") or []
    should_drop = teacher.get("should_drop") or []
    if not isinstance(must_keep, list):
        must_keep = []
    if not isinstance(should_drop, list):
        should_drop = []

    return {
        "id": row["id"],
        "domain": row["domain"],
        "source": row.get("source"),
        "input_text": row["input_text"],
        "weak_target_text": row["weak_target"],
        "target_text": target_text,
        "must_keep": [clean_text(item, 120) for item in must_keep if clean_text(item, 120)],
        "should_drop": [clean_text(item, 120) for item in should_drop if clean_text(item, 120)],
        "quality_notes": clean_text(teacher.get("quality_notes"), 400),
        "teacher_model": model,
        "meta": row.get("meta") or {},
    }


def iter_selected_rows(input_path: Path, domains: Optional[Set[str]], shuffle: bool, seed: int) -> Iterable[Dict[str, Any]]:
    rows = [normalize_row(row, idx) for idx, row in enumerate(read_jsonl(input_path), start=1)]
    if domains:
        rows = [row for row in rows if row["domain"] in domains]
    if shuffle:
        rng = random.Random(seed)
        rng.shuffle(rows)
    return rows


def process_one(row: Dict[str, Any], api_key: str, args: argparse.Namespace, base_url: str = OPENROUTER_URL) -> Dict[str, Any]:
    """Process a single row — called from thread pool. Returns status dict."""
    prompt     = build_prompt(row)
    last_error = None

    for attempt in range(1, args.retries + 1):
        try:
            content    = openrouter_chat(
                api_key    = api_key,
                model      = args.model,
                prompt     = prompt,
                temperature= args.temperature,
                max_tokens = args.max_tokens,
                timeout    = args.timeout,
                base_url   = base_url,
            )
            teacher    = parse_teacher_json(content)
            output_row = normalize_teacher(row, teacher, args.model)
            return {"status": "ok", "row": output_row}
        except urllib.error.HTTPError as exc:
            details    = exc.read().decode("utf-8", errors="replace")[:400]
            last_error = f"HTTP {exc.code}: {details}"
        except Exception as exc:
            last_error = repr(exc)

        wait = min(args.max_backoff, args.sleep * (2 ** (attempt - 1)))
        time.sleep(wait)

    return {"status": "failed", "row": row, "error": last_error}


def generate(args: argparse.Namespace) -> None:
    # Support both OpenRouter and Gemini AI Studio
    if args.gemini:
        base_url = GEMINI_URL
        api_key  = os.environ.get("GEMINI_API_KEY", "").strip()
        if not api_key and not args.dry_run:
            raise SystemExit("GEMINI_API_KEY is missing. Set it with: $env:GEMINI_API_KEY='your-key'")
    else:
        base_url = OPENROUTER_URL
        api_key  = os.environ.get("OPENROUTER_API_KEY", "").strip()
        if not api_key and not args.dry_run:
            raise SystemExit("OPENROUTER_API_KEY is missing. Set it in your shell environment first.")

    domains  = set(args.domains) if args.domains else None
    done     = existing_ids(args.output) if args.resume else set()
    all_rows = list(iter_selected_rows(args.input, domains, args.shuffle, args.seed))

    # Filter rows to process
    pending = []
    skipped = 0
    for idx, row in enumerate(all_rows):
        if args.start_after and row["id"] <= args.start_after:
            skipped += 1
            continue
        if row["id"] in done:
            skipped += 1
            continue
        pending.append(row)
        if args.limit is not None and len(pending) >= args.limit:
            break

    print(f"  total rows : {len(all_rows)}")
    print(f"  skipped    : {skipped}")
    print(f"  to process : {len(pending)}")
    print(f"  workers    : {args.workers}")
    print()

    if args.dry_run:
        for row in pending[:5]:
            print("=" * 80)
            print(f"DRY RUN {row['id']} domain={row['domain']}")
            print(build_prompt(row)[: args.preview_chars])
        return

    # Thread-safe counters
    lock      = threading.Lock()
    generated = 0
    failed    = 0

    # Write lock so threads don't interleave JSONL writes
    write_lock = threading.Lock()

    def safe_write(path: Path, row: Dict[str, Any]) -> None:
        with write_lock:
            append_jsonl(path, row)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(process_one, row, api_key, args, base_url): row for row in pending}

        for future in as_completed(futures):
            result = future.result()
            with lock:
                if result["status"] == "ok":
                    generated += 1
                    out = result["row"]
                    safe_write(args.output, out)
                    print(f"[ok {generated}] {out['id']} domain={out['domain']} chars={len(out['target_text'])}")
                else:
                    failed += 1
                    src = result["row"]
                    safe_write(args.failed, {
                        "id":               src["id"],
                        "domain":           src["domain"],
                        "error":            result["error"],
                        "input_text":       src["input_text"],
                        "weak_target_text": src["weak_target"],
                    })
                    print(f"[fail {failed}] {src['id']}: {result['error']}", file=sys.stderr)

    print("\nDone")
    print(f"  generated : {generated}")
    print(f"  failed    : {failed}")
    print(f"  output    : {args.output.resolve()}")
    print(f"  failed    : {args.failed.resolve()}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate OpenRouter teacher summaries for CTS T5/BART training.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--failed", type=Path, default=DEFAULT_FAILED)
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--limit", type=int, default=5000)
    parser.add_argument("--domains", nargs="*", default=None, help="Optional domain filter, e.g. coding customer_support sales")
    parser.add_argument("--temperature", type=float, default=0.1)
    parser.add_argument("--max-tokens", type=int, default=450)
    parser.add_argument("--timeout", type=int, default=90)
    parser.add_argument("--sleep", type=float, default=0.15)
    parser.add_argument("--max-backoff", type=float, default=30.0)
    parser.add_argument("--retries", type=int, default=4)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--shuffle", action="store_true", help="Shuffle input rows before generation")
    parser.add_argument("--no-resume", dest="resume", action="store_false", help="Do not skip ids already in output")
    parser.set_defaults(resume=True)
    parser.add_argument("--start-after", default=None, help="Skip ids lexically up to and including this id")
    parser.add_argument("--workers", type=int, default=15, help="Parallel API workers (default 15)")
    parser.add_argument("--gemini", action="store_true", help="Use Gemini AI Studio instead of OpenRouter")
    parser.add_argument("--dry-run", action="store_true", help="Print prompts without calling OpenRouter")
    parser.add_argument("--preview-chars", type=int, default=1800)
    args = parser.parse_args()

    if not args.input.exists():
        raise SystemExit(f"Input file not found: {args.input}")

    generate(args)


if __name__ == "__main__":
    main()
