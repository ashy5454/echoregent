# ML Retrain Guide — Datasets, Architectures, Fine-Tuning

This is the concrete engineering reference for retraining CTS's model stack from scratch,
following the direction set in the "CTS ML Stack Rebuild Plan" doc from this session. It names
real, verified Hugging Face datasets and model checkpoints (checked live, not from memory) —
where a real public dataset doesn't exist for a domain, that's stated plainly rather than
invented.

Three real problems from this session motivate every choice below:

1. The old classifier's training data was wildly imbalanced (5,000 coding examples vs. 400
   medical vs. 5 legal) and it silently learned to guess "coding" when unsure. **Fix: balanced
   counts per domain, enforced, not assumed.**
2. The old T5 compressor's generated text has no spaces between words — a broken model that
   never threw an exception. **Fix: don't rebuild a generative summarizer at all; build a
   retrieval/relevance model instead, the same shape as the Gemini-embeddings path already
   shipped and already measured at F1 0.213 vs. regex's 0.105.**
3. Two "fixed" re-exports of the broken T5 model use an ONNX IR version this stack's runtime
   can't load. **Fix: pin the export toolchain version before training anything.**

---

## Model 1 — Domain/Intent/Risk Classifier

**Job**: given the current message + history, output domain (coding / customer_support / sales
/ legal / medical / education / commerce / general), intent, and risk flags. Replaces the
existing `cts_classifier` (DistilBERT fine-tune) — same base model, retrained on balanced,
real data with per-class evaluation enforced.

**Base checkpoint**: [`distilbert-base-uncased`](https://huggingface.co/distilbert/distilbert-base-uncased)
— unchanged from the original. 66M parameters, already proven to load and run fast in this
stack's `@xenova/transformers` ONNX runtime (confirmed working this session — 99.7% confidence
on a clean example). The problem was never the architecture; it was the data.

**Datasets per domain** (real, verified on Hugging Face just now):

