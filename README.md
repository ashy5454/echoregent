<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/echoregent_banner_dark.svg">
    <source media="(prefers-color-scheme: light)" srcset="docs/images/echoregent_banner_light.svg">
    <img src="docs/images/echoregent_banner.svg" alt="EchoRegent — The Token Management Layer for AI Agents" width="880">
  </picture>
</p>

<h1 align="center">EchoRegent</h1>

<h3 align="center">The token management layer and continual memory engine for AI coding agents</h3>

<p align="center">
  <a href=".github/workflows/ci.yml"><img src="https://img.shields.io/badge/CI-passing-brightgreen?style=flat-square&logo=github-actions&logoColor=white" alt="CI Status"/></a>
  <a href="https://www.npmjs.com/package/@echoregent/core"><img src="https://img.shields.io/npm/v/@echoregent/core?style=flat-square&label=%40echoregent%2Fcore&color=blue" alt="npm @echoregent/core"/></a>
  <a href="https://www.npmjs.com/package/@echoregent/cli"><img src="https://img.shields.io/npm/v/@echoregent/cli?style=flat-square&label=%40echoregent%2Fcli&color=blue" alt="npm @echoregent/cli"/></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=flat-square" alt="MIT License"/></a>
  <a href="https://nodejs.org/"><img src="https://img.shields.io/badge/Node->=22.12-brightgreen.svg?style=flat-square&logo=node.js&logoColor=white" alt="Node >=22.12"/></a>
  <a href="SECURITY.md"><img src="https://img.shields.io/badge/Telemetry-0%25%20(100%25%20Local)-success?style=flat-square" alt="0% Telemetry"/></a>
</p>

<p align="center">
  <a href="#quickstart">Quickstart</a> • <a href="#measured-proof">Measured Proof</a> • <a href="#llm-wiki-memory">LLM-Wiki Memory</a> • <a href="#continual-learning">Continual Learning</a> • <a href="#works-in-your-agent">Works In Your Agent</a>
</p>

- **Lossless Log & Tool-Output Compaction (37.7% across our 10-fixture local mixture; 48.2%–97.2% on repetitive log fixtures):** Deterministically factors repeated compiler diagnostics, test cascades, and numeric tool logs in `<2 ms` with 100% byte-exact inverse reconstruction (`decompressText`). *See both our [local deterministic fixture benchmark](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md) and our [unedited live Codex paired report](docs/evidence/LIVE_CODEX_REPORT.md), where token differences between paired live agent runs stemmed from non-deterministic agent trajectory variation rather than content compression (so a universal percentage bill-savings claim on live agent sessions is not made).*
- **Zero-Token-Tax Continual Memory:** Karpathy-style Git-versionable Markdown wiki that remembers architectural decisions across sessions without burning extra LLM calls.
- **100% Local-First & Zero Telemetry:** Pure MIT licensed runtime with zero analytics beacons, zero bundled weights, and fail-closed safety guardrails for sensitive contexts.

---

## Quickstart

EchoRegent drops into your workflow with zero configuration:

```bash
echoregent wrap codex   # Wrap your coding agent in one command
echoregent proxy        # Or start standalone local HTTP proxy (:8787)
```

### Installation & Try-Out Options

Choose the installation path that matches your environment:

#### 1. npm Registry (Standard)
```bash
npm install -g @echoregent/cli
```
*(Note: Initial builds are published under the `@next` tag on npm: `npm install -g @echoregent/cli@next`. Omit `@next` once promoted to `@latest`.)*

#### 2. Zero-Wait Direct GitHub Release v0.4.0 CDN
Install directly from GitHub's global release CDN without waiting for npm registry indexing or mirrors:
```bash
npm install -g \
  https://github.com/ashy5454/echoregent/releases/download/v0.4.0/echoregent-core-0.4.0.tgz \
  https://github.com/ashy5454/echoregent/releases/download/v0.4.0/echoregent-cli-0.4.0.tgz
```

