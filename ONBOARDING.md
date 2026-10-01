# EchoRegent — Engineering Onboarding & Repo Map

**For:** a new engineer joining this codebase.
**As of:** 2026-10-01. The audit described in Section 8 lives in PR #2
(`claude/echoregent-audit-2026-10-3saddb` → `master`), which is **open and
unmerged** as of this writing. Check its status before trusting any
"current state" claim below — if it's merged, everything here describes
`master`; if it isn't, everything here describes that branch, not `master`.

This document is a map, not a replacement for the real docs already in the
repo. It tells you what exists, where it is, which parts are true today and
which parts are aspirational, and what order to read things in. Where a
section below would just repeat an existing doc, it links to it instead.

---

## 0. Reading order for your first day

1. `README.md` — the product pitch, quickstart, and API surface as currently
   documented (post-cleanup — see Section 8, it used to contain unverifiable
   numbers and no longer does).
2. This document, in full.
3. `AUDIT.md` — a full technical/commercial audit written before the fixes
   in PR #2. Read it for the *reasoning*, not for current state — most of
   what it flags as broken is now fixed. Section 8 below tells you which
   parts are stale.
4. `ML_RETRAIN_GUIDE.md` — if you're going to touch anything ML-related,
   read this before writing code. It has real dataset names, checkpoints,
   and fine-tuning recipes, not a vague plan.
5. `CTS_SETUP_GUIDE.md` and `PRODUCTION_READINESS.md` — older, narrower docs
   (API endpoint reference, and a pre-pilot gap checklist). Still accurate
   for what they cover, just not comprehensive.

