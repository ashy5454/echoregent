# -*- coding: utf-8 -*-
"""
CTS MultiWOZ Evaluation Script
Samples 1000 conversations evenly across all domains, pipes through
/demo/compress, measures token reduction and domain classification accuracy.
"""

import json
import csv
import time
import random
import sys
from collections import defaultdict
from pathlib import Path

# ── Config ────────────────────────────────────────────────────────────────────

CTS_ENDPOINT   = "http://127.0.0.1:8787/demo/compress"
DATASET_PATH   = Path(__file__).parent / "multiwoz.json"
RESULTS_CSV    = Path(__file__).parent / "data" / "multiwoz_results.csv"
SAMPLE_SIZE    = 1000
PER_DOMAIN     = 9999                      # take all available per domain
RATE_LIMIT     = 600                       # local server, no rate limit
SLEEP_BETWEEN  = 0.05                     # 50ms between requests
SAVE_PROGRESS  = Path(__file__).parent / "data" / "multiwoz_progress.json"

# MultiWOZ domain -> CTS expected domain mapping
DOMAIN_MAP = {
    "restaurant": "commerce",
    "hotel":      "commerce",
    "taxi":       "commerce",
    "train":      "commerce",
    "bus":        "commerce",
    "attraction": "general",
    "hospital":   "medical",
    "police":     "legal",
}

MULTIWOZ_DOMAINS = list(DOMAIN_MAP.keys())

# ── Try to import dependencies ────────────────────────────────────────────────

try:
    import requests
except ImportError:
    print("[error] Missing 'requests'. Run: pip install requests")
    sys.exit(1)

try:
    import tiktoken
    enc = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text: str) -> int:
        return len(enc.encode(text))
