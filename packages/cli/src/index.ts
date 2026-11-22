#!/usr/bin/env node
import { parseArgs } from 'node:util'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { EchoRegent, type MemorySettings } from '@echoregent/core'
import { startProxy } from './proxy.js'
import { wrapCodex } from './codex.js'
import { runMcp } from './mcp.js'

const help = `EchoRegent 0.4.0 — local context middleware

  echoregent wrap codex [--upstream URL] [--compact-history] [-- <codex arguments>]
  echoregent proxy [--port 8787] [--upstream URL] [--compact-history]
  echoregent doctor [--url http://127.0.0.1:8787] [--probe --model NAME]
  echoregent mcp [--memory off|ephemeral|file --project PATH --session ID]
  echoregent models
  echoregent unwrap

Provider: ECHOREGENT_UPSTREAM (default https://api.openai.com/v1)
API key: ECHOREGENT_PROVIDER_KEY or OPENAI_API_KEY
Memory defaults off; file mode requires --memory-dir and --retention-days.
History compaction defaults off; --compact-history factors older repeated wording.
Wrap uses per-launch Codex configuration; exiting reverses setup.
`

async function main() {
  const separator = process.argv.indexOf('--', 2)
  const forwarded = separator < 0 ? [] : process.argv.slice(separator + 1)
  const argv = separator < 0 ? process.argv.slice(2) : process.argv.slice(2, separator)
  const { values, positionals } = parseArgs({ args: argv, allowPositionals: true, options: {
    upstream: { type: 'string' }, port: { type: 'string' }, url: { type: 'string' },
    'compact-history': { type: 'boolean', default: false },
    'local-token': { type: 'string' },
    'inject-memory': { type: 'boolean', default: false },
    'adaptive-compression': { type: 'boolean', default: false },
    'project-memory': { type: 'boolean', default: false },
    memory: { type: 'string', default: 'off' }, 'memory-dir': { type: 'string' },
    'retention-days': { type: 'string' }, project: { type: 'string' }, session: { type: 'string' },
    probe: { type: 'boolean' }, model: { type: 'string' }, help: { type: 'boolean', short: 'h' }, version: { type: 'boolean', short: 'V' },
  } })
  if (values.version) { console.log('0.4.0'); return }
  if (values.help || !positionals.length) { console.log(help); return }
  const command = positionals[0]
  const upstream = values.upstream ?? process.env.ECHOREGENT_UPSTREAM ?? 'https://api.openai.com/v1'
  const key = process.env.ECHOREGENT_PROVIDER_KEY ?? process.env.OPENAI_API_KEY
  const localToken = values['local-token'] ?? process.env.ECHOREGENT_LOCAL_TOKEN
  if (command === 'unwrap') { console.log('Wrap makes no persistent client edits. Exit the wrapped client to stop its proxy; no configuration needs restoring.'); return }
  if (command === 'models') { console.log('Rules only. No model weights are installed, downloaded, or required. Optional model integrations are not shipped in 0.4.0; see MODEL_LICENSES.md.'); return }
  if (command === 'doctor') {
    const url = (values.url ?? 'http://127.0.0.1:8787').replace(/\/v1\/?$/, '').replace(/\/$/, '')
    const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5_000) })
    if (!response.ok || (await response.json()).product !== 'echoregent') throw new Error('EchoRegent proxy not found. Start echoregent proxy and verify --url.')
    console.log('Proxy healthy; deterministic mode; telemetry off; no model downloads.')
    if (values.probe) {
      if (!values.model || !key) throw new Error('--probe requires --model and a provider API key; it sends one billable provider request')
      const probe = await fetch(`${url}/v1/responses`, { method: 'POST', headers: { authorization: 'Bearer ' + key, 'content-type': 'application/json' }, body: JSON.stringify({ model: values.model, input: 'Reply OK.', max_output_tokens: 32, stream: false }), signal: AbortSignal.timeout(30_000) })
      if (!probe.ok || !probe.headers.has('x-echoregent-compressed')) throw new Error(`Responses routing probe failed (${probe.status}); check provider authentication and model access`)
      await probe.text()
      console.log('Responses request routed through EchoRegent successfully.')
    } else console.log('Provider authentication and client routing are unverified; --probe --model NAME checks the Responses route.')
    return
  }
  let memory: MemorySettings = { mode: 'off' }
  if (values.memory !== 'off') {
    if (!values.project || !values.session) throw new Error('Enabled memory requires explicit --project and --session')
    const days = Number(values['retention-days'])
    if (!Number.isFinite(days) || days <= 0) throw new Error('Enabled memory requires positive --retention-days')
    if (values.memory === 'ephemeral') memory = { mode: 'ephemeral', retentionMs: days * 86_400_000 }
    else if (values.memory === 'file' && values['memory-dir']) memory = { mode: 'file', directory: values['memory-dir'], retentionMs: days * 86_400_000 }
    else throw new Error('Use --memory off|ephemeral|file; file mode requires --memory-dir')
  }
  const engine = new EchoRegent({
    memory,
    compactHistory: values['compact-history'],
    injectMemory: values['inject-memory'],
    adaptiveCompression: values['adaptive-compression'],
    projectWideMemory: values['project-memory'],
  } as any)
  const scope = { project: resolve(values.project ?? process.cwd()), session: values.session ?? randomUUID() }
  if (command === 'wrap') {
    if (positionals[1] !== 'codex') throw new Error('Only the Codex Responses launcher is implemented; other agents are not advertised')
    process.exitCode = await wrapCodex([...positionals.slice(2), ...forwarded], { upstream, key, compactHistory: values['compact-history'], engine, scope })
    return
  }
  if (command === 'mcp') { await runMcp(engine, scope); return }
  if (command === 'proxy') {
    const port = Number(values.port ?? 8787)
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Port must be an integer from 0 to 65535')
    const proxy = await startProxy({ upstream, port, engine, scope: memory.mode === 'off' ? undefined : scope, localToken })
    console.error(`EchoRegent proxy: ${proxy.baseUrl}; memory ${memory.mode}; telemetry off`)
    let closing = false
    const close = async () => { if (closing) return; closing = true; await proxy.close() }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    return
  }
  throw new Error(`Unknown command: ${command}; run echoregent --help`)
}

main().catch((error) => { console.error(`EchoRegent: ${(error as Error).message}`); process.exitCode = 1 })
