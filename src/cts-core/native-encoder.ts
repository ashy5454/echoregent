import { join } from 'node:path'
import { loadTransformersRuntime } from './transformers-runtime'

export type NativeEncoder = (texts: string[]) => Promise<number[][]>

/** Tokenize with the existing tokenizer, but infer and pool in native ONNX. */
export async function loadNativeEncoder(name: string): Promise<NativeEncoder> {
  const load = new Function('name', 'return import(name)') as (name: string) => Promise<any>
  const runtimeModule = await load('onnxruntime-node')
  const transformers = await loadTransformersRuntime()
  const runtime = runtimeModule.default ?? runtimeModule
  transformers.env.localModelPath = join(process.cwd(), 'ml')
  transformers.env.allowRemoteModels = false
  const tokenizer = await transformers.AutoTokenizer.from_pretrained(name)
  // A single-query cache encoder must not keep eight workers spinning while
  // the relevance encoder runs its batch on the same CPU.
  const defaultThreads = name === 'cts_minilm' ? 1 : 8
  const requested = Number((name === 'cts_minilm' ? process.env.CTS_CACHE_ONNX_THREADS : process.env.CTS_ONNX_THREADS) ?? defaultThreads)
  const threads = Number.isInteger(requested) && requested >= 1 && requested <= 16 ? requested : defaultThreads
  const session = await runtime.InferenceSession.create(join(process.cwd(), 'ml', name, 'onnx', 'model_pooled_quantized.onnx'), {
    executionProviders: ['cpu'], intraOpNumThreads: threads, interOpNumThreads: 1,
    graphOptimizationLevel: 'all',
    extra: { session: { intra_op: { allow_spinning: name === 'cts_minilm' ? '0' : '1' } } },
  })
  return async (texts: string[]): Promise<number[][]> => {
    if (texts.length === 0) return []
    const inputs = tokenizer(texts, { padding: true, truncation: true })
    const feeds: Record<string, unknown> = {}
    for (const key of session.inputNames) {
      const tensor = inputs[key]
      if (!tensor) throw new Error(`Missing encoder input ${key}`)
      const source = tensor.data ?? tensor.cpuData
      const data = tensor.type === 'int64' ? BigInt64Array.from(source, (value: bigint | number) => BigInt(value)) : source
      feeds[key] = new runtime.Tensor(tensor.type, data, tensor.dims)
    }
    const output = (await session.run(feeds)).sentence_embedding
    if (!output || output.dims[0] !== texts.length || output.dims.length !== 2) {
      throw new Error('Invalid sentence embedding output')
    }
    const width = output.dims[1]
    return texts.map((_, index) => Array.from(output.data.slice(index * width, (index + 1) * width)) as number[])
  }
}
