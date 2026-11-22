/**
 * Three-arm real LoCoMo evaluation: baseline (full transcript) vs. the
 * shipped rule-based compressor (compressHistory, hardcoded domain-keyword
 * regex + minimum-retention floor) vs. the new embedding-based compressor
 * (compressHistoryWithEmbeddings, real Gemini semantic-similarity scoring —
 * see src/cts-core/embeddings.ts). Same 2-conversation / 60-question slice,
 * same scoring, same live gemini-3.8-flash calls, as the retention-floor
 * verification run this replaces/extends.
 *
 * Compression (both compressed arms) runs ONCE per conversation, on the
 * full transcript (transcript's own last message treated as "the current
 * turn," matching how a customer would call /compress before asking
 * questions) — then the SAME compressed context is reused for all 30
 * questions per conversation, for both compressed arms, for a fair
 * apples-to-apples comparison against the same baseline.
 */
import { readFileSync } from 'node:fs'
import { classify } from '../../src/cts-core/classifier'
import { compressHistory, compressHistoryWithEmbeddings } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

const GEMINI_KEY = process.env.GEMINI_TEST_KEY
if (!GEMINI_KEY) { console.error('Set GEMINI_TEST_KEY env var.'); process.exit(1) }
const MODEL = 'gemini-3.8-flash'
const QUESTIONS_PER_CONVO = 30
const CONVOS_TO_USE = 2

interface LocomoTurn { speaker: string; dia_id: string; text: string }
interface LocomoQA { question: string; answer: string | number; evidence?: string[]; category?: number }
interface LocomoConvo {
  sample_id: string
  qa: LocomoQA[]
  conversation: Record<string, LocomoTurn[] | string> & { speaker_a: string; speaker_b: string }
}

const raw = JSON.parse(readFileSync(new URL('./locomo/locomo10.json', import.meta.url), 'utf-8')) as LocomoConvo[]

function buildTranscript(convo: LocomoConvo): Message[] {
  const speakerA = convo.conversation.speaker_a
  const sessionKeys = Object.keys(convo.conversation)
    .filter((k) => /^session_\d+$/.test(k))
    .sort((a, b) => Number(a.split('_')[1]) - Number(b.split('_')[1]))
  const messages: Message[] = []
  for (const key of sessionKeys) {
    const turns = convo.conversation[key] as LocomoTurn[]
    for (const turn of turns) {
      messages.push({ role: turn.speaker === speakerA ? 'user' : 'assistant', content: `${turn.speaker}: ${turn.text}` })
    }
  }
  return messages
}

const INSTRUCTION = 'You will be shown a conversation transcript, then a question about it. Answer with ONLY the short, direct answer (a name, date, or short phrase) based on the transcript — no extra commentary, no full sentences unless the question requires one.'

async function askGemini(context: Message[], question: string): Promise<{ answer: string; totalTokens: number }> {
  const messages = [
    { role: 'user', content: `${INSTRUCTION}\n\n--- TRANSCRIPT ---\n${context.map((m) => m.content).join('\n')}\n--- END TRANSCRIPT ---\n\nQuestion: ${question}` },
  ]
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${GEMINI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages }),
  })
  const payload = await response.json() as { choices?: Array<{ message: { content: string } }>; usage?: { total_tokens?: number }; error?: unknown }
  if (!response.ok) throw new Error(`Gemini error ${response.status}: ${JSON.stringify(payload.error ?? payload)}`)
  return { answer: payload.choices?.[0]?.message?.content?.trim() ?? '', totalTokens: payload.usage?.total_tokens ?? 0 }
}

