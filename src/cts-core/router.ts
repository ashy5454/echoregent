import type { CustomDomainPlugin, RouteResult, RoutingFrame } from './types'

const intentBehaviors: Record<string, string> = {
  information_seeking: 'Answer the question directly, then add only necessary context.',
  task_execution: 'Turn the request into concrete next actions and complete the requested task shape.',
  decision_support: 'Compare against the user criteria and end with a clear recommendation.',
  comparison: 'Use consistent criteria across options and call out the practical winner.',
  summarization: 'Preserve meaning while removing everything nonessential.',
  generation: 'Produce the requested artifact first, with concise explanation after.',
  debugging: 'Identify the most likely root cause first, then give the smallest useful fix.',
  escalation: 'Acknowledge the rising urgency and move toward resolution quickly.',
  objection_handling: 'Surface the concern, answer it specifically, and avoid pressure.',
  confirmation_seeking: 'Confirm, correct, or qualify clearly with minimal extra detail.',
  exploration: 'Generate several distinct directions without prematurely judging them.',
  correction: 'Point out the correction plainly and provide the fixed version.',
}

const domainConstraints: Record<string, string> = {
  general: 'Use general assistant language and avoid domain-specific assumptions.',
  coding: 'Preserve technical details, exact errors, file names, APIs, and constraints.',
  customer_support: 'Track issue state, requested resolution, and customer frustration signals.',
  sales: 'Stay helpful and consultative; do not overpromise or pressure the user.',
  legal: 'Provide general legal information only and recommend qualified counsel for decisions.',
  medical: 'Provide health information only and encourage professional care for concerning symptoms.',
  education: 'Teach progressively and check understanding before increasing complexity.',
  commerce: 'Respect budget and preferences; give specific tradeoffs and avoid fake certainty.',
}

export function routePrompt(frame: RoutingFrame, options: { wikiContext?: string; customDomainPlugins?: CustomDomainPlugin[] } = {}): RouteResult {
  const customDomain = options.customDomainPlugins?.find((plugin) => plugin.id === frame.domain)
  const behavior = [
    intentBehaviors[frame.intent],
    stateAdjustment(frame.state),
    customDomain?.behavior,
  ].filter(Boolean) as string[]

  const constraints = [
    customDomain?.constraints ?? domainConstraints[frame.domain] ?? 'Use the active custom domain rules and avoid unsupported assumptions.',
    ...riskConstraints(frame),
  ]

  return {
    behavior,
    constraints,
    systemPrompt: [
      'You are responding through CTS, a universal interaction-routing layer.',
      `Intent: ${frame.intent}. State: ${frame.state}. Domain: ${frame.domain}.`,
      `Behavior: ${behavior.join(' ')}`,
      `Constraints: ${constraints.join(' ')}`,
      options.wikiContext ? `User wiki context:\n${options.wikiContext}` : '',
      'Use the routed behavior over generic assistant habits.',
    ].filter(Boolean).join('\n'),
  }
}

function stateAdjustment(state: RoutingFrame['state']): string {
  const map: Record<RoutingFrame['state'], string> = {
    opening: 'Establish the frame quickly because there is little prior context.',
    deepening: 'Build on the existing topic without repeating basics.',
    pivoting: 'Recognize the topic shift and reset only the relevant context.',
    returning: 'Reconnect to earlier context and avoid making the user restate it.',
    escalating: 'Prioritize speed, clarity, and immediate next steps.',
    resolving: 'Move toward a concrete conclusion or handoff.',
    closing: 'Be brief and close the loop cleanly.',
  }
  return map[state]
}

function riskConstraints(frame: RoutingFrame): string[] {
  const constraints: string[] = []
  if (frame.risk.includes('crisis')) constraints.push('Crisis risk is present: prioritize immediate safety and supportive next steps.')
  if (frame.risk.includes('medical_caution')) constraints.push('Do not diagnose; flag urgent symptoms and encourage professional care.')
  if (frame.risk.includes('legal_caution')) constraints.push('Do not provide legal advice; explain concepts and jurisdiction limits.')
  if (frame.risk.includes('financial_caution')) constraints.push('Do not guarantee financial outcomes or imply certainty.')
  if (frame.risk.includes('unsafe_request')) constraints.push('Refuse unsafe assistance and offer a safe alternative.')
  return constraints
}