except ImportError:
    print("[warn] tiktoken not found — using word-count approximation")
    print("       Install with: pip install tiktoken")
    def count_tokens(text: str) -> int:
        return max(1, len(text.split()) * 4 // 3)

# ── Load and sample dataset ───────────────────────────────────────────────────

def get_primary_domain(services: list) -> str:
    """Return the first recognised MultiWOZ domain in the services list."""
    for svc in services:
        if svc in MULTIWOZ_DOMAINS:
            return svc
    return None

def load_and_sample(path: Path, per_domain: int) -> list:
    print(f"[load] Reading {path} ...")
    with open(path, "r", encoding="utf-8") as f:
        data = json.load(f)
    print(f"[load] {len(data)} conversations loaded")

    # Group by primary domain
    by_domain = defaultdict(list)
    for conv in data:
        domain = get_primary_domain(conv.get("services", []))
        if domain:
            by_domain[domain].append(conv)

    print("[load] Domain distribution in full dataset:")
    for d in MULTIWOZ_DOMAINS:
        print(f"       {d:12s}: {len(by_domain[d]):5d}")

    # Sample evenly
    sampled = []
    for domain in MULTIWOZ_DOMAINS:
        pool   = by_domain[domain]
        n      = min(per_domain, len(pool))
        chosen = random.sample(pool, n)
        for conv in chosen:
            conv["_primary_domain"] = domain
        sampled.extend(chosen)
        print(f"[sample] {domain:12s}: {n} sampled")

    random.shuffle(sampled)
    print(f"[sample] Total sample: {len(sampled)} conversations")
    return sampled

# ── Format turns for CTS ──────────────────────────────────────────────────────

def build_history_and_message(turns: list) -> tuple:
    """Convert MultiWOZ turns into CTS history + final message."""
    messages = []
    for turn in turns:
        speaker   = turn.get("speaker", "").upper()
        utterance = turn.get("utterance", "").strip()
        if not utterance:
            continue
        role = "user" if speaker == "USER" else "assistant"
        messages.append({"role": role, "content": utterance})

    if not messages:
        return [], ""

    # Last message is the current user turn, rest is history
    # Find last user message as the "current" message
    last_user_idx = None
    for i in range(len(messages) - 1, -1, -1):
        if messages[i]["role"] == "user":
            last_user_idx = i
            break

    if last_user_idx is None:
        return messages[:-1], messages[-1]["content"]

    history = messages[:last_user_idx]
    message = messages[last_user_idx]["content"]
    return history, message

def raw_token_count(history: list, message: str) -> int:
    total = count_tokens(message)
    for msg in history:
        total += count_tokens(msg["content"])
    return total

# ── Call CTS ──────────────────────────────────────────────────────────────────

def call_cts(history: list, message: str, retries: int = 3) -> dict | None:
    payload = {"history": history, "message": message}
    for attempt in range(retries):
        try:
            resp = requests.post(
                CTS_ENDPOINT,
                json=payload,
                timeout=15,
                headers={"Content-Type": "application/json"},
            )
            if resp.status_code == 429:
                wait = 65
                print(f"\n[rate-limit] 429 received, sleeping {wait}s ...")
                time.sleep(wait)
                continue
            if resp.status_code != 200:
                print(f"\n[error] HTTP {resp.status_code}: {resp.text[:120]}")
                return None
            return resp.json()
        except requests.exceptions.Timeout:
            print(f"\n[timeout] attempt {attempt+1}/{retries}")
            time.sleep(5)
        except Exception as e:
            print(f"\n[error] {e}")
            return None
    return None

# ── Load progress ─────────────────────────────────────────────────────────────

def load_progress() -> dict:
    if SAVE_PROGRESS.exists():
        with open(SAVE_PROGRESS) as f:
            return json.load(f)
    return {}

def save_progress(done: dict):
    SAVE_PROGRESS.parent.mkdir(parents=True, exist_ok=True)
    with open(SAVE_PROGRESS, "w") as f:
        json.dump(done, f)

# ── Main evaluation loop ──────────────────────────────────────────────────────

def run_evaluation():
    random.seed(42)
    sample     = load_and_sample(DATASET_PATH, PER_DOMAIN)
    progress   = load_progress()
    total      = len(sample)
    results    = []

    print(f"\n[eval] Starting evaluation — {total} conversations")
    print(f"[eval] Rate: {RATE_LIMIT}/min -> ~{SLEEP_BETWEEN:.1f}s between requests")
    eta_mins   = (total - len(progress)) * SLEEP_BETWEEN / 60
    print(f"[eval] ETA: ~{eta_mins:.0f} minutes ({(total-len(progress))} remaining)\n")

    for idx, conv in enumerate(sample):
        dial_id = conv.get("dialogue_id", f"conv_{idx}")

        # Resume from checkpoint
        if dial_id in progress:
            results.append(progress[dial_id])
            continue

        history, message = build_history_and_message(conv.get("turns", []))
        if not message:
            continue

        original_tokens  = raw_token_count(history, message)
        multiwoz_domain  = conv["_primary_domain"]
        expected_cts     = DOMAIN_MAP[multiwoz_domain]

        # Call CTS
        cts_resp = call_cts(history, message)

        if cts_resp is None:
            row = {
                "dialogue_id":       dial_id,
                "multiwoz_domain":   multiwoz_domain,
                "expected_cts":      expected_cts,
                "cts_domain":        "ERROR",
                "cts_intent":        "ERROR",
                "cts_state":         "ERROR",
                "original_tokens":   original_tokens,
                "compressed_tokens": original_tokens,
                "tokens_saved":      0,
                "reduction_pct":     0.0,
                "domain_correct":    False,
                "num_turns":         len(conv.get("turns", [])),
                "services":          "|".join(conv.get("services", [])),
                "error":             True,
            }
        else:
            # Count compressed tokens
            compressed_history = cts_resp.get("compressedHistory", [])
            compressed_tokens  = count_tokens(cts_resp.get("intent", ""))  # base
            for msg in compressed_history:
                compressed_tokens += count_tokens(str(msg.get("content", "")))
            compressed_tokens = max(1, compressed_tokens)

            tokens_saved    = max(0, original_tokens - compressed_tokens)
            reduction_pct   = round(tokens_saved / original_tokens * 100, 2) if original_tokens > 0 else 0.0
            cts_domain      = cts_resp.get("domain", "")
            domain_correct  = (cts_domain == expected_cts)

            row = {
                "dialogue_id":       dial_id,
                "multiwoz_domain":   multiwoz_domain,
                "expected_cts":      expected_cts,
                "cts_domain":        cts_domain,
                "cts_intent":        cts_resp.get("intent", ""),
                "cts_state":         cts_resp.get("state", ""),
                "original_tokens":   original_tokens,
                "compressed_tokens": compressed_tokens,
                "tokens_saved":      tokens_saved,
                "reduction_pct":     reduction_pct,
                "domain_correct":    domain_correct,
                "num_turns":         len(conv.get("turns", [])),
                "services":          "|".join(conv.get("services", [])),
                "error":             False,
            }

        results.append(row)
        progress[dial_id] = row
        save_progress(progress)

        done    = idx + 1
        pct     = done / total * 100
        avg_red = (sum(r["reduction_pct"] for r in results if not r["error"]) /
                   max(1, sum(1 for r in results if not r["error"])))
        print(f"\r[{done:4d}/{total}] {pct:5.1f}%  |  "
              f"avg reduction: {avg_red:5.1f}%  |  "
              f"{row['multiwoz_domain']:12s} -> {row['cts_domain']:15s} "
              f"({'OK' if row['domain_correct'] else 'X '})  "
              f"{row['reduction_pct']:5.1f}% saved", end="", flush=True)

        time.sleep(SLEEP_BETWEEN)

    print("\n\n[eval] Done. Writing results...")
    write_csv(results)
    print_summary(results)

# ── Output ────────────────────────────────────────────────────────────────────

def write_csv(results: list):
    RESULTS_CSV.parent.mkdir(parents=True, exist_ok=True)
    if not results:
        return
    with open(RESULTS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)
    print(f"[output] CSV saved -> {RESULTS_CSV}")

def print_summary(results: list):
    valid = [r for r in results if not r["error"]]
    if not valid:
        print("[summary] No valid results.")
        return

    total_orig  = sum(r["original_tokens"]   for r in valid)
    total_comp  = sum(r["compressed_tokens"] for r in valid)
    total_saved = sum(r["tokens_saved"]      for r in valid)
    avg_red     = sum(r["reduction_pct"]     for r in valid) / len(valid)
    domain_acc  = sum(1 for r in valid if r["domain_correct"]) / len(valid) * 100

    print("\n" + "=" * 62)
    print("  CTS x MultiWOZ Evaluation Summary")
    print("=" * 62)
    print(f"  Conversations evaluated : {len(valid):>6,}")
    print(f"  Total original tokens   : {total_orig:>6,}")
    print(f"  Total compressed tokens : {total_comp:>6,}")
    print(f"  Total tokens saved      : {total_saved:>6,}")
    print(f"  Average token reduction : {avg_red:>6.1f}%")
    print(f"  Domain accuracy (overall): {domain_acc:>5.1f}%")
    print("-" * 62)
    print(f"  {'MultiWOZ':12s}  {'Expected CTS':15s}  {'Reduction':>9s}  {'Acc':>6s}  {'N':>4s}")
    print("-" * 62)

    for mwoz_domain in MULTIWOZ_DOMAINS:
        rows = [r for r in valid if r["multiwoz_domain"] == mwoz_domain]
        if not rows:
            continue
        avg   = sum(r["reduction_pct"] for r in rows) / len(rows)
        acc   = sum(1 for r in rows if r["domain_correct"]) / len(rows) * 100
        exp   = DOMAIN_MAP[mwoz_domain]
        print(f"  {mwoz_domain:12s}  {exp:15s}  {avg:>8.1f}%  {acc:>5.1f}%  {len(rows):>4d}")

    print("-" * 62)
    # Most common CTS domains returned per MultiWOZ domain
    print("\n  CTS domain distribution per MultiWOZ domain:")
    for mwoz_domain in MULTIWOZ_DOMAINS:
        rows = [r for r in valid if r["multiwoz_domain"] == mwoz_domain]
        if not rows:
            continue
        freq = defaultdict(int)
        for r in rows:
            freq[r["cts_domain"]] += 1
        top = sorted(freq.items(), key=lambda x: -x[1])[:3]
        top_str = ", ".join(f"{d}({n})" for d, n in top)
        print(f"  {mwoz_domain:12s} -> {top_str}")

    print("\n" + "=" * 62)
    errors = len(results) - len(valid)
    if errors:
        print(f"  [warn] {errors} conversations failed (API errors/timeouts)")
    print(f"  Results CSV -> {RESULTS_CSV}")
    print("=" * 62 + "\n")

# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--reset" in sys.argv:
        if SAVE_PROGRESS.exists():
            SAVE_PROGRESS.unlink()
            print("[reset] Progress cleared.")

    if not DATASET_PATH.exists():
        print(f"[error] Dataset not found: {DATASET_PATH}")
        sys.exit(1)

    run_evaluation()
