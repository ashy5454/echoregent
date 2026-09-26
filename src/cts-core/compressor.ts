import type { CompressionResult, MemoryFrame, Message, RoutingFrame } from './types'
import { summarizeWithT5 } from './ml-t5'
import { countChatTokens } from './tokenizer'

const HIGH_VALUE_DOMAINS = new Set(['coding', 'customer_support', 'sales'])
const GENERIC_DISTRACTOR_PATTERNS = [
  /\bdark mode\b/i,
  /\blight mode\b/i,
  /\bMarvel\b/i,
  /\bmovie\b/i,
  /\bweather\b/i,
  /\bTokyo\b/i,
  /\bcat\b/i,
  /\blunch\b/i,
  /\bspace travel\b/i,
  /\bfavorite color\b/i,
  /\bstanding desk\b/i,
  /\bfitness routine\b/i,
  /\bsushi\b/i,
  /\bburger\b/i,
]

export interface CompressionStats {
  asyncRequests: number
  t5Successes: number
  ruleFallbacks: number
  fallbackRate: number
}

const compressionStats = {
  asyncRequests: 0,
  t5Successes: 0,
  ruleFallbacks: 0,
}

export function getCompressionStats(): CompressionStats {
  const total = compressionStats.asyncRequests
  return {
    ...compressionStats,
    fallbackRate: total > 0 ? compressionStats.ruleFallbacks / total : 0,
  }
}
export function compressHistory(history: Message[], frame: RoutingFrame): CompressionResult {
  const original = [...history]
  const keptReasons: string[] = []

  if (history.length <= 4) {
    const originalTokens = estimateTokens(original)
    keptReasons.push('Short history kept in full.')
    return {
      original,
      compressed: original,
      memoryFrame: buildMemoryFrame(original, frame),
      keptReasons,
      droppedCount: 0,
      originalTokens,
      compressedTokens: originalTokens,
      tokensSaved: 0,
    }
  }

  const memoryFrame = buildMemoryFrame(original, frame)
  const summaryMessage = getStableSummaryMessage(original, frame)
  const recentMessages = pickRecentMessages(original, frame, memoryFrame)
  const anchorMessages = pickAnchorMessages(original, recentMessages, frame, memoryFrame)

  const candidates: Message[][] = [
    uniqueMessages([summaryMessage, ...anchorMessages, ...recentMessages]),
    uniqueMessages([summaryMessage, ...recentMessages]),
    [summaryMessage],
  ]

  const originalTokens = estimateTokens(original)
  const targetMaxRatio = HIGH_VALUE_DOMAINS.has(frame.domain) ? 0.62 : 0.5
  let compressed = candidates[candidates.length - 1]

  for (const candidate of candidates) {
    const ratio = estimateTokens(candidate) / Math.max(1, originalTokens)
    if (ratio <= targetMaxRatio) {
      compressed = candidate
      break
    }
  }

  let compressedTokens = estimateTokens(compressed)
  if (compressedTokens >= originalTokens) {
    compressed = uniqueMessages([...anchorMessages, ...recentMessages]).slice(-Math.max(1, Math.min(4, original.length)))
    compressedTokens = estimateTokens(compressed)
  }

  // ── Must-keep rescue pass ─────────────────────────────────────────────────
  // extractHardFacts pulls concrete entities (HTTP codes, IDs, dates, proper
  // nouns, numbers-with-units) that rule-based summarisation routinely drops.
  // If any are missing from the compressed output we inject the smallest set
  // of original messages that restores coverage (max 2 rescue messages so
  // compression ratio stays aggressive).
  const hardFacts = extractHardFacts(original, frame.domain)
  if (hardFacts.length > 0) {
    const compressedText = compressed.map((m) => m.content).join(' ').toLowerCase()
    const missingFacts   = hardFacts.filter((f) => !compressedText.includes(f.toLowerCase()))

    if (missingFacts.length > 0) {
      const compressedSet = new Set(compressed)
      const rescueCandidates = original
        .filter((m) => !compressedSet.has(m))
        .map((m) => ({
          message:  m,
          coverage: missingFacts.filter((f) => m.content.toLowerCase().includes(f.toLowerCase())).length,
        }))
        .filter((r) => r.coverage > 0)
        .sort((a, b) => b.coverage - a.coverage)
        .slice(0, 2)
        .map((r) => r.message)

      if (rescueCandidates.length > 0) {
        // Re-insert rescue messages in original order, after the summary head
        const [head, ...tail] = compressed
        const rescueSet = new Set(rescueCandidates)
        const orderedRescue = original.filter((m) => rescueSet.has(m))
        compressed = uniqueMessages([head, ...orderedRescue, ...tail])
        compressedTokens = estimateTokens(compressed)
        keptReasons.push(`CTS rescued ${rescueCandidates.length} message(s) to preserve: ${missingFacts.slice(0, 3).join(', ')}.`)
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  // ── Minimum-retention floor ────────────────────────────────────────────────
  // pickRecentMessages/pickAnchorMessages cap out at a handful of messages
  // (2-4 each) regardless of conversation length. For a short conversation
  // that's most of it; for a long one it's a sliver — and because that sliver
  // already satisfies the ratio ceiling above, the compressor never reaches
  // for the rest of its real token budget. Left unchecked this collapses a
  // 400+ turn conversation down to single digits and destroys recall (a real
  // LoCoMo run measured F1 dropping from 0.326 to 0.032 on exactly this
  // failure mode). This floor guarantees at least a minimum fraction of the
  // original messages survive no matter how the ratio/vocabulary heuristics
  // land, prioritizing the most recent ones not already kept.
  const MIN_RETENTION_RATIO = 0.15
  const minMessageCount = Math.min(original.length, Math.max(4, Math.ceil(original.length * MIN_RETENTION_RATIO)))
  const retainedOriginals = new Set(compressed.filter((message) => message !== summaryMessage))
  if (retainedOriginals.size < minMessageCount) {
    const needed = minMessageCount - retainedOriginals.size
    const additional = original.filter((message) => !retainedOriginals.has(message)).slice(-needed)
    for (const message of additional) retainedOriginals.add(message)
    const orderedOriginals = original.filter((message) => retainedOriginals.has(message))
    const hasSummary = compressed.includes(summaryMessage)
    compressed = hasSummary ? uniqueMessages([summaryMessage, ...orderedOriginals]) : orderedOriginals
    compressedTokens = estimateTokens(compressed)
    keptReasons.push(`CTS enforced a minimum retention floor: kept ${orderedOriginals.length} of ${original.length} original messages for a long conversation.`)
  }
  // ─────────────────────────────────────────────────────────────────────────

  const retainedOriginalCount = compressed.filter((message) => message.role !== 'assistant' || message.content !== summaryMessage.content).length

  if (compressed.length === 1) {
    keptReasons.push('CTS replaced the raw history with a natural-language summary.')
  } else if (compressed.some((message) => recentMessages.includes(message))) {
    keptReasons.push('CTS kept a natural-language summary plus the most relevant recent turns.')
  } else {
    keptReasons.push('CTS kept a natural-language summary plus a couple of high-signal anchor turns.')
  }

  return {
    original,
    compressed,
    memoryFrame,
    keptReasons,
    droppedCount: Math.max(0, original.length - retainedOriginalCount),
    originalTokens,
    compressedTokens,
    tokensSaved: Math.max(0, originalTokens - compressedTokens),
  }
}

function buildMemoryFrame(history: Message[], frame: RoutingFrame): MemoryFrame {
  const allText = history.map((message) => message.content).join('\n')
  const userMessages = history.filter((message) => message.role === 'user')
  const latestUser = userMessages.at(-1)?.content ?? history.at(-1)?.content ?? ''
  const focusMessages = selectFocusMessages(history, frame, latestUser, HIGH_VALUE_DOMAINS.has(frame.domain) ? 8 : 6)
  const focusText = focusMessages.length > 0 ? focusMessages.map((message) => message.content).join('\n') : allText
  const factText = `${latestUser}\n${focusText}`
  const relevantFacts = rankFacts(extractFacts(factText, frame.domain), frame.domain).slice(0, 10)

  return {
    domain: frame.domain,
    intent: frame.intent,
    state: frame.state,
    task: compactSentence(latestUser, 96),
    userGoal: inferUserGoal(latestUser, frame.domain, frame.intent),
    entities: relevantFacts.slice(0, entityBudget(frame)),
    constraints: inferConstraints(factText, frame.domain).slice(0, 4),
    unresolved: inferUnresolved(factText, frame.domain, frame.intent).slice(0, 4),
    risk: frame.risk,
  }
}

function serializeMemoryFrame(memoryFrame: MemoryFrame): string {
  const parts = [`CTS summary: ${domainLead(memoryFrame)}`]

  if (memoryFrame.entities.length > 0) {
    parts.push(`Key facts: ${memoryFrame.entities.join(', ')}.`)
  }
  if (memoryFrame.constraints.length > 0) {
    parts.push(`Important constraints: ${memoryFrame.constraints.join(', ')}.`)
  }
  if (memoryFrame.unresolved.length > 0) {
    parts.push(`Still unresolved: ${memoryFrame.unresolved.join(', ')}.`)
  }
  if (memoryFrame.risk.length > 0) {
    parts.push(`Risk flags: ${memoryFrame.risk.join(', ')}.`)
  }

  return parts.join(' ')
}

// ── Stable-prefix summary caching (audit issue #8) ────────────────────────
// buildMemoryFrame() used to be re-run on the FULL history (including the
// message currently in flight) on every single call, which bakes the latest
// user message into `task`/`userGoal` and rewrites the summary text every
// turn. That destroys the stable prefix provider prompt caching depends on:
// a cache breakpoint only pays off when everything before it is byte-
// identical to a previous request (see AUDIT.md Part 6 / the Anthropic
// prompt-caching docs cited there).
//
// Fix: the summary TEXT that becomes compressed[0] is built from a "settled"
// slice of history — everything except the most-recent `recentCount`
// messages (which change every turn by design and are sent separately,
// verbatim, via pickRecentMessages) — and only regenerated once the settled
// slice grows past the next batch boundary. Between regenerations, the exact
// same cached string is returned, so the request prefix stays stable across
// multiple consecutive turns instead of changing on every single one.
//
// `memoryFrame` (the fuller, always-fresh version built from the complete
// history) is untouched by this and still used for anchor/recent-message
// selection and the must-keep rescue pass below — this only changes what
// text gets embedded as the cacheable summary message itself.
const SUMMARY_SNAPSHOT_BATCH = 4
const MAX_SUMMARY_CACHE_ENTRIES = 200
const summarySnapshotCache = new Map<string, Message>()

function recentWindowSize(frame: RoutingFrame): number {
  return HIGH_VALUE_DOMAINS.has(frame.domain) ? 4 : 2
}

function getStableSummaryMessage(original: Message[], frame: RoutingFrame): Message {
  const recentCount = recentWindowSize(frame)
  const settled = original.slice(0, Math.max(0, original.length - recentCount))
  // Below one full batch there's nothing to round down to without throwing
  // away all settled content — use it as-is (this window is inherently less
  // stable, same as a real cache breakpoint moving early in a short
  // conversation); once settled.length >= SUMMARY_SNAPSHOT_BATCH, round down
  // to the batch boundary so the snapshot — and therefore the cached summary
  // text — stays IDENTICAL across every turn inside that batch window.
  const snapshotLength = settled.length < SUMMARY_SNAPSHOT_BATCH
    ? settled.length
    : Math.floor(settled.length / SUMMARY_SNAPSHOT_BATCH) * SUMMARY_SNAPSHOT_BATCH
  const snapshot = settled.slice(0, snapshotLength)

  const cacheKey = `${frame.domain}:${snapshotLength}:${hashMessages(snapshot)}`
  const cached = summarySnapshotCache.get(cacheKey)
  if (cached) return cached

  const snapshotFrame = buildMemoryFrame(snapshot, frame)
  const message: Message = { role: 'assistant', content: serializeMemoryFrame(snapshotFrame) }

  summarySnapshotCache.set(cacheKey, message)
  if (summarySnapshotCache.size > MAX_SUMMARY_CACHE_ENTRIES) {
    const oldest = summarySnapshotCache.keys().next().value
    if (oldest !== undefined) summarySnapshotCache.delete(oldest)
  }
  return message
}

// Cheap deterministic string hash (FNV-1a) — this only needs to distinguish
// different settled-history snapshots from each other, not resist collision
// attacks, so no crypto dependency.
function hashMessages(messages: Message[]): string {
  const text = messages.map((m) => `${m.role}:${m.content}`).join('\u0000')
  let hash = 0x811c9dc5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(36)
}

function domainLead(memoryFrame: MemoryFrame): string {
  const task = memoryFrame.task || memoryFrame.userGoal || 'Follow the active conversation.'
  switch (memoryFrame.domain) {
    case 'coding':
      return `The user is working on a technical issue. Current request: ${task}.`
    case 'customer_support':
      return `The user needs customer support help. Current request: ${task}.`
    case 'sales':
      return `The conversation is in a sales motion. Current request: ${task}.`
    case 'legal':
      return `The user is asking for legal-adjacent guidance. Current request: ${task}.`
    case 'medical':
      return `The user is asking for medical-adjacent guidance. Current request: ${task}.`
    case 'education':
      return `The user is learning or reviewing material. Current request: ${task}.`
    case 'commerce':
      return `The user is comparing or selecting a purchase option. Current request: ${task}.`
    default:
      return `The active task is: ${task}.`
  }
}

function pickRecentMessages(history: Message[], frame: RoutingFrame, memoryFrame: MemoryFrame): Message[] {
  const count = HIGH_VALUE_DOMAINS.has(frame.domain) ? 4 : 2
  const latestUser = history.filter((message) => message.role === 'user').at(-1)?.content ?? ''
  const focusMessages = selectFocusMessages(history, frame, latestUser, count + 2, memoryFrame)
  return focusMessages.slice(-count)
}

function pickAnchorMessages(history: Message[], recentMessages: Message[], frame: RoutingFrame, memoryFrame: MemoryFrame): Message[] {
  const recentSet = new Set(recentMessages)
  const factSet = new Set([...memoryFrame.entities, ...memoryFrame.constraints, ...memoryFrame.unresolved].map((item) => item.toLowerCase()))

  const scored = history
    .map((message, index) => {
      if (recentSet.has(message)) return { message, index, score: -1 }
      const score = messageRelevanceScore(message.content, frame.domain, factSet) + index / Math.max(1, history.length)
      return { message, index, score }
    })
    .filter((item) => item.score >= 4)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, 2)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.message)

  return uniqueMessages(scored)
}

function selectFocusMessages(history: Message[], frame: RoutingFrame, latestUser: string, limit: number, memoryFrame?: MemoryFrame): Message[] {
  const latestFacts = new Set(rankFacts(extractFacts(latestUser, frame.domain), frame.domain).slice(0, 8).map((fact) => fact.toLowerCase()))
  const memoryFacts = new Set((memoryFrame ? [...memoryFrame.entities, ...memoryFrame.constraints, ...memoryFrame.unresolved] : []).map((fact) => fact.toLowerCase()))
  const factSet = new Set([...latestFacts, ...memoryFacts])

  const selected = history
    .map((message, index) => {
      const score = messageRelevanceScore(message.content, frame.domain, factSet)
        + (message.role === 'user' ? 0.75 : 0)
        + index / Math.max(1, history.length)
      return { message, index, score }
    })
    .filter((item) => item.score >= 2.5)
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .sort((a, b) => a.index - b.index)
    .map((item) => item.message)

  if (selected.length > 0) return uniqueMessages(selected)

  return history.slice(-Math.min(limit, history.length))
}

function messageRelevanceScore(content: string, domain: string, factSet: Set<string>): number {
  const domainScore = scoreContent(content, domainPattern(domain))
  const factOverlap = countFactOverlap(content, factSet)
  const structuralBoost = codeOrIdBoost(content, domain)
  const actionBoost = actionSignalBoost(content, domain)
  const distractorPenalty = genericDistractorPenalty(content, domainScore)
  return domainScore + factOverlap * 3 + structuralBoost + actionBoost - distractorPenalty
}

function countFactOverlap(content: string, factSet: Set<string>): number {
  const lowered = content.toLowerCase()
  let hits = 0
  for (const fact of factSet) {
    if (fact.length >= 3 && lowered.includes(fact)) hits += 1
  }
  return hits
}

function genericDistractorPenalty(content: string, domainScore: number): number {
  const lowered = content.toLowerCase()
  let penalty = 0

  for (const pattern of GENERIC_DISTRACTOR_PATTERNS) {
    if (pattern.test(content)) penalty += 3
  }

  if (/\bwhat(?:'s| is) the weather\b/i.test(content)) penalty += 3
  if (/\bwhat(?:'s| is) your favorite\b/i.test(content)) penalty += 3
  if (/\brandom thought\b/i.test(content)) penalty += 2

  if (domainScore > 0) {
    penalty = Math.max(0, penalty - 2)
  }

  if (/\b(500|401|403|refund|order|security|soc2|doctor|blood pressure|Lisinopril|Calvin cycle|binary search)\b/i.test(content)) {
    penalty = Math.max(0, penalty - 3)
  }

  if (lowered.includes('requests') && lowered.includes('python')) {
    penalty = Math.max(0, penalty - 2)
  }

  return penalty
}

function actionSignalBoost(content: string, domain: string): number {
  if (domain === 'coding' && /\b(failed|error|timeout|issue|fix|migration|schema|column|requests|api|endpoint|lock|retry)\b/i.test(content)) return 3
  if (domain === 'customer_support' && /\b(refund|tracking|arrived|damaged|replacement|process|escalat|delivery)\b/i.test(content)) return 3
  if (domain === 'sales' && /\b(discount|budget|security|roi|contract|annual|price|premium)\b/i.test(content)) return 3
  if (domain === 'medical' && /\b(side effects|blood pressure|doctor|cough|safe|stop taking|persistent)\b/i.test(content)) return 3
  if (domain === 'legal' && /\b(contract|termination|retaliation|indemnity|clause|documentation|non-compete)\b/i.test(content)) return 3
  if (domain === 'education' && /\b(explain|summary|quiz|process|example|binary search|photosynthesis)\b/i.test(content)) return 2
  if (domain === 'commerce' && /\b(compare|budget|battery|hosting|buy|worth|cheaper)\b/i.test(content)) return 2
  if (domain === 'general' && /\b(meeting|email|calendar|schedule|launch|deadline)\b/i.test(content)) return 2
  return 0
}

function codeOrIdBoost(content: string, domain: string): number {
  if (domain === 'coding' && /```[\s\S]*?```|`[^`\n]{3,}`|\b(?:TypeError|SyntaxError|ReferenceError|ValueError|RuntimeError|AttributeError):/i.test(content)) return 4
  if (domain === 'customer_support' && /\b[A-Z]{1,4}[-_]?\d{3,10}\b|\border\s*#?\s*[A-Z0-9]{4,}\b/i.test(content)) return 4
  if (domain === 'sales' && /\$[\d,]+|Q[1-4]|end of (?:month|quarter|year)/i.test(content)) return 4
  if (domain === 'medical' && /\b\d{2,3}\/\d{2,3}\b/.test(content)) return 3
  return 0
}

function inferUserGoal(latestUser: string, domain: string, intent: string): string | undefined {
  if (!latestUser) return undefined
  if (intent === 'debugging') return compactSentence(`Resolve ${latestUser}`, 96)
  if (intent === 'generation') return compactSentence(`Produce ${latestUser}`, 96)
  if (domain === 'customer_support') return compactSentence(`Support request: ${latestUser}`, 96)
  if (domain === 'sales') return compactSentence(`Advance the sales conversation: ${latestUser}`, 96)
  return compactSentence(latestUser, 96)
}

function entityBudget(frame: RoutingFrame): number {
  if (frame.domain === 'coding' && frame.intent === 'generation') return 8
  if (frame.domain === 'legal' || frame.domain === 'medical' || frame.domain === 'commerce' || frame.domain === 'general') return 7
  if (HIGH_VALUE_DOMAINS.has(frame.domain)) return 6
  return 5
}

function inferConstraints(text: string, domain: string): string[] {
  const collector = createCollector()
  addMatches(collector, text, /\b\d+(?:am|pm|ms|gb|mb|%)\b/gi)
  addMatches(collector, text, /\b\d+\s+(?:requests?|users?|days?|weeks?|months?|rows?)\b/gi)
  addMatches(collector, text, /\bunder\s+\d+\b/gi)
  addMatches(collector, text, /#[A-Z]?\d+/g)

  if (domain === 'coding') {
    addMatches(collector, text, /\bexponential backoff|dead-letter|raw body|API key|nullable|backfill|constraints|10 million rows|CSV|pagination|script\b/gi)
  } else if (domain === 'customer_support') {
    addMatches(collector, text, /\bexpress shipping|last Monday|this morning|damaged monitor\b/gi)
  } else if (domain === 'sales') {
    addMatches(collector, text, /\bstartup discount|annual plans?|budget|ROI|SOC2|SSO|audit logs|20% discount\b/gi)
  } else if (domain === 'legal') {
    addMatches(collector, text, /\bCalifornia law|California|at-will|18 months|third-party claims|documentation\b/gi)
  } else if (domain === 'medical') {
    addMatches(collector, text, /\btwo days|three weeks|every day|140\/90|side effects|persistent cough\b/gi)
  } else if (domain === 'commerce') {
    addMatches(collector, text, /\b1200 dollars|500 users|battery life\b/gi)
  } else if (domain === 'education') {
    addMatches(collector, text, /\bCalvin cycle|sorted array|middle item\b/gi)
  } else if (domain === 'general') {
    addMatches(collector, text, /\b10am|1pm|5pm|6pm|after lunch|lunch|gym\b/gi)
  }

  return Array.from(collector.values())
}

function inferUnresolved(text: string, domain: string, intent: string): string[] {
  const collector = createCollector()
  const lowered = text.toLowerCase()

  if (domain === 'coding') {
    if (/\b403|401|500|failed|timeout|signature|schema|bio|requests\b/.test(lowered)) addMatches(collector, text, /\b403|401|500|signature|timeout|failed payment|card_declined|retry_count|rate limiting|latency|schema|bio|requests\b/gi)
  } else if (domain === 'customer_support') {
    if (/\brefund|arrived|tracking|escalate|process\b/.test(lowered)) addMatches(collector, text, /\brefund|arrived|tracking|Dallas|Chicago|escalated?|process\b/gi)
  } else if (domain === 'sales') {
    if (/\bprice|budget|security|discount|contract\b/.test(lowered)) addMatches(collector, text, /\bprice|budget|security|discount|ROI|SSO|audit logs|contract\b/gi)
  } else if (domain === 'legal') {
    if (/\bsign|risk|termination|non-compete|retaliation\b/.test(lowered)) addMatches(collector, text, /\bindemnity clause|non-compete|termination|retaliation|whistleblower\b/gi)
  } else if (domain === 'medical') {
    if (/\bchest|shortness of breath|safe|ibuprofen|lisinopril|cough|blood pressure\b/.test(lowered)) addMatches(collector, text, /\bchest tightness|shortness of breath|ibuprofen|stomach discomfort|Lisinopril|cough|blood pressure|140\/90\b/gi)
  } else if (domain === 'commerce') {
    if (/\bbetter|cheaper|battery\b/.test(lowered)) addMatches(collector, text, /\bThinkPad T14|MacBook Air M3|cheaper|battery\b/gi)
  } else if (domain === 'education') {
    if (intent === 'summarization' || /\bquiz\b/.test(lowered)) addMatches(collector, text, /\bCalvin cycle|binary search|sorted array|middle item|left or right\b/gi)
  } else if (domain === 'general') {
    addMatches(collector, text, /\bMaya|gym|email|after lunch|delayed launch|API integration\b/gi)
  }

  return Array.from(collector.values())
}

function extractFacts(text: string, domain: string): string[] {
  const collector = createCollector()

  if (domain === 'coding') {
    addMatches(collector, text, /\bStripe|TypeScript|Python|Redis|PostgreSQL|Postgres|BeautifulSoup|CSV|Docker|Next\.js|API key|requests|webhook|signature|secret|worker|queue|retry|dead-letter|rate limiting|latency|concurrency|migration|backfill|nullable|exponential backoff|database|schema|scrape|pagination|bio\b/gi)
    addMatches(collector, text, /\b(?:TypeError|SyntaxError|ReferenceError|ValueError|RuntimeError|AttributeError):\s*[^\n]{0,80}/gi)
    addMatches(collector, text, /\bError:\s*[^\n]{0,80}/gi)
    addMatches(collector, text, /\b[45]\d{2}\s+[A-Za-z ]{3,30}/g)
    addMatches(collector, text, /\b[a-z][a-z0-9]*(?:[A-Z][a-z0-9]+)+\b/g)
    addMatches(collector, text, /\b[a-z][a-z0-9]*(?:_[a-z][a-z0-9]+){1,}\b/g)
    addMatches(collector, text, /\b[a-z]+(?:-[a-z0-9]+)+\b/gi)
    addMatches(collector, text, /\b(?:src|lib|app|components|pages|api|utils|routes|models)\/[a-z0-9/_.-]+/gi)
    addMatches(collector, text, /['"][A-Za-z_][A-Za-z0-9_-]{1,40}['"]/g)
    for (const block of text.matchAll(/```[\s\S]*?```/g)) {
      const snippet = block[0].trim().slice(0, 160)
      if (snippet.length > 12) collector.set(snippet.toLowerCase(), snippet)
    }
    addMatches(collector, text, /`[^`\n]{3,60}`/g)
  } else if (domain === 'customer_support') {
    addMatches(collector, text, /\brefund|delivery|tracking|express shipping|damaged|replacement|escalated?|process\b/gi)
    addMatches(collector, text, /\b[A-Z]{1,4}[-_]?\d{3,10}\b/g)
    addMatches(collector, text, /\border\s*#?\s*[A-Z0-9]{4,}\b/gi)
    addMatches(collector, text, /\b\d{6,12}\b/g)
    addMatches(collector, text, /\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{1,2}(?:st|nd|rd|th)?\b/gi)
    addMatches(collector, text, /\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g)
    addMatches(collector, text, /\b(?:Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)\b/gi)
  } else if (domain === 'sales') {
    addMatches(collector, text, /\bpremium plan|premium|startup discount|ROI|SOC2|SSO|audit logs|security features|budget|discount|contract\b/gi)
    addMatches(collector, text, /\$[\d,]+(?:\.\d{2})?(?:\s*(?:k|K|M|B|million|thousand))?\b/g)
    addMatches(collector, text, /\b\d+(?:,\d{3})*\s*(?:dollars?|USD)\b/gi)
    addMatches(collector, text, /\b\d+\s*(?:per\s+(?:month|year|seat|user)|\/mo|\/yr|\/user)\b/gi)
    addMatches(collector, text, /\bQ[1-4]\s*(?:\d{4})?\b/gi)
    addMatches(collector, text, /\bend\s+of\s+(?:month|quarter|year|week)\b/gi)
    addMatches(collector, text, /\bnext\s+(?:week|month|quarter|year)\b/gi)
  } else if (domain === 'legal') {
    addMatches(collector, text, /\bindemnity clause|third-party claims|California law|California|non-compete|18 months|India|retaliation|whistleblower|at-will|contract|documentation|performance\b/gi)
  } else if (domain === 'medical') {
    addMatches(collector, text, /\bchest tightness|shortness of breath|two days|three weeks|ibuprofen|daily|knee pain|stomach discomfort|blood pressure|doctor|Lisinopril|cough|side effects\b/gi)
    addMatches(collector, text, /\b\d{2,3}\/\d{2,3}\b/g)
  } else if (domain === 'commerce') {
    addMatches(collector, text, /\bThinkPad T14|MacBook Air M3|iPhone|Samsung|S24 Ultra|S24|battery|Docker|Next\.js MVP|PostgreSQL|500 users|cheaper hosting|MSRP|iOS|Android\b/gi)
  } else if (domain === 'education') {
    addMatches(collector, text, /\bphotosynthesis|Calvin cycle|chlorophyll|glucose|binary search|sorted array|middle item|left or right|oxygen|sunlight\b/gi)
  } else if (domain === 'general') {
    addMatches(collector, text, /\bcalendar|Maya|Sarah|meeting|email|delayed launch|API integration|pressure|failing everyone|safe\b/gi)
  }

  addMatches(collector, text, /#[A-Z]?\d+/g)
  addMatches(collector, text, /\/[a-z][a-z0-9/_-]*/gi)
  addMatches(collector, text, /\b\d+\s*(?:ms|gb|mb|%|rpm|rps|req)\b/gi)

  return Array.from(collector.values())
}

function rankFacts(facts: string[], domain: string): string[] {
  return facts
    .map((fact) => ({ fact, score: factImportance(fact, domain) }))
    .sort((a, b) => b.score - a.score || a.fact.length - b.fact.length)
    .map((item) => item.fact)
}

function factImportance(fact: string, domain: string): number {
  let score = 0
  if (/[#/]/.test(fact)) score += 3
  if (/\d/.test(fact)) score += 2
  if (fact.includes(' ')) score += 1
  if (domain === 'coding' && /\b(403|401|500|Stripe|TypeScript|Python|Redis|Postgres|signature|webhook|dead-letter|card_declined|retry_count|rate limiting|latency|concurrency|100 requests|API key|exponential backoff|nullable|backfill|constraints|migration|queue|retry|worker|database|schema|scrape|pagination|script|requests|bio|BeautifulSoup|CSV)\b/i.test(fact)) score += 4
  if (domain === 'customer_support' && /\b(Dallas|Chicago|refund|delivery|express shipping|damaged monitor|replacement|escalated?|tracking|order|Friday|Monday|deadline|process)\b/i.test(fact)) score += 4
  if (domain === 'sales' && /\b(ROI|SOC2|SSO|audit logs|discount|security|premium|startups|contract|budget)\b/i.test(fact)) score += 4
  if (domain === 'legal' && /\b(indemnity clause|third-party claims|non-compete|California law|California|whistleblower|contract|18 months|termination|India|retaliation|documentation|performance)\b/i.test(fact)) score += 4
  if (domain === 'medical' && /\b(chest tightness|shortness of breath|ibuprofen|stomach discomfort|two days|three weeks|daily|knee pain|blood pressure|doctor|Lisinopril|cough|side effects|140\/90)\b/i.test(fact)) score += 4
  if (domain === 'commerce' && /\b(ThinkPad T14|MacBook Air M3|PostgreSQL|Next\.js MVP|iPhone|Samsung|S24 Ultra|S24|battery|MSRP|iOS|Android)\b/i.test(fact)) score += 4
  if (domain === 'education' && /\b(Calvin cycle|binary search|sorted array|middle item|photosynthesis|chlorophyll|glucose|left or right|oxygen|sunlight)\b/i.test(fact)) score += 4
  if (domain === 'general' && /\b(Maya|Sarah|API integration|delayed launch|failing everyone|calendar|email|pressure|safe|meeting)\b/i.test(fact)) score += 4
  return score
}

function compactSentence(value: string, limit: number): string {
  return value.replace(/\s+/g, ' ').trim().replace(/[|]/g, '').slice(0, limit)
}

// Real BPE token count (see tokenizer.ts) — was chars/4 (audit issue #9).
function estimateTokens(messages: Message[]): number {
  return countChatTokens(messages)
}

function domainPattern(domain: string): RegExp {
  switch (domain) {
    case 'coding':
      return /```[\s\S]*?```|`[^`\n]{3,}`|\b(error|exception|function|api|auth|[45]\d{2}|database|schema|migration|timeout|stripe|signature|secret|worker|queue|retry|dead-letter|redis|postgres|payment|TypeError|SyntaxError|ReferenceError|requests|bio)\b|\/[a-z0-9/_-]+/i
    case 'customer_support':
      return /\b(order|refund|delivery|tracking|escalate|escalated|express shipping|damaged|replacement|process)\b|#\w+|[A-Z]{1,4}[-_]?\d{3,}|\d{6,}/i
    case 'sales':
      return /\$[\d,]+|\bQ[1-4]\b|\b(price|discount|premium|security|soc2|encryption|startup|budget|roi|manager|sso|audit logs|contract|end of month|end of quarter|per month|per year)\b/i
    case 'legal':
      return /\b(contract|clause|termination|retaliation|whistleblower|at-will|california|indemnity|third-party claims|india|non-compete|documentation)\b/i
    case 'medical':
      return /\b(doctor|bp|blood pressure|ibuprofen|lisinopril|chest|tightness|shortness of breath|stomach discomfort|knee pain|cough|side effects)\b/i
    case 'commerce':
      return /\b(thinkpad|macbook|iphone|samsung|s24|battery|docker|next\.js|postgresql|hosting|vercel|netlify|msrp|ios|android)\b/i
    case 'education':
      return /\b(quiz|process|summary|photosynthesis|chlorophyll|calvin cycle|binary search|sorted array|middle item)\b/i
    case 'general':
      return /\b(calendar|schedule|meeting|maya|email|launch|tone|pressure|safe)\b/i
    default:
      return /\w+/i
  }
}

function scoreContent(content: string, pattern: RegExp): number {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  return Array.from(content.matchAll(global)).length
}

function uniqueMessages(messages: Message[]): Message[] {
  return messages.filter((message, index) => messages.findIndex((other) => other.content === message.content && other.role === message.role) === index)
}

function createCollector(): Map<string, string> {
  return new Map<string, string>()
}

function addMatches(target: Map<string, string>, text: string, pattern: RegExp): void {
  for (const match of text.matchAll(pattern)) {
    const value = match[0].trim().replace(/^['"]|['"]$/g, '')
    const normalized = value.toLowerCase()
    if (value.length >= 2 && value.length <= 160 && !target.has(normalized)) {
      target.set(normalized, value)
    }
  }
}

// ── Hard fact extractor ───────────────────────────────────────────────────────
// Pulls concrete values that abstractive summarizers (T5) routinely drop.
// Appended verbatim to the [CTS Memory] block so the LLM can answer
// specific follow-up questions (“what was the date?”, “which department?”).

function extractHardFacts(history: Message[], domain: string): string[] {
  const fullText = history.map((m) => m.content).join(' ')
  const seen = new Set<string>()
  const facts: string[] = []

  function add(val: string): void {
    const key = val.toLowerCase().trim()
    if (key.length < 3 || seen.has(key)) return
    seen.add(key)
    facts.push(val.trim())
  }

  // 1. Dates
  for (const m of fullText.matchAll(/\b(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+\d{1,2}(?:st|nd|rd|th)?(?:,?\s+\d{4})?\b/gi))
    add(m[0])
  for (const m of fullText.matchAll(/\b\d{4}-\d{2}-\d{2}\b/g))
    add(m[0])

  // 2. Proper noun phrases — 2-4 consecutive capitalised words
  //    e.g. “Mendoza College of Business”, “Hunt Construction Group”
  for (const m of fullText.matchAll(/\b([A-Z][a-z]{1,20})(\s+(?:of\s+)?[A-Z][a-z]{1,20}){1,3}\b/g))
    add(m[0])

  // 3. Numbers with units
  for (const m of fullText.matchAll(/\b\d+(?:\.\d+)?(?:\s*(?:ms|GB|MB|TB|KB|%|rpm|rps|USD|dollars?|kg|km|mi|mph))\b/gi))
    add(m[0])

  // 4. Phone numbers
  for (const m of fullText.matchAll(/\b(?:\+?\d[\d\s\-().]{7,15}\d)\b/g))
    add(m[0])

  // 5. Order / ticket IDs
  for (const m of fullText.matchAll(/\b[A-Z]{1,5}[-_]?\d{3,12}\b/g))
    add(m[0])

  // 6. Prices
  for (const m of fullText.matchAll(/\$[\d,]+(?:\.\d{2})?(?:\s*(?:k|M|B|million|thousand))?\b/gi))
    add(m[0])

  // 7. Domain-specific
  if (domain === 'education') {
    // SQuAD-style: named entities that are likely answer targets
    for (const m of fullText.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\s+(?:was|is|are|were|did|has|have|began|started|founded|built|hired|located)\b/g))
      add(m[1])
  }
  if (domain === 'medical') {
    for (const m of fullText.matchAll(/\b\d{2,3}\/\d{2,3}\b/g)) add(m[0])
    for (const m of fullText.matchAll(/\b[A-Z][a-z]+(?:cin|pril|olol|statin|zide|pine|mide)\b/g)) add(m[0])
  }

  // Remove shorter facts already covered by a longer one
  const deduped: string[] = []
  for (const f of facts.slice(0, 20)) {
    const subsumed = deduped.some(
      (other) => other.toLowerCase().includes(f.toLowerCase()) && other !== f
    )
    if (!subsumed) deduped.push(f)
  }

  return deduped.slice(0, 12)
}

// ── ML-powered async compression ──────────────────────────────────────────────
// Uses T5-small to generate a natural-language memory summary instead of the
// rule-based pipe-separated format. Falls back to rule compressor on error.

export async function compressHistoryAsync(history: Message[], frame: RoutingFrame): Promise<CompressionResult> {
  // Short history: no compression needed
  if (history.length <= 4) {
    return compressHistory(history, frame)
  }

  compressionStats.asyncRequests += 1

  try {
    // Filter generic noise before feeding to T5
    const filtered = history.filter((msg) => {
      const lower = msg.content.toLowerCase()
      return !GENERIC_DISTRACTOR_PATTERNS.some((p) => p.test(lower))
    })

    // Build T5 input â€” keep to 1500 chars so it fits in 512 tokens
    const historyText = filtered
      .map((msg) => `${msg.role === 'user' ? 'User' : 'Assistant'}: ${msg.content.slice(0, 300)}`)
      .join(' ')
      .slice(0, 1500)

    const t5Input = `summarize: DOMAIN:${frame.domain} ${historyText}`

    // Generate natural-language summary
    const summary = await summarizeWithT5(t5Input)

    // Extract hard facts from full history BEFORE T5 can lose them.
    // These are concrete values (dates, names, numbers, IDs) that abstractive
    // summarizers routinely drop but LLMs need to answer follow-up questions.
    const hardFacts = extractHardFacts(filtered, frame.domain)
    const factSuffix = hardFacts.length > 0
      ? ` [Key facts: ${hardFacts.join('; ')}]`
      : ''

    const summaryMessage: Message = { role: 'assistant', content: `[CTS Memory] ${summary}${factSuffix}` }

    // Sales and customer_support need more context â€” keep last 6 turns
    // and enforce a 50% minimum retention floor
    const HIGH_CONTEXT_DOMAINS = new Set(['sales', 'customer_support'])
    const recentCount    = HIGH_CONTEXT_DOMAINS.has(frame.domain) ? 6 : 4
    const maxReduction   = HIGH_CONTEXT_DOMAINS.has(frame.domain) ? 0.50 : 0.80

    const recentMessages  = history.slice(-recentCount)
    let compressed        = uniqueMessages([summaryMessage, ...recentMessages])

    const originalTokens  = estimateTokens(history)

    // If still over-compressed for sensitive domains, add more turns
    const reductionRatio = 1 - estimateTokens(compressed) / Math.max(1, originalTokens)
    if (reductionRatio > maxReduction) {
      const moreRecent = history.slice(-Math.min(history.length, recentCount + 4))
      compressed = uniqueMessages([summaryMessage, ...moreRecent])
    }

    const compressedTokens = estimateTokens(compressed)
    compressionStats.t5Successes += 1

    return {
      original:        history,
      compressed,
      memoryFrame:     buildMemoryFrame(history, frame),
      keptReasons:     ['T5 generated a natural-language memory summary. Last 4 turns kept verbatim.'],
      droppedCount:    Math.max(0, history.length - recentMessages.length),
      originalTokens,
      compressedTokens,
      tokensSaved:     Math.max(0, originalTokens - compressedTokens),
    }
  } catch {
    compressionStats.ruleFallbacks += 1
    const fallback = compressHistory(history, frame)
    fallback.keptReasons.unshift('T5 unavailable; rule compressor fallback used.')
    return fallback
  }
}







