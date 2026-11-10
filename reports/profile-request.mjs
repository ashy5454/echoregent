import { performance } from 'node:perf_hooks'
import { classifyAsync } from '../src/cts-core/classifier.ts'
import { compressHistoryML } from '../src/cts-core/compressor.ts'
import { checkCache, warmUpSemanticCache } from '../src/cts-core/semantic-cache.ts'
const stats=[]
if(!process.argv.includes('--no-cache')) await warmUpSemanticCache()
for(let i=0;i<60;i++){
 const messages=Array.from({length:40},(_,j)=>({role:j%2?'user':'assistant',content:`Fresh ${i} Turn ${j}: My TypeScript Express API returns 500 from /api/users/${j}. PostgreSQL reports a connection timeout. How do I debug this?`}))
 const query=messages.at(-1).content
 const a=performance.now();const frame=await classifyAsync(query,messages);const b=performance.now()
 if(!process.argv.includes('--no-cache'))await checkCache(query,frame.domain,'profile',{history:messages.slice(0,-1)})
 const c=performance.now();const result=await compressHistoryML(messages,frame);JSON.stringify(result.compressed);const d=performance.now()
 if(i>=10)stats.push({classify:b-a,cache:c-b,compress:d-c,total:d-a})
}
for(const key of ['classify','cache','compress','total']){
 const values=stats.map(x=>x[key]).sort((a,b)=>a-b);console.log(key,{p50:values[24],p95:values[47]})
}
