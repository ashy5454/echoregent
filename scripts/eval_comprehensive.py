# -*- coding: utf-8 -*-
"""
CTS Comprehensive Evaluation Suite
====================================
Runs all meaningful benchmarks in a single pass:

  1. Token Reduction          -- how much we compress (%)
  2. Domain Accuracy          -- classification correctness
  3. Latency                  -- p50 / p95 / p99 CTS response time (ms)
  4. ROUGE-L                  -- industry-standard compression quality score
                                 (longest common subsequence of content words)
  5. Answer Retention         -- for SQuAD/QA: does the exact answer survive?
  6. CTS vs Sliding Window    -- compare CTS against the naive "keep last 5 turns"
  7. Reduction by Turn Count  -- does CTS get better on longer conversations?
  8. Cost Savings Projection  -- $ saved/month at different usage scales

ROUGE-L is the key metric used in all summarization/compression papers
(CNN/DailyMail, XSum, LongLLMLingua, AutoCompressor, etc.)
It measures longest common subsequence — captures preserved meaning even when
words are reordered or partially rephrased.
"""

import json
import csv
import time
import random
import sys
import re
from collections import defaultdict
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────

CTS_ENDPOINT  = "http://127.0.0.1:8787/demo/compress"
BASE          = Path(__file__).parent
RESULTS_CSV   = BASE / "data" / "comprehensive_results.csv"
PROGRESS_FILE = BASE / "data" / "comprehensive_progress.json"
WORKERS       = 20
SLIDING_K     = 5     # turns to keep in sliding window baseline

DATASETS = [
    ("customer_support.json", "customer_support", "instruction_response", 2_000),
    ("general.json",          "general",          "instruction_response", 2_000),
    ("hospitality.json",      "commerce",         "instruction_response", 2_000),
    ("sales.json",            "sales",            "instruction_response", 2_000),
    ("coding.json",           "coding",           "stackoverflow",        2_000),
    ("medical.json",          "medical",          "qa",                   400),
    ("legal.json",            "legal",            "legal",                5),
    ("education.json",        "education",        "squad",                2_000),
    ("commerce.json",         "commerce",         "instruction_response", 2_000),
    ("multiwoz.json",         "mixed",            "multiwoz",             1_000),
]

MULTIWOZ_MAP = {
    "restaurant": "commerce", "hotel": "commerce", "taxi": "commerce",
    "train": "commerce",      "bus": "commerce",   "attraction": "general",
    "hospital": "medical",    "police": "legal",
}

# Pricing per 1M input tokens (2026)
MODEL_PRICING = {
    "Claude Opus 4":     5.00,
    "Claude Sonnet 4.5": 3.00,
    "GPT-4.1":           2.00,
    "o3":                2.00,
    "o4-mini":           1.10,
    "Gemini 2.5 Pro":    1.25,
    "Gemini 2.5 Flash":  0.30,
}

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

# ── ROUGE-L (no external deps) ────────────────────────────────────────────────

_STOPWORDS = {
    'a','an','the','is','are','was','were','be','been','being','have','has',
    'had','do','does','did','will','would','could','should','may','might',
    'shall','can','i','you','he','she','it','we','they','me','him','her',
    'us','them','my','your','his','its','our','their','this','that','these',
    'those','what','which','who','when','where','why','how','all','each',
    'every','both','few','more','most','other','some','such','no','not',
    'only','same','so','than','too','very','just','but','and','or','as',
    'at','by','for','from','in','into','of','on','to','with','about',
    'after','before','then','there','here','if','also','even','still','yet',
    'get','got','like','go','use','used','one','two','three','new','old',
}

def _tokenize(text: str) -> list:
    """Lowercase word tokens, stripped of stopwords and short words."""
    words = re.findall(r'[a-z0-9]+', str(text).lower())
    return [w for w in words if len(w) > 2 and w not in _STOPWORDS]

