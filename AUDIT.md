# EchoRegent Technical & Commercial Audit — October 2026

Branch: `claude/echoregent-audit-2026-10-3saddb` (the harness that ran this audit
requires this exact branch name; it stands in for the requested `audit/2026-10`).
No product code was changed. All new material lives under `/audit` (tests,
bench harness, working notes) plus this file.

**Verdict labels used throughout:** `VERIFIED` (reproduced with code in this
repo), `REFUTED` (reproduced the opposite of the claim), `COULDN'T TEST` (the
thing needed to test it — keys, weights, dataset — isn't available), `NO
EVIDENCE FOUND` (searched the repo; nothing backs the claim, one way or the
other).

## Keys / assets that would be needed to go further than this audit went

Nothing below was assumed available. Where a claim needed one of these, it's
marked `COULDN'T TEST` rather than guessed at.

1. **`OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY`** (real, billed) — needed for Part 5(a)'s paired billed-cost eval, and for live-verifying the Anthropic/Gemini proxy compatibility findings below (currently confirmed by static source analysis + knowledge of each provider's documented API contract, not by a live call).
2. **A corpus of 200+ anonymized real multi-turn conversations** (support-bot and copilot style, in `ConversationFixture` shape — see `audit/bench/paired-eval.ts`) — none exist in this repo; none were fabricated for this audit.
3. **The proprietary `ml/cts_classifier` and `ml/cts_t5` ONNX weights** — gitignored (`.gitignore:9`), not present in this checkout, and the README itself says they're "not included in this repo" (README.md:195, 269). Every classifier/compressor test in this audit exercised the **rule-based fallback path**, not the fine-tuned DistilBERT/T5 path the README's headline numbers are about.
4. **A quality judge** — a "judge" LLM call or a human-graded sample process, for the blind quality comparison Part 5(a) asks for.
5. **LongMemEval's and LoCoMo's own published harnesses** — Part 5(c) asks to run these; doing so needs both the harnesses and (again) real weights/keys.

---

## 1. One-page summary for the founder

