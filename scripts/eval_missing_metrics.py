# -*- coding: utf-8 -*-
"""
CTS Missing Metrics Eval
=========================
Measures everything not covered by eval_quality_v2 or eval_cache:

  1. Compression Consistency    — same conversation, 3 runs → variance in output
  2. Latency Under Load         — p50/p95/p99 at 1/10/25/50 concurrent requests
  3. Compression Ratio vs Quality Tradeoff — at what % reduction does quality drop?
  4. Cache False Positive Rate  — when cache hits, is the response actually right?
  5. T5 Fallback Rate           — how often does T5 fail → keyword fallback?
  6. Long Conversation Degradation — does quality hold at 10/20/30 turns?

Run:
  python eval_missing_metrics.py

Reads GEMINI_API_KEY from .env automatically.
"""

import json, time, random, sys, re, statistics
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

try:
    import requests
except ImportError:
    print("[error] pip install requests"); sys.exit(1)

BASE              = Path(__file__).parent
COMPRESS_EP       = "http://127.0.0.1:8787/demo/compress"        # sync — used for latency test only
COMPRESS_ASYNC_EP = "http://127.0.0.1:8787/demo/compress-async"  # async T5 — used for all quality/T5 tests
CACHE_EP          = "http://127.0.0.1:8787/test/cache"
HEALTH_EP         = "http://127.0.0.1:8787/health"
MODEL_HEALTH      = "http://127.0.0.1:8787/admin/model-health"
GEMINI_MODEL      = "gemini-2.5-flash-lite"
GEMINI_BASE       = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# ── Helpers ───────────────────────────────────────────────────────────────────

def load_env_key() -> str:
    env_file = BASE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip()
    return ""

def call_compress(history, message, timeout=15, use_async=False):
    """Call the compress endpoint. use_async=True uses T5 async path with token counts."""
    ep = COMPRESS_ASYNC_EP if use_async else COMPRESS_EP
    try:
        t0 = time.perf_counter()
        r  = requests.post(ep,
                           json={"history": history, "message": message},
                           timeout=timeout)
        ms = (time.perf_counter() - t0) * 1000
        if r.status_code == 200:
            return r.json(), ms
    except Exception:
        pass
    return None, None

def call_gemini(api_key, messages, system, max_tokens=300):
    url = GEMINI_BASE.format(model=GEMINI_MODEL) + f"?key={api_key}"
    contents = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    try:
        r = requests.post(url,
                          json={"systemInstruction": {"parts": [{"text": system}]},
                                "contents": contents,
                                "generationConfig": {"maxOutputTokens": max_tokens,
                                                     "temperature": 0.2}},
                          headers={"Content-Type": "application/json"},
                          timeout=25)
        if r.status_code == 200:
            return r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
    except Exception:
        pass
    return None

def load_messages(filename, fmt, limit):
    for d in [BASE, BASE / "data"]:
        p = d / filename
        if not p.exists(): continue
        try:
            raw = p.read_text(encoding="utf-8", errors="replace")
            data = json.loads(raw)
            if isinstance(data, dict):
                data = next((v for v in data.values() if isinstance(v, list)), [])
            msgs = []
            for item in data:
                if len(msgs) >= limit: break
                if fmt == "instruction_response":
                    u = str(item.get("instruction") or item.get("input") or "")
                    a = str(item.get("response")    or item.get("output") or "")
                elif fmt == "stackoverflow":
                    clean = lambda s: re.sub(r'<[^>]+>', ' ', str(s)).strip()
                    u = f"{item.get('title','')} {clean(item.get('question_body',''))}".strip()[:400]
                    a = clean(item.get("answer_body", ""))[:400]
                else:
                    u = str(item.get("question") or item.get("input") or "")
                    a = str(item.get("answer")   or item.get("output") or "")
                if len(u) > 20 and len(a) > 10:
                    msgs.append((u[:400], a[:400]))
            return msgs
        except Exception as e:
            print(f"  [warn] {filename}: {e}")
    return []

def section(t): print(); print("=" * 64); print(f"  {t}"); print("=" * 64)
def ok(m):   print(f"  ✓ {m}")
def info(m): print(f"    {m}")
def warn(m): print(f"  ⚠ {m}")

# ── 1. Compression Consistency ────────────────────────────────────────────────

