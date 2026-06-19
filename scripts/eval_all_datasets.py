# -*- coding: utf-8 -*-
"""
CTS Multi-Dataset Evaluation Script
Handles all domain datasets (single-turn Q&A) + MultiWOZ (conversations).
Builds synthetic multi-turn conversations from single-turn datasets.
"""

import json
import csv
import time
import random
import sys
from collections import defaultdict
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor, as_completed

# ── Config ────────────────────────────────────────────────────────────────────

CTS_ENDPOINT  = "http://127.0.0.1:8787/demo/compress"
BASE          = Path(__file__).parent
RESULTS_CSV   = BASE / "data" / "all_datasets_results.csv"
PROGRESS_FILE = BASE / "data" / "all_datasets_progress.json"
SAMPLE_PER_DOMAIN = 999_999   # no cap — run all data
WORKERS           = 20        # concurrent threads — tune up/down based on CPU
SLEEP_BETWEEN     = 0.0       # no sleep needed with concurrency

# Dataset configs: file, cts_domain, schema_type, sample_cap
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

# MultiWOZ domain -> CTS domain
MULTIWOZ_MAP = {
    "restaurant": "commerce", "hotel": "commerce", "taxi": "commerce",
    "train": "commerce", "bus": "commerce", "attraction": "general",
    "hospital": "medical", "police": "legal",
}

# ── Try imports ───────────────────────────────────────────────────────────────

try:
    import requests
except ImportError:
    print("[error] pip install requests"); sys.exit(1)

try:
    import tiktoken
    enc = tiktoken.get_encoding("cl100k_base")
    def count_tokens(text: str) -> int:
        return len(enc.encode(str(text)))
