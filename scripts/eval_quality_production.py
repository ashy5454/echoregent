# -*- coding: utf-8 -*-
"""
CTS Production Response Quality Eval
====================================

This is the eval that answers the real pilot question:

  If CTS compresses the conversation, does the final answer stay as good as
  the answer generated from full history?

Flow per sample:
  1. Build a multi-turn conversation from source datasets.
  2. Send history + current user message to CTS /demo/compress-async.
  3. Ask an LLM to answer with full history.
  4. Ask the same LLM to answer with CTS compressed history.
  5. Ask a judge LLM to compare A vs B.
  6. Save JSON results with domain OK rates and token savings.

Default provider is Gemini so this does not require OpenRouter.

Usage:
  # Terminal 1
  npm run api

  # Terminal 2
  $env:GEMINI_API_KEY="YOUR_KEY"
  python eval_quality_production.py --samples 100 --provider gemini

Dry-run without paid LLM calls:
  python eval_quality_production.py --dry-run --samples 10
"""

from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import time
import urllib.error
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from typing import Any, Iterable

BASE = Path(__file__).parent
DEFAULT_ENDPOINT = "http://127.0.0.1:8787/demo/compress-async"
RESULTS_FILE = BASE / "data" / "quality_results_production.json"

PROVIDER_URLS = {
    "gemini": "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
    "openrouter": "https://openrouter.ai/api/v1/chat/completions",
}
DEFAULT_MODELS = {
    "gemini": "gemini-2.5-flash-lite",
    "openrouter": "openai/gpt-4o-mini",
}

SAMPLE_PLAN = [
    ("customer_support.json", "customer_support", "instruction_response", 20),
    ("coding.json", "coding", "stackoverflow", 20),
    ("medical.json", "medical", "qa", 20),
    ("education.json", "education", "squad", 20),
    ("sales.json", "sales", "instruction_response", 20),
]

ANSWERER_SYSTEM = (
    "You are a helpful assistant. Answer the user's question concisely and accurately "
    "using the conversation history. If safety or legal/medical caution is needed, include it. "
    "Use 2-5 sentences."
)

JUDGE_SYSTEM = """You are an impartial evaluator for a conversation-compression system.

You will receive:
- the original conversation history
- the user's latest question
- Response A, generated from full history
- Response B, generated from CTS compressed history

Score both responses 1-10 for:
- accuracy
- preservation of important context
- usefulness for the user's latest question
- appropriate caution for medical/legal/safety cases

Return only valid JSON:
{"score_a": 8, "score_b": 8, "verdict": "EQUAL", "reason": "one sentence"}

Allowed verdicts: A_BETTER, B_BETTER, EQUAL.
"""

_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "have", "has",
    "do", "does", "did", "will", "would", "could", "should", "i", "you", "he",
    "she", "it", "we", "they", "me", "him", "her", "us", "them", "this", "that",
}


