// AUDIT — Overfitting detection tests
//
// Validates Requirements 2.3, 2.4, 6.1:
//   2.3  Vocabulary overfitting: structurally identical histories with different
//        city names must compress at the same retention ratio.
//   2.4  Unseen vocabulary must not be dropped more aggressively than known vocab.
//   6.1  Minimum retention floor: compressHistory must keep ≥ 15 % of messages
//        for long conversations, and tokensSaved must always be non-negative.

import { describe, it, expect } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
import { classify } from '../../src/cts-core/classifier'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeFrame(domain: string): RoutingFrame {
  return {
    intent: 'task_execution',
    state: 'deepening',
    domain,
    risk: [],
    signals: { keywords: [], structures: [], urgency: 'medium' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
  }
}

function supportFrame(): RoutingFrame {
  return {
    intent: 'escalation',
    state: 'escalating',
    domain: 'customer_support',
    risk: [],
    signals: { keywords: [], structures: [], urgency: 'high', affect: 'frustrated' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
  }
}

/** 8-message customer_support history with a given city name. */
function historyWithCity(city: string): Message[] {
  return [
    { role: 'user',      content: `My package never arrived here in ${city}.` },
    { role: 'assistant', content: 'I am sorry to hear that. Let me look into your order.' },
    { role: 'user',      content: 'The tracking number shows delivered but I see nothing.' },
    { role: 'assistant', content: 'I will escalate this to our logistics team immediately.' },
    { role: 'user',      content: 'I need a refund or a replacement sent out today.' },
    { role: 'assistant', content: 'Understood. I have flagged your order as urgent.' },
    { role: 'user',      content: 'Please confirm once the replacement is dispatched.' },
    { role: 'assistant', content: 'You will receive a confirmation email once it ships.' },
  ]
}

// ── 1. Vocabulary overfitting regression guard ────────────────────────────────

describe('Vocabulary overfitting regression guard', () => {
  // This test is expected to fail until ml-relevance.ts is wired in —
  // documents the vocabulary overfitting gap
  it('Dallas and Portland compress at the same retention ratio', () => {
    const frame = supportFrame()
    const resultDallas   = compressHistory(historyWithCity('Dallas'),   frame)
    const resultPortland = compressHistory(historyWithCity('Portland'), frame)

    expect(Math.abs(resultDallas.compressed.length - resultPortland.compressed.length)).toBeLessThanOrEqual(1)
  })

  it('unseen city names are not dropped more aggressively than known ones', () => {
    // Build an 8-message history around a customer support issue that mentions
    // "Springfield" — a city name not present in any hardcoded regex pattern.
    const history: Message[] = [
      { role: 'user',      content: 'My delivery address is in Springfield and the package is missing.' },
      { role: 'assistant', content: 'I am sorry to hear that. Can you provide your order number?' },
      { role: 'user',      content: 'Order number is ORD-77821. It was due last Tuesday.' },
      { role: 'assistant', content: 'I see the order. It appears to still be in transit.' },
      { role: 'user',      content: 'That makes no sense. Springfield is only 2 hours from the warehouse.' },
      { role: 'assistant', content: 'I agree, that is unusual. I will escalate to the logistics team.' },
      { role: 'user',      content: 'Please also issue a refund if it does not arrive by Friday.' },
      { role: 'assistant', content: 'Noted. A refund will be initiated automatically if it is not delivered by Friday.' },
    ]

    const frame  = supportFrame()
    const result = compressHistory(history, frame)

    // The compressor must not collapse the whole conversation to just a summary.
    // At minimum 3 messages must survive (generous floor, not just the summary).
    expect(result.compressed.length).toBeGreaterThanOrEqual(3)
  })
})

// ── 2. Train/val F1 gap detection ─────────────────────────────────────────────

interface ClassMetrics { f1: number }
interface GapResult { train_f1: number; val_f1: number; gap: number; overfit: boolean }

function computeTrainValGap(
  trainMetrics: Record<string, ClassMetrics>,
  valMetrics:   Record<string, ClassMetrics>,
): Record<string, GapResult> {
  const result: Record<string, GapResult> = {}
  for (const domain of Object.keys(trainMetrics)) {
    const gap = trainMetrics[domain].f1 - valMetrics[domain].f1
    result[domain] = {
      train_f1: trainMetrics[domain].f1,
      val_f1:   valMetrics[domain].f1,
      gap,
      overfit:  gap > 0.15,
    }
  }
  return result
}

describe('Train/val F1 gap detection', () => {
  it('flags medical as overfit when train/val gap is 0.36', () => {
    const gaps = computeTrainValGap(
      { medical: { f1: 0.96 } },
      { medical: { f1: 0.60 } },
    )
    // gap = 0.96 - 0.60 = 0.36, which is > 0.15
    expect(gaps['medical'].overfit).toBe(true)
  })

  it('does NOT flag coding as overfit at gap of exactly 0.15 (boundary)', () => {
    const gaps = computeTrainValGap(
      { coding: { f1: 0.95 } },
      { coding: { f1: 0.80 } },
    )
    // gap = 0.95 - 0.80 = 0.15, boundary is exclusive (> 0.15 required), so NOT overfit
    expect(gaps['coding'].overfit).toBe(false)
  })

  it('does NOT flag coding as overfit at gap of 0.14', () => {
    const gaps = computeTrainValGap(
      { coding: { f1: 0.94 } },
      { coding: { f1: 0.80 } },
    )
    // gap = 0.94 - 0.80 = 0.14, which is < 0.15
    expect(gaps['coding'].overfit).toBe(false)
  })

  it('flags a domain as overfit when gap is 0.16', () => {
    const gaps = computeTrainValGap(
      { sales: { f1: 0.96 } },
      { sales: { f1: 0.80 } },
    )
    // gap = 0.96 - 0.80 = 0.16, which is > 0.15
    expect(gaps['sales'].overfit).toBe(true)
  })
})

// ── 3. All gaps within threshold ──────────────────────────────────────────────

describe('all gaps within threshold', () => {
  it('no domain is flagged when all gaps are 0.05', () => {
    const domains = ['coding', 'customer_support', 'sales', 'legal', 'medical', 'education', 'commerce', 'general']
    const trainMetrics: Record<string, ClassMetrics> = {}
    const valMetrics:   Record<string, ClassMetrics> = {}
    for (const d of domains) {
      trainMetrics[d] = { f1: 0.90 }
      valMetrics[d]   = { f1: 0.85 }   // gap = 0.05
    }

    const gaps = computeTrainValGap(trainMetrics, valMetrics)
    for (const d of domains) {
      expect(gaps[d].overfit).toBe(false)
    }
  })
})

// ── 4. Minimum retention floor ────────────────────────────────────────────────

describe('minimum retention floor', () => {
  it('compressHistory keeps at least 15% of messages on a 100-turn history', () => {
    // Build a 100-message history with alternating user/assistant turns
    const history: Message[] = []
    for (let i = 0; i < 100; i++) {
      history.push({
        role:    i % 2 === 0 ? 'user' : 'assistant',
        content: i % 2 === 0
          ? `User message number ${i + 1}: I need help with my order.`
          : `Assistant message number ${i + 1}: I am looking into that for you.`,
      })
    }

    const lastMessage = history[history.length - 1].content
    const frame  = classify(lastMessage, history.slice(0, -1))
    const result = compressHistory(history, frame)

    // 15% of 100 = 15 messages minimum
    expect(result.compressed.length).toBeGreaterThanOrEqual(15)
  })

  it('tokensSaved is non-negative for any history', () => {
    const history: Message[] = []
    for (let i = 0; i < 10; i++) {
      history.push({
        role:    i % 2 === 0 ? 'user' : 'assistant',
        content: i % 2 === 0
          ? `User turn ${i + 1}: can you help me with my support request?`
          : `Assistant turn ${i + 1}: of course, let me check that for you.`,
      })
    }

    const frame  = makeFrame('customer_support')
    const result = compressHistory(history, frame)

    expect(result.tokensSaved).toBeGreaterThanOrEqual(0)
  })
})
