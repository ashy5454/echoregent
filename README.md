# EchoRegent

Open-source context middleware for LLM applications and coding agents, with policy controls and editable, source-cited memory.

The `abhiram` branch contains the current packaged product. Read the [detailed changes from the original repository](PRODUCT_CHANGES.md) and the [step-by-step npm publishing guide](PUBLISHING.md).

One TypeScript repository, two npm packages sharing the same engine:

| Package | Audience | Includes |
| --- | --- | --- |
| `@echoregent/core` | Application developers | SDK: deterministic policy decisions, compression and scoped memory |
| `@echoregent/cli` | Coding-agent users | Local proxy, Codex launch setup, diagnostics and MCP; imports core |

## Install

```sh
npm install -g @echoregent/cli@next
echoregent wrap codex
```

These packages are prepared for npm publication; this checkout does not establish that they are already published. Until publication, `npm run test:packages` produces and validates both installable archives in `artifacts/`.

The first release uses npm's `next` tag. After a version is promoted to `latest`, the same installation commands can omit `@next`.

Requires Node 22.12+, an installed Codex CLI and `OPENAI_API_KEY` or `ECHOREGENT_PROVIDER_KEY`. Use `ECHOREGENT_UPSTREAM` for another Responses-compatible provider. Codex subscription login is not supported by this launcher. Installed packages include compiled JavaScript and TypeScript declarations, with no clone/build step or model downloads.

For applications:

```sh
npm install @echoregent/core@next
```

```ts
import { EchoRegent } from '@echoregent/core'
const engine = new EchoRegent() // memory off, telemetry off
const result = engine.process(providerRequest, 'responses')
// Forward result.request to your chosen provider.
```

The middleware runs locally; inference goes to your chosen provider. Protected medical/legal/crisis content is preserved. Deterministic compression compacts duplicate logs and repeated wording with changing timestamps or numbers in the newest tool result, including Codex custom-tool text blocks. Every value and its order can be reconstructed exactly. Structured items, tool ordering and current user input are preserved; prior tool transformations replay deterministically. Compression failure preserves the original request. Changes must reduce local token estimates; payload reduction is not evidence of billed savings.

Use `new EchoRegent({ compactHistory: true })` or the CLI's `--compact-history` to also factor shared wording in older conversation turns. This option defaults off and preserves recent turns. Diverse prose can remain unchanged. The [local savings report](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md) compares the previous baseline with both modes and checks exact reconstructed requests; it does not measure upstream answer quality or billing.

## CLI and memory

```sh
echoregent proxy --port 8787
echoregent wrap codex --compact-history
echoregent doctor
echoregent doctor --probe --model your-model
echoregent mcp
echoregent models
```

Wrap verifies local proxy health, configures Codex for that launch through command-line Responses provider overrides, and reports routed requests on exit. Exiting reverses setup; there are no persistent configuration edits. Doctor's optional probe sends one provider request and may incur a charge. The actual Codex binary was tested against a controlled Responses/SSE provider with a shell tool round trip; this is protocol evidence, not a live-provider benchmark.

MCP exposes explicit classify/compress/remember/recall/update/forget/purge operations through the same core. The agent must invoke MCP tools. Registration alone does not intercept all requests.

Memory defaults off. Enabled memory requires explicit project/session scope and retention; persistent mode requires a local directory. Facts have editable source citations and deletion/purge controls. Recall never searches all namespaces. No automatic memory writes or injection, external telemetry, or response caching. Expired facts are removed when their scope is accessed; immediate deletion uses purge.

- [SDK API and memory settings](packages/core/README.md)
- [CLI, proxy and MCP setup](packages/cli/README.md)
- [Code/model licensing](MODEL_LICENSES.md)
- [Reproducible evidence](docs/evidence/README.md)
- [How to publish the SDK and CLI](PUBLISHING.md)
- [Release validation and legacy-service scope](docs/RELEASE.md)

## Develop and verify

```sh
npm ci
npm run build:packages
npm test
npm run test:packages # requires Codex on PATH
```

`npm run api` starts the core-backed local proxy. Existing frontend and model research remain in this repository as development code; the previous hosted service is available only as `npm run dev:legacy-api` and is excluded from both npm packages. It does not establish the public package API or compatibility claims. Historical service documentation is archived in `docs/legacy-service.md`.

Code uses the existing [MIT license](LICENSE). Proprietary fine-tuned weights are excluded and never required by these packages. No savings claim is made without paired provider-billed task evidence.
