/**
 * A small, REAL paired benchmark run — not a simulation, not the full rigorous
 * design in audit/bench/paired-eval.ts (which needs a 200+ conversation
 * corpus, multiple providers, k=3 repeats, and a quality judge to be that).
 *
 * This is the honest, small version: N realistic conversations, run twice
 * each (baseline = full growing history, echoregent = compressHistory()'s
 * real output), both arms making REAL calls to the real Gemini API, reading
 * REAL total_tokens from REAL responses. Single run (k=1), one provider,
 * compression effect only (not testing interaction with provider caching —
 * that's what audit/bench/breakeven.ts's simulation already covers).
 *
 * Conversations below are deliberately generic/varied vocabulary — NOT the
 * demo terms (Dallas, Lisinopril, ThinkPad, etc.) compressor.ts is tuned to,
 * so this doesn't accidentally flatter the compressor the way issue #3
 * describes.
 */
import { classify } from '../../src/cts-core/classifier'
import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

const GEMINI_KEY = process.env.GEMINI_TEST_KEY
if (!GEMINI_KEY) { console.error('Set GEMINI_TEST_KEY env var.'); process.exit(1) }
const MODEL = 'gemini-3.8-flash'

interface Fixture { id: string; domain: string; userTurns: string[] }

const fixtures: Fixture[] = [
  {
    id: 'support-shipping',
    domain: 'customer_support',
    userTurns: [
      'Hi, I ordered a desk lamp last week and it still says "processing."',
      'The order number is SD-88213, placed on the 14th.',
      'I paid for 2-day shipping so this is now past the window I was promised.',
      'Can you tell me if it has actually left the warehouse yet?',
      'If it has not shipped, I would like to cancel and get a refund instead.',
      'How long does the refund usually take to show up on my card?',
      'Okay, please go ahead and process that.',
      'Thanks for your help, that resolves it.',
    ],
  },
  {
    id: 'coding-debug',
    domain: 'coding',
    userTurns: [
      'My Python script crashes with a KeyError when parsing a CSV file.',
      'Here is the relevant part: row["email"] throws even though the header row has an "email" column.',
      'I printed the header row and it shows " email" with a leading space.',
      'That would explain it. How do I strip whitespace from all headers at once?',
      'Using pandas, what is the cleanest one-line fix for that?',
      'Great, that worked. Now I am seeing duplicate rows in the output though.',
      'The duplicates seem to come from re-running the script without clearing the output file first.',
      'Got it, I will add a check for that. Thanks for walking through it.',
    ],
  },
  {
    id: 'general-planning',
    domain: 'general',
    userTurns: [
      'I am trying to plan a small team offsite for about 12 people.',
      'Budget is tight, so I am looking at places within a 2-hour drive.',
      'We need a room that can fit a projector and some breakout space.',
      'Someone suggested a lake house rental instead of a hotel conference room.',
      'What should I ask the rental owner about before booking, for a work event specifically?',
      'Good point about liability insurance, I had not thought of that.',
      'Can you help me draft a short message to the team about the plan so far?',
    ],
  },
  {
    id: 'commerce-compare',
    domain: 'commerce',
    userTurns: [
      'I am deciding between two mid-range laptops for video editing on the side.',
      'One has more RAM, the other has a better GPU but less storage.',
      'Most of my editing is 1080p, not 4K, if that changes the tradeoff.',
      'Battery life matters too since I sometimes work from coffee shops.',
      'Between those two, which would you lean toward for that use case?',
      'That makes sense. Does the RAM difference matter much for exporting videos specifically?',
    ],
  },
]

interface TurnResult { totalTokens: number }

