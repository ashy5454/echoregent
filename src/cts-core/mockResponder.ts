import type { CompressionResult, RouteResult, RoutingFrame } from './types.js'

export function mockRespond(message: string, frame: RoutingFrame, compression: CompressionResult, route: RouteResult): string {
  if (frame.risk.includes('unsafe_request')) {
    return 'I can’t help with unsafe instructions, but I can help reframe this into a legitimate security, learning, or troubleshooting task.'
  }

  if (frame.intent === 'debugging') {
    return `CTS would answer as a technical debugger: start with the most likely cause, use the preserved error/code context (${compression.compressed.length} kept messages), and give one focused fix before extra alternatives.`
  }

  if (frame.domain === 'customer_support') {
    return 'CTS would answer as a support flow: acknowledge the issue, preserve order and escalation details, then move toward a concrete resolution path such as tracking, replacement, refund, or handoff.'
  }

  if (frame.domain === 'sales') {
    return 'CTS would answer as a consultative sales assistant: address the current buying stage, compare only relevant tradeoffs, and handle objections without pressure.'
  }

  if (frame.domain === 'legal' || frame.domain === 'medical') {
    return `CTS would answer with ${frame.domain} caution: provide general information, keep the relevant facts, avoid overclaiming, and recommend qualified help where needed.`
  }

  if (frame.intent === 'comparison') {
    return 'CTS would compare the options using consistent criteria, then give a practical recommendation instead of ending with a vague “it depends.”'
  }

  if (frame.intent === 'summarization') {
    return 'CTS would return a tight summary that preserves the source meaning and drops nonessential context.'
  }

  if (frame.intent === 'generation') {
    return 'CTS would generate the requested artifact directly, then add a short note about assumptions or next steps.'
  }

  return `CTS routed this as ${frame.intent} in a ${frame.domain} context. The final LLM would receive the prompt policy plus ${compression.compressed.length} compressed history messages.`
}

