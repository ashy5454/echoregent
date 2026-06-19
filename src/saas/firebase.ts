import { initializeApp, cert, getApps } from 'firebase-admin/app'
import { getFirestore } from 'firebase-admin/firestore'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createHash, randomBytes } from 'node:crypto'

// Initialize Firebase Admin
if (getApps().length === 0) {
  const serviceAccountPath = join(process.cwd(), 'data', 'firebase-service-account.json')
  if (existsSync(serviceAccountPath)) {
    try {
      const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, 'utf-8'))
      initializeApp({
        credential: cert(serviceAccount)
      })
      console.log('[firebase] Initialized with service account file')
    } catch (err) {
      console.error('[firebase] Error loading service account file:', err)
      initializeApp()
    }
  } else if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT)
      initializeApp({
        credential: cert(serviceAccount)
      })
      console.log('[firebase] Initialized with FIREBASE_SERVICE_ACCOUNT env var')
    } catch (err) {
      console.error('[firebase] Error parsing FIREBASE_SERVICE_ACCOUNT env var:', err)
      initializeApp()
    }
  } else {
    initializeApp()
    console.log('[firebase] Initialized with Application Default Credentials')
  }
}

export const db = getFirestore()

export function isFirebaseEnabled(): boolean {
  const serviceAccountPath = join(process.cwd(), 'data', 'firebase-service-account.json')
  return existsSync(serviceAccountPath) || !!process.env.FIREBASE_SERVICE_ACCOUNT || !!process.env.GOOGLE_APPLICATION_CREDENTIALS
}

// Helper hash function
function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

// Interfaces
export interface ApiKey {
  id: string
  keyHash: string
  name: string
  ownerEmail: string
  createdAt: string
  lastUsedAt: string | null
  active: boolean
  quotaLimit: number
  quotaUsed: number
  totalCalls?: number
  totalTokensSaved?: number
}

export interface UsageEntry {
  keyId: string
  endpoint: string
  tokensSaved: number
  calledAt: string
}

export interface KeyRequest {
  id: number
  name: string
  email: string
  useCase: string
  requestedAt: string
  fulfilledAt: string | null
}

export interface WikiDocument {
  pages: any[]
  version: number
  lastUpdated: string
  indexMarkdown: string
  logMarkdown: string
}

// ── Firestore Collections ──
const KEYS_COLL = 'api_keys'
const USAGE_COLL = 'usage_log'
const WIKI_COLL = 'wiki_store'
const REQUESTS_COLL = 'key_requests'

// ── API Key Methods ──

export async function fbCreateApiKey(name: string, ownerEmail: string): Promise<{ key: string; id: string }> {
  const raw = `echoregent_${randomBytes(24).toString('hex')}`
  const id = `key_${randomBytes(8).toString('hex')}`
  const hash = sha256(raw)

  const newKey: ApiKey = {
    id,
    keyHash: hash,
    name: name.trim() || 'Unnamed',
    ownerEmail: ownerEmail.trim(),
    createdAt: new Date().toISOString(),
    lastUsedAt: null,
    active: true,
    quotaLimit: 10000,
    quotaUsed: 0,
    totalCalls: 0,
    totalTokensSaved: 0
  }

  await db.collection(KEYS_COLL).doc(id).set(newKey)
  return { key: raw, id }
}

export async function fbLookupKey(raw: string): Promise<Omit<ApiKey, 'keyHash'> | null> {
  const hash = sha256(raw)
  const snap = await db.collection(KEYS_COLL)
    .where('keyHash', '==', hash)
    .where('active', '==', true)
    .limit(1)
    .get()

  if (snap.empty) return null
  const doc = snap.docs[0]
  const data = doc.data() as ApiKey

  const lastUsedAt = new Date().toISOString()
  await doc.ref.update({ lastUsedAt })

  const { keyHash, ...rest } = data
  return { ...rest, lastUsedAt }
}