async function callGemini(messages: Message[]): Promise<{ text: string; totalTokens: number }> {
  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', {
    method: 'POST',
    headers: { authorization: `Bearer ${GEMINI_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model: MODEL, messages: messages.map((m) => ({ role: m.role, content: m.content })) }),
  })
  const payload = await response.json() as { choices?: Array<{ message: { content: string } }>; usage?: { total_tokens?: number }; error?: unknown }
  if (!response.ok) throw new Error(`Gemini error ${response.status}: ${JSON.stringify(payload.error ?? payload)}`)
  return { text: payload.choices?.[0]?.message?.content ?? '', totalTokens: payload.usage?.total_tokens ?? 0 }
}

async function runBaseline(userTurns: string[]): Promise<{ totalTokens: number; turns: TurnResult[]; finalReply: string }> {
  const history: Message[] = []
  const turns: TurnResult[] = []
  let finalReply = ''
  for (const userText of userTurns) {
    history.push({ role: 'user', content: userText })
    const { text, totalTokens } = await callGemini(history) // FULL growing history every turn
    turns.push({ totalTokens })
    history.push({ role: 'assistant', content: text })
    finalReply = text
  }
  return { totalTokens: turns.reduce((s, t) => s + t.totalTokens, 0), turns, finalReply }
}

async function runEchoRegent(userTurns: string[], domainHint: string): Promise<{ totalTokens: number; turns: TurnResult[]; finalReply: string }> {
  const history: Message[] = []
  const turns: TurnResult[] = []
  let finalReply = ''
  for (const userText of userTurns) {
    const frame: RoutingFrame = classify(userText, history)
    const current: Message = { role: 'user', content: userText }
    const compression = compressHistory([...history, current], frame)
    // Matches server.ts's real /v1/chat/completions guard: re-append the raw
    // current message if compression dropped it (e.g. collapsed to just the
    // summary) — without this, a request can end on an assistant/summary
    // turn, which Gemini's API rejects outright ("Requests ending with a
    // model turn are not supported"). Confirmed live during this run.
    const alreadyHasCurrent = compression.compressed.some((m) => m.role === 'user' && m.content === userText)
    const toSend = alreadyHasCurrent ? compression.compressed : [...compression.compressed, current]
    const { text, totalTokens } = await callGemini(toSend) // COMPRESSED history
    turns.push({ totalTokens })
    history.push(current, { role: 'assistant', content: text })
    finalReply = text
  }
  return { totalTokens: turns.reduce((s, t) => s + t.totalTokens, 0), turns, finalReply }
}

async function main(): Promise<void> {
  console.log('Real paired benchmark — single run (k=1), gemini-3.8-flash, compression effect only.\n')
  let grandBaseline = 0
  let grandEchoRegent = 0

  for (const fixture of fixtures) {
    process.stdout.write(`[${fixture.id}] baseline...`)
    const baseline = await runBaseline(fixture.userTurns)
    process.stdout.write(` ${baseline.totalTokens} tokens. echoregent...`)
    const echoregent = await runEchoRegent(fixture.userTurns, fixture.domain)
    const pct = ((1 - echoregent.totalTokens / baseline.totalTokens) * 100).toFixed(1)
    console.log(` ${echoregent.totalTokens} tokens. (${pct}% ${Number(pct) >= 0 ? 'savings' : 'MORE expensive'})`)
    console.log(`   baseline final reply:   "${baseline.finalReply.slice(0, 100)}"`)
    console.log(`   echoregent final reply: "${echoregent.finalReply.slice(0, 100)}"`)
    grandBaseline += baseline.totalTokens
    grandEchoRegent += echoregent.totalTokens
  }

  const grandPct = ((1 - grandEchoRegent / grandBaseline) * 100).toFixed(1)
  console.log(`\n=== TOTAL across ${fixtures.length} conversations, single run each ===`)
  console.log(`Baseline (full history):  ${grandBaseline} total_tokens`)
  console.log(`EchoRegent (compressed):  ${grandEchoRegent} total_tokens`)
  console.log(`Delta: ${grandPct}% ${Number(grandPct) >= 0 ? 'savings' : 'MORE expensive'}`)
  console.log(`\nCaveats: n=${fixtures.length}, k=1 (not the k=3 the full design calls for), one provider`)
  console.log(`(Gemini only), no quality judge beyond eyeballing the final replies printed above,`)
  console.log(`and this isolates compression's effect — it does not test interaction with provider`)
  console.log(`caching (see audit/bench/breakeven.ts for that simulation).`)
}

main().catch((err) => { console.error(err); process.exit(1) })
