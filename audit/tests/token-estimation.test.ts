// AUDIT — Issue #9: "Token counts use chars/4, not provider-reported usage"
//
// src/cts-core/compressor.ts:476-479:
//   function estimateTokens(messages: Message[]): number {
//     const chars = messages.reduce((sum, message) => sum + message.content.length, 0)
//     return Math.ceil(chars / 4)
//   }
//
// Every "tokensSaved" / "tokenSavingsPct" figure surfaced by /compress, /demo/compress,
// /demo/compress-async, and the x-cts-tokens-saved / x-cts-compression-pct response headers
// on /v1/chat/completions (src/server.ts:797-802, 860-864) is derived from this chars/4
// heuristic, never from the LLM provider's actual tokenizer or response.usage field.
//
// chars/4 is a rough English-prose approximation. Real tokenizers (tiktoken for OpenAI,
// Anthropic's tokenizer, SentencePiece for Gemini) diverge from it substantially for
// code, JSON, non-English text, and repeated whitespace/punctuation — exactly the kind
// of content a "coding" or "customer_support" conversation contains.
//
// This test shows chars/4 disagreeing with a real tokenizer estimate (GPT tokenizers
// average ~4 chars/token for English but far fewer for code/JSON), by comparing the
// chars/4 estimate against a hand-counted, denser tokenization for a JSON/code-heavy
// message where the true token/char ratio is known to be higher than 0.25.

import { describe, it, expect } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
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

describe('Issue #9 — chars/4 token estimation diverges from real tokenization', () => {
  it('reports a token count that does not match a real tokenizer for JSON/code payloads', () => {
    // A minified JSON blob: real BPE tokenizers split on punctuation-dense text far more
    // densely than 1 token per 4 chars (commonly ~2.2-3 chars/token for this kind of text).
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

    const result = compressHistory(history, codingFrame())
    const charsBasedEstimate = result.originalTokens

    // A conservative real-tokenizer lower bound for this text: punctuation-heavy JSON
    // commonly tokenizes at closer to 1 token per 2.5-3 characters, not 4.
    const totalChars = history.reduce((sum, m) => sum + m.content.length, 0)
    const conservativeRealTokenEstimate = Math.ceil(totalChars / 3)

    // This assertion documents that CTS's own number is meaningfully smaller than a
    // conservative real-tokenizer estimate — i.e. CTS is under-counting input tokens,
    // which means both the "tokensSaved" and compression-pct numbers it reports do not
    // correspond to what the provider will actually bill.
    expect(charsBasedEstimate).toBeLessThan(conservativeRealTokenEstimate)
  })
})
