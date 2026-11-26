# EchoRegent Multi-Cloud & Container Try-Out Guide

Deploy and test EchoRegent in 60 seconds across **GitHub Codespaces**, **Docker Compose**, **GCP Cloud Run / Compute Engine**, **Fly.io**, and **Render**.

EchoRegent operates as a transparent local context middleware and proxy that compacts repetitive tool outputs, logs, and compiler errors in `<2 ms`, while persisting cross-session LLM-wiki memory with source citations.

---

## 1. Architectural Security Model & Container Networking

EchoRegent's proxy server (`packages/cli/src/proxy.ts`) implements strict IPv4 loopback isolation:
1. **Loopback Binding (`127.0.0.1`)**: By design, the Node.js HTTP server binds exclusively to `127.0.0.1` so that untrusted network interfaces and external LANs cannot access your AI proxy.
2. **Browser Origin Rejection**: Requests presenting browser headers (`Origin` or `Sec-Fetch-Site != none`) are rejected with `403 Forbidden` to prevent browser-based Cross-Site Request Forgery (CSRF) or cross-origin scanning.
3. **Optional Secret Token (`x-echoregent-local-token`)**: When `ECHOREGENT_LOCAL_TOKEN` is configured, incoming requests must present matching credentials.

### Deployment Patterns: Sidecar vs. Cloud Ingress

Depending on your architecture, choose between two deployment patterns:

| Pattern | Network Topology | Best For | Ingress Setup |
| :--- | :--- | :--- | :--- |
| **Pattern A: Local Loopback / Sidecar** | Proxy and agent share `127.0.0.1` | Local machine, VS Code Dev Containers, Kubernetes Pod sidecar | `BIND_ADDRESS=127.0.0.1`<br>(Zero external exposure) |
| **Pattern B: Cloud Ingress Bridge** | External traffic forwarded to loopback | Docker Compose, GCP Cloud Run, Fly.io, Render | `BIND_ADDRESS=0.0.0.0`<br>(Docker image uses internal `socat` bridge `0.0.0.0:$PORT -> 127.0.0.1:$INTERNAL_PORT` + `ECHOREGENT_LOCAL_TOKEN`) |
| **Pattern C: SSH Port Forwarding** | Remote VM bound to `127.0.0.1`, tunneled | GCP Compute Engine, AWS EC2, remote developer box | `ssh -N -L 8787:127.0.0.1:8787 user@vm-ip` |

---

## 2. (a) 1-Click GitHub Codespaces & VS Code Dev Containers

Try EchoRegent directly in your browser without installing Node.js or Docker locally.

