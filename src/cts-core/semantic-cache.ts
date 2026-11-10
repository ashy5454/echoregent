/**
 * CTS Semantic Response Cache
 * ============================
 * Saves output tokens by returning cached LLM responses for semantically
 * similar queries instead of generating new ones.
 *
 * How it works:
 *  1. Embed the incoming query with all-MiniLM-L6-v2 (23 MB, ~5ms/query)
 *  2. Cosine-similarity scan against the in-memory cache
 *  3. Hit (similarity > THRESHOLD) â†’ return cached response instantly
 *     â†’ 0 input tokens + 0 output tokens consumed
 *  4. Miss â†’ caller generates response normally â†’ stored in cache
 *
 * Cache is scoped by domain, sessionId and optional history/system context.
 * Queries over 512 characters bypass caching to avoid prefix collisions.
 *
 * TTL: 1 hour per entry (sliding expiry resets on hit).
 * Max size: 500 entries global (LRU eviction).
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadNativeEncoder } from './native-encoder'
import { loadTransformersRuntime } from './transformers-runtime'
import { createHash } from 'node:crypto'
import type { DomainType, Message } from './types'

export interface CacheContext {
  history: Message[]
  systemPrompt?: string
}

function contextFingerprint(context?: CacheContext): string {
  return context ? createHash('sha256').update(JSON.stringify(context)).digest('hex') : ''
}

// Sentence similarity often ignores changes to order IDs, amounts or negation.
// Restrict these queries to exact text matches before using their embeddings.
function requiresExactQuery(query: string): boolean {
  return /\d|\b(?:not|never|no|without|except|don't|can't|cannot|avoid|allergic)\b|[@$£€₹]|\b(?:mon|tues|wednes|thurs|fri|satur|sun)day\b|\b(?:january|february|march|april|may|june|july|august|september|october|november|december)\b/i.test(query)
}

// â”€â”€ Config â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const SIMILARITY_THRESHOLD = 0.92   // cosine sim required for a cache hit
const MAX_CACHE_ENTRIES    = 500     // global LRU cap
const TTL_MS               = 60 * 60 * 1_000  // 1 hour

function readCacheThreshold(): number {
  const raw = process.env.CTS_CACHE_THRESHOLD
  if (raw === undefined || raw === '') return SIMILARITY_THRESHOLD
  const parsed = Number(raw)
  if (Number.isNaN(parsed) || parsed < 0.50 || parsed > 1.00) {
    console.warn(
      `[CTS] CTS_CACHE_THRESHOLD=${raw} is out of range [0.50, 1.00] — using default ${SIMILARITY_THRESHOLD}`
    )
    return SIMILARITY_THRESHOLD
  }
  return parsed
}

const ACTIVE_THRESHOLD = readCacheThreshold()

// Domains where caching is most valuable (high FAQ repetition rate)
const HIGH_CACHE_DOMAINS = new Set<DomainType>([
  'customer_support', 'commerce', 'education', 'medical', 'coding',
  // coding: Stack Overflow-style questions repeat at massive scale
  // "how do I sort a list in Python" is asked by millions â€” identical queries cache perfectly
])

// Domains where caching is risky (answers change per-session context)
const NO_CACHE_DOMAINS = new Set<DomainType>([
  'legal',  // legal advice is highly context-specific
])

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

interface CacheEntry {
  embedding:  number[]    // dense vector from MiniLM
  response:   string      // the cached LLM reply
  query:      string      // original query text (for debug)
  domain:     DomainType
  sessionId:  string
  context:    string
  hits:       number      // how many times this entry was served
  createdAt:  number      // ms timestamp
  lastHitAt:  number      // ms timestamp (used for TTL reset on hit)
}

export interface CacheResult {
  hit:        boolean
  response?:  string
  similarity?: number
  savedTokens?: number    // estimated output tokens saved
}

export interface CacheStats {
  totalEntries:    number
  totalHits:       number
  totalMisses:     number
  hitRate:         number  // 0â€“1
  estimatedTokensSaved: number
}

// â”€â”€ Singleton state â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

let _pipe: unknown = null
let _inflightLoad: Promise<unknown> | null = null

type ModelStatus = 'not_loaded' | 'loading' | 'ready' | 'failed'
export interface SemanticModelHealth {
  name: string
  status: ModelStatus
  loaded: boolean
  loadedAt?: string
  lastError?: string
}

let modelHealth: SemanticModelHealth = { name: 'cts_minilm', status: 'not_loaded', loaded: false }

function setModelHealth(status: ModelStatus, error?: unknown): void {
  modelHealth = {
    name: 'cts_minilm',
    status,
    loaded: status === 'ready',
    loadedAt: status === 'ready' ? new Date().toISOString() : modelHealth.loadedAt,
    lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
  }
}

export function getSemanticCacheHealth(): SemanticModelHealth {
  return { ...modelHealth }
}

const cache: CacheEntry[] = []
let totalHits        = 0
let totalMisses      = 0
let totalSavedTokens = 0

let _cacheOpCount = 0
const DEBUG_LOG_LIMIT = 100

// â”€â”€ Model loader â€” identical pattern to ml-classifier.ts / ml-t5.ts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function getPipeline(): Promise<((text: string, opts: Record<string, unknown>) => Promise<unknown>) | null> {
  if (_pipe) return _pipe as (text: string, opts: Record<string, unknown>) => Promise<unknown>

  if (!_inflightLoad) {
    setModelHealth('loading')
    _inflightLoad = (async () => {
      try {
        if (existsSync(join(process.cwd(), 'ml', 'cts_minilm', 'onnx', 'model_pooled_quantized.onnx'))) {
          const encode = await loadNativeEncoder('cts_minilm')
          const created = async (text: string) => (await encode([text])).map(data => ({ data: Float32Array.from(data) }))
          _pipe = created
          setModelHealth('ready')
          return created
        }
        const mod = await loadTransformersRuntime()
        const pipelineFactory = mod.pipeline as Function
        const envRef = mod.env as { localModelPath: string; allowRemoteModels: boolean }
        envRef.localModelPath    = join(process.cwd(), 'ml')
        envRef.allowRemoteModels = false

        const created = await pipelineFactory('feature-extraction', 'cts_minilm', {
          quantized: true,   // uses model_quantized.onnx (22 MB vs 88 MB)
        })
        _pipe         = created
        _inflightLoad = null
        setModelHealth('ready')
        console.info('[CTS] cts_minilm loaded — semantic cache active')
        console.log('[CTS] Semantic cache (MiniLM) loaded')
        return created
      } catch (err) {
        _inflightLoad = null
        setModelHealth('failed', err)
        console.warn('[CTS] Semantic cache unavailable (MiniLM not loaded):', (err as Error).message)
        return null
      }
    })()
  }

  await _inflightLoad
  return _pipe as ((text: string, opts: Record<string, unknown>) => Promise<unknown>) | null
}

export async function warmUpSemanticCache(): Promise<void> {
  const pipe = await getPipeline()
  if (pipe) {
    await embed('warm-up query')
    console.log('[CTS] Semantic cache warm-up complete âœ“')
  }
}

// â”€â”€ Embedding helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function embed(text: string): Promise<number[] | null> {
  const pipe = await getPipeline()
  if (!pipe) return null
  try {
    const result = await pipe(text.slice(0, 512), { pooling: 'mean', normalize: true }) as { data: Float32Array }[]
    return Array.from(result[0].data)
  } catch (error) {
    setModelHealth('failed', error)
    return null
  }
}

function cosine(a: number[], b: number[]): number {
  // Both vectors are already L2-normalised by MiniLM (normalize: true above)
  // so cosine similarity = dot product
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

// â”€â”€ Cache operations â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function cacheKey(domain: DomainType, sessionId: string): string {
  return `${domain}::${sessionId}`
}

function evictStaleAndOverflow(): void {
  const now = Date.now()
  // Remove expired entries
  for (let i = cache.length - 1; i >= 0; i--) {
    if (now - cache[i].lastHitAt > TTL_MS) cache.splice(i, 1)
  }
  // LRU eviction if still over limit
  while (cache.length > MAX_CACHE_ENTRIES) {
    // Remove the entry with the oldest lastHitAt
    let oldest = 0
    for (let i = 1; i < cache.length; i++) {
      if (cache[i].lastHitAt < cache[oldest].lastHitAt) oldest = i
    }
    cache.splice(oldest, 1)
  }
}

/**
 * Check cache before calling the LLM.
 * Returns { hit: true, response, similarity, savedTokens } on hit.
 * Returns { hit: false } on miss (caller should generate and then storeCache).
 */
