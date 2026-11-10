# Local latency results — October 21, 2026

The available relevance model is fast when history embeddings are cached, but fresh conversation batches exceed the project's reference latency targets. The classifier and semantic-cache models could not be benchmarked because their local weights/tokenizers are absent.

Measured on Windows, AMD Ryzen 7 7840HS (8 cores / 16 logical processors), 15.3 GiB RAM, Node v24.19.0, @xenova/transformers 2.17.2. One request at a time on CPU. Each scenario used 10 discarded warmups followed by 100 measured calls. Percentiles use the nearest-rank definition. Output checks ran outside the timed interval.

| Scenario | p50 ms | p95 ms | Reference target ms | Result |
| --- | ---: | ---: | ---: | --- |
| Relevance, 20 messages, all embeddings cached | 0.008 | 0.012 | — | Cache lookup only; no inference |
| Relevance, 20 cached history messages + unique query | 3.15 | 4.33 | 35 | Within target |
| Relevance, 20 uncached messages + unique query | 84.75 | 88.21 | 35 | Above target |
| Rule classification with 40-message history | 0.058 | 0.082 | 15 | Within target; no classifier inference |
| Rule compression, 40 messages, changing current query | 1.81 | 2.49 | 100 | Within rule-path target |
| ML compression, 40 messages, cached history + unique query | 7.06 | 8.28 | 50 | Within target |
| ML compression, 40 messages, uncached history + query | 161.35 | 165.76 | 50 | Above target |
| Rule classify + ML compress + JSON serialize, cached history + unique query | 7.46 | 8.58 | 50 | Within target for available pipeline |

First model load plus scoring three messages took 390.7 ms. This is one process-first measurement, not a cold-start percentile or a machine-cold disk measurement.

The production relevance loader reported `ready`; all measured relevance outputs contained finite, nonzero scores. A fact-bearing message ranked above distractors. The quantized model measured was `ml/cts_relevance/onnx/model_quantized.onnx`; its SHA-256 is recorded in the raw report.

`cts_classifier` and `cts_minilm` each reported `failed` because their local tokenizer/model directories are absent. Rule timings do not measure DistilBERT. The combined row therefore measures rule classification plus the loaded relevance model, not the complete planned ML model stack.

The existing `verify:relevance` script repeats just ten query variants, so later samples reuse query embeddings as well as history embeddings. This diagnostic uses unique queries for every measured inference call and unique message prefixes for uncached batches. The all-cached row explicitly identifies the cache-only timing.

The reference targets apply to the target production CPU and inputs up to 200 tokens. This laptop benchmark uses short coding messages of roughly 140 characters each and does not certify container performance, maximum input lengths, concurrent load, network latency, or upstream LLM latency. The 40-message compression fixtures cover one coding domain. ML-only compression uses a precomputed routing frame; the combined row includes rule classification and JSON serialization.

The existing held-out synthetic token benchmark was also rerun with `node --import tsx audit/bench/token-savings-bench.ts`. It returned 61% aggregate token savings, 1240/1240 hard facts retained, and 320/320 current turns retained. That benchmark invokes the synchronous rule compressor, so its savings result does not validate ML-compressor quality or live customer traffic. The older evaluation reports' 0.01 ms latency entries are placeholders in `pipeline/eval/run_eval.py`.

Reproduce the latency diagnostic from the repository root:

```powershell
node --import tsx reports/latency-benchmark-20261021.mjs
```

Raw results, including all 800 measured timings, model health, environment, and model hash: [latency_20261020T221553616Z.json](latency_20261020T221553616Z.json). Its UTC timestamp corresponds to October 21 in Asia/Calcutta.

No production source files or model artifacts were modified by this diagnostic. New files are limited to this report, the diagnostic script, and its raw output.
