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

describe('Issue #5 — tool_calls/tool_call_id are dropped; null/array content is not handled', () => {
  it('FAILS: drops tool_calls and tool_call_id when forwarding an assistant tool-call turn to the upstream LLM', async () => {
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

    // Whatever status comes back, check whether the forwarded body preserved the
    // tool-calling structure a real OpenAI tools conversation depends on.
    const forwarded = mockReceivedRequests[0]?.body as { messages?: Array<Record<string, unknown>> } | undefined
    const forwardedHasToolCalls = forwarded?.messages?.some((m) => 'tool_calls' in m) ?? false
    const forwardedHasToolRole  = forwarded?.messages?.some((m) => m.role === 'tool') ?? false

    expect(res.status).toBe(200)
    expect(forwardedHasToolCalls).toBe(true)
    expect(forwardedHasToolRole).toBe(true)
  })

  it('FAILS: a null assistant content field (standard for OpenAI tool-call turns) should not crash the request', async () => {
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

    // A production-ready proxy should return 200 (or a clean 4xx), never a 500 from
    // an uncaught exception while estimating tokens / scoring message relevance.
    expect(res.status).toBe(200)
  })

  it('FAILS: multimodal array content (image_url parts) should not crash the request', async () => {
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

    expect(res.status).toBe(200)
  })
})

describe('Issue #7 — /api/chat and /api/wiki memory is keyed by API key only', () => {
  it('FAILS: two different end users of the same customer key share one merged memory, with no end-user identifier anywhere in the request', async () => {
    // End "user A" ingests a session under this API key.
    await fetch(`${CTS_BASE}/api/wiki/ingest-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctsApiKey}` },
      body: JSON.stringify({
        session: [
          { role: 'user', content: 'I study at Stanford and I am building a fintech app.' },
          { role: 'assistant', content: 'Nice, what payment processor are you using?' },
        ],
        frame: { intent: 'information_seeking', state: 'opening', domain: 'general', signals: { keywords: [], structures: [], urgency: 'low' }, confidence: { intent: 0.7, state: 0.9, domain: 0.6, risk: 1 } },
      }),
    })

    // End "user B" — a completely different person — ingests a session under the
    // SAME API key (this is exactly what happens today: the API key belongs to the
    // customer's backend, not to any individual end user, and the endpoint accepts
    // no end-user id parameter at all).
    await fetch(`${CTS_BASE}/api/wiki/ingest-chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ctsApiKey}` },
      body: JSON.stringify({
        session: [
          { role: 'user', content: 'I study at MIT and I am building a healthcare app.' },
          { role: 'assistant', content: 'Interesting, what is the compliance requirement?' },
        ],
        frame: { intent: 'information_seeking', state: 'opening', domain: 'general', signals: { keywords: [], structures: [], urgency: 'low' }, confidence: { intent: 0.7, state: 0.9, domain: 0.6, risk: 1 } },
      }),
    })

    const wikiRes = await fetch(`${CTS_BASE}/api/wiki`, { headers: { Authorization: `Bearer ${ctsApiKey}` } })
    const wiki = await wikiRes.json() as { userWiki: { profile: string[] } }

    const mentionsStanford = wiki.userWiki.profile.some((p) => p.includes('Stanford'))
    const mentionsMIT      = wiki.userWiki.profile.some((p) => p.includes('MIT'))

    // Expected if end users were isolated: fetching "the wiki" for this key should
    // not silently contain both unrelated people's profile facts merged together.
    // (There is no per-end-user id in the request at all, so there is no way to
    // even ask for just one of them.)
    expect(mentionsStanford && mentionsMIT).toBe(false)
  })
})
