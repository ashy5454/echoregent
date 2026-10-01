import { classify } from '../../src/cts-core/classifier'

const msg = 'My order #A4821 never arrived and I need a refund, this is the third time I have contacted support.'
const history = Array.from({ length: 6 }, (_, i) => ({ role: (i % 2 === 0 ? 'user' : 'assistant') as const, content: `Turn ${i} about the order and refund status.` }))

// warm up
for (let i = 0; i < 100; i++) classify(msg, history)

const N = 2000
const start = performance.now()
for (let i = 0; i < N; i++) classify(msg, history)
const elapsed = performance.now() - start
console.log(`classify(): ${N} calls in ${elapsed.toFixed(2)}ms -> ${(elapsed / N).toFixed(4)}ms/call (rule-based path, no ML model)`)
