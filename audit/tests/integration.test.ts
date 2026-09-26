// AUDIT — live integration tests against the actual running server (src/server.ts),
// spawned as a child process. No external API keys or network egress to real LLM
// providers are used: the "LLM" the proxy talks to is a local mock HTTP server we
// control, and the CTS admin/API keys are self-issued against our own throwaway
// server instance. This exercises real, running code — not a simulation.
//
// Covers:
//   Issue #10 (a) — x-llm-base-url accepts an arbitrary URL with no allowlist.
//   Issue #5      — tool_calls/tool_call_id are dropped; null/array content crash or corrupt.
//   Issue #7      — /api/chat and /api/wiki memory is keyed only by API key (key.id),
//                   so two different end users of the same customer share one memory.

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const REPO_ROOT = join(__dirname, '../..')
const CTS_PORT = 8901
const MOCK_PORT = 8902
const ADMIN_SECRET = 'audit-test-admin-secret'
const CTS_BASE = `http://127.0.0.1:${CTS_PORT}`

let ctsProcess: ChildProcess
let mockUpstream: Server
let mockReceivedRequests: Array<{ url: string; headers: Record<string, string | string[] | undefined>; body: unknown }> = []
let ctsApiKey = ''
let tempCwd: string

function waitForHttp(url: string, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url)
        if (res.ok || res.status < 500) { resolve(); return }
      } catch { /* not up yet */ }
      if (Date.now() > deadline) { reject(new Error(`Timed out waiting for ${url}`)); return }
      setTimeout(attempt, 250)
    }
    attempt()
  })
}

beforeAll(async () => {
  tempCwd = mkdtempSync(join(tmpdir(), 'cts-audit-'))

  // Local mock "OpenAI-compatible" upstream — records every request it receives.
  mockUpstream = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => (body += chunk))
    req.on('end', () => {
      let parsed: unknown = null
      try { parsed = JSON.parse(body || '{}') } catch { parsed = body }
      mockReceivedRequests.push({ url: req.url ?? '', headers: req.headers, body: parsed })
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'mock reply' } }] }))
    })
  })
  await new Promise<void>((resolve) => mockUpstream.listen(MOCK_PORT, '127.0.0.1', resolve))

  // Spawn the real CTS server against a throwaway cwd (so data/*.json lands in a temp dir).
  const tsxBin = join(REPO_ROOT, 'node_modules', '.bin', 'tsx')
  ctsProcess = spawn(tsxBin, [join(REPO_ROOT, 'src/server.ts')], {
    cwd: tempCwd,
    env: {
      ...process.env,
      PORT: String(CTS_PORT),
      CTS_ADMIN_SECRET: ADMIN_SECRET,
      NODE_ENV: 'test',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  ctsProcess.stderr?.on('data', (d) => process.stderr.write(`[cts-server] ${d}`))

  await waitForHttp(`${CTS_BASE}/health`)

  // Self-issue a CTS API key against our own throwaway instance (no external creds).
  const keyRes = await fetch(`${CTS_BASE}/admin/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ name: 'audit', ownerEmail: 'audit@example.com' }),
  })
  const keyData = await keyRes.json() as { key: string }
  ctsApiKey = keyData.key
}, 30_000)

afterAll(async () => {
  ctsProcess?.kill()
  await new Promise<void>((resolve) => mockUpstream.close(() => resolve()))
  try { rmSync(tempCwd, { recursive: true, force: true }) } catch { /* best effort */ }
})

describe('Issue #10(a) — x-llm-base-url accepts an arbitrary URL with no allowlist', () => {
  it('forwards the compressed conversation and the "LLM key" to whatever host the caller names via x-llm-base-url', async () => {
    mockReceivedRequests = []
    const res = await fetch(`${CTS_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctsApiKey}`,
        'x-llm-key': 'sk-should-not-leave-this-test',
        'x-llm-base-url': `http://127.0.0.1:${MOCK_PORT}`, // NOT api.openai.com
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'Hello, does this get forwarded anywhere the caller names?' }],
      }),
    })

    expect(res.status).toBe(200)
    expect(mockReceivedRequests.length).toBe(1)
    // The real bug: nothing validated that x-llm-base-url was api.openai.com (or any
    // known provider) before sending the user's conversation + "LLM key" there.
    expect(mockReceivedRequests[0].headers.authorization).toBe('Bearer sk-should-not-leave-this-test')
  })
})

