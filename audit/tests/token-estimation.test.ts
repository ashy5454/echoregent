// AUDIT — Issue #9 (fixed): "Token counts use chars/4, not provider-reported usage"
//
// ORIGINAL BUG — src/cts-core/compressor.ts:476-479:
//   function estimateTokens(messages: Message[]): number {
//     const chars = messages.reduce((sum, message) => sum + message.content.length, 0)
//     return Math.ceil(chars / 4)
//   }
// Every "tokensSaved"/"tokenSavingsPct" figure this product surfaces was derived from
// this chars/4 heuristic, never from a real tokenizer or the provider's usage field.
//
// FIX — estimateTokens() now delegates to countChatTokens() (src/cts-core/tokenizer.ts),
// which uses gpt-tokenizer's real BPE encoding (encodeChat, matching OpenAI's actual
// chat-format token counting including per-message overhead) instead of chars/4.
//
// This test verifies the fix directly: compressHistory()'s reported originalTokens for
// a JSON/code-heavy payload (exactly the content chars/4 was worst at) now matches real
// tokenization exactly, not a chars/4 approximation of it.
//
// Note: compressHistory()'s own compression-ratio thresholds are still a heuristic
// (this fix makes the REPORTED numbers accurate, it doesn't claim the compression
// decision logic itself is now perfectly tuned — that's issue #3's overfitting problem,
// tracked separately in audit/tests/overfit-demo-entities.test.ts).

import { describe, it, expect } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
import { countChatTokens } from '../../src/cts-core/tokenizer'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

function codingFrame(): RoutingFrame {
  return {
    intent: 'debugging',
    state: 'deepening',
    domain: 'coding',
    risk: [],
    signals: { keywords: [], structures: ['code_block'], urgency: 'low', affect: 'neutral' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
  }
}

const jsonBlob = JSON.stringify({
  error: 'TypeError', code: 500, path: '/api/v1/users/12345/orders',
  headers: { 'content-type': 'application/json', 'x-request-id': 'abc-123-def-456' },
  stack: ['at handler (index.js:42:10)', 'at Layer.handle (router.js:95:5)'],
})

const history: Message[] = [
  { role: 'user', content: 'Here is the failing response body, can you tell me what is wrong?' },
  { role: 'assistant', content: 'Sure, paste the JSON and I will take a look.' },
  { role: 'user', content: jsonBlob },
  { role: 'assistant', content: 'This looks like a routing issue in your Express app.' },
  { role: 'user', content: 'How do I fix the 500 on that endpoint?' },
]

describe('Issue #9 (fixed) — token counts now come from a real tokenizer, not chars/4', () => {
  it('compressHistory().originalTokens matches real BPE tokenization exactly for a JSON/code payload', () => {
    const result = compressHistory(history, codingFrame())
    const realTokenCount = countChatTokens(history)

    expect(result.originalTokens).toBe(realTokenCount)
  })

  it('no longer matches the old chars/4 heuristic (proves the swap actually happened, not just a coincidental match)', () => {
    const result = compressHistory(history, codingFrame())
    const totalChars = history.reduce((sum, m) => sum + m.content.length, 0)
    const oldCharsBasedEstimate = Math.ceil(totalChars / 4)

    expect(result.originalTokens).not.toBe(oldCharsBasedEstimate)
  })
})
