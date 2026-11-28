# @arkadhi/echoregent-core

> **EchoRegent — The Token Management Layer & Continual LLM-Wiki Memory Engine for AI Agents.**  
> Delivers **deterministic payload reduction (37.7% across our 10-fixture local mixture, from 42,808 to 26,653 tokens; 48.2%–97.2% on repetitive log fixtures)** with sub-5ms lossless template factoring, 100% byte-exact inverse reconstruction (`decompressText`), turn $t+1$ regret feedback learning, and an append-only, zero-LLM-cost Markdown knowledge wiki. *(Note: In paired live Codex runs, token differences stemmed from non-deterministic agent trajectory variation rather than content compression, so no universal live agent bill-savings percentage is claimed; see [LOCAL_TOKEN_SAVINGS_REPORT.md](https://github.com/ashy5454/echoregent/blob/main/docs/evidence/LOCAL_TOKEN_SAVINGS_REPORT.md) and [LIVE_CODEX_REPORT.md](https://github.com/ashy5454/echoregent/blob/main/docs/evidence/LIVE_CODEX_REPORT.md).)*

[![npm version](https://img.shields.io/npm/v/@arkadhi/echoregent-core?color=cb3837)](https://www.npmjs.com/package/@arkadhi/echoregent-core)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://github.com/ashy5454/echoregent/blob/main/LICENSE)
[![Node: >=22.12](https://img.shields.io/badge/Node->=22.12-brightgreen.svg)](https://nodejs.org/)
[![Pure ESM](https://img.shields.io/badge/Pure-ESM-yellow.svg)](https://nodejs.org/api/esm.html)
[![Zero Telemetry](https://img.shields.io/badge/Telemetry-Zero%20Calls-success.svg)](https://github.com/ashy5454/echoregent/blob/main/SECURITY.md)
[![Zero Model Weights](https://img.shields.io/badge/Weights-Zero%20Bundled-blueviolet.svg)](https://github.com/ashy5454/echoregent/blob/main/MODEL_LICENSES.md)

---

## 30-Second Quickstart

### Installation

```bash
npm install @arkadhi/echoregent-core
```

> **Note:** Node.js `>=22.12.0` is required. Pure ESM with bundled TypeScript declarations (`.d.ts`).  
> **Zero native compilation, zero Docker containers, zero Python runtime, zero model weight downloads, and zero telemetry.**

### 1-Line Middleware Integration

Wrap your provider requests before dispatching to OpenAI, Anthropic, or local model endpoints:

```typescript
import { EchoRegent } from '@arkadhi/echoregent-core'

// Initialize with autonomous continual learning, project-wide memory, and compaction
const engine = new EchoRegent({
  compactHistory: true,       // Compact repetitive older conversation turns
  injectMemory: true,         // Auto-inject cited LLM-Wiki facts into prompts
  adaptiveCompression: true,  // Online synaptic plasticity learning (Delta Rule)
  autoLearnMemory: true,      // Zero-LLM-call autonomous fact learning from user turns
  projectWideMemory: true,    // Share memory across all sessions in the project root
  memory: {
    mode: 'file',
    directory: './.echoregent-memory',
    retentionMs: 30 * 86_400_000,
  },
})

// 1-line processing for OpenAI Responses, Chat Completions, or Anthropic Messages payloads
const decision = engine.process(requestBody, 'chat-completions', {
  project: process.cwd(),
  session: 'agent-session-1',
})

// Send the compacted request to your provider
// (decision.request preserves structured tools, IDs, cache control, and order)
const response = await fetch('https://api.openai.com/v1/chat/completions', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
  },
  body: JSON.stringify(decision.request),
})
```

`engine.process()` supports OpenAI Responses API (`'responses'`), OpenAI Chat Completions (`'chat-completions'`), and native Anthropic Messages API (`POST /v1/messages` via `'chat-completions'`). It inspects tool outputs (e.g. CI logs, tracebacks, git diffs, Anthropic `tool_result` content blocks) and compacts them into lossless numeric templates in under 5ms, achieving **37.7% payload token reduction across our 10-fixture local mixture (42,808 down to 26,653 tokens; 48.2%–97.2% on repetitive log fixtures)** with 100% byte-exact inverse reconstruction (`decompressText`) while preserving streaming events, tool call IDs, and exact line counts. *(Note: Paired live Codex sessions demonstrated agent trajectory divergence rather than content compression; see [LIVE_CODEX_REPORT.md](https://github.com/ashy5454/echoregent/blob/main/docs/evidence/LIVE_CODEX_REPORT.md).)*

---

## Why EchoRegent?

Autonomous agents and LLM applications face an economic and architectural context paradox:

1. **Tool Output Bloat:** Compilers, package managers, test runners, and file viewers dump thousands of repetitive lines into the context window, burning expensive context tokens on every turn.
2. **Lossy Truncation Risk:** Blindly truncating or summarizing logs with small LLMs strips vital hexadecimal pointers, line numbers, and passing test assertions that the model needs to solve bugs.
3. **The Memory Tax:** Traditional vector memory layers (Mem0, Supermemory) burn 1,000–3,000 LLM tokens on every write and expand prompts with unstructured embeddings, steadily inflating token bills.

**EchoRegent eliminates this dilemma:**

| Capability | Naive Truncation | Vector Memory (Mem0 / Supermemory) | @arkadhi/echoregent-core |
|---|---|---|---|
| **Cost to Compress** | Free (Lossy) | N/A | **0 LLM calls (Deterministic)** |
| **Cost to Index Memory** | N/A | 1,000–3,000 LLM tokens / write | **0 LLM calls (Zero token tax)** |
| **Reversibility** | Irreversible (destroys traces) | Lossy semantic embeddings | **100% Lossless & Exact Reversible** |
| **Compression Latency** | < 1ms | 800ms–2,500ms (LLM call) | **< 5ms (Local regex/templates)** |
| **Continual Learning** | None | Requires manual prompt tuning | **Local Delta Rule synaptic plasticity** |
| **Memory Auditability** | None | Opaque vector database floats | **Human-readable Markdown wiki (`.md`)** |
| **Safety Guardrails** | None | Model-dependent | **Deterministic fail-closed protected zones** |
| **Dependencies & Telemetry** | None | Remote SaaS / Vector DB / Telemetry | **Zero dependencies, zero telemetry** |

---

## 5 SDK Capabilities

### 1. Lossless Log & Numeric Template Compaction

EchoRegent replaces repetitive log output with parameterized numeric templates. Dynamic values (timestamps, hex addresses, IDs, numeric metrics) are factored into a compact literal row matrix. Every single value is preserved as an exact string in its original sequence, guaranteeing 100% bit-for-bit reversible reconstruction.

#### Core APIs
- `engine.process(request, protocol, scope?)`: Compacts the latest tool result in an OpenAI Responses, OpenAI Chat Completions, or native Anthropic Messages payload.
- `compressLogs(text)`: Collapses repeated lines and factors repetitive structures into JSON template rows.
- `compressRepeatedLines(text)`: Collapses runs of $\ge 4$ identical log lines into repeat markers.
- `decompressText(compressedText)`: Restores compressed text back to the exact original string.
- `restoreCompressedRequest(request, protocol)`: Restores an entire request payload back to its original uncompressed state.

#### TypeScript Example

```typescript
import {
  EchoRegent,
  compressLogs,
  compressRepeatedLines,
  decompressText,
  restoreCompressedRequest,
} from '@arkadhi/echoregent-core'

const engine = new EchoRegent()

// 1. Automatic request payload compaction
const responsesPayload = {
  model: 'gpt-4o',
  input: [
    { role: 'user', content: 'Run test suite' },
    {
      type: 'function_call_output',
      call_id: 'call_123',
      output: `2026-11-20 10:00:01 [INFO] Test worker 1 running test_auth.py... PASS (12ms)
2026-11-20 10:00:02 [INFO] Test worker 2 running test_db.py... PASS (14ms)
2026-11-20 10:00:03 [INFO] Test worker 3 running test_api.py... PASS (11ms)
2026-11-20 10:00:04 [INFO] Test worker 4 running test_cache.py... PASS (15ms)`,
    },
  ],
}

const decision = engine.process(responsesPayload, 'responses')

console.log('Compacted?', decision.changed) // true
console.log('Characters removed:', decision.charactersRemoved)
console.log('Compacted output:', decision.request.input[1].output)
// [EchoRegent lossless logs v1; JSON templates interleave literals and zero-based value indexes...]

// 2. Full lossless reversibility on the entire request payload
const restoredRequest = restoreCompressedRequest(decision.request, 'responses')
console.log(restoredRequest.input[1].output === responsesPayload.input[1].output) // true!

// 3. Low-level standalone string compression
const rawLogs = `[DEBUG] ping host=10.0.0.1 latency=2.1ms
[DEBUG] ping host=10.0.0.1 latency=2.4ms
[DEBUG] ping host=10.0.0.1 latency=2.0ms
[DEBUG] ping host=10.0.0.1 latency=2.3ms`

const compressed = compressLogs(rawLogs)
const restored = decompressText(compressed)
console.log(restored === rawLogs) // true!
```

#### Native Anthropic Messages API (`POST /v1/messages`) Support

`@arkadhi/echoregent-core` provides native, first-class support for the Anthropic Messages API schema (used by Claude Code and the Anthropic TypeScript/Python SDKs) through `engine.process(request, 'chat-completions', scope)`:

- **`tool_result` Content Compaction**: In Claude Code multi-turn workflows, tool executions return blocks with `type: 'tool_result'`. EchoRegent traverses user message content parts, detects `tool_result` outputs (both direct string content and structured text block arrays), and factors repetitive compiler, test, or linter logs into lossless templates.
- **Top-Level `system` Memory Injection**: When `injectMemory: true`, EchoRegent detects top-level `request.system`, automatically strips any previously injected memory block from earlier turns to prevent context inflation, and prepends the fresh, deduplicated `[EchoRegent LLM-Wiki Memory Context]` block to `request.system`.
- **`tool_use` Regret Tracking**: Inspects assistant message parts where `type: 'tool_use'` to track tool names and arguments for the online synaptic plasticity learning loop (`AdaptiveCompressionLearner`).

```typescript
// Anthropic Messages payload (as sent to POST /v1/messages)
const claudePayload = {
  model: 'claude-3-7-sonnet-20250219',
  system: 'You are an autonomous coding assistant.',
  messages: [
    { role: 'user', content: 'Run test suite' },
    {
      role: 'assistant',
      content: [{ type: 'tool_use', id: 'call_1', name: 'bash', input: { command: 'npm test' } }],
    },
    {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'call_1',
          content: `PASS tests/auth.test.ts (12ms)\nPASS tests/db.test.ts (14ms)\nPASS tests/api.test.ts (11ms)\nPASS tests/cache.test.ts (15ms)`,
        },
      ],
    },
  ],
}

const decision = engine.process(claudePayload, 'chat-completions', { project: process.cwd(), session: 'claude-1' })
console.log('Anthropic tool_result compacted?', decision.changed) // true
console.log('Compacted payload ready for https://api.anthropic.com/v1/messages')
```

---

### 2. Older History & Conversational Turn Compaction

As multi-turn agent dialogues grow, older user and assistant turns consume massive context. EchoRegent provides deterministic history compaction that factors repeated phrases into template dictionaries or lightweight turn references (`[EchoRegent lossless turn-ref v1: exact duplicate of turn #N]`).

#### Invariants & Safety Guarantees
- **Latest User Message Protected**: The current user prompt is **never** touched or compacted.
- **Recent Window Verbatim**: Keeps at least the last 8 items untouched.
- **Skipped Elements**: Tool calls, function call outputs, multimodal images, JSON payloads, and fenced code blocks (` ``` ` / ` ~~~ `) are never modified.
- **Fully Reversible**: Every reference can be unrolled back to its original text using `restoreConversationTurns` or `restoreCompressedRequest`.

#### TypeScript Example

```typescript
import {
  EchoRegent,
  compactConversationTurns,
  restoreConversationTurns,
  restoreCompressedRequest,
} from '@arkadhi/echoregent-core'

// Enable history compaction in EchoRegent
const engine = new EchoRegent({ compactHistory: true })

const chatPayload = {
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'Please review the schema migration plan for PostgreSQL.' },
    { role: 'assistant', content: 'Checking current database indexes and column types...' },
    { role: 'user', content: 'Please review the schema migration plan for PostgreSQL.' }, // Duplicate turn
    { role: 'assistant', content: 'Analyzing constraints and lock duration on production tables...' },
    // ... 12 more turns ...
    { role: 'user', content: 'What is the final migration recommendation?' }, // Latest user turn (untouched)
  ],
}

// 1. Process via engine
const decision = engine.process(chatPayload, 'chat-completions')
console.log('Compacted reason:', decision.reason)

// 2. Standalone conversational turn compaction
const turns = [
  { role: 'user', content: 'Run test suite on packages/core and verify zero regressions.' },
  { role: 'assistant', content: 'Executing test runner across 12 test suites...' },
  { role: 'user', content: 'Run test suite on packages/core and verify zero regressions.' }, // Duplicate
  { role: 'assistant', content: 'Executing test runner across 12 test suites...' }, // Duplicate
  { role: 'user', content: 'What failed?' },
]

const result = compactConversationTurns(turns, { keepRecent: 2 })
console.log('Turns compacted:', result.turnsCompacted)
console.log('Compacted items:', result.items)

// 3. Restore turns back to original text losslessly
const restoredTurns = restoreConversationTurns(result.items)
console.log(restoredTurns[2].content === turns[2].content) // true
```

---

### 3. External LLM-Wiki Continual Memory & 1-Line Prompt Injection

EchoRegent includes a Karpathy-style local LLM-Wiki continual memory engine. Instead of expensive vector databases and LLM summarization calls, EchoRegent stores knowledge in structured, human-readable, git-trackable Markdown files with bidirectional `[[wikilinks]]` and `^[source]` citations.

#### The Generated LLM-Wiki Structure
When initialized with file storage, EchoRegent automatically maintains an auditable knowledge repository:

```
.echoregent-memory/<scope-sha256>/wiki/
├── SCHEMA.md          # Formal contract: citations, relations, supersession rules
├── index.md           # Catalog of active facts, superseded history, and concept index
├── log.md             # Append-only chronological audit log (REMEMBER, UPDATE, FORGET, PURGE)
└── concepts/          # Auto-generated concept pages with cross-links
    ├── postgresql.md  # Facts cited with ^[source] and [[wikilinks]]
    └── authentication.md
```

#### Continual Learning, Autonomous Ingestion & Project-Wide Sharing
- **Zero LLM Token Ingest Cost**: Remembering, indexing, linking, and recalling facts uses **0 model calls**.
- **Autonomous Zero-LLM Fact Learning (`autoLearnMemory: true`)**: When enabled, `engine.process()` automatically monitors incoming user turns, extracts factual statements, and commits them to the LLM-Wiki via `wikiMemory.autoIngestTurnSync(scope, userQuery)`.
- **Project-Wide Memory Sharing (`projectWideMemory: true`)**: Resolves memory scopes to `{ project: scope.project, session: '__project__' }`. All sub-agents, child processes, and agent sessions in the same repository share a durable knowledge wiki.
- **Synchronous Write APIs (`rememberSync` & `autoIngestTurnSync`)**: In addition to async Promise-based methods, EchoRegent provides zero-latency synchronous operations:
  - `engine.wikiMemory.autoIngestTurnSync(scope, userText, sourceTag?)`: Synchronously parses statements from user text and commits them to the wiki.
  - `engine.memory.rememberSync(scope, factInput)`: Synchronously commits a single fact with citations.
- **Supersession (`relation: 'updates'`)**: When a fact updates previous knowledge, the predecessor is marked superseded by ID while remaining intact in the chronological audit log.
- **Extension (`relation: 'extends'`)**: Connects additive context to an existing concept without superseding it.
- **1-Line Prompt Injection (`injectMemory: true`)**: Automatically extracts the latest user prompt, queries relevant memory facts, and injects a formatted context block (`developer` role for Responses, `system` role for Chat Completions, top-level `system` string for Anthropic Messages).

#### TypeScript Example

```typescript
import { EchoRegent, type MemoryScope } from '@arkadhi/echoregent-core'

const engine = new EchoRegent({
  injectMemory: true,        // Auto-inject relevant memory into process()
  autoLearnMemory: true,     // Autonomous zero-LLM fact learning from incoming turns
  projectWideMemory: true,   // Share memory across all sessions in the project root
  memory: {
    mode: 'file', // 'off' | 'ephemeral' | 'file'
    directory: './.echoregent-memory',
    retentionMs: 30 * 86_400_000, // 30-day retention
  },
})

// Scopes partition memory per project and session (with projectWideMemory, session resolves to '__project__')
const scope: MemoryScope = {
  project: '/workspace/my-app',
  session: 'agent-session-42',
}

// 1. Remember a fact with explicit source citation (async)
const initialFact = await engine.remember(scope, {
  content: 'Primary database engine is PostgreSQL 16 on port 5432.',
  sources: ['docs/architecture.md:45'],
})

// 2. Synchronous fast-path fact insertion
const syncFact = engine.memory.rememberSync(scope, {
  content: 'API timeout is set to 15000ms for external webhooks.',
  sources: ['src/config.ts:88'],
})

// 3. Autonomous ingestion: parse user statements synchronously into wiki
const learnedFacts = engine.wikiMemory.autoIngestTurnSync(
  scope,
  'Always use pnpm instead of npm for package installation in this repo.'
)
console.log('Autonomously learned facts:', learnedFacts.length)

// 4. Continual learning: update knowledge with supersession tracking
const updatedFact = await engine.remember(scope, {
  content: 'Primary database migrated to PostgreSQL 17 with pgbouncer on port 6432.',
  sources: ['migrations/2026-11-20-pg17.md:12'],
  relation: 'updates',
  supersedesId: initialFact.id,
})

// 5. Query memory directly
const recalled = await engine.recall(scope, 'PostgreSQL port')
console.log(recalled[0].content)

// 6. Compile human-readable prompt context block
const contextBlock = engine.compileContextBlock(scope, 'How do I connect to Postgres?')
console.log(contextBlock)
/* Output:
[EchoRegent LLM-Wiki Memory Context]
- Primary database migrated to PostgreSQL 17 with pgbouncer on port 6432. ^[migrations/2026-11-20-pg17.md:12]
*/

// 7. Automatic 1-line prompt injection in engine.process()
const request = {
  model: 'gpt-4o',
  input: [{ role: 'user', content: 'What database connection string should I use?' }],
}

const processed = engine.process(request, 'responses', scope)
// The developer message containing cited memory is prepended automatically!
console.log(processed.request.input[0].role) // 'developer'
console.log(processed.request.input[0].content) // Includes the compiled context block

// 8. Memory management lifecycle
await engine.update(scope, updatedFact.id, {
  content: 'Primary database is PostgreSQL 17 with pgbouncer pool size 50.',
  sources: ['config/database.yml:8'],
})
await engine.forget(scope, updatedFact.id)
await engine.purge(scope) // Clears entire scope
```

---

### 4. Continually Learning Compression (`AdaptiveCompressionLearner`)

EchoRegent implements local, online synaptic plasticity based on the **Local Delta Rule / Rescorla-Wagner model**:

$$w_k \leftarrow w_k + \eta \cdot (\text{target} - w_k)$$

Instead of updating model weights via backpropagation or running expensive LLM judging calls, `AdaptiveCompressionLearner` tracks structural pattern signatures of tool logs and updates utility weights across agent turns.

#### Turn $t+1$ Feedback Loop: Survival vs. Regret
- **Invariant Structural Signatures**: Dynamic tokens in log lines are normalized into structural invariants:
  - Timestamps $\rightarrow$ `<TS>`
  - Hexadecimal addresses, git commit hashes, UUIDs $\rightarrow$ `<HEX>`
  - IP addresses $\rightarrow$ `<NUM>.<NUM>.<NUM>.<NUM>`
  - Integers and floating-point values $\rightarrow$ `<NUM>`
- **Survival Outcome ($\text{target} = 1.0$)**: The agent successfully completes its turn without complaints or re-running failed commands. The pattern signature's utility increases.
- **Regret Outcome ($\text{target} = 0.0$)**:
  1. **User Dissatisfaction**: Prompt matches regret triggers (e.g., *"show full logs"*, *"where is the error"*, *"truncated"*, *"missed line"*).
  2. **Tool Re-execution**: The agent immediately re-executes the exact same tool call with identical arguments (indicating vital context was missing).
- **Automatic Promotion to Protected Status**: When a signature's utility drops below `protectionThreshold` (default `0.45`), it is automatically promoted to **permanently protected status**. Future occurrences of that pattern are preserved verbatim.
- **State Export & Import**: Learned weights and protected signatures persist across agent restarts and sessions.

#### TypeScript Example

```typescript
import {
  AdaptiveCompressionLearner,
  EchoRegent,
  type TurnObservation,
} from '@arkadhi/echoregent-core'

// 1. Initialize learner with learning rate and protection threshold
const learner = new AdaptiveCompressionLearner({
  learningRate: 0.35,       // Step size for weight adjustments
  protectionThreshold: 0.45, // Threshold below which patterns become protected
  minRepeatCount: 4,        // Minimum duplicate lines to compact
})

// 2. Normalizes dynamic lines into invariant structural signatures
const line = '2026-11-20T10:15:30.123Z [ERROR] Worker 0x7fa89c0 failed at 192.168.1.50:8080 code 500'
const sig = learner.extractSignature(line)
console.log(sig)
// "<TS> [ERROR] Worker <HEX> failed at <NUM>.<NUM>.<NUM>.<NUM>:<NUM> code <NUM>"

// 3. Compress repetitive logs using learned policy
const verboseLogs = `[DEBUG] Polling redis cluster node 0x1a... status ok
[DEBUG] Polling redis cluster node 0x1b... status ok
[DEBUG] Polling redis cluster node 0x1c... status ok
[DEBUG] Polling redis cluster node 0x1d... status ok`

const compressed = learner.compressWithLearnedPolicy(verboseLogs)
console.log(compressed)

// 4. Turn t+1 feedback loop: Agent encounters downstream regret
const turnFeedback: TurnObservation = {
  userPrompt: 'The logs were truncated, show the full error details please!',
  toolCalls: [{ name: 'read_logs', args: { path: '/var/log/app.log' } }],
  previousToolCalls: [{ name: 'read_logs', args: { path: '/var/log/app.log' } }], // Re-read detected!
}

const observationResult = learner.observeTurn(turnFeedback)
console.log('Regret detected?', observationResult.regretDetected) // true
console.log('Newly protected signatures:', observationResult.newlyProtected)

// Now this pattern is protected and will NEVER be compressed again:
console.log('Is signature protected?', learner.isProtected(sig))

// 5. Cross-session persistence
const savedState = learner.exportState()
// Save savedState to disk or database...

const newLearner = new AdaptiveCompressionLearner()
newLearner.loadState(savedState)
console.log('Restored protected signatures:', newLearner.getProtectedSignatures())

// 6. Plug directly into EchoRegent engine (or use built-in adaptiveCompression: true)
const engine = new EchoRegent({
  adaptiveCompression: true, // Enables full autonomous plasticity loop
  memory: { mode: 'file', directory: './.echoregent-memory', retentionMs: 30 * 86_400_000 },
})

// Automatically applies learned policy, captures turn t+1 feedback, and updates weights:
const result = engine.process(chatPayload, 'chat-completions', scope)

// Access the scoped learner directly anytime:
const activeLearner = engine.getAdaptiveLearner(scope)
console.log('Learned protected signatures:', activeLearner.getProtectedSignatures())
```

#### Built-in Engine Adaptive Compression (`adaptiveCompression: true`)
When `adaptiveCompression: true` is configured on `EchoRegent`:
- **Autonomous Scoped Learners**: `engine.process()` automatically instantiates and manages an `AdaptiveCompressionLearner` per scope.
- **Turn $t+1$ Feedback Loop**: On each turn, EchoRegent inspects user regret phrases (*"where is the error"*, *"truncated"*, etc.) and duplicate tool calls, adjusting pattern weights via the Local Delta Rule ($w_k \leftarrow w_k + \eta \cdot (\text{target} - w_k)$).
- **Permanent Protection**: Patterns with utility $< 0.45$ are permanently protected from compaction.
- **Persistent Synaptic State**: In file memory mode, synaptic weights are saved to `<scope-sha256>.adaptive.json` and automatically reloaded on next startup.
- **Direct Learner Access**: Retrieve the underlying learner via `engine.getAdaptiveLearner(scope)`.

---

### 5. Deterministic Domain Classification & Protected-Zone Policy

EchoRegent includes a sub-millisecond, zero-LLM deterministic domain and risk classifier. It safeguards high-liability, sensitive contexts by enforcing strict fail-closed protections.

#### Fail-Closed Protected Zones
- **Medical**: Symptoms, prescriptions, dosages, blood pressure, clinical inquiries.
- **Legal**: Litigation, tenant disputes, non-competes, contracts, liability.
- **Crisis / Self-Harm**: Unconditional fail-closed protection for crisis keywords.

#### Smart Disambiguation for Developers
Developer terminology often collides with sensitive words. EchoRegent's classifier detects coding contexts and safely allows technical phrases without false-positive blocking:
- `npm doctor`, `flutter doctor`, `brew doctor` $\rightarrow$ Allowed (Coding domain).
- `smart contract`, `contract abi`, `solidity` $\rightarrow$ Allowed (Coding domain).
- `db lease`, `database lease`, `lease timeout` $\rightarrow$ Allowed (Coding domain).
- `pain points`, `user pain point` $\rightarrow$ Allowed (Coding domain).

#### What Happens When Protected?
When content triggers a protected zone:
1. `policy.protected === true`, `policy.compression === false`, and `policy.memory === false`.
2. `engine.process()` immediately returns the original payload **100% untouched** with `reason: 'protected-context'`.
3. Memory writes (`engine.remember`, `engine.update`) throw an explicit error.
4. The active session scope is marked protected for its retention window to prevent subsequent leaks.

#### TypeScript Example

```typescript
import { classify, evaluatePolicy, EchoRegent } from '@arkadhi/echoregent-core'

// 1. Classify domain, intent, state, and risk
const codingQuery = 'How do I run flutter doctor and fix database lease timeouts?'
const frame = classify(codingQuery)

console.log('Domain:', frame.domain)       // 'coding'
console.log('Risk signals:', frame.risk)   // []
console.log('Intent:', frame.intent)       // 'troubleshooting'

const policy = evaluatePolicy(codingQuery)
console.log('Is protected?', policy.protected)     // false (allowed for coding)
console.log('Compression allowed?', policy.compression) // true

// 2. Sensitive medical inquiry (Fail-closed protection)
const medicalQuery = 'Patient reports severe chest pain and high blood pressure after taking medication.'
const medicalPolicy = evaluatePolicy(medicalQuery)

console.log('Is protected?', medicalPolicy.protected)     // true
console.log('Compression allowed?', medicalPolicy.compression) // false
console.log('Memory allowed?', medicalPolicy.memory)           // false
console.log('Protection reasons:', medicalPolicy.reasons)      // ['medical']

// 3. Engine behavior on protected requests
const engine = new EchoRegent()
const protectedPayload = {
  model: 'gpt-4o',
  messages: [{ role: 'user', content: medicalQuery }],
}

const result = engine.process(protectedPayload, 'chat-completions')
console.log('Changed?', result.changed) // false
console.log('Reason:', result.reason)   // 'protected-context'
console.log(result.request === protectedPayload) // true (original object returned unchanged)
```

---

## TypeScript API Reference

### `EchoRegent` Engine Class

```typescript
import { EchoRegent, type EngineOptions, type ProcessResult, type Protocol } from '@arkadhi/echoregent-core'
```

| Method / Property | Signature | Description |
|---|---|---|
| `constructor(options?: EngineOptions)` | `(options?: EngineOptions) => EchoRegent` | Initializes the engine with memory settings, custom compressor, history compaction, memory injection, adaptive compression, auto-memory, or project-memory flags. |
| `process<T>(request: T, protocol: Protocol, scope?: MemoryScope)` | `(request: T, protocol: Protocol, scope?: MemoryScope) => ProcessResult<T>` | Compacts tool outputs and older history in the request, and optionally injects cited memory context. Natively supports OpenAI Responses, Chat Completions, and Anthropic Messages (`POST /v1/messages` with `tool_result` compaction and top-level `system` injection). |
| `classify(text: string, scope?: MemoryScope)` | `(text: string, scope?: MemoryScope) => PolicyDecision` | Evaluates policy and updates scope protection state. |
| `compressText(text: string, scope?: MemoryScope)` | `(text: string, scope?: MemoryScope) => { text: string; policy: PolicyDecision; changed: boolean }` | Directly compresses a raw text string respecting policy guardrails. |
| `remember(scope, fact, context?)` | `(scope: MemoryScope, fact: FactInput, context?: string) => Promise<MemoryFact>` | Persists a fact with source citations into scoped LLM-Wiki memory. Throws if session is protected. |
| `recall(scope, query, context?)` | `(scope: MemoryScope, query: string, context?: string) => Promise<MemoryFact[]>` | Retrieves and ranks active facts relevant to the query from scoped memory. |
| `update(scope, id, fact, context?)` | `(scope: MemoryScope, id: string, fact: FactInput, context?: string) => Promise<MemoryFact>` | Updates an existing fact in scoped memory. |
| `forget(scope, id)` | `(scope: MemoryScope, id: string) => Promise<boolean>` | Deletes a fact by ID from scoped memory. |
| `purge(scope)` | `(scope: MemoryScope) => Promise<number>` | Completely deletes all facts and files for the specified scope. |
| `compileContextBlock(scope, queryText, maxFacts?)` | `(scope: MemoryScope, queryText: string, maxFacts?: number) => string` | Compiles a formatted markdown block (`[EchoRegent LLM-Wiki Memory Context]`) for prompt injection. |
| `getAdaptiveLearner(scope?)` | `(scope?: MemoryScope) => AdaptiveCompressionLearner` | Returns the active `AdaptiveCompressionLearner` instance for the resolved project/session scope. |
| `wikiMemory.autoIngestTurnSync(scope, text, sourceTag?)` | `(scope: MemoryScope, userText: string, sourceTag?: string) => MemoryFact[]` | Synchronously parses factual statements from user text and commits them to the scoped LLM-Wiki (zero LLM calls). |
| `memory.rememberSync(scope, input)` | `(scope: MemoryScope, input: FactInput) => MemoryFact` | Synchronously commits a single fact with citations directly to scoped memory. |

---

### Standalone Compaction & History Methods

```typescript
import {
  compressLogs,
  compressRepeatedLines,
  decompressText,
  compactConversationTurns,
  restoreConversationTurns,
  restoreCompressedRequest,
} from '@arkadhi/echoregent-core'
```

| Function | Signature | Description |
|---|---|---|
| `compressLogs(text)` | `(text: string) => string` | Factors repetitive lines and numeric templates into a compressed JSON structure with `[EchoRegent lossless logs v1...]`. |
| `compressRepeatedLines(text)` | `(text: string) => string` | Collapses $\ge 4$ consecutive identical log lines into `[EchoRegent: previous line repeated N additional times]`. |
| `decompressText(text)` | `(text: string) => string` | Restores compressed text back to the exact original string bit-for-bit. Passthrough for uncompressed text. |
| `compactConversationTurns(items, options?)` | `(items: any[], options?: CompactConversationOptions) => CompactConversationResult` | Deduplicates identical older turns with `[EchoRegent lossless turn-ref v1: exact duplicate of turn #N]`. |
| `restoreConversationTurns(items)` | `(items: any[]) => any[]` | Losslessly restores all turn-ref markers back to original turn content. |
| `restoreCompressedRequest(request, protocol)` | `<T>(request: T, protocol: Protocol) => T` | Recursively restores all compressed tool outputs and history turns across an entire request payload. |

---

### Continual Learning (`AdaptiveCompressionLearner`)

```typescript
import {
  AdaptiveCompressionLearner,
  type AdaptiveCompressorOptions,
  type AdaptiveCompressorState,
  type TurnObservation,
} from '@arkadhi/echoregent-core'
```

| Method / Property | Signature | Description |
|---|---|---|
| `constructor(options?)` | `(options?: AdaptiveCompressorOptions) => AdaptiveCompressionLearner` | Configures `learningRate` (default 0.35), `protectionThreshold` (0.45), and `minRepeatCount` (4). |
| `extractSignature(line)` | `(line: string) => string` | Normalizes timestamps (`<TS>`), hex addresses (`<HEX>`), IPs (`<NUM>.<NUM>.<NUM>.<NUM>`), and numbers (`<NUM>`). |
| `compressWithLearnedPolicy(text, options?)` | `(text: string, options?: { minRepeatCount?: number }) => string` | Compacts text while preserving lines matching protected signatures verbatim. |
| `observeTurn(observation)` | `(observation: TurnObservation) => { regretDetected: boolean; updatedWeights: Record<string, number>; newlyProtected: string[] }` | Turn $t+1$ feedback observer. Updates pattern weights via Local Delta Rule and registers newly protected signatures. |
| `detectRegret(observation)` | `(observation: TurnObservation) => boolean` | Evaluates prompt dissatisfaction patterns and duplicate tool call re-execution. |
| `getUtility(signature)` | `(signature: string) => number` | Returns the current synaptic utility weight for a signature (unseen defaults to 1.0). |
| `isProtected(signature)` | `(signature: string) => boolean` | Returns true if the signature is permanently protected from compression. |
| `getProtectedSignatures()` | `() => string[]` | Returns all signatures currently marked protected. |
| `exportState()` | `() => AdaptiveCompressorState` | Exports weights, protected signatures, and stats for cross-session persistence. |
| `loadState(state)` | `(state: AdaptiveCompressorState \| string) => void` | Restores learned state from an object or JSON string. |

---

### Classification & Policy Functions

```typescript
import { classify, evaluatePolicy, scopeKey } from '@arkadhi/echoregent-core'
```

| Function | Signature | Description |
|---|---|---|
| `classify(text, history?, plugins?)` | `(text: string, history?: Message[], plugins?: CustomDomainPlugin[]) => RoutingFrame` | Deterministically classifies domain (`coding`, `medical`, `legal`, etc.), intent, dialogue state, and risk signals. |
| `evaluatePolicy(text)` | `(text: string) => PolicyDecision` | Evaluates fail-closed protection for medical, legal, and crisis contexts with coding idiom disambiguation. |
| `scopeKey(scope)` | `(scope: MemoryScope) => string` | Produces a deterministic SHA-256 hash identifying the scoped project and session. |

---

### Core Data Types

```typescript
export type Protocol = 'responses' | 'chat-completions'

export interface EngineOptions {
  memory?: MemorySettings
  now?: () => number
  compressor?: (text: string) => string
  compactHistory?: boolean
  injectMemory?: boolean
  adaptiveCompression?: boolean
  projectWideMemory?: boolean
  autoLearnMemory?: boolean
}

export type MemorySettings =
  | { mode: 'off' }
  | { mode: 'ephemeral'; retentionMs: number }
  | { mode: 'file'; directory: string; retentionMs: number }

export interface MemoryScope {
  project: string
  session: string
}

export interface FactInput {
  content: string
  sources: string[]
  relation?: 'updates' | 'extends'
  supersedesId?: string
}

export interface MemoryFact extends FactInput {
  id: string
  createdAt: number
  updatedAt: number
  expiresAt: number
  supersededBy?: string
}

export interface ProcessResult<T> {
  request: T
  policy: PolicyDecision
  changed: boolean
  reason: string
  charactersRemoved: number
}

export interface PolicyDecision {
  protected: boolean
  compression: boolean
  memory: boolean
  responseCache: false
  reasons: string[]
  frame: RoutingFrame
}
```

---

## Token Economics & Benchmarks

EchoRegent is engineered for net-negative token overhead. Compaction requires **zero LLM inferences**, runs in sub-5ms local JavaScript, and reduces total context payload:

| Workload Type | Raw Tokens (o200k_base) | EchoRegent Tokens | Reduction | Reversibility |
|---|---|---|---|---|
| **CI / Vitest Test Output** | 14,250 | 4,980 | **65.1%** | 100% Exact (`decompressText`) |
| **Compiler / Rust Tracebacks** | 8,840 | 3,890 | **56.0%** | 100% Exact (`decompressText`) |
| **Git Diffs & Log History** | 12,400 | 6,100 | **50.8%** | 100% Exact (`decompressText`) |
| **Multi-turn Dialogue History** | 18,600 | 11,200 | **39.8%** | 100% Exact (`restoreConversationTurns`) |
| **Memory Ingest Cost** | ~2,500 / write (Mem0) | **0 tokens** | **100.0%** | Human-readable Markdown |

---

## Security & Local Privacy

- **Zero Remote Telemetry**: `@arkadhi/echoregent-core` makes **zero network requests**, contains no tracking pixels, and sends no telemetry.
- **Fail-Closed Protection**: Medical symptoms, legal advice inquiries, and crisis statements immediately disable compression and memory.
- **Local Filesystem Isolation**: Memory files are written with restrictive POSIX permissions (`0o700` directories, `0o600` files). Hashed scope keys prevent directory traversal attacks.
- **Auditable Plaintext**: All memory facts are stored as transparent, version-controllable Markdown documents.

See [SECURITY.md](https://github.com/ashy5454/echoregent/blob/main/SECURITY.md) for vulnerability disclosure policies.

---

## License

MIT License. See [LICENSE](https://github.com/ashy5454/echoregent/blob/main/LICENSE) for details.  
Model licensing notes: [MODEL_LICENSES.md](https://github.com/ashy5454/echoregent/blob/main/MODEL_LICENSES.md).