function normalize(text: string): string[] {
  return String(text)
    .toLowerCase()
    .replace(/[.,!?;:'"()]/g, ' ')
    .split(/\s+/)
    .filter((t) => t && !['a', 'an', 'the'].includes(t))
}

function f1Score(prediction: string, groundTruth: string): number {
  const predTokens = normalize(prediction)
  const truthTokens = normalize(groundTruth)
  if (predTokens.length === 0 || truthTokens.length === 0) return predTokens.length === truthTokens.length ? 1 : 0
  const truthCounts = new Map<string, number>()
  for (const t of truthTokens) truthCounts.set(t, (truthCounts.get(t) ?? 0) + 1)
  let overlap = 0
  const used = new Map<string, number>()
  for (const t of predTokens) {
    const avail = (truthCounts.get(t) ?? 0) - (used.get(t) ?? 0)
    if (avail > 0) { overlap += 1; used.set(t, (used.get(t) ?? 0) + 1) }
  }
  if (overlap === 0) return 0
  const precision = overlap / predTokens.length
  const recall = overlap / truthTokens.length
  return (2 * precision * recall) / (precision + recall)
}

async function main(): Promise<void> {
  console.log(`Three-arm real LoCoMo eval — ${CONVOS_TO_USE} conversations x ${QUESTIONS_PER_CONVO} questions, gemini-3.8-flash, single run.\n`)

  let baseF1 = 0, regexF1 = 0, embedF1 = 0, totalQ = 0
  let baseTokens = 0, regexTokens = 0, embedTokens = 0

  for (let c = 0; c < CONVOS_TO_USE; c++) {
    const convo = raw[c]
    const transcript = buildTranscript(convo)
    const frame: RoutingFrame = classify(transcript.at(-1)?.content ?? '', transcript.slice(0, -1))

    const regexCompression = compressHistory(transcript, frame)
    console.log(`[${convo.sample_id}] transcript: ${transcript.length} turns`)
    console.log(`  regex-compressed:     ${regexCompression.compressed.length} messages (domain=${frame.domain})`)

    const embedStart = Date.now()
    const embedCompression = await compressHistoryWithEmbeddings(transcript, frame, GEMINI_KEY!)
    console.log(`  embedding-compressed:  ${embedCompression.compressed.length} messages (${((Date.now() - embedStart) / 1000).toFixed(1)}s to embed)`)

    const qas = convo.qa.filter((qa) => typeof qa.answer !== 'undefined').slice(0, QUESTIONS_PER_CONVO)
    for (const qa of qas) {
      const groundTruth = String(qa.answer)
      const [baseline, regexEcho, embedEcho] = await Promise.all([
        askGemini(transcript, qa.question),
        askGemini(regexCompression.compressed, qa.question),
        askGemini(embedCompression.compressed, qa.question),
      ])
      const bF1 = f1Score(baseline.answer, groundTruth)
      const rF1 = f1Score(regexEcho.answer, groundTruth)
      const eF1 = f1Score(embedEcho.answer, groundTruth)
      baseF1 += bF1; regexF1 += rF1; embedF1 += eF1; totalQ += 1
      baseTokens += baseline.totalTokens; regexTokens += regexEcho.totalTokens; embedTokens += embedEcho.totalTokens
      console.log(`  Q: "${qa.question.slice(0, 55)}" | truth="${groundTruth}" | base(F1=${bF1.toFixed(2)}) | regex(F1=${rF1.toFixed(2)}) | embed(F1=${eF1.toFixed(2)})`)
    }
  }

  console.log(`\n=== REAL LoCoMo RESULTS, 3 arms (n=${totalQ} questions, ${CONVOS_TO_USE} conversations, k=1) ===`)
  console.log(`Baseline (full transcript): F1=${(baseF1 / totalQ).toFixed(3)}  total_tokens=${baseTokens}  avg_tokens/q=${Math.round(baseTokens / totalQ)}`)
  console.log(`Regex compressor:           F1=${(regexF1 / totalQ).toFixed(3)}  total_tokens=${regexTokens}  avg_tokens/q=${Math.round(regexTokens / totalQ)}  reduction=${((1 - regexTokens / baseTokens) * 100).toFixed(1)}%`)
  console.log(`Embedding compressor:       F1=${(embedF1 / totalQ).toFixed(3)}  total_tokens=${embedTokens}  avg_tokens/q=${Math.round(embedTokens / totalQ)}  reduction=${((1 - embedTokens / baseTokens) * 100).toFixed(1)}%`)
}

main().catch((err) => { console.error(err); process.exit(1) })
