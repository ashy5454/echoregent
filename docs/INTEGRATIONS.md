# EchoRegent Agent & SDK Integration Cookbook

> **Self-serve integration recipes for every major AI coding agent, developer IDE, and LLM SDK.**  
> Cut prompt tokens by 30% to 60% with zero-overhead deterministic log compaction, online continual learning, fail-closed policy controls, and local source-cited LLM-Wiki memory.

[![npm core](https://img.shields.io/npm/v/@arkadhi/echoregent-core?color=cb3837&label=@arkadhi/echoregent-core)](https://www.npmjs.com/package/@arkadhi/echoregent-core)
[![npm cli](https://img.shields.io/npm/v/@arkadhi/echoregent?color=cb3837&label=@arkadhi/echoregent)](https://www.npmjs.com/package/@arkadhi/echoregent)
[![Node: >=22.12](https://img.shields.io/badge/Node->=22.12-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/ashy5454/echoregent/blob/main/LICENSE)
[![Zero Telemetry](https://img.shields.io/badge/Telemetry-Zero%20Calls-success.svg)](https://github.com/ashy5454/echoregent/blob/main/SECURITY.md)
[![Zero Model Weights](https://img.shields.io/badge/Weights-Zero%20Bundled-blueviolet.svg)](https://github.com/ashy5454/echoregent/blob/main/MODEL_LICENSES.md)

---

## Table of Contents

- [Architectural Overview & Integration Matrix](#architectural-overview--integration-matrix)
- [Recipe 1: OpenAI Codex CLI](#recipe-1-openai-codex-cli)
  - [Overview & Non-Destructive Launcher](#11-overview--non-destructive-launcher)
  - [Interactive Session](#12-interactive-session)
  - [Non-Interactive & Batch Tasks](#13-non-interactive--batch-tasks)
  - [Configuration Flags & Mechanics](#14-configuration-flags--mechanics)
  - [Exit Telemetry & Verification](#15-exit-telemetry--verification)
- [Recipe 2: Claude Code](#recipe-2-claude-code)
  - [Mode A: Native HTTP Proxy Mode (`ANTHROPIC_BASE_URL`)](#21-mode-a-native-http-proxy-mode-anthropic_base_url)
  - [Mode B: Model Context Protocol (MCP) Integration](#22-mode-b-model-context-protocol-mcp-integration)
  - [Verifying Compaction & Tool Execution](#23-verifying-compaction--tool-execution)
- [Recipe 3: Cursor & Windsurf IDEs](#recipe-3-cursor--windsurf-ides)
  - [Mode A: MCP Server Setup (Cursor & Windsurf)](#31-mode-a-mcp-server-setup-cursor--windsurf)
  - [Mode B: OpenAI Base URL Override (Transparent Proxy)](#32-mode-b-openai-base-url-override-transparent-proxy)
  - [Streaming & Verification](#33-streaming--verification)
- [Recipe 4: Hermes Agent](#recipe-4-hermes-agent)
  - [MCP Server Setup (`config.yaml`)](#41-mcp-server-setup-configyaml)
  - [Custom Provider Endpoint Setup](#42-custom-provider-endpoint-setup)
  - [Testing & Health Check](#43-testing--health-check)
- [Recipe 5: OpenAI Python SDK](#recipe-5-openai-python-sdk)
  - [Drop-in Base URL Redirection](#51-drop-in-base-url-redirection)
  - [Full Python Client with Scoped Memory](#52-full-python-client-with-scoped-memory)
  - [Streaming & Response Header Auditing](#53-streaming--response-header-auditing)
- [Recipe 6: OpenAI Node / TypeScript SDK & Vercel AI SDK](#recipe-6-openai-node--typescript-sdk--vercel-ai-sdk)
  - [Approach A: Local HTTP Proxy Mode](#61-approach-a-local-http-proxy-mode)
  - [Approach B: In-Process `@arkadhi/echoregent-core` Middleware (Zero Daemon)](#62-approach-b-in-process-echoregentcore-middleware-zero-daemon)
  - [Vercel AI SDK Integration (`ai` + `@ai-sdk/openai`)](#63-vercel-ai-sdk-integration-ai--ai-sdkopenai)
- [Recipe 7: Continual Learning Loop Recipe](#recipe-7-continual-learning-loop-recipe)
  - [First-Principles Biological Motivation](#71-first-principles-biological-motivation)
  - [The Local Delta-Rule & Structural Signatures](#72-the-local-delta-rule--structural-signatures)
  - [Full Autonomous Agent Loop Implementation](#73-full-autonomous-agent-loop-implementation)
  - [Knowledge Graph Evolution: `updates` vs `extends`](#74-knowledge-graph-evolution-updates-vs-extends)
  - [Human-Auditable Markdown LLM-Wiki Directory Structure](#75-human-auditable-markdown-llm-wiki-directory-structure)

---

## Architectural Overview & Integration Matrix

EchoRegent operates as a **local, private context management layer** positioned directly between your autonomous agent / application logic and upstream LLM providers (OpenAI, Anthropic, local vLLM/Ollama).

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Agent & Application Ecosystem                         │
│  Codex CLI │ Claude Code │ Cursor │ Windsurf │ Hermes │ Python │ Node / Vercel │
└──────┬────────────┬──────────┬──────────┬─────────┬────────┬───────┬────────┘
       │            │          │          │         │        │       │
       ▼            ▼          ▼          ▼         ▼        ▼       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                    EchoRegent Integration Modalities                        │
│                                                                             │
│  [1] CLI Wrap     [2] Stdio MCP Server       [3] HTTP Loopback Proxy        │
│  `wrap codex`     `echoregent mcp`           `http://127.0.0.1:8787/v1`     │
│                   7 native tools:            `/v1/responses`                │
│                   classify, compress,        `/v1/chat/completions`         │
│                   remember, recall,          `/memory/*`, `/compress`       │
│                   update, forget, purge                                     │
│                                                                             │
│  [4] In-Process Core SDK Middleware: `import { EchoRegent } from '@arkadhi/echoregent-core'`
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Core Processing Pipeline                            │
│                                                                             │
│  1. Fail-Closed Policy Gate   ──> Medical / Legal / Crisis ? Bypasses       │
│  2. Adaptive Compactor        ──> Local Delta Rule: w_k < θ ? Protected    │
│  3. Template Factoring        ──> Lossless compaction of repeated logs     │
│  4. Conversation Compactor    ──> Factoring older turns (>= 8 preserved)   │
│  5. LLM-Wiki Memory Layer     ──> Scoped facts (`updates` / `extends`)     │
└──────────────────────────────────────┬──────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Upstream Provider API (HTTPS)                         │
│             OpenAI API │ Azure OpenAI │ OpenCode │ Self-Hosted              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Integration Capabilities Matrix

| Agent / SDK | Primary Modality | Secondary Modality | Tool Compression | Memory Injection | Auto-Compaction |
|---|---|---|:---:|:---:|:---:|
| **OpenAI Codex CLI** | `echoregent wrap codex` | `echoregent proxy` | Yes (Lossless) | Yes (`--inject-memory`) | Yes (`--compact-history` + `--adaptive-compression`) |
| **Claude Code** | Native Proxy (`ANTHROPIC_BASE_URL`) | MCP (`claude mcp add`) | Yes (Proxy & MCP) | Yes (Wiki memory) | Yes (Proxy mode) |
| **Cursor IDE** | Base URL override | MCP (`.cursor/mcp.json`) | Yes (Proxy) | Yes (MCP) | Yes (Proxy mode) |
| **Windsurf IDE** | Base URL override | MCP (`mcp_config.json`) | Yes (Proxy) | Yes (MCP) | Yes (Proxy mode) |
| **Hermes Agent** | MCP (`config.yaml`) | Custom provider endpoint | Yes (MCP & Proxy) | Yes (Wiki memory) | Yes (Proxy mode) |
| **OpenAI Python SDK** | `base_url="http://127.0.0.1:8787/v1"` | REST API (`/memory/*`) | Yes (Transparent) | Yes (REST endpoints) | Yes (Transparent) |
| **OpenAI Node SDK** | In-Process `@arkadhi/echoregent-core` | Proxy (`http://127.0.0.1:8787/v1`) | Yes (In-process/Proxy) | Yes (In-process/REST) | Yes (In-process/Proxy) |
| **Vercel AI SDK** | `createOpenAI({ baseURL })` | Custom `fetch` middleware | Yes (Transparent) | Yes (Pre-process hook) | Yes (Transparent) |
| **Custom Agent Loops** | `AdaptiveCompressionLearner` + `WikiMemory` | In-process Core SDK | Yes (Online Plasticity)| Yes (`updates`/`extends`)| Yes (Full Lifecycle) |

---

## Recipe 1: OpenAI Codex CLI

### 1.1 Overview & Non-Destructive Launcher

The official OpenAI Codex CLI operates against the OpenAI Responses API wire protocol. `echoregent wrap codex` provides a zero-setup, non-destructive execution wrapper.

#### Key Mechanics
- **Dynamic Configuration Injection**: Spawns an ephemeral loopback HTTP proxy on a random available port and injects per-launch `-c` overrides into the spawned Codex process:
  ```text
  model_provider="echoregent"
  model_providers.echoregent.name="EchoRegent local proxy"
  model_providers.echoregent.base_url="http://127.0.0.1:<port>/v1"
  model_providers.echoregent.wire_api="responses"
  model_providers.echoregent.env_key="ECHOREGENT_PROVIDER_KEY"
  model_providers.echoregent.requires_openai_auth=false
  model_providers.echoregent.supports_websockets=false
  ```
- **Zero Persistent File Edits**: Does **not** edit `~/.codex/config.toml`, shell profiles, or system environment variables.
- **WebSocket Disablement**: Sets `supports_websockets=false` to force HTTP/SSE streaming so request payloads flow through the local compaction engine.
- **Routing Protection**: Forbids CLI flags that would override provider routing (e.g., `-c`, `-p`, `--config`, `--profile`, `--oss`, `--local-provider`).
- **Clean Exit**: Exiting Codex automatically terminates the proxy. Running `echoregent unwrap` confirms that no system settings require restoration.

### 1.2 Interactive Session

Launch interactive Codex with history compaction, scoped memory injection, online adaptive plasticity, auto-learning, and project-wide memory:

```bash
# Set your OpenAI API key
export OPENAI_API_KEY="sk-..."

# Launch wrapped Codex session with full autonomous context optimization
echoregent wrap codex \
  --compact-history \
  --inject-memory \
  --adaptive-compression \
  --auto-memory \
  --project-memory
```

On Windows (Git Bash / Command Prompt / PowerShell):
```powershell
$env:OPENAI_API_KEY="sk-..."
echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```

### 1.3 Non-Interactive & Batch Tasks

Pass flags and subcommands directly to Codex using the `--` separator:

```bash
# Execute a specific coding task
echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory -- \
  exec "Run npm test, fix all type errors in src/, and verify tests pass"

# Pass custom model and approval flags
echoregent wrap codex --compact-history --adaptive-compression -- \
  --model o3-mini --full-auto exec "Refactor packages/core/src/classifier.ts"
```

### 1.4 Configuration Flags & Mechanics

| Flag | Default | Description |
|---|---|---|
| `--upstream <URL>` | `https://api.openai.com/v1` | Upstream Responses API endpoint (or `ECHOREGENT_UPSTREAM`). |
| `--compact-history` | `false` | Enables lossless template factoring across older conversation turns. Always preserves the latest user turn and at least the last 8 items verbatim. |
| `--inject-memory` | `false` | Injects active source-cited facts from the project/session scope as a developer message in the Responses input array. |
| `--adaptive-compression` | `false` | Enables online synaptic plasticity learning via Local Delta Rule; auto-protects patterns with downstream regret. |
| `--auto-memory` | `false` | Enables autonomous zero-LLM-call fact learning from user turns into the scoped LLM-Wiki. |
| `--project-memory` | `false` | Scopes memory across all sessions in the project root (`session: '__project__'`). |
| `-- <codex args>` | `[]` | Forwards all trailing arguments to the underlying Codex executable. |

### 1.5 Exit Telemetry & Verification

When Codex finishes, `wrap` outputs an audit summary to `stderr`:

```text
EchoRegent proxy: http://127.0.0.1:58432/v1 (rules only; memory off; telemetry off)
... [Codex execution output] ...
EchoRegent routing: 18 provider request(s), 11 compressed, 0 protected.
```

If Codex terminates with exit code 0 without routing any requests through the proxy (and `--help` or `--version` was not called), `wrap` exits with an error indicating routing was unverified.

---

## Recipe 2: Claude Code

Claude Code can be integrated in two powerful modalities:
1. **Mode A (Native HTTP Proxy Mode — Recommended)**: Transparently routes Claude Code's Anthropic Messages API requests (`POST /v1/messages`) through EchoRegent via `ANTHROPIC_BASE_URL=http://127.0.0.1:8787`. Zero configuration file edits, lossless compaction of `tool_result` content blocks, online adaptive plasticity, autonomous fact learning, and project-wide memory.
2. **Mode B (Model Context Protocol / MCP Mode)**: Exposes EchoRegent's 7 compression, classification, and memory tools directly to Claude Code as native MCP tool calls.

### 2.1 Mode A: Native HTTP Proxy Mode (`ANTHROPIC_BASE_URL`)

Claude Code natively supports overriding its Anthropic API endpoint via the standard `ANTHROPIC_BASE_URL` environment variable. Because EchoRegent includes native proxy support for Anthropic's `POST /v1/messages` protocol, Claude Code can run through EchoRegent with zero extra bridges or gateways.

#### Step 1: Start the Local Proxy with Autonomous Context Management

In your project directory or in a background terminal, launch `echoregent proxy`:

```bash
echoregent proxy --port 8787 \
  --compact-history \
  --inject-memory \
  --adaptive-compression \
  --auto-memory \
  --project-memory \
  --memory file \
  --memory-dir ~/.echoregent/memory \
  --retention-days 30
```

#### Step 2: Launch Claude Code with `ANTHROPIC_BASE_URL`

Point Claude Code's API traffic to the local EchoRegent proxy:

```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
claude
```

Or as a single launch command:
```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
```

On Windows (Git Bash):
```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
```

On Windows (PowerShell):
```powershell
$env:ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
claude
```

#### How EchoRegent Optimizes Claude Code Wire Traffic
- **Lossless `tool_result` Compaction**: When Claude Code runs tools (e.g., bash test suites, git diffs, file searches), the tool outputs are sent in user content blocks with `type: 'tool_result'`. EchoRegent detects these blocks and compacts repetitive logs into numeric templates in `<5ms`, reducing prompt token bills by 30% to 60%.
- **Top-Level `system` Prompt Memory Injection**: When `--inject-memory` is active, EchoRegent queries the project's LLM-Wiki, formats relevant facts into `[EchoRegent LLM-Wiki Memory Context]`, and injects them directly into top-level `request.system`. Previous turns' injected memory blocks are stripped and deduplicated automatically.
- **Autonomous Zero-Cost Fact Learning (`--auto-memory`)**: EchoRegent inspects incoming user prompts and automatically extracts architectural constraints into the LLM-Wiki via `wikiMemory.autoIngestTurnSync()` with 0 external LLM calls.
- **Online Synaptic Plasticity (`--adaptive-compression`)**: Tracks assistant `tool_use` blocks and subsequent user prompts. If regret or repeated tool calls are detected, the pattern signature's utility weight is updated via the Local Delta Rule ($w_k < 0.45$ is permanently protected).
- **Project-Wide Memory (`--project-memory`)**: All Claude Code sessions inside the same workspace share a single durable knowledge base scoped to `{ project, session: '__project__' }`.

### 2.2 Mode B: Model Context Protocol (MCP) Integration

If you prefer explicit tool calling where Claude Code decides when to compact logs or save architectural decisions into memory, connect EchoRegent as an MCP stdio server.

#### Step 1: Add EchoRegent via Claude CLI

```bash
claude mcp add echoregent -- echoregent mcp \
  --memory file \
  --memory-dir ~/.echoregent/memory \
  --retention-days 14
```

#### Step 2: Or Configure Directly in `~/.claude/mcp.json`

Create or update `~/.claude/mcp.json` (or your project's `.claude/mcp.json`):

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": [
        "mcp",
        "--memory", "file",
        "--memory-dir", "~/.echoregent/memory",
        "--retention-days", "14"
      ]
    }
  }
}
```

#### Step 3: Available Tools in Claude Code

Once added, Claude Code has access to 7 deterministic tools:

| Tool Name | Parameters | Behavior |
|---|---|---|
| `classify` | `text` *(string)* | Evaluates domain and checks fail-closed policy (medical, legal, crisis). |
| `compress` | `text` *(string)* | Compresses repetitive compiler/test output losslessly. Preserves protected content. |
| `remember` | `content` *(string)*, `sources` *(string[])*, `context` *(optional string)* | Persists a fact with mandatory source citations into the project/session scope. |
| `recall` | `query` *(string)*, `context` *(optional string)* | Retrieves relevant facts ranked by keyword matching without conversational stopwords. |
| `update` | `id` *(string)*, `content` *(string)*, `sources` *(string[])*, `context` *(optional string)* | Updates content/sources of an existing fact. |
| `forget` | `id` *(string)* | Deletes a single fact by ID. |
| `purge` | *(none)* | Wipes all facts within the active project/session scope. |

#### Claude Code Usage Prompt Example
```text
Run the vitest test suite. If the output exceeds 50 lines, call the echoregent `compress`
tool on the output before analyzing failures. If you establish a architectural invariant,
call `remember` with content and source file citations.
```

### 2.3 Verifying Compaction & Tool Execution

Check that the proxy is actively intercepting and compacting:

```bash
curl -s http://127.0.0.1:8787/health | jq
```

Response:
```json
{
  "product": "echoregent",
  "version": "0.4.0",
  "mode": "deterministic",
  "telemetry": false,
  "models": [],
  "stats": {
    "requests": 14,
    "compressed": 9,
    "protected": 0,
    "errors": 0
  }
}
```

---

## Recipe 3: Cursor & Windsurf IDEs

Both Cursor and Windsurf support Model Context Protocol (MCP) servers and OpenAI API base URL overrides.

### 3.1 Mode A: MCP Server Setup (Cursor & Windsurf)

#### Cursor Configuration (`.cursor/mcp.json`)
Create `.cursor/mcp.json` in your workspace root:

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": [
        "mcp",
        "--memory", "file",
        "--memory-dir", "${env:HOME}/.echoregent/memory",
        "--retention-days", "14"
      ]
    }
  }
}
```

#### Windsurf Configuration (`~/.codeium/windsurf/mcp_config.json`)
Open Windsurf Settings > MCP, or edit `~/.codeium/windsurf/mcp_config.json`:

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "echoregent",
      "args": [
        "mcp",
        "--memory", "file",
        "--memory-dir", "~/.echoregent/memory",
        "--retention-days", "14"
      ]
    }
  }
}
```

### 3.2 Mode B: OpenAI Base URL Override (Transparent Proxy)

To compress all prompt traffic (agent commands, linter output, multi-file diffs) before it reaches OpenAI, route Cursor or Windsurf through the local EchoRegent proxy.

#### Step 1: Start the Local Proxy
```bash
echoregent proxy --port 8787 --compact-history
```

#### Step 2: Configure IDE Settings

**In Cursor**:
1. Open **Cursor Settings** (`Cmd+,` or `Ctrl+,`).
2. Navigate to **Models** > **OpenAI API Key**.
3. Set your API Key (`sk-...`).
4. Click **Override OpenAI Base URL**.
5. Set the Base URL to:
   ```text
   http://127.0.0.1:8787/v1
   ```
6. Toggle **Override Base URL** to **ON**.

**In Windsurf (Cascade)**:
1. Open **Settings** > **Model Providers**.
2. Select **OpenAI**.
3. Set **API Base URL** to `http://127.0.0.1:8787/v1`.

### 3.3 Streaming & Verification

EchoRegent's proxy supports transparent SSE streaming:
- Token chunks (`data: {"choices": [{"delta": {"content": "..."}}]}`) pass through with zero buffering or added latency.
- Upstream response headers are augmented with:
  ```http
  x-echoregent-compressed: true
  x-echoregent-protected: false
  ```
- Any repetitive compiler errors, long log output, or verbose grep results generated during Composer / Cascade tasks are compacted prior to hitting OpenAI's billed endpoints.

---

## Recipe 4: Hermes Agent

[Hermes Agent](https://hermes-agent.nousresearch.com/docs) by Nous Research natively supports MCP tools and custom OpenAI-compatible provider endpoints.

### 4.1 MCP Server Setup (`config.yaml`)

Add EchoRegent under the `mcp_servers` section of your Hermes profile configuration (`~/.hermes/config.yaml` or `%APPDATA%\hermes\config.yaml`):

```yaml
mcp_servers:
  echoregent:
    command: echoregent
    args:
      - mcp
      - --memory
      - file
      - --memory-dir
      - ~/.hermes/echoregent_memory
      - --retention-days
      - "30"
```

Verify in Hermes by issuing:
```bash
hermes tools list
```
The tools `classify`, `compress`, `remember`, `recall`, `update`, `forget`, and `purge` will appear in your available tools catalog.

### 4.2 Custom Provider Endpoint Setup

To route Hermes Agent's LLM calls through EchoRegent's compaction layer, declare an OpenAI-compatible provider in `config.yaml`:

```yaml
providers:
  echoregent_local:
    type: openai_compatible
    base_url: http://127.0.0.1:8787/v1
    api_key_env: OPENAI_API_KEY
    default_model: gpt-4o

model: echoregent_local/gpt-4o
```

Start the proxy daemon in the background or as a system service:
```bash
echoregent proxy --port 8787 --compact-history --inject-memory
```

### 4.3 Testing & Health Check

Test the route with `echoregent doctor`:
```bash
echoregent doctor --url http://127.0.0.1:8787
```

Output:
```text
Proxy healthy; deterministic mode; telemetry off; no model downloads.
Provider authentication and client routing are unverified; --probe --model NAME checks the Responses route.
```

Optional billable provider probe:
```bash
echoregent doctor --probe --model gpt-4o-mini
```

---

## Recipe 5: OpenAI Python SDK

Integrate Python applications, LangChain, LlamaIndex, or custom agents with EchoRegent using the official `openai` Python SDK.

### 5.1 Drop-in Base URL Redirection

Point the SDK to the local proxy. Zero code changes to completions or streaming:

```python
import os
from openai import OpenAI

# Initialize client pointing to EchoRegent local proxy
client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key=os.environ.get("OPENAI_API_KEY", "sk-mock-key-for-local"),
)

# Standard chat completion call
response = client.chat.completions.create(
    model="gpt-4o",
    messages=[
        {"role": "system", "content": "You are a senior build engineer."},
        {
            "role": "user",
            "content": (
                "Analyze these build logs:\n"
                "[2026-11-22 10:00:01] INFO Building target //src/core:engine (attempt 1)\n"
                "[2026-11-22 10:00:02] INFO Building target //src/core:engine (attempt 2)\n"
                "[2026-11-22 10:00:03] INFO Building target //src/core:engine (attempt 3)\n"
                "[2026-11-22 10:00:04] ERROR Linker failed with code 1\n"
            ),
        },
    ],
)

print(response.choices[0].message.content)
```

### 5.2 Full Python Client with Scoped Memory

A complete Python helper class interacting with both the completions proxy and EchoRegent's REST memory endpoints:

```python
#!/usr/bin/env python3
"""
echoregent_client.py - Complete OpenAI Python SDK + EchoRegent Memory Client
"""

import os
from typing import Any, Dict, List, Optional
import requests
from openai import OpenAI


class EchoRegentAgent:
    def __init__(
        self,
        proxy_url: str = "http://127.0.0.1:8787",
        project_dir: Optional[str] = None,
        session_id: str = "python-agent-session-1",
        api_key: Optional[str] = None,
    ):
        self.proxy_url = proxy_url.rstrip("/")
        self.scope = {
            "project": os.path.abspath(project_dir or os.getcwd()),
            "session": session_id,
        }
        self.client = OpenAI(
            base_url=f"{self.proxy_url}/v1",
            api_key=api_key or os.environ.get("OPENAI_API_KEY", "sk-echoregent"),
        )

    # 1. Scoped Memory: Remember
    def remember(
        self,
        content: str,
        sources: List[str],
        relation: Optional[str] = None,
        supersedes_id: Optional[str] = None,
        context: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Stores a cited fact in the scoped LLM-Wiki."""
        payload = {
            "scope": self.scope,
            "fact": {
                "content": content,
                "sources": sources,
            },
            "context": context,
        }
        if relation and supersedes_id:
            payload["fact"]["relation"] = relation
            payload["fact"]["supersedesId"] = supersedes_id

        res = requests.post(
            f"{self.proxy_url}/memory/remember",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        res.raise_for_status()
        return res.json()

    # 2. Scoped Memory: Recall
    def recall(self, query: str, context: Optional[str] = None) -> List[Dict[str, Any]]:
        """Retrieves active cited facts matching query keywords."""
        payload = {
            "scope": self.scope,
            "query": query,
            "context": context,
        }
        res = requests.post(
            f"{self.proxy_url}/memory/recall",
            json=payload,
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        res.raise_for_status()
        return res.json()

    # 3. Explicit Compaction
    def compress_text(self, text: str) -> Dict[str, Any]:
        """Compresses repetitive logs without calling any LLM."""
        res = requests.post(
            f"{self.proxy_url}/compress",
            json={"text": text, "scope": self.scope},
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        res.raise_for_status()
        return res.json()

    # 4. Domain & Policy Classification
    def classify(self, text: str) -> Dict[str, Any]:
        """Evaluates fail-closed safety policy (Medical, Legal, Crisis)."""
        res = requests.post(
            f"{self.proxy_url}/classify",
            json={"text": text, "scope": self.scope},
            headers={"Content-Type": "application/json"},
            timeout=10,
        )
        res.raise_for_status()
        return res.json()

    # 5. Execute Agent Turn
    def run_turn(self, prompt: str, tool_logs: Optional[str] = None) -> str:
        # Pre-recall relevant memories
        memories = self.recall(prompt)
        system_context = ""
        if memories:
            formatted = "\n".join(f"- {m['content']} ^[{', '.join(m['sources'])}]" for m in memories)
            system_context = f"[EchoRegent Scoped Memory]\n{formatted}\n"

        messages = []
        if system_context:
            messages.append({"role": "system", "content": system_context})

        user_content = prompt
        if tool_logs:
            user_content += f"\n\n```log\n{tool_logs}\n```"
        messages.append({"role": "user", "content": user_content})

        response = self.client.chat.completions.create(
            model="gpt-4o",
            messages=messages,
        )
        return response.choices[0].message.content or ""


if __name__ == "__main__":
    agent = EchoRegentAgent()

    # 1. Remember architectural constraint
    fact = agent.remember(
        content="All microservices communicate via gRPC on port 50051",
        sources=["docs/arch.md:12"],
    )
    print(f"Stored Fact: {fact.get('id')}")

    # 2. Run agent turn
    reply = agent.run_turn("What protocol and port should new backend services use?")
    print(f"Agent Reply:\n{reply}")
```

### 5.3 Streaming & Response Header Auditing

Inspect proxy headers in Python using `with_raw_response`:

```python
from openai import OpenAI

client = OpenAI(base_url="http://127.0.0.1:8787/v1")

# Use raw response wrapper to inspect headers
raw = client.chat.completions.with_raw_response.create(
    model="gpt-4o",
    messages=[{"role": "user", "content": "Ping"}],
)

headers = raw.headers
print("x-echoregent-compressed:", headers.get("x-echoregent-compressed"))
print("x-echoregent-protected:", headers.get("x-echoregent-protected"))

completion = raw.parse()
print(completion.choices[0].message.content)
```

---

## Recipe 6: OpenAI Node / TypeScript SDK & Vercel AI SDK

### 6.1 Approach A: Local HTTP Proxy Mode

Configure the official `openai` npm package to direct requests to the EchoRegent proxy:

```typescript
import OpenAI from 'openai'

const openai = new OpenAI({
  baseURL: 'http://127.0.0.1:8787/v1',
  apiKey: process.env.OPENAI_API_KEY,
})

async function main() {
  const stream = await openai.chat.completions.create({
    model: 'gpt-4o',
    messages: [
      { role: 'system', content: 'You are an autonomous debugging agent.' },
      { role: 'user', content: 'Check test output:\n' + 'PASS test/unit.js\n'.repeat(50) },
    ],
    stream: true,
  })

  for await (const chunk of stream) {
    process.stdout.write(chunk.choices[0]?.delta?.content || '')
  }
}

main().catch(console.error)
```

### 6.2 Approach B: In-Process `@arkadhi/echoregent-core` Middleware (Zero Daemon)

For applications that prefer zero background processes, embed `@arkadhi/echoregent-core` directly into your application process:

```bash
npm install @arkadhi/echoregent-core openai
```

```typescript
import { EchoRegent, type MemoryScope } from '@arkadhi/echoregent-core'
import OpenAI from 'openai'

// 1. Initialize in-process engine
const engine = new EchoRegent({
  compactHistory: true,
  injectMemory: true,
  memory: {
    mode: 'file',
    directory: './.echoregent-memory',
    retentionMs: 14 * 86_400_000,
  },
})

const scope: MemoryScope = {
  project: process.cwd(),
  session: 'ts-agent-session-42',
}

// 2. Wrap standard fetch to transparently pre-process payloads
const customFetch: typeof fetch = async (url, init) => {
  if (init?.body && typeof init.body === 'string') {
    const parsed = JSON.parse(init.body)

    // Determine wire protocol
    const urlStr = url.toString()
    const protocol = urlStr.includes('/responses') ? 'responses' : 'chat-completions'

    // Run deterministic compaction & memory injection in-process
    const decision = engine.process(parsed, protocol, scope)

    if (decision.changed) {
      init = {
        ...init,
        body: JSON.stringify(decision.request),
      }
    }
  }

  return fetch(url, init)
}

// 3. Initialize OpenAI client with custom fetch
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  fetch: customFetch,
})

async function run() {
  const response = await openai.chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'user', content: 'Analyze build logs:\n' + 'Step 1/10: npm install\n'.repeat(20) },
    ],
  })

  console.log(response.choices[0].message.content)
}

run().catch(console.error)
```

### 6.3 Vercel AI SDK Integration (`ai` + `@ai-sdk/openai`)

The [Vercel AI SDK](https://sdk.vercel.ai/) integrates seamlessly via a custom OpenAI provider instance:

```bash
npm install ai @ai-sdk/openai
```

```typescript
import { createOpenAI } from '@ai-sdk/openai'
import { streamText } from 'ai'

// Point provider to EchoRegent local proxy
const customOpenAI = createOpenAI({
  baseURL: 'http://127.0.0.1:8787/v1',
  apiKey: process.env.OPENAI_API_KEY,
})

export async function POST(req: Request) {
  const { messages } = await req.json()

  // Tool outputs and long logs in messages are compacted on the wire
  const result = streamText({
    model: customOpenAI('gpt-4o'),
    messages,
  })

  return result.toDataStreamResponse()
}
```

---

## Recipe 7: Continual Learning Loop Recipe

Wiring `AdaptiveCompressionLearner` and `WikiMemory` with `relation: 'updates' | 'extends'` into a custom agent execution loop.

### 7.1 First-Principles Biological Motivation

Autonomous agents repeatedly execute CLI commands, database queries, and test runners that output verbose, structurally repetitive logs. Static heuristics either fail to capture project-specific patterns or strip critical error lines. Secondary LLM summarization adds $500\text{ms}$ latency and extra token costs.

EchoRegent implements an **online, continual learning compression engine** grounded in predictive coding (Rao & Ballard 1999; Friston 2005) and synaptic plasticity:
- **Structural Invariants**: Canonical structural signatures $\sigma(L)$ normalize dynamic tokens (timestamps, hex addresses, numbers) while preserving syntax.
- **Parametric Utility Tracking**: Signatures maintain synaptic utility weights $w_k \in [0, 1]$.
- **Downstream Free Feedback**: The agent passively monitors Turn $t+1$. If the user says "show full logs" or the agent re-executes the exact same inspection command, **regret** is triggered ($target = 0.0$). If execution proceeds cleanly, **survival** is reinforced ($target = 1.0$).
- **Local Delta Rule**: Weights update via $w_k \leftarrow w_k + \eta (target - w_k)$. When $w_k < \theta$, the pattern is permanently protected from future compaction without backpropagation or model retraining.

### 7.2 The Local Delta-Rule & Structural Signatures

```
Raw Log Line:
"[2026-11-22 10:14:02.120] [INFO] Job 0x9a4f finished in 14ms"
                          │
                          ▼
Canonical Structural Signature σ(L):
"[<TS>] [INFO] Job <HEX> finished in <NUM>ms"
                          │
                          ▼
Utility Evaluation: w_k = 0.38 < θ (0.45)?
        ├── YES ──> Protected! Preserve line verbatim.
        └── NO  ──> Safe to compact consecutive identical runs.
```

### 7.3 Full Autonomous Agent Loop Implementation

The following complete, runnable TypeScript agent loop demonstrates:
1. Canonical structural pattern extraction.
2. Lossless compression with learned policy gating.
3. Turn $t+1$ downstream regret observation.
4. Local Delta-Rule plasticity updates.
5. Cross-session state persistence.

```typescript
import {
  AdaptiveCompressionLearner,
  EchoRegent,
  type MemoryScope,
  type TurnObservation,
  type ToolCallItem,
} from '@arkadhi/echoregent-core'
import OpenAI from 'openai'
import { writeFileSync, readFileSync, existsSync } from 'node:fs'

interface AgentTurnState {
  turnNumber: number
  userPrompt: string
  toolCalls: ToolCallItem[]
  rawToolOutput: string
  compressedToolOutput: string
  signaturesCompacted: string[]
}

export class ContinualLearningAgent {
  private learner: AdaptiveCompressionLearner
  private engine: EchoRegent
  private openai: OpenAI
  private scope: MemoryScope
  private stateFilePath = './agent-learner-state.json'
  private previousTurnState?: AgentTurnState

  constructor() {
    this.scope = {
      project: process.cwd(),
      session: 'continual-loop-session-1',
    }

    // 1. Initialize Adaptive Compression Learner (Workstream 2)
    this.learner = new AdaptiveCompressionLearner({
      learningRate: 0.35,          // η: local delta update rate
      protectionThreshold: 0.45,   // θ: utility below which patterns are protected
      initialWeight: 1.0,          // Default optimistic compression weight
      minRepeatCount: 4,           // Compact runs of >= 4 identical lines
    })

    // Load persisted learned weights if available
    if (existsSync(this.stateFilePath)) {
      const saved = readFileSync(this.stateFilePath, 'utf8')
      this.learner.loadState(saved)
      console.log('Restored learned structural weights from disk.')
    }

    // 2. Initialize EchoRegent Scoped Engine (or pass adaptiveCompression: true, autoLearnMemory: true, projectWideMemory: true)
    this.engine = new EchoRegent({
      compactHistory: true,
      injectMemory: true,
      adaptiveCompression: true,
      autoLearnMemory: true,
      projectWideMemory: true,
      memory: {
        mode: 'file',
        directory: './.echoregent-wiki',
        retentionMs: 30 * 86_400_000,
      },
    })

    this.openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  }

  /**
   * Turn execution with continual learning feedback loop.
   */
  async executeTurn(userPrompt: string, toolExecutionFn: () => Promise<{ calls: ToolCallItem[]; output: string }>) {
    console.log(`\n=== Turn Execution ===`)
    console.log(`User Prompt: "${userPrompt}"`)

    // Step A: Turn t+1 Passive Regret Observation for the PREVIOUS turn
    if (this.previousTurnState) {
      const observation: TurnObservation = {
        userPrompt,
        signatures: this.previousTurnState.signaturesCompacted,
      }

      const feedback = this.learner.observeTurn(observation)
      if (feedback.regretDetected) {
        console.warn(`[Regret Triggered] User requested full output or repeated inspection!`)
        if (feedback.newlyProtected.length > 0) {
          console.warn(`[Plasticity] Newly protected pattern signatures:`, feedback.newlyProtected)
        }
      } else {
        console.log(`[Survival Reinforced] Previous turn completed without regret.`)
      }

      // Persist state
      writeFileSync(this.stateFilePath, JSON.stringify(this.learner.exportState(), null, 2))
    }

    // Step B: Execute requested tool (e.g., test runner, build trace)
    const { calls, output: rawOutput } = await toolExecutionFn()

    // Step C: Compress tool output using Learned Policy Gating
    const compressedOutput = this.learner.compressWithLearnedPolicy(rawOutput)
    const signaturesCompacted = this.learner.getLastCompressedSignatures()

    console.log(`Tool Output: raw=${rawOutput.length} chars, compressed=${compressedOutput.length} chars.`)
    console.log(`Active Protected Signatures:`, this.learner.getProtectedSignatures())

    // Step D: Retrieve and format relevant LLM-Wiki context
    const wikiContext = this.engine.compileContextBlock(this.scope, userPrompt)

    // Step E: Construct Prompt and Call LLM
    const messages: OpenAI.ChatCompletionMessageParam[] = []
    if (wikiContext) {
      messages.push({ role: 'system', content: wikiContext })
    }
    messages.push({
      role: 'user',
      content: `${userPrompt}\n\nTool Output:\n${compressedOutput}`,
    })

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages,
    })

    const assistantReply = completion.choices[0].message.content || ''
    console.log(`LLM Response: ${assistantReply.slice(0, 100)}...`)

    // Save turn state for next turn's regret evaluation
    this.previousTurnState = {
      turnNumber: (this.previousTurnState?.turnNumber ?? 0) + 1,
      userPrompt,
      toolCalls: calls,
      rawToolOutput: rawOutput,
      compressedToolOutput: compressedOutput,
      signaturesCompacted,
    }

    return assistantReply
  }
}
```

### 7.4 Knowledge Graph Evolution: `updates` vs `extends`

EchoRegent's memory layer implements provenance-tracked knowledge evolution:
- **`relation: 'updates'` (Superseding)**: Used when a new architectural decision, bug fix, or dependency upgrade invalidates prior knowledge. The old fact is marked `supersededBy: newFact.id` and hidden from active keyword recall, while remaining preserved in the append-only `log.md` and historical records.
- **`relation: 'extends'` (Augmenting)**: Used when new findings add details or operational extensions to existing facts without invalidating them. Both facts remain active and searchable.

```typescript
import { EchoRegent, type MemoryScope } from '@arkadhi/echoregent-core'

const engine = new EchoRegent({
  memory: {
    mode: 'file',
    directory: './.echoregent-wiki',
    retentionMs: 30 * 86_400_000,
  },
})

const scope: MemoryScope = { project: process.cwd(), session: 'arch-session' }

async function evolveKnowledge() {
  // Step 1: Record initial architecture decision
  const v1 = await engine.remember(scope, {
    content: 'Database tier uses PostgreSQL 15 on port 5432 with pgvector.',
    sources: ['docs/rfcs/001-database.md:15'],
  })
  console.log(`Created Initial Fact [${v1.id}]`)

  // Step 2: Extend knowledge (augment without superseding)
  const ext = await engine.remember(scope, {
    content: 'Read replicas for PostgreSQL are provisioned in us-east-1 and us-west-2.',
    sources: ['docs/rfcs/002-replication.md:40'],
    relation: 'extends',
    supersedesId: v1.id,
  })
  console.log(`Created Extending Fact [${ext.id}]`)

  // Both facts are recalled
  const both = await engine.recall(scope, 'PostgreSQL')
  console.log(`Active facts count: ${both.length}`) // 2

  // Step 3: Upgrade decision superseding v1
  const v2 = await engine.remember(scope, {
    content: 'Database tier upgraded to PostgreSQL 16 on port 5432 with pgvector 0.7.0.',
    sources: ['docs/rfcs/005-pg16-upgrade.md:10'],
    relation: 'updates',
    supersedesId: v1.id,
  })
  console.log(`Created Updating Fact [${v2.id}], superseded [${v1.id}]`)

  // Active recall now returns v2 and ext, while v1 is hidden from active recall
  const activeFacts = await engine.recall(scope, 'PostgreSQL')
  console.log('Active facts after update:', activeFacts.map((f) => f.content))
}

evolveKnowledge().catch(console.error)
```

### 7.5 Human-Auditable Markdown LLM-Wiki Directory Structure

When file memory mode is enabled (`--memory file`), EchoRegent synchronizes the memory graph into a standard, Git-committable, human-readable directory:

```text
.echoregent-wiki/
└── <sha256-scope-hash>/
    ├── <sha256-scope-hash>.json          # Atomic machine-readable fact database
    ├── <sha256-scope-hash>.protected.json# Active policy protection marker (if any)
    └── wiki/
        ├── SCHEMA.md                     # Contracts, schema rules, and provenance spec
        ├── index.md                      # Active catalog, superseded history, concept index
        ├── log.md                        # Append-only chronological audit log
        └── concepts/                     # Interlinked markdown concept pages
            ├── postgresql.md             # [[postgresql]] concept notes with ^[citations]
            ├── pgvector.md               # [[pgvector]] concept notes
            └── replication.md            # [[replication]] concept notes
```

#### Sample `wiki/log.md`
```markdown
# EchoRegent Memory Audit Log

- [2026-11-22T10:00:00.000Z] REMEMBER [f1a8...] "Database tier uses PostgreSQL 15 on port 5432 with pgvector." ^[docs/rfcs/001-database.md:15]
- [2026-11-22T10:15:00.000Z] REMEMBER [f2b9...] "Read replicas for PostgreSQL are provisioned in us-east-1 and us-west-2." ^[docs/rfcs/002-replication.md:40] (extends f1a8...)
- [2026-11-22T11:00:00.000Z] REMEMBER [f3c1...] "Database tier upgraded to PostgreSQL 16 on port 5432 with pgvector 0.7.0." ^[docs/rfcs/005-pg16-upgrade.md:10] (updates f1a8...)
```

#### Sample `wiki/index.md`
```markdown
# EchoRegent LLM-Wiki Knowledge Index

## Active Facts
- [f3c1...] Database tier upgraded to PostgreSQL 16 on port 5432 with pgvector 0.7.0. ^[docs/rfcs/005-pg16-upgrade.md:10]
- [f2b9...] Read replicas for PostgreSQL are provisioned in us-east-1 and us-west-2. ^[docs/rfcs/002-replication.md:40]

## Superseded Facts (History)
- [f1a8...] (Superseded by [[f3c1...]]) Database tier uses PostgreSQL 15 on port 5432 with pgvector. ^[docs/rfcs/001-database.md:15]

## Concepts
- [[postgresql]] (2 active facts)
- [[pgvector]] (1 active fact)
- [[replication]] (1 active fact)
```

---

## Conclusion & Best Practices

1. **Keep Telemetry Off & Bind to Loopback**: EchoRegent is architected for private, local developer environments. Always bind to `127.0.0.1`.
2. **Always Cite Sources**: In the memory layer, cite files and line numbers (`^[path/to/file.ts:42]`). EchoRegent enforces source citations for auditability.
3. **Use `updates` for Deprecations**: Avoid manually deleting old facts when architectural constraints change; use `relation: 'updates'` to retain full historical provenance in the audit log while keeping active prompts clean.
4. **Combine History Compaction & Memory**: For long-running agents (Codex CLI, Hermes, Claude Code), enable `--compact-history` and `--inject-memory` to maintain constant-bounded prompt sizes without losing critical project invariants.
