import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import * as sdk from '../../packages/core/src/index.js'

const tokens = (value: unknown) => encode(JSON.stringify(value), { disallowedSpecial: new Set() }).length
const expandLog = (text: string) => {
  expect(sdk.decompressText).toBeTypeOf('function')
  return sdk.decompressText(text)
}
const logsRequest = (output: string, context = 'Inspect the build observations.') => ({
  model: 'local-fixture', prompt_cache_key: 'stable',
  input: [
    { role: 'user', content: context },
    { type: 'custom_tool_call_output', call_id: 'logs-1', output },
  ],
})

describe('lossless log compaction', () => {
  it.each(['compressRepeatedLines', 'compressLogs'] as const)('reconstructs oversized duplicate runs emitted by %s', (method) => {
    const output = '[INFO]\n'.repeat(1_000_002)
    const compressed = sdk[method](output)
    expect(compressed.length).toBeLessThan(output.length)
    // Compare booleans so a regression does not print a million-line diff.
    expect(sdk.decompressText(compressed) === output).toBe(true)
  }, 60_000)

  it('passes tilde-fenced tool output through unchanged', () => {
    const output = '~~~log\n' + Array.from({ length: 80 }, (_, i) => `[INFO] timestamp=${i} fixture input validated`).join('\n') + '\n~~~'
    expect(new sdk.EchoRegent().compressText(output).text).toBe(output)
    const body = logsRequest(output)
    expect(new sdk.EchoRegent().process(body, 'responses').request).toBe(body)
  })

  it('reconstructs oversized duplicate rows alongside changing numeric values', () => {
    const output = '[INFO] value=0\n'.repeat(1_000_002)
      + Array.from({ length: 100 }, (_, i) => `[INFO] value=${i + 1}`).join('\n')
    const compressed = sdk.compressLogs(output)
    expect(compressed.length).toBeLessThan(output.length)
    expect(sdk.decompressText(compressed) === output).toBe(true)
  }, 60_000)

  it('reconstructs repeated text at the expansion size limit including the final newline', () => {
    const line = '[INFO] ' + 'x'.repeat(16 * 1024 * 1024 - 8)
    const output = (line + '\n').repeat(4)
    const compressed = sdk.compressRepeatedLines(output)
    expect(compressed.length).toBeLessThan(output.length)
    expect(sdk.decompressText(compressed) === output).toBe(true)
  })

  it.each([
    '[EchoRegent: previous line repeated invalid additional times]',
    ' [EchoRegent: previous line repeated 3 additional times]',
    'ordinary literal\n[EchoRegent: previous line repeated 3 additional times]',
  ])('leaves an entire repeat stream unchanged for malformed reserved text: %j', (invalid) => {
    const text = '[INFO] ready\n[EchoRegent: previous line repeated 3 additional times]\n' + invalid
    expect(sdk.decompressText(text)).toBe(text)
  })

  it('saves tokens on timestamped lines without removing or rounding any timestamp', () => {
    const output = Array.from({ length: 600 }, (_, i) => `[INFO] timestamp=${i} fixture input validated`).join('\n')
    const body = logsRequest(output)
    const original = structuredClone(body)
    const result = new sdk.EchoRegent().process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(tokens(result.request)).toBeLessThan(tokens(body) * 0.7)
    expect(expandLog(result.request.input[1].output!)).toBe(output)
    expect(body).toEqual(original)
    expect({ ...result.request.input[1], output }).toEqual(body.input[1])
    expect(result.request.input[0]).toBe(body.input[0])
    expect(result.request.prompt_cache_key).toBe('stable')
  })

  it('factors dense numeric logs while retaining every ID, status and their associations', () => {
    const lines = Array.from({ length: 240 }, (_, i) => `[INFO] stage=${i} endpoint=/v2/item/${i} status=${200 + i % 5}`)
    lines.splice(17, 0, 'FAIL endpoint /v2/reconcile status 503 trace QZ-8407')
    const output = lines.join('\n') + '\n'
    const body = logsRequest(output)
    const result = new sdk.EchoRegent().process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(tokens(result.request)).toBeLessThan(tokens(body) * 0.7)
    expect(expandLog(result.request.input[1].output!)).toBe(output)
    expect(result.request.input[1].output).toContain('FAIL endpoint /v2/reconcile status 503 trace QZ-8407')
  })

  it.each(['\n', '\r\n'])('reconstructs duplicate runs, blank lines and a final %j exactly', (newline) => {
    const output = '[INFO] fixture input validated'.concat(newline).repeat(600)
      + newline + 'FAIL unique observation' + newline
    const result = new sdk.EchoRegent().compressText(output)
    expect(result.changed).toBe(true)
    expect(tokens(result.text)).toBeLessThan(tokens(output) * 0.1)
    expect(expandLog(result.text)).toBe(output)
  })

  it('preserves numeric spellings, Unicode, mixed newlines and literal braces and quotes', () => {
    const lines = Array.from({ length: 80 }, (_, i) =>
      `[INFO] time=2026-11-10T23:59:${String(i % 60).padStart(2, '0')}.000+05:30 id=${String(i).padStart(6, '0')} delta=${i % 2 ? '-0.000' : '+1.2300e-04'} label="café 雪 {0}"`,
    )
    const output = lines.map((line, i) => line + (i % 3 ? '\r\n' : '\n')).join('')
    const result = new sdk.EchoRegent().compressText(output)
    expect(result.changed).toBe(true)
    expect(tokens(result.text)).toBeLessThan(tokens(output))
    expect(expandLog(result.text)).toBe(output)
  })

  it('preserves both text and non-text custom tool blocks and does not mutate caller metadata', () => {
    const output = Array.from({ length: 100 }, (_, i) => `[INFO] timestamp=${i} fixture input validated`).join('\n')
    const body = { input: [{ type: 'custom_tool_call_output', call_id: 'c', id: 'item-id', output: [
      { type: 'input_image', image_url: 'data:image/png;base64,AA==' },
      { type: 'input_text', text: output, marker: { retained: true } },
      { type: 'future_block', data: [1, 2, 3] },
    ] }] }
    const original = structuredClone(body)
    const result = new sdk.EchoRegent().process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(expandLog(result.request.input[0].output[1].text!)).toBe(output)
    expect(result.request.input[0].output[0]).toBe(body.input[0].output[0])
    expect(result.request.input[0].output[2]).toBe(body.input[0].output[2])
    expect(result.request.input[0].output[1].marker).toBe(body.input[0].output[1].marker)
    expect(result.request.input[0].id).toBe('item-id')
    expect(body).toEqual(original)
  })

  it('does not grow small or high-entropy payloads and handles literal special-token text', () => {
    const samples = [
      'ordinary distinct prose',
      Array.from({ length: 4 }, (_, i) => `[INFO] ${i}`).join('\n'),
      Array.from({ length: 60 }, (_, i) => '[INFO] ' + createHash('sha256').update(String(i)).digest('hex')).join('\n'),
      '[INFO] token <|endoftext|> timestamp=0 ready\n'.repeat(80),
    ]
    for (const output of samples) {
      const result = new sdk.EchoRegent().compressText(output)
      expect(tokens(result.text)).toBeLessThanOrEqual(tokens(output))
      if (result.changed) expect(expandLog(result.text)).toBe(output)
    }
  })

  it.each(['My prescription dosage is 20 mg.', 'Preserve the legal contract clause.', 'I want to kill myself.'])('protects the whole original context: %s', (context) => {
    const output = Array.from({ length: 600 }, (_, i) => `[INFO] timestamp=${i} fixture input validated`).join('\n')
    const body = logsRequest(output, context)
    const result = new sdk.EchoRegent().process(body, 'responses')
    expect(result.policy.protected).toBe(true)
    expect(result.request).toBe(body)
  })

  it('leaves structured JSON, fenced code and genuine unique prose unchanged', () => {
    const fence = String.fromCharCode(96).repeat(3)
    const timestamped = Array.from({ length: 100 }, (_, i) => `[INFO] timestamp=${i} fixture input validated`).join('\n')
    const samples = [JSON.stringify({ lines: timestamped.split('\n') }), fence + '\n' + timestamped + '\n' + fence,
      'The build waits for input. A worker closes after processing. Inspect the database independently.\n'.repeat(8)]
    for (const output of samples) expect(new sdk.EchoRegent().compressText(output).text).toBe(output)
  })

  it('replays numeric-log transforms deterministically when original history is resent', () => {
    const output = Array.from({ length: 100 }, (_, i) => `[INFO] timestamp=${i} fixture input validated`).join('\n')
    const body = logsRequest(output)
    const engine = new sdk.EchoRegent()
    const first = engine.process(body, 'responses')
    expect(first.changed).toBe(true)
    const next = { ...body, input: [...body.input, { role: 'user', content: 'Explain the results.' }] }
    const second = engine.process(next, 'responses')
    expect(second.request.input.slice(0, 2)).toEqual(first.request.input)
    expect(second.request.input[2]).toBe(next.input[2])
    expect(expandLog(second.request.input[1].output!)).toBe(output)
    expect(engine.process(first.request, 'responses').request).toBe(first.request)
  })
})