export async function fbRevokeKey(keyId: string): Promise<boolean> {
  const ref = db.collection(KEYS_COLL).doc(keyId)
  const doc = await ref.get()
  if (!doc.exists) return false
  await ref.update({ active: false })
  return true
}

export async function fbUpdateKeyQuota(keyId: string, limit: number, used: number): Promise<boolean> {
  const ref = db.collection(KEYS_COLL).doc(keyId)
  const doc = await ref.get()
  if (!doc.exists) return false
  await ref.update({ quotaLimit: limit, quotaUsed: used })
  return true
}

// ── Usage Tracking ──

export function fbLogUsage(keyId: string, endpoint: string, tokensSaved: number): void {
  // Fire-and-forget
  setImmediate(async () => {
    try {
      const now = new Date().toISOString()
      const usageDoc: UsageEntry = {
        keyId,
        endpoint,
        tokensSaved,
        calledAt: now
      }
      await db.collection(USAGE_COLL).add(usageDoc)

      const keyRef = db.collection(KEYS_COLL).doc(keyId)
      await db.runTransaction(async (t: any) => {
        const doc = await t.get(keyRef)
        if (doc.exists) {
          const data = doc.data() as ApiKey
          const quotaUsed = (data.quotaUsed || 0) + 1
          const totalCalls = (data.totalCalls || 0) + 1
          const totalTokensSaved = (data.totalTokensSaved || 0) + tokensSaved
          t.update(keyRef, { quotaUsed, totalCalls, totalTokensSaved })
        }
      })
    } catch (err) {
      console.error('[firebase] logUsage error:', err)
    }
  })
}

// ── Dashboard Reports ──

export async function fbGetDashboard(): Promise<any[]> {
  const keysSnap = await db.collection(KEYS_COLL).orderBy('createdAt', 'desc').get()
  const cutoff = new Date(Date.now() - 86400000).toISOString()
  
  const results = []
  for (const doc of keysSnap.docs) {
    const data = doc.data() as ApiKey
    const { keyHash, ...rest } = data

    // Count calls in last 24h from usage collection
    const usageSnap = await db.collection(USAGE_COLL)
      .where('keyId', '==', data.id)
      .where('calledAt', '>=', cutoff)
      .get()

    results.push({
      ...rest,
      totalCalls: data.totalCalls || 0,
      totalTokensSaved: data.totalTokensSaved || 0,
      last24hCalls: usageSnap.size
    })
  }
  return results
}

export async function fbGetKeyUsage(keyId: string, limit = 100): Promise<UsageEntry[]> {
  const snap = await db.collection(USAGE_COLL)
    .where('keyId', '==', keyId)
    .orderBy('calledAt', 'desc')
    .limit(limit)
    .get()

  return snap.docs.map((doc: any) => doc.data() as UsageEntry)
}

export async function fbGetOwnUsage(keyId: string): Promise<{ totalCalls: number; totalTokensSaved: number; last24hCalls: number }> {
  const keyDoc = await db.collection(KEYS_COLL).doc(keyId).get()
  const cutoff = new Date(Date.now() - 86400000).toISOString()

  const usageSnap = await db.collection(USAGE_COLL)
    .where('keyId', '==', keyId)
    .where('calledAt', '>=', cutoff)
    .get()

  if (keyDoc.exists) {
    const data = keyDoc.data() as ApiKey
    return {
      totalCalls: data.totalCalls || 0,
      totalTokensSaved: data.totalTokensSaved || 0,
      last24hCalls: usageSnap.size
    }
  }

  return { totalCalls: 0, totalTokensSaved: 0, last24hCalls: 0 }
}

// ── Waitlist Operations ──

export async function fbGetWaitlistCount(): Promise<number> {
  const snap = await db.collection(REQUESTS_COLL)
    .where('fulfilledAt', '==', null)
    .get()
  return snap.size
}

