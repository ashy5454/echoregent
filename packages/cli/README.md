# @echoregent/cli

> **EchoRegent — The Token Management Layer & Continual LLM-Wiki Memory Engine for AI Agents.**  
> Local HTTP proxy, transparent coding-agent launcher, diagnostics suite, and Model Context Protocol (MCP) server. Delivers **deterministic payload reduction (37.7% across our 10-fixture local mixture, from 42,808 to 26,653 tokens; 48.2%–97.2% on repetitive log fixtures)** with sub-2ms lossless template factoring and 100% byte-exact inverse reconstruction (`decompressText`). *(Note: In paired live Codex runs, token differences stemmed from non-deterministic agent trajectory variation rather than content compression, so no universal live agent bill-savings percentage is claimed; see [LOCAL_TOKEN_SAVINGS_REPORT.md](https://github.com/ashy5454/echoregent/blob/main/docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md) and [LIVE_CODEX_REPORT.md](https://github.com/ashy5454/echoregent/blob/main/docs/evidence/LIVE_CODEX_REPORT.md).)*

[![npm version](https://img.shields.io/npm/v/@echoregent/cli?color=cb3837)](https://www.npmjs.com/package/@echoregent/cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/ashy5454/echoregent/blob/main/LICENSE)
[![Node: >=22.12](https://img.shields.io/badge/Node->=22.12-brightgreen.svg)](https://nodejs.org/)
[![Pure ESM](https://img.shields.io/badge/Pure-ESM-yellow.svg)](https://nodejs.org/api/esm.html)
[![Zero Telemetry](https://img.shields.io/badge/Telemetry-Zero%20Calls-success.svg)](https://github.com/ashy5454/echoregent/blob/main/SECURITY.md)
[![Zero Model Weights](https://img.shields.io/badge/Weights-Zero%20Bundled-blueviolet.svg)](https://github.com/ashy5454/echoregent/blob/main/MODEL_LICENSES.md)

---

## 30-Second Quick Start

Install globally via npm:

```bash
npm install -g @echoregent/cli@next
```

*(The initial release uses the `@next` tag. Omit `@next` once the release is promoted to `@latest` on npm.)*

Alternatively, run directly without global installation via `npx`:

```bash
npx @echoregent/cli@next wrap codex
```

### Requirements & Runtime Characteristics
- **Node.js**: `>= 22.12.0` (Native `fetch`, modern stream handling, ES modules).
- **Architecture**: 100% Pure ESM with bundled TypeScript declarations (`.d.ts`).
- **Dependencies**: Featherweight; depends only on `@echoregent/core` and `@modelcontextprotocol/sdk`.
- **Zero Heavy Runtime**: No Python, no C++ compilation, no Docker containers, no background daemons, and no model weight downloads.

---

## CLI Command Overview

| Command | Syntax | Description |
|---|---|---|
| **`wrap codex`** | `echoregent wrap codex [--upstream URL] [--compact-history] [--inject-memory] [--adaptive-compression] [--auto-memory] [--project-memory] [-- <codex args>]` | Spawns an ephemeral loopback proxy, configures Codex via per-launch `-c` flags, and reports exit routing telemetry. |
| **`proxy`** | `echoregent proxy [--port 8787] [--upstream URL] [--compact-history] [--inject-memory] [--adaptive-compression] [--auto-memory] [--project-memory] [--local-token SECRET]` | Runs a standalone loopback HTTP proxy (`/v1/responses`, `/v1/chat/completions`, `/v1/messages`) and REST context API on `127.0.0.1`. |
| **`mcp`** | `echoregent mcp [options]` | Runs a Model Context Protocol (MCP) stdio server exposing 7 compression and memory tools to agent IDEs. |
| **`doctor`** | `echoregent doctor [--url <url>] [--probe --model <name>]` | Verifies local proxy health, deterministic mode, and optionally executes a live billable upstream routing probe. |
| **`models`** | `echoregent models` | Confirms engine rule status and verifies zero local model weights are required or installed. |
| **`unwrap`** | `echoregent unwrap` | Explains the non-destructive wrapper lifecycle and confirms no persistent client configuration was altered. |

---

## 1. Coding-Agent Launcher (`echoregent wrap codex`)

`echoregent wrap codex` provides a zero-setup, transparent wrapper around the official OpenAI Codex CLI. It boots an ephemeral loopback proxy, verifies local health, configures Codex dynamically on launch, and reports live request telemetry upon exit.

```bash
# Launch interactive Codex with default settings
export OPENAI_API_KEY="sk-..."
echoregent wrap codex

# Execute non-interactive task with history compaction enabled
echoregent wrap codex --compact-history -- exec "Run the test suite and fix failing tests"

# Point to an alternate Responses-compatible upstream provider
echoregent wrap codex --upstream "https://api.openai.com/v1" --compact-history --inject-memory

# Launch fully autonomous mode (compaction + memory injection + plasticity + auto-learning + project memory)
echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```

### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--upstream <URL>` | `https://api.openai.com/v1` | Upstream Responses-compatible provider base URL (or env `ECHOREGENT_UPSTREAM`). |
| `--compact-history` | `false` | Enables lossless template factoring across older conversation turns (preserves latest user turn and >= 8 items). |
| `--inject-memory` | `false` | Enables automatic source-cited memory retrieval and prompt injection from the active project/session scope. |
| `--adaptive-compression` | `false` | Enables online synaptic plasticity learning via Local Delta Rule; auto-protects patterns that trigger downstream regret. |
| `--auto-memory` | `false` | Enables autonomous zero-LLM-call fact learning from incoming user prompts into the scoped LLM-Wiki. |
| `--project-memory` | `false` | Scopes memory across all sessions in the project root (`session: '__project__'`). |
| `-- <codex args>` | `[]` | Forward all remaining flags and arguments directly to the Codex CLI child process. |

### Per-Launch Non-Destructive Configuration

The launcher follows the [official Codex provider configuration specification](https://developers.openai.com/codex/config-reference/). It dynamically injects `-c` configuration overrides into the spawned Codex process:

```
model_provider="echoregent"
model_providers.echoregent.name="EchoRegent local proxy"
model_providers.echoregent.base_url="http://127.0.0.1:<random-port>/v1"
model_providers.echoregent.wire_api="responses"
model_providers.echoregent.env_key="ECHOREGENT_PROVIDER_KEY"
model_providers.echoregent.requires_openai_auth=false
model_providers.echoregent.supports_websockets=false
```

- **Zero Persistent File Edits**: Does **not** touch `~/.codex/config.toml`, shell profiles, or global settings.
- **WebSocket Disablement**: Enforces standard HTTP/SSE streaming (`supports_websockets=false`) so request payloads pass through the local compaction pipeline.
- **Routing Protection**: Any forwarded argument attempting to redirect provider configuration (e.g. `-c`, `-p`, `--config`, `--profile`, `--oss`, `--local-provider`) is rejected immediately to prevent silent routing bypass.
- **Authentication**: Uses `ECHOREGENT_PROVIDER_KEY` or `OPENAI_API_KEY`. (ChatGPT browser subscription sessions are not supported by the wire API launcher).
- **Clean Exit**: Exiting Codex terminates the child process and immediately shuts down the proxy server. Running `echoregent unwrap` confirms that no configuration cleanup is necessary.

### Exit Routing Telemetry

When Codex exits, `wrap` outputs an audit summary to `stderr`:

```text
EchoRegent proxy: http://127.0.0.1:54321/v1 (rules only; memory off; telemetry off)
... [Codex execution output] ...
EchoRegent routing: 12 provider request(s), 8 compressed, 0 protected.
```

If Codex terminates with exit code 0 without routing any requests through the proxy (and `--help` / `--version` were not passed), `wrap` exits with an error alerting you that client routing was unverified.

---

## 2. Local HTTP Proxy & Self-Serve Context API (`echoregent proxy`)

Run a high-throughput, standalone reverse proxy and local context API server on `127.0.0.1`.

```bash
# Start proxy with default settings on port 8787
echoregent proxy --port 8787

# Start proxy with history compaction, adaptive plasticity, and persistent file memory
echoregent proxy --port 8787 \
  --compact-history \
  --inject-memory \
  --adaptive-compression \
  --auto-memory \
  --project-memory \
  --memory file \
  --memory-dir ~/.echoregent/memory \
  --retention-days 14 \
  --project $(pwd) \
  --session session-42 \
  --local-token "secret-token-123"
```

### CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--port <number>` | `8787` | Port to bind on `127.0.0.1` (integer `0`-`65535`). |
| `--upstream <URL>` | `https://api.openai.com/v1` | Target provider base URL (or env `ECHOREGENT_UPSTREAM`). Supports OpenAI and Anthropic (`POST /v1/messages`). |
| `--compact-history` | `false` | Enables template factoring of older conversation turns. |
| `--inject-memory` | `false` | Automatically injects relevant memories into proxied prompts. |
| `--adaptive-compression` | `false` | Enables online synaptic plasticity learning across proxied turns; saves state to disk in file mode. |
| `--auto-memory` | `false` | Enables autonomous zero-LLM-call fact learning from incoming user prompts into the scoped LLM-Wiki. |
| `--project-memory` | `false` | Scopes memory across all sessions in the project root (`session: '__project__'`). |
| `--memory <mode>` | `off` | Memory storage mode: `off`, `ephemeral` (in-memory), or `file` (Markdown wiki). |
| `--memory-dir <path>` | *(none)* | Storage directory for Markdown memory files (required for `--memory file`). |
| `--retention-days <days>` | *(none)* | Fact retention window in days (required if memory is enabled). |
| `--project <path>` | `process.cwd()` | Project root path for memory namespace isolation. |
| `--session <id>` | `<uuid>` | Session ID for memory namespace isolation. |
| `--local-token <token>` | *(none)* | Shared secret required in `x-echoregent-local-token` (or env `ECHOREGENT_LOCAL_TOKEN`). |

---

### Endpoint Reference

The proxy exposes both upstream provider pass-through routes and local context/memory endpoints:

| Method & Route | Purpose | Upstream Call? |
|---|---|:---:|
| `POST /v1/responses` | OpenAI Responses API proxy with transparent tool-output and history compaction | Yes |
| `POST /v1/chat/completions` | OpenAI Chat Completions API proxy with transparent compaction | Yes |
| `POST /v1/messages` | Anthropic Messages API proxy (Claude Code, Anthropic SDK) with transparent `tool_result` compaction and top-level `system` memory injection | Yes |
| `POST /compress` | Explicit lossless text/log compaction via deterministic template factoring | No |
| `POST /classify` | Deterministic domain classification & fail-closed policy evaluation | No |
| `POST /memory/remember` | Store a source-cited fact into the active project/session scope | No |
| `POST /memory/recall` | Retrieve scoped facts matching keywords or query text | No |
| `POST /memory/update` | Update content and citations of an existing fact by ID | No |
| `POST /memory/forget` | Delete a single fact by ID within the active scope | No |
| `POST /memory/purge` | Purge all facts and indexes within the active scope | No |
| `GET /health` | Health probe returning engine version, deterministic mode, and proxy stats | No |

---

### Injected Response Headers

All proxied provider requests (`/v1/responses`, `/v1/chat/completions`, and `/v1/messages`) return transparent upstream responses augmented with real-time audit headers:

| Header Name | Type | Description | Example |
|---|---|---|---|
| `x-echoregent-compressed` | `boolean` | Indicates whether request payload was modified by compaction. | `true` |
| `x-echoregent-protected` | `boolean` | Indicates whether policy detected sensitive domains and bypassed compaction. | `false` |
| `x-echoregent-reason` | `string` | Specific policy rule or transform applied. | `tool-output-compaction` |
| `x-echoregent-characters-removed` | `integer` | Exact count of characters eliminated from the outbound prompt. | `4120` |

---

### Dynamic Memory Scope Headers (`x-echoregent-project` & `x-echoregent-session`)

When running a shared `echoregent proxy` daemon, individual HTTP client requests to `/v1/responses`, `/v1/chat/completions`, or `/v1/messages` can dynamically supply or override memory scopes via HTTP request headers:
- `x-echoregent-project: <directory-path>` (e.g. `/workspace/repo-a`)
- `x-echoregent-session: <session-id>` (e.g. `agent-session-42`)

When both headers are provided, EchoRegent routes memory lookups and ingestion directly to that designated scope instead of server defaults. This allows a single local proxy instance to serve multiple git repositories, editor tabs, and concurrent coding agent sessions with strict namespace isolation.

---

### Copy-Pasteable `curl` Examples

#### 1. Provider Proxy: `POST /v1/responses`
Transparently intercepts verbose tool logs, applies lossless template factoring, and streams SSE chunks from the upstream provider:

```bash
curl -X POST http://127.0.0.1:8787/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "input": [
      { "role": "user", "content": "Analyze CI build logs" },
      { "role": "tool", "content": "[10:00:01] PASS tests/auth.test.ts (2ms)\n[10:00:02] PASS tests/db.test.ts (3ms)\n[10:00:03] PASS tests/api.test.ts (2ms)" }
    ],
    "stream": true
  }'
```

#### 2. Provider Proxy: `POST /v1/chat/completions`
Standard Chat Completions format with identical compaction and SSE pass-through:

```bash
curl -X POST http://127.0.0.1:8787/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ***" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      { "role": "system", "content": "You are a helpful assistant." },
      { "role": "user", "content": "Build status update" }
    ]
  }'
```

#### 3. Provider Proxy: `POST /v1/messages` (Claude Code / Anthropic Messages API)
Intercepts Anthropic Messages payloads, losslessly compacts `tool_result` content blocks, and injects cited memory into the top-level `system` prompt:

```bash
curl -X POST http://127.0.0.1:8787/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "x-echoregent-project: $(pwd)" \
  -H "x-echoregent-session: claude-session-1" \
  -d '{
    "model": "claude-3-7-sonnet-20250219",
    "max_tokens": 1024,
    "system": "You are a coding assistant.",
    "messages": [
      {
        "role": "user",
        "content": [
          {
            "type": "tool_result",
            "tool_use_id": "toolu_01",
            "content": "[10:00:01] PASS tests/auth.test.ts (2ms)\n[10:00:02] PASS tests/db.test.ts (3ms)\n[10:00:03] PASS tests/api.test.ts (2ms)"
          }
        ]
      }
    ]
  }'
```

#### 4. Explicit Compaction: `POST /compress`
Losslessly compacts repetitive logs or tabular outputs using 0 LLM tokens:

```bash
curl -X POST http://127.0.0.1:8787/compress \
  -H "Content-Type: application/json" \
  -d '{
    "text": "2026-11-22T10:00:01Z [worker-1] Job 101 status: ok\n2026-11-22T10:00:02Z [worker-2] Job 102 status: ok\n2026-11-22T10:00:03Z [worker-3] Job 103 status: ok"
  }'
```

*Response (`200 OK`):*
```json
{
  "text": "<template:\"<TIMESTAMP> [<WORKER>] Job <ID> status: ok\" count=3>\n  10:00:01Z, worker-1, 101\n  10:00:02Z, worker-2, 102\n  10:00:03Z, worker-3, 103",
  "ratio": 0.42,
  "charactersRemoved": 58,
  "changed": true
}
```

#### 5. Safety Policy Check: `POST /classify`
Evaluates deterministic domain routing and fail-closed protection (Medical, Legal, Crisis):

```bash
curl -X POST http://127.0.0.1:8787/classify \
  -H "Content-Type: application/json" \
  -d '{
    "text": "The patient was prescribed 50mg sertraline daily following consultation."
  }'
```

*Response (`200 OK`):*
```json
{
  "domain": "medical",
  "policy": {
    "protected": true,
    "allowCompression": false,
    "allowMemory": false,
    "reason": "sensitive-domain-detected:medical"
  }
}
```

#### 6. Scoped Memory: `POST /memory/remember`
Writes an atomic, human-auditable fact with mandatory source citations (0 LLM write cost):

```bash
curl -X POST http://127.0.0.1:8787/memory/remember \
  -H "Content-Type: application/json" \
  -d '{
    "fact": {
      "content": "Database migrations must execute via drizzle-kit migrate against PostgreSQL 16.",
      "sources": ["docs/architecture/database.md:42", "scripts/migrate.ts:15"]
    },
    "context": "database setup instructions"
  }'
```

*Response (`200 OK`):*
```json
{
  "id": "fact_01j9x7k5m8p2q3r4s5t6u7v8w9",
  "content": "Database migrations must execute via drizzle-kit migrate against PostgreSQL 16.",
  "sources": ["docs/architecture/database.md:42", "scripts/migrate.ts:15"],
  "createdAt": "2026-11-22T10:15:30.000Z",
  "expiresAt": "2026-12-06T10:15:30.000Z"
}
```

#### 7. Scoped Memory: `POST /memory/recall`
Queries facts strictly scoped to the active project and session:

```bash
curl -X POST http://127.0.0.1:8787/memory/recall \
  -H "Content-Type: application/json" \
  -d '{
    "query": "PostgreSQL database migrations",
    "context": "deployment checks"
  }'
```

*Response (`200 OK`):*
```json
[
  {
    "id": "fact_01j9x7k5m8p2q3r4s5t6u7v8w9",
    "content": "Database migrations must execute via drizzle-kit migrate against PostgreSQL 16.",
    "sources": ["docs/architecture/database.md:42", "scripts/migrate.ts:15"],
    "createdAt": "2026-11-22T10:15:30.000Z",
    "expiresAt": "2026-12-06T10:15:30.000Z"
  }
]
```

#### 8. Scoped Memory: `POST /memory/update`
Updates fact content and citations while preserving original creation timestamp:

```bash
curl -X POST http://127.0.0.1:8787/memory/update \
  -H "Content-Type: application/json" \
  -d '{
    "id": "fact_01j9x7k5m8p2q3r4s5t6u7v8w9",
    "fact": {
      "content": "Database migrations must execute via drizzle-kit migrate against PostgreSQL 17.",
      "sources": ["docs/architecture/database.md:42", "rfc/004-pg17.md:10"]
    }
  }'
```

#### 9. Scoped Memory: `POST /memory/forget`
Deletes a specific fact by ID:

```bash
curl -X POST http://127.0.0.1:8787/memory/forget \
  -H "Content-Type: application/json" \
  -d '{
    "id": "fact_01j9x7k5m8p2q3r4s5t6u7v8w9"
  }'
```

*Response (`200 OK`):*
```json
{
  "deleted": true
}
```

#### 10. Scoped Memory: `POST /memory/purge`
Purges all facts and index files in the current scope:

```bash
curl -X POST http://127.0.0.1:8787/memory/purge \
  -H "Content-Type: application/json" \
  -d '{}'
```

*Response (`200 OK`):*
```json
{
  "deleted": 14
}
```

#### 11. Health Status: `GET /health`
Returns proxy status, deterministic engine flag, and live telemetry statistics:

```bash
curl -s http://127.0.0.1:8787/health
```

*Response (`200 OK`):*
```json
{
  "product": "echoregent",
  "version": "0.4.0",
  "mode": "deterministic",
  "telemetry": false,
  "models": [],
  "stats": {
    "requests": 28,
    "compressed": 19,
    "protected": 0,
    "errors": 0
  }
}
```

---

## 3. Model Context Protocol (MCP) Server (`echoregent mcp`)

Run EchoRegent as a standard Model Context Protocol (MCP) stdio server. This exposes 7 native tools to coding assistants and IDEs (Claude Code, Claude Desktop, Cursor, Windsurf, Hermes Agent), allowing models to classify text, compress logs on demand, and maintain source-cited memory wikis.

```bash
# Basic MCP server (memory off)
echoregent mcp

# Scoped persistent file memory MCP server
echoregent mcp \
  --memory file \
  --memory-dir ~/.echoregent/memory \
  --project $(pwd) \
  --session session-default \
  --retention-days 14
```

### The 7 Native MCP Tools

| Tool | Parameters | Description |
|---|---|---|
| **`classify`** | `text` *(string)* | Evaluates deterministic domain classification and fail-closed safety policy (Medical, Legal, Crisis). |
| **`compress`** | `text` *(string)* | Explicitly compresses repeated logs or tabular text using lossless template factoring. Protected content is preserved. |
| **`remember`** | `content` *(string)*<br>`sources` *(string[])*<br>`context` *(optional string)* | Stores a cited fact in the current project/session scope. (Memory must be enabled). |
| **`recall`** | `query` *(string)*<br>`context` *(optional string)* | Retrieves cited facts matching query keywords strictly from the current project/session scope. |
| **`update`** | `id` *(string)*<br>`content` *(string)*<br>`sources` *(string[])*<br>`context` *(optional string)* | Replaces an existing fact's content and citations within the current scope. |
| **`forget`** | `id` *(string)* | Deletes a single fact by ID within the current scope. |
| **`purge`** | *(none)* | Deletes all facts and indexes within the current scope. |

---

### Copy-Pasteable Client Configurations

#### Claude Code

**Mode 1 — Native HTTP Proxy Mode (Zero Client Edits):**  
Start the proxy in autonomous mode (`echoregent proxy --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory`), then launch Claude Code:
```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
```
EchoRegent transparently intercepts `POST /v1/messages`, compacts verbose `tool_result` blocks in `<5ms`, injects cited project memory into top-level `system`, and adapts pattern weights online.

**Mode 2 — Stdio MCP Server:**  
Add via Claude Code CLI:
```bash
claude mcp add echoregent -- echoregent mcp --memory file --memory-dir ~/.echoregent/memory --retention-days 14
```

Or add directly to `~/.claude/mcp.json`:
```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": ["mcp", "--memory", "file", "--memory-dir", "~/.echoregent/memory", "--retention-days", "14"]
    }
  }
}
```

#### Claude Desktop
Add to `claude_desktop_config.json` (macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`; Windows: `%APPDATA%\Claude\claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": [
        "mcp",
        "--memory", "file",
        "--memory-dir", "/Users/username/.echoregent/memory",
        "--retention-days", "14"
      ]
    }
  }
}
```

#### Cursor IDE
Add to `.cursor/mcp.json` in your workspace root, or navigate to **Settings > Features > MCP**:

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": ["mcp"]
    }
  }
}
```

#### Windsurf IDE
Add to `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": ["mcp"]
    }
  }
}
```

#### Hermes Agent
Add to `~/.hermes/config.yaml` under `mcp_servers`:

```yaml
mcp_servers:
  echoregent:
    command: echoregent
    args:
      - mcp
      - --memory
      - file
      - --memory-dir
      - ~/.echoregent/memory
      - --retention-days
      - "14"
```

---

## 4. Diagnostics & Security Boundary

### Diagnostics Suite

#### `echoregent doctor`
Validates local proxy connectivity, verifies that the proxy is running in pure deterministic mode, and optionally executes a live provider probe.

```bash
# Check local proxy health on default port 8787 (free, no provider API calls)
echoregent doctor

# Check proxy on a custom URL
echoregent doctor --url http://127.0.0.1:9000

# Execute a live end-to-end routing probe to upstream provider
# WARNING: This sends one minimal billable request to verify authentication & model access
export OPENAI_API_KEY="sk-..."
echoregent doctor --probe --model gpt-4o-mini
```

*Sample Probe Output:*
```text
Proxy healthy; deterministic mode; telemetry off; no model downloads.
Responses request routed through EchoRegent successfully.
```

#### `echoregent models`
Inspects installed model integrations and engine rules:

```bash
echoregent models
```

*Output:*
```text
Rules only. No model weights are installed, downloaded, or required. Optional model integrations are not shipped in 0.4.0; see MODEL_LICENSES.md.
```

---

### Security Boundary & Private Control Surface

EchoRegent is engineered as a private local middleware layer, not an open multi-tenant server. It implements rigorous defense-in-depth controls:

1. **Strict `127.0.0.1` Loopback Binding**
   - The proxy and diagnostics listeners bind exclusively to IPv4 loopback (`127.0.0.1`).
   - It will never bind to `0.0.0.0` or expose public network interfaces.

2. **Browser Isolation & Anti-CSRF Guardrails**
   - Modern web browsers can be weaponized via DNS rebinding or cross-origin scripts to probe local ports.
   - EchoRegent inspects incoming request headers: any request containing an `Origin` header, or where `Sec-Fetch-Site` is present and not `'none'`, is rejected with `403 Forbidden`:
     ```json
     { "error": "Browser origins are not allowed" }
     ```
   - Only CLI tools, SDK clients, and terminal processes can communicate with the proxy.

3. **Local Token Authorization (`--local-token`)**
   - Pass `--local-token <token>` or export `ECHOREGENT_LOCAL_TOKEN`.
   - When configured, all incoming HTTP requests must supply the identical secret via the `x-echoregent-local-token` header, or the proxy rejects with `401 Unauthorized`.

4. **Namespace Scope Isolation**
   - Memory operations require an explicit `--project` and `--session`.
   - Callers cannot switch scopes or traverse arbitrary directory paths at runtime. File memory writes are sandboxed using hashed scope namespaces and atomic file locks.

5. **Fail-Closed Safety Policy**
   - Prompts containing sensitive domains (Medical, Legal, Crisis) are automatically detected by deterministic policy gates.
   - Compression and memory ingestion are immediately bypassed (`x-echoregent-protected: true`), ensuring exact, verbatim forwarding to the provider.

6. **Zero Telemetry Guarantee**
   - EchoRegent performs **zero remote telemetry**, collects zero analytics, and makes zero background network requests. All transformations occur locally in-memory.

---

## License

MIT License. See [LICENSE](https://github.com/ashy5454/echoregent/blob/main/LICENSE) for details.  
Model licensing and third-party notices: [MODEL_LICENSES.md](https://github.com/ashy5454/echoregent/blob/main/MODEL_LICENSES.md).
