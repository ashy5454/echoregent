import { classify } from './classifier.js'
import type { RoutingFrame } from './types.js'

export interface PolicyDecision {
  protected: boolean
  compression: boolean
  memory: boolean
  responseCache: false
  reasons: string[]
  frame: RoutingFrame
}

/** Built-in protection cannot be weakened by a domain plugin or an adapter. */
export function evaluatePolicy(text: string): PolicyDecision {
  const frame = classify(text)
  const reasons: string[] = []
  // Scan the complete request independently of domain priority and ML results.
  if (frame.domain === 'medical' || /\b(medical|medication|prescription|dosage|symptoms?|diagnosis|diagnosed|blood pressure|chest pain|bleeding|doctor)\b/i.test(text)) reasons.push('medical')
  if (frame.domain === 'legal' || /\b(legal advice|lawsuit|litigation|lease|contract|clause|eviction|indemnity)\b/i.test(text)) reasons.push('legal')
  if (frame.risk.some((risk) => risk === 'crisis' || risk === 'protected_context') || /\b(suicid\w*|self[- ]harm|kill myself|end my life|want to die|protected_context)\b/i.test(text)) reasons.push('crisis-or-protected-context')
  return { protected: reasons.length > 0, compression: reasons.length === 0, memory: reasons.length === 0, responseCache: false, reasons, frame }
}
