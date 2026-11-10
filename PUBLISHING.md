# Publish EchoRegent to npm

This repository releases two packages: `@echoregent/core` and `@echoregent/cli`. The root workspace and legacy `cts-mcp` package stay private. Publish core first because CLI depends on the exact core version.

The current release version is `0.4.0`. The source and release evidence are on the GitHub `abhiram` branch. A Git push does not publish anything to npm.

## 1. Prepare the account and tools

- Install Node 22.12+ and its bundled npm. Node 24 is also supported.
- Use an npm account with publish permission for the `@echoregent` scope. Create/control that npm organization or obtain access from its owner. GitHub repository ownership does not grant npm scope ownership.
- Have the Codex CLI on PATH for the local integration check. The verified fixture version is `@openai/codex@0.167.0`.
- Log in to the npm registry using your own account and complete its browser/2FA prompts:

```sh
npm login --registry=https://registry.npmjs.org/
npm whoami --registry=https://registry.npmjs.org/
```

On PowerShell, use `npm.cmd` instead of `npm` if script execution policy blocks `npm.ps1`. The commands below otherwise work with the same arguments.

If `@echoregent` is unavailable to your account, choose a scope you control and update both package names, CLI's core dependency, source imports, workspace commands, smoke scripts and documentation consistently before rebuilding. Do not publish mismatched package names or dependencies.

## 2. Obtain and verify the source

For a fresh checkout:

```sh
git clone --branch abhiram https://github.com/ashy5454/echoregent.git
cd echoregent
npm ci
npm run build:packages
npm run build
npm test
npm install -g @openai/codex@0.167.0
npm run test:packages
```

`test:packages` packs both workspaces into `artifacts/`, installs the archives in a fresh temporary directory with development dependencies omitted and installation scripts disabled, checks compiled SDK/CLI/declarations/MCP, and runs the installed Codex executable against a local controlled Responses provider. This test needs no real provider API key and does not spend provider credits.

The release evidence records 148 passing tests and 12 existing TODO cases on Windows/Node 24. The GitHub package workflow is configured for Linux/Windows and Node 22/24; inspect the branch's CI results before publishing. See [product changes](PRODUCT_CHANGES.md) and [verification](docs/evidence/COMPACTION_VERIFICATION.md).

The local model comparisons are optional research checks, rather than an npm release prerequisite. Their scripts need separately provisioned local model assets, which are not included in this branch or either package.

## 3. Check version availability and package contents

```sh
npm view @echoregent/core@0.4.0 version --registry=https://registry.npmjs.org/
npm view @echoregent/cli@0.4.0 version --registry=https://registry.npmjs.org/
npm pack --dry-run --json --workspace @echoregent/core
npm pack --dry-run --json --workspace @echoregent/cli
```

An E404 from a version query means that package/version is not visible in the registry. An authentication or network error does not establish availability. npm versions are immutable: if `0.4.0` is already published, choose a new version before building.

Both package allowlists should contain compiled `dist` files, declarations, README and licensing files. They should contain no weights, model/training directories, environment files, provider credentials, local memory stores or research traces. A regular developer dependency tree exists in the repository, but is not the content of the published tarballs.

If preparing a later version, keep the two package versions and CLI's exact `@echoregent/core` dependency aligned, update the lockfile with `npm install --package-lock-only`, and update version-dependent CLI output, proxy health, smoke-script expectations and archive names. Search for the existing release string with `rg -n '0\.4\.0' packages scripts package.json docs`. Editing only package manifests will leave this release's hardcoded CLI/fixture version strings inconsistent.

## 4. Build the exact archives to publish

```sh
npm run pack:packages
```

For `0.4.0`, the output is:

```text
artifacts/echoregent-core-0.4.0.tgz
artifacts/echoregent-cli-0.4.0.tgz
```

The `prepack` scripts compile each workspace. Archive names and hashes change with version/content; inspect the actual output from your checkout. The archive hashes in earlier reports identify those historical builds, not every future rebuild.

## 5. Publish the first release under `next`

Use npm's `next` distribution tag initially. The package versions remain `0.4.0`; `next` selects the release without advertising it as the default stable installation.

```sh
npm publish artifacts/echoregent-core-0.4.0.tgz --access public --tag next --registry=https://registry.npmjs.org/
npm view @echoregent/core@0.4.0 version --registry=https://registry.npmjs.org/
npm publish artifacts/echoregent-cli-0.4.0.tgz --access public --tag next --registry=https://registry.npmjs.org/
```

Complete any npm account/2FA requirements interactively. If core publication fails, resolve that error before publishing CLI. CLI's exact dependency resolves a published core version even when core is tagged `next`.

Do not publish the root or `cts-mcp` package. Do not commit npm credentials or auth configuration to the repository.

## 6. Verify registry installation

Check the package metadata and distribution tags:

```sh
npm view @echoregent/core@0.4.0 version engines dependencies dist-tags --registry=https://registry.npmjs.org/
npm view @echoregent/cli@0.4.0 version engines dependencies dist-tags --registry=https://registry.npmjs.org/
npm install -g @echoregent/cli@next
echoregent --version
echoregent models
echoregent --help
```

Expected: version `0.4.0`, a rules-only model report, and the proxy/wrap/doctor/MCP commands. Test the SDK in a fresh directory:

```sh
mkdir echoregent-registry-check
cd echoregent-registry-check
npm init -y
npm install @echoregent/core@next
```

Create `check.mjs` in that directory with:

```js
import assert from 'node:assert/strict'
import { EchoRegent } from '@echoregent/core'

assert.equal(new EchoRegent().compressText('PASS unit\n'.repeat(90)).changed, true)
console.log('SDK registry installation passed')
```

Run `node check.mjs`. Expected output: `SDK registry installation passed`. These version/help/model/SDK checks do not call a real provider.

To use the published CLI with an installed Codex and your provider key:

```sh
echoregent wrap codex
echoregent wrap codex --compact-history
```

Set `OPENAI_API_KEY` or `ECHOREGENT_PROVIDER_KEY` in your environment first, and optionally `ECHOREGENT_UPSTREAM` for another Responses-compatible provider. Real agent runs use your provider credits. The launcher does not use ChatGPT subscription authentication and does not edit persistent Codex configuration. History compaction is optional; memory remains off by default.

## 7. Promote the tested version to `latest`

After reviewing CI and validating real-workload task quality and provider usage, move the same published version to npm's stable tag:

```sh
npm dist-tag add @echoregent/core@0.4.0 latest
npm dist-tag add @echoregent/cli@0.4.0 latest
```

Then the normal commands select the stable release:

```sh
npm install -g @echoregent/cli
npm install @echoregent/core
```

Dist-tag changes do not republish or alter the package bytes. If a stable version needs a fix, publish a new version; npm will not let you replace an existing version. An incorrect `latest` tag can be pointed back to a previously published known-good version.

Describe savings as workload-dependent local measurements until paired provider-billed task evidence is available. The existing [local report](docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md) proves payload reduction and exact reconstruction on selected fixtures, not model answer quality or monetary savings.