except ImportError:
    def count_tokens(text: str) -> int:
        return max(1, len(str(text).split()) * 4 // 3)

import re as _re

# ── Information retention helpers ─────────────────────────────────────────────

_STOPWORDS = {
    'a','an','the','is','are','was','were','be','been','being',
    'have','has','had','do','does','did','will','would','could','should',
    'may','might','shall','can','need','i','you','he','she','it','we',
    'they','me','him','her','us','them','my','your','his','its','our',
    'their','this','that','these','those','what','which','who','whom',
    'when','where','why','how','all','each','every','both','few','more',
    'most','other','some','such','no','not','only','same','so','than',
    'too','very','just','but','and','or','as','at','by','for','from',
    'in','into','of','on','to','with','about','after','before','between',
    'during','through','up','down','out','off','over','under','again',
    'then','there','here','if','because','while','although','though',
    'however','therefore','thus','also','even','still','yet','get','got',
    'like','go','use','used','using','one','two','three','new','old',
}

def _content_words(text: str) -> set:
    """Extract meaningful words: lowercase, 3+ chars, not a stopword."""
    words = _re.findall(r'[a-z0-9]+', str(text).lower())
    return {w for w in words if len(w) > 2 and w not in _STOPWORDS}

def compute_retention(original_history: list, compressed_history: list) -> float:
    """
    What % of content words from the original history survive in the
    compressed history. Returns 0-100.
    A score of 100 means every meaningful word was preserved.
    A score of 80 means 80% of facts/entities made it through compression.
    """
    orig_text = ' '.join(m.get('content', '') for m in original_history)
    comp_text = ' '.join(str(m.get('content', '')) for m in compressed_history)
    orig_words = _content_words(orig_text)
    if not orig_words:
        return 100.0
    comp_words = _content_words(comp_text)
    retained   = orig_words & comp_words
    return round(len(retained) / len(orig_words) * 100, 2)

# ── Schema parsers ─────────────────────────────────────────────────────────────

def parse_entries(data: list, schema: str) -> list:
    """Return list of {user, assistant, group} dicts from raw dataset entries."""
    entries = []
    for item in data:
        try:
            group = str(
                item.get("intent") or item.get("category") or
                item.get("qtype") or item.get("title") or
                item.get("tags") or "default"
            )
            if schema == "instruction_response":
                u = str(item.get("instruction") or item.get("question") or "")
                a = str(item.get("response") or item.get("answer") or "")
            elif schema == "stackoverflow":
                import re
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
            elif schema == "legal":
                u = str(item.get("text") or "")
                a = str(item.get("answer") or "")
                group = "legal_classification"
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
                entries.append({"user": u[:600], "assistant": a[:600], "group": group})
        except Exception:
            continue
    return entries

def build_synthetic_conversations(entries: list, n: int) -> list:
    """
    Group entries by intent/category, then build multi-turn conversations
    by picking 3-5 entries from the SAME group as consecutive turns.
    This simulates a real focused conversation — all turns on-topic.
    """
    # Group by intent/category
    by_group = defaultdict(list)
    for e in entries:
        by_group[e["group"]].append(e)

    # Shuffle within each group
    for g in by_group:
        random.shuffle(by_group[g])

    convs = []
    groups = list(by_group.keys())
    random.shuffle(groups)

    for group in groups:
        pool  = by_group[group]
        # Slide a window of 3-5 turns across each group
        turns = random.randint(3, 5)
        for i in range(0, len(pool) - turns, turns):
            chunk = pool[i:i + turns]
            history = []
            for e in chunk[:-1]:                        # all but last = history
                history.append({"role": "user",      "content": e["user"]})
                history.append({"role": "assistant", "content": e["assistant"]})
            message = chunk[-1]["user"]                 # last user turn = message
            convs.append({"history": history, "message": message, "group": group})
            if len(convs) >= n:
                return convs

    # If not enough grouped convs, pad with random cross-group ones
    all_entries = [e for pool in by_group.values() for e in pool]
    random.shuffle(all_entries)
    i = 0
    while len(convs) < n and i + 3 < len(all_entries):
        turns = random.randint(3, 5)
        chunk = all_entries[i:i + turns]
        history = []
        for e in chunk[:-1]:
            history.append({"role": "user",      "content": e["user"]})
            history.append({"role": "assistant", "content": e["assistant"]})
        convs.append({"history": history, "message": chunk[-1]["user"], "group": "mixed"})
        i += turns

    return convs[:n]

# ── MultiWOZ parser ────────────────────────────────────────────────────────────

def load_multiwoz(path: Path, n: int) -> list:
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    by_domain = defaultdict(list)
    for conv in data:
        for svc in conv.get("services", []):
            if svc in MULTIWOZ_MAP:
                by_domain[svc].append(conv)
                break
    convs = []
    per = max(1, n // len(MULTIWOZ_MAP))
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
                "history":  msgs[:last_user],
                "message":  msgs[last_user]["content"],
                "domain":   MULTIWOZ_MAP.get(domain, "general"),
                "mwoz_domain": domain,
            })
    random.shuffle(convs)
    return convs[:n]

# ── Load dataset ───────────────────────────────────────────────────────────────

def load_dataset(filename: str, schema: str, cts_domain: str, cap: int) -> list:
    path = BASE / filename
    if not path.exists():
        print(f"  [skip] {filename} not found")
        return []

    size_mb = path.stat().st_size / 1_048_576
    print(f"  [load] {filename} ({size_mb:.0f} MB) ...", end=" ", flush=True)

    if schema == "multiwoz":
        convs = load_multiwoz(path, cap)
        print(f"{len(convs)} conversations")
        return [{"cts_domain": cts_domain, "schema": schema, **c} for c in convs]

    # Stream large files — only load enough entries
    needed = cap * 5 * 2   # enough raw entries to build capped conversations
    entries_raw = []
    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            # Try streaming line by line first (JSONL)
            first_char = f.read(1)
            f.seek(0)
            if first_char == "[":
                # JSON array — load fully but cap
                try:
                    data = json.load(f)
                    entries_raw = data[:needed]
                except Exception as e:
                    print(f"parse error: {e}")
                    return []
            elif first_char == "{":
                # Wrapped object e.g. {"value": [...], "Count": N}
                try:
                    data = json.load(f)
                    arr  = next((v for v in data.values() if isinstance(v, list)), [])
                    entries_raw = arr[:needed]
                except Exception as e:
                    print(f"parse error: {e}")
                    return []
            else:
                # JSONL
                for i, line in enumerate(f):
                    if i >= needed:
                        break
                    line = line.strip()
                    if line:
                        try:
                            entries_raw.append(json.loads(line))
                        except Exception:
                            continue
    except Exception as e:
        print(f"read error: {e}")
        return []

    entries = parse_entries(entries_raw, schema)
    print(f"{len(entries_raw)} entries -> {len(entries)} parsed")

    convs = build_synthetic_conversations(entries, cap)
    return [{"cts_domain": cts_domain, "schema": schema, "history": c["history"], "message": c["message"]} for c in convs]

