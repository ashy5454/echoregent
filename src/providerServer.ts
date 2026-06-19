import type { LiveLLMConfig } from './llmClient.js'
import type { Message } from './cts-core/index.js'

export interface ProviderRequest extends LiveLLMConfig {
  systemPrompt: string
  compressedHistory: Message[]
  message: string
}

export async function callLLMProvider(body: ProviderRequest): Promise<string> {
  if (body.provider === 'gemini') return callGemini(body)
  if (body.provider === 'anthropic') return callAnthropic(body)
  if (body.provider === 'openrouter') {
    return callOpenAICompatible(body, 'https://openrouter.ai/api/v1/chat/completions', {
      'HTTP-Referer': 'http://127.0.0.1:5173',
      'X-Title': 'CTS Local API',
    })
  }
  return callOpenAICompatible(body, 'https://api.openai.com/v1/chat/completions')
}

export function validateProviderRequest(body: Partial<ProviderRequest>): asserts body is ProviderRequest {
  if (!['openai', 'gemini', 'anthropic', 'openrouter'].includes(String(body.provider))) throw new Error('Unsupported provider.')
  for (const key of ['apiKey', 'model', 'systemPrompt', 'message'] as const) {
    if (typeof body[key] !== 'string' || body[key]?.trim() === '') throw new Error(`Missing ${key}.`)
  }
  if (!Array.isArray(body.compressedHistory)) throw new Error('compressedHistory must be an array.')
}

const PROVIDER_TIMEOUT_MS = 30_000

async function callOpenAICompatible(body: ProviderRequest, url: string, extraHeaders: Record<string, string> = {}): Promise<string> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
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
          ...body.compressedHistory.map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: body.message },
        ],
      }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(providerError(payload, response.status))
    return payload.choices?.[0]?.message?.content?.trim() || ''
  } finally {
    clearTimeout(timer)
  }
}

async function callGemini(body: ProviderRequest): Promise<string> {
  const text = [
    body.systemPrompt,
    '',
    'Compressed history:',
    ...body.compressedHistory.map((message) => `${message.role}: ${message.content}`),
    '',
    `Current user message: ${body.message}`,
  ].join('\n')

  // Gemini REST API requires the key as a query param — no header-based auth for API keys.
  // This is server-to-server only; ensure HTTPS is always used (Railway enforces this).
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(body.model)}:generateContent?key=${encodeURIComponent(body.apiKey)}`,
      {
        signal: controller.signal,
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0.2 },
        }),
      },
    )
    const payload = await response.json()
    if (!response.ok) throw new Error(providerError(payload, response.status))
    return payload.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text).join('').trim() || ''
  } finally {
    clearTimeout(timer)
  }
}

async function callAnthropic(body: ProviderRequest): Promise<string> {
  const controller = new AbortController()
  const timer      = setTimeout(() => controller.abort(), PROVIDER_TIMEOUT_MS)
  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      signal: controller.signal,
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
          ...body.compressedHistory.map((message) => ({ role: message.role, content: message.content })),
          { role: 'user', content: body.message },
        ],
      }),
    })
    const payload = await response.json()
    if (!response.ok) throw new Error(providerError(payload, response.status))
    return payload.content?.map((part: { text?: string }) => part.text).join('').trim() || ''
  } finally {
    clearTimeout(timer)
  }
}

function providerError(payload: { error?: { message?: string } | string }, status: number): string {
  return typeof payload?.error === 'string' ? payload.error : payload?.error?.message || `Provider request failed with HTTP ${status}.`
}

