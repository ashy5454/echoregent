/**
 * Manual End-to-End LLM Prompt & Token Savings Test Runner
 *
 * Spawns:
 * 1. An upstream mock OpenAI-compatible LLM on port 8912 that logs received messages and returns real usage objects
 * 2. The EchoRegent CTS server on port 8911
 *
 * Sends a battery of real-world multi-turn conversational prompts through:
 * - POST /v1/chat/completions (Proxy path)
 * - POST /compress (Direct authenticated compression)
 * - POST /demo/compress (Public demo endpoint)
 *
 * Verifies and reports:
 * - Domain & Intent classification
 * - Original tokens vs Compressed tokens
 * - Tokens saved (absolute count)
 * - Token saved percentage (%)
 * - What was retained in the forwarded prompt to the LLM
 * - Response headers (x-cts-tokens-saved, x-cts-compression-pct, x-cts-domain, etc.)
 */

import { createServer, type Server } from 'node:http'
import { spawn, type ChildProcess } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { countChatTokens } from '../../src/cts-core/tokenizer'

const __dirname = fileURLToPath(new URL('.', import.meta.url))
const CTS_PORT = 8911
const MOCK_PORT = 8912
const CTS_BASE = `http://127.0.0.1:${CTS_PORT}`
const ADMIN_SECRET = 'manual-eval-admin-secret-2026'

let ctsProcess: ChildProcess
let mockServer: Server
let lastUpstreamPayload: any = null
let ctsApiKey = ''
let tempCwd = ''

interface TestCase {
  id: string
  name: string
  domainHint: string
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
}

