import { createHash, randomBytes } from 'node:crypto'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDb } from './database.js'
import {
  isFirebaseEnabled,
  fbCreateApiKey,
  fbLookupKey,
  fbRevokeKey,
  fbUpdateKeyQuota,
  fbLogUsage,
  fbGetDashboard,
  fbGetKeyUsage,
  fbGetOwnUsage,
  fbGetWaitlistCount,
  fbGetWaitlistPosition,
  fbSaveKeyRequest,
  fbGetKeyRequests,
  fbFulfillKeyRequest,
  fbLoadWiki,
  fbSaveUserWiki,
  fbSaveLLMWiki,
  fbDeleteWiki,
  fbCreateUser,
  fbAuthenticateUser
} from './firebase.js'

// ── Types ─────────────────────────────────────────────────────────────────────

export type ApiKey = {
  id: string
  keyHash: string
  name: string
  ownerEmail: string
  createdAt: string
  lastUsedAt: string | null
  active: boolean
  quotaLimit: number
  quotaUsed: number
}

export type UsageEntry = {
  keyId: string
  endpoint: string
  tokensSaved: number
  calledAt: string
}

export type UsageSummary = Omit<ApiKey, 'keyHash'> & {
  totalCalls: number
  totalTokensSaved: number
  last24hCalls: number
}

export type KeyRequest = {
  id: number
  name: string
  email: string
  useCase: string
  requestedAt: string
  fulfilledAt: string | null
}

// ── JSON file fallback (local dev without DATABASE_URL) ───────────────────────

const dataDir = join(process.cwd(), 'data')
mkdirSync(dataDir, { recursive: true })

const keysPath    = join(dataDir, 'keys.json')
const usagePath   = join(dataDir, 'usage.json')
const reqPath     = join(dataDir, 'key-requests.json')
const storePath   = join(dataDir, 'cts-store.json')

type Store = { userWikis: Record<string, any>; llmWikis: Record<string, any> }

function loadKeys(): ApiKey[] {
  try { return JSON.parse(readFileSync(keysPath, 'utf-8')) } catch { return [] }
}
function saveKeys(keys: ApiKey[]): void {
  writeFileSync(keysPath, JSON.stringify(keys, null, 2), 'utf-8')
}
function loadUsage(): UsageEntry[] {
  try { return JSON.parse(readFileSync(usagePath, 'utf-8')) } catch { return [] }
}
function saveUsage(usage: UsageEntry[]): void {
  writeFileSync(usagePath, JSON.stringify(usage, null, 2), 'utf-8')
}
function loadRequests(): KeyRequest[] {
  try { return JSON.parse(readFileSync(reqPath, 'utf-8')) } catch { return [] }
}
function saveRequests(reqs: KeyRequest[]): void {
  writeFileSync(reqPath, JSON.stringify(reqs, null, 2), 'utf-8')
}
async function loadFullStore(): Promise<Store> {
  try { return JSON.parse(readFileSync(storePath, 'utf-8')) as Store }
  catch { return { userWikis: {}, llmWikis: {} } }
}
async function saveFullStore(store: Store): Promise<void> {
  writeFileSync(storePath, JSON.stringify(store, null, 2), 'utf-8')
}

// ── Crypto ────────────────────────────────────────────────────────────────────

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// ── API Key operations ────────────────────────────────────────────────────────

export async function createApiKey(name: string, ownerEmail: string): Promise<{ key: string; id: string }> {
  if (isFirebaseEnabled()) {
    return fbCreateApiKey(name, ownerEmail)
  }

  const raw  = `echoregent_${randomBytes(24).toString('hex')}`
  const id   = `key_${randomBytes(8).toString('hex')}`
  const hash = sha256(raw)
  const db   = getDb()

  if (db) {
    await db.query(
      `INSERT INTO api_keys (id, key_hash, name, owner_email) VALUES ($1, $2, $3, $4)`,
      [id, hash, name.trim() || 'Unnamed', ownerEmail.trim()],
    )
  } else {
    const keys = loadKeys()
    keys.push({
      id, keyHash: hash,
      name: name.trim() || 'Unnamed',
      ownerEmail: ownerEmail.trim(),
      createdAt: new Date().toISOString(),
      lastUsedAt: null, active: true,
      quotaLimit: 10_000, quotaUsed: 0,
    })
    saveKeys(keys)
  }

  return { key: raw, id }
}

