# Local token savings measurement

Measured: 2026-11-10T19:41:31.151Z

Local only. No provider calls or API credits.

## Existing synthetic history regression

Eight known templates, 40 acknowledgement variants per template. The three arms receive identical fixture inputs. These results describe the legacy development history compressor.

| Path | Before | After | Saved | Reduction | Facts | Current turn |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rules | 50502 | 19493 | 31009 | 61.40% | 1240/1240 | 320/320 |
| fine-tuned relevance | 50502 | 19640 | 30862 | 61.11% | 1240/1240 | 320/320 |
| base MiniLM | 50502 | 19640 | 30862 | 61.11% | 1240/1240 | 320/320 |

## Current packaged runtime

The same eleven input fixtures as the preserved baseline are measured with history off and on. Input token counts match the baseline; both current arms use identical fixture hashes. Counts include serialized request JSON and fixed context.

Every reconstructed request equals its original exactly. Separate checks cover roles, IDs, ordering, metadata, unique lines, caller mutation, current/recent messages, protected context and token growth.

| Input | Before | Previous after | Default after | Default reduction | History on after | History on reduction |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| 600 repeated fixture logs | 4298 | 119 | 119 | 97.23% | 119 | 97.23% |
| mixed logs with duplicate runs | 3346 | 1386 | 948 | 71.67% | 948 | 71.67% |
| custom input_text output block | 4314 | 135 | 135 | 96.87% | 135 | 96.87% |
| timestamped non-identical logs | 6088 | 6088 | 3156 | 48.16% | 3156 | 48.16% |
| dense unique tool output | 4168 | 4168 | 1845 | 55.73% | 1845 | 55.73% |
| structured JSON tool output | 2195 | 2195 | 2195 | 0.00% | 2195 | 0.00% |
| fenced tool output | 4302 | 4302 | 4302 | 0.00% | 4302 | 0.00% |
| medical protected context | 4301 | 4301 | 4301 | 0.00% | 4301 | 0.00% |
| legal protected context | 4297 | 4297 | 4297 | 0.00% | 4297 | 0.00% |
| older uncompressed tool output | 4318 | 4318 | 4318 | 0.00% | 4318 | 0.00% |
| Templated conversation: 40 numbered build turns | 1181 | 1181 | 1181 | 0.00% | 1037 | 12.19% |
| Selected mixture total | 42808 | 32490 | 26797 | 37.40% | 26653 | 37.74% |

## Additional controls

These fixtures are excluded from the eleven-case mixture total. ISO log timestamps and IDs vary in non-monotonic order and every value must reconstruct exactly.

| Input | Before | Default after | History on after | History on reduction |
| --- | ---: | ---: | ---: | ---: |
| ISO timestamps, changing IDs and statuses | 22893 | 9797 | 9797 | 57.21% |
| unique opaque event payloads | 10290 | 10290 | 10290 | 0.00% |
| diverse conversation: 40 different sentences | 961 | 961 | 961 | 0.00% |

## Enable older conversation compaction

Log compaction is automatic. History factoring is optional and requires repeated wording. Recent turns stay verbatim.

```sh
echoregent proxy --compact-history
echoregent wrap codex --compact-history
```

SDK: `new EchoRegent({ compactHistory: true })`. Inspect original text with `restoreCompressedRequest(result.request, protocol)` or `decompressText(result.text)` for standalone log text.

## Limits

- History benchmark has 8 known synthetic templates with 40 acknowledgement variants each; it is not a held-out or production benchmark.
- History results describe legacy development compression, not the current packaged proxy. Its medical/legal policy differs from the packaged protected-context policy.
- Package totals depend on this deliberately selected mixture of repeated logs and pass-through controls.
- The numbered build-turn fixture is templated prose, not arbitrary ordinary conversation. Diverse prose and opaque unique payloads are separate pass-through controls.
- Optional history factoring preserves the latest user message and at least the last eight items. A newly aged chunk may change a provider prefix once; already factored chunks are deterministic.
- Tokenizer estimates do not establish provider-billed savings, cache hits, output-token changes, or monetary savings.
- Exact reconstructed package requests verify every text character, value, association, role, ID and metadata field in these fixtures. Upstream interpretation of templates and semantic answer quality were not tested.

Previous evidence: [LOCAL_TOKEN_SAVINGS_BASELINE.md](LOCAL_TOKEN_SAVINGS_BASELINE.md).

Reproduce from the repository with: node --import tsx audit/bench/local-savings-report.mjs
