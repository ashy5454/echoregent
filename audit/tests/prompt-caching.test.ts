// AUDIT — Issue #8: "Rewriting history every turn defeats provider prompt caching"
//
// Provider prompt caching (OpenAI, Anthropic, Gemini) works by hashing a REQUEST
// PREFIX: if the first N tokens of this request are byte-identical to the first N
// tokens of a previous request, the provider serves the cached prefix at a steep
// discount (OpenAI: automatic on >=1024-token prefixes; Anthropic: explicit
// cache_control breakpoints). Both require the prefix to be unchanged turn-to-turn.
//
// ORIGINAL BUG: compressHistory()'s first output message was a synthesized "CTS
// summary: ..." rebuilt from the FULL history on every single call, which baked
// the CURRENT user message into `task`/`userGoal`. Since the current message is
// different every turn by definition, the summary at position 0 of what gets sent
// to the LLM was rewritten every turn — no stable prefix, ever, for any provider
// to cache against.
//
// FIX (this file's tests now verify the fix, not just the bug): getStableSummaryMessage()
// in compressor.ts builds the summary from a "settled" slice of history — everything
// except the most-recent turns, which change every call by design — and only
// regenerates it once that settled slice crosses a batch boundary (4 messages by
// default), caching and reusing the exact same text in between. That gives a
// genuinely stable, cacheable prefix across most turns, at the cost of an honest
// limitation: the summary still changes once whenever a batch boundary is crossed.
// That's a real, bounded cost — nowhere near "different on literally every turn."

import { describe, it, expect } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

function codingFrame(): RoutingFrame {
  return {
    intent: 'debugging', state: 'deepening', domain: 'coding', risk: [],
    signals: { keywords: [], structures: ['error_signal'], urgency: 'low', affect: 'neutral' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
  }
}

const baseHistory: Message[] = [
  { role: 'user', content: 'I am getting a 500 error from my Express API on POST /orders.' },
  { role: 'assistant', content: 'Can you share the stack trace?' },
  { role: 'user', content: 'TypeError: Cannot read properties of undefined (reading "id") at orderController.js:42' },
  { role: 'assistant', content: 'That looks like req.body.user is undefined — check your auth middleware order.' },
  { role: 'user', content: 'I moved the middleware earlier but still get the same error.' },
  { role: 'assistant', content: 'Can you show the updated middleware order?' },
  { role: 'user', content: 'Sure: [cors(), auth(), json(), routes]. Still 500 on /orders.' },
  { role: 'assistant', content: 'Try moving auth() before cors() and log req.body right inside the handler.' },
]

describe('Issue #8 (fixed) — the compressed history now has a stable, cacheable prefix across most turns', () => {
  it('FIXED: message[0] stays byte-identical across turns that fall in the same settled-history batch', () => {
    // turnA: base (8 msgs) + 1 new user turn = 9 messages total.
    const turnA = compressHistory(
      [...baseHistory, { role: 'user', content: 'Logged it — req.body is an empty object even though Postman shows a JSON body.' }],
      codingFrame(),
    )
    // turnB: two more turns on top of turnA (11 messages total) — a real turn or
    // two further into the same conversation, not a hand-picked coincidence.
    const turnB = compressHistory(
      [...baseHistory,
        { role: 'user', content: 'Logged it — req.body is an empty object even though Postman shows a JSON body.' },
        { role: 'assistant', content: 'Check that express.json() runs before your route handler, not after.' },
        { role: 'user', content: 'That was it, json() was registered after the routes. Fixed now.' },
      ],
      codingFrame(),
    )

    expect(turnA.compressed[0]?.content).toEqual(turnB.compressed[0]?.content)
  })

  it('honest limitation: the summary DOES still change once a batch boundary is crossed — this is expected, not a regression', () => {
    const turnA = compressHistory(
      [...baseHistory, { role: 'user', content: 'Logged it — req.body is an empty object even though Postman shows a JSON body.' }],
      codingFrame(),
    )
    // Enough additional turns to push the settled-history snapshot past the next
    // batch boundary — a real conversation eventually does this too; the point
    // is it happens occasionally, not every single turn like the original bug.
    const turnFarLater = compressHistory(
      [...baseHistory,
        { role: 'user', content: 'Logged it — req.body is an empty object even though Postman shows a JSON body.' },
        { role: 'assistant', content: 'Check that express.json() runs before your route handler, not after.' },
        { role: 'user', content: 'That was it, json() was registered after the routes. Fixed now.' },
        { role: 'assistant', content: 'Glad that resolved it. Anything else on this endpoint?' },
        { role: 'user', content: 'Yes — now I need to add rate limiting to the same /orders route.' },
      ],
      codingFrame(),
    )

    // This is EXPECTED to differ — documented here so nobody mistakes "changes
    // sometimes" for a regression of the fix above.
    expect(turnA.compressed[0]?.content).not.toEqual(turnFarLater.compressed[0]?.content)
  })
})
