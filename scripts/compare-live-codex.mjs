import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const run = Number(process.argv[2] ?? 2)
const root = resolve(import.meta.dirname, '..')
const read = (arm) => readFile(resolve(root, `docs/evidence/live-codex-${arm}-run-${run}.json`), 'utf8').then(JSON.parse)
const [baseline, echo] = await Promise.all([read('baseline'), read('echoregent')])
for (const field of ['model', 'provider', 'reasoning', 'taskHash', 'fixtureHash']) assert.equal(baseline[field], echo[field], `Unmatched ${field}`)
assert.ok(baseline.completed && echo.completed, 'Both coding tasks must complete before comparing savings')
const startDifferenceMs = Math.abs(Date.parse(baseline.startedAt) - Date.parse(echo.startedAt))
assert.ok(startDifferenceMs < 1000, 'Paired runs did not start concurrently')
for (const record of [baseline, echo]) {
  assert.ok(record.providerTotals, 'Missing provider usage')
  assert.equal(record.errors.length, 0, 'Run had reported errors')
  assert.ok(record.calls.every((call) => call.status === 200 && !call.error && call.usage.length === 1), 'Incomplete provider usage coverage')
  const clientInput = record.clientUsage.reduce((sum, usage) => sum + usage.input_tokens, 0)
  const clientOutput = record.clientUsage.reduce((sum, usage) => sum + usage.output_tokens, 0)
  assert.equal(record.providerTotals.inputTokens, clientInput, 'Provider/client input counts disagree')
  assert.equal(record.providerTotals.outputTokens, clientOutput, 'Provider/client output counts disagree')
}
const row = (record) => ({ ...record.providerTotals, latencyMs: record.latencyMs, providerRequests: record.calls.length, compressedRequests: record.proxyStats?.compressed ?? 0, middlewareErrors: record.proxyStats?.errors ?? 0, passed: record.testResult })
const difference = Object.fromEntries(['inputTokens','cachedInputTokens','uncachedInputTokens','outputTokens','totalTokens'].map((field) => [field, echo.providerTotals[field] - baseline.providerTotals[field]]))
const summary = { run, model: baseline.model, provider: baseline.provider, task: 'Repair a usage normalizer with a repetitive test log', startDifferenceMs, baseline: row(baseline), echoregent: row(echo), echoMinusBaseline: difference, totalTokenReductionPct: 100 * (baseline.providerTotals.totalTokens - echo.providerTotals.totalTokens) / baseline.providerTotals.totalTokens, billedCost: null, limitations: ['One live paired sample; model trajectories and cache usage can differ.', 'The task intentionally includes repetitive logs to exercise compression.', 'Reported tokens are verified against provider SSE and Codex aggregates; no invoice/pricing comparison.', 'Coordinator and diagnostic run tokens are excluded from the task comparison.'] }
const output = resolve(root, `docs/evidence/live-codex-comparison-run-${run}.json`)
await writeFile(output, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
