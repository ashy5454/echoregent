# Lossless compaction verification

Completed locally on 2026-11-11 in `E:\echoregent`. Existing working changes were preserved. No paid provider calls, commits, pushes or publication were performed.

## Review fixes

- Both repeat encoders split oversized runs using the decoder's shared repeat limit. Additional-count and total-count formats reconstruct exactly.
- Expansion accounting measures the actual reconstructed separators, including a final newline at the 64 MiB character limit.
- Backtick and tilde code fences pass through in tool output and older history.
- History restoration requires a complete 16-item group. Invalid reserved references before or after the first header leave the entire group untouched.
- Malformed standalone repeat markers leave the entire original text untouched, including any previously decoded rows.

Fourteen new regression cases exercised these boundaries. The reported defects were observed in failing tests before their fixes. An independent read-only review confirmed the final fixes and found no remaining issues in its compaction scope.

## Final checks

| Check | Result |
| --- | --- |
| `npm.cmd test -- --reporter=dot` | 21 files passed; 148 tests passed; 12 existing TODOs |
| `npm.cmd run build:packages` | SDK and CLI TypeScript builds passed; final archives also rebuilt by package smoke |
| `npm.cmd run build` | TypeScript and Vite production build passed |
| `npm.cmd run test:packages` | Final SDK, CLI and MCP archives installed without dev dependencies or installation scripts |
| Controlled installed Codex integration | Codex CLI 0.167.0; two local Responses requests; authentication, incremental SSE and tool round trip passed |
| `node --import tsx audit/bench/local-savings-report.mjs` | 252 invariant checks passed across 28 package cases |
| `git diff --check` | Passed |

The full test suite emitted an existing Node DEP0190 child-process shell deprecation warning; it did not fail. Controlled-provider fixture usage is synthetic and is not billing evidence. The Codex check did not change persistent configuration.

## Local token measurements

The selected eleven-case mixture measures 42,808 input tokens before compaction. Default compaction produces 26,797 tokens, saving 16,011 (37.40%). Enabling older-history compaction produces 26,653, saving 16,155 (37.74%). Timestamped logs save 48.16%, dense numeric logs 55.73%, and the templated conversation saves 12.19% with history enabled.

Every measured package request reconstructs exactly. Diverse prose and opaque unique values remain unchanged. These are local tokenizer estimates on selected fixtures; upstream answer quality and provider-billed savings were not tested.

Evidence: [current measurements](LOCAL_TOKEN_SAVINGS_REPORT.md), [preserved baseline](LOCAL_TOKEN_SAVINGS_BASELINE.md), and [controlled Codex integration](codex-integration.json).

## Built archives

| Archive | SHA-256 |
| --- | --- |
| `artifacts/echoregent-core-0.4.0.tgz` | `5a7542135abb45a288221b16219845c0c796230f55cc44b2fff0e6b9d6415219` |
| `artifacts/echoregent-cli-0.4.0.tgz` | `006b019ee0c7726379709d7c133c2b763672167f24c45e67442510dc66760aca` |

Enable optional history compaction with `echoregent proxy --compact-history`, `echoregent wrap codex --compact-history`, or `new EchoRegent({ compactHistory: true })`. Log compaction is automatic; history compaction remains off by default.
