import { evaluatePolicy, type PolicyDecision } from './policy.js'
import { compressLogs } from './compression.js'
import { payloadTokens, smallerText } from './token-count.js'
import { compactOlderHistory } from './history.js'
import { compactConversationTurns } from './conversation-compressor.js'
import {
  AdaptiveCompressionLearner,
  extractSignature,
  type AdaptiveCompressorOptions,
  type AdaptiveCompressorState,
  type TurnObservation,
  type ToolCallItem,
} from './adaptive-compressor.js'
import { ScopedMemory, scopeKey, type MemoryScope, type MemorySettings, type FactInput, type MemoryFact } from './memory.js'
import { WikiMemory } from './wiki-memory.js'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export { classify } from './classifier.js'
export { evaluatePolicy } from './policy.js'
export { compressRepeatedLines, compressLogs, decompressText } from './compression.js'
export { restoreCompressedRequest } from './history.js'
export { ScopedMemory, scopeKey } from './memory.js'
export { WikiMemory } from './wiki-memory.js'
export {
  compactConversationTurns,
  restoreConversationTurns,
  type CompactConversationOptions,
  type CompactConversationResult,
} from './conversation-compressor.js'
export {
  AdaptiveCompressionLearner,
  extractSignature,
  type AdaptiveCompressorOptions,
  type AdaptiveCompressorState,
  type TurnObservation,
  type ToolCallItem,
} from './adaptive-compressor.js'
export type { PolicyDecision } from './policy.js'
export type { MemoryScope, MemorySettings, FactInput, MemoryFact } from './memory.js'
export type { RoutingFrame } from './types.js'

export type Protocol = 'responses' | 'chat-completions'
export interface EngineOptions {
  memory?: MemorySettings
  now?: () => number
  compressor?: (text: string) => string
  compactHistory?: boolean
  injectMemory?: boolean
  adaptiveCompression?: boolean
  projectWideMemory?: boolean
  autoLearnMemory?: boolean
}
export interface ProcessResult<T> { request: T; policy: PolicyDecision; changed: boolean; reason: string; charactersRemoved: number }

interface ScopeLearnerContext {
  learner: AdaptiveCompressionLearner
  pendingSignatures: string[]
  lastToolCalls: ToolCallItem[]
}

export class EchoRegent {
  readonly memory: ScopedMemory
  readonly wikiMemory: WikiMemory
  private readonly compressor: (text: string) => string
  private readonly compactHistory: boolean
  private readonly injectMemory: boolean
  private readonly adaptiveCompression: boolean
  private readonly projectWideMemory: boolean
  private readonly autoLearnMemory: boolean
  // Hashes only: no original/condensed content is retained between requests.
  private readonly priorTransforms = new Map<string, { outputHash: string; expiresAt: number }>()
  private readonly learners = new Map<string, ScopeLearnerContext>()

  constructor(options: EngineOptions = {}) {
    this.memory = new ScopedMemory(options.memory, options.now)
    this.wikiMemory = new WikiMemory(this.memory)
    this.compressor = options.compressor ?? compressLogs
    this.compactHistory = options.compactHistory ?? false
    this.injectMemory = options.injectMemory ?? false
    this.adaptiveCompression = options.adaptiveCompression ?? false
    this.projectWideMemory = options.projectWideMemory ?? false
    this.autoLearnMemory = options.autoLearnMemory ?? false
  }

  private resolveScope(scope?: MemoryScope): MemoryScope | undefined {
    if (!scope) return undefined
    scopeKey(scope)
    return this.projectWideMemory ? { project: scope.project, session: '__project__' } : scope
  }

  private getLearnerContext(scope?: MemoryScope): ScopeLearnerContext {
    const key = scope ? scopeKey(scope) : 'unscoped'
    let ctx = this.learners.get(key)
    if (!ctx) {
      const learner = new AdaptiveCompressionLearner()
      if (this.memory.settings.mode === 'file') {
        const filePath = join(this.memory.settings.directory, `${key}.adaptive.json`)
        if (existsSync(filePath)) {
          try {
            const raw = JSON.parse(readFileSync(filePath, 'utf8'))
            if (raw && raw.state) learner.loadState(raw.state)
          } catch { /* ignore corrupt state */ }
        }
      }
      ctx = { learner, pendingSignatures: [], lastToolCalls: [] }
      this.learners.set(key, ctx)
    }
    return ctx
  }

