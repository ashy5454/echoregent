# Progress: 2026-11-10-npm-packaging.md

The supplied user specification authorizes implementation. Changes remain uncommitted alongside pre-existing user work; no npm publication or GitHub changes performed.

Tasks 1 and 2 complete: two packages, shared classifier/policy/memory, local Responses/chat relay, per-launch Codex configuration, doctor, MCP and legacy entry delegation. Initial core and CLI tests were observed failing before implementation. Full development suite and frontend build passed.

Task 3: packed installation succeeded with scripts disabled and dev dependencies omitted. Installed SDK, npm CLI shim, TypeScript declarations and real stdio MCP validated. Actual Codex 0.167.0 on Windows/Node 24.19.0 completed an authenticated Responses/SSE shell tool round trip against a controlled provider. No persistent client config edits. Fixture tokens are not billing evidence.

Independent requesting-code-review reviewer found seven defects: routing override variants, malformed HTTP targets, scoped protected continuations, protection persistence failure, streaming listener accumulation, asynchronous memory protection race, and JSON tool-output corruption. Each was reproduced by a failing regression and fixed; the package suite then passed 24/24. No deferred review findings.

Final verification: 105 tests passed, 12 existing todo; frontend build, both package builds, private legacy MCP shim build and packed SDK/CLI/declarations/MCP/Codex installation all passed. Added an unscoped provider-continuation regression to preserve requests whose original provider-side context is unavailable, and a task-metrics summarizer behavior test. Task 3 complete. No live-provider billing experiment, Linux execution, npm publication or public visibility change performed.

Follow-up user request: two subagents ran the same task using live configured Codex/AgentRouter inference, one through EchoRegent, one direct. Fixed custom tool output/block handling, normal SSE cancellation accounting, prefix replay and benchmark sandbox/test-discovery issues. Final pair: 8/8 fixture tests each, no unexpected errors; 89,942 direct tokens and 52,062 EchoRegent tokens. Compression was zero and provider-call counts differed, so no compression-savings claim. Evidence and all live experiment token totals are in docs/evidence/LIVE_CODEX_REPORT.md. Updated suite: 111 passed, 12 todo. Changes remain uncommitted; no npm/GitHub publication.

Decision: retain existing hosted/model research code under an explicitly named legacy development script and exclude it from public packages; cost if wrong is retaining an extra development entry, not changing the published engine. Optional model integrations are not shipped: no downloader without a verified model manifest, licensing, sizes and fallback. Live-provider task savings remain a release-evidence gate, not an installation claim.
