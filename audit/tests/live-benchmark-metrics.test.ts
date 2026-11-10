import { expect, it } from 'vitest'
import * as metrics from '../../scripts/benchmark-metrics.mjs'

it('extracts provider-reported Responses usage without estimating from payload size', () => {
  expect(metrics.readUsage).toBeTypeOf('function')
  expect(metrics.readUsage({ input_tokens: 100, input_tokens_details: { cached_tokens: 40 }, output_tokens: 20, total_tokens: 120 })).toEqual({ inputTokens: 100, cachedInputTokens: 40, uncachedInputTokens: 60, outputTokens: 20, totalTokens: 120 })
  expect(metrics.readUsage({ input_tokens: 10, output_tokens: 2 })).toEqual({ inputTokens: 10, cachedInputTokens: null, uncachedInputTokens: null, outputTokens: 2, totalTokens: 12 })
  expect(metrics.readUsage({ input_tokens: '100', output_tokens: 20 })).toBeNull()
})

it('captures completed usage from fragmented SSE without keeping prompts or outputs', () => {
  expect(metrics.createUsageCollector).toBeTypeOf('function')
  const collector = metrics.createUsageCollector()
  const event = 'event: response.completed\ndata: {"type":"response.completed","response":{"id":"r","usage":{"input_tokens":8,"input_tokens_details":{"cached_tokens":0},"output_tokens":2}}}\n\n'
  for (let index = 0; index < event.length; index += 7) collector.push(event.slice(index, index + 7))
  expect(collector.finish()).toEqual([{ inputTokens: 8, cachedInputTokens: 0, uncachedInputTokens: 8, outputTokens: 2, totalTokens: 10 }])
})
