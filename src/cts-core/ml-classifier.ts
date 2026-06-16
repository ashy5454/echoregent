/**
 * ml-classifier.ts
 * ----------------
 * Loads the trained DistilBERT ONNX model once and exposes domain
 * classification plus production-readable model health.
 */

import { join } from 'node:path'

type TransformerEnv = {
  localModelPath: string
  allowRemoteModels: boolean
}

type PipelineFn = (text: string, opts: Record<string, unknown>) => Promise<unknown>
type ModelStatus = 'not_loaded' | 'loading' | 'ready' | 'failed'

export interface ModelHealth {
  name: string
  status: ModelStatus
  loaded: boolean
  loadedAt?: string
  lastError?: string
}

let pipelineFactory: ((task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>) | null = null
let envRef: TransformerEnv | null = null
let _pipe: unknown = null
let _inflightLoad: Promise<unknown> | null = null
let health: ModelHealth = { name: 'cts_classifier', status: 'not_loaded', loaded: false }

function setHealth(status: ModelStatus, error?: unknown): void {
  health = {
    name: 'cts_classifier',
    status,
    loaded: status === 'ready',
    loadedAt: status === 'ready' ? new Date().toISOString() : health.loadedAt,
    lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
  }
}

export function getClassifierHealth(): ModelHealth {
  return { ...health }
}

async function ensureTransformers(): Promise<void> {
  if (pipelineFactory && envRef) return

  const loadModule = new Function("return import('@xenova/transformers')") as () => Promise<Record<string, unknown>>
  const mod = await loadModule()
  pipelineFactory = mod.pipeline as typeof pipelineFactory
  envRef = mod.env as TransformerEnv
  envRef.localModelPath = join(process.cwd(), 'ml')
  envRef.allowRemoteModels = false
}

async function getPipeline(): Promise<PipelineFn> {
  if (_pipe) return _pipe as PipelineFn

  if (!_inflightLoad) {
    setHealth('loading')
    _inflightLoad = (async () => {
      try {
        await ensureTransformers()
        const created = await pipelineFactory!('text-classification', 'cts_classifier', {
          quantized: false,
        })
        _pipe = created
        _inflightLoad = null
        setHealth('ready')
        console.log('[CTS] DistilBERT classifier loaded')
        return created
      } catch (err) {
        _inflightLoad = null
        setHealth('failed', err)
        throw err
      }
    })()
  }

  await _inflightLoad
  return _pipe as PipelineFn
}

export interface MLResult {
  label: string
  score: number
}

export async function classifyDomainML(text: string): Promise<MLResult> {
  const pipe = await getPipeline()
  const result = await pipe(text.slice(0, 512), { truncation: true })
  const top = Array.isArray(result) ? result[0] : result
  return {
    label: String((top as { label: string }).label),
    score: Number((top as { score: number }).score),
  }
}

export async function warmUpClassifier(): Promise<void> {
  try {
    await classifyDomainML('warmup')
  } catch (err) {
    console.warn('[CTS] classifier warm-up failed, will use keyword fallback:', err)
  }
}
