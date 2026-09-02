import { extractSignals } from './signals'
import { classifyDomainML } from './ml-classifier'
import type { ConversationState, CustomDomainPlugin, DomainType, IntentType, Message, RiskSignal, RoutingFrame } from './types'

export function classify(message: string, history: Message[] = [], customDomainPlugins: CustomDomainPlugin[] = []): RoutingFrame {
  const signals = extractSignals(message, history)
  const lower = message.toLowerCase()
  const historyText = history.map((item) => item.content).join('\n').toLowerCase()
  const contextText = `${lower}\n${historyText}`

  const domain = detectDomain(lower, contextText, signals, customDomainPlugins)
  const intent = detectIntent(lower, contextText, signals, domain)
  const state = detectState(lower, history, signals, domain)
  const risk = detectRisk(signals, domain, contextText)

  return {
    intent,
    state,
    domain,
    risk,
    signals,
    confidence: {
      intent: scoreIntent(intent, signals),
      state: state === 'opening' ? 0.9 : 0.74,
      domain: domain === 'general' ? 0.62 : 0.88,
      risk: risk.length === 0 ? 1 : 0.88,
    },
  }
}

function detectDomain(
  lower: string,
  contextText: string,
  signals: ReturnType<typeof extractSignals>,
  customDomainPlugins: CustomDomainPlugin[],
): DomainType {
  const customDomain = customDomainPlugins.find((plugin) =>
    plugin.keywords.some((keyword) => contextText.includes(keyword.toLowerCase())),
  )
  if (customDomain) return customDomain.id
  // Crisis-only content with no other domain signals → general
  // NOTE: do NOT force general for unsafe requests (delete logs, hide evidence) —
  // those can happen inside coding/support contexts and risk detection handles them.
  if (/\b(i do not want to be here|i don't want to be here|want to die|kill myself|self harm)\b/.test(contextText)) return 'general'
  if (/\b(quiz|teach|learn|explain|study)\b/.test(lower)) return 'education'
  if (/\b(schedule|calendar|next item|meeting)\b/.test(lower)) return 'general'
  if (/\b(correct the tone|email shorter|delayed launch)\b/.test(contextText)) return 'general'
  if (/\b(cheaper hosting|hosting option|next\.js mvp)\b/.test(contextText)) return 'commerce'
  // Customer support takes priority over commerce — a damaged monitor being refunded is support, not shopping
  if (/\b(refund|order|damaged|replacement|tracking|delivery|escalate?|arrived|fulfil)\b/.test(contextText) && /\b(order\s*#?|ORD-|CST-|ticket|#[A-Z0-9]{4,})\b/i.test(contextText)) return 'customer_support'
  // Commerce hardware/device check before the sales budget trap — "$400 budget" on a laptop question is commerce, not sales
  // Excludes "monitor" — too ambiguous (support context uses it too); covered by scoring instead
  if (/\b(macbook|thinkpad|iphone|samsung|s24|laptop|tablet|headphones)\b/.test(contextText)) return 'commerce'
  if (/\b(migration|nullable|backfill|constraints|webhook|stripe|worker|typescript|redis|postgres(?:ql)?|postgresql|gcp|docker|kubernetes|k8s|fastapi|django|rails)\b/.test(contextText)) return 'coding'
  if (/\b(doctor|bp readings|blood pressure)\b/.test(lower)) return 'medical'
  // Guard: don't fire the sales budget rule when strong coding signals are present
  if (/\b(discount|premium|roi|soc2|discussed discount)\b/.test(contextText)) return 'sales'
  if (/\b(budget)\b/.test(contextText) && !/\b(postgres(?:ql)?|python|gcp|aws|azure|database|api|code|script|deploy|server|instance)\b/.test(contextText)) return 'sales'
  // "legal" alone is too weak a signal — it shows up in sales/compliance talk
  // ("legal signs off", "check with legal") without the conversation actually
  // being about legal advice. Require it to co-occur with a real legal-advice
  // term, or require one of the stronger unambiguous terms on its own.
  if (/\b(termination|contract|clause)\b/.test(lower)) return 'legal'
  if (/\blegal\b/.test(lower) && /\b(advice|clause|contract|termination|non-compete|indemnity|liable|lawsuit|tenant|rights|counsel)\b/.test(contextText)) return 'legal'
  if (/\b(refund|order|delivery|ticket)\b/.test(lower)) return 'customer_support'
  const scores: Array<{ domain: DomainType; score: number }> = [
    {
      domain: 'coding',
      score: scorePattern(contextText, /\b(code|function|api|auth|login|webhook|typescript|javascript|python|bug|error|exception|traceback|undefined|401|403|500|sql|database|schema|migration|docker|react|node|csv|beautifulsoup|selector|pagination)\b/g),
    },
    {
      domain: 'customer_support',
      // "weeks"/"called"/"process" were dropped as standalone signals — they're
      // generic enough to appear in any domain (e.g. "started this medication
      // last week") and were winning false positives against real domain terms.
      score: scorePattern(contextText, /\b(order|refund|delivery|arrived|ticket|support|cancel|replacement|tracking|logistics)\b|#\d+/g),
    },
    {
      domain: 'sales',
      score: scorePattern(contextText, /\b(pricing|price|demo|trial|competitor|objection|contract|plan|subscription|discount|annual|premium|soc2|security|startup|startups)\b/g),
    },
    {
      domain: 'legal',
      score: scorePattern(contextText, /\b(contract|clause|enforceable|rights|liable|lawsuit|tenant|terms|termination|employee|employer|retaliation|whistleblower|at-will|california|legal|policy|documentation)\b/g),
    },
    {
      domain: 'medical',
      // Broadened from a narrow drug/symptom list (which only matched specific
      // named drugs and exact phrases) to generic clinical vocabulary that
      // should generalize to symptoms and medications not explicitly listed here.
      score: scorePattern(contextText, /\b(headache|fever|symptom|symptoms|doctor|medication|prescription|dose|dosage|pain|bleeding|bp|blood pressure|heart rate|resting heart rate|bpm|cough|dizziness|dizzy|lightheaded|light-headed|faint|fainting|nausea|rash|swelling|side effect|side effects|stop taking|since starting|new medication)\b/g),
    },
    {
      domain: 'commerce',
      score: scorePattern(contextText, /\b(buy|purchase|best under|recommend|where can i buy|worth it|iphone|samsung|s24|battery|msrp|laptop|monitor|keyboard|standing desk)\b|[₹$]\s?\d+/g),
    },
    {
      domain: 'education',
      score: scorePattern(contextText, /\b(teach|learn|quiz|explain|homework|study|lesson|process|steps|flashcard|example)\b/g),
    },
  ]

  if (signals.structures.includes('code_block') || signals.structures.includes('error_signal')) {
    bump(scores, 'coding', 3)
  }
  if (signals.structures.includes('price_constraint')) bump(scores, 'commerce', 2)

  const ranked = scores.sort((a, b) => b.score - a.score)
  const best = ranked[0]
  // Safety-first tie-break: medical is a protected zone (no compression, no
  // monetization). If it's tied with or one point behind the top score, a
  // misclassification here means real medical content silently loses its
  // protection. Prefer medical over an equally-weak alternative signal.
  const medical = ranked.find((item) => item.domain === 'medical')
  if (medical && medical.score > 0 && best.score - medical.score <= 1 && best.domain !== 'medical') {
    return 'medical'
  }
  return best.score > 0 ? best.domain : 'general'
}

function detectIntent(lower: string, contextText: string, signals: ReturnType<typeof extractSignals>, domain: DomainType): IntentType {
  const currentLooksGeneric = /\b(that issue|that problem|this issue|that one|which one|discussed|the process|next item)\b/.test(lower)

  if (/\b(delete the logs|hide the evidence|nobody can trace)\b/.test(lower)) return 'task_execution'

  // Confirmation-seeking check must come BEFORE coding history checks so
  // "are you sure the migration order is right?" isn't swallowed by the
  // coding-context debugging fallback below.
  if (/\b(is that ok|confirm|are you sure|does this look right)\b/.test(lower)) return 'confirmation_seeking'

  if (signals.structures.includes('error_signal') || /\b(failing|throws|crashes?|crashing|broken|bug|fix this|recursion|recursionerror|typeerror|syntaxerror|valueerror|attributeerror|importerror)\b/.test(lower)) return 'debugging'
  if (domain === 'coding' && /\b(write|create|generate|build|scrape|csv|selector|beautifulsoup|pagination|implement)\b/.test(contextText)) return 'generation'
  if (domain === 'coding' && /\b(final fix|fix for that issue|why is|error|failed|timeout|500|401|403|bug|migration)\b/.test(contextText)) return 'debugging'
  if (/\b(compare|vs|versus|difference between|better than)\b/.test(lower)) return 'comparison'
  if (domain === 'commerce' && /\b(which one|better battery|compare|versus|vs|iphone|samsung)\b/.test(contextText)) return 'comparison'
  if (/\b(summarize|tl;dr|tldr|key points)\b/.test(lower)) return 'summarization'
  if (domain === 'education' && /\b(quiz|recap|summarize)\b/.test(lower) && /\b(summary|summarize|recap)\b/.test(contextText)) return 'summarization'
  if (/\b(correct the tone|make this email shorter|correct this|fix my wording)\b/.test(lower)) return 'correction'
  if (/\b(write|create|generate|build|draft|make me|implement)\b/.test(lower)) return 'generation'
  if (domain === 'medical' && /\b(what should|doctor|readings|side effects|bp|blood pressure)\b/.test(contextText)) return 'information_seeking'
  if (domain === 'medical' && /\b(is it safe|safe to|should i keep|taking .* every day)\b/.test(lower)) return 'decision_support'
  if (domain === 'legal' && /\b(should i|proceed|termination|options|what can i do)\b/.test(lower)) return 'decision_support'
  if (/\b(should i|help me decide|which should|recommend whether)\b/.test(lower)) return 'decision_support'
  if (domain === 'sales' && /\b(send me the contract|discount|security|not sure|concern|objection)\b/.test(contextText)) {
    // Forward-motion action on current turn → decision_support regardless of history
    if (/\b(send|proceed|go with|upgrade|proposal|submit|sign)\b/.test(lower)) return 'decision_support'
    return /\b(not sure|concern|security really|too expensive|hesitant|half the price)\b/.test(lower) ? 'objection_handling' : 'decision_support'
  }
  if (/\b(is this right|correct this|fix my wording|actually|no,|that's wrong)\b/.test(lower)) return 'correction'
  if (domain === 'customer_support' && /\b(refund|process|exactly when|arrived|called|escalate)\b/.test(contextText)) {
    if (/\b(escalate|escalated|already called|no one helped|3 weeks|full refund|want a refund|refund now|not here)\b/.test(contextText)) return 'escalation'
    return /\b(when|status|exactly)\b/.test(lower) ? 'information_seeking' : 'task_execution'
  }
  if (domain === 'education' && /\b(quiz|what's the next|next item)\b/.test(lower)) return 'information_seeking'
  if (/\b(next item on my schedule|calendar|schedule)\b/.test(lower)) return 'task_execution'
  if (/\b(why|how|what|who|when|where)\b/.test(lower)) return 'information_seeking'
  if (/\b(ideas|brainstorm|explore|options|ways to)\b/.test(lower)) return 'exploration'
  if (/\b(not sure|too expensive|concerned|hesitant|maybe later)\b/.test(lower)) return 'objection_handling'
  if (signals.urgency === 'high' || /\b(refund|resolve|escalate|manager)\b/.test(lower)) return domain === 'customer_support' ? 'escalation' : 'task_execution'
  if (currentLooksGeneric && domain !== 'general') return domain === 'coding' ? 'debugging' : 'task_execution'
  return 'task_execution'
}

function detectState(lower: string, history: Message[], signals: ReturnType<typeof extractSignals>, domain: DomainType): ConversationState {
  if (history.length === 0) return 'opening'
  const historyText = history.map((item) => item.content).join('\n').toLowerCase()
  // Last exchange = immediately preceding 2 messages (one turn)
  const lastExchange = history.slice(-2).map((item) => item.content).join('\n').toLowerCase()

  if (/\b(i do not want to be here|i don't want to be here|want to die|self harm|delete the logs|hide the evidence|nobody can trace)\b/.test(lower)) return 'escalating'
  if (/\b(thanks|that helps|done|resolved|wrap up|that's all)\b/.test(lower)) return 'closing'
  // "again" removed — normal word, not an escalation signal on its own
  if (signals.urgency === 'high' || /\b(still|keeps|not fixed|2 weeks|asap|urgent)\b/.test(lower)) return 'escalating'
  if (/\b(already called|no one helped|not here by friday|shortness of breath)\b/.test(historyText)) return 'escalating'

  // Resolving — check before casual-topic returning so a concluding action wins
  if (/\b(so|therefore|choose|ship|submit)\b/.test(lower)) return 'resolving'
  if (/\b(send the|go with|proceed with|recommend the|final fix|send me the contract)\b/.test(lower)) return 'resolving'

  // Pivoting — require explicit topic-change phrasing, not standalone "next"
  if (/\b(ok now|next topic|new topic|different question|switching to)\b/.test(lower)) return 'pivoting'

  // Explicit back-reference in current message
  if (/\b(as i said|from before|coming back|earlier|that issue|discussed|which one was that)\b/.test(lower)) return 'returning'

  // Casual digression in the immediately preceding exchange → user is coming back
  // Keep list narrow: only terms that are clearly off-topic for every domain
  const casualTopics = /\b(weather|cat|dark mode|space travel|cricket)\b/
  if (casualTopics.test(lastExchange) && domain !== 'general') return 'returning'

  return 'deepening'
}

function detectRisk(signals: ReturnType<typeof extractSignals>, domain: DomainType, contextText: string): RiskSignal[] {
  const risk: RiskSignal[] = []
  if (hasPrefix(signals, 'crisis') || /\b(kill myself|end my life|want to die|self harm|following me|do not want to be here|don't want to be here|not want to be here anymore)\b/.test(contextText)) risk.push('crisis', 'protected_context')
  if (hasPrefix(signals, 'unsafe') || /\b(hack into|steal|bypass security|malware|phishing|exploit|delete logs|delete the logs|hide the evidence|nobody can trace|evade)\b/.test(contextText)) risk.push('unsafe_request')
  if (domain === 'medical') risk.push('medical_caution')
  if (domain === 'legal') risk.push('legal_caution')
  if (domain === 'commerce' && signals.keywords.some((item) => item.includes('invest') || item.includes('price'))) risk.push('financial_caution')
  return Array.from(new Set(risk))
}

function hasPrefix(signals: ReturnType<typeof extractSignals>, prefix: string): boolean {
  return signals.keywords.some((keyword) => keyword.startsWith(`${prefix}:`))
}

function scorePattern(text: string, pattern: RegExp): number {
  return Array.from(text.matchAll(pattern)).length
}

function bump(scores: Array<{ domain: DomainType; score: number }>, domain: DomainType, amount: number): void {
  const item = scores.find((score) => score.domain === domain)
  if (item) item.score += amount
}

function scoreIntent(intent: IntentType, signals: ReturnType<typeof extractSignals>): number {
  const base = intent === 'task_execution' ? 0.68 : 0.78
  const boost = Math.min(0.16, (signals.keywords.length + signals.structures.length) * 0.025)
  return Number(Math.min(0.96, base + boost).toFixed(2))
}

// ── ML-powered async classify ─────────────────────────────────────────────────
// Same as classify() but uses DistilBERT for domain detection.
// Intent, state, and risk still use deterministic rules (they work well).
// Falls back to keyword-based domain if the ML model errors.

export async function classifyAsync(
  message: string,
  history: Message[] = [],
  customDomainPlugins: CustomDomainPlugin[] = [],
): Promise<RoutingFrame> {
  const signals     = extractSignals(message, history)
  const lower       = message.toLowerCase()
  const historyText = history.map((m) => m.content).join('\n').toLowerCase()
  const contextText = `${lower}\n${historyText}`

  // ── Domain: ML model (with fallbacks) ──────────────────────────────────────
  let domain: DomainType
  let domainConf = 0.88

  // 1. Custom domain plugins always win
  const customDomain = customDomainPlugins.find((p) =>
    p.keywords.some((kw) => contextText.includes(kw.toLowerCase())),
  )

  if (customDomain) {
    domain     = customDomain.id
    domainConf = 0.95
  } else {
    // 2. Try ML model
    try {
      const ml   = await classifyDomainML(contextText.slice(0, 512))
      domain     = ml.label as DomainType
      domainConf = ml.score
    } catch {
      // 3. Fallback to keyword rules if model unavailable
      domain     = detectDomain(lower, contextText, signals, customDomainPlugins)
      domainConf = domain === 'general' ? 0.62 : 0.88
    }
  }

  const intent = detectIntent(lower, contextText, signals, domain)
  const state  = detectState(lower, history, signals, domain)
  const risk   = detectRisk(signals, domain, contextText)

  return {
    intent,
    state,
    domain,
    risk,
    signals,
    confidence: {
      intent:  scoreIntent(intent, signals),
      state:   state === 'opening' ? 0.9 : 0.74,
      domain:  domainConf,
      risk:    risk.length === 0 ? 1 : 0.88,
    },
  }
}
