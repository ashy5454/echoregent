import { encodeChat } from 'gpt-tokenizer'
import type { Message } from './types'
const messageCounts = new Map<string, number>()
const COUNT_CACHE_LIMIT = 2048

/**
 * Real BPE token count for a chat message array (OpenAI cl100k/o200k-style
 * encoding, including the per-message role/formatting overhead OpenAI
 * actually bills for) — replaces the chars/4 heuristic that used to back
 * every tokensSaved/compression-pct number this product surfaces.
 *
 * Not a substitute for the provider's own `usage` field on a real response
 * (that's still the authoritative number for what was actually billed) —
 * this is for estimating tokens on content that hasn't been sent to a
 * provider yet, e.g. comparing original vs. compressed history size.
 */
export function countChatTokens(messages: Message[]): number {
  if (messages.length === 0) return 0
  try {
    // Chat messages are independently encoded, followed by the three-token
    // assistant prefix. Text keys and counts are bounded to 2,048 entries;
    // token arrays are not retained.
    let total = 3
    for (const message of messages) {
      const key = `${message.role}\0${message.content}`
      let count = messageCounts.get(key)
      if (count === undefined) {
        count = encodeChat([{ role: message.role, content: message.content }], 'gpt-4o').length - 3
        messageCounts.set(key, count)
        if (messageCounts.size > COUNT_CACHE_LIMIT) messageCounts.delete(messageCounts.keys().next().value!)
      }
      total += count
    }
    return total
  } catch {
    // Defensive fallback only — e.g. content the tokenizer can't handle.
    // Still logged as a heuristic, not treated as ground truth elsewhere.
    return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
  }
}