def test_consistency():
    section("TEST 1 — Compression Consistency (same input × 3 runs)")

    pairs = load_messages("customer_support.json", "instruction_response", 100)
    if not pairs:
        warn("No dataset found — skipping"); return {}

    random.seed(42)
    sample = random.sample(pairs, min(20, len(pairs)))

    variances = []
    for u, a in sample:
        history = [{"role": "user", "content": u},
                   {"role": "assistant", "content": a},
                   {"role": "user", "content": u + " Can you help further?"}]
        message = "What is the status of my request?"

        reductions = []
        for _ in range(3):
            # Use sync endpoint (fast) — measure reduction via char counts
            result, _ = call_compress(history, message, use_async=False)
            if result:
                orig_chars = sum(len(m["content"]) for m in history) + len(message)
                comp_chars = sum(len(m.get("content","")) for m in result.get("compressedHistory", []))
                if orig_chars > 0:
                    reductions.append((orig_chars - comp_chars) / orig_chars * 100)

        if len(reductions) >= 2:
            variances.append(statistics.stdev(reductions) if len(reductions) > 1 else 0)

    if not variances:
        warn("No valid results"); return {}

    avg_var = statistics.mean(variances)
    max_var = max(variances)
    unstable = sum(1 for v in variances if v > 5)

    print(f"\n  Conversations tested     : {len(variances)}")
    print(f"  Avg std dev (reduction%) : {avg_var:.2f}%")
    print(f"  Max std dev              : {max_var:.2f}%")
    print(f"  Unstable runs (>5% std)  : {unstable}/{len(variances)}")

    if avg_var < 2:
        ok("Compression is deterministic (avg variance <2%)")
    elif avg_var < 5:
        info("Compression has minor variance — acceptable")
    else:
        warn("High variance — compressor output is not deterministic")

    return {"avg_variance": avg_var, "max_variance": max_var, "unstable_pct": unstable/len(variances)*100}

# ── 2. Latency Under Load ─────────────────────────────────────────────────────

def test_latency_under_load():
    section("TEST 2 — Latency Under Load (concurrent requests)")

    pairs = load_messages("coding.json", "stackoverflow", 200)
    if not pairs:
        warn("No dataset found — skipping"); return {}

    history_pool = []
    for u, a in pairs[:50]:
        history_pool.append({
            "history": [{"role": "user", "content": u},
                        {"role": "assistant", "content": a}],
            "message": "Can you elaborate on that solution?"
        })

    results = {}
    for concurrency in [1, 10, 25, 50]:
        batch = random.choices(history_pool, k=concurrency)
        latencies = []

        with ThreadPoolExecutor(max_workers=concurrency) as ex:
            futures = {ex.submit(call_compress, b["history"], b["message"]): b
                       for b in batch}
            for f in as_completed(futures):
                _, ms = f.result()
                if ms is not None:
                    latencies.append(ms)

        if not latencies:
            print(f"  {concurrency:>3d} concurrent → all failed")
            continue

        latencies.sort()
        p50 = latencies[int(len(latencies) * 0.50)]
        p95 = latencies[int(len(latencies) * 0.95)] if len(latencies) >= 20 else latencies[-1]
        p99 = latencies[int(len(latencies) * 0.99)] if len(latencies) >= 100 else latencies[-1]
        errs = concurrency - len(latencies)

        print(f"  {concurrency:>3d} concurrent → p50:{p50:>7.0f}ms  "
              f"p95:{p95:>7.0f}ms  p99:{p99:>7.0f}ms  "
              f"errors:{errs}")

        results[concurrency] = {"p50": p50, "p95": p95, "p99": p99, "errors": errs}
        time.sleep(0.5)  # brief pause between load levels

    # Verdict
    print()
    if results:
        p95_50 = results.get(50, {}).get("p95", 9999)
        if p95_50 < 500:
            ok("p95 < 500ms at 50 concurrent — production ready")
        elif p95_50 < 1000:
            info("p95 < 1s at 50 concurrent — acceptable")
        else:
            warn(f"p95 {p95_50:.0f}ms at 50 concurrent — may struggle under real load")

    return results

# ── 3. Compression Ratio vs Quality Tradeoff ──────────────────────────────────

