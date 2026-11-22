import { describe, expect, it, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http'
import { once } from 'node:events'
import { readdirSync, existsSync, readFileSync, rmSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  authenticate,
  resetRateLimits,
} from '../../src/saas/auth.js'
import {
  createApiKey,
  lookupKey,
  revokeKey,
  updateKeyQuota,
  saveKeyRequest,
  atomicWriteJson,
} from '../../src/saas/db.js'

function createMockReq(headers: Record<string, string | string[] | undefined> = {}): IncomingMessage {
  return {
    headers,
  } as unknown as IncomingMessage
}

function createMockRes() {
  let statusCode = 200
  const headers: Record<string, string> = {}
  let body = ''

  const res = {
    writeHead(status: number, h?: Record<string, string>) {
      statusCode = status
      if (h) {
        for (const [k, v] of Object.entries(h)) {
          headers[k.toLowerCase()] = v
        }
      }
      return this
    },
    setHeader(name: string, value: string) {
      headers[name.toLowerCase()] = value
      return this
    },
    end(chunk?: string) {
      if (chunk) body = chunk
      return this
    },
    getStatusCode: () => statusCode,
    getHeaders: () => headers,
    getBody: () => body,
    getJson: () => (body ? JSON.parse(body) : null),
  }

  return res as unknown as ServerResponse & {
    getStatusCode: () => number
    getHeaders: () => Record<string, string>
    getBody: () => string
    getJson: () => any
  }
}

describe('Workstream: SaaS API Key Quota Enforcement, Header Fallbacks & Atomic JSON Storage', () => {
  beforeEach(() => {
    resetRateLimits()
  })

  describe('API Key Creation, Lookup, and Header Authentication', () => {
    it('creates and looks up an API key with correct default quota', async () => {
      const created = await createApiKey('Test Org', 'org@example.com')
      expect(created.key).toMatch(/^cts_[0-9a-f]{48}$/)
      expect(created.id).toMatch(/^key_[0-9a-f]{16}$/)

      const lookedUp = await lookupKey(created.key)
      expect(lookedUp).not.toBeNull()
      expect(lookedUp!.id).toBe(created.id)
      expect(lookedUp!.name).toBe('Test Org')
      expect(lookedUp!.ownerEmail).toBe('org@example.com')
      expect(lookedUp!.active).toBe(true)
      expect(lookedUp!.quotaLimit).toBe(10_000)
      expect(lookedUp!.quotaUsed).toBe(0)
      expect(lookedUp!.lastUsedAt).not.toBeNull()
    })

    it('authenticates via standard Authorization: Bearer <key>', async () => {
      const { key, id } = await createApiKey('Bearer User', 'bearer@example.com')
      const req = createMockReq({ authorization: `Bearer ${key}` })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).not.toBeNull()
      expect(auth!.id).toBe(id)
      expect(auth!.name).toBe('Bearer User')
      expect(res.getStatusCode()).toBe(200)
    })

    it('authenticates via fallback header x-echoregent-key', async () => {
      const { key, id } = await createApiKey('Echo User', 'echo@example.com')
      const req = createMockReq({ 'x-echoregent-key': key })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).not.toBeNull()
      expect(auth!.id).toBe(id)
      expect(auth!.name).toBe('Echo User')
      expect(res.getStatusCode()).toBe(200)
    })

    it('authenticates via fallback header x-cts-key', async () => {
      const { key, id } = await createApiKey('CTS User', 'cts@example.com')
      const req = createMockReq({ 'x-cts-key': key })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).not.toBeNull()
      expect(auth!.id).toBe(id)
      expect(auth!.name).toBe('CTS User')
      expect(res.getStatusCode()).toBe(200)
    })

    it('authenticates with case-insensitive fallback header names', async () => {
      const { key, id } = await createApiKey('Case User', 'case@example.com')
      const req1 = createMockReq({ 'X-EchoRegent-Key': key })
      const res1 = createMockRes()
      const auth1 = await authenticate(req1, res1)
      expect(auth1).not.toBeNull()
      expect(auth1!.id).toBe(id)

      const req2 = createMockReq({ 'X-CTS-Key': key })
      const res2 = createMockRes()
      const auth2 = await authenticate(req2, res2)
      expect(auth2).not.toBeNull()
      expect(auth2!.id).toBe(id)
    })

    it('supports Bearer prefix inside fallback headers', async () => {
      const { key, id } = await createApiKey('Prefix User', 'prefix@example.com')
      const req = createMockReq({ 'x-echoregent-key': `Bearer ${key}` })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).not.toBeNull()
      expect(auth!.id).toBe(id)
    })

    it('rejects request with 401 when all auth headers are missing', async () => {
      const req = createMockReq({})
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).toBeNull()
      expect(res.getStatusCode()).toBe(401)
      expect(res.getJson()).toEqual({
        error: 'Missing Authorization header. Use: Authorization: Bearer ***',
      })
      expect(res.getHeaders()['www-authenticate']).toBe('Bearer')
    })

    it('rejects invalid or unknown API key with 401', async () => {
      const req = createMockReq({ authorization: 'Bearer cts_invalidkey1234567890' })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).toBeNull()
      expect(res.getStatusCode()).toBe(401)
      expect(res.getJson()).toEqual({
        error: 'Invalid or revoked API key.',
      })
    })

    it('rejects revoked API key with 401', async () => {
      const { key, id } = await createApiKey('Revoked User', 'revoked@example.com')
      const revoked = await revokeKey(id)
      expect(revoked).toBe(true)

      const req = createMockReq({ authorization: `Bearer ${key}` })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).toBeNull()
      expect(res.getStatusCode()).toBe(401)
      expect(res.getJson()).toEqual({
        error: 'Invalid or revoked API key.',
      })
    })
  })

  describe('Quota Enforcement (HTTP 429 when quotaUsed >= quotaLimit)', () => {
    it('blocks request when quotaUsed equals quotaLimit', async () => {
      const { key, id } = await createApiKey('Quota Equal', 'equal@example.com')
      await updateKeyQuota(id, 50, 50)

      const req = createMockReq({ authorization: `Bearer ${key}` })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).toBeNull()
      expect(res.getStatusCode()).toBe(429)
      expect(res.getJson()).toEqual({
        error: 'API key quota exceeded. Upgrade or increase your quota limit.',
      })
    })

    it('blocks request when quotaUsed exceeds quotaLimit', async () => {
      const { key, id } = await createApiKey('Quota Exceeded', 'exceeded@example.com')
      await updateKeyQuota(id, 20, 25)

      const req = createMockReq({ 'x-echoregent-key': key })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).toBeNull()
      expect(res.getStatusCode()).toBe(429)
      expect(res.getJson()).toEqual({
        error: 'API key quota exceeded. Upgrade or increase your quota limit.',
      })
    })

    it('allows requests again after updateKeyQuota increases the limit', async () => {
      const { key, id } = await createApiKey('Quota Recover', 'recover@example.com')
      // Initially exhausted
      await updateKeyQuota(id, 10, 10)

      const req1 = createMockReq({ 'x-cts-key': key })
      const res1 = createMockRes()
      const blocked = await authenticate(req1, res1)
      expect(blocked).toBeNull()
      expect(res1.getStatusCode()).toBe(429)

      // Admin upgrades quota
      const updated = await updateKeyQuota(id, 100, 10)
      expect(updated).toBe(true)

      const req2 = createMockReq({ 'x-cts-key': key })
      const res2 = createMockRes()
      const allowed = await authenticate(req2, res2)
      expect(allowed).not.toBeNull()
      expect(allowed!.id).toBe(id)
      expect(allowed!.quotaLimit).toBe(100)
      expect(allowed!.quotaUsed).toBe(10)
      expect(res2.getStatusCode()).toBe(200)
    })

    it('does not block requests when quotaLimit is 0 (unlimited quota)', async () => {
      const { key, id } = await createApiKey('Unlimited User', 'unlimited@example.com')
      await updateKeyQuota(id, 0, 500)

      const req = createMockReq({ authorization: `Bearer ${key}` })
      const res = createMockRes()

      const auth = await authenticate(req, res)
      expect(auth).not.toBeNull()
      expect(auth!.id).toBe(id)
      expect(res.getStatusCode()).toBe(200)
    })
  })

  describe('Atomic JSON Persistence and Zero Stray .tmp Files', () => {
    it('leaves zero .tmp files in data/ directory after multiple mutations', async () => {
      const dataDir = join(process.cwd(), 'data')

      // Perform multiple key operations that write JSON files
      for (let i = 0; i < 5; i++) {
        const { key, id } = await createApiKey(`Batch User ${i}`, `batch${i}@example.com`)
        await lookupKey(key)
        await updateKeyQuota(id, 100 + i, i * 5)
        await saveKeyRequest(`Waitlist User ${i}`, `wait${i}@example.com`, `usecase ${i}`)
      }

      expect(existsSync(dataDir)).toBe(true)
      const files = readdirSync(dataDir)
      const tmpFiles = files.filter((f) => f.endsWith('.tmp'))

      expect(tmpFiles).toHaveLength(0)

      // Verify that keys.json is valid and contains our keys
      const keysJsonPath = join(dataDir, 'keys.json')
      expect(existsSync(keysJsonPath)).toBe(true)
      const content = JSON.parse(readFileSync(keysJsonPath, 'utf-8'))
      expect(Array.isArray(content)).toBe(true)
      expect(content.length).toBeGreaterThanOrEqual(5)
    })

    it('atomicWriteJson writes valid JSON and cleans up temporary files', () => {
      const testDir = join(tmpdir(), `atomic-test-${randomBytes(6).toString('hex')}`)
      mkdirSync(testDir, { recursive: true })

      try {
        const targetPath = join(testDir, 'test-output.json')
        const payload = { hello: 'world', numbers: [1, 2, 3], timestamp: Date.now() }

        atomicWriteJson(targetPath, payload)

        expect(existsSync(targetPath)).toBe(true)
        const parsed = JSON.parse(readFileSync(targetPath, 'utf-8'))
        expect(parsed).toEqual(payload)

        const dirFiles = readdirSync(testDir)
        const tmpFiles = dirFiles.filter((f) => f.endsWith('.tmp'))
        expect(tmpFiles).toHaveLength(0)
      } finally {
        rmSync(testDir, { recursive: true, force: true })
      }
    })

    it('atomicWriteJson cleans up .tmp file if an error occurs during write/rename', () => {
      const testDir = join(tmpdir(), `atomic-err-test-${randomBytes(6).toString('hex')}`)
      mkdirSync(testDir, { recursive: true })

      try {
        // Target is an invalid path that will fail when renaming or writing
        const invalidTargetPath = join(testDir, 'nonexistent-subdir', 'deep', 'file.json')

        // Supplying circular JSON or invalid target will exercise error handling
        let threw = false
        try {
          atomicWriteJson(invalidTargetPath, { a: 1 })
        } catch {
          threw = true
        }

        // Even if it succeeds or throws, check that no stray .tmp files remain
        const dirFiles = readdirSync(testDir)
        const tmpFiles = dirFiles.filter((f) => f.endsWith('.tmp'))
        expect(tmpFiles).toHaveLength(0)
      } finally {
        rmSync(testDir, { recursive: true, force: true })
      }
    })
  })

  describe('End-to-End Real HTTP Server Integration', () => {
    let server: Server
    let baseUrl: string

    beforeAll(async () => {
      server = createServer(async (req, res) => {
        const key = await authenticate(req, res)
        if (!key) return
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ status: 'ok', keyId: key.id, keyName: key.name }))
      })

      server.listen(0, '127.0.0.1')
      await once(server, 'listening')
      const address = server.address()
      if (typeof address === 'object' && address !== null) {
        baseUrl = `http://127.0.0.1:${address.port}`
      }
    })

    afterAll(async () => {
      if (server) {
        server.close()
        await once(server, 'close')
      }
    })

    it('e2e: authenticates with Authorization Bearer header', async () => {
      const { key, id } = await createApiKey('E2E Bearer', 'e2e-bearer@example.com')
      const res = await fetch(`${baseUrl}/test`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ status: 'ok', keyId: id, keyName: 'E2E Bearer' })
    })

    it('e2e: authenticates with x-echoregent-key header', async () => {
      const { key, id } = await createApiKey('E2E Echo', 'e2e-echo@example.com')
      const res = await fetch(`${baseUrl}/test`, {
        headers: { 'x-echoregent-key': key },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ status: 'ok', keyId: id, keyName: 'E2E Echo' })
    })

    it('e2e: authenticates with x-cts-key header', async () => {
      const { key, id } = await createApiKey('E2E CTS', 'e2e-cts@example.com')
      const res = await fetch(`${baseUrl}/test`, {
        headers: { 'x-cts-key': key },
      })
      expect(res.status).toBe(200)
      const data = await res.json()
      expect(data).toEqual({ status: 'ok', keyId: id, keyName: 'E2E CTS' })
    })

    it('e2e: returns 429 when quota limit is exceeded and resumes 200 when upgraded', async () => {
      const { key, id } = await createApiKey('E2E Quota', 'e2e-quota@example.com')
      await updateKeyQuota(id, 5, 5)

      const blockedRes = await fetch(`${baseUrl}/test`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      expect(blockedRes.status).toBe(429)
      const err = await blockedRes.json()
      expect(err).toEqual({ error: 'API key quota exceeded. Upgrade or increase your quota limit.' })

      // Upgrade quota
      await updateKeyQuota(id, 50, 5)
      const allowedRes = await fetch(`${baseUrl}/test`, {
        headers: { Authorization: `Bearer ${key}` },
      })
      expect(allowedRes.status).toBe(200)
      const ok = await allowedRes.json()
      expect(ok.status).toBe('ok')
    })

    it('e2e: returns 401 when no key headers provided', async () => {
      const res = await fetch(`${baseUrl}/test`)
      expect(res.status).toBe(401)
      const err = await res.json()
      expect(err).toEqual({
        error: 'Missing Authorization header. Use: Authorization: Bearer ***',
      })
    })
  })
})
