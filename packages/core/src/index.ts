import { evaluatePolicy, type PolicyDecision } from './policy.js'
import { compressLogs } from './compression.js'
import { payloadTokens, smallerText } from './token-count.js'
import { compactOlderHistory } from './history.js'
import { ScopedMemory, scopeKey, type MemoryScope, type MemorySettings, type FactInput } from './memory.js'
import { createHash } from 'node:crypto'

export { classify } from './classifier.js'
export { evaluatePolicy } from './policy.js'
export { compressRepeatedLines, compressLogs, decompressText } from './compression.js'
export { restoreCompressedRequest } from './history.js'
export type { PolicyDecision } from './policy.js'
export type { MemoryScope, MemorySettings, FactInput, MemoryFact } from './memory.js'
export type { RoutingFrame } from './types.js'

export type Protocol = 'responses' | 'chat-completions'
export interface EngineOptions { memory?: MemorySettings; now?: () => number; compressor?: (text: string) => string; compactHistory?: boolean }
export interface ProcessResult<T> { request: T; policy: PolicyDecision; changed: boolean; reason: string; charactersRemoved: number }

export class EchoRegent {
  private readonly memory: ScopedMemory
  private readonly compressor: (text: string) => string
  private readonly compactHistory: boolean
  // Hashes only: no original/condensed content is retained between requests.
  private readonly priorTransforms = new Map<string, { outputHash: string; expiresAt: number }>()
  constructor(options: EngineOptions = {}) {
    this.memory = new ScopedMemory(options.memory, options.now)
    this.compressor = options.compressor ?? compressLogs
    this.compactHistory = options.compactHistory ?? false
  }

  process<T extends Record<string, any>>(request: T, protocol: Protocol, scope?: MemoryScope): ProcessResult<T> {
    const policy = this.classify(JSON.stringify(request), scope)
    const original = (reason: string): ProcessResult<T> => ({ request, policy, changed: false, reason, charactersRemoved: 0 })
    if (policy.protected) return original('protected-context')
    if (request.previous_response_id && !scope) return original('unavailable-server-side-context')
    const field = protocol === 'responses' ? 'input' : 'messages'
    const items = request[field]
    if (!Array.isArray(items) || !items.length) return original('no-eligible-tool-result')
    try {
      let charactersRemoved = 0
      let eligible = false
      const pendingTransforms: Array<[string, { outputHash: string; expiresAt: number }]> = []
      const hash = (text: string) => createHash('sha256').update(text).digest('hex')
      const scopeId = scope ? scopeKey(scope) : 'unscoped'
      let next = items.map((item, index) => {
        const contentField = protocol === 'responses' && ['function_call_output', 'custom_tool_call_output'].includes(item?.type) ? 'output' : protocol === 'chat-completions' && item?.role === 'tool' ? 'content' : null
        if (!contentField) return item
        const transform = (text: string, partIndex: number) => {
          const key = hash(JSON.stringify([scopeId, protocol, item.call_id ?? item.tool_call_id ?? item.id ?? index, partIndex, text]))
          const prior = this.priorTransforms.get(key)
          const replay = prior && prior.expiresAt > Date.now()
          if (index !== items.length - 1 && !replay) return text
          eligible = true
          const compressed = this.compressor(text)
          if (typeof compressed !== 'string' || (!compressed && text) || compressed.length > text.length) throw new Error('Invalid compression result')
          if (replay && hash(compressed) !== prior.outputHash) throw new Error('Compression prefix changed')
          if (compressed === text) return text
          charactersRemoved += text.length - compressed.length
          pendingTransforms.push([key, { outputHash: hash(compressed), expiresAt: Date.now() + 86_400_000 }])
          return compressed
        }
        const content = item[contentField]
        let updated: unknown = content
        if (typeof content === 'string') updated = transform(content, 0)
        else if (Array.isArray(content)) updated = content.map((part, partIndex) => {
          if (!part || !['input_text', 'text'].includes(part.type) || typeof part.text !== 'string') return part
          const text = transform(part.text, partIndex)
          return text === part.text ? part : { ...part, text }
        })
        if (typeof content === 'string' ? updated === content : Array.isArray(content) && (updated as unknown[]).every((part, partIndex) => part === content[partIndex])) return item
        return { ...item, [contentField]: updated }
      })
      const logCharactersRemoved = charactersRemoved
      if (this.compactHistory) {
        const history = compactOlderHistory(next)
        next = history.items
        charactersRemoved += history.charactersRemoved
      }
      if (!charactersRemoved) return original(eligible || this.compactHistory ? 'unchanged' : 'no-eligible-tool-result')
      const updatedRequest = { ...request, [field]: next }
      if (payloadTokens(updatedRequest) >= payloadTokens(request)) return original('no-token-savings')
      for (const [key, value] of pendingTransforms) this.priorTransforms.set(key, value)
      while (this.priorTransforms.size > 2048) this.priorTransforms.delete(this.priorTransforms.keys().next().value!)
      const reason = charactersRemoved === logCharactersRemoved ? 'lossless-log-compaction'
        : logCharactersRemoved ? 'lossless-context-compaction' : 'lossless-history-compaction'
      return { request: updatedRequest, policy, changed: true, reason, charactersRemoved }
    } catch { return original('compression-error') }
  }

  classify(text: string, scope?: MemoryScope): PolicyDecision {
    if (typeof text !== 'string') throw new Error('text must be a string')
    const policy = evaluatePolicy(text)
    if (scope) {
      scopeKey(scope)
      try {
        if (policy.protected) this.memory.protect(scope)
        else if (this.memory.isProtected(scope)) return { ...policy, protected: true, compression: false, memory: false, reasons: ['protected-session'] }
      } catch {
        // Preserve provider traffic; unavailable protection storage blocks transformations.
        return { ...policy, protected: true, compression: false, memory: false, reasons: [...policy.reasons, 'protection-state-unavailable'] }
      }
    }
    return policy
  }

  compressText(text: string, scope?: MemoryScope) {
    const policy = this.classify(text, scope)
    if (policy.protected) return { text, policy, changed: false }
    try {
      const compressed = this.compressor(text)
      if (typeof compressed !== 'string' || (!compressed && text) || (compressed !== text && !smallerText(text, compressed))) return { text, policy, changed: false }
      return { text: compressed, policy, changed: compressed !== text }
    } catch { return { text, policy, changed: false } }
  }

  private memoryAllowed(scope: MemoryScope, context = ''): boolean {
    this.classify(context, scope)
    return !this.memory.isProtected(scope)
  }

  async remember(scope: MemoryScope, fact: FactInput, context = '') {
    if (!this.memoryAllowed(scope, context)) throw new Error('Protected session cannot write memory')
    return this.memory.remember(scope, fact)
  }
  async recall(scope: MemoryScope, query: string, context = '') {
    if (!this.memoryAllowed(scope, context)) return []
    return this.memory.recall(scope, query)
  }
  async update(scope: MemoryScope, id: string, fact: FactInput, context = '') {
    if (!this.memoryAllowed(scope, context)) throw new Error('Protected session cannot write memory')
    return this.memory.update(scope, id, fact)
  }
  forget(scope: MemoryScope, id: string) { return this.memory.forget(scope, id) }
  purge(scope: MemoryScope) { return this.memory.purge(scope) }
}
