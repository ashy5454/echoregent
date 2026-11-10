# EchoRegent local models and latency — 21 October 2026

The requested 30 ms p95 budget is **not reliably achieved**. Short coding histories varied around the threshold; the latest final run failed at 30.24 ms. Long messages also failed. All changes and weights are local in `E:\echoregent`; pre-existing changes were preserved.

| Scenario | Latest p95 | Target |
| --- | ---: | ---: |
| Compact classifier, unique queries | 0.02 ms | <15 ms |
| Semantic cache, unique queries | 2.47 ms | <8 ms |
| Relevance, 20 fresh short messages | 27.66 ms | <35 ms |
| Full preprocessing, 40 fresh short messages | 30.24 ms | <30 ms — failed |
| Cached history, unique current query | 9.74 ms | <30 ms |
| Full preprocessing, 40 fresh long messages | 73.05 ms | <30 ms — failed |

Short fixture: roughly 140 characters per turn. Long fixture: roughly 1,000 characters (~200 tokens) per turn. Each scenario uses 10 warmups and 100 timed requests. Fresh histories use distinct contents; cache hits and embedding reuse are measured separately. Aggregate timing includes classification, context-scoped cache lookup, neural compression, exact BPE token accounting and JSON serialization. It excludes process/model startup, HTTP transport, databases, wiki loading and upstream LLM generation. Long-query cache requests safely bypass caching, while relevance embeds the first 512 characters. Windows scheduling and thermal state affect results; these are measurements, not a service guarantee.

Evidence: `model_latency_1792539021397.json` (latest short after final review fixes), `model_latency_1792538734750.json` (previous short: 29.81 ms), `model_latency_1792538630857.json` (previous short: 29.99 ms), `model_latency_1792538650656.json` (long). Earlier final-runtime short measurements were 27.93 and 28.82 ms. These passes do not override the latest failure. Every timed run requires all three models loaded; inference failures must fail the benchmark.

## Weights and provenance

- **Relevance:** preserved `models/relevance_synthetic_20261020_040034`. Exported eager-attention MiniLM with per-channel int8 weights, masked mean pooling and normalization. This is the locally trained checkpoint, not newly invented weights.
- **Cache:** documented `sentence-transformers/all-MiniLM-L6-v2`, cached revision `1110a243fdf4706b3f48f1d95db1a4f5529b4d41`. Installed tokenizer/config and pooled int8 encoder.
- **Classifier:** newly trained TF-IDF unigram/bigram logistic model across eight domains. The original private DistilBERT checkpoint was inaccessible and was **not recovered**. Training: 6,400 balanced public/synthetic rows plus 1,920 product calibration examples; 1,600 same-source holdout rows. Sources and split are recorded in `compact_classifier_training.json`. Holdout accuracy: 98.75%; this is not real-traffic accuracy. Nine independent conversational probes routed 5 correctly; four fell back to general (`conversation-routing.json`). A landlord/deposit regression now retains legal routing/caution. Do not infer comprehensive medical/legal accuracy from smoke tests.
- **T5:** remains unavailable and optional. The optimized production path uses relevance selection plus deterministic summaries; no untrained T5 weights were substituted.

Exact installed SHA-256 hashes are in `model_artifact_manifest.json`. Export commands keep intermediate graphs under ignored `models/native_exports`; installed graphs are under ignored `ml`. Weight files are local and will need explicit artifact distribution for another machine.

## Runtime and quality decisions

Native ONNX sessions avoid JavaScript pooling. Relevance uses eight CPU threads; cache uses one non-spinning thread to prevent competing worker pools. Deduplicated ONNX Runtime 1.16.3 retains compatibility with Transformers.js 2.x tensor copies; a shared CPU-provider loader supports legacy fallback pipelines. Export removes unused domain declarations and uses supported ONNX IR.

Neural reranking sees `anchor limit + 2` keyword candidates plus four timeline samples, and reserves one anchor for the best neural match. This makes selection meaningful, but does not provide exhaustive semantic recall across unsampled messages. All history is scanned for hard/domain facts; missing fact tokens are carried separately. User constraints matching the rescue patterns (including "prefer," "need," "do not," "avoid" and "cannot") are retained as whole turns in chronological order. Other wording, such as "I dislike" or "won't," can still be missed. Constraint-heavy histories can exceed the savings ratio. Token presence is not proof of factual relationships or answer fidelity.

The response cache requires identical history/system-context fingerprints within a session/domain and skips queries over 512 characters. Queries containing digits, negation, currency/email symbols or named dates require an exact text match, preventing another order's cached answer from being served. This conservative guard is not exhaustive semantic equivalence checking. Native regressions cover changed context, changed order IDs, long query tails, session isolation, padded batches, older paraphrases, preferences/negation and repeated-current-turn ordering.

## Verification and reproduction

- Unit suite: **79 passed, 12 todo**, no failures.
- Real model suite: **12 passed**, no failures or fallback timings.
- Build: passed. Actual local server startup loaded classifier, relevance and cache; legacy feature-extraction pipeline passed. Startup model warmup was about 377 ms in the recorded run.
- Known synthetic regression: **61% aggregate token savings**, 1,240/1,240 tested fact tokens and 320/320 current turns retained. This is a regression set, not an independent quality benchmark.
- Four-vector source/export checks: minimum cosine 0.9847 relevance and 0.9889 cache. Batch padding parity is tested with direct uncached encoder calls.

Run sequentially from the project directory; Windows PowerShell uses `npm.cmd` when script execution is disabled:

```powershell
npm.cmd test
npm.cmd run test:models
npm.cmd run build
npm.cmd run bench:latency
node --import tsx audit/bench/model-latency.ts --stress
$env:CTS_BENCH_ML='1'
node --import tsx audit/bench/token-savings-bench.ts
.venv\Scripts\python.exe pipeline\tests\check_native_export.py
```

The latest ordinary benchmark and the stress benchmark exit nonzero because their targets fail. Re-export with `.venv\Scripts\python.exe pipeline\export\export_native_encoders.py` using the existing local source checkpoints; retrain the compact classifier with `pipeline\train\train_compact_classifier.py`. Broad <30 ms performance for longer histories would require a smaller validated encoder or a changed input/workload contract; reducing context further without new quality evidence is not justified.
