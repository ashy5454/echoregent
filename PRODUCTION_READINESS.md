# CTS Production Readiness Gaps

This is the honest pre-pilot checklist after adding the async compression path, model health, and production quality eval.

## Wired now

- `/demo/compress-async` tests the actual async CTS path: DistilBERT domain classifier plus T5 compressor, with rule fallback if T5 fails.
- `/health` is now a liveness check and includes a `ready` flag.
- `/ready` returns 200 only when the required local ML models are loaded: classifier and T5. It returns 503 while they are missing/loading/failed.
- `/admin/model-health` reports model status, startup state, semantic cache stats, and compressor fallback rate.
- `eval_quality_production.py` measures the real thing: full-history answer quality vs CTS-compressed answer quality, by domain.

## Still missing before pilots

1. Re-run response quality eval on the current async path.
   - Current trusted number is unknown until `eval_quality_production.py` finishes.
   - Target for pilot: 80%+ CTS OK rate, where OK means compressed answer is equal or better than full-history answer.

2. Decide the deployment model strategy.
   - Three local ONNX models are heavy together: classifier, T5, MiniLM.
   - Railway hobby memory is likely too small for all three.
   - Practical pilot options: upgrade RAM, disable MiniLM cache, or deploy model files to a separate model service.

3. Ensure model files exist on the production machine.
   - Local models live under `ml/cts_classifier`, `ml/cts_t5`, and `ml/cts_minilm`.
   - If they are not included in deploy artifacts or downloaded at boot, production falls back/degrades.

4. Set deployment health checks to `/ready`, not `/health`.
   - `/health` only says the HTTP server is alive.
   - `/ready` says CTS can actually classify and compress with required models.

5. Treat medical as not pilot-ready unless quality eval proves otherwise.
   - Medical needs higher bar because wrong compression can remove safety context.
   - If medical scores low, disable medical pilots or route medical to low/no compression.

6. Finish architectural memory guarantees.
   - Current wiki/memory exists, but Layer A/B protected-zone enforcement is not a hard architectural boundary yet.
   - Cross-session memory exists through the wiki store, but it needs stronger permission controls, export/delete UX, and retrieval evals.

## Pilot go/no-go thresholds

- Required models ready in `/ready`: yes.
- Compressor fallback rate in `/admin/model-health`: ideally below 5% after warmup.
- Response quality OK rate: 80%+ overall.
- High-risk domains: no pilot unless domain OK rate is 90%+ or compression is conservative.
- Token savings: 50-80% is acceptable only if answer quality stays high. Savings without quality is not CTS value.
