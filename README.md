<p align="center">
  <img src="docs/images/echoregent_banner.svg" alt="EchoRegent Banner" width="720"/>
</p>

# EchoRegent

> **Lightweight, zero-overhead, local-first context middleware and continual memory layer for AI coding agents and LLM applications.**  
> Cuts prompt tokens by **30% to 60%** using deterministic lossless template factoring, backed by a human-auditable, zero-LLM-cost Markdown memory wiki.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node: >=22.12](https://img.shields.io/badge/Node->=22.12-brightgreen.svg)](https://nodejs.org/)
[![Pure ESM](https://img.shields.io/badge/Pure-ESM-yellow.svg)](https://nodejs.org/api/esm.html)
[![Zero Telemetry](https://img.shields.io/badge/Telemetry-Zero%20Calls-success.svg)](SECURITY.md)
[![Zero Weights](https://img.shields.io/badge/Model%20Weights-Zero%20Bundled-blueviolet.svg)](MODEL_LICENSES.md)

---

## Why EchoRegent?

As LLM context windows grow, agent workflows suffer from an economic and architectural paradox:
1. **Tool Output Bloat:** CI test runs, compiler tracebacks, git logs, and JSON dumps waste thousands of expensive prompt tokens every turn.
2. **Lossy Truncation Risk:** Standard filters strip context irreversibly, hiding critical stack traces or passing assertions that agents need.
3. **The Memory Tax:** Existing vector memory layers (Mem0, Supermemory) burn 1,000+ LLM tokens on every write and expand prompts with unstructured embeddings, steadily inflating token bills.

**EchoRegent eliminates this dilemma:**
- **Zero LLM Token Overhead:** Deterministic template factoring requires **0 model calls** to compress and **0 model calls** to write memory.
- **100% Lossless & Reversible:** Every timestamp, hexadecimal pointer, numeric counter, and line ending can be restored with exact precision via `restoreCompressedRequest` and `decompressText`.
- **Net-Negative Token Economics:** Saves 30% to 60% of total prompt tokens while maintaining an append-only, human-auditable Markdown knowledge graph.
- **Deterministic Policy Guardrails:** Built-in fail-closed protection automatically bypasses compression and memory on sensitive domains (Medical, Legal, Crisis).
- **100% Local-First & Permissive MIT:** No remote telemetry, no external database containers (Docker), no background daemons, and no BUSL commercial restrictions.

---

## Workspace Packages

One TypeScript monorepo, two clean npm packages sharing the same modular engine:

| Package | Audience | What's Included |
|---|---|---|
| **`@echoregent/core`** | Application developers & LLM middleware | Featherweight SDK (~120KB): deterministic policy decisions, lossless log compaction, chunked history compaction, and scoped memory. Pure ESM, zero runtime dependencies. |
| **`@echoregent/cli`** | Coding agent users & terminal workflows | Local loopback proxy (`/v1/responses`, `/v1/chat/completions`), transparent Codex launcher (`wrap codex`), diagnostics (`doctor`), and MCP server. |

---

## 3 Self-Serve Workflows

EchoRegent offers three self-serve integration paths depending on your stack:

```
+───────────────────────────────────────────────────────────────────────────+
│                           EchoRegent Workflows                            │
│                                                                           │
│  [Coding Agents: Codex / Claude]      [Application / Agent Backend]       │
│                │                                    │                     │
│   (Workflow 1) │                       (Workflow 2) │                     │
│                ▼                                    ▼                     │
│      [echoregent proxy / wrap]            [import { EchoRegent }]         │
│                │                                    │                     │
│                └──────────────────┬─────────────────┘                     │
│                                   ▼                                       │
│                    [EchoRegent Engine Core]                               │
│                    - Deterministic Policy Gating                          │
│                    - Lossless Log Template Factoring                      │
│                    - Optional History Compaction                          │
│                                   │                                       │
│                                   ▼                                       │
│                       (Workflow 3: Memory Layer)                          │
│                    [Karpathy-Style LLM-Wiki Store]                        │
│                    - Scoped Atomic Markdown Files                         │
│                    - Zero-LLM Ingest (0 Token Cost)                       │
│                    - Bi-directional [[Wikilinks]]                         │
│                                   │                                       │
│                                   ▼                                       │
│                    [Upstream Provider: OpenAI / Anthropic]                │
+───────────────────────────────────────────────────────────────────────────+
```

### Workflow 1: 1-Line Local Proxy API (For Coding Agents)

Wrap your autonomous coding agents or point your existing OpenAI/Anthropic HTTP clients to the local loopback proxy without touching your codebase.

```bash
# Install globally
npm install -g @echoregent/cli@next

# Transparently launch OpenAI Codex with automatic token compaction
echoregent wrap codex --compact-history

# Or start a standalone local proxy on port 8787
echoregent proxy --port 8787 --compact-history
```

Any tool sending requests to `http://127.0.0.1:8787/v1/responses` or `http://127.0.0.1:8787/v1/chat/completions` receives transparent, sub-5ms compaction on verbose tool outputs and older turns, while SSE streaming events and tool calls flow through untouched.

---

### Workflow 2: 1-Line TypeScript SDK (For LLM Applications)

Integrate EchoRegent directly into your Node.js or TypeScript backend pipelines before dispatching payloads to model providers.

```bash
npm install @echoregent/core@next
```

```typescript
import { EchoRegent, restoreCompressedRequest, decompressText } from '@echoregent/core'

// Initialize engine (defaults: memory off, telemetry off)
const engine = new EchoRegent({ compactHistory: true })

// Process any OpenAI Responses or Chat Completions payload
const result = engine.process(providerRequest, 'responses')

// 1. Inspect local savings
console.log(`Saved ${result.charactersRemoved} characters across payloads`)

// 2. Forward compressed request directly to OpenAI / Anthropic / Gemini
const response = await fetch('https://api.openai.com/v1/responses', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`
  },
  body: JSON.stringify(result.request)
})

// 3. Exact lossless reconstruction whenever needed:
const restoredRequest = restoreCompressedRequest(result.request, 'responses')
```

- **Reversibility Guarantee:** `restoreCompressedRequest` and `decompressText` recover the exact original text and ordering.
- **Fail-Closed Safety:** Protected medical, legal, and crisis contexts automatically bypass transformations and forward verbatim.

---

### Workflow 3: External LLM-Wiki Continual Memory Layer

Inspired by Andrej Karpathy's vision of an autonomous, human-auditable personal knowledge wiki maintained by LLMs, EchoRegent provides a persistent continual memory layer without the token penalty or infrastructure overhead of vector databases.

```typescript
import { EchoRegent } from '@echoregent/core'

const engine = new EchoRegent({
  memory: {
    mode: 'file',
    directory: './.echoregent/wiki',
    retentionMs: 30 * 86400_000 // 30-day retention
  }
})

// Scoped to project and session — zero risk of cross-tenant leakage
const scope = { project: process.cwd(), session: 'ci-pipeline-42' }

// 1. Store structured knowledge with source citations (0 LLM tokens burned!)
const fact = await engine.remember(scope, {
  content: 'Production database uses PostgreSQL 16 connection pool with max 20 connections.',
  sources: ['src/db.ts:42', 'docs/architecture.md:15']
})

// 2. Scoped deterministic recall
const recalled = await engine.recall(scope, 'PostgreSQL')
console.log('Recalled context:', recalled.map(f => f.content))

// 3. Update, forget, or purge
await engine.update(scope, fact.id, {
  content: 'Production database updated to max 35 connections.',
  sources: ['infra/pull/104']
})
await engine.forget(scope, fact.id)
await engine.purge(scope) // Immediate scoped wipe
```

The memory engine generates clean, Obsidian-compatible Markdown wiki structures (`SCHEMA.md`, `index.md`, `log.md`, `entities/`, `concepts/`) with bi-directional `[[Wikilinks]]` and atomic per-scope file locks.

---

## Feature Comparison Matrix

| Dimension | EchoRegent (`@echoregent`) | RTK + ICM (`rtk-ai/rtk`) | Headroom (`headroom-ai`) | Mem0 (`mem0ai/mem0`) | Supermemory (`supermemory`) |
|---|---|---|---|---|---|
| **Core Architecture** | Deterministic log template factoring + Karpathy LLM-Wiki | Shell command filtering (Rust) + SQLite memory | Rule-based tool/log stripper + proxy | LLM fact extraction into Qdrant/Postgres | Chunking + HNSW vector index + LLM dreaming |
| **Language & Runtime** | TypeScript / Node.js 22.12+ (Pure ESM, zero native binaries) | Rust (single binary) + SQLite | Python 3.10+ (C-extensions) + Node wrapper | Python / TypeScript + Docker Compose | TypeScript / Next.js / Cloudflare Workers |
| **Install Footprint** | Dual npm packages (~300KB total). Zero Docker, zero weights. | Single binary (~15MB) + SQLite daemon | PyPI package (~80MB). Requires local proxy. | Heavy multi-container Docker (~1.5GB) | Monorepo + external vector DB |
| **Net Token Balance** | **Net-Negative** (Saves 30–60%; 0 tokens spent on write/read) | Net-negative on CLI; ICM's 31 MCP tools burn 2k tokens/turn | Net-negative on tool logs (lossy) | **Severe Net-Positive** (Burns 1.2k tokens/write) | **Severe Net-Positive** (Continuous LLM dreaming burn) |
| **Reversibility** | **100% Lossless** (`decompressText` restores exact text) | **Lossy** (Omits passing tests, truncates output) | **Lossy** (Strips structural formatting) | N/A (Memory only) | N/A (Memory only) |
| **Domain Guardrails** | **Built-in deterministic classifier** (Medical/Legal/Crisis) | None | None | None | None |
| **Telemetry Default** | **100% Local-First** (Zero telemetry, zero pings) | Local binary | **Telemetry ON by default** | Cloud API dependency by default | Cloud/SaaS dependency by default |
| **License** | **Permissive MIT** | **BUSL-1.1 Contamination** (Commercial non-compete) | Apache-2.0 | Apache-2.0 | Permissive MIT |

---

## Reproducible Empirical Benchmarks

All token measurements are generated locally using exact `o200k_base` token counters and verified with byte-exact inverse reconstruction tests.

| Workload Type | Original Tokens | EchoRegent Default | Reduction | Reversibility Verification |
|---|---:|---:|---:|---|
| **600 Repeated Fixture Logs** | 4,298 | 119 | **97.23%** | Exact Match :white_check_mark: |
| **Mixed Logs with Duplicate Runs** | 3,346 | 948 | **71.67%** | Exact Match :white_check_mark: |
| **Custom input_text Output Block** | 4,314 | 135 | **96.87%** | Exact Match :white_check_mark: |
| **Timestamped Non-Identical Logs** | 6,088 | 3,156 | **48.16%** | Exact Match :white_check_mark: |
| **Dense Numeric Tool Output** | 4,168 | 1,845 | **55.73%** | Exact Match :white_check_mark: |
| **Templated 40-Turn Conversation** | 1,181 | 1,037 | **12.19%** | Exact Match :white_check_mark: |
| **Multi-Turn Agent Mixture Total** | **42,808** | **26,653** | **37.74%** | Exact Match :white_check_mark: |

> **Reproduce Locally:** Run the verification script directly in the repository:
> ```bash
> node --import tsx audit/bench/local-savings-report.mjs
> ```
> Full methodology and fixture breakdown: [docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md).

---

## CLI & MCP Server Reference

The `@echoregent/cli` package includes rich diagnostics and Model Context Protocol (MCP) support:

```bash
# Launch transparent proxy for OpenAI Codex
echoregent wrap codex --compact-history

# Execute single coding agent command through proxy
echoregent wrap codex -- exec "npm test"

# Healthcheck and connection diagnostics
echoregent doctor

# Optional live provider latency probe
echoregent doctor --probe --model gpt-4o

# Run as Model Context Protocol (MCP) server
echoregent mcp --memory file --memory-dir ~/.echoregent/memory --project my-project --session session-1
```

### MCP Tool Configuration

Add EchoRegent to your Claude Desktop or Cursor configuration (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": ["mcp", "--memory", "file", "--memory-dir", ".echoregent/memory"]
    }
  }
}
```

Exposes 7 clean tools: `classify`, `compress`, `remember`, `recall`, `update`, `forget`, and `purge`.

---

## Deterministic Policy Guardrails

EchoRegent includes built-in domain filters for sensitive user contexts:
- **Medical Policy:** Detects prescriptions, symptoms, dosages, or diagnostic consultations.
- **Legal Policy:** Detects litigation, court proceedings, contractual liability, or tenant eviction.
- **Crisis Policy:** Detects self-harm, crisis intervention, or urgent safety triggers.

**The Policy Guarantee:**
When policy protection triggers:
1. `policy.protected === true`, `policy.compression === false`, `policy.memory === false`.
2. The entire payload forwards to upstream providers **100% verbatim**.
3. No facts are stored or indexed in persistent memory.
4. The system **fails closed**: if storage or policy checks encounter an error, all transformations are immediately halted.

---

## Development & Test Verification

```bash
# 1. Install dependencies
npm ci

# 2. Build monorepo packages (@echoregent/core and @echoregent/cli)
npm run build:packages

# 3. Run full Vitest suite
npm test

# 4. Verify distribution packaging tarballs
npm pack --dry-run --json --workspace @echoregent/core
npm pack --dry-run --json --workspace @echoregent/cli
```

---

## Documentation Index

- [Core SDK Documentation](packages/core/README.md)
- [CLI and MCP Configuration Guide](packages/cli/README.md)
- [Competitive Benchmark & Architectural Teardown](docs/research/WS3_COMPETITOR_AND_OSS_BENCHMARK.md)
- [Continual Learning Compression Specification](docs/research/WS2_CONTINUAL_LEARNING_COMPRESSION_SPEC.md)
- [Reproducible Token Savings Evidence](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md)
- [Packaging and Publishing Guide](PUBLISHING.md)
- [Model Weight Licensing Clarification](MODEL_LICENSES.md)
- [Security Policy & Vulnerability Reporting](SECURITY.md)
- [Contributing Guidelines](CONTRIBUTING.md)

---

## License

EchoRegent is open-source software licensed under the **[MIT License](LICENSE)**.  
No proprietary model weights are bundled or required.
