/**
 * embeddings.ts
 * -------------
 * Real semantic-similarity scoring via Gemini's embedding API
 * (models/gemini-embedding-001, native :embedContent endpoint — not the
 * OpenAI-compat surface used elsewhere in this repo, which does not expose
 * embeddings). Used by compressHistoryWithEmbeddings() in compressor.ts as
 * an alternative to the hardcoded domain-keyword regex scorer: instead of
 * "does this message match a hand-tuned vocabulary list for this domain",
 * it asks "how semantically close is this message to the current query."
 *
 * Requires a real Gemini API key, passed in per-call — never hardcoded or
 * persisted here.
 */

const EMBED_MODEL = 'models/gemini-embedding-001'
const EMBED_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/${EMBED_MODEL}:embedContent`
// Embedding models cap input length; this is a safe truncation point, same
// spirit as the T5 path's 300/1500-char slices elsewhere in this codebase.
const MAX_EMBED_CHARS = 2000

export type EmbedTaskType = 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'

export async function embedText(text: string, apiKey: string, taskType: EmbedTaskType): Promise<number[]> {
  const response = await fetch(EMBED_ENDPOINT, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: EMBED_MODEL,
      content: { parts: [{ text: text.slice(0, MAX_EMBED_CHARS) }] },
      taskType,
    }),
  })
  const payload = await response.json() as { embedding?: { values?: number[] }; error?: unknown }
  if (!response.ok) throw new Error(`Gemini embedding error ${response.status}: ${JSON.stringify(payload.error ?? payload)}`)
  return payload.embedding?.values ?? []
}

// The batch embedding endpoint (batchEmbedContents) isn't supported for this
// model in this API version — only single embedContent calls are. This runs
// them concurrently (bounded pool) instead of one giant sequential loop.
export async function embedBatch(texts: string[], apiKey: string, taskType: EmbedTaskType, concurrency = 8): Promise<number[][]> {
  const results: number[][] = new Array(texts.length)
  let cursor = 0

  async function worker(): Promise<void> {
    while (cursor < texts.length) {
      const i = cursor++
      results[i] = await embedText(texts[i], apiKey, taskType)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, texts.length) }, () => worker()))
  return results
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  if (normA === 0 || normB === 0) return 0
  return dot / (Math.sqrt(normA) * Math.sqrt(normB))
}
