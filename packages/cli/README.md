# @echoregent/cli

EchoRegent's local proxy, coding-agent launcher, diagnostics and MCP server. Imports `@echoregent/core` for every public operation.

The initial release uses npm's `next` tag. Omit `@next` after the package is promoted to `latest`. Before publication, install the built SDK/CLI archives from the repository's `artifacts` directory.

```sh
npm install -g @echoregent/cli@next
echoregent wrap codex
```

Requires Node 22.12+, an installed Codex CLI and `OPENAI_API_KEY` or `ECHOREGENT_PROVIDER_KEY`. Set `ECHOREGENT_UPSTREAM` to another Responses-compatible provider base URL if needed. ChatGPT subscription authentication is not supported by this launcher. JavaScript and declarations are included; installation requires no repository or build tools.

```sh
echoregent wrap codex -- exec "Run the project tests"
echoregent proxy --port 8787
# Optional compaction of repeated wording in older conversation turns:
echoregent wrap codex --compact-history
echoregent proxy --port 8787 --compact-history
echoregent doctor
echoregent doctor --probe --model your-model
echoregent models
```

`wrap` starts a loopback proxy, checks its local health, supplies per-launch Codex provider overrides for the Responses API, and reports actual routed requests when Codex exits. It disables the provider WebSocket transport in favor of HTTP/SSE. Provider overrides/profiles that would change routing are rejected. All client flags belong after `--`. Shutdown stops the proxy and reverses setup; `unwrap` explains this. No persistent client configuration is installed. `doctor --probe` explicitly sends one potentially billable provider request; ordinary doctor checks only local health.

The launcher follows the [official Codex provider configuration reference](https://developers.openai.com/codex/config-reference/): `wire_api = "responses"`, a custom provider `base_url` and `env_key`. A Chat Completions route alone does not establish Codex support.

## Local API and proxy

`POST /v1/responses` and `POST /v1/chat/completions` forward to the configured upstream base URL. Requests use the client's normal provider authentication. Structured blocks, tool calls/results, ordering, metadata and SSE bytes are relayed. The newest plain-text or `input_text` tool-output blocks can compact duplicate logs and shared wording with changing timestamps or numbers, retaining every value and its order. Previously applied transforms replay deterministically. Provider errors retain their status/body. Compression errors send the original request bytes. Streaming interruptions terminate the response and leave retries to the client. Normal client cancellation after `response.completed` is not counted as a proxy failure.

`--compact-history` also factors repeated wording in older plain conversation turns. It is available on both `proxy` and `wrap codex` and defaults off. The latest user message and at least the last eight items remain verbatim; roles, IDs and metadata are preserved. A newly aged group may change its provider prefix once, while previously factored groups remain deterministic. Diverse prose and changes that would increase estimated tokens pass through. See the SDK's `restoreCompressedRequest` and `decompressText` helpers for exact reconstruction. These local token estimates do not establish provider cache hits, billed savings or upstream answer quality.

`POST /compress` and `/classify` accept `{ "text": "..." }`. `/memory/remember`, `/memory/recall`, `/memory/update`, `/memory/forget`, `/memory/purge` use the same engine. SDK README documents their arguments (`scope`, `fact`, `query`, `id`, optional complete `context`). With enabled CLI memory, scope is fixed by `--project` and `--session`; callers cannot switch namespaces. Bind is always `127.0.0.1`; browser origins and compressed request bodies are refused. This is a local single-user service, not a hosted multi-tenant endpoint.

## MCP

```sh
echoregent mcp
# Explicit persistence and scope:
echoregent mcp --memory file --memory-dir /private/memory \
  --project /absolute/project --session session-123 --retention-days 7
```

```json
{
  "mcpServers": {
    "echoregent": { "command": "echoregent", "args": ["mcp"] }
  }
}
```

Tools: `classify`, `compress`, `remember`, `recall`, `update`, `forget`, `purge`. Compression tools work when the agent invokes them; registration alone does not intercept context. Memory is off by default. Enabled memory requires explicit project, session and retention; file mode additionally requires a directory. The server binds memory tools to that one scope. No implicit cross-session recall, prompt storage, model download or telemetry.

Codex was exercised with a controlled Responses provider including a real shell tool round trip. This validates protocol/routing, not live-provider task savings. Other coding-agent launchers, Anthropic-native schemas, WebSockets and remote MCP are not advertised.

Code: MIT. Model licensing: [MODEL_LICENSES.md](MODEL_LICENSES.md).
