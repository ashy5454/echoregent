import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { EchoRegent, type MemoryScope } from '@echoregent/core'

export interface ProxyOptions { upstream: string; port?: number; engine?: EchoRegent; scope?: MemoryScope; localToken?: string }
export interface ProxyStats { requests: number; compressed: number; protected: number; errors: number }

const hopHeaders = new Set(['connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length', 'accept-encoding', 'content-encoding'])

function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(JSON.stringify(value))
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > 32 * 1024 * 1024) throw new Error('Request exceeds 32 MiB limit')
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

export async function startProxy(options: ProxyOptions) {
  const target = new URL(options.upstream)
  if (!['http:', 'https:'].includes(target.protocol) || target.username || target.password || target.search || target.hash) throw new Error('Upstream must be an HTTP(S) base URL without credentials, query or fragment')
  target.pathname = target.pathname.replace(/\/+$/, '')
  const engine = options.engine ?? new EchoRegent()
  const stats: ProxyStats = { requests: 0, compressed: 0, protected: 0, errors: 0 }
  const active = new Set<AbortController>()
  const server = createServer(async (req, res) => {
    let url: URL
    try { url = new URL(req.url ?? '/', 'http://127.0.0.1') }
    catch { json(res, 400, { error: 'Invalid HTTP request target' }); return }
    // Browser origins are not CLI/API clients; keep the local control surface private.
    const secFetchSite = req.headers['sec-fetch-site']
    if (req.headers.origin !== undefined || (secFetchSite !== undefined && secFetchSite !== 'none')) {
      json(res, 403, { error: 'Browser origins are not allowed' })
      return
    }
    if (options.localToken && req.headers['x-echoregent-local-token'] !== options.localToken) { json(res, 401, { error: 'Local token required' }); return }
    if (req.method === 'GET' && url.pathname === '/health') {
      json(res, 200, { product: 'echoregent', version: '0.4.0', mode: 'deterministic', telemetry: false, models: [], stats })
      return
    }
    const route = url.pathname.replace(/\/$/, '')
    const providerRoute = route === '/v1/responses' || route === '/v1/chat/completions'
    const localRoute = ['/compress', '/classify', '/memory/remember', '/memory/recall', '/memory/update', '/memory/forget', '/memory/purge'].includes(route)
    if (req.method !== 'POST' || (!providerRoute && !localRoute)) { json(res, 404, { error: 'Unsupported route' }); return }
    const controller = new AbortController()
    active.add(controller)
    res.on('close', () => { if (!res.writableFinished) controller.abort() })
    try {
      if (req.headers['content-encoding'] && req.headers['content-encoding'] !== 'identity') { json(res, 415, { error: 'Compressed request bodies are unsupported' }); return }
      const original = await readBody(req)
      let body: Record<string, any>
      try { body = JSON.parse(original.toString('utf8')) } catch { json(res, 400, { error: 'Invalid JSON' }); return }
      if (!body || typeof body !== 'object' || Array.isArray(body)) { json(res, 400, { error: 'JSON object required' }); return }
      if (localRoute) {
        const scope = options.scope ?? body.scope
        let result: unknown
        if (route === '/classify' || route === '/compress') {
          if (typeof body.text !== 'string') throw new Error('text must be a string')
          result = route === '/classify' ? engine.classify(body.text, scope) : engine.compressText(body.text, scope)
        } else if (route === '/memory/remember') result = await engine.remember(scope, body.fact, body.context)
        else if (route === '/memory/recall') {
          if (typeof body.query !== 'string') throw new Error('query must be a string')
          result = await engine.recall(scope, body.query, body.context)
        } else if (route === '/memory/update') result = await engine.update(scope, body.id, body.fact, body.context)
        else if (route === '/memory/forget') result = { deleted: await engine.forget(scope, body.id) }
        else result = { deleted: await engine.purge(scope) }
        json(res, 200, result)
        return
      }
      const result = engine.process(body, route === '/v1/responses' ? 'responses' : 'chat-completions', options.scope)
      stats.requests++
      if (result.changed) stats.compressed++
      if (result.policy.protected) stats.protected++
      const headers = new Headers()
      const extraHopHeaders = new Set(String(req.headers.connection ?? '').toLowerCase().split(',').map((name) => name.trim()))
      for (const [name, value] of Object.entries(req.headers)) {
        if (value !== undefined && !hopHeaders.has(name) && !extraHopHeaders.has(name) && !name.startsWith('x-echoregent-')) headers.set(name, Array.isArray(value) ? value.join(', ') : value)
      }
      headers.set('content-type', 'application/json')
      const endpoint = new URL(target)
      const basePath = target.pathname.replace(/\/+$/, '')
      endpoint.pathname = basePath.endsWith('/v1')
        ? `${basePath}${route.slice('/v1'.length)}`
        : `${basePath}${route}`
      endpoint.search = url.search
      const response = await fetch(endpoint, {
        method: 'POST', headers, body: result.changed ? JSON.stringify(result.request) : new Uint8Array(original),
        signal: controller.signal, redirect: 'manual',
      })
      res.statusCode = response.status
      for (const [name, value] of response.headers) if (!hopHeaders.has(name)) res.setHeader(name, value)
      res.setHeader('x-echoregent-compressed', String(result.changed))
      res.setHeader('x-echoregent-protected', String(result.policy.protected))
      res.setHeader('x-echoregent-reason', result.reason)
      res.setHeader('x-echoregent-characters-removed', String(result.charactersRemoved))
      if (!response.body) { res.end(); return }
      // Forward SSE bytes incrementally; never parse/reorder tool events or usage.
      for await (const chunk of response.body as any as AsyncIterable<Uint8Array>) {
        if (!res.write(chunk)) await new Promise<void>((resolveDrain, reject) => {
          const cleanup = () => { res.off('drain', drained); res.off('close', closed); res.off('error', failed) }
          const drained = () => { cleanup(); resolveDrain() }
          const closed = () => { cleanup(); reject(new Error('Client disconnected')) }
          const failed = (error: Error) => { cleanup(); reject(error) }
          res.once('drain', drained)
          res.once('close', closed)
          res.once('error', failed)
          if (res.destroyed) closed()
        })
      }
      res.end()
    } catch (error) {
      // Codex closes the SSE connection after response.completed. Cancellation
      // is expected client behavior and must not count as a middleware failure.
      if (controller.signal.aborted && res.destroyed) return
      stats.errors++
      if (res.headersSent) res.destroy()
      else if (!res.destroyed) json(res, providerRoute ? 502 : 400, { error: localRoute ? (error as Error).message : 'Provider request failed' })
    } finally { active.delete(controller) }
  })
  server.listen(options.port ?? 0, '127.0.0.1')
  await once(server, 'listening')
  const baseUrl = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`
  return {
    baseUrl, stats,
    async close() {
      for (const controller of active) controller.abort()
      await new Promise<void>((resolveClose, reject) => { server.close((error) => error ? reject(error) : resolveClose()); server.closeAllConnections() })
    },
  }
}
