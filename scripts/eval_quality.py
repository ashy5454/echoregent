# -*- coding: utf-8 -*-
"""
CTS End-to-End Output Quality Test
=====================================
The only test that actually matters:

  Group A: full conversation history  → LLM → answer
  Group B: CTS compressed history     → LLM → answer
  Judge  : LLM grades both answers, picks winner

This proves (or disproves) whether CTS compression hurts answer quality.

Usage:
  python eval_quality.py --key sk-or-v1-xxxx
  python eval_quality.py --key sk-or-v1-xxxx --samples 50
"""

import json
import time
import random
import sys
import re
import argparse
from collections import defaultdict
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────

CTS_ENDPOINT     = "http://127.0.0.1:8787/demo/compress"
OPENROUTER_URL   = "https://openrouter.ai/api/v1/chat/completions"
GEMINI_URL       = "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions"
BASE             = Path(__file__).parent
RESULTS_FILE     = BASE / "data" / "quality_results.json"

ANSWERER_MODEL   = "openai/gpt-4o-mini"        # cheap + fast for generating answers
JUDGE_MODEL      = "openai/gpt-4o-mini"        # judge (same model, different prompt)
WORKERS          = 5                            # conservative — paying per call
DEFAULT_SAMPLES  = 100                          # 20 per domain × 5 domains

# Domains to sample from (pick ones with clearest right/wrong answers)
SAMPLE_PLAN = [
    ("customer_support.json", "customer_support", "instruction_response", 20),
    ("coding.json",           "coding",           "stackoverflow",        20),
    ("medical.json",          "medical",          "qa",                   20),
    ("education.json",        "education",        "squad",                20),
    ("sales.json",            "sales",            "instruction_response", 20),
]

# ── Imports ───────────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    print("[error] pip install requests"); sys.exit(1)

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text: str) -> int:
        return len(_enc.encode(str(text)))
except ImportError:
    def count_tokens(text: str) -> int:
        return max(1, len(str(text).split()) * 4 // 3)

# ── Dataset loaders (minimal, reused from eval_all_datasets) ──────────────────

_STOPWORDS = {'a','an','the','is','are','was','were','be','been','have','has',
              'do','does','did','will','would','could','should','i','you','he',
              'she','it','we','they','me','him','her','us','them','this','that'}

def parse_entries(data, schema):
    entries = []
    for item in data:
        try:
            group = str(item.get("intent") or item.get("category") or
                        item.get("qtype") or item.get("title") or
                        item.get("tags") or "default")
            if schema == "instruction_response":
                u = str(item.get("instruction") or item.get("question") or "")
                a = str(item.get("response") or item.get("answer") or "")
            elif schema == "stackoverflow":
                clean = lambda s: re.sub(r'<[^>]+>', ' ', str(s)).strip()
                title = str(item.get("title") or "")
                body  = clean(item.get("question_body") or "")
                u     = f"{title}\n{body}".strip()[:600]
                a     = clean(item.get("answer_body") or "")[:600]
                tags  = item.get("tags") or []
                group = tags[0] if tags else "coding"
            elif schema == "qa":
                u = str(item.get("Question") or item.get("question") or "")
                a = str(item.get("Answer") or item.get("answer") or "")
            elif schema == "squad":
                ctx = str(item.get("context") or "")
                q   = str(item.get("question") or "")
                ans = item.get("answers") or {}
                a   = str((ans.get("text") or [""])[0]) if isinstance(ans, dict) else ""
                u   = f"{ctx[:300]} {q}".strip() if ctx else q
                group = str(item.get("title") or "education")
            else:
                continue
            if u and a:
                entries.append({"user": u[:600], "assistant": a[:600],
                                 "group": group, "ground_truth": a})
        except Exception:
            continue
    return entries

def build_conversations(entries, n):
    by_group = defaultdict(list)
    for e in entries:
        by_group[e["group"]].append(e)
    for g in by_group:
        random.shuffle(by_group[g])

    convs = []
    for group, pool in by_group.items():
        turns = 4   # fixed 4-turn history so there's real context to preserve
        for i in range(0, len(pool) - turns, turns):
            chunk   = pool[i:i + turns]
            history = []
            for e in chunk[:-1]:
                history.append({"role": "user",      "content": e["user"]})
                history.append({"role": "assistant",  "content": e["assistant"]})
            convs.append({
                "history":      history,
                "message":      chunk[-1]["user"],
                "ground_truth": chunk[-1]["ground_truth"],
                "group":        group,
            })
            if len(convs) >= n:
                return convs
    return convs[:n]

def load_sample(filename, schema, domain, n):
    path = BASE / filename
    if not path.exists():
        print(f"  [skip] {filename} not found"); return []
    print(f"  [load] {filename} ...", end=" ", flush=True)
    needed = n * 10
    entries_raw = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            first = f.read(1); f.seek(0)
            if first == "[":
                entries_raw = json.load(f)[:needed]
            elif first == "{":
                data = json.load(f)
                arr  = next((v for v in data.values() if isinstance(v, list)), [])
                entries_raw = arr[:needed]
            else:
                for i, line in enumerate(f):
                    if i >= needed: break
                    try: entries_raw.append(json.loads(line.strip()))
                    except: continue
    except Exception as e:
        print(f"error: {e}"); return []

    entries = parse_entries(entries_raw, schema)
    convs   = build_conversations(entries, n)
    print(f"{len(convs)} conversations built")
    for i, c in enumerate(convs):
        c["domain"] = domain
        c["_id"]    = f"{domain}_{i}"
    return convs

# ── API calls ─────────────────────────────────────────────────────────────────

def call_cts(history, message):
    try:
        r = requests.post(CTS_ENDPOINT,
            json={"history": history, "message": message},
            timeout=10, headers={"Content-Type": "application/json"})
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

def call_llm(api_key, model, system, messages, max_tokens=400, base_url=OPENROUTER_URL):
    """Single LLM call — supports OpenRouter and Gemini AI Studio."""
    payload = {
        "model":    model,
        "messages": [{"role": "system", "content": system}] + messages,
        "max_tokens": max_tokens,
        "temperature": 0.3,
    }
    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type":  "application/json",
    }
    if base_url == OPENROUTER_URL:
        headers["HTTP-Referer"] = "https://cts.yudi.co.in"
        headers["X-Title"]      = "CTS Quality Eval"
    try:
        r = requests.post(base_url,
            json=payload,
            headers=headers,
            timeout=30)
        if r.status_code == 200:
            data = r.json()
            return data["choices"][0]["message"]["content"].strip()
        else:
            return None
    except Exception:
        return None