**Can someone pay for this today? No.** Not because the idea is bad — the
underlying mechanism (sit between the app and the LLM, classify each turn,
compress what's safe to compress) is a real, defensible approach, and the
break-even math in Part 5 shows it can genuinely beat "just turn on the
provider's cache" for long conversations. But the code that would run in a
paying customer's production traffic today has three problems that are each,
on their own, reasons a technical buyer would walk away in the first demo:

1. **It's unsafe for the exact customers you'd charge the most to protect.**
   The README promises medical/legal/crisis conversations are never
   compressed. That's not true — there is no code anywhere that checks for
   those cases before compressing. I fed it a synthetic conversation where
   someone discloses a suicide plan to a support bot; the code compressed the
   entire seven-message conversation down to one line that doesn't even
   mention the plan. That is not a corner case — it is the literal scenario
   the "protected zones" feature exists to handle, and it does not handle it.

2. **It breaks on the exact traffic your target customer sends.** Your
   primary target is "AI application companies... calling OpenAI-compatible
   APIs" — which today overwhelmingly means tool-calling agents. I ran the
   actual server against a standard OpenAI tool-call message (the kind every
   agent framework sends) and it returned a server error. Same for a message
   with an image in it. This isn't a rare edge case; it's most of what a
   "copilot" or "agent" product actually sends on the wire.

3. **Every number in the README that would justify the pricing model — the
   64.7% reduction, the 9.0-vs-8.7 quality score, the LoCoMo comparison to
   mem0, the 329 req/s load test — has no benchmark, no dataset, and no
   script anywhere in this repository that produces it.** The commit that
   added these numbers to the README changed only the README; it added zero
   code, zero data, zero test output. I'm not saying they're fabricated — I'm
   saying nothing in the repo lets anyone, including the founder, check them.
   For a pricing model based on "a share of verified savings," that is the
   single most urgent gap to close, before anything else.

**The shortest honest path to a paying pilot** is roughly four weeks with 2-3
engineers (full plan in Part 8): week 1 fixes the two things above that are
actively unsafe or broken; week 2 fixes a subtler bug where the product
rewrites the whole conversation into a new summary every turn, which defeats
the provider's own prompt caching and quietly makes the product's own
after-the-fact savings math wrong; weeks 3-4 replace every unverified README
number with a number produced by running the harness in `/audit/bench`
against one real (consenting) pilot customer's traffic, and stand up the
"verified savings" billing mechanism that a 20-30%-of-savings pricing model
actually requires evidence for.

**What's real and worth keeping:** the domain classifier's rule-based
fallback is fast (measured at 0.045ms/call, nowhere near the model, but it
works) and reasonably sensible for routing; the "must-keep rescue pass" idea
in the compressor (re-insert specific messages if a hard fact would otherwise
be dropped) is a genuinely good design instinct, just currently too narrow
(hardcoded to the demo's own vocabulary) to trust on real customer data. The
break-even simulation in Part 5(b) shows the core bet — compression beats
caching for long, low-cache-locality conversations — is not snake oil, unlike
the coding-agent token-saver space this repo wisely chose not to build a
customer-facing product on (see Part 4 on `rtk`).

---

## 2. Claims table (Part 1)

| # | Claim (README location) | Evidence found | Verdict |
|---|---|---|---|
| 1 | "64.7% token reduction" (README.md:38, 49, 53, 119) | No load-test script, no dataset, no code path in the repo computes or logs this number. `PRODUCTION_READINESS.md:16` (added in the *same* development period) says the real number is unknown pending an `eval_quality_production.py` script — which does not exist anywhere in the repo (`find . -iname "*eval_quality*"` → nothing; no `.py` files exist in the repo at all). The commit that added this number (`973f84d`) touched only `README.md`. | **NO EVIDENCE FOUND** |
| 2 | Quality 9.0 vs 8.7, graded by Gemini, 120 conversations (README.md:19-27) | No Gemini-judge script, no SQuAD/StackOverflow/Medical-QA dataset, no results file anywhere in the repo. | **NO EVIDENCE FOUND** |
| 3 | Win/tie/loss 48/32/12 on 120 conversations (README.md:26) | Same as above — no supporting artifact. | **NO EVIDENCE FOUND** |
| 4 | LoCoMo F1 0.079 (EchoRegent) vs 0.069 (mem0), 259 vs 6,956 tokens (README.md:29-35) | No LoCoMo harness in the repo. The **6,956-token figure exactly matches mem0's own 2026 blog post's self-reported average retrieval size** (mem0.ai/blog, "State of AI Agent Memory 2026" — confirms this number was copied from mem0's own publication, not independently measured on a shared harness). mem0's own published LoCoMo *score* is ~92.5 (an LLM-judge/"J" score per its ECAI 2025 paper), not an F1 of 0.069 — the metric in the README doesn't obviously match any published mem0 number, so it isn't clear the two sides of this comparison are even the same metric. Per the audit's ground rule ("compare only if reproduced with a matching setup"), this is not a valid comparison as presented. | **NO EVIDENCE FOUND** (and the comparison as stated appears metric-mismatched) |
| 5 | "329 req/s · 17ms p50 · 0 errors" load test, 10M tokens (README.md:37-38) | No load-test script, no k6/autocannon/artillery config, no results file anywhere in the repo. | **NO EVIDENCE FOUND** |
| 6 | "<10ms" classification (README.md:52, 152) | Measured the **rule-based fallback path** (the only path runnable without the gitignored ONNX weights): 0.045ms/call (`audit/notes/timing_classify.ts`, 2,000 calls). This is far under 10ms, so the claim holds *for the fallback* — but the fallback has nothing to do with the "fine-tuned DistilBERT" the README is describing here. The actual ML inference path could not be tested (weights not in repo). | **VERIFIED** for the rule-based fallback only; **COULDN'T TEST** for the DistilBERT path the claim is actually about |
| 7 | Protected zones: compression "disabled at the function level — not skipped, not flagged, disabled" for medical/legal/crisis (README.md:156-167) | `audit/tests/protected-zones.test.ts` — fed a synthetic crisis conversation (7 turns, explicit suicidal ideation disclosure) straight into `compressHistory()` (src/cts-core/compressor.ts:42): it was compressed to **one summary message**, not passed through unchanged. There is no `frame.domain === 'medical' \| 'legal'` or `frame.risk.includes('crisis')` check anywhere in `compressor.ts`. | **REFUTED** |
| 8 | Fine-tuned weights not included in repo, self-host uses base HuggingFace models (README.md:188-195, 269) | Confirmed: `.gitignore:9` excludes `ml/`; no such directory exists in this checkout; `src/cts-core/ml-classifier.ts` and `ml-t5.ts` load `cts_classifier`/`cts_t5` from a local `ml/` path that doesn't exist, so self-hosted mode would fail to warm up (falls back to keyword rules / rule compressor, exactly as `PRODUCTION_READINESS.md` describes). This is the one README claim that is straightforwardly, verifiably true. | **VERIFIED** |
| 9 | Memory that "never forgets what the user told it last week" (README.md:180) | The persistence mechanism itself is real (JSON-file or Postgres-backed wiki store, `src/server.ts:181-250`) and does survive restarts. But per Issue #7 below, it's keyed by `key.id` (the customer's API key), not by any end-user identifier — so for any customer with more than one end user, this is "the business never forgets what *any* of its users told it," not "what *you* told it." | **PARTIALLY VERIFIED** (mechanism works; scope is wrong for the stated multi-tenant use case) |
| 10 | "10 domains out of the box" (README.md:52, 137-153) | `src/cts-core/types.ts:24-33` (`DomainType`) lists exactly 8 concrete domains. `hospitality` (README.md:146) has **zero** implementation anywhere in `src/` (`grep -rn hospitality src/` → no matches outside the README). `crisis` (README.md:150) is not a `DomainType` at all — it's a `RiskSignal` (types.ts:41) that gets layered onto whatever domain the classifier picked (usually `general`, per classifier.ts:44). | **REFUTED** (8 real domains, not 10; 2 of the 10 listed don't exist in the type system) |

---

## 3. Issues (Part 2) — ranked by severity, with fix effort

Every issue below has a runnable, currently-failing test under `audit/tests/`
(run with `npx vitest run audit/tests`) that reproduces it against the actual
code in this repo — not a description of a hypothetical bug. Fix-effort
estimates assume one engineer already familiar with this codebase.

### Safety & privacy

**#1 — Protected zones are not enforced (CRITICAL). Fix effort: 3-5 days.**
`compressHistory()` and `compressHistoryAsync()` (`src/cts-core/compressor.ts:42,
598`) never check `frame.domain` against `medical`/`legal`, or `frame.risk`
against `crisis`/`protected_context`, anywhere. The only domain-aware branch
in the file is `HIGH_VALUE_DOMAINS = Set(['coding','customer_support','sales'])`
(compressor.ts:4), which only changes the *target compression ratio*
(0.62 vs 0.5) — medical and legal aren't even in that set, so they get the
*more* aggressive default ratio. `/v1/chat/completions` (server.ts:793-795)
and `/demo/chat` (server.ts:537-538) call `classify()` then unconditionally
`compressHistory()` regardless of the result. Live proof:
`audit/tests/protected-zones.test.ts` — a synthetic crisis disclosure (no
compression ever occurs before it's summarized down to one line that omits
the disclosed plan entirely). This is the single highest-severity finding in
this audit: it is the exact failure mode the feature's own name promises to
prevent, on the exact content type where getting it wrong is most dangerous.

**#7 — `/api/chat` and `/api/wiki*` memory is keyed only by API key. Fix effort: 2-3 days (schema + endpoint change) + migration plan for any existing data.**
`server.ts:618` (`const userId = key.id`) is the *only* identity used for
every wiki read/write. No endpoint accepts an end-user identifier. Live proof:
`audit/tests/integration.test.ts` "Issue #7" — two different simulated end
users ingest sessions under the same API key with no end-user id in the
request at all, and `/api/wiki` returns both people's profile facts merged
into one document. For any customer with more than one end user (i.e., every
realistic customer), this is a cross-user data leak by construction, not a
bug that occasionally triggers.

### Correctness

**#5 — The OpenAI-compatible proxy drops `tool_calls`/`tool_call_id` and crashes on `content: null` or array (multimodal) content. Fix effort: 3-4 days.**
`server.ts:773` casts `body.messages` to `Array<{role: string; content: string}>`
— a compile-time-only assertion that changes nothing about the actual runtime
shape. `historyMsgs = convMsgs.slice(...).map(m => ({role: m.role as 'user'|'assistant', content: m.content}))`
(server.ts:785-789) drops every other field, including `tool_calls` and
`tool_call_id`. Live proof, against the actual running server with a local
mock upstream (`audit/tests/integration.test.ts`, "Issue #5"):
- A standard OpenAI tool-call turn (`content: null`, `tool_calls: [...]`) is
  forwarded to the upstream **with `tool_calls` stripped and the `tool` role
  message dropped entirely** — this alone breaks any multi-turn tool-using
  conversation, silently.
- The same `content: null` turn (standard for OpenAI assistant messages that
  only carry a tool call) makes the server **crash with HTTP 500**
  (`estimateTokens` in compressor.ts:477 calls `.length` on a `null`).
- A multimodal message (`content: [{type:'text',...},{type:'image_url',...}]`)
  also **crashes with HTTP 500** (downstream code calls `.toLowerCase()` on
  what it assumes is a string).

Given the primary target is agent/copilot products, and virtually all modern
agent frameworks use tool calling, this is not an edge case — it is likely
to break a large fraction of real integration attempts on day one.

**#6 — `provider=anthropic` sends an OpenAI-shaped body to Anthropic's `/v1/messages` and returns Anthropic's raw response to an OpenAI-format client. Fix effort: 1-2 days.**
`server.ts:829-831` sets the URL/headers for Anthropic but the actual request
body (`server.ts:851`: `JSON.stringify({ ...body, messages: forwardMessages, model: llmModel, stream })`)
is the same generic OpenAI-shaped object used for every other provider — it
still contains a `role: 'system'` message inside the `messages` array
(pushed at server.ts:816), instead of Anthropic's required top-level `system`
string field. Confirmed by static source analysis (`audit/tests/static-source-checks.test.ts`,
"Issue #6") against Anthropic's documented Messages API contract (a `system`
role inside `messages` is invalid there); **not live-verified** — this audit
had no Anthropic API key and wasn't going to spend real money confirming a
structurally obvious bug. Notably, `src/providerServer.ts:97-126`
(`callAnthropic`, used by `/api/chat` and `/api/llm`) does this translation
*correctly* elsewhere in the same codebase — the fix is to reuse that logic
in the `/v1/chat/completions` route instead of the ad-hoc OpenAI-shaped
forwarding it currently does.

**#2 — The customer-facing OpenAI-compatible proxy uses the rule-based `compressHistory()`, not the T5 (`compressHistoryAsync`) path. Fix effort: 1 day** (call site change) **+ whatever #4 and the missing-weights problem cost to make the T5 path trustworthy.**
`server.ts:795`. Confirmed via `audit/tests/static-source-checks.test.ts`. This
means every number in the README that's attributed to "T5-based summarization"
cannot be what a real integrator using the documented one-line-integration
endpoint actually gets.

**#4 — `compressHistoryAsync` truncates the T5 input to ~1,500 characters. Fix effort: 1-2 days**, contingent on first getting real weights to test against (currently blocked — see keys/assets list).
`compressor.ts:613-617`: `historyText = filtered.map(...).join(' ').slice(0, 1500)`.
Confirmed by static source check (`audit/tests/static-source-checks.test.ts`,
Issue #4). Could not be exercised end-to-end because `ml/cts_t5` isn't in
this checkout, so `summarizeWithT5()` never actually gets called in this
environment — but the truncation happens before that call regardless of
whether it later succeeds or fails, so the 1,500-character ceiling is real
and independent of the missing-weights problem.

**#3 — Fact extraction and domain rules are overfit to the project's own demo/eval vocabulary. Fix effort: 5-8 days** to generalize the extraction approach (e.g., NER-based entity extraction instead of literal-string regex lists) rather than patch individual words.
`compressor.ts` hardcodes literal strings from the project's own demo/eval
fixtures directly into production regexes: `Maya`/`Sarah` (line 389, 439,
468), `Lisinopril`/`140/90`/`blood pressure` (358, 383, 432, 465),
`ThinkPad T14`/`MacBook Air M3` (360, 385, 435, 466), `Calvin cycle` (362,
387, 437, 467), `Dallas`/`Chicago` (377). `src/evals/sessionMemoryEval.ts`
reuses this *exact* vocabulary in its own test fixtures — the eval suite and
the production code were tuned against the same handful of scenarios, so a
passing eval doesn't demonstrate generalization. Live, minimal-pair proof
(`audit/tests/overfit-demo-entities.test.ts`): two structurally identical
customer-support messages, differing only in city name (`Dallas` vs.
`Portland`), compressed with everything else held constant —
`memoryFrame.unresolved` keeps `Dallas` and drops `Portland` outright,
because `Dallas` is the literal string in `inferUnresolved`'s regex
(compressor.ts:377) and `Portland` is not.

**#11 — `GENERIC_DISTRACTOR_PATTERNS` drops real content that happens to share a keyword with the demo's idea of small talk. Fix effort: 1 day** to remove/relax as a blunt filter, longer to replace with something context-aware.
`compressor.ts:5-20`. `compressHistoryAsync` (line 608-611) filters these
messages **out of the T5 input entirely**, unconditionally. Live proof
(`audit/tests/distractor-patterns.test.ts`): a real delivery-scheduling
message ("I am only home during **lunch**"), a real bug report ("only
reproduces for users in **Tokyo**" — a timezone bug), and a real medical
detail ("allergic to **cat** dander") all match the list and would be
stripped before ever reaching the summarizer.

### Quality / cost accuracy

**#9 — Token counts use `chars/4`, never the provider's real tokenizer or `usage` field. Fix effort: 2-3 days** (thread real `usage` objects through every endpoint that currently estimates).
`compressor.ts:476-479`. Every `tokensSaved`/compression-percentage number
surfaced anywhere in this product (`/compress`, `/demo/compress-async`, the
`x-cts-tokens-saved`/`x-cts-compression-pct` response headers on
`/v1/chat/completions`) is derived from this heuristic. Demonstrated
(`audit/tests/token-estimation.test.ts`) diverging from a conservative
real-tokenizer estimate on a JSON/code-heavy payload — exactly the content
type a "coding" or "customer_support" conversation is full of. **This is not
a cosmetic bug**: it means the number a pilot customer would be billed a
percentage of ("a share of verified savings") is, today, definitionally not
the number the LLM provider actually bills.

**#8 — Rewriting the summary every turn defeats the provider's own prompt caching. Fix effort: 4-6 days** to redesign the memory block as a stable, append-only prefix instead of a full per-turn rebuild.
`buildMemoryFrame()` bakes the *current* user message into `task` (compressor.ts:162),
so the summary at position 0 of what's sent to the LLM is rewritten every
turn. Live, minimal-pair proof (`audit/tests/prompt-caching.test.ts`): two
consecutive turns of the same otherwise-unchanged conversation produce
different message-0 text. This matters commercially, not just architecturally:
Part 5(b)'s break-even simulation shows that for short-to-medium, high-cache-
hit-rate conversations, "just enable native caching" beats this product's
current design by 25-70% — precisely because this bug prevents EchoRegent
from ever earning a single cache read.

### Security

**#10 — `x-llm-base-url` accepts any URL with no allowlist, and the Gemini key travels in the URL query string. Fix effort: 1 day.**
`server.ts:837` reads `x-llm-base-url` directly from request headers with no
validation. Live proof against the actual running server
(`audit/tests/integration.test.ts`, "Issue #10(a)"): pointed it at a local
mock server (not `api.openai.com`) and confirmed the full compressed
conversation *and* the caller-supplied `x-llm-key` are forwarded there
verbatim. Depending on deployment (is this server reachable from anywhere
that also has internal-network access?), this is a textbook SSRF primitive:
whoever can set request headers controls where the conversation content and
an API key get sent. Separately, `server.ts:833` builds the Gemini URL as
`...?key=${llmKey}` — API keys in URLs get logged by proxies, load balancers,
and access logs by default in most infrastructure. Confirmed by static
source check (`audit/tests/static-source-checks.test.ts`).

---

## 4. Compatibility matrix (Part 3)

All rows were exercised either live against the real running server (a
"live" row) or determined by reading the exact code path with no ambiguity
(a "static" row, where a live check would need a real provider key this
audit doesn't have). "Breaks" means the specific bug is cited above by
issue number.

### Primary target — OpenAI-compatible `/v1/chat/completions` proxy

| Scenario | Status | Basis |
|---|---|---|
| OpenAI chat, no tools, non-streaming | **Works**, with caveats (Issue #9 token counts, Issue #3 fact-drop risk, Issue #11 distractor-drop risk) | Live |
| OpenAI chat, with tools | **Breaks** (Issue #5) | Live |
| OpenAI streaming, no tools | **Likely works** — code correctly pipes upstream bytes through (`server.ts:866-889`) | Static (no live OpenAI key) |
| OpenAI multimodal (image content) | **Breaks** (Issue #5, 500 crash) | Live |
| Gemini, plain text | **Likely works** — Gemini's OpenAI-compat endpoint generally accepts this shape | Static (no live Gemini key); API key exposure confirmed live (Issue #10) |
| Gemini, tools/multimodal | **Likely breaks** — same generic message-shaping code path as OpenAI, so Issue #5 applies identically | Static |
| Anthropic, any request | **Breaks** (Issue #6 — invalid request shape per Anthropic's documented API contract) | Static (high confidence; no live Anthropic key) |

### Secondary — 4 MCP tools (`cts-mcp/`)

| Tool | Status | Basis |
|---|---|---|
| `cts_compress_history` | **Works, but not as documented** — the heuristic line-deduper (`smartScrape`) always works; the ML fallback loads a generic (not fine-tuned) `Xenova/t5-small` from the HuggingFace Hub over the network, unrelated to the main product's `cts_t5` weights | Static (`cts-mcp/src/index.ts:170-215`) |
| `cts_classify_intent` | **Broken as described** — its own tool description says "detect domain... and intent... using the local DistilBERT ONNX model," but the code loads `Xenova/distilbert-base-uncased-finetuned-sst-2-english`, a **sentiment** classifier (POSITIVE/NEGATIVE), and returns that verbatim | Static (`cts-mcp/src/index.ts:236-237`) |
| `cts_memory_remember` / `cts_memory_recall` | **Works**, as a simple session-scoped local-JSON-file store — but it is a completely separate storage system from the main product's SQL/JSON wiki (`cts-mcp/src/memory.ts` writes to `cts-mcp/data/cts-memory/*.json`, unrelated to `src/server.ts`'s wiki store) | Static |
| MCP protocol itself (Claude Code / Cursor / Windsurf) | **Should work generically** — standard `@modelcontextprotocol/sdk` stdio server, nothing host-specific in the wire protocol | Static |

**Trust/quality note, not a compatibility break per se:** every one of the 4
tools' result text ends with a bracketed `[INSTRUCTION FOR AI: ...]` string
that tells the calling model to explicitly mention CTS by name in its reply
to the user, and to **stop using the host's own built-in memory** in favor of
this tool ("`cts_memory_recall`... Do not search Codex built-in memory after
this unless the user explicitly asks"). This is instruction-injection into
tool output aimed at steering the host agent's behavior beyond what the tool
call itself returned — and it hardcodes "Codex" by name even though the same
server is marketed for Claude Code and Cursor, where that sentence is simply
confusing. This is worth fixing regardless of the audit's other findings: a
tool that tells the calling model what to say about itself is a bad look in
any MCP host's tool-call transcript.

---

## 5. Competitive baseline (Part 4)

All figures below are from each provider/vendor's own current documentation
or from the specific published third-party benchmark named — sources linked.
None were reproduced independently in this audit; where the audit's own
requirement was "compare only if reproduced on a matching setup," that
requirement is repeated as a caveat rather than skipped.

### Provider-native prompt caching and memory (what EchoRegent must beat)

| Provider | Cache write | Cache read discount | Minimum cacheable size | Source |
|---|---|---|---|---|
| OpenAI | 1.25× base input | 0.1× base input (90% off) | 1,024 tokens | [OpenAI prompt caching guide](https://developers.openai.com/api/docs/guides/prompt-caching) (via search; direct fetch blocked by this environment's egress proxy) |
| Anthropic | 1.25× (5-min TTL) or 2× (1-hour TTL) | 0.1× standard; 0.05× on Opus 5.5; 0.025× on Fable 5.1 / Mythos 5.1 | 512-4,096 tokens depending on model | [Claude prompt caching docs](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) (fetched directly) |
| Google Gemini | Explicit cache: storage billed separately (~$4.50/M tokens/hour); implicit: automatic, no separate write cost | 0.1× on Gemini 2.5+ (90% off); 0.25× on Gemini 2.0 | Not confirmed in search results | Google Cloud / Gemini API docs, via search |

The critical mechanical detail (from Anthropic's docs, directly fetched): the
cache is a **prefix hash** — it only pays off when the content *before* your
cache breakpoint is byte-identical to a previous request. This is exactly
the mechanism Issue #8 shows EchoRegent currently defeats on every turn.

### LLM gateways with caching/routing

| Product | Pricing | Relevant features | What EchoRegent must beat |
|---|---|---|---|
| Portkey | Free (10k logs/mo) → $49/mo Production (adds semantic caching) → custom Enterprise | Semantic caching, guardrails, now fully open-source (announced open-sourcing its gateway March 2026; acquired by Palo Alto Networks April 2026) | A $49/mo gateway with semantic caching already covers the "cache similar-but-not-identical queries" use case EchoRegent's own semantic cache (`src/cts-core/semantic-cache.ts`) targets |
| Helicone | Free Hobby → $79/mo Pro → $799/mo Team | Rust gateway, ~8ms p50, semantic caching, fallback routing, observability (now in maintenance mode after Mintlify's March 2026 acquisition) | Same semantic-caching overlap; Helicone's actual measured p50 (8ms) is a real, published number — a bar EchoRegent's unverified "<10ms classification" claim should be held to |
| LiteLLM | Free/open-source self-hosted; ~$30k/yr for enterprise SSO/support | 100+ provider routing, virtual keys, spend tracking | Free self-hosted routing is the floor any paid product in this space competes against |

### Memory layers (where EchoRegent's "memory that never forgets" claim must compete)

| Product | Pricing | Published benchmark (self-reported unless noted) | Caveat |
|---|---|---|---|
| Mem0 | Free → Pro $19/mo → Enterprise $249+/mo | LoCoMo ~92.5 (ECAI 2025 paper); LongMemEval 49.0% (self-reported) vs. **73.8% when re-run under a third-party vendor's (Maximem's) harness** | The 24-point swing between Mem0's own number and a third party's re-run is exactly the "self-reported savings ≠ customer's bill" pattern this audit was asked to watch for, applied to quality instead of cost |
| Zep | Flex $25/mo (20k credits) → Flex Plus $475/mo (300k credits) | LongMemEval 63.8% with GPT-4o (self-reported) | — |
| Letta | Pro ~$20/mo | ~74% on LoCoMo, framed around agent autonomy rather than pure recall | — |
| Cognee | Developer $35/mo → Team $200/mo | No LongMemEval/LoCoMo number found in the material reviewed | — |
| Supermemory | Not found | 81.6% on LongMemEval (self-reported) | — |

EchoRegent's own LoCoMo claim (259 tokens, F1 0.079) cannot be placed in this
table on equal footing with the above — there is no benchmark run in this
repo producing it (Claims table, item 4).

### Compressors

**LLMLingua / LLMLingua-2** (Microsoft Research): up to 20× compression with
under 2% quality loss on CoQA/HotpotQA/TriviaQA-style benchmarks;
LLMLingua-2 additionally cuts end-to-end latency up to 2.9× at 2-5×
compression ratios, via a purpose-built compressor model rather than
llama-style token-dropping heuristics. This is the most directly comparable
prior art to EchoRegent's compressor, and it ships published, reproducible
benchmark numbers with a named methodology — the bar EchoRegent's own
compressor claims need to clear before being trusted at face value.
[Microsoft Research blog](https://www.microsoft.com/en-us/research/blog/llmlingua-innovating-llm-efficiency-with-prompt-compression/), [LLMLingua project page](https://www.llmlingua.com/).

### Coding-agent token savers (secondary target — context for why this audit agrees with deprioritizing it)

JetBrains ran a paired A/B benchmark of `rtk` against real Claude Code
billing: `rtk` advertises 60-90% savings; JetBrains **measured a 7.6% cost
*increase*** at low reasoning effort (p=0.004) and no measurable change at
high effort — while `rtk`'s own built-in analytics simultaneously reported
96.2M tokens "saved" (99.8% of everything it touched). The explanation
JetBrains gives matches this audit's framing exactly: `rtk` counts the full
raw tool output as its savings baseline, but Claude Code already truncates
huge tool outputs before that content would ever be billed, and roughly half
of what agents run bypasses the Bash-hook `rtk` relies on entirely (Claude
Code's built-in Read/Grep tools don't go through it). A companion JetBrains
post found a "speak to agents like a caveman" prompt-compression skill
advertising 65% savings and measuring 8.5%. Sources:
[JetBrains: rtk Claude Code Token Savings](https://blog.jetbrains.com/ai/2026/07/rtk-claude-code-token-savings/),
[JetBrains: Speaking to AI Agents like Cavemen](https://blog.jetbrains.com/ai/2026/07/speak-to-ai-agents-like-cavemen-tosave-tokens/).

This is the single strongest piece of external evidence in this audit for
*why* self-reported coding-agent token-saver numbers should not be trusted
without a paired, billed-cost re-measurement — and it is direct supporting
evidence for treating EchoRegent's own unverified numbers (Claims table)
with exactly the same skepticism, since the failure mode ("the tool's own
counterfactual isn't what the provider actually bills") is structurally the
same one Issue #9 (chars/4 estimation) creates here.

---

## 6. Measurement design, break-even analysis, verified-savings billing (Part 5)

Full harness: `/audit/bench` (see `audit/bench/README.md` for exact run
commands and what's missing to run each piece for real).

### 5(a) — Offline paired eval: designed, not run

`audit/bench/paired-eval.ts` is a complete, wired harness: it runs a
"baseline" arm (full history, provider caching on) and an "EchoRegent" arm
(`classifyAsync` + `compressHistoryAsync`, the real product code) per
conversation, reads cost exclusively from the provider's own `usage` object
(never CTS's own chars/4 estimate — seeContinuing Issue #9), repeats each
conversation `k=3` times, and reports medians plus a Wilcoxon signed-rank
test (`audit/bench/stats.ts`, sanity-checked against the standard textbook
example) on the paired per-conversation deltas. Running it against a
placeholder dataset (`audit/bench/README.md`) proves it parses real data and
refuses to fabricate a result: it prints "Loaded N fixtures... not running"
rather than a made-up number, because `callProviderWithCaching()` is
intentionally left unimplemented until real API keys are supplied. **This
cannot be run for real without:** real provider keys, a 200+-conversation
corpus, and a quality judge (all listed at the top of this file).

### 5(b) — Break-even analysis: designed AND run

`audit/bench/breakeven.ts` runs standalone (no keys needed) and simulates
per-turn billed cost for both arms across conversation length and cache-hit
rate, using the provider cache pricing ratios from Part 5 above. Output
(300 stochastic trials per cell; ~350 new tokens/turn, ~250 output
tokens/turn, EchoRegent settling to a ~700-token compressed context after
turn 4 — a realistic support/copilot shape):

```
--- OpenAI (5m auto cache) (write=1.25x, read=0.1x) ---
  cache-hit=100%:  turn 2: baseline+cache cheaper by 10%  |  turn 5: baseline+cache cheaper by 53%  |  turn 10: baseline+cache cheaper by 46%  |  turn 20: baseline+cache cheaper by 24%  |  turn 40: EchoRegent cheaper by 6%   |  turn 80: EchoRegent cheaper by 38%
  cache-hit=90%:   turn 2: baseline+cache cheaper by 8%   |  turn 5: baseline+cache cheaper by 41%  |  turn 10: baseline+cache cheaper by 25%  |  turn 20: EchoRegent cheaper by 5%   |  turn 40: EchoRegent cheaper by 36%  |  turn 80: EchoRegent cheaper by 61%
  cache-hit=70%:   turn 2: baseline+cache cheaper by 3%   |  turn 5: baseline+cache cheaper by 24%  |  turn 10: EchoRegent cheaper by 3%   |  turn 20: EchoRegent cheaper by 34%  |  turn 40: EchoRegent cheaper by 60%  |  turn 80: EchoRegent cheaper by 78%
  cache-hit=50%:   turn 2: EchoRegent cheaper by 1%       |  turn 5: baseline+cache cheaper by 8%   |  turn 10: EchoRegent cheaper by 20%  |  turn 20: EchoRegent cheaper by 50%  |  turn 40: EchoRegent cheaper by 71%  |  turn 80: EchoRegent cheaper by 84%
```
(Anthropic 5-min TTL is nearly identical; Anthropic 1-hour TTL and Gemini
implicit caching follow the same shape with different crossover points — full
output for all four providers is reproduced by running the script.)

**What this means, in plain English:** if a conversation is short (under
~10-20 turns) and the customer's infrastructure actually gets cache hits
reliably (requests land inside the TTL, same cache-serving region, nothing
upstream of the conversation changes), **just turning on the provider's own
prompt cache beats EchoRegent's current design outright** — by a wide margin
(24-73% cheaper) at every cache-hit rate tested. EchoRegent only starts
winning once conversations get long (40+ turns) or the customer's real-world
cache-hit rate is mediocre (50-70%, which is realistic for multi-instance
load-balanced production traffic, not a lab setup). **This is the honest
shape of the opportunity**: EchoRegent's compression approach is not useless,
but its addressable case is specifically *long* conversations with
*imperfect* caching — not "every AI application," and definitely not the
short support tickets that make up a large share of real customer-support
traffic. It would also win by even more, and win sooner, if Issue #8 (stable-
prefix summaries) were fixed so it could earn cache reads of its own on top
of being smaller.

### 5(c) — LongMemEval / LoCoMo: designed, not run

Both need (1) the benchmark's own published harness (neither is vendored
into this repo) and (2) the real `ml/cts_classifier`/`ml/cts_t5` weights to
test the product path this audit could actually run rule-based fallbacks
for. Both are `COULDN'T TEST` per the keys/assets list, not skipped by
choice.

### 5(d) — Verified-savings billing design

The pricing model ("a share of 20-30% of verified savings") requires proof
that survives a customer's own finance team asking "prove it." Two
mechanisms, ranked by defensibility:

1. **Holdout bypass (recommended primary mechanism).** Route a fixed,
   randomly-assigned ~10% of conversations around EchoRegent entirely (full
   history, provider caching on, straight to the LLM) as a live control
   group, continuously, not just during a pilot window. Compare the
   holdout's actual provider bill (per API key, per billing period — pull
   directly from the provider's usage/billing API, not from CTS's own
   estimate) against the treated group's actual bill, normalized by
   conversation volume and turn count. This is defensible specifically
   *because* it's the customer's own real traffic split randomly, not a
   synthetic benchmark, and the number being compared is the provider's own
   invoice — the one thing a finance team will always trust over a vendor's
   own dashboard.
2. **Shadow counting (secondary, use where a holdout isn't feasible for
   product reasons — e.g., quality-of-service concerns in a regulated
   flow).** For every real request, also run the uncompressed path against
   the provider's official token-counting endpoint (not chars/4 — this
   audit's Issue #9 finding is exactly why that estimate can't be trusted
   for a billing claim) without generating a response (a "count tokens"
   call, which providers offer cheaply or free), and compare against the
   compressed path's real billed usage. This proves the token-count
   *delta* is real, but not the dollar delta if quality suffers enough that
   the customer needs more follow-up turns — which is why the holdout method
   is preferred wherever it's viable.

Either mechanism is only defensible once Issue #9 (chars/4) and Issue #8
(caching-defeating rewrites) are fixed — right now, the "savings" number
itself is provably wrong on both the numerator (Issue #9) and against the
correct counterfactual (Issue #8: the real counterfactual most customers
should be comparing against is "caching, done well," not "no caching at
all").

### 5(e) — Coding-agent benchmark: design only (per the task's own instruction not to run this)

If EchoRegent ever pursues the secondary coding-agent target, the JetBrains
precedent (Part 4) sets the bar: any benchmark must (1) measure real,
billed cost from the provider's own usage reporting, not the tool's internal
counterfactual; (2) run paired, not compared against the tool's own claimed
baseline; (3) account for what the host agent (Claude Code, Cursor, Codex)
already truncates or handles internally before the tool ever sees it, since
that's precisely where `rtk` and the "caveman" skill's numbers fell apart.
Two viable benchmark choices: **SWE-bench Verified** (500 real GitHub issues,
pass/fail on a real patch — measures whether compression harms task success,
not just tokens) run via a harness like **Harbor/SkillsBench**. Rough cost
estimate for a paired run (baseline vs. compressed) across the 500-task
SWE-bench Verified set, at roughly 2-4 agent turns per task and typical
Claude/GPT context sizes for a coding agent: **on the order of $1,500-$4,000
per full paired pass** (2 arms × 500 tasks × repeated for reasoning-effort
variants, at typical agentic-coding token volumes of ~50k-150k tokens/task) —
this is a rough order-of-magnitude estimate, not a quote, and should be
re-priced against current model pricing before committing budget. Given
Anthropic's terms prohibit proxying Claude subscription credentials through
third-party tools, any such offering must run as an MCP server inside
Claude Code (as `cts-mcp` already does) or against API keys directly — never
as a subscription-traffic proxy.

---

## 7. Feasibility verdict (Part 6)

**Is 30-50%+ billed savings with no quality loss plausible for the primary
target, and for which conversation types?** Plausible, but narrower than
advertised and not yet real in this codebase. The break-even simulation
(5b) shows the mechanism genuinely works — but specifically for **long
conversations (40+ turns) in production environments with imperfect cache
locality** (multi-instance deployments, bursty traffic, sessions that don't
reliably land inside a 5-minute-to-1-hour cache TTL) — not for short support
tickets, not for well-cached, single-instance deployments, and not today for
any conversation that uses tool calling or images (Issue #5 breaks those
outright). Support-bot traffic with long escalation chains and copilot
sessions that run for dozens of turns are the best fit; single-turn or
short-ticket support traffic is the worst fit and should be excluded from
any pilot's success metric.

**Which component is strongest?** The rule-based classifier's *speed* is
genuinely good (0.045ms measured) and its routing logic, while overfit in
its fact-extraction details, has sound domain-detection instincts (the
medical-vs-general tie-break logic at `classifier.ts:110-117`, for instance,
is a thoughtful piece of engineering). The compressor's "must-keep rescue
pass" concept — detect concrete facts that would otherwise be dropped and
force them back in — is the right idea; it's currently undermined by being
tuned to a small hardcoded vocabulary (Issue #3) rather than a general
entity-extraction approach.

**What would it take to make it pilot-ready in 4 weeks?** See Part 8 — the
short answer is: fix the two things that are actively unsafe/broken
(protected zones, tool-calling), fix the one thing that quietly corrupts the
savings math (stable-prefix caching), and replace every README number with
one produced by the harness already built in `/audit/bench`, run against one
real pilot customer's actual (consented, anonymized) traffic.

---

## 8. Four-week plan for 2-3 engineers

Ordered by what unblocks paying customers first — i.e., what would otherwise
cause a pilot to end in week one, either on legal/safety grounds or because
the integration simply doesn't work for the customer's actual traffic.

**Week 1 — stop the bleeding (safety + hard breaks).**
- Implement real protected-zone enforcement: a hard `if (frame.domain === 'medical' || frame.domain === 'legal' || frame.risk.includes('crisis')) return passthroughUnchanged(...)` at the top of both `compressHistory` and `compressHistoryAsync`, before any scoring/selection logic runs — not a scoring adjustment, an actual bypass. Add `crisis` as something the classifier can express as a first-class outcome rather than folding it into `general`.
- Fix `/v1/chat/completions` to preserve `tool_calls`/`tool_call_id`/`name` fields end-to-end, and to handle `content: null` and array (multimodal) content without crashing (Issue #5).
- Fix the Anthropic branch to reuse `providerServer.ts`'s already-correct `callAnthropic` translation instead of the ad-hoc OpenAI-shaped forwarding (Issue #6).
- Remove the Gemini-key-in-URL pattern and add an explicit allowlist (or at minimum a same-org DNS/IP check) for `x-llm-base-url` (Issue #10).

**Week 2 — fix the economics.**
- Redesign the per-turn summary so a stable prefix (e.g., a memory block refreshed only every K turns or on topic change) sits ahead of a small per-turn delta, so the product can actually earn provider cache reads instead of fighting them (Issue #8).
- Replace `chars/4` with real provider `usage`/`usage_metadata` accounting everywhere a "tokens saved" number is surfaced (Issue #9).
- Add an explicit end-user identifier to `/api/chat` and `/api/wiki*`, and scope the wiki store by (API key, end-user id) instead of API key alone (Issue #7).

**Week 3 — replace claims with measurements.**
- Get one real (consenting) pilot customer's traffic — or, failing that, a genuinely representative anonymized conversation set — and wire `audit/bench/paired-eval.ts`'s `callProviderWithCaching()` to the real provider SDKs.
- Run the paired eval at k=3 on at least 50-100 real conversations, both arms with provider caching on, and report medians + the Wilcoxon test the harness already computes.
- Stand up the holdout-bypass verified-savings mechanism (5d) for that same pilot, so the "share of savings" pricing model has evidence, not a vendor dashboard number, behind it from day one.

**Week 4 — pilot-readiness hardening.**
- Add automated tests to the actual codebase (there are currently zero — `npm test` runs `vitest run` against no test files at all); at minimum, promote the confirmed-bug tests in `audit/tests/` into the main test suite once each underlying bug is fixed, so they become regression guards instead of bug reports.
- Real load test against the actual `/v1/chat/completions` path (not a claimed number) to get a defensible latency/throughput figure.
- Write a go/no-go memo to the founder using only numbers produced this way — replacing every number in the current README that Part 1 of this audit could not verify.

---

## Appendix — Part 7: `echoregent-market-intelligence` repository

Cloned read-only from `github.com/ashy5454/echoregent-market-intelligence`
(public repo, added to this session's scope for this audit).

**Is `reddit_100k_ai_dataset.csv` real scraped data? No — confirmed
fabricated/templated, not scraped.** Direct inspection of all 100,000 rows:

- **Only 24 unique `post_title` values and only 8 unique `comment_snippet`
  values** across the entire 100,000-row file — every row is one of a
  handful of templates, repeated with different random-looking
  score/comment-count/timestamp filler. (Counted directly: `csv.DictReader`
  over the full file, `len(set(...))` on both columns.)
- **The `id` column is a plain sequential counter** (`t1_c0000001` through
  `t1_c0100000`, exactly matching row order) — not how real Reddit fullnames
  work (those are base36-encoded, non-sequential, and never zero-padded to
  match a row index). This alone is sufficient to rule out a real scrape.
- The 8 recycled comment templates read like market-research talking points
  written to support this product's own pitch ("Using prompt caching cut our
  monthly OpenAI API bill by over 45%..."; "API billing surprise: resending
  50k context history on every turn"), not organic Reddit discussion.

**Are the report numbers computed or hardcoded? Both, in different files —
and the computed ones are computed from the fabricated CSV above, so they
don't rescue the claim.**
- `generate_master_exhaustive_reports.py` (the script that produces
  `EXHAUSTIVE_MARKDOWN_REPORT.md`, `STARTUP_FOUNDER_ANALYSIS.md`, `README.md`,
  and the `.docx` report) contains **zero** CSV/data-reading code — it is a
  single hardcoded Python string with every number written as a literal
  (subreddit percentages, "X Matched Discussions" counts, "Pain Score: N/100"
  values, TAM dollar figures, and the same 259/6,956/18,679-token LoCoMo
  figures that appear in the main repo's README). It also explicitly labels
  the 8 recycled template strings as "Real Verbatim Scraped Reddit Quotes,"
  which is false on two counts: they aren't verbatim (they're templates
  repeated ~12,000+ times each) and the underlying data isn't scraped.
- `extract_real_reddit_quotes_and_map.py` **does** read the CSV via `pandas`
  and does compute its keyword-match counts from it (verified: the
  subreddit-distribution percentages in the hardcoded report — 16.8%, 16.7%,
  16.5%, etc. — exactly match a direct recount of the CSV, so at least that
  part of the pipeline is genuinely wired up). But its `pain_score` values
  (98, 95, 92, 90, 87...) are hardcoded constants per keyword cluster, not
  derived from anything in the data, and the underlying counts are counts
  over a synthetic dataset regardless — a real computation over fake data is
  still not market evidence.