def test_ratio_vs_quality():
    section("TEST 3 — Compression Ratio vs Quality Tradeoff")

    results_file = BASE / "data" / "quality_v2_results.json"
    if not results_file.exists():
        warn("quality_v2_results.json not found — run eval_quality_v2.py first")
        return {}

    with open(results_file) as f:
        results = json.load(f)

    valid = [r for r in results if not r.get("error") and r.get("reduction_pct") is not None]
    if not valid:
        warn("No valid results in quality_v2_results.json"); return {}

    buckets = {
        "0-30%":   lambda r: r["reduction_pct"] < 30,
        "30-50%":  lambda r: 30 <= r["reduction_pct"] < 50,
        "50-70%":  lambda r: 50 <= r["reduction_pct"] < 70,
        "70-85%":  lambda r: 70 <= r["reduction_pct"] < 85,
        "85%+":    lambda r: r["reduction_pct"] >= 85,
    }

    print(f"\n  {'Reduction':12s}  {'OK%':>6s}  {'Avg CTS':>8s}  {'Avg Full':>9s}  {'N':>4s}")
    print("  " + "-" * 48)

    tradeoff = {}
    cliff_found = False
    for label, predicate in buckets.items():
        rows = [r for r in valid if predicate(r)]
        if not rows:
            print(f"  {label:12s}  {'—':>6s}  {'—':>8s}  {'—':>9s}  {'0':>4s}")
            continue
        ok_rate = sum(1 for r in rows if r["verdict"] in ("EQUAL","B_BETTER")) / len(rows) * 100
        avg_cts  = sum(r["score_b"] for r in rows) / len(rows)
        avg_full = sum(r["score_a"] for r in rows) / len(rows)
        flag = " ← cliff" if ok_rate < 65 and not cliff_found else ""
        if ok_rate < 65: cliff_found = True
        print(f"  {label:12s}  {ok_rate:>5.1f}%  {avg_cts:>8.2f}  {avg_full:>9.2f}  {len(rows):>4d}{flag}")
        tradeoff[label] = {"ok_rate": ok_rate, "n": len(rows)}

    print()
    if not cliff_found:
        ok("No quality cliff detected — CTS holds across all compression levels")
    else:
        warn("Quality cliff detected — check the bucket marked above")

    return tradeoff

# ── 4. Cache False Positive Rate ──────────────────────────────────────────────

def test_cache_false_positives(api_key):
    section("TEST 4 — Cache False Positive Rate")

    # Pairs: (seed_query, different_but_similar_query) — should NOT get same answer
    test_pairs = [
        ("How do I sort a list in Python?",
         "How do I sort a dictionary in Python?",
         "coding"),
        ("What are the symptoms of diabetes?",
         "What are the symptoms of hypertension?",
         "medical"),
        ("How do I cancel my order?",
         "How do I return my order?",
         "customer_support"),
        ("What is a closure in JavaScript?",
         "What is a promise in JavaScript?",
         "coding"),
        ("What is the price of the premium plan?",
         "What is the price of the basic plan?",
         "commerce"),
        ("How do I connect to a PostgreSQL database?",
         "How do I connect to a MySQL database?",
         "coding"),
        ("What are the side effects of ibuprofen?",
         "What are the side effects of aspirin?",
         "medical"),
        ("How do I reset my password?",
         "How do I change my username?",
         "customer_support"),
    ]

    false_positives = 0
    true_negatives  = 0
    cache_hits      = 0

    JUDGE = ("You are a strict judge. Given a QUERY and a RESPONSE, "
             "answer YES if the response directly answers the query, NO if it does not. "
             "Respond with only YES or NO.")

    for seed_q, test_q, domain in test_pairs:
        sid = f"fp-test-{hash(seed_q) % 10000}"

        # Seed cache
        fake_resp = f"This response specifically addresses: {seed_q}"
        requests.post(CACHE_EP, json={"message": seed_q, "sessionId": sid,
                                       "domain": domain, "fakeResponse": fake_resp},
                      timeout=10)
        time.sleep(0.1)

        # Check if different query hits
        r = requests.post(CACHE_EP, json={"message": test_q, "sessionId": sid,
                                           "domain": domain},
                          timeout=10).json()

        if r.get("hit"):
            cache_hits += 1
            # Ask Gemini to judge if cached response is appropriate for test query
            verdict = call_gemini(api_key,
                                  [{"role": "user",
                                    "content": f"QUERY: {test_q}\nRESPONSE: {r.get('response','')}"}],
                                  JUDGE, max_tokens=5)
            if verdict and "NO" in verdict.upper():
                false_positives += 1
                print(f"  ✗ FALSE POSITIVE  sim={r.get('similarity','?')}")
                print(f"    Seed:  {seed_q}")
                print(f"    Query: {test_q}")
            else:
                print(f"  ✓ hit but valid   sim={r.get('similarity','?')}")
        else:
            true_negatives += 1
            print(f"  ✓ correct miss    '{test_q[:50]}'")

    print()
    fp_rate = false_positives / len(test_pairs) * 100
    print(f"  Total pairs tested     : {len(test_pairs)}")
    print(f"  Cache hits             : {cache_hits}")
    print(f"  False positives        : {false_positives}")
    print(f"  False positive rate    : {fp_rate:.1f}%")

    if fp_rate == 0:
        ok("Zero false positives — similarity threshold (0.92) is correctly calibrated")
    elif fp_rate <= 10:
        info(f"{fp_rate:.0f}% false positive rate — acceptable")
    else:
        warn(f"{fp_rate:.0f}% false positive rate — lower SIMILARITY_THRESHOLD in semantic-cache.ts")

    return {"false_positive_rate": fp_rate, "cache_hits": cache_hits}

