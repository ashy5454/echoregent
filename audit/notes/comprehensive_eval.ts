/**
 * Real comprehensive eval against CURRENT echoregent code.
 *
 * This ports the actual methodology from yudi-cts's eval_comprehensive.py
 * (ROUGE-L, sliding-window baseline, domain accuracy, token reduction) —
 * that script's own numbers couldn't be reproduced or trusted here because
 * its 10 source datasets (coding.json, customer_support.json, ...) were
 * gitignored and never committed to any repo we have access to, so there's
 * nothing to re-run it against. This runs the SAME kind of measurement
 * against data we actually have: the real public LoCoMo conversations
 * (already downloaded this session) and the hand-labeled example scenarios
 * already in this repo (src/scenarios.ts) — and against the CURRENT
 * compression code (both the regex fallback and the embeddings default),
 * not the old T5/DistilBERT path that no longer exists in this codebase.
 *
 * Metrics:
 *  - Token reduction (real BPE tokenizer, same one the product uses)
 *  - ROUGE-L (LCS-based, ported directly from eval_comprehensive.py's
 *    algorithm) — how much of the original content's wording survives
 *  - Naive sliding-window baseline ("keep last 5 messages") as a point of
 *    comparison, same baseline the original script used
 *  - Domain classification accuracy against the 6 hand-labeled scenarios
 *    already in this repo
 */
import { readFileSync } from 'node:fs'
import { classify } from '../../src/cts-core/classifier'
import { compressHistory, compressHistoryWithEmbeddings } from '../../src/cts-core/compressor'
import { countChatTokens } from '../../src/cts-core/tokenizer'
import type { Message, RoutingFrame } from '../../src/cts-core/types'
import { scenarios } from '../../src/scenarios'

const GEMINI_KEY = process.env.GEMINI_TEST_KEY

// ── ROUGE-L, ported from eval_comprehensive.py ────────────────────────────
const STOPWORDS = new Set([
  'a','an','the','is','are','was','were','be','been','being','have','has',
  'had','do','does','did','will','would','could','should','may','might',
  'shall','can','i','you','he','she','it','we','they','me','him','her',
  'us','them','my','your','his','its','our','their','this','that','these',
  'those','what','which','who','when','where','why','how','all','each',
  'every','both','few','more','most','other','some','such','no','not',
  'only','same','so','than','too','very','just','but','and','or','as',
  'at','by','for','from','in','into','of','on','to','with','about',
  'after','before','then','there','here','if','also','even','still','yet',
  'get','got','like','go','use','used','one','two','three','new','old',
])

function tokenizeRouge(text: string): string[] {
  const words = String(text).toLowerCase().match(/[a-z0-9]+/g) ?? []
  return words.filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

function lcsLen(x: string[], y: string[]): number {
  const m = x.length, n = y.length
  if (m === 0 || n === 0) return 0
  let prev = new Array(n + 1).fill(0)
  for (let i = 1; i <= m; i++) {
    const curr = new Array(n + 1).fill(0)
    for (let j = 1; j <= n; j++) {
      curr[j] = x[i - 1] === y[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], curr[j - 1])
    }
    prev = curr
  }
  return prev[n]
}

function rougeL(reference: string, hypothesis: string): number {
  const ref = tokenizeRouge(reference)
  const hyp = tokenizeRouge(hypothesis)
  if (ref.length === 0 || hyp.length === 0) return 0
  const lcs = lcsLen(ref, hyp)
  const precision = lcs / hyp.length
  const recall = lcs / ref.length
  if (precision + recall === 0) return 0
  return Math.round(((2 * precision * recall) / (precision + recall)) * 10000) / 100
}

function slidingWindow(history: Message[], k = 5): Message[] {
  return history.slice(-k)
}

function joinText(messages: Message[]): string {
  return messages.map((m) => m.content).join(' ')
}

// ── Domain accuracy against src/scenarios.ts's hand-labeled examples ─────
const EXPECTED_DOMAIN: Record<string, string> = {
  'coding-debug': 'coding',
  'support-refund': 'customer_support',
  'sales-objection': 'sales',
  'legal-caution': 'legal',
  'medical-decision': 'medical',
  'general-summary': 'general',
}

function runDomainAccuracy(): void {
  console.log('\n=== DOMAIN ACCURACY (src/scenarios.ts, n=6 hand-labeled) ===')
  let correct = 0
  for (const s of scenarios) {
    const frame: RoutingFrame = classify(s.message, s.history)
    const expected = EXPECTED_DOMAIN[s.id]
    const ok = frame.domain === expected
    if (ok) correct++
    console.log(`  ${ok ? 'OK  ' : 'MISS'} [${s.id}] expected=${expected} got=${frame.domain}`)
  }
  console.log(`Domain accuracy: ${correct}/${scenarios.length} (${Math.round((correct / scenarios.length) * 100)}%)`)
  console.log('(n=6 — small sample, not a substitute for a large labeled eval set)')
}

// ── LoCoMo-based token reduction + ROUGE-L, current code only ────────────
interface LocomoTurn { speaker: string; dia_id: string; text: string }
interface LocomoConvo {
  sample_id: string
  conversation: Record<string, LocomoTurn[] | string> & { speaker_a: string; speaker_b: string }
}

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

async function runLocomoComprehensive(): Promise<void> {
  console.log('\n=== TOKEN REDUCTION + ROUGE-L, current code, real LoCoMo conversations ===')
  const raw = JSON.parse(readFileSync(new URL('./locomo/locomo10.json', import.meta.url), 'utf-8')) as LocomoConvo[]

  console.log(`${'arm'.padEnd(18)}${'orig_tok'.padStart(10)}${'comp_tok'.padStart(10)}${'reduction'.padStart(11)}${'rouge-l'.padStart(9)}`)

  for (let c = 0; c < 2; c++) {
    const convo = raw[c]
    const transcript = buildTranscript(convo)
    const originalTokens = countChatTokens(transcript)
    const originalText = joinText(transcript)
    console.log(`\n[${convo.sample_id}] ${transcript.length} turns, ${originalTokens} tokens`)

    const frame: RoutingFrame = classify(transcript.at(-1)?.content ?? '', transcript.slice(0, -1))

    const arms: Array<{ name: string; messages: Message[] }> = [
      { name: 'sliding-window(5)', messages: slidingWindow(transcript, 5) },
      { name: 'regex (shipped fallback)', messages: compressHistory(transcript, frame).compressed },
    ]
    if (GEMINI_KEY) {
      const embedResult = await compressHistoryWithEmbeddings(transcript, frame, GEMINI_KEY)
      arms.push({ name: 'embeddings (shipped default)', messages: embedResult.compressed })
    }

    for (const arm of arms) {
      const compTokens = countChatTokens(arm.messages)
      const reduction = ((1 - compTokens / originalTokens) * 100).toFixed(1)
      const rouge = rougeL(originalText, joinText(arm.messages))
      console.log(`${arm.name.padEnd(18)}${String(originalTokens).padStart(10)}${String(compTokens).padStart(10)}${(reduction + '%').padStart(11)}${String(rouge).padStart(9)}`)
    }
  }

  if (!GEMINI_KEY) {
    console.log('\n(GEMINI_TEST_KEY not set — embeddings arm skipped)')
  }
}

async function main(): Promise<void> {
  console.log('Real comprehensive eval against CURRENT echoregent code (not the old T5/DistilBERT path).')
  runDomainAccuracy()
  await runLocomoComprehensive()
}

main().catch((err) => { console.error(err); process.exit(1) })
