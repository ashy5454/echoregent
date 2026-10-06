import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Resend } from 'resend'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, extname, join } from 'node:path'
import {
  classify,
  classifyAsync,
  compressHistory,
  compressHistoryAsync,
  correctMemoryFact,
  createEmptyLLMWiki,
  ctsAsync,
  buildContextPlan,
  evaluateContextPolicy,
  evaluateContextQuality,
  forgetMemoryFact,
  ingestSession,
  ingestSourceIntoLLMWiki,
  lintLLMWiki,
  llmWikiToContextString,
  purgeExpiredMemory,
  recallMemoryFacts,
  warmUpClassifier,
  warmUpT5,
  warmUpSemanticCache,
  checkCache,
  storeCache,
  getCacheStats,
  getCompressionStats,
  getClassifierHealth,
  getT5Health,
  getSemanticCacheHealth,
  wikiToContextString,
  type CustomDomainPlugin,
  type ContextPolicy,
  type LLMWiki,
  type MemoryFrame,
  type Message,
  type RoutingFrame,
  type SourceInput,
  type WikiDocument,
} from './cts-core'
import { callLLMProvider, validateProviderRequest, type ProviderRequest } from './providerServer'
import { authenticate, recordUsage } from './saas/auth.js'
import {
  createApiKey,
  getDashboard,
  getKeyRequests,
  getKeyUsage,
  getOwnUsage,
  fulfillKeyRequest,
  getWaitlistCount,
  getWaitlistPosition,
  revokeKey,
  saveKeyRequest,
  updateKeyQuota,
} from './saas/db.js'
import { initDb, getDb } from './saas/database.js'
import { getContextPolicy, saveContextPolicy } from './saas/policies.js'
import { listContextTraces, recordContextTrace } from './saas/traces.js'
import { getAdminDashboardHtml } from './admin-ui.js'
import { getOpenApiDocument } from './openapi.js'

// Load .env for local dev (no extra dependencies needed)
const envFile = join(process.cwd(), '.env')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf-8').split('\n')) {
    const eq = line.indexOf('=')
    if (eq > 0 && !line.trimStart().startsWith('#')) {
      const key = line.slice(0, eq).trim()
      const val = line.slice(eq + 1).trim()
      if (key && !(key in process.env)) process.env[key] = val
    }
  }
}

type WikiLLMCall = (prompt: string) => Promise<string>

// Sanitize user-supplied session IDs used as DB/store keys
function sanitizeSessionId(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9._:@-]/g, '-').slice(0, 128)
}

const PORT         = Number(process.env.PORT || process.env.CTS_API_PORT || 8787)
const HOST         = process.env.CTS_HOST || '0.0.0.0'
const IS_PROD      = process.env.NODE_ENV === 'production'
const CORS_ORIGIN  = process.env.CTS_CORS_ORIGIN || (IS_PROD ? '' : '*')
const ADMIN_SECRET = process.env.CTS_ADMIN_SECRET || ''
const REQUIRE_LOCAL_MODELS = process.env.CTS_REQUIRE_LOCAL_MODELS === 'true'
const distPath     = join(process.cwd(), 'dist')

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null

async function sendApiKeyEmail(email: string, key: string, name: string): Promise<boolean> {
  if (!resend) return false
  try {
    const { error } = await resend.emails.send({
      from: 'CTS <onboarding@yudi.co.in>',
      to: [email],
      subject: 'Your CTS API Key is ready',
      html: `
        <div style="font-family: sans-serif; max-width: 600px; margin: 0 auto;">
          <h2>Welcome to CTS, ${name}!</h2>
          <p>Your early-access API key has been generated. Please keep this safe, as it cannot be shown again.</p>
          <div style="background: #f4f4f5; padding: 16px; border-radius: 8px; font-family: monospace; font-size: 16px; margin: 24px 0;">
            ${key}
          </div>
          <p>Get started with the <a href="https://cts.yudi.co.in">documentation</a> or check your usage at the bottom of the homepage.</p>
          <p>Cheers,<br>The CTS Team</p>
        </div>
      `,
    })
    if (error) {
      console.error('[CTS] Resend email error:', error)
      return false
    }
    return true
  } catch (err) {
    console.error('[CTS] Resend email exception:', err)
    return false
  }
}

if (IS_PROD && CORS_ORIGIN === '*') {
  console.warn('[warn] CTS_CORS_ORIGIN is "*" in production — set it to your frontend origin')
}
if (IS_PROD && !CORS_ORIGIN) {
  console.warn('[warn] CORS is disabled in production; set CTS_CORS_ORIGIN only when a separate browser frontend needs access')
}

// Demo rate limit: 20 requests per IP per minute
const demoRateMap = new Map<string, { count: number; windowStart: number }>()
// Evict stale entries every 2 minutes (rate window is 1 min — keeps map tight)
setInterval(() => {
  const cutoff = Date.now() - 60_000
  for (const [ip, entry] of demoRateMap) {
    if (entry.windowStart < cutoff) demoRateMap.delete(ip)
  }
}, 120_000).unref()