def _lcs_len(x: list, y: list) -> int:
    """Length of longest common subsequence (DP, O(m*n))."""
    m, n = len(x), len(y)
    if m == 0 or n == 0:
        return 0
    # Space-optimised: two rows only
    prev = [0] * (n + 1)
    curr = [0] * (n + 1)
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if x[i-1] == y[j-1]:
                curr[j] = prev[j-1] + 1
            else:
                curr[j] = max(prev[j], curr[j-1])
        prev, curr = curr, [0] * (n + 1)
    return prev[n]

def rouge_l(reference: str, hypothesis: str) -> float:
    """
    ROUGE-L F1 score (0-100).
    reference  = original text (what we started with)
    hypothesis = compressed text (what CTS produced)
    """
    ref = _tokenize(reference)
    hyp = _tokenize(hypothesis)
    if not ref or not hyp:
        return 0.0
    lcs = _lcs_len(ref, hyp)
    precision = lcs / len(hyp)
    recall    = lcs / len(ref)
    if precision + recall == 0:
        return 0.0
    f1 = 2 * precision * recall / (precision + recall)
    return round(f1 * 100, 2)

# ── Answer retention (exact string match for SQuAD/QA) ───────────────────────

def answer_retained(answer_text: str, compressed_text: str) -> bool:
    """
    Check if the key words from the ground-truth answer survive in the
    compressed output.  We require 70%+ of answer content words to be present.
    """
    ans_words  = set(_tokenize(answer_text))
    comp_words = set(_tokenize(compressed_text))
    if not ans_words:
        return True
    overlap = len(ans_words & comp_words) / len(ans_words)
    return overlap >= 0.70

# ── Sliding window baseline ───────────────────────────────────────────────────

def sliding_window(history: list, k: int = SLIDING_K) -> list:
    """Keep only the last k messages (naive baseline used by most chatbots)."""
    return history[-k:] if len(history) > k else history

# ── Schema parsers (same as eval_all_datasets.py) ────────────────────────────

def parse_entries(data: list, schema: str) -> list:
    entries = []
    for item in data:
        try:
            group = str(
                item.get("intent") or item.get("category") or
                item.get("qtype")  or item.get("title")    or
                item.get("tags")   or "default"
            )
            answer_text = ""
            if schema == "instruction_response":
                u = str(item.get("instruction") or item.get("question") or "")
                a = str(item.get("response")    or item.get("answer")   or "")
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
                a = str(item.get("Answer")   or item.get("answer")   or "")
                answer_text = a
            elif schema == "legal":
                u = str(item.get("text")   or "")
                a = str(item.get("answer") or "")
                group = "legal_classification"
            elif schema == "squad":
                ctx = str(item.get("context") or "")
                q   = str(item.get("question") or "")
                ans = item.get("answers") or {}
                a   = str((ans.get("text") or [""])[0]) if isinstance(ans, dict) else ""
                u   = f"{ctx[:300]} {q}".strip() if ctx else q
                group       = str(item.get("title") or "education")
                answer_text = a        # exact ground truth answer span
            else:
                continue
            if u and a:
                entries.append({
                    "user": u[:600], "assistant": a[:600],
                    "group": group,  "answer_text": answer_text,
                })
        except Exception:
            continue
    return entries

def build_synthetic_conversations(entries: list, n: int) -> list:
    by_group = defaultdict(list)
    for e in entries:
        by_group[e["group"]].append(e)
    for g in by_group:
        random.shuffle(by_group[g])

    convs  = []
    groups = list(by_group.keys())
    random.shuffle(groups)

    for group in groups:
        pool  = by_group[group]
        turns = random.randint(3, 5)
        for i in range(0, len(pool) - turns, turns):
            chunk   = pool[i:i + turns]
            history = []
            for e in chunk[:-1]:
                history.append({"role": "user",      "content": e["user"]})
                history.append({"role": "assistant",  "content": e["assistant"]})
            # Collect answer texts from history turns (ground truth for QA datasets)
            answer_texts = [e["answer_text"] for e in chunk[:-1] if e.get("answer_text")]
            convs.append({
                "history":      history,
                "message":      chunk[-1]["user"],
                "group":        group,
                "answer_texts": answer_texts,   # ground truth answers in history
            })
            if len(convs) >= n:
                return convs

    # Pad with cross-group if needed
    all_e = [e for pool in by_group.values() for e in pool]
    random.shuffle(all_e)
    i = 0
    while len(convs) < n and i + 3 < len(all_e):
        turns = random.randint(3, 5)
        chunk = all_e[i:i + turns]
        history = []
        for e in chunk[:-1]:
            history.append({"role": "user",      "content": e["user"]})
            history.append({"role": "assistant",  "content": e["assistant"]})
        convs.append({
            "history": history, "message": chunk[-1]["user"],
            "group": "mixed",   "answer_texts": [],
        })
        i += turns

    return convs[:n]