The repo is still internally called "CTS" in a lot of code, comments, and
some docs (the product is branded EchoRegent; CTS — "Conversation Token
System" — is the original/internal name). You'll see both. They're the same
thing.

---

## 1. What EchoRegent is, in one paragraph

EchoRegent is HTTP middleware that sits between your application and an
LLM provider (OpenAI, Anthropic, Gemini, or anything OpenAI-compatible). On
every request it classifies the conversation (domain, intent, risk),
compresses the history to cut token cost without losing meaning, optionally
injects long-term memory about the user, forwards the compressed request to
whichever provider you configured, and returns the provider's response with
EchoRegent's own metadata (domain, compression ratio, tokens saved) attached
as response headers. You either use it as a drop-in OpenAI-compatible proxy
(`/v1/chat/completions`, bring your own provider key) or as a hosted chat
endpoint where EchoRegent itself holds the key and generates replies
(`/api/chat`, `/demo/chat`).

---

## 2. Architecture overview

```
            ┌─────────────────────────────────────────────────────────┐
            │                      src/server.ts                       │
            │        (single Node HTTP server, every route lives       │
            │                  in one big request handler)             │
            └─────────────────────────────────────────────────────────┘
                     │                    │                   │
          ┌──────────┴──────┐   ┌─────────┴────────┐   ┌──────┴───────┐
          │   classify()     │   │  compress*()      │   │  wiki / llmWiki │
          │  src/cts-core/   │   │  src/cts-core/     │   │  src/cts-core/  │
          │  classifier.ts   │   │  compressor.ts     │   │  wiki.ts,       │
          │                  │   │                     │   │  llmWiki.ts     │
          │  domain + intent │   │  3 modes:           │   │                 │
          │  + risk, via     │   │  - compressHistory  │   │  per-(key,end-  │
          │  DistilBERT ONNX │   │    (regex, sync)    │   │  user) structured│
          │  or keyword      │   │  - compressHistory- │   │  memory, exposed│
          │  fallback        │   │    Async (T5 —      │   │  at /api/wiki*  │
          │                  │   │    BROKEN, unused   │   │  and /memory    │
          │                  │   │    in the proxy path)│   │                 │
          │                  │   │  - compressHistory- │   │                 │
          │                  │   │    WithEmbeddings   │   │                 │
          │                  │   │    (Gemini real     │   │                 │
          │                  │   │    embeddings — the │   │                 │
          │                  │   │    LIVE DEFAULT)     │   │                 │
          └──────────────────┘   └─────────────────────┘   └─────────────────┘
                     │
          ┌──────────┴───────────────────────────────┐
          │   forward to provider (one of):            │
          │   OpenAI / Anthropic / Gemini / OpenRouter  │
          │   / any OpenAI-compatible base URL          │
          │   (validated against SSRF — see Section 8)  │
          └─────────────────────────────────────────────┘
                     │
          ┌──────────┴───────────────────────────────┐
          │  src/saas/ — API keys, usage logging,      │
          │  rate limiting, quota. Postgres if          │
          │  DATABASE_URL is set, else local JSON files │
          │  under data/ (gitignored).                  │
          └─────────────────────────────────────────────┘
```

Two separate usage patterns, don't confuse them:

- **Proxy mode** (`/v1/chat/completions`): the caller brings their own
  provider key via `x-llm-key`. EchoRegent classifies and compresses, then
  forwards to the real provider and relays the real response. EchoRegent
  never generates the reply itself here.
- **Hosted mode** (`/api/chat`, `/demo/chat`): EchoRegent holds its own
  provider key (`DEMO_LLM_API_KEY` / `GEMINI_API_KEY`) and generates the
  reply itself, via `src/providerServer.ts` → `callGemini`/`callOpenRouter`.
  This is what the landing-page demo chat and `/api/chat` use.

---

## 3. Core data model & vocabulary

Read `src/cts-core/types.ts` early — it's the shared vocabulary every other
file assumes you already know. The central type is `RoutingFrame`, produced
by `classify()`/`classifyAsync()` on every request:

```ts
interface RoutingFrame {
  intent: IntentType
  state: ConversationState
  domain: DomainType
  risk: RiskSignal[]
  signals: ExtractedSignals
  confidence: { intent: number; state: number; domain: number; risk: number }
}
```

**`IntentType`** (what the user is trying to do): `information_seeking`,
`task_execution`, `decision_support`, `comparison`, `summarization`,
`generation`, `debugging`, `escalation`, `objection_handling`,
`confirmation_seeking`, `exploration`, `correction`.

**`ConversationState`** (where in the conversation arc this turn sits):
`opening`, `deepening`, `pivoting`, `returning`, `escalating`, `resolving`,
`closing`.

**`DomainType`** (topic area — this is what drives compression aggressiveness
and system-prompt selection): `general`, `coding`, `customer_support`,
`sales`, `legal`, `medical`, `education`, `commerce`, plus an open string
type so custom domain plugins can add their own.

**`RiskSignal`** (safety flags, can be multiple at once): `medical_caution`,
`legal_caution`, `financial_caution`, `protected_context`, `unsafe_request`,
`crisis`. These are surfaced to the caller via the `x-cts-risk` response
header (the "conversation awareness" signal) but — see Section 9, Issue
#1 — they don't yet *change* compression behavior on their own.

**`CompressionResult`** (what every `compress*()` function returns):
`original`/`compressed` message arrays, `droppedCount`, `originalTokens`/
`compressedTokens`/`tokensSaved`, and `keptReasons` (human-readable strings
explaining why each kept message survived — useful for debugging a specific
compression decision).

**`WikiDocument`** (per-user structured memory, rule-based, instant):
`profile`, `patterns`, `activeContext`, `mistakes`, `behavioralSignals`
(all `string[]`), plus `version`/`lastUpdated`.

**`LLMWiki`** (ingested knowledge-base sources, bigger and AI-assisted):
`sources` (raw ingested documents), `pages` (synthesized wiki pages),
`indexMarkdown`/`logMarkdown`/`schemaMarkdown`, `version`/`lastUpdated`.

---

## 4. Repository map

```
echoregent/
├── README.md                 Product pitch, quickstart, API reference
├── AUDIT.md                  Full audit (pre-PR#2 fixes — read Section 8 first)
├── ML_RETRAIN_GUIDE.md       Real datasets/architectures/recipes for retraining
├── ONBOARDING.md             This document
├── CTS_SETUP_GUIDE.md        Memory API reference + local dev setup
├── PRODUCTION_READINESS.md   Pre-pilot gap checklist
├── index.html                Vite entry point — the landing/demo page
├── .env.example              Template for the env vars server.ts reads
├── Dockerfile, nixpacks.toml, railway.toml   Deployment config (Railway target)
│
├── src/
│   ├── server.ts             The HTTP API server. Every route (/v1/chat/
│   │                         completions, /api/*, /admin/*, /demo/*) is an
│   │                         `if` block inside one big request handler.
│   │                         ~1,100 lines. Start here to trace any request.
│   ├── admin-ui.ts           Returns the admin dashboard HTML (served at
│   │                         GET /admin-ui). Admin-secret-gated.
│   ├── memory-ui.ts          Returns the customer-facing "your memory" page
│   │                         HTML (served at GET /memory). Gated by the
│   │                         customer's own API key, not the admin secret.
│   ├── providerServer.ts     callLLMProvider() — used only by hosted-mode
│   │                         endpoints (/api/chat, /demo/chat), not the proxy.
│   ├── llmClient.ts          Shared provider config types + default models.
│   ├── apiClient.ts          A browser-side API client. NOT imported by
│   │                         main.ts — leftover from an earlier frontend
│   │                         iteration, confirmed unused this session.
│   ├── scenarios.ts          Example conversation fixtures per domain. Also
│   │                         not imported anywhere live; useful as content
│   │                         to copy from, not as running code.
│   ├── main.ts               The landing page's client-side script — demo
│   │                         chat, quickstart tabs, waitlist form, usage
│   │                         dashboard widget. Paired with index.html.
│   ├── docs.ts, usecases.ts  Client scripts for docs.html/use-cases.html —
│   │                         those HTML files don't exist yet (deferred;
│   │                         server.ts falls back to index.html for those
│   │                         routes so nothing 404s).
│   ├── stars.ts              initStarfield() — shared canvas background,
│   │                         used by main.ts, docs.ts, usecases.ts.
│   ├── styles.css            All frontend styling, ~1,800 lines, one file.
│   │
│   ├── cts-core/             The actual product logic. No HTTP here.
│   │   ├── types.ts          Every shared type — read Section 3 first.
│   │   ├── classifier.ts     classify()/classifyAsync() — domain/intent/
│   │   │                     risk detection. Sync version uses keywords;
│   │   │                     Async tries the real ONNX classifier first.
│   │   ├── ml-classifier.ts  ONNX runtime wrapper for the DistilBERT model.
│   │   ├── compressor.ts     All three compression modes (see Section 2).
│   │   │                     ~900 lines, the most complex file in the repo.
│   │   ├── ml-t5.ts          ONNX runtime wrapper for the T5 model — the
│   │   │                     one that's currently broken (Section 7).
│   │   ├── embeddings.ts     Gemini embeddings client used by
│   │   │                     compressHistoryWithEmbeddings().
│   │   ├── semantic-cache.ts MiniLM-based response cache (checkCache/
│   │   │                     storeCache) — used by hosted-mode endpoints
│   │   │                     to skip regenerating identical-ish replies.
│   │   ├── wiki.ts           Per-user structured memory implementation.
│   │   ├── llmWiki.ts        Ingested knowledge-base sources/pages.
│   │   ├── router.ts         Builds the system prompt from the routing
│   │   │                     frame + any custom domain plugins.
│   │   ├── signals.ts        Feature extraction helpers used by classifier.ts.
│   │   ├── mockResponder.ts  A canned responder used only by the cts()/
│   │   │                     ctsAsync() library-mode functions (see
│   │   │                     index.ts) — not used by server.ts at all.
│   │   ├── tokenizer.ts      Real tokenizer (gpt-tokenizer) for honest
│   │   │                     tokensSaved figures — replaced a chars/4
│   │   │                     estimate this session.
│   │   └── index.ts          Public exports + cts()/ctsAsync() — a
│   │                         library-style entry point separate from
│   │                         server.ts's HTTP routes. Mostly used by evals.
│   │
│   └── saas/                 Everything about being a multi-tenant product.
│       ├── db.ts              ApiKey/UsageEntry/WikiStore CRUD, dual-backed:
│       │                      Postgres if DATABASE_URL is set, else JSON
│       │                      files under data/ (gitignored, created on
│       │                      first write).
│       ├── database.ts        getDb()/initDb() — the Postgres pool + schema
│       │                      (CREATE TABLE IF NOT EXISTS + additive ALTER
│       │                      TABLE ADD COLUMN IF NOT EXISTS migrations).
│       └── auth.ts            authenticate() (Bearer-token lookup + rate
│                               limit) and recordUsage() (usage logging).
│
├── audit/
│   ├── tests/                 Vitest suite. Run with `npx vitest run
│   │   │                      audit/tests`. Two tests are INTENTIONALLY
│   │   │                      still failing — see Section 9, don't try to
│   │   │                      make them pass without reading it first.
│   │   ├── integration.test.ts        Spawns the real server as a child
│   │   │                              process, hits it with real HTTP
│   │   │                              requests against a local mock
│   │   │                              upstream. No external API calls.
│   │   ├── static-source-checks.test.ts  Source-text assertions for things
│   │   │                              that can't be exercised live here
│   │   │                              (no real provider keys, no ml/
│   │   │                              weights in this checkout).
│   │   ├── protected-zones.test.ts    The one open issue — Section 9.
│   │   ├── distractor-patterns.test.ts, overfit-demo-entities.test.ts,
│   │   │   prompt-caching.test.ts, token-estimation.test.ts  Each
│   │   │                              documents and verifies one fixed bug.
│   │
│   ├── bench/                  Rigorous (designed, mostly not yet run at
│   │                           scale) benchmark harness: paired-eval.ts,
│   │                           breakeven.ts, stats.ts. See AUDIT.md Part 5.
│   │
│   └── notes/                  Smaller, real, already-run scripts:
│       ├── live_paired_bench.ts        The real paired A/B benchmark that
│       │                               produced the 29.4% token-reduction
│       │                               number (needs GEMINI_TEST_KEY).
│       ├── locomo_eval.ts, locomo_eval_embeddings.ts  Real LoCoMo dataset
│       │                               evals — the second produced the
│       │                               F1 0.213 (embeddings) vs 0.105
│       │                               (regex) comparison.
│       └── locomo/                     The actual LoCoMo dataset JSON.
│
├── cts-mcp/                    A SEPARATE sub-project: a standalone MCP
│   │                           (Model Context Protocol) server with its own
│   │                           package.json. Exposes 4 tools
│   │                           (cts_compress_history, cts_classify_intent,
│   │                           cts_memory_remember, cts_memory_recall) for
│   │                           Claude/Cursor/Windsurf. Not wired into
│   │                           src/server.ts at all — a separate product
│   │                           surface, secondary priority per AUDIT.md.
│   └── src/  index.ts, tools.ts, memory.ts
│
├── src/evals/                  Standalone eval scripts, run via npm scripts
│   │                           (eval:dataset, eval:tokens, eval:session-
│   │                           memory, eval:plugins, eval:convert).
│
└── ml/                         Model weights. GITIGNORED — never committed
                                 directly. Distributed via the `ml-models`
                                 git branch + Git LFS (confirmed working:
                                 `git fetch origin ml-models`, then
                                 `git show origin/ml-models:<path> | git-lfs
                                 smudge > <path>` for individual files).
                                 Download scripts: ml/download_*.py.
    cts_classifier/              DistilBERT ONNX — real, works, biased data.
    cts_t5/                      T5 ONNX — real, broken output. Section 7.
    cts_minilm/                  MiniLM ONNX, several quantization variants
                                  — real, works, verified live this session.
```

---

## 5. Request-flow walkthrough: a single `/v1/chat/completions` call

Read this with `src/server.ts` open. Line numbers are approximate — the
file moves as it's edited, but the order of operations doesn't.

1. **Route match** (`server.ts:877`) — `POST /v1/chat/completions`.
2. **Auth** — `authenticate()` (from `saas/auth.ts`) checks the
   `Authorization: Bearer <cts_key>` header against the key store, applies
   the 60-req/min rate limit.
3. **Classify** (`server.ts:921`) — `classify(currentMessage, historyMsgs)`
   returns a `RoutingFrame` (Section 3).
4. **Compress** — tries `compressHistoryWithEmbeddings()` first (needs a
   Gemini key, from `x-embedding-key` or reused from `x-llm-key` when the
   provider is Gemini — `server.ts:935`); falls back to the sync
   `compressHistory()` on any failure (no key, network error, etc.).
5. **Build the provider-specific request body** — three branches:
   - `llmProvider === 'anthropic'` (`server.ts:976`) — top-level `system`
     field, required `max_tokens`, no `role: "system"` message.
   - `llmProvider === 'gemini'` (`server.ts:990`) — OpenAI-compat endpoint,
     key via `Authorization: Bearer`, never in the URL.
   - default / OpenAI-compatible (`server.ts:1000`) — `x-llm-base-url` is
     validated here (`validateLlmBaseUrl()`) before use; see Section 8.
6. **Fetch the real provider**, with a 60s timeout via `AbortController`.
7. **Respond** — either streamed (SSE passthrough, `server.ts:1044`) or a
   single JSON response (`server.ts:1078`), with `x-cts-*` headers attached
   either way (tokens saved, domain, intent, risk, compression mode/%).
8. **Log usage** — `recordUsage()` is called with routing metadata (domain/
   provider/model), the pre-call token estimate, and — for non-streamed
   calls only — the provider's real reported usage and compression-shape
   metadata (original/kept message counts). This is what powers both
   `/api/usage` and the `/memory` page's "what was compressed" table.

---

## 6. Auth & API key model

Two completely separate auth mechanisms — don't mix them up:

**Customer API keys** (`cts_...` prefix) — issued via
`POST /admin/keys` (admin-secret-gated), used by customers against
`/v1/chat/completions`, `/api/*`, `/demo/*` via `Authorization: Bearer
<key>`. Looked up by SHA-256 hash (`src/saas/db.ts`'s `sha256()`), never
stored or logged in plaintext after issuance. Rate-limited to 60 requests/
minute per key (in-memory, resets if the server restarts — fine for a
single instance, won't hold across a multi-instance deployment without a
shared store).

```bash
# Issue a key (admin only)
curl -X POST $BASE/admin/keys \
  -H "Content-Type: application/json" -H "X-Admin-Secret: $CTS_ADMIN_SECRET" \
  -d '{"name":"Acme Corp","ownerEmail":"dev@acme.com"}'
# → {"id":"key_...","key":"cts_...","emailed":false,...}
# Save the "key" value now — it's never shown again, only its hash is stored.

# Use it
curl $BASE/api/usage -H "Authorization: Bearer cts_..."
```

**Admin secret** (`CTS_ADMIN_SECRET` env var) — a single shared secret, not
per-user, checked via the `X-Admin-Secret` header. Gates all of `/admin/*`:
key creation/revocation/quota edits, the full-fleet dashboard
(`/admin/dashboard`), and key-request (waitlist) management. There is no
admin user model beyond "knows the secret" — fine for a single founder/small
team, would need real auth before multiple admins with different
permissions matters.

**End-user scoping** (`x-end-user-id` header, optional) — lets one customer
API key represent many of *their* end users without their memories bleeding
into each other. When sent, wiki memory (`/api/wiki*`) is keyed by
`` `${key.id}:${endUserId}` `` instead of just `key.id`. Omitting the header
keeps the old pooled-under-one-key behavior — an explicit, documented
choice, not an oversight. Usage-log entries (`/api/usage/calls`) are **not**
currently scoped by end-user — they're always whole-API-key, since the
usage log never captured end-user id at all. If you need per-end-user usage
breakdowns, that's real, not-yet-done work.

---

## 7. The ML model stack — current real state (not aspirational)

| Model | Base checkpoint | Status | Where it's used |
|---|---|---|---|
| Classifier | `distilbert-base-uncased` | **Real, loads, runs.** Biased: trained on wildly imbalanced per-domain data (thousands of coding examples vs. single digits of legal), so it silently guesses "coding" when unsure. Architecture is fine; the training data isn't. | `classifyAsync()`, used by hosted-mode endpoints when available, keyword fallback otherwise. |
| T5 compressor | T5 (encoder/decoder) | **Real weights, broken output.** Generates text with no word boundaries — a genuine model/export defect, not a decode-config bug (the tokenizer's SentencePiece Metaspace setup is structurally correct). A validation+fallback was added this session so it fails loudly instead of silently shipping garbage, but the model itself is still broken. | `compressHistoryAsync()` — not called by the `/v1/chat/completions` proxy path at all (see Section 9, Issue #2). |
| MiniLM (semantic cache) | `sentence-transformers/all-MiniLM-L6-v2` | **Real, works, verified.** Live-tested this session: 0.97 cosine similarity on a true paraphrase, correct misses on unrelated queries, correct per-session isolation. | `checkCache()`/`storeCache()` in hosted-mode endpoints (`/api/chat`, `/demo/chat`). |

**The infrastructure blocker, if you retrain anything:** the two "fixed" T5
re-exports found earlier use ONNX IR version 9; this stack's
`onnxruntime-node` only loads up to IR version 8. Pin your export
toolchain's version (or upgrade `onnxruntime-node` deliberately, with
tests) *before* you export anything, and check `onnx.load(...).ir_version`
on every export before trusting it.

Full retrain plan, real datasets, and fine-tuning recipes:
**`ML_RETRAIN_GUIDE.md`** — read it in full before starting ML work, don't
re-derive this from memory. In short: Model 1 (classifier) is a rebalanced
fine-tune of the same base model, using real per-domain HF datasets
(`code_search_net`, a Bitext customer-support set, CUAD-QA, PubMedQA, SQuAD,
Amazon-QA, multi_woz_v22, plus synthetic sales data since no real public
set exists). Model 2 replaces T5 entirely with a fine-tuned
`all-MiniLM-L6-v2` relevance scorer (`MultipleNegativesRankingLoss` on
LoCoMo evidence pairs), gated at beating the current F1 0.213 embeddings
baseline. Both are Colab-sized jobs — the real cost is data prep, not
compute.

---

## 8. What the recent audit (PR #2) actually changed

`AUDIT.md` is a point-in-time snapshot written *before* the fixes below. It
found 11 real issues, ranked by severity. Everything in the list below was
then fixed, tested (typecheck + `audit/tests` + live smoke tests against a
real running server, not just unit tests), and shipped as commits on
`claude/echoregent-audit-2026-10-3saddb` → PR #2. If you're reading
`AUDIT.md` for background, cross-check every issue number against this list
— most of them are resolved now.

- **Compression collapse** — long conversations could compress to almost
  nothing. Fixed with a minimum-retention floor (15% of messages, minimum
  4) in both `compressHistory()` and `compressHistoryWithEmbeddings()`.
- **T5 silent failure** — now validated and falls back instead of shipping
  degenerate output (the model itself is still broken — see Section 7).
- **False-positive distractor filtering** — bare single-word patterns
  ("lunch", "Tokyo", "cat") were flagging real content as noise in any
  domain; now only multi-word, genuinely small-talk-specific phrases match.
- **Hardcoded demo-city bias** — "Dallas"/"Chicago" were hardcoded into
  customer-support scoring; replaced with a generic location-extraction
  pattern.
- **Provider request-shape bugs** — Anthropic and Gemini branches of the
  proxy were sending OpenAI-shaped bodies that those providers now reject;
  both fixed to send provider-correct shapes.
- **Unsupported message shapes crashing the server** — `tool_calls`, null
  content, array content now get a clean 400 instead of a 500 or silent
  corruption (narrow, tested scope — full tool-calling support is real,
  separate future work, not attempted here).
- **Token estimation** — was `chars/4`; now a real tokenizer
  (`gpt-tokenizer`), and every "tokens saved" figure shown anywhere is
  explicitly labeled estimated vs. provider-verified.
- **Cross-end-user memory leak** — wiki memory was keyed only by API key,
  so two end users of the same customer shared one memory. Now scoped by
  `(API key, x-end-user-id)` when the header is sent (Section 6).
- **SSRF via `x-llm-base-url`** — nothing validated that header before
  using it in an outbound fetch, so a caller could point the server at an
  internal/cloud-metadata address and relay the response back. Now
  validated: must be `https`, and the hostname must not resolve (live DNS
  lookup, not just literal-IP matching) to a private/loopback/link-local
  address. `src/server.ts`: `validateLlmBaseUrl()` / `isPrivateOrUnresolvableHost()`.
- **Gemini key in the URL** — moved to an `Authorization: Bearer` header.
- **Usage logging was throwing away real data** — domain/provider/model and
  the provider's real reported token usage were computed and then
  discarded. Now persisted on every usage-log row, exposed via
  `/api/usage/calls` (metadata only — no raw conversation content, by
  explicit decision).
- **`/memory`** — a new customer-facing page (no prior UI existed for the
  already-real `GET`/`DELETE /api/wiki` endpoints), plus a "what was
  compressed" activity table.
- **`index.html`** — this repo's Vite entry point never existed, so
  `npm run build` had never succeeded in this repo's history before this
  session. `src/main.ts`/`src/styles.css` were already complete; only the
  HTML shell was missing.
- **Embedding-based compression shipped as the default** —
  `compressHistoryWithEmbeddings()` (real Gemini embeddings) replaced
  regex-only compression as the live default for `/v1/chat/completions`,
  roughly doubling LoCoMo answer-quality F1 (0.213 vs. 0.105) per a real
  eval run (`audit/notes/locomo_eval_embeddings.ts`).

**Deliberately deferred, not forgotten** (ask before starting any of these
— they were explicitly held back, not missed):
- The full model retrain (Section 7 / `ML_RETRAIN_GUIDE.md`) — a real time
  and compute cost, intentionally not started yet.
- `docs.html` / `use-cases.html` dedicated content.
- A founder-facing ops/cost dashboard (real $ cost, time-series).
- A synthetic-traffic generator to seed usage data for demos.
- Automatic model routing (auto-picking a cheaper model per request) —
  explicitly ruled out of scope; no existing scaffolding for it.

---

## 9. Known open issues — the only two tests that should be red

Run `npx vitest run audit/tests`. You should see **23 passed, 3 failed**.
All three failures are two *known, intentional* issues (not regressions):

**Issue #1 — Protected zones aren't architecturally enforced**
(`audit/tests/protected-zones.test.ts`, 2 tests.) The README used to
promise that crisis-risk conversations pass through *unchanged* and
medical-domain conversations get *zero* compression. That promise was
removed from the docs this session (it wasn't true), but the real fix —
building an actual bypass — was never done. Today, every domain goes
through the same generic 15%-minimum-retention floor; there's no special
case keyed on `frame.risk` or `frame.domain` that fully exempts
crisis/medical content. If you pick this up: it belongs in
`compressHistory()`/`compressHistoryWithEmbeddings()` in
`src/cts-core/compressor.ts`, gated on `frame.risk.includes(...)` (Section
3's `RiskSignal` values) and `frame.domain === 'medical'`.

**Issue #2 — T5 isn't wired into the `/v1/chat/completions` proxy path**
(`audit/tests/static-source-checks.test.ts`, 1 test.) That route uses the
synchronous rule-based `compressHistory()`, not the async T5-based
`compressHistoryAsync()`. This is intentional: the real T5 model is broken
(Section 7). Wiring it in would just ship broken compression through the
main product surface. This is blocked on the retrain, not a quick fix —
don't "fix" it by just calling the async function without first confirming
the model works.

If you ever see a *different* test fail, that's a real regression —
investigate it as a bug, don't assume it's one of these two.

---

## 10. Business & GTM context (why things are scoped the way they are)

Full detail: `AUDIT.md` Part 9. Condensed, because it explains a lot of
*why* the code looks the way it does:

- **Pricing: a flat monthly fee (~$49–99/mo), not a cut of verified
  savings** — the "bill the customer a share of what we saved them" model
  is the real long-term differentiator, but it's structurally slow to cash
  (you can't invoice a verified delta until a real billing cycle has
  passed). Flat fee first, move to savings-based pricing once there are
  paying customers and testimonials.
- **Scope: OpenAI-only, text-only, no tool calls, for the first push** —
  not because other providers don't matter, but because that's the one
  path the compatibility matrix (`AUDIT.md` Part 3) confirmed actually
  works end-to-end. Everything outside that shape should fail loudly and
  cleanly (Section 8's "unsupported message shapes" fix) rather than being
  silently wrong.
- **~15–25 paying customers at the flat fee clears $1–2K MRR** — a volume,
  self-serve motion; the stated goal was reaching that within a 15-day push
  through founder-led outreach (own network + communities where this exact
  pain is discussed), not through paid acquisition or a sales team.
- **What's explicitly not being built in a launch sprint**: full
  tool-calling/multimodal support, automatic model routing, a from-scratch
  model retrain, a founder cost dashboard. These are real, valuable, and
  intentionally not on the critical path — see Section 8's deferred list.

If a design decision in the code seems narrower than it "should" be,
check here and in `AUDIT.md` Part 9 before assuming it's an oversight.

---

## 11. Testing & verification philosophy

This codebase holds itself to a specific, higher-than-default bar,
established over the course of the audit in PR #2: **a fix isn't done when
the unit test passes — it's done when it's been exercised against a real
running server with a real request.** Concretely, every fix in PR #2 was:

1. Typechecked (`npx tsc --noEmit`).
2. Run against `audit/tests` (expect the Section 9 baseline, nothing more
   red than that).
3. **Smoke-tested live**: the real server spawned as a child process
   (`npx tsx src/server.ts`, often with `nohup ... &` + `disown` so it
   survives across separate shell invocations), hit with real `curl`
   requests or a real headless Chromium session (Playwright — pre-installed
   in this environment at a fixed path, see any recent commit's description
   for the exact invocation pattern) for anything UI-facing, before being
   called done.

`audit/tests/` itself follows a convention worth knowing: each file
documents *one* historical bug, written as a test that originally failed
(a "confirmed-bug" test), then updated in place to assert the fixed
behavior once the real fix landed (a "confirmed-fixed" test) — the
describe-block names and comments narrate that history on purpose. When you
fix something, follow the same pattern: don't delete the old test, rewrite
it to prove the new behavior, and keep the comment trail explaining what
used to be true.

`audit/tests/integration.test.ts` spawns a real server against a real local
mock HTTP upstream — no external provider spend, but genuinely real HTTP
end-to-end, not a mocked-out unit test. If you add a test that needs to hit
`x-llm-base-url`, note the `CTS_TEST_TRUSTED_LLM_HOST` escape hatch
(Section 12) that exists specifically so this test file can point at its
own mock without weakening the real SSRF check for everyone else.

---

## 12. How to run things locally (and deploy)

```bash
npm install

# Frontend dev server (Vite, hot reload) — serves index.html + main.ts
npm run dev

# API server (tsx, no build step)
npm run api

# Full build — typecheck (tsc, noEmit per tsconfig) then vite build.
# Produces dist/index.html + bundled assets.
npm run build

# Audit test suite
npx vitest run audit/tests
# or just `npm test` for the full vitest suite

# Eval scripts (standalone, not part of CI)
npm run eval:dataset
npm run eval:tokens
npm run eval:session-memory
npm run eval:plugins
```

**Environment variables** (`.env.example` has the template):
- `DEMO_LLM_API_KEY` / `DEMO_LLM_MODEL` — hosted-mode provider key, used by
  `/api/chat` and `/demo/chat`. Falls back to `GEMINI_API_KEY` if unset.
- `GEMINI_API_KEY` — also used directly if you want Gemini as the demo
  provider, and reused as the embeddings key for compression when the
  caller's provider is Gemini.
- `CTS_ADMIN_SECRET` — required for `/admin/*` endpoints and `/admin-ui`.
  Generate with `openssl rand -hex 32`.
- `DATABASE_URL` — **not in `.env.example`, but read directly by
  `src/saas/database.ts`.** If unset, the server runs on local JSON files
  under `data/` (gitignored) instead of Postgres — fine for local dev, not
  for anything you want to persist reliably or run multi-instance.
- `CTS_TEST_TRUSTED_LLM_HOST` — test-only escape hatch for the SSRF check
  (Section 8), set only by `audit/tests/integration.test.ts`'s spawned
  server. Never set this in a real deployment.

**Getting real model weights**, if you're working on anything ML-related:
`ml/` is gitignored. Pull individual files from the `ml-models` branch (Git
LFS) without checking out the whole 1.3GB branch:
```bash
git fetch origin ml-models
git show origin/ml-models:ml/cts_minilm/onnx/model_quantized.onnx | git-lfs smudge > ml/cts_minilm/onnx/model_quantized.onnx
# repeat per file, or write a small loop over the files you need
```

**Deployment** — the configured target is Railway (`railway.toml`:
`nixpacks` builder, `npm install && npm run build` at build time). The
`Dockerfile` is an alternative path (`node:20-slim`, `npm ci`, copies
source, presumably `npm run build` + `npm run api` at runtime — check it
directly before relying on it, it wasn't touched or re-verified this
session). Either way, production needs real values for `CTS_ADMIN_SECRET`,
a real `DATABASE_URL` (local JSON files are a dev convenience, not a
production datastore), and whichever provider keys hosted-mode endpoints
need. `nixpacks.toml` also pins a `BUILD_ID` variable — bump it on
deploys where you need to force a clean rebuild.

---

## 13. Common gotchas (things that look like bugs but are known/expected)

- **`[CTS] T5 warm-up failed` / `classifier warm-up failed` in your local
  logs on startup.** Expected in any checkout without the real `ml/`
  weights (Section 4/7) — the server falls back to the keyword classifier
  and rule-based compressor automatically. Not an error you need to chase
  unless you've actually pulled the weights and still see it.
- **`GET /favicon.ico` returns 401 when running `npm run api` without
  first running `npm run build`.** The static-file fallback in
  `server.ts` tries `dist/favicon.ico` then `dist/index.html`; if
  `dist/` doesn't exist yet, both misses fall through to a later
  auth-gated route instead of a plain 404. Harmless in dev (browsers
  auto-request favicons), confirmed not an issue once `dist/` is built.
- **`src/apiClient.ts` and `src/scenarios.ts` are dead code.** Confirmed
  this session: neither is imported by `main.ts` or any other live entry
  point. `apiClient.ts` even has a hardcoded `http://127.0.0.1:8787`
  base URL that doesn't match this server's actual default port — a sign
  it's leftover from an earlier iteration of the frontend. Don't assume
  either file reflects current API behavior; check `server.ts` directly.
- **Two different `.api-container` CSS rules exist in `styles.css`** (one
  for the waitlist-form section, one — marked "updated" in a comment — for
  the quickstart tabs section). Same class name, different
  `grid-template-columns`, and CSS source order means the second
  definition wins for *any* element using that class, anywhere on the
  page. `index.html` deliberately avoids reusing `.api-container` for the
  waitlist form to sidestep this collision. If you add new HTML that needs
  that waitlist-form two-column layout, don't reach for `.api-container` —
  write a scoped class or inline style instead, or clean up the CSS
  collision properly first.
- **`mockResponder.ts` is not what generates real replies.** It backs the
  `cts()`/`ctsAsync()` library-mode functions in `cts-core/index.ts`
  (used by some eval scripts), not `server.ts`'s hosted-mode endpoints —
  those call the real providers via `providerServer.ts`. Don't go looking
  in `mockResponder.ts` to understand how `/api/chat` actually replies.
- **"CTS" vs "EchoRegent"** — the product was renamed; the rename is not
  complete everywhere. `README.md` and new session work (this doc
  included) use EchoRegent; `admin-ui.ts`'s page title, some older docs,
  and the npm package name (`cts-v4-local-api`) still say CTS. Functionally
  identical, cosmetically inconsistent — low priority, but don't be
  surprised by it, and don't "fix" it piecemeal without a deliberate pass.
- **`docs.html`/`use-cases.html` requests don't 404 — they silently serve
  `index.html` instead.** `server.ts` falls back to the landing page for
  those two routes specifically, which is a deliberate stop-gap (Section
  8), not a routing bug. If you build real content for those pages, make
  sure you actually create the HTML files — the fallback won't warn you
  that they're still missing.

---

## 14. Suggested first tasks

1. Clone, `npm install`, `npm run api`, hit `/health` — confirm it's up.
2. Run `npx vitest run audit/tests`, confirm you get the expected 23/3
   baseline from Section 9. If you don't, something changed — figure out
   what before doing anything else.
3. Read PR #2's full diff (or the `git log` on `claude/echoregent-audit-
   2026-10-3saddb` if it's merged by the time you read this) — it's the
   fastest way to see real, working examples of this codebase's conventions
   (how tests are written, how commits are scoped, how live smoke-testing
   is done before trusting a fix).
4. Pick a real starting task:
   - **Small, contained, pure code:** Issue #1 above (protected zones).
   - **Bigger, needs a Hugging Face account and some compute budget:**
     start on `ML_RETRAIN_GUIDE.md`'s Model 1 (classifier rebalancing) —
     it's the most self-contained of the two retrain targets and doesn't
     require inventing a new training recipe, just real balanced data.
5. Whatever you build: typecheck, run the audit suite, and do a real live
   smoke test against a running server before calling it done (Section 11).
   This codebase's established bar is "verified with a real request," not
   "the unit test passes" — keep holding it to that.