  private saveLearnerContext(scope: MemoryScope | undefined, ctx: ScopeLearnerContext): void {
    if (this.memory.settings.mode !== 'file') return
    const key = scope ? scopeKey(scope) : 'unscoped'
    const dir = this.memory.settings.directory
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    const filePath = join(dir, `${key}.adaptive.json`)
    const tmp = `${filePath}.${randomUUID()}.tmp`
    try {
      writeFileSync(tmp, JSON.stringify({ state: ctx.learner.exportState() }, null, 2), { mode: 0o600, flag: 'wx' })
      renameSync(tmp, filePath)
    } finally {
      rmSync(tmp, { force: true })
    }
  }

  getAdaptiveLearner(scope?: MemoryScope): AdaptiveCompressionLearner {
    return this.getLearnerContext(this.resolveScope(scope)).learner
  }

  compileContextBlock(scope: MemoryScope, queryText: string, maxFacts = 5): string {
    return this.wikiMemory.compileContextBlock(this.resolveScope(scope)!, queryText, maxFacts)
  }

  process<T extends Record<string, any>>(request: T, protocol: Protocol, scope?: MemoryScope): ProcessResult<T> {
    const effectiveScope = this.resolveScope(scope)
    const policy = this.classify(JSON.stringify(request), effectiveScope)
    const original = (reason: string): ProcessResult<T> => ({ request, policy, changed: false, reason, charactersRemoved: 0 })
    if (policy.protected) return original('protected-context')
    if (request.previous_response_id && !effectiveScope) return original('unavailable-server-side-context')
    const field = protocol === 'responses' ? 'input' : 'messages'
    const rawItems = request[field]
    if (!Array.isArray(rawItems) || !rawItems.length) return original('no-eligible-tool-result')

    // Deduplicate prior turn's injected [EchoRegent LLM-Wiki Memory Context] block when client resends history
    const items = this.injectMemory
      ? rawItems.filter((item) => {
          if (!item || !['system', 'developer'].includes(item.role)) return true
          return !(typeof item.content === 'string' && item.content.startsWith('[EchoRegent LLM-Wiki Memory Context]'))
        })
      : rawItems
    let priorMemoryStripped = items.length !== rawItems.length

    // Detect Anthropic Messages API shape (top-level `system` or `tool_result` / `tool_use` content blocks)
    const isAnthropicShape =
      protocol === 'chat-completions' &&
      ('system' in request ||
        items.some(
          (m) =>
            Array.isArray(m?.content) &&
            m.content.some((p: any) => p && ['tool_result', 'tool_use'].includes(p.type)),
        ))

    let cleanedTopSystem: unknown = request.system
    if (this.injectMemory && isAnthropicShape && typeof request.system === 'string') {
      if (request.system.startsWith('[EchoRegent LLM-Wiki Memory Context]')) {
        const splitIdx = request.system.indexOf('\n\n')
        cleanedTopSystem = splitIdx >= 0 ? request.system.slice(splitIdx + 2) : undefined
        priorMemoryStripped = true
      }
    }

    const userItem = [...items].reverse().find((item) => {
      if (item?.role !== 'user') return false
      if (typeof item.content === 'string') return true
      if (Array.isArray(item.content)) {
        return item.content.some((part: any) => part && ['input_text', 'text'].includes(part.type) && typeof part.text === 'string')
      }
      return false
    })
    let userQuery = ''
    if (userItem) {
      if (typeof userItem.content === 'string') {
        userQuery = userItem.content
      } else if (Array.isArray(userItem.content)) {
        userQuery = userItem.content
          .filter((part: any) => part && ['input_text', 'text'].includes(part.type) && typeof part.text === 'string')
          .map((part: any) => part.text)
          .join('\n')
      }
    }

    // Autonomous zero-LLM-call fact learning from incoming user turns
    if (this.autoLearnMemory && effectiveScope && !policy.protected && userQuery) {
      this.wikiMemory.autoIngestTurnSync(effectiveScope, userQuery)
    }

    const currentToolCalls: ToolCallItem[] = []
    for (const item of items) {
      if (protocol === 'responses' && ['function_call', 'custom_tool_call'].includes(item?.type)) {
        currentToolCalls.push({ name: item.name, args: item.arguments ?? item.input })
      } else if (protocol === 'chat-completions' && item?.role === 'assistant') {
        if (Array.isArray(item.tool_calls)) {
          for (const tc of item.tool_calls) {
            currentToolCalls.push({ name: tc?.function?.name ?? tc?.name, args: tc?.function?.arguments ?? tc?.args })
          }
        }
        if (Array.isArray(item.content)) {
          for (const part of item.content) {
            if (part?.type === 'tool_use') {
              currentToolCalls.push({ name: part.name, args: part.input })
            }
          }
        }
      }
    }

    const learnerCtx = this.adaptiveCompression ? this.getLearnerContext(effectiveScope) : null
    if (learnerCtx && learnerCtx.pendingSignatures.length > 0) {
      learnerCtx.learner.observeTurn({
        signatures: learnerCtx.pendingSignatures,
        userPrompt: userQuery,
        toolCalls: currentToolCalls,
        previousToolCalls: learnerCtx.lastToolCalls,
      })
      learnerCtx.pendingSignatures = []
      this.saveLearnerContext(effectiveScope, learnerCtx)
    }

    let memoryInjected = false
    let injectedItem: any = null
    let injectedTopSystem: string | undefined

    if (this.injectMemory && effectiveScope && !policy.protected) {
      const contextBlock = this.compileContextBlock(effectiveScope, userQuery)
      if (contextBlock) {
        memoryInjected = true
        if (isAnthropicShape) {
          injectedTopSystem =
            typeof cleanedTopSystem === 'string' && cleanedTopSystem.trim()
              ? `${contextBlock}\n\n${cleanedTopSystem}`
              : contextBlock
        } else {
          injectedItem = protocol === 'responses'
            ? { role: 'developer', content: contextBlock }
            : { role: 'system', content: contextBlock }
        }
      }
    }

    try {
      let charactersRemoved = 0
      let eligible = false
      const pendingTransforms: Array<[string, { outputHash: string; expiresAt: number }]> = []
      const turnCompressedSignatures = new Set<string>()
      const hash = (text: string) => createHash('sha256').update(text).digest('hex')
      const scopeId = effectiveScope ? scopeKey(effectiveScope) : 'unscoped'
      let next = items.map((item, index) => {
        const isAnthropicToolResult =
          protocol === 'chat-completions' &&
          item?.role === 'user' &&
          Array.isArray(item?.content) &&
          item.content.some((p: any) => p?.type === 'tool_result')
        const contentField =
          protocol === 'responses' && ['function_call_output', 'custom_tool_call_output'].includes(item?.type)
            ? 'output'
            : protocol === 'chat-completions' && (item?.role === 'tool' || isAnthropicToolResult)
              ? 'content'
              : null
        if (!contentField) return item
        const transform = (text: string, partIndex: number) => {
          const key = hash(JSON.stringify([scopeId, protocol, item.call_id ?? item.tool_call_id ?? item.id ?? index, partIndex, text]))
          const prior = this.priorTransforms.get(key)
          const replay = prior && prior.expiresAt > Date.now()
          if (index !== items.length - 1 && !replay) return text
          eligible = true
          let compressed: string
          if (learnerCtx) {
            const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
            const sigs = lines.map(extractSignature)
            const hasProtectedLine = sigs.some((sig) => learnerCtx.learner.isProtected(sig))
            if (hasProtectedLine) {
              compressed = learnerCtx.learner.compressWithLearnedPolicy(text)
              for (const sig of learnerCtx.learner.getLastCompressedSignatures()) turnCompressedSignatures.add(sig)
            } else {
              const adaptiveCandidate = learnerCtx.learner.compressWithLearnedPolicy(text)
              const stdCandidate = this.compressor(text)
              compressed = smallerText(adaptiveCandidate, stdCandidate) ? stdCandidate : adaptiveCandidate
              if (compressed !== text) {
                for (const sig of sigs) turnCompressedSignatures.add(sig)
              }
            }
          } else {
            compressed = this.compressor(text)
          }
          if (typeof compressed !== 'string' || (!compressed && text) || compressed.length > text.length) throw new Error('Invalid compression result')
          if (!learnerCtx && replay && hash(compressed) !== prior.outputHash) throw new Error('Compression prefix changed')
          if (compressed === text) return text
          charactersRemoved += text.length - compressed.length
          if (!learnerCtx) {
            pendingTransforms.push([key, { outputHash: hash(compressed), expiresAt: Date.now() + 86_400_000 }])
          }
          return compressed
        }
        const content = item[contentField]
        let updated: unknown = content
        if (typeof content === 'string') updated = transform(content, 0)
        else if (Array.isArray(content)) updated = content.map((part, partIndex) => {
          if (!part) return part
          if (['input_text', 'text'].includes(part.type) && typeof part.text === 'string') {
            const text = transform(part.text, partIndex)
            return text === part.text ? part : { ...part, text }
          }
          if (part.type === 'tool_result') {
            if (typeof part.content === 'string') {
              const text = transform(part.content, partIndex)
              return text === part.content ? part : { ...part, content: text }
            }
            if (Array.isArray(part.content)) {
              const subUpdated = part.content.map((sub: any, subIdx: number) => {
                if (!sub || sub.type !== 'text' || typeof sub.text !== 'string') return sub
                const text = transform(sub.text, partIndex * 100 + subIdx)
                return text === sub.text ? sub : { ...sub, text }
              })
              return subUpdated.every((s: any, idx: number) => s === part.content[idx]) ? part : { ...part, content: subUpdated }
            }
          }
          return part
        })
        if (typeof content === 'string' ? updated === content : Array.isArray(content) && (updated as unknown[]).every((part, partIndex) => part === content[partIndex])) return item
        return { ...item, [contentField]: updated }
      })
      if (learnerCtx) {
        if (turnCompressedSignatures.size > 0) {
          learnerCtx.pendingSignatures = Array.from(turnCompressedSignatures)
        }
        learnerCtx.lastToolCalls = currentToolCalls
        this.saveLearnerContext(effectiveScope, learnerCtx)
      }
      const logCharactersRemoved = charactersRemoved
      if (this.compactHistory) {
        const history = compactOlderHistory(next)
        next = history.items
        charactersRemoved += history.charactersRemoved
        const convTurns = compactConversationTurns(next)
        if (convTurns.charactersRemoved > 0) {
          next = convTurns.items
          charactersRemoved += convTurns.charactersRemoved
        }
      }
      if (memoryInjected && injectedItem) {
        next = [injectedItem, ...next]
      }
      if (!charactersRemoved && !memoryInjected && !priorMemoryStripped) return original(eligible || this.compactHistory ? 'unchanged' : 'no-eligible-tool-result')
      const updatedRequest = {
        ...request,
        [field]: next,
        ...(injectedTopSystem !== undefined
          ? { system: injectedTopSystem }
          : priorMemoryStripped && isAnthropicShape && cleanedTopSystem !== undefined
            ? { system: cleanedTopSystem }
            : {}),
      }
      if (!memoryInjected && !priorMemoryStripped && payloadTokens(updatedRequest) >= payloadTokens(request)) return original('no-token-savings')
      for (const [key, value] of pendingTransforms) this.priorTransforms.set(key, value)
      while (this.priorTransforms.size > 2048) this.priorTransforms.delete(this.priorTransforms.keys().next().value!)
      
      let reason = ''
      if (memoryInjected && charactersRemoved > 0) {
        reason = charactersRemoved === logCharactersRemoved ? 'lossless-log-compaction'
          : logCharactersRemoved ? 'lossless-context-compaction' : 'lossless-history-compaction'
      } else if (memoryInjected) {
        reason = 'memory-injected'
      } else {
        reason = charactersRemoved === logCharactersRemoved ? 'lossless-log-compaction'
          : logCharactersRemoved ? 'lossless-context-compaction' : 'lossless-history-compaction'
      }
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
    const s = this.resolveScope(scope)!
    if (!this.memoryAllowed(s, context)) throw new Error('Protected session cannot write memory')
    return this.memory.remember(s, fact)
  }
  async recall(scope: MemoryScope, query: string, context = '') {
    const s = this.resolveScope(scope)!
    if (!this.memoryAllowed(s, context)) return []
    return this.memory.recall(s, query)
  }
  async update(scope: MemoryScope, id: string, fact: FactInput, context = '') {
    const s = this.resolveScope(scope)!
    if (!this.memoryAllowed(s, context)) throw new Error('Protected session cannot write memory')
    return this.memory.update(s, id, fact)
  }
  forget(scope: MemoryScope, id: string) { return this.memory.forget(this.resolveScope(scope)!, id) }
  purge(scope: MemoryScope) { return this.memory.purge(this.resolveScope(scope)!) }
}
