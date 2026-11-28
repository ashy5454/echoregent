# npm release procedure

For account/scope setup, version checks, exact archive commands, the first-release `next` tag and promotion to `latest`, follow the root [PUBLISHING.md](../PUBLISHING.md). This file records validation and package boundaries.

The supported distribution is one TypeScript repository with exactly two public packages: core SDK and CLI (proxy, Codex launcher, diagnostics, MCP). The root workspace is private. No `@echoregent/mcp-server` package is released.

```sh
npm ci
npm run build:packages
npm test
npm run test:packages
```

`test:packages` packs both workspaces into `artifacts`, installs them together in a clean temporary directory with dev dependencies omitted and lifecycle scripts disabled, exercises SDK/CLI/MCP, and runs the installed Codex binary against a controlled Responses/SSE provider. It requires Codex on PATH. Users install compiled JavaScript and declarations from npm; they do not clone/build.

The fixture evidence does not prove a live provider's authentication policies, all Codex versions/platforms, cache hit rate or billed savings. Before publishing a stable release, repeat the fixture in CI on Linux and Windows and run paired live-provider tasks using the same agent/model/tool permissions and cache settings. Record completion, provider-billed input/output/cache tokens, retries and elapsed time. Compare total task cost; do not use payload reduction as a savings claim.

Prepare/review public code and remove private findings, credentials, ignored datasets and proprietary weights from any repository visibility change. Package `files` allowlists restrict npm artifacts to compiled code and public documentation; inspect `npm pack --dry-run --json --workspace <package>`.

When npm publishing and public repository access are authorized, publish core first, then CLI:

```sh
npm publish artifacts/arkadhi-echoregent-core-0.4.0.tgz --access public --tag next
npm publish artifacts/arkadhi-echoregent-0.4.0.tgz --access public --tag next
```

Publishing and repository visibility changes have not been performed by this packaging work. Until then, install both local `.tgz` files together. The CLI's published dependency resolves core from npm after core is published.

`npm run api` starts the packaged local proxy. Use `echoregent mcp` for MCP server installation.
