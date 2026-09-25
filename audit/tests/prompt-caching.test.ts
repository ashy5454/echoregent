// AUDIT — Issue #8: "Rewriting history every turn defeats provider prompt caching"
//
// Provider prompt caching (OpenAI, Anthropic, Gemini) works by hashing a REQUEST
// PREFIX: if the first N tokens of this request are byte-identical to the first N
// tokens of a previous request, the provider serves the cached prefix at a steep
// discount (OpenAI: automatic on >=1024-token prefixes; Anthropic: explicit
// cache_control breakpoints). Both require the prefix to be unchanged turn-to-turn.
//
// compressHistory()'s first output message is always a synthesized "CTS summary: ..."
// built from buildMemoryFrame(), which bakes in `task: compactSentence(latestUser, 96)`
// (compressor.ts:162) — i.e. the summary text embeds the CURRENT user message. Since
// the "current" message is different on every turn by definition, the summary message
// — which sits at position 0 of what gets sent to the LLM — is rewritten every turn.
// That destroys the stable prefix caching depends on: nothing after turn 1 can hit a
// provider's prompt cache, no matter how little the underlying conversation actually
// changed.
//
// This test compresses the same conversation at two consecutive turns and shows the
// resulting message-0 text differs even when most of the underlying history is
// unchanged, proving there is no stable cacheable prefix across turns.

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
]

describe('Issue #8 — the compressed history has no stable, cacheable prefix across turns', () => {
  it('FAILS: message[0] of the compressed output changes turn-to-turn even though the underlying conversation barely changed', () => {
    // Both turns are already well past the 4-message threshold and both get
    // summarized — this isolates the effect to the summary content itself, not
    // to whether compression triggered at all.
    const turnN   = compressHistory([...baseHistory, { role: 'user', content: 'Sure: [cors(), auth(), json(), routes]. Still 500 on /orders.' }], codingFrame())
    const turnNp1 = compressHistory([...baseHistory,
      { role: 'user', content: 'Sure: [cors(), auth(), json(), routes]. Still 500 on /orders.' },
      { role: 'assistant', content: 'Try moving auth() before cors() and log req.body right inside the handler.' },
      { role: 'user', content: 'Logged it — req.body is an empty object even though Postman shows a JSON body.' },
    ], codingFrame())

    // A caching-friendly design would keep the head of the request byte-identical
    // across turns (e.g. a stable system/memory block, with only new turns appended
    // at the end). Instead, the summary message at position 0 is regenerated from
    // the CURRENT latest user message every single call.
    const messageZeroTurnN   = turnN.compressed[0]?.content
    const messageZeroTurnNp1 = turnNp1.compressed[0]?.content

    expect(messageZeroTurnN).toEqual(messageZeroTurnNp1)
  })
})
