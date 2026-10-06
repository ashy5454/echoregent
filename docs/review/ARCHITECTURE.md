# EchoRegent — Architecture & Tech Stack (prepared for external review)

**Snapshot:** 2026-10-06, branch `claude/echoregent-audit-2026-10-3saddb`
(commit `30b4660` plus uncommitted doc edits). The branch is PR #2 against
`master`, **open and unmerged**. Everything below describes this branch, not
`master`.

**Purpose of this file:** give an external reviewer a complete, honest map of
what the system is, what each component and model actually does, which
claims have evidence and which do not, and where the author already knows it
is weak. It is deliberately candid. Every statement about code is meant to be
checkable against the file named next to it.

---

## 1. The problem, from first principles

1. LLMs are stateless. The application must re-send the conversation context
   on every call.
2. Cost and latency scale with the number of input tokens sent. Answer
   quality can also degrade when irrelevant context is mixed in.
3. The context window is finite, and nothing persists between calls unless
   something outside the model stores it.

So every LLM call involves four decisions, and applications mostly make them
badly or not at all:

| Decision | Question |
|---|---|
| Selection | Which parts of the history and memory should the model see? |
| Form | In what form: verbatim, quoted, summarized? |
| Persistence | What is worth remembering after the call? |
| Posture | How cautious should the model be in this situation? |

**EchoRegent is a context controller between an application and an LLM
provider.** For each request it decides what the model sees, optionally how
cautiously it should respond and what to remember, and reports what it did
and what it saved.

The metric that matters is **answer quality at a given token budget**, not
tokens saved alone. A savings number is only credible if quality is shown to
be preserved and the saving is verified against the provider's billed usage.

---

## 2. Claims under review (the author's own ledger)

| # | Claim | Evidence in this repo | Status |
|---|---|---|---|
| C1 | Reduces input tokens by roughly X% | Paired A/B benchmark, `audit/notes/live_paired_bench.ts`: **29.4%** reduction in billed `total_tokens`. **n = 4 conversations, one run, one provider (Gemini).** It measured the *regex* compressor `compressHistory()`, **not** the embeddings path that is now the default. No quality judging in that script. | Indicative only |
| C2 | Compression preserves or improves answer quality | `audit/notes/locomo_eval_embeddings.ts`, 60 LoCoMo questions: F1 **0.213 (embeddings) vs 0.105 (regex)**. The script also has a full-transcript baseline arm, but that baseline number is **not recorded anywhere in the repo**. | Embeddings > regex is shown. "Compression ≥ no compression" is **not shown**. |
| C3 | Lower latency | Not measured end to end. The default embeddings path makes one outbound HTTP call **per message** (see §9). | **Unverified, plausibly false today** for long histories |
| C4 | Savings are net of provider prompt caching | A summary-snapshot mechanism (`SUMMARY_SNAPSHOT_BATCH = 4`) keeps the compressed prefix stable across turns so provider caches are not defeated. Break-even was *simulated* (`audit/bench/breakeven.ts`), not measured against a real provider bill. | Simulated only |
| C5 | Risk-aware handling (crisis, medical) | Risk signals are detected and returned in `x-cts-risk`. They do **not** change compression behavior. Two tests assert the missing behavior and fail on purpose (`audit/tests/protected-zones.test.ts`). | **Not implemented** |
| C6 | Output scoring / governance of LLM answers | Does not exist. See §13. | Proposal only |

A README claim of "87% quality match, 26x more efficient than mem0" existed in
git history (`973f84d`) and was found unreproducible in the audit (`AUDIT.md`
Part 1). It should be treated as retracted.

---

## 3. System at a glance

```
 client app ──HTTP──▶  src/server.ts  (one Node process, one big request handler)
                          │
      ┌───────────────────┼─────────────────────────────────────────┐
      ▼                   ▼                                         ▼
 classify()          compress*()                          wiki / llmWiki
 (keyword rules;     3 modes:                             (memory; injected only
  DistilBERT only     • regex  compressHistory             on /api/chat, /demo/chat)
  on /api/chat)       • T5     compressHistoryAsync
                      • embeddings (Gemini API)  ← default on the proxy
      │                   │
      └──────▶ forward to provider: OpenAI-compatible / Anthropic / Gemini
                          │
                          ▼
                 response + x-cts-* headers ──▶ usage log (Postgres or JSON files)
```

Two ML runtimes exist side by side: local ONNX inference in the Node process
(`@xenova/transformers` → `onnxruntime-node`) and a remote embeddings API
(Gemini).

---

## 4. Request lifecycle: the primary surface, `POST /v1/chat/completions`

`src/server.ts` (≈ lines 877–1100).

