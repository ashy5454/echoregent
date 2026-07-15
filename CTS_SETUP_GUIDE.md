# CTS — Conversation Token System
## Complete Setup & Operations Guide

---

## What Is CTS?

CTS is a SaaS API that runs **before** every LLM call in a chatbot. It does three things in one request:

1. **Classifies** the message — detects domain (coding, medical, legal, sales, customer support, education, commerce, general), intent (debugging, generation, information seeking, etc.), and conversation state (opening, deepening, resolving, closing)
2. **Compresses** low-risk conversation history — removes selected noise while preserving critical facts. Token savings are workload-dependent and must be checked with the context-quality evaluation endpoint.
3. **Routes** to the right system prompt — domain-specific prompt is returned so your LLM behaves correctly for this exact message

Zero LLM tokens spent on routing. Everything is rule-based, under 1ms.

CTS also ships a **dual memory layer** that builds a persistent, per-user knowledge base from conversations automatically — so your chatbot remembers everything across sessions without you writing a single line of memory code.

---

## Memory Layer — How It Works

CTS has two separate memory systems that work in parallel. Both are stored per API key (fully multi-tenant) and injected as context into every LLM call automatically when you use `/api/chat`.

### 1. User Wiki (Rule-Based, Instant)

A lightweight structured fact-store extracted from every conversation. No LLM needed — runs in <1ms.

What it tracks:
| Field | What it stores | Example |
|---|---|---|
| `profile` | Who the user is | `profile_fact: student at IIT Bombay` |
| `patterns` | Their most common domains/intents | `common_domain: coding`, `recent_intent: debugging` |
| `activeContext` | What they're currently building | `current_work: a Next.js SaaS with Stripe` |
| `mistakes` | Recurring blockers | `blocker_pattern: recurring debugging/errors` |
| `behavioralSignals` | Stack/tool preferences | `prefers_stack: TypeScript`, `llm_provider_interest: OpenRouter` |

After each conversation, call `POST /api/wiki/ingest-chat` and the wiki updates automatically. On the next message, the wiki context is prepended to the system prompt — your LLM knows who it's talking to without you re-explaining anything.

### 2. LLM Wiki (AI-Powered Knowledge Base)

A deeper, document-level wiki built from any source you feed it — past conversations, documentation, product specs, support tickets, anything. Uses an LLM to synthesize structured markdown pages.

What it produces:
- `overview.md` — running synthesis of everything ingested
- `domains/coding.md`, `domains/medical.md`, etc. — per-domain knowledge
- `concepts/typescript.md`, `concepts/stripe.md`, etc. — extracted key concepts
- `index.md` — auto-generated index of all pages
- `log.md` — append-only ingestion audit trail

On every message, CTS **semantically searches** the wiki (by tag + keyword scoring) and injects the top 4 most relevant pages into the system prompt context — so your LLM always has the right background knowledge for the current message.

### How They Work Together

```
User sends message
       ↓
CTS classifies + compresses (always)
       ↓
User Wiki injected → who is this person, what are they working on?
       ↓
LLM Wiki injected → relevant knowledge pages for THIS message
       ↓
Your LLM gets: compressed history + user context + knowledge context + domain system prompt
       ↓
LLM responds with full context, zero repetition needed
```

This is how CTS enables chatbots that **remember forever** at near-zero token cost.

---

## Memory API Endpoints

All memory endpoints require `Authorization: Bearer cts_your_key`.

### `GET /api/wiki`
Get both wikis for the authenticated user.
```bash
curl https://cts-v4-production.up.railway.app/api/wiki \
  -H "Authorization: Bearer cts_your_key"
```
Response:
```json
{
  "userWiki": {
    "profile": ["profile_fact: student at IIT"],
    "patterns": ["common_domain: coding"],
    "activeContext": ["current_work: Next.js SaaS with Stripe"],
    "mistakes": ["blocker_pattern: recurring debugging/errors"],
    "behavioralSignals": ["prefers_stack: TypeScript"],
    "version": 3,
    "lastUpdated": "2026-05-01T12:00:00Z"
  },
  "llmWiki": {
    "pages": [...],
    "indexMarkdown": "# Index\n- overview.md ...",
    "version": 2,
    ...
  }
}
```

