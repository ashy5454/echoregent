/**
 * ml-relevance.ts
 * ---------------
 * Loads the fine-tuned cts_relevance ONNX model (all-MiniLM-L6-v2 bi-encoder)
 * and exposes relevance scoring for compression history selection.
 *
 * When the model is absent (ml/cts_relevance/ not found), all functions
 * degrade gracefully:
 *   - scoreRelevance() returns an array of zeros, same length as messages
 *   - No exception is thrown to the caller
 *
 * The model is loaded lazily on first use and cached for the process lifetime.
 * Preferred weights: ml/cts_relevance/onnx/model_pooled_quantized.onnx
 */

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { loadNativeEncoder } from './native-encoder'
import { loadTransformersRuntime } from './transformers-runtime'
import type { Message } from './types'

type TransformerEnv = {
  localModelPath: string
  allowRemoteModels: boolean
}

type PipelineFn = (text: string | string[], opts: Record<string, unknown>) => Promise<unknown>
type ModelStatus = 'not_loaded' | 'loading' | 'ready' | 'failed'

export interface RelevanceModelHealth {
  name: string
  status: ModelStatus
  loaded: boolean
  loadedAt?: string
  lastError?: string
  version?: string | null
}

let _pipe: PipelineFn | null = null
let _inflightLoad: Promise<PipelineFn | null> | null = null
let _health: RelevanceModelHealth = { name: 'cts_relevance', status: 'not_loaded', loaded: false }

function setHealth(status: ModelStatus, error?: unknown, version?: string | null): void {
  _health = {
    name: 'cts_relevance',
    status,
    loaded: status === 'ready',
    loadedAt: status === 'ready' ? new Date().toISOString() : _health.loadedAt,
    lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
    version: version ?? _health.version,
  }
}

export function getRelevanceHealth(): RelevanceModelHealth {
  return { ..._health }
}

async function getPipeline(): Promise<PipelineFn | null> {
  if (_pipe) return _pipe

  if (_inflightLoad) {
    await _inflightLoad
    return _pipe
  }

  setHealth('loading')
  _inflightLoad = (async (): Promise<PipelineFn | null> => {
    try {
      if (existsSync(join(process.cwd(), 'ml', 'cts_relevance', 'onnx', 'model_pooled_quantized.onnx'))) {
        const encode = await loadNativeEncoder('cts_relevance')
        _pipe = async (texts) => (await encode(Array.isArray(texts) ? texts : [texts])).map(data => ({ data: Float32Array.from(data) }))
        setHealth('ready')
        return _pipe
      }
      const mod = await loadTransformersRuntime()
      const pipelineFactory = mod.pipeline as (
        task: string,
        model: string,
        options?: Record<string, unknown>
      ) => Promise<PipelineFn>
      const envRef = mod.env as TransformerEnv
      envRef.localModelPath = join(process.cwd(), 'ml')
      envRef.allowRemoteModels = false

      const created = await pipelineFactory('feature-extraction', 'cts_relevance', { quantized: true })
      _pipe = created
      _inflightLoad = null
      setHealth('ready')
      console.log('[CTS] Relevance scorer (cts_relevance) loaded')
      return _pipe
    } catch (err) {
      _inflightLoad = null
      setHealth('failed', err)
      console.warn('[CTS] Relevance scorer unavailable — rule-based fallback active:', (err as Error).message)
      return null
    }
  })()

  await _inflightLoad
  return _pipe
}

// Message embeddings repeat across turns (a history grows by one message, it
// does not rewrite), so caching them turns a 21-forward batch into 1-2 new
// forwards per turn. Bounded to keep memory flat in a long-lived server.
const EMBEDDING_CACHE_MAX = 1024
const embeddingCache = new Map<string, number[]>()

function rememberEmbedding(text: string, vector: number[]): void {
  embeddingCache.set(text, vector)
  if (embeddingCache.size > EMBEDDING_CACHE_MAX) {
    const oldest = embeddingCache.keys().next().value
    if (oldest !== undefined) embeddingCache.delete(oldest)
  }
}

// One batched forward pass for every text not already cached. Calling the
// pipeline once per message serialises dozens of tiny forwards; batching plus
// the cache keeps repeated scoring inside the latency budget.
async function embedBatch(pipe: PipelineFn, texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const keys = texts.map((text) => text.slice(0, 512))
  const missing: string[] = []
  keys.forEach((key) => {
    if (!embeddingCache.has(key) && !missing.includes(key)) missing.push(key)
  })

  if (missing.length > 0) {
    try {
      // @xenova/transformers returns a Tensor: row i is the pooled vector for
      // input i. (For one input the same shape is [1, 384].)
      const output = await pipe(missing, { pooling: 'mean', normalize: true }) as {
        [index: number]: { data: Float32Array }
      }
      const rows = Array.isArray(output)
        ? output
        : Array.from({ length: missing.length }, (_, index) => output[index])
      rows.forEach((row, index) => rememberEmbedding(missing[index], Array.from(row.data)))
    } catch (error) {
      setHealth('failed', error)
      return texts.map(() => [])
    }
  }

  return keys.map((key) => embeddingCache.get(key) ?? [])
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length === 0 || b.length === 0 || a.length !== b.length) return 0
  // Both vectors are L2-normalized (normalize: true above), so cosine = dot product
  let dot = 0
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i]
  return dot
}

export async function scoreRelevance(query: string, messages: Message[]): Promise<number[]> {
  if (messages.length === 0) return []

  try {
    const pipe = await getPipeline()
    if (pipe === null) return Array(messages.length).fill(0.0)

    const vectors = await embedBatch(pipe, [query, ...messages.map((m) => m.content)])
    const queryVec = vectors[0] ?? []
    if (queryVec.length === 0) return Array(messages.length).fill(0.0)

    return messages.map((_, index) => cosineSimilarity(queryVec, vectors[index + 1] ?? []))
  } catch (err) {
    setHealth('failed', err)
    console.warn('[CTS] scoreRelevance error (falling back to zeros):', (err as Error).message)
    return Array(messages.length).fill(0.0)
  }
}

export async function warmUpRelevanceModel(): Promise<void> {
  try {
    await scoreRelevance('warmup query', [{ role: 'user', content: 'warmup message' }])
  } catch (err) {
    console.warn('[CTS] Relevance model warm-up failed:', err)
  }
}
