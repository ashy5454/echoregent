/**
 * AUDIT — Part 5(b): break-even analysis.
 *
 * Question: at what conversation length, and at what provider cache-hit rate,
 * does EchoRegent's compression approach beat "do nothing, just turn on the
 * provider's native prompt cache" — and when does it cost MORE?
 *
 * This is a closed-form cost simulation, not a live benchmark (no API keys are
 * used or required — it runs standalone with `npx tsx audit/bench/breakeven.ts`).
 * The pricing RATIOS below are sourced from the providers' own docs (see
 * AUDIT.md Part 4 for citations + fetch dates); only the ratios matter for a
 * break-even crossover point, not any one provider's absolute $/token, which
 * changes often. A worked $ example using OpenAI/Anthropic's published numbers
 * is printed at the end for concreteness.
 *
 * Baseline arm ("full history + provider caching ON"):
 *   Every turn resends the full transcript. If the conversation is pure
 *   append-only (nothing earlier gets edited) and requests land inside the
 *   cache TTL, the provider serves everything up to the last turn's end as a
 *   cache READ (heavily discounted) and only the newly-appended turn is
 *   freshly billed as a cache WRITE (slightly *more* than uncached, since a
 *   write also extends the cache for the next turn).
 *
 * EchoRegent arm:
 *   compressHistoryAsync()/compressHistory() rebuild a NEW summary every turn
 *   (audit/tests/prompt-caching.test.ts proves this — the position-0 message
 *   is not stable across turns). That means the compressed request has NO
 *   stable prefix a provider cache can match, so every token in it is billed
 *   at the full uncached input rate, every turn — regardless of how small the
 *   compressed context is.
 */

type PriceRatios = {
  name: string
  uncached: number   // base input price, normalized to 1.0
  cacheWrite: number // multiplier of `uncached`
  cacheRead: number  // multiplier of `uncached`
}

// Sourced from Part 4 (AUDIT.md) — ratios only, not absolute $/token.
const PROVIDERS: PriceRatios[] = [
  { name: 'OpenAI (5m auto cache)',      uncached: 1, cacheWrite: 1.25, cacheRead: 0.10 },
  { name: 'Anthropic (5m TTL)',          uncached: 1, cacheWrite: 1.25, cacheRead: 0.10 },
  { name: 'Anthropic (1h TTL)',          uncached: 1, cacheWrite: 2.00, cacheRead: 0.10 },
  { name: 'Gemini 2.5+ (implicit)',      uncached: 1, cacheWrite: 1.00, cacheRead: 0.10 },
]

interface SimParams {
  turns: number            // conversation length N
  deltaTokensPerTurn: number // tokens appended per turn (user+assistant)
  outputTokensPerTurn: number
  echoregentCompressedSize: number // steady-state compressed context size (tokens) once N > 4
  cacheHitRate: number      // 0..1 — probability a given turn's prior history is served from cache
}

function baselineCost(p: PriceRatios, s: SimParams): number[] {
  // Returns CUMULATIVE cost after each turn.
  const cumulative: number[] = []
  let total = 0
  let priorHistory = 0
  for (let i = 1; i <= s.turns; i++) {
    const isHit = Math.random() < s.cacheHitRate // stochastic per-turn cache hit
    let turnCost: number
    if (i === 1 || !isHit) {
      // Cache miss (or first turn): the whole prior history is billed uncached,
      // and a write is paid to (re)seed the cache for the next attempt.
      turnCost = p.uncached * priorHistory + p.cacheWrite * s.deltaTokensPerTurn
    } else {
      turnCost = p.cacheRead * priorHistory + p.cacheWrite * s.deltaTokensPerTurn
    }
    turnCost += p.uncached * s.outputTokensPerTurn // output tokens are never cached
    total += turnCost
    cumulative.push(total)
    priorHistory += s.deltaTokensPerTurn
  }
  return cumulative
}

function echoregentCost(p: PriceRatios, s: SimParams): number[] {
  const cumulative: number[] = []
  let total = 0
  let priorHistory = 0
  for (let i = 1; i <= s.turns; i++) {
    // compressHistory() keeps everything verbatim for the first 4 turns
    // (compressor.ts:46 — `if (history.length <= 4)`), then compresses down
    // to a fresh, non-cacheable summary every turn after that.
    const contextSize = i <= 4 ? priorHistory : s.echoregentCompressedSize
    const turnCost = p.uncached * (contextSize + s.deltaTokensPerTurn) + p.uncached * s.outputTokensPerTurn
    total += turnCost
    cumulative.push(total)
    priorHistory += s.deltaTokensPerTurn
  }
  return cumulative
}

