// AUDIT — Issue #11: "GENERIC_DISTRACTOR_PATTERNS drops real content"
//
// src/cts-core/compressor.ts:5-20 defines GENERIC_DISTRACTOR_PATTERNS as a fixed list of
// whole-word regexes (dark mode, light mode, Marvel, movie, weather, Tokyo, cat, lunch,
// space travel, favorite color, standing desk, fitness routine, sushi, burger). Any
// message matching one of these, in ANY domain, is:
//   - penalized in messageRelevanceScore() during sync compressHistory() (compressor.ts:283-285), and
//   - filtered OUT ENTIRELY before being sent to T5 in compressHistoryAsync()
//     (compressor.ts:608-611: `filtered = history.filter(msg => !GENERIC_DISTRACTOR_PATTERNS.some(...))`)
//
// These words are treated as small-talk distractors unconditionally, with no check for
// whether they are the actual substance of the turn. A customer-support message about a
// damaged product that happens to mention "lunch" (an appointment window), or a coding
// question about a bug that reproduces only "in Tokyo" (a timezone/locale bug), or a
// medical question mentioning a "cat" (allergen exposure) all get flagged as noise.
//
// This test shows a real, on-topic customer-support message that contains one of the
// literal distractor words being filtered out of the T5 input entirely in
// compressHistoryAsync(), and shows the same message scoring as if it were noise in the
// sync path's relevance scorer.

import { describe, it, expect } from 'vitest'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// messageRelevanceScore / genericDistractorPenalty are not exported — re-derive the
// filter predicate exactly as compressHistoryAsync uses it (compressor.ts:608-611) to
// prove which real messages get dropped before ever reaching T5.
const GENERIC_DISTRACTOR_PATTERNS = [
  /\bdark mode\b/i, /\blight mode\b/i, /\bMarvel\b/i, /\bmovie\b/i, /\bweather\b/i,
  /\bTokyo\b/i, /\bcat\b/i, /\blunch\b/i, /\bspace travel\b/i, /\bfavorite color\b/i,
  /\bstanding desk\b/i, /\bfitness routine\b/i, /\bsushi\b/i, /\bburger\b/i,
]

function supportFrame(): RoutingFrame {
  return {
    intent: 'escalation', state: 'escalating', domain: 'customer_support', risk: [],
    signals: { keywords: [], structures: [], urgency: 'high', affect: 'frustrated' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
  }
}

describe('Issue #11 — GENERIC_DISTRACTOR_PATTERNS matches real, on-topic content', () => {
  it('flags a genuine delivery-window message ("I am only home during lunch") as a distractor', () => {
    const onTopicMessage = 'The courier keeps missing me — I am only home during lunch, can you schedule redelivery then?'
    const isFlaggedAsDistractor = GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(onTopicMessage))
    // This is real, actionable delivery-scheduling content for a customer_support
    // conversation, not small talk — yet it matches the distractor list and would be
    // stripped out of the T5 input in compressHistoryAsync() before ever being summarized.
    expect(isFlaggedAsDistractor).toBe(false)
  })

  it('flags a genuine bug-report detail ("only reproduces for users in Tokyo") as a distractor', () => {
    const onTopicMessage = 'This only reproduces for users in Tokyo — looks like a timezone parsing bug.'
    const isFlaggedAsDistractor = GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(onTopicMessage))
    expect(isFlaggedAsDistractor).toBe(false)
  })

  it('flags a genuine medical detail ("allergic to cat dander") as a distractor', () => {
    const onTopicMessage = 'I am allergic to cat dander and my symptoms started after visiting a friend with cats.'
    const isFlaggedAsDistractor = GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(onTopicMessage))
    expect(isFlaggedAsDistractor).toBe(false)
  })

  it('demonstrates compressHistoryAsync would filter all three real messages out of the T5 input', async () => {
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