export async function checkCache(
  query:     string,
  domain:    DomainType,
  sessionId: string,
  context?: CacheContext,
): Promise<CacheResult> {
  // Skip caching for domains where it's unsafe
  if (NO_CACHE_DOMAINS.has(domain)) return { hit: false }
  // Prefix-only embeddings cannot safely distinguish a changed query tail.
  if (query.length > 512) return { hit: false }

  const queryEmbedding = await embed(query)
  if (!queryEmbedding) return { hit: false }   // model not available â†’ miss

  const scope = cacheKey(domain, sessionId)
  const fingerprint = contextFingerprint(context)
  const now   = Date.now()

  let bestSim   = -1
  let bestEntry: CacheEntry | null = null

  for (const entry of cache) {
    // Scope check: same domain+session, not expired
    if (cacheKey(entry.domain, entry.sessionId) !== scope) continue
    if (entry.context !== fingerprint) continue
    if ((requiresExactQuery(query) || requiresExactQuery(entry.query)) && entry.query !== query) continue
    if (now - entry.lastHitAt > TTL_MS) continue

    const sim = cosine(queryEmbedding, entry.embedding)
    if (sim > bestSim) {
      bestSim   = sim
      bestEntry = entry
    }
  }

  if (bestEntry && bestSim >= ACTIVE_THRESHOLD) {
    bestEntry.hits      += 1
    bestEntry.lastHitAt  = now
    totalHits           += 1

    // Estimate saved tokens: ~response length / 4 chars per token
    const saved = Math.round(bestEntry.response.length / 4)
    totalSavedTokens += saved

    if (_cacheOpCount < DEBUG_LOG_LIMIT) {
      console.debug(
        `[CTS cache op #${_cacheOpCount + 1}] hit=true sim=${bestSim.toFixed(4)} domain=${domain}`
      )
      _cacheOpCount += 1
    }

    return {
      hit:        true,
      response:   bestEntry.response,
      similarity: Math.round(bestSim * 1000) / 1000,
      savedTokens: saved,
    }
  }

  totalMisses += 1

  if (_cacheOpCount < DEBUG_LOG_LIMIT) {
    const isHit = bestEntry !== null && bestSim >= ACTIVE_THRESHOLD
    console.debug(
      `[CTS cache op #${_cacheOpCount + 1}] hit=${isHit} sim=${
        bestSim >= 0 ? bestSim.toFixed(4) : 'n/a'
      } domain=${domain}`
    )
    _cacheOpCount += 1
  }

  return { hit: false }
}

