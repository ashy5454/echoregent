import { performance } from 'node:perf_hooks'
import ort from 'onnxruntime-node'
import { AutoTokenizer, env } from '@xenova/transformers'
env.localModelPath = `${process.cwd()}/ml`
env.allowRemoteModels = false
const tokenizer = await AutoTokenizer.from_pretrained('cts_relevance')
for (const threads of [1, 2, 4, 8]) {
 for (const spinning of ['1', '0']) {
  const session = await ort.InferenceSession.create('ml/cts_relevance/onnx/model_pooled_quantized.onnx', {
   executionProviders:['cpu'], intraOpNumThreads:threads, interOpNumThreads:1,
   extra:{session:{intra_op:{allow_spinning:spinning}}}
  })
  for (const count of [9, 13, 21]) {
   const times=[]
   for(let trial=0;trial<60;trial++) {
    const started=performance.now()
    const texts=Array.from({length:count},(_,i)=>`Fresh ${trial} turn ${i}: My TypeScript Express API returns 500 from /api/users/${i}. PostgreSQL reports a connection timeout. How do I debug this?`)
    const inputs=tokenizer(texts,{padding:true,truncation:true})
    const feeds=Object.fromEntries(session.inputNames.map(key=>{
     const tensor=inputs[key]
     return [key,new ort.Tensor(tensor.type,BigInt64Array.from(tensor.data??tensor.cpuData,BigInt),tensor.dims)]
    }))
    await session.run(feeds)
    if(trial>=10)times.push(performance.now()-started)
   }
   times.sort((a,b)=>a-b)
   console.log(JSON.stringify({threads,spinning,count,p50:times[24],p95:times[47]}))
  }
  await session.release()
 }
}