def load_multiwoz(path: Path, n: int) -> list:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    by_domain = defaultdict(list)
    for conv in data:
        for svc in conv.get("services", []):
            if svc in MULTIWOZ_MAP:
                by_domain[svc].append(conv); break
    convs = []
    per   = max(1, n // len(MULTIWOZ_MAP))
    for domain, pool in by_domain.items():
        for conv in random.sample(pool, min(per, len(pool))):
            turns = conv.get("turns", [])
            msgs  = []
            for t in turns:
                role = "user" if t.get("speaker","").upper() == "USER" else "assistant"
                utt  = t.get("utterance","").strip()
                if utt:
                    msgs.append({"role": role, "content": utt})
            if len(msgs) < 2:
                continue
            last_user = next((i for i in range(len(msgs)-1,-1,-1) if msgs[i]["role"]=="user"), None)
            if last_user is None:
                continue
            convs.append({
                "history":      msgs[:last_user],
                "message":      msgs[last_user]["content"],
                "domain":       MULTIWOZ_MAP.get(domain, "general"),
                "mwoz_domain":  domain,
                "answer_texts": [],
            })
    random.shuffle(convs)
    return convs[:n]

def load_dataset(filename: str, schema: str, cts_domain: str, cap: int) -> list:
    path = BASE / filename
    if not path.exists():
        print(f"  [skip] {filename} not found"); return []
    size_mb = path.stat().st_size / 1_048_576
    print(f"  [load] {filename} ({size_mb:.0f} MB) ...", end=" ", flush=True)

    if schema == "multiwoz":
        convs = load_multiwoz(path, cap)
        print(f"{len(convs)} conversations")
        return [{"cts_domain": cts_domain, "schema": schema, **c} for c in convs]

    needed     = cap * 5 * 2
    entries_raw = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            first_char = f.read(1); f.seek(0)
            if first_char == "[":
                data = json.load(f); entries_raw = data[:needed]
            elif first_char == "{":
                data = json.load(f)
                arr  = next((v for v in data.values() if isinstance(v, list)), [])
                entries_raw = arr[:needed]
            else:
                for i, line in enumerate(f):
                    if i >= needed: break
                    line = line.strip()
                    if line:
                        try: entries_raw.append(json.loads(line))
                        except Exception: continue
    except Exception as e:
        print(f"read error: {e}"); return []

    entries = parse_entries(entries_raw, schema)
    print(f"{len(entries_raw)} entries -> {len(entries)} parsed")
    convs = build_synthetic_conversations(entries, cap)
    return [{
        "cts_domain":   cts_domain,
        "schema":       schema,
        "history":      c["history"],
        "message":      c["message"],
        "answer_texts": c.get("answer_texts", []),
    } for c in convs]

# ── CTS call ──────────────────────────────────────────────────────────────────

def call_cts(history: list, message: str, retries: int = 3):
    """Returns (response_dict, latency_ms) or (None, latency_ms)."""
    for attempt in range(retries):
        try:
            t0   = time.perf_counter()
            resp = requests.post(
                CTS_ENDPOINT,
                json={"history": history, "message": message},
                timeout=10,
                headers={"Content-Type": "application/json"},
            )
            latency = (time.perf_counter() - t0) * 1000   # ms
            if resp.status_code == 429:
                print("\n[rate-limit] sleeping 65s ..."); time.sleep(65); continue
            if resp.status_code != 200:
                return None, latency
            return resp.json(), latency
        except requests.exceptions.Timeout:
            time.sleep(2)
        except Exception:
            return None, 0.0
    return None, 0.0

# ── Progress ──────────────────────────────────────────────────────────────────

def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        try:
            with open(PROGRESS_FILE) as f:
                return json.load(f)
        except Exception:
            return {}
    return {}

def save_progress(done: dict):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(done, f)

# ── Main eval loop ────────────────────────────────────────────────────────────

def process(conv):
    cid           = conv["_id"]
    history       = conv["history"]
    message       = conv["message"]
    expected      = conv["cts_domain"]
    schema        = conv.get("schema", "?")
    answer_texts  = conv.get("answer_texts", [])

    orig_tok      = count_tokens(message) + sum(count_tokens(m["content"]) for m in history)
    orig_text     = " ".join(m["content"] for m in history)

    # ── Sliding window baseline ──────────────────────────────────────────
    sw_history    = sliding_window(history, SLIDING_K)
    sw_tok        = count_tokens(message) + sum(count_tokens(m["content"]) for m in sw_history)
    sw_rouge      = rouge_l(orig_text, " ".join(m["content"] for m in sw_history))
    sw_saved_pct  = round((1 - sw_tok / max(1, orig_tok)) * 100, 2)

    # ── CTS call ─────────────────────────────────────────────────────────
    cts, latency  = call_cts(history, message)

    if cts is None:
        return dict(
            id=cid, dataset=schema, expected_domain=expected,
            cts_domain="ERROR", cts_intent="ERROR", cts_state="ERROR",
            original_tokens=orig_tok, compressed_tokens=orig_tok,
            tokens_saved=0, reduction_pct=0.0,
            rouge_l=0.0, answer_retained="N/A",
            sw_tokens=sw_tok, sw_reduction_pct=sw_saved_pct, sw_rouge_l=sw_rouge,
            latency_ms=round(latency, 1),
            domain_correct=False, num_turns=len(history)//2+1, error=True,
        )

    comp_hist   = cts.get("compressedHistory", [])
    comp_text   = " ".join(str(m.get("content","")) for m in comp_hist)
    comp_tok    = max(1, sum(count_tokens(str(m.get("content",""))) for m in comp_hist))
    saved       = max(0, orig_tok - comp_tok)
    red_pct     = round(saved / orig_tok * 100, 2) if orig_tok > 0 else 0.0

    # ROUGE-L: how well does the compressed history preserve meaning?
    rl          = rouge_l(orig_text, comp_text)

    # Answer retention: for SQuAD/QA, did ground truth answers survive?
    if answer_texts:
        retained = all(answer_retained(a, comp_text) for a in answer_texts if a.strip())
        ans_flag = "YES" if retained else "NO"
    else:
        ans_flag = "N/A"

    cts_domain  = cts.get("domain", "")
    exp_check   = conv.get("domain", expected) if expected == "mixed" else expected
    correct     = cts_domain == exp_check

    return dict(
        id=cid, dataset=schema, expected_domain=exp_check,
        cts_domain=cts_domain, cts_intent=cts.get("intent",""),
        cts_state=cts.get("state",""),
        original_tokens=orig_tok, compressed_tokens=comp_tok,
        tokens_saved=saved, reduction_pct=red_pct,
        rouge_l=rl, answer_retained=ans_flag,
        sw_tokens=sw_tok, sw_reduction_pct=sw_saved_pct, sw_rouge_l=sw_rouge,
        latency_ms=round(latency, 1),
        domain_correct=correct, num_turns=len(history)//2+1, error=False,
    )

def run():
    random.seed(42)
    print("\n[CTS Comprehensive Eval]\n")

    all_convs = []
    for filename, cts_domain, schema, cap in DATASETS:
        print(f"\n[{cts_domain.upper()}] {filename}")
        convs = load_dataset(filename, schema, cts_domain, cap)
        for i, c in enumerate(convs):
            c["_id"] = f"{cts_domain}_{i}"
        all_convs.extend(convs)

    random.shuffle(all_convs)
    total     = len(all_convs)
    progress  = load_progress()
    results   = list(progress.values())
    remaining = [c for c in all_convs if c["_id"] not in progress]

    print(f"\n[eval] {total} total | {len(remaining)} remaining | {WORKERS} workers")
    print(f"[eval] ETA: ~{len(remaining) / max(1, WORKERS * 20):.1f} minutes\n")

    done_count = len(progress)
    start_time = time.time()

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(process, conv): conv for conv in remaining}
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            progress[row["id"]] = row
            done_count += 1

            if done_count % 50 == 0:
                save_progress(progress)

            elapsed = time.time() - start_time
            rate    = done_count / elapsed * 60 if elapsed > 0 else 0
            valid   = [r for r in results if not r["error"]]
            avg_red = sum(r["reduction_pct"] for r in valid) / max(1, len(valid))
            avg_rl  = sum(r["rouge_l"]        for r in valid) / max(1, len(valid))

            print(f"\r[{done_count:4d}/{total}] {done_count/total*100:5.1f}%  |  "
                  f"{rate:6.0f}/min  |  "
                  f"reduction: {avg_red:5.1f}%  ROUGE-L: {avg_rl:5.1f}%",
                  end="", flush=True)

    save_progress(progress)
    print("\n\n[eval] Done. Writing results...")
    write_csv(results)
    print_summary(results)

