import ort from 'onnxruntime-node'
import { AutoTokenizer, env } from '@xenova/transformers'
import { performance } from 'node:perf_hooks'
env.localModelPath = `${process.cwd()}/ml`
env.allowRemoteModels = false
const tokenizer = await AutoTokenizer.from_pretrained('cts_relevance')
const provider=process.argv[3]??'cpu'
const session = await ort.InferenceSession.create(process.argv[2]??'reports/relevance-candidate/model_quantized.onnx', { executionProviders: [provider], intraOpNumThreads:Number(process.argv[4]??8), interOpNumThreads:1, enableMemPattern:provider!=='dml', executionMode:'sequential' })
const texts = Array.from({length:33},(_,i)=>`Turn ${i}: My TypeScript Express API returns 500 from /api/users/${i}. PostgreSQL reports a connection timeout. How do I debug this?`)
for(let i=0;i<8;i++) {
  const a=performance.now()
  const inputs=tokenizer(texts,{padding:true,truncation:true})
  const b=performance.now()
  const feeds=Object.fromEntries(session.inputNames.map(key=>[key,new ort.Tensor(inputs[key].type,inputs[key].data,inputs[key].dims)]))
  const outputs=await session.run(feeds)
  const c=performance.now()
  const tensor=outputs.last_hidden_state
  const [batch,length,dim]=tensor.dims
  const vectors=[]
  for(let row=0;row<batch;row++) {const vector=new Float32Array(dim);let count=0;for(let token=0;token<length;token++){if(inputs.attention_mask.data[row*length+token]===0n)continue;count++;for(let k=0;k<dim;k++)vector[k]+=tensor.data[(row*length+token)*dim+k]}let norm=0;for(let k=0;k<dim;k++){vector[k]/=count;norm+=vector[k]**2}norm=Math.sqrt(norm);for(let k=0;k<dim;k++)vector[k]/=norm;vectors.push(vector)}
  const d=performance.now()
  console.log({tokenize:b-a,inference:c-b,pool:d-c,total:d-a,first:Array.from(vectors[0].slice(0,4))})
}
await session.release()
