/**
 * ml-classifier.ts
 * ----------------
 * Loads compact trained weights (or the legacy DistilBERT model) and exposes domain
 * classification plus production-readable model health.
 */

import { join } from 'node:path'
import { readFileSync, existsSync } from 'node:fs'
import { loadTransformersRuntime } from './transformers-runtime'
import { loadCompactClassifier } from './compact-classifier'

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
  labelMapSize?: number
  architecture?: 'compact_tfidf' | 'distilbert'
}

let pipelineFactory: ((task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>) | null = null
let envRef: TransformerEnv | null = null
let _pipe: unknown = null
let _inflightLoad: Promise<unknown> | null = null
let health: ModelHealth = { name: 'cts_classifier', status: 'not_loaded', loaded: false }
let labelMap: Map<number, string> | null = null

function loadLabelMap(modelDir: string): Map<number, string> | null {
  try {
    const raw = readFileSync(join(modelDir, 'label_map.json'), 'utf-8')
    const obj = JSON.parse(raw) as Record<string, string>
    const map = new Map<number, string>()
    for (const [k, v] of Object.entries(obj)) {
      map.set(Number(k), v)
    }
    return map
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      console.warn('[CTS] label_map.json absent for cts_classifier — rule-based fallback active')
    } else {
      console.warn(`[CTS] label_map.json unreadable: ${msg} — rule-based fallback active`)
    }
    return null
  }
}

function setHealth(status: ModelStatus, error?: unknown): void {
  health = {
    name: 'cts_classifier',
    status,
    loaded: status === 'ready',
    loadedAt: status === 'ready' ? new Date().toISOString() : health.loadedAt,
    lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
    ...(status === 'ready' ? { labelMapSize: labelMap?.size ?? 0, architecture: health.architecture } : {}),
  }
}

export function getClassifierHealth(): ModelHealth {
  return { ...health }
}

export function getLabelMap(): Map<number, string> | null {
  return labelMap
}

async function ensureTransformers(): Promise<void> {
  if (pipelineFactory && envRef) return

  const mod = await loadTransformersRuntime()
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
        const compactPath = join(process.cwd(), 'ml', 'cts_classifier', 'compact_weights.json')
        if (existsSync(compactPath)) {
          const classify = loadCompactClassifier(compactPath)
          labelMap = loadLabelMap(join(process.cwd(), 'ml', 'cts_classifier'))
          _pipe = async (text: string) => [classify(text)]
          health.architecture = 'compact_tfidf'
          setHealth('ready')
          return _pipe
        }
        await ensureTransformers()
        const created = await pipelineFactory!('text-classification', 'cts_classifier', {
          quantized: false,
        })
        labelMap = loadLabelMap(join(process.cwd(), 'ml', 'cts_classifier'))
        if (labelMap) {
          console.log(`[CTS] cts_classifier label_map loaded: ${labelMap.size} classes`)
        }
        _pipe = created
        health.architecture = 'distilbert'
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
  const rawLabel = String((top as { label: string }).label)
  const score = Number((top as { score: number }).score)

  // Map LABEL_N integer labels to domain strings when label_map.json is available
  let label = rawLabel
  const match = rawLabel.match(/^LABEL_(\d+)$/)
  if (match && labelMap) {
    label = labelMap.get(Number(match[1])) ?? rawLabel
  }

  return { label, score }
}

export async function warmUpClassifier(): Promise<void> {
  try {
    await classifyDomainML('warmup')
  } catch (err) {
    console.warn('[CTS] classifier warm-up failed, will use keyword fallback:', err)
  }
}
