<div align="center">

![EchoRegent Banner](docs/images/echoregent_banner.svg)

**Conversation Intelligence Middleware**

*Classifies every conversation turn for domain, intent, and risk. Compresses history for OpenAI-compatible APIs without losing meaning — and gives your agent a conversation-awareness signal it can act on.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6)](src/)
[![MCP Compatible](https://img.shields.io/badge/MCP-Claude%20%7C%20Cursor%20%7C%20Windsurf-00c9b1)](cts-mcp/)
[![Models](https://img.shields.io/badge/Models-DistilBERT%20%7C%20T5%20%7C%20MiniLM-orange)](ml/)
[![by Yudi Labs](https://img.shields.io/badge/by-Yudi%20Labs-08090e)](https://yudi.co.in)

</div>

---

## Results

We don't have an independently reproducible benchmark to publish yet. An
earlier version of this README carried specific numbers here (a quality
score, a LoCoMo comparison, a load-test figure) that no script or dataset in
this repo actually produces — see `AUDIT.md` for the full accounting of what
was and wasn't verified. Rather than leave numbers up that nobody can rerun,
we took them down.

A paired benchmark — compressed vs. full history, both with the provider's
own prompt caching enabled, on real (anonymized) conversations — is in
progress under `/audit/bench` in this repo. Numbers will go here once
they're reproducible by anyone who clones the repo, not asserted.

---

## The problem

LLMs receive your full conversation history on every turn. At 100 turns, that is 80,000 tokens — most of it noise. You pay for it. It degrades answer quality. And the model treats a user's medical crisis the same way it treats a product search.

EchoRegent sits between your application and the LLM and fixes all three:

```
Fewer tokens. Domain- and risk-aware, not just character-counting.
```

- **Classifier** — domain, intent, emotional state, and risk signal on every turn. The rule-based fallback (what runs without extra setup) measures under 1ms on CPU; an optional fine-tuned DistilBERT path exists but needs weights not included in this repo (see "Self-host vs managed" below).
- **Compressor** — domain-aware history compression, tuned to preserve concrete facts (IDs, dates, numbers) that naive summarization drops. A T5-based summarization path also exists in the codebase; it is not yet the default on the main `/v1/chat/completions` proxy.
- **Conversation awareness** — medical, legal, crisis, and other risk signals are classified on every turn and exposed to your application (`x-cts-risk` header, or the `risk` field on `/compress`) so **your code** can decide how to handle a sensitive conversation. This is a signal, not an enforced compliance boundary — see "Conversation awareness" below.
- **MCP server** — drop into Claude Code, Cursor, Windsurf, or any MCP-compatible tool.

**Provider support today:** OpenAI-compatible APIs, text-only conversations, no tool calling yet. Requests with `tool_calls` or non-text content are rejected with a clear error rather than silently mishandled. Anthropic, Gemini, and tool-calling/multimodal support are on the roadmap, not shipped.

---

## Quickstart

```bash
git clone https://github.com/ashy5454/echoregent
cd echoregent
cp .env.example .env   # fill in your keys
npm install
npm run dev
```

**With MCP (Claude Desktop / Cursor):**

```bash
cd cts-mcp
npm install && npm run build
```

Add to your MCP config:

```json
{
  "mcpServers": {
    "echoregent": {
      "command": "node",
      "args": ["/path/to/echoregent/cts-mcp/dist/index.js"]
    }
  }
}
```

Four tools available immediately: `cts_compress_history`, `cts_classify_intent`, `cts_memory_remember`, `cts_memory_recall`.

---

## How it works

```
┌─────────────────────────────────────────────────────────────┐
│                    INCOMING TURN                            │
│              user message + full history                    │
└───────────────────────┬─────────────────────────────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │   CLASSIFIER     │  domain · intent · risk signal
              │                  │  (rule-based by default; optional
              │                  │   fine-tuned DistilBERT path)
              └────────┬─────────┘
                        │
                        ▼
              ┌──────────────────┐
              │   COMPRESSOR     │  domain-aware, removes noise,
              │                  │  keeps facts + semantics
              └────────┬─────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  SEMANTIC CACHE  │  skips recompression
              │                  │  if semantically equivalent turn seen
              └────────┬─────────┘
                        │
                        ▼
                   LLM call
         (compressed context + x-cts-risk header
          so YOUR code can act on sensitive turns)
```

---

## Domain classifier

8 domains out of the box, rule-based by default.

| Domain | Compression | Notes |
|---|---|---|
| `coding` | aggressive | Stack traces, diffs compress well |
| `commerce` | moderate | Product context must survive |
| `education` | moderate | Concept threads preserved |
| `sales` | moderate | Objection history kept |
| `customer_support` | conservative | Issue context critical |
| `general` | moderate | — |
| `medical` | conservative | Also raises `medical_caution` risk — see below |
| `legal` | conservative | Also raises `legal_caution` risk — see below |

`crisis` is not a separate domain — it's a **risk signal** (see below) that
can be raised alongside any domain, most often `general`. The rule-based
classifier runs in under 1ms on CPU (measured); no LLM call needed for
routing.

---

## Conversation awareness

EchoRegent classifies a risk signal on every turn — `medical_caution`,
`legal_caution`, `crisis`, `protected_context`, `unsafe_request`, or
`financial_caution` — and exposes it to your application via the
**`x-cts-risk`** response header on `/v1/chat/completions` (comma-separated),
or the **`risk`** field on `/compress`.

**This is a signal your application acts on — it is not an enforced
boundary.** EchoRegent does not currently guarantee that a medical, legal, or
crisis conversation is compressed differently, excluded from any downstream
logic, or retained differently, on its own. If your product needs a hard
compliance boundary — never compress, never forward to a third party,
elevated retention, an audit trail — build that check in your own code using
`x-cts-risk` as the trigger.

*(An earlier version of this README described this as "protected zones...
architecturally enforced." That wasn't accurate, and has been corrected —
see `AUDIT.md` in this repo for the full accounting of what changed and why.)*

---

## Memory layer

```
wiki/
  session.db      WAL SQLite — full turn history, searchable within session
  skills.db       FTS5 index — searchable across all sessions
  memory/         Per-session JSON — survives restarts, exportable
```

The MCP tools `cts_memory_remember` and `cts_memory_recall` expose this to any MCP-compatible client. EchoRegent never proposes what already failed — and never forgets what the user told it last week.

---

## Self-host vs managed

| | Self-hosted | Managed API (yudi.co.in) |
|---|---|---|
| Core classifier | Rule-based, or base HuggingFace DistilBERT | Fine-tuned Yudi weights |
| Compressor | Rule-based | Fine-tuned T5 (higher recall) |
| Conversation-awareness signal | ✓ (risk header/field) | ✓ (risk header/field) |
| Token savings | Not yet independently benchmarked — see `AUDIT.md` | Not yet independently benchmarked — see `AUDIT.md` |
| Setup | `npm run dev` | API key + one line |
| Cost | Your compute | Pay per call |

The fine-tuned weights are not included in this repo. They are available via the managed API. Self-hosted mode uses base HuggingFace models and works well for most domains.

---

## File layout

```
src/
  server.ts               HTTP API server
  cts-core/
    classifier.ts         Domain + intent + risk classification
    compressor.ts         T5-based history compression
    router.ts             Domain routing logic
    ml-classifier.ts      ONNX inference — DistilBERT
    ml-t5.ts              ONNX inference — T5 compressor
    semantic-cache.ts     MiniLM embedding cache
    wiki.ts               Session memory store
    signals.ts            Feature extraction
    types.ts              Shared types

cts-mcp/
  src/
    index.ts              MCP server entry point
    tools.ts              4 MCP tools
    memory.ts             Cross-session memory

ml/                       Model weights — gitignored, download separately
  cts_classifier/         DistilBERT ONNX
  cts_t5/                 T5 encoder/decoder ONNX
  cts_minilm/             MiniLM embedding variants

docs/
  images/
    echoregent_banner.svg

.env.example              Environment variable template
PRODUCTION_READINESS.md   Honest pre-pilot checklist
```

---

## API

```bash
# Classify a conversation turn (requires Authorization: Bearer <key>)
POST /api/classify
{ "message": "I've been having chest pains", "history": [...] }
→ { "domain": "medical", "intent": "information_seeking", "state": "opening",
    "risk": ["medical_caution"], "signals": {...}, "confidence": {...} }

# Compress history (requires Authorization: Bearer <key>)
POST /compress
{ "message": "...", "history": [...] }
→ { "compressedHistory": [...], "intent": "...", "domain": "...", "state": "...",
    "tokensSaved": 3420, "memoryFrame": {...}, "risk": ["medical_caution"] }

# OpenAI-compatible proxy (one-line baseURL swap — see Provider support above)
POST /v1/chat/completions
→ standard OpenAI chat completion response, plus x-cts-* response headers
  (x-cts-domain, x-cts-intent, x-cts-risk, x-cts-tokens-saved, x-cts-compression-pct)

# Health + model readiness
GET /ready   → 200 when the classifier is loaded, 503 while loading
GET /health  → always 200 if HTTP server is alive
```

---

## Inspired by

- [mem0](https://github.com/mem0ai/mem0) — persistent memory layer architecture
- [LangChain](https://github.com/langchain-ai/langchain) — conversation chain abstractions
- [Nissenbaum (2004)](https://crypto.stanford.edu/~ninghui/courses/Fall2008/papers/privacy_as_contextual_integrity.pdf) — contextual integrity as the theoretical ground for the conversation-awareness signal
- [ARIA by Yudi Labs](https://github.com/ashy5454/aria) — autonomous research loop that uses EchoRegent's memory layer

---

## License

MIT — see [LICENSE](LICENSE).

The fine-tuned model weights (`cts_classifier`, `cts_t5`) are proprietary to Yudi Labs and are not included in this repository. The core code runs on base HuggingFace models. Managed API access with Yudi-trained weights is available at [yudi.co.in](https://yudi.co.in).

---

<div align="center">
<sub>Built at Yudi Labs, Hyderabad · <a href="https://yudi.co.in">yudi.co.in</a></sub>
</div>
