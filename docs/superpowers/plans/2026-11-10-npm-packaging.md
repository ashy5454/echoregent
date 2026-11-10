# EchoRegent npm Packaging Implementation Plan

> **For agentic workers:** Use superpowers:executing-plans to implement this plan task-by-task. The user has supplied the design and authorized packaging.

**Goal:** Produce installable SDK and CLI npm archives sharing one deterministic, policy-aware engine.

**Architecture:** Two npm workspaces with tsc ESM builds. Core owns transformations and scoped memory. CLI adapts HTTP, Codex launch configuration and MCP to core.

**Tech Stack:** TypeScript, Node 22.12+, Node HTTP/fetch, MCP SDK, Vitest, Node test runner.

**Spec:** ../specs/2026-11-10-npm-packaging-design.md

## Global Constraints

- Exactly two public packages: `@echoregent/core`, `@echoregent/cli`; version 0.4.0; MIT code license unchanged.
- No model downloads or telemetry; memory off by default; no automatic memory injection/writes.
- Preserve existing uncommitted work; work in the current feature checkout.
- Compiled JavaScript and TypeScript declarations in npm archives; no installation build hook.
- `/v1/responses` and `/v1/chat/completions` relay structured payloads and streaming bytes.

## Review Focus

- Tool result after the last user input must survive with call IDs and ordering intact.
- Prefix and cache control changes must not occur when compression runs.
- Policy checks must inspect earlier sensitive turns even if current input is benign.
- Malformed compression output must fall back to exact original request bytes.
- Scoped file stores must resist traversal, concurrent writes and cross-session recall.

### Task 1: SDK and workspace

Files: `packages/core/{package.json,tsconfig.json,src/*}`, root `package.json`, `audit/tests/package-core.test.ts`.

Interfaces: `EchoRegent.process(body, protocol, scope?)`, `compressText(text)`, `evaluatePolicy(text)`, scoped memory `remember`, `recall`, `update`, `forget`, `purge`.

- [x] Add failing policy, newest-tool/prefix preservation, fail-open, scope and retention tests; run Vitest and inspect expected missing-export failure.
- [x] Extract existing deterministic classifier/signals/types into core and reexport classification from legacy code without loading model dependencies in core.
- [x] Implement policy, conservative log compression and scoped file/ephemeral memory; add package metadata and ESM declarations build.
- [x] Run core tests and existing suite, retaining the original development tests.

### Task 2: CLI adapters

Files: `packages/cli/{package.json,tsconfig.json,src/*}`, `audit/tests/package-proxy.test.ts`, `audit/tests/package-mcp.test.ts`.

Interfaces: `startProxy(options) -> {baseUrl, close, stats}`, `buildCodexArgs(baseUrl, tokenEnv, args)`, `createMcpServer(engine, scope)`.

- [x] Add failing real HTTP relay tests: Responses/tool ordering, chunked SSE, auth, provider errors and fail-open bytes.
- [x] Implement loopback proxy plus policy API and explicit scoped memory API, bounded bodies and disconnection cancellation.
- [x] Add Codex per-launch overrides, routing verification, doctor and MCP tools; replace old MCP entry point with delegation and retain legacy service under an explicitly named development script.
- [x] Run new and full tests and both package builds.

### Task 3: Distribution and reproducible evidence

Files: `scripts/package-smoke.mjs`, `scripts/codex-integration.mjs`, `scripts/task-evidence.mjs`, package READMEs/LICENSEs, root README and licensing/release docs, package CI.

- [x] Pack and install both archives into a temporary directory without source or dev dependencies; exercise CLI, SDK, MCP and declarations.
- [x] Run actual installed Codex with an isolated configuration against a controlled Responses/SSE fixture; verify tool round trip, authentication and routing.
- [x] Provide task evidence collection for completion, provider usage/cache tokens and latency; record controlled-fixture evidence without claiming billed savings.
- [x] Review package changes, address material issues with regression tests, run complete verification and report remaining release gates.
