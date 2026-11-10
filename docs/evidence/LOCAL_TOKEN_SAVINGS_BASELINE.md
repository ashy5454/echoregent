# Local token savings measurement

Measured: 2026-11-10T17:34:54.304Z

Local only. No provider calls or API credits.

## Existing synthetic history regression

Eight known templates, 40 acknowledgement variants per template. The three arms receive identical fixture inputs. These results describe the legacy development history compressor.

| Path | Before | After | Saved | Reduction | Facts | Current turn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rules | 50502 | 19493 | 31009 | 61.40% | 1240/1240 | 320/320 |
| fine-tuned relevance | 50502 | 19640 | 30862 | 61.11% | 1240/1240 | 320/320 |
| base MiniLM | 50502 | 19640 | 30862 | 61.11% | 1240/1240 | 320/320 |

## Current packaged runtime

These are estimates of serialized request JSON tokens, including fixed fixture context. All unique output lines, request structure, caller inputs and expected pass-through controls were checked.

| Input | Before | After | Saved | Reduction |
| --- | ---: | ---: | ---: | ---: |
| 600 repeated fixture logs | 4298 | 119 | 4179 | 97.23% |
| mixed logs with duplicate runs | 3346 | 1386 | 1960 | 58.58% |
| custom input_text output block | 4314 | 135 | 4179 | 96.87% |
| timestamped non-identical logs | 6088 | 6088 | 0 | 0.00% |
| dense unique tool output | 4168 | 4168 | 0 | 0.00% |
| structured JSON tool output | 2195 | 2195 | 0 | 0.00% |
| fenced tool output | 4302 | 4302 | 0 | 0.00% |
| medical protected context | 4301 | 4301 | 0 | 0.00% |
| legal protected context | 4297 | 4297 | 0 | 0.00% |
| older uncompressed tool output | 4318 | 4318 | 0 | 0.00% |
| ordinary conversation without tool output | 1181 | 1181 | 0 | 0.00% |
| Selected mixture total | 42808 | 32490 | 10318 | 24.10% |

## Limits

- History benchmark has 8 known synthetic templates with 40 acknowledgement variants each; it is not a held-out or production benchmark.
- History results describe legacy development compression, not the current packaged proxy. Its medical/legal policy differs from the packaged protected-context policy.
- Package totals depend on this deliberately selected mixture of repeated logs and pass-through controls.
- Tokenizer estimates do not establish provider-billed savings, cache hits, output-token changes, or monetary savings.
- Facts checked are selected benchmark strings and unique tool-output lines; this does not establish preservation of every semantic detail.

Reproduce from the repository with: node --import tsx audit/bench/local-savings-report.mjs
