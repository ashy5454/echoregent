// Held-out token-efficiency benchmark.
//
// The 4 fixtures in src/evals/tokenEval.ts were used to design the compression
// policy, so they cannot prove it generalises. This benchmark generates fresh
// conversations from templates and injected facts that do not appear in any
// fixture, then measures the two things the product promises:
//
//   1. token savings
//   2. retention of every injected hard fact + the in-flight turn
//
// A policy that "wins" by deleting information fails the second metric.
// Run: npx tsx audit/bench/token-savings-bench.ts

import { compressHistory, compressHistoryML } from '../../src/cts-core/compressor'
import { getRelevanceHealth } from '../../src/cts-core/ml-relevance'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// ── deterministic RNG ────────────────────────────────────────────────────────
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length)]
}

// ── domains ──────────────────────────────────────────────────────────────────
type Domain = 'coding' | 'customer_support' | 'sales' | 'commerce' | 'education' | 'general' | 'medical' | 'legal'

type Template = {
  domain: Domain
  intent: string
  risk: string[]
  substantive: string[]   // each contains one injected fact
  current: string
  facts: string[]
  protected?: boolean
}

const TEMPLATES: Template[] = [
  {
    domain: 'coding',
    intent: 'debugging',
    risk: [],
    substantive: [
      'The checkout call returns 503 from /api/orders/sync with error ERR-48213.',
      'We use JWT access tokens and a rotating signing secret in the worker queue.',
      'The retry queue dead-letters after three attempts and logs latency in ms.',
    ],
    current: 'Why does the webhook keep failing with a 503 on every retry?',
    facts: ['503', '/api/orders/sync', 'ERR-48213', 'JWT'],
  },
  {
    domain: 'customer_support',
    intent: 'escalation',
    risk: [],
    substantive: [
      'Order #ORD-88213 was placed on March 3 and still has not shipped.',
      'The tracking page shows no movement and the item cost $49.99.',
      'I already asked for a refund twice and the process has stalled.',
    ],
    current: 'My refund request for order #ORD-88213 is still pending. What now?',
    facts: ['ORD-88213', 'March 3', '$49.99', 'refund'],
  },
  {
    domain: 'sales',
    intent: 'objection_handling',
    risk: [],
    substantive: [
      'Northwind Traders quoted $2,400 per seat for the annual contract.',
      'Their rollout is planned for Q3 and they require SOC2 and SSO.',
      'They say the budget is locked until end of quarter.',
    ],
    current: 'Their pricing is higher than Zendesk. How should I handle the objection?',
    facts: ['Northwind Traders', '$2,400', 'Q3', 'SOC2', 'Zendesk'],
  },
  {
    domain: 'commerce',
    intent: 'decision_support',
    risk: [],
    substantive: [
      'The ThinkPad T14 costs $1,200 and has 16GB of RAM.',
      'The MacBook Air M3 is lighter but has a smaller battery.',
      'I need it for Docker and Next.js work while travelling.',
    ],
    current: 'Which laptop should I buy: ThinkPad T14 or MacBook Air M3?',
    facts: ['ThinkPad T14', '$1,200', 'MacBook Air M3', '16GB'],
  },
  {
    domain: 'education',
    intent: 'summarization',
    risk: [],
    substantive: [
      'The Calvin cycle uses ATP and produces glucose in the chloroplast.',
      'Photosynthesis also needs chlorophyll, water, and sunlight.',
      'The light reactions produce oxygen before the Calvin cycle begins.',
    ],
    current: 'Can you quiz me on the Calvin cycle and photosynthesis?',
    facts: ['Calvin cycle', 'glucose', 'chlorophyll', 'oxygen'],
  },
  {
    domain: 'general',
    intent: 'task_execution',
    risk: [],
    substantive: [
      'Maya and I have a meeting at 10am on Friday about the delayed launch.',
      'The API integration is still failing for everyone on the calendar sync.',
      'Sarah will send the email after lunch.',
    ],
    current: 'Can you put the meeting with Maya on my calendar for Friday at 10am?',
    facts: ['Maya', '10am', 'Friday', 'delayed launch'],
  },
  {
    domain: 'medical',
    intent: 'information_seeking',
    risk: ['medical_caution'],
    substantive: [
      'I started Lisinopril two weeks ago for blood pressure.',
      'I have a persistent cough and my blood pressure is 140/90.',
      'Is it safe to take ibuprofen alongside Lisinopril?',
    ],
    current: 'I have a headache and fever. Should I see a doctor?',
    facts: ['Lisinopril', '140/90', 'ibuprofen'],
  },
  {
    domain: 'legal',
    intent: 'information_seeking',
    risk: [],
    substantive: [
      'My California employment contract has an 18 months non-compete.',
      'The indemnity clause covers third-party claims.',
      'I am worried about retaliation if I report the issue.',
    ],
    current: 'Is this non-compete enforceable under California law?',
    facts: ['California', '18 months', 'non-compete', 'indemnity clause'],
  },
]

// Noise turns are deliberately information-free; a compressor should drop them.
const NOISE: Message[] = [
  { role: 'user', content: 'hey' },
  { role: 'assistant', content: 'Hey, what are you working on?' },
  { role: 'user', content: 'random thought, I might build something later' },
  { role: 'assistant', content: 'Sounds good.' },
]