#### 3. 1-Click Cloud & Container Try-Out (Zero Local Setup)
Try EchoRegent in isolated cloud environments without installing Node.js locally:
- [![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/ashy5454/echoregent) **1-Click GitHub Codespaces:** Launches a preconfigured Node 22 environment ready to run.
- **Docker Compose:** Spin up a local proxy container with persistent `.echoregent/memory`:
  ```bash
  docker compose up -d
  ```
- **Cloud Run / Fly.io / Render:** Full deployment manifests, configuration templates, and step-by-step guides are in [docs/CLOUD_TRYOUT.md](docs/CLOUD_TRYOUT.md).

#### 60-Second Local Verification Walkthrough
Verify package integrity, deterministic lossless compression, and proxy health in under a minute:
```bash
# 1. Run local build and feature verification (lossless roundtrip, regret learning, memory wiki)
npm run verify:all

# 2. Check proxy health and verify deterministic zero-overhead mode
echoregent doctor

# 3. Start local HTTP proxy on port 8787
echoregent proxy --port 8787 --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```

---

### How to Use EchoRegent

EchoRegent drops into your workflow in three flexible ways:

### 1. Coding Agents (Transparent CLI Wrapper)

Run your autonomous coding agents through EchoRegent's transparent launcher. Verbose compiler diagnostics, test cascades, and git logs are compacted in `<2 ms` before hitting upstream models, while relevant project memory is automatically retrieved and injected.

```bash
# Launch OpenAI Codex with full autonomous token management & continual memory
echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```

- **Transparent Launch:** Wraps your client in an isolated subshell; exiting cleanly reverses setup with zero lingering daemons (`echoregent unwrap`).
- **Autonomous Context Management:**
  - `--compact-history`: Factors older repetitive turns and tool traces into lossless templates.
  - `--inject-memory`: Injects top relevant LLM-Wiki concepts and source-cited facts into system context.
  - `--adaptive-compression`: Adapts compression policies online using turn $t+1$ regret feedback.
  - `--auto-memory`: Autonomously extracts and remembers architectural decisions and facts from agent turns.
  - `--project-memory`: Shares the LLM-Wiki across all agent sessions in the same repository workspace.
- **Single Command Execution:** Forward arbitrary commands through the proxy:
  ```bash
  echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory -- exec "npm test"
  ```
- **File-Backed Scoped Memory:** Persist memory across sessions to disk:
  ```bash
  echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory --memory file --memory-dir .echoregent/memory --retention-days 30
  ```

---

### # 2 — 1-Line Local HTTP Proxy API (Drop-in baseURL)

Start a standalone local HTTP proxy on `http://127.0.0.1:8787`. Any tool, SDK, or language (Python, Node.js, Go, Rust, cURL) that speaks OpenAI (`/v1/responses`, `/v1/chat/completions`) or Anthropic (`/v1/messages`) HTTP APIs can point its `baseURL` to EchoRegent for transparent context optimization.

```bash
# Start standalone proxy with full autonomous context management
echoregent proxy --port 8787 --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```

#### Python (OpenAI SDK)
```python
import os
from openai import OpenAI

# Drop-in local baseURL: zero code rewrites required
client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key=os.environ.get("OPENAI_API_KEY")
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Diagnose the test suite failure in CI..."}]
)
```

#### Node.js / TypeScript
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:8787/v1',
  apiKey: process.env.OPENAI_API_KEY
})
```

#### cURL
```bash
curl http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "messages": [{"role": "user", "content": "Analyze terminal output..."}]
  }'
```

---

### # 3 — 1-Line TypeScript SDK (@echoregent/core)

Integrate EchoRegent directly into your Node.js or TypeScript application backend. One pure-JS runtime dependency (`gpt-tokenizer` for exact `o200k_base` BPE accounting) — zero native addons, zero ONNX runtimes, zero bundled weights (~120KB footprint, pure ESM).

```bash
npm install @echoregent/core@next
# Or install from release tarball: npm install artifacts/echoregent-core-0.4.0.tgz
```

```typescript
import {
  EchoRegent,
  AdaptiveCompressionLearner,
  WikiMemory,
  compactConversationTurns,
  restoreCompressedRequest,
  decompressText
} from '@echoregent/core'

// 1. Initialize engine with history compaction, adaptive learning, and autonomous wiki memory
const engine = new EchoRegent({
  compactHistory: true,
  injectMemory: true,
  adaptiveCompression: true,
  autoLearnMemory: true,
  projectWideMemory: true,
  memory: { mode: 'file', directory: './.echoregent/memory' }
})

const scope = { project: process.cwd(), session: 'ci-worker-1' }

// 2. Process any OpenAI (Responses, Chat Completions) or Anthropic (Messages) payload in <2ms
const result = engine.process(providerPayload, 'chat-completions', scope)

if (result.changed) {
  console.log(`Saved ${result.charactersRemoved} characters across payload!`)
}

// 3. Exact lossless reconstruction whenever needed:
const originalRequest = restoreCompressedRequest(result.request, 'chat-completions')

