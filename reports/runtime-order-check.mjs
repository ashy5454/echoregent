import { loadNativeEncoder } from '../src/cts-core/native-encoder.ts'
const transformers=await import('@xenova/transformers')
transformers.env.localModelPath=`${process.cwd()}/ml`;transformers.env.allowRemoteModels=false
const tok=await transformers.AutoTokenizer.from_pretrained('cts_relevance')
const t=tok(['Runtime order verification'],{padding:true,truncation:true}).input_ids
const encoder=await loadNativeEncoder('cts_relevance')
const vectors=await encoder(['Runtime order verification'])
if(vectors[0].length!==384)throw new Error('Invalid encoder')
console.log('Transformers-first native runtime load: PASS')