### `POST /api/wiki/ingest-chat`
After a conversation ends, ingest the session to update the User Wiki. Call this once per session.
```bash
curl -X POST https://cts-v4-production.up.railway.app/api/wiki/ingest-chat \
  -H "Authorization: Bearer cts_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "session": [
      {"role": "user", "content": "Im building a Next.js app with Stripe payments"},
      {"role": "assistant", "content": "Great, what do you need help with?"},
      {"role": "user", "content": "The webhook keeps throwing an error"}
    ],
    "frame": {
      "domain": "coding",
      "intent": "debugging",
      "state": "deepening"
    }
  }'
```
Returns the updated `WikiDocument`.

### `POST /api/llm-wiki/ingest-source`
Feed a document, article, product spec, or anything into the LLM Wiki. CTS uses your LLM to synthesize it into structured wiki pages.
```bash
curl -X POST https://cts-v4-production.up.railway.app/api/llm-wiki/ingest-source \
  -H "Authorization: Bearer cts_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "source": {
      "title": "Stripe Webhook Troubleshooting Guide",
      "content": "Stripe webhooks must be verified using the signing secret... [full content]"
    },
    "live": {
      "provider": "openrouter",
      "apiKey": "sk-or-v1-your-key",
      "model": "google/gemini-2.0-flash-001"
    }
  }'
```
If `live` is omitted, CTS uses a fast template-based fallback (no LLM cost).

### `POST /api/llm-wiki/lint`
Check the LLM Wiki for broken links or missing source references.
```bash
curl -X POST https://cts-v4-production.up.railway.app/api/llm-wiki/lint \
  -H "Authorization: Bearer cts_your_key"
# {"issues": ["Wiki lint passed: no obvious broken links or source gaps."]}
```

### `DELETE /api/wiki`
Wipe both wikis for the authenticated user. Use for testing or user data deletion requests.
```bash
curl -X DELETE https://cts-v4-production.up.railway.app/api/wiki \
  -H "Authorization: Bearer cts_your_key"
```

---

## Full Chat Endpoint (Memory Auto-Managed)

### `POST /api/chat`
The most powerful endpoint. Runs classify + compress + wiki lookup + LLM call in one request. Memory is updated automatically at session close (state = `closing` or `resolving`).

```bash
curl -X POST https://cts-v4-production.up.railway.app/api/chat \
  -H "Authorization: Bearer cts_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "Why does my Stripe webhook keep failing?",
    "history": [...],
    "live": {
      "provider": "openrouter",
      "apiKey": "sk-or-v1-your-key",
      "model": "google/gemini-2.0-flash-001"
    }
  }'
```

What CTS does under the hood:
1. Classifies the message (domain=coding, intent=debugging)
2. Looks up the User Wiki — finds `current_work: Next.js app with Stripe`
3. Searches the LLM Wiki — finds the Stripe webhook page you ingested
4. Compresses eligible history and records a context plan; protected context stays verbatim
5. Builds system prompt: coding domain prompt + user context + Stripe wiki page
6. Calls your LLM with everything
7. If conversation is closing/resolving, auto-saves a memory frame to the LLM Wiki

Response:
```json
{
  "result": {
    "reply": "The most common cause of Stripe webhook failures is...",
    "frame": {"domain": "coding", "intent": "debugging", ...},
    "compression": {"tokensSaved": 312, "compressed": [...]}
  },
  "userWiki": {...},
  "llmWiki": {...}
}
```

---

## Memory Integration Pattern (Full Example)

```javascript
// chatbot-with-memory.js

const CTS_KEY = 'cts_your_key'
const LLM_KEY = 'sk-or-v1-your-openrouter-key'
const BASE = 'https://cts-v4-production.up.railway.app'

let history = []

async function chat(userMessage) {
  // Single call — CTS handles routing + memory + LLM
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CTS_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      message: userMessage,
      history,
      live: {
        provider: 'openrouter',
        apiKey: LLM_KEY,
        model: 'google/gemini-2.0-flash-001'
      }
    })
  })

  const { result } = await res.json()

  // Update local history
  history.push({ role: 'user', content: userMessage })
  history.push({ role: 'assistant', content: result.reply })

  return result.reply
}

// To add knowledge to the LLM Wiki (e.g. when onboarding a new user):
async function learnDocument(title, content) {
  await fetch(`${BASE}/api/llm-wiki/ingest-source`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CTS_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      source: { title, content },
      live: { provider: 'openrouter', apiKey: LLM_KEY, model: 'google/gemini-2.0-flash-001' }
    })
  })
}
```