// FIXED (AUDIT.md Part 9 — narrowed week-1 scope): the proxy no longer
// crashes on tool_calls / null / array content. It was not given full
// tool-calling/multimodal support (that's real work, deferred per the GTM
// addendum) — instead it now detects that shape up front and rejects it
// with a clean 400 and a clear message, via findUnsupportedMessageShape()
// in server.ts. These tests were rewritten from "does this crash" to "does
// this fail loudly and cleanly" once the fix landed.
describe('Issue #5 (fixed, narrow scope) — unsupported message shapes are rejected cleanly, not crashed on', () => {
  it('rejects a tool-call turn with a clean 400, not a 500 or silent corruption', async () => {
    mockReceivedRequests = []
    const messages = [
      { role: 'user', content: 'What is the weather in Paris?' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Paris"}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: '{"tempC":18}' },
      { role: 'user', content: 'And tomorrow?' },
    ]

    const res = await fetch(`${CTS_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctsApiKey}`,
        'x-llm-key': 'sk-test',
        'x-llm-base-url': `http://127.0.0.1:${MOCK_PORT}`,
      },
      body: JSON.stringify({ model: 'gpt-4o', messages }),
    })
    const payload = await res.json() as { error?: string; unsupported?: boolean }

    expect(res.status).toBe(400)
    expect(payload.unsupported).toBe(true)
    expect(payload.error).toMatch(/tool/i)
    // Nothing should have reached the upstream LLM with a mangled body.
    expect(mockReceivedRequests.length).toBe(0)
  })

  it('rejects null assistant content (standard for OpenAI tool-call turns) with a clean 400, not a 500', async () => {
    const messages = [
      { role: 'user', content: 'Turn on the lights' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'lights_on', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'call_1', content: 'ok' },
      { role: 'user', content: 'Thanks, now dim them' },
      { role: 'assistant', content: 'Sure, to what percent?' },
    ]

    const res = await fetch(`${CTS_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctsApiKey}`,
        'x-llm-key': 'sk-test',
        'x-llm-base-url': `http://127.0.0.1:${MOCK_PORT}`,
      },
      body: JSON.stringify({ model: 'gpt-4o', messages }),
    })

    expect(res.status).toBe(400)
    expect(res.status).not.toBe(500)
  })

  it('rejects multimodal array content (image_url parts) with a clean 400, not a 500', async () => {
    const messages = [
      { role: 'user', content: 'Describe this image' },
      { role: 'assistant', content: 'It looks like a screenshot of an error dialog.' },
      { role: 'user', content: 'And this one?' },
      { role: 'assistant', content: 'That one shows a stack trace.' },
      {
        role: 'user',
        content: [
          { type: 'text', text: 'One more, what is wrong here?' },
          { type: 'image_url', image_url: { url: 'https://example.com/screenshot.png' } },
        ],
      },
    ]

    const res = await fetch(`${CTS_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctsApiKey}`,
        'x-llm-key': 'sk-test',
        'x-llm-base-url': `http://127.0.0.1:${MOCK_PORT}`,
      },
      body: JSON.stringify({ model: 'gpt-4o', messages }),
    })

    expect(res.status).toBe(400)
    expect(res.status).not.toBe(500)
  })

  it('still handles a plain text-only conversation normally (the fix did not overreach)', async () => {
    mockReceivedRequests = []
    const messages = [
      { role: 'user', content: 'Hi' },
      { role: 'assistant', content: 'Hello, how can I help?' },
      { role: 'user', content: 'Just checking this endpoint still works for plain text.' },
    ]

    const res = await fetch(`${CTS_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctsApiKey}`,
        'x-llm-key': 'sk-test',
        'x-llm-base-url': `http://127.0.0.1:${MOCK_PORT}`,
      },
      body: JSON.stringify({ model: 'gpt-4o', messages }),
    })

    expect(res.status).toBe(200)
    expect(mockReceivedRequests.length).toBe(1)
  })
})

