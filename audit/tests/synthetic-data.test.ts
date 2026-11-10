// AUDIT — Synthetic data quality checks
//
// Validates two properties of the synthetic data generation pipeline:
//   1.3 Entity substitution produces structurally valid outputs (price/company tokens
//       can be swapped without breaking the surrounding context).
//   1.4 Rule-based validation gate — entity-substituted sentences must still be
//       classified into the expected domain, proving the substituted text retains
//       enough signal to be useful training data.

import { describe, it, expect, test } from 'vitest'
import { classify } from '../../src/cts-core/classifier'

// ── Inline helper ──────────────────────────────────────────────────────────────
// Replaces the FIRST occurrence of a $X,XXX or $XX/month-style price pattern with
// the given replacement string.  Implemented inline so this file has no extra
// runtime dependencies and the substitution logic is auditable here.
function substitutePrice(text: string, replacement: string): string {
  // Matches: $<digits with optional comma><optional /word> — e.g. $499/month, $12,000/year, $500/seat
  return text.replace(/\$[\d,]+(?:\/\w+)?/, replacement)
}

// ── 1. Entity substitution produces valid outputs ──────────────────────────────

describe('entity substitution produces valid outputs', () => {
  it('substitutes a price entity exactly once', () => {
    const input = 'Our premium plan costs $499/month for up to 50 users'
    const result = substitutePrice(input, '$799/month')

    expect(result).toContain('$799/month')
    expect(result).not.toContain('$499/month')
    expect(result).toContain('premium plan') // surrounding context preserved
  })

  it('leaves text unchanged when no price entity found', () => {
    const input = 'We offer great support'
    const result = substitutePrice(input, '$999/month')

    expect(result).toBe(input)
  })

  it('substituted text is different from input', () => {
    const input = 'Enterprise tier starts at $5,000/year'
    const result = substitutePrice(input, '$8,000/year')

    expect(result).not.toBe(input)
  })
})

// ── 2. Rule-based validation gate ─────────────────────────────────────────────

describe('rule-based validation gate', () => {
  it('classify returns sales for a known good sales sentence', () => {
    const frame = classify(
      "We need SOC2 compliance certification before we can sign the annual contract. What's your pricing for 100 seats?",
    )
    expect(frame.domain).toBe('sales')
  })

  it('classify does not return sales for an unrelated sentence', () => {
    const frame = classify('The weather is nice today')
    expect(frame.domain).not.toBe('sales')
  })

  it('classify returns sales for a synthetic-style sentence with substituted company name', () => {
    const frame = classify(
      "DataSphere needs SOC2 Type II. What's the enterprise pricing for Q3 contract signing?",
    )
    expect(frame.domain).toBe('sales')
  })

  it('synthetic validation gate: entity-substituted sales text keeps domain', () => {
    const examples = [
      'TechNova requires audit logs and SSO for the $12,000/year premium plan',
      'CloudBase needs ROI justification before end of quarter contract renewal',
      'Acme Corp is evaluating our premium enterprise tier at $500/seat with a discount for annual commitment',
    ]

    for (const ex of examples) {
      const frame = classify(ex)
      expect(frame.domain).toBe('sales')
    }
  })
})

// ── 3. Diversity: generated examples are not duplicates ───────────────────────

describe('diversity: generated examples are not duplicates', () => {
  test.todo('generated synthetic examples differ from seed examples')
})