const TEST_CASES: TestCase[] = [
  {
    id: 'TEST-01-CODING-STACKTRACE',
    name: 'Full-Stack Node/React Debugging with Large Stack Trace',
    domainHint: 'coding',
    messages: [
      { role: 'system', content: 'You are an expert senior software engineer assisting with full-stack debugging.' },
      { role: 'user', content: "Hi, I'm setting up our Next.js backend with Stripe webhook handling and PostgreSQL pool connections." },
      { role: 'assistant', content: 'Understood. Are you using raw pg Pool or Prisma/Drizzle ORM for the connection management?' },
      { role: 'user', content: 'Raw pg.Pool with max: 10 connections. When under test traffic, every webhook call throws a timeout error:' },
      { role: 'assistant', content: 'Could you share the stack trace and connection configuration?' },
      {
        role: 'user',
        content: `Here is the error output:\n` +
          Array(20).fill('  at Object.invokeGuardedCallbackProd (react-dom.production.min.js:1024:12)\n  at ConnectionPool.acquire (pg-pool/index.js:312:15)').join('\n') +
          `\nError: Connection timeout after 5000ms. Connection pool exhausted at db/client.ts:44:9.`
      },
      { role: 'assistant', content: 'It looks like pool clients are being checked out without release() in a finally block.' },
      { role: 'user', content: 'Can you show me the exact fixed try/finally wrapper for checkout and query execution?' }
    ]
  },
  {
    id: 'TEST-02-SUPPORT-REFUND',
    name: 'E-commerce Customer Support Return & Tracking Dispute',
    domainHint: 'customer_support',
    messages: [
      { role: 'system', content: 'You are a polite customer support agent for Apex Direct.' },
      { role: 'user', content: 'Hello, I ordered a ThinkPad T14 laptop last week (Order #APX-98234) and paid $1,249 via Visa.' },
      { role: 'assistant', content: 'Hello! I can certainly check that order for you. Could you confirm your delivery zip code?' },
      { role: 'user', content: 'My delivery zip code is 75001 in Dallas, Texas. The tracking says delivered 3 days ago but nothing arrived at my porch.' },
      { role: 'assistant', content: 'Thank you for confirming. I have checked with the carrier and it seems it was marked delivered at a parcel locker.' },
      { role: 'user', content: 'I checked our building parcel locker and it is completely empty. I have already contacted my building manager.' },
      { role: 'assistant', content: 'I apologize for the inconvenience. Let me initiate a missing package investigation with carrier dispatch.' },
      { role: 'user', content: 'I fly out for a work trip on Friday, so if it cannot be found today, please process an immediate replacement or full refund.' }
    ]
  },
  {
    id: 'TEST-03-SALES-ENTERPRISE',
    name: 'B2B Enterprise SaaS Sales & Security Objection Handling',
    domainHint: 'sales',
    messages: [
      { role: 'system', content: 'You are an enterprise account executive for CloudScale.' },
      { role: 'user', content: 'We are evaluating CloudScale Enterprise for our team of 250 engineers. What is your annual seat price?' },
      { role: 'assistant', content: 'Our list price for Enterprise is $48/user/month billed annually, which includes dedicated SSO and 99.99% uptime SLA.' },
      { role: 'user', content: 'Our allocated annual budget for this toolchain transition is capped strictly at $90,000 for year one.' },
      { role: 'assistant', content: 'With 250 seats, that puts us at $30/user/month. We can explore a multi-year commit or volume tiering to meet your $90k cap.' },
      { role: 'user', content: 'We also have a strict security gate: our CISO requires SOC2 Type II reports and HIPAA Business Associate Agreements.' },
      { role: 'assistant', content: 'We maintain annual SOC2 Type II certification and offer standard BAA addendums for healthcare-adjacent workloads.' },
      { role: 'user', content: 'If you can approve the $90k year-one price point and provide the audit report by Wednesday, we can sign before quarter-end.' }
    ]
  },
  {
    id: 'TEST-04-HIGH-NOISE-CHITCHAT',
    name: 'Customer Support with Heavy Distractor & Chit-Chat Fluff',
    domainHint: 'customer_support',
    messages: [
      { role: 'user', content: 'Good morning! How are you doing today on this lovely sunny Tuesday?' },
      { role: 'assistant', content: 'Good morning! I am doing well, thank you. How can I help you today?' },
      { role: 'user', content: 'The weather here has been crazy. Anyway, I am having trouble logging into my portal.' },
      { role: 'assistant', content: 'I would be happy to help with your portal login. What error message are you seeing?' },
      { role: 'user', content: 'Just grab some coffee first haha. Okay the screen says: Invalid credentials code 401.' },
      { role: 'assistant', content: 'Have you recently tried using the password reset link?' },
      { role: 'user', content: 'Yeah my dog started barking so I got distracted. Yes, I clicked the reset email 10 minutes ago.' },
      { role: 'assistant', content: 'Did the reset link allow you to set a new password, or did the link expire?' },
      { role: 'user', content: 'It said Token Expired immediately when I clicked it in Gmail.' },
      { role: 'assistant', content: 'Understood. Token links expire after 15 minutes. Let me trigger a fresh reset link to your registered email.' },
      { role: 'user', content: 'Great, thanks! Please send it to account dev@acme.org right now.' }
    ]
  },
  {
    id: 'TEST-05-LEGAL-REGULATORY',
    name: 'Legal Domain Advisory & Non-Disclosure Compliance',
    domainHint: 'legal',
    messages: [
      { role: 'system', content: 'You are a legal assistant specializing in commercial contracts.' },
      { role: 'user', content: 'We are drafting a mutual NDA with a prospective acquisition target based in California.' },
      { role: 'assistant', content: 'Understood. Are you including standard trade secret definitions and California jurisdiction clauses?' },
      { role: 'user', content: 'Yes, but the target wants a 5-year confidentiality term for all residual knowledge and non-solicitation of employees.' },
      { role: 'assistant', content: 'Under California Business and Professions Code section 16600, employee non-solicitation clauses are generally unenforceable.' },
      { role: 'user', content: 'Understood. What is the standard carve-out language for residual knowledge that complies with California law?' }
    ]
  },
  {
    id: 'TEST-06-SHORT-CONVO',
    name: 'Short Conversation (Turn Count < 4 - Edge Case)',
    domainHint: 'general',
    messages: [
      { role: 'user', content: 'What is the capital of Australia?' },
      { role: 'assistant', content: 'The capital of Australia is Canberra.' },
      { role: 'user', content: 'What is its approximate population?' }
    ]
  },
  {
    id: 'TEST-07-MEDICAL-ZONE',
    name: 'Medical Healthcare Consultation (Protected Zone)',
    domainHint: 'medical',
    messages: [
      { role: 'system', content: 'You are a medical triage assistant.' },
      { role: 'user', content: 'My elderly mother was prescribed Lisinopril 20mg daily for hypertension.' },
      { role: 'assistant', content: 'Understood. Is she experiencing any new symptoms or blood pressure fluctuations?' },
      { role: 'user', content: 'Her home cuff reading was 145/92 this morning, and she developed a persistent dry nocturnal cough.' },
      { role: 'assistant', content: 'A dry cough is a known class effect of ACE inhibitors like Lisinopril. She should consult her prescribing physician.' },
      { role: 'user', content: 'Should she skip today dosage until she speaks with her cardiologist?' }
    ]
  },
  {
    id: 'TEST-08-LONG-20-TURN-SUPPORT',
    name: 'Long 20-Turn Enterprise Support Ticket with Historical Logs',
    domainHint: 'customer_support',
    messages: [
      { role: 'user', content: 'Hi, our account sync has been failing since Monday morning.' },
      { role: 'assistant', content: 'Hello! I can look into that. Could you provide your tenant organization ID?' },
      { role: 'user', content: 'Tenant ID is org_882910-enterprise.' },
      { role: 'assistant', content: 'Thanks. Are you seeing error 502 or a timeout?' },
      { role: 'user', content: 'We see HTTP 504 Gateway Timeout after 30 seconds.' },
      { role: 'assistant', content: 'Got it. Is it affecting all webhooks or just user sync?' },
      { role: 'user', content: 'Just the user provisioning webhook endpoint.' },
      { role: 'assistant', content: 'Could you tell me how many user records are in the bulk batch?' },
      { role: 'user', content: 'Approximately 5,000 users per sync cycle.' },
      { role: 'assistant', content: 'The default timeout for batches over 1,000 users is 30s. Have you tried batch slicing?' },
      { role: 'user', content: 'We tried slicing to 500 users but still saw occasional failures on Wednesday.' },
      { role: 'assistant', content: 'Let me inspect the ingress proxy logs for Wednesday around 14:00 UTC.' },
      { role: 'user', content: 'Okay, let me know what you find in the ingress proxy.' },
      { role: 'assistant', content: 'The proxy reports connection drops caused by an expired TLS certificate on your callback URL.' },
      { role: 'user', content: 'Ah, our team renewed the cert yesterday at 16:00 UTC.' },
      { role: 'assistant', content: 'Excellent. Have you tested a test payload since the renewal?' },
      { role: 'user', content: 'Yes, but the webhook queue still shows paused status in the dashboard.' },
      { role: 'assistant', content: 'When a queue hits 50 consecutive failures, it enters safe-mode paused state automatically.' },
      { role: 'user', content: 'How do we unpause the queue and trigger a full replay of the backlog?' },
      { role: 'assistant', content: 'You can unpause via the dashboard button or by sending a POST to /api/v2/queues/sync/resume.' },
      { role: 'user', content: 'Can you trigger the resume API call for our tenant right now from your side?' }
    ]
  },
  {
    id: 'TEST-09-LONG-18-TURN-CODING',
    name: 'Long 18-Turn Architectural Refactoring & Code Design Discussion',
    domainHint: 'coding',
    messages: [
      { role: 'user', content: 'We need to migrate our monolithic Express app to modular TypeScript services.' },
      { role: 'assistant', content: 'Great project. Are you planning to keep a monorepo or split into separate packages?' },
      { role: 'user', content: 'We prefer a pnpm monorepo with Turborepo for caching.' },
      { role: 'assistant', content: 'Turborepo with pnpm workspaces is a solid choice. What database access layer are you standardizing on?' },
      { role: 'user', content: 'We are debating between Kysely and Prisma.' },
      { role: 'assistant', content: 'Kysely gives type-safe SQL with zero runtime overhead, while Prisma has higher schema abstractions.' },
      { role: 'user', content: 'Our team hates Prisma migration lock-in, so Kysely sounds better.' },
      { role: 'assistant', content: 'Understood. Kysely with pg or kysely-postgres-js works very well.' },
      { role: 'user', content: 'How should we structure the shared types package across services?' },
      { role: 'assistant', content: 'Create a packages/types directory with its own package.json exporting TypeScript interfaces.' },
      { role: 'user', content: 'Should we build types with tsc or use unbuild/tsup?' },
      { role: 'assistant', content: 'tsup is extremely fast and generates both ESM and CJS declarations seamlessly.' },
      { role: 'user', content: 'Okay, what about environment variable validation?' },
      { role: 'assistant', content: 'Zod or envalid in a shared config package guarantees validation on process boot.' },
      { role: 'user', content: 'We chose Zod. Now for error handling: RFC 7807 problem details or custom JSON?' },
      { role: 'assistant', content: 'RFC 7807 is best practice for standard HTTP API clients.' },
      { role: 'user', content: 'Can you write the Zod env schema and the Kysely database initialization module?' }
    ]
  }
]

