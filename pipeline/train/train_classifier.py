"""
Fine-tune distilbert-base-uncased for CTS domain classification.

8 classes: coding, customer_support, sales, legal, medical, education, commerce, general

Gates:
  - All 8 per-class F1 scores >= 0.80 on validation set
  - Train/val F1 gap <= 0.15 per class (overfitting check via detect_overfit.py)

Outputs:
  models/classifier_<YYYYMMDD_HHMMSS>/   PyTorch checkpoint
  reports/classifier_run_<timestamp>.json  training run report

Usage:
    python -m pipeline.train.train_classifier
"""

import json
import pathlib
import sys
import time
from dataclasses import dataclass, field, asdict
from datetime import datetime
from typing import Optional

# Heavy ML deps — fail with clear message
try:
    import torch
    from torch import nn
    from torch.utils.data import DataLoader, Dataset, WeightedRandomSampler
    from transformers import (
        AutoTokenizer,
        AutoModelForSequenceClassification,
        get_linear_schedule_with_warmup,
    )
    from sklearn.metrics import classification_report
    from sklearn.model_selection import train_test_split
except ImportError as e:
    sys.exit(f"Missing dependency: {e}. Run: pip install -r pipeline/requirements.txt")

_ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(_ROOT))
from pipeline.utils import load_jsonl, write_json, load_config  # noqa: E402

# ── Constants ────────────────────────────────────────────────────────────────

LABEL_NAMES = [
    "coding",
    "customer_support",
    "sales",
    "legal",
    "medical",
    "education",
    "commerce",
    "general",
]
LABEL2IDX = {label: i for i, label in enumerate(LABEL_NAMES)}
IDX2LABEL = {i: label for i, label in enumerate(LABEL_NAMES)}

MIN_F1_PER_CLASS = 0.80
MAX_OVERFIT_GAP = 0.15

MODEL_NAME = "distilbert-base-uncased"


# ── Dataset ──────────────────────────────────────────────────────────────────


class ClassifierDataset(Dataset):
    """PyTorch Dataset wrapping classifier corpus examples."""

    def __init__(self, examples: list, tokenizer, max_len: int = 256) -> None:
        self.examples = examples
        self.tokenizer = tokenizer
        self.max_len = max_len

    def __len__(self) -> int:
        return len(self.examples)

    def __getitem__(self, idx: int) -> dict:
        example = self.examples[idx]
        encoding = self.tokenizer(
            example["text"],
            padding="max_length",
            truncation=True,
            max_length=self.max_len,
            return_tensors="pt",
        )
        return {
            "input_ids": encoding["input_ids"].squeeze(0),
            "attention_mask": encoding["attention_mask"].squeeze(0),
            "labels": torch.tensor(LABEL2IDX[example["label"]], dtype=torch.long),
        }


# ── Class weights ─────────────────────────────────────────────────────────────


def make_class_weights(labels: list) -> torch.Tensor:
    """Compute inverse-frequency class weights.

    Returns a float tensor of shape (n_classes,) where each weight equals
    total / (n_classes * count_for_class).
    """
    n_classes = len(LABEL_NAMES)
    counts = [0] * n_classes
    for lbl in labels:
        counts[lbl] += 1
    total = sum(counts)
    weights = []
    for i in range(n_classes):
        count = counts[i] if counts[i] > 0 else 1  # avoid division by zero
        weights.append(total / (n_classes * count))
    return torch.tensor(weights, dtype=torch.float)


# ── Per-class evaluation ──────────────────────────────────────────────────────


def evaluate_per_class(model, dataloader, device) -> dict:
    """Run inference and return sklearn classification_report as a dict."""
    model.eval()
    all_preds = []
    all_labels = []
    with torch.no_grad():
        for batch in dataloader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            preds = torch.argmax(outputs.logits, dim=-1)
            all_preds.extend(preds.cpu().tolist())
            all_labels.extend(labels.cpu().tolist())

    return classification_report(
        all_labels,
        all_preds,
        target_names=LABEL_NAMES,
        output_dict=True,
        zero_division=0,
    )


# ── Overfitting check ─────────────────────────────────────────────────────────


def check_overfit(train_report: dict, val_report: dict) -> list:
    """Return list of domain names where train/val F1 gap exceeds MAX_OVERFIT_GAP."""
    overfit_domains = []
    for domain in LABEL_NAMES:
        train_f1 = train_report.get(domain, {}).get("f1-score", 0.0)
        val_f1 = val_report.get(domain, {}).get("f1-score", 0.0)
        gap = train_f1 - val_f1
        if gap > MAX_OVERFIT_GAP:
            overfit_domains.append(domain)
    return overfit_domains


# ── Main training function ────────────────────────────────────────────────────


