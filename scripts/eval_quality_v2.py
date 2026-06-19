# -*- coding: utf-8 -*-
"""
CTS Output Quality Eval v2
===========================
Measures whether CTS compression hurts answer quality.

Method:
  For each conversation:
    A) Full history  → Gemini → answer
    B) CTS compressed → Gemini → answer
    Judge (Gemini): score both 1-10, verdict A_BETTER / EQUAL / B_BETTER

  "OK rate" = % of conversations where CTS matches or beats full history

Reads GEMINI_API_KEY from .env automatically — no --key arg needed.

Run:
  python eval_quality_v2.py                   # 100 samples, all domains
  python eval_quality_v2.py --samples 200     # more samples
  python eval_quality_v2.py --domain coding   # single domain debug
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

try:
    import requests
except ImportError:
    print("[error] pip install requests"); sys.exit(1)

# ── Config ────────────────────────────────────────────────────────────────────

BASE         = Path(__file__).parent
CTS_ENDPOINT = "http://127.0.0.1:8787/demo/compress"
RESULTS_FILE = BASE / "data" / "quality_v2_results.json"
WORKERS      = 8

GEMINI_MODEL = "gemini-3.5-flash"
# Native Gemini REST API — works with AIzaSy... API keys via ?key= param
GEMINI_BASE  = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"

# Per-domain sample count (total = sum of these)
SAMPLE_PLAN = [
    ("customer_support.json", "customer_support", "instruction_response", 25),
    ("coding.json",           "coding",           "stackoverflow",        25),
    ("education.json",        "education",        "squad",                20),
    ("sales.json",            "sales",            "instruction_response", 15),
    ("commerce.json",         "commerce",         "instruction_response", 15),
    ("general.json",          "general",          "instruction_response", 10),
    ("medical.json",          "medical",          "qa",                   10),
]

# ── Load Gemini key from .env ─────────────────────────────────────────────────

def load_env_key() -> str:
    env_file = BASE / ".env"
    if env_file.exists():
        for line in env_file.read_text().splitlines():
            line = line.strip()
            if line.startswith("GEMINI_API_KEY="):
                return line.split("=", 1)[1].strip()
    return ""

# ── Token counter ─────────────────────────────────────────────────────────────

try:
    import tiktoken
    _enc = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text: str) -> int:
        return len(_enc.encode(str(text)))
except ImportError:
    def count_tokens(text: str) -> int:
        return max(1, len(str(text).split()) * 4 // 3)

# ── Dataset loaders ───────────────────────────────────────────────────────────

def parse_entries(data, schema):
    entries = []
    for item in data:
        try:
            if schema == "instruction_response":
                u = str(item.get("instruction") or item.get("input") or item.get("question") or "")
                a = str(item.get("response")    or item.get("output") or item.get("answer")   or "")
                group = str(item.get("intent") or item.get("category") or "default")
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
                group = "medical"
            elif schema == "squad":
                ctx = str(item.get("context") or "")
                q   = str(item.get("question") or "")
                ans = item.get("answers") or {}
                a   = str((ans.get("text") or [""])[0]) if isinstance(ans, dict) else ""
                u   = f"{ctx[:300]} {q}".strip() if ctx else q
                group = str(item.get("title") or "education")
            else:
                continue
            if len(u) > 20 and len(a) > 10:
                entries.append({"user": u[:600], "assistant": a[:500],
                                "group": group})
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
        turns = 3   # 3-turn history so there's real context to preserve
        for i in range(0, len(pool) - turns, turns):
            chunk   = pool[i : i + turns]
            history = []
            for e in chunk[:-1]:
                history.append({"role": "user",      "content": e["user"]})
                history.append({"role": "assistant",  "content": e["assistant"]})
            convs.append({
                "history": history,
                "message": chunk[-1]["user"],
                "group":   group,
            })
            if len(convs) >= n:
                return convs
    return convs[:n]

def load_sample(filename, schema, domain, n):
    # Search project root first, then data/ subdirectory
    for search_dir in [BASE, BASE / "data"]:
        path = search_dir / filename
        if not path.exists():
            continue
        try:
            with open(path, encoding="utf-8", errors="replace") as f:
                first = f.read(1); f.seek(0)
                if first == "[":
                    raw = json.load(f)[:n * 12]
                elif first == "{":
                    data = json.load(f)
                    raw  = next((v for v in data.values() if isinstance(v, list)), [])[:n * 12]
                else:
                    raw = []
                    for i, line in enumerate(f):
                        if i >= n * 12: break
                        try: raw.append(json.loads(line.strip()))
                        except: continue
            entries = parse_entries(raw, schema)
            convs   = build_conversations(entries, n)
            for i, c in enumerate(convs):
                c["domain"] = domain
                c["_id"]    = f"{domain}_{i}"
            return convs
        except Exception as e:
            print(f"  [warn] {filename}: {e}")
    return []

# ── Gemini API call ───────────────────────────────────────────────────────────

import threading
_rate_lock    = threading.Lock()
_last_call    = [0.0]
_MIN_INTERVAL = float(__import__('os').environ.get('GEMINI_MIN_INTERVAL', '9'))  # seconds between calls (per-minute quota guard)

def _throttle():
    with _rate_lock:
        wait = _MIN_INTERVAL - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()

def call_gemini(api_key, messages, system, max_tokens=1000):
    _throttle()
    url = GEMINI_BASE.format(model=GEMINI_MODEL) + f"?key={api_key}"
    # Convert OpenAI-style messages to native Gemini format
    contents = []
    for m in messages:
        role = "user" if m["role"] == "user" else "model"
        contents.append({"role": role, "parts": [{"text": m["content"]}]})
    payload = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents":          contents,
        "generationConfig":  {"maxOutputTokens": max_tokens, "temperature": 0.3, "thinkingConfig": {"thinkingBudget": 0}},
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
            if r.status_code in (429, 500, 503):          # rate-limit / transient → back off & retry
                time.sleep(2 * (attempt + 1)); continue
            return None
        except Exception:
            time.sleep(1.5 * (attempt + 1))
    return None

def call_cts(history, message):
    try:
        r = requests.post(CTS_ENDPOINT,
                          json={"history": history, "message": message},
                          timeout=10)
        if r.status_code == 200:
            return r.json()
    except Exception:
        pass
    return None

# ── Prompts ───────────────────────────────────────────────────────────────────

ANSWERER_SYSTEM = (
    "You are a helpful assistant. Answer the user's question concisely and accurately "
    "based on the conversation history provided. Be direct — 2-4 sentences max."
)

JUDGE_SYSTEM = """You are an impartial judge evaluating two AI assistant responses.