export async function lookupKey(raw: string): Promise<Omit<ApiKey, 'keyHash'> | null> {
  if (isFirebaseEnabled()) {
    return fbLookupKey(raw)
  }

  const hash = sha256(raw)
  const db   = getDb()
  const now  = new Date().toISOString()

  if (db) {
    const { rows } = await db.query<{
      id: string; name: string; owner_email: string; created_at: string
      last_used_at: string | null; active: boolean; quota_limit: number; quota_used: number
    }>(
      `UPDATE api_keys SET last_used_at = NOW()
       WHERE key_hash = $1 AND active = TRUE
       RETURNING id, name, owner_email, created_at, last_used_at, active, quota_limit, quota_used`,
      [hash],
    )
    if (!rows[0]) return null
    const r = rows[0]
    return {
      id: r.id, name: r.name, ownerEmail: r.owner_email,
      createdAt: r.created_at, lastUsedAt: r.last_used_at,
      active: r.active, quotaLimit: r.quota_limit, quotaUsed: r.quota_used,
    }
  } else {
    const keys = loadKeys()
    const key  = keys.find((k) => k.keyHash === hash && k.active)
    if (!key) return null
    key.lastUsedAt = now
    saveKeys(keys)
    const { keyHash: _, ...rest } = key
    return rest
  }
}

export async function revokeKey(keyId: string): Promise<boolean> {
  if (isFirebaseEnabled()) {
    return fbRevokeKey(keyId)
  }

  const db = getDb()

  if (db) {
    const { rowCount } = await db.query(
      `UPDATE api_keys SET active = FALSE WHERE id = $1 AND active = TRUE`,
      [keyId],
    )
    return (rowCount ?? 0) > 0
  } else {
    const keys = loadKeys()
    const key  = keys.find((k) => k.id === keyId)
    if (!key) return false
    key.active = false
    saveKeys(keys)
    return true
  }
}

export async function updateKeyQuota(keyId: string, limit: number, used: number): Promise<boolean> {
  if (isFirebaseEnabled()) {
    return fbUpdateKeyQuota(keyId, limit, used)
  }

  const db = getDb()

  if (db) {
    const { rowCount } = await db.query(
      `UPDATE api_keys SET quota_limit = $1, quota_used = $2 WHERE id = $3`,
      [limit, used, keyId],
    )
    return (rowCount ?? 0) > 0
  } else {
    const keys = loadKeys()
    const key  = keys.find((k) => k.id === keyId)
    if (!key) return false
    key.quotaLimit = limit
    key.quotaUsed = used
    saveKeys(keys)
    return true
  }
}

// ── Usage tracking ────────────────────────────────────────────────────────────

export function logUsage(keyId: string, endpoint: string, tokensSaved: number): void {
  if (isFirebaseEnabled()) {
    return fbLogUsage(keyId, endpoint, tokensSaved)
  }

  const db = getDb()

  if (db) {
    db.query(
      `INSERT INTO usage_log (key_id, endpoint, tokens_saved) VALUES ($1, $2, $3)`,
      [keyId, endpoint, tokensSaved],
    ).catch((err) => console.error('[db] logUsage error:', err))

    db.query(
      `UPDATE api_keys SET quota_used = quota_used + 1 WHERE id = $1`,
      [keyId],
    ).catch((err) => console.error('[db] quota increment error:', err))
  } else {
    setImmediate(() => {
      const usage = loadUsage()
      usage.push({ keyId, endpoint, tokensSaved, calledAt: new Date().toISOString() })
      if (usage.length > 10_000) usage.splice(0, usage.length - 10_000)
      saveUsage(usage)
    })
  }
}

// ── Dashboard & reporting ─────────────────────────────────────────────────────

export async function getDashboard(): Promise<UsageSummary[]> {
  if (isFirebaseEnabled()) {
    return fbGetDashboard()
  }

  const db      = getDb()
  const cutoff  = new Date(Date.now() - 86_400_000).toISOString()

  if (db) {
    const { rows } = await db.query<{
      id: string; name: string; owner_email: string; created_at: string
      last_used_at: string | null; active: boolean; quota_limit: number; quota_used: number
      total_calls: string; total_tokens_saved: string; last24h_calls: string
    }>(`
      SELECT
        k.id, k.name, k.owner_email, k.created_at, k.last_used_at,
        k.active, k.quota_limit, k.quota_used,
        COUNT(u.id)::text                                    AS total_calls,
        COALESCE(SUM(u.tokens_saved), 0)::text              AS total_tokens_saved,
        COUNT(u.id) FILTER (WHERE u.called_at >= $1)::text  AS last24h_calls
      FROM api_keys k
      LEFT JOIN usage_log u ON u.key_id = k.id
      GROUP BY k.id
      ORDER BY k.created_at DESC
    `, [cutoff])

    return rows.map((r) => ({
      id: r.id, name: r.name, ownerEmail: r.owner_email,
      createdAt: r.created_at, lastUsedAt: r.last_used_at,
      active: r.active, quotaLimit: r.quota_limit, quotaUsed: r.quota_used,
      totalCalls: Number(r.total_calls),
      totalTokensSaved: Number(r.total_tokens_saved),
      last24hCalls: Number(r.last24h_calls),
    }))
  } else {
    const keys   = loadKeys()
    const usage  = loadUsage()

    return keys
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((key) => {
        const ku = usage.filter((u) => u.keyId === key.id)
        const { keyHash: _, ...rest } = key
        return {
          ...rest,
          totalCalls: ku.length,
          totalTokensSaved: ku.reduce((s, u) => s + u.tokensSaved, 0),
          last24hCalls: ku.filter((u) => u.calledAt >= cutoff).length,
        }
      })
  }
}

