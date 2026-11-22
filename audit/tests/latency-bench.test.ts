// AUDIT — Latency benchmarks for CTS model inference and compression paths.
//
// All tests use a p95 latency metric over measured runs (plus warmup calls
// that are discarded). Tests verify model inference and health reporting when
// ONNX weights are installed, and verify rule-based fallback latency and graceful
// model-health reporting when local ONNX weights are not installed.
//
// Latency gates:
//   cts_classifier   — classifies a single turn in ≤15ms p95
//   cts_relevance    — scores a batch of 20 messages in ≤35ms p95 (Phase 4)
//   end-to-end       — compresses a 40-turn history in ≤50ms p95 (Phase 4, with ML)
//   rule-based       — compressHistory (sync, no ML) on 40-turn history ≤100ms p95
//   semantic cache   — checkCache in ≤8ms p95 (Phase 4)

import { describe, it, expect } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { classifyAsync } from '../../src/cts-core/classifier'
import { getClassifierHealth } from '../../src/cts-core/ml-classifier'
import { compressHistory, compressHistoryML } from '../../src/cts-core/compressor'
import { scoreRelevance, getRelevanceHealth } from '../../src/cts-core/ml-relevance'
import { checkCache, getSemanticCacheHealth } from '../../src/cts-core/semantic-cache'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// ── Model presence helpers ────────────────────────────────────────────────────

const ML_DIR = join(process.cwd(), 'ml')

function checkModelPresent(name: string): boolean {
  return existsSync(join(ML_DIR, name))
}

// ── P95 latency measurement helper ───────────────────────────────────────────

async function measureP95(
  fn: () => Promise<unknown> | unknown,
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
  it(
    'classifies a single turn in ≤15ms p95',
    async () => {
      const p95 = await measureP95(
        () => classifyAsync('Help me debug this TypeScript error in my Express API'),
        5,
        30,
      )
      const health = getClassifierHealth()
      if (checkModelPresent('cts_classifier')) {
        expect(health.loaded).toBe(true)
      } else {
        expect(health.loaded).toBe(false)
        expect(['not_loaded', 'failed']).toContain(health.status)
      }
      expect(p95).toBeLessThanOrEqual(15)
    },
    { timeout: 10000 },
  )
})

// ── cts_relevance latency ─────────────────────────────────────────────────────

describe('cts_relevance latency', () => {
  it(
    'scoreRelevance batch of 20 messages ≤35ms p95 with graceful fallback',
    async () => {
      const messages = make40TurnHistory().slice(0, 20)
      const p95 = await measureP95(
        () => scoreRelevance('debug TypeScript error Express API', messages),
        5,
        30,
      )
      const health = getRelevanceHealth()
      if (checkModelPresent('cts_relevance')) {
        expect(health.loaded).toBe(true)
        expect(p95).toBeLessThanOrEqual(35)
      } else {
        expect(health.loaded).toBe(false)
        expect(['not_loaded', 'failed']).toContain(health.status)
        expect(p95).toBeLessThanOrEqual(35)
      }
    },
    { timeout: 10000 },
  )
})

// ── end-to-end compression latency ───────────────────────────────────────────

describe('end-to-end compression latency', () => {
  it(
    'compressHistoryML on 40-turn history completes within latency budget with rule-based fallback',
    async () => {
      const history = make40TurnHistory()
      const frame = makeRoutingFrame()
      const p95 = await measureP95(() => compressHistoryML(history, frame), 5, 20)
      const health = getRelevanceHealth()
      if (checkModelPresent('cts_relevance')) {
        expect(health.loaded).toBe(true)
        expect(p95).toBeLessThanOrEqual(50)
      } else {
        expect(health.loaded).toBe(false)
        expect(['not_loaded', 'failed']).toContain(health.status)
        expect(p95).toBeLessThanOrEqual(100)
      }
    },
    { timeout: 10000 },
  )

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
  it(
    'checkCache completes within latency budget with graceful fallback when model absent',
    async () => {
      const p95 = await measureP95(
        () => checkCache('debug TypeScript error in Express API', 'coding', 'latency-sess-1'),
        5,
        20,
      )
      const health = getSemanticCacheHealth()
      if (checkModelPresent('cts_minilm')) {
        expect(health.loaded).toBe(true)
        expect(p95).toBeLessThanOrEqual(8)
      } else {
        expect(health.loaded).toBe(false)
        expect(['not_loaded', 'failed']).toContain(health.status)
        expect(p95).toBeLessThanOrEqual(30)
      }
    },
    { timeout: 10000 },
  )
})
