import { readFile, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { DomainType, IntentType, Message, RiskSignal } from '../cts-core'

type LegacyRow = {
  id: string
  message: string
  history?: Message[]
  expectedType: string
  expectedState: string
  expectedRisk?: string[]
  notes?: string
}

type ConvertedRow = {
  id: string
  message: string
  history: Message[]
  expectedIntent: IntentType
  expectedState: string
  expectedDomain: DomainType
  expectedRisk: RiskSignal[]
  legacyType: string
  notes?: string
}

const inputPath = process.argv[2]
const outputPath = process.argv[3] ?? inputPath?.replace(/\.jsonl?$/i, '.routing-frame.jsonl')

if (!inputPath || !outputPath) {
  console.error('Usage: npm.cmd run eval:convert -- ./data/legacy.jsonl ./data/cts-eval-routing.jsonl')
  process.exit(1)
}

const raw = await readFile(inputPath, 'utf-8')
const rows = parseRows(raw)
const converted = rows.map(convertRow)
await writeFile(outputPath, converted.map((row) => JSON.stringify(row)).join('\n') + '\n', 'utf-8')

console.log(`Converted ${converted.length} rows from ${basename(inputPath)} to ${outputPath}`)
printDistribution(converted)

function parseRows(rawText: string): LegacyRow[] {
  const trimmed = rawText.trim()
  if (!trimmed) return []
  if (trimmed.startsWith('[')) return JSON.parse(trimmed) as LegacyRow[]
  return trimmed.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line) as LegacyRow)
}

function convertRow(row: LegacyRow): ConvertedRow {
  const lower = `${row.message}\n${row.history?.map((item) => item.content).join('\n') ?? ''}`.toLowerCase()
  const base = mapLegacyType(row.expectedType, lower)
  const risk = normalizeRisk(row.expectedRisk ?? [], row.expectedType)

  return {
    id: row.id,
    message: row.message,
    history: row.history ?? [],
    expectedIntent: base.intent,
    expectedState: row.expectedState,
    expectedDomain: base.domain,
    expectedRisk: risk,
    legacyType: row.expectedType,
    notes: row.notes,
  }
}

function mapLegacyType(expectedType: string, lower: string): { intent: IntentType; domain: DomainType } {
  switch (expectedType) {
    case 'debugging':
      return { intent: 'debugging', domain: 'coding' }
    case 'code_generation':
      return { intent: 'generation', domain: 'coding' }
    case 'problem_solving':
      return { intent: 'task_execution', domain: inferProblemDomain(lower) }
    case 'commerce':
      return { intent: inferCommerceIntent(lower), domain: 'commerce' }
    case 'comparison':
      return { intent: 'comparison', domain: inferComparisonDomain(lower) }
    case 'medical_adjacent':
      return { intent: lower.includes('should i') || lower.includes('is it safe') ? 'decision_support' : 'information_seeking', domain: 'medical' }
    case 'legal_adjacent':
      return { intent: lower.includes('what can i do') || lower.includes('should i') || lower.includes('options') ? 'decision_support' : 'information_seeking', domain: 'legal' }
    case 'decision_support':
      return { intent: 'decision_support', domain: inferDecisionDomain(lower) }
    case 'emotional_support':
      return { intent: 'task_execution', domain: 'general' }
    case 'crisis':
      return { intent: 'task_execution', domain: 'general' }
    case 'brainstorming':
      return { intent: 'exploration', domain: inferProblemDomain(lower) }
    case 'research':
      return { intent: 'exploration', domain: inferProblemDomain(lower) }
    case 'teaching':
      return { intent: 'information_seeking', domain: 'education' }
    case 'explanation':
      return { intent: 'information_seeking', domain: inferProblemDomain(lower) }
    case 'editing':
      return { intent: 'correction', domain: 'general' }
    case 'casual_chat':
      return { intent: 'information_seeking', domain: 'general' }
    case 'information_seeking':
      return { intent: 'information_seeking', domain: inferProblemDomain(lower) }
    default:
      return { intent: 'task_execution', domain: inferProblemDomain(lower) }
  }
}

function inferProblemDomain(lower: string): DomainType {
  if (/(api|code|database|microservice|deployment|lambda|android|bug|prompt injection|auth|search feature|test coverage|merge conflict)/.test(lower)) return 'coding'
  if (/(support tickets|order|refund|customer)/.test(lower)) return 'customer_support'
  if (/(sales|pricing|crm|lead)/.test(lower)) return 'sales'
  if (/(doctor|symptom|medication|blood pressure|headache|fever|pain|sleep)/.test(lower)) return 'medical'
  if (/(contract|landlord|employer|legal|gdpr|trademark|copyright|equity|patent)/.test(lower)) return 'legal'
  if (/(laptop|buy|monitor|keyboard|hosting|chair|vpn|domain|registrar|gateway)/.test(lower)) return 'commerce'
  if (/(learn|teach|interview|study|explain)/.test(lower)) return 'education'
  return 'general'
}

function inferCommerceIntent(lower: string): IntentType {
  if (/(vs|versus|compare|better|worth it|alternatives)/.test(lower)) return 'comparison'
  if (/(should i|which plan|16gb or 32gb)/.test(lower)) return 'decision_support'
  return 'task_execution'
}

function inferComparisonDomain(lower: string): DomainType {
  if (/(iphone|samsung|laptop|monitor|keyboard|vercel|netlify|aws|gcp|supabase|firebase|figma|postman)/.test(lower)) return 'commerce'
  return inferProblemDomain(lower)
}

function inferDecisionDomain(lower: string): DomainType {
  if (/(typescript|javascript|monorepo|repos|mobile app|web version|no-code|sdk|open source)/.test(lower)) return 'coding'
  if (/(seed round|bootstrap|pricing|revenue)/.test(lower)) return 'commerce'
  if (/(patent|legal|non-compete|contract)/.test(lower)) return 'legal'
  if (/(mba|learn|education)/.test(lower)) return 'education'
  return 'general'
}

function normalizeRisk(risk: string[], expectedType: string): RiskSignal[] {
  const mapped = risk.map((item) => {
    if (item === 'medical_caution') return 'medical_caution'
    if (item === 'legal_caution') return 'legal_caution'
    if (item === 'financial_caution') return 'financial_caution'
    if (item === 'unsafe_request') return 'unsafe_request'
    if (item === 'crisis') return 'crisis'
    if (item === 'protected_context') return 'protected_context'
    return null
  }).filter((item): item is RiskSignal => Boolean(item))

  if (expectedType === 'crisis' && !mapped.includes('protected_context')) mapped.push('protected_context')
  return Array.from(new Set(mapped))
}

function printDistribution(rows: ConvertedRow[]): void {
  const byIntent = count(rows.map((row) => row.expectedIntent))
  const byDomain = count(rows.map((row) => row.expectedDomain))
  console.log('\nIntent distribution:')
  for (const [key, value] of Object.entries(byIntent)) console.log(`  ${key}: ${value}`)
  console.log('\nDomain distribution:')
  for (const [key, value] of Object.entries(byDomain)) console.log(`  ${key}: ${value}`)
}

function count(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((acc, value) => {
    acc[value] = (acc[value] ?? 0) + 1
    return acc
  }, {})
}