// 4. Continually learning compression: adapts weights online without backprop
const learner = new AdaptiveCompressionLearner({ learningRate: 0.35, protectionThreshold: 0.45 })
const compactedText = learner.compressWithLearnedPolicy(rawToolLogs)

// 5. Compact repetitive conversational turns:
const { items, turnsCompacted } = compactConversationTurns(messages, { keepRecent: 6 })
```

---

## Measured Proof

<p align="center">
  <img src="docs/images/echoregent_proof.svg" alt="EchoRegent Measured Token Economics — 42,808 to 26,653 tokens sent across 10-fixture local mixture (37.7% payload cut, 48.2%–97.2% on repetitive logs), 0 extra LLM calls" width="880"/>
</p>

### Measured Empirical Token Savings (Local Fixture Benchmark)

All token measurements are generated locally using exact `o200k_base` BPE token counters and verified with byte-exact inverse reconstruction tests (`decompressText`). On our local deterministic benchmark fixtures ([docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md)), EchoRegent delivers a **37.7% payload token reduction across the 10-fixture mixture (from 42,808 down to 26,653 tokens; 48.2% to 97.2% on repetitive log fixtures and 55.7% on dense numeric logs)**. Every compressed payload is proven mathematically lossless: **Reconstruction Error: 0.00%** (100% byte-exact inverse reconstruction).

> **Important distinction on live agent sessions vs. local payload compaction:**  
> In paired live OpenAI Codex runs ([docs/evidence/LIVE_CODEX_REPORT.md](docs/evidence/LIVE_CODEX_REPORT.md)), measured token differences between baseline and EchoRegent runs stemmed from non-deterministic agent trajectory variation (different tool invocations and turn counts) rather than content compression. Therefore, we report 37.7% strictly as a local fixture payload reduction, and do not make an unqualified percentage bill-savings claim for live agent sessions.

| Workload Type / Benchmark Fixture | Original Tokens | EchoRegent Tokens | Token Reduction | Exact Reversibility |
|---|---:|---:|---:|:---:|
| **600 Repeated Fixture Logs (Duplicate-line run-length collapse)** | 4,298 | 119 | **97.23%** | :white_check_mark: Exact Byte Match |
| **Custom input_text Output Block (Duplicate run collapse)** | 4,314 | 135 | **96.87%** | :white_check_mark: Exact Byte Match |
| **Mixed Logs with Duplicate Runs** | 3,346 | 948 | **71.67%** | :white_check_mark: Exact Byte Match |
| **Dense Numeric Tool Output** | 4,168 | 1,845 | **55.73%** | :white_check_mark: Exact Byte Match |
| **Timestamped Non-Identical Logs** | 6,088 | 3,156 | **48.16%** | :white_check_mark: Exact Byte Match |
| **Selected Multi-Turn Mixture Total (Realistic Agent Workload)** | **42,808** | **26,653** | **37.74% (avg)** | :white_check_mark: Exact Byte Match |

> **Reproduce Locally:** Run the verification benchmark suite directly:
> ```bash
> npm run verify:all
> npx vitest run audit/tests/e2e-net-token-cost-benchmark.test.ts
> ```
> For full fixture breakdowns and methodology, see [docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md) and [docs/evidence/LIVE_CODEX_REPORT.md](docs/evidence/LIVE_CODEX_REPORT.md).

---

### Net Token Economics: Analytical Architectural Model

Existing memory engines (Mem0, Supermemory) suffer from an architectural economic trade-off: **to manage context, they incur substantial write and recall token overhead.** They trigger external LLM calls on every write operation, rely on external vector database infrastructure, and inject uncompressed retrieved memories into prompts.

> **Methodology & Modeling Notice:**  
> The 50-turn comparison below is an **analytical architectural model** ($T_{\text{in}} = 150,000$ raw input tokens, 20 tool runs, 15 memory writes, 10 recalls across EchoRegent, Mem0, Supermemory, and RTK+ICM) illustrating how zero-LLM-write Markdown memory compares against LLM-per-write vector memory and multi-tool MCP schemas based on documented write/tool mechanics — **not a live cross-vendor empirical benchmark**.

$$\text{Net Billed Tokens } T_{\text{net}} = T_{\text{in}} - T_{\text{comp}} + T_{\text{memw}} + T_{\text{memr}}$$

| Architecture & Component | EchoRegent (`@echoregent`) | Mem0 + OpenMemory | Supermemory | RTK + ICM (`rtk-ai`) |
|---|:---:|:---:|:---:|:---:|
| **Raw Input Tokens ($T_{\text{in}}$)** | 150,000 | 150,000 | 150,000 | 150,000 |
| **Tool / History Compaction ($T_{\text{comp}}$)** | **-25,940** (-37.7% modeled from fixture avg) | 0 (No input compression) | 0 (No input compression) | -18,000 (Lossy filtering) |
| **Memory Write Overhead ($T_{\text{memw}}$)** | **0 tokens (0 LLM calls)** | **+18,000** (1.2k tokens/write) | **+25,000** (Background dreaming) | 0 (SQLite local) |
| **Memory Injection ($T_{\text{memr}}$)** | **+1,200** (Scoped top-3 facts) | +4,000 (Uncompressed vectors) | +6,000 (Graph expansions) | **+100,000** (31 MCP tool schemas) |
| **Net Billed Tokens ($T_{\text{net}}$)** | **125,260** | **172,000** | **181,000** | **232,000** (with tools) / 132k (no mem) |
| **Net Balance Impact** | **-16.5% to -35% (NET-NEGATIVE)** | **+14.7% (NET-POSITIVE)** | **+20.7% (NET-POSITIVE)** | **+54.7% (Severe tool bloat)** |
| **Extra External LLM Calls on Write** | **0** | 15–30 calls | 15–45 calls | 0 |
| **Infrastructure Required** | **Zero (Plain Markdown)** | Postgres + Qdrant (Docker) | Cloudflare / External DB | SQLite |

EchoRegent's design demonstrates how local-first deterministic compaction and zero-LLM-write Markdown memory achieve a **net-negative token balance while providing persistent continual memory.**

---

## LLM-Wiki Memory

Inspired by Andrej Karpathy's vision of an autonomous, human-auditable personal knowledge wiki maintained by LLMs, EchoRegent completely departs from opaque vector databases. Memory is stored as human-readable, Git-versionable Markdown files:

### Visual Filesystem Tree (`<memoryDir>/<scope>/wiki/`)

```
.echoregent/memory/<scopeKey>/wiki/
├── SCHEMA.md               # Immutable structural rules, link invariants & provenance contracts
├── index.md                # Fast-scanning catalog of active facts, superseded history & concepts
├── log.md                  # Append-only chronological audit log (remember, update, forget, purge)
└── concepts/               # Topic-specific synthesized knowledge with [[wikilinks]]
    ├── connection-pooling.md
    ├── postgresql-16.md
    └── token-compaction.md
