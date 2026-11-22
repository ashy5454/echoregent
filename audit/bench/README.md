# /audit/bench — measurement harness (Part 5)

Everything in this directory either (a) runs standalone with no external
dependencies and produces real output, or (b) is a complete, wired harness
that intentionally refuses to fabricate a result until it is given real
credentials and data. See AUDIT.md Part 5 for the full write-up; this file is
just the "how to run it" reference.

## What actually runs today

- **`breakeven.ts`** — `npx tsx audit/bench/breakeven.ts`
  Pure math, no keys needed. Simulates per-turn billed cost for "full history
  + provider prompt caching" vs. EchoRegent's compression, across conversation
  length and cache-hit rate, using the cache pricing ratios cited in AUDIT.md
  Part 4. This is Part 5(b) and it is fully executed — see AUDIT.md for the
  output table and what it means.
- **`stats.ts`** — Wilcoxon signed-rank test, used by `paired-eval.ts`.
  Sanity-checked against the standard textbook example (n=10, one zero-diff
  pair dropped, W+=27/W-=18) in `audit/notes/check_wilcoxon.ts`.

## What is built but NOT run (Part 5a)

- **`paired-eval.ts`** — the offline paired evaluation harness. It:
  - runs a "baseline" arm (full history, provider caching ON) and an
    "EchoRegent" arm (`classifyAsync` + `compressHistoryAsync`) per
    conversation,
  - reads cost exclusively from the provider's own `usage` object (never
    CTS's chars/4 estimate),
  - repeats each conversation `k=3` times and reports medians + a Wilcoxon
    signed-rank test on the paired deltas, per the audit's ground rules.

  It does not fabricate output: `callProviderWithCaching()` throws until you
  wire it to a real SDK call, and running it (see command below) against a
  placeholder dataset prints only "Loaded N fixtures... not running" — proven
  in AUDIT.md.

  **To actually run this and get real numbers, you need to supply:**
  1. `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` (real, billed).
  2. A `ConversationFixture[]`-shaped JSONL file of 200+ anonymized real
     multi-turn conversations (support-bot and copilot style). None exist in
     this repo or this audit — synthesizing them would defeat the point of a
     "real conversation" eval.
  3. A quality judge — either one more LLM call per turn (a "judge" model) or
     a human-graded sample for the blind side Part 5(a) asks for.
  4. `callProviderWithCaching()` implemented against the real OpenAI/
     Anthropic/Gemini SDKs, with caching turned on in both arms, mapping each
     provider's real `usage`/`usage_metadata` object onto `ProviderUsage`.

  ```bash
  OPENAI_API_KEY=sk-... npx tsx audit/bench/paired-eval.ts --dataset ./conversations.jsonl --k 3
  ```

## Not built (design only — see AUDIT.md Part 5)

- **LongMemEval / LoCoMo runs (5c)** — need each benchmark's own published
  harness plus the fine-tuned `ml/cts_classifier` / `ml/cts_t5` weights
  (gitignored, not in this repo) to test the real product path rather than
  its keyword/rule fallback.
- **Verified-savings billing design (5d)** — written up in AUDIT.md, not code
  (it is a billing/product decision, not something to simulate here).
- **Coding-agent benchmark design (5e)** — written up in AUDIT.md per the
  task's explicit instruction to design, not run, this one.
