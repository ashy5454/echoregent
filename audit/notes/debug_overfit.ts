import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

function supportFrame(): RoutingFrame {
  return {
    intent: 'escalation', state: 'escalating', domain: 'customer_support', risk: [],
    signals: { keywords: [], structures: [], urgency: 'high', affect: 'frustrated' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
  }
}
function historyWithCity(city: string): Message[] {
  return [
    { role: 'user', content: `My package was supposed to arrive at my apartment in ${city} last week.` },
    { role: 'assistant', content: 'I am sorry to hear that. Let me look into the shipping status for you.' },
    { role: 'user', content: 'It still has not shown up and the tracking page has not updated in days.' },
    { role: 'assistant', content: 'That does sound frustrating. I will escalate this to our logistics team right away.' },
    { role: 'user', content: 'I need this resolved because I am flying out for a work trip on Friday.' },
    { role: 'assistant', content: 'Understood, I will mark this as urgent given your Friday travel date.' },
  ]
}
for (const city of ['Dallas', 'Portland']) {
  const r = compressHistory(historyWithCity(city), supportFrame())
  console.log(`--- city=${city} ---`)
  console.log('compressed messages:', r.compressed.length, 'of', r.original.length)
  console.log(r.compressed.map((m) => m.content).join('\n---\n'))
  console.log('contains city?', r.compressed.some((m) => m.content.includes(city)))
  console.log()
}
