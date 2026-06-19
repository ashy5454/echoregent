import type { Message, RoutingFrame, WikiDocument } from './types.js'

export function createEmptyWiki(): WikiDocument {
  return {
    profile: [],
    patterns: [],
    activeContext: [],
    mistakes: [],
    behavioralSignals: [],
    version: 1,
    lastUpdated: new Date().toISOString(),
  }
}

export function ingestSession(existing: WikiDocument | null, session: Message[], frame: RoutingFrame): WikiDocument {
  const wiki = cloneWiki(existing ?? createEmptyWiki())
  const text = session.map((message) => message.content).join('\n')

  addUnique(wiki.patterns, `common_domain: ${frame.domain}`)
  addUnique(wiki.patterns, `recent_intent: ${frame.intent}`)

  const currentWork = extractCurrentWork(text)
  if (currentWork) addUnique(wiki.activeContext, currentWork)

  for (const preference of extractPreferences(text)) addUnique(wiki.behavioralSignals, preference)
  for (const profileFact of extractProfileFacts(text)) addUnique(wiki.profile, profileFact)
  for (const mistake of extractMistakes(text)) addUnique(wiki.mistakes, mistake)

  trimSection(wiki.profile, 10)
  trimSection(wiki.patterns, 12)
  trimSection(wiki.activeContext, 8)
  trimSection(wiki.mistakes, 8)
  trimSection(wiki.behavioralSignals, 12)

  wiki.version += existing ? 1 : 0
  wiki.lastUpdated = new Date().toISOString()
  return wiki
}

export function wikiToContextString(wiki: WikiDocument | null): string {
  if (!wiki) return ''
  return [
    renderSection('Profile', wiki.profile),
    renderSection('Patterns', wiki.patterns),
    renderSection('Active context', wiki.activeContext),
    renderSection('Recurring blockers', wiki.mistakes),
    renderSection('Behavioral signals', wiki.behavioralSignals),
  ].filter(Boolean).join('\n')
}

function cloneWiki(wiki: WikiDocument): WikiDocument {
  return {
    profile: [...wiki.profile],
    patterns: [...wiki.patterns],
    activeContext: [...wiki.activeContext],
    mistakes: [...wiki.mistakes],
    behavioralSignals: [...wiki.behavioralSignals],
    version: wiki.version,
    lastUpdated: wiki.lastUpdated,
  }
}

function renderSection(title: string, values: string[]): string {
  if (values.length === 0) return ''
  return `${title}:\n${values.map((value) => `- ${value}`).join('\n')}`
}

function addUnique(target: string[], value: string): void {
  const cleaned = compact(value)
  if (!cleaned || target.includes(cleaned)) return
  target.push(cleaned)
}

function trimSection(target: string[], max: number): void {
  while (target.length > max) target.shift()
}

function compact(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 90)
}

function extractCurrentWork(text: string): string | null {
  const match = text.match(/\b(?:building|working on|creating|making|debugging|launching)\s+([^.\n]{3,70})/i)
  return match ? `current_work: ${match[1].trim()}` : null
}

function extractPreferences(text: string): string[] {
  const preferences: string[] = []
  const lower = text.toLowerCase()
  if (lower.includes('typescript')) preferences.push('prefers_stack: TypeScript')
  if (lower.includes('python')) preferences.push('prefers_stack: Python')
  if (lower.includes('openrouter')) preferences.push('llm_provider_interest: OpenRouter')
  if (lower.includes('apk')) preferences.push('delivery_interest: Android APK')
  if (lower.includes('local') || lower.includes('laptop')) preferences.push('deployment_preference: local-first')
  return preferences
}

function extractProfileFacts(text: string): string[] {
  const facts: string[] = []
  const studyMatch = text.match(/\b(?:study at|student at|from)\s+([^.\n]{3,50})/i)
  if (studyMatch) facts.push(`profile_fact: ${studyMatch[1].trim()}`)
  return facts
}

function extractMistakes(text: string): string[] {
  const mistakes: string[] = []
  const lower = text.toLowerCase()
  if (lower.includes('error') || lower.includes('throws') || lower.includes('failing')) mistakes.push('blocker_pattern: recurring debugging/errors')
  if (lower.includes('not connected') || lower.includes('missing')) mistakes.push('blocker_pattern: missing integration surfaces')
  return mistakes
}

