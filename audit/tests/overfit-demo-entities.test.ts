// AUDIT — Issue #3: "Fact extraction and domain rules are overfit to demo scenarios"
//
// src/cts-core/compressor.ts hardcodes literal demo entities into its regexes:
//   - "Maya", "Sarah"                          (general domain)          compressor.ts:389, 439, 468
//   - "Lisinopril", "140/90", "blood pressure"  (medical domain)          compressor.ts:358, 383, 432, 465
//   - "ThinkPad T14", "MacBook Air M3"          (commerce domain)         compressor.ts:360, 385, 435, 466
//   - "Calvin cycle"                            (education domain)       compressor.ts:362, 387, 437, 467
//   - "Dallas"                                  (customer_support domain) compressor.ts:377
//
// These are not generic patterns (e.g. "any drug name", "any city"); they are the exact
// strings used in the project's own demo/eval fixtures (see src/evals/sessionMemoryEval.ts,
// which reuses the identical vocabulary). A fact that means the same thing but uses different
// words is invisible to factImportance()/extractFacts(), so it gets a score of 0 and is the
// first thing dropped under compression — even though it is exactly as important as the
// hardcoded example.
//
// This test compresses two structurally identical conversations that only differ in which
// city / drug name is mentioned. One uses the hardcoded demo vocabulary; the other uses an
// equally important but unseen synonym. If the compressor generalizes, both facts should
// survive compression equally. If it's overfit, only the demo-vocabulary fact survives.

import { describe, it, expect } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

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

function historyWithCity(city: string): Message[] {
  return [
    { role: 'user', content: `My tracking says the order arrived, but I never got the package here in ${city}.` },
    { role: 'assistant', content: 'I am sorry to hear that. Let me look into the shipping status for you.' },
    { role: 'user', content: 'It still has not shown up and the tracking page has not updated in days.' },
    { role: 'assistant', content: 'That does sound frustrating. I will escalate this to our logistics team right away.' },
    { role: 'user', content: 'I need this resolved because I am flying out for a work trip on Friday.' },
    { role: 'assistant', content: 'Understood, I will mark this as urgent given your Friday travel date.' },
  ]
}

describe('Issue #3 — hardcoded demo entities beat equally-important unseen facts', () => {
  it('FAILS to generalize: "Dallas" (in the hardcoded demo list) survives compression while an equally important unseen city does not', () => {
    const demoResult   = compressHistory(historyWithCity('Dallas'), supportFrame())
    const unseenResult = compressHistory(historyWithCity('Portland'), supportFrame())

    const demoText   = demoResult.compressed.map((m) => m.content).join(' ')
    const unseenText = unseenResult.compressed.map((m) => m.content).join(' ')

    const demoKeptCity   = demoText.includes('Dallas')
    const unseenKeptCity = unseenText.includes('Portland')

    // Expected if the compressor generalized: both cities are structurally identical
    // facts (same sentence position, same surrounding domain-relevant wording) and
    // should be treated the same way (both kept, or both dropped).
    expect(demoKeptCity).toBe(unseenKeptCity)
  })

  it('FAILS: memoryFrame.unresolved keeps the hardcoded city ("Dallas") but drops the identical unseen city ("Portland")', () => {
    // inferUnresolved's customer_support branch (compressor.ts:377) hardcodes the
    // literal alternation `Dallas|Chicago` inside `/\brefund|arrived|tracking|Dallas|
    // Chicago|escalated?|process\b/gi`. With every other word in the sentence held
    // constant, only the hardcoded city survives into the MemoryFrame that gets
    // serialized into the [CTS Memory] block the LLM actually sees.
    const demoResult   = compressHistory(historyWithCity('Dallas'), supportFrame())
    const unseenResult = compressHistory(historyWithCity('Portland'), supportFrame())

    const demoKeptCity   = demoResult.memoryFrame?.unresolved.includes('Dallas') ?? false
    const unseenKeptCity = unseenResult.memoryFrame?.unresolved.includes('Portland') ?? false

    expect(demoKeptCity).toBe(unseenKeptCity)
  })
})
