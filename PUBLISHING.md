# Publishing & Zero-Server Distribution Guide

This repository releases two packages: `@echoregent/core` (the token management & continual memory engine SDK) and `@echoregent/cli` (the local proxy, Codex launcher, diagnostics, and MCP server). The root workspace stays private. Publish core first because CLI depends on the exact core version.

The current release version is `0.4.0`. The release branch is `oss-release-v0.4.0` at [https://github.com/ashy5454/echoregent](https://github.com/ashy5454/echoregent). A Git push alone does not publish packages to npm or create GitHub Releases.

---

## Zero-Server Distribution Architecture

EchoRegent requires **zero hosted backend servers**:

1. **Package Hosting (npm Registry + GitHub Releases CDN):**
   - Publishing `@echoregent/core` and `@echoregent/cli` to the public npm registry (`registry.npmjs.org`) places both packages onto npm's global Cloudflare CDN for free. Developers worldwide run `npm install -g @echoregent/cli` or `npx @echoregent/cli` without hitting any custom infrastructure.
   - Attaching `echoregent-core-0.4.0.tgz` and `echoregent-cli-0.4.0.tgz` to a GitHub Release (`v0.4.0`) enables direct global distribution via GitHub's CDN (`npm install -g https://github.com/ashy5454/echoregent/releases/download/v0.4.0/...`). This works instantly even before npm propagation or without an npm account.
2. **Runtime Compute (`127.0.0.1` Local Loopback):**
   - Both `@echoregent/core` and `@echoregent/cli` run 100% in-process or locally on loopback (`127.0.0.1:8787`).
   - Zero external model weights, zero cloud database dependencies, and zero proprietary server runtimes.
   - 100,000 active users cost Arkadhi **$0/month in server compute and $0/month in bandwidth**.

---

## 1. Prepare the account and tools

- Install Node 22.12+ and its bundled npm (Node 24 is also supported).
- Install the GitHub CLI (`gh`) for creating GitHub Releases.
- For **Channel A (npm Registry)**: Use an npm account with publish permission for the `@echoregent` scope. Create/control that npm organization or obtain access from its owner. GitHub repository ownership does not grant npm scope ownership.
- Have the Codex CLI on PATH for the local packaging fixture check (`npm install -g @openai/codex@0.167.0`).
- Log in to the npm registry using your account and complete any browser/2FA prompts:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

On PowerShell on Windows, use `npm.cmd` instead of `npm` if script execution policy blocks `npm.ps1`. The commands below otherwise work with the same arguments.

If `@echoregent` is unavailable to your account, choose a scope you control and update both package names, CLI's core dependency, source imports, workspace commands, smoke scripts, and documentation consistently before rebuilding. Do not publish mismatched package names or dependencies.

---

## 2. Obtain and verify the source

For a fresh checkout:

```sh
git clone --branch oss-release-v0.4.0 https://github.com/ashy5454/echoregent.git
cd echoregent
npm ci
npm run build:packages
npm run build
npm run verify:all
npm test
npm install -g @openai/codex@0.167.0
npm run test:packages
```

- `npm run verify:all`: Executes live end-to-end verification of all three engine components (streaming SSE proxy, session history compaction, and continual wiki-memory ingestion).
- `npm test`: Runs Vitest across all 31 test files (283 passing tests).
- `npm run test:packages`: Packs both workspaces into `artifacts/`, installs the archives in a fresh temporary directory with development dependencies omitted and installation scripts disabled, checks compiled SDK/CLI/declarations/MCP, and runs the installed Codex executable against a local controlled Responses provider. This test needs no real provider API key and does not spend provider credits.

See the [verification evidence](docs/evidence/COMPACTION_VERIFICATION.md). The local model comparisons are optional research checks rather than a release prerequisite; their scripts need separately provisioned local model assets not included in this repository.

---

## 3. Check version availability and package contents

```sh
npm view @echoregent/core@0.4.0 version --registry=https://registry.npmjs.org/
npm view @echoregent/cli@0.4.0 version --registry=https://registry.npmjs.org/
npm pack --dry-run --json --workspace @echoregent/core
npm pack --dry-run --json --workspace @echoregent/cli
```

An E404 from a version query means that package/version is not yet visible in the registry. An authentication or network error does not establish availability. npm versions are immutable: if `0.4.0` is already published, choose a new version before building.

Both package allowlists contain compiled `dist` files, declarations, README, and licensing files. `@echoregent/core` has only **one pure-JS runtime dependency** (`gpt-tokenizer` for exact `o200k_base` BPE accounting) and **zero native addons, zero ONNX runtimes, and zero bundled model weights**. Neither package contains weights, model/training directories, environment files, provider credentials, local memory stores, or internal playbooks.

If preparing a later version, keep the two package versions and CLI's exact `@echoregent/core` dependency aligned, update the lockfile with `npm install --package-lock-only`, and update version-dependent CLI output, proxy health, smoke-script expectations, and archive names. Search for the existing release string with `rg -n '0\.4\.0' packages scripts package.json docs`.

---

## 4. Build the exact release archives

Ensure the destination directory exists and pack both workspace packages:

```sh
mkdir -p artifacts
npm run pack:packages
```

For version `0.4.0`, this builds clean distributions and generates:

```text
artifacts/echoregent-core-0.4.0.tgz
artifacts/echoregent-cli-0.4.0.tgz
```

The `prepack` scripts automatically compile each TypeScript workspace. Archive names and hashes change with version/content; inspect the actual output from your checkout.

---

## 5. Channel A: Publish to the Public npm Registry (CDN)

Use npm's `next` distribution tag initially. The package versions remain `0.4.0`; `next` selects the release without advertising it as the default stable installation.

**Publish core first** because CLI depends on the exact `@echoregent/core` version:

```sh
# 1. Publish core package
npm publish artifacts/echoregent-core-0.4.0.tgz --access public --tag next --registry=https://registry.npmjs.org/
npm view @echoregent/core@0.4.0 version --registry=https://registry.npmjs.org/

# 2. Publish CLI package
npm publish artifacts/echoregent-cli-0.4.0.tgz --access public --tag next --registry=https://registry.npmjs.org/
```

Complete any npm account/2FA requirements interactively. If core publication fails, resolve that error before publishing CLI. CLI's exact dependency resolves a published core version even when core is tagged `next`.

Do not publish the root workspace. Do not commit npm credentials or auth configuration to the repository.

---

## 6. Channel B: Zero-Server Direct GitHub Release Tarball Distribution

Even before npm propagation or for developers installing in corporate environments without npm registry access, distribute release tarballs directly through GitHub Releases backed by GitHub's global CDN.

### Step 1: Create the GitHub Release and attach the tarballs

Using the GitHub CLI (`gh`):

```sh
gh release create v0.4.0 \
  artifacts/echoregent-core-0.4.0.tgz \
  artifacts/echoregent-cli-0.4.0.tgz \
  --title "EchoRegent v0.4.0" \
  --notes-file docs/RELEASE.md
```

### Step 2: User Installation from GitHub Releases CDN

Users worldwide can install the CLI globally directly from GitHub's CDN with zero Arkadhi servers required:

```sh
npm install -g \
  https://github.com/ashy5454/echoregent/releases/download/v0.4.0/echoregent-core-0.4.0.tgz \
  https://github.com/ashy5454/echoregent/releases/download/v0.4.0/echoregent-cli-0.4.0.tgz
```

Or install from local tarballs directly:

```sh
npm install -g ./artifacts/echoregent-core-0.4.0.tgz ./artifacts/echoregent-cli-0.4.0.tgz
```

Or for SDK projects:

```sh
npm install https://github.com/ashy5454/echoregent/releases/download/v0.4.0/echoregent-core-0.4.0.tgz
```

---

## 7. Verify registry & release installations

Check the package metadata and distribution tags:

```sh
npm view @echoregent/core@0.4.0 version engines dependencies dist-tags --registry=https://registry.npmjs.org/
npm view @echoregent/cli@0.4.0 version engines dependencies dist-tags --registry=https://registry.npmjs.org/
```

Test global CLI installation:

```sh
# Via npm registry
npm install -g @echoregent/cli@next

# Or via GitHub Release tarball
npm install -g https://github.com/ashy5454/echoregent/releases/download/v0.4.0/echoregent-core-0.4.0.tgz https://github.com/ashy5454/echoregent/releases/download/v0.4.0/echoregent-cli-0.4.0.tgz

# Verify CLI commands
echoregent --version
echoregent --help
echoregent models
echoregent doctor
```

Expected: version `0.4.0`, a rules-only model report, and the wrap/proxy/doctor/mcp/models commands with new autonomous flags (`--adaptive-compression`, `--auto-memory`, `--project-memory`, `--inject-memory`, `--local-token`).

Test the SDK in a fresh directory:

```sh
mkdir echoregent-registry-check
cd echoregent-registry-check
npm init -y
npm install @echoregent/core@next
```

Create `check.mjs` in that directory:

```js
import assert from 'node:assert/strict'
import { EchoRegent } from '@echoregent/core'

const engine = new EchoRegent({ adaptiveCompression: true, autoLearnMemory: true })
assert.equal(engine.compressText('PASS unit\n'.repeat(90)).changed, true)
console.log('SDK registry installation passed')
```

Run `node check.mjs`. Expected output: `SDK registry installation passed`. These version/help/model/SDK checks run entirely locally without requiring a provider API key.

To use the published CLI with Codex and your provider key:

```sh
echoregent wrap codex
echoregent wrap codex --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```

Or run the proxy for Claude Code or any OpenAI/Anthropic client:

```sh
echoregent proxy --compact-history --inject-memory --adaptive-compression --auto-memory --project-memory
```

Set `OPENAI_API_KEY` or `ECHOREGENT_PROVIDER_KEY` in your environment first, and optionally `ECHOREGENT_UPSTREAM` for another Responses- or Anthropic-compatible provider. Real agent runs use your provider credits. The launcher does not use ChatGPT subscription authentication and does not edit persistent Codex configuration.

---

## 8. Promote the tested version to `latest`

After reviewing CI and validating real-workload task quality and provider usage, move the published npm version to the stable `latest` tag:

```sh
npm dist-tag add @echoregent/core@0.4.0 latest
npm dist-tag add @echoregent/cli@0.4.0 latest
```

Then standard commands select the stable release:

```sh
npm install -g @echoregent/cli
npm install @echoregent/core
```

Dist-tag changes do not republish or alter the package bytes. If a stable version needs a fix, publish a new version; npm will not let you replace an existing version. An incorrect `latest` tag can be pointed back to a previously published known-good version.

Describe savings as workload-dependent local measurements until paired provider-billed task evidence is available. The existing [local report](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md) proves payload reduction and exact reconstruction on selected fixtures, not model answer quality or monetary savings.
