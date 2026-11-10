import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { classifyAsync } from '../../src/cts-core/classifier'
import { classifyDomainML, getClassifierHealth } from '../../src/cts-core/ml-classifier'
import { scoreRelevance, getRelevanceHealth } from '../../src/cts-core/ml-relevance'
import { warmUpSemanticCache, checkCache, storeCache, getSemanticCacheHealth, clearSessionCache } from '../../src/cts-core/semantic-cache'
import { compressHistoryML } from '../../src/cts-core/compressor'
import type { Message } from '../../src/cts-core/types'

const runs=100, warmups=10
const stress=process.argv.includes('--stress')
let sequence=0
const results: Record<string,unknown>[]=[]
function history(tag: string):Message[]{
 return Array.from({length:40},(_,i)=>({role:i%2===0?'assistant':'user',content:(i%2===0
 ?`${tag} Turn ${i}: Check the TypeScript Express handler /api/users/${i}, its database connection, and the stack trace for the 500 error.`
 :`${tag} Turn ${i}: My TypeScript Express API returns 500 from /api/users/${i}. PostgreSQL reports a connection timeout. How do I debug this?`) + (stress ? ' The service waits for a connection, hangs during a burst, and recovers after a restart. We need to understand pool limits, backpressure, retries, resource leaks, and the timeout sequence before changing the configuration.'.repeat(4) : '')}))
}
async function measure(name:string, fn:()=>Promise<unknown>, target_ms:number){
 for(let i=0;i<warmups;i++) await fn()
 const raw_ms=[]
 for(let i=0;i<runs;i++){const started=performance.now();await fn();raw_ms.push(performance.now()-started)}
 const sorted=[...raw_ms].sort((a,b)=>a-b)
 const result={name,runs,warmups,p50_ms:sorted[49],p95_ms:sorted[94],p99_ms:sorted[98],target_ms,passed:sorted[94]<target_ms,raw_ms}
 results.push(result)
 console.log(`${name}: p50=${result.p50_ms.toFixed(2)}ms p95=${result.p95_ms.toFixed(2)}ms (${result.passed?'PASS':'FAIL'} <${target_ms}ms)`)
}

async function main(){
 await classifyDomainML('A TypeScript compiler error in an Express API')
 await scoreRelevance('Why does the TypeScript API return 500?',[{role:'user',content:'The TypeScript API returns 500.'}])
 await warmUpSemanticCache()
 const verificationQuery='How do I reset my account password?'
 await storeCache(verificationQuery,'Open account settings, select reset password, and follow the email confirmation link.','customer_support','benchmark-check')
 assert((await checkCache(verificationQuery,'customer_support','benchmark-check')).hit,'Cache must actually perform successful inference')
 clearSessionCache('benchmark-check')
 assert(getClassifierHealth().loaded && getRelevanceHealth().loaded && getSemanticCacheHealth().loaded,'Every model must load')
 await measure('classifier_unique_queries',()=>classifyDomainML(`Request ${sequence++}: Why does my TypeScript compiler report an error?`),15)
 await measure('cache_unique_queries',()=>checkCache(`Request ${sequence++}: How do I reset my account password?`,'customer_support','latency'),8)
 await measure('relevance_20_uncached',async()=>{const tag=`relevance-${sequence++}`;const scores=await scoreRelevance(`${tag} Why does my API return 500?`,history(tag).slice(0,20));assert(scores.every(Number.isFinite)&&scores.some(score=>score!==0),'Relevance inference must succeed');return scores},35)
 await measure('aggregate_40_uncached',async()=>{
  const messages=history(`fresh-${sequence++}`)
  const query=messages.at(-1)!.content
  const frame=await classifyAsync(query,messages)
  await checkCache(query,frame.domain,'latency',{history:messages.slice(0,-1),systemPrompt:'Assist with the current task.'})
  const compressed=await compressHistoryML(messages,frame)
  JSON.stringify(compressed.compressed)
 },30)
 const stable=history('stable')
 await measure('aggregate_40_cached_history_new_query',async()=>{
  const messages=[...stable.slice(0,-1),{role:'user' as const,content:`Live ${sequence++}: My TypeScript API returns 500; how do I debug the database connection timeout?`}]
  const query=messages.at(-1)!.content
  const frame=await classifyAsync(query,messages)
  await checkCache(query,frame.domain,'latency',{history:messages.slice(0,-1),systemPrompt:'Assist with the current task.'})
  const compressed=await compressHistoryML(messages,frame)
  JSON.stringify(compressed.compressed)
 },30)
 assert(getClassifierHealth().loaded && getRelevanceHealth().loaded && getSemanticCacheHealth().loaded,'No model may silently fall back during measurement')
 const report={timestamp:new Date().toISOString(),scope:stress ? 'Local CPU, fresh40 long coding messages ~1000 chars (~200 tokens); relevance embeds first512 chars and response cache safely skips oversized queries.' : 'Local CPU, full production functions, fresh unique texts, cached histories reported separately; short coding messages ~140 chars, not maximum 200-token stress inputs.',health:{classifier:getClassifierHealth(),relevance:getRelevanceHealth(),cache:getSemanticCacheHealth()},results}
 const path=`reports/model_latency_${Date.now()}.json`
 writeFileSync(path,JSON.stringify(report,null,2)+'\n')
 console.log('Saved',path)
 if(results.some(result=>result.passed!==true))process.exitCode=1
}
main().catch(error=>{console.error(error);process.exitCode=1})