export async function getKeyUsage(keyId: string, limit = 100): Promise<UsageEntry[]> {
  if (isFirebaseEnabled()) {
    return fbGetKeyUsage(keyId, limit)
  }

  const db = getDb()

  if (db) {
    const { rows } = await db.query<{ key_id: string; endpoint: string; tokens_saved: number; called_at: string }>(
      `SELECT key_id, endpoint, tokens_saved, called_at
       FROM usage_log WHERE key_id = $1
       ORDER BY called_at DESC LIMIT $2`,
      [keyId, limit],
    )
    return rows.map((r) => ({
      keyId: r.key_id, endpoint: r.endpoint,
      tokensSaved: r.tokens_saved, calledAt: r.called_at,
    }))
  } else {
    return loadUsage().filter((u) => u.keyId === keyId).slice(-limit).reverse()
  }
}

export async function getOwnUsage(keyId: string): Promise<{ totalCalls: number; totalTokensSaved: number; last24hCalls: number }> {
  if (isFirebaseEnabled()) {
    return fbGetOwnUsage(keyId)
  }

  const db     = getDb()
  const cutoff = new Date(Date.now() - 86_400_000).toISOString()

  if (db) {
    const { rows } = await db.query<{ total_calls: string; total_tokens: string; last24h: string }>(
      `SELECT
         COUNT(*)::text                                        AS total_calls,
         COALESCE(SUM(tokens_saved), 0)::text                 AS total_tokens,
         COUNT(*) FILTER (WHERE called_at >= $2)::text        AS last24h
       FROM usage_log WHERE key_id = $1`,
      [keyId, cutoff],
    )
    const r = rows[0]
    return {
      totalCalls: Number(r?.total_calls ?? 0),
      totalTokensSaved: Number(r?.total_tokens ?? 0),
      last24hCalls: Number(r?.last24h ?? 0),
    }
  } else {
    const ku = loadUsage().filter((u) => u.keyId === keyId)
    return {
      totalCalls: ku.length,
      totalTokensSaved: ku.reduce((s, u) => s + u.tokensSaved, 0),
      last24hCalls: ku.filter((u) => u.calledAt >= cutoff).length,
    }
  }
}

// ── Key requests (from demo "Request Access" form) ────────────────────────────

export async function getWaitlistCount(): Promise<number> {
  if (isFirebaseEnabled()) {
    return fbGetWaitlistCount()
  }

  const db = getDb()
  if (db) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM key_requests WHERE fulfilled_at IS NULL`,
    )
    return Number(rows[0]?.count ?? 0)
  } else {
    return loadRequests().filter((r) => !r.fulfilledAt).length
  }
}

export async function getWaitlistPosition(email: string): Promise<number> {
  if (isFirebaseEnabled()) {
    return fbGetWaitlistPosition(email)
  }

  const db = getDb()
  if (db) {
    const { rows } = await db.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM key_requests WHERE fulfilled_at IS NULL AND email != $1`,
      [String(email)],
    )
    return Number(rows[0]?.count ?? 0) + 1
  } else {
    const reqs = loadRequests().filter((r) => !r.fulfilledAt && r.email !== String(email))
    return reqs.length + 1
  }
}

export async function saveKeyRequest(name: unknown, email: unknown, useCase: unknown): Promise<void> {
  if (isFirebaseEnabled()) {
    return fbSaveKeyRequest(String(name ?? ''), String(email ?? ''), String(useCase ?? ''))
  }

  const db = getDb()

  if (db) {
    await db.query(
      `INSERT INTO key_requests (name, email, use_case) VALUES ($1, $2, $3)`,
      [String(name ?? ''), String(email ?? ''), String(useCase ?? '')],
    )
  } else {
    const reqs = loadRequests()
    reqs.push({
      id: reqs.length + 1,
      name: String(name ?? ''), email: String(email ?? ''), useCase: String(useCase ?? ''),
      requestedAt: new Date().toISOString(), fulfilledAt: null,
    })
    saveRequests(reqs)
  }
}

