import { spawn } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import assert from 'node:assert/strict'
const child=spawn(process.execPath,['--import','tsx','src/server.ts'],{
 cwd:process.cwd(), env:{...process.env,PORT:'18787',CTS_HOST:'127.0.0.1',DATABASE_URL:'',CTS_ADMIN_SECRET:'local-latency-check'}
})
let logs=''
child.stdout.on('data',data=>{logs+=data})
child.stderr.on('data',data=>{logs+=data})
try {
 const deadline=Date.now()+15000
 let health
 while(Date.now()<deadline){
  try {
   const response=await fetch('http://127.0.0.1:18787/admin/model-health',{headers:{'x-admin-secret':'local-latency-check'}})
   health=await response.json()
   if(health.models?.classifier?.loaded && health.models?.relevance?.loaded && health.models?.semanticCache?.loaded) break
  } catch {}
  await new Promise(resolve=>setTimeout(resolve,100))
 }
 writeFileSync('reports/final-server-health.json',JSON.stringify(health,null,2)+'\n')
 assert(health?.models?.classifier?.loaded && health?.models?.relevance?.loaded && health?.models?.semanticCache?.loaded,'Required model startup must succeed')
 console.log('Server startup and three model health checks: PASS')
}finally{
 child.kill()
 writeFileSync('reports/final-server-startup.txt',logs)
}