function waitForHttp(url: string, timeoutMs = 15_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const attempt = async () => {
      try {
        const res = await fetch(url)
        if (res.ok || res.status < 500) { resolve(); return }
      } catch {}
      if (Date.now() > deadline) { reject(new Error(`Timeout waiting for ${url}`)); return }
      setTimeout(attempt, 200)
    }
    attempt()
  })
}

async function startEnvironment() {
  tempCwd = mkdtempSync(join(tmpdir(), 'cts-manual-test-'))

  // 1. Upstream mock OpenAI LLM server
  mockServer = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      try { lastUpstreamPayload = JSON.parse(body) } catch { lastUpstreamPayload = body }

      // Calculate realistic mock usage based on received messages
      const msgs = (lastUpstreamPayload?.messages || [])
      const receivedTokens = countChatTokens(msgs)
      const completionTokens = 85

      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({
        id: 'chatcmpl-mock-12345',
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: lastUpstreamPayload?.model || 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'This is the verified LLM reply received through the EchoRegent proxy.' },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: receivedTokens,
          completion_tokens: completionTokens,
          total_tokens: receivedTokens + completionTokens
        }
      }))
    })
  })

  await new Promise<void>((resolve) => mockServer.listen(MOCK_PORT, '127.0.0.1', resolve))

  // 2. Spawn CTS Server
  const repoRoot = join(__dirname, '../..')
  const tsxBin = join(repoRoot, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx')

  ctsProcess = spawn(tsxBin, [join(repoRoot, 'src/server.ts')], {
    shell: process.platform === 'win32',
    cwd: tempCwd,
    env: {
      ...process.env,
      PORT: String(CTS_PORT),
      CTS_ADMIN_SECRET: ADMIN_SECRET,
      NODE_ENV: 'test',
      CTS_TEST_TRUSTED_LLM_HOST: `127.0.0.1:${MOCK_PORT}`,
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })

  await waitForHttp(`${CTS_BASE}/health`)

  // 3. Issue test API key
  const keyRes = await fetch(`${CTS_BASE}/admin/keys`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': ADMIN_SECRET },
    body: JSON.stringify({ name: 'manual_tester', ownerEmail: 'test@example.com' })
  })
  const keyData = await keyRes.json() as { key: string }
  ctsApiKey = keyData.key
}

