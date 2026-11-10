// Verify the fine-tuned cts_relevance ONNX model loads through the production
// loader and ranks a fact-bearing turn above distractors.
//
// Run after pipeline/export/export_relevance_onnx.py has populated ml/cts_relevance.
import { scoreRelevance, getRelevanceHealth } from '../../src/cts-core/ml-relevance'
import type { Message } from '../../src/cts-core/types'

async function measureP95(fn: () => Promise<unknown>, warmup = 5, runs = 30): Promise<number> {
  for (let i = 0; i < warmup; i++) await fn()
  const times: number[] = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    await fn()
    times.push(performance.now() - started)
  }
  times.sort((a, b) => a - b)
  return times[Math.max(0, Math.ceil(times.length * 0.95) - 1)]
}

async function main() {
  const messages = [
    { role: 'user' as const, content: 'The checkout endpoint returns 503 from /api/orders/sync with error ERR-48213.' },
    { role: 'assistant' as const, content: 'Sounds good.' },
    { role: 'assistant' as const, content: 'Hey, what are you working on?' },
  ]
  const scores = await scoreRelevance('Why does the checkout call fail with 503 at /api/orders/sync?', messages)
  console.log('health:', getRelevanceHealth())
  console.log('scores:', scores)

  const ok = scores[0] > scores[1] && scores[0] > scores[2] && scores[0] > 0
  if (!ok) {
    console.error('FAIL: relevance ordering or model loading is wrong')
    process.exit(1)
  }
  console.log('PASS: fact-bearing turn ranks above distractors')

  const batch: Message[] = Array.from({ length: 20 }, (_, i) => ({
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: `Turn ${i + 1}: Let me help you debug that 500 error on /api/users/${i}. Can you share the stack trace?`,
  }))
  // Realistic warm-path latency: the history is stable across turns (cached),
  // the in-flight query changes (one new forward per call).
  let turn = 0
  const p95 = await measureP95(() =>
    scoreRelevance(`Why does the API return a ${500 + (turn++ % 10)} error?`, batch),
  )
  console.log(`batch-20 p95: ${p95.toFixed(1)}ms (target <= 35ms)`)
}

main()
