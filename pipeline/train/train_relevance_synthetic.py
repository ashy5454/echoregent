"""
Fine-tune all-MiniLM-L6-v2 on synthetic relevance triplets.

The production relevance scorer (src/cts-core/ml-relevance.ts) asks one
question: given the in-flight user query, which history turn carries the fact
needed to answer it? This script trains that bi-encoder on the synthetic
conversations produced by pipeline/data/build_synthetic_relevance.py.

It reports a held-out retrieval accuracy before and after fine-tuning, so the
gain is measured rather than assumed. A hard-negative share keeps the model
from learning the shortcut "same domain = relevant".

Usage:
    python -m pipeline.train.train_relevance_synthetic --epochs 2 --batch-size 32
"""

import argparse
import json
import pathlib
import sys
import time
from datetime import datetime

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))

DATA_DIR = _ROOT / "pipeline" / "data" / "synthetic_relevance"
MODELS_DIR = _ROOT / "models"
REPORTS_DIR = _ROOT / "reports"


def load_jsonl(path: pathlib.Path) -> list:
    rows = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                rows.append(json.loads(line))
    return rows


def evaluate(model, rows: list) -> dict:
    """Positive-vs-negative retrieval accuracy, overall and per domain."""
    if not rows:
        return {"accuracy": None, "margin": None, "per_domain": {}, "count": 0}

    queries = model.encode([r["query"] for r in rows], batch_size=64, normalize_embeddings=True)
    positives = model.encode([r["positive"] for r in rows], batch_size=64, normalize_embeddings=True)
    negatives = model.encode([r["negative"] for r in rows], batch_size=64, normalize_embeddings=True)

    correct = 0
    margin = 0.0
    per_domain = {}
    for index, row in enumerate(rows):
        pos = float((queries[index] * positives[index]).sum())
        neg = float((queries[index] * negatives[index]).sum())
        hit = pos > neg
        correct += int(hit)
        margin += pos - neg
        bucket = per_domain.setdefault(row.get("domain", "unknown"), {"correct": 0, "count": 0})
        bucket["correct"] += int(hit)
        bucket["count"] += 1

    return {
        "accuracy": correct / len(rows),
        "margin": margin / len(rows),
        "count": len(rows),
        "per_domain": {
            domain: bucket["correct"] / bucket["count"]
            for domain, bucket in sorted(per_domain.items())
        },
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base-model", default="sentence-transformers/all-MiniLM-L6-v2")
    parser.add_argument("--epochs", type=int, default=2)
    parser.add_argument("--batch-size", type=int, default=32)
    parser.add_argument("--max-train", type=int, default=0, help="0 = all")
    args = parser.parse_args()

    try:
        from sentence_transformers import SentenceTransformer, InputExample, losses
        from torch.utils.data import DataLoader
    except ImportError as exc:
        print(f"Missing dependency: {exc}")
        print("Run: python -m pip install -r pipeline/requirements.txt")
        return 2

    train_path = DATA_DIR / "train.jsonl"
    val_path = DATA_DIR / "val.jsonl"
    if not train_path.exists() or not val_path.exists():
        print(f"Missing synthetic data in {DATA_DIR}. Run pipeline/data/build_synthetic_relevance.py first.")
        return 2

    train_rows = load_jsonl(train_path)
    val_rows = load_jsonl(val_path)
    if args.max_train > 0:
        train_rows = train_rows[: args.max_train]

    started = time.time()
    print(f"Loading base model {args.base_model} ...")
    model = SentenceTransformer(args.base_model)

    before = evaluate(model, val_rows)
    print(f"Baseline held-out accuracy: {before['accuracy']:.3f} (margin {before['margin']:+.3f})")

    examples = [InputExample(texts=[row["query"], row["positive"]]) for row in train_rows]
    loader = DataLoader(examples, shuffle=True, batch_size=args.batch_size)
    loss = losses.MultipleNegativesRankingLoss(model)

    print(f"Fine-tuning on {len(examples)} pairs for {args.epochs} epoch(s) ...")
    model.fit(
        train_objectives=[(loader, loss)],
        epochs=args.epochs,
        warmup_steps=max(1, int(len(loader) * args.epochs * 0.1)),
        show_progress_bar=True,
    )

    after = evaluate(model, val_rows)
    print(f"Fine-tuned held-out accuracy: {after['accuracy']:.3f} (margin {after['margin']:+.3f})")

    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    model_dir = MODELS_DIR / f"relevance_synthetic_{stamp}"
    model.save(str(model_dir))

    report = {
        "model_name": "cts_relevance_synthetic",
        "timestamp": stamp,
        "base_model": args.base_model,
        "train_pairs": len(examples),
        "epochs": args.epochs,
        "batch_size": args.batch_size,
        "duration_seconds": round(time.time() - started, 1),
        "baseline": before,
        "fine_tuned": after,
        "accuracy_delta": (after["accuracy"] - before["accuracy"]) if before["accuracy"] is not None else None,
        "model_dir": str(model_dir.relative_to(_ROOT)),
    }
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORTS_DIR / f"relevance_synthetic_{stamp}.json"
    report_path.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(f"Saved model to {model_dir}")
    print(f"Report: {report_path}")

    return 0 if after["accuracy"] is not None and after["accuracy"] >= before["accuracy"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
