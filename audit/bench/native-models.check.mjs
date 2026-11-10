// Run with npm run test:models.
// Real local models are required; no fallback timings or mocked embeddings.
import test from 'node:test'
import assert from 'node:assert/strict'
import { scoreRelevance, getRelevanceHealth } from '../../src/cts-core/ml-relevance.ts'
import { storeCache, checkCache, getSemanticCacheHealth, clearSessionCache } from '../../src/cts-core/semantic-cache.ts'
import { classifyDomainML, getClassifierHealth } from '../../src/cts-core/ml-classifier.ts'
import { compressHistoryML } from '../../src/cts-core/compressor.ts'
import { classifyAsync } from '../../src/cts-core/classifier.ts'
import { loadNativeEncoder } from '../../src/cts-core/native-encoder.ts'

test('fresh 40-message ML compression stays below the 30ms request budget', async () => {
  const times=[]
  for(let trial=0;trial<25;trial++){
    const messages=Array.from({length:40},(_,i)=>({role:i%2===0?'assistant':'user',content:`Request ${trial} turn ${i}: The TypeScript Express endpoint /api/users/${i} returns error 500 and PostgreSQL reports a database connection timeout.`}))
    const started=performance.now()
    const frame=await classifyAsync(messages.at(-1).content,messages)
    await checkCache(messages.at(-1).content,frame.domain,'fresh-latency-test')
    const result=await compressHistoryML(messages,frame)
    JSON.stringify(result.compressed)
    const elapsed=performance.now()-started
    if(trial>=10) times.push(elapsed)
    assert(result.compressed.some(message=>message.content===messages.at(-1).content),'Current turn must survive')
  }
  times.sort((a,b)=>a-b)
  assert(times[14]<30,`Fresh preprocessing p95=${times[14].toFixed(2)}ms must be <30ms`)
})

test('classifier loads trained weights and distinguishes product domains', async () => {
  const probes=[
    ['coding','My TypeScript build fails with a compiler error after upgrading React.'],
    ['customer_support','I need to cancel my order and get a refund for a damaged item.'],
    ['medical','Could lisinopril cause a dry cough and affect my blood pressure?'],
    ['legal','What are the termination clauses and liability obligations in this employment contract?'],
    ['commerce','Is this wireless keyboard compatible with a MacBook and does it include batteries?'],
    ['education','Explain photosynthesis for my biology homework and how plants produce oxygen.'],
    ['sales','We are comparing enterprise plans for 80 seats; can you prepare a discounted annual quote?'],
    ['general','Please help me plan a restaurant visit and find a hotel near the train station.'],
  ]
  for(const [label,text] of probes){
    const result=await classifyDomainML(text)
    assert.equal(result.label,label,text)
  }
  assert(getClassifierHealth().loaded)
  for(const text of ['__proto__','Why does my function fail on __proto__?']){
    const result=await classifyDomainML(text)
    assert(['coding','commerce','customer_support','education','general','legal','medical','sales'].includes(result.label))
    assert(Number.isFinite(result.score))
  }
})

test('uncertain ML routing preserves legal signals and neutral greetings', async () => {
  assert.equal((await classifyAsync('Can you check if my contract is enforceable?')).domain,'legal')
  assert.equal((await classifyAsync('hi')).domain,'general')
  const tenant = await classifyAsync('My landlord kept the deposit even though I left the flat spotless.')
  assert.equal(tenant.domain,'legal')
  assert(tenant.risk.includes('legal_caution'))
})

test('relevance reports the same ranking alone and beside padded messages', async () => {
  const query = 'What is the refund status for order ORD-55128?'
  const relevant = {role:'user',content:'A refund for order ORD-55128 was requested because the keyboard arrived damaged.'}
  const distractor = {role:'assistant',content:'Sounds good.'}
  // Direct calls deliberately avoid the message embedding cache.
  const encode = await loadNativeEncoder('cts_relevance')
  const dot = (a,b) => a.reduce((sum,value,index)=>sum+value*b[index],0)
  const a = await encode([query,relevant.content,distractor.content])
  const b = await encode([query,relevant.content,distractor.content,'x '.repeat(220)])
  const small = [dot(a[0],a[1]),dot(a[0],a[2])]
  const large = [dot(b[0],b[1]),dot(b[0],b[2])]
  assert(small[0]>small[1] && large[0]>large[1])
  assert(Math.abs(small[0]-large[0])<0.025)
})