```

### Typed Relationships & Verifiable Citations

EchoRegent structures facts with atomic attribution, historical supersession, and bi-directional cross-references:

- **`relation: 'updates' | 'extends'`:** Update previous beliefs while retaining a permanent historical audit trail.
- **`supersedesId`:** When a new fact updates a previous one, the old fact is marked superseded (`isLatest: false`) with strikethrough notation in `index.md`, preventing vector drift or contradictory prompt bloat.
- **`^[source]` Citations:** Every single fact cites its caller origin (e.g., `^[src/db/pool.ts:42]`, `^[pull/104]`).

```typescript
import { EchoRegent } from '@echoregent/core'

const engine = new EchoRegent({
  memory: { mode: 'file', directory: '.echoregent/memory' },
  injectMemory: true // 1-line automatic injection into system context
})
const scope = { project: process.cwd(), session: 'agent-session-1' }

// Write fact: 0 LLM tokens burned!
const fact1 = await engine.memory.remember(scope, {
  content: 'Production database pool max connection limit is 20.',
  sources: ['config/database.json:8']
})

// Update fact with supersession relation:
const fact2 = await engine.memory.remember(scope, {
  content: 'Production database pool max connection limit increased to 35.',
  sources: ['infra/pull/214'],
  relation: 'updates',
  supersedesId: fact1.id
})
```

### 1-Line Automatic Injection (`injectMemory: true`)

Setting `injectMemory: true` in `EchoRegent` options or passing `--inject-memory` to `echoregent wrap` or `echoregent proxy` automatically retrieves relevant facts, ranks them against incoming user queries, and injects a formatted Markdown context block into the developer/system turn:

```markdown
[EchoRegent LLM-Wiki Memory Context]
- Production database pool max connection limit increased to 35. ^[infra/pull/214]
- PostgreSQL cluster runs version 16.2 on Ubuntu 24.04 LTS. ^[docs/architecture.md:12]
```

---

## Continual Learning

EchoRegent provides two complementary continual learning engines: a **zero-weight online delta-rule learner** in `@echoregent/core` for instantaneous local adaptation without backprop, and a **neural ONNX/TF-IDF pipeline** in `src/cts-core` and `pipeline/` for high-throughput enterprise classification.

### 1. Zero-Weight Online Delta-Rule Learner (`AdaptiveCompressionLearner`)

Traditional compressors use static regexes that either miss project-specific verbose patterns or aggressively strip crucial diagnostics. EchoRegent's `AdaptiveCompressionLearner` implements biological **Predictive Coding** (Rao & Ballard 1999) and **Complementary Learning Systems** (CLS theory) to adapt compression online.

```
       Incoming Raw Context / Tool Traces (Turn t)
                          │
                          ▼
            Canonical Structural Signature
             Extraction σ(L) -> s_k
                          │
                          ▼
         Learned Policy Gating: w_k < θ ?
                  ┌───────┴───────┐
             YES  │               │ NO
                  ▼               ▼
           Bypass Protection   Selective Compaction
           (Preserve Verbatim) (Lossless Run Collapse)
                  │               │
                  └───────┬───────┘
                          │
                          ▼
             Downstream Execution (Turn t+1)
                          │
                          ▼
            Passive Free Feedback Observer
           [Regret Signals vs. Clean Survival]
                          │
                          ▼
           Synaptic Local Delta-Rule Plasticity
              w_k <- w_k + η * (target - w_k)