const historyRequest = (protocol: sdk.Protocol, blocks = true, count = 40) => {
  const field = protocol === 'responses' ? 'input' : 'messages'
  return { model: 'local-fixture', prompt_cache_key: 'history-stable', [field]: Array.from({ length: count }, (_, i) => ({
    id: `turn-${i}`, role: i % 2 ? 'assistant' : 'user', metadata: { index: i },
    content: blocks
      ? [{ type: protocol === 'responses' ? 'input_text' : 'text', text: `We are discussing the build step ${i} and its next action.` }]
      : `We are discussing the build step ${i} and its next action.`,
  })) }
}
const restore = (body: Record<string, any>, protocol: sdk.Protocol) => {
  expect(sdk.restoreCompressedRequest).toBeTypeOf('function')
  return sdk.restoreCompressedRequest(body, protocol)
}

describe('optional lossless history compaction', () => {
  it.each([1, 15])('leaves a truncated %i-item history group entirely unchanged', (count) => {
    const result = new sdk.EchoRegent({ compactHistory: true }).process(historyRequest('responses', false), 'responses')
    expect(result.changed).toBe(true)
    const truncated = { ...result.request, input: result.request.input.slice(0, count) }
    expect(restore(truncated, 'responses')).toBe(truncated)
  })

  it.each(['H0 NaN', 'H0 invalid', 'H0 1\ntrailing'])('rejects the entire history group for a malformed reference: %j', (content) => {
    const result = new sdk.EchoRegent({ compactHistory: true }).process(historyRequest('responses', false), 'responses')
    expect(result.changed).toBe(true)
    const input = result.request.input.slice(0, 16)
    input[1] = { ...input[1], content }
    const malformed = { ...result.request, input }
    expect(restore(malformed, 'responses')).toBe(malformed)
  })

  it('rejects a reserved history reference before the first template header', () => {
    const body = historyRequest('responses', false)
    body.input[0].content = 'An independent opening observation.'
    const result = new sdk.EchoRegent({ compactHistory: true }).process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(restore(result.request, 'responses')).toEqual(body)
    expect(result.request.input[0]).toBe(body.input[0])
    const input = result.request.input.slice(0, 16)
    input[0] = { ...input[0], content: 'H1 invalid' }
    const malformed = { ...result.request, input }
    expect(restore(malformed, 'responses')).toBe(malformed)
  })

  it('keeps tilde-fenced historical messages verbatim', () => {
    const body = historyRequest('responses', false)
    body.input.forEach((item: any, i: number) => item.content = `~~~log\n[INFO] timestamp=${i} fixture input validated\n~~~`)
    expect(new sdk.EchoRegent({ compactHistory: true }).process(body, 'responses').request).toBe(body)
  })

  it.each(['responses', 'chat-completions'] as const)('reduces templated %s history and reconstructs roles, IDs, metadata and every message exactly', (protocol) => {
    const body = historyRequest(protocol)
    const field = protocol === 'responses' ? 'input' : 'messages'
    const original = structuredClone(body)
    expect(new sdk.EchoRegent().process(body, protocol).request).toBe(body)
    const result = new sdk.EchoRegent({ compactHistory: true }).process(body, protocol)
    expect(result.changed).toBe(true)
    expect(tokens(result.request)).toBeLessThan(tokens(body) * 0.92)
    expect(restore(result.request, protocol)).toEqual(original)
    expect(body).toEqual(original)
    expect(result.request[field].slice(-8)).toEqual(body[field].slice(-8))
    result.request[field].forEach((item: any, i: number) => {
      expect({ ...item, content: body[field][i].content }).toEqual(body[field][i])
    })
    expect(result.request.prompt_cache_key).toBe('history-stable')
  })

  it('handles string history and keeps factored prefixes stable when original turns are resent', () => {
    const body = historyRequest('responses', false)
    const engine = new sdk.EchoRegent({ compactHistory: true })
    const first = engine.process(body, 'responses')
    expect(first.changed).toBe(true)
    const next = historyRequest('responses', false, 42)
    const second = engine.process(next, 'responses')
    expect(second.request.input.slice(0, 40)).toEqual(first.request.input)
    expect(restore(second.request, 'responses')).toEqual(next)
    const aged = engine.process(historyRequest('responses', false, 56), 'responses')
    expect(aged.request.input.slice(0, 32)).toEqual(first.request.input.slice(0, 32))
    expect(engine.process(first.request, 'responses').request).toBe(first.request)
  })

  it('keeps the latest user message verbatim even when many tool outputs follow it', () => {
    const body = historyRequest('responses', false, 16)
    const current = { id: 'current', role: 'user', content: 'Keep this current build question verbatim.' }
    body.input.push(current, ...Array.from({ length: 70 }, (_, i) => ({ type: 'function_call_output', call_id: `call-${i}`, output: `observation ${i}` })))
    const result = new sdk.EchoRegent({ compactHistory: true }).process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(result.request.input[16]).toBe(current)
    expect(result.request.input.slice(16)).toEqual(body.input.slice(16))
    expect(restore(result.request, 'responses')).toEqual(body)
  })

  it('preserves instruction, tool-call, multimodal, structured, code and explicit cache/annotation items', () => {
    const body = historyRequest('responses')
    for (const item of body.input) item.content[0].text += ' The compile worker should retain its full observation for this numbered step.'
    body.input[0].role = 'developer'
    body.input[1].role = 'system'
    body.input[2].content.push({ type: 'input_image', image_url: 'data:image/png;base64,AA==' })
    body.input[3].tool_calls = [{ id: 'tool-1', type: 'function', function: { name: 'shell', arguments: '{}' } }]
    body.input[4].cache_control = { type: 'ephemeral' }
    body.input[5].content[0].annotations = [{ type: 'file_citation', index: 0 }]
    body.input[6].content[0].cache_control = { type: 'ephemeral' }
    body.input[7].content[0].text = JSON.stringify({ observation: 'Keep this JSON intact.' })
    body.input[8].content[0].text = String.fromCharCode(96).repeat(3) + '\nPASS build\n'.repeat(60) + String.fromCharCode(96).repeat(3)
    body.input[9].type = 'future_item'
    const result = new sdk.EchoRegent({ compactHistory: true }).process(body, 'responses')
    expect(result.changed).toBe(true)
    for (let i = 0; i < 10; i++) expect(result.request.input[i]).toBe(body.input[i])
    expect(restore(result.request, 'responses')).toEqual(body)
  })

  it('passes through diverse prose and short templates that would cost more tokens', () => {
    for (const text of [
      (i: number) => `Step ${i}.`,
      (i: number) => createHash('sha256').update(`independent sentence ${i}`).digest('hex'),
    ]) {
      const body = historyRequest('responses', false)
      body.input.forEach((item: any, i: number) => item.content = text(i))
      const result = new sdk.EchoRegent({ compactHistory: true }).process(body, 'responses')
      expect(result.request).toBe(body)
      expect(tokens(result.request)).toBe(tokens(body))
    }
  })

  it('keeps protected and unavailable provider-side conversations entirely unchanged', () => {
    const body = historyRequest('responses', false)
    body.input.at(-2).content = 'My prescription dosage is 20 mg.'
    expect(new sdk.EchoRegent({ compactHistory: true }).process(body, 'responses').request).toBe(body)
    const continued = { ...historyRequest('responses', false), previous_response_id: 'remote' }
    expect(new sdk.EchoRegent({ compactHistory: true }).process(continued, 'responses').request).toBe(continued)
  })

  it('uses request-local history templates and never mixes values from another session', () => {
    const engine = new sdk.EchoRegent({ compactHistory: true })
    for (const start of [0, 800]) {
      const body = historyRequest('responses', false)
      body.input.forEach((item: any, i: number) => item.content = `We are discussing the build step ${start + i} and its next action.`)
      const result = engine.process(body, 'responses', { project: '/fixture', session: String(start) })
      expect(result.changed).toBe(true)
      expect(restore(result.request, 'responses')).toEqual(body)
    }
  })

  it('fails open for the entire request when a tool compressor throws alongside eligible history', () => {
    const body = historyRequest('responses', false)
    body.input.push({ type: 'custom_tool_call_output', call_id: 'c', output: '[INFO] observation\n'.repeat(100) })
    const engine = new sdk.EchoRegent({ compactHistory: true, compressor() { throw new Error('fixture compressor failure') } })
    const result = engine.process(body, 'responses')
    expect(result.request).toBe(body)
    expect(result.reason).toBe('compression-error')
  })
})