export async function fbGetWaitlistPosition(email: string): Promise<number> {
  const snap = await db.collection(REQUESTS_COLL)
    .where('fulfilledAt', '==', null)
    .get()
  const otherCount = snap.docs.filter((doc: any) => doc.data().email !== email).length
  return otherCount + 1
}

export async function fbSaveKeyRequest(name: string, email: string, useCase: string): Promise<void> {
  // Get auto-increment index
  const metaRef = db.collection('meta').doc('key_requests')
  let nextId = 1

  await db.runTransaction(async (t: any) => {
    const metaDoc = await t.get(metaRef)
    if (metaDoc.exists) {
      nextId = (metaDoc.data()?.lastId || 0) + 1
      t.update(metaRef, { lastId: nextId })
    } else {
      t.set(metaRef, { lastId: 1 })
    }
  })

  const newReq: KeyRequest = {
    id: nextId,
    name: name || '',
    email: email || '',
    useCase: useCase || '',
    requestedAt: new Date().toISOString(),
    fulfilledAt: null
  }

  await db.collection(REQUESTS_COLL).doc(String(nextId)).set(newReq)
}

export async function fbGetKeyRequests(): Promise<KeyRequest[]> {
  const snap = await db.collection(REQUESTS_COLL).orderBy('requestedAt', 'desc').get()
  return snap.docs.map((doc: any) => doc.data() as KeyRequest)
}

export async function fbFulfillKeyRequest(id: number): Promise<boolean> {
  const ref = db.collection(REQUESTS_COLL).doc(String(id))
  const doc = await ref.get()
  if (!doc.exists) return false
  await ref.update({ fulfilledAt: new Date().toISOString() })
  return true
}

// ── Wiki Store Methods ──

export async function fbLoadWiki(userId: string): Promise<{ userWiki: any | null; llmWiki: any | null }> {
  const doc = await db.collection(WIKI_COLL).doc(userId).get()
  if (!doc.exists) return { userWiki: null, llmWiki: null }
  const data = doc.data()
  return {
    userWiki: data?.userWiki || null,
    llmWiki: data?.llmWiki || null
  }
}

export async function fbSaveUserWiki(userId: string, userWiki: any): Promise<void> {
  const ref = db.collection(WIKI_COLL).doc(userId)
  const doc = await ref.get()
  if (doc.exists) {
    await ref.update({ userWiki, updatedAt: new Date().toISOString() })
  } else {
    await ref.set({ userWiki, llmWiki: null, updatedAt: new Date().toISOString() })
  }
}

export async function fbSaveLLMWiki(userId: string, llmWiki: any): Promise<void> {
  const ref = db.collection(WIKI_COLL).doc(userId)
  const doc = await ref.get()
  if (doc.exists) {
    await ref.update({ llmWiki, updatedAt: new Date().toISOString() })
  } else {
    await ref.set({ userWiki: null, llmWiki, updatedAt: new Date().toISOString() })
  }
}

export async function fbDeleteWiki(userId: string): Promise<void> {
  await db.collection(WIKI_COLL).doc(userId).delete()
}

export async function fbCreateUser(email: string, passwordPlain: string, role: 'admin' | 'user', name: string, keyId = ''): Promise<void> {
  const salt = randomBytes(16).toString('hex')
  const passwordHash = sha256(passwordPlain + salt)
  await db.collection('users').doc(email.toLowerCase().trim()).set({
    email: email.toLowerCase().trim(),
    passwordHash,
    salt,
    role,
    name,
    keyId,
    createdAt: new Date().toISOString()
  })
}

export async function fbAuthenticateUser(email: string, passwordPlain: string): Promise<{ email: string; role: 'admin' | 'user'; name: string; keyId: string } | null> {
  const doc = await db.collection('users').doc(email.toLowerCase().trim()).get()
  const data = doc.data()
  if (!doc.exists || !data) return null
  const hash = sha256(passwordPlain + data.salt)
  if (hash === data.passwordHash) {
    return {
      email: data.email,
      role: data.role,
      name: data.name,
      keyId: data.keyId || ''
    }
  }
  return null
}
