import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { cts, type DomainType, type IntentType, type Message, type RiskSignal } from '../cts-core/index.js'

type DatasetRow = {
  id: string
  message: string
  history?: Message[]
  expectedIntent?: IntentType
  expectedDomain?: DomainType
  expectedState?: string
  expectedRisk?: RiskSignal[]
  expectedType?: string
  mustKeep?: string[]
  shouldDrop?: string[]
  expectedMinSavingsPct?: number
  notes?: string
}

type RouteShape = {
  intent: string
  domain: string
  state: string
  risk: string[]
}

type ResultRow = {
  id: string
  message: string
  expected: RouteShape
  actual: RouteShape
  pass: {
    intent: boolean
    domain: boolean
    state: boolean
    risk: boolean
    mustKeep: boolean
    shouldDrop: boolean
    savings: boolean
    compressionQuality: boolean
    ctsValue: boolean
    all: boolean
  }
  tokens: {
    original: number
    compressed: number
    saved: number
    ratio: number
  }
  contextChecks: {
    mustKeep: Array<{ value: string; kept: boolean }>
    shouldDrop: Array<{ value: string; dropped: boolean }>
    expectedMinSavingsPct: number | null
  }
  notes?: string
}

const inputPath = process.argv[2]
const outputJsonPath = process.argv[3] ?? './data/cts-eval-results.json'
const outputHtmlPath = process.argv[4] ?? './data/cts-eval-dashboard.html'

if (!inputPath) {
  console.error('Usage: npm.cmd run eval:dataset -- ./data/cts-eval-dataset.jsonl')
  process.exit(1)
}

const rows = parseRows(await readFile(inputPath, 'utf-8'))
const results = rows.map(evaluateRow)
const summary = summarize(results)

await mkdir(dirname(resolve(outputJsonPath)), { recursive: true })
await writeFile(outputJsonPath, JSON.stringify({ summary, results }, null, 2), 'utf-8')
await writeFile(outputHtmlPath, renderDashboard(summary, results), 'utf-8')

printLiveLogs(results)
printSummary(summary, outputJsonPath, outputHtmlPath)

function parseRows(rawText: string): DatasetRow[] {
  const trimmed = rawText.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as DatasetRow[]
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as DatasetRow)
}

