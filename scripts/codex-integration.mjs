import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'

function resolveCodexCommand(command = 'codex') {
  if (process.platform !== 'win32' || command !== 'codex') {
    return { command, prefixArgs: [] }
  }

  const candidateDirs = [
    ...(process.env.PATH ?? '').split(delimiter),
    join(process.env.APPDATA ?? '', 'npm'),
    dirname(process.execPath),
  ]

  for (const dir of candidateDirs) {
    if (!dir) continue

    const jsPaths = [
      join(dir, 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
      join(dir, '..', 'node_modules', '@openai', 'codex', 'bin', 'codex.js'),
    ]
    for (const jsPath of jsPaths) {
      if (existsSync(jsPath)) {
        return { command: process.execPath, prefixArgs: [jsPath] }
      }
    }

    const exePath = join(dir, 'codex.exe')
    if (existsSync(exePath)) {
      return { command: exePath, prefixArgs: [] }
    }

    const cmdPath = join(dir, 'codex.cmd')
    if (existsSync(cmdPath)) {
      try {
        const text = readFileSync(cmdPath, 'utf8')
        const matches = text.matchAll(/(?:%~?dp0%?[\\/])?([^\s"';]+?\.[mc]?js)\b/gi)
        for (const match of matches) {
          const candidate = match[1]
          if (!candidate) continue
          const cleanCandidate = candidate.replace(/^(?:%~?dp0%?[\\/])+/, '').trim()
          const resolvedJs = resolve(dir, cleanCandidate)
          if (existsSync(resolvedJs)) {
            return { command: process.execPath, prefixArgs: [resolvedJs] }
          }
        }
      } catch {
        // Fall back to executing cmdPath via cmd.exe
      }
      return { command: process.env.ComSpec ?? 'cmd.exe', prefixArgs: ['/d', '/s', '/c', cmdPath] }
    }
  }

  return { command, prefixArgs: [] }
}

// Real Codex binary, controlled provider. No live inference, real keys or task billing.
const directory = await mkdtemp(join(tmpdir(), 'echoregent-codex-'))
const codeHomes = resolve(import.meta.dirname, '../.superpowers/codex-fixture-homes')
await mkdir(codeHomes, { recursive: true })
const codeHome = await mkdtemp(join(codeHomes, 'home-'))
const requests = []
const token = 'echoregent-fixture-only'
let stderr = ''
let stdout = ''
let version = ''
const cli = resolve(process.env.ECHOREGENT_TEST_CLI ?? 'packages/cli/dist/index.js')
const server = createServer(async (req, res) => {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const body = JSON.parse(Buffer.concat(chunks).toString())
  requests.push({ path: req.url, auth: req.headers.authorization, body })
  if (req.url !== '/v1/responses') { res.writeHead(404); res.end('{}'); return }
  const callResult = body.input?.find((item) => ['function_call_output', 'custom_tool_call_output'].includes(item.type) && item.call_id === 'echoregent_call_1')
  const responseId = `resp_fixture_${requests.length}`
  const response = { id: responseId, object: 'response', created_at: 1_700_000_000, status: 'in_progress', error: null, incomplete_details: null, instructions: null, model: 'fixture-model', output: [], parallel_tool_calls: true, tool_choice: 'auto', tools: body.tools ?? [], usage: null }
  const events = []
  events.push(['response.created', { response }])
  let item
  if (!callResult) {
    const flatten = (items, namespace) => items.flatMap((entry) => Array.isArray(entry.tools)
      ? flatten(entry.tools, entry.name)
      : [{ ...entry, namespace, name: entry.name ?? entry.function?.name }])
    const tool = flatten(body.tools ?? []).find((item) => ['exec_command', 'shell_command', 'shell'].includes(item.name))
    if (!tool) {
      res.writeHead(500); res.end(JSON.stringify({ error: { message: 'Fixture needs a declared shell function' } })); return
    }
    const command = process.env.ECHOREGENT_TEST_NOISY === '1'
      ? `node -e "for(let i=0;i<100;i++)console.log('[INFO] fixture input validated');console.log('ECHOREGENT_TOOL_OK')"`
      : process.platform === 'win32' ? 'Write-Output ECHOREGENT_TOOL_OK' : 'printf ECHOREGENT_TOOL_OK'
    const args = tool.name === 'exec_command' ? { cmd: command, workdir: directory } : tool.name === 'shell_command' ? { command, workdir: directory } : { command: process.platform === 'win32' ? ['powershell', '-NoProfile', '-Command', command] : ['sh', '-c', command], workdir: directory }
    const custom = process.env.ECHOREGENT_TEST_CUSTOM_CALL === '1' || tool.type === 'custom'
    const inputField = custom ? 'input' : 'arguments'
    item = { id: 'fc_fixture', type: custom ? 'custom_tool_call' : 'function_call', status: 'in_progress', call_id: 'echoregent_call_1', name: tool.name, ...(tool.namespace ? { namespace: tool.namespace } : {}), [inputField]: '' }
    events.push(['response.output_item.added', { output_index: 0, item: { ...item } }])
    const argumentsText = JSON.stringify(args)
    events.push([custom ? 'response.custom_tool_call_input.delta' : 'response.function_call_arguments.delta', { item_id: item.id, output_index: 0, delta: argumentsText }])
    events.push([custom ? 'response.custom_tool_call_input.done' : 'response.function_call_arguments.done', { item_id: item.id, output_index: 0, [inputField]: argumentsText }])
    item = { ...item, status: 'completed', [inputField]: argumentsText }
  } else {
    item = { id: 'msg_fixture', type: 'message', status: 'in_progress', role: 'assistant', content: [] }
    events.push(['response.output_item.added', { output_index: 0, item: { ...item } }])
    events.push(['response.content_part.added', { item_id: item.id, output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } }])
    events.push(['response.output_text.delta', { item_id: item.id, output_index: 0, content_index: 0, delta: 'ECHOREGENT_INTEGRATION_OK' }])
    events.push(['response.output_text.done', { item_id: item.id, output_index: 0, content_index: 0, text: 'ECHOREGENT_INTEGRATION_OK' }])
    item = { ...item, status: 'completed', content: [{ type: 'output_text', text: 'ECHOREGENT_INTEGRATION_OK', annotations: [] }] }
    events.push(['response.content_part.done', { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] }])
  }
  events.push(['response.output_item.done', { output_index: 0, item }])
  events.push(['response.completed', { response: { ...response, status: 'completed', output: [item], usage: { input_tokens: 50, input_tokens_details: { cached_tokens: callResult ? 20 : 0 }, output_tokens: 10, output_tokens_details: { reasoning_tokens: 0 }, total_tokens: 60 } } }])
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  for (const [index, [event, data]] of events.entries()) {
    res.write(`event: ${event}\ndata: ${JSON.stringify({ type: event, sequence_number: index, ...data })}\n\n`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 5))
  }
  res.end()
})

try {
  await writeFile(join(codeHome, 'config.toml'), '# fixture configuration must remain unchanged\n')
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const upstream = `http://127.0.0.1:${server.address().port}/v1`
  const resolved = resolveCodexCommand('codex')
  const versionProcess = spawn(resolved.command, [...resolved.prefixArgs, '--version'], { shell: false })
  versionProcess.stdout.on('data', (chunk) => version += chunk)
  await once(versionProcess, 'exit')
  const child = spawn(process.execPath, [cli, 'wrap', 'codex', '--upstream', upstream, '--', 'exec', '--ignore-user-config', '--ignore-rules', '--skip-git-repo-check', '--ephemeral', '--json', '-s', process.env.ECHOREGENT_TEST_NOISY === '1' ? 'danger-full-access' : 'read-only', '-C', directory, '-m', 'fixture-model', 'Run the fixture shell tool once, then report its marker.'], {
    cwd: directory, shell: false, env: { ...process.env, CODEX_HOME: codeHome, ECHOREGENT_PROVIDER_KEY: token }, stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout.on('data', (chunk) => stdout += chunk)
  child.stderr.on('data', (chunk) => stderr += chunk)
  const timeout = setTimeout(() => { child.kill(); }, 45_000)
  const [code] = await once(child, 'exit')
  clearTimeout(timeout)
  assert.equal(code, 0, `Codex integration exited ${code}\n${stderr}\n${stdout}`)
  assert.ok(stdout.includes('ECHOREGENT_INTEGRATION_OK'), `Missing final marker\n${stderr}\n${stdout}`)
  assert.ok(requests.length >= 2, 'Expected a tool round trip')
  assert.ok(requests.every((request) => request.auth === `Bearer ${token}`), 'Authentication did not route')
  const roundTrip = requests.find((request) => request.body.input?.some((item) => ['function_call_output', 'custom_tool_call_output'].includes(item.type) && item.call_id === 'echoregent_call_1'))
  assert.ok(roundTrip, 'Tool result missing from subsequent provider request')
  assert.ok(JSON.stringify(roundTrip.body.input).includes('ECHOREGENT_TOOL_OK'), 'Shell tool did not execute')
  assert.equal(await readFile(join(codeHome, 'config.toml'), 'utf8'), '# fixture configuration must remain unchanged\n')
  const toolOutputItem = roundTrip.body.input.find((item) => ['function_call_output', 'custom_tool_call_output'].includes(item.type) && item.call_id === 'echoregent_call_1')
  const toolOutput = toolOutputItem?.output
  const toolOutputShape = { itemType: toolOutputItem.type, itemFields: Object.keys(toolOutputItem), type: Array.isArray(toolOutput) ? 'array' : typeof toolOutput, parts: Array.isArray(toolOutput) ? toolOutput.map((part) => ({ type: part.type, fields: Object.keys(part), textPreview: process.env.ECHOREGENT_TEST_NOISY === '1' ? part.text?.slice(0,400) : undefined })) : null }
  const evidence = { kind: 'controlled-provider-integration', timestamp: new Date().toISOString(), client: version.trim(), platform: process.platform, node: process.version, requests: requests.length, protocol: 'responses', authentication: 'fixture bearer key forwarded', streaming: 'incremental SSE', toolRoundTrip: true, toolOutputShape, persistentConfigChanged: false, billingEvidence: false }
  if (process.env.ECHOREGENT_EVIDENCE_PATH) await writeFile(process.env.ECHOREGENT_EVIDENCE_PATH, JSON.stringify(evidence, null, 2) + '\n')
  console.log(JSON.stringify(evidence, null, 2))
} finally {
  server.closeAllConnections()
  await new Promise((resolveClose) => server.close(resolveClose))
  await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
  await rm(codeHome, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 })
}
