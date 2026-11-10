import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, execFileSync } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { EchoRegent } from '../packages/core/dist/index.js'
import { startProxy } from '../packages/cli/dist/proxy.js'
import { buildCodexArgs } from '../packages/cli/dist/codex.js'
import { createUsageCollector } from './benchmark-metrics.mjs'

const root = resolve(import.meta.dirname, '..')
const task = process.argv.includes('--diagnostic')
  ? `Use exec_command once to run node -e "for(let i=0;i<100;i++)console.log('[INFO] fixture input validated')". After the command completes reply DIAGNOSTIC_OK. Do not edit files or run other commands.`
  : `Fix usage.mjs using README.md requirements. First run node test.mjs to observe failures. Read usage.mjs and README.md, then change only usage.mjs. Preserve the caller's input objects. Run node test.mjs again and correct any remaining failures. Do not edit tests or instructions, do not install dependencies, and do not access files outside this workspace. Finally report the changes and test result briefly.`

const files = {
  'AGENTS.md': 'This is an isolated coding benchmark. Work only on the requested fixture files. Do not read external skills, memory, credentials, repositories or configuration. Use shell tools to run tests and edit the requested module.\n',
  'README.md': `# Usage normalizer\n\nRepair normalizeUsage(response) in usage.mjs. Support Responses API usage (input_tokens/output_tokens/input_tokens_details.cached_tokens) and Chat Completions usage (prompt_tokens/completion_tokens/prompt_tokens_details.cached_tokens). Return { inputTokens, cachedInputTokens, uncachedInputTokens, outputTokens, totalTokens }. Input includes cache tokens; do not add them twice. Derive totalTokens from input+output. Missing cache detail means cachedInputTokens and uncachedInputTokens are null, not zero. Never mutate the input. Reject negative, fractional, non-number counts, and cached counts above input with TypeError. Missing usage means return null. No dependencies.\n`,
  'usage.mjs': `export function normalizeUsage(response) {\n  const u = response.usage;\n  if (!u) return null;\n  const inputTokens = u.input_tokens || u.prompt_tokens || 0;\n  const outputTokens = u.output_tokens || u.completion_tokens || 0;\n  const cachedInputTokens = u.input_tokens_details?.cached_tokens || 0;\n  return { inputTokens: inputTokens + cachedInputTokens, cachedInputTokens, uncachedInputTokens: inputTokens, outputTokens, totalTokens: u.total_tokens || 0 };\n}\n`,
  'test.mjs': `import assert from 'node:assert/strict';\nimport { normalizeUsage } from './usage.mjs';\nfor(let i=0;i<600;i++) console.log('[INFO] fixture input validated');\nconst checks = [\n  ['Responses cache accounting',()=>assert.deepEqual(normalizeUsage({usage:{input_tokens:100,output_tokens:20,input_tokens_details:{cached_tokens:40}}}),{inputTokens:100,cachedInputTokens:40,uncachedInputTokens:60,outputTokens:20,totalTokens:120})],\n  ['Chat Completions schema',()=>assert.deepEqual(normalizeUsage({usage:{prompt_tokens:80,completion_tokens:10,prompt_tokens_details:{cached_tokens:30}}}),{inputTokens:80,cachedInputTokens:30,uncachedInputTokens:50,outputTokens:10,totalTokens:90})],\n  ['Absent cache detail is unknown',()=>assert.deepEqual(normalizeUsage({usage:{input_tokens:7,output_tokens:2}}),{inputTokens:7,cachedInputTokens:null,uncachedInputTokens:null,outputTokens:2,totalTokens:9})],\n  ['Zero is valid',()=>assert.deepEqual(normalizeUsage({usage:{input_tokens:0,output_tokens:0,input_tokens_details:{cached_tokens:0}}}),{inputTokens:0,cachedInputTokens:0,uncachedInputTokens:0,outputTokens:0,totalTokens:0})],\n  ['Reject invalid counts',()=>{for(const bad of [-1,1.5,'8',NaN]) assert.throws(()=>normalizeUsage({usage:{input_tokens:bad,output_tokens:1}}),TypeError)}],\n  ['Reject invalid cache',()=>assert.throws(()=>normalizeUsage({usage:{input_tokens:1,output_tokens:2,input_tokens_details:{cached_tokens:3}}}),TypeError)],\n  ['Missing usage',()=>assert.equal(normalizeUsage({}),null)],\n  ['Preserve input',()=>{const input={usage:{input_tokens:7,output_tokens:2,input_tokens_details:{cached_tokens:3}}};const before=JSON.stringify(input);normalizeUsage(input);assert.equal(JSON.stringify(input),before)}],\n];\nlet failures=0;for(const [name,check] of checks){try{check();console.log('PASS '+name)}catch(error){failures++;console.log('FAIL '+name+'\\n'+error.stack)}}\nconsole.log('RESULT '+(checks.length-failures)+'/'+checks.length+' passed');process.exitCode=failures?1:0;\n`,
}

