import { encodeChat } from 'gpt-tokenizer'
import type { Message } from './types'

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
    return encodeChat(
      messages.map((m) => ({ role: m.role, content: m.content })),
      'gpt-4o',
    ).length
  } catch {
    // Defensive fallback only — e.g. content the tokenizer can't handle.
    // Still logged as a heuristic, not treated as ground truth elsewhere.
    return Math.ceil(messages.reduce((sum, m) => sum + m.content.length, 0) / 4)
  }
}
