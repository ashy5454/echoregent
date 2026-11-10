// Token-efficiency contract for compressHistory().
//
// The product promise is aggressive compression WITHOUT information loss.
// These tests pin the two halves of that promise:
//   1. token savings (>= 50% aggregate on the standard routing fixtures)
//   2. retention of hard facts, the current turn, and protected zones
//
// Fixtures intentionally match src/evals/tokenEval.ts so the eval script and
// the suite can never silently disagree.

import { describe, it, expect } from 'vitest'
import { classify } from '../../src/cts-core/classifier'
import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

const smallTalk: Message[] = [
  { role: 'user', content: 'hey' },
  { role: 'assistant', content: 'Hey, what are you working on?' },
  { role: 'user', content: 'random thought, I might build something later' },
  { role: 'assistant', content: 'Sounds good.' },
]

type Fixture = { name: string; message: string; history: Message[]; protected?: boolean; frame?: RoutingFrame }

const fixtures: Fixture[] = [
  {
    name: 'coding-debugging',
    message: 'This webhook throws a 401 on every third request. Why is it failing?',
    history: [
      ...smallTalk,
      { role: 'user', content: 'Help me build an auth system with JWT refresh tokens.' },
      { role: 'assistant', content: 'Use access tokens, refresh tokens, and server-side revocation.' },
      { role: 'user', content: 'Here is the error: 401 Unauthorized from /api/webhook/callback.' },
      { role: 'assistant', content: 'Check the signature validation and token expiry.' },
      { role: 'user', content: 'I tried rotating the signing secret but it still fails.' },
    ],
  },
  {
    name: 'customer-support-escalation',
    message: "My order still hasn't arrived after 2 weeks. I want a refund now.",
    history: [
      ...smallTalk,
      { role: 'user', content: "My order hasn't arrived." },
      { role: 'assistant', content: 'I can help check the status.' },
      { role: 'user', content: 'Tracking has not moved for days.' },
      { role: 'assistant', content: 'The carrier may be delayed.' },
      { role: 'user', content: 'This is getting urgent because it was a gift.' },
    ],
  },
  {
    name: 'sales-objection',
    message: "I'm not sure yet. Your pricing seems higher than the competitor.",
    history: [
      ...smallTalk,
      { role: 'user', content: 'Tell me about your product for support teams.' },
      { role: 'assistant', content: 'It routes tickets and summarizes customer history.' },
      { role: 'user', content: 'How does it compare to Zendesk?' },
      { role: 'assistant', content: 'It is lighter and more AI-native, but Zendesk has more enterprise workflows.' },
    ],
  },
  {
    name: 'medical-decision',
    message: 'I have had a headache and fever for 3 days. Should I see a doctor?',
    history: [
      ...smallTalk,
      { role: 'user', content: 'I started Lisinopril two weeks ago for blood pressure.' },
      { role: 'assistant', content: 'How are you feeling on it so far?' },
      { role: 'user', content: 'I have a persistent cough and my blood pressure is 140/90.' },
      { role: 'user', content: 'I have had a headache and fever for 3 days. Should I see a doctor?' },
    ],
  },
  {
    name: 'crisis-risk',
    message: 'I do not want to be here anymore.',
    history: [
      ...smallTalk,
      { role: 'user', content: 'I have not been sleeping and everything feels pointless lately.' },
      { role: 'assistant', content: 'I am really glad you told me. How long has this been going on?' },
      { role: 'user', content: 'About two weeks. I keep thinking my family would be better off without me.' },
      { role: 'user', content: 'I do not want to be here anymore. I have been thinking about how I would do it.' },
    ],
    protected: true,
    frame: {
      intent: 'task_execution',
      state: 'escalating',
      domain: 'general',
      risk: ['crisis', 'protected_context'],
      signals: { keywords: ['crisis'], structures: [], urgency: 'high', affect: 'distressed' },
      confidence: { intent: 0.7, state: 0.74, domain: 0.62, risk: 0.88 },
    },
  },
]

function compressFixture(f: Fixture) {
  const frame = f.frame ?? classify(f.message, f.history)
  const full = [...f.history, { role: 'user' as const, content: f.message }]
  return { frame, result: compressHistory(full, frame), full }
}

function compressedText(f: Fixture): string {
  return compressFixture(f).result.compressed.map((m) => m.content).join('\n').toLowerCase()
}

describe('token savings contract', () => {
  it('saves at least 50% of tokens in aggregate across compressible fixtures', () => {
    let original = 0
    let saved = 0
    // Protected crisis cases are intentionally 0% and excluded from the
    // savings target, exactly as the held-out benchmark reports them.
    for (const f of fixtures.filter((x) => !x.protected)) {
      const { result } = compressFixture(f)
      original += result.originalTokens
      saved += result.tokensSaved
    }
    const ratio = saved / original
    expect(ratio).toBeGreaterThanOrEqual(0.5)
  })

  it('saves at least 50% on every compressible fixture', () => {
    for (const f of fixtures.filter((x) => !x.protected)) {
      const { result } = compressFixture(f)
      const savings = result.tokensSaved / result.originalTokens
      expect(savings, `${f.name} saved ${(savings * 100).toFixed(1)}%`).toBeGreaterThanOrEqual(0.5)
    }
  })

  it('never compresses a protected zone', () => {
    for (const f of fixtures.filter((x) => x.protected)) {
      const { result } = compressFixture(f)
      expect(result.compressed).toEqual(result.original)
      expect(result.tokensSaved).toBe(0)
    }
  })

  it('always keeps the current (latest) user message verbatim', () => {
    for (const f of fixtures) {
      const { result } = compressFixture(f)
      const kept = result.compressed.some((m) => m.role === 'user' && m.content === f.message)
      expect(kept, `${f.name} dropped the current turn`).toBe(true)
    }
  })

  it('retains the hard facts the next turn needs', () => {
    // coding: HTTP status + endpoint path
    const coding = compressedText(fixtures[0])
    expect(coding).toContain('401')
    expect(coding).toContain('/api/webhook/callback')

    // sales: the named competitor is the whole point of the objection
    const sales = compressedText(fixtures[2])
    expect(sales).toContain('zendesk')

    // medical: medication and the blood-pressure reading survive compression
    const medical = compressedText(fixtures[3])
    expect(medical).toContain('lisinopril')
    expect(medical).toContain('140/90')
  })

  it('keeps at least 15% of a long conversation', () => {
    const history: Message[] = []
    for (let i = 0; i < 100; i++) {
      history.push(
        i % 2 === 0
          ? { role: 'user', content: `Turn ${i}: the payment retry failed with code ERR-${1000 + i}.` }
          : { role: 'assistant', content: `Check the retry queue and the dead-letter topic for ERR-${1000 + i - 1}.` },
      )
    }
    const frame = classify('Why does the retry queue keep failing?', history)
    const result = compressHistory(history, frame)
    const retained = result.compressed.filter((m) => !m.content.startsWith('CTS')).length
    expect(retained).toBeGreaterThanOrEqual(Math.ceil(history.length * 0.15))
  })
})