const [arm, runText = '1'] = process.argv.slice(2)
if (!['baseline', 'echoregent'].includes(arm)) throw new Error('Usage: node scripts/live-codex-run.mjs baseline|echoregent [run]')
const run = Number(runText)
if (!Number.isInteger(run) || run < 1) throw new Error('Positive run number required')
const directory = join(root, '.superpowers', 'paired-codex', `run-${run}`, arm)
await mkdir(directory, { recursive: true })
for (const [name, content] of Object.entries(files)) await writeFile(join(directory, name), content)
const codeHome = join(directory, '.codex-home')
await mkdir(codeHome, { recursive: true })
await writeFile(join(codeHome, 'config.toml'), 'approval_policy = "never"\n')

// Read the existing Codex provider credentials into memory only; never log/save them.
const profile = JSON.parse(execFileSync('python', ['-X', 'utf8', '-c', `from pathlib import Path\nimport tomllib,json,os\nc=tomllib.loads((Path.home()/'.codex/config.toml').read_text(encoding='utf-8'))\npid=c.get('model_provider','openai');p=c.get('model_providers',{}).get(pid,{})\na=Path.home()/'.codex/auth.json';a=json.loads(a.read_text()) if a.exists() else {}\nkey=os.environ.get(p.get('env_key',''), '') or p.get('experimental_bearer_token','') or a.get('OPENAI_API_KEY','')\nprint(json.dumps({'model':c.get('model'),'upstream':p.get('base_url',c.get('openai_base_url','https://api.openai.com/v1')),'provider':pid,'key':key,'headers':p.get('http_headers',{}),'envHeaders':{k:os.environ.get(v,'') for k,v in p.get('env_http_headers',{}).items()},'reasoning':c.get('model_reasoning_effort')}))`], { encoding: 'utf8' }))
if (!profile.model || !profile.key) throw new Error('Current Codex model/provider API-key configuration unavailable')
if (profile.reasoning) await writeFile(join(codeHome, 'config.toml'), `approval_policy = "never"\nmodel_reasoning_effort = ${JSON.stringify(profile.reasoning)}\n`)
const redact = (text) => String(text).replaceAll(profile.key, '[redacted]').replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
const calls = []
const transformations = []
const faults = []
class ObservedEngine extends EchoRegent {
  process(body, protocol, scope) {
    const result = super.process(body, protocol, scope)
    const last = Array.isArray(body.input) ? body.input.at(-1) : null
    transformations.push({ changed: result.changed, reason: result.reason, charactersRemoved: result.charactersRemoved, newestItemType: last?.type ?? last?.role ?? null, newestItemFields: last?Object.keys(last):[], newestOutputShape: Array.isArray(last?.output) ? last.output.map(part=>({type:part.type,fields:Object.keys(part)})) : last?.output&&typeof last.output==='object'?{type:'object',fields:Object.keys(last.output)}:typeof last?.output, inputItems: body.input?.length ?? null })
    return result
  }
}
const recorder = createServer(async (req, res) => {
  const started = performance.now()
  const controller = new AbortController()
  res.on('close', () => { if (!res.writableFinished) controller.abort() })
  const call = { status: null, durationMs: null, requestBytes: 0, usage: [], error: null }
  const collector=createUsageCollector()
  calls.push(call)
  try {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    call.requestBytes = body.length
    const headers = new Headers()
    for (const [name, value] of Object.entries(req.headers)) if (!['host','connection','content-length','transfer-encoding','accept-encoding','content-encoding'].includes(name) && value !== undefined) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
    for (const [name,value] of Object.entries({...profile.headers,...profile.envHeaders})) if (value) headers.set(name,value)
    headers.set('accept-encoding','identity')
    const upstream = new URL(profile.upstream.replace(/\/$/,'') + (req.url ?? '').replace(/^\/v1/,''))
    const response = await fetch(upstream, {method:'POST',headers,body:new Uint8Array(body),signal:controller.signal,redirect:'manual'})
    call.status = response.status
    res.statusCode=response.status
    for(const [name,value] of response.headers) if(!['connection','content-length','transfer-encoding','content-encoding'].includes(name))res.setHeader(name,value)
    const decoder = new TextDecoder()
    let errorBody = ''
    if(response.body)for await(const chunk of response.body){
      const text=decoder.decode(chunk,{stream:true});collector.push(text)
      if(!response.ok && errorBody.length<1000)errorBody+=text
      if(!res.write(chunk))await new Promise((resolveDrain,reject)=>{const clean=()=>{res.off('drain',ok);res.off('close',closed)};const ok=()=>{clean();resolveDrain()};const closed=()=>{clean();reject(new Error('Disconnected'))};res.once('drain',ok);res.once('close',closed)})
    }
    collector.push(decoder.decode())
    if(!response.ok)call.error=redact(errorBody).slice(0,1000)
    res.end()
  }catch(error){
    if(controller.signal.aborted&&res.destroyed)call.clientCancelled=true
    else call.error=redact(error.message)
    if(res.headersSent)res.destroy();else if(!res.destroyed){res.writeHead(502);res.end('{"error":{"message":"Benchmark transport failed"}}')}
  }
  finally {call.usage=collector.finish();call.durationMs=Math.round(performance.now()-started)}
})

