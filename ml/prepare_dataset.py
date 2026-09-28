# -*- coding: utf-8 -*-
"""
CTS DistilBERT Dataset Preparation
====================================
Run this LOCALLY before uploading to Colab.

Output:
  ml/data/train.csv       -- 80% split, balanced across domains
  ml/data/val.csv         -- 20% split
  ml/data/label_map.json  -- {domain: int_label} mapping

Usage:
  cd C:\\Users\\ASHMITH ATMURI\\Documents\\Codex\\2026-04-29\\cts
  python ml/prepare_dataset.py
"""

import json
import csv
import re
import random
from pathlib import Path
from collections import defaultdict

BASE        = Path(__file__).parent.parent   # cts/ root
OUTPUT_DIR  = Path(__file__).parent / "data"
SAMPLE_PER  = 3_000                          # per domain — sweet spot for Colab T4
SEED        = 42

# Dataset files + their domain label + schema type
# legal skipped (only 5 entries) — merged signals go to general
DATASETS = [
    ("customer_support.json", "customer_support", "instruction_response"),
    ("coding.json",           "coding",           "stackoverflow"),
    ("medical.json",          "medical",          "qa"),
    ("education.json",        "education",        "squad"),
    ("sales.json",            "sales",            "instruction_response"),
    ("commerce.json",         "commerce",         "instruction_response"),
    ("general.json",          "general",          "instruction_response"),
]

LABEL_MAP = {
    "customer_support": 0,
    "coding":           1,
    "medical":          2,
    "education":        3,
    "sales":            4,
    "commerce":         5,
    "general":          6,
}

# ── Text extraction per schema ────────────────────────────────────────────────

def extract_text(item: dict, schema: str) -> str | None:
    """Extract the user-facing text from a dataset entry."""
    try:
        if schema == "instruction_response":
            u = str(item.get("instruction") or item.get("question") or "").strip()
            return u if len(u) > 10 else None

        elif schema == "stackoverflow":
            clean = lambda s: re.sub(r'<[^>]+>', ' ', str(s)).strip()
            title = str(item.get("title") or "").strip()
            body  = clean(item.get("question_body") or "")[:400]
            text  = f"{title} {body}".strip()
            return text if len(text) > 20 else None

        elif schema == "qa":
            u = str(item.get("Question") or item.get("question") or "").strip()
            return u if len(u) > 10 else None

        elif schema == "squad":
            ctx = str(item.get("context") or "")[:300]
            q   = str(item.get("question") or "").strip()
            text = f"{ctx} {q}".strip()
            return text if len(text) > 20 else None

    except Exception:
        pass
    return None

# ── Load dataset file ─────────────────────────────────────────────────────────

def load_texts(filename: str, schema: str, sample: int) -> list[str]:
    path = BASE / filename
    if not path.exists():
        print(f"  [skip] {filename} not found")
        return []

    size_mb = path.stat().st_size / 1_048_576
    print(f"  [load] {filename} ({size_mb:.0f} MB) ...", end=" ", flush=True)

    needed = sample * 6    # read 6x more than needed to allow for filtering
    raws   = []

    try:
        with open(path, encoding="utf-8", errors="replace") as f:
            first = f.read(1); f.seek(0)
            if first == "[":
                data = json.load(f)
                raws = data[:needed]
            elif first == "{":
                data = json.load(f)
                arr  = next((v for v in data.values() if isinstance(v, list)), [])
                raws = arr[:needed]
            else:
                for i, line in enumerate(f):
                    if i >= needed: break
                    try: raws.append(json.loads(line.strip()))
                    except: continue
    except Exception as e:
        print(f"error: {e}")
        return []

    texts = []
    for item in raws:
        t = extract_text(item, schema)
        if t:
            # Truncate to 512 chars — DistilBERT max 512 tokens anyway
            texts.append(t[:512])
        if len(texts) >= needed:
            break

    print(f"{len(texts)} texts extracted")
    return texts

# ── Main ──────────────────────────────────────────────────────────────────────

def run():
    random.seed(SEED)
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

    all_rows = []   # (text, label_int, domain_name)

    for filename, domain, schema in DATASETS:
        print(f"\n[{domain.upper()}]")
        texts = load_texts(filename, schema, SAMPLE_PER)

        if not texts:
            print(f"  [warn] no texts for {domain}")
            continue

        random.shuffle(texts)
        texts = texts[:SAMPLE_PER]
        label = LABEL_MAP[domain]

        for t in texts:
            all_rows.append((t, label, domain))

        print(f"  -> {len(texts)} samples (label={label})")

    # Shuffle everything
    random.shuffle(all_rows)

    # 80/20 train/val split
    split     = int(len(all_rows) * 0.80)
    train     = all_rows[:split]
    val       = all_rows[split:]

    # Write CSVs
    def write_csv(rows, path):
        with open(path, "w", newline="", encoding="utf-8") as f:
            writer = csv.writer(f)
            writer.writerow(["text", "label", "domain"])
            for text, label, domain in rows:
                writer.writerow([text, label, domain])

    train_path = OUTPUT_DIR / "train.csv"
    val_path   = OUTPUT_DIR / "val.csv"
    write_csv(train, train_path)
    write_csv(val,   val_path)

    # Write label map
    label_map_path = OUTPUT_DIR / "label_map.json"
    with open(label_map_path, "w") as f:
        json.dump(LABEL_MAP, f, indent=2)

    # Summary
    from collections import Counter
    train_counts = Counter(r[2] for r in train)
    val_counts   = Counter(r[2] for r in val)

    print("\n" + "=" * 50)
    print("  Dataset prepared")
    print("=" * 50)
    print(f"  Total samples : {len(all_rows):,}")
    print(f"  Train         : {len(train):,}")
    print(f"  Val           : {len(val):,}")
    print(f"  Labels        : {len(LABEL_MAP)} domains")
    print()
    print(f"  {'Domain':20s}  {'Train':>6s}  {'Val':>5s}")
    print("-" * 36)
    for domain in LABEL_MAP:
        print(f"  {domain:20s}  {train_counts.get(domain,0):>6d}  {val_counts.get(domain,0):>5d}")
    print("=" * 50)
    print(f"\n  train.csv  -> {train_path}")
    print(f"  val.csv    -> {val_path}")
    print(f"  label_map  -> {label_map_path}")
    print("\n  Next: upload ml/data/ folder to Google Colab and run train_colab.py")

if __name__ == "__main__":
    run()