| Domain | Dataset | Size | Notes |
| --- | --- | --- | --- |
| Coding | [`code-search-net/code_search_net`](https://huggingface.co/datasets/code-search-net/code_search_net) | 2M comment/code pairs | Sample down to ~2,500 — using all 2M would recreate the old imbalance in reverse |
| Customer support | [`bitext/Bitext-customer-support-llm-chatbot-training-dataset`](https://huggingface.co/datasets/bitext/Bitext-customer-support-llm-chatbot-training-dataset) | 26,872 examples, 27 intents | Purpose-built for exactly this; well-labeled |
| Legal | [`theatticusproject/cuad-qa`](https://huggingface.co/datasets/theatticusproject/cuad-qa) | 13,000+ labeled clauses, 510 contracts | Real, expert-annotated (Atticus Project, supervised by practicing attorneys) — this is what the old training set only had **5** examples of |
| Medical | [`qiaojin/PubMedQA`](https://huggingface.co/datasets/qiaojin/PubMedQA) | 1k expert-labeled + 211k generated | Use the 1k expert-labeled (PQA-L) split for quality over the old set's 400 |
| Education | [`rajpurkar/squad`](https://huggingface.co/datasets/rajpurkar/squad) | 100k+ QA pairs | Same source as before, keep |
| Commerce | [`embedding-data/Amazon-QA`](https://huggingface.co/datasets/embedding-data/Amazon-QA) | Query/answer pairs | Already formatted as query + positive pairs, useful for Model 2 too |
| General / mixed | [`pfb30/multi_woz_v22`](https://huggingface.co/datasets/pfb30/multi_woz_v22) | Multi-domain task dialogues | Use the non-domain-specific slices (attraction, general chat) |
| Sales | *No strong public dataset found.* | — | Generate synthetic examples, keep the set small (~1,000), label them explicitly as synthetic in the training manifest so this is never silently mistaken for real coverage later |

**Target**: ~2,000–2,500 examples per domain. Downsample coding and customer_support, upsample
legal and medical relative to the old set. This alone fixes the root cause of the bias found
this session.

**Fine-tuning recipe**:
- Library: `transformers` (`AutoModelForSequenceClassification`), same as before.
- **Stratified sampling enforced in the training script itself** — not left to chance. Use
  `sklearn.model_selection.train_test_split(..., stratify=labels)` or a weighted `WeightedRandomSampler`
  so no epoch can silently over-represent one class.
- Loss: standard cross-entropy, but with `class_weight` inversely proportional to class
  frequency as a second safeguard on top of balanced sampling.
- Hyperparameters (standard DistilBERT fine-tune, no exotic tuning needed): batch size 16–32,
  learning rate 2e-5–5e-5, 3–5 epochs, max sequence length 256.
- **Evaluation**: report per-class precision/recall/F1 every epoch, not just aggregate accuracy.
  Aggregate accuracy is exactly the metric that hid the coding bias last time — a model that's
  99% accurate on coding and 40% on legal can still show ~85% aggregate and look fine.
- **Gate**: no domain below 80% per-class accuracy before export.

---

## Model 2 — Relevance/Compression Scorer (replaces T5)

**Job**: given the current query and a candidate message from history, score how relevant that
message is — the actual job the compressor needs, and the one T5's broken abstractive
summarization was never well-suited to. This is the same shape as the Gemini-embeddings path
already shipped this session, made self-hostable instead of a per-request paid API call.

**Base checkpoint**: [`sentence-transformers/all-MiniLM-L6-v2`](https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2)
— 22.7M parameters, already a real, widely-used sentence encoder, small enough to run per-request
without meaningful latency. This is a *fine-tune*, not a from-scratch train — it already has strong
general sentence-similarity behavior; the fine-tune specializes it for "does this message answer
this query" specifically.

**Training data — this is the important part**: classification-shaped datasets are the wrong
shape for this job. What's needed is (query, relevant passage, irrelevant passage) triplets.
Real sources:

- **LoCoMo** (already downloaded this session, real, public long-conversation dataset) — its
  `evidence` field names exactly which turns support each answer. Build positives from
  `(question, evidence turn)` pairs and negatives from other turns in the same conversation.
  This is direct, real supervision for the exact task, already validated informally this
  session (the Gemini-embeddings path scored F1 0.213 on this exact data using the same idea
  without any fine-tuning at all — a fine-tuned model starting from that baseline should do
  better, not worse).
- [`embedding-data/Amazon-QA`](https://huggingface.co/datasets/embedding-data/Amazon-QA) — already
  in the right (query, positive) shape, useful as general retrieval pretraining before the
  LoCoMo-specific fine-tune.

**Fine-tuning recipe**:
- Library: `sentence-transformers` (the same library `all-MiniLM-L6-v2` was originally trained
  with — confirmed it directly supports fine-tuning and reranker training).
- Loss: `MultipleNegativesRankingLoss` — the standard sentence-transformers contrastive loss for
  exactly this "which passage answers this query" shape (confirmed real fine-tunes of this exact
  base model with this exact loss exist publicly).
- Data format: `InputExample(texts=[query, positive_passage, negative_passage])` — or just
  `[query, positive]` and let in-batch negatives do the rest, which is the more common recipe and
  needs less hand-labeling of explicit negatives.
- Hyperparameters: batch size 32–64 (bigger batches help in-batch-negative losses), learning rate
  2e-5, 1–3 epochs — sentence-transformer fine-tunes overfit fast on small specialized data, watch
  the eval loss.
- **Evaluation**: real downstream LoCoMo QA test (the methodology already built this session —
  `audit/notes/locomo_eval_embeddings.ts` and `comprehensive_eval.ts`), not just embedding
  cosine-similarity sanity checks.
- **Gate**: must beat F1 0.213 (the current shipped Gemini-embeddings result) at equal or better
  token reduction before it replaces anything in production. "Better than regex" is not the bar —
  regex is already the fallback, not the target.

---

## Model 3 — MiniLM semantic cache

Weights already exist on the `ml-models` branch (same base, `all-MiniLM-L6-v2`, already
downloaded and quantized in several variants this session) and were never actually exercised.
Before any retraining effort here: run it once, confirm cache hit-rate behavior on real traffic
patterns, and decide if a fine-tune is even needed — it may work fine as-is for a cache
similarity check, which is a coarser task than the relevance scorer above.

---

## Infrastructure — fix this before training anything

The two "fixed" T5 re-exports found this session (`onnx_fixed`, `onnx_fixed14`) both use ONNX
IR version 9; this stack's `onnxruntime-node` only loads up to IR version 8. Before exporting
any retrained model:

```bash
# Check what opset/IR version your export tool produces
python -m optimum.exporters.onnx --model <checkpoint> --task <task> out/ --opset 14
# Verify the exported IR version explicitly before treating it as usable
python -c "import onnx; m = onnx.load('out/model.onnx'); print('IR version:', m.ir_version)"
```

Pin the export tool version (or upgrade `onnxruntime-node` in this repo and test that
upgrade deliberately) so IR version 8 or lower is guaranteed. Add a one-line sanity check to
every export step: feed one canned input, confirm the decoded output isn't degenerate, **before**
pushing the artifact to the `ml-models` branch. This alone would have caught the T5 defect
before it ever shipped.

## Compute

Colab is sufficient for both models — DistilBERT-scale classifier fine-tuning and a 22.7M-parameter
sentence-encoder fine-tune are both well within free-tier Colab GPU budgets (a T4 handles either in
under an hour of actual training time; the real time cost is data prep and evaluation iteration,
not GPU time).

## Distribution

Keep using the `ml-models` branch + Git LFS — confirmed working this session (1.3GB pulled
cleanly once `git-lfs` was installed). No need to build a new distribution mechanism.