# ── CTS call ──────────────────────────────────────────────────────────────────

def call_cts(history: list, message: str, retries: int = 3) -> dict | None:
    for attempt in range(retries):
        try:
            resp = requests.post(CTS_ENDPOINT,
                json={"history": history, "message": message},
                timeout=10, headers={"Content-Type": "application/json"})
            if resp.status_code == 429:
                print("\n[rate-limit] sleeping 65s ..."); time.sleep(65); continue
            if resp.status_code != 200:
                return None
            return resp.json()
        except requests.exceptions.Timeout:
            time.sleep(2)
        except Exception:
            return None
    return None

# ── Progress ──────────────────────────────────────────────────────────────────

def load_progress() -> dict:
    if PROGRESS_FILE.exists():
        with open(PROGRESS_FILE) as f:
            return json.load(f)
    return {}

def save_progress(done: dict):
    PROGRESS_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(PROGRESS_FILE, "w") as f:
        json.dump(done, f)

# ── Main ──────────────────────────────────────────────────────────────────────

def run():
    random.seed(42)
    print("\n[CTS Multi-Dataset Eval]\n")

    # Load all datasets
    all_convs = []
    for filename, cts_domain, schema, cap in DATASETS:
        print(f"\n[{cts_domain.upper()}] {filename}")
        convs = load_dataset(filename, schema, cts_domain, cap)
        for i, c in enumerate(convs):
            c["_id"] = f"{cts_domain}_{i}"
        all_convs.extend(convs)

    random.shuffle(all_convs)
    total    = len(all_convs)
    progress = load_progress()
    results  = []

    remaining = [c for c in all_convs if c["_id"] not in progress]
    for cid, row in progress.items():
        results.append(row)

    print(f"\n[eval] {total} conversations | {len(remaining)} remaining | {WORKERS} workers")
    eta = len(remaining) / max(1, WORKERS * 20)
    print(f"[eval] ETA: ~{eta:.1f} minutes\n")

    done_count  = len(progress)
    start_time  = time.time()
    lock_results = []

    def process(conv):
        cid      = conv["_id"]
        history  = conv["history"]
        message  = conv["message"]
        expected = conv["cts_domain"]
        orig_tok = count_tokens(message) + sum(count_tokens(m["content"]) for m in history)
        cts      = call_cts(history, message)

        if cts is None:
            return dict(id=cid, dataset=conv.get("schema","?"), expected_domain=expected,
                        cts_domain="ERROR", cts_intent="ERROR", cts_state="ERROR",
                        original_tokens=orig_tok, compressed_tokens=orig_tok,
                        tokens_saved=0, reduction_pct=0.0, retention_pct=0.0,
                        domain_correct=False, num_turns=len(history)//2+1, error=True)

        comp_hist     = cts.get("compressedHistory", [])
        comp_tok      = max(1, sum(count_tokens(str(m.get("content",""))) for m in comp_hist))
        saved         = max(0, orig_tok - comp_tok)
        red_pct       = round(saved / orig_tok * 100, 2) if orig_tok > 0 else 0.0
        retention     = compute_retention(history, comp_hist)
        cts_domain    = cts.get("domain", "")
        exp_check     = conv.get("domain", expected) if expected == "mixed" else expected
        correct       = cts_domain == exp_check

        return dict(id=cid, dataset=conv.get("schema","?"), expected_domain=exp_check,
                    cts_domain=cts_domain, cts_intent=cts.get("intent",""),
                    cts_state=cts.get("state",""),
                    original_tokens=orig_tok, compressed_tokens=comp_tok,
                    tokens_saved=saved, reduction_pct=red_pct, retention_pct=retention,
                    domain_correct=correct, num_turns=len(history)//2+1, error=False)

    with ThreadPoolExecutor(max_workers=WORKERS) as executor:
        futures = {executor.submit(process, conv): conv for conv in remaining}
        for future in as_completed(futures):
            row = future.result()
            results.append(row)
            lock_results.append(row)
            progress[row["id"]] = row
            done_count += 1

            # Save progress every 50 completions
            if done_count % 50 == 0:
                save_progress(progress)

            elapsed  = time.time() - start_time
            rate     = done_count / elapsed * 60 if elapsed > 0 else 0
            valid    = [r for r in results if not r["error"]]
            avg_red  = sum(r["reduction_pct"]  for r in valid) / max(1, len(valid))
            avg_ret  = sum(r["retention_pct"]  for r in valid) / max(1, len(valid))
            acc      = sum(1 for r in valid if r["domain_correct"]) / max(1, len(valid)) * 100

            print(f"\r[{done_count:4d}/{total}] {done_count/total*100:5.1f}%  |  "
                  f"{rate:6.0f}/min  |  "
                  f"reduction: {avg_red:5.1f}%  retention: {avg_ret:5.1f}%  acc: {acc:4.1f}%",
                  end="", flush=True)

    save_progress(progress)

    print("\n\n[eval] Complete. Writing results...")
    write_csv(results)
    print_summary(results)

# ── Output ────────────────────────────────────────────────────────────────────

def write_csv(results: list):
    if not results:
        return
    RESULTS_CSV.parent.mkdir(parents=True, exist_ok=True)
    with open(RESULTS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        writer.writeheader()
        writer.writerows(results)
    print(f"[output] {RESULTS_CSV}")

def print_summary(results: list):
    valid = [r for r in results if not r["error"]]
    if not valid:
        return

    orig  = sum(r["original_tokens"]   for r in valid)
    comp  = sum(r["compressed_tokens"] for r in valid)
    saved = sum(r["tokens_saved"]       for r in valid)
    avg   = sum(r["reduction_pct"]      for r in valid) / len(valid)
    ret   = sum(r["retention_pct"]      for r in valid) / len(valid)
    acc   = sum(1 for r in valid if r["domain_correct"]) / len(valid) * 100

    print("\n" + "=" * 76)
    print("  CTS Full Benchmark Summary")
    print("=" * 76)
    print(f"  Conversations       : {len(valid):>8,}")
    print(f"  Original tokens     : {orig:>8,}")
    print(f"  Compressed tokens   : {comp:>8,}")
    print(f"  Tokens saved        : {saved:>8,}")
    print(f"  Avg token reduction : {avg:>7.1f}%")
    print(f"  Avg info retention  : {ret:>7.1f}%   <-- what % of facts survived")
    print(f"  Domain accuracy     : {acc:>7.1f}%")
    print("-" * 76)
    print(f"  {'Domain':18s}  {'Reduction':>10s}  {'Retention':>10s}  {'Acc':>7s}  {'N':>5s}")
    print("-" * 76)

    domains = sorted(set(r["expected_domain"] for r in valid))
    for d in domains:
        rows  = [r for r in valid if r["expected_domain"] == d]
        d_avg = sum(r["reduction_pct"] for r in rows) / len(rows)
        d_ret = sum(r["retention_pct"] for r in rows) / len(rows)
        d_acc = sum(1 for r in rows if r["domain_correct"]) / len(rows) * 100
        print(f"  {d:18s}  {d_avg:>9.1f}%  {d_ret:>9.1f}%  {d_acc:>6.1f}%  {len(rows):>5d}")

    print("=" * 76)
    errs = len(results) - len(valid)
    if errs:
        print(f"  [warn] {errs} errors/timeouts")
    print(f"  CSV -> {RESULTS_CSV}\n")

# ── Entry ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    if "--reset" in sys.argv:
        if PROGRESS_FILE.exists():
            PROGRESS_FILE.unlink()
            print("[reset] Progress cleared.")
    run()