1. **Shape check.** Tool calls, null content and array (multimodal) content
   are rejected with a clean 400 (`findUnsupportedMessageShape`).
2. **Auth.** `Authorization: Bearer cts_…` looked up by SHA-256 hash, 60
   requests/minute/key, in-memory counter.
3. **Split** the caller's messages into system message, history, and current
   user message.
4. **Classify** with the *keyword-rule* `classify()` → `RoutingFrame`
   (domain, intent, state, risk, confidence). DistilBERT is **not** used here.
5. **Compress.** If an embeddings key is available (`x-embedding-key`, or the
   caller's own key when their provider is Gemini), try
   `compressHistoryWithEmbeddings()`; on any failure fall back to the regex
   `compressHistory()`.
6. **Build a provider-specific request body** (Anthropic: top-level `system`
   and required `max_tokens`; Gemini: OpenAI-compat endpoint with Bearer
   auth; default: OpenAI-compatible at `x-llm-base-url`, validated against
   SSRF).
7. **Forward** to the provider (60 s timeout) and stream or relay the
   response, adding `x-cts-tokens-saved`, `-domain`, `-intent`, `-risk`,
   `-compression-pct`, `-compression-mode`, and (non-streamed) `-actual-usage`.
8. **Log** one usage row: domain, provider, model, estimated tokens saved,
   provider-reported usage (non-streamed only), compression mode, original
   and kept message counts. **No conversation text is stored.**

What this path does **not** do: it injects no memory and no EchoRegent system
prompt. The caller's own system message passes through untouched.

---

## 5. Endpoint → component matrix

This is the most useful table for judging "what is actually used where".

| Route | Classifier | Compressor | Memory injected | Semantic cache | Who supplies the LLM key |
|---|---|---|---|---|---|
| `POST /v1/chat/completions` (primary) | keyword rules | embeddings → regex fallback | no | no | caller (`x-llm-key`) |
| `POST /api/chat` | **DistilBERT** → keyword fallback | **T5** → rule fallback | yes (user wiki + LLM wiki) | no | caller (`live` in body) or canned mock reply |
| `POST /demo/chat` | keyword rules | regex | yes (LLM wiki) | **MiniLM** | EchoRegent (`DEMO_LLM_API_KEY`) |
| `POST /demo/compress-async` | DistilBERT | T5 | no | no | none (compression demo) |
| `POST /demo/compress-embeddings` | keyword rules | embeddings | no | no | none |
| `POST /api/classify`, `POST /compress` | keyword rules | regex (`/compress`) | no | no | none |

Consequence worth stating plainly: **the two models that were trained for this
product (DistilBERT, T5) are not on the primary product path.** The primary
path runs keyword rules plus the Gemini embeddings API.

---

## 6. Components

### 6.1 Classification (`src/cts-core/classifier.ts`, `ml-classifier.ts`, `signals.ts`)
- `RoutingFrame` = intent (12 values), conversation state (7), domain (8 plus
  custom plugins), risk signals (6), extracted signals, confidences.
- **Keyword/rule classifier** is what production routes use. Intent, state and
  risk are *always* rule-based, even on the ML path.
- **DistilBERT** only predicts **domain**. Its label set has **7 classes and no
  `legal`** (`ml/cts_classifier/config.json`:
  customer_support, coding, medical, education, sales, commerce, general).
- One observation (n = 1): on an obvious order-support conversation,
  DistilBERT returned `coding`, the keyword classifier `customer_support`.
  Training data was heavily imbalanced (thousands of coding examples vs.
  single digits elsewhere).

### 6.2 Compression (`src/cts-core/compressor.ts`, ≈ 900 lines)
All modes: histories of ≤ 4 messages pass through unchanged. All modes
prepend a **synthetic natural-language summary message** of older turns,
built deterministically from extracted facts (entities, constraints,
unresolved items, inferred user goal), not by an LLM.

**Rule-based path** (`compressHistory`), the "parameters and variables":
- Domain keyword vocabularies (`domainPattern`), fact-set overlap ×3,
  structural boosts (codes/IDs), action-signal boosts, distractor penalties.
- Recent window: 4 messages for high-value domains (coding, customer_support,
  sales), else 2. Up to 2 "anchor" messages with relevance score ≥ 4.
- Candidate ladders with token-ratio ceilings: 0.62 (high-value domains) or
  0.5 (others).
- **Must-keep rescue pass:** hard facts (HTTP codes, IDs, dates, proper nouns,
  numbers with units) missing from the output pull back up to 2 original
  messages.
- **Minimum-retention floor:** at least 15% of messages (min 4) always kept.
  Added after a long conversation collapsed to a handful of messages.
- **Stable summary snapshots:** summary text only changes every 4 settled
  messages, to avoid breaking provider prompt-cache prefixes.
- Known weakness: relevance is largely hand-tuned vocabulary per domain. It is
  blind on text outside those vocabularies (audit issue #3).

**Embeddings path** (`compressHistoryWithEmbeddings`): embed the current user
message (query) and every candidate message separately via Gemini
`gemini-embedding-001`, rank by cosine similarity, keep the recent window
verbatim, then greedily fill a token budget (ratio 0.62 / 0.5) by rank, then
apply the 15% floor (backfilled by rank). Needs no domain label.

**T5 path** (`compressHistoryAsync`): feeds ≈ 1,500 chars of filtered history
to T5-small to produce a summary. The model's output is degenerate (no word
boundaries); a validator now rejects it and falls back to the rule path. Not
used on the primary path.

### 6.3 Memory (`wiki.ts`, `llmWiki.ts`)
- **User wiki:** rule/regex extraction into `profile`, `patterns`,
  `activeContext`, `mistakes`, `behavioralSignals`. Extraction is crude (a
  stored fact looked like `profile_fact: Stanford and I am building a fintech
  app`).
- **LLM wiki:** LLM-assisted ingestion of sources into wiki pages (requires a
  provider call).
- Scoped per `(API key, x-end-user-id)`. Customer-facing view/clear at
  `/memory`; `GET`/`DELETE /api/wiki`.

### 6.4 Semantic response cache (`semantic-cache.ts`)
MiniLM embeddings, cosine threshold 0.92, max 500 entries, 1 h TTL, scoped by
(domain, session), disabled for `legal`. Used only by `/demo/chat`.

### 6.5 Provider layer
Proxy path builds provider-shaped bodies inline in `server.ts`. Hosted
endpoints use `providerServer.ts`. `x-llm-base-url` must be `https` and must
not resolve (DNS lookup) to a private/loopback/link-local address.

### 6.6 SaaS layer (`src/saas/`)
API keys (hash only stored), admin secret for `/admin/*`, per-key quota
counter, usage log. Postgres if `DATABASE_URL` is set, else JSON files under
`data/`. Rate limiting is in-process memory, so it does not hold across
multiple instances.

### 6.7 Surfaces
Vite landing page (`index.html`, `src/main.ts`, `src/styles.css`), admin
dashboard and customer memory page (server-rendered HTML strings), and a
separate `cts-mcp/` MCP server with 4 tools.

---

## 7. Models: what each is used for

| Model | Base / size | Task | Runtime | Status | Used by |
|---|---|---|---|---|---|
| Domain classifier | DistilBERT, 6 layers, hidden 768 (≈ 66M params), fine-tuned | domain label only (7 classes) | ONNX in-process (`transformers.js`) | Loads and runs; biased; no `legal` class | `/api/chat`, `/demo/compress-async` |
| T5 summarizer | T5-small (≈ 60M params), fine-tuned | abstractive history summary | ONNX in-process | **Broken output**; guarded by validator | `/api/chat`, `/demo/compress-async` |
| MiniLM | `all-MiniLM-L6-v2`, quantized ONNX (≈ 23 MB) | sentence embedding for response cache | ONNX in-process | Works (verified live) | `/demo/chat` |
| Gemini embeddings | `gemini-embedding-001` (remote API) | query/message relevance for compression | HTTPS API | Works; costs a network call per message | `/v1/chat/completions`, `/demo/compress-embeddings` |
| Provider LLMs | OpenAI / Anthropic / Gemini / OpenRouter | the actual completion | HTTPS API | Customer's choice | all generation |

Weights are not committed. They live on the `ml-models` git branch via Git
LFS, downloaded into `ml/` (gitignored). A known blocker for any re-export:
exports produced by current tooling use ONNX IR version 9, while the pinned
`onnxruntime-node` loads up to IR version 8.

---

## 8. Tech stack

| Layer | Technology |
|---|---|
| Server | Node 20+, TypeScript, hand-written `node:http` request handler (no framework) |
| ML inference | `@xenova/transformers` (transformers.js) → `onnxruntime-node` |
| Embeddings | Gemini REST API |
| Tokenizer | `gpt-tokenizer` (for estimating tokens saved) |
| Persistence | Postgres (`pg`) or local JSON files |
| Frontend | Vite, vanilla TypeScript, one CSS file |
| MCP | `@modelcontextprotocol/sdk` (separate package) |
| Tests | Vitest; `audit/tests` includes a suite that spawns the real server against a local mock upstream |
| Training / export (planned) | Python: `transformers`, `sentence-transformers`, `optimum` |
| Deploy | Railway (nixpacks) or Docker |

---

## 9. Latency profile

Measured on the author's sandbox CPU, single process, warm, indicative only
(median-style averages over many calls):

| Operation | Measured |
|---|---|
| Keyword `classify()`, 8-turn / 50-turn history | 0.13 ms / 0.23 ms |
| Regex `compressHistory()`, 9 / 51 messages | 0.66 ms / 1.5 ms |
| MiniLM local embedding (+ empty-cache scan) | ≈ 2.5 ms |
| DistilBERT `classifyAsync()`, warm | ≈ 34 ms |
| DistilBERT first call including model load | ≈ 30 s (warm-up at boot hides this) |

**Not measured:** the Gemini embeddings path. By construction it issues
**1 + N HTTP calls per request** (query plus one per non-recent message,
concurrency 8) and **re-embeds the entire history on every turn**, because
nothing caches message embeddings between requests. Latency therefore grows
with history length and includes a round trip to Google. T5 generation is also
unmeasured. The end-to-end effect on request latency (compression saves
provider prefill time but adds embedding time) has not been measured at all.

---

## 10. Data flow and privacy

- Conversation content is sent to the **customer's chosen LLM provider** (as
  expected) **and, on the embeddings path, also to Google's embeddings API**,
  even when the customer's provider is OpenAI or Anthropic.
