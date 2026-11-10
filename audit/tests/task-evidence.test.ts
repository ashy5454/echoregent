import { expect, it } from 'vitest'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

it('summarizes actual paired provider metrics and rejects unmatched task settings', () => {
  const directory = mkdtempSync(join(tmpdir(), 'echoregent-evidence-'))
  try {
    const path = join(directory, 'records.jsonl')
    const output = join(directory, 'summary.json')
    const script = join(__dirname, '../../scripts/task-evidence.mjs')
    const common = { taskId: 'task-1', run: 1, completed: true, latencyMs: 1000, retries: 0, provider: 'fixture', model: 'fixture', agent: 'codex', cacheConfiguration: 'same', usageSource: 'provider', calls: [{ inputTokens: 100, cachedInputTokens: 40, outputTokens: 10 }], billedCost: 0.01 }
    const baseline = { ...common, arm: 'baseline' }
    const compressed = { ...common, arm: 'echoregent', calls: [{ inputTokens: 80, cachedInputTokens: 20, outputTokens: 15 }], billedCost: 0.009 }
    writeFileSync(path, [baseline, compressed].map((record) => JSON.stringify(record)).join('\n'))
    const success = spawnSync(process.execPath, [script, path, output], { encoding: 'utf8' })
    expect(success.status).toBe(0)
    const summary = JSON.parse(readFileSync(output, 'utf8'))
    expect(summary.matchedPairs).toBe(1)
    expect(summary.arms.baseline.inputTokens).toBe(100)
    expect(summary.arms.echoregent.cachedInputTokens).toBe(20)
    expect(summary.arms.echoregent.billedCost).toBe(0.009)
    writeFileSync(path, [baseline, { ...compressed, model: 'different' }].map((record) => JSON.stringify(record)).join('\n'))
    expect(spawnSync(process.execPath, [script, path, output]).status).not.toBe(0)
    writeFileSync(path, JSON.stringify({ ...baseline, usageSource: 'character-estimate' }))
    expect(spawnSync(process.execPath, [script, path, output]).status).not.toBe(0)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
