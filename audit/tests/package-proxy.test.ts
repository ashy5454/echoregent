import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { connect } from 'node:net'
import { EchoRegent, restoreCompressedRequest } from '../../packages/core/src/index.js'
import * as adapter from '../../packages/cli/src/proxy.js'

async function fixture(handler: Parameters<typeof createServer>[0]) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return { url: `http://127.0.0.1:${(server.address() as any).port}/v1`, close: () => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()) }) }
}

describe('installed proxy contract', () => {
  it('exports the local proxy adapter', () => { expect(adapter.startProxy).toBeTypeOf('function') })

  it('forwards optional compacted history through a local upstream with exact text reconstruction', async () => {
    let received: any
    const upstream = await fixture((req, res) => {
      let text = ''
      req.on('data', (chunk) => text += chunk)
      req.on('end', () => { received = JSON.parse(text); res.setHeader('content-type', 'application/json'); res.end('{"id":"local-result"}') })
    })
    const proxy = await adapter.startProxy({ upstream: upstream.url, engine: new EchoRegent({ compactHistory: true }) })
    try {
      const body = { model: 'local-fixture', input: Array.from({ length: 40 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user', content: `We are discussing the build step ${i} and its next action.`, id: `turn-${i}`,
      })) }
      const response = await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(response.headers.get('x-echoregent-compressed')).toBe('true')
      expect(await response.json()).toEqual({ id: 'local-result' })
      expect(received.input.slice(-8)).toEqual(body.input.slice(-8))
      expect(restoreCompressedRequest(received, 'responses')).toEqual(body)
      expect(proxy.stats.compressed).toBe(1)
    } finally { await proxy.close(); await upstream.close() }
  })

  it('rejects malformed HTTP targets without crashing the proxy', async () => {
    const proxy = await adapter.startProxy({ upstream: 'https://api.openai.com/v1' })
    try {
      const port = Number(new URL(proxy.baseUrl).port)
      const socket = connect(port, '127.0.0.1')
      let response = ''
      socket.setEncoding('utf8')
      socket.on('data', (chunk) => response += chunk)
      await once(socket, 'connect')
      socket.write('GET http://[ HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n')
      await once(socket, 'close')
      expect(response).toContain('400')
      expect((await fetch(proxy.baseUrl.replace('/v1', '/health'))).status).toBe(200)
    } finally { await proxy.close() }
  })

  it('streams large responses without accumulating event listeners', async () => {
    const warnings: Error[] = []
    const record = (warning: Error) => { if (warning.name === 'MaxListenersExceededWarning') warnings.push(warning) }
    process.on('warning', record)
    const payload = 'x'.repeat(8 * 1024 * 1024)
    const upstream = await fixture((_req, res) => res.end(payload))
    const proxy = await adapter.startProxy({ upstream: upstream.url })
    try {
      const response = await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', body: '{}' })
      expect((await response.text()).length).toBe(payload.length)
      expect(warnings).toEqual([])
    } finally { process.off('warning', record); await proxy.close(); await upstream.close() }
  })

  it('does not report a client stream cancellation as a proxy failure', async () => {
    const upstream = await fixture((_req, res) => {
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: {"type":"response.created"}\n\n')
      const timer = setTimeout(() => res.end(), 500)
      res.on('close', () => clearTimeout(timer))
    })
    const proxy = await adapter.startProxy({ upstream: upstream.url })
    try {
      const response = await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', body: '{}' })
      const reader = response.body!.getReader()
      await reader.read()
      await reader.cancel()
      await new Promise((resolve) => setTimeout(resolve, 100))
      expect(proxy.stats.errors).toBe(0)
    } finally { await proxy.close(); await upstream.close() }
  })

  it('relays Responses authentication, tools and body metadata with incremental SSE', async () => {
    let received: any
    const upstream = await fixture((req, res) => {
      let text = ''
      req.on('data', (chunk) => text += chunk)
      req.on('end', () => {
        received = { path: req.url, auth: req.headers.authorization, body: JSON.parse(text) }
        res.writeHead(200, { 'content-type': 'text/event-stream', 'x-request-id': 'fixture-id' })
        res.write('event: response.created\ndata: {"type":"response.created"}\n\n')
        setTimeout(() => res.end('event: response.completed\ndata: {"type":"response.completed","usage":{"input_tokens":7}}\n\n'), 120)
      })
    })
    const proxy = await adapter.startProxy({ upstream: upstream.url })
    try {
      const body = { model: 'fixture', stream: true, prompt_cache_key: 'stable', input: [{ role: 'user', content: [{ type: 'input_text', text: 'run tests' }] }, { type: 'function_call', call_id: 'call_1', name: 'shell', arguments: '{}' }, { type: 'function_call_output', call_id: 'call_1', output: 'PASS unit\n'.repeat(80) + 'FAIL integration' }] }
      const response = await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', headers: { authorization: 'Bearer fixture-key', 'content-type': 'application/json' }, body: JSON.stringify(body) })
      expect(response.headers.get('x-request-id')).toBe('fixture-id')
      expect(response.headers.get('x-echoregent-compressed')).toBe('true')
      const reader = response.body!.getReader()
      const first = await reader.read()
      expect(new TextDecoder().decode(first.value)).toContain('response.created')
      expect(new TextDecoder().decode(first.value)).not.toContain('response.completed')
      let remaining = ''
      for (;;) { const next = await reader.read(); if (next.done) break; remaining += new TextDecoder().decode(next.value) }
      expect(remaining).toContain('response.completed')
      expect(received.auth).toBe('Bearer fixture-key')
      expect(received.path).toBe('/v1/responses')
      expect(received.body.input.slice(0, 2)).toEqual(body.input.slice(0, 2))
      expect(received.body.input[2].call_id).toBe('call_1')
      expect(received.body.input[2].output).toContain('FAIL integration')
      expect(received.body.prompt_cache_key).toBe('stable')
      expect(proxy.stats.requests).toBe(1)
    } finally { await proxy.close(); await upstream.close() }
  })

  it('forwards the exact original request bytes on a compression error', async () => {
    let received = ''
    const upstream = await fixture((req, res) => { req.on('data', (chunk) => received += chunk); req.on('end', () => res.end('{}')) })
    const proxy = await adapter.startProxy({ upstream: upstream.url, engine: new EchoRegent({ compressor() { throw new Error('compression failed') } }) })
    try {
      const raw = '{ "model": "fixture", "input": [ {"type":"function_call_output","output":"log"} ] }\n'
      await (await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: raw })).text()
      expect(received).toBe(raw)
    } finally { await proxy.close(); await upstream.close() }
  })

  it('preserves provider errors and rejects unsupported routes and invalid JSON locally', async () => {
    const upstream = await fixture((_req, res) => { res.writeHead(401, { 'content-type': 'application/json' }); res.end('{"error":{"message":"fixture auth failed"}}') })
    const proxy = await adapter.startProxy({ upstream: upstream.url })
    try {
      const response = await fetch(`${proxy.baseUrl}/chat/completions`, { method: 'POST', body: '{"messages":[]}' })
      expect(response.status).toBe(401)
      expect(await response.text()).toBe('{"error":{"message":"fixture auth failed"}}')
      expect((await fetch(`${proxy.baseUrl}/responses`, { method: 'POST', body: 'invalid' })).status).toBe(400)
      expect((await fetch(`${proxy.baseUrl}/unknown`)).status).toBe(404)
    } finally { await proxy.close(); await upstream.close() }
  })

  it('uses the same protected memory and compression policy in the local API', async () => {
    const proxy = await adapter.startProxy({ upstream: 'https://api.openai.com/v1', engine: new EchoRegent({ memory: { mode: 'ephemeral', retentionMs: 60_000 } }) })
    try {
      const post = (path: string, body: unknown) => fetch(`${proxy.baseUrl.replace(/\/v1$/, '')}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const response = await post('/compress', { text: 'My medical prescription\n'.repeat(80) })
      expect((await response.json()).policy.protected).toBe(true)
      const denied = await post('/memory/remember', { scope: { project: 'p', session: 's' }, fact: { content: 'My prescription dose is 20mg', sources: ['turn:1'] } })
      expect(denied.status).toBe(400)
      const missingScope = await post('/memory/recall', { query: 'anything' })
      expect(missingScope.status).toBe(400)
    } finally { await proxy.close() }
  })
})
