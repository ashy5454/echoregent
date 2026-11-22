import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EchoRegent, scopeKey, type MemoryScope } from '../../packages/core/src/index.js'
import { startProxy } from '../../packages/cli/src/proxy.js'

async function createMockUpstream() {
  const received: Array<{ url: string; body: any }> = []
  const server = createServer((req, res) => {
    let raw = ''
    req.on('data', (c) => (raw += c))
    req.on('end', () => {
      received.push({ url: req.url ?? '', body: JSON.parse(raw || '{}') })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'msg_ok', content: [{ type: 'text', text: 'OK' }] }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    received,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

describe('Autonomous Token Management System: Claude Code (/v1/messages), Codex (/v1/responses), and Hermes (/v1/chat/completions)', () => {
  it('autonomously learns, supersedes, and injects project memory across sessions without a single manual remember() call', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-autolearn-'))
    const upstream = await createMockUpstream()

    try {
      const engine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
        autoLearnMemory: true,
        projectWideMemory: true,
        adaptiveCompression: true,
        compactHistory: true,
      })

      const proxy = await startProxy({ upstream: upstream.url, engine })
      const base = proxy.baseUrl.replace(/\/v1$/, '')

      try {
        // SESSION 1 (Hermes / OpenAI /v1/chat/completions) — User states initial architecture in natural chat
        await fetch(`${base}/v1/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-echoregent-project': '/workspace/autonomous-tms',
            'x-echoregent-session': 'session-1-init',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'user',
                content:
                  'We are starting the billing service. Remember that our primary database is MySQL 5.7 on port 3306. Our cache layer uses Memcached 1.6.',
              },
            ],
          }),
        })

        // SESSION 2 (Codex /v1/responses — different session ID) — User states database migration in natural chat
        await fetch(`${base}/v1/responses`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-echoregent-project': '/workspace/autonomous-tms',
            'x-echoregent-session': 'session-2-migration',
          },
          body: JSON.stringify({
            model: 'gpt-4o',
            input: [
              {
                role: 'user',
                content:
                  'We migrated our primary database to PostgreSQL 16 via PgBouncer on port 6432 instead of MySQL.',
              },
            ],
          }),
        })

        // SESSION 3 (Claude Code /v1/messages — 3rd session ID after context wipe!)
        // User asks a question AND sends a Claude Code tool_result block with 60 repetitive [INFO] log lines
        const claudeToolLogs =
          Array.from({ length: 60 }, (_, i) => `[INFO] timestamp=${1700000000 + i} worker=${i % 2} status=200`).join('\n') +
          '\nFAIL src/db/pool.ts:44 connection timeout'

        const claudeRes = await fetch(`${base}/v1/messages`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-echoregent-project': '/workspace/autonomous-tms',
            'x-echoregent-session': 'session-3-claude-code',
          },
          body: JSON.stringify({
            model: 'claude-sonnet-4-5',
            max_tokens: 1024,
            system: 'You are Claude Code running in a terminal.',
            messages: [
              {
                role: 'user',
                content: 'How should I configure the primary database and cache connection?',
              },
              {
                role: 'assistant',
                content: [{ type: 'tool_use', id: 'toolu_1', name: 'bash', input: { command: 'npm test' } }],
              },
              {
                role: 'user',
                content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: claudeToolLogs }],
              },
            ],
          }),
        })

        expect(claudeRes.status).toBe(200)
        expect(claudeRes.headers.get('x-echoregent-compressed')).toBe('true')

        const claudeUpstream = upstream.received[2]
        expect(claudeUpstream.url).toBe('/v1/messages')

        // 1. Verify top-level Anthropic `system` prompt received the autonomously learned & superseded LLM-Wiki memory!
        expect(typeof claudeUpstream.body.system).toBe('string')
        expect(claudeUpstream.body.system).toContain('[EchoRegent LLM-Wiki Memory Context]')
        expect(claudeUpstream.body.system).toContain('PostgreSQL 16 via PgBouncer on port 6432')
        expect(claudeUpstream.body.system).toContain('Memcached 1.6')
        expect(claudeUpstream.body.system).not.toContain('MySQL 5.7 on port 3306')
        expect(claudeUpstream.body.system).toContain('You are Claude Code running in a terminal.')

        // 2. Verify no illegal `role: 'system'` message was inserted into Anthropic `messages` array
        expect(claudeUpstream.body.messages.every((m: any) => m.role !== 'system')).toBe(true)

        // 3. Verify Claude Code's `tool_result` block was losslessly compacted while preserving the FAIL line
        const toolResultBlock = claudeUpstream.body.messages[2].content[0]
        expect(toolResultBlock.type).toBe('tool_result')
        expect(toolResultBlock.content).toContain('[EchoRegent lossless logs v1')
        expect(toolResultBlock.content).toContain('FAIL src/db/pool.ts:44 connection timeout')

        // 4. Verify on-disk LLM-Wiki index.md was autonomously compiled with Active and Superseded sections
        const projKey = scopeKey({ project: '/workspace/autonomous-tms', session: '__project__' })
        const indexMd = readFileSync(join(directory, projKey, 'wiki', 'index.md'), 'utf8')
        expect(indexMd).toContain('## Active Facts')
        expect(indexMd).toContain('## Superseded Facts (History)')
        expect(indexMd).toContain('~~**[')
        expect(indexMd).toContain('MySQL 5.7 on port 3306~~')
      } finally {
        await proxy.close()
      }
    } finally {
      await upstream.close()
      await rm(directory, { recursive: true, force: true })
    }
  })
})
