# -*- coding: utf-8 -*-
"""
CTS T5-small Summarizer — Google Colab Training Script
=======================================================
Run on Google Colab with a free T4 GPU.
Expected training time: ~25-35 minutes on T4.

Steps:
  1. Upload ml/data/t5_teacher_train.jsonl to Colab
  2. Run all cells top to bottom
  3. Download cts_t5/ folder when done
  4. Drop into CTS repo at ml/cts_t5/

CELL 1 — Install dependencies
CELL 2 — Load + split data
CELL 3 — Tokenize
CELL 4 — Train
CELL 5 — Evaluate (ROUGE)
CELL 6 — Export to ONNX
CELL 7 — Sanity test
CELL 8 — Download
"""

# ─────────────────────────────────────────────────────────────────────────────
# CELL 1 — Install dependencies
# ─────────────────────────────────────────────────────────────────────────────
# %%
import subprocess, sys

pkgs = [
    "transformers",
    "datasets",
    "sentencepiece",
    "rouge-score",
    "optimum[onnxruntime]",
    "onnxruntime",
    "accelerate",
]

for pkg in pkgs:
    subprocess.run([sys.executable, "-m", "pip", "install", "-q", pkg], check=False)

print("Dependencies installed.")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 2 — Load + split data
# ─────────────────────────────────────────────────────────────────────────────
# %%
import json
import random
from collections import Counter

# Upload t5_teacher_train.jsonl to Colab before running
JSONL_FILE = "t5_teacher_train.jsonl"
SEED       = 42
VAL_SPLIT  = 0.1   # 10% val

random.seed(SEED)

