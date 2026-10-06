import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ContextPlan, RoutingFrame } from '../cts-core/types.js'
import { getDb } from './database.js'

export interface ContextTrace {
  id: string
  keyId: string
  endpoint: string
  createdAt: string
  frame: Pick<RoutingFrame, 'domain' | 'intent' | 'state' | 'risk'>
  plan: ContextPlan
  originalTokens: number
  compressedTokens: number
  tokensSaved: number
  processingMs?: number
}

const tracePath = join(process.cwd(), 'data', 'context-traces.json')
const MAX_LOCAL_TRACES = 10_000

/** The trace intentionally excludes prompt text, provider keys, and user content. */
export async function recordContextTrace(trace: ContextTrace): Promise<void> {
  const db = getDb()
  if (db) {
    await db.query(
      'INSERT INTO context_traces (key_id, endpoint, trace) VALUES ($1, $2, $3)',
      [trace.keyId, trace.endpoint, JSON.stringify(trace)],
    )
    return
  }

  const traces = await loadLocalTraces()
  traces.push(trace)
  if (traces.length > MAX_LOCAL_TRACES) traces.splice(0, traces.length - MAX_LOCAL_TRACES)
  await mkdir(dirname(tracePath), { recursive: true })
  await writeFile(tracePath, JSON.stringify(traces, null, 2), 'utf-8')
}

export async function listContextTraces(keyId: string, limit = 100): Promise<ContextTrace[]> {
  const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)))
  const db = getDb()
  if (db) {
    const { rows } = await db.query<{ trace: ContextTrace }>(
      'SELECT trace FROM context_traces WHERE key_id = $1 ORDER BY created_at DESC LIMIT $2',
      [keyId, safeLimit],
    )
    return rows.map((row) => row.trace)
  }
  return (await loadLocalTraces())
    .filter((trace) => trace.keyId === keyId)
    .slice(-safeLimit)
    .reverse()
}

async function loadLocalTraces(): Promise<ContextTrace[]> {
  try {
    return JSON.parse(await readFile(tracePath, 'utf-8')) as ContextTrace[]
  } catch {
    return []
  }
}