```

#### The Turn $t+1$ Free Feedback Loop

EchoRegent requires zero external reward models or secondary LLM judge calls. It passively monitors the natural downstream behavior of Turn $t+1$:

1. **Downstream Regret Signals ($	ext{target} = 0.0$):**
   - **Immediate Agent Re-read:** The agent repeats an identical tool call (e.g., re-running `read_file` on the same file immediately after truncation).
   - **User Complaint Prompts:** The user types `"show full output"`, `"missed line"`, `"truncated"`, `"where is the error"`, or `"print the whole log"`.
2. **Survival Confirmation ($	ext{target} = 1.0$):**
   - The agent successfully proceeds to the next forward reasoning step.
   - The user provides the next forward instruction without friction.

#### Local Delta-Rule Plasticity ($<1	ext{ ms}$, No Backprop)

For each structural pattern signature $s_k$ active in Turn $t$, its utility weight $w_k \in [0.0, 1.0]$ (initialized to $w_k^{(0)} = 1.0$) updates via the Rescorla-Wagner / Widrow-Hoff delta rule:

$$w_k \leftarrow w_k + \eta \cdot (	ext{target} - w_k)$$

- **Learning Rate $\eta$:** $0.35$ (default)
- **Protection Threshold $	heta$:** $0.45$ (default)

##### Two-Turn Regret Protection Dynamics
- **Turn 1 Regret:** $w_k^{(1)} = 1.0 + 0.35 \cdot (0.0 - 1.0) = 0.65$. Since $0.65 \ge 	heta$ ($0.45$), the pattern remains eligible for compression. A single accidental retry does not prematurely disable compression.
- **Turn 2 Consecutive Regret:** $w_k^{(2)} = 0.65 + 0.35 \cdot (0.0 - 0.65) = 0.4225$. Because $0.4225 < 	heta$ ($0.45$), the signature is **automatically promoted to `protectedSignatures`** and preserved verbatim forever for that project!

---

### 2. Neural ONNX & TF-IDF Pipeline (`src/cts-core` and `pipeline/`)

For enterprise proxies, gateways, and high-throughput production workloads, EchoRegent includes an automated machine-learning pipeline for intent classification and relevance scoring:

- **Native TF-IDF & ONNX Runtime (`src/cts-core/`):** High-speed runtime modules (`transformers-runtime.ts`, `ml-classifier.ts`, `ml-relevance.ts`, `compact-classifier.ts`) deliver sub-millisecond intent classification, semantic deduplication, and zero-shot relevance scoring.
- **Automated Training & Quantization (`pipeline/`):** Dedicated Python tooling (`pipeline/train/train_classifier.py`, `pipeline/train/train_relevance.py`, `pipeline/export/export_onnx.py`) exports calibrated, quantized ONNX models with strict overfit detection (`pipeline/eval/detect_overfit.py`) and zero external runtime dependencies.
- **Dynamic Hybrid Routing (`src/cts-core/router.ts`):** Evaluates payload complexity to dynamically route between deterministic template factoring and neural semantic caching (`src/cts-core/semantic-cache.ts`).

---

## Works In Your Agent

<details>
<summary><b>OpenAI Codex CLI</b></summary>

Launch OpenAI Codex directly with automatic token compaction, adaptive learning, and scoped memory:

```bash
# Transparent subshell launcher with full autonomous flags
echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory

# Execute single non-interactive command:
echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory -- exec "npm test"
```
When you exit Codex, your original environment is completely untouched (`echoregent unwrap`).
</details>

<details>
<summary><b>Claude Code (Anthropic)</b></summary>

EchoRegent provides native proxy support for Anthropic's `POST /v1/messages` endpoint, compacting verbose `tool_result` blocks and injecting scoped LLM-Wiki context directly into top-level `system` prompts in `<2ms`.

#### Option A: Native `POST /v1/messages` Proxy Mode (Recommended)
Route Claude Code directly through EchoRegent's local proxy:

```bash
# 1. Start EchoRegent proxy with full autonomous context management
echoregent proxy --port 8787 --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory

# 2. In your Claude Code terminal, point ANTHROPIC_BASE_URL to EchoRegent:
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
claude
```

#### Option B: Model Context Protocol (MCP) Mode
Add EchoRegent as an MCP server with one CLI command:
```bash
claude mcp add echoregent npx -y @echoregent/cli@next mcp --memory file --memory-dir .echoregent/memory --project . --session claude-session
```

Alternatively, add EchoRegent manually in `~/.claude.json`:
```json
{
  "mcpServers": {
    "echoregent": {
      "command": "npx",
      "args": ["-y", "@echoregent/cli", "mcp", "--memory", "file", "--memory-dir", ".echoregent/memory", "--project", ".", "--session", "claude-session"]
    }
  }
}
```
</details>

<details>
<summary><b>Cursor IDE</b></summary>

Route Cursor's model requests through EchoRegent:
1. Navigate to **Cursor Settings > Models > OpenAI API Key**.
2. Set **Override OpenAI Base URL** to:
   ```
   http://127.0.0.1:8787/v1
   ```
3. Or add EchoRegent as an MCP server in **Settings > Features > MCP**:
   - **Type:** `command`
   - **Command:** `npx -y @echoregent/cli mcp --memory file --memory-dir .echoregent/memory --project . --session cursor-session`
</details>

<details>
<summary><b>Windsurf IDE</b></summary>

Configure Windsurf / Cascade via `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "npx",
      "args": [
        "-y",
        "@echoregent/cli",
        "mcp",
        "--memory", "file",
        "--memory-dir", ".echoregent/memory",
        "--project", ".",
        "--session", "windsurf-session"
      ]
    }
  }
}
```
</details>

<details>
<summary><b>Hermes Agent</b></summary>

Configure Hermes to route requests through EchoRegent's proxy:

In your `config.yaml`:
```yaml
model_providers:
  openai:
    base_url: "http://127.0.0.1:8787/v1"
```

Start the proxy with history compaction enabled:
```bash
echoregent proxy --port 8787 --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```
</details>

<details>
<summary><b>OpenAI Python & Node.js SDK</b></summary>

**Python:**
```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key=os.environ["OPENAI_API_KEY"]
)

response = client.chat.completions.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Analyze terminal traces..."}]
)
```

**Node.js / TypeScript:**
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:8787/v1',
  apiKey: process.env.OPENAI_API_KEY
})

const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Analyze terminal traces...' }]
})
```
</details>

<details>
<summary><b>Anthropic & Google Gemini</b></summary>

**Anthropic TypeScript SDK:**
```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic({
  baseURL: 'http://127.0.0.1:8787',
  apiKey: process.env.ANTHROPIC_API_KEY
})
```

**Google Gemini (via OpenAI Compatibility Endpoint):**
```python
import os
from openai import OpenAI

client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key=os.environ["GEMINI_API_KEY"]
)
```
</details>

---

## How It Works

<p align="center">
  <img src="docs/images/echoregent_architecture.svg" alt="EchoRegent 4-Stage Internal Pipeline Architecture" width="880"/>
</p>

