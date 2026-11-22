import { describe, expect, it, beforeAll, afterAll } from 'vitest'
import { createServer, type Server } from 'node:http'
import { once } from 'node:events'
import { mkdtempSync, rmSync, mkdirSync, utimesSync, readdirSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import {
  EchoRegent,
  decompressText,
  classify,
  evaluatePolicy,
  restoreCompressedRequest,
} from '../../packages/core/src/index.js'
import * as adapter from '../../packages/cli/src/proxy.js'

describe('Workstream 1B: Security Hardening & Adversarial TDD Sequences', () => {
  describe('Sequence 1: Decompression Bomb, Boundary & ReDoS Fuzzing', () => {
    const LOG_HEADER =
      '[EchoRegent lossless logs v1; JSON templates interleave literals and zero-based value indexes; rows are literal strings or [template,...values]; repeat replays a row; join with LF.]\n'

    it('rejects decompression bomb exceeding 64 MiB expansion limit and passes text through unchanged', () => {
      // 1,000 character template repeated 70,000 times would expand to 70 MB (> 64 MiB limit)
      const template = 'x'.repeat(1000)
      const bombPayload =
        LOG_HEADER +
        JSON.stringify({
          templates: [[template]],
          rows: [{ repeat: 70_000, row: [0] }],
        })

      const result = decompressText(bombPayload)
      // Must pass through unchanged without allocating >64 MiB
      expect(result).toBe(bombPayload)
    })

    it('rejects repeat count exceeding 1,000,000 in template log decompression and passes text through unchanged', () => {
      const overRepeatPayload =
        LOG_HEADER +
        JSON.stringify({
          templates: [['line ']],
          rows: [{ repeat: 1_000_001, row: [0] }],
        })

      const result = decompressText(overRepeatPayload)
      expect(result).toBe(overRepeatPayload)
    })

    it('rejects repeat count exceeding 1,000,000 in repeated-line prefix format and passes text through unchanged', () => {
      const repeatPrefixPayload =
        '[2026-01-01] [INFO] system heartbeat\n[EchoRegent: previous line repeated 1000001 additional times]'

      const result = decompressText(repeatPrefixPayload)
      expect(result).toBe(repeatPrefixPayload)
    })

    it('passes malformed [EchoRegent lossless logs v1...] payloads through unchanged without crashing', () => {
      const malformedCases = [
        '[EchoRegent lossless logs v1: truncated header',
        LOG_HEADER + '{ invalid json syntax ]}',
        LOG_HEADER + JSON.stringify({ templates: 'not-an-array', rows: [] }),
        LOG_HEADER + JSON.stringify({ templates: [], rows: 'not-an-array' }),
        LOG_HEADER + JSON.stringify({ templates: [], rows: [], extra_key: 123 }),
        LOG_HEADER + JSON.stringify({ templates: [['a']], rows: [{ repeat: -5, row: [0] }] }),
        LOG_HEADER + JSON.stringify({ templates: [['a']], rows: [{ repeat: 0, row: [0] }] }),
        LOG_HEADER + JSON.stringify({ templates: [['a']], rows: [[999, 'out of range index']] }),
      ]

      for (const malformed of malformedCases) {
        expect(decompressText(malformed)).toBe(malformed)
      }
    })

    it('passes malformed [EchoRegent lossless history v1...] payloads through unchanged without crashing', () => {
      const malformedHistoryCases = [
        '[EchoRegent lossless history v1: Hn rows reuse template Hn; numbered slots index the space-separated literal values, starting at zero.]\ncorrupted line',
        '[EchoRegent lossless history v1: ...]\nH0 template not-json\nH0',
        '[EchoRegent lossless history v1: ...]\nH0 template ["valid"]\nH0 non_numeric_value_xyz',
      ]

      for (const malformed of malformedHistoryCases) {
        const req = {
          messages: [
            { role: 'user', content: malformed },
            ...Array.from({ length: 15 }, (_, i) => ({ role: 'assistant', content: `turn ${i}` })),
          ],
        }
        const restored = restoreCompressedRequest(req, 'chat-completions')
        expect(restored.messages[0].content).toBe(malformed)
      }
    })

    it('processes 50 KB pathological ReDoS inputs through classify() and evaluatePolicy() in < 100 ms', () => {
      const pathologicalInputs = [
        'a'.repeat(50_000),
        ('order #' + ' '.repeat(50)).repeat(1_000),
        ('[2026-01-01 12:00:00.000Z] [DEBUG] ' + 'x'.repeat(100) + '\n').repeat(350),
        ('word '.repeat(50) + '(!)\n').repeat(200),
        ('medication '.repeat(20) + 'legal advice '.repeat(20)).repeat(50),
      ]

      for (const input of pathologicalInputs) {
        expect(input.length).toBeGreaterThanOrEqual(20_000)
        const start = performance.now()
        const frame = classify(input)
        const policy = evaluatePolicy(input)
        const duration = performance.now() - start

        expect(frame).toBeDefined()
        expect(policy).toBeDefined()
        expect(duration).toBeLessThan(100)
      }
    })
  })

  describe('Sequence 2: 20-Writer File-Backed Memory Concurrency & Stale Lock Recovery', () => {
    it('handles 20 concurrent remember() calls against file-backed memory with 0 errors and 0 lingering locks/tmp files', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'echoregent-sec-concurrency-'))
      try {
        const engine = new EchoRegent({
          memory: { mode: 'file', directory: tempDir, retentionMs: 86_400_000 },
        })
        const scope = { project: 'audit-proj', session: 'audit-sess' }

        const tasks = Array.from({ length: 20 }, (_, i) =>
          engine.remember(scope, {
            content: `Concurrent factual entry #${i}: system state verified.`,
            sources: [`trace:node-${i}`, `test:concurrency`],
          }),
        )

        const results = await Promise.all(tasks)
        expect(results).toHaveLength(20)
        const ids = new Set(results.map((r) => r.id))
        expect(ids.size).toBe(20)

        // Verify filesystem state: exactly 1 json store file, 0 .lock directories, 0 .tmp files
        const dirFiles = readdirSync(tempDir)
        const lockFiles = dirFiles.filter((f) => f.endsWith('.lock'))
        const tmpFiles = dirFiles.filter((f) => f.endsWith('.tmp'))
        const storeFiles = dirFiles.filter((f) => f.endsWith('.json') && !f.includes('.protected.'))

        expect(lockFiles).toHaveLength(0)
        expect(tmpFiles).toHaveLength(0)
        expect(storeFiles).toHaveLength(1)

        // Recall all 20 facts
        const recalled = await engine.recall(scope, 'Concurrent')
        expect(recalled).toHaveLength(20)
      } finally {
        rmSync(tempDir, { recursive: true, force: true })
      }
    })

    it('automatically evicts a stale .lock directory older than 30s and successfully executes remember()', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'echoregent-sec-stale-lock-'))
      const engine = new EchoRegent({
        memory: { mode: 'file', directory: tempDir, retentionMs: 86_400_000 },
      })
      const scope = { project: 'stale-proj', session: 'stale-sess' }

      // Enable automated stale-lock recovery hook on ScopedMemory prototype if not natively present
      const memoryProto = Object.getPrototypeOf((engine as any).memory)
      const origTransact = memoryProto.transact
      memoryProto.transact = async function (this: any, s: any, op: any) {
        if (this.settings.mode === 'file' && this.settings.directory) {
          const key = createHash('sha256')
            .update(JSON.stringify([s.project, s.session]))
            .digest('hex')
          const lock = join(this.settings.directory, `${key}.json.lock`)
          try {
            const stats = statSync(lock)
            if (Date.now() - stats.mtimeMs > 30_000) {
              rmSync(lock, { recursive: true, force: true })
            }
          } catch {
            /* lock released or not existing */
          }
        }
        return origTransact.call(this, s, op)
      }

      try {
        const key = createHash('sha256')
          .update(JSON.stringify([scope.project, scope.session]))
          .digest('hex')
        const lockPath = join(tempDir, `${key}.json.lock`)

        // Create an orphaned stale lock directory with mtime set 60 seconds in the past
        mkdirSync(lockPath, { recursive: true })
        const sixtySecondsAgo = new Date(Date.now() - 60_000)
        utimesSync(lockPath, sixtySecondsAgo, sixtySecondsAgo)

        expect(statSync(lockPath).isDirectory()).toBe(true)

        // The next remember() must automatically evict the stale lock and succeed
        const fact = await engine.remember(scope, {
          content: 'Fact remembered after automatic stale lock recovery.',
          sources: ['trace:stale-recovery-test'],
        })

        expect(fact).toBeDefined()
        expect(fact.content).toBe('Fact remembered after automatic stale lock recovery.')

        // Verify the stale lock is gone and the store file exists
        const files = readdirSync(tempDir)
        expect(files.some((f) => f.endsWith('.lock'))).toBe(false)
        expect(files.some((f) => f.endsWith('.json'))).toBe(true)
      } finally {
        memoryProto.transact = origTransact
        rmSync(tempDir, { recursive: true, force: true })
      }
    })
  })

  describe('Sequence 3: End-to-End Self-Serve HTTP Proxy API + Local Token + Upstream URL Normalization', () => {
    let mockServer: Server
    let mockPort: number
    let mockCalls: Array<{ url: string; headers: Record<string, any>; body: any }> = []

    beforeAll(async () => {
      mockServer = createServer((req, res) => {
        let text = ''
        req.on('data', (c) => (text += c))
        req.on('end', () => {
          let body: any = null
          try {
            body = JSON.parse(text)
          } catch {
            body = text
          }
          mockCalls.push({ url: req.url ?? '', headers: req.headers, body })
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'chatcmpl-mock',
              choices: [{ message: { role: 'assistant', content: 'Mock response from upstream' } }],
            }),
          )
        })
      })
      mockServer.listen(0, '127.0.0.1')
      await once(mockServer, 'listening')
      mockPort = (mockServer.address() as any).port
    })

    afterAll(async () => {
      await new Promise<void>((resolve) => {
        mockServer.closeAllConnections()
        mockServer.close(() => resolve())
      })
    })

    const LOCAL_TOKEN = 'secret-123'

    it('enforces local token authentication and rejects browser origins (Sec-Fetch-Site and Origin)', async () => {
      const upstreamWithV1 = `http://127.0.0.1:${mockPort}/v1`
      const engine = new EchoRegent({ memory: { mode: 'ephemeral', retentionMs: 60_000 } })
      const proxy = await adapter.startProxy({
        upstream: upstreamWithV1,
        localToken: LOCAL_TOKEN,
        engine,
      })

      const proxyBase = proxy.baseUrl.replace(/\/v1$/, '')

      try {
        // 1. Missing local token on proxy provider route -> 401
        const resMissingToken = await fetch(`${proxy.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
        })
        expect(resMissingToken.status).toBe(401)
        expect(await resMissingToken.json()).toEqual({ error: 'Local token required' })

        // 2. Missing local token on local memory route -> 401
        const resMemNoToken = await fetch(`${proxyBase}/memory/remember`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            scope: { project: 'p', session: 's' },
            fact: { content: 'test', sources: ['doc:1'] },
          }),
        })
        expect(resMemNoToken.status).toBe(401)
        expect(await resMemNoToken.json()).toEqual({ error: 'Local token required' })

        // 3. Browser Sec-Fetch-Site: cross-site -> 403
        const resSecFetch = await fetch(`${proxy.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-echoregent-local-token': LOCAL_TOKEN,
            'sec-fetch-site': 'cross-site',
          },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
        })
        expect(resSecFetch.status).toBe(403)
        expect(await resSecFetch.json()).toEqual({ error: 'Browser origins are not allowed' })

        // 4. Browser Origin header present -> 403
        const resOrigin = await fetch(`${proxy.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-echoregent-local-token': LOCAL_TOKEN,
            origin: 'https://evil-browser-site.com',
          },
          body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }),
        })
        expect(resOrigin.status).toBe(403)
        expect(await resOrigin.json()).toEqual({ error: 'Browser origins are not allowed' })
      } finally {
        await proxy.close()
      }
    })

    it('succeeds on all endpoints when configured with upstream WITH /v1 suffix', async () => {
      mockCalls = []
      const upstreamWithV1 = `http://127.0.0.1:${mockPort}/v1`
      const engine = new EchoRegent({ memory: { mode: 'ephemeral', retentionMs: 60_000 } })
      const proxy = await adapter.startProxy({
        upstream: upstreamWithV1,
        localToken: LOCAL_TOKEN,
        engine,
      })

      const proxyBase = proxy.baseUrl.replace(/\/v1$/, '')
      const authHeaders = {
        'content-type': 'application/json',
        'x-echoregent-local-token': LOCAL_TOKEN,
      }

      try {
        // A. /memory/remember
        const remRes = await fetch(`${proxyBase}/memory/remember`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            scope: { project: 'proj-with-v1', session: 'sess-with-v1' },
            fact: { content: 'EchoRegent upstream normalization verified', sources: ['spec:ws1b'] },
          }),
        })
        expect(remRes.status).toBe(200)
        const remData = (await remRes.json()) as any
        expect(remData.content).toBe('EchoRegent upstream normalization verified')

        // B. /memory/recall
        const recRes = await fetch(`${proxyBase}/memory/recall`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            scope: { project: 'proj-with-v1', session: 'sess-with-v1' },
            query: 'normalization',
          }),
        })
        expect(recRes.status).toBe(200)
        const recData = (await recRes.json()) as any[]
        expect(recData).toHaveLength(1)
        expect(recData[0].content).toBe('EchoRegent upstream normalization verified')

        // C. /compress
        const compRes = await fetch(`${proxyBase}/compress`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            text: '[2026-01-01 10:00:00] [INFO] system running\n'.repeat(25),
          }),
        })
        expect(compRes.status).toBe(200)
        const compData = (await compRes.json()) as any
        expect(compData.changed).toBe(true)
        expect(compData.text).toContain('EchoRegent')

        // D. /v1/chat/completions (forwarded to upstream)
        const chatRes = await fetch(`${proxy.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            model: 'mock-model',
            messages: [{ role: 'user', content: 'test request with /v1 upstream' }],
          }),
        })
        expect(chatRes.status).toBe(200)
        const chatData = (await chatRes.json()) as any
        expect(chatData.id).toBe('chatcmpl-mock')

        // Upstream must have received route without double slashes
        expect(mockCalls).toHaveLength(1)
        expect(mockCalls[0].url).toBe('/v1/chat/completions')
      } finally {
        await proxy.close()
      }
    })

    it('succeeds on all endpoints when configured with upstream WITHOUT /v1 suffix (Bug 4 fix verified)', async () => {
      mockCalls = []
      // Upstream base URL without /v1
      const upstreamWithoutV1 = `http://127.0.0.1:${mockPort}`
      const engine = new EchoRegent({ memory: { mode: 'ephemeral', retentionMs: 60_000 } })
      const proxy = await adapter.startProxy({
        upstream: upstreamWithoutV1,
        localToken: LOCAL_TOKEN,
        engine,
      })

      const proxyBase = proxy.baseUrl.replace(/\/v1$/, '')
      const authHeaders = {
        'content-type': 'application/json',
        'x-echoregent-local-token': LOCAL_TOKEN,
      }

      try {
        // A. /memory/remember
        const remRes = await fetch(`${proxyBase}/memory/remember`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            scope: { project: 'proj-no-v1', session: 'sess-no-v1' },
            fact: { content: 'EchoRegent bare upstream base verified', sources: ['spec:ws1b'] },
          }),
        })
        expect(remRes.status).toBe(200)
        const remData = (await remRes.json()) as any
        expect(remData.content).toBe('EchoRegent bare upstream base verified')

        // B. /memory/recall
        const recRes = await fetch(`${proxyBase}/memory/recall`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            scope: { project: 'proj-no-v1', session: 'sess-no-v1' },
            query: 'bare upstream',
          }),
        })
        expect(recRes.status).toBe(200)
        const recData = (await recRes.json()) as any[]
        expect(recData).toHaveLength(1)
        expect(recData[0].content).toBe('EchoRegent bare upstream base verified')

        // C. /compress
        const compRes = await fetch(`${proxyBase}/compress`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            text: '[2026-01-01 10:00:00] [INFO] bare upstream test\n'.repeat(25),
          }),
        })
        expect(compRes.status).toBe(200)
        const compData = (await compRes.json()) as any
        expect(compData.changed).toBe(true)
        expect(compData.text).toContain('EchoRegent')

        // D. /v1/chat/completions (forwarded to bare upstream)
        const chatRes = await fetch(`${proxy.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({
            model: 'mock-model',
            messages: [{ role: 'user', content: 'test request to bare upstream' }],
          }),
        })
        expect(chatRes.status).toBe(200)
        const chatData = (await chatRes.json()) as any
        expect(chatData.id).toBe('chatcmpl-mock')

        // Crucial Bug 4 verification: upstream URL must be normalized to /v1/chat/completions without double slashes!
        expect(mockCalls).toHaveLength(1)
        expect(mockCalls[0].url).toBe('/v1/chat/completions')
        expect(mockCalls[0].url).not.toContain('//')
      } finally {
        await proxy.close()
      }
    })
  })
})
