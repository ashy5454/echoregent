import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const root = resolve('.')
const directory = await mkdtemp(join(tmpdir(), 'echoregent-install-'))
const artifacts = join(root, 'artifacts')

function run(command, args, options = {}) {
  // npm's JS entry avoids shell quoting and cmd interpolation on Windows.
  const child = spawn(command, args, { cwd: directory, shell: false, ...options })
  let output = ''
  child.stdout?.on('data', (chunk) => output += chunk)
  child.stderr?.on('data', (chunk) => output += chunk)
  return new Promise((resolveRun, reject) => {
    child.once('error', reject)
    child.once('close', (code) => code === 0 ? resolveRun(output) : reject(new Error(`${command} exited ${code}\n${output}`)))
  })
}

try {
  const npmCli = process.env.npm_execpath ?? (process.platform === 'win32' ? join(process.execPath, '..', 'node_modules/npm/bin/npm-cli.js') : '/usr/share/nodejs/npm/bin/npm-cli.js')
  await mkdir(artifacts, { recursive: true })
  await run(process.execPath, [npmCli, 'pack', '--workspace', '@echoregent/core', '--pack-destination', artifacts], { cwd: root })
  await run(process.execPath, [npmCli, 'pack', '--workspace', '@echoregent/cli', '--pack-destination', artifacts], { cwd: root })
  await writeFile(join(directory, 'package.json'), JSON.stringify({ private: true, type: 'module' }))
  await run(process.execPath, [npmCli, 'install', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund', join(artifacts, 'echoregent-core-0.4.0.tgz'), join(artifacts, 'echoregent-cli-0.4.0.tgz')])
  const cli = join(directory, 'node_modules/@echoregent/cli/dist/index.js')
  assert.equal((await run(process.execPath, [cli, '--version'])).trim(), '0.4.0')
  assert.ok((await run(process.execPath, [cli, 'models'])).includes('No model weights'))
  await writeFile(join(directory, 'sdk.mjs'), `import assert from 'node:assert/strict'; import { EchoRegent } from '@echoregent/core'; const e = new EchoRegent(); assert.equal(e.compressText('PASS unit\\n'.repeat(90)).changed, true); assert.equal(e.compressText('My medication dose').policy.protected, true); console.log('SDK installed and working');`)
  assert.ok((await run(process.execPath, [join(directory, 'sdk.mjs')])).includes('SDK installed and working'))
  for (const name of ['core', 'cli']) {
    const files = await readdir(join(directory, `node_modules/@echoregent/${name}/dist`))
    assert.ok(files.includes('index.js') && files.includes('index.d.ts'), `${name} is missing compiled JS/declarations`)
    assert.ok(!(await readdir(join(directory, `node_modules/@echoregent/${name}`))).includes('src'), 'Source build leaked into published package')
  }
  // Verify the actual installed npm command shim, without a shell.
  const shim = join(directory, 'node_modules/.bin/echoregent')
  if (process.platform !== 'win32') assert.equal((await run(shim, ['--version'])).trim(), '0.4.0')
  else {
    const shimOutput = await run(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'echoregent.cmd', '--version'], { env: { ...process.env, PATH: `${join(directory, 'node_modules/.bin')};${process.env.PATH}` } })
    assert.equal(shimOutput.trim(), '0.4.0')
  }
  await writeFile(join(directory, 'usage.ts'), `import { EchoRegent, type MemoryScope } from '@echoregent/core';\nconst scope: MemoryScope = { project: 'p', session: 's' };\nnew EchoRegent().process({ input: [] }, 'responses', scope);\n// @ts-expect-error scope requires a session\nconst invalidScope: MemoryScope = { project: 'p' };\n// @ts-expect-error unsupported provider protocol\nnew EchoRegent().process({}, 'anthropic');\n`)
  await writeFile(join(directory, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: true }, include: ['usage.ts'] }))
  await run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(directory, 'tsconfig.json')])
  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js')
  const { StdioClientTransport } = await import('@modelcontextprotocol/sdk/client/stdio.js')
  const client = new Client({ name: 'package-smoke', version: '1.0.0' })
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'mcp'], cwd: directory })
  try {
    await client.connect(transport)
    const catalog = await client.listTools()
    assert.ok(catalog.tools.some((tool) => tool.name === 'remember'))
    const result = await client.callTool({ name: 'compress', arguments: { text: 'My medical prescription\n'.repeat(80) } })
    assert.equal(JSON.parse(result.content[0].text).policy.protected, true)
  } finally { await client.close() }
  const integration = await run(process.execPath, [join(root, 'scripts/codex-integration.mjs')], { cwd: root, env: { ...process.env, ECHOREGENT_TEST_CLI: cli, ECHOREGENT_EVIDENCE_PATH: join(root, 'docs/evidence/codex-integration.json') } })
  console.log(integration.trim())
  console.log('Packed SDK, CLI and MCP install without build scripts or repository sources: PASS')
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 100 }) }
