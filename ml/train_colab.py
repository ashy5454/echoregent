# -*- coding: utf-8 -*-
"""
CTS DistilBERT Classifier — Google Colab Training Script
==========================================================
Run on Google Colab with a free T4 GPU.
Expected training time: ~35 minutes on T4.

Steps:
  1. Upload ml/data/train.csv, ml/data/val.csv, ml/data/label_map.json to Colab
  2. Run all cells top to bottom
  3. Download cts_classifier/ folder when done
  4. Drop into CTS repo at ml/cts_classifier/

CELL 1 — Install dependencies
CELL 2 — Load data
CELL 3 — Tokenize
CELL 4 — Train
CELL 5 — Evaluate
CELL 6 — Export to ONNX
CELL 7 — Test the exported model
"""

# ─────────────────────────────────────────────────────────────────────────────
# CELL 1 — Install dependencies
# ─────────────────────────────────────────────────────────────────────────────
# %%
import subprocess, sys

pkgs = [
    "transformers",
    "datasets",
    "scikit-learn",
    "optimum[onnxruntime]",
    "onnxruntime",
    "accelerate",
]

for pkg in pkgs:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", pkg], check=False)

print("Dependencies installed.")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 2 — Load data
# ─────────────────────────────────────────────────────────────────────────────
# %%
import json
import pandas as pd
from collections import Counter

# Upload these files to Colab before running:
# train.csv, val.csv, label_map.json

train_df    = pd.read_csv("train.csv")
val_df      = pd.read_csv("val.csv")
label_map   = json.load(open("label_map.json"))
id2label    = {v: k for k, v in label_map.items()}
num_labels  = len(label_map)

print(f"Train: {len(train_df):,} samples")
print(f"Val:   {len(val_df):,} samples")
print(f"Labels ({num_labels}):", label_map)
print("\nTrain distribution:")
for domain, count in Counter(train_df["domain"]).most_common():
    print(f"  {domain:20s}: {count:,}")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 3 — Tokenize
# ─────────────────────────────────────────────────────────────────────────────
# %%
from transformers import DistilBertTokenizerFast
from datasets import Dataset

MODEL_NAME = "distilbert-base-uncased"
MAX_LENGTH = 128    # 128 is fast + accurate enough for domain classification
                    # domain signal is in the first ~80 tokens anyway

tokenizer = DistilBertTokenizerFast.from_pretrained(MODEL_NAME)

def tokenize(batch):
    return tokenizer(
        batch["text"],
        truncation=True,
        padding="max_length",
        max_length=MAX_LENGTH,
    )

train_dataset = Dataset.from_pandas(train_df[["text", "label"]])
val_dataset   = Dataset.from_pandas(val_df[["text", "label"]])

train_dataset = train_dataset.map(tokenize, batched=True, batch_size=256)
val_dataset   = val_dataset.map(tokenize,   batched=True, batch_size=256)

train_dataset.set_format("torch", columns=["input_ids", "attention_mask", "label"])
val_dataset.set_format("torch",   columns=["input_ids", "attention_mask", "label"])

print(f"Tokenization done. Sample shape: {train_dataset[0]['input_ids'].shape}")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 4 — Train
# ─────────────────────────────────────────────────────────────────────────────
# %%
import numpy as np
from transformers import (
    DistilBertForSequenceClassification,
    TrainingArguments,
    Trainer,
)
from sklearn.metrics import accuracy_score, classification_report

model = DistilBertForSequenceClassification.from_pretrained(
    MODEL_NAME,
    num_labels=num_labels,
    id2label=id2label,
    label2id=label_map,
)

def compute_metrics(eval_pred):
    logits, labels = eval_pred
    preds = np.argmax(logits, axis=-1)
    return {"accuracy": accuracy_score(labels, preds)}

training_args = TrainingArguments(
    output_dir              = "./cts_classifier_checkpoints",
    num_train_epochs        = 4,
    per_device_train_batch_size = 32,
    per_device_eval_batch_size  = 64,
    warmup_ratio            = 0.1,
    weight_decay            = 0.01,
    learning_rate           = 2e-5,
    eval_strategy           = "epoch",        # renamed from evaluation_strategy in transformers>=4.41
    save_strategy           = "epoch",
    load_best_model_at_end  = True,
    metric_for_best_model   = "accuracy",
    greater_is_better       = True,
    logging_steps           = 100,
    fp16                    = True,
    report_to               = "none",
    seed                    = 42,
)

trainer = Trainer(
    model           = model,
    args            = training_args,
    train_dataset   = train_dataset,
    eval_dataset    = val_dataset,
    compute_metrics = compute_metrics,
)

