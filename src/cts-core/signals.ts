import type { ExtractedSignals, Message } from './types'

const keywordGroups = {
  coding: ['code', 'function', 'api', 'auth', 'login', 'webhook', 'typescript', 'javascript', 'python', 'bug', 'stack trace'],
  support: ['order', 'refund', 'delivery', 'arrived', 'ticket', 'support', 'cancel', 'replacement'],
  sales: ['pricing', 'price', 'demo', 'trial', 'competitor', 'objection', 'contract', 'plan', 'subscription'],
  legal: ['contract', 'clause', 'enforceable', 'rights', 'liable', 'lawsuit', 'tenant', 'terms'],
  medical: ['headache', 'fever', 'symptom', 'doctor', 'medication', 'dose', 'pain', 'bleeding'],
  commerce: ['buy', 'purchase', 'best under', 'recommend', 'where can i buy', 'worth it', '₹', '$'],
  education: ['teach', 'learn', 'quiz', 'explain like', 'homework', 'study', 'lesson'],
  urgency: ['urgent', 'asap', 'today', 'now', 'immediately', '2 weeks', 'still not', 'keeps failing'],
  crisis: ['kill myself', 'end my life', 'want to die', "don't want to be here", 'self harm'],
  unsafe: ['hack into', 'steal', 'bypass security', 'malware', 'phishing'],
}

const affectWords = {
  frustrated: ['stupid', 'annoying', 'frustrated', 'keeps failing', 'broken', 'hate this'],
  distressed: ['hopeless', 'worthless', 'empty', 'panic', 'overwhelmed', 'alone'],
  positive: ['great', 'awesome', 'love', 'excited', 'perfect'],
}

export function extractSignals(message: string, history: Message[] = []): ExtractedSignals {
  const lower = message.toLowerCase()
  const keywords: string[] = []
  const structures: string[] = []

  // Scan the current message for domain keyword signals
  for (const [group, words] of Object.entries(keywordGroups)) {
    for (const word of words) {
      if (lower.includes(word)) keywords.push(`${group}:${word}`)
    }
  }

  // Also scan recent history for crisis/unsafe/urgency signals so multi-turn
  // escalation is detected even when the final message alone is mild
  const historyLower = history.slice(-6).map((m) => m.content).join('\n').toLowerCase()
  const combinedLower = `${lower}\n${historyLower}`

  for (const group of ['crisis', 'unsafe'] as const) {
    for (const word of keywordGroups[group]) {
      if (historyLower.includes(word) && !keywords.includes(`${group}:${word}`)) {
        keywords.push(`${group}:${word}`)
      }
    }
  }

  if (/```[\s\S]*```/.test(message)) structures.push('code_block')
  if (/\b(error|exception|traceback|undefined|null pointer|401|403|500)\b/i.test(message)) structures.push('error_signal')
  if (/\b(vs|versus|compare|difference between)\b/i.test(message)) structures.push('comparison_marker')
  if (/\b\d{1,2}[/-]\d{1,2}\b|\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|tomorrow|next week)\b/i.test(message)) {
    structures.push('date_or_schedule')
  }
  if (/[₹$]\s?\d+|\bunder\s+[₹$]?\d+/i.test(message)) structures.push('price_constraint')
  if (history.length > 0) structures.push('has_history')

  // Urgency from both current message and recent history (last 4 turns)
  const recentLower = history.slice(-4).map((m) => m.content).join('\n').toLowerCase()
  const urgencyTarget = `${lower}\n${recentLower}`
  const urgencyMatches = keywordGroups.urgency.filter((word) => urgencyTarget.includes(word)).length
  const urgency = urgencyMatches >= 2 ? 'high' : urgencyMatches === 1 ? 'medium' : 'low'

  // Affect from current message primarily; escalate to distressed if history signals it
  let affect: ExtractedSignals['affect'] = 'neutral'
  if (affectWords.distressed.some((word) => combinedLower.includes(word))) affect = 'distressed'
  else if (affectWords.frustrated.some((word) => lower.includes(word))) affect = 'frustrated'
  else if (affectWords.positive.some((word) => lower.includes(word))) affect = 'positive'

  return { keywords: unique(keywords), structures: unique(structures), urgency, affect }
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

