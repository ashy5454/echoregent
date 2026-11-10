# Live Codex comparison — 10 November 2026

Two subagents managed isolated Codex runs, one through EchoRegent and one directly. Both used the user's configured `gpt-6.1-sol` model and AgentRouter Responses endpoint/API-key authentication. Credentials stayed in memory and were not saved in evidence. Both received byte-identical task instructions and fixture files: repair a provider-usage normalizer, observe its failing tests, implement the fix, and rerun the tests. The fixture includes repetitive logs. A common passive recorder captured provider SSE usage for both arms; only the EchoRegent arm used the policy/compression engine.

Final pair (run 4) started 16 ms apart:

| Measurement | Direct Codex | Through EchoRegent |
| --- | ---: | ---: |
| Provider input tokens | 88,551 | 51,035 |
| Cached input, included above | 67,347 | 30,267 |
| Uncached input | 21,204 | 20,768 |
| Output tokens | 1,391 | 1,027 |
| Total input + output | 89,942 | 52,062 |
| Elapsed time | 47.906 s | 29.704 s |
| Provider requests | 5 | 3 |
| Final fixture tests | 8/8 | 8/8 |
| Unexpected provider/proxy errors | 0 | 0 |
| Compressed requests | — | 0 |

The provider SSE totals agree with Codex's `turn.completed` aggregates. Cached input is a subset of input; reasoning output is already included in output. No provider price or invoice was available, so no monetary cost was calculated.

These single-run totals do not demonstrate compression-driven savings. The agents followed different trajectories and used different numbers of provider calls; no content transformation occurred in this final sample. Run 2 also passed both tasks but used 92,843 tokens directly and 93,443 through EchoRegent, with no compression. This variation makes a percentage-based product savings claim unwarranted.

## Errors found and fixes verified

- Current Codex sends `custom_tool_call_output`, including arrays of `input_text` blocks. Core originally handled only function-call string results. It now handles custom outputs and text blocks while preserving IDs, ordering and other blocks; repeated log lines are the only text eligible for reduction.
- Codex normally closes SSE after `response.completed`. Proxy cancellation previously incremented the error count. Normal cancellation is now excluded from middleware errors, and the evidence recorder preserves already-received provider usage.
- Replayed original history could undo prior compression and change the provider-facing prefix. Core now replays successful deterministic transforms using bounded hash metadata, retaining no original or condensed content between requests. A regression fails when replay is disabled and passes with the fix.
- The first pair's Windows child sandbox policy rejected shell commands, so neither fixture was repaired. Both subsequent runs use identical unrestricted execution settings in isolated, trusted fixture directories.
- Codex unpacked plugin test files beneath its isolated benchmark home, which Vitest discovered as repository tests. The test configuration now excludes `.superpowers/**` while preserving the repository suite.

All product regressions were observed failing before their fixes. Final repository suite: 111 passed, 12 existing todo. Package builds, frontend build, and packed SDK/CLI/MCP installation are verified separately. Successful fixture runs do not establish compatibility with every Codex version/provider.

## Evidence and reproduction

- `live-codex-baseline-run-4.json`, `live-codex-echoregent-run-4.json`, `live-codex-comparison-run-4.json`: final pair.
- Run 1 records: failed shell-policy setup and cancellation-accounting findings; client usage is available, provider SSE accounting was incomplete.
- Run 2 records: successful pair before output-block support/prefix replay.
- `live-codex-echoregent-run-3.json`: short format diagnostic, which did not attempt to repair the fixture.

Across the measured live runs, reruns and diagnostic: **460,812 input-plus-output tokens**. This excludes root/coordinator subagent usage and nonbillable controlled-provider tests. Failed first-run totals come from Codex aggregates; subsequent totals were verified against provider SSE. No further paid inference was run after the final pair.

Reproduction requires Node 22.12+, Python 3.11+ (to read the local TOML configuration), Codex on PATH, and the user's existing API-key provider configuration. Build packages first. In two terminals run `node scripts/live-codex-run.mjs baseline N --barrier` and `node scripts/live-codex-run.mjs echoregent N --barrier` with a fresh run number. Once both `.ready` files exist under `.superpowers/paired-codex/run-N`, create its `.start` file. Then run `node scripts/compare-live-codex.mjs N`. These commands use live provider inference and consume tokens.
