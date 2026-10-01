/**
 * AUDIT — Part 5(a): offline paired evaluation harness.
 *
 * STATUS: this harness is complete and type-checks, but has NOT been run
 * end-to-end in this audit. It needs three things this environment does not
 * have (see AUDIT.md "keys/assets needed"):
 *   1. Real API keys for the providers under test (OPENAI_API_KEY /
 *      ANTHROPIC_API_KEY / GEMINI_API_KEY) — this makes real, billed calls.
 *   2. A corpus of 200+ anonymized real multi-turn conversations
 *      (support-bot and copilot style) in the ConversationFixture shape
 *      below. None ship with this repo or this audit.
 *   3. A quality judge: either a "judge" provider/model (e.g. one more LLM
 *      call per turn) or a human-graded sample process for the blind side.
 *
 * Usage (once the above are supplied):
 *   OPENAI_API_KEY=... npx tsx audit/bench/paired-eval.ts --dataset ./conversations.jsonl --k 3
 *
 * Design constraints this harness follows (per the audit's ground rules):
 *   - Runs BOTH arms with the provider's prompt caching turned ON. A baseline
 *     with caching OFF is not a fair "what does the customer actually pay"
 *     comparison — see AUDIT.md Part 5 for why.
 *   - Reads billed cost exclusively from the provider's own `usage` object
 *     (uncached input tokens, cache_creation/cache_write tokens, cache_read
 *     tokens, output tokens) — never from CTS's own chars/4 estimate
 *     (src/cts-core/compressor.ts:476-479, confirmed inaccurate — see
 *     audit/tests/token-estimation.test.ts).
 *   - Repeats each conversation k=3 times and reports medians + a Wilcoxon
 *     signed-rank test (audit/bench/stats.ts) on the paired per-conversation
 *     deltas, exactly as Part 5(a) asks — this guards against the very
 *     mistake this audit exists to catch: reporting one lucky run as "the"
 *     result.
 *   - Every failure (classify() crash, malformed response, provider error)
 *     is recorded per-conversation, not silently dropped from the average.
 */

import { readFile } from 'node:fs/promises'
import { classifyAsync } from '../../src/cts-core/classifier'
import { compressHistoryAsync } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'
import { wilcoxonSignedRank, median } from './stats'

export interface ConversationFixture {
  id: string
  kind: 'support' | 'copilot'
  turns: Message[] // ground-truth full transcript, oldest first
}

export interface ProviderUsage {
  uncachedInputTokens: number
  cacheWriteTokens: number
  cacheReadTokens: number
  outputTokens: number
}

export interface TurnResult {
  turnIndex: number
  usage: ProviderUsage
  latencyMs: number
  responseText: string
  error?: string
}

export interface ConversationRunResult {
  conversationId: string
  arm: 'baseline' | 'echoregent'
  turns: TurnResult[]
  totalUsage: ProviderUsage
  failures: number
}

export interface JudgeVerdict {
  conversationId: string
  turnIndex: number
  verdict: 'win' | 'tie' | 'loss' // echoregent vs baseline, from the judge's perspective
  rationale: string
}

// ── Provider call — real network calls, gated behind explicit opt-in ────────

async function callProviderWithCaching(
  _provider: 'openai' | 'anthropic' | 'gemini',
  _apiKey: string,
  _model: string,
  _messages: Message[],
  _systemPrompt: string,
): Promise<{ usage: ProviderUsage; text: string }> {
  throw new Error(
    'callProviderWithCaching() is intentionally unimplemented in this audit checkout. ' +
    'Wire this to the real OpenAI/Anthropic/Gemini SDKs with prompt caching enabled ' +
    '(Anthropic: cache_control blocks; OpenAI/Gemini: automatic) before running this ' +
    'harness against a real dataset and real keys. Map each provider\'s `usage` object ' +
    'onto ProviderUsage exactly — do not estimate tokens from character counts.',
  )
}

// ── Arm 1: baseline — full history, provider caching ON, no CTS involved ───