function evaluateRow(row: DatasetRow): ResultRow {
  const expected = normalizeExpected(row)
  const result = cts({ message: row.message, history: row.history ?? [] })
  const compressedText = result.compression.compressed.map((message) => message.content).join('\n')
  const ratio = result.compression.originalTokens === 0 ? 0 : result.compression.tokensSaved / result.compression.originalTokens
  const expectedMinSavingsPct = typeof row.expectedMinSavingsPct === 'number' ? row.expectedMinSavingsPct : null
  const compressedLower = compressedText.toLowerCase()
  const mustKeep = (row.mustKeep ?? []).map((value) => ({ value, kept: compressedLower.includes(value.toLowerCase()) }))
  const shouldDrop = (row.shouldDrop ?? []).map((value) => ({
    value,
    dropped: !new RegExp(`\\b${value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(compressedText),
  }))

  const pass = {
    intent: result.frame.intent === expected.intent,
    domain: result.frame.domain === expected.domain,
    state: result.frame.state === expected.state,
    risk: sameSet(expected.risk, result.frame.risk),
    mustKeep: mustKeep.every((item) => item.kept),
    shouldDrop: shouldDrop.every((item) => item.dropped),
    savings: expectedMinSavingsPct === null || ratio * 100 >= expectedMinSavingsPct,
    compressionQuality: false,
    ctsValue: false,
    all: false,
  }
  pass.compressionQuality = pass.mustKeep && pass.shouldDrop && pass.savings
  pass.ctsValue = pass.intent && pass.domain && pass.compressionQuality
  pass.all = pass.intent && pass.domain && pass.state && pass.risk && pass.compressionQuality

  return {
    id: row.id,
    message: row.message,
    expected,
    actual: {
      intent: result.frame.intent,
      domain: result.frame.domain,
      state: result.frame.state,
      risk: result.frame.risk,
    },
    pass,
    tokens: {
      original: result.compression.originalTokens,
      compressed: result.compression.compressedTokens,
      saved: result.compression.tokensSaved,
      ratio,
    },
    contextChecks: {
      mustKeep,
      shouldDrop,
      expectedMinSavingsPct,
    },
    notes: row.notes,
  }
}

function normalizeExpected(row: DatasetRow): RouteShape {
  if (row.expectedIntent && row.expectedDomain) {
    return {
      intent: row.expectedIntent,
      domain: row.expectedDomain,
      state: row.expectedState ?? 'opening',
      risk: row.expectedRisk ?? [],
    }
  }
  const mapped = mapLegacyType(row.expectedType ?? 'task_execution', `${row.message}\n${row.history?.map((item) => item.content).join('\n') ?? ''}`.toLowerCase())
  return {
    intent: mapped.intent,
    domain: mapped.domain,
    state: row.expectedState ?? 'opening',
    risk: normalizeRisk(row.expectedRisk ?? [], row.expectedType ?? ''),
  }
}

function summarize(results: ResultRow[]) {
  const total = results.length
  const passCount = (key: keyof ResultRow['pass']) => results.filter((row) => row.pass[key]).length
  const totalOriginal = results.reduce((sum, row) => sum + row.tokens.original, 0)
  const totalCompressed = results.reduce((sum, row) => sum + row.tokens.compressed, 0)
  const totalSaved = results.reduce((sum, row) => sum + row.tokens.saved, 0)
  return {
    total,
    allAccuracy: pct(passCount('all'), total),
    intentAccuracy: pct(passCount('intent'), total),
    domainAccuracy: pct(passCount('domain'), total),
    stateAccuracy: pct(passCount('state'), total),
    riskAccuracy: pct(passCount('risk'), total),
    mustKeepAccuracy: pct(passCount('mustKeep'), total),
    shouldDropAccuracy: pct(passCount('shouldDrop'), total),
    savingsPassRate: pct(passCount('savings'), total),
    compressionQualityPassRate: pct(passCount('compressionQuality'), total),
    ctsValuePassRate: pct(passCount('ctsValue'), total),
    totalOriginalTokens: totalOriginal,
    totalCompressedTokens: totalCompressed,
    totalTokensSaved: totalSaved,
    tokenSavingsRatio: totalOriginal === 0 ? 0 : totalSaved / totalOriginal,
    ctsValueFailures: results.filter((row) => !row.pass.ctsValue).length,
    strictFailures: results.filter((row) => !row.pass.all).length,
  }
}

function printLiveLogs(results: ResultRow[]): void {
  for (const row of results) {
    const status = row.pass.all ? 'PASS' : 'FAIL'
    console.log([
      `[${status}] ${row.id}`,
      `  message: ${row.message}`,
      `  expected: ${row.expected.intent}/${row.expected.domain}/${row.expected.state} risk=[${row.expected.risk.join(',') || 'none'}]`,
      `  actual:   ${row.actual.intent}/${row.actual.domain}/${row.actual.state} risk=[${row.actual.risk.join(',') || 'none'}]`,
      `  pass: intent=${row.pass.intent} domain=${row.pass.domain} state=${row.pass.state} risk=${row.pass.risk} mustKeep=${row.pass.mustKeep} shouldDrop=${row.pass.shouldDrop} savings=${row.pass.savings}`,
      `  tokens: ${row.tokens.original} -> ${row.tokens.compressed}, saved=${row.tokens.saved} (${Math.round(row.tokens.ratio * 100)}%), threshold=${row.contextChecks.expectedMinSavingsPct ?? 'n/a'}%`,
      row.contextChecks.mustKeep.length ? `  mustKeep: ${row.contextChecks.mustKeep.map((item) => `${item.kept ? 'ok' : 'miss'}:${item.value}`).join(' | ')}` : '',
      row.contextChecks.shouldDrop.length ? `  shouldDrop: ${row.contextChecks.shouldDrop.map((item) => `${item.dropped ? 'ok' : 'kept'}:${item.value}`).join(' | ')}` : '',
    ].filter(Boolean).join('\n'))
  }
}

function printSummary(summary: ReturnType<typeof summarize>, jsonPath: string, htmlPath: string): void {
  console.log('\n=== CTS DATASET EVAL SUMMARY ===')
  console.log(`Rows: ${summary.total}`)
  console.log(`All dimensions accuracy: ${Math.round(summary.allAccuracy * 100)}%`)
  console.log(`Intent accuracy: ${Math.round(summary.intentAccuracy * 100)}%`)
  console.log(`Domain accuracy: ${Math.round(summary.domainAccuracy * 100)}%`)
  console.log(`State accuracy: ${Math.round(summary.stateAccuracy * 100)}%`)
  console.log(`Risk accuracy: ${Math.round(summary.riskAccuracy * 100)}%`)
  console.log(`Must-keep pass rate: ${Math.round(summary.mustKeepAccuracy * 100)}%`)
  console.log(`Should-drop pass rate: ${Math.round(summary.shouldDropAccuracy * 100)}%`)
  console.log(`Savings threshold pass rate: ${Math.round(summary.savingsPassRate * 100)}%`)
  console.log(`Compression quality pass rate: ${Math.round(summary.compressionQualityPassRate * 100)}%`)
  console.log(`CTS value pass rate: ${Math.round(summary.ctsValuePassRate * 100)}%`)
  console.log(`Token savings: ${summary.totalTokensSaved}/${summary.totalOriginalTokens} (${Math.round(summary.tokenSavingsRatio * 100)}%)`)
  console.log(`CTS value failures: ${summary.ctsValueFailures}`)
  console.log(`Strict all-label failures: ${summary.strictFailures}`)
  console.log(`JSON report: ${resolve(jsonPath)}`)
  console.log(`HTML dashboard: ${resolve(htmlPath)}`)
}

function renderDashboard(summary: ReturnType<typeof summarize>, results: ResultRow[]): string {
  const cards = [
    ['Rows', summary.total],
    ['All Accuracy', `${Math.round(summary.allAccuracy * 100)}%`],
    ['Intent', `${Math.round(summary.intentAccuracy * 100)}%`],
    ['Domain', `${Math.round(summary.domainAccuracy * 100)}%`],
    ['State', `${Math.round(summary.stateAccuracy * 100)}%`],
    ['Risk', `${Math.round(summary.riskAccuracy * 100)}%`],
    ['Must Keep', `${Math.round(summary.mustKeepAccuracy * 100)}%`],
    ['Should Drop', `${Math.round(summary.shouldDropAccuracy * 100)}%`],
    ['Savings Pass', `${Math.round(summary.savingsPassRate * 100)}%`],
    ['Compression Quality', `${Math.round(summary.compressionQualityPassRate * 100)}%`],
    ['CTS Value Pass', `${Math.round(summary.ctsValuePassRate * 100)}%`],
    ['Tokens Saved', `${summary.totalTokensSaved} (${Math.round(summary.tokenSavingsRatio * 100)}%)`],
    ['CTS Value Failures', summary.ctsValueFailures],
    ['Strict Failures', summary.strictFailures],
  ]

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>CTS Eval Dashboard</title>
  <style>
    body{font-family:Inter,system-ui,sans-serif;margin:0;background:#f6f7f4;color:#17201b}
    main{max-width:1400px;margin:auto;padding:28px}
    h1{font-size:42px;margin:0 0 20px}
    .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
    .card,.row{background:white;border:1px solid #d8dfda;border-radius:8px;padding:14px}
    .card span{display:block;color:#627267;font-size:13px}.card strong{font-size:26px}
    .rows{display:grid;gap:10px}.row{display:grid;gap:8px}
    .ok{border-left:6px solid #2f7d50}.bad{border-left:6px solid #bf3b3b}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
    .muted{color:#627267}.pill{display:inline-block;border:1px solid #cfd8d1;border-radius:999px;padding:3px 8px;margin:2px;background:#f8faf7}
    .good{border-color:#9ac7a8;background:#effaf2}.miss{border-color:#e1a0a0;background:#fff1f1}
    @media(max-width:700px){.grid{grid-template-columns:1fr}}
  </style>
</head>
<body>
<main>
  <h1>CTS Eval Dashboard</h1>
  <section class="cards">${cards.map(([label, value]) => `<div class="card"><span>${escapeHtml(String(label))}</span><strong>${escapeHtml(String(value))}</strong></div>`).join('')}</section>
  <section class="rows">
    ${results.map((row) => `
      <article class="row ${row.pass.all ? 'ok' : 'bad'}">
        <strong>${escapeHtml(row.id)} - ${row.pass.ctsValue ? 'VALUE PASS' : 'VALUE FAIL'}${row.pass.all ? ' / STRICT PASS' : ''}</strong>
        <p>${escapeHtml(row.message)}</p>
        <div class="grid">
          <div><span class="muted">Expected</span><br>${renderPills(row.expected)}</div>
          <div><span class="muted">Actual</span><br>${renderPills(row.actual)}</div>
        </div>
        <div class="muted">Route pass: intent=${row.pass.intent} domain=${row.pass.domain} state=${row.pass.state} risk=${row.pass.risk}</div>
        <div class="muted">Compression pass: mustKeep=${row.pass.mustKeep} shouldDrop=${row.pass.shouldDrop} savings=${row.pass.savings} quality=${row.pass.compressionQuality} ctsValue=${row.pass.ctsValue}</div>
        <div class="muted">Tokens: ${row.tokens.original} -> ${row.tokens.compressed}, saved ${row.tokens.saved} (${Math.round(row.tokens.ratio * 100)}%), threshold ${row.contextChecks.expectedMinSavingsPct ?? 'n/a'}%</div>
        ${row.contextChecks.mustKeep.length ? `<div><span class="muted">Must keep</span><br>${row.contextChecks.mustKeep.map((item) => `<span class="pill ${item.kept ? 'good' : 'miss'}">${item.kept ? 'kept' : 'missing'}: ${escapeHtml(item.value)}</span>`).join('')}</div>` : ''}
        ${row.contextChecks.shouldDrop.length ? `<div><span class="muted">Should drop</span><br>${row.contextChecks.shouldDrop.map((item) => `<span class="pill ${item.dropped ? 'good' : 'miss'}">${item.dropped ? 'dropped' : 'kept'}: ${escapeHtml(item.value)}</span>`).join('')}</div>` : ''}
        ${row.notes ? `<div class="muted">Notes: ${escapeHtml(row.notes)}</div>` : ''}
      </article>
    `).join('')}
  </section>
</main>
</body>
</html>`
}

function renderPills(value: RouteShape): string {
  return [
    value.intent,
    value.domain,
    value.state,
    value.risk.length ? value.risk.join(', ') : 'no-risk',
  ].map((item) => `<span class="pill">${escapeHtml(item)}</span>`).join('')
}

function pct(part: number, total: number): number {
  return total === 0 ? 0 : part / total
}

function sameSet(a: string[], b: string[]): boolean {
  const left = new Set(a)
  const right = new Set(b)
  return left.size === right.size && [...left].every((item) => right.has(item))
}

function mapLegacyType(expectedType: string, lower: string): { intent: IntentType; domain: DomainType } {
  switch (expectedType) {
    case 'debugging': return { intent: 'debugging', domain: 'coding' }
    case 'code_generation': return { intent: 'generation', domain: 'coding' }
    case 'problem_solving': return { intent: 'task_execution', domain: inferDomain(lower) }
    case 'commerce': return { intent: /(vs|compare|better|worth|alternatives)/.test(lower) ? 'comparison' : 'task_execution', domain: 'commerce' }
    case 'comparison': return { intent: 'comparison', domain: inferDomain(lower) }
    case 'medical_adjacent': return { intent: /(should i|safe|worried)/.test(lower) ? 'decision_support' : 'information_seeking', domain: 'medical' }
    case 'legal_adjacent': return { intent: /(what can i do|options|should i)/.test(lower) ? 'decision_support' : 'information_seeking', domain: 'legal' }
    case 'decision_support': return { intent: 'decision_support', domain: inferDomain(lower) }
    case 'brainstorming': return { intent: 'exploration', domain: inferDomain(lower) }
    case 'research': return { intent: 'exploration', domain: inferDomain(lower) }
    case 'teaching': return { intent: 'information_seeking', domain: 'education' }
    case 'explanation': return { intent: 'information_seeking', domain: inferDomain(lower) }
    case 'editing': return { intent: 'correction', domain: 'general' }
    case 'casual_chat': return { intent: 'information_seeking', domain: 'general' }
    case 'emotional_support': return { intent: 'task_execution', domain: 'general' }
    case 'crisis': return { intent: 'task_execution', domain: 'general' }
    default: return { intent: 'task_execution', domain: inferDomain(lower) }
  }
}

function inferDomain(lower: string): DomainType {
  if (/(code|api|database|deploy|lambda|auth|bug|webhook|typescript|javascript|python|rust|react|sql|docker|github actions|terraform|supabase|prisma)/.test(lower)) return 'coding'
  if (/(order|refund|support|ticket|delivery)/.test(lower)) return 'customer_support'
  if (/(sales|pricing|crm|competitor|lead)/.test(lower)) return 'sales'
  if (/(doctor|symptom|medication|headache|fever|blood pressure|pain|diabetes|rash|sleep|ibuprofen|paracetamol)/.test(lower)) return 'medical'
  if (/(contract|landlord|employer|legal|gdpr|trademark|copyright|equity|patent|privacy policy|cease and desist|non-compete)/.test(lower)) return 'legal'
  if (/(buy|laptop|monitor|keyboard|hosting|chair|vpn|domain|registrar|gateway|iphone|samsung|aws|gcp|figma|postman|notion|confluence)/.test(lower)) return 'commerce'
  if (/(teach|learn|interview|study|explain|example|cap theorem|binary search|event loop)/.test(lower)) return 'education'
  return 'general'
}

function normalizeRisk(risk: string[], expectedType: string): RiskSignal[] {
  const allowed = new Set(['medical_caution', 'legal_caution', 'financial_caution', 'protected_context', 'unsafe_request', 'crisis'])
  const mapped = risk.filter((item): item is RiskSignal => allowed.has(item))
  if (expectedType === 'crisis' && !mapped.includes('protected_context')) mapped.push('protected_context')
  return Array.from(new Set(mapped))
}

function escapeHtml(value: string): string {
  return value
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#039;')
}