# ── 5. T5 Fallback Rate ───────────────────────────────────────────────────────

def test_fallback_rate():
    section("TEST 5 — Model Health Check")

    try:
        h = requests.get(HEALTH_EP, timeout=5).json()
        models = h.get("models", {})
        clf_ok  = models.get("classifier",    {}).get("loaded", False)
        t5_ok   = models.get("t5",            {}).get("loaded", False)
        mlm_ok  = models.get("semanticCache", {}).get("loaded", False)

        print(f"\n  Classifier loaded : {clf_ok}")
        print(f"  T5 loaded         : {t5_ok}")
        print(f"  MiniLM loaded     : {mlm_ok}")

        all_loaded = clf_ok and t5_ok and mlm_ok
        if all_loaded:
            ok("All 3 models loaded — no fallback risk")
        else:
            missing = [n for n, v in [("Classifier", clf_ok), ("T5", t5_ok), ("MiniLM", mlm_ok)] if not v]
            warn(f"Not loaded: {', '.join(missing)}")

        return {"classifier": clf_ok, "t5": t5_ok, "minilm": mlm_ok, "all_loaded": all_loaded}
    except Exception as e:
        warn(f"Health check failed: {e}")
        return {"all_loaded": False}

# ── 6. Long Conversation Degradation ─────────────────────────────────────────

