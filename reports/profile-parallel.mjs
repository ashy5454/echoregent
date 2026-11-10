import ort from 'onnxruntime-node'
import { AutoTokenizer, env } from '@xenova/transformers'
import { performance } from 'node:perf_hooks'
env.localModelPath=`${process.cwd()}/ml`;env.allowRemoteModels=false
const tokenizer=await AutoTokenizer.from_pretrained('cts_relevance')
for(const [threads,chunks] of [[8,1],[4,2],[2,4],[1,4],[1,8]]){
 const sessions=await Promise.all(Array.from({length:chunks},()=>ort.InferenceSession.create('ml/cts_relevance/onnx/model_pooled_quantized.onnx',{executionProviders:['cpu'],intraOpNumThreads:threads,interOpNumThreads:1})))
 const times=[]
 for(let i=0;i<15;i++){
  const texts=Array.from({length:37},(_,j)=>`Fresh ${i} Turn ${j}: My TypeScript Express API returns 500 from /api/users/${j}. PostgreSQL reports a connection timeout. How do I debug this?`)
  const start=performance.now();
  await Promise.all(sessions.map(async(session,index)=>{
   const input=texts.slice(Math.ceil(texts.length/chunks)*index,Math.ceil(texts.length/chunks)*(index+1))
   const inputs=tokenizer(input,{padding:true,truncation:true})
   const feeds=Object.fromEntries(session.inputNames.map(key=>[key,new ort.Tensor(inputs[key].type,inputs[key].data,inputs[key].dims)]))
   return session.run(feeds)
  }))
  if(i>=5)times.push(performance.now()-start)
 }
 times.sort((a,b)=>a-b);console.log({threads,chunks,p50:times[4],p90:times[8]})
 for(const session of sessions)await session.release()
}