---

## Project Structure

```
can-you-build-anything/
├── src/
│   ├── server.ts          # Main HTTP server (all API endpoints)
│   ├── styles.css         # YUDI-inspired dark space UI
│   ├── main.ts            # Frontend JS (live demo chatbot)
│   ├── cts-core/          # Core engine (classifier, compressor, router)
│   │   ├── classifier.ts
│   │   ├── compressor.ts
│   │   ├── router.ts
│   │   ├── signals.ts
│   │   ├── wiki.ts
│   │   └── types.ts
│   └── saas/
│       ├── auth.ts        # Bearer token auth + rate limiting
│       └── db.ts          # JSON file store (keys, usage)
├── index.html             # Product landing page + live demo
├── railway.toml           # Railway deployment config
├── vite.config.ts         # Dev server + LLM proxy
├── data/                  # Runtime data (gitignored)
│   ├── keys.json          # API keys (hashed)
│   ├── usage.json         # Usage logs
│   └── key-requests.json  # Access requests from the website
└── dist/                  # Built frontend (gitignored)
```

---

## Local Development

### Prerequisites
- Node.js 18+
- Two terminal windows

### Step 1 — Install dependencies
```bash
npm install
```

### Step 2 — Create .env file
```bash
# .env (already gitignored — never commit this)
DEMO_LLM_API_KEY=your-openrouter-key-here
DEMO_LLM_MODEL=google/gemini-2.0-flash-001
CTS_ADMIN_SECRET=your-admin-password-here
```

### Step 3 — Start the API server (Terminal 1)
```bash
npm run api
# → CTS API listening on http://0.0.0.0:8787
```

### Step 4 — Start the frontend (Terminal 2)
```bash
npm run dev
# → http://127.0.0.1:5173
```

Open **http://127.0.0.1:5173** — the full product website with live demo.

---

## Deployment to Railway

### One-time Setup

1. Install Railway CLI: `npm install -g @railway/cli`
2. Login: `railway login`
3. Link project: `railway link --project remarkable-empathy`

### Set Environment Variables (Railway Dashboard or CLI)

```bash
railway variables set CTS_ADMIN_SECRET=your-strong-secret-here
railway variables set DEMO_LLM_API_KEY=sk-or-v1-your-key-here
railway variables set DEMO_LLM_MODEL=google/gemini-2.0-flash-001
```

### IMPORTANT — Fix Railway Port (One-time manual step)

Railway requires you to expose the port in the dashboard:

1. Go to **railway.com** → your project → **cts-v4 service**
2. Click **Settings** tab
3. Under **Networking** → click **Generate Domain** (if not already done)
4. Under **Networking** → set **Port** to `8080`
5. Save — Railway will redeploy automatically

After this, `https://cts-v4-production.up.railway.app` will be live.

### Deploy Latest Code

```bash
git add .
git commit -m "your message"
git push origin master
# Railway auto-deploys from GitHub push
```

Or force deploy directly:
```bash
railway up --detach
```

### Check Deployment

```bash
railway logs              # View server logs
railway deployment list   # List recent deployments
curl https://cts-v4-production.up.railway.app/health  # Test live URL
```

---

## API Endpoints

### Base URL
- **Local**: `http://127.0.0.1:8787`
- **Production**: `https://cts-v4-production.up.railway.app`

---

### Public Endpoints (No Auth Required)

#### `GET /health`
Returns server status.
```bash
curl https://cts-v4-production.up.railway.app/health
# {"ok":true,"service":"cts-api","version":"0.4.0"}
```

#### `POST /demo/compress`
Public routing-only endpoint. Rate limited to 20 req/min per IP.
```bash
curl -X POST https://cts-v4-production.up.railway.app/demo/compress \
  -H "Content-Type: application/json" \
  -d '{"message":"My Python code throws a TypeError","history":[]}'
```
Response:
```json
{
  "compressedHistory": [...],
  "intent": "task_execution",
  "domain": "coding",
  "state": "opening",
  "tokensSaved": 0,
  "frame": {
    "confidence": {"intent": 0.73, "domain": 0.88, "state": 0.9},
    "risk": []
  }
}
```