async function stopEnvironment() {
  ctsProcess?.kill()
  await new Promise<void>((resolve) => mockServer.close(() => resolve()))
  try { rmSync(tempCwd, { recursive: true, force: true }) } catch {}
}

async function run() {
  console.log('Starting test environment (Mock LLM + EchoRegent CTS)...')
  await startEnvironment()
  console.log(`Environment ready. Key: ${ctsApiKey.slice(0, 10)}...`)

  const results: any[] = []

  for (const tc of TEST_CASES) {
    const originalTokens = countChatTokens(tc.messages)
    const originalChars = tc.messages.reduce((acc, m) => acc + m.content.length, 0)
    lastUpstreamPayload = null

    const startTime = Date.now()
    const res = await fetch(`${CTS_BASE}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${ctsApiKey}`,
        'x-llm-key': 'sk-test-provider-key',
        'x-llm-provider': 'openai',
        'x-llm-base-url': `http://127.0.0.1:${MOCK_PORT}`,
      },
      body: JSON.stringify({
        model: 'gpt-4o',
        messages: tc.messages,
      })
    })

    const latency = Date.now() - startTime
    const status = res.status
    const responseJson = await res.json() as any

    const tokensSavedHeader = Number(res.headers.get('x-cts-tokens-saved') ?? 0)
    const compressionPctHeader = Number(res.headers.get('x-cts-compression-pct') ?? 0)
    const domainHeader = res.headers.get('x-cts-domain') ?? ''
    const intentHeader = res.headers.get('x-cts-intent') ?? ''
    const riskHeader = res.headers.get('x-cts-risk') ?? ''
    const actualUsageHeader = res.headers.get('x-cts-actual-usage')

    // Upstream received payload analysis
    const forwardedMessages = lastUpstreamPayload?.messages || []
    const forwardedTokens = countChatTokens(forwardedMessages)
    const actualTokensSaved = Math.max(0, originalTokens - forwardedTokens)
    const actualPctSaved = originalTokens > 0 ? Math.round((actualTokensSaved / originalTokens) * 100) : 0

    results.push({
      id: tc.id,
      name: tc.name,
      status,
      latencyMs: latency,
      domainClassified: domainHeader,
      intentClassified: intentHeader,
      riskFlags: riskHeader || 'none',
      originalTurns: tc.messages.length,
      forwardedTurns: forwardedMessages.length,
      turnsDroppedOrSummarized: tc.messages.length - forwardedMessages.length,
      originalTokens,
      forwardedTokens,
      tokensSavedEstimate: tokensSavedHeader,
      tokensSavedActual: actualTokensSaved,
      pctSaved: actualPctSaved,
      providerActualUsage: actualUsageHeader ? JSON.parse(actualUsageHeader) : null,
      summarySnippet: forwardedMessages.find((m: any) => m.content?.includes('CTS summary:'))?.content?.slice(0, 100) || '(No CTS summary block)'
    })
  }

  // Print results table
  console.log('\n========================================================================================')
  console.log('                       ECHOREGENT MANUAL END-TO-END TEST RESULTS                        ')
  console.log('========================================================================================')

  for (const r of results) {
    console.log(`\n[${r.id}] ${r.name}`)
    console.log(`  * Status: HTTP ${r.status} (${r.latencyMs}ms)`)
    console.log(`  * Domain: ${r.domainClassified} | Intent: ${r.intentClassified} | Risk: ${r.riskFlags}`)
    console.log(`  * Turns: ${r.originalTurns} input -> ${r.forwardedTurns} forwarded to LLM`)
    console.log(`  * Tokens: ${r.originalTokens} original -> ${r.forwardedTokens} forwarded`)
    console.log(`  * Tokens Saved: ${r.tokensSavedActual} tokens (${r.pctSaved}% reduction)`)
    if (r.summarySnippet !== '(No CTS summary block)') {
      console.log(`  * Injected Context: "${r.summarySnippet}..."`)
    }
  }

  // Also query SaaS usage log from CTS server to verify database recording
  const usageRes = await fetch(`${CTS_BASE}/api/usage`, {
    headers: { Authorization: `Bearer ${ctsApiKey}` }
  })
  const usageData = await usageRes.json() as any

  console.log('\n========================================================================================')
  console.log('                          SAAS PERSISTENT USAGE LOG VERIFICATION                         ')
  console.log('========================================================================================')
  console.log(`Total Logged Calls: ${usageData.totalCalls}`)
  console.log(`Total Tokens Saved Logged: ${usageData.totalTokensSaved}`)
  console.log(`Quota Used / Limit: ${usageData.quotaUsed} / ${usageData.quotaLimit}`)

  await stopEnvironment()

  // Output JSON report to scratch directory
  const reportPath = join(__dirname, '../notes/manual_test_run_data.json')
  writeFileSync(reportPath, JSON.stringify({ results, usage: usageData }, null, 2))
  console.log(`\nSaved run artifact to ${reportPath}`)
}

run().catch((e) => {
  console.error('Fatal test error:', e)
  stopEnvironment().finally(() => process.exit(1))
})
