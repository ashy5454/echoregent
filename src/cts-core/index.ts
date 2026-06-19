import { classify, classifyAsync } from './classifier.js'
import { compressHistory, compressHistoryAsync } from './compressor.js'
import { mockRespond } from './mockResponder.js'
import { routePrompt } from './router.js'
import type { CTSAsyncInput, CTSInput, CTSResult, Message } from './types.js'

export * from './types.js'
export { classify, classifyAsync } from './classifier.js'
export { compressHistory, compressHistoryAsync, getCompressionStats } from './compressor.js'
export { routePrompt } from './router.js'
export { createEmptyWiki, ingestSession, wikiToContextString } from './wiki.js'
export { createEmptyLLMWiki, ingestSourceIntoLLMWiki, lintLLMWiki, llmWikiToContextString } from './llmWiki.js'
export { warmUpClassifier, getClassifierHealth } from './ml-classifier.js'
export { warmUpT5, getT5Health } from './ml-t5.js'
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
} from './semantic-cache.js'

export function cts(input: CTSInput): CTSResult {
  const started = performance.now()
  const current: Message = { role: 'user', content: input.message }
  const history = input.history ?? []
  const frame = classify(input.message, history, input.customDomainPlugins)
  const compression = compressHistory([...history, current], frame)
  const route = routePrompt(frame, {
    wikiContext: input.wikiContext,
    customDomainPlugins: input.customDomainPlugins,
  })
  const response = mockRespond(input.message, frame, compression, route)

  return {
    frame,
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
  const frame = await classifyAsync(input.message, history, input.customDomainPlugins)
  const compression = await compressHistoryAsync([...history, current], frame)
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
    compression,
    route,
    response,
    processingMs: Math.round(performance.now() - started),
  }
}