// FIXED (AUDIT.md Part 9): /api/chat and /api/wiki* now accept an optional
// `x-end-user-id` header and scope the wiki store by (API key, end-user id)
// instead of API key alone (server.ts: `userId = endUserId ? \`${key.id}:${endUserId}\` : key.id`).
// Backward compatible on purpose: a caller that never sends the header keeps
// getting the old key-only behavior — that's now an explicit, documented
// choice a customer can opt out of, not an unfixable cross-user leak.
describe('Issue #7 (fixed) — wiki memory can now be scoped per end user, not just per API key', () => {
  it('FIXED: two end users with different x-end-user-id values get isolated memory under the same API key', async () => {
    await fetch(`${CTS_BASE}/api/wiki/ingest-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctsApiKey}`, 'x-end-user-id': 'user-a' },
      body: JSON.stringify({
        session: [
          { role: 'user', content: 'I study at Stanford and I am building a fintech app.' },
          { role: 'assistant', content: 'Nice, what payment processor are you using?' },
        ],
        frame: { intent: 'information_seeking', state: 'opening', domain: 'general', signals: { keywords: [], structures: [], urgency: 'low' }, confidence: { intent: 0.7, state: 0.9, domain: 0.6, risk: 1 } },
      }),
    })

    await fetch(`${CTS_BASE}/api/wiki/ingest-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctsApiKey}`, 'x-end-user-id': 'user-b' },
      body: JSON.stringify({
        session: [
          { role: 'user', content: 'I study at MIT and I am building a healthcare app.' },
          { role: 'assistant', content: 'Interesting, what is the compliance requirement?' },
        ],
        frame: { intent: 'information_seeking', state: 'opening', domain: 'general', signals: { keywords: [], structures: [], urgency: 'low' }, confidence: { intent: 0.7, state: 0.9, domain: 0.6, risk: 1 } },
      }),
    })

    const wikiARes = await fetch(`${CTS_BASE}/api/wiki`, { headers: { Authorization: `Bearer ${ctsApiKey}`, 'x-end-user-id': 'user-a' } })
    const wikiBRes = await fetch(`${CTS_BASE}/api/wiki`, { headers: { Authorization: `Bearer ${ctsApiKey}`, 'x-end-user-id': 'user-b' } })
    const wikiA = await wikiARes.json() as { userWiki: { profile: string[] } }
    const wikiB = await wikiBRes.json() as { userWiki: { profile: string[] } }

    expect(wikiA.userWiki.profile.some((p) => p.includes('Stanford'))).toBe(true)
    expect(wikiA.userWiki.profile.some((p) => p.includes('MIT'))).toBe(false)
    expect(wikiB.userWiki.profile.some((p) => p.includes('MIT'))).toBe(true)
    expect(wikiB.userWiki.profile.some((p) => p.includes('Stanford'))).toBe(false)
  })

  it('documents the intentional backward-compatible default: no x-end-user-id still pools memory under the bare API key', async () => {
    await fetch(`${CTS_BASE}/api/wiki/ingest-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctsApiKey}` },
      body: JSON.stringify({
        session: [{ role: 'user', content: 'I study at Cornell and I am building a logistics app.' }],
        frame: { intent: 'information_seeking', state: 'opening', domain: 'general', signals: { keywords: [], structures: [], urgency: 'low' }, confidence: { intent: 0.7, state: 0.9, domain: 0.6, risk: 1 } },
      }),
    })
    const wikiRes = await fetch(`${CTS_BASE}/api/wiki`, { headers: { Authorization: `Bearer ${ctsApiKey}` } })
    const wiki = await wikiRes.json() as { userWiki: { profile: string[] } }
    expect(wiki.userWiki.profile.some((p) => p.includes('Cornell'))).toBe(true)
  })
})
