/**
 * Real, small-scale LoCoMo evaluation — using the actual public dataset
 * (snap-research/locomo, data/locomo10.json), not a hand-written stand-in.
 * This is the same benchmark the old README claimed a comparison against
 * mem0 on (F1 0.079 vs 0.069, 259 vs 6,956 tokens) with zero code in the
 * repo backing it. This script is that code, run for real, on a scoped
 * sample (2 conversations, 30 QA pairs each = 60 questions) per the
 * founder's explicit choice over running the full 1,986-question set.
 *
 * Design:
 *  - Full transcript per conversation = every session's turns, in order,
 *    speaker_a mapped to 'user' / speaker_b mapped to 'assistant' (LoCoMo
 *    conversations are between two named people, not a user+AI chat — this
 *    mapping only matters for feeding it through classify()/compressHistory(),
 *    which only cares about turn-taking role, not semantic identity).
 *  - Baseline arm: full transcript + question, one real Gemini call.
 *  - EchoRegent arm: compressHistory() run ONCE on the full transcript (a
 *    single /compress-style call, matching how a customer would actually
 *    use this endpoint before asking a question) + question, one real call.
 *  - F1: standard SQuAD-style token-overlap F1 (lowercase, strip punctuation,
 *    drop articles, whitespace-tokenize, precision/recall over token
 *    multiset intersection) — the same style of metric the old README's
 *    "F1" claim was implicitly invoking.
 *  - No mem0 comparison: we don't have mem0 running here, and reproducing
 *    someone else's number without their exact setup isn't valid (this is
 *    exactly the caveat AUDIT.md Part 1 already raised) — this reports
 *    EchoRegent's real, own numbers on the real dataset, nothing more.
 */
import { readFileSync } from 'node:fs'
import { classify } from '../../src/cts-core/classifier'
import { compressHistory } from '../../src/cts-core/compressor'
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

// Standard SQuAD-style token-overlap F1.
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
  console.log(`Real LoCoMo eval — ${CONVOS_TO_USE} conversations x ${QUESTIONS_PER_CONVO} questions, gemini-3.8-flash, single run.\n`)

  let baselineF1Sum = 0, echoregentF1Sum = 0, totalQ = 0
  let baselineTokens = 0, echoregentTokens = 0

  for (let c = 0; c < CONVOS_TO_USE; c++) {
    const convo = raw[c]
    const transcript = buildTranscript(convo)
    const frame: RoutingFrame = classify(transcript.at(-1)?.content ?? '', transcript.slice(0, -1))
    const compression = compressHistory(transcript, frame)
    console.log(`[${convo.sample_id}] transcript: ${transcript.length} turns -> compressed to ${compression.compressed.length} messages (domain=${frame.domain})`)

    const qas = convo.qa.filter((qa) => typeof qa.answer !== 'undefined').slice(0, QUESTIONS_PER_CONVO)
    for (const qa of qas) {
      const groundTruth = String(qa.answer)
      const [baseline, echoregent] = await Promise.all([
        askGemini(transcript, qa.question),
        askGemini(compression.compressed, qa.question),
      ])
      const bF1 = f1Score(baseline.answer, groundTruth)
      const eF1 = f1Score(echoregent.answer, groundTruth)
      baselineF1Sum += bF1; echoregentF1Sum += eF1; totalQ += 1
      baselineTokens += baseline.totalTokens; echoregentTokens += echoregent.totalTokens
      console.log(`  Q: "${qa.question.slice(0, 60)}" | truth="${groundTruth}" | baseline="${baseline.answer.slice(0, 40)}"(F1=${bF1.toFixed(2)}) | echoregent="${echoregent.answer.slice(0, 40)}"(F1=${eF1.toFixed(2)})`)
    }
  }

  console.log(`\n=== REAL LoCoMo RESULTS (n=${totalQ} questions, ${CONVOS_TO_USE} conversations, k=1) ===`)
  console.log(`Baseline (full transcript):    F1=${(baselineF1Sum / totalQ).toFixed(3)}  total_tokens=${baselineTokens}  avg_tokens/q=${Math.round(baselineTokens / totalQ)}`)
  console.log(`EchoRegent (compressed once):  F1=${(echoregentF1Sum / totalQ).toFixed(3)}  total_tokens=${echoregentTokens}  avg_tokens/q=${Math.round(echoregentTokens / totalQ)}`)
  console.log(`Token reduction: ${((1 - echoregentTokens / baselineTokens) * 100).toFixed(1)}%`)
  console.log(`\nNo mem0 comparison run — we don't have mem0 wired up in this environment, and comparing`)
  console.log(`against mem0's own published number without an identical setup isn't valid (AUDIT.md Part 1).`)
}

main().catch((err) => { console.error(err); process.exit(1) })