Given:
- The user's question
- Response A (from FULL conversation history)
- Response B (from CTS COMPRESSED history — shorter context)

Score each response 1-10 on accuracy, context usage, and completeness.
Verdict: A_BETTER (full history clearly better), B_BETTER (compressed better), EQUAL (same quality)

Respond ONLY in this exact JSON:
{"score_a": 7, "score_b": 7, "verdict": "EQUAL", "reason": "one short sentence"}"""

# ── Per-conversation eval ─────────────────────────────────────────────────────

def evaluate_one(conv, api_key):
    cid     = conv["_id"]
    history = conv["history"]
    message = conv["message"]
    domain  = conv["domain"]

    orig_tokens = count_tokens(message) + sum(count_tokens(m["content"]) for m in history)

    # Step 1: CTS compress
    cts = call_cts(history, message)
    if cts is None:
        return {"id": cid, "domain": domain, "error": "cts_failed",
                "original_tokens": orig_tokens, "compressed_tokens": orig_tokens,
                "reduction_pct": 0}

    comp_hist   = cts.get("compressedHistory", [])
    comp_tokens = max(1, sum(count_tokens(str(m.get("content",""))) for m in comp_hist))
    reduction   = round((1 - comp_tokens / orig_tokens) * 100, 1)

    # Step 2: Answer A — full history
    answer_a = call_gemini(api_key,
                           history + [{"role": "user", "content": message}],
                           ANSWERER_SYSTEM)

    # Step 3: Answer B — compressed history
    answer_b = call_gemini(api_key,
                           comp_hist + [{"role": "user", "content": message}],
                           ANSWERER_SYSTEM)

    if not answer_a or not answer_b:
        return {"id": cid, "domain": domain, "error": "llm_failed",
                "original_tokens": orig_tokens, "compressed_tokens": comp_tokens,
                "reduction_pct": reduction}

    # Step 4: Judge
    judge_prompt = (
        f"USER QUESTION: {message}\n\n"
        f"RESPONSE A (full history, {orig_tokens} tokens):\n{answer_a}\n\n"
        f"RESPONSE B (CTS compressed, {comp_tokens} tokens, {reduction}% smaller):\n{answer_b}\n\n"
        f"Judge these responses."
    )
    judge_raw = call_gemini(api_key,
                            [{"role": "user", "content": judge_prompt}],
                            JUDGE_SYSTEM, max_tokens=600)

    score_a, score_b, verdict, reason = 5, 5, "EQUAL", ""
    if judge_raw:
        try:
            m = re.search(r'\{.*\}', judge_raw, re.DOTALL)
            if m:
                j       = json.loads(m.group())
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
        "reduction_pct":    reduction,
        "score_a":          score_a,
        "score_b":          score_b,
        "verdict":          verdict,
        "reason":           reason,
        "answer_a":         answer_a[:300],
        "answer_b":         answer_b[:300],
        "error":            None,
    }

# ── Summary printer ───────────────────────────────────────────────────────────

def print_summary(results, domain_filter=None):
    valid = [r for r in results if not r.get("error")]
    errs  = len(results) - len(valid)

    if not valid:
        print("\n[summary] No valid results.")
        # Show error breakdown so we know exactly what failed
        error_counts: dict = {}
        for r in results:
            e = r.get("error", "unknown")
            error_counts[e] = error_counts.get(e, 0) + 1
        print("  Error breakdown:")
        for e, count in error_counts.items():
            print(f"    {e}: {count}")
        print("\n  Likely causes:")
        print("    cts_failed  → CTS server not running or /demo/compress returning error")
        print("    llm_failed  → Gemini API key invalid, quota exceeded, or wrong model name")
        return

    eq  = sum(1 for r in valid if r["verdict"] == "EQUAL")
    ab  = sum(1 for r in valid if r["verdict"] == "A_BETTER")
    bb  = sum(1 for r in valid if r["verdict"] == "B_BETTER")
    avg_a   = sum(r["score_a"]      for r in valid) / len(valid)
    avg_b   = sum(r["score_b"]      for r in valid) / len(valid)
    avg_red = sum(r["reduction_pct"] for r in valid) / len(valid)
    ok_rate = (eq + bb) / len(valid) * 100

    print("\n" + "=" * 64)
    print("  CTS Output Quality Eval v2 — Results")
    print("=" * 64)
    print(f"  Conversations tested    : {len(valid)}")
    print(f"  Avg token reduction     : {avg_red:.1f}%")
    print()
    print("  -- ANSWER QUALITY (1-10 scored by Gemini judge) --")
    print(f"  Full history avg score  : {avg_a:.2f} / 10")
    print(f"  CTS compressed avg      : {avg_b:.2f} / 10")
    print(f"  Score gap               : {avg_b - avg_a:+.2f}  "
          f"({'CTS better ✓' if avg_b >= avg_a else 'full history better'})")
    print()
    print("  -- VERDICT BREAKDOWN --")
    print(f"  Equal quality           : {eq:>4d}  ({eq/len(valid)*100:.1f}%)")
    print(f"  CTS answer BETTER       : {bb:>4d}  ({bb/len(valid)*100:.1f}%)")
    print(f"  Full history BETTER     : {ab:>4d}  ({ab/len(valid)*100:.1f}%)")
    print()
    print(f"  ★ CTS OK rate (matches or beats full): {ok_rate:.1f}%")
    print()

    # Per-domain breakdown
    print("  -- BY DOMAIN --")
    print(f"  {'Domain':20s}  {'Full':>5s}  {'CTS':>5s}  {'Gap':>5s}  {'OK%':>6s}  {'N':>4s}  Status")
    print("  " + "-" * 62)
    domains = sorted(set(r["domain"] for r in valid))
    for domain in domains:
        rows  = [r for r in valid if r["domain"] == domain]
        d_a   = sum(r["score_a"] for r in rows) / len(rows)
        d_b   = sum(r["score_b"] for r in rows) / len(rows)
        gap   = d_b - d_a
        ok    = sum(1 for r in rows if r["verdict"] in ("EQUAL", "B_BETTER"))
        ok_pct = ok / len(rows) * 100
        status = "✓ READY" if ok_pct >= 65 else ("⚠ WEAK" if ok_pct >= 40 else "✗ BROKEN")
        print(f"  {domain:20s}  {d_a:>5.2f}  {d_b:>5.2f}  {gap:>+5.2f}  {ok_pct:>5.1f}%  {len(rows):>4d}  {status}")

    # Production readiness verdict
    print()
    ready_domains = [d for d in domains
                     if (lambda rows: sum(1 for r in rows if r["verdict"] in ("EQUAL","B_BETTER")) / len(rows) * 100 >= 65)(
                         [r for r in valid if r["domain"] == d])]
    not_ready = [d for d in domains if d not in ready_domains]

    print("  -- PRODUCTION READINESS --")
    print(f"  Ready for pilots   : {', '.join(ready_domains) or 'none'}")
    print(f"  Needs fixing first : {', '.join(not_ready) or 'none'}")
    print()

    # Worst cases — where CTS clearly hurt
    hurt = [r for r in valid if r["verdict"] == "A_BETTER"]
    if hurt:
        print(f"  -- TOP CASES WHERE CTS HURT (showing 5 of {len(hurt)}) --")
        worst = sorted(hurt, key=lambda r: r["score_a"] - r["score_b"], reverse=True)[:5]
        for r in worst:
            print(f"  [{r['domain']:16s}]  {r['reduction_pct']}% reduction  "
                  f"Full:{r['score_a']}  CTS:{r['score_b']}")
            print(f"    Reason: {r['reason']}")
            print(f"    Full answer: {r['answer_a'][:120]}...")
            print(f"    CTS answer:  {r['answer_b'][:120]}...")
            print()

    print("=" * 64)
    if errs:
        print(f"  [warn] {errs} errors (CTS timeout or Gemini failure)")
    print(f"  Full results → {RESULTS_FILE}\n")

# ── Main ──────────────────────────────────────────────────────────────────────

def preflight(api_key: str) -> bool:
    """Test CTS and Gemini before running the full eval. Prints exact error."""
    ok = True

    # 1. CTS /demo/compress
    print("[preflight] Testing CTS /demo/compress ...", end=" ", flush=True)
    try:
        r = requests.post(CTS_ENDPOINT,
                          json={"history": [], "message": "hello"},
                          timeout=10)
        if r.status_code == 200:
            data = r.json()
            print(f"OK  (tokensSaved={data.get('tokensSaved', '?')})")
        else:
            print(f"FAIL  HTTP {r.status_code}: {r.text[:200]}")
            ok = False
    except Exception as e:
        print(f"FAIL  {e}")
        ok = False

    # 2. Gemini API
    print("[preflight] Testing Gemini API ...", end=" ", flush=True)
    try:
        url = GEMINI_BASE.format(model=GEMINI_MODEL) + f"?key={api_key}"
        r = requests.post(url,
                          json={
                              "contents": [{"role": "user", "parts": [{"text": "Say OK"}]}],
                              "generationConfig": {"maxOutputTokens": 50, "thinkingConfig": {"thinkingBudget": 0}},
                          },
                          headers={"Content-Type": "application/json"},
                          timeout=20)
        if r.status_code == 200:
            reply = r.json()["candidates"][0]["content"]["parts"][0]["text"].strip()
            print(f"OK  (reply='{reply[:40]}')")
        else:
            print(f"FAIL  HTTP {r.status_code}: {r.text[:300]}")
            ok = False
    except Exception as e:
        print(f"FAIL  {e}")
        ok = False

    return ok


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--samples", type=int, default=120,
                        help="Total conversations to test (default: 120)")
    parser.add_argument("--domain",  default=None,
                        help="Test a single domain only (e.g. --domain coding)")
    parser.add_argument("--workers", type=int, default=WORKERS)
    args = parser.parse_args()

    api_key = load_env_key()
    if not api_key:
        print("[error] GEMINI_API_KEY not found in .env"); sys.exit(1)
    print(f"[key] GEMINI_API_KEY loaded ({api_key[:8]}...)\n")

    # Check server is up
    try:
        r = requests.get("http://127.0.0.1:8787/health", timeout=5)
        health = r.json()
        models = health.get("models", {})
        print(f"[server] CTS up — models: {models}")
    except Exception:
        print("[error] CTS server not reachable. Run:  npm run api"); sys.exit(1)

    # Pre-flight: test both endpoints before running full eval
    print()
    if not preflight(api_key):
        print("\n[error] Pre-flight failed — fix the issue above before running full eval.")
        sys.exit(1)
    print()

    # Filter plan if --domain set
    plan = SAMPLE_PLAN
    if args.domain:
        plan = [(f, d, s, n) for f, d, s, n in SAMPLE_PLAN if d == args.domain]
        if not plan:
            print(f"[error] Unknown domain '{args.domain}'. "
                  f"Options: {[d for _,d,_,_ in SAMPLE_PLAN]}"); sys.exit(1)

    print(f"\n[CTS Quality Eval v2]  model={GEMINI_MODEL}  workers={args.workers}")
    print("=" * 64)

    # Load all conversations
    all_convs = []
    scale = args.samples / sum(n for _,_,_,n in plan)
    for filename, domain, schema, base_n in plan:
        n = max(5, int(base_n * scale))
        print(f"  Loading {domain:20s} ({filename}) ... ", end="", flush=True)
        convs = load_sample(filename, schema, domain, n)
        if convs:
            print(f"{len(convs)} conversations")
            all_convs.extend(convs)
        else:
            print("SKIPPED (file not found or empty)")

    if not all_convs:
        print("\n[error] No conversations loaded. Check dataset files exist in project root.")
        sys.exit(1)

    random.seed(42)
    random.shuffle(all_convs)
    total = len(all_convs)
    print(f"\n[eval] Running {total} conversations with {args.workers} workers...\n")

    results  = []
    start    = time.time()

    with ThreadPoolExecutor(max_workers=args.workers) as ex:
        futures = {ex.submit(evaluate_one, c, api_key): c for c in all_convs}
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            done  = len(results)
            valid = [r for r in results if not r.get("error")]

            if valid:
                eq    = sum(1 for r in valid if r["verdict"] == "EQUAL")
                bb    = sum(1 for r in valid if r["verdict"] == "B_BETTER")
                ab    = sum(1 for r in valid if r["verdict"] == "A_BETTER")
                avg_a = sum(r["score_a"] for r in valid) / len(valid)
                avg_b = sum(r["score_b"] for r in valid) / len(valid)
                ok_r  = (eq + bb) / len(valid) * 100
                rate  = done / (time.time() - start) * 60
                print(f"\r[{done:3d}/{total}]  {rate:4.0f}/min  |  "
                      f"Full:{avg_a:.1f}  CTS:{avg_b:.1f}  OK:{ok_r:.1f}%  |  "
                      f"Equal:{eq}  CTS-better:{bb}  Full-better:{ab}   ",
                      end="", flush=True)

    print("\n")
    RESULTS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_FILE, "w") as f:
        json.dump(results, f, indent=2)

    print_summary(results)