export async function getKeyRequests(): Promise<KeyRequest[]> {
  if (isFirebaseEnabled()) {
    return fbGetKeyRequests()
  }

  const db = getDb()

  if (db) {
    const { rows } = await db.query<{
      id: number; name: string; email: string; use_case: string
      requested_at: string; fulfilled_at: string | null
    }>(`SELECT id, name, email, use_case, requested_at, fulfilled_at FROM key_requests ORDER BY requested_at DESC`)

    return rows.map((r) => ({
      id: r.id, name: r.name, email: r.email, useCase: r.use_case,
      requestedAt: r.requested_at, fulfilledAt: r.fulfilled_at,
    }))
  } else {
    return loadRequests()
  }
}

export async function fulfillKeyRequest(id: number): Promise<boolean> {
  if (isFirebaseEnabled()) {
    return fbFulfillKeyRequest(id)
  }

  const db = getDb()

  if (db) {
    const { rowCount } = await db.query(
      `UPDATE key_requests SET fulfilled_at = NOW() WHERE id = $1 AND fulfilled_at IS NULL`,
      [id],
    )
    return (rowCount ?? 0) > 0
  } else {
    const reqs = loadRequests()
    const req  = reqs.find((r) => r.id === id)
    if (!req) return false
    req.fulfilledAt = new Date().toISOString()
    saveRequests(reqs)
    return true
  }
}

// ── Wiki Store operations ─────────────────────────────────────────────────────

export async function loadWiki(userId: string): Promise<{ userWiki: any | null; llmWiki: any | null }> {
  if (isFirebaseEnabled()) {
    return fbLoadWiki(userId)
  }

  const db = getDb()
  if (db) {
    const { rows } = await db.query<{ user_wiki: any | null; llm_wiki: any | null }>(
      `SELECT user_wiki, llm_wiki FROM wiki_store WHERE key_id = $1`,
      [userId],
    )
    return { userWiki: rows[0]?.user_wiki ?? null, llmWiki: rows[0]?.llm_wiki ?? null }
  }
  try {
    const store = await loadFullStore()
    return { userWiki: store.userWikis[userId] ?? null, llmWiki: store.llmWikis[userId] ?? null }
  } catch { return { userWiki: null, llmWiki: null } }
}

export async function saveUserWiki(userId: string, userWiki: any): Promise<void> {
  if (isFirebaseEnabled()) {
    return fbSaveUserWiki(userId, userWiki)
  }

  const db = getDb()
  if (db) {
    await db.query(
      `INSERT INTO wiki_store (key_id, user_wiki, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key_id) DO UPDATE SET user_wiki = $2, updated_at = NOW()`,
      [userId, JSON.stringify(userWiki)],
    )
    return
  }
  const store = await loadFullStore()
  store.userWikis[userId] = userWiki
  await saveFullStore(store)
}

export async function saveLLMWiki(userId: string, llmWiki: any): Promise<void> {
  if (isFirebaseEnabled()) {
    return fbSaveLLMWiki(userId, llmWiki)
  }

  const db = getDb()
  if (db) {
    await db.query(
      `INSERT INTO wiki_store (key_id, llm_wiki, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key_id) DO UPDATE SET llm_wiki = $2, updated_at = NOW()`,
      [userId, JSON.stringify(llmWiki)],
    )
    return
  }
  const store = await loadFullStore()
  store.llmWikis[userId] = llmWiki
  await saveFullStore(store)
}

export async function deleteWiki(userId: string): Promise<void> {
  if (isFirebaseEnabled()) {
    return fbDeleteWiki(userId)
  }

  const db = getDb()
  if (db) {
    await db.query(`DELETE FROM wiki_store WHERE key_id = $1`, [userId])
    return
  }
  const store = await loadFullStore()
  delete store.userWikis[userId]
  delete store.llmWikis[userId]
  await saveFullStore(store)
}

export async function createUser(email: string, passwordPlain: string, role: 'admin' | 'user', name: string, keyId = ''): Promise<void> {
  if (isFirebaseEnabled()) {
    return fbCreateUser(email, passwordPlain, role, name, keyId)
  }
  // In local mode, we just log it or save to a file
  console.log(`[local] Create user: ${email} (${role})`)
}

export async function authenticateUser(email: string, passwordPlain: string): Promise<{ email: string; role: 'admin' | 'user'; name: string; keyId: string } | null> {
  if (isFirebaseEnabled()) {
    return fbAuthenticateUser(email, passwordPlain)
  }
  // Local fallback credentials
  if (email.toLowerCase() === 'admin@echoregent.com' && passwordPlain === 'admin') {
    return { email: 'admin@echoregent.com', role: 'admin', name: 'Admin User', keyId: '' }
  }
  return null
}
