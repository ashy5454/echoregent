/**
 * Session memory eval — proves that key facts established in session 1
 * survive into session 2 via the LLM wiki pipeline.
 *
 * Pipeline under test:
 *   session 1 messages
 *     → classify + compressHistory → MemoryFrame
 *     → ingestSourceIntoLLMWiki (template mode, no LLM needed)
 *     → llmWikiToContextString(wiki, session2Message)
 *     → check that expectedWikiContains and expectedContextContains pass
 */

import { classify, compressHistory, createEmptyLLMWiki, ingestSourceIntoLLMWiki, llmWikiToContextString } from '../cts-core'
import type { MemoryFrame, Message, SourceInput } from '../cts-core'

interface SessionMemoryCase {
  id: string
  description: string
  session1: Message[]
  session1FinalMessage: string
  session2Message: string
  expectedWikiContains: string[]
  expectedContextContains: string[]
}

const cases: SessionMemoryCase[] = [
  {
    id: 'sm_001',
    description: 'TypeScript + PostgreSQL stack persists to session 2',
    session1: [
      { role: 'user', content: 'I am building a REST API in TypeScript with PostgreSQL.' },
      { role: 'assistant', content: 'Good stack. Use pg or Drizzle for the DB layer.' },
      { role: 'user', content: 'I need to add a webhook endpoint that receives Stripe events.' },
      { role: 'assistant', content: 'Verify the Stripe signature on every incoming request.' },
      { role: 'user', content: 'My POST /api/webhook/stripe keeps returning 401.' },
      { role: 'assistant', content: 'Check that STRIPE_WEBHOOK_SECRET matches what is in the Stripe dashboard.' },
      { role: 'user', content: 'Found it — wrong env var. Fixed now, thanks.' },
    ],
    session1FinalMessage: 'Found it — wrong env var. Fixed now, thanks.',
    session2Message: 'Which TypeScript ORM works best with PostgreSQL for a project like mine?',
    expectedWikiContains: ['typescript', 'postgresql'],
    expectedContextContains: ['typescript', 'postgresql'],
  },
  {
    id: 'sm_002',
    description: 'Lisinopril and BP readings persist across medical sessions',
    session1: [
      { role: 'user', content: 'I have been taking Lisinopril 10mg for high blood pressure.' },
      { role: 'assistant', content: 'How long have you been on it and what are your recent readings?' },
      { role: 'user', content: 'About three months. My last BP was 140/90 which is still high.' },
      { role: 'assistant', content: 'That is borderline. A doctor may adjust the dose.' },
      { role: 'user', content: 'I also started having a dry cough, could that be a side effect?' },
      { role: 'assistant', content: 'Yes, dry cough is a known Lisinopril side effect. Mention it to your doctor.' },
      { role: 'user', content: 'I will call my doctor today to discuss. Thank you.' },
    ],
    session1FinalMessage: 'I will call my doctor today to discuss. Thank you.',
    session2Message: 'My Lisinopril prescription needs renewal and my blood pressure is still not great.',
    expectedWikiContains: ['lisinopril', 'blood pressure'],
    expectedContextContains: ['lisinopril'],
  },
  {
    id: 'sm_003',
    description: 'SOC2 compliance requirement persists into follow-up sales session',
    session1: [
      { role: 'user', content: 'We are evaluating your premium plan for our startup team of 40.' },
      { role: 'assistant', content: 'The premium plan includes SSO, audit logs, and priority support.' },
      { role: 'user', content: 'Our security team requires SOC2 Type II certification. Do you have it?' },
      { role: 'assistant', content: 'Yes, we are SOC2 Type II certified. I can send the report.' },
      { role: 'user', content: 'Great. What is the annual price for 40 seats with the startup discount?' },
      { role: 'assistant', content: 'With the startup discount it is $12,000 per year for 40 seats.' },
      { role: 'user', content: 'Let me discuss with our CTO and get back to you this week.' },
    ],
    session1FinalMessage: 'Let me discuss with our CTO and get back to you this week.',
    session2Message: 'We are ready to move forward on the SOC2 certified premium plan.',
    expectedWikiContains: ['soc2', 'premium'],
    expectedContextContains: ['soc2'],
  },
  {
    id: 'sm_004',
    description: 'Refund order number persists into follow-up support session',
    session1: [
      { role: 'user', content: 'My order #A4821 never arrived. It has been three weeks.' },
      { role: 'assistant', content: 'I am sorry about the delay. Let me look up order #A4821.' },
      { role: 'user', content: 'The tracking says delivered but I have not received anything.' },
      { role: 'assistant', content: 'We will initiate an investigation with the carrier.' },
      { role: 'user', content: 'I already called the carrier and they said to contact you for a refund.' },
      { role: 'assistant', content: 'Understood. I have escalated this for a full refund within 5 business days.' },
      { role: 'user', content: 'Okay, I will wait until Friday. Thanks.' },
    ],
    session1FinalMessage: 'Okay, I will wait until Friday. Thanks.',
    session2Message: 'I still have not received my refund for order A4821, it is past Friday.',
    expectedWikiContains: ['refund', 'order'],
    expectedContextContains: ['refund'],
  },
  {
    id: 'sm_005',
    description: 'California employment contract context persists to follow-up legal session',
    session1: [
      { role: 'user', content: 'I am an employee in California and my contract has a non-compete clause.' },
      { role: 'assistant', content: 'California does not enforce non-compete clauses for employees.' },
      { role: 'user', content: 'My employer is threatening termination if I do not sign an updated contract.' },
      { role: 'assistant', content: 'Retaliation for refusing an unenforceable clause is itself problematic under California law.' },
      { role: 'user', content: 'Should I document all communications with my manager?' },
      { role: 'assistant', content: 'Yes, keep written records of every relevant interaction.' },
      { role: 'user', content: 'I will consult an employment attorney this week.' },
    ],
    session1FinalMessage: 'I will consult an employment attorney this week.',
    session2Message: 'I met with my California employment attorney about the contract termination threat.',
    expectedWikiContains: ['california', 'contract'],
    expectedContextContains: ['california'],
  },
  {
    id: 'sm_006',
    description: 'iPhone vs Samsung comparison context carries into decision session',
    session1: [
      { role: 'user', content: 'I am deciding between the iPhone 15 Pro and the Samsung S24 Ultra.' },
      { role: 'assistant', content: 'Both are flagship phones. What matters most to you?' },
      { role: 'user', content: 'Battery life and camera quality under $1200 MSRP.' },
      { role: 'assistant', content: 'S24 Ultra wins on battery; iPhone 15 Pro edges it on video quality.' },
      { role: 'user', content: 'Does iOS or Android work better with MacBook for file transfers?' },
      { role: 'assistant', content: 'iPhone and iOS integrates more seamlessly with MacBook via AirDrop and Handoff.' },
      { role: 'user', content: 'I need to think it over, talk soon.' },
    ],
    session1FinalMessage: 'I need to think it over, talk soon.',
    session2Message: 'I have decided on the iPhone, can you remind me the iPhone vs Samsung battery difference?',
    expectedWikiContains: ['iphone', 'samsung'],
    expectedContextContains: ['iphone'],
  },
  {
    id: 'sm_007',
    description: 'Photosynthesis lesson context persists to quiz session',
    session1: [
      { role: 'user', content: 'Can you teach me how photosynthesis works?' },
      { role: 'assistant', content: 'Photosynthesis converts sunlight, water, and CO2 into glucose and oxygen.' },
      { role: 'user', content: 'Which part of the plant does it happen in?' },
      { role: 'assistant', content: 'Primarily in the chloroplasts inside leaf cells.' },
      { role: 'user', content: 'What is the role of chlorophyll exactly?' },
      { role: 'assistant', content: 'Chlorophyll absorbs sunlight and transfers that energy to drive the reactions.' },
      { role: 'user', content: 'Got it. I want to review this tomorrow before my biology test.' },
    ],
    session1FinalMessage: 'Got it. I want to review this tomorrow before my biology test.',
    session2Message: 'Can you quiz me on photosynthesis and chlorophyll before my biology test?',
    expectedWikiContains: ['photosynthesis'],
    expectedContextContains: ['photosynthesis'],
  },
  {
    id: 'sm_008',
    description: 'Stripe webhook integration context persists to debugging session',
    session1: [
      { role: 'user', content: 'I am setting up a Stripe webhook to handle payment_intent.succeeded events.' },
      { role: 'assistant', content: 'Register the endpoint in the Stripe dashboard and verify the signature.' },
      { role: 'user', content: 'I am using TypeScript and Express. Where should I verify the signature?' },
      { role: 'assistant', content: 'In a raw body middleware before JSON parsing, using stripe.webhooks.constructEvent.' },
      { role: 'user', content: 'My handler is at POST /api/payments/webhook.' },
      { role: 'assistant', content: 'Make sure that path is not behind any auth middleware.' },
      { role: 'user', content: 'All set, it is working in test mode now.' },
    ],
    session1FinalMessage: 'All set, it is working in test mode now.',
    session2Message: 'My Stripe webhook is now failing in production, how do I debug the integration?',
    expectedWikiContains: ['stripe', 'webhook'],
    expectedContextContains: ['stripe'],
  },
  {
    id: 'sm_009',
    description: 'Database migration context persists to verification session',
    session1: [
      { role: 'user', content: 'I need to add a nullable column to a PostgreSQL table with 2 million rows.' },
      { role: 'assistant', content: 'Use a non-blocking migration: add the column with a default, then backfill.' },
      { role: 'user', content: 'Should I add a NOT NULL constraint after the backfill?' },
      { role: 'assistant', content: 'Yes, validate the constraint before setting it to avoid a full table lock.' },
      { role: 'user', content: 'I will run the migration script this weekend.' },
      { role: 'assistant', content: 'Monitor replication lag and have a rollback plan ready.' },
      { role: 'user', content: 'Good plan, I will prepare the rollback script first. Thanks.' },
    ],
    session1FinalMessage: 'Good plan, I will prepare the rollback script first. Thanks.',
    session2Message: 'The PostgreSQL migration ran. How do I verify the nullable column and constraints are correct?',
    expectedWikiContains: ['postgresql', 'migration'],
    expectedContextContains: ['postgresql'],
  },
  {
    id: 'sm_010',
    description: 'Web scraper context with BeautifulSoup persists to follow-up session',
    session1: [
      { role: 'user', content: 'I am writing a Python web scraper using BeautifulSoup to collect product prices.' },
      { role: 'assistant', content: 'Use requests + BeautifulSoup. Respect robots.txt and add rate limiting.' },
      { role: 'user', content: 'The target site has pagination via ?page=1, ?page=2 etc.' },
      { role: 'assistant', content: 'Loop until you hit an empty page or a known max, incrementing the page param.' },
      { role: 'user', content: 'I want to export the results to a CSV file.' },
      { role: 'assistant', content: 'Use the csv module with DictWriter for clean column-aligned output.' },
      { role: 'user', content: 'The script is working. I will run it tonight against the full catalogue.' },
    ],
    session1FinalMessage: 'The script is working. I will run it tonight against the full catalogue.',
    session2Message: 'My BeautifulSoup scraper is throwing errors on some pages. How do I add error handling?',
    expectedWikiContains: ['beautifulsoup', 'python'],
    expectedContextContains: ['beautifulsoup'],
  },
]