#### `POST /demo/chat`
Public live demo — runs CTS routing + calls the configured LLM. Rate limited to 20 req/min per IP.
```bash
curl -X POST https://cts-v4-production.up.railway.app/demo/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Explain neural networks","history":[]}'
```
Response includes `reply` (real LLM response) plus all routing fields above.

#### `POST /demo/request-key`
Saves an API key request to `data/key-requests.json`.
```bash
curl -X POST https://cts-v4-production.up.railway.app/demo/request-key \
  -H "Content-Type: application/json" \
  -d '{"name":"John","email":"john@co.com","useCase":"customer support bot"}'
```

---

### Authenticated Endpoints (Require API Key)

All authenticated endpoints require:
```
Authorization: Bearer cts_your_api_key_here
```

#### `POST /compress`
The core CTS endpoint. Use this in your chatbot.
```bash
curl -X POST https://cts-v4-production.up.railway.app/compress \
  -H "Authorization: Bearer cts_your_key" \
  -H "Content-Type: application/json" \
  -d '{
    "message": "How do I fix this bug?",
    "history": [
      {"role": "user", "content": "I have a Python script"},
      {"role": "assistant", "content": "Sure, what is it doing?"}
    ]
  }'
```
Response:
```json
{
  "compressedHistory": [...],
  "intent": "debugging",
  "domain": "coding",
  "state": "deepening",
  "tokensSaved": 47,
  "memoryFrame": null
}
```

#### `GET /api/usage`
Returns usage stats for the authenticated key.
```bash
curl https://cts-v4-production.up.railway.app/api/usage \
  -H "Authorization: Bearer cts_your_key"
# {"totalCalls":142,"totalTokensSaved":8820,"last24hCalls":23}
```

---

### Admin Endpoints (Require Admin Secret)

All admin endpoints require:
```
X-Admin-Secret: your-admin-secret
```

#### `POST /admin/keys` — Create a new API key
```bash
curl -X POST https://cts-v4-production.up.railway.app/admin/keys \
  -H "X-Admin-Secret: your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Acme Corp","ownerEmail":"dev@acme.com"}'
```
Response:
```json
{
  "id": "key_a1b2c3d4e5f6g7h8",
  "key": "cts_abc123...48hexchars",
  "note": "Save this key now — it will not be shown again."
}
```
**The raw key is shown only once.** Copy it and send it to the user.

#### `GET /admin/dashboard` — View all keys + usage
```bash
curl https://cts-v4-production.up.railway.app/admin/dashboard \
  -H "X-Admin-Secret: your-admin-secret"
```
Returns array of all keys with `totalCalls`, `totalTokensSaved`, `last24hCalls`.

#### `GET /admin/keys/:id/usage` — Usage detail for one key
```bash
curl https://cts-v4-production.up.railway.app/admin/keys/key_abc123/usage \
  -H "X-Admin-Secret: your-admin-secret"
```

#### `DELETE /admin/keys/:id` — Revoke a key
```bash
curl -X DELETE https://cts-v4-production.up.railway.app/admin/keys/key_abc123 \
  -H "X-Admin-Secret: your-admin-secret"
```

---

## How to Give API Keys to Users

### Step 1 — Check pending requests
Users fill out the form on the website. View requests at:
```bash
# On Railway, check the data/ directory via logs or SSH
# Locally:
cat data/key-requests.json
```

### Step 2 — Create their key
```bash
curl -X POST https://cts-v4-production.up.railway.app/admin/keys \
  -H "X-Admin-Secret: your-admin-secret" \
  -H "Content-Type: application/json" \
  -d '{"name":"Their Name or Company","ownerEmail":"their@email.com"}'
```

### Step 3 — Send them the key
Copy the `key` field from the response (e.g. `cts_abc123...`) and email it to them. **Do not store it — it's hashed in the database.**

