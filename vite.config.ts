import { defineConfig } from 'vite'
import { resolve } from 'path'

export default defineConfig({
  root: 'site',
  plugins: [localLLMProxy()],
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: resolve(process.cwd(), 'site/index.html'),
        about: resolve(process.cwd(), 'site/about.html'),
        changelog: resolve(process.cwd(), 'site/changelog.html'),
        docs: resolve(process.cwd(), 'site/docs.html'),
        enterprise: resolve(process.cwd(), 'site/enterprise.html'),
        pricing: resolve(process.cwd(), 'site/pricing.html'),
        product: resolve(process.cwd(), 'site/product.html'),
        research: resolve(process.cwd(), 'site/research.html'),
        security: resolve(process.cwd(), 'site/security.html'),
        'blog/index': resolve(process.cwd(), 'site/blog/index.html'),
        'blog/introducing-echoregent': resolve(process.cwd(), 'site/blog/introducing-echoregent.html'),
        'blog/locomo-benchmark': resolve(process.cwd(), 'site/blog/locomo-benchmark.html'),
      },
    },
  },
  server: {
    port: 5173,
    proxy: {
      '/demo': 'http://127.0.0.1:8787',
      '/api': 'http://127.0.0.1:8787',
      '/compress': 'http://127.0.0.1:8787',
      '/admin': 'http://127.0.0.1:8787',
    },
  },
  test: {
    environment: 'node',
  },
})

function localLLMProxy() {
  return {
    name: 'cts-local-llm-proxy',
    configureServer(server: any) {
      server.middlewares.use('/api/llm', proxyHandler)
    },
    configurePreviewServer(server: any) {
      server.middlewares.use('/api/llm', proxyHandler)
    },
  }
}

async function proxyHandler(req: any, res: any) {
  if (req.method !== 'POST') {
    sendJson(res, 405, { error: 'Only POST is supported.' })
    return
  }

  try {
    const body = await readJson(req)
    validateLLMRequest(body)
    const text = await callProvider(body)
    sendJson(res, 200, { text })
  } catch (error) {
    sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

function validateLLMRequest(body: any) {
  if (!body || typeof body !== 'object') throw new Error('Request body must be an object.')
  if (!['openai', 'gemini', 'anthropic', 'openrouter'].includes(body.provider)) throw new Error('Unsupported provider.')
  for (const key of ['apiKey', 'model', 'systemPrompt', 'message']) {
    if (typeof body[key] !== 'string' || body[key].trim() === '') throw new Error(`Missing ${key}.`)
  }
  if (!Array.isArray(body.compressedHistory)) throw new Error('compressedHistory must be an array.')
}

async function callProvider(body: any): Promise<string> {
  if (body.provider === 'gemini') return callGemini(body)
  if (body.provider === 'anthropic') return callAnthropic(body)
  if (body.provider === 'openrouter') return callOpenAICompatible(body, 'https://openrouter.ai/api/v1/chat/completions', {
    'HTTP-Referer': 'http://127.0.0.1:5173',
    'X-Title': 'CTS Visual Simulator',
  })
  return callOpenAICompatible(body, 'https://api.openai.com/v1/chat/completions')
}

async function callOpenAICompatible(body: any, url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${body.apiKey}`,
      ...extraHeaders,
    },
    body: JSON.stringify({
      model: body.model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: body.systemPrompt },
        ...body.compressedHistory.map((message: any) => ({
          role: message.role,
          content: String(message.content),
        })),
        { role: 'user', content: body.message },
      ],
    }),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(providerError(payload, response.status))
  return payload.choices?.[0]?.message?.content?.trim() || ''
}

async function callGemini(body: any): Promise<string> {
  const text = [
    body.systemPrompt,
    '',
    'Compressed history:',
    ...body.compressedHistory.map((message: any) => `${message.role}: ${message.content}`),
    '',
    `Current user message: ${body.message}`,
  ].join('\n')

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(body.model)}:generateContent?key=${encodeURIComponent(body.apiKey)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { temperature: 0.2 },
    }),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(providerError(payload, response.status))
  return payload.candidates?.[0]?.content?.parts?.map((part: any) => part.text).join('').trim() || ''
}

async function callAnthropic(body: any): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': body.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: body.model,
      max_tokens: 900,
      temperature: 0.2,
      system: body.systemPrompt,
      messages: [
        ...body.compressedHistory.map((message: any) => ({
          role: message.role,
          content: String(message.content),
        })),
        { role: 'user', content: body.message },
      ],
    }),
  })

  const payload = await response.json()
  if (!response.ok) throw new Error(providerError(payload, response.status))
  return payload.content?.map((part: any) => part.text).join('').trim() || ''
}

function providerError(payload: any, status: number): string {
  return payload?.error?.message || payload?.error || `Provider request failed with HTTP ${status}.`
}

function readJson(req: any): Promise<any> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > 100_000) {
        reject(new Error('Request body too large.'))
        req.destroy()
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(body || '{}'))
      } catch {
        reject(new Error('Invalid JSON body.'))
      }
    })
    req.on('error', reject)
  })
}

function sendJson(res: any, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
