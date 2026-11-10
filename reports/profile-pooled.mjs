import ort from 'onnxruntime-node'
import { AutoTokenizer, env } from '@xenova/transformers'
import { performance } from 'node:perf_hooks'
env.localModelPath = `${process.cwd()}/ml`
env.allowRemoteModels = false
const tokenizer = await AutoTokenizer.from_pretrained('cts_relevance')
const provider=process.argv[3]??'cpu'
const session = await ort.InferenceSession.create(process.argv[2]??'reports/relevance-candidate/model_quantized_pooled.onnx', {
 executionProviders:provider==='dml'?[{name:'dml',deviceId:Number(process.argv[4]??0)}]:['cpu'],
 intraOpNumThreads:Number(process.argv[4]??8),interOpNumThreads:1,enableMemPattern:provider!=='dml',executionMode:'sequential',logSeverityLevel:3 })
for(const count of [1,21,33]){
 const texts=Array.from({length:count},(_,i)=>`Turn ${i}: My TypeScript Express API returns 500 from /api/users/${i}. PostgreSQL reports a connection timeout. How do I debug this?`)
 const times=[]
 for(let i=0;i<15;i++){
  const a=performance.now()
  const inputs=tokenizer(texts,{padding:true,truncation:true})
  const feeds=Object.fromEntries(session.inputNames.map(key=>[key,new ort.Tensor(inputs[key].type,inputs[key].data,inputs[key].dims)]))
  const outputs=await session.run(feeds)
  if(i>=5)times.push(performance.now()-a)
  if(i===14)console.log('sample',outputs.sentence_embedding.dims,Array.from(outputs.sentence_embedding.data.slice(0,4)))
 }
 times.sort((a,b)=>a-b)
 console.log({count,provider,device:process.argv[4],p50:times[4],p90:times[8]})
}
await session.release()
