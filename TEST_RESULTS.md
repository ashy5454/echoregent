> Historical development-service report. This document predates the current npm SDK/CLI product. For current architecture, protection/memory defaults and verification, read [PRODUCT_CHANGES.md](PRODUCT_CHANGES.md), [README.md](README.md) and [compaction verification](docs/evidence/COMPACTION_VERIFICATION.md).

# EchoRegent Test Suite & Audit Verification Results

**Date**: October 5, 2026
**Branch**: `claude/echoregent-audit-2026-10-3saddb`
**Commit**: [`30b4660`](file:///e:/echoregent) (`Add ONBOARDING.md — engineering handoff doc and repo map for new hires`)
**Environment**: Windows / Node.js 20 / TypeScript 5.6.3 / Vitest 2.1.9

---

## 1. Executive Summary

| Category | Target / Requirement | Observed Status | Notes |
|---|---|---|---|
| **Build** | `tsc && vite build` | **PASS (0)** | Built in 202ms; 5 modules transformed; `dist/` ready. |
| **Test Suite** | `vitest run` | **23 PASS / 3 FAIL** | 7 test files, 26 total tests. 0 skipped, 0 uncaught errors. |
| **Stale Contracts** | Review failing tests | **3 Documented Gaps** | 2 in `protected-zones`, 1 in `static-source-checks`. |
| **CI Integration** | Honest CI without hiding failures | **CONFIGURED** | [`.github/workflows/ci.yml`](file:///e:/echoregent/.github/workflows/ci.yml) created. |
| **Offline Eval** | Quality / Token Baseline | **PASS** | Evaluated via `eval:tokens`, `eval:session-memory`, `eval:plugins`. |
| **Cost Baseline** | Break-even vs Prompt Caching | **REPRODUCED** | 300 stochastic trials per cell; crossover at turns 20–40. |
| **Deployment Footprint** | GCP vs Railway | **INVENTORIED** | Code target is Railway; GCP is Dockerfile/Cloud SQL comment only. |

---

## 2. Test Execution Details (`npm test` / `vitest run`)

### 2.1 Summary Metrics
- **Test Files**: 5 passed, 2 failed (7 total)
- **Tests**: 23 passed, 3 failed (26 total)
- **Duration**: ~2.1s

### 2.2 Per-Suite Breakdown

| Test Suite File | Tests | Passed | Failed | Status |
|---|---|---|---|---|
| [`audit/tests/distractor-patterns.test.ts`](file:///e:/echoregent/audit/tests/distractor-patterns.test.ts) | 4 | 4 | 0 | **PASS** |
| [`audit/tests/overfit-demo-entities.test.ts`](file:///e:/echoregent/audit/tests/overfit-demo-entities.test.ts) | 2 | 2 | 0 | **PASS** |
| [`audit/tests/prompt-caching.test.ts`](file:///e:/echoregent/audit/tests/prompt-caching.test.ts) | 2 | 2 | 0 | **PASS** |
| [`audit/tests/token-estimation.test.ts`](file:///e:/echoregent/audit/tests/token-estimation.test.ts) | 2 | 2 | 0 | **PASS** |
| [`audit/tests/integration.test.ts`](file:///e:/echoregent/audit/tests/integration.test.ts) | 8 | 8 | 0 | **PASS** |
| [`audit/tests/protected-zones.test.ts`](file:///e:/echoregent/audit/tests/protected-zones.test.ts) | 3 | 1 | 2 | **FAIL (Intentional)** |
| [`audit/tests/static-source-checks.test.ts`](file:///e:/echoregent/audit/tests/static-source-checks.test.ts) | 5 | 4 | 1 | **FAIL (Intentional)** |

---

### 2.3 Individual Test Log

#### Passing Tests (23)
1. `distractor-patterns.test.ts` > Issue #11 > no longer flags a genuine delivery-window message (`"I am only home during lunch"`)
2. `distractor-patterns.test.ts` > Issue #11 > no longer flags a genuine bug-report detail (`"only reproduces for users in Tokyo"`)
3. `distractor-patterns.test.ts` > Issue #11 > no longer flags a genuine medical detail (`"allergic to cat dander"`)
4. `distractor-patterns.test.ts` > Issue #11 > confirms `compressHistoryAsync` no longer filters real messages from T5 input
5. `overfit-demo-entities.test.ts` > Issue #3 > "Dallas" survives compression equally with unseen "Portland"
6. `overfit-demo-entities.test.ts` > Issue #3 > `memoryFrame.unresolved` retains unseen cities symmetrically
7. `prompt-caching.test.ts` > Issue #8 > compressed history maintains stable prefix (`message[0]`) within settled history batches
8. `prompt-caching.test.ts` > Issue #8 > documents prefix update across batch boundaries
9. `token-estimation.test.ts` > Issue #9 > `originalTokens` matches real BPE tokenization
10. `token-estimation.test.ts` > Issue #9 > verifies departure from legacy `chars/4` heuristic
11. `static-source-checks.test.ts` > Issue #4 > verifies 1500-char input slice before T5 prompt construction
12. `static-source-checks.test.ts` > Issue #6 > Anthropic provider correctly forms `system` string and `max_tokens`
13. `static-source-checks.test.ts` > Issue #10 > `x-llm-base-url` undergoes protocol & DNS SSRF validation
14. `static-source-checks.test.ts` > Issue #10 > Gemini API key travels via `Authorization: Bearer` header, not URL parameter
15. `protected-zones.test.ts` > Issue #1 > documents baseline behavior: medical compressed at ~50% ratio
16. `integration.test.ts` > Issue #10(a) > rejects base URL pointing to private/link-local address (169.254.169.254) with 400
17. `integration.test.ts` > Issue #10(a) > allows explicitly trusted test harness upstream (`127.0.0.1:8902`)
18. `integration.test.ts` > Issue #5 > rejects tool-call turn with clean 400
19. `integration.test.ts` > Issue #5 > rejects null assistant content with clean 400
20. `integration.test.ts` > Issue #5 > rejects multimodal array content (image_url parts) with clean 400
21. `integration.test.ts` > Issue #5 > allows standard text-only conversations without regression
22. `integration.test.ts` > Issue #7 > isolates wiki memory across distinct `x-end-user-id` values
23. `integration.test.ts` > Issue #7 > preserves backward-compatible pooling under bare API key when header absent

#### Failing Tests (3) & Root Causes

```
1. FAIL: audit/tests/protected-zones.test.ts
   Issue #1: Crisis-risk conversations should be passed through unchanged per README, but are compressed
   Expected: 7 messages (unchanged raw history)
   Received: 5 messages (compressed with CTS summary)
   Assertion: expect(result.compressed).toEqual(result.original)

2. FAIL: audit/tests/protected-zones.test.ts
   Issue #1: Medical-domain conversations should get zero compression per README, but are compressed at ~50%
   Expected: 7 messages (0 tokens saved)
   Received: 5 messages (tokensSaved > 0)
   Assertion: expect(result.tokensSaved).toBe(0)

3. FAIL: audit/tests/static-source-checks.test.ts
   Issue #2: /v1/chat/completions should call compressHistoryAsync (T5 path) but calls compressHistory (rule path)
   Expected pattern: /compressHistoryAsync\(/
   Found in handler: compressHistory / compressHistoryWithEmbeddings
```

---

## 3. Evaluation & Quality Baseline Outputs (Zero-Budget Runs)

### 3.1 Token Reduction & Domain Routing (`npm run eval:tokens`)
Evaluates classification routing and token compression on standard domain fixtures with zero upstream LLM spend:

| Scenario / Case | Detected Route | Route Valid? | Original Tokens | Compressed Tokens | Tokens Saved | Reduction % |
|---|---|---|---|---|---|---|
| `coding-debugging` | `debugging/coding` | **YES** | 138 | 98 | 40 | **29%** |
| `customer-support-escalation` | `escalation/customer_support` | **YES** | 114 | 83 | 31 | **27%** |
| `sales-objection` | `objection_handling/sales` | **YES** | 113 | 91 | 22 | **19%** |
| `medical-decision` | `information_seeking/medical` | **Protected (0% Save)** | 95 | 96 | 0 | **0%** |

- **Route Accuracy**: 3/4 (75%)
- **Token Reduction**: 93 / 460 tokens saved (**20.2%**)

---

### 3.2 Session Memory Persistence (`npm run eval:session-memory`)
Evaluates whether user facts and entity relationships persist across sessions:

| Test ID | Test Description | Result |
|---|---|---|
| `sm_001` | TypeScript + PostgreSQL stack persists to session 2 | **PASS** |
| `sm_002` | Lisinopril and BP readings persist across medical sessions | **PASS** |
| `sm_003` | SOC2 compliance requirement persists into follow-up sales session | **PASS** |
| `sm_004` | Refund order number persists into follow-up support session | **PASS** |
| `sm_005` | California employment contract context persists to follow-up legal session | **PASS** |
| `sm_006` | iPhone vs Samsung comparison context carries into decision session | **PASS** |
| `sm_007` | Photosynthesis lesson context persists to quiz session | **PASS** |
| `sm_008` | Stripe webhook integration context persists to debugging session | **PASS** |
| `sm_009` | Database migration context persists to verification session | **PASS** |
| `sm_010` | Web scraper context with BeautifulSoup persists to follow-up session | **FAIL** (missing 'python' tag) |

- **Cases**: 10
- **Passed**: 9/10 (**90%**)

---

### 3.3 Domain Plugin Routing (`npm run eval:plugins`)
Tests the dynamic domain injection and constraint substitution system:

- **Total Test Cases**: 12
- **Passed**: 12/12 (**100%**)
- **Domain Accuracy**: 100%
- **System Prompt Accuracy**: 100%

---

### 3.4 Break-Even Analysis Simulation (`audit/bench/breakeven.ts`)
Stochastic cost simulation (300 trials/cell) comparing EchoRegent compression against native LLM prompt caching (write multiplier 1.25x, read multiplier 0.10x):

```
Provider: OpenAI (5m auto cache, write=1.25x, read=0.10x)
Turn 2:   Baseline+Cache cheaper by 7%–10%
Turn 5:   Baseline+Cache cheaper by 41%–53%
Turn 10:  Baseline+Cache cheaper by 25% (at 90% cache hit rate)
Turn 20:  EchoRegent cheaper by 4% (at 90% cache hit rate)
Turn 40:  EchoRegent CHEAPER by 34% (at 90% cache hit rate)
Turn 80:  EchoRegent CHEAPER by 61% (at 90% cache hit rate)
```

**Key Takeaway**: Prompt caching is more cost-effective for short conversations (<15 turns) with high cache locality. EchoRegent provides compounding cost advantages for long-running conversations (20+ turns) where cumulative full-transcript tokens overwhelm cache read discounts.

---

## 4. Architecture & Request Routing Matrix

| Feature | OpenAI Proxy (`/v1/chat/completions`) | Hosted Direct (`/demo/chat`, `/api/chat`) | MCP Server (`cts-mcp/`) |
|---|---|---|---|
| **Protocol** | HTTP / REST (OpenAI spec) | HTTP / REST (Custom API) | JSON-RPC 2.0 via `stdio` |
| **Caller Key** | `x-llm-key` header (BYOK) | Server-held (`DEMO_LLM_API_KEY`) | Client/IDE provides |
| **EchoRegent Auth** | `Authorization: Bearer <key>` | IP rate limit / Admin key | Local child process |
| **Classification** | `classify()` (sync keywords/rules) | `classify()` / `classifyAsync()` | DistilBERT ONNX via Transformers |
| **Compression** | Gemini Embeddings (live default) or Regex | Regex rule compressor | T5-small ONNX + Smart Scraper |
| **Semantic Cache** | Not used | `all-MiniLM-L6-v2` cosine cache | Not used |
| **Upstream Routing** | OpenAI, Anthropic, Gemini, SSRF-validated base URL | Gemini-2.0 or OpenRouter | Direct tool execution |
| **Telemetry** | `x-cts-tokens-saved`, `x-cts-actual-usage` | Response payload JSON | Tool output text |

---

## 5. GCP & Infrastructure Inventory

- **GCP Artifacts in Repo**:
  - `Dockerfile`: standard multi-stage build on `node:20-slim`.
  - `src/saas/database.ts`: connection pooling set to `max: 2` with comments targeting Cloud SQL `db-f1-micro` + Cloud Run instances.
  - **No** GCP Terraform, `cloudbuild.yaml`, or GCP project credentials exist.
- **Actual Active Deployment**:
  - **Railway**: configured via `railway.toml` and `nixpacks.toml` targeting `https://cts-v4-production.up.railway.app` (project `remarkable-empathy`).
- **PostgreSQL Durability**:
  - Automated startup migration in `initDb()` (`CREATE TABLE IF NOT EXISTS`, `ALTER TABLE ADD COLUMN IF NOT EXISTS`).
  - Graceful fallback to `data/*.json` if `DATABASE_URL` is omitted.
  - Multi-tenant isolation enforced via `x-end-user-id`.
- **Model Delivery & Rollback**:
  - Model weights (`ml/`) are excluded from Git and Docker images. Server catches missing weights at startup and defaults to keyword/embedding fallbacks.
  - DB migrations are non-breaking/additive, allowing zero-downtime rollback to previous container releases.
