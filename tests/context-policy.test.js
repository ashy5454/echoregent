import { describe, expect, it } from 'vitest'
import {
  buildContextPlan,
  classify,
  compressHistory,
  createEmptyLLMWiki,
  correctMemoryFact,
  evaluateContextQuality,
  forgetMemoryFact,
  ingestSourceIntoLLMWiki,
  isCacheable,
  recallMemoryFacts,
  purgeExpiredMemory,
  redactSensitiveData,
} from '../src/cts-core/index.ts'

describe('protected context policy', () => {
  it('keeps medical history verbatim and disables caching/memory writes', () => {
    const history = Array.from({ length: 6 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' : 'assistant',
      content: `Medical turn ${index}: blood pressure and medication details.`,
    }))
    const frame = classify('Should I stop this medication?', history)
    const plan = buildContextPlan({ frame, history })
    const result = compressHistory(history, frame)

    expect(plan.strategy).toBe('verbatim')
    expect(plan.policy.compression).toBe('block')
    expect(plan.policy.responseCache).toBe('block')
    expect(plan.policy.memoryWrite).toBe('block')
    expect(result.compressed).toEqual(history)
    expect(result.tokensSaved).toBe(0)
    expect(isCacheable('medical', frame.risk)).toBe(false)
  })
})

describe('context quality evaluation', () => {
  it('flags a missing explicitly required fact', () => {
    const original = [{ role: 'user', content: 'Order ORD-1234 has a refund deadline on 2026-08-01.' }]
    const frame = classify(original[0].content)
    const report = evaluateContextQuality({
      original,
      frame,
      requiredFacts: ['ORD-1234', '2026-08-01'],
      compression: {
        original,
        compressed: [{ role: 'assistant', content: 'The customer needs support.' }],
        keptReasons: [],
        droppedCount: 1,
        originalTokens: 12,
        compressedTokens: 6,
        tokensSaved: 6,
      },
    })
    expect(report.passed).toBe(false)
    expect(report.missingFacts).toEqual(expect.arrayContaining(['ORD-1234', '2026-08-01']))
  })
})

describe('automatic-memory privacy', () => {
  it('redacts direct identifiers and secrets but retains support IDs', () => {
    const result = redactSensitiveData('Email sam@example.com. Card 4111 1111 1111 1111. Order ORD-1234. Key sk-abcdefghijklmnopqrstuvwxyz123456.')
    expect(result.value).toContain('[REDACTED_EMAIL]')
    expect(result.value).toContain('[REDACTED_PAYMENT_CARD]')
    expect(result.value).toContain('[REDACTED_SECRET]')
    expect(result.value).toContain('ORD-1234')
  })
})

describe('source-cited temporal facts', () => {
  it('retrieves current facts and preserves a correction history', async () => {
    let wiki = createEmptyLLMWiki()
    wiki = await ingestSourceIntoLLMWiki(
      wiki,
      { title: 'Support case', content: 'Order ORD-1234 is scheduled for delivery on 2026-08-01. The customer requested express shipping.' },
      classify('Track order ORD-1234'),
    )

    const initial = recallMemoryFacts(wiki, 'Where is order ORD-1234?')
    expect(initial.length).toBeGreaterThan(0)
    expect(initial[0].sourceIds.length).toBeGreaterThan(0)

    const corrected = correctMemoryFact(wiki, initial[0].id, 'Order ORD-1234 was delivered on 2026-08-02.')
    expect(corrected.status).toBe('current')
    expect(wiki.facts.find((fact) => fact.id === initial[0].id)?.status).toBe('superseded')
    expect(forgetMemoryFact(wiki, corrected.id)).toBe(true)
    expect(recallMemoryFacts(wiki, 'ORD-1234')).not.toContainEqual(expect.objectContaining({ id: corrected.id }))
  })

  it('permanently purges expired sources, pages, and facts', async () => {
    let wiki = createEmptyLLMWiki()
    wiki = await ingestSourceIntoLLMWiki(
      wiki,
      { title: 'Temporary note', content: 'Ticket CST-5555 is open.' },
      classify('Ticket CST-5555'),
      undefined,
      { retentionDays: 1 },
    )
    const removed = purgeExpiredMemory(wiki, new Date('2100-01-01T00:00:00.000Z'))
    expect(removed.sources).toBeGreaterThan(0)
    expect(removed.facts).toBeGreaterThan(0)
    expect(wiki.sources).toHaveLength(0)
  })
})
