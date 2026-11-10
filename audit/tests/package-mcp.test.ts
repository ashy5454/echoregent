import { describe, expect, it } from 'vitest'
import { EchoRegent } from '../../packages/core/src/index.js'
import * as mcp from '../../packages/cli/src/mcp.js'
import * as codex from '../../packages/cli/src/codex.js'

describe('CLI adapters share core behavior', () => {
  it('exports MCP operations and Codex launcher configuration', () => {
    expect(mcp.callTool).toBeTypeOf('function')
    expect(codex.buildCodexArgs).toBeTypeOf('function')
  })
  it('binds MCP memory to one explicit scope and applies protection rules', async () => {
    const engine = new EchoRegent({ memory: { mode: 'ephemeral', retentionMs: 60_000 } })
    const scope = { project: 'p', session: 's' }
    const denied = await mcp.callTool(engine, scope, 'remember', { content: 'My medication dose', sources: ['turn:1'] })
    expect(denied.isError).toBe(true)
    const stored = await mcp.callTool(engine, scope, 'remember', { content: 'Use TypeScript', sources: ['README.md:1'], scope: { project: 'elsewhere', session: 'elsewhere' } })
    expect(stored.isError).not.toBe(true)
    expect((await engine.recall(scope, 'TypeScript'))[0].content).toBe('Use TypeScript')
    expect(await engine.recall({ project: 'elsewhere', session: 'elsewhere' }, '')).toEqual([])
    const compressed = await mcp.callTool(engine, scope, 'compress', { text: 'legal contract\n'.repeat(80) })
    expect(JSON.parse(compressed.content[0].text).policy.protected).toBe(true)
    const blockedRecall = await mcp.callTool(engine, scope, 'recall', { query: 'TypeScript' })
    expect(JSON.parse(blockedRecall.content[0].text)).toEqual([])
  })
  it('configures a per-launch Responses provider without durable edits', () => {
    const args = codex.buildCodexArgs('http://127.0.0.1:1234/v1', 'ECHOREGENT_PROVIDER_KEY', ['exec', 'hello'])
    expect(args.slice(-2)).toEqual(['exec', 'hello'])
    expect(args).toContain('model_providers.echoregent.wire_api="responses"')
    expect(args).toContain('model_providers.echoregent.base_url="http://127.0.0.1:1234/v1"')
    expect(args).toContain('model_providers.echoregent.env_key="ECHOREGENT_PROVIDER_KEY"')
    expect(args).toContain('model_provider="echoregent"')
    expect(() => codex.buildCodexArgs('http://127.0.0.1:1234/v1', 'KEY', ['--config', 'model_provider="other"'])).toThrow(/routing/i)
    for (const bypass of [ ['--config=model_provider="other"'], ['--profile=other'], ['-pother'], ['-c', ' model_provider="other"'], ['-cmodel_provider="other"'] ]) {
      expect(() => codex.buildCodexArgs('http://127.0.0.1:1234/v1', 'KEY', bypass)).toThrow(/routing/i)
    }
  })
})
