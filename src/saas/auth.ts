import type { IncomingMessage, ServerResponse } from 'node:http'
import { logUsage, lookupKey, type UsageSummary } from './db.js'

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

export async function authenticate(
  req: IncomingMessage,
  res: ServerResponse,
): Promise<ApiKey | null> {
  const header = req.headers['authorization'] ?? ''
  const raw    = header.startsWith('Bearer ') ? header.slice(7).trim() : ''

  if (!raw) {
    sendUnauth(res, 'Missing Authorization header. Use: Authorization: Bearer <your-cts-key>')
    return null
  }

  const key = await lookupKey(raw)
  if (!key) {
    sendUnauth(res, 'Invalid or revoked API key.')
    return null
  }

  if (!checkRateLimit(key.id)) {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
    res.end(JSON.stringify({ error: 'Rate limit exceeded. Max 60 requests/minute per key.' }))
    return null
  }

  return key
}

export function recordUsage(keyId: string, endpoint: string, tokensSaved = 0): void {
  logUsage(keyId, endpoint, tokensSaved)
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