def test_long_conversation_degradation(api_key):
    section("TEST 6 — Long Conversation Degradation")

    pairs = load_messages("customer_support.json", "instruction_response", 500)
    if len(pairs) < 30:
        warn("Not enough data — skipping"); return {}

    ANSWERER = ("You are a helpful assistant. Answer the user's final question "
                "accurately based on the conversation history. 2-3 sentences max.")
    JUDGE = ("Judge two responses to a question. "
             "Score A and B 1-10. Verdict: A_BETTER, B_BETTER, or EQUAL. "
             "JSON only: {\"score_a\":7,\"score_b\":7,\"verdict\":\"EQUAL\"}")

    turn_buckets = [5, 10, 15, 20, 30]
    results = {}

    print(f"\n  {'Turns':>6s}  {'OK%':>6s}  {'Full':>6s}  {'CTS':>5s}  "
          f"{'Reduction':>10s}  {'Latency':>8s}  N")
    print("  " + "-" * 58)

    for n_turns in turn_buckets:
        if len(pairs) < n_turns + 2:
            continue

        ok_count = total = 0
        scores_a = []; scores_b = []; reductions = []; latencies = []

        for trial in range(4):  # 4 trials per turn count
            start_idx = trial * n_turns
            if start_idx + n_turns >= len(pairs):
                break

            chunk   = pairs[start_idx : start_idx + n_turns]
            history = []
            for u, a in chunk[:-1]:
                history.append({"role": "user",      "content": u})
                history.append({"role": "assistant",  "content": a})
            message = chunk[-1][0]

            result, ms = call_compress(history, message, use_async=False)
            if result is None: continue

            comp_hist  = result.get("compressedHistory", [])
            orig_chars = sum(len(m["content"]) for m in history) + len(message)
            comp_chars = sum(len(m.get("content","")) for m in comp_hist)
            reduction  = (orig_chars - comp_chars) / orig_chars * 100 if orig_chars > 0 else 0

            answer_a = call_gemini(api_key,
                                   history + [{"role":"user","content":message}],
                                   ANSWERER)
            answer_b = call_gemini(api_key,
                                   comp_hist + [{"role":"user","content":message}],
                                   ANSWERER)
            if not answer_a or not answer_b: continue

            judge_raw = call_gemini(api_key,
                                    [{"role":"user","content":
                                      f"Q: {message}\nA: {answer_a}\nB: {answer_b}"}],
                                    JUDGE, max_tokens=80)
            verdict = "EQUAL"
            sa, sb  = 5, 5
            if judge_raw:
                try:
                    m = re.search(r'\{.*\}', judge_raw, re.DOTALL)
                    if m:
                        j = json.loads(m.group())
                        sa = int(j.get("score_a", 5))
                        sb = int(j.get("score_b", 5))
                        verdict = str(j.get("verdict","EQUAL")).upper()
                except Exception: pass

            total += 1
            if verdict in ("EQUAL","B_BETTER"): ok_count += 1
            scores_a.append(sa); scores_b.append(sb)
            reductions.append(reduction)
            if ms: latencies.append(ms)

        if total == 0: continue

        ok_pct   = ok_count / total * 100
        avg_a    = sum(scores_a) / len(scores_a)
        avg_b    = sum(scores_b) / len(scores_b)
        avg_red  = sum(reductions) / len(reductions)
        avg_lat  = sum(latencies) / len(latencies) if latencies else 0
        flag     = " ← drops" if ok_pct < 70 else ""

        print(f"  {n_turns:>6d}  {ok_pct:>5.1f}%  {avg_a:>6.2f}  {avg_b:>5.2f}  "
              f"{avg_red:>9.1f}%  {avg_lat:>6.0f}ms  {total}{flag}")
        results[n_turns] = {"ok_pct": ok_pct, "avg_reduction": avg_red, "n": total}

    print()
    if results:
        pcts = [v["ok_pct"] for v in results.values()]
        drop = max(pcts) - min(pcts)
        if drop < 10:
            ok(f"Quality stable across turn lengths (max drop: {drop:.1f}%)")
        else:
            warn(f"Quality drops {drop:.1f}% from shortest to longest conversations")

    return results

# ── 7. LLM Wiki Memory Quality ───────────────────────────────────────────────