- The usage log stores metadata only (no message text).
- The memory stores store extracted facts and ingested sources per key/end-user,
  viewable and deletable by the customer.
- Provider keys travel in per-request headers and are not stored.

---

## 11. Known weaknesses (author's own list)

1. The primary path does not use the trained models; the trained models are
   weak or broken (biased classifier without a `legal` class; broken T5).
2. Quality preservation is unproven (C2); the headline 29.4% (C1) comes from
   a different compressor and n = 4.
3. The embeddings path is expensive in calls and likely slow for long
   histories (§9), and leaks content to a second vendor.
4. Risk signals are advisory only; protected-zone behavior does not exist.
5. The synthetic summary is injected as ordinary history; whether a model
   treats a synthetic assistant-role summary as real prior output is untested.
6. Memory extraction is regex-grade.
7. No runtime quality gate: nothing detects when compression has damaged an
   answer.
8. Rate limiting and quotas are single-instance only.
9. No tool-call or multimodal support (rejected with 400).

---

## 12. Proposed direction (author's thinking, not built)

Candidate ordering: (1) posture layer: enforce protected zones as policy;
(2) cache message embeddings and move relevance scoring on-box (a
fine-tuned MiniLM scorer, ≈ 2.5 ms per embed) to remove the network hop and
the second-vendor data flow; (3) memory quality; (4) verified savings via a
holdout arm, scored by an output-quality signal.