# ── Per-conversation evaluation ───────────────────────────────────────────────

ANSWERER_SYSTEM = (
    "You are a helpful assistant. Answer the user's question concisely and accurately "
    "based on the conversation history provided. Be direct — 2-4 sentences max."
)

JUDGE_SYSTEM = """You are an impartial judge evaluating two AI assistant responses.

You will be given:
- The original conversation history (ground truth context)
- The user's question
- Response A (generated from full history)
- Response B (generated from compressed history)

Score each response 1-10 on:
  - Accuracy: does it correctly address the question?
  - Context usage: does it use relevant conversation history?
  - Completeness: is the answer complete?

Then give your verdict: A_BETTER, B_BETTER, or EQUAL

Respond in this exact JSON format:
{"score_a": 7, "score_b": 8, "verdict": "B_BETTER", "reason": "one sentence"}
"""

def evaluate_conversation(conv, api_key, base_url=OPENROUTER_URL):
    cid         = conv["_id"]
    history     = conv["history"]
    message     = conv["message"]
    domain      = conv["domain"]

    orig_tokens = count_tokens(message) + sum(count_tokens(m["content"]) for m in history)

    # ── Step 1: Get CTS compressed version ───────────────────────────────
    cts = call_cts(history, message)
    if cts is None:
        return {"id": cid, "domain": domain, "error": "cts_failed",
                "original_tokens": orig_tokens, "compressed_tokens": orig_tokens}

    comp_hist       = cts.get("compressedHistory", [])
    comp_intent     = cts.get("intent", "")
    comp_state      = cts.get("state", "")
    comp_tokens     = max(1, sum(count_tokens(str(m.get("content",""))) for m in comp_hist))
    reduction_pct   = round((1 - comp_tokens / orig_tokens) * 100, 1)

    # Build compressed context: intent + state + compressed history
    compressed_context = []
    if comp_intent:
        compressed_context.append({
            "role": "system",
            "content": f"[CTS Intent: {comp_intent} | State: {comp_state}]"
        })
    compressed_context.extend(comp_hist)

    # ── Step 2: Get Answer A (full history) ───────────────────────────────
    answer_a = call_llm(api_key, ANSWERER_MODEL, ANSWERER_SYSTEM,
                        history + [{"role": "user", "content": message}], base_url=base_url)

    # ── Step 3: Get Answer B (CTS compressed history) ─────────────────────
    answer_b = call_llm(api_key, ANSWERER_MODEL, ANSWERER_SYSTEM,
                        compressed_context + [{"role": "user", "content": message}], base_url=base_url)

    if not answer_a or not answer_b:
        return {"id": cid, "domain": domain, "error": "llm_failed",
                "original_tokens": orig_tokens, "compressed_tokens": comp_tokens}

    # ── Step 4: Judge ─────────────────────────────────────────────────────
    full_context_text = "\n".join(f"{m['role'].upper()}: {m['content']}" for m in history)
    judge_prompt = f"""ORIGINAL CONVERSATION:
{full_context_text}

USER QUESTION: {message}

RESPONSE A (from full history, {orig_tokens} tokens):
{answer_a}

RESPONSE B (from CTS compressed history, {comp_tokens} tokens, {reduction_pct}% reduction):
{answer_b}

Judge these responses."""

    judge_raw = call_llm(api_key, JUDGE_MODEL, JUDGE_SYSTEM,
                         [{"role": "user", "content": judge_prompt}], max_tokens=200, base_url=base_url)

    # Parse judge response
    score_a, score_b, verdict, reason = 5, 5, "EQUAL", ""
    if judge_raw:
        try:
            # Extract JSON from response
            match = re.search(r'\{.*\}', judge_raw, re.DOTALL)
            if match:
                j       = json.loads(match.group())
                score_a = int(j.get("score_a", 5))
                score_b = int(j.get("score_b", 5))
                verdict = str(j.get("verdict", "EQUAL")).upper()
                reason  = str(j.get("reason", ""))
        except Exception:
            pass

    return {
        "id":               cid,
        "domain":           domain,
        "original_tokens":  orig_tokens,
        "compressed_tokens": comp_tokens,
        "reduction_pct":    reduction_pct,
        "score_a":          score_a,      # full history answer quality
        "score_b":          score_b,      # compressed answer quality
        "verdict":          verdict,       # A_BETTER / B_BETTER / EQUAL
        "reason":           reason,
        "answer_a":         answer_a[:300],
        "answer_b":         answer_b[:300],
        "cts_intent":       comp_intent,
        "error":            None,
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def run(api_key, total_samples, base_url=OPENROUTER_URL):
    random.seed(42)
    provider = "Gemini" if base_url == GEMINI_URL else "OpenRouter"
    print(f"\n[CTS Quality Eval] — {total_samples} conversations ({provider})")
    print(f"  Answerer : {ANSWERER_MODEL}")
    print(f"  Judge    : {JUDGE_MODEL}")
    print(f"  Workers  : {WORKERS}\n")

    all_convs = []
    per = total_samples // len(SAMPLE_PLAN)
    for filename, domain, schema, _ in SAMPLE_PLAN:
        print(f"[{domain.upper()}]")
        convs = load_sample(filename, schema, domain, per)
        all_convs.extend(convs)

    random.shuffle(all_convs)
    total   = len(all_convs)
    results = []

    print(f"\n[eval] Running {total} conversations ({WORKERS} workers)...\n")
    start = time.time()

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(evaluate_conversation, c, api_key, base_url): c
                   for c in all_convs}
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            done = len(results)

            valid = [r for r in results if not r.get("error")]
            if valid:
                eq  = sum(1 for r in valid if r["verdict"] == "EQUAL")
                ab  = sum(1 for r in valid if r["verdict"] == "A_BETTER")
                bb  = sum(1 for r in valid if r["verdict"] == "B_BETTER")
                avg_a = sum(r["score_a"] for r in valid) / len(valid)
                avg_b = sum(r["score_b"] for r in valid) / len(valid)
                rate  = done / (time.time() - start) * 60

                print(f"\r[{done:3d}/{total}]  {rate:5.0f}/min  |  "
                      f"Full:{avg_a:.1f}  CTS:{avg_b:.1f}  |  "
                      f"Equal:{eq}  A-better:{ab}  B-better:{bb}",
                      end="", flush=True)

    print("\n\n[eval] Done.")
    save_results(results)
    print_summary(results)