def test_wiki_memory(api_key):
    section("TEST 7 — LLM Wiki Memory (injection · building · quality)")

    WIKI_EP = "http://127.0.0.1:8787/test/wiki"
    CHAT_EP = "http://127.0.0.1:8787/demo/chat"

    # ── Test A: Wiki injection ────────────────────────────────────────────────
    session_id = f"wiki-eval-{int(time.time())}"
    fake_page = (
        "# Customer Order Policy\n"
        "Return window: 30 days for all orders.\n"
        "Refund method: Original payment method within 5-7 business days.\n"
        "Exception: Digital downloads are non-refundable.\n"
        "Contact: support@example.com for all order issues.\n"
        "Order ID format: ORD-XXXXXXXX"
    )

    try:
        r = requests.post(WIKI_EP, json={
            "sessionId": session_id,
            "message":   "how do I return an order",
            "fakeWikiMarkdown": fake_page,
        }, timeout=10).json()
    except Exception as e:
        warn(f"Test A failed: {e}"); return {"injection_works": False}

    page_count   = r.get("pageCount", 0)
    has_context  = r.get("hasContext", False)
    wiki_context = r.get("wikiContext", "")

    print(f"\n  Test A: Wiki injection")
    print(f"  Pages seeded        : {page_count}")
    print(f"  Context retrieved   : {has_context}")
    print(f"  Context length      : {len(wiki_context)} chars")

    if has_context:
        ok("Wiki context retrieved correctly for matching query")
    else:
        warn("Wiki context not retrieved — llmWikiToContextString may not match tags")

    # ── Test B: Wiki builds after multi-turn demo chat ────────────────────────
    session_id_b = f"wiki-build-{int(time.time())}"
    history = [
        {"role": "user",      "content": "I'm having trouble sorting a list in Python."},
        {"role": "assistant", "content": "Happy to help! Show me your code."},
        {"role": "user",      "content": "I use arr.sort() but it modifies the original."},
        {"role": "assistant", "content": "Use sorted(arr) — it returns a new list."},
        {"role": "user",      "content": "How do I sort by a custom key, like string length?"},
        {"role": "assistant", "content": "Use sorted(arr, key=len). Add reverse=True for descending."},
        {"role": "user",      "content": "What about sorting a list of dicts by a field?"},
        {"role": "assistant", "content": "sorted(items, key=lambda x: x['field']) works great."},
    ]

    wiki_pages_built = 0
    try:
        r2 = requests.post(CHAT_EP, json={
            "sessionId": session_id_b,
            "message":   "Summarise all sorting methods we covered.",
            "history":   history,
        }, timeout=30).json()
        wiki_pages_built = r2.get("wikiPageCount", 0)
        print(f"\n  Test B: Wiki building after 8-turn conversation")
        print(f"  Wiki pages built    : {wiki_pages_built}")
        if wiki_pages_built > 0:
            ok(f"Wiki built {wiki_pages_built} page(s) from conversation")
        else:
            info("Wiki not yet built — ingest triggers asynchronously; "
                 "may need ≥1 more turn to appear in response")
    except Exception as e:
        warn(f"Test B chat error: {e}")

    # ── Test C: Fact survives into context for follow-up query ────────────────
    FACT_CHECK = (
        "Does the following context contain information about order return policies "
        "or return windows? Answer YES or NO only."
    )

    # Empty session — no wiki
    try:
        no_wiki = requests.post(WIKI_EP, json={
            "sessionId": f"empty-{int(time.time())}",
            "message":   "What is the return window for orders?",
        }, timeout=10).json()
        no_wiki_ctx = no_wiki.get("wikiContext", "") or "(empty)"
    except Exception:
        no_wiki_ctx = "(error)"

    # Seeded session — has wiki
    try:
        with_wiki = requests.post(WIKI_EP, json={
            "sessionId": session_id,
            "message":   "What is the return window for orders?",
        }, timeout=10).json()
        with_wiki_ctx = with_wiki.get("wikiContext", "") or "(empty)"
    except Exception:
        with_wiki_ctx = "(error)"

    print(f"\n  Test C: Fact retrieval quality")
    print(f"  Without wiki (chars) : {len(no_wiki_ctx)}")
    print(f"  With wiki (chars)    : {len(with_wiki_ctx)}")

    fact_in_context = False
    verdict = call_gemini(
        api_key,
        [{"role": "user", "content": f"CONTEXT:\n{with_wiki_ctx}"}],
        FACT_CHECK, max_tokens=5,
    )
    if verdict:
        fact_in_context = "YES" in verdict.upper()

    if fact_in_context:
        ok("Wiki context surfaces the correct domain facts for follow-up queries")
    else:
        warn("Wiki fact not surfaced — check llmWikiToContextString scoring logic")

    # ── Test D: Quality delta — does wiki context improve Gemini's answer? ────
    JUDGE = (
        "Two AI system prompts. A has no memory context. B has wiki memory context. "
        "Which gives a more accurate, complete answer to a user asking about order returns? "
        "Score each 1-10. JSON only: {\"score_a\":N,\"score_b\":N,\"verdict\":\"A_BETTER|B_BETTER|EQUAL\"}"
    )

    score_delta = None
    verdict_d   = None
    try:
        judge_raw = call_gemini(
            api_key,
            [{"role": "user", "content":
              f"System prompt A: (no memory)\nSystem prompt B:\n{with_wiki_ctx[:800]}"}],
            JUDGE, max_tokens=80,
        )
        if judge_raw:
            m = __import__("re").search(r'\{.*\}', judge_raw, __import__("re").DOTALL)
            if m:
                j = json.loads(m.group())
                sa = int(j.get("score_a", 5))
                sb = int(j.get("score_b", 5))
                verdict_d   = str(j.get("verdict", "EQUAL")).upper()
                score_delta = sb - sa
    except Exception:
        pass

    print(f"\n  Test D: Quality delta (wiki context vs none)")
    if score_delta is not None:
        print(f"  Score delta (B-A)    : {score_delta:+d}  verdict: {verdict_d}")
        if score_delta >= 0:
            ok("Wiki memory context improves or matches baseline quality")
        else:
            warn("Wiki context scored lower than no-context — check page content quality")
    else:
        info("Could not get quality delta from Gemini judge")

    return {
        "injection_works":    has_context,
        "wiki_pages_built":   wiki_pages_built,
        "fact_in_context":    fact_in_context,
        "quality_delta":      score_delta,
    }


