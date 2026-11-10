import { readFile, writeFile } from 'node:fs/promises'

// One JSONL record per completed task attempt (include all provider calls/retries):
// { taskId, arm: "baseline" | "echoregent", run, completed: boolean,
//   latencyMs, retries, provider, model, agent, cacheConfiguration,
//   usageSource: "provider", calls: [{ inputTokens, cachedInputTokens, outputTokens }],
//   billedCost: number } -- cost from actual provider pricing/records, same currency.
const [input, output] = process.argv.slice(2)
if (!input || !output) throw new Error('Usage: node scripts/task-evidence.mjs results.jsonl summary.json')
const records = (await readFile(input, 'utf8')).split(/\r?\n/).filter((line) => line.trim()).map((line) => JSON.parse(line))
const numeric = (value) => Number.isFinite(value) && value >= 0
if (!records.length) throw new Error('No task records')
for (const record of records) {
  if (!record.taskId || !['baseline', 'echoregent'].includes(record.arm) || !Number.isInteger(record.run) || typeof record.completed !== 'boolean' || !numeric(record.latencyMs) || !Number.isInteger(record.retries) || record.retries < 0 || !record.provider || !record.model || !record.agent || typeof record.cacheConfiguration !== 'string' || record.usageSource !== 'provider' || !numeric(record.billedCost) || !Array.isArray(record.calls) || !record.calls.length) throw new Error(`Incomplete task record: ${record.taskId ?? 'unknown'}`)
  for (const call of record.calls) if (![call.inputTokens, call.cachedInputTokens, call.outputTokens].every(numeric) || call.cachedInputTokens > call.inputTokens) throw new Error(`Invalid provider usage: ${record.taskId}`)
}
const pairs = new Map()
for (const record of records) {
  const key = JSON.stringify([record.taskId, record.run, record.provider, record.model, record.agent, record.cacheConfiguration])
  const pair = pairs.get(key) ?? {}
  if (pair[record.arm]) throw new Error(`Duplicate task arm: ${record.taskId}`)
  pair[record.arm] = record
  pairs.set(key, pair)
}
if ([...pairs.values()].some((pair) => !pair.baseline || !pair.echoregent)) throw new Error('Each task/run needs matched baseline and EchoRegent arms with identical settings')
const arms = Object.fromEntries(['baseline', 'echoregent'].map((arm) => {
  const items = records.filter((record) => record.arm === arm)
  const sum = (field) => items.reduce((total, record) => total + record[field], 0)
  const calls = items.flatMap((record) => record.calls)
  const tokens = (field) => calls.reduce((total, call) => total + call[field], 0)
  return [arm, { tasks: items.length, completed: items.filter((record) => record.completed).length, billedCost: sum('billedCost'), latencyMs: sum('latencyMs'), retries: sum('retries'), providerCalls: calls.length, inputTokens: tokens('inputTokens'), cachedInputTokens: tokens('cachedInputTokens'), outputTokens: tokens('outputTokens') }]
}))
const summary = { usageSource: 'provider', matchedPairs: pairs.size, arms, note: 'Aggregate observations for supplied paired tasks; not a universal quality or savings claim.' }
await writeFile(output, JSON.stringify(summary, null, 2) + '\n')
console.log(JSON.stringify(summary, null, 2))
