import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sdk from '../../packages/core/src/index.js'

const scope = { project: '/project/one', session: 'session-a' }

describe('public shared engine', () => {
  it('exports a usable SDK engine', () => {
    expect(sdk.EchoRegent).toBeTypeOf('function')
  })

  it.each(['My medication dose causes dizziness', 'Review my lease contract clause', 'I want to kill myself'])('protects %s across compression and explicit memory', async (text) => {
    const engine = new sdk.EchoRegent({ memory: { mode: 'ephemeral', retentionMs: 60_000 } })
    const body = { input: [{ role: 'user', content: text }, { type: 'function_call_output', call_id: 'c', output: 'ok\n'.repeat(90) }] }
    const result = engine.process(body, 'responses', scope)
    expect(result.request).toBe(body)
    expect(result.policy.protected).toBe(true)
    await expect(engine.remember(scope, { content: 'Use TypeScript', sources: ['turn:2'] })).rejects.toThrow(/protect/i)
    expect(await engine.recall(scope, 'TypeScript')).toEqual([])
  })

  it('preserves structured items, tool ordering and provider-cache prefixes', () => {
    const engine = new sdk.EchoRegent()
    const prefix = [
      { role: 'developer', content: [{ type: 'input_text', text: 'Keep these instructions.', cache_control: { type: 'ephemeral' } }] },
      { role: 'user', content: [{ type: 'input_image', image_url: 'data:image/png;base64,AA==' }, { type: 'input_text', text: 'Run tests' }] },
      { type: 'function_call', call_id: 'call_1', name: 'shell', arguments: '{"cmd":"test"}' },
    ]
    const body = { model: 'fixture', prompt_cache_key: 'project', tools: [{ type: 'function', name: 'shell' }], input: [...prefix, { type: 'function_call_output', call_id: 'call_1', output: 'PASS unit\n'.repeat(80) + 'FAIL integration: missing field' }] }
    const result = engine.process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(result.request.input.slice(0, 3)).toEqual(prefix)
    expect(result.request.input[3].call_id).toBe('call_1')
    expect(result.request.input[3].output).toContain('FAIL integration: missing field')
    expect(result.request.prompt_cache_key).toBe('project')
    expect(result.request.tools).toEqual(body.tools)
    expect(body.input[3].output).toContain('PASS unit\n'.repeat(80))
  })

  it('leaves current user text, structured tool output and unknown items untouched', () => {
    const engine = new sdk.EchoRegent()
    for (const input of [
      [{ role: 'user', content: 'echo\n'.repeat(80) }],
      [{ type: 'function_call_output', call_id: 'c', output: [{ type: 'input_text', text: 'echo\n'.repeat(80) }] }],
      [{ type: 'future_item', content: 'echo\n'.repeat(80) }],
    ]) {
      const body = { input }
      expect(engine.process(body, 'responses').request).toBe(body)
    }
  })

  it('fails open on compression exceptions', () => {
    const engine = new sdk.EchoRegent({ compressor() { throw new Error('failed') } })
    const body = { input: [{ type: 'function_call_output', output: 'echo\n'.repeat(80) }] }
    const result = engine.process(body, 'responses')
    expect(result.request).toBe(body)
    expect(result.reason).toBe('compression-error')
  })

  it('keeps a protected file session protected across engine restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-protected-'))
    try {
      const options = { memory: { mode: 'file' as const, directory, retentionMs: 60_000 } }
      const first = new sdk.EchoRegent(options)
      first.compressText('My prescription dose causes dizziness', scope)
      const reopened = new sdk.EchoRegent(options)
      await expect(reopened.remember(scope, { content: 'Use TypeScript', sources: ['turn:2'] })).rejects.toThrow(/protect/i)
      expect(await reopened.recall(scope, '')).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('protects resumed tool requests when earlier sensitive context is omitted', () => {
    const engine = new sdk.EchoRegent()
    engine.process({ input: 'My medical prescription' }, 'responses', scope)
    const resumed = { previous_response_id: 'resp_1', input: [{ type: 'function_call_output', call_id: 'c', output: 'PASS unit\n'.repeat(80) }] }
    const result = engine.process(resumed, 'responses', scope)
    expect(result.request).toBe(resumed)
    expect(result.policy.protected).toBe(true)
  })

  it('passes protected requests through when protection metadata storage fails', () => {
    const engine = new sdk.EchoRegent({ memory: { mode: 'file', directory: join(__dirname, '../../package.json'), retentionMs: 60_000 } })
    const request = { input: 'My medical prescription' }
    expect(engine.process(request, 'responses', scope).request).toBe(request)
  })

  it('preserves valid structured JSON serialized in a plain-text tool result', () => {
    const output = '[\n' + '  {"id": 1},\n'.repeat(80) + '  {"id": 2}\n]'
    const request = { input: [{ type: 'function_call_output', call_id: 'c', output }] }
    const result = new sdk.EchoRegent().process(request, 'responses')
    expect(result.request).toBe(request)
    expect(JSON.parse(result.request.input[0].output)).toHaveLength(81)
  })

  it('preserves unscoped provider continuations whose original context is unavailable', () => {
    const request = { previous_response_id: 'external', input: [{ type: 'function_call_output', call_id: 'c', output: 'PASS unit\n'.repeat(80) }] }
    expect(new sdk.EchoRegent().process(request, 'responses').request).toBe(request)
  })

  it('compresses current Codex custom tool results while preserving custom tool input and IDs', () => {
    const call = { type: 'custom_tool_call', id: 'ctc1', call_id: 'custom_1', name: 'exec_command', input: '{"cmd":"node test.mjs"}' }
    const body = { input: [call, { type: 'custom_tool_call_output', call_id: 'custom_1', output: '[INFO] fixture input validated\n'.repeat(600) + 'FAIL Cache accounting' }] }
    const result = new sdk.EchoRegent().process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(result.request.input[0]).toEqual(call)
    expect(result.request.input[1].call_id).toBe('custom_1')
    expect(result.request.input[1].output).toContain('FAIL Cache accounting')
  })

  it('handles Codex input_text output parts without changing block structure or non-text content', () => {
    const parts = [{ type: 'input_text', text: 'Command metadata' }, { type: 'input_text', text: '[INFO] fixture input validated\n'.repeat(600) + 'FAIL Cache accounting' }, { type: 'input_image', image_url: 'data:fixture' }]
    const body = { input: [{ type: 'custom_tool_call_output', id: 'out1', call_id: 'c', output: parts }] }
    const result = new sdk.EchoRegent().process(body, 'responses')
    expect(result.changed).toBe(true)
    expect(result.request.input[0].output[0]).toEqual(parts[0])
    expect(result.request.input[0].output[1].text).toContain('FAIL Cache accounting')
    expect(result.request.input[0].output[1].type).toBe('input_text')
    expect(result.request.input[0].output[2]).toEqual(parts[2])
    expect(body.input[0].output[1].text).toContain('[INFO] fixture input validated\n'.repeat(600))
  })

  it('replays prior log transforms to keep the provider prefix stable when Codex resends original history', () => {
    const engine = new sdk.EchoRegent()
    const call = { type: 'custom_tool_call_output', call_id: 'c', output: [{ type: 'input_text', text: '[INFO] fixture input validated\n'.repeat(600) }] }
    const first = engine.process({ input: [{ role: 'user', content: 'Run tests' }, call] }, 'responses', scope)
    expect(first.changed).toBe(true)
    const nextInput = [{ role: 'user', content: 'Run tests' }, call, { role: 'user', content: 'Explain the failure' }]
    const second = engine.process({ input: nextInput }, 'responses', scope)
    expect(second.request.input.slice(0, 2)).toEqual(first.request.input)
    expect(second.request.input[2]).toEqual(nextInput[2])
  })

  it('rechecks protection when an asynchronous file memory operation commits', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-race-'))
    try {
      const options = { memory: { mode: 'file' as const, directory, retentionMs: 60_000 } }
      const engine = new sdk.EchoRegent(options)
      const pending = engine.remember(scope, { content: 'Use TypeScript', sources: ['turn:1'] })
      engine.classify('My prescription causes dizziness', scope)
      await expect(pending).rejects.toThrow(/protect/i)
      const other = { ...scope, session: 'other' }
      await engine.remember(other, { content: 'Use Python', sources: ['turn:2'] })
      const recall = engine.recall(other, '')
      engine.classify('My prescription causes dizziness', other)
      expect(await recall).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })

  it('disables memory until explicitly enabled and requires a scope and source', async () => {
    const engine = new sdk.EchoRegent()
    await expect(engine.remember(scope, { content: 'Use TS', sources: ['turn:1'] })).rejects.toThrow(/disabled/i)
    const enabled = new sdk.EchoRegent({ memory: { mode: 'ephemeral', retentionMs: 60_000 } })
    await expect(enabled.remember({ project: '', session: '' }, { content: 'Use TS', sources: ['turn:1'] })).rejects.toThrow(/scope/i)
    await expect(enabled.remember(scope, { content: 'Use TS', sources: [] })).rejects.toThrow(/source/i)
  })

  it('isolates scopes, persists cited edits, deletes facts and enforces retention', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-memory-'))
    let now = 1_000
    try {
      const options = { memory: { mode: 'file' as const, directory, retentionMs: 100 }, now: () => now }
      const engine = new sdk.EchoRegent(options)
      const fact = await engine.remember(scope, { content: 'Use TypeScript', sources: ['README.md:4'] })
      expect(await engine.recall({ ...scope, session: 'b' }, '')).toEqual([])
      expect(await engine.recall({ ...scope, project: '/project/two' }, '')).toEqual([])
      const reopened = new sdk.EchoRegent(options)
      expect((await reopened.recall(scope, 'TypeScript'))[0].sources).toEqual(['README.md:4'])
      await reopened.update(scope, fact.id, { content: 'Use Python', sources: ['decision:2'] })
      expect((await reopened.recall(scope, 'Python'))[0].id).toBe(fact.id)
      expect(await reopened.forget(scope, fact.id)).toBe(true)
      expect(await reopened.recall(scope, '')).toEqual([])
      await reopened.remember(scope, { content: 'Use SQLite', sources: ['decision:3'] })
      now = 1_101
      expect(await reopened.recall(scope, '')).toEqual([])
      await reopened.remember(scope, { content: 'Use Redis', sources: ['decision:4'] })
      expect(await reopened.purge(scope)).toBe(1)
      expect(await reopened.recall(scope, '')).toEqual([])
    } finally { await rm(directory, { recursive: true, force: true }) }
  })
})
