import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { delimiter, dirname, join, resolve } from 'node:path'
import process from 'node:process'
import { EchoRegent } from '@echoregent/core'
import { startProxy } from './proxy.js'

export function resolveCodexCommand(command = 'codex'): { command: string; prefixArgs: string[] } {
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

export function buildCodexArgs(baseUrl: string, tokenEnv: string, args: string[]): string[] {
  if (!/^[A-Z_][A-Z0-9_]*$/.test(tokenEnv)) throw new Error('Invalid provider key environment variable')
  if (args.some((arg) => /^(?:-c|-p|--config(?:=|$)|--profile(?:=|$)|--oss(?:=|$)|--local-provider(?:=|$))/.test(arg.trim()))) throw new Error('Client config/provider/profile overrides that can change routing are unsupported')
  const overrides = [
    'model_provider="echoregent"',
    'model_providers.echoregent.name="EchoRegent local proxy"',
    `model_providers.echoregent.base_url=${JSON.stringify(baseUrl)}`,
    'model_providers.echoregent.wire_api="responses"',
    `model_providers.echoregent.env_key=${JSON.stringify(tokenEnv)}`,
    'model_providers.echoregent.requires_openai_auth=false',
    'model_providers.echoregent.supports_websockets=false',
  ]
  return [...overrides.flatMap((override) => ['-c', override]), ...args]
}

export async function wrapCodex(args: string[], options: { upstream: string; key?: string; command?: string; compactHistory?: boolean }) {
  if (!options.key) throw new Error('Set OPENAI_API_KEY or ECHOREGENT_PROVIDER_KEY for your Responses provider. ChatGPT subscription login is not supported by this launcher.')
  const scope = { project: resolve(process.cwd()), session: randomUUID() }
  const proxy = await startProxy({ upstream: options.upstream, engine: new EchoRegent({ compactHistory: options.compactHistory }), scope })
  try {
    const health = await fetch(proxy.baseUrl.replace(/\/v1$/, '/health'))
    if (!health.ok || (await health.json()).product !== 'echoregent') throw new Error('Local routing verification failed')
    const childArgs = buildCodexArgs(proxy.baseUrl, 'ECHOREGENT_PROVIDER_KEY', args)
    console.error(`EchoRegent proxy: ${proxy.baseUrl} (rules only; memory off; telemetry off)`)
    const resolved = resolveCodexCommand(options.command ?? 'codex')
    const child = spawn(resolved.command, [...resolved.prefixArgs, ...childArgs], { stdio: 'inherit', env: { ...process.env, ECHOREGENT_PROVIDER_KEY: options.key }, shell: false })
    const forwardSignal = () => { child.kill('SIGINT') }
    process.on('SIGINT', forwardSignal)
    process.on('SIGTERM', forwardSignal)
    let code: number | null
    try { code = await new Promise<number | null>((resolveExit, reject) => { child.once('error', reject); child.once('exit', (exitCode) => resolveExit(exitCode)) }) }
    finally { process.off('SIGINT', forwardSignal); process.off('SIGTERM', forwardSignal) }
    console.error(`EchoRegent routing: ${proxy.stats.requests} provider request(s), ${proxy.stats.compressed} compressed, ${proxy.stats.protected} protected.`)
    if (code === 0 && !proxy.stats.requests && !args.some((arg) => ['--help', '-h', '--version', '-V'].includes(arg))) throw new Error('Codex exited without routing a provider request; run echoregent doctor')
    return code ?? 1
  } finally { await proxy.close() }
}