let proxy
let stderr = ''
const events=[]
let pending=''
let startedAt
let latencyMs=0
let exitCode=null
let timedOut=false
let checksPassed=false
let verification=''
try {
  if(process.argv.includes('--barrier')){
    await writeFile(join(directory,'.ready'),'ready\n')
    const startFile=join(root,'.superpowers','paired-codex',`run-${run}`,'.start')
    const deadline=Date.now()+120_000
    for(;;){try{await readFile(startFile);break}catch(error){if(error.code!=='ENOENT')throw error};if(Date.now()>deadline)throw new Error('Parallel start barrier timed out');await new Promise(resolveWait=>setTimeout(resolveWait,100))}
  }
  startedAt=new Date().toISOString()
  recorder.listen(0,'127.0.0.1');await once(recorder,'listening')
  const recorderUrl=`http://127.0.0.1:${recorder.address().port}/v1`
  if(arm==='echoregent')proxy=await startProxy({upstream:recorderUrl,engine:new ObservedEngine(),scope:{project:directory,session:randomUUID()}})
  const argv=buildCodexArgs(proxy?.baseUrl??recorderUrl,'ECHOREGENT_PROVIDER_KEY',['exec','--ignore-rules','--skip-git-repo-check','--ephemeral','--json','-s','danger-full-access','-C',directory,'-m',profile.model,task])
  const start=performance.now()
  const child=spawn('codex',argv,{cwd:directory,shell:false,env:{...process.env,CODEX_HOME:codeHome,ECHOREGENT_PROVIDER_KEY:profile.key},stdio:['ignore','pipe','pipe']})
  child.stderr.on('data',chunk=>{stderr+=redact(chunk.toString());if(stderr.length>64000)stderr=stderr.slice(-64000)})
  child.stdout.on('data',chunk=>{pending+=chunk;for(;;){const end=pending.indexOf('\n');if(end<0)break;const line=pending.slice(0,end);pending=pending.slice(end+1);try{const event=JSON.parse(line);events.push(event);if(event.type==='error'||event.type==='turn.failed')faults.push(redact(JSON.stringify(event)))}catch{}}})
  const timer=setTimeout(()=>{timedOut=true;child.kill('SIGTERM')},180_000)
  exitCode=await new Promise((resolveExit,reject)=>{child.once('error',reject);child.once('close',resolveExit)})
  clearTimeout(timer)
  latencyMs=Math.round(performance.now()-start)
  const verify=spawn(process.execPath,['test.mjs'],{cwd:directory,shell:false})
  verify.stdout.on('data',chunk=>verification+=chunk);verify.stderr.on('data',chunk=>verification+=chunk)
  checksPassed=(await new Promise(resolveExit=>verify.once('close',resolveExit)))===0
} catch(error){faults.push(redact(error.message))}
finally {
  if(proxy)await proxy.close()
  recorder.closeAllConnections();await new Promise(resolveClose=>recorder.close(resolveClose))
}
const clientUsage=events.filter(event=>event.type==='turn.completed').map(event=>event.usage)
const providerUsage=calls.flatMap(call=>call.usage)
const totals=providerUsage.length?Object.fromEntries(['inputTokens','cachedInputTokens','uncachedInputTokens','outputTokens','totalTokens'].map(field=>[field,providerUsage.some(usage=>usage[field]===null)?null:providerUsage.reduce((sum,usage)=>sum+usage[field],0)])):null
const errorEvents=events.filter(event=>event.type==='error'||event.type==='turn.failed')
for(const line of stderr.split(/\r?\n/))if(/\bERROR\b|blocked by policy|rejected:/i.test(line))faults.push(redact(line))
for(const call of calls)if(call.error)faults.push(`Provider HTTP ${call.status}: ${call.error}`)
const commandFailures=events.filter(event=>event.type==='item.completed'&&event.item?.type==='command_execution'&&event.item.exit_code!==0).map(event=>({command:redact(event.item.command),exitCode:event.item.exit_code}))
const record={kind:process.argv.includes('--diagnostic')?'format-diagnostic':'coding-task',arm,run,startedAt,model:profile.model,provider:profile.provider,reasoning:profile.reasoning??'client default',taskHash:createHash('sha256').update(task).digest('hex'),fixtureHash:createHash('sha256').update(JSON.stringify(files)).digest('hex'),exitCode,timedOut,completed:exitCode===0&&checksPassed,checksPassed,testResult:verification.split(/\r?\n/).find(line=>line.startsWith('RESULT '))??null,latencyMs,calls,providerTotals:totals,clientUsage,transformations,proxyStats:proxy?.stats??null,errors:faults,expectedInitialTestFailures:commandFailures,stderr:redact(stderr).slice(-8000),billedCost:null,note:'Live provider-reported tokens. Format diagnostics do not attempt the coding fixture. No invoice cost or universal savings claim. Coordinator subagent tokens are excluded.'}
const output=join(root,'docs/evidence',`live-codex-${arm}-run-${run}.json`)
await writeFile(output,JSON.stringify(record,null,2)+'\n')
console.log(JSON.stringify({arm,run,output,completed:record.completed,latencyMs,providerTotals:totals,clientUsage,requests:calls.length,compression:proxy?.stats??null,errors:faults,testResult:record.testResult},null,2))
process.exitCode=record.completed?0:1