# ── Output ────────────────────────────────────────────────────────────────────

def write_csv(results: list):
    if not results: return
    RESULTS_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)
    print(f"[output] {RESULTS_CSV}")

def print_summary(results: list):
    valid = [r for r in results if not r["error"]]
    if not valid:
        print("[summary] No valid results."); return

    orig       = sum(r["original_tokens"]    for r in valid)
    comp       = sum(r["compressed_tokens"]  for r in valid)
    saved      = sum(r["tokens_saved"]        for r in valid)
    avg_red    = sum(r["reduction_pct"]       for r in valid) / len(valid)
    avg_rl     = sum(r["rouge_l"]             for r in valid) / len(valid)
    avg_lat    = sum(r["latency_ms"]          for r in valid) / len(valid)
    acc        = sum(1 for r in valid if r["domain_correct"]) / len(valid) * 100

    # Latency percentiles
    lats       = sorted(r["latency_ms"] for r in valid)
    p50        = lats[int(len(lats) * 0.50)]
    p95        = lats[int(len(lats) * 0.95)]
    p99        = lats[int(len(lats) * 0.99)]

    # Answer retention (only rows with YES/NO, not N/A)
    ans_rows   = [r for r in valid if r["answer_retained"] in ("YES", "NO")]
    ans_rate   = (sum(1 for r in ans_rows if r["answer_retained"] == "YES")
                  / max(1, len(ans_rows)) * 100)

    # Sliding window comparison
    avg_sw_red = sum(r["sw_reduction_pct"] for r in valid) / len(valid)
    avg_sw_rl  = sum(r["sw_rouge_l"]        for r in valid) / len(valid)

    print("\n" + "=" * 72)
    print("  CTS Comprehensive Benchmark Results")
    print("=" * 72)
    print(f"  Conversations        : {len(valid):>8,}")
    print(f"  Original tokens      : {orig:>8,}")
    print(f"  Compressed tokens    : {comp:>8,}")
    print(f"  Tokens saved         : {saved:>8,}")
    print()
    print("  -- COMPRESSION --")
    print(f"  Avg token reduction  : {avg_red:>7.1f}%")
    print(f"  ROUGE-L score        : {avg_rl:>7.1f}%   (industry standard compression quality)")
    print()
    print("  -- LATENCY --")
    print(f"  p50 latency          : {p50:>7.1f} ms")
    print(f"  p95 latency          : {p95:>7.1f} ms")
    print(f"  p99 latency          : {p99:>7.1f} ms")
    print(f"  avg latency          : {avg_lat:>7.1f} ms")
    print()
    print("  -- ANSWER RETENTION (SQuAD / Medical QA) --")
    if ans_rows:
        print(f"  Answer retained      : {ans_rate:>7.1f}%  ({len(ans_rows)} Q&A pairs tested)")
    else:
        print(f"  Answer retained      : N/A (no QA datasets found)")
    print()
    print("  -- CTS vs SLIDING WINDOW (last 5 turns) --")
    print(f"  {'Metric':30s}  {'CTS':>8s}  {'Sliding Win':>11s}")
    print(f"  {'Token reduction':30s}  {avg_red:>7.1f}%  {avg_sw_red:>10.1f}%")
    print(f"  {'ROUGE-L (meaning preserved)':30s}  {avg_rl:>7.1f}%  {avg_sw_rl:>10.1f}%")
    print()
    print("  -- DOMAIN ACCURACY --")
    print(f"  Overall accuracy     : {acc:>7.1f}%")
    print()
    print("  -- BY DOMAIN --")
    print(f"  {'Domain':18s}  {'Reduction':>9s}  {'ROUGE-L':>8s}  {'Acc':>6s}  {'N':>5s}")
    print("-" * 72)

    for d in sorted(set(r["expected_domain"] for r in valid)):
        rows  = [r for r in valid if r["expected_domain"] == d]
        d_red = sum(r["reduction_pct"] for r in rows) / len(rows)
        d_rl  = sum(r["rouge_l"]        for r in rows) / len(rows)
        d_acc = sum(1 for r in rows if r["domain_correct"]) / len(rows) * 100
        print(f"  {d:18s}  {d_red:>8.1f}%  {d_rl:>7.1f}%  {d_acc:>5.1f}%  {len(rows):>5d}")

    print()
    print("  -- COMPRESSION BY CONVERSATION LENGTH --")
    print(f"  {'Turns':>6s}  {'Avg Reduction':>14s}  {'ROUGE-L':>8s}  {'Count':>6s}")
    print("-" * 40)
    buckets = [(2, 3), (4, 6), (7, 10), (11, 999)]
    for lo, hi in buckets:
        rows  = [r for r in valid if lo <= r["num_turns"] <= hi]
        if not rows: continue
        b_red = sum(r["reduction_pct"] for r in rows) / len(rows)
        b_rl  = sum(r["rouge_l"]        for r in rows) / len(rows)
        label = f"{lo}-{hi}" if hi < 999 else f"{lo}+"
        print(f"  {label:>6s}  {b_red:>13.1f}%  {b_rl:>7.1f}%  {len(rows):>6d}")

    print()
    print("  -- COST SAVINGS PROJECTION --")
    print(f"  Based on {avg_red:.1f}% token reduction across {len(valid):,} conversations")
    print(f"  {'Model':15s}  {'$/1M tokens':>12s}  {'Saved/day (10k convs)':>22s}  {'Saved/month':>12s}")
    print("-" * 72)
    avg_orig_per_conv  = orig / len(valid)
    avg_comp_per_conv  = comp / len(valid)
    daily_convs        = 10_000
    for model, price in MODEL_PRICING.items():
        daily_orig  = avg_orig_per_conv  * daily_convs / 1_000_000 * price
        daily_comp  = avg_comp_per_conv  * daily_convs / 1_000_000 * price
        daily_saved = daily_orig - daily_comp
        monthly     = daily_saved * 30
        print(f"  {model:15s}  ${price:>11.2f}  ${daily_saved:>21.2f}  ${monthly:>11.2f}")

    print("=" * 72)
    errs = len(results) - len(valid)
    if errs:
        print(f"  [warn] {errs} errors/timeouts")
    print(f"  Full CSV -> {RESULTS_CSV}\n")

# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--reset" in sys.argv:
        if PROGRESS_FILE.exists():
            PROGRESS_FILE.unlink()
            print("[reset] Progress cleared.")
    run()