// ── helpers ───────────────────────────────────────────────────────────────────

function memoryFrameToSource(frame: MemoryFrame, turnCount: number): SourceInput {
  const lines = [
    `Domain: ${frame.domain} | Intent: ${frame.intent} | State: ${frame.state}`,
    `Task: ${frame.task}`,
    frame.userGoal ? `Goal: ${frame.userGoal}` : '',
    frame.entities.length > 0 ? `Entities: ${frame.entities.join(', ')}` : '',
    frame.constraints.length > 0 ? `Constraints: ${frame.constraints.join(', ')}` : '',
    frame.unresolved.length > 0 ? `Unresolved: ${frame.unresolved.join(', ')}` : '',
    frame.risk.length > 0 ? `Risk: ${frame.risk.join(', ')}` : '',
  ].filter(Boolean)
  return {
    title: `Session memory — ${frame.domain} (${turnCount} turns)`,
    content: lines.join('\n'),
  }
}

// ── runner ────────────────────────────────────────────────────────────────────

interface CaseResult {
  id: string
  description: string
  pass: boolean
  wikiCheck: { term: string; found: boolean }[]
  contextCheck: { term: string; found: boolean }[]
  memoryFrame: MemoryFrame | undefined
  wikiPageCount: number
}

async function runCase(c: SessionMemoryCase): Promise<CaseResult> {
  const history = c.session1
  const finalMsg = c.session1FinalMessage
  const frame = classify(finalMsg, history)
  const compression = compressHistory([...history, { role: 'user', content: finalMsg }], frame)
  const memoryFrame = compression.memoryFrame

  let wiki = createEmptyLLMWiki()
  if (memoryFrame) {
    const source = memoryFrameToSource(memoryFrame, Math.floor(history.length / 2))
    wiki = await ingestSourceIntoLLMWiki(wiki, source, frame)
  }

  const wikiText = [
    wiki.indexMarkdown,
    ...wiki.pages.map((p) => p.markdown),
  ].join('\n').toLowerCase()

  const context = llmWikiToContextString(wiki, c.session2Message).toLowerCase()

  const wikiCheck = c.expectedWikiContains.map((term) => ({
    term,
    found: wikiText.includes(term.toLowerCase()),
  }))

  const contextCheck = c.expectedContextContains.map((term) => ({
    term,
    found: context.includes(term.toLowerCase()),
  }))

  const pass = wikiCheck.every((x) => x.found) && contextCheck.every((x) => x.found) && wiki.pages.length > 0

  return { id: c.id, description: c.description, pass, wikiCheck, contextCheck, memoryFrame, wikiPageCount: wiki.pages.length }
}

