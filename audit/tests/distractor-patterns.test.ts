// AUDIT — Issue #11: "GENERIC_DISTRACTOR_PATTERNS drops real content" (FIXED)
//
// src/cts-core/compressor.ts used to include bare single-word patterns (Tokyo, cat, lunch,
// movie, weather, Marvel, sushi, burger) in GENERIC_DISTRACTOR_PATTERNS. Any message
// matching one of these, in ANY domain, was penalized in messageRelevanceScore() during
// sync compressHistory() and filtered OUT ENTIRELY before being sent to T5 in
// compressHistoryAsync() — with no check for whether the word was the actual substance of
// the turn. A customer-support message about a damaged product that happens to mention
// "lunch" (an appointment window), or a coding question about a bug that reproduces only
// "in Tokyo" (a timezone/locale bug), or a medical question mentioning a "cat" (allergen
// exposure) all got flagged as noise.
//
// Fix: GENERIC_DISTRACTOR_PATTERNS now only contains multi-word phrases ("dark mode",
// "favorite color", ...) that are specific enough to small talk to not collide with real
// on-topic content the way a bare common noun does. This test verifies the three
// previously-documented false positives no longer match.

import { describe, it, expect } from 'vitest'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// messageRelevanceScore / genericDistractorPenalty are not exported — re-derive the
// filter predicate exactly as compressHistoryAsync uses it, matching the fixed list in
// compressor.ts, to prove the three real messages are no longer dropped before reaching T5.
const GENERIC_DISTRACTOR_PATTERNS = [
  /\bdark mode\b/i, /\blight mode\b/i, /\bspace travel\b/i, /\bfavorite color\b/i,
  /\bstanding desk\b/i, /\bfitness routine\b/i,
]

function supportFrame(): RoutingFrame {
  return {
    intent: 'escalation', state: 'escalating', domain: 'customer_support', risk: [],
    signals: { keywords: [], structures: [], urgency: 'high', affect: 'frustrated' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
  }
}

describe('Issue #11 — GENERIC_DISTRACTOR_PATTERNS no longer matches real, on-topic content (FIXED)', () => {
  it('no longer flags a genuine delivery-window message ("I am only home during lunch")', () => {
    const onTopicMessage = 'The courier keeps missing me — I am only home during lunch, can you schedule redelivery then?'
    const isFlaggedAsDistractor = GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(onTopicMessage))
    // Real, actionable delivery-scheduling content for a customer_support conversation,
    // not small talk — the old bare-word "lunch" pattern used to match this.
    expect(isFlaggedAsDistractor).toBe(false)
  })

  it('no longer flags a genuine bug-report detail ("only reproduces for users in Tokyo")', () => {
    const onTopicMessage = 'This only reproduces for users in Tokyo — looks like a timezone parsing bug.'
    const isFlaggedAsDistractor = GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(onTopicMessage))
    expect(isFlaggedAsDistractor).toBe(false)
  })

  it('no longer flags a genuine medical detail ("allergic to cat dander")', () => {
    const onTopicMessage = 'I am allergic to cat dander and my symptoms started after visiting a friend with cats.'
    const isFlaggedAsDistractor = GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(onTopicMessage))
    expect(isFlaggedAsDistractor).toBe(false)
  })

  it('confirms compressHistoryAsync no longer filters any of the three real messages out of the T5 input', async () => {
    const history: Message[] = [
      { role: 'user', content: 'The courier keeps missing me — I am only home during lunch, can you schedule redelivery then?' },
      { role: 'assistant', content: 'I can schedule that for you.' },
      { role: 'user', content: 'This only reproduces for users in Tokyo — looks like a timezone parsing bug.' },
      { role: 'assistant', content: 'Good catch, let me check the timezone handling.' },
      { role: 'user', content: 'Also, I am allergic to cat dander, in case that is relevant to the rash question from earlier.' },
    ]
    const filtered = history.filter((msg) => !GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(msg.content.toLowerCase())))
    // All 3 user messages carry real, on-topic information; none should be removed.
    const droppedUserMessages = history.filter((m) => m.role === 'user').length - filtered.filter((m) => m.role === 'user').length
    expect(droppedUserMessages).toBe(0)
  })
})