def save_results(results):
    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)
    print(f"[output] {RESULTS_FILE}")

def print_summary(results):
    valid = [r for r in results if not r.get("error")]
    errs  = len(results) - len(valid)

    if not valid:
        print("[summary] No valid results."); return

    eq   = sum(1 for r in valid if r["verdict"] == "EQUAL")
    ab   = sum(1 for r in valid if r["verdict"] == "A_BETTER")
    bb   = sum(1 for r in valid if r["verdict"] == "B_BETTER")
    avg_a = sum(r["score_a"] for r in valid) / len(valid)
    avg_b = sum(r["score_b"] for r in valid) / len(valid)
    avg_red = sum(r["reduction_pct"] for r in valid) / len(valid)

    cts_wins_or_ties = eq + bb
    pct_ok = cts_wins_or_ties / len(valid) * 100

    print("\n" + "=" * 62)
    print("  CTS Output Quality Results")
    print("=" * 62)
    print(f"  Conversations tested   : {len(valid)}")
    print(f"  Avg token reduction    : {avg_red:.1f}%")
    print()
    print("  -- ANSWER QUALITY (scored 1-10 by judge LLM) --")
    print(f"  Full history avg score : {avg_a:.2f} / 10")
    print(f"  CTS compressed avg     : {avg_b:.2f} / 10")
    print(f"  Score difference       : {avg_b - avg_a:+.2f}  "
          f"({'CTS better' if avg_b > avg_a else 'Full better' if avg_a > avg_b else 'Equal'})")
    print()
    print("  -- VERDICT BREAKDOWN --")
    print(f"  Equal quality          : {eq:>4d}  ({eq/len(valid)*100:.1f}%)")
    print(f"  CTS answer BETTER      : {bb:>4d}  ({bb/len(valid)*100:.1f}%)")
    print(f"  Full history BETTER    : {ab:>4d}  ({ab/len(valid)*100:.1f}%)")
    print()
    print(f"  CTS matches or beats full history: {pct_ok:.1f}% of the time")
    print()
    print("  -- BY DOMAIN --")
    print(f"  {'Domain':20s}  {'Full':>5s}  {'CTS':>5s}  {'OK%':>6s}  {'N':>4s}")
    print("-" * 50)
    for domain in sorted(set(r["domain"] for r in valid)):
        rows  = [r for r in valid if r["domain"] == domain]
        d_a   = sum(r["score_a"] for r in rows) / len(rows)
        d_b   = sum(r["score_b"] for r in rows) / len(rows)
        ok    = sum(1 for r in rows if r["verdict"] in ("EQUAL","B_BETTER"))
        print(f"  {domain:20s}  {d_a:>5.2f}  {d_b:>5.2f}  {ok/len(rows)*100:>5.1f}%  {len(rows):>4d}")

    print()
    print("  -- CASES WHERE CTS CLEARLY HURT (A_BETTER) --")
    hurt = [r for r in valid if r["verdict"] == "A_BETTER"]
    for r in hurt[:5]:
        print(f"  [{r['domain']}] {r['reduction_pct']}% reduction")
        print(f"    Reason: {r['reason']}")
        print()

    print("=" * 62)
    if errs:
        print(f"  [warn] {errs} errors (CTS or LLM failures)")
    print(f"  Full results -> {RESULTS_FILE}")
    print("=" * 62 + "\n")

# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--key",     required=True, help="OpenRouter or Gemini API key")
    parser.add_argument("--samples", type=int, default=DEFAULT_SAMPLES)
    parser.add_argument("--gemini",  action="store_true", help="Use Gemini AI Studio instead of OpenRouter")
    parser.add_argument("--model",   default=None, help="Override model (default: gemini-2.5-flash-lite with --gemini)")
    args = parser.parse_args()

    if args.gemini:
        if args.model:
            globals()["ANSWERER_MODEL"] = args.model
            globals()["JUDGE_MODEL"]    = args.model
        else:
            globals()["ANSWERER_MODEL"] = "gemini-2.5-flash-lite"
            globals()["JUDGE_MODEL"]    = "gemini-2.5-flash-lite"
        run(args.key, args.samples, base_url=GEMINI_URL)
    else:
        if args.model:
            globals()["ANSWERER_MODEL"] = args.model
            globals()["JUDGE_MODEL"]    = args.model
        run(args.key, args.samples)
