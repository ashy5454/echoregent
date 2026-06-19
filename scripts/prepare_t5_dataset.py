#!/usr/bin/env python3
"""
Prepare CTS summarization training pairs for a local T5/BART compressor.

The output format is JSONL, one example per line:
{
  "id": "coding_000001",
  "domain": "coding",
  "source": "coding.json",
  "input": "summarize CTS memory:\nDOMAIN: coding\n...",
  "target": "Coding issue: How can I find the full path to a font from its display name on a Mac?"
}

This script intentionally creates weakly-supervised summarization pairs from the
raw datasets we already have. It does not call an LLM and it does not require
pandas/ijson. The huge Stack Overflow-style coding file is parsed as a streaming
JSON array so it does not need to fit in memory.
"""

from __future__ import annotations

import argparse
import html
import json
import random
import re
from json import JSONDecoder
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Optional, Tuple

ROOT = Path(__file__).resolve().parent
DEFAULT_OUT = ROOT / "data" / "t5_compression"

DATASET_CONFIG = {
    "coding": {
        "path": "coding.json",
        "kind": "stackoverflow",
        "default_limit": 5000,
    },
    "customer_support": {
        "path": "customer_support.json",
        "kind": "instruction_response",
        "default_limit": 3000,
    },
    "sales": {
        "path": "sales.json",
        "kind": "instruction_response",
        "default_limit": 3000,
    },
    "commerce": {
        "path": "commerce.json",
        "kind": "instruction_response",
        "default_limit": 3000,
    },
    "general": {
        "path": "general.json",
        "kind": "instruction_response",
        "default_limit": 3000,
    },
    "hospitality": {
        "path": "hospitality.json",
        "kind": "instruction_response",
        "default_limit": 2000,
    },
    "medical": {
        "path": "medical.json",
        "kind": "medical_qa",
        "default_limit": 2000,
    },
    "education": {
        "path": "education.json",
        "kind": "squad",
        "default_limit": 3000,
    },
    "multiwoz": {
        "path": "multiwoz.json",
        "kind": "dialogue",
        "default_limit": 2000,
    },
}

HTML_TAG_RE = re.compile(r"<[^>]+>")
SPACE_RE = re.compile(r"\s+")
CODE_RE = re.compile(r"<pre><code>(.*?)</code></pre>", re.IGNORECASE | re.DOTALL)


