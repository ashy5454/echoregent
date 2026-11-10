# From the original EchoRegent repository to the current product

This document describes the product on the `abhiram` branch: an installable, local context middleware SDK and CLI, with the existing hosted-service and model research preserved as development code.

## Comparison baseline

The original baseline is the repository's default `master` branch at [`a9ade3c3aefc7a174a38230d7ad7c4b60ca22579`](https://github.com/ashy5454/echoregent/tree/a9ade3c3aefc7a174a38230d7ad7c4b60ca22579), fetched on November 11, 2026. The separate `main` branch contains another application history and is not the baseline for this middleware comparison.

The current work builds on the existing audit branch through [`30b4660`](https://github.com/ashy5454/echoregent/commit/30b4660f434a2c53ac2ceb168513e202f4b746bb), then adds the packaging, runtime, model-development, measurement and documentation work described below. Earlier audit fixes are inherited history, rather than all being newly authored in this branch's final snapshot.

## What changed for users

The original repository was primarily a TypeScript conversation-intelligence service and demo. Its quickstart required cloning the repository, configuring the service and separately building `cts-mcp`. Classification, history summarization, provider adapters, wiki memory and semantic caching lived in the development service and its related modules.

The current distribution consists of exactly two public npm packages:

| Package | Purpose | Contents |
| --- | --- | --- |
| `@echoregent/core` | Embed middleware in an application | Shared deterministic classifier and policy, lossless compaction, scoped memory, reconstruction helpers and TypeScript declarations |
| `@echoregent/cli` | Use middleware with an installed coding agent | Local HTTP proxy, Codex launcher, diagnostics, explicit MCP tools and model-state reporting; imports core |

Both packages are version `0.4.0`, require Node 22.12+, and ship compiled ESM JavaScript and declarations. End users do not need to clone the repository, compile TypeScript, install Python or download model weights. The root workspace and legacy MCP wrapper remain private npm packages.

After npm publication, coding-agent users install the CLI and launch their existing Codex executable through the proxy. Application developers install core and pass their provider request to `engine.process(...)`. The CLI and SDK apply the same packaged engine, rather than maintaining separate compression and memory implementations.

| Area | Original service-oriented repository | Current packaged product |
| --- | --- | --- |
| Installation | Clone, configure and build the service/MCP project | Install the core SDK or CLI from npm |
| Provider integration | Development service and provider-specific adapters; Chat Completions proxy | Local Responses and Chat Completions forwarding, with a verified controlled Codex Responses round trip |
| Compression | Rule/embedding/T5 history-selection and summarization paths | Deterministic, reversible log factoring; optional older-history factoring |
| Sensitive context | Service policy and adapter-specific handling | Full original request evaluated before transformation; packaged medical/legal/crisis protection shared across interfaces |
| Memory | Wiki and hosted-service memory paths | Explicit project/session scope, off by default, editable cited facts, retention and deletion |
| Models | Research loaders and fine-tuned classifier/T5/MiniLM assets | No weights, model downloader or native inference runtime in the npm packages |
| Validation | Existing audit/evaluation scripts and historical results | SDK/proxy/MCP regressions, clean installation, actual Codex against a local controlled provider and reproducible local savings evidence |

## Shared core and policy

The public SDK is implemented in [`packages/core`](packages/core). `EchoRegent.process(request, protocol, scope?)` accepts `responses` and `chat-completions` requests, returns the transformed or original request, and reports its policy decision, reason and character reduction. `compressText` and `classify` provide explicit text operations using the same policy.

The complete original request is classified before any compaction. The packaged policy preserves medical, legal, crisis and explicitly protected context. A protected enabled memory scope remains protected for its retention interval. If protection storage is unavailable, transformation is blocked. Compression exceptions return the original request object; the proxy retains the original request bytes when no transformation is accepted.

The product preserves caller objects, roles, item order, call IDs, metadata and non-text content. Responses function/custom tool outputs support both string output and eligible text blocks. Images, unknown blocks, structured JSON and backtick/tilde-fenced code pass through.

Response caching, automatic memory extraction/injection, external telemetry and implicit model downloads are not part of the public runtime. Existing legacy caching and model experiments remain separate, with different behavior and validation limits.

## Lossless token compaction

The previous packaged compressor could collapse consecutive identical log lines, but timestamped lines and templated conversations often remained unchanged. The current compressor factors repeated literal wording into a readable request-local dictionary and retains changing numeric values as exact strings in their original order.

Signs, leading zeros, exponent spellings, timestamps, repeated IDs, associations, Unicode, mixed line endings, blank lines and final newlines are retained. The compressor chooses a representation only when it reduces both character size and local `o200k_base` token estimates, including serialized payload overhead. Its tokenizer has the content merge cache disabled.

Default behavior compacts the newest eligible tool result. Previously transformed tool results replay deterministically when original history is resent. Replay metadata is bounded to 2,048 hashes with 24-hour expiry and does not retain the original or compressed prompt text.

Older-history factoring is opt-in: `new EchoRegent({ compactHistory: true })`, `echoregent proxy --compact-history`, or `echoregent wrap codex --compact-history`. Complete groups of 16 original items have independent embedded dictionaries. The latest user message and at least the last eight items stay verbatim. Instructions, tool-call messages, multimodal items and explicitly cached/annotated content are skipped. Already aged groups encode deterministically; a newly aged group can change a provider prefix once.

`decompressText` and `restoreCompressedRequest` reconstruct locally generated encodings without a provider call. Review fixes cover oversized repeat runs, exact separator accounting at the expansion limit, incomplete groups, malformed references before/after a history header, malformed standalone repeat streams and tilde fences. Invalid recognized encodings pass through rather than returning partially restored content.

### Measured local results

The same eleven selected fixtures were measured before and after the compaction work. Counts include serialized request JSON and fixed context:

| Input | Before | After | Estimated reduction |
| --- | ---: | ---: | ---: |
| 600 identical log lines | 4,298 | 119 | 97.23% |
| Timestamped non-identical logs | 6,088 | 3,156 | 48.16% |
| Dense numeric tool output | 4,168 | 1,845 | 55.73% |
| Templated conversation, history enabled | 1,181 | 1,037 | 12.19% |
| Selected mixture, default | 42,808 | 26,797 | 37.40% |
| Selected mixture, history enabled | 42,808 | 26,653 | 37.74% |

The previous package saved 24.10% on that selected mixture. All 252 separate invariant checks pass across 28 package cases, including exact reconstructed requests, caller mutation, ordering, metadata, recent/current messages, protected context and token growth.

These are deliberately selected local fixtures. Diverse conversation prose and opaque unique values remain unchanged. Exact reconstruction establishes retained text and structure, not the upstream model's interpretation, task quality, provider cache hits or billed savings. The legacy synthetic-history/model comparisons in the report are a separate development compressor, with different protection behavior; they are not evidence that the public CLI uses ML compression.

See the [measurement report](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md), [preserved baseline](docs/evidence/LOCAL_TOKEN_SAVINGS_BASELINE.md) and [compaction verification](docs/evidence/COMPACTION_VERIFICATION.md).

## CLI, proxy and Codex integration

[`packages/cli`](packages/cli) exposes `proxy`, `wrap codex`, `doctor`, `mcp` and `models` commands. The proxy binds to `127.0.0.1` and forwards `/v1/responses` and `/v1/chat/completions` to the configured upstream. It preserves provider status/body, authentication, structured tools and incremental SSE bytes, handles backpressure, propagates cancellation and avoids accumulating stream listeners. Compression failure forwards the unmodified request.

The Codex launcher starts and health-checks the proxy, supplies Responses provider overrides for that launch, and reports routed/compressed/protected request counts on exit. It does not edit persistent Codex configuration. It requires an existing Codex executable plus `OPENAI_API_KEY` or `ECHOREGENT_PROVIDER_KEY`; `ECHOREGENT_UPSTREAM` selects another Responses-compatible provider. ChatGPT subscription authentication is not supported by this launcher.

The controlled integration used the actual Codex CLI `0.167.0` on Windows with Node `24.19.0`. Two local Responses requests completed an authentication, incremental SSE and shell-tool round trip. This is protocol evidence using a controlled provider, not a live-provider cost benchmark.

The earlier live direct-versus-proxy benchmark completed the same task in both arms but compressed zero requests in its final sample. The agents made different provider-call trajectories, so the lower observed token total does not establish compression-driven savings. All attempts and that limitation remain in the [live report](docs/evidence/LIVE_CODEX_REPORT.md).

## Explicit scoped memory and MCP

Memory is off by default. The SDK supports ephemeral and file-backed stores; enabled stores require positive retention and explicit project/session scope, and file storage requires an explicit directory. CLI memory tools are bound to the configured scope rather than allowing callers to switch namespaces.

Facts have stable IDs, creation/update/expiry timestamps, editable content and caller-supplied source citations. APIs provide remember, recall, update, forget and purge. Recall never scans another scope. Updates retain original expiry; expired facts are removed when accessed, and purge provides immediate deletion. File updates use atomic replacement and writer locking. Protected context cannot write/recall facts, while deletion remains available. Source citations are references supplied by the caller, not independently verified evidence.

The CLI's MCP server exposes classify/compress/remember/recall/update/forget/purge through the same core. The legacy `cts-mcp` entry point delegates to it. MCP compression is explicit: the agent must invoke its tools; registering MCP alone does not intercept every provider request.

## Inherited service audit and model-development work

The branch also carries earlier service improvements: startup/build repairs, real BPE token accounting and retention floors, deterministic provider-prefix handling, Gemini/Anthropic request-shape fixes, SSRF validation, per-end-user memory scoping, persisted provider usage, editable memory UI and a metadata-only compression view. Historical estimates were distinguished from real provider usage.

Additional development changes include shared deterministic classification, model-confidence/domain fallback checks, a compact classifier, local relevance scoring, native pooled/quantized ONNX encoder loading, lazy Transformers runtime loading, context-aware semantic-cache keys, and classifier/relevance training/export/evaluation/promotion tools under [`pipeline`](pipeline). Supporting research reports remain under `reports`; local model weights and training datasets are excluded from this source snapshot.

These modules belong to the legacy/research paths. In particular, legacy history compression can apply fact-preserving compression to medical/legal domains while hard-blocking crisis/protected risk; the packaged policy preserves medical/legal content entirely. Do not infer the public SDK's protections, memory defaults or model requirements from those experiments.

`npm run api` now starts the packaged proxy. The existing hosted development service remains available as `npm run dev:legacy-api`. Historical documentation is preserved in [the legacy guide](docs/legacy-service.md), and older overview/test reports are marked accordingly.

## Verification and distribution

The final local product suite passes 148 tests in 21 files, with 12 existing TODO cases. SDK/CLI builds and the frontend production build pass. Both archives install together in a clean temporary directory without dev dependencies or installation scripts; the installed SDK, CLI shim, declarations and MCP tools are exercised before the controlled Codex check.

GitHub package CI is configured for Linux/Windows and Node 22/24. General and model CI use Node 22, matching the supported package runtime. CI configuration is not a claim that every remote matrix job has already passed.

The code retains its MIT license. Proprietary fine-tuned classifier/T5 weights are excluded from that grant and from the packages. Neither npm package includes an ONNX runtime, training data or model weights; the SDK depends on the local tokenizer, and the CLI depends on core and the MCP SDK. There is no optional-model downloader in this release.

The branch includes product/source documentation and reproducible evidence. Dependency folders, build outputs, npm archives, model artifacts, local agent state, databases, environment secrets and duplicate console captures remain local or are ignored. Pushing this branch does not publish the packages to npm.

For the exact publication steps, scope ownership, first-release `next` tag, installation checks and later stable promotion, see [PUBLISHING.md](PUBLISHING.md).