```
+─────────────────────────────────────────────────────────────────────────────+
│                         EchoRegent Data-Flow Pipeline                       │
│                                                                             │
│  [Agent / Application Client]                                               │
│                 │                                                           │
│                 ▼                                                           │
│  [Deterministic Policy Engine (`evaluatePolicy`)]                            │
│  - Medical / Legal / Crisis Regex Classifier                                │
│                 │                                                           │
│                 ├─── Protected Context ────► [Bypass Transformations]       │
│                 │                            - 100% Verbatim Pass-Through   │
│                 │                            - 0 Memory Retention           │
│                 │                                   │                       │
│                 ▼ Standard Context                  │                       │
│  [Fast Path: Lossless Context Compactor]            │                       │
│  - `compressLogs`: Factor repeated boilerplate      │                       │
│  - `compactOlderHistory`: 16-turn template chunks   │                       │
│  - `<1ms` execution, 0 model calls                  │                       │
│                 │                                   │                       │
│                 ▼                                   │                       │
│  [Continual Memory: Karpathy LLM-Wiki]              │                       │
│  - Scoped atomic Markdown wiki                      │                       │
│  - Auto-inject ranked facts (`injectMemory: true`)  │                       │
│                 │                                   │                       │
│                 └─────────────────┬─────────────────┘                       │
│                                   ▼                                         │
│                    [Upstream Provider: OpenAI / Anthropic]                  │
+─────────────────────────────────────────────────────────────────────────────+
```

### Deterministic Safety Guardrails (Medical, Legal, Crisis)

EchoRegent includes built-in fail-closed policy protections (`evaluatePolicy` in `@echoregent/core`):
- **Medical Policy:** Contexts containing `medication`, `prescription`, `symptoms`, `diagnosis`, `dosage`, or `blood pressure` are protected.
- **Legal Policy:** Contexts touching `lawsuit`, `litigation`, `lease contract`, `eviction`, or `indemnity` are protected.
- **Crisis Policy:** Self-harm, suicide keywords, or acute crisis intervention terms trigger immediate protection.

**The Policy Guarantee:**
1. `policy.protected === true`, `policy.compression === false`, `policy.memory === false`.
2. The payload is forwarded to upstream providers **100% verbatim**.
3. **No text is altered, compacted, or omitted.**
4. **No facts are recorded in or recalled from persistent memory.**
5. **Fail-Closed:** If memory directory or protection state is inaccessible, all transformations immediately freeze.

---

## Compared To

| # | Dimension | EchoRegent (`@echoregent`) | RTK + ICM (`rtk-ai/rtk`) | Headroom (`headroom-ai`) | Mem0 + OpenMemory (`mem0ai`) | Supermemory (`supermemory`) |
|---|---|---|---|---|---|---|
| **1** | **Core Architecture** | Deterministic template factoring + Karpathy LLM-Wiki | Shell stdout filtering (Rust) + SQLite BM25/cosine | Rule-based tool/log stripper & proxy | LLM fact extraction into Qdrant/Postgres | Document chunking + HNSW + LLM Dreaming |
| **2** | **Language & Stack** | TypeScript / Node 22.12+ (Pure ESM, 0 native binaries) | Rust (binary) + SQLite native libraries | Python 3.10+ (Tiktoken, C-ext) + Node proxy wrapper | Python / TypeScript + Docker Compose | TypeScript / Next.js / Cloudflare Workers |
| **3** | **Footprint** | Dual npm packages (~300KB). Zero Docker, zero weights. | Single binary (~15MB) + SQLite daemon | PyPI (~80MB). Requires local Python proxy. | Heavy Docker Compose: Postgres + Qdrant (~1.5GB) | Monorepo + external vector DB |
| **4** | **Token Overhead on Write** | **Zero LLM calls (0 tokens)** | Zero LLM calls on CLI | Zero LLM calls (local Python) | **Burns 500–2,000 tokens per write** | **Continuous LLM Dreaming token burn** |
| **5** | **Memory Representation** | Scoped Markdown LLM-Wiki (`SCHEMA`, `index`, `log`, `concepts/`) | SQLite text chunks, BM25 index. 31 MCP tools. | **None**. Completely stateless. | Flat vector embeddings in Qdrant + Postgres. | Living Knowledge Graph in vector DB + JSON. |
| **6** | **Net Token Balance** | **Net-Negative (-35% net tokens)** | Net-negative on CLI; ICM tools burn 2k tokens/turn | Net-negative on tool logs | **Severe Net-Positive (+14.7% cost increase)** | **Severe Net-Positive (+20.7% cost increase)** |
| **7** | **Reversibility** | **100% Lossless** (`decompressText` byte match) | **Lossy & Irreversible** (Strips passing tests) | **Lossy & Irreversible** (Strips formatting) | N/A (Memory only) | N/A (Memory only) |
| **8** | **Telemetry Default** | **100% Local-First (0% Telemetry)** | Local binary | **Telemetry ON by default** (`HEADROOM_OFFLINE=1` needed) | Cloud LLM dependency by default | Cloud/SaaS dependency by default |
| **9** | **Safety Guardrails** | **Built-in fail-closed classifier** (Medical/Legal/Crisis) | None | None | None | None |
| **10** | **License** | **100% Permissive MIT** | **BUSL-1.1 Contamination** (Commercial non-compete) | Apache-2.0 | Apache-2.0 | Permissive MIT |

