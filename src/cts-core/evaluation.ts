import type { CompressionResult, Message, RoutingFrame } from './types'

export interface ContextQualityReport {
  passed: boolean
  criticalFactRecall: number
  requiredFacts: string[]
  preservedFacts: string[]
  missingFacts: string[]
  warnings: string[]
}

/**
 * Deterministically checks whether concrete, answer-critical values survived a
 * context transform. It does not pretend to judge answer quality; it provides
 * a reproducible guardrail for IDs, errors, dates, paths, amounts, and explicit
 * product facts that summarizers are most likely to lose.
 */
export function evaluateContextQuality(input: {
  original: Message[]
  compression: CompressionResult
  frame: RoutingFrame
  requiredFacts?: string[]
}): ContextQualityReport {
  const requiredFacts = unique(
    (input.requiredFacts?.length ? input.requiredFacts : extractCriticalFacts(input.original, input.frame))
      .map(normalizeFact)
      .filter(Boolean),
  )
  const compressed = input.compression.compressed.map((message) => message.content).join('\n').toLowerCase()
  const preservedFacts = requiredFacts.filter((fact) => compressed.includes(fact.toLowerCase()))
  const missingFacts = requiredFacts.filter((fact) => !compressed.includes(fact.toLowerCase()))
  const recall = requiredFacts.length === 0 ? 1 : preservedFacts.length / requiredFacts.length
  const warnings: string[] = []

  if (input.compression.tokensSaved === 0 && input.compression.originalTokens > 0) {
    warnings.push('No compression was applied; critical-context recall is expected to be 100%.')
  }
  if (missingFacts.length > 0) {
    warnings.push(`${missingFacts.length} critical fact(s) are absent from the transformed context.`)
  }
  if (input.frame.risk.length > 0 && input.compression.tokensSaved > 0) {
    warnings.push('A risk signal was present while compression saved tokens; review this trace before rollout.')
  }

  return {
    passed: missingFacts.length === 0,
    criticalFactRecall: Number(recall.toFixed(4)),
    requiredFacts,
    preservedFacts,
    missingFacts,
    warnings,
  }
}

function extractCriticalFacts(messages: Message[], frame: RoutingFrame): string[] {
  const text = messages.map((message) => message.content).join('\n')
  const facts = new Set<string>()
  const add = (pattern: RegExp): void => {
    for (const match of text.matchAll(pattern)) facts.add(normalizeFact(match[0]))
  }

  add(/\b[A-Z]{1,5}[-_]?[A-Z0-9]{3,12}\b/g) // order, ticket, and account IDs
  add(/\b(?:\d{4}-\d{2}-\d{2}|\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)\b/g)
  add(/\b[45]\d{2}\b/g)
  add(/\b(?:TypeError|ReferenceError|SyntaxError|ValueError|RuntimeError):[^\n]{0,120}/g)
  add(/`[^`\n]{2,120}`/g)
  add(/\b(?:src|app|lib|api|components|routes)\/[A-Za-z0-9_./-]+/g)
  add(/\$[\d,]+(?:\.\d{2})?/g)
  add(/\b\d+(?:\.\d+)?\s*(?:ms|seconds?|minutes?|hours?|days?|weeks?|%|GB|MB|users?|requests?)\b/gi)

  if (frame.domain === 'coding') add(/\b(?:webhook|stripe|postgres(?:ql)?|redis|docker|kubernetes|migration|backfill|signature|timeout)\b/gi)
  if (frame.domain === 'customer_support') add(/\b(?:refund|delivery|tracking|replacement|escalat(?:e|ed|ion))\b/gi)
  if (frame.domain === 'sales') add(/\b(?:SOC2|SSO|ROI|discount|contract|budget)\b/gi)

  return Array.from(facts).filter((fact) => fact.length >= 2).slice(0, 30)
}

function normalizeFact(value: string): string {
  return value.trim().replace(/^`|`$/g, '').replace(/\s+/g, ' ')
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values))
}
