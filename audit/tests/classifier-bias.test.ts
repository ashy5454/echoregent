/**
 * Classifier bias tests — Requirements 2.3, 6.4, 6.5
 *
 * Three concerns addressed here:
 *  1. Per-domain accuracy on the rule-based classifier using canonical scenarios.
 *  2. Overfitting indicator — ambiguous inputs should not default to coding.
 *  3. ML classifier label_map integration — classifyAsync fallback behaviour.
 */
import { describe, it, expect } from 'vitest'
import { classify, classifyAsync } from '../../src/cts-core/classifier'
import { scenarios } from '../../src/scenarios'

// ── 1. Per-domain accuracy on rule-based classifier ───────────────────────────

describe('per-domain accuracy on rule-based classifier', () => {
  /**
   * Maps each canonical scenario ID to the domain it must resolve to.
   * Scenario IDs are defined in src/scenarios.ts.
   */
  const EXPECTED_DOMAIN: Record<string, string> = {
    'coding-debug':    'coding',
    'support-refund':  'customer_support',
    'sales-objection': 'sales',
    'legal-caution':   'legal',
    'medical-decision': 'medical',
  }

  for (const [scenarioId, expectedDomain] of Object.entries(EXPECTED_DOMAIN)) {
    it(`classifies scenario "${scenarioId}" as domain "${expectedDomain}"`, () => {
      const scenario = scenarios.find((s) => s.id === scenarioId)
      expect(scenario, `scenario "${scenarioId}" not found in scenarios.ts`).toBeDefined()

      const frame = classify(scenario!.message, scenario!.history)
      expect(frame.domain).toBe(expectedDomain)
    })
  }
})

// ── 2. Overfitting indicator — ambiguous inputs should not default to coding ──

describe('overfitting indicator — ambiguous inputs should not default to coding', () => {
  it('classifies a generic greeting as general, not coding', () => {
    const frame = classify('Hello, how are you today?')
    expect(frame.domain).not.toBe('coding')
  })

  it('classifies a medical question without drug names as medical', () => {
    const frame = classify(
      'I have been having chest pain and shortness of breath for two days. Should I see a doctor?',
    )
    expect(frame.domain).toBe('medical')
  })

  it('classifies a legal question as legal', () => {
    const frame = classify(
      "My employer is threatening to fire me if I don't sign a non-compete clause. What are my options under California law?",
    )
    expect(frame.domain).toBe('legal')
  })

  it('classifies a sales question as sales', () => {
    const frame = classify(
      "We need SOC2 Type II compliance. What's the annual pricing for 50 seats?",
    )
    expect(frame.domain).toBe('sales')
  })

  it('classifies an education question as education', () => {
    const frame = classify(
      'Can you explain how binary search works and give me a quiz question about it?',
    )
    expect(frame.domain).toBe('education')
  })
})

// ── 3. ML classifier label_map integration ───────────────────────────────────

describe('ML classifier label_map integration', () => {
  it('classifyAsync resolves without throwing when ml model is absent', async () => {
    const frame = await classifyAsync('test message')
    // Must resolve to a valid RoutingFrame with a non-null domain string,
    // falling back to rule-based domain detection when the ML model is unavailable.
    expect(frame).toBeDefined()
    expect(typeof frame.domain).toBe('string')
    expect(frame.domain).not.toBeNull()
    expect(frame.domain.length).toBeGreaterThan(0)
  })

  it('classifyAsync result has all required RoutingFrame fields', async () => {
    const frame = await classifyAsync('I need help debugging a TypeScript error')
    // Every field of RoutingFrame must be present and non-null.
    expect(frame.intent).toBeDefined()
    expect(frame.intent).not.toBeNull()

    expect(frame.state).toBeDefined()
    expect(frame.state).not.toBeNull()

    expect(frame.domain).toBeDefined()
    expect(frame.domain).not.toBeNull()

    expect(frame.risk).toBeDefined()
    expect(frame.risk).not.toBeNull()
    expect(Array.isArray(frame.risk)).toBe(true)

    expect(frame.signals).toBeDefined()
    expect(frame.signals).not.toBeNull()

    expect(frame.confidence).toBeDefined()
    expect(frame.confidence).not.toBeNull()
    expect(typeof frame.confidence.intent).toBe('number')
    expect(typeof frame.confidence.state).toBe('number')
    expect(typeof frame.confidence.domain).toBe('number')
    expect(typeof frame.confidence.risk).toBe('number')
  })
})