### Step 4 — Give them this quick-start snippet
```javascript
// Drop this before every LLM call

const cts = await fetch('https://cts-v4-production.up.railway.app/compress', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer cts_their_key_here',
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message, history })
})

const { compressedHistory, intent, domain, tokensSaved } = await cts.json()

// Then call your LLM with compressedHistory instead of history
// Use intent + domain to pick the right system prompt
```

### Step 5 — Monitor usage
```bash
curl https://cts-v4-production.up.railway.app/admin/dashboard \
  -H "X-Admin-Secret: your-admin-secret"
```

### Step 6 — Revoke if needed
```bash
curl -X DELETE https://cts-v4-production.up.railway.app/admin/keys/KEY_ID \
  -H "X-Admin-Secret: your-admin-secret"
```

---

## Integration Example (Full Chatbot)

```javascript
// chatbot.js — complete example with CTS

const CTS_KEY = 'cts_your_key'
const CTS_URL = 'https://cts-v4-production.up.railway.app/compress'

let history = []

async function chat(userMessage) {
  // Step 1: Run CTS
  const ctsRes = await fetch(CTS_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${CTS_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ message: userMessage, history })
  })
  const { compressedHistory, domain, intent, tokensSaved } = await ctsRes.json()

  console.log(`Domain: ${domain} | Intent: ${intent} | Tokens saved: ${tokensSaved}`)

  // Step 2: Pick system prompt based on domain
  const systemPrompts = {
    coding: 'You are a senior software engineer. Be direct and technical.',
    medical: 'You are a medical information assistant. Always recommend seeing a doctor.',
    legal: 'You are a legal information assistant. This is not legal advice.',
    customer_support: 'You are a helpful support agent. Resolve issues quickly.',
    general: 'You are a helpful assistant.'
  }
  const systemPrompt = systemPrompts[domain] ?? systemPrompts.general

  // Step 3: Call your LLM with COMPRESSED history (not full history)
  const llmRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        ...compressedHistory,
        { role: 'user', content: userMessage }
      ]
    })
  })
  const llmData = await llmRes.json()
  const reply = llmData.choices[0].message.content

  // Step 4: Update history with FULL message (CTS compresses on next turn)
  history.push({ role: 'user', content: userMessage })
  history.push({ role: 'assistant', content: reply })

  return reply
}
```

---

## Rate Limits

| Endpoint | Limit |
|---|---|
| `/demo/compress`, `/demo/chat` | 20 req/min per IP |
| All `/compress`, `/api/*` | 60 req/min per API key |
| Admin endpoints | Unlimited (protected by secret) |

---

## Environment Variables Reference

| Variable | Required | Description |
|---|---|---|
| `PORT` | Auto (Railway) | Port to listen on. Do NOT set manually on Railway — injected automatically |
| `CTS_ADMIN_SECRET` | Yes | Password for `/admin/*` endpoints |
| `DEMO_LLM_API_KEY` | Yes (for live demo) | OpenRouter key for the public demo chatbot |
| `DEMO_LLM_MODEL` | No | Model to use for demo (default: `google/gemini-2.0-flash-001`) |
| `CTS_HOST` | No | Bind address (default: `0.0.0.0`) |
| `CTS_CORS_ORIGIN` | No | CORS origin (default: `*`) |

---

## Current Admin Credentials

| Setting | Value |
|---|---|
| Admin Secret | `your-admin-secret` |
| Railway URL | `https://cts-v4-production.up.railway.app` |
| GitHub Repo | `github.com/ashy5454/cts-v4` (private) |

> Change `CTS_ADMIN_SECRET` in Railway variables before going fully public.

---

## Troubleshooting

**Railway shows 502**
→ Go to Railway dashboard → cts-v4 service → Settings → Networking → set Port to `8080`

**Demo chat not responding locally**
→ Make sure BOTH servers are running: `npm run api` (port 8787) AND `npm run dev` (port 5173)

**"Demo LLM not configured" error**
→ Add `DEMO_LLM_API_KEY` to your `.env` file (local) or Railway variables (production)

**Invalid API key error**
→ Key must start with `cts_`. Create one via `POST /admin/keys`

**Rate limit hit**
→ Wait 60 seconds. Demo endpoints: 20/min. API keys: 60/min.

**Tokens saved = 0**
→ Normal for the first message. Compression activates from the 2nd turn onwards.