function checkDemoRateLimit(ip: string): boolean {
  // No rate limit for localhost â€” allows local benchmarking/eval
  if (ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1') return true
  const now   = Date.now()
  const entry = demoRateMap.get(ip)
  if (!entry || now - entry.windowStart > 60_000) {
    demoRateMap.set(ip, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= 20) return false
  entry.count += 1
  return true
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
  '.ico':  'image/x-icon',
  '.woff2':'font/woff2',
  '.json': 'application/json',
}

function serveStatic(res: ServerResponse, filePath: string): boolean {
  try {
    const stat = statSync(filePath)
    if (stat.isFile()) {
      const ext       = extname(filePath)
      const immutable = ['.js', '.css', '.woff2', '.png', '.svg'].includes(ext)
      res.writeHead(200, {
        'Content-Type':  MIME[ext] || 'application/octet-stream',
        'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
      })
      createReadStream(filePath).pipe(res)
      return true
    }
  } catch { /* not found */ }
  return false
}

function getClientIp(req: IncomingMessage): string {
  // Railway (and most reverse proxies) append the real client IP last in X-Forwarded-For.
  // Taking the rightmost entry prevents spoofing via a client-controlled leftmost value.
  const fwd = req.headers['x-forwarded-for']
  const raw = Array.isArray(fwd) ? fwd.join(',') : (fwd ?? '')
  const ips  = raw.split(',').map((s) => s.trim()).filter(Boolean)
  return ips.at(-1) ?? req.socket.remoteAddress ?? 'unknown'
}

// â”€â”€ Wiki store â€” DB-backed with JSON fallback â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

const storePath = join(process.cwd(), 'data', 'cts-store.json')

type Store = { userWikis: Record<string, WikiDocument>; llmWikis: Record<string, LLMWiki> }

async function loadWiki(userId: string): Promise<{ userWiki: WikiDocument | null; llmWiki: LLMWiki | null }> {
  const db = getDb()
  if (db) {
    const { rows } = await db.query<{ user_wiki: WikiDocument | null; llm_wiki: LLMWiki | null }>(
      `SELECT user_wiki, llm_wiki FROM wiki_store WHERE key_id = $1`,
      [userId],
    )
    return { userWiki: rows[0]?.user_wiki ?? null, llmWiki: rows[0]?.llm_wiki ?? null }
  }
  try {
    const store = JSON.parse(await readFile(storePath, 'utf-8')) as Store
    return { userWiki: store.userWikis[userId] ?? null, llmWiki: store.llmWikis[userId] ?? null }
  } catch { return { userWiki: null, llmWiki: null } }
}

async function saveUserWiki(userId: string, wiki: WikiDocument): Promise<void> {
  const db = getDb()
  if (db) {
    await db.query(
      `INSERT INTO wiki_store (key_id, user_wiki, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key_id) DO UPDATE SET user_wiki = $2, updated_at = NOW()`,
      [userId, JSON.stringify(wiki)],
    )
    return
  }
  const store = await loadFullStore()
  store.userWikis[userId] = wiki
  await saveFullStore(store)
}

async function saveLLMWiki(userId: string, wiki: LLMWiki): Promise<void> {
  const db = getDb()
  if (db) {
    await db.query(
      `INSERT INTO wiki_store (key_id, llm_wiki, updated_at) VALUES ($1, $2, NOW())
       ON CONFLICT (key_id) DO UPDATE SET llm_wiki = $2, updated_at = NOW()`,
      [userId, JSON.stringify(wiki)],
    )
    return
  }
  const store = await loadFullStore()
  store.llmWikis[userId] = wiki
  await saveFullStore(store)
}

async function deleteWiki(userId: string): Promise<void> {
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

// JSON file fallback helpers
async function loadFullStore(): Promise<Store> {
  try { return JSON.parse(await readFile(storePath, 'utf-8')) as Store }
  catch { return { userWikis: {}, llmWikis: {} } }
}
async function saveFullStore(store: Store): Promise<void> {
  await mkdir(dirname(storePath), { recursive: true })
  await writeFile(storePath, JSON.stringify(store, null, 2), 'utf-8')
}

// â”€â”€ Server â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


type StartupState = {
  startedAt: string
  dbReady: boolean
  dbError: string | null
  modelWarmupStartedAt: string | null
  modelWarmupFinishedAt: string | null
}

const startupState: StartupState = {
  startedAt: new Date().toISOString(),
  dbReady: false,
  dbError: null,
  modelWarmupStartedAt: null,
  modelWarmupFinishedAt: null,
}

let modelWarmupPromise: Promise<void> | null = null

function startModelWarmup(): Promise<void> {
  if (modelWarmupPromise) return modelWarmupPromise
  startupState.modelWarmupStartedAt = new Date().toISOString()
  modelWarmupPromise = Promise.allSettled([
    warmUpClassifier(),
    warmUpT5(),
    warmUpSemanticCache(),
  ]).then((results) => {
    startupState.modelWarmupFinishedAt = new Date().toISOString()
    for (const result of results) {
      if (result.status === 'rejected') console.warn('[CTS] model warm-up task rejected:', result.reason)
    }
  })
  return modelWarmupPromise
}

function currentModelHealth() {
  return {
    classifier: getClassifierHealth(),
    t5: getT5Health(),
    semanticCache: getSemanticCacheHealth(),
  }
}

function requiredModelsReady(): boolean {
  const models = currentModelHealth()
  // Rule classification and compression are supported production fallbacks.
  // Strict model readiness is available to deployments that ship local ONNX.
  return !REQUIRE_LOCAL_MODELS || models.classifier.loaded
}

function readinessPayload() {
  return {
    ok: requiredModelsReady(),
    mode: REQUIRE_LOCAL_MODELS ? 'local-models-required' : 'fallback-capable',
    service: 'cts-api',
    version: '0.4.0',
    startup: startupState,
    models: currentModelHealth(),
    compression: getCompressionStats(),
  }
}
const server = createServer(async (req, res) => {
  setCors(res)
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
  try {
    await route(req, res)
  } catch (error) {
    sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) })
  }
})

process.on('uncaughtException',  (err)    => console.error('[crash] uncaughtException:', err))
process.on('unhandledRejection', (reason) => console.error('[crash] unhandledRejection:', reason))

// Start listening immediately, then init DB + warm up ML model in background
server.listen(PORT, HOST, () => {
  console.log(`CTS API listening on http://${HOST}:${PORT} (raw PORT env: ${process.env.PORT})`)
  if (!ADMIN_SECRET) console.warn('[warn] CTS_ADMIN_SECRET not set - admin endpoints disabled')
  initDb().then(() => {
    startupState.dbReady = true
    startupState.dbError = null
    console.log('[db] ready')
  }).catch((err) => {
    startupState.dbReady = false
    startupState.dbError = err instanceof Error ? err.message : String(err)
    console.error('[db] init error (will retry on first request):', err)
  })
  startModelWarmup()
})

// â”€â”€ Route â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