test('cache misses when history or system context changes', async () => {
  const query='Which one should I choose?'
  const response='Choose the lightweight keyboard because it fits your stated preference and budget.'
  const context={history:[{role:'user',content:'I prefer a quiet keyboard.'}],systemPrompt:'Recommend products under $100.'}
  await storeCache(query,response,'commerce','context-test',context)
  assert.equal((await checkCache(query,'commerce','context-test',context)).hit,true)
  assert.equal((await checkCache(query,'commerce','context-test',{...context,history:[{role:'user',content:'I need tactile clicks.'}]})).hit,false)
  assert.equal((await checkCache(query,'commerce','context-test',{...context,systemPrompt:'Recommend products under $30.'})).hit,false)
  clearSessionCache('context-test')
})

test('cache does not collapse long queries with identical prefixes', async () => {
  const prefix='I have a question about this product. '.repeat(20)
  await storeCache(prefix+'I want red.', 'Select the red variant from the product page and add it to your shopping cart.', 'commerce','long-query-test')
  assert.equal((await checkCache(prefix+'I want blue.','commerce','long-query-test')).hit,false)
  clearSessionCache('long-query-test')
})

test('cache distinguishes changed order identifiers in the current query', async () => {
  const query='What is the refund status for order ORD-55128?'
  const response='The refund for order ORD-55128 was processed and should reach your account soon.'
  const context={history:[],systemPrompt:'Help with order refunds.'}
  await storeCache(query,response,'customer_support','order-cache',context)
  assert.equal((await checkCache(query,'customer_support','order-cache',context)).hit,true)
  assert.equal((await checkCache('What is the refund status for order ORD-55129?','customer_support','order-cache',context)).hit,false)
  clearSessionCache('order-cache')
})

test('compression preserves an older preference and its negation', async () => {
  const preference='I prefer a compact keyboard and do not want a model with loud clicks.'
  const messages=[{role:'user',content:preference},...Array.from({length:36},(_,i)=>({role:i%2?'user':'assistant',content:`We compared product variant ${i} and its shipping options.`})),{role:'user',content:'Which keyboard would suit my stated preferences?'}]
  const result=await compressHistoryML(messages,await classifyAsync(messages.at(-1).content,messages))
  assert(result.compressed.some(message=>message.content.includes(preference)),'Keep preference and negation together, not a detached token list')
  assert.equal(result.compressed.at(-1).content,messages.at(-1).content,'Current question must follow rescued older preferences')
})

test('neural compression retrieves an older paraphrased troubleshooting observation', async () => {
  const observation='The requests hang until the socket closes; restarting the pool brings them back.'
  const messages=[{role:'user',content:observation},...Array.from({length:36},(_,i)=>({role:i%2?'user':'assistant',content:`The TypeScript compiler error in function build${i} has been fixed.`})),{role:'user',content:'Why does the API stall until I reset the connections?'}]
  const result=await compressHistoryML(messages,await classifyAsync(messages.at(-1).content,messages))
  assert(result.compressed.some(message=>message.content===observation),'Semantic recall should reach beyond the keyword shortlist')
})

test('rescued preference turns retain chronological order', async () => {
  const preference='I prefer Python and do not want a JavaScript solution.'
  const current='How should I diagnose the PostgreSQL connection timeout?'
  const messages=[{role:'user',content:preference},...Array.from({length:36},(_,i)=>({role:i%2?'user':'assistant',content:`Turn ${i}: The TypeScript API endpoint /api/users/${i} returns error 500. The PostgreSQL connection pool times out under load; inspect the stack trace and retry behavior.`})),{role:'user',content:current}]
  const result=await compressHistoryML(messages,await classifyAsync(current,messages))
  assert.equal(result.compressed.at(-1).content,current,'Earlier rescued turn must not follow the current question')
})

test('repeated current query retains the latest occurrence', async () => {
  const query='I need a Python solution for the API timeout.'
  const messages=[{role:'user',content:query},...Array.from({length:36},(_,i)=>({role:i%2?'user':'assistant',content:`Turn ${i}: TypeScript function build${i} has a compiler error in the API handler.`})),{role:'user',content:query}]
  const result=await compressHistoryML(messages,await classifyAsync(query,messages))
  assert.equal(result.compressed.at(-1),messages.at(-1),'Repeated query must keep the current turn identity and position')
})

test('restored semantic model serves an identical query and respects session isolation', async () => {
  const query='How do I reset my account password?'
  const response='Open account settings, select reset password, and follow the link sent to your registered email address.'
  await storeCache(query,response,'customer_support','native-model-test')
  assert(getSemanticCacheHealth().loaded,'Semantic model weights must be installed')
  const match=await checkCache(query,'customer_support','native-model-test')
  assert.equal(match.hit,true)
  assert.equal(match.response,response)
  assert.equal((await checkCache(query,'customer_support','different-session')).hit,false)
  clearSessionCache('native-model-test')
})
