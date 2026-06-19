# -*- coding: utf-8 -*-
"""
CTS vs LoCoMo Benchmark
========================
Evaluates CTS context compression against the same LoCoMo benchmark mem0 used.

Method:
  For each conversation (10 total, ~588 turns each):
    1. Build full message history from all session turns
    2. CTS compress the history → get compressed messages + token stats
    3. For each sampled QA question:
       A) Ask Gemini with FULL history → answer_full
       B) Ask Gemini with CTS COMPRESSED history → answer_cts
       C) Score both against ground truth (F1 token overlap + exact match)

Metrics reported:
  - F1 score: full context vs CTS compressed
  - Token reduction: how much CTS shrinks the context
  - OK rate: % of questions where CTS matches or beats full context F1

mem0 baseline on LoCoMo: 92.5 overall score, ~6,956 mean tokens per retrieval
Full-context baseline: 25,000+ tokens

Run:
  python eval_locomo.py                    # 15 questions per conversation (150 total)
  python eval_locomo.py --questions 50     # more questions
  python eval_locomo.py --questions 0      # all questions (~1986)
"""

import json
import time
import sys
import re
import argparse
import threading
from pathlib import Path
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
except ImportError:
    print("[error] pip install requests"); sys.exit(1)

BASE         = Path(__file__).parent
LOCOMO_FILE  = BASE / "data" / "locomo10.json"
RESULTS_FILE = BASE / "data" / "locomo_results.json"
CTS_ENDPOINT = "http://127.0.0.1:8787/demo/compress"
GEMINI_MODEL = "gemini-3.5-flash"
GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# ── Load .env key ─────────────────────────────────────────────────────────────

def load_env_key():
    for path in [BASE / ".env", Path(__file__).parent.parent / ".env"]:
        if path.exists():
            for line in path.read_text().splitlines():
                line = line.strip()
                if line.startswith("GEMINI_API_KEY="):
                    return line.split("=", 1)[1].strip()
    return ""

# ── Throttle ──────────────────────────────────────────────────────────────────

import os
_rate_lock    = threading.Lock()
_last_call    = [0.0]
_MIN_INTERVAL = float(os.environ.get("GEMINI_MIN_INTERVAL", "0.5"))

def _throttle():
    with _rate_lock:
        wait = _MIN_INTERVAL - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()

# ── Token counter ─────────────────────────────────────────────────────────────

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text):
        return len(_enc.encode(str(text)))
except ImportError:
    def count_tokens(text):
        return max(1, len(str(text).split()) * 4 // 3)

def messages_tokens(messages):
    return sum(count_tokens(m.get("content", "")) for m in messages)

# ── Gemini call ───────────────────────────────────────────────────────────────

def call_gemini(api_key, messages, system, max_tokens=300):
    _throttle()
    url = GEMINI_BASE.format(model=GEMINI_MODEL) + f"?key={api_key}"
    contents = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents":          contents,
        "generationConfig":  {
            "maxOutputTokens": max_tokens,
            "temperature":     0.1,
            "thinkingConfig":  {"thinkingBudget": 0},
        },
    }
    for attempt in range(5):
        try:
            r = requests.post(url, json=payload,
                              headers={"Content-Type": "application/json"},
                              timeout=40)
            if r.status_code == 200:
                cand  = r.json().get("candidates", [{}])[0]
                parts = cand.get("content", {}).get("parts", [])
                if parts and parts[0].get("text"):
                    return parts[0]["text"].strip()
                return None
            if r.status_code in (429, 500, 503):
                time.sleep(2 * (attempt + 1)); continue
            return None
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None

# ── CTS compress ──────────────────────────────────────────────────────────────

def call_cts(history, message):
    try:
        r = requests.post(CTS_ENDPOINT,
                          json={"history": history, "message": message},
                          timeout=30)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"  [cts error] {e}")
    return None

# ── LoCoMo data helpers ───────────────────────────────────────────────────────

CATEGORY_NAMES = {
    1: "single-session",
    2: "multi-session",
    3: "reasoning",
    4: "world-knowledge",
    5: "temporal",
}

def build_history_from_conv(conv):
    """Convert LoCoMo conversation dict into CTS-style messages list."""
    speaker_a = conv.get("speaker_a", "Person A")
    messages  = []
    session_keys = sorted(
        [k for k in conv if re.match(r"session_\d+$", k)],
        key=lambda k: int(k.split("_")[1])
    )
    # Alternate speaker mapping: speaker_a → user, other → assistant
    for sess_key in session_keys:
        turns = conv.get(sess_key, [])
        date  = conv.get(f"{sess_key}_date_time", "")
        if date:
            # Inject date as a system-style user note
            messages.append({"role": "user",
                              "content": f"[Session date: {date}]"})
            messages.append({"role": "assistant", "content": "Understood."})
        for turn in turns:
            role    = "user" if turn["speaker"] == speaker_a else "assistant"
            content = f"{turn['speaker']}: {turn['text']}"
            messages.append({"role": role, "content": content})
    return messages