print("Starting training...")
print(f"  Model    : {MODEL_NAME}")
print(f"  Epochs   : {training_args.num_train_epochs}")
print(f"  Batch    : {training_args.per_device_train_batch_size}")
print(f"  Max len  : {MAX_LENGTH} tokens")
print(f"  Training : {len(train_dataset):,} samples")
print(f"  Val      : {len(val_dataset):,} samples")
print(f"  ETA      : ~30-40 min on T4\n")

trainer.train()

# ─────────────────────────────────────────────────────────────────────────────
# CELL 5 — Evaluate
# ─────────────────────────────────────────────────────────────────────────────
# %%
import torch

print("Evaluating best model on validation set...\n")

predictions = trainer.predict(val_dataset)
preds       = np.argmax(predictions.predictions, axis=-1)
labels      = predictions.label_ids

overall_acc = accuracy_score(labels, preds)
print(f"Overall accuracy: {overall_acc*100:.2f}%\n")

report = classification_report(
    labels, preds,
    target_names=[id2label[i] for i in range(num_labels)],
    digits=3,
)
print(report)

# Per-class confidence check
print("Confidence distribution (should be >0.85 for most classes):")
probs = torch.softmax(torch.tensor(predictions.predictions), dim=-1).numpy()
for i, domain in id2label.items():
    mask        = labels == i
    if mask.sum() == 0: continue
    avg_conf    = probs[mask, i].mean()
    domain_acc  = accuracy_score(labels[mask], preds[mask])
    print(f"  {domain:20s}  acc={domain_acc*100:.1f}%  avg_conf={avg_conf:.3f}")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 6 — Save + Export to ONNX
# ─────────────────────────────────────────────────────────────────────────────
# %%
import os
from optimum.onnxruntime import ORTModelForSequenceClassification

SAVE_DIR = "./cts_classifier"
os.makedirs(SAVE_DIR, exist_ok=True)

# Save PyTorch model + tokenizer
trainer.save_model(SAVE_DIR)
tokenizer.save_pretrained(SAVE_DIR)

# Save label map
with open(f"{SAVE_DIR}/label_map.json", "w") as f:
    json.dump(label_map, f, indent=2)

# Export to ONNX — needed for Node.js integration via @xenova/transformers
print("Exporting to ONNX...")
ort_model = ORTModelForSequenceClassification.from_pretrained(
    SAVE_DIR,
    export=True,
)
ort_model.save_pretrained(f"{SAVE_DIR}/onnx")
tokenizer.save_pretrained(f"{SAVE_DIR}/onnx")

print(f"\nSaved:")
print(f"  PyTorch model  -> {SAVE_DIR}/")
print(f"  ONNX model     -> {SAVE_DIR}/onnx/model.onnx")
print(f"  Tokenizer      -> {SAVE_DIR}/onnx/")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 7 — Quick sanity test
# ─────────────────────────────────────────────────────────────────────────────
# %%
from transformers import pipeline

clf = pipeline(
    "text-classification",
    model     = SAVE_DIR,
    tokenizer = tokenizer,
    device    = 0 if torch.cuda.is_available() else -1,
)

TEST_CASES = [
    ("I'm getting a 401 error when calling the Stripe API with my webhook signature", "coding"),
    ("My order #12345 never arrived and I need a refund please", "customer_support"),
    ("What is the Calvin cycle in photosynthesis?", "education"),
    ("We have a budget of $50k for Q3, can you match Salesforce pricing?", "sales"),
    ("I've been having chest pain and shortness of breath for two days", "medical"),
    ("I'm looking for a laptop under $1200 with good battery life", "commerce"),
    ("Can you help me write an email to my team about the delayed launch?", "general"),
]

print("Sanity check — model predictions:\n")
print(f"  {'Text (truncated)':55s}  {'Expected':16s}  {'Predicted':16s}  {'Conf':>6s}  OK?")
print("-" * 110)
correct = 0
for text, expected in TEST_CASES:
    result    = clf(text[:200], truncation=True)[0]
    predicted = result["label"]
    conf      = result["score"]
    ok        = "YES" if predicted == expected else "NO "
    if predicted == expected: correct += 1
    print(f"  {text[:55]:55s}  {expected:16s}  {predicted:16s}  {conf:.3f}  {ok}")

print(f"\n  Sanity accuracy: {correct}/{len(TEST_CASES)} ({correct/len(TEST_CASES)*100:.0f}%)")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 8 — Download (zip and download from Colab)
# ─────────────────────────────────────────────────────────────────────────────
# %%
import shutil
from google.colab import files

shutil.make_archive("cts_classifier", "zip", ".", "cts_classifier")
files.download("cts_classifier.zip")
print("Download started. Unzip into cts/ml/cts_classifier/")