[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://github.com/codespaces/new?hide_repo_select=true&ref=main&repo=ashy5454/echoregent)

### How It Works:
1. Click the badge above (or navigate to `https://github.com/ashy5454/echoregent` and click **Code > Codespaces > Create codespace on main**).
2. The dev container specification in `.devcontainer/devcontainer.json` automatically:
   - Boots a Node.js 22 container.
   - Executes `npm ci && npm run build:packages && npm run verify:all` in `postCreateCommand`.
   - Pre-configures port forwarding for port `8787`.
3. Open a terminal inside Codespaces and start the proxy:
   ```bash
   node packages/cli/dist/index.js proxy \
     --compact-history \
     --inject-memory \
     --adaptive-compression \
     --auto-memory \
     --project-memory
   ```
4. Verify proxy health in a second terminal:
   ```bash
   curl -s http://127.0.0.1:8787/health | jq
   ```

---

## 3. (b) Local or Cloud VM via Docker Compose

Run EchoRegent locally or on any cloud virtual machine with a single command.

### Step 1: Clone and Start
```bash
git clone https://github.com/ashy5454/echoregent.git
cd echoregent

# Launch EchoRegent proxy container in the background
docker compose up -d
```

### Step 2: Check Logs and Health
```bash
# View startup logs
docker compose logs -f

# Verify loopback health probe
curl -s http://127.0.0.1:8787/health | jq
```

Expected output:
```json
{
  "product": "echoregent",
  "version": "0.4.0",
  "mode": "deterministic",
  "telemetry": false,
  "models": [],
  "stats": {
    "requests": 0,
    "compressed": 0,
    "protected": 0,
    "errors": 0
  }
}
```

### Step 3: Persistent Memory Inspection
EchoRegent persists cross-session LLM-wiki memory and learned adaptive compression models to the Docker named volume `echoregent-memory-data` (`/data/.echoregent/memory`).

To inspect stored memories on disk:
```bash
docker compose exec echoregent ls -la /data/.echoregent/memory
```

### Sidecar Pattern for Coding Agents (Docker Compose)
If running a containerized coding agent (e.g. OpenAI Codex, Claude Code, or an autonomous agent), attach your agent container directly to the EchoRegent network namespace:

```yaml
version: '3.8'

services:
  echoregent:
    build: .
    environment:
      - BIND_ADDRESS=127.0.0.1
      - PORT=8787
      - ENABLE_FILE_MEMORY=true

  coding-agent:
    image: my-coding-agent:latest
    network_mode: "service:echoregent" # Shares localhost:8787 with EchoRegent
    environment:
      - OPENAI_BASE_URL=http://127.0.0.1:8787/v1
```

---

## 4. (c) Google Cloud Platform (Cloud Run & Compute Engine)

### Option 1: GCP Cloud Run (Serverless Container)

GCP Cloud Run provides serverless container execution with auto-scaling to zero.

#### 1. Build and Submit Container Image
```bash
export PROJECT_ID=$(gcloud config get-value project)
gcloud builds submit --tag gcr.io/${PROJECT_ID}/echoregent-proxy:0.4.0
```

#### 2. Deploy to Cloud Run
```bash
gcloud run deploy echoregent-proxy \
  --image gcr.io/${PROJECT_ID}/echoregent-proxy:0.4.0 \
  --platform managed \
  --region us-central1 \
  --port 8787 \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars "BIND_ADDRESS=0.0.0.0,PORT=8787,INTERNAL_PORT=8788,ECHOREGENT_UPSTREAM=https://api.openai.com/v1" \
  --set-env-vars "ECHOREGENT_LOCAL_TOKEN=$(openssl rand -hex 16)" \
  --allow-unauthenticated
```

#### 3. Test Endpoint
```bash
export CLOUD_RUN_URL=$(gcloud run services describe echoregent-proxy --format 'value(status.url)' --region us-central1)

curl -s -H "x-echoregent-local-token: YOUR_SECRET_TOKEN" "${CLOUD_RUN_URL}/health" | jq
```

---

### Option 2: GCP Compute Engine (VM with SSH Port Forwarding)

For dedicated VM development, keep EchoRegent isolated to `127.0.0.1` and tunnel traffic securely over SSH.

#### 1. Launch VM and Start Container
```bash
# On your VM:
git clone https://github.com/ashy5454/echoregent.git
cd echoregent
docker compose up -d
```

#### 2. Establish SSH Tunnel from Your Local Laptop
```bash
# Tunnel remote VM's 127.0.0.1:8787 to local laptop's 127.0.0.1:8787
gcloud compute ssh my-dev-vm -- -N -L 8787:127.0.0.1:8787
# Or standard SSH:
# ssh -N -L 8787:127.0.0.1:8787 user@vm-ip
```

Now any local CLI (`codex`, `claude`, or OpenAI SDK) talks to `http://127.0.0.1:8787` seamlessly and securely with zero public firewall holes.

---

## 5. (d) Fly.io & Render

### Fly.io Deployment

The repository includes a ready-to-deploy `fly.toml` configuration with persistent volume mounts.

```bash
# 1. Initialize Fly application (do not deploy yet)
fly launch --no-deploy

# 2. Create 1GB NVMe persistent volume for wiki memory in your chosen region
fly volumes create echoregent_memory --region iad --size 1

# 3. Configure secrets (upstream provider key and local authentication token)
fly secrets set \
  OPENAI_API_KEY="sk-..." \
  ECHOREGENT_LOCAL_TOKEN="$(openssl rand -hex 16)"

# 4. Deploy container
fly deploy

# 5. Verify live deployment
curl -s -H "x-echoregent-local-token: <your-token>" https://echoregent-proxy.fly.dev/health | jq
```

---

### Render Deployment

The repository includes a `render.yaml` Blueprint specification.

1. Fork or push this repository to your GitHub account (`https://github.com/ashy5454/echoregent`).
2. Log into the [Render Dashboard](https://dashboard.render.com).
3. Click **New +** > **Blueprint**.
4. Connect your `echoregent` repository.
5. Render detects `render.yaml` and provisions:
   - Web Service running Docker (`Dockerfile`).
   - 1GB Persistent SSD mounted at `/data/.echoregent/memory`.
   - Auto-generated secret token for `ECHOREGENT_LOCAL_TOKEN`.
6. Supply `OPENAI_API_KEY` when prompted and click **Apply**.

---

## 6. (e) 60-Second Direct Verification Guide

Once EchoRegent is running on `http://127.0.0.1:8787` (locally, via Docker, or forwarded), test each capability directly.

### 1. Health Probe
```bash
curl -s http://127.0.0.1:8787/health | jq
```

Expected response:
```json
{
  "product": "echoregent",
  "version": "0.4.0",
  "mode": "deterministic",
  "telemetry": false,
  "models": [],
  "stats": { "requests": 0, "compressed": 0, "protected": 0, "errors": 0 }
}
```

---

### 2. Standalone Compression Endpoint (`POST /compress`)
Test EchoRegent's deterministic log compactor on repetitive tool outputs:

```bash
curl -s -X POST http://127.0.0.1:8787/compress \
  -H "content-type: application/json" \
  -d '{
    "text": "npm ERR! code ERESOLVE\nnpm ERR! ERESOLVE unable to resolve dependency tree\nnpm ERR!\nnpm ERR! While resolving: test-app@1.0.0\nnpm ERR! Found: react@18.2.0\nnpm ERR! node_modules/react\nnpm ERR!   react@\"^18.2.0\" from the root project\nnpm ERR!\nnpm ERR! Could not resolve dependency:\nnpm ERR! peer react@\"^17.0.0\" from legacy-lib@1.0.0\nnpm ERR! node_modules/legacy-lib\nnpm ERR!   legacy-lib@\"*\" from the root project"
  }' | jq
```

Returns compacted text and byte savings in `<2 ms` without making any upstream LLM calls.

---

### 3. Continual Memory Ingestion & Recall (`POST /memory/*`)

Store an architecture fact:
```bash
curl -s -X POST http://127.0.0.1:8787/memory/remember \
  -H "content-type: application/json" \
  -d '{
    "scope": { "project": "ecommerce-api", "session": "session-101" },
    "fact": "The database uses PostgreSQL on port 5433 instead of the default 5432.",
    "context": "src/config/database.ts line 14"
  }' | jq
```

Recall the fact with source citations:
```bash
curl -s -X POST http://127.0.0.1:8787/memory/recall \
  -H "content-type: application/json" \
  -d '{
    "scope": { "project": "ecommerce-api", "session": "session-101" },
    "query": "Which port does postgres connect to?"
  }' | jq
```

Response includes source citations and confidence scores:
```json
{
  "items": [
    {
      "id": "...",
      "fact": "The database uses PostgreSQL on port 5433 instead of the default 5432.",
      "context": "src/config/database.ts line 14",
      "score": 0.88
    }
  ]
}
```

---

### 4. OpenAI SDK Integration (Python & TypeScript)

EchoRegent serves as a transparent drop-in replacement for `https://api.openai.com/v1`. Point `baseURL` at the proxy:

#### Python:
```python
import os
from openai import OpenAI

# If ECHOREGENT_LOCAL_TOKEN is enabled, pass it in default_headers
default_headers = {}
if os.environ.get("ECHOREGENT_LOCAL_TOKEN"):
    default_headers["x-echoregent-local-token"] = os.environ["ECHOREGENT_LOCAL_TOKEN"]

client = OpenAI(
    base_url="http://127.0.0.1:8787/v1",
    api_key=os.environ.get("OPENAI_API_KEY", "dummy-key"),
    default_headers=default_headers,
)

response = client.chat.completions.create(
    model="gpt-4o-mini",
    messages=[
        {"role": "system", "content": "You are a concise engineering assistant."},
        {"role": "user", "content": "Explain deterministic compression in 1 sentence."}
    ],
)

print(response.choices[0].message.content)
```

#### TypeScript / Node.js:
```typescript
import OpenAI from 'openai'

const client = new OpenAI({
  baseURL: 'http://127.0.0.1:8787/v1',
  apiKey: process.env.OPENAI_API_KEY || 'dummy-key',
  defaultHeaders: process.env.ECHOREGENT_LOCAL_TOKEN
    ? { 'x-echoregent-local-token': process.env.ECHOREGENT_LOCAL_TOKEN }
    : {},
})

const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [{ role: 'user', content: 'Ping' }],
})

console.log(response.choices[0].message.content)
```

---

### 5. Anthropic SDK & Claude Code Integration

EchoRegent proxies the Anthropic Messages API (`POST /v1/messages`) with automatic `tool_result` compaction and `system` memory injection.

#### Python Anthropic SDK:
```python
import os
import anthropic

client = anthropic.Anthropic(
    base_url="http://127.0.0.1:8787",
    api_key=os.environ.get("ANTHROPIC_API_KEY"),
)

message = client.messages.create(
    model="claude-3-5-sonnet-20241022",
    max_tokens=256,
    messages=[{"role": "user", "content": "Hello!"}],
)

print(message.content[0].text)
```

#### Claude Code CLI:
Route Claude Code through EchoRegent by setting `ANTHROPIC_BASE_URL`:
```bash
export ANTHROPIC_BASE_URL="http://127.0.0.1:8787"
claude
```

---

## 7. Security Best Practices Summary

1. **Keep Private by Default**: Always use `127.0.0.1` binding and SSH tunnels when hosting on remote virtual machines.
2. **Mandate Authentication for Public Ingress**: If hosting on Cloud Run, Fly.io, or Render, always generate and set a strong `ECHOREGENT_LOCAL_TOKEN`.
3. **Persist the Memory Directory**: Always mount a persistent volume at `/data/.echoregent/memory` (Docker, Fly.io, or Render disk) so your continual LLM-wiki memory and adaptive model weights persist across restarts.