rows = []
with open(JSONL_FILE, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        # Accept both field name formats
        inp = row.get("input_text") or row.get("input") or ""
        tgt = row.get("target_text") or row.get("target") or ""
        if len(inp) > 10 and len(tgt) > 5:
            rows.append({"input_text": inp, "target_text": tgt, "domain": row.get("domain", "general")})

random.shuffle(rows)
split     = int(len(rows) * (1 - VAL_SPLIT))
train_rows = rows[:split]
val_rows   = rows[split:]

print(f"Total   : {len(rows):,}")
print(f"Train   : {len(train_rows):,}")
print(f"Val     : {len(val_rows):,}")
print(f"\nDomain distribution (train):")
for domain, count in Counter(r["domain"] for r in train_rows).most_common():
    print(f"  {domain:20s}: {count:,}")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 3 — Tokenize
# ─────────────────────────────────────────────────────────────────────────────
# %%
from transformers import T5TokenizerFast
from datasets import Dataset

MODEL_NAME  = "t5-small"
MAX_INPUT   = 512   # full conversation history
MAX_TARGET  = 128   # compact summary (25-90 words fits in 128 tokens)

tokenizer = T5TokenizerFast.from_pretrained(MODEL_NAME)

def tokenize(batch):
    model_inputs = tokenizer(
        batch["input_text"],
        truncation  = True,
        padding     = "max_length",
        max_length  = MAX_INPUT,
    )
    with tokenizer.as_target_tokenizer():
        labels = tokenizer(
            batch["target_text"],
            truncation  = True,
            padding     = "max_length",
            max_length  = MAX_TARGET,
        )
    # Replace padding token id with -100 so loss ignores pad tokens
    label_ids = [
        [(l if l != tokenizer.pad_token_id else -100) for l in label]
        for label in labels["input_ids"]
    ]
    model_inputs["labels"] = label_ids
    return model_inputs

train_dataset = Dataset.from_list(train_rows)
val_dataset   = Dataset.from_list(val_rows)

train_dataset = train_dataset.map(tokenize, batched=True, batch_size=256, remove_columns=["input_text", "target_text", "domain"])
val_dataset   = val_dataset.map(tokenize,   batched=True, batch_size=256, remove_columns=["input_text", "target_text", "domain"])

train_dataset.set_format("torch")
val_dataset.set_format("torch")

print(f"Tokenization done.")
print(f"  Input shape : {train_dataset[0]['input_ids'].shape}")
print(f"  Label shape : {train_dataset[0]['labels'].shape}")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 4 — Train
# ─────────────────────────────────────────────────────────────────────────────
# %%
import numpy as np
from transformers import (
    T5ForConditionalGeneration,
    Seq2SeqTrainingArguments,
    Seq2SeqTrainer,
    DataCollatorForSeq2Seq,
)

model = T5ForConditionalGeneration.from_pretrained(MODEL_NAME)

data_collator = DataCollatorForSeq2Seq(
    tokenizer,
    model   = model,
    padding = True,
)

training_args = Seq2SeqTrainingArguments(
    output_dir                  = "./cts_t5_checkpoints",
    num_train_epochs            = 4,
    per_device_train_batch_size = 16,
    per_device_eval_batch_size  = 32,
    warmup_ratio                = 0.1,
    weight_decay                = 0.01,
    learning_rate               = 5e-4,
    eval_strategy               = "epoch",
    save_strategy               = "epoch",
    load_best_model_at_end      = True,
    metric_for_best_model       = "eval_loss",
    greater_is_better           = False,
    predict_with_generate       = True,
    generation_max_length       = MAX_TARGET,
    fp16                        = True,
    logging_steps               = 50,
    report_to                   = "none",
    seed                        = SEED,
)

trainer = Seq2SeqTrainer(
    model         = model,
    args          = training_args,
    train_dataset = train_dataset,
    eval_dataset  = val_dataset,
    tokenizer     = tokenizer,
    data_collator = data_collator,
)

print("Starting T5-small training...")
print(f"  Model    : {MODEL_NAME}")
print(f"  Epochs   : {training_args.num_train_epochs}")
print(f"  Batch    : {training_args.per_device_train_batch_size}")
print(f"  Train    : {len(train_dataset):,} samples")
print(f"  Val      : {len(val_dataset):,} samples")
print(f"  ETA      : ~25-35 min on T4\n")

trainer.train()

# ─────────────────────────────────────────────────────────────────────────────
# CELL 5 — Evaluate (ROUGE)
# ─────────────────────────────────────────────────────────────────────────────
# %%
import torch
from rouge_score import rouge_scorer

print("Generating summaries on val set for ROUGE evaluation...")

scorer   = rouge_scorer.RougeScorer(["rouge1", "rouge2", "rougeL"], use_stemmer=True)
r1_scores, r2_scores, rL_scores = [], [], []

model.eval()
device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
model.to(device)

# Run on raw val_rows (before tokenization) for readable output
sample_val = val_rows[:200]   # evaluate on 200 examples

for row in sample_val:
    inputs = tokenizer(
        row["input_text"],
        return_tensors = "pt",
        truncation     = True,
        max_length     = MAX_INPUT,
    ).to(device)

    with torch.no_grad():
        output_ids = model.generate(
            **inputs,
            max_new_tokens  = MAX_TARGET,
            num_beams       = 4,
            early_stopping  = True,
        )

    pred   = tokenizer.decode(output_ids[0], skip_special_tokens=True).strip()
    target = row["target_text"].strip()

    scores = scorer.score(target, pred)
    r1_scores.append(scores["rouge1"].fmeasure)
    r2_scores.append(scores["rouge2"].fmeasure)
    rL_scores.append(scores["rougeL"].fmeasure)

print(f"\nROUGE scores (vs teacher targets, n={len(sample_val)}):")
print(f"  ROUGE-1 : {np.mean(r1_scores)*100:.1f}%")
print(f"  ROUGE-2 : {np.mean(r2_scores)*100:.1f}%")
print(f"  ROUGE-L : {np.mean(rL_scores)*100:.1f}%")
print("\n  (Target: ROUGE-L > 40% means the model learned the compression style)")

# Show 3 examples
print("\n── Sample outputs ───────────────────────────────────────")
for row in sample_val[:3]:
    inputs = tokenizer(row["input_text"], return_tensors="pt", truncation=True, max_length=MAX_INPUT).to(device)
    with torch.no_grad():
        ids = model.generate(**inputs, max_new_tokens=MAX_TARGET, num_beams=4)
    pred = tokenizer.decode(ids[0], skip_special_tokens=True).strip()
    print(f"  Domain : {row['domain']}")
    print(f"  Target : {row['target_text'][:120]}")
    print(f"  Pred   : {pred[:120]}")
    print()

# ─────────────────────────────────────────────────────────────────────────────
# CELL 6 — Save + Export to ONNX
# ─────────────────────────────────────────────────────────────────────────────
# %%
import os
from optimum.onnxruntime import ORTModelForSeq2SeqLM

SAVE_DIR = "./cts_t5"
os.makedirs(SAVE_DIR, exist_ok=True)

# Save PyTorch model + tokenizer
trainer.save_model(SAVE_DIR)
tokenizer.save_pretrained(SAVE_DIR)

# Export to ONNX
print("Exporting to ONNX (encoder + decoder)...")
ort_model = ORTModelForSeq2SeqLM.from_pretrained(SAVE_DIR, export=True)
ort_model.save_pretrained(f"{SAVE_DIR}/onnx")
tokenizer.save_pretrained(f"{SAVE_DIR}/onnx")

print(f"\nSaved:")
print(f"  PyTorch model -> {SAVE_DIR}/")
print(f"  ONNX model    -> {SAVE_DIR}/onnx/")

# ─────────────────────────────────────────────────────────────────────────────
# CELL 7 — Sanity test
# ─────────────────────────────────────────────────────────────────────────────
# %%
from transformers import pipeline

summarizer = pipeline(
    "summarization",
    model     = SAVE_DIR,
    tokenizer = tokenizer,
    device    = 0 if torch.cuda.is_available() else -1,
)

TEST_CASES = [
    {
        "domain": "coding",
        "input":  "summarize: DOMAIN:coding User: The Stripe webhook keeps returning 401. I've already verified the endpoint secret. Assistant: Check how you're reading the raw body — express.json() might be consuming it before the HMAC check. User: Oh I think that's it, I have body-parser before the webhook route.",
    },
    {
        "domain": "customer_support",
        "input":  "summarize: DOMAIN:customer_support User: My order #45231 hasn't arrived in 3 weeks. Assistant: I'm sorry, let me look that up. User: I've already called twice and nobody helped. I want a full refund if it's not here by Friday.",
    },
    {
        "domain": "sales",
        "input":  "summarize: DOMAIN:sales User: Your premium plan is too expensive for our team of 5. Assistant: We offer 20% off for startups on annual plans. User: What about SOC2 compliance? Our security team requires it. Assistant: Yes we're SOC2 Type II certified.",
    },
    {
        "domain": "medical",
        "input":  "summarize: DOMAIN:medical User: I've been taking Lisinopril and have a persistent cough. Assistant: That's a known side effect of ACE inhibitors. User: My BP is 140/90, should I stop taking it? Assistant: Don't stop without consulting your doctor.",
    },
]

print("Sanity check — T5 compression outputs:\n")
for tc in TEST_CASES:
    result = summarizer(tc["input"], max_length=80, min_length=15, do_sample=False)[0]["summary_text"]
    print(f"  Domain : {tc['domain']}")
    print(f"  Output : {result}")
    print()

# ─────────────────────────────────────────────────────────────────────────────
# CELL 8 — Download
# ─────────────────────────────────────────────────────────────────────────────
# %%
import shutil
from google.colab import files

shutil.make_archive("cts_t5", "zip", ".", "cts_t5")
files.download("cts_t5.zip")
print("Download started. Unzip into cts/ml/cts_t5/")
