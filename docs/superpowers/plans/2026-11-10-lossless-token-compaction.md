# Lossless token compaction implementation plan

> **For agentic workers:** Use test-driven development and execute the tasks below in order in this session. Preserve the existing working changes; do not commit or publish them.

**Goal:** Reduce the locally measured tokens in repetitive timestamped logs and templated older conversations without dropping values or changing recent messages.

**Architecture:** Factor repeated literal wording into readable templates and retain ordered string values. Keep duplicate-line compaction as a candidate. Optional history compaction uses fixed groups of 16 request items and leaves at least the last eight items and the latest user turn verbatim. Select only representations that reduce both characters and estimated tokens.

**Tech stack:** Existing TypeScript SDK/CLI, Vitest, and the repository's gpt-tokenizer 4.0.0 (o200k_base). Tokenization runs locally with an isolated tokenizer whose content merge cache is disabled. No model inference or downloads.

**Spec / approved scope:** The user's request to save tokens and supplied continuation summary: lossless factoring of changing numeric/timestamp values; optional compaction of templated older conversation turns; local token counts and exact retention checks. Fixed chunk sizes, encoding syntax and SDK names are implementation choices.

## Global constraints

- Preserve the existing dirty checkout, all caller objects, roles, item order, call IDs, metadata, non-text blocks, valid JSON and fenced code.
- Classify the complete original request before any compaction; protected context always passes through.
- Preserve every numeric string exactly, including signs, leading zeros, timestamps, repeated values, newline style and final newline.
- Keep history compaction off by default; skip instructions, multimodal/tool-call messages and explicit cache/annotation-sensitive content.
- Replay tool-result transformations deterministically; previously factored history chunks must stay stable when original history is resent.
- Retain no prompt-content cache or cross-request template dictionary. Runtime replay storage remains hashes only.
- Check serialized payload tokens, not only characters. Do not claim provider-billed, cache, task-quality or monetary savings from this local test.
- Use npm.cmd on Windows. No paid provider calls, commits, pushes or publishing.

## Review focus

- Unusual number spellings, Unicode and mixed newline styles must reconstruct exactly.
- Small or high-entropy inputs must not grow in estimated tokens.
- References must be defined within their fixed historical chunk, without changing roles or recent turns.
- Existing encoded text, malformed envelopes and non-text metadata must survive reprocessing safely.
- Newly added protection or a failing compressor must preserve the whole original request.

## Task 1: Lossless tool-log compaction

**Files:** Create `packages/core/src/templates.ts` and `packages/core/src/token-count.ts`; modify `packages/core/src/compression.ts`, `packages/core/src/index.ts`, `packages/core/package.json`, `package-lock.json`; create `audit/tests/lossless-compaction.test.ts`.

**Interfaces:** `compressLogs(text: string): string`, `decompressText(text: string): string`; private numeric template helpers and `payloadTokens(value: unknown): number`.

- [x] Add failing tests showing timestamped and dense numeric logs reduce o200k_base serialized-request tokens and reconstruct exactly.
- [x] Add retention controls for duplicate logs, Unicode, numeric spelling, newlines, literal exceptions, JSON, code, protection and no-growth cases.
- [x] Run the new tests to observe the missing behavior.
- [x] Implement template factoring, a strict decoder and token gates; retain the best duplicate-line candidate when cheaper.
- [x] Run `npm.cmd test -- audit/tests/lossless-compaction.test.ts audit/tests/package-core.test.ts` and build the core package.

## Task 2: Optional older-history compaction

**Files:** Create `packages/core/src/history.ts`; modify `packages/core/src/index.ts`, `packages/cli/src/index.ts`, `packages/cli/src/codex.ts`; extend `audit/tests/lossless-compaction.test.ts` and `audit/tests/package-proxy.test.ts`.

**Interfaces:** `EngineOptions.compactHistory?: boolean`; CLI `--compact-history` on proxy and wrap; `restoreCompressedRequest(request, protocol)` for exact inspection/reconstruction.

- [x] Add failing tests for templated older history, both API protocols, unchanged default, current/recent messages, item metadata, exact reconstruction, independent sessions and stable prefix replay.
- [x] Add controls for tool-call messages, instructions, multimodal and cache/annotation-sensitive content, and newly protected history.
- [x] Implement fixed-chunk factoring and reconstruction, using Task 1's templates and local token counter.
- [x] Wire the option through proxy and wrap; prove the proxy forwards the compacted payload to a local fixture only.
- [x] Run the targeted SDK/proxy tests and `npm.cmd run build:packages`.

## Task 3: Measurement, documentation and verification

**Files:** Modify `audit/bench/local-savings-report.mjs`, `packages/core/README.md`, `packages/cli/README.md`, `README.md`; preserve baseline and write updated evidence under `docs/evidence/`.

- [x] Preserve the existing local report as a baseline before overwriting it.
- [x] Replace literal-line-only checks with exact reconstructed-payload equality, retaining separate structure, metadata, input mutation, protection and current-turn checks.
- [x] Measure the same fixtures with history off and on; add realistic timestamp/unique-prose controls and record their fixture hashes.
- [x] Document activation and limits: shared wording is required; reconstruction is evidence of retained text, not of upstream answer quality.
- [x] Run `npm.cmd test`, `npm.cmd run build:packages`, `npm.cmd run build`, relevant package-install checks, and `node --import tsx audit/bench/local-savings-report.mjs`.
- [x] Review the authored changes independently and address substantive findings with a failing regression test first.
- [x] Report measured before/after reductions and verification counts; leave all existing work available in the user's checkout.

## Completion: 2026-11-11

All three tasks are complete. Follow-up review fixes cover oversized repeat runs, expansion-size accounting, tilde fences, incomplete/malformed historical groups, pre-header references and malformed standalone repeat streams. Final verification: 148 tests passed with 12 existing TODOs; package and frontend builds passed; final archives installed and the controlled Codex tool round trip passed; 252 invariant checks passed across 28 measured package cases. See [verification evidence](../../evidence/COMPACTION_VERIFICATION.md) and [local token measurements](../../evidence/LOCAL_TOKEN_SAVINGS_REPORT.md). All work remains in the existing checkout; nothing was committed or published.
