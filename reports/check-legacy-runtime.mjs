import { loadTransformersRuntime } from '../src/cts-core/transformers-runtime.ts'
const { pipeline, env } = await loadTransformersRuntime()
env.localModelPath=`${process.cwd()}/ml`
env.allowRemoteModels=false
const encode=await pipeline('feature-extraction','cts_relevance',{quantized:true})
const result=await encode(['Test the old feature extraction fallback.'],{pooling:'mean',normalize:true})
const data=result.data??result.cpuData
if(!data || !data.length || !Array.from(data).every(Number.isFinite))throw new Error('Legacy embeddings invalid')
console.log('Legacy Transformers feature extraction: PASS',result.dims)
