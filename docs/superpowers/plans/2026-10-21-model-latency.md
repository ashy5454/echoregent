# Model latency and weights implementation plan

Goal: measure the full local preprocessing pipeline below 30 ms p95 on this machine for up to 40-message histories, including uncached inputs, without masking missing models or degrading verified output quality.

Architecture: preserve the trained relevance weights; profile native ONNX threading and graph optimization before changing model behavior. Restore semantic-cache weights from the documented sentence-transformers/all-MiniLM-L6-v2 base. Restore the original classifier only from its trained checkpoint, with correct domain mapping and documented quality checks; do not relabel unrelated weights as a trained classifier.

Tech stack: existing TypeScript, Transformers.js 2.17.2, native ONNX runtime, Python ONNX tooling.

Constraints: preserve the user's uncommitted changes; no remote publication. Interpret aggregate as whole-request elapsed p95, including classification, relevance compression, cache lookup and serialization, pending user clarification. Separate uncached, warm-history, and startup measurements. Record model provenance and hashes. Never count fallback timings as model timings.

1. Profile native ONNX sessions with 1/2/4/8 CPU threads and optimized graphs on identical inputs. Compare numerical outputs with the installed relevance model. Save evidence.
2. Add a failing real-runtime check for fresh relevance batches, model loading, deterministic repeated outputs, and semantic-cache hit/isolation behavior. Implement a supported native session loader only if profiling justifies it; retain existing missing-model fallback contracts.
3. Restore cache weights from the documented base checkpoint, including tokenizer/config and quantized ONNX. Verify graph compatibility and semantic behavior. Record source, revision and hashes.
4. Recover original classifier weights and training provenance. Original Git LFS is currently unavailable (404; unauthenticated GitHub). If no checkpoint is available, obtain the user's dataset/checkpoint location; do not invent a replacement training history. Verify all trained domains, label formats, uncertain-domain behavior, and unsupported legal routing.
5. Benchmark all loaded components and combined preprocessing with 10 warmups and 100 unique measured requests per scenario. Run project tests and token/quality checks. Report any target or unresolved weights honestly.

Final ledger (2026-10-21):

- Ruling: continue in the existing feature branch with user changes preserved; no commits, publication or cleanup of user artifacts.
- Ruling: original private classifier checkpoint is unavailable and user has no access. Train a clearly identified new eight-domain TF-IDF/logistic classifier from balanced public data plus synthetic product calibration. This does not recover the original model or prove real conversational accuracy.
- Native relevance keeps the locally trained checkpoint. Cache uses the documented MiniLM base revision 1110a243fdf4706b3f48f1d95db1a4f5529b4d41. Both export through pipeline/export/export_native_encoders.py with pooled int8 graphs; numerical source parity checked.
- Ruling: bounded neural selection uses limit+2 keyword candidates and four timeline samples, with one anchor selected by neural similarity. Full-history facts, explicit user constraints and the latest turn are retained. Cost: semantic recall outside the sampled pool is still limited; constraint-rich inputs can exceed token savings targets.
- Fixed reviewer findings with real regressions: index mapping, inherited vocabulary keys, uncertain legal routing, inference health, cache history/system context isolation, long-query cache bypass, padded batch parity and chronological constraint rescue.
- Root cause: cache session workers competed with relevance batch inference. Cache now uses one non-spinning thread; relevance uses eight. ONNX Runtime 1.16.3 is deduplicated and compatible with Transformers.js 2.x tensor copies. CPU-only fallback provider configuration and unused ONNX domain imports fix legacy-runtime compatibility.
- Final checks: 79 unit tests passed, 12 todo; 10 native tests passed; build passed; actual server startup and legacy encoder passed. Known synthetic regression: 61% token savings, 1240/1240 fact tokens and 320/320 current turns retained. Four-vector source/export cosine minimum >0.98 for each encoder.
- Target status: short coding fresh40 passed but has little headroom (latest p95 29.99 ms). Long ~200-token fresh40 stress failed at 73.05 ms p95. Broad under30 goal remains unmet. Independent conversational classifier probes: 5/9 routed correctly; remaining cases fall back to general. T5 remains absent and optional; native relevance compression does not invoke T5.
- Evidence and exact artifact hashes are in reports/MODEL_LATENCY_FINAL_20261021.md and reports/model_artifact_manifest.json.
- Final review fixes: repeated-current-query latest identity and changed-order-ID cache collision, each reproduced RED then verified GREEN. Constraint rescue recognizes a limited regex; report qualifies wording rather than claiming exhaustive preference/negation recall. Final native suite now 12 tests.
- Final verification after all review fixes: 79 unit passed/12 todo, 12 native passed, build passed, token regression61% with all tested facts/current turns retained. Latest fresh40 short p95 **30.24ms FAIL**, cached history9.74ms. Previous below30 runs do not override latest failure. Goal is not reliably met; longer fresh40 remains73.05ms FAIL. Report reflects latest evidence.

Progress: baseline npm test: 77 passed, 0 failed, 3 pending. Original seven-domain classifier trained on customer_support, coding, medical, education, sales, commerce and general; legal was explicitly excluded. Cache model base: all-MiniLM-L6-v2. Relevance trained checkpoint exists locally. Git LFS original classifier unavailable as of this run. Work in the existing feature branch to preserve the current uncommitted trained-model integration; do not copy stale committed code into a new worktree.
