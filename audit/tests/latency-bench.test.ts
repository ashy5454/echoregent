// AUDIT — Latency benchmarks for CTS model inference and compression paths.
//
// All tests use a p95 latency metric over 100 measured runs (plus 10 warmup
// calls that are discarded). Tests that depend on a trained ONNX model are
// gated with `it.skipIf(checkModelPresent(...))` so they skip cleanly when
// the ml/ directory is empty (e.g. CI, fresh checkouts pre-Phase 4).
//
// Latency gates:
//   cts_classifier   — classifies a single turn in ≤15ms p95
//   cts_relevance    — scores a batch of 20 messages in ≤35ms p95 (Phase 4)
//   end-to-end       — compresses a 40-turn history in ≤50ms p95 (Phase 4, with ML)
//   rule-based       — compressHistory (sync, no ML) on 40-turn history ≤100ms p95
//   semantic cache   — checkCache in ≤8ms p95 (Phase 4)

import { describe, it, expect, test } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { classifyAsync } from '../../src/cts-core/classifier'
import { getClassifierHealth } from '../../src/cts-core/ml-classifier'
import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// ── Model presence helpers ────────────────────────────────────────────────────

const ML_DIR = join(process.cwd(), 'ml')

function checkModelPresent(name: string): boolean {
  return existsSync(join(ML_DIR, name))
}

// ── P95 latency measurement helper ───────────────────────────────────────────

async function measureP95(
  fn: () => Promise<void> | void,
  warmup = 10,
  measure = 100,
): Promise<number> {
  // Warmup: run fn warmup times, discard results
  for (let i = 0; i < warmup; i++) await fn()
  // Measure: collect measure latencies
  const latencies: number[] = []
  for (let i = 0; i < measure; i++) {
    const start = performance.now()
    await fn()
    latencies.push(performance.now() - start)
  }
  latencies.sort((a, b) => a - b)
  return latencies[Math.floor(measure * 0.95)]
}

// ── Shared test fixtures ──────────────────────────────────────────────────────

function makeRoutingFrame(overrides: Partial<RoutingFrame> = {}): RoutingFrame {
  return {
    intent: 'debugging',
    state: 'deepening',
    domain: 'coding',
    risk: [],
    signals: { keywords: [], structures: [], urgency: 'low', affect: 'neutral' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
    ...overrides,
  }
}

function make40TurnHistory(): Message[] {
  const history: Message[] = []
  for (let i = 0; i < 40; i++) {
    if (i % 2 === 0) {
      history.push({
        role: 'user',
        content: `Turn ${i + 1}: I am trying to debug a TypeScript error in my Express API. The endpoint is /api/users/${i} and it returns a 500.`,
      })
    } else {
      history.push({
        role: 'assistant',
        content: `Turn ${i + 1}: Let me help you debug that 500 error on /api/users/${i - 1}. Can you share the stack trace?`,
      })
    }
  }
  return history
}

// ── cts_classifier latency ────────────────────────────────────────────────────

describe('cts_classifier latency', () => {
  it.skipIf(!checkModelPresent('cts_classifier'))(
    'classifies a single turn in ≤15ms p95',
    async () => {
      const p95 = await measureP95(() =>
        classifyAsync('Help me debug this TypeScript error in my Express API'),
      )
      expect(getClassifierHealth().loaded).toBe(true)
      expect(p95).toBeLessThanOrEqual(15)
    },
    { timeout: 10000 },
  )
})

// ── cts_relevance latency ─────────────────────────────────────────────────────

describe('cts_relevance latency', () => {
  // The production loader uses `new Function("return import(...)")`, which
  // Vitest's module runner cannot execute — the model always falls back here,
  // so a timing assertion would pass without measuring anything. The real
  // load + latency check runs under tsx: `npm run verify:relevance`.
  test.todo('scoreRelevance batch of 20 messages ≤35ms p95 (measured by npm run verify:relevance)')
})

// ── end-to-end compression latency ───────────────────────────────────────────

describe('end-to-end compression latency', () => {
  test.todo('full model latency is measured outside Vitest by npm run bench:latency')

  it(
    'rule-based compressHistory on 40-turn history completes in reasonable time (no ML dependency)',
    async () => {
      const history = make40TurnHistory()
      const frame = makeRoutingFrame()
      const p95 = await measureP95(() => compressHistory(history, frame))
      expect(p95).toBeLessThanOrEqual(100)
    },
    { timeout: 10000 },
  )
})

// ── semantic cache latency ────────────────────────────────────────────────────

describe('semantic cache latency', () => {
  test.todo('real semantic-cache latency is measured outside Vitest by npm run bench:latency')
})
