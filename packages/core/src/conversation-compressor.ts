import { smallerText } from './token-count.js'

const DEFAULT_KEEP_RECENT = 6
const MIN_DUPLICATE_LENGTH = 64
const TURN_REF_PREFIX = '[EchoRegent lossless turn-ref v1: exact duplicate of turn #'
const TURN_REF_REGEX = /^\[EchoRegent lossless turn-ref v1: exact duplicate of turn #(\d+)\]$/

export interface CompactConversationOptions {
  keepRecent?: number
}

export interface CompactConversationResult {
  items: any[]
  charactersRemoved: number
  turnsCompacted: number
}

/** Check if item is a plain-text user or assistant conversational turn. */
function getPlainText(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined
  if (!['user', 'assistant'].includes(item.role)) return undefined
  if (item.type !== undefined && item.type !== 'message') return undefined
  if (['tool_calls', 'function_call', 'cache_control', 'annotations'].some(key => key in item && item[key] !== undefined)) {
    return undefined
  }
  if (typeof item.content === 'string') return item.content
  if (!Array.isArray(item.content) || item.content.length !== 1) return undefined
  const part = item.content[0]
  if (!part || typeof part !== 'object') return undefined
  if (!['input_text', 'output_text', 'text'].includes(part.type) || typeof part.text !== 'string') return undefined
  if (('cache_control' in part && part.cache_control !== undefined) || ('annotations' in part && part.annotations !== undefined)) {
    return undefined
  }
  return part.text
}

function hasFencedCode(text: string): boolean {
  return text.includes('```') || text.includes('~~~')
}

function isJsonObject(text: string): boolean {
  const trimmed = text.trim()
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      const parsed = JSON.parse(trimmed)
      return typeof parsed === 'object' && parsed !== null
    } catch {
      return false
    }
  }
  return false
}

function isReservedMarker(text: string): boolean {
  return text.includes('[EchoRegent lossless')
}

/** Returns plain text if eligible for compaction/referencing, or undefined if skipped. */
function getEligibleTurnText(item: any): string | undefined {
  const text = getPlainText(item)
  if (text === undefined) return undefined
  if (hasFencedCode(text)) return undefined
  if (isJsonObject(text)) return undefined
  if (isReservedMarker(text)) return undefined
  return text
}

/** Extracts text from an item if present, without strict eligibility checks (for restore). */
function extractItemText(item: any): string | undefined {
  if (!item || typeof item !== 'object') return undefined
  if (typeof item.content === 'string') return item.content
  if (Array.isArray(item.content) && item.content.length === 1) {
    const part = item.content[0]
    if (part && typeof part.text === 'string') return part.text
  }
  return undefined
}

function withText(item: any, text: string): any {
  if (typeof item.content === 'string') {
    if (item.content === text) return item
    return { ...item, content: text }
  }
  if (Array.isArray(item.content) && item.content.length === 1) {
    const part = item.content[0]
    if (part && typeof part.text === 'string') {
      if (part.text === text) return item
      return { ...item, content: [{ ...part, text }] }
    }
  }
  return item
}

/**
 * Deduplicate older conversational turns by replacing identical turns
 * with a lightweight lossless reference marker.
 */
export function compactConversationTurns(
  items: any[],
  options?: CompactConversationOptions
): CompactConversationResult {
  if (!Array.isArray(items) || items.length === 0) {
    return { items: Array.isArray(items) ? items : [], charactersRemoved: 0, turnsCompacted: 0 }
  }

  const keepRecent = Math.max(0, options?.keepRecent ?? DEFAULT_KEEP_RECENT)

  let latestUserIdx = -1
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.role === 'user') {
      latestUserIdx = i
      break
    }
  }

  const userBoundary = latestUserIdx >= 0 ? latestUserIdx : items.length
  const boundary = Math.min(items.length - keepRecent, userBoundary)

  if (boundary <= 0) {
    return { items, charactersRemoved: 0, turnsCompacted: 0 }
  }

  const next = [...items]
  let charactersRemoved = 0
  let turnsCompacted = 0
  const firstSeen = new Map<string, number>()

  for (let i = 0; i < boundary; i++) {
    const text = getEligibleTurnText(items[i])
    if (text === undefined) {
      continue
    }

    const firstIdx = firstSeen.get(text)
    if (firstIdx !== undefined) {
      if (text.length >= MIN_DUPLICATE_LENGTH) {
        const marker = `${TURN_REF_PREFIX}${firstIdx}]`
        if (smallerText(text, marker)) {
          next[i] = withText(items[i], marker)
          charactersRemoved += text.length - marker.length
          turnsCompacted += 1
          continue
        }
      }
    } else {
      firstSeen.set(text, i)
    }
  }

  return {
    items: turnsCompacted > 0 ? next : items,
    charactersRemoved,
    turnsCompacted,
  }
}

function resolveText(items: any[], idx: number, visited: Set<number>): string | undefined {
  if (visited.has(idx)) return undefined
  visited.add(idx)
  if (idx < 0 || idx >= items.length) return undefined

  const item = items[idx]
  const text = extractItemText(item)
  if (typeof text !== 'string') return undefined

  const match = TURN_REF_REGEX.exec(text)
  if (!match) {
    return text
  }

  const targetIdx = Number(match[1])
  if (!Number.isSafeInteger(targetIdx) || targetIdx < 0 || targetIdx >= items.length) {
    return undefined
  }

  return resolveText(items, targetIdx, visited)
}

/**
 * Losslessly restores every `[EchoRegent lossless turn-ref v1: exact duplicate of turn #N]`
 * back to the exact text of turn N, leaving malformed or out-of-range references untouched.
 */
export function restoreConversationTurns(items: any[]): any[] {
  if (!Array.isArray(items) || items.length === 0) return items

  let changed = false
  const next = [...items]

  for (let i = 0; i < next.length; i++) {
    const item = next[i]
    const text = extractItemText(item)
    if (typeof text !== 'string') continue

    const match = TURN_REF_REGEX.exec(text)
    if (!match) continue

    const targetIdx = Number(match[1])
    if (!Number.isSafeInteger(targetIdx) || targetIdx < 0 || targetIdx >= items.length || targetIdx === i) {
      continue
    }

    const restoredText = resolveText(next, targetIdx, new Set([i]))
    if (typeof restoredText === 'string') {
      const updated = withText(item, restoredText)
      if (updated !== item) {
        next[i] = updated
        changed = true
      }
    }
  }

  return changed ? next : items
}
