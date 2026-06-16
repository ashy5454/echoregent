/**
 * ml-t5.ts
 * --------
 * Loads the fine-tuned T5-small ONNX model once and exposes a local
 * summarizer plus production-readable model health.
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

let _pipe: unknown = null
let _inflightLoad: Promise<unknown> | null = null
let health: ModelHealth = { name: 'cts_t5', status: 'not_loaded', loaded: false }

function setHealth(status: ModelStatus, error?: unknown): void {
  health = {
    name: 'cts_t5',
    status,
    loaded: status === 'ready',
    loadedAt: status === 'ready' ? new Date().toISOString() : health.loadedAt,
    lastError: error ? (error instanceof Error ? error.message : String(error)) : undefined,
  }
}

export function getT5Health(): ModelHealth {
  return { ...health }
}

async function getPipeline(): Promise<PipelineFn> {
  if (_pipe) return _pipe as PipelineFn

  if (!_inflightLoad) {
    setHealth('loading')
    _inflightLoad = (async () => {
      try {
        const loadModule = new Function("return import('@xenova/transformers')") as () => Promise<Record<string, unknown>>
        const mod = await loadModule()
        const pipelineFactory = mod.pipeline as (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>
        const envRef = mod.env as TransformerEnv
        envRef.localModelPath = join(process.cwd(), 'ml')
        envRef.allowRemoteModels = false

        const created = await pipelineFactory('text2text-generation', 'cts_t5', {
          quantized: false,
        })
        _pipe = created
        _inflightLoad = null
        setHealth('ready')
        console.log('[CTS] T5 summarizer loaded')
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

/**
 * Generate a compact CTS memory summary for a conversation history.
 * Input format: "summarize: DOMAIN:{domain} User: ... Assistant: ..."
 */
export async function summarizeWithT5(input: string): Promise<string> {
  const pipe = await getPipeline()
  const result = await pipe(input.slice(0, 2000), {
    max_new_tokens: 120,
    num_beams: 4,
    early_stopping: true,
  })
  const top = Array.isArray(result) ? result[0] : result
  return String((top as { generated_text?: string; summary_text?: string }).generated_text ?? (top as { summary_text?: string }).summary_text ?? top).trim()
}

export async function warmUpT5(): Promise<void> {
  try {
    await summarizeWithT5('summarize: DOMAIN:general User: warmup')
  } catch (err) {
    console.warn('[CTS] T5 warm-up failed, compressor will use rule fallback:', err)
  }
}
