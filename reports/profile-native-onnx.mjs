import { readFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import ort from 'onnxruntime-node'
import { AutoTokenizer, BertModel, FeatureExtractionPipeline, env } from '@xenova/transformers'

env.localModelPath = `${process.cwd()}/ml`
env.allowRemoteModels = false
const modelPath = process.argv[2] ?? 'ml/cts_relevance/onnx/model_quantized.onnx'
const tokenizer = await AutoTokenizer.from_pretrained('cts_relevance')
const config = JSON.parse(readFileSync('ml/cts_relevance/config.json', 'utf8'))
const texts = Array.from({ length: 33 }, (_, i) => `Turn ${i}: My TypeScript Express API returns 500 from /api/users/${i}. PostgreSQL reports a connection timeout. How do I debug this?`)
const provider = process.argv[3] ?? 'cpu'
for (const threads of provider === 'cpu' ? [1, 2, 4, 8] : [4]) {
  const session = await ort.InferenceSession.create(modelPath, { executionProviders: [provider], intraOpNumThreads: threads, interOpNumThreads: 1, graphOptimizationLevel: 'all', executionMode: 'sequential', enableMemPattern: provider !== 'dml' })
  const compatibleSession = {
    inputNames: session.inputNames,
    run: async feeds => session.run(Object.fromEntries(Object.entries(feeds).map(([key, value]) => [key, new ort.Tensor(value.type, value.data, value.dims)]))),
  }
  const model = new BertModel(config, compatibleSession)
  const pipe = new FeatureExtractionPipeline({ task: 'feature-extraction', model, tokenizer })
  for (const count of [1, 21, 33]) {
    for (let i = 0; i < 3; i++) await pipe(texts.slice(0, count), { pooling: 'mean', normalize: true })
    const times = []
    let result
    for (let i = 0; i < 10; i++) { const start = performance.now(); result = await pipe(texts.slice(0, count), { pooling: 'mean', normalize: true }); times.push(performance.now() - start) }
    times.sort((a,b) => a-b)
    console.log(JSON.stringify({ modelPath, threads, batch: count, median_ms: times[4], p90_ms: times[8], dims: result.dims, first: Array.from(result.data.slice(0, 4)) }))
  }
  if (typeof session.release === 'function') await session.release()
}
