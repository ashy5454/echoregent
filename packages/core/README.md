# @echoregent/core

Open-source context middleware for LLM applications and coding agents, with policy controls and editable, source-cited memory.

```sh
npm install @echoregent/core@next
```

Node 22.12+; ESM JavaScript and TypeScript declarations included. No build, model downloads, native runtime, proprietary weights, account, or telemetry required.

The initial release uses npm's `next` tag. Omit `@next` after the package is promoted to `latest`. Before publication, install the built SDK/CLI archives from the repository's `artifacts` directory.

```ts
import { EchoRegent } from '@echoregent/core'

const engine = new EchoRegent() // memory off
const body = { model: 'your-model', input: conversationItems, stream: true }
const decision = engine.process(body, 'responses')
// Send decision.request to your chosen Responses-compatible provider.
```

`process(body, 'responses' | 'chat-completions', scope?)` preserves structured content, tools, call IDs, ordering and cache metadata. The newest tool result can compact duplicate lines or repeated wording with changing timestamps, IDs and numbers, including `input_text` blocks in Codex custom-tool output arrays. Templates retain every value as an exact string in its original order. Other blocks, images, JSON, fenced code and the current user message stay intact. Previously applied log transformations replay when the client resends original history. Protected medical/legal/crisis content is forwarded unchanged. Compression exceptions return the original request object.

Compaction must reduce both characters and local o200k_base token estimates, including serialized payload overhead. The tokenizer runs locally with its content merge cache disabled; it requires no model inference. Diverse text without repeated wording can remain unchanged. Local estimates and lossless reconstruction do not establish billed savings or upstream answer quality.

## Optional older conversation compaction

```ts
import { EchoRegent, restoreCompressedRequest, decompressText } from '@echoregent/core'

const engine = new EchoRegent({ compactHistory: true })
const result = engine.process(body, 'responses')
const originalRequest = restoreCompressedRequest(result.request, 'responses')
const originalLogText = decompressText(engine.compressText(logText).text)
```

History compaction defaults off. Enabling it factors shared wording in older user/assistant text while retaining message count, roles, IDs, metadata and every changing numeric string. It keeps at least the last eight request items and the latest user message verbatim, even when many tool outputs follow that message. Instructions, tool-call messages, multimodal content, JSON, fenced code and explicitly cached or annotated conversation blocks are skipped.

Complete groups of 16 original items use independent dictionaries embedded in their text. Resending original history produces the same already factored groups without retaining a cross-request text dictionary. A newly aged group may change its provider prefix once; actual provider cache hits require separate measurement. Validate upstream task quality before relying on this optional representation for production workloads.

Tool prefix replay keeps at most 2,048 hashes for 24 hours and retains no original or compressed content between requests. This runtime metadata is independent of the optional fact-memory store.

`engine.classify(text, scope?)` returns the policy and deterministic routing frame. `engine.compressText(text, scope?)` is an explicit text operation using that same policy. A protected operation marks an enabled memory scope protected for its retention interval. Pass the complete relevant context to policy operations; a classifier cannot protect context it never receives.

Pass a stable scope when processing incremental Responses conversations. With memory off, a protected scope is held in runtime metadata for 24 hours; no facts or files are stored. Unscoped requests with `previous_response_id` are preserved because the original provider-side history cannot be inspected locally.

## Explicit memory

```ts
const engine = new EchoRegent({
  memory: { mode: 'file', directory: './.echoregent-memory', retentionMs: 7 * 86400_000 },
})
const scope = { project: '/absolute/project/path', session: 'session-123' }
const fact = await engine.remember(scope, {
  content: 'Use PostgreSQL for this project.',
  sources: ['architecture.md:12'],
}, fullRelevantContext)
const facts = await engine.recall(scope, 'PostgreSQL', fullRelevantContext)
await engine.update(scope, fact.id, {
  content: 'Use SQLite for this project.', sources: ['decision:2026-11-10'],
})
await engine.forget(scope, fact.id)
await engine.purge(scope)
```

Alternatively use `{ mode: 'ephemeral', retentionMs: ... }`. Project and session are always required; recall never scans another scope. A citation records the caller's source reference; EchoRegent does not verify its truth or fetch its contents. Updates retain the ID and original expiry time. Protected facts are refused. Protection markers contain only an expiry timestamp and persist in file mode. Deletion and purge remain available in protected scopes.

File stores use hashed scope names, atomic replacement, and a per-scope writer lock. Facts are local plaintext: choose a private directory and suitable OS access controls. Expired facts are excluded and removed when that scope is accessed; there is no background deletion daemon. Invoke `purge` for immediate deletion. Stale writer locks time out rather than risk overwriting an active writer. Existing unscoped wiki files are not imported automatically.

No automatic memory extraction, injection, response caching or provider calls. `charactersRemoved` is a payload measure, not a billed-token counter. Use provider `usage` and whole-task validation to measure cost and completion.

Code: MIT. Model licensing: [MODEL_LICENSES.md](MODEL_LICENSES.md).
