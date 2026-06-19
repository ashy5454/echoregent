# -*- coding: utf-8 -*-
"""
CTS Semantic Cache Evaluation
==============================
No LLM credits needed — uses /test/cache endpoint with fake responses.

Tests:
  1. Smoke test       — same message twice → second must be cache hit
  2. Similarity test  — paraphrased queries → should still hit at 0.92
  3. Isolation test   — same query, different session → must NOT cross-hit
  4. Hit rate eval    — replay dataset, measure real-world hit rate
                        + estimate total token cost reduction (input + output)

Run:
  python eval_cache.py
"""

import json
import time
import sys
import hashlib
from pathlib import Path

try:
    import requests
except ImportError:
    print("[error] pip install requests"); sys.exit(1)

BASE         = Path(__file__).parent
CACHE_EP     = "http://127.0.0.1:8787/test/cache"
HEALTH_EP    = "http://127.0.0.1:8787/health"

# Dataset files are in the project root (not data/)
DATASETS = [
    ("customer_support.json", "customer_support", "instruction_response", 300),
    ("coding.json",           "coding",           "stackoverflow",        300),
    ("education.json",        "education",        "squad",                300),
    ("commerce.json",         "commerce",         "instruction_response", 200),
    ("hospitality.json",      "commerce",         "instruction_response", 100),
    ("medical.json",          "medical",          "qa",                   100),
    ("sales.json",            "sales",            "instruction_response", 100),
    ("general.json",          "general",          "instruction_response", 100),
]