async function main(): Promise<void> {
  const results: CaseResult[] = []

  for (const c of cases) {
    const result = await runCase(c)
    results.push(result)

    const status = result.pass ? '[PASS]' : '[FAIL]'
    console.log(`${status} ${result.id}: ${result.description}`)
    if (!result.pass) {
      const wikiFails = result.wikiCheck.filter((x) => !x.found)
      const ctxFails = result.contextCheck.filter((x) => !x.found)
      if (wikiFails.length > 0) console.log(`  wiki missing: ${wikiFails.map((x) => x.term).join(', ')}`)
      if (ctxFails.length > 0) console.log(`  context missing: ${ctxFails.map((x) => x.term).join(', ')}`)
      if (!result.memoryFrame) console.log(`  no MemoryFrame produced (history too short?)`)
      console.log(`  wiki pages: ${result.wikiPageCount}, entities: ${result.memoryFrame?.entities.join(', ') ?? 'none'}`)
    }
  }

  const passed = results.filter((r) => r.pass).length
  const total = results.length
  console.log(`\n=== SESSION MEMORY EVAL SUMMARY ===`)
  console.log(`Cases: ${total}`)
  console.log(`Passed: ${passed}/${total} (${Math.round((passed / total) * 100)}%)`)

  if (passed < total) process.exit(1)
}

main().catch((err) => { console.error(err); process.exit(1) })