/**
 * Store a generated response in the cache after an LLM call.
 * Call this AFTER you get the LLM response back, before returning to client.
 */
export async function storeCache(
  query:     string,
  response:  string,
  domain:    DomainType,
  sessionId: string,
  context?: CacheContext,
): Promise<void> {
  // Skip for no-cache domains or very short responses (not worth caching)
  if (NO_CACHE_DOMAINS.has(domain)) return
  if (query.length > 512) return
  if (response.length < 50) return

  const embedding = await embed(query)
  if (!embedding) return

  evictStaleAndOverflow()

  const now = Date.now()
  cache.push({
    embedding,
    response,
    query,
    domain,
    sessionId,
    context: contextFingerprint(context),
    hits:      0,
    createdAt: now,
    lastHitAt: now,
  })
}

/**
 * Get cache health stats (for /admin/cache-stats endpoint or logging).
 */
export function getCacheStats(): CacheStats {
  const total = totalHits + totalMisses
  return {
    totalEntries:         cache.length,
    totalHits,
    totalMisses,
    hitRate:              total > 0 ? totalHits / total : 0,
    estimatedTokensSaved: totalSavedTokens,
  }
}

/**
 * Clear cache for a specific session (call on session end / logout).
 */
export function clearSessionCache(sessionId: string): void {
  for (let i = cache.length - 1; i >= 0; i--) {
    if (cache[i].sessionId === sessionId) cache.splice(i, 1)
  }
}

/**
 * Whether caching is enabled for this domain.
 * Useful for UI/logging to indicate cache eligibility.
 */
export function isCacheable(domain: DomainType): boolean {
  return !NO_CACHE_DOMAINS.has(domain)
}

/**
 * Whether this domain is in the high-value cache tier
 * (expect >15% hit rate in production).
 */
export function isHighCacheDomain(domain: DomainType): boolean {
  return HIGH_CACHE_DOMAINS.has(domain)
}

/**
 * Returns the active cosine similarity threshold used for cache hits.
 * Reflects the CTS_CACHE_THRESHOLD env var if set, otherwise the compiled default.
 */
export function getActiveCacheThreshold(): number {
  return ACTIVE_THRESHOLD
}

