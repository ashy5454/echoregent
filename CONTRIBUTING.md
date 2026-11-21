# Contributing to EchoRegent

Thank you for your interest in contributing to EchoRegent! We welcome contributions from developers, researchers, and agent engineers to help build the fastest, zero-overhead context middleware and continual memory layer for AI agents and LLM applications.

---

## Code of Conduct

We expect all contributors to adhere to the [Contributor Covenant v2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). Please treat all participants with respect, kindness, and professional courtesy.

---

## Architecture Overview

EchoRegent is structured as a TypeScript monorepo using npm workspaces:

```
echoregent/
├── packages/
│   ├── core/           # @echoregent/core: SDK, compression engine, policy, scoped memory
│   └── cli/            # @echoregent/cli: Proxy daemon, agent wrap, doctor, MCP server
├── docs/               # Architecture specs, competitive benchmarks, evidence reports
├── audit/              # Comprehensive test suites and benchmark reproduction scripts
└── scripts/            # Packaging and distribution verification scripts
```

### Core Invariants (Non-Negotiable)

Every Pull Request must strictly respect the following core design invariants:

1. **Zero External Runtime Dependencies in `@echoregent/core`:** The core package must remain featherweight (~120KB) and rely solely on modern Node.js built-ins (`node:crypto`, `node:fs`). Do not add third-party runtime dependencies to `@echoregent/core`.
2. **100% Lossless Reversibility:** Compression algorithms (template factoring, structural canonicalization) must never discard non-recoverable semantic information. `decompressText` and `restoreCompressedRequest` must reconstruct the original input with byte-exact precision for all supported formats.
3. **Zero Bundled Model Weights:** No binary weights (`.onnx`, `.pt`, `.bin`, `.safetensors`) or heavy ML runtimes may be committed or bundled into the packages.
4. **Local-First & Zero Telemetry:** Never introduce analytics calls, tracking beacons, or unsolicited external network traffic. The entire stack must remain completely operational offline.
5. **Deterministic Policy Guardrails:** Policy evaluations for protected domains (medical, legal, crisis) must fail closed. When triggered, compression and memory writes are completely bypassed.

---

## Development Setup

### Prerequisites

- **Node.js:** `22.12.0` or higher
- **npm:** `10.0.0` or higher
- Optional: An installed [OpenAI Codex CLI](https://github.com/openai/codex) or Claude Code if testing CLI wrapper integration.

### Quickstart

1. **Clone your fork:**
   ```bash
   git clone https://github.com/<your-username>/echoregent.git
   cd echoregent
   ```

2. **Install dependencies:**
   ```bash
   npm ci
   ```

3. **Build workspace packages:**
   ```bash
   npm run build:packages
   ```

4. **Run the test suite:**
   ```bash
   npm test
   # or run vitest directly:
   npx vitest run
   ```

5. **Verify package packaging & tarball dry-run:**
   ```bash
   npm pack --dry-run --json --workspace @echoregent/core
   npm pack --dry-run --json --workspace @echoregent/cli
   ```

---

## Contribution Workflow

### 1. Branching Strategy

Create a branch with a descriptive name from `main` or the active release branch:

```bash
git checkout -b feat/adaptive-signature-cache
# or
git checkout -b fix/proxy-sse-boundary
```

### 2. Commit Message Guidelines

We follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

- `feat:` A new feature or capability (e.g., `feat(core): add ISO-8601 millisecond template pattern`)
- `fix:` A bug fix (e.g., `fix(cli): resolve proxy loopback port conflict on Windows`)
- `docs:` Documentation improvements (e.g., `docs: update LLM-Wiki quickstart guide`)
- `perf:` Performance optimizations without behavioral changes
- `refactor:` Code improvements that do not fix bugs or add features
- `test:` Adding or improving unit or integration tests
- `chore:` Build scripts, repo hygiene, or CI pipeline changes

### 3. Writing Tests

All bug fixes and new features must be accompanied by comprehensive tests in `packages/core/tests/` or `packages/cli/tests/`. Ensure:
- Edge cases (empty strings, huge payloads, nested JSON, malformed inputs) are covered.
- Compression tests verify both token reduction and exact inverse decompression.
- Policy tests confirm that protected terms trigger pass-through behavior.

### 4. Submitting a Pull Request

1. Ensure the build and test suites pass locally:
   ```bash
   npm run build:packages && npx vitest run
   ```
2. Push your branch to GitHub and open a Pull Request.
3. In the PR description, explain:
   - What problem this change solves.
   - Any architectural tradeoffs made.
   - How you verified the fix/feature (commands, benchmarks, or test outputs).
   - Reference any relevant GitHub issues (`Fixes #123`).

---

## Areas Where Contributions Are Welcomed

- **Template Factoring Patterns:** Expanding lossless compression rules for common developer tool outputs (Docker, Kubernetes, AWS CLI, Terraform, Jest/Vitest).
- **Continual Learning Rules:** Enhancing the delta-rule synaptic plasticity and regret-signal detection in `adaptive-compressor.ts`.
- **LLM-Wiki Memory Extensions:** Enhancing Markdown wiki graph traversal, AST linter rules, and Obsidian-compatible wikilink generation.
- **Agent Integrations:** Adding wrappers and presets for emerging agent frameworks (Claude Code, OpenCode, Aider, Roo Code).
- **Documentation & Benchmarks:** Adding real-world reproducible benchmark traces from diverse developer stacks.

Thank you for helping make EchoRegent better for everyone!