function frameFor(t: Template): RoutingFrame {
  return {
    intent: t.intent as RoutingFrame['intent'],
    state: 'deepening',
    domain: t.domain,
    risk: t.risk,
    signals: { keywords: [], structures: [], urgency: 'low', affect: 'neutral' },
    confidence: { intent: 0.8, state: 0.75, domain: 0.85, risk: 0.9 },
  }
}

function buildConversation(t: Template, rng: () => number): Message[] {
  const history: Message[] = [...NOISE]
  for (const factLine of t.substantive) {
    history.push({ role: 'user', content: factLine })
    history.push({ role: 'assistant', content: pick(rng, [
      'Understood — can you share a bit more detail?',
      'That makes sense. What have you tried so far?',
      'Thanks. I will keep that in mind for the next step.',
    ]) })
  }
  history.push({ role: 'user', content: t.current })
  return history
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/#/g, '').replace(/\s+/g, ' ').trim()
}

// ── run ──────────────────────────────────────────────────────────────────────
const RUNS_PER_DOMAIN = 40
const results: Array<{
  domain: string
  protected: boolean
  original: number
  compressed: number
  savings: number
  factHits: number
  factTotal: number
  missing: string[]
  currentKept: boolean
}> = []

for (const template of TEMPLATES) {
  for (let i = 0; i < RUNS_PER_DOMAIN; i++) {
    const rng = mulberry32(1000 + i * 31 + template.domain.length)
    const history = buildConversation(template, rng)
    const frame = frameFor(template)
    const result = process.env.CTS_BENCH_ML === '1'
      ? await compressHistoryML(history, frame)
      : compressHistory(history, frame)
    const text = normalize(result.compressed.map((m) => m.content).join('\n'))

    const facts = template.facts.filter((f) => !/^refund$/.test(f)) // "refund" is in the current turn
    const missing = facts.filter((f) => !text.includes(normalize(f)))
    const hits = facts.length - missing.length
    const current = history[history.length - 1]
    const currentKept = result.compressed.some((m) => m.content === current.content)

    results.push({
      domain: template.domain,
      protected: template.protected === true,
      original: result.originalTokens,
      compressed: result.compressedTokens,
      savings: 1 - result.compressedTokens / result.originalTokens,
      factHits: hits,
      factTotal: facts.length,
      missing,
      currentKept,
    })
  }
}

// ── report ───────────────────────────────────────────────────────────────────
const byDomain = new Map<string, typeof results>()
for (const r of results) {
  if (!byDomain.has(r.domain)) byDomain.set(r.domain, [])
  byDomain.get(r.domain)!.push(r)
}

console.log(`\nSYNTHETIC RETENTION REGRESSION (${process.env.CTS_BENCH_ML === '1' ? 'ML' : 'rule'} path; templates are known to the implementation)\n`)
if (process.env.CTS_BENCH_ML === '1' && !getRelevanceHealth().loaded) throw new Error('Relevance model was not loaded')
console.log(
  'domain'.padEnd(18),
  'savings'.padStart(8),
  'facts'.padStart(8),
  'current'.padStart(8),
)

let totalOriginal = 0
let totalCompressed = 0
let factsKept = 0
let factsTotal = 0
let currentKept = 0

for (const [domain, rows] of byDomain) {
  const orig = rows.reduce((s, r) => s + r.original, 0)
  const comp = rows.reduce((s, r) => s + r.compressed, 0)
  const fh = rows.reduce((s, r) => s + r.factHits, 0)
  const ft = rows.reduce((s, r) => s + r.factTotal, 0)
  const cur = rows.filter((r) => r.currentKept).length
  totalOriginal += orig
  totalCompressed += comp
  factsKept += fh
  factsTotal += ft
  currentKept += cur
  console.log(
    domain.padEnd(18),
    `${Math.round((1 - comp / orig) * 100)}%`.padStart(8),
    `${Math.round((fh / Math.max(1, ft)) * 100)}%`.padStart(8),
    `${cur}/${rows.length}`.padStart(8),
  )
}

const compressible = results.filter((r) => !r.protected)
const cOrig = compressible.reduce((s, r) => s + r.original, 0)
const cComp = compressible.reduce((s, r) => s + r.compressed, 0)

console.log('\naggregate (all domains):', `${Math.round((1 - totalCompressed / totalOriginal) * 100)}%`)
console.log('hard-fact retention:    ', `${factsKept}/${factsTotal} (${Math.round((factsKept / factsTotal) * 100)}%)`)
console.log('current-turn retention: ', `${currentKept}/${results.length}`)

const failures = results.filter((r) => !r.protected && (!r.currentKept || r.factHits < r.factTotal))
if (failures.length > 0) {
  const missingByDomain = new Map<string, Map<string, number>>()
  for (const f of failures) {
    if (!missingByDomain.has(f.domain)) missingByDomain.set(f.domain, new Map())
    const bucket = missingByDomain.get(f.domain)!
    for (const fact of f.missing) bucket.set(fact, (bucket.get(fact) ?? 0) + 1)
  }
  console.log(`\n${failures.length} compressible case(s) lost information:`)
  for (const [domain, bucket] of missingByDomain) {
    console.log(`  ${domain}: ` + [...bucket.entries()].map(([fact, n]) => `${fact} ×${n}`).join(', '))
  }
}

const aggregateCompressible = 1 - cComp / cOrig
const factRetention = factsKept / factsTotal
process.exit(aggregateCompressible >= 0.5 && factRetention === 1 ? 0 : 1)