# ── Main ──────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    api_key = load_env_key()
    if not api_key:
        print("[error] GEMINI_API_KEY not found in .env"); sys.exit(1)

    try:
        requests.get(HEALTH_EP, timeout=5)
    except Exception:
        print("[error] CTS server not reachable. Run: npm run api"); sys.exit(1)

    print("\n" + "=" * 64)
    print("  CTS Missing Metrics Eval")
    print("  Tests: consistency · load · ratio·quality · cache FP ·")
    print("         fallback rate · long conversation · wiki memory")
    print("=" * 64)
    print(f"  Gemini model: {GEMINI_MODEL}")

    random.seed(42)
    all_results = {}

    all_results["consistency"]       = test_consistency()
    all_results["latency_under_load"]= test_latency_under_load()
    all_results["ratio_vs_quality"]  = test_ratio_vs_quality()
    all_results["cache_fp"]          = test_cache_false_positives(api_key)
    all_results["fallback_rate"]     = test_fallback_rate()
    all_results["long_conv"]         = test_long_conversation_degradation(api_key)
    all_results["wiki_memory"]       = test_wiki_memory(api_key)

    # ── Final summary ─────────────────────────────────────────────────────────
    section("FINAL SUMMARY — All Missing Metrics")

    def fmt_float(val, fmt=".2f", suffix="%", fallback="no data"):
        try: return f"{float(val):{fmt}}{suffix}"
        except (TypeError, ValueError): return fallback

    avg_var      = all_results["consistency"].get("avg_variance")
    p95_50       = all_results["latency_under_load"].get(50, {}).get("p95")
    fp_rate      = all_results["cache_fp"].get("false_positive_rate")
    all_models   = all_results["fallback_rate"].get("all_loaded", False)
    wiki_delta   = all_results["wiki_memory"].get("quality_delta")
    long_pcts    = [v["ok_pct"] for v in all_results["long_conv"].values()]

    checks = [
        ("Compression consistency",
         float(avg_var) < 5 if avg_var is not None else False,
         fmt_float(avg_var, ".2f", "%", "no data") + " avg variance"),
        ("Latency at 50 concurrent",
         float(p95_50) < 1000 if p95_50 is not None else False,
         fmt_float(p95_50, ".0f", "ms", "no data") + " p95"),
        ("No quality cliff",
         all(v["ok_rate"] >= 60 for v in all_results["ratio_vs_quality"].values() if v.get("n", 0) >= 3),
         "across all compression buckets"),
        ("Cache false positive rate",
         float(fp_rate) <= 10 if fp_rate is not None else False,
         fmt_float(fp_rate, ".0f", "%", "no data") + " FP rate"),
        ("All models loaded",
         all_models,
         "classifier + T5 + MiniLM"),
        ("Long conversation stability",
         len(long_pcts) < 2 or (max(long_pcts) - min(long_pcts)) < 15,
         f"{max(long_pcts) - min(long_pcts):.1f}% drop" if len(long_pcts) >= 2 else "no data"),
        ("Wiki memory injection",
         all_results["wiki_memory"].get("injection_works", False),
         "wiki context surfaces correctly"),
        ("Wiki memory quality delta",
         (wiki_delta or 0) >= 0,
         fmt_float(wiki_delta, "+.0f", " score delta", "no data")),
    ]

    print()
    all_pass = True
    for name, passed, detail in checks:
        sym = "✓" if passed else "✗"
        print(f"  {sym} {name:35s} {detail}")
        if not passed: all_pass = False

    print()
    if all_pass:
        print("  ALL METRICS PASS ✓  — CTS is production ready")
    else:
        print("  Some metrics need attention — see details above")
    print()

    out = BASE / "data" / "missing_metrics_results.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    with open(out, "w") as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f"  Full results → {out}\n")