def clean_text(value: Any, max_chars: int = 4000) -> str:
    if value is None:
        return ""
    text = str(value)
    text = html.unescape(text)
    text = CODE_RE.sub(lambda m: " CODE_BLOCK " + clean_text(m.group(1), 1200) + " ", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = text.replace("{{", "").replace("}}", "")
    text = SPACE_RE.sub(" ", text).strip()
    return text[:max_chars].strip()


def first_sentence(value: Any, max_chars: int = 280) -> str:
    text = clean_text(value, max_chars=900)
    if not text:
        return ""
    pieces = re.split(r"(?<=[.!?])\s+", text)
    chosen = " ".join(pieces[:2]).strip()
    return chosen[:max_chars].strip()


def make_input(domain: str, intent: str, history: List[Tuple[str, str]], task_hint: str = "") -> str:
    lines = [
        "summarize CTS memory:",
        f"DOMAIN: {domain}",
        f"INTENT: {intent}",
    ]
    if task_hint:
        lines.append(f"TASK_HINT: {clean_text(task_hint, 240)}")
    lines.append("HISTORY:")
    for role, content in history:
        cleaned = clean_text(content, 1500)
        if cleaned:
            lines.append(f"{role}: {cleaned}")
    return "\n".join(lines).strip()


def make_example(example_id: str, domain: str, source: str, input_text: str, target: str, meta: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    input_text = input_text.strip()
    target = clean_text(target, 700)
    if len(input_text) < 80 or len(target) < 12:
        return None
    return {
        "id": example_id,
        "domain": domain,
        "source": source,
        "input": input_text,
        "target": target,
        "meta": meta or {},
    }


def iter_json_array_stream(path: Path, chunk_size: int = 1024 * 1024) -> Iterator[Dict[str, Any]]:
    """Stream objects from a top-level JSON array without loading the file."""
    decoder = JSONDecoder()
    buffer = ""
    started = False
    finished = False

    with path.open("r", encoding="utf-8", errors="replace") as handle:
        while not finished:
            chunk = handle.read(chunk_size)
            if not chunk:
                finished = True
            buffer += chunk
            pos = 0

            while True:
                while pos < len(buffer) and buffer[pos].isspace():
                    pos += 1
                if not started:
                    if pos >= len(buffer):
                        break
                    if buffer[pos] != "[":
                        raise ValueError(f"Expected JSON array in {path}")
                    started = True
                    pos += 1

                while pos < len(buffer) and buffer[pos].isspace():
                    pos += 1
                if pos < len(buffer) and buffer[pos] == ",":
                    pos += 1
                    continue
                if pos < len(buffer) and buffer[pos] == "]":
                    finished = True
                    pos += 1
                    break
                if pos >= len(buffer):
                    break

                try:
                    item, end = decoder.raw_decode(buffer, pos)
                except json.JSONDecodeError:
                    break
                if isinstance(item, dict):
                    yield item
                pos = end

            buffer = buffer[pos:]

            if finished:
                break


def load_json_items(path: Path) -> Iterable[Dict[str, Any]]:
    with path.open("r", encoding="utf-8", errors="replace") as handle:
        first = handle.read(1)
        handle.seek(0)
        if first == "[":
            data = json.load(handle)
            for item in data:
                if isinstance(item, dict):
                    yield item
        else:
            for line in handle:
                line = line.strip()
                if not line:
                    continue
                item = json.loads(line)
                if isinstance(item, dict):
                    yield item


def stackoverflow_pair(row: Dict[str, Any], idx: int, source: str) -> Optional[Dict[str, Any]]:
    title = clean_text(row.get("title"), 220)
    question = clean_text(row.get("question_body"), 2500)
    answer = clean_text(row.get("answer_body"), 1500)
    tags = row.get("tags") or []
    tag_text = ", ".join(map(str, tags[:6])) if isinstance(tags, list) else clean_text(tags, 120)
    history = [
        ("User", question),
        ("Assistant", answer),
    ]
    task_hint = title or tag_text
    target_bits = [f"Coding issue: {title}" if title else "Coding issue from prior technical discussion"]
    if tag_text:
        target_bits.append(f"Relevant tags: {tag_text}.")
    target = " ".join(target_bits)
    return make_example(
        f"coding_{idx:06d}",
        "coding",
        source,
        make_input("coding", "compression", history, task_hint),
        target,
        {"question_id": row.get("question_id"), "answer_id": row.get("answer_id"), "tags": tags},
    )


def instruction_response_pair(row: Dict[str, Any], idx: int, domain: str, source: str) -> Optional[Dict[str, Any]]:
    instruction = clean_text(row.get("instruction"), 900)
    response = clean_text(row.get("response"), 1400)
    intent = clean_text(row.get("intent"), 80) or "task_execution"
    category = clean_text(row.get("category"), 80)
    history = [("User", instruction), ("Assistant", response)]
    target = f"User request: {instruction}."
    answer_hint = first_sentence(response)
    if answer_hint:
        target += f" Important response context: {answer_hint}"
    return make_example(
        f"{domain}_{idx:06d}",
        domain,
        source,
        make_input(domain, intent, history, instruction),
        target,
        {"intent": intent, "category": category},
    )


def medical_pair(row: Dict[str, Any], idx: int, source: str) -> Optional[Dict[str, Any]]:
    question = clean_text(row.get("Question"), 900)
    answer = clean_text(row.get("Answer"), 1400)
    qtype = clean_text(row.get("qtype"), 80)
    target = f"Medical question: {question}."
    answer_hint = first_sentence(answer)
    if answer_hint:
        target += f" Key medical context: {answer_hint}"
    return make_example(
        f"medical_{idx:06d}",
        "medical",
        source,
        make_input("medical", "medical_caution", [("User", question), ("Assistant", answer)], question),
        target,
        {"qtype": qtype},
    )


def squad_pair(row: Dict[str, Any], idx: int, source: str) -> Optional[Dict[str, Any]]:
    context = clean_text(row.get("context"), 2200)
    question = clean_text(row.get("question"), 700)
    answers = row.get("answers") or {}
    answer_text = ""
    if isinstance(answers, dict):
        texts = answers.get("text") or []
        if texts:
            answer_text = clean_text(texts[0], 180)
    title = clean_text(row.get("title"), 120)
    target = f"Education context: {title}. Question: {question}."
    if answer_text:
        target += f" Answer: {answer_text}."
    return make_example(
        f"education_{idx:06d}",
        "education",
        source,
        make_input("education", "information_seeking", [("User", question), ("Assistant", context)], question),
        target,
        {"title": title, "answer": answer_text},
    )


def dialogue_pair(row: Dict[str, Any], idx: int, source: str) -> Optional[Dict[str, Any]]:
    turns = row.get("turns") or []
    history: List[Tuple[str, str]] = []
    if isinstance(turns, list):
        for turn in turns[:12]:
            speaker = str(turn.get("speaker", "user")).lower() if isinstance(turn, dict) else "user"
            utterance = turn.get("utterance", "") if isinstance(turn, dict) else ""
            role = "Assistant" if "system" in speaker or "assistant" in speaker else "User"
            history.append((role, clean_text(utterance, 600)))
    services = row.get("services") or []
    service_text = ", ".join(map(str, services[:4])) if isinstance(services, list) else clean_text(services, 100)
    user_turns = [content for role, content in history if role == "User" and content]
    latest_user = user_turns[-1] if user_turns else "Continue the dialogue."
    target = f"Dialogue services: {service_text or 'general'}. Current user need: {latest_user}"
    return make_example(
        f"multiwoz_{idx:06d}",
        "general",
        source,
        make_input("general", "task_execution", history, latest_user),
        target,
        {"dialogue_id": row.get("dialogue_id"), "services": services},
    )


def iter_domain_examples(domain: str, cfg: Dict[str, Any], limit: int) -> Iterator[Dict[str, Any]]:
    path = ROOT / cfg["path"]
    if not path.exists():
        return

    kind = cfg["kind"]
    count = 0
    source = cfg["path"]
    iterator: Iterable[Dict[str, Any]]

    if kind == "stackoverflow":
        iterator = iter_json_array_stream(path)
    else:
        iterator = load_json_items(path)

    for row in iterator:
        idx = count + 1
        example: Optional[Dict[str, Any]] = None
        if kind == "stackoverflow":
            example = stackoverflow_pair(row, idx, source)
        elif kind == "instruction_response":
            example = instruction_response_pair(row, idx, domain, source)
        elif kind == "medical_qa":
            example = medical_pair(row, idx, source)
        elif kind == "squad":
            example = squad_pair(row, idx, source)
        elif kind == "dialogue":
            example = dialogue_pair(row, idx, source)

        if example:
            yield example
            count += 1
            if count >= limit:
                break


def split_examples(examples: List[Dict[str, Any]], val_ratio: float, test_ratio: float, seed: int) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]], List[Dict[str, Any]]]:
    rng = random.Random(seed)
    rng.shuffle(examples)
    total = len(examples)
    test_n = int(total * test_ratio)
    val_n = int(total * val_ratio)
    test = examples[:test_n]
    val = examples[test_n:test_n + val_n]
    train = examples[test_n + val_n:]
    return train, val, test


