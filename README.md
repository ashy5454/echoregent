<div align="center">

![EchoRegent Banner](docs/images/echoregent_banner.svg)

**Conversation Intelligence Middleware**

*A policy-governed context layer for AI agents. It classifies turns, protects sensitive context, compresses low-risk history, and records explainable decisions.*

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6)](src/)
[![MCP Compatible](https://img.shields.io/badge/MCP-Claude%20%7C%20Cursor%20%7C%20Windsurf-00c9b1)](cts-mcp/)
[![Models](https://img.shields.io/badge/Models-DistilBERT%20%7C%20T5%20%7C%20MiniLM-orange)](ml/)
[![by Yudi Labs](https://img.shields.io/badge/by-Yudi%20Labs-08090e)](https://yudi.co.in)

</div>

---

## Validation status

EchoRegent ships deterministic context-quality checks that report whether critical IDs, dates, paths, error codes, and explicitly required facts survived a context transformation. Run `POST /api/evaluations/context` against your own redacted workload before relying on a token-savings claim. Historical benchmark or load-test numbers are not presented as current product guarantees.

---

## The problem

LLMs receive your full conversation history on every turn. At 100 turns, that is 80,000 tokens — most of it noise. You pay for it. It degrades answer quality. And the model treats a user's medical crisis the same way it treats a product search.

EchoRegent sits between your application and the LLM and fixes all three:

```
Explainable context decisions. Low-risk history compression. Protected handling for sensitive context.
```

- **Classifier** — domain, intent, emotional state, risk level on every turn, <10ms on CPU
- **Compressor** — rule-based compression with an optional local T5 summarizer
- **Protected zones** — medical, legal, crisis, and protected-risk traffic is kept verbatim; response caching, cross-session retrieval, and automatic memory writes are blocked
- **MCP server** — drop into Claude, Cursor, Windsurf, or any MCP-compatible tool in minutes

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
              │   CLASSIFIER     │  DistilBERT — fine-tuned on 10 domains
              │                  │  domain · intent · risk · emotional state
              └────────┬─────────┘
                       │
          ┌────────────┼──────────────┐
          │            │              │
     protected      commerce      general
     zone ▼          zone ▼        zone ▼
  no compression   compress      compress
  no cache/memory  + route       + route
          │            │              │
          └────────────┴──────────────┘
                        │
                        ▼
              ┌──────────────────┐
              │   COMPRESSOR     │  T5 — removes noise, keeps semantics
              │                  │  context-quality checks required
              └────────┬─────────┘
                        │
                        ▼
              ┌──────────────────┐
              │  SEMANTIC CACHE  │  MiniLM — skips recompression
              │                  │  if semantically equivalent turn seen
              └────────┬─────────┘
                        │
                        ▼
                   LLM call
              (compressed context)
```

---

## Domain classifier

10 domains out of the box. Trained on real multi-turn conversation data.

| Domain | Compression | Monetization | Notes |
|---|---|---|---|
| `coding` | aggressive | allowed | Stack traces, diffs compress well |
| `commerce` | moderate | allowed | Product context must survive |
| `education` | moderate | allowed | Concept threads preserved |
| `sales` | moderate | allowed | Objection history kept |
| `customer_support` | conservative | allowed | Issue context critical |
| `hospitality` | moderate | allowed | — |
| `general` | moderate | allowed | — |
| `medical` | **none** | **blocked** | Protected zone |
| `legal` | **none** | **blocked** | Protected zone |
| `crisis` | **none** | **blocked** | Protected zone — hard floor |

Classification happens in <10ms on CPU. No LLM call needed for routing.

---

## Protected zones

The protected zone is not a filter. It is an architectural boundary.

When the classifier returns `medical`, `legal`, or `crisis`:

1. Compression is **disabled at the function level** — not skipped, not flagged, disabled
2. The raw history is passed to the LLM unchanged
3. Semantic response caching, cross-session retrieval, and automatic long-term memory writes are blocked
4. The policy decision is included in the context plan and can be traced without storing prompt text

This is the CTBM (Conversation-Type-Based Monetization) principle: conversation type is the primary structural boundary, not user consent or subscription tier.

---

## Memory layer

```
PostgreSQL (when `DATABASE_URL` is set)
  wiki_store          User and LLM wiki documents per API key
  context_policies    Versioned policy per API key
  context_traces      Prompt-free context-decision audit traces

data/ (local fallback)
  JSON stores for keys, wiki data, policies, and traces
```

The MCP tools `cts_memory_remember` and `cts_memory_recall` expose local CTS memory to MCP-compatible clients. API memory facts include source IDs and support correction or deletion.

---

## Self-host vs managed

| | Self-hosted | Managed API (yudi.co.in) |
|---|---|---|
| Core classifier | Base HuggingFace DistilBERT | Fine-tuned Yudi weights |
| Compressor | Base T5-small | Fine-tuned T5 (higher recall) |
| Protected zone enforcement | ✓ full | ✓ full |
| Token savings | workload-dependent | workload-dependent; validate with quality evaluation |
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
# Classify a conversation turn
POST /classify
{ "message": "I've been having chest pains", "history": [...] }
→ { "domain": "medical", "risk": "high", "protected": true }

# Compress history
POST /compress
{ "history": [...], "domain": "coding" }
→ { "compressed": [...], "tokens_saved": 3420, "ratio": 0.61 }

# Health + model readiness
GET /ready   → 200 with rule-based fallbacks by default; set `CTS_REQUIRE_LOCAL_MODELS=true` to require the local classifier
GET /health  → always 200 if HTTP server is alive
```

---

## Inspired by

- [mem0](https://github.com/mem0ai/mem0) — persistent memory layer architecture
- [LangChain](https://github.com/langchain-ai/langchain) — conversation chain abstractions
- [Nissenbaum (2004)](https://crypto.stanford.edu/~ninghui/courses/Fall2008/papers/privacy_as_contextual_integrity.pdf) — contextual integrity as the theoretical ground for protected zones
- [ARIA by Yudi Labs](https://github.com/ashy5454/aria) — autonomous research loop that uses EchoRegent's memory layer

---

## License

MIT — see [LICENSE](LICENSE).

The fine-tuned model weights (`cts_classifier`, `cts_t5`) are proprietary to Yudi Labs and are not included in this repository. The core code runs on base HuggingFace models. Managed API access with Yudi-trained weights is available at [yudi.co.in](https://yudi.co.in).

---

<div align="center">
<sub>Built at Yudi Labs, Hyderabad · <a href="https://yudi.co.in">yudi.co.in</a></sub>
</div>