# ── Scoring ───────────────────────────────────────────────────────────────────

def normalize(text):
    text = str(text).lower()
    text = re.sub(r"[^\w\s]", "", text)
    return text.split()

def f1_score(prediction, ground_truth):
    pred_tokens = normalize(prediction)
    gold_tokens = normalize(ground_truth)
    if not pred_tokens or not gold_tokens:
        return 0.0
    common = set(pred_tokens) & set(gold_tokens)
    if not common:
        return 0.0
    precision = len(common) / len(pred_tokens)
    recall    = len(common) / len(gold_tokens)
    return 2 * precision * recall / (precision + recall)

def exact_match(prediction, ground_truth):
    return int(normalize(prediction) == normalize(ground_truth))

# ── System prompt ─────────────────────────────────────────────────────────────

QA_SYSTEM = (
    "You are answering questions about a long conversation between two people. "
    "Answer ONLY based on what was discussed. Be concise — 1 sentence or a short phrase. "
    "If the answer is a date, name, or fact, give it directly with no extra words."
)

def build_qa_messages(history, question):
    return history + [{"role": "user", "content": f"Question: {question}"}]

# ── Per-question eval ─────────────────────────────────────────────────────────

def eval_question(api_key, full_history, cts_result, qa, sample_id):
    question    = qa["question"]
    ground_truth = qa["answer"]
    category    = qa.get("category", 0)

    cts_messages = cts_result.get("compressedHistory", full_history) if cts_result else full_history

    # Answer A: full history
    msgs_full = build_qa_messages(full_history[-40:], question)  # last 40 turns cap
    ans_full  = call_gemini(api_key, msgs_full, QA_SYSTEM, max_tokens=100)

    # Answer B: CTS compressed
    msgs_cts  = build_qa_messages(cts_messages, question)
    ans_cts   = call_gemini(api_key, msgs_cts, QA_SYSTEM, max_tokens=100)

    if not ans_full or not ans_cts:
        return None

    f1_full = f1_score(ans_full, ground_truth)
    f1_cts  = f1_score(ans_cts,  ground_truth)
    em_full = exact_match(ans_full, ground_truth)
    em_cts  = exact_match(ans_cts,  ground_truth)

    return {
        "sample_id":    sample_id,
        "category":     category,
        "question":     question,
        "ground_truth": ground_truth,
        "ans_full":     ans_full,
        "ans_cts":      ans_cts,
        "f1_full":      f1_full,
        "f1_cts":       f1_cts,
        "em_full":      em_full,
        "em_cts":       em_cts,
        "cts_better":   f1_cts > f1_full + 0.05,
        "full_better":  f1_full > f1_cts + 0.05,
    }

# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--questions", type=int, default=15,
                        help="Max questions per conversation (0 = all)")
    parser.add_argument("--workers",   type=int, default=4)
    args = parser.parse_args()

    api_key = load_env_key()
    if not api_key:
        print("[error] GEMINI_API_KEY not found in .env"); sys.exit(1)
    print(f"[key] GEMINI_API_KEY loaded ({api_key[:10]}...)")

    # Preflight
    r = requests.get("http://127.0.0.1:8787/health", timeout=5)
    assert r.json().get("ready"), "CTS server not ready"
    print(f"[server] CTS up")

    if not LOCOMO_FILE.exists():
        print(f"[error] {LOCOMO_FILE} not found — run download first"); sys.exit(1)

    with open(LOCOMO_FILE, encoding="utf-8") as f:
        data = json.load(f)

    print(f"\n[LoCoMo Benchmark]  model={GEMINI_MODEL}  workers={args.workers}")
    print(f"mem0 baseline: 92.5 score | ~6,956 tokens/retrieval")
    print("=" * 60)

    all_results = []
    tasks       = []

    for sample in data:
        sid  = sample["sample_id"]
        conv = sample["conversation"]
        qas  = sample["qa"]

        # Build full history
        full_history = build_history_from_conv(conv)
        full_tokens  = messages_tokens(full_history)

        # CTS compress once per conversation
        last_message = full_history[-1]["content"] if full_history else "Continue."
        history_to_compress = full_history[:-1] if len(full_history) > 1 else full_history
        cts_result = call_cts(history_to_compress, last_message)

        cts_tokens = 0
        if cts_result:
            compressed = cts_result.get("compressedHistory", [])
            cts_tokens = messages_tokens(compressed)
        else:
            cts_tokens = full_tokens
            compressed = full_history

        reduction = (1 - cts_tokens / full_tokens) * 100 if full_tokens > 0 else 0

        print(f"\n[{sid}]  turns={len(full_history)}  "
              f"full={full_tokens:,} tokens  "
              f"CTS={cts_tokens:,} tokens  "
              f"reduction={reduction:.1f}%")

        # Sample questions
        sampled_qas = qas if args.questions == 0 else qas[:args.questions]
        print(f"  QA: {len(sampled_qas)} questions "
              f"(categories: {set(q['category'] for q in sampled_qas)})")

        for qa in sampled_qas:
            tasks.append((api_key, full_history, cts_result, qa, sid))

    print(f"\n[eval] Running {len(tasks)} questions with {args.workers} workers...")
    print("-" * 60)

    done   = 0
    f1_full_sum = f1_cts_sum = em_full_sum = em_cts_sum = 0.0
    ok_count    = 0

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(eval_question, *t): t for t in tasks}
        for fut in as_completed(futures):
            res = fut.result()
            done += 1
            if res is None:
                continue
            all_results.append(res)
            f1_full_sum += res["f1_full"]
            f1_cts_sum  += res["f1_cts"]
            em_full_sum += res["em_full"]
            em_cts_sum  += res["em_cts"]
            if not res["full_better"]:
                ok_count += 1
            n = len(all_results)
            print(f"\r[{done:>4}/{len(tasks)}]  "
                  f"F1 full={f1_full_sum/n:.3f}  "
                  f"F1 CTS={f1_cts_sum/n:.3f}  "
                  f"EM full={em_full_sum/n:.3f}  "
                  f"EM CTS={em_cts_sum/n:.3f}  "
                  f"OK={ok_count/n*100:.1f}%",
                  end="", flush=True)

    print("\n")

    if not all_results:
        print("[error] No valid results"); sys.exit(1)

    n = len(all_results)

    # Per-category breakdown
    by_cat = defaultdict(list)
    for r in all_results:
        by_cat[r["category"]].append(r)

    print("=" * 60)
    print(f"[LoCoMo Results]  n={n} questions")
    print("=" * 60)
    print(f"{'Metric':<25} {'Full Context':>14} {'CTS':>10}")
    print("-" * 50)
    print(f"{'F1 Score':<25} {f1_full_sum/n:>14.3f} {f1_cts_sum/n:>10.3f}")
    print(f"{'Exact Match':<25} {em_full_sum/n:>14.3f} {em_cts_sum/n:>10.3f}")
    print(f"{'OK Rate (CTS>=Full)':<25} {'—':>14} {ok_count/n*100:>9.1f}%")
    print()
    print("Per-category F1:")
    for cat in sorted(by_cat.keys()):
        items   = by_cat[cat]
        f_full  = sum(r["f1_full"] for r in items) / len(items)
        f_cts   = sum(r["f1_cts"]  for r in items) / len(items)
        label   = CATEGORY_NAMES.get(cat, f"cat-{cat}")
        delta   = f_cts - f_full
        symbol  = "+" if delta >= 0 else ""
        print(f"  {label:<20} full={f_full:.3f}  CTS={f_cts:.3f}  delta={symbol}{delta:.3f}")

    # Token stats
    token_reductions = []
    for sample in data:
        conv        = sample["conversation"]
        full_h      = build_history_from_conv(conv)
        full_tok    = messages_tokens(full_h)
        cts_r       = call_cts(full_h[:-1] if len(full_h)>1 else full_h,
                               full_h[-1]["content"] if full_h else "")
        if cts_r:
            cts_tok = messages_tokens(cts_r.get("compressedHistory", full_h))
            token_reductions.append((full_tok, cts_tok))

    if token_reductions:
        avg_full = sum(f for f, _ in token_reductions) / len(token_reductions)
        avg_cts  = sum(c for _, c in token_reductions) / len(token_reductions)
        avg_red  = (1 - avg_cts / avg_full) * 100
        print()
        print(f"Token usage (avg per conversation):")
        print(f"  Full context : {avg_full:,.0f} tokens")
        print(f"  CTS          : {avg_cts:,.0f} tokens")
        print(f"  Reduction    : {avg_red:.1f}%")
        print()
        print(f"mem0 benchmark comparison:")
        print(f"  mem0 score   : 92.5  |  mem0 tokens/retrieval: ~6,956")
        print(f"  CTS F1       : {f1_cts_sum/n:.3f}  |  CTS tokens: {avg_cts:,.0f}")

    # Save results
    RESULTS_FILE.parent.mkdir(exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump({
            "meta": {
                "model":        GEMINI_MODEL,
                "questions":    n,
                "workers":      args.workers,
                "timestamp":    time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            },
            "summary": {
                "f1_full":      f1_full_sum / n,
                "f1_cts":       f1_cts_sum  / n,
                "em_full":      em_full_sum / n,
                "em_cts":       em_cts_sum  / n,
                "ok_rate":      ok_count / n,
            },
            "results": all_results,
        }, f, indent=2)
    print(f"\n[saved] {RESULTS_FILE}")

if __name__ == "__main__":
    main()
