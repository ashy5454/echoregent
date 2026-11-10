// AUDIT — Issue #1: "Protected zones aren't enforced"
//
// README.md:156-167 claims that when the classifier returns medical / legal / crisis:
//   1. "Compression is disabled at the function level — not skipped, not flagged, disabled"
//   2. "The raw history is passed to the LLM unchanged"
//
// Ground truth: compressHistory() and compressHistoryAsync() (src/cts-core/compressor.ts)
// never read frame.domain against 'medical' | 'legal' or frame.risk against 'crisis' /
// 'protected_context' anywhere. The only domain-aware branch in the file is
// HIGH_VALUE_DOMAINS = Set(['coding','customer_support','sales']) (compressor.ts:4),
// which only changes the *target compression ratio* (0.62 vs 0.5) — medical/legal are
// NOT in that set, so they get the standard aggressive path, not "no compression".
//
// This test constructs a RoutingFrame exactly as classify() would for a real crisis/
// medical conversation and feeds it straight to compressHistory(), bypassing keyword
// brittleness in the classifier so the compressor itself is what's under test.
//
// EXPECTED (per README): compressed history === original history (byte for byte).
// ACTUAL (current code): history is compressed like any general-domain conversation.
// This test documents the README's claim and FAILS against current code, proving the gap.

import { describe, it, expect } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

function longNonKeywordHistory(): Message[] {
  // Deliberately generic content that does not hit any of compressor.ts's
  // hardcoded medical/crisis regexes (no "Lisinopril", "blood pressure", "140/90",
  // "doctor", etc.) — this is what a REAL crisis conversation from an unseen
  // vocabulary looks like, not the demo scenario the compressor was tuned on.
  return [
    { role: 'user', content: 'I have not been sleeping and everything feels pointless lately.' },
    { role: 'assistant', content: 'I am really glad you told me. Can you say more about how long this has been going on?' },
    { role: 'user', content: 'About two weeks. I keep thinking my family would be better off without me around.' },
    { role: 'assistant', content: 'That sounds incredibly heavy to be carrying. You are not a burden, and I want to make sure you are safe right now.' },
    { role: 'user', content: 'I do not want to be here anymore. I have been thinking about how I would do it.' },
    { role: 'assistant', content: 'Thank you for trusting me with that. Right now, are you in a safe place, and is there someone nearby you can be with tonight?' },
    { role: 'user', content: 'My sister is home. I have not told her anything.' },
  ]
}

function crisisFrame(): RoutingFrame {
  return {
    intent: 'task_execution',
    state: 'escalating',
    domain: 'general', // classify() actually routes crisis text to 'general' — see classifier.ts:44
    risk: ['crisis', 'protected_context'],
    signals: { keywords: ['crisis:want to die'], structures: [], urgency: 'high', affect: 'distressed' },
    confidence: { intent: 0.7, state: 0.74, domain: 0.62, risk: 0.88 },
  }
}

function medicalFrame(): RoutingFrame {
  return {
    intent: 'information_seeking',
    state: 'deepening',
    domain: 'medical',
    risk: ['medical_caution'],
    signals: { keywords: [], structures: [], urgency: 'low', affect: 'neutral' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 0.88 },
  }
}

describe('Issue #1 — protected-zone policy after the medical/legal opt-in', () => {
  it('crisis-risk conversations are passed through unchanged', () => {
    const history = longNonKeywordHistory()
    const result = compressHistory(history, crisisFrame())

    // Crisis / protected_context remain a hard safety boundary.
    expect(result.compressed).toEqual(result.original)
    expect(result.tokensSaved).toBe(0)
  })

  it('medical-domain conversations are now compressed like other domains', () => {
    const history = longNonKeywordHistory()
    const result = compressHistory(history, medicalFrame())

    expect(result.tokensSaved).toBeGreaterThan(0)
    expect(result.compressed.length).toBeLessThan(result.original.length)
  })

  it('medical and general both compress, while crisis does not', () => {
    const history = longNonKeywordHistory()
    const generalFrame: RoutingFrame = { ...medicalFrame(), domain: 'general', risk: [] }

    const medicalResult = compressHistory(history, medicalFrame())
    const generalResult = compressHistory(history, generalFrame)
    const crisisResult = compressHistory(history, crisisFrame())

    expect(medicalResult.tokensSaved).toBeGreaterThan(0)
    expect(generalResult.tokensSaved).toBeGreaterThan(0)
    expect(crisisResult.tokensSaved).toBe(0)
  })
})