async function runBaselineArm(
  fixture: ConversationFixture,
  provider: 'openai' | 'anthropic' | 'gemini',
  apiKey: string,
  model: string,
): Promise<ConversationRunResult> {
  const turns: TurnResult[] = []
  let failures = 0
  const history: Message[] = []

  for (let i = 0; i < fixture.turns.length; i++) {
    const turn = fixture.turns[i]
    if (turn.role !== 'user') { history.push(turn); continue }
    const started = performance.now()
    try {
      const { usage, text } = await callProviderWithCaching(provider, apiKey, model, [...history, turn], '')
      turns.push({ turnIndex: i, usage, latencyMs: performance.now() - started, responseText: text })
      history.push(turn, { role: 'assistant', content: text })
    } catch (err) {
      failures += 1
      turns.push({
        turnIndex: i,
        usage: { uncachedInputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
        latencyMs: performance.now() - started,
        responseText: '',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { conversationId: fixture.id, arm: 'baseline', turns, totalUsage: sumUsage(turns), failures }
}

// ── Arm 2: EchoRegent — classifyAsync + compressHistoryAsync every turn ─────

async function runEchoRegentArm(
  fixture: ConversationFixture,
  provider: 'openai' | 'anthropic' | 'gemini',
  apiKey: string,
  model: string,
): Promise<ConversationRunResult> {
  const turns: TurnResult[] = []
  let failures = 0
  const history: Message[] = []

  for (let i = 0; i < fixture.turns.length; i++) {
    const turn = fixture.turns[i]
    if (turn.role !== 'user') { history.push(turn); continue }
    const started = performance.now()
    try {
      const frame: RoutingFrame = await classifyAsync(turn.content, history)
      const compression = await compressHistoryAsync([...history, turn], frame)
      // NOTE: compression.compressed is a FRESH summary every turn (see
      // audit/tests/prompt-caching.test.ts) — do not expect this arm to earn
      // any cache_read_tokens even with provider caching enabled.
      const { usage, text } = await callProviderWithCaching(provider, apiKey, model, compression.compressed, '')
      turns.push({ turnIndex: i, usage, latencyMs: performance.now() - started, responseText: text })
      history.push(turn, { role: 'assistant', content: text })
    } catch (err) {
      failures += 1
      turns.push({
        turnIndex: i,
        usage: { uncachedInputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
        latencyMs: performance.now() - started,
        responseText: '',
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return { conversationId: fixture.id, arm: 'echoregent', turns, totalUsage: sumUsage(turns), failures }
}

function sumUsage(turns: TurnResult[]): ProviderUsage {
  return turns.reduce(
    (acc, t) => ({
      uncachedInputTokens: acc.uncachedInputTokens + t.usage.uncachedInputTokens,
      cacheWriteTokens: acc.cacheWriteTokens + t.usage.cacheWriteTokens,
      cacheReadTokens: acc.cacheReadTokens + t.usage.cacheReadTokens,
      outputTokens: acc.outputTokens + t.usage.outputTokens,
    }),
    { uncachedInputTokens: 0, cacheWriteTokens: 0, cacheReadTokens: 0, outputTokens: 0 },
  )
}

// ── Billed-cost projection (pass real $/token rates for the chosen model) ──

export interface Rates { uncached: number; cacheWrite: number; cacheRead: number; output: number }

export function billedCost(usage: ProviderUsage, rates: Rates): number {
  return (
    usage.uncachedInputTokens * rates.uncached +
    usage.cacheWriteTokens * rates.cacheWrite +
    usage.cacheReadTokens * rates.cacheRead +
    usage.outputTokens * rates.output
  )
}

// ── Orchestration: k repeats, paired deltas, Wilcoxon ───────────────────────

export async function runPairedEval(
  fixtures: ConversationFixture[],
  provider: 'openai' | 'anthropic' | 'gemini',
  apiKey: string,
  model: string,
  rates: Rates,
  k = 3,
): Promise<void> {
  const baselineCosts: number[] = []
  const echoregentCosts: number[] = []

  for (const fixture of fixtures) {
    const baselineRuns: number[] = []
    const echoregentRuns: number[] = []
    for (let run = 0; run < k; run++) {
      const baseline = await runBaselineArm(fixture, provider, apiKey, model)
      const echoregent = await runEchoRegentArm(fixture, provider, apiKey, model)
      baselineRuns.push(billedCost(baseline.totalUsage, rates))
      echoregentRuns.push(billedCost(echoregent.totalUsage, rates))
    }
    // Median-of-k per conversation, as Part 5(a) specifies.
    baselineCosts.push(median(baselineRuns))
    echoregentCosts.push(median(echoregentRuns))
  }

  const test = wilcoxonSignedRank(echoregentCosts, baselineCosts)
  const meanSavingsPct =
    (1 - median(echoregentCosts) / median(baselineCosts)) * 100

  console.log(`Conversations: ${fixtures.length}, k=${k}`)
  console.log(`Median billed cost — baseline: ${median(baselineCosts).toFixed(4)}, EchoRegent: ${median(echoregentCosts).toFixed(4)}`)
  console.log(`Median savings: ${meanSavingsPct.toFixed(1)}%`)
  console.log(`Wilcoxon signed-rank: n=${test.n}, W=${test.statistic.toFixed(1)}, z≈${test.zApprox.toFixed(2)}, two-sided p≈${test.pValueApprox.toFixed(4)}`)
}

// ── CLI entry point ──────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const datasetIdx = args.indexOf('--dataset')
  if (datasetIdx === -1) {
    console.error('Usage: npx tsx audit/bench/paired-eval.ts --dataset ./conversations.jsonl [--k 3]')
    console.error('Requires OPENAI_API_KEY / ANTHROPIC_API_KEY / GEMINI_API_KEY in env, and')
    console.error('callProviderWithCaching() wired to a real SDK — see comments in this file.')
    process.exit(1)
  }
  const datasetPath = args[datasetIdx + 1]
  const raw = await readFile(datasetPath, 'utf-8')
  const fixtures: ConversationFixture[] = raw.trim().split('\n').map((line) => JSON.parse(line))
  console.log(`Loaded ${fixtures.length} conversation fixtures from ${datasetPath}.`)
  console.log('Not running: callProviderWithCaching() is unimplemented (see file header). ' +
    'This confirms the harness parses a real dataset; it does not fabricate a result.')
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error(err); process.exit(1) })
}