async function route(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${HOST}:${PORT}`}`)

  // â”€â”€ Health â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET' && url.pathname === '/health') {
    sendJson(res, 200, {
      ok: true,
      service: 'cts-api',
      version: '0.4.0',
      ready: requiredModelsReady(),
      uptimeSec: Math.round(process.uptime()),
      models: currentModelHealth(),
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/ready') {
    const payload = readinessPayload()
    sendJson(res, payload.ok ? 200 : 503, payload)
    return
  }

  if (req.method === 'GET' && url.pathname === '/openapi.json') {
    const proto = String(req.headers['x-forwarded-proto'] ?? 'http')
    const host = String(req.headers.host ?? `localhost:${PORT}`)
    sendJson(res, 200, getOpenApiDocument(`${proto}://${host}`))
    return
  }

  // â”€â”€ Admin UI (serve dashboard HTML) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET' && url.pathname === '/admin-ui') {
    const origin = `${req.headers['x-forwarded-proto'] ?? 'http'}://${req.headers.host ?? `localhost:${PORT}`}`
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(getAdminDashboardHtml(origin))
    return
  }

  // â”€â”€ Static file serving (built frontend) â€” must come before auth â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (req.method === 'GET' && !url.pathname.startsWith('/api') && !url.pathname.startsWith('/admin') && !url.pathname.startsWith('/demo')) {
    // Named page routes â†' serve their specific HTML from dist/
    if (url.pathname === '/docs' || url.pathname === '/docs/') {
      if (serveStatic(res, join(distPath, 'docs.html'))) return
    }
    if (url.pathname === '/use-cases' || url.pathname === '/use-cases/') {
      if (serveStatic(res, join(distPath, 'use-cases.html'))) return
    }
    // Everything else: try exact path, then fall back to index.html
    const safePath = url.pathname.replace(/\.\./g, '').replace(/^\/+/, '') || 'index.html'
    if (serveStatic(res, join(distPath, safePath))) return
    if (serveStatic(res, join(distPath, 'index.html'))) return
  }

  // ── Eval-only test endpoints — disabled in production ────────────────────────
  if ((url.pathname === '/test/wiki' || url.pathname === '/test/cache') && IS_PROD) {
    sendJson(res, 404, { error: 'Not found.' })
    return
  }

  // POST /test/wiki  {sessionId, message, fakeWikiMarkdown?}
  if (req.method === 'POST' && url.pathname === '/test/wiki') {
    const body      = await readJson(req)
    const sessionId = sanitizeSessionId(String(body.sessionId ?? 'test-wiki'))
    const message   = String(body.message ?? '').slice(0, 2000)
    const fakeMd    = body.fakeWikiMarkdown ? String(body.fakeWikiMarkdown).slice(0, 8000) : null

    const { llmWiki } = await loadWiki(sessionId)
    let wiki = llmWiki ?? createEmptyLLMWiki()

    if (fakeMd) {
      const now = new Date().toISOString()
      wiki = {
        ...wiki,
        pages: [
          ...wiki.pages.filter((p) => p.path !== 'test/injected.md'),
          {
            path: 'test/injected.md',
            title: 'Injected Test Page',
            markdown: fakeMd,
            updatedAt: now,
            sourceIds: ['test-seed'],
            tags: ['test', 'injected'],
          },
        ],
        version: wiki.version + 1,
        lastUpdated: now,
        indexMarkdown: wiki.indexMarkdown + '\n- [test/injected.md] Injected Test Page',
        logMarkdown: wiki.logMarkdown + `\n## [${now.slice(0, 10)}] eval seed\n`,
      }
      await saveLLMWiki(sessionId, wiki)
    }

    const context = llmWikiToContextString(wiki, message)
    sendJson(res, 200, {
      pageCount:   wiki.pages.length,
      wikiContext: context,
      hasContext:  context.length > 0,
    })
    return
  }

  // ── Cache test endpoint (no LLM, no credits needed — for eval only) ─────────
  // POST /test/cache  {message, sessionId, domain?, fakeResponse?}
  // → checks cache; if miss and fakeResponse provided, stores it
  if (req.method === 'POST' && url.pathname === '/test/cache') {
    const body      = await readJson(req)
    const message   = String(body.message ?? '')
    const sessionId = String(body.sessionId ?? 'test')
    const domain    = String(body.domain ?? 'general') as import('./cts-core').DomainType
    const fakeresp  = body.fakeResponse ? String(body.fakeResponse) : null

    const cached = await checkCache(message, domain, sessionId)
    if (cached.hit) {
      sendJson(res, 200, { hit: true, response: cached.response, similarity: cached.similarity, savedTokens: cached.savedTokens })
      return
    }
    if (fakeresp) {
      await storeCache(message, fakeresp, domain, sessionId)
    }
    sendJson(res, 200, { hit: false })
    return
  }

  // â”€â”€ Public demo endpoints (no key required, IP rate limited) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (req.method === 'POST' && url.pathname === '/demo/compress') {
    const ip = getClientIp(req)
    if (!checkDemoRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
      res.end(JSON.stringify({ error: 'Demo rate limit: 20 requests/minute.' }))
      return
    }
    const body        = await readJson(req)
    const message     = String(body.message ?? '')
    const history     = asMessages(body.history)
    const frame       = classify(message, history)
    const compression = compressHistory([...history, { role: 'user' as const, content: message }], frame)
    sendJson(res, 200, {
      compressedHistory: compression.compressed,
      intent: frame.intent, domain: frame.domain, state: frame.state,
      tokensSaved: compression.tokensSaved,
      frame: { confidence: frame.confidence, risk: frame.risk },
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/demo/compress-async') {
    const ip = getClientIp(req)
    if (!checkDemoRateLimit(ip)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' })
      res.end(JSON.stringify({ error: 'Demo rate limit: 20 requests/minute.' }))
      return
    }
    const body        = await readJson(req)
    const message     = String(body.message ?? '')
    const history     = asMessages(body.history)
    const frame       = await classifyAsync(message, history)
    const compression = await compressHistoryAsync([...history, { role: 'user' as const, content: message }], frame)
    sendJson(res, 200, {
      async: true,
      compressedHistory: compression.compressed,
      originalTokens: compression.originalTokens,
      compressedTokens: compression.compressedTokens,
      tokensSaved: compression.tokensSaved,
      tokenSavingsPct: compression.originalTokens > 0 ? Math.round((compression.tokensSaved / compression.originalTokens) * 1000) / 10 : 0,
      droppedCount: compression.droppedCount,
      keptReasons: compression.keptReasons,
      intent: frame.intent, domain: frame.domain, state: frame.state,
      frame: { confidence: frame.confidence, risk: frame.risk, signals: frame.signals },
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/demo/waitlist-count') {
    const count = await getWaitlistCount()
    sendJson(res, 200, { count })
    return
  }

  if (req.method === 'POST' && url.pathname === '/demo/request-key') {
    const ip = getClientIp(req)
    if (!checkDemoRateLimit(ip)) { sendJson(res, 429, { error: 'Too many requests.' }); return }
    const body = await readJson(req)
    await saveKeyRequest(body.name, body.email, body.useCase)
    const position = await getWaitlistPosition(String(body.email ?? ''))
    sendJson(res, 200, { ok: true, position })
    return
  }

  if (req.method === 'POST' && url.pathname === '/demo/chat') {
    const ip = getClientIp(req)
    if (!checkDemoRateLimit(ip)) {
      sendJson(res, 429, { error: 'Demo rate limit: 20 requests/minute.' })
      return
    }
    const demoKey = process.env.DEMO_LLM_API_KEY || process.env.GEMINI_API_KEY
    if (!demoKey) { sendJson(res, 503, { error: 'Demo LLM not configured.' }); return }
    const body        = await readJson(req)
    const message     = String(body.message ?? '')
    const sessionId   = sanitizeSessionId(String(body.sessionId ?? ip))
    const history     = asMessages(body.history)
    const frame       = classify(message, history)
    const policy      = evaluateContextPolicy(frame)
    const compression = compressHistory([...history, { role: 'user' as const, content: message }], frame)
    // ── Load LLM Wiki for this session and inject as context ─────────────────
    const { llmWiki: sessionWiki } = policy.retrieval === 'allow'
      ? await loadWiki(sessionId)
      : { llmWiki: null }
    const wikiContext = policy.retrieval === 'allow' ? llmWikiToContextString(sessionWiki, message) : ''
    const baseSystemPrompt = getDemoSystemPrompt(frame.domain)
    const systemPrompt = wikiContext
      ? `${baseSystemPrompt}\n\n${wikiContext}`
      : baseSystemPrompt

    // ── Semantic cache check (saves output tokens) ────────────────────────────
    const cached = await checkCache(message, frame.domain, sessionId, frame.risk)
    if (cached.hit && cached.response) {
      sendJson(res, 200, {
        reply:             cached.response,
        compressedHistory: compression.compressed,
        intent: frame.intent, domain: frame.domain, state: frame.state,
        tokensSaved:       compression.tokensSaved,
        frame:             { confidence: frame.confidence, risk: frame.risk },
        cacheHit:          true,
        cacheSimilarity:   cached.similarity,
        outputTokensSaved: cached.savedTokens,
        wikiPageCount:     sessionWiki?.pages?.length ?? 0,
      })
      return
    }

    // Use Gemini directly (GEMINI_API_KEY) or OpenRouter fallback
    const useGemini = !!process.env.GEMINI_API_KEY
    const reply = useGemini
      ? await callGemini(demoKey, compression.compressed, message, systemPrompt)
      : await callOpenRouter(demoKey, compression.compressed, message, systemPrompt)

    await storeCache(message, reply, frame.domain, sessionId, frame.risk)

    // ── Fire-and-forget wiki ingest (after ≥4 turns, non-blocking) ──────────
    if (policy.memoryWrite === 'allow' && history.length >= 4 && compression.memoryFrame) {
      const wikiCall = makeDemoWikiCall(demoKey, useGemini)
      if (wikiCall) {
        ingestSourceIntoLLMWiki(
          sessionWiki ?? createEmptyLLMWiki(),
          memoryFrameToSource(compression.memoryFrame, Math.floor(history.length / 2)),
          frame,
          wikiCall,
        ).then((newWiki) => saveLLMWiki(sessionId, newWiki))
         .catch((err) => console.error('[wiki] demo ingest error:', err))
      }
    }

    sendJson(res, 200, {
      reply,
      compressedHistory: compression.compressed,
      intent: frame.intent, domain: frame.domain, state: frame.state,
      tokensSaved: compression.tokensSaved,
      frame: { confidence: frame.confidence, risk: frame.risk },
      policy,
      cacheHit: false,
      wikiPageCount: sessionWiki?.pages?.length ?? 0,
    })
    return
  }

  // â”€â”€ Admin (protected by CTS_ADMIN_SECRET) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  if (url.pathname.startsWith('/admin')) {
    if (!ADMIN_SECRET) {
      sendJson(res, 503, { error: 'Admin endpoints disabled. Set CTS_ADMIN_SECRET to enable.' })
      return
    }
    if (req.headers['x-admin-secret'] !== ADMIN_SECRET) {
      sendJson(res, 401, { error: 'Invalid admin secret.' })
      return
    }
    await routeAdmin(req, res, url)
    return
  }

  // â”€â”€ API (requires Bearer key) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  const key = await authenticate(req, res)
  if (!key) return

  const userId = key.id
  const tenantPolicy = await getContextPolicy(userId)

  if (req.method === 'POST' && url.pathname === '/api/classify') {
    const body  = await readJson(req)
    const frame = classify(String(body.message ?? ''), asMessages(body.history), asPlugins(body.customDomainPlugins))
    recordUsage(key.id, '/api/classify')
    sendJson(res, 200, frame)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/context-plan') {
    const body = await readJson(req)
    const history = asMessages(body.history)
    const frame = classify(String(body.message ?? ''), history, asPlugins(body.customDomainPlugins))
    const plan = buildContextPlan({
      frame,
      history: [...history, { role: 'user', content: String(body.message ?? '') }],
      policy: tenantPolicy,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
    })
    recordUsage(key.id, '/api/context-plan')
    sendJson(res, 200, { frame, plan })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/policy') {
    recordUsage(key.id, '/api/policy')
    sendJson(res, 200, tenantPolicy)
    return
  }

  if (req.method === 'PUT' && url.pathname === '/api/policy') {
    const body = await readJson(req)
    const updated = await saveContextPolicy(userId, asContextPolicy(body) ?? {})
    recordUsage(key.id, 'PUT /api/policy')
    sendJson(res, 200, updated)
    return
  }

  if (req.method === 'POST' && url.pathname === '/compress') {
    const body        = await readJson(req)
    const message     = String(body.message ?? '')
    const history     = asMessages(body.history)
    const frame       = classify(message, history, asPlugins(body.customDomainPlugins))
    const current     = { role: 'user' as const, content: message }
    const compression = compressHistory([...history, current], frame, tenantPolicy)
    const plan = buildContextPlan({ frame, history: [...history, current], policy: tenantPolicy, provider: typeof body.provider === 'string' ? body.provider : undefined })
    recordUsage(key.id, '/compress', compression.tokensSaved)
    void recordContextTrace(makeContextTrace(key.id, '/compress', frame, plan, compression)).catch((error) => console.error('[trace] write failed:', error))
    sendJson(res, 200, {
      compressedHistory: compression.compressed,
      intent: frame.intent, domain: frame.domain, state: frame.state,
      tokensSaved: compression.tokensSaved,
      memoryFrame: compression.memoryFrame ?? null,
      contextPlan: plan,
    })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/evaluations/context') {
    const body = await readJson(req)
    const message = String(body.message ?? '')
    const history = asMessages(body.history)
    const frame = classify(message, history, asPlugins(body.customDomainPlugins))
    const fullHistory = [...history, { role: 'user' as const, content: message }]
    const compression = compressHistory(fullHistory, frame, tenantPolicy)
    const contextPlan = buildContextPlan({ frame, history: fullHistory, policy: tenantPolicy, provider: typeof body.provider === 'string' ? body.provider : undefined })
    const requiredFacts = Array.isArray(body.requiredFacts)
      ? body.requiredFacts.filter((fact): fact is string => typeof fact === 'string').slice(0, 100)
      : undefined
    const report = evaluateContextQuality({ original: fullHistory, compression, frame, requiredFacts })
    recordUsage(key.id, '/api/evaluations/context', compression.tokensSaved)
    void recordContextTrace(makeContextTrace(key.id, '/api/evaluations/context', frame, contextPlan, compression)).catch((error) => console.error('[trace] write failed:', error))
    sendJson(res, 200, { frame, contextPlan, compression, report })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/chat') {
    const body                = await readJson(req)
    const history             = asMessages(body.history)
    const customDomainPlugins = asPlugins(body.customDomainPlugins)
    const preFrame            = await classifyAsync(String(body.message ?? ''), history, customDomainPlugins)
    const prePolicy           = evaluateContextPolicy(preFrame, tenantPolicy)
    const { userWiki, llmWiki } = prePolicy.retrieval === 'allow'
      ? await loadWiki(userId)
      : { userWiki: null, llmWiki: null }
    const smallWikiContext    = prePolicy.retrieval === 'allow' ? wikiToContextString(userWiki) : ''
    const knowledgeContext    = prePolicy.retrieval === 'allow' ? llmWikiToContextString(llmWiki, String(body.message ?? '')) : ''
    const wikiContext         = [smallWikiContext, knowledgeContext].filter(Boolean).join('\n\n')
    const live                = body.live
    const sessionId           = sanitizeSessionId(String(body.sessionId ?? userId))
    const cached = live && prePolicy.responseCache === 'allow'
      ? await checkCache(String(body.message ?? ''), preFrame.domain, sessionId, preFrame.risk)
      : { hit: false }

    const result = await ctsAsync({
      message: String(body.message ?? ''),
      history, frame: preFrame, customDomainPlugins, wikiContext,
      contextPolicy: tenantPolicy,
      provider: isLiveProvider(body.live) ? body.live.provider : undefined,
      responder: live
        ? cached.hit && cached.response
          ? async () => cached.response!
          : async ({ systemPrompt, compressedHistory, message }) => {
            const providerRequest: Partial<ProviderRequest> = { ...live, systemPrompt, compressedHistory, message }
            validateProviderRequest(providerRequest)
            return callLLMProvider(providerRequest)
          }
        : undefined,
    })

    const memoryFrame = result.compression.memoryFrame
    const state       = result.frame.state
    if (result.policy.memoryWrite === 'allow' && memoryFrame && live && (state === 'closing' || state === 'resolving') && history.length >= 4) {
      const wikiCall = makeLLMCall(live)
      if (wikiCall) {
        const newLLMWiki = await ingestSourceIntoLLMWiki(
          llmWiki ?? createEmptyLLMWiki(),
          memoryFrameToSource(memoryFrame, Math.floor(history.length / 2)),
          result.frame,
          wikiCall,
          { retentionDays: tenantPolicy.defaultRetentionDays },
        )
        await saveLLMWiki(userId, newLLMWiki)
      }
    }

    if (live && !cached.hit && result.policy.responseCache === 'allow') {
      await storeCache(String(body.message ?? ''), result.response, result.frame.domain, sessionId, result.frame.risk)
    }

    recordUsage(key.id, '/api/chat', result.compression.tokensSaved)
    void recordContextTrace(makeContextTrace(key.id, '/api/chat', result.frame, result.contextPlan, result.compression, result.processingMs)).catch((error) => console.error('[trace] write failed:', error))
    const updatedWiki = result.policy.retrieval === 'allow'
      ? await loadWiki(userId)
      : { userWiki: null, llmWiki: null }
    sendJson(res, 200, {
      result,
      userWiki: updatedWiki.userWiki,
      llmWiki:  updatedWiki.llmWiki,
      cache: {
        hit: cached.hit,
        similarity: cached.similarity ?? null,
        outputTokensSaved: cached.savedTokens ?? 0,
      },
    })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/wiki') {
    const { userWiki, llmWiki } = await loadWiki(userId)
    recordUsage(key.id, '/api/wiki')
    sendJson(res, 200, { userWiki, llmWiki })
    return
  }

  if (req.method === 'DELETE' && url.pathname === '/api/wiki') {
    await deleteWiki(userId)
    recordUsage(key.id, 'DELETE /api/wiki')
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/wiki/ingest-chat') {
    const body    = await readJson(req)
    const frame   = asFrame(body.frame)
    const session = asMessages(body.session)
    const { userWiki } = await loadWiki(userId)
    const updated = ingestSession(userWiki, session, frame)
    await saveUserWiki(userId, updated)
    recordUsage(key.id, '/api/wiki/ingest-chat')
    sendJson(res, 200, updated)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/llm-wiki/ingest-source') {
    const body    = await readJson(req)
    const source  = asSource(body.source)
    const frame   = body.frame ? asFrame(body.frame) : classify(`${source.title}\n${source.content}`)
    const { llmWiki } = await loadWiki(userId)
    const updated = await ingestSourceIntoLLMWiki(
      llmWiki ?? createEmptyLLMWiki(),
      { title: source.title, content: source.content },
      frame,
      makeLLMCall(body.live),
      { retentionDays: tenantPolicy.defaultRetentionDays },
    )
    await saveLLMWiki(userId, updated)
    recordUsage(key.id, '/api/llm-wiki/ingest-source')
    sendJson(res, 200, updated)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/llm-wiki/lint') {
    const { llmWiki } = await loadWiki(userId)
    recordUsage(key.id, '/api/llm-wiki/lint')
    sendJson(res, 200, { issues: lintLLMWiki(llmWiki) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/memory/facts') {
    const query = String(url.searchParams.get('query') ?? '')
    const limit = Number(url.searchParams.get('limit') ?? 8)
    const policy = evaluateContextPolicy(classify(query), tenantPolicy)
    if (policy.retrieval === 'block') {
      sendJson(res, 403, { error: 'Policy blocks cross-session memory retrieval for this request.', policy })
      return
    }
    const { llmWiki } = await loadWiki(userId)
    recordUsage(key.id, '/api/memory/facts')
    sendJson(res, 200, { facts: recallMemoryFacts(llmWiki, query, limit), policy })
    return
  }

  if (req.method === 'POST' && /^\/api\/memory\/facts\/[^/]+\/correct$/.test(url.pathname)) {
    const body = await readJson(req)
    const factId = url.pathname.split('/')[4]
    const { llmWiki } = await loadWiki(userId)
    if (!llmWiki) { sendJson(res, 404, { error: 'No memory exists for this workspace.' }); return }
    const fact = correctMemoryFact(llmWiki, factId, String(body.value ?? ''))
    await saveLLMWiki(userId, llmWiki)
    recordUsage(key.id, '/api/memory/facts/correct')
    sendJson(res, 200, { fact })
    return
  }

  if (req.method === 'DELETE' && /^\/api\/memory\/facts\/[^/]+$/.test(url.pathname)) {
    const factId = url.pathname.split('/')[4]
    const { llmWiki } = await loadWiki(userId)
    if (!llmWiki) { sendJson(res, 404, { error: 'No memory exists for this workspace.' }); return }
    const forgotten = forgetMemoryFact(llmWiki, factId)
    if (!forgotten) { sendJson(res, 404, { error: 'Current memory fact not found.' }); return }
    await saveLLMWiki(userId, llmWiki)
    recordUsage(key.id, 'DELETE /api/memory/facts')
    sendJson(res, 200, { ok: true })
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/memory/purge') {
    const { llmWiki } = await loadWiki(userId)
    if (!llmWiki) { sendJson(res, 200, { sources: 0, pages: 0, facts: 0 }); return }
    const removed = purgeExpiredMemory(llmWiki)
    if (removed.sources || removed.pages || removed.facts) await saveLLMWiki(userId, llmWiki)
    recordUsage(key.id, '/api/memory/purge')
    sendJson(res, 200, removed)
    return
  }

  if (req.method === 'POST' && url.pathname === '/api/llm') {
    const body = await readJson(req)
    validateProviderRequest(body)
    recordUsage(key.id, '/api/llm')
    sendJson(res, 200, { text: await callLLMProvider(body) })
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/usage') {
    recordUsage(key.id, '/api/usage')
    sendJson(res, 200, await getOwnUsage(key.id))
    return
  }

  if (req.method === 'GET' && url.pathname === '/api/traces') {
    const limit = Number(url.searchParams.get('limit') ?? 100)
    recordUsage(key.id, '/api/traces')
    sendJson(res, 200, { traces: await listContextTraces(key.id, limit) })
    return
  }

  // ── OpenAI-compatible proxy: POST /v1/chat/completions ────────────────────
  // One-line integration: just change baseURL to this server's URL.
  // CTS classifies + compresses the messages before forwarding to the LLM,
  // then returns an OpenAI-compatible response with CTS metadata in headers.
  //
  // Usage:
  //   const openai = new OpenAI({ apiKey: LLM_KEY, baseURL: "https://your-cts-url/v1" })
  //   // Pass CTS key in x-cts-key header OR as the Authorization bearer token
  //   // Pass the real LLM key in x-llm-key header, and provider in x-llm-provider
  //
  // Headers returned:
  //   x-cts-tokens-saved    — tokens saved by compression (integer)
  //   x-cts-domain          — detected domain
  //   x-cts-intent          — detected intent
  //   x-cts-compression-pct — compression percentage (0-100)
  if (req.method === 'POST' && (url.pathname === '/v1/chat/completions' || url.pathname === '/v1/chat/completions/')) {
    const body      = await readJson(req)
    const messages  = (body.messages as Array<{ role: string; content: string }> | undefined) ?? []
    const model     = String(body.model ?? 'gpt-4o')
    const stream    = Boolean(body.stream)

    // Separate system prompt from conversation history
    const systemMsg = messages.find((m) => m.role === 'system')
    const convMsgs  = messages.filter((m) => m.role !== 'system')

    // Split into history (all but last user message) and current message
    const lastUserIdx = [...convMsgs].reverse().findIndex((m) => m.role === 'user')
    const lastUser    = lastUserIdx >= 0 ? convMsgs[convMsgs.length - 1 - lastUserIdx] : null
    const historyMsgs = lastUser
      ? convMsgs.slice(0, convMsgs.length - 1 - lastUserIdx).map((m) => ({
          role: m.role as 'user' | 'assistant',
          content: m.content,
        }))
      : []
    const currentMessage = lastUser?.content ?? ''

    // Run CTS classify + compress pipeline
    const frame       = classify(currentMessage, historyMsgs)
    const currentMsg: Message = { role: 'user', content: currentMessage }
    const compression = compressHistory([...historyMsgs, currentMsg], frame, tenantPolicy)
    const contextPlan = buildContextPlan({ frame, history: [...historyMsgs, currentMsg], policy: tenantPolicy, provider: String(req.headers['x-llm-provider'] ?? 'openai') })

    const tokensSaved  = compression.tokensSaved
    const comprPct     = compression.originalTokens > 0
      ? Math.round((tokensSaved / compression.originalTokens) * 100)
      : 0

    recordUsage(key.id, '/v1/chat/completions', tokensSaved)
    void recordContextTrace(makeContextTrace(key.id, '/v1/chat/completions', frame, contextPlan, compression)).catch((error) => console.error('[trace] write failed:', error))

    // Resolve which LLM to call
    const llmKey      = String(req.headers['x-llm-key'] ?? '')
    const llmProvider = String(req.headers['x-llm-provider'] ?? 'openai')
    const llmModel    = String(req.headers['x-llm-model'] ?? model)

    if (!llmKey) {
      sendJson(res, 400, { error: 'Missing x-llm-key header. Pass your LLM API key there; use Authorization for your CTS key.' })
      return
    }

    // Build the forwarded message array (compressed history + system + current)
    const forwardMessages: Array<{ role: string; content: string }> = []
    if (systemMsg) forwardMessages.push(systemMsg)
    forwardMessages.push(...compression.compressed.map((m) => ({ role: m.role, content: m.content })))
    // If currentMessage is not already in compressed (it may be), append it
    const alreadyHasCurrent = compression.compressed.some(
      (m) => m.role === 'user' && m.content === currentMessage
    )
    if (!alreadyHasCurrent && currentMessage) {
      forwardMessages.push({ role: 'user', content: currentMessage })
    }

    // Determine LLM endpoint
    let llmUrl: string
    let llmHeaders: Record<string, string>
    if (llmProvider === 'anthropic') {
      llmUrl     = 'https://api.anthropic.com/v1/messages'
      llmHeaders = { 'x-api-key': llmKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
    } else if (llmProvider === 'gemini') {
      llmUrl     = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions?key=${llmKey}`
      llmHeaders = { 'content-type': 'application/json' }
    } else {
      // Default: OpenAI-compatible (openai, groq, together, etc.)
      const baseUrl = String(req.headers['x-llm-base-url'] ?? 'https://api.openai.com')
      llmUrl     = `${baseUrl.replace(/\/$/, '')}/v1/chat/completions`
      llmHeaders = { authorization: `Bearer ${llmKey}`, 'content-type': 'application/json' }
    }

    const controller = new AbortController()
    const timeout    = setTimeout(() => controller.abort(), 60_000)

    let llmResponse: Response
    try {
      llmResponse = await fetch(llmUrl, {
        signal:  controller.signal,
        method:  'POST',
        headers: llmHeaders,
        body:    JSON.stringify({ ...body, messages: forwardMessages, model: llmModel, stream }),
      })
    } catch (err) {
      clearTimeout(timeout)
      sendJson(res, 502, { error: `LLM upstream error: ${(err as Error).message}` })
      return
    }
    clearTimeout(timeout)

    // Inject CTS metadata into response headers
    res.setHeader('x-cts-tokens-saved',    String(tokensSaved))
    res.setHeader('x-cts-domain',          frame.domain)
    res.setHeader('x-cts-intent',          frame.intent)
    res.setHeader('x-cts-compression-pct', String(comprPct))
    res.setHeader('x-cts-context-strategy', contextPlan.strategy)
    res.setHeader('x-cts-policy-version', contextPlan.policy.policyVersion)

    if (stream) {
      // Stream passthrough — pipe LLM response directly to client
      res.writeHead(llmResponse.status, {
        'content-type':          'text/event-stream',
        'cache-control':         'no-cache',
        'x-cts-tokens-saved':    String(tokensSaved),
        'x-cts-domain':          frame.domain,
        'x-cts-intent':          frame.intent,
        'x-cts-compression-pct': String(comprPct),
        'x-cts-context-strategy': contextPlan.strategy,
        'x-cts-policy-version': contextPlan.policy.policyVersion,
      })
      if (llmResponse.body) {
        const reader = llmResponse.body.getReader()
        const write  = async (): Promise<void> => {
          const { done, value } = await reader.read()
          if (done) { res.end(); return }
          res.write(value)
          await write()
        }
        await write()
      } else {
        res.end()
      }
      return
    }

    // Non-stream: return JSON
    const llmPayload = await llmResponse.json() as Record<string, unknown>
    res.writeHead(llmResponse.status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(llmPayload))
    return
  }

  sendJson(res, 404, { error: 'Not found.' })
}

// ── Admin routes ─────────────────────────────────────────────────────────────

async function routeAdmin(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
  // POST /admin/keys — create a new API key
  if (req.method === 'POST' && url.pathname === '/admin/keys') {
    const body        = await readJson(req)
    const { key, id } = await createApiKey(String(body.name ?? ''), String(body.ownerEmail ?? ''))
    
    let emailed = false
    if (body.ownerEmail) {
      emailed = await sendApiKeyEmail(String(body.ownerEmail), key, String(body.name || 'Developer'))
    }

    sendJson(res, 201, { id, key, emailed, note: 'Save this key now — it will not be shown again.' })
    return
  }

  // GET /admin/dashboard — all keys with usage stats
  if (req.method === 'GET' && url.pathname === '/admin/dashboard') {
    sendJson(res, 200, { keys: await getDashboard() })
    return
  }

  // GET /admin/keys/:id/usage â€” recent calls for a specific key
  if (req.method === 'GET' && /^\/admin\/keys\/[^/]+\/usage$/.test(url.pathname)) {
    const keyId = url.pathname.split('/')[3]
    const limit = Number(url.searchParams.get('limit') || 100)
    sendJson(res, 200, { usage: await getKeyUsage(keyId, limit) })
    return
  }

  // DELETE /admin/keys/:id â€” revoke a key
  if (req.method === 'DELETE' && /^\/admin\/keys\/[^/]+$/.test(url.pathname)) {
    const keyId = url.pathname.split('/')[3]
    const ok    = await revokeKey(keyId)
    sendJson(res, ok ? 200 : 404, { ok })
    return
  }

  // PATCH /admin/keys/:id — update quota limit and usage
  if (req.method === 'PATCH' && /^\/admin\/keys\/[^/]+$/.test(url.pathname)) {
    const keyId = url.pathname.split('/')[3]
    const body  = await readJson(req)
    const limit = Number(body.quotaLimit ?? 10000)
    const used  = Number(body.quotaUsed ?? 0)
    const ok    = await updateKeyQuota(keyId, limit, used)
    sendJson(res, ok ? 200 : 404, { ok })
    return
  }

  // GET /admin/key-requests â€” list all access requests from the demo form
  if (req.method === 'GET' && url.pathname === '/admin/key-requests') {
    sendJson(res, 200, { requests: await getKeyRequests() })
    return
  }

  // POST /admin/key-requests/:id/fulfill â€” mark a request as fulfilled
  if (req.method === 'POST' && /^\/admin\/key-requests\/\d+\/fulfill$/.test(url.pathname)) {
    const id = Number(url.pathname.split('/')[3])
    const ok = await fulfillKeyRequest(id)
    sendJson(res, ok ? 200 : 404, { ok })
    return
  }

  // GET /admin/model-health - model readiness, cache, and compressor fallback health
  if (req.method === 'GET' && url.pathname === '/admin/model-health') {
    const stats = getCacheStats()
    sendJson(res, 200, {
      ready: requiredModelsReady(),
      startup: startupState,
      models: currentModelHealth(),
      compression: getCompressionStats(),
      cache: {
        ...stats,
        hitRatePct: Math.round(stats.hitRate * 1000) / 10,
        estimatedOutputTokensSaved: stats.estimatedTokensSaved,
      },
    })
    return
  }
  // GET /admin/cache-stats â€” semantic cache health (hits, misses, tokens saved)
  if (req.method === 'GET' && url.pathname === '/admin/cache-stats') {
    const stats = getCacheStats()
    sendJson(res, 200, {
      ...stats,
      hitRatePct: Math.round(stats.hitRate * 1000) / 10,
      estimatedOutputTokensSaved: stats.estimatedTokensSaved,
      note: 'Tokens saved = output tokens that were NOT generated due to cache hits',
    })
    return
  }

  sendJson(res, 404, { error: 'Admin route not found.' })
}

// â”€â”€ Helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

function setCors(res: ServerResponse): void {
  if (CORS_ORIGIN) {
    res.setHeader('Access-Control-Allow-Origin', CORS_ORIGIN)
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization,X-Admin-Secret,X-LLM-Key,X-LLM-Provider,X-LLM-Model,X-LLM-Base-URL')
    res.setHeader('Vary', 'Origin')
  }
  // Security headers
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > 8_000_000) { reject(new Error('Request body too large.')); req.destroy() }
    })
    req.on('end', () => {
      try { resolve(JSON.parse(body || '{}')) }
      catch { reject(new Error('Invalid JSON body.')) }
    })
    req.on('error', reject)
  })
}

function asMessages(value: unknown): Message[] {
  if (!Array.isArray(value)) return []
  return value
    .filter((item): item is Message => {
      const maybe = item as Partial<Message>
      return (maybe.role === 'user' || maybe.role === 'assistant') && typeof maybe.content === 'string'
    })
    .map((message) => ({ role: message.role, content: message.content, timestamp: message.timestamp }))
}

function asPlugins(value: unknown): CustomDomainPlugin[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is CustomDomainPlugin => {
    const plugin = item as Partial<CustomDomainPlugin>
    return Boolean(
      plugin && typeof plugin.id === 'string' && typeof plugin.label === 'string' &&
      Array.isArray(plugin.keywords) && typeof plugin.behavior === 'string' &&
      typeof plugin.constraints === 'string',
    )
  })
}

function asContextPolicy(value: unknown): Partial<ContextPolicy> | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Partial<ContextPolicy>
  const policy: Partial<ContextPolicy> = {}
  if (typeof raw.version === 'string') policy.version = raw.version
  if (Array.isArray(raw.protectedDomains) && raw.protectedDomains.every((item) => typeof item === 'string')) {
    policy.protectedDomains = raw.protectedDomains
  }
  if (Array.isArray(raw.protectedRisks) && raw.protectedRisks.every((item) => typeof item === 'string')) {
    policy.protectedRisks = raw.protectedRisks as ContextPolicy['protectedRisks']
  }
  if (typeof raw.defaultRetentionDays === 'number') policy.defaultRetentionDays = raw.defaultRetentionDays
  return policy
}

function isLiveProvider(value: unknown): value is { provider: string } {
  return Boolean(value && typeof value === 'object' && typeof (value as { provider?: unknown }).provider === 'string')
}

function makeContextTrace(
  keyId: string,
  endpoint: string,
  frame: RoutingFrame,
  plan: import('./cts-core').ContextPlan,
  compression: import('./cts-core').CompressionResult,
  processingMs?: number,
): import('./saas/traces.js').ContextTrace {
  return {
    id: `trace-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    keyId,
    endpoint,
    createdAt: new Date().toISOString(),
    frame: {
      domain: frame.domain,
      intent: frame.intent,
      state: frame.state,
      risk: frame.risk,
    },
    plan,
    originalTokens: compression.originalTokens,
    compressedTokens: compression.compressedTokens,
    tokensSaved: compression.tokensSaved,
    processingMs,
  }
}

function asFrame(value: unknown): RoutingFrame {
  const maybe = value as RoutingFrame
  if (maybe?.intent && maybe?.state && maybe?.domain && maybe?.signals && maybe?.confidence) return maybe
  return classify('')
}

function asSource(value: unknown): { title: string; content: string } {
  const maybe = value && typeof value === 'object' ? value as { title?: unknown; content?: unknown } : {}
  return { title: String(maybe.title ?? ''), content: String(maybe.content ?? '') }
}

function makeLLMCall(live: unknown): WikiLLMCall | undefined {
  if (!live || typeof live !== 'object') return undefined
  const config = live as Partial<ProviderRequest>
  if (!config.provider || !config.apiKey || !config.model) return undefined
  return (prompt: string) =>
    callLLMProvider({
      provider: config.provider!, apiKey: config.apiKey!, model: config.model!,
      systemPrompt: 'You are a wiki maintenance assistant. Follow all instructions precisely and output only the requested page blocks.',
      compressedHistory: [], message: prompt,
    })
}

function makeDemoWikiCall(apiKey: string, useGemini: boolean): WikiLLMCall | undefined {
  if (!useGemini) return undefined
  return (prompt: string) =>
    callGemini(
      apiKey,
      [],
      prompt,
      'You are a wiki maintenance assistant. Follow all instructions precisely and output only the requested PAGE: blocks.',
    )
}

function getDemoSystemPrompt(domain: string): string {
  const prompts: Record<string, string> = {
    coding:           'You are a senior software engineer. Give concise, accurate technical help. Use code snippets when useful. Be direct and practical.',
    medical:          'You are a knowledgeable medical information assistant. Provide clear general health information. Always recommend consulting a qualified doctor for personal medical decisions.',
    legal:            'You are a legal information assistant. Explain legal concepts clearly and simply. Always clarify this is general information, not legal advice.',
    sales:            "You are a helpful sales consultant. Understand the customer's needs honestly and provide relevant, trustworthy recommendations.",
    customer_support: 'You are a friendly, efficient customer support agent. Focus on resolving issues quickly and empathetically.',
    education:        'You are a patient, clear teacher. Break complex topics into understandable steps and use relatable examples.',
    commerce:         'You are a knowledgeable shopping assistant. Help users compare options and make informed purchase decisions.',
    general:          'You are a helpful, knowledgeable assistant. Give clear, accurate, and concise responses.',
  }
  return prompts[domain] ?? prompts.general
}

async function callGemini(apiKey: string, history: Message[], message: string, systemPrompt: string): Promise<string> {
  const model      = process.env.DEMO_LLM_MODEL || 'gemini-3.5-flash'
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 20_000)
  // Gemini OpenAI-compat endpoint now requires Authorization: Bearer — the old ?key= query param returns 400.
  const url        = `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions`
  const response   = await fetch(url, {
    signal: controller.signal,
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model, temperature: 0.7, max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ],
    }),
  })
  clearTimeout(timeout)
  const payload = await response.json() as Record<string, unknown>
  if (!response.ok) {
    const err = payload?.error as Record<string, unknown> | undefined
    throw new Error(String(err?.message ?? `Gemini error ${response.status}`))
  }
  const choices = payload.choices as Array<{ message: { content: string } }> | undefined
  return choices?.[0]?.message?.content?.trim() || ''
}

// Keep OpenRouter as fallback
async function callOpenRouter(apiKey: string, history: Message[], message: string, systemPrompt: string): Promise<string> {
  const model      = process.env.DEMO_LLM_MODEL || 'google/gemini-2.0-flash-001'
  const controller = new AbortController()
  const timeout    = setTimeout(() => controller.abort(), 20_000)
  const response   = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    signal: controller.signal,
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer':  'https://cts-v4-production.up.railway.app',
      'X-Title':       'CTS Demo',
    },
    body: JSON.stringify({
      model, temperature: 0.7, max_tokens: 500,
      messages: [
        { role: 'system', content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: 'user', content: message },
      ],
    }),
  })
  clearTimeout(timeout)
  const payload = await response.json() as Record<string, unknown>
  if (!response.ok) {
    const err = payload?.error as Record<string, unknown> | undefined
    throw new Error(String(err?.message ?? `OpenRouter error ${response.status}`))
  }
  const choices = payload.choices as Array<{ message: { content: string } }> | undefined
  return choices?.[0]?.message?.content?.trim() || ''
}

function memoryFrameToSource(frame: MemoryFrame, turnCount: number): SourceInput {
  const lines = [
    `Domain: ${frame.domain} | Intent: ${frame.intent} | State: ${frame.state}`,
    `Task: ${frame.task}`,
    frame.userGoal              ? `Goal: ${frame.userGoal}` : '',
    frame.entities.length > 0  ? `Entities: ${frame.entities.join(', ')}` : '',
    frame.constraints.length > 0 ? `Constraints: ${frame.constraints.join(', ')}` : '',
    frame.unresolved.length > 0 ? `Unresolved: ${frame.unresolved.join(', ')}` : '',
    frame.risk.length > 0      ? `Risk: ${frame.risk.join(', ')}` : '',
  ].filter(Boolean)
  return {
    title:   `Session memory â€” ${frame.domain} (${turnCount} turns, ${new Date().toLocaleDateString()})`,
    content: lines.join('\n'),
  }
}