def write_jsonl(path: Path, rows: Iterable[Dict[str, Any]]) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    count = 0
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")
            count += 1
    return count


def parse_limits(raw_limits: List[str]) -> Dict[str, int]:
    limits: Dict[str, int] = {}
    for item in raw_limits:
        if "=" not in item:
            raise ValueError(f"Limit must look like domain=number, got {item!r}")
        domain, value = item.split("=", 1)
        limits[domain.strip()] = int(value)
    return limits


def main() -> None:
    parser = argparse.ArgumentParser(description="Prepare CTS T5/BART summarization dataset JSONL files.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--domains", nargs="*", default=list(DATASET_CONFIG.keys()), help="Domains/config keys to include.")
    parser.add_argument("--limit", type=int, default=None, help="Default examples per domain.")
    parser.add_argument("--domain-limit", action="append", default=[], help="Override one domain limit, e.g. coding=10000")
    parser.add_argument("--val-ratio", type=float, default=0.08)
    parser.add_argument("--test-ratio", type=float, default=0.02)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    domain_limits = parse_limits(args.domain_limit)
    all_examples: List[Dict[str, Any]] = []
    per_domain: Dict[str, int] = {}

    for domain in args.domains:
        if domain not in DATASET_CONFIG:
            raise SystemExit(f"Unknown domain/config key {domain!r}. Known: {', '.join(DATASET_CONFIG)}")
        cfg = DATASET_CONFIG[domain]
        limit = domain_limits.get(domain, args.limit if args.limit is not None else cfg["default_limit"])
        examples = list(iter_domain_examples(domain, cfg, limit))
        all_examples.extend(examples)
        per_domain[domain] = len(examples)
        print(f"{domain}: {len(examples)} examples from {cfg['path']}")

    train, val, test = split_examples(all_examples, args.val_ratio, args.test_ratio, args.seed)

    train_n = write_jsonl(args.out_dir / "train.jsonl", train)
    val_n = write_jsonl(args.out_dir / "val.jsonl", val)
    test_n = write_jsonl(args.out_dir / "test.jsonl", test)
    all_n = write_jsonl(args.out_dir / "all.jsonl", all_examples)

    summary = {
        "total": len(all_examples),
        "train": train_n,
        "val": val_n,
        "test": test_n,
        "all": all_n,
        "per_domain": per_domain,
        "format": {"input": "model input text", "target": "gold compact CTS memory summary"},
    }
    (args.out_dir / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2))


if __name__ == "__main__":
    main()