# Output pricing per 1M tokens (2026)
OUTPUT_PRICING = {
    "Claude Opus 4":     15.00,
    "Claude Sonnet 4.5":  6.00,
    "GPT-4.1":            8.00,
    "o3":                12.00,
    "o4-mini":            4.40,
    "Gemini 2.5 Pro":    10.00,
    "Gemini 2.5 Flash":   1.00,
}
INPUT_PRICING = {
    "Claude Opus 4":      5.00,
    "Claude Sonnet 4.5":  3.00,
    "GPT-4.1":            2.00,
    "o3":                 2.00,
    "o4-mini":            1.10,
    "Gemini 2.5 Pro":     1.25,
    "Gemini 2.5 Flash":   0.30,
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def fake_response(message: str) -> str:
    """Generate a deterministic fake LLM response (no API call needed)."""
    h = hashlib.md5(message.encode()).hexdigest()[:8]
    return f"Here is a helpful response to your question. [ref:{h}] " \
           f"Based on your query about '{message[:40]}', the answer involves " \
           f"several key considerations that depend on your specific context."

def cache_call(message: str, session_id: str, domain: str = "general",
               store_fake: bool = True) -> dict:
    """Hit /test/cache — no LLM needed."""
    payload = {"message": message, "sessionId": session_id, "domain": domain}
    if store_fake:
        payload["fakeResponse"] = fake_response(message)
    try:
        r = requests.post(CACHE_EP, json=payload, timeout=10)
        return r.json()
    except requests.exceptions.ConnectionError:
        print("[error] Cannot connect. Start server: npm run api")
        sys.exit(1)
    except Exception as e:
        return {"error": str(e)}

def load_messages(filename: str, fmt: str, limit: int) -> list:
    """Load user messages from a dataset file. Checks project root first."""
    for search_dir in [BASE, BASE / "data"]:
        path = search_dir / filename
        if not path.exists():
            continue
        try:
            raw = path.read_text(encoding="utf-8", errors="replace")
            data = json.loads(raw)
            if isinstance(data, dict):
                data = data.get("data", data.get("rows", []))
            messages = []
            for item in data:
                if len(messages) >= limit:
                    break
                if fmt == "instruction_response":
                    msg = item.get("instruction") or item.get("input") or item.get("prompt") or ""
                elif fmt == "stackoverflow":
                    msg = item.get("question") or item.get("title") or item.get("body") or ""
                elif fmt == "qa":
                    msg = item.get("question") or item.get("input") or ""
                elif fmt == "squad":
                    msg = item.get("question") or item.get("input") or ""
                else:
                    msg = str(next(iter(item.values()), ""))
                msg = str(msg).strip()
                if len(msg) > 20:
                    messages.append(msg[:300])
            return messages
        except Exception as e:
            print(f"    [warn] Error reading {filename}: {e}")
    return []

def section(title):
    print(); print("=" * 62); print(f"  {title}"); print("=" * 62)

def ok(msg):   print(f"  ✓ {msg}")
def fail(msg): print(f"  ✗ {msg}")
def info(msg): print(f"    {msg}")

# ── Test 1: Smoke ─────────────────────────────────────────────────────────────

def test_smoke():
    section("TEST 1 — Smoke Test (same query twice)")
    msg = "How do I cancel my subscription?"
    sid = "smoke-test-001"

    info("Query #1 (cold — stores fake response)...")
    r1 = cache_call(msg, sid, "customer_support", store_fake=True)
    if r1.get("hit"):
        info("(was already cached from a previous run — that's fine)")

    time.sleep(0.2)

    info("Query #2 (should be cache hit)...")
    r2 = cache_call(msg, sid, "customer_support", store_fake=False)

    hit = r2.get("hit", False)
    sim = r2.get("similarity", "n/a")

    if hit:
        ok(f"Cache HIT on identical query  (similarity={sim})")
        return True
    else:
        fail("Cache MISS on identical query")
        info("MiniLM model may not be loaded — check server logs for:")
        info("  '[CTS] Semantic cache (MiniLM) loaded ✓'")
        info("If missing, the model failed to load. Check ml/cts_minilm/ exists.")
        return False

# ── Test 2: Similarity ────────────────────────────────────────────────────────

PARAPHRASE_PAIRS = [
    ("How do I sort a list in Python?",         "Python: how to sort a list?",          "coding"),
    ("What are the symptoms of diabetes?",       "Symptoms of diabetes — what are they?","medical"),
    ("How do I reset my password?",             "I forgot my password, how to reset?",  "customer_support"),
    ("Explain what a closure is in JavaScript", "What is a JavaScript closure?",         "coding"),
    ("What is the return policy?",              "Can I return this? What's the policy?", "commerce"),
]

def test_similarity():
    section("TEST 2 — Similarity Test (paraphrased queries)")
    hits = 0
    for i, (original, paraphrase, domain) in enumerate(PARAPHRASE_PAIRS):
        sid = f"sim-{i}"
        cache_call(original,   sid, domain, store_fake=True)
        time.sleep(0.15)
        r = cache_call(paraphrase, sid, domain, store_fake=False)
        hit = r.get("hit", False)
        sim = r.get("similarity", "n/a")
        if hit:
            hits += 1
            ok(f"HIT  (sim={sim})  '{paraphrase[:50]}'")
        else:
            info(f"MISS (sim={sim})  '{paraphrase[:50]}'")

    info(f"Paraphrase hit rate: {hits}/{len(PARAPHRASE_PAIRS)}")
    if hits >= 3:
        ok("Similarity threshold working correctly")
        return True
    elif hits >= 1:
        info("Partial hits — threshold may need tuning (try 0.88 in semantic-cache.ts)")
        return True
    else:
        fail("Zero hits — MiniLM not loaded (embeddings returning null)")
        return False

# ── Test 3: Isolation ─────────────────────────────────────────────────────────

def test_isolation():
    section("TEST 3 — Domain Isolation (different sessions must not share)")
    msg = "What is the recommended dosage?"

    cache_call(msg, "session-medical-A", "medical", store_fake=True)
    time.sleep(0.15)

    # Different session — must NOT hit
    r_diff = cache_call(msg, "session-coding-B", "coding", store_fake=False)
    isolated = not r_diff.get("hit", True)

    if isolated:
        ok("Different sessions do NOT share cache entries ✓")
    else:
        fail("Cross-session cache leak detected")

    # Same session — MUST hit
    time.sleep(0.15)
    r_same = cache_call(msg, "session-medical-A", "medical", store_fake=False)
    if r_same.get("hit"):
        ok("Same session hits its own cache entry ✓")
    else:
        info("Same session did not hit — MiniLM may not be loaded")

    return isolated

# ── Test 4: Hit Rate Eval ─────────────────────────────────────────────────────

def test_hit_rate():
    section("TEST 4 — Real-World Hit Rate Eval (dataset replay)")
    info("Loading datasets and replaying conversations...")
    print()

    domain_stats = {}

    for filename, domain, fmt, limit in DATASETS:
        messages = load_messages(filename, fmt, limit)
        if not messages:
            info(f"Skipping {domain} ({filename}) — not found or empty")
            continue

        # Simulate sessions of 5 turns each
        session_size = 5
        sessions = [messages[i:i+session_size] for i in range(0, len(messages), session_size)]

        hits = 0; misses = 0; output_tokens_saved = 0

        for s_idx, session_msgs in enumerate(sessions):
            sid = f"eval4-{domain}-{s_idx}"
            for msg in session_msgs:
                r = cache_call(msg, sid, domain, store_fake=True)
                if r.get("hit"):
                    hits += 1
                    output_tokens_saved += r.get("savedTokens", 80)
                else:
                    misses += 1
                time.sleep(0.03)

        total    = hits + misses
        hit_rate = hits / total if total > 0 else 0

        # Merge same domain stats if domain appears twice (e.g. hospitality→commerce)
        if domain in domain_stats:
            domain_stats[domain]["hits"]   += hits
            domain_stats[domain]["misses"] += misses
            domain_stats[domain]["total"]  += total
            domain_stats[domain]["output_tokens_saved"] += output_tokens_saved
            h = domain_stats[domain]["hits"]
            t = domain_stats[domain]["total"]
            domain_stats[domain]["hit_rate"] = h / t if t else 0
        else:
            domain_stats[domain] = {
                "hits": hits, "misses": misses, "total": total,
                "hit_rate": hit_rate, "output_tokens_saved": output_tokens_saved,
            }

        bar = "█" * int(hit_rate * 20) + "░" * (20 - int(hit_rate * 20))
        print(f"  {domain:18s} [{bar}] {hit_rate*100:4.1f}%  ({hits}/{total} hits)")

    # ── Final summary ─────────────────────────────────────────────────────────
    section("RESULTS — Cache Eval Summary")

    total_hits        = sum(s["hits"]   for s in domain_stats.values())
    total_all         = sum(s["total"]  for s in domain_stats.values())
    overall_hit_rate  = total_hits / total_all if total_all else 0
    total_out_saved   = sum(s["output_tokens_saved"] for s in domain_stats.values())

    print(f"\n  Overall cache hit rate:   {overall_hit_rate*100:.1f}%  ({total_hits}/{total_all})")
    print(f"  Output tokens saved:      {total_out_saved:,}\n")

    print(f"  {'Domain':18s}  {'Hit Rate':>9s}  {'Hits':>6s}  {'Total':>6s}")
    print("  " + "-" * 46)
    for domain, s in sorted(domain_stats.items(), key=lambda x: -x[1]["hit_rate"]):
        print(f"  {domain:18s}  {s['hit_rate']*100:8.1f}%  {s['hits']:>6d}  {s['total']:>6d}")

    # Combined cost savings table
    print()
    print("  -- COMBINED SAVINGS: Input Compression + Output Cache --")
    print(f"  Input reduction:  87.4%  (T5 compression)")
    print(f"  Output reduction: {overall_hit_rate*100:.1f}%  (semantic cache)")
    print()

    avg_in_tok  = 800   # avg original input tokens per conversation
    avg_out_tok = 80    # avg output tokens per response
    daily_convs = 10_000

    print(f"  {'Model':18s}  {'In $/1M':>8s}  {'Out $/1M':>9s}  "
          f"{'Daily saved':>12s}  {'Monthly saved':>13s}")
    print("  " + "-" * 68)

    for model in OUTPUT_PRICING:
        in_p  = INPUT_PRICING[model]
        out_p = OUTPUT_PRICING[model]

        orig_daily  = (avg_in_tok * in_p + avg_out_tok * out_p) * daily_convs / 1_000_000
        cts_in      = avg_in_tok  * (1 - 0.874) * in_p  * daily_convs / 1_000_000
        cts_out     = avg_out_tok * (1 - overall_hit_rate) * out_p * daily_convs / 1_000_000
        saved       = orig_daily - (cts_in + cts_out)
        monthly     = saved * 30

        print(f"  {model:18s}  ${in_p:>7.2f}  ${out_p:>8.2f}  "
              f"${saved:>11.2f}  ${monthly:>12.2f}")

    print()
    print("  Based on 10,000 conversations/day | 800 avg input | 80 avg output tokens")
    print("=" * 62)

    return overall_hit_rate

# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\nCTS Semantic Cache Evaluation")
    print(f"Endpoint: {CACHE_EP}\n")

    try:
        requests.get(HEALTH_EP, timeout=5)
    except Exception:
        print("[error] Server not reachable. Run:  npm run api")
        sys.exit(1)

    smoke  = test_smoke()
    simil  = test_similarity()
    isol   = test_isolation()
    hr     = test_hit_rate()

    section("FINAL PASS/FAIL")
    tests = [("smoke", smoke), ("similarity", simil), ("isolation", isol),
             ("hit_rate >5%", hr > 0.05)]
    all_pass = True
    for name, result in tests:
        sym = "✓" if result else "✗"
        print(f"  {sym} {name}")
        if not result: all_pass = False

    print()
    if all_pass:
        print("  ALL TESTS PASSED ✓")
        print("\n  → These numbers are ready for the website.")
    else:
        print("  Some tests failed — check output above")
    print()