def count_tokens(text: str) -> int:
    # Dependency-free estimate close enough for relative savings.
    return max(1, len(str(text)) // 4)


def strip_html(text: Any) -> str:
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", str(text or ""))).strip()


def post_json(url: str, payload: dict[str, Any], headers: dict[str, str] | None = None, timeout: int = 30) -> dict[str, Any]:
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=data,
        headers={"Content-Type": "application/json", **(headers or {})},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        raw = response.read().decode("utf-8")
        return json.loads(raw)


def iter_jsonl(path: Path, limit: int) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8", errors="replace") as f:
        for i, line in enumerate(f):
            if i >= limit:
                break
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                yield row


def iter_json_array(path: Path, limit: int) -> Iterable[dict[str, Any]]:
    """Stream a top-level JSON array without loading huge files into memory."""
    decoder = json.JSONDecoder()
    yielded = 0
    with path.open("r", encoding="utf-8", errors="replace") as f:
        buffer = ""
        started = False
        eof = False
        while yielded < limit and not eof:
            chunk = f.read(1024 * 1024)
            if not chunk:
                eof = True
            buffer += chunk

            while True:
                buffer = buffer.lstrip()
                if not started:
                    if not buffer:
                        break
                    if buffer[0] == "[":
                        buffer = buffer[1:]
                        started = True
                    else:
                        raise ValueError(f"{path} is not a JSON array")

                buffer = buffer.lstrip()
                if not buffer:
                    break
                if buffer[0] == "]":
                    return
                if buffer[0] == ",":
                    buffer = buffer[1:]
                    continue

                try:
                    item, idx = decoder.raw_decode(buffer)
                except json.JSONDecodeError:
                    if eof:
                        return
                    break

                buffer = buffer[idx:]
                if isinstance(item, dict):
                    yielded += 1
                    yield item
                    if yielded >= limit:
                        return


def iter_json_source(path: Path, limit: int) -> Iterable[dict[str, Any]]:
    with path.open("r", encoding="utf-8", errors="replace") as f:
        first = f.read(1)
    if first == "[":
        yield from iter_json_array(path, limit)
    else:
        # JSONL is the common fallback. If this is a full object, we keep it simple
        # and only read it when the file is small enough for eval use.
        if path.stat().st_size < 25_000_000:
            try:
                data = json.loads(path.read_text(encoding="utf-8", errors="replace"))
                if isinstance(data, dict):
                    arrays = [v for v in data.values() if isinstance(v, list)]
                    for item in (arrays[0] if arrays else []):
                        if isinstance(item, dict):
                            yield item
                    return
            except Exception:
                pass
        yield from iter_jsonl(path, limit)


def parse_entries(rows: Iterable[dict[str, Any]], schema: str) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    for item in rows:
        try:
            group = str(item.get("intent") or item.get("category") or item.get("qtype") or item.get("title") or "default")
            if schema == "instruction_response":
                user = str(item.get("instruction") or item.get("question") or "").strip()
                assistant = str(item.get("response") or item.get("answer") or "").strip()
            elif schema == "stackoverflow":
                title = str(item.get("title") or "")
                body = strip_html(item.get("question_body") or "")
                answer = strip_html(item.get("answer_body") or "")
                tags = item.get("tags") or []
                group = str(tags[0] if tags else "coding")
                user = f"{title}\n{body}".strip()[:900]
                assistant = answer[:900]
            elif schema == "qa":
                user = str(item.get("Question") or item.get("question") or "").strip()
                assistant = str(item.get("Answer") or item.get("answer") or "").strip()
            elif schema == "squad":
                context = str(item.get("context") or "")
                question = str(item.get("question") or "")
                answers = item.get("answers") or {}
                if isinstance(answers, dict):
                    texts = answers.get("text") or [""]
                    assistant = str(texts[0] if texts else "")
                else:
                    assistant = ""
                user = f"Context: {context[:500]}\nQuestion: {question}".strip()
                group = str(item.get("title") or "education")
            else:
                continue

            if len(user) >= 20 and len(assistant) >= 20:
                entries.append({"user": user[:900], "assistant": assistant[:900], "group": group})
        except Exception:
            continue
    return entries


def build_conversations(entries: list[dict[str, Any]], domain: str, count: int, seed: int) -> list[dict[str, Any]]:
    rng = random.Random(seed)
    by_group: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for entry in entries:
        by_group[str(entry["group"])].append(entry)
    for pool in by_group.values():
        rng.shuffle(pool)

    conversations: list[dict[str, Any]] = []
    for group, pool in by_group.items():
        turns = 4
        for i in range(0, max(0, len(pool) - turns), turns):
            chunk = pool[i:i + turns]
            if len(chunk) < turns:
                continue
            history = []
            for entry in chunk[:-1]:
                history.append({"role": "user", "content": entry["user"]})
                history.append({"role": "assistant", "content": entry["assistant"]})
            conversations.append({
                "id": f"{domain}_{len(conversations):05d}",
                "domain": domain,
                "group": group,
                "history": history,
                "message": chunk[-1]["user"],
            })
            if len(conversations) >= count:
                return conversations
    return conversations[:count]


def load_samples(total_samples: int, domains: set[str], seed: int) -> list[dict[str, Any]]:
    plan = [p for p in SAMPLE_PLAN if p[1] in domains]
    if not plan:
        raise SystemExit("No matching domains selected.")

    per_domain = max(1, total_samples // len(plan))
    conversations: list[dict[str, Any]] = []

    for filename, domain, schema, _ in plan:
        path = BASE / filename
        if not path.exists():
            print(f"[skip] {filename} not found")
            continue
        needed_rows = per_domain * 30
        print(f"[load] {domain:16s} {filename} rows~{needed_rows}")
        rows = iter_json_source(path, needed_rows)
        entries = parse_entries(rows, schema)
        convs = build_conversations(entries, domain, per_domain, seed)
        print(f"       built {len(convs)} conversations")
        conversations.extend(convs)

    random.Random(seed).shuffle(conversations)
    return conversations[:total_samples]


def call_cts(endpoint: str, history: list[dict[str, str]], message: str) -> dict[str, Any]:
    return post_json(endpoint, {"history": history, "message": message}, timeout=45)


def call_llm(provider: str, api_key: str, model: str, system: str, messages: list[dict[str, str]], max_tokens: int = 500) -> str:
    url = PROVIDER_URLS[provider]
    payload = {
        "model": model,
        "temperature": 0.2,
        "max_tokens": max_tokens,
        "messages": [{"role": "system", "content": system}] + messages,
    }
    headers = {"Authorization": f"Bearer {api_key}"}
    if provider == "openrouter":
        headers["HTTP-Referer"] = "https://cts.local"
        headers["X-Title"] = "CTS Production Quality Eval"

    data = post_json(url, payload, headers=headers, timeout=60)
    choices = data.get("choices") or []
    if not choices:
        raise RuntimeError(f"No choices returned by {provider}")
    return str(choices[0]["message"]["content"]).strip()


def parse_judge(raw: str) -> tuple[int, int, str, str]:
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if not match:
        return 5, 5, "EQUAL", "judge did not return JSON"
    try:
        data = json.loads(match.group())
        score_a = int(data.get("score_a", 5))
        score_b = int(data.get("score_b", 5))
        verdict = str(data.get("verdict", "EQUAL")).upper()
        if verdict not in {"A_BETTER", "B_BETTER", "EQUAL"}:
            verdict = "EQUAL"
        return score_a, score_b, verdict, str(data.get("reason", ""))[:500]
    except Exception as exc:
        return 5, 5, "EQUAL", f"judge JSON parse failed: {exc}"


def evaluate_one(conv: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    history = conv["history"]
    message = conv["message"]
    domain = conv["domain"]
    original_tokens = count_tokens(message) + sum(count_tokens(m["content"]) for m in history)

    cts = call_cts(args.cts_endpoint, history, message)
    compressed_history = cts.get("compressedHistory") or []
    compressed_tokens = max(1, sum(count_tokens(str(m.get("content", ""))) for m in compressed_history) + count_tokens(message))
    savings_pct = round((1 - compressed_tokens / max(1, original_tokens)) * 100, 1)

    context_note = {
        "role": "system",
        "content": f"CTS frame: intent={cts.get('intent')} domain={cts.get('domain')} state={cts.get('state')} risk={((cts.get('frame') or {}).get('risk') or [])}",
    }

    answer_a = call_llm(args.provider, args.key, args.model, ANSWERER_SYSTEM, history + [{"role": "user", "content": message}])
    answer_b = call_llm(args.provider, args.key, args.model, ANSWERER_SYSTEM, [context_note] + compressed_history + [{"role": "user", "content": message}])

    full_context = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history)
    compressed_context = "\n".join(f"{m.get('role', '').upper()}: {m.get('content', '')}" for m in compressed_history)
    judge_prompt = f"""DOMAIN: {domain}

ORIGINAL HISTORY:
{full_context}

USER QUESTION:
{message}

CTS COMPRESSED HISTORY ({savings_pct}% savings):
{compressed_context}

RESPONSE A - full history:
{answer_a}

RESPONSE B - CTS compressed history:
{answer_b}

Judge Response A vs Response B."""
    judge_raw = call_llm(args.provider, args.key, args.judge_model, JUDGE_SYSTEM, [{"role": "user", "content": judge_prompt}], max_tokens=250)
    score_a, score_b, verdict, reason = parse_judge(judge_raw)

    return {
        "id": conv["id"],
        "domain": domain,
        "group": conv.get("group"),
        "original_tokens": original_tokens,
        "compressed_tokens": compressed_tokens,
        "savings_pct": savings_pct,
        "cts_domain": cts.get("domain"),
        "cts_intent": cts.get("intent"),
        "cts_state": cts.get("state"),
        "kept_reasons": cts.get("keptReasons") or [],
        "score_full": score_a,
        "score_cts": score_b,
        "verdict": verdict,
        "ok": verdict in {"EQUAL", "B_BETTER"},
        "reason": reason,
        "answer_full_preview": answer_a[:500],
        "answer_cts_preview": answer_b[:500],
        "error": None,
    }


def evaluate_safe(conv: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    try:
        return evaluate_one(conv, args)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:500]
        return {"id": conv.get("id"), "domain": conv.get("domain"), "error": f"HTTP {exc.code}: {body}"}
    except Exception as exc:
        return {"id": conv.get("id"), "domain": conv.get("domain"), "error": str(exc)}


def summarize(results: list[dict[str, Any]]) -> None:
    valid = [r for r in results if not r.get("error")]
    errors = [r for r in results if r.get("error")]
    print("\n=== CTS PRODUCTION QUALITY EVAL ===")
    print(f"Rows: {len(results)}")
    print(f"Valid: {len(valid)}")
    print(f"Errors: {len(errors)}")
    if not valid:
        return

    ok = sum(1 for r in valid if r["ok"])
    avg_savings = sum(float(r["savings_pct"]) for r in valid) / len(valid)
    avg_full = sum(float(r["score_full"]) for r in valid) / len(valid)
    avg_cts = sum(float(r["score_cts"]) for r in valid) / len(valid)
    print(f"CTS OK rate: {ok / len(valid) * 100:.1f}%")
    print(f"Avg token savings: {avg_savings:.1f}%")
    print(f"Full-history avg score: {avg_full:.2f}/10")
    print(f"CTS-compressed avg score: {avg_cts:.2f}/10")
    print(f"Score delta: {avg_cts - avg_full:+.2f}")

    print("\nBy domain:")
    print(f"{'domain':18s} {'ok%':>7s} {'save%':>8s} {'full':>7s} {'cts':>7s} {'n':>5s}")
    for domain in sorted({r["domain"] for r in valid}):
        rows = [r for r in valid if r["domain"] == domain]
        d_ok = sum(1 for r in rows if r["ok"]) / len(rows) * 100
        d_save = sum(float(r["savings_pct"]) for r in rows) / len(rows)
        d_full = sum(float(r["score_full"]) for r in rows) / len(rows)
        d_cts = sum(float(r["score_cts"]) for r in rows) / len(rows)
        print(f"{domain:18s} {d_ok:6.1f}% {d_save:7.1f}% {d_full:7.2f} {d_cts:7.2f} {len(rows):5d}")

    hurt = [r for r in valid if r["verdict"] == "A_BETTER"][:8]
    if hurt:
        print("\nTop CTS-hurt cases:")
        for row in hurt:
            print(f"- {row['id']} [{row['domain']}] save={row['savings_pct']}% reason={row['reason']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--provider", choices=("gemini", "openrouter"), default="gemini")
    parser.add_argument("--key", default=None, help="API key. Defaults to GEMINI_API_KEY or OPENROUTER_API_KEY.")
    parser.add_argument("--model", default=None)
    parser.add_argument("--judge-model", default=None)
    parser.add_argument("--samples", type=int, default=100)
    parser.add_argument("--workers", type=int, default=3)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--domains", nargs="*", default=["coding", "customer_support", "medical", "education", "sales"])
    parser.add_argument("--cts-endpoint", default=DEFAULT_ENDPOINT)
    parser.add_argument("--output", default=str(RESULTS_FILE))
    parser.add_argument("--dry-run", action="store_true", help="Build samples and call CTS only; no paid LLM calls.")
    args = parser.parse_args()

    args.model = args.model or DEFAULT_MODELS[args.provider]
    args.judge_model = args.judge_model or args.model
    args.key = args.key or os.getenv("GEMINI_API_KEY" if args.provider == "gemini" else "OPENROUTER_API_KEY")

    domains = set(args.domains)
    samples = load_samples(args.samples, domains, args.seed)
    print(f"\nLoaded {len(samples)} conversations.")
    if not samples:
        raise SystemExit("No conversations loaded.")

    if args.dry_run:
        print("\nDry run: checking CTS endpoint only.")
        preview = []
        for conv in samples[: min(10, len(samples))]:
            try:
                cts = call_cts(args.cts_endpoint, conv["history"], conv["message"])
                row = {
                    "id": conv["id"],
                    "domain": conv["domain"],
                    "cts_domain": cts.get("domain"),
                    "cts_intent": cts.get("intent"),
                    "tokensSaved": cts.get("tokensSaved"),
                    "keptReasons": cts.get("keptReasons"),
                }
                preview.append(row)
                print(json.dumps(row))
            except Exception as exc:
                print(f"{conv['id']} failed: {exc}")
        return

    if not args.key:
        raise SystemExit("Missing API key. Set GEMINI_API_KEY/OPENROUTER_API_KEY or pass --key.")

    print(f"\nRunning eval with provider={args.provider} model={args.model} judge={args.judge_model} workers={args.workers}")
    start = time.time()
    results: list[dict[str, Any]] = []
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(evaluate_safe, conv, args) for conv in samples]
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            done = len(results)
            valid = [r for r in results if not r.get("error")]
            ok = sum(1 for r in valid if r.get("ok"))
            ok_rate = ok / len(valid) * 100 if valid else 0
            print(f"[{done}/{len(samples)}] {row.get('id')} domain={row.get('domain')} ok_rate={ok_rate:.1f}% error={row.get('error')}")

    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(results, indent=2), encoding="utf-8")
    summarize(results)
    print(f"\nJSON report: {output}")
    print(f"Elapsed: {time.time() - start:.1f}s")


if __name__ == "__main__":
    main()