---

## 13. Proposed extension: an output scoring / governance layer

**Idea:** a layer that scores what the LLM produced (for example, a per-line
confidence or correctness score on generated code) and flags output that is
probably wrong, as an external governor on LLM outputs.

**Constraints the author has identified:**
- Ground truth is the hard part. Strong signals for code are *execution-based*
  (parse, type-check, lint, run tests) and need an environment the proxy does
  not have. Model-as-judge scoring is cheap but noisy and correlated with the
  generator. Token log-probabilities are available from only some providers
  and are weakly calibrated. Self-consistency sampling multiplies cost, which
  conflicts with a cost-reduction product.
- Latency and cost: any scoring that blocks the response works against the
  "lower latency, lower cost" claims. Asynchronous scoring (stream through,
  score afterwards, expose via headers/webhook/dashboard) avoids this.
- Market: output evaluation, observability and guardrails is a crowded
  category. The author has **not** researched it in this repo (`AUDIT.md`
  Part 4 covers caching, gateways, memory layers and compressors only).
- Strategic fit: scoring is arguably most valuable first as an **internal
  instrument** that measures answer quality with and without compression (the
  missing evidence for C2 and the basis for verified-savings billing), and only
  later as a customer-facing feature.

---

## 14. Questions for the reviewer

See `REVIEW_PROMPT.md`. In short: is the core idea sound, is the evidence
sufficient for the claims, is the architecture fit for the goal, and is the
output-scoring extension worth building.

---

## 15. How to verify things yourself

```bash
npm install
npx tsc --noEmit                       # typecheck
npx vitest run audit/tests             # expect 23 passed, 3 failed (known, intentional)
npm run build                          # vite build
npm run api                            # start the server on $PORT
# real benchmarks (need a Gemini key in GEMINI_TEST_KEY):
npx tsx audit/notes/live_paired_bench.ts
npx tsx audit/notes/locomo_eval_embeddings.ts
```

The 3 intentional failures are: protected zones not enforced (2 tests) and the
proxy not using the T5 path (1 test).