def train_classifier(config: Optional[dict] = None) -> dict:
    """Fine-tune distilbert-base-uncased and return the training run report dict.

    Parameters
    ----------
    config:
        Pipeline configuration dict. If None, loaded from pipeline_config.json.

    Returns
    -------
    dict
        Training run report with fields: timestamp, gate_result,
        per_epoch_metrics, final_val_metrics, final_test_metrics,
        confusion_matrix, hyperparameters, overfit_domains.
    """
    if config is None:
        config = load_config()

    classifier_cfg = config["classifier"]
    paths_cfg = config["paths"]

    batch_size: int = classifier_cfg["batch_size"]
    learning_rate: float = classifier_cfg["learning_rate"]
    num_epochs: int = classifier_cfg["num_epochs"]
    max_seq_len: int = classifier_cfg["max_seq_len"]

    # ── Resolve paths relative to pipeline root ──────────────────────────────
    pipeline_root = pathlib.Path(__file__).resolve().parents[1]
    project_root = pipeline_root.parent
    corpus_path = project_root / paths_cfg["classifier_corpus"]
    reports_dir = project_root / paths_cfg["reports_dir"]
    models_dir = project_root / paths_cfg["models_dir"]

    # ── Load and filter corpus ────────────────────────────────────────────────
    print(f"Loading corpus from {corpus_path} ...")
    examples = [ex for ex in load_jsonl(corpus_path) if ex.get("label") in LABEL2IDX]
    if not examples:
        raise RuntimeError(f"No valid examples found in {corpus_path}")

    print(f"  {len(examples)} examples across {len(LABEL_NAMES)} domains")

    labels_all = [LABEL2IDX[ex["label"]] for ex in examples]

    # ── Stratified 80 / 10 / 10 split ────────────────────────────────────────
    train_examples, temp_examples, train_labels, temp_labels = train_test_split(
        examples,
        labels_all,
        test_size=0.20,
        stratify=labels_all,
        random_state=42,
    )
    val_examples, test_examples, val_labels, test_labels = train_test_split(
        temp_examples,
        temp_labels,
        test_size=0.50,
        stratify=temp_labels,
        random_state=42,
    )

    print(
        f"  Split → train={len(train_examples)}, val={len(val_examples)}, test={len(test_examples)}"
    )

    # ── Tokenizer ─────────────────────────────────────────────────────────────
    print(f"Loading tokenizer: {MODEL_NAME}")
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)

    # ── Datasets ──────────────────────────────────────────────────────────────
    train_dataset = ClassifierDataset(train_examples, tokenizer, max_len=max_seq_len)
    val_dataset = ClassifierDataset(val_examples, tokenizer, max_len=max_seq_len)
    test_dataset = ClassifierDataset(test_examples, tokenizer, max_len=max_seq_len)

    # ── Weighted sampler for balanced batches ─────────────────────────────────
    class_weights = make_class_weights(train_labels)
    sample_weights = [class_weights[lbl].item() for lbl in train_labels]
    sampler = WeightedRandomSampler(
        weights=sample_weights,
        num_samples=len(sample_weights),
        replacement=True,
    )

    train_loader = DataLoader(
        train_dataset,
        batch_size=batch_size,
        sampler=sampler,
    )
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False)
    test_loader = DataLoader(test_dataset, batch_size=batch_size, shuffle=False)

    # ── Model ─────────────────────────────────────────────────────────────────
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loading model: {MODEL_NAME} on {device}")
    model = AutoModelForSequenceClassification.from_pretrained(
        MODEL_NAME, num_labels=len(LABEL_NAMES)
    )
    model.to(device)

    # ── Optimizer and scheduler ───────────────────────────────────────────────
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate)
    total_steps = len(train_loader) * num_epochs
    scheduler = get_linear_schedule_with_warmup(
        optimizer,
        num_warmup_steps=max(1, total_steps // 10),
        num_training_steps=total_steps,
    )

    # Cross-entropy loss with class weights
    class_weights_device = class_weights.to(device)
    loss_fn = nn.CrossEntropyLoss(weight=class_weights_device)

    # ── Training loop ─────────────────────────────────────────────────────────
    per_epoch_metrics: list = []
    last_train_report: dict = {}

    for epoch in range(1, num_epochs + 1):
        model.train()
        epoch_loss = 0.0
        num_batches = 0
        epoch_preds: list = []
        epoch_labels: list = []

        for batch in train_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)

            optimizer.zero_grad()
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            loss = loss_fn(outputs.logits, labels)
            loss.backward()
            torch.nn.utils.clip_grad_norm_(model.parameters(), max_norm=1.0)
            optimizer.step()
            scheduler.step()

            epoch_loss += loss.item()
            num_batches += 1

            preds = torch.argmax(outputs.logits, dim=-1)
            epoch_preds.extend(preds.detach().cpu().tolist())
            epoch_labels.extend(labels.cpu().tolist())

        avg_loss = epoch_loss / max(num_batches, 1)

        # Per-epoch train metrics (for overfitting check)
        last_train_report = classification_report(
            epoch_labels,
            epoch_preds,
            target_names=LABEL_NAMES,
            output_dict=True,
            zero_division=0,
        )

        # Validation metrics
        val_report = evaluate_per_class(model, val_loader, device)

        epoch_entry = {
            "epoch": epoch,
            "train_loss": avg_loss,
            "train_metrics": last_train_report,
            "val_metrics": val_report,
        }
        per_epoch_metrics.append(epoch_entry)

        # Log summary
        val_macro_f1 = val_report.get("macro avg", {}).get("f1-score", 0.0)
        print(
            f"  Epoch {epoch}/{num_epochs} — loss={avg_loss:.4f} val_macro_f1={val_macro_f1:.4f}"
        )
        for domain in LABEL_NAMES:
            f1 = val_report.get(domain, {}).get("f1-score", 0.0)
            marker = " ✗" if f1 < MIN_F1_PER_CLASS else ""
            print(f"    {domain:<20} f1={f1:.4f}{marker}")

    # ── Final evaluation ──────────────────────────────────────────────────────
    print("Running final validation evaluation ...")
    final_val_report = evaluate_per_class(model, val_loader, device)

    print("Running final test evaluation ...")
    final_test_report = evaluate_per_class(model, test_loader, device)

    # ── Gate check ────────────────────────────────────────────────────────────
    failing_domains = [
        domain
        for domain in LABEL_NAMES
        if final_val_report.get(domain, {}).get("f1-score", 0.0) < MIN_F1_PER_CLASS
    ]
    gate_result = "fail" if failing_domains else "pass"

    if gate_result == "fail":
        print("Gate FAILED — domains below 0.80 threshold:")
        for domain in failing_domains:
            f1 = final_val_report.get(domain, {}).get("f1-score", 0.0)
            print(f"  {domain}: f1={f1:.4f}")
    else:
        print("Gate PASSED — all domains ≥ 0.80")

    # ── Overfitting check ─────────────────────────────────────────────────────
    overfit_domains = check_overfit(last_train_report, final_val_report)
    if overfit_domains:
        print(f"WARNING: Overfitting detected for domains: {overfit_domains}")

    # ── Build confusion matrix (val set) ──────────────────────────────────────
    # Collect val predictions for confusion matrix
    model.eval()
    cm_preds: list = []
    cm_labels: list = []
    with torch.no_grad():
        for batch in val_loader:
            input_ids = batch["input_ids"].to(device)
            attention_mask = batch["attention_mask"].to(device)
            labels = batch["labels"].to(device)
            outputs = model(input_ids=input_ids, attention_mask=attention_mask)
            preds = torch.argmax(outputs.logits, dim=-1)
            cm_preds.extend(preds.cpu().tolist())
            cm_labels.extend(labels.cpu().tolist())

    # Build confusion matrix as nested list: cm[true][pred]
    n = len(LABEL_NAMES)
    confusion_matrix = [[0] * n for _ in range(n)]
    for true_lbl, pred_lbl in zip(cm_labels, cm_preds):
        confusion_matrix[true_lbl][pred_lbl] += 1

    # ── Build report ──────────────────────────────────────────────────────────
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    report: dict = {
        "timestamp": timestamp,
        "gate_result": gate_result,
        "failing_domains": failing_domains,
        "per_epoch_metrics": per_epoch_metrics,
        "final_val_metrics": final_val_report,
        "final_test_metrics": final_test_report,
        "confusion_matrix": {
            "labels": LABEL_NAMES,
            "matrix": confusion_matrix,
        },
        "hyperparameters": {
            "model": MODEL_NAME,
            "learning_rate": learning_rate,
            "batch_size": batch_size,
            "num_epochs": num_epochs,
            "max_seq_len": max_seq_len,
        },
        "overfit_domains": overfit_domains,
    }

    # ── Write report ──────────────────────────────────────────────────────────
    reports_dir.mkdir(parents=True, exist_ok=True)
    report_path = reports_dir / f"classifier_run_{timestamp}.json"
    write_json(report_path, report)
    print(f"Report written to {report_path}")

    # ── Save checkpoint (only when gate passes) ───────────────────────────────
    if gate_result == "pass":
        checkpoint_dir = models_dir / f"classifier_{timestamp}"
        checkpoint_dir.mkdir(parents=True, exist_ok=True)
        model.save_pretrained(str(checkpoint_dir))
        tokenizer.save_pretrained(str(checkpoint_dir))
        # Write label_map.json sidecar
        label_map = {str(i): label for i, label in IDX2LABEL.items()}
        write_json(checkpoint_dir / "label_map.json", label_map)
        print(f"Checkpoint saved to {checkpoint_dir}")
    else:
        print("Checkpoint NOT saved (gate failed)")

    return report


# ── Entry point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    train_classifier()
