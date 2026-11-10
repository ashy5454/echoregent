// Legacy development entry: public MCP lives in @echoregent/cli.
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
const cli = fileURLToPath(new URL('../../packages/cli/dist/index.js', import.meta.url))
const child = spawn(process.execPath, [cli, 'mcp', ...process.argv.slice(2)], { stdio: 'inherit', shell: false })
child.once('error', (error) => { console.error(error.message); process.exitCode = 1 })
child.once('exit', (code) => { process.exitCode = code ?? 1 })
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
