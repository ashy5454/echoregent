import type { IncomingMessage, ServerResponse } from 'node:http'
import { logUsage, lookupKey, type UsageSummary, type UsageMeta } from './db.js'

type ApiKey = Omit<UsageSummary, 'totalCalls' | 'totalTokensSaved' | 'last24hCalls'>

// In-memory rate limit: 60 requests per key per minute
const rateLimitMap = new Map<string, { count: number; windowStart: number }>()
const RATE_LIMIT = 60
const WINDOW_MS  = 60_000

// Evict stale entries every 5 minutes to prevent memory leak
setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS
  for (const [id, entry] of rateLimitMap) {
    if (entry.windowStart < cutoff) rateLimitMap.delete(id)
  }
}, 300_000).unref()

export type AuthedRequest = IncomingMessage & { keyId: string; keyName: string }

function extractRawKey(req: IncomingMessage): string {
  const getH = (name: string): string | string[] | undefined => {
    if (req.headers[name] !== undefined) return req.headers[name]
    const lower = name.toLowerCase()
    if (req.headers[lower] !== undefined) return req.headers[lower]
    for (const [k, v] of Object.entries(req.headers)) {
      if (k.toLowerCase() === lower) return v
    }
    return undefined
  }

  const authHeader = getH('authorization')
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const token = authHeader.slice(7).trim()
    if (token) return token
  } else if (Array.isArray(authHeader)) {
    for (const h of authHeader) {
      if (h.startsWith('Bearer ')) {
        const token = h.slice(7).trim()
        if (token) return token
      }
    }
  }

  const echoHeader = getH('x-echoregent-key')
  const echoVal = Array.isArray(echoHeader) ? echoHeader[0] : echoHeader
  if (typeof echoVal === 'string' && echoVal.trim()) {
    const val = echoVal.trim()
    return val.startsWith('Bearer ') ? val.slice(7).trim() : val
  }

  const ctsHeader = getH('x-cts-key')
  const ctsVal = Array.isArray(ctsHeader) ? ctsHeader[0] : ctsHeader
  if (typeof ctsVal === 'string' && ctsVal.trim()) {
    const val = ctsVal.trim()
    return val.startsWith('Bearer ') ? val.slice(7).trim() : val
  }

  return ''
}

export async function authenticate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<ApiKey | null> {
  const raw = extractRawKey(req)

  if (!raw) {
    sendUnauth(res, 'Missing Authorization header. Use: Authorization: Bearer ***')
    return null
  }

  const key = await lookupKey(raw)
  if (!key) {
    sendUnauth(res, 'Invalid or revoked API key.')
    return null
  }

  if (typeof key.quotaLimit === 'number' && key.quotaLimit > 0 && key.quotaUsed >= key.quotaLimit) {
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'API key quota exceeded. Upgrade or increase your quota limit.' }))
    return null
  }

  if (!checkRateLimit(key.id)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Max 60 requests/minute per key.' }))
    return null
  }

  return key
}

export function recordUsage(keyId: string, endpoint: string, tokensSaved = 0, meta?: UsageMeta): void {
  logUsage(keyId, endpoint, tokensSaved, meta)
}

export function resetRateLimits(): void {
  rateLimitMap.clear()
}

function checkRateLimit(keyId: string): boolean {
  const now   = Date.now()
  const entry = rateLimitMap.get(keyId)
  if (!entry || now - entry.windowStart > WINDOW_MS) {
    rateLimitMap.set(keyId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count += 1
  return true
}

function sendUnauth(res: ServerResponse, message: string): void {
  res.writeHead(401, { 'Content-Type': 'application/json', 'WWW-Authenticate': 'Bearer' })
  res.end(JSON.stringify({ error: message }))
}
