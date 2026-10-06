import { classify, classifyAsync } from './classifier'
import { compressHistory, compressHistoryAsync } from './compressor'
import { mockRespond } from './mockResponder'
import { routePrompt } from './router'
import { buildContextPlan } from './contextPlan'
import type { CTSAsyncInput, CTSInput, CTSResult, Message } from './types'

export * from './types'
export { classify, classifyAsync } from './classifier'
export { compressHistory, compressHistoryAsync, getCompressionStats } from './compressor'
export { routePrompt } from './router'
export { buildContextPlan } from './contextPlan'
export { DEFAULT_CONTEXT_POLICY, evaluateContextPolicy, isProtectedFrame, isResponseCacheAllowed, resolveContextPolicy } from './policy'
export { redactSensitiveData } from './privacy'
export { evaluateContextQuality } from './evaluation'
export { createEmptyWiki, ingestSession, wikiToContextString } from './wiki'
export {
  createEmptyLLMWiki,
  ingestSourceIntoLLMWiki,
  lintLLMWiki,
  llmWikiToContextString,
  recallMemoryFacts,
  correctMemoryFact,
  forgetMemoryFact,
  purgeExpiredMemory,
} from './llmWiki'
export { warmUpClassifier, getClassifierHealth } from './ml-classifier'
export { warmUpT5, getT5Health } from './ml-t5'
export {
  warmUpSemanticCache,
  checkCache,
  storeCache,
  getCacheStats,
  getSemanticCacheHealth,
  clearSessionCache,
  isCacheable,
  isHighCacheDomain,
  type CacheResult,
  type CacheStats,
} from './semantic-cache'

export function cts(input: CTSInput): CTSResult {
  const started = performance.now()
  const current: Message = { role: 'user', content: input.message }
  const history = input.history ?? []
  const frame = input.frame ?? classify(input.message, history, input.customDomainPlugins)
  const fullHistory = [...history, current]
  const contextPlan = buildContextPlan({ frame, history: fullHistory, policy: input.contextPolicy, provider: input.provider })
  const compression = compressHistory(fullHistory, frame, input.contextPolicy)
  const route = routePrompt(frame, {
    wikiContext: input.wikiContext,
    customDomainPlugins: input.customDomainPlugins,
  })
  const response = mockRespond(input.message, frame, compression, route)

  return {
    frame,
    policy: contextPlan.policy,
    contextPlan,
    compression,
    route,
    response,
    processingMs: Math.round(performance.now() - started),
  }
}

export async function ctsAsync(input: CTSAsyncInput): Promise<CTSResult> {
  const started = performance.now()
  const current: Message = { role: 'user', content: input.message }
  const history = input.history ?? []
  const frame = input.frame ?? await classifyAsync(input.message, history, input.customDomainPlugins)
  const fullHistory = [...history, current]
  const contextPlan = buildContextPlan({ frame, history: fullHistory, policy: input.contextPolicy, provider: input.provider })
  const compression = await compressHistoryAsync(fullHistory, frame, input.contextPolicy)
  const route = routePrompt(frame, {
    wikiContext: input.wikiContext,
    customDomainPlugins: input.customDomainPlugins,
  })
  const response = input.responder
    ? await input.responder({
        systemPrompt: route.systemPrompt,
        compressedHistory: compression.compressed,
        message: input.message,
        frame,
      })
    : mockRespond(input.message, frame, compression, route)

  return {
    frame,
    policy: contextPlan.policy,
    contextPlan,
    compression,
    route,
    response,
    processingMs: Math.round(performance.now() - started),
  }
}
