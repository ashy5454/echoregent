# -*- coding: utf-8 -*-
"""
CTS T5 Summarizer — Dataset Preparation
=========================================
Converts existing CTS domain datasets into (input, target) pairs
for fine-tuning a T5-small summarization model.

Strategy per dataset:
  coding        → input: question_body (long messy SO post)
                  target: title (short clean summary) ← PERFECT natural pair
  customer_support, sales, commerce, general
                → input: "DOMAIN:{domain}\nUser: {instruction}\nAssistant: {response}"
                  target: instruction  (clean statement of what user wants)
  medical       → input: "DOMAIN:medical\nQuestion: {Q}\nAnswer: {A}"
                  target: Question

Output:
  ml/data/t5_train.jsonl   — 80% split
  ml/data/t5_val.jsonl     — 20% split

Each line: {"input_text": "...", "target_text": "..."}

Usage:
  cd <cts root>
  python ml/prepare_t5_dataset.py
"""

import json
import re
import random
from pathlib import Path

BASE       = Path(__file__).parent.parent   # cts/ root
OUTPUT_DIR = Path(__file__).parent / "data"
SEED       = 42

# How many pairs to sample per domain
SAMPLES = {
    "coding":           5_000,   # huge dataset — cap at 5k
    "customer_support": 2_000,
    "medical":          1_000,
    "sales":            1_500,
    "commerce":         1_500,
    "general":          2_000,
}

# ── Helpers ───────────────────────────────────────────────────────────────────

def strip_html(text: str) -> str:
    """Remove HTML tags and collapse whitespace."""
    text = re.sub(r'<[^>]+>', ' ', text)
    text = re.sub(r'\s+', ' ', text)
    return text.strip()

def clean(text: str, max_len: int = 600) -> str:
    return strip_html(str(text or '')).strip()[:max_len]

def t5_input(domain: str, body: str) -> str:
    """Prepend T5 task prefix + domain tag."""
    return f"summarize: DOMAIN:{domain} {body}"

# ── Per-schema extractors ─────────────────────────────────────────────────────

def pairs_coding(path: Path, n: int) -> list[dict]:
    """Stack Overflow: question_body → title."""
    pairs = []
    needed = n * 4   # read more, filter bad ones
    with open(path, encoding='utf-8', errors='replace') as f:
        first = f.read(1); f.seek(0)
        if first == '[':
            items = json.load(f)[:needed]
        else:
            items = []
            for i, line in enumerate(f):
                if i >= needed: break
                try: items.append(json.loads(line.strip()))
                except: continue

    for item in items:
        title = clean(item.get('title', ''), 120)
        body  = clean(item.get('question_body', ''), 600)
        if len(title) < 10 or len(body) < 30:
            continue
        pairs.append({
            "input_text":  t5_input("coding", body),
            "target_text": title,
        })
        if len(pairs) >= n:
            break

    return pairs


def pairs_instruction_response(path: Path, domain: str, n: int) -> list[dict]:
    """instruction + response → instruction (instruction IS the clean summary)."""
    pairs = []
    needed = n * 4
    with open(path, encoding='utf-8', errors='replace') as f:
        first = f.read(1); f.seek(0)
        if first == '[':
            items = json.load(f)[:needed]
        else:
            items = []
            for i, line in enumerate(f):
                if i >= needed: break
                try: items.append(json.loads(line.strip()))
                except: continue

    for item in items:
        instr    = clean(item.get('instruction', '') or item.get('question', ''), 200)
        response = clean(item.get('response', '') or item.get('answer', ''), 300)
        if len(instr) < 15 or len(response) < 10:
            continue
        body = f"User: {instr} Assistant: {response}"
        pairs.append({
            "input_text":  t5_input(domain, body),
            "target_text": instr[:150],
        })
        if len(pairs) >= n:
            break

    return pairs


def pairs_medical(path: Path, n: int) -> list[dict]:
    """Question + Answer → Question."""
    pairs = []
    needed = n * 4
    with open(path, encoding='utf-8', errors='replace') as f:
        first = f.read(1); f.seek(0)
        if first == '[':
            items = json.load(f)[:needed]
        else:
            items = []
            for i, line in enumerate(f):
                if i >= needed: break
                try: items.append(json.loads(line.strip()))
                except: continue

    for item in items:
        q = clean(item.get('Question', '') or item.get('question', ''), 200)
        a = clean(item.get('Answer', '') or item.get('answer', ''), 300)
        if len(q) < 10 or len(a) < 10:
            continue
        body = f"Question: {q} Answer: {a}"
        pairs.append({
            "input_text":  t5_input("medical", body),
            "target_text": q[:150],
        })
        if len(pairs) >= n:
            break

    return pairs

# ── Main ──────────────────────────────────────────────────────────────────────

def run():
    random.seed(SEED)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_pairs: list[dict] = []

    # coding — stackoverflow pairs (the best training signal)
    path = BASE / "coding.json"
    if path.exists():
        print(f"[coding]  loading {SAMPLES['coding']:,} pairs from stackoverflow...")
        p = pairs_coding(path, SAMPLES["coding"])
        print(f"  → {len(p):,} pairs")
        all_pairs.extend(p)
    else:
        print("[coding]  coding.json not found, skipping")

    # instruction_response domains
    for domain in ("customer_support", "sales", "commerce", "general"):
        fname = f"{domain}.json"
        path  = BASE / fname
        if not path.exists():
            print(f"[{domain}]  {fname} not found, skipping")
            continue
        n = SAMPLES[domain]
        print(f"[{domain}]  loading {n:,} pairs...")
        p = pairs_instruction_response(path, domain, n)
        print(f"  → {len(p):,} pairs")
        all_pairs.extend(p)

    # medical
    path = BASE / "medical.json"
    if path.exists():
        print(f"[medical]  loading {SAMPLES['medical']:,} pairs...")
        p = pairs_medical(path, SAMPLES["medical"])
        print(f"  → {len(p):,} pairs")
        all_pairs.extend(p)
    else:
        print("[medical]  medical.json not found, skipping")

    # Shuffle and split
    random.shuffle(all_pairs)
    split      = int(len(all_pairs) * 0.8)
    train      = all_pairs[:split]
    val        = all_pairs[split:]

    # Write JSONL
    train_path = OUTPUT_DIR / "t5_train.jsonl"
    val_path   = OUTPUT_DIR / "t5_val.jsonl"

    with open(train_path, "w", encoding="utf-8") as f:
        for row in train:
            f.write(json.dumps(row) + "\n")

    with open(val_path, "w", encoding="utf-8") as f:
        for row in val:
            f.write(json.dumps(row) + "\n")

    print("\n" + "=" * 50)
    print("  T5 dataset prepared")
    print("=" * 50)
    print(f"  Total pairs : {len(all_pairs):,}")
    print(f"  Train       : {len(train):,}")
    print(f"  Val         : {len(val):,}")
    print(f"\n  t5_train.jsonl → {train_path}")
    print(f"  t5_val.jsonl   → {val_path}")
    print("\n  Next: upload ml/data/t5_train.jsonl + t5_val.jsonl to Colab")
    print("        and run ml/train_t5_colab.py")

    # Show 2 sample pairs
    print("\n── Sample pairs ──────────────────────────────────────")
    for row in all_pairs[:2]:
        print(f"  INPUT : {row['input_text'][:120]}...")
        print(f"  TARGET: {row['target_text']}")
        print()

if __name__ == "__main__":
    run()