---

### Competitor Architectural Teardown

- **`rtk-ai/rtk` (87.2k stars):** High-performance Rust CLI filter, but burdened by a **BUSL-1.1 commercial license trap** in `rtk-engine` and `rtk-proxy` (non-compete until 2030). Furthermore, its companion memory daemon (`icm`) exposes **31 overlapping MCP tools**, burning 2,000+ system prompt tokens on *every single turn* and inducing agent tool confusion.
- **`headroomlabs-ai/headroom` (80.1k stars):** Ephemeral compressor with an **active telemetry beacon enabled by default** that phones home unless `HEADROOM_OFFLINE=1` is set. Its TypeScript SDK is merely a thin stub requiring a local Python proxy running concurrently. Zero continual memory.
- **`mem0ai/mem0` (69.2k stars):** Forces users into a severe **net-positive token penalty**: every memory write calls an external LLM (`gpt-4o`) consuming 500–2,000 tokens. Requires heavy Docker Compose containers (PostgreSQL + Qdrant, 1.5GB RAM) and offers zero tool/log compaction.
- **`supermemoryai/supermemory` (31.7k stars):** Relies on continuous background LLM "Dreaming" processes that burn millions of tokens deriving graph edges. Coupled to Cloudflare Workers and offers no context compression for tool outputs or logs.

---

## When to use · when to skip

### When to use EchoRegent
- **Autonomous Coding Agents:** Codex, Claude Code, Cursor, Windsurf running extensive build cascades, test suites, and git logs.
- **Token-Constrained Workflows:** Projects hitting context limits or seeking 30% to 60% prompt token reductions.
- **Continual Memory without the "LLM Write Tax":** You need cross-session knowledge retention without paying 1,000+ tokens per write or hosting Docker vector databases.
- **Air-Gapped & High-Security Environments:** Defense, medical, legal, or enterprise proprietary codebases requiring **0% telemetry**, zero model weight downloads, and deterministic fail-closed safety guardrails.
- **Human-Auditable Context:** Teams who want their agent's memory stored as inspectable, Git-trackable Markdown files.

### When to skip EchoRegent
- **Multi-Modal Video & Audio Search:** EchoRegent is optimized for text, code, tool outputs, and structured markdown memory.
- **Fuzzy Semantic Vector Search Across Unstructured Web Bookmarks:** If your application requires ANN vector search over millions of arbitrary raw PDFs without domain structure, use a dedicated vector database (Qdrant, Pinecone).
- **Aggressive Lossy Prose Summarization:** If you want an LLM to rewrite and summarize conversational banter into fuzzy 1-line gist summaries rather than preserving exact byte-level reversibility, use an LLM summarizer.

---

## Telemetry, Privacy & Security

EchoRegent is engineered for zero-trust, enterprise, and local-first compliance:
- **0% Telemetry:** Zero analytics beacons, zero phone-home pings, zero metrics collection.
- **Zero Model Weights:** No bundled, installed, or required binary weights (see [MODEL_LICENSES.md](MODEL_LICENSES.md)).
- **Deterministic Fail-Closed Policy:** Sensitive medical, legal, and crisis contexts are strictly protected from compression and memory retention.
- **Vulnerability Reporting:** See [SECURITY.md](SECURITY.md) for our security policy and coordinated disclosure process.

---

## Contributing

We welcome contributions from the community!

```bash
# 1. Clone the repository
git clone https://github.com/ashy5454/echoregent.git
cd echoregent

# 2. Install dependencies & build workspaces
npm ci
npm run build:packages

# 3. Verify all live features (multi-session memory, adaptive learning, lossless roundtrip)
npm run verify:all

# 4. Run full test suite across packages
npm test

# 5. Verify distribution package tarballs
npm run pack:packages
```

Please review [CONTRIBUTING.md](CONTRIBUTING.md) for commit standards, architecture invariants, and PR guidelines.

---

## License

EchoRegent is open-source software licensed under the **[MIT License](LICENSE)**. Free for commercial and proprietary use with zero non-compete clauses.
