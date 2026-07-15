import { evaluateContextPolicy } from './policy'
import type { ContextPlan, ContextPolicy, Message, RoutingFrame } from './types'

const PROVIDERS_WITH_PREFIX_CACHE = new Set(['gemini'])

/**
 * Produces an explainable plan before the history is transformed. This is the
 * one place where a request becomes "verbatim" or "compress"; callers can
 * persist the output in an audit trail without storing raw provider secrets.
 */
export function buildContextPlan(input: {
  frame: RoutingFrame
  history: Message[]
  policy?: Partial<ContextPolicy>
  provider?: string
}): ContextPlan {
  const policy = evaluateContextPolicy(input.frame, input.policy)
  const estimatedOriginalTokens = estimateTokens(input.history)
  const provider = input.provider?.toLowerCase().trim()

  if (policy.compression === 'block') {
    return {
      strategy: 'verbatim',
      reason: policy.reasons.join(' '),
      policy,
      originalMessageCount: input.history.length,
      estimatedOriginalTokens,
      providerCacheEligible: false,
    }
  }

  if (input.history.length <= 4) {
    return {
      strategy: 'verbatim',
      reason: 'History is short; preserving it verbatim is cheaper and safer than summarising it.',
      policy,
      originalMessageCount: input.history.length,
      estimatedOriginalTokens,
      providerCacheEligible: PROVIDERS_WITH_PREFIX_CACHE.has(provider ?? ''),
    }
  }

  return {
    strategy: 'compress',
    reason: 'History exceeds the verbatim threshold and no protected-context rule matched.',
    policy,
    originalMessageCount: input.history.length,
    estimatedOriginalTokens,
    providerCacheEligible: PROVIDERS_WITH_PREFIX_CACHE.has(provider ?? ''),
  }
}

function estimateTokens(messages: Message[]): number {
  return Math.ceil(messages.reduce((total, message) => total + message.content.length, 0) / 4)
}
