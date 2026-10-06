export type LocalClassification = {
  domain: 'coding' | 'customer_support' | 'sales' | 'legal' | 'medical' | 'education' | 'commerce' | 'general'
  intent: 'debugging' | 'generation' | 'comparison' | 'information_seeking' | 'decision_support' | 'task_execution'
  risk: string[]
  classifier: 'local-rules'
}

const DOMAIN_PATTERNS: Array<{ domain: LocalClassification['domain']; pattern: RegExp }> = [
  { domain: 'coding', pattern: /\b(api|webhook|typescript|javascript|python|bug|error|exception|stack trace|database|docker|deploy|401|403|500)\b/gi },
  { domain: 'customer_support', pattern: /\b(order|refund|delivery|tracking|replacement|ticket|support|cancel)\b/gi },
  { domain: 'sales', pattern: /\b(pricing|discount|contract|subscription|trial|competitor|roi|plan)\b/gi },
  { domain: 'legal', pattern: /\b(contract|clause|legal|lawsuit|liable|tenant|termination|rights)\b/gi },
  { domain: 'medical', pattern: /\b(symptom|doctor|medication|dose|pain|fever|bleeding|blood pressure)\b/gi },
  { domain: 'education', pattern: /\b(teach|learn|study|quiz|homework|lesson|explain)\b/gi },
  { domain: 'commerce', pattern: /\b(buy|purchase|recommend|worth it|best under|laptop|phone|price)\b/gi },
]

export function classifyLocally(message: string): LocalClassification {
  const lower = message.toLowerCase()
  const ranked = DOMAIN_PATTERNS
    .map(({ domain, pattern }) => ({ domain, score: Array.from(lower.matchAll(pattern)).length }))
    .sort((a, b) => b.score - a.score)
  const domain = ranked[0]?.score > 0 ? ranked[0].domain : 'general'

  const risk: string[] = []
  if (/\b(kill myself|want to die|self harm|do not want to be here)\b/.test(lower)) risk.push('crisis', 'protected_context')
  if (/\b(hack into|steal|bypass security|malware|phishing|delete logs|hide evidence)\b/.test(lower)) risk.push('unsafe_request')
  if (domain === 'medical') risk.push('medical_caution')
  if (domain === 'legal') risk.push('legal_caution')

  let intent: LocalClassification['intent'] = 'task_execution'
  if (/\b(error|exception|fails?|failing|broken|bug|fix|401|403|500)\b/.test(lower)) intent = 'debugging'
  else if (/\b(compare|versus|\bvs\b|difference between)\b/.test(lower)) intent = 'comparison'
  else if (/\b(write|create|generate|build|draft|implement)\b/.test(lower)) intent = 'generation'
  else if (/\b(should i|recommend|which should|help me decide)\b/.test(lower)) intent = 'decision_support'
  else if (/\b(what|why|how|who|when|where)\b/.test(lower)) intent = 'information_seeking'

  return { domain, intent, risk, classifier: 'local-rules' }
}
