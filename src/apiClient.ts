import type { CTSResult, CustomDomainPlugin, LLMWiki, Message, RoutingFrame, SourceInput, WikiDocument } from './cts-core/index.js'
import type { LiveLLMConfig } from './llmClient.js'

const API_BASE = 'http://127.0.0.1:8787'

export interface ChatRequest {
  userId: string
  message: string
  history: Message[]
  customDomainPlugins: CustomDomainPlugin[]
  live?: LiveLLMConfig
}

export interface ChatResponse {
  result: CTSResult
  userWiki: WikiDocument | null
  llmWiki: LLMWiki | null
}

export async function apiChat(request: ChatRequest): Promise<ChatResponse> {
  return postJson('/api/chat', request)
}

export async function apiClassify(message: string, history: Message[], customDomainPlugins: CustomDomainPlugin[] = []): Promise<RoutingFrame> {
  return postJson('/api/classify', { message, history, customDomainPlugins })
}

export async function apiGetWiki(userId: string): Promise<{ userWiki: WikiDocument | null; llmWiki: LLMWiki | null }> {
  return getJson(`/api/wiki?userId=${encodeURIComponent(userId)}`)
}

export async function apiDeleteWiki(userId: string): Promise<void> {
  await deleteJson(`/api/wiki?userId=${encodeURIComponent(userId)}`)
}

export async function apiIngestChat(userId: string, session: Message[], frame: RoutingFrame): Promise<WikiDocument> {
  return postJson('/api/wiki/ingest-chat', { userId, session, frame })
}

export async function apiIngestSource(userId: string, source: SourceInput, frame: RoutingFrame | null): Promise<LLMWiki> {
  return postJson('/api/llm-wiki/ingest-source', { userId, source, frame })
}

export async function apiLintLLMWiki(userId: string): Promise<{ issues: string[] }> {
  return postJson('/api/llm-wiki/lint', { userId })
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`)
  return readResponse(response)
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  return readResponse(response)
}

async function deleteJson(path: string): Promise<void> {
  const response = await fetch(`${API_BASE}${path}`, { method: 'DELETE' })
  await readResponse(response)
}

async function readResponse<T>(response: Response): Promise<T> {
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(payload.error || `API returned HTTP ${response.status}`)
  return payload as T
}