function mean(values: number[]): number {
  return values.reduce((s, v) => s + v, 0) / values.length
}

// Reports, at each checkpoint turn N, which arm is cheaper ON AVERAGE across
// `trials` stochastic runs — this is more informative than a single
// "crossover point" because (as the results below show) the cheaper arm can
// flip back and forth: EchoRegent's flat per-turn cost avoids the cache
// WRITE premium early on, but a provider's heavily-discounted cache READ
// compounds favorably over a long, high-hit-rate conversation and can overtake
// it again later.
function runScenario(p: PriceRatios, s: Omit<SimParams, 'turns'>, checkpoints: number[], trials = 300): void {
  const maxTurns = checkpoints[checkpoints.length - 1]
  const baselineAt: number[][] = checkpoints.map(() => [])
  const echoregentAt: number[][] = checkpoints.map(() => [])

  for (let t = 0; t < trials; t++) {
    const b = baselineCost(p, { ...s, turns: maxTurns })
    const e = echoregentCost(p, { ...s, turns: maxTurns })
    checkpoints.forEach((turn, idx) => {
      baselineAt[idx].push(b[turn - 1])
      echoregentAt[idx].push(e[turn - 1])
    })
  }

  const cells = checkpoints.map((turn, idx) => {
    const bMean = mean(baselineAt[idx])
    const eMean = mean(echoregentAt[idx])
    const cheaper = eMean < bMean ? 'EchoRegent' : 'baseline+cache'
    const pct = Math.abs((eMean - bMean) / bMean * 100).toFixed(0)
    return `turn ${turn}: ${cheaper} cheaper by ${pct}%`
  })
  console.log(cells.join('  |  '))
}

// ── Scenarios ────────────────────────────────────────────────────────────────
// A realistic support/copilot conversation: ~350 tokens added per turn (user +
// assistant), ~250 output tokens, EchoRegent settles to a ~700-token compressed
// context (summary + a couple of recent turns) once compression kicks in.

const baseParams: Omit<SimParams, 'cacheHitRate' | 'turns'> = {
  deltaTokensPerTurn: 350,
  outputTokensPerTurn: 250,
  echoregentCompressedSize: 700,
}
const checkpoints = [2, 5, 10, 20, 40, 80]

console.log('EchoRegent vs. "just turn on provider prompt caching" — which is cheaper at turn N?')
console.log('(mean cumulative billed cost across 300 stochastic trials per cell; conversation shape:')
console.log(` ~${baseParams.deltaTokensPerTurn} new tokens/turn, ~${baseParams.outputTokensPerTurn} output tokens/turn,`)
console.log(` EchoRegent settles to a ~${baseParams.echoregentCompressedSize}-token compressed context after turn 4)`)
console.log('')

const hitRates = [1.0, 0.9, 0.7, 0.5]
for (const provider of PROVIDERS) {
  console.log(`--- ${provider.name} (write=${provider.cacheWrite}x, read=${provider.cacheRead}x) ---`)
  for (const hitRate of hitRates) {
    process.stdout.write(`  cache-hit=${Math.round(hitRate * 100)}%:  `)
    runScenario(provider, { ...baseParams, cacheHitRate: hitRate }, checkpoints)
  }
  console.log('')
}

// ── Worked $ example (OpenAI GPT-4o-mini-class pricing shape) ────────────────
console.log('--- Worked example: 40-turn support conversation, OpenAI-shaped pricing, 90% cache-hit rate ---')
const worked: SimParams = { turns: 40, deltaTokensPerTurn: 350, outputTokensPerTurn: 250, echoregentCompressedSize: 700, cacheHitRate: 0.9 }
const b = baselineCost(PROVIDERS[0], worked)
const e = echoregentCost(PROVIDERS[0], worked)
console.log(`Cumulative cost units after 40 turns — baseline+caching: ${b[b.length - 1].toFixed(0)} units, EchoRegent: ${e[e.length - 1].toFixed(0)} units`)
console.log(`(units are "uncached input tokens" — multiply by your model's $/token to get real cost)`)
console.log(`EchoRegent is ${e[e.length - 1] < b[b.length - 1] ? 'CHEAPER' : 'MORE EXPENSIVE'} than baseline+caching at this point.`)
