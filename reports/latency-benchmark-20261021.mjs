// Diagnostic only. Run from the repository root:
// node --import tsx reports/latency-benchmark-20261021.mjs
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import { performance } from 'node:perf_hooks'
import { classify } from '../src/cts-core/classifier.ts'
import { classifyDomainML, getClassifierHealth } from '../src/cts-core/ml-classifier.ts'
import { scoreRelevance, getRelevanceHealth } from '../src/cts-core/ml-relevance.ts'
import { warmUpSemanticCache, getSemanticCacheHealth } from '../src/cts-core/semantic-cache.ts'
import { compressHistory, compressHistoryML } from '../src/cts-core/compressor.ts'

const warmups = 10
const runs = 100
const measurements = []
let sequence = 0

function history(size, tag) {
  return Array.from({ length: size }, (_, i) => ({
    role: i % 2 === 0 ? 'assistant' : 'user',
    content: i % 2 === 0
      ? `${tag} Turn ${i}: Check the TypeScript Express handler /api/users/${i}, its database connection, and the stack trace for the 500 error.`
      : `${tag} Turn ${i}: My TypeScript Express API returns 500 from /api/users/${i}. PostgreSQL reports a connection timeout. How do I debug this?`,
  }))
}

function checkScores(scores) {
  assert(scores.length > 0 && scores.every(Number.isFinite), 'Invalid relevance scores')
  assert(scores.some(score => Math.abs(score) > 0.00001), 'Relevance fell back to all-zero scores')
  assert(getRelevanceHealth().loaded, 'Relevance model is not loaded')
}

function checkCompression(result) {
  assert(result.originalTokens > 0 && result.compressedTokens > 0)
  assert(result.keptReasons.some(reason => reason.includes('ML')), 'ML compression path was bypassed')
  assert(getRelevanceHealth().loaded, 'Relevance model is not loaded')
}

async function measure(name, operation, validate, target_ms, notes) {
  for (let i = 0; i < warmups; i++) validate(await operation())
  const raw_ms = []
  for (let i = 0; i < runs; i++) {
    const started = performance.now()
    const result = await operation()
    raw_ms.push(performance.now() - started)
    validate(result) // Validate outside the timed interval.
  }
  const sorted = [...raw_ms].sort((a, b) => a - b)
  const percentile = p => sorted[Math.ceil(p * sorted.length) - 1]
  const result = {
    name, warmups, runs, p50_ms: percentile(0.5), p95_ms: percentile(0.95),
    p99_ms: percentile(0.99), min_ms: sorted[0], max_ms: sorted.at(-1),
    mean_ms: raw_ms.reduce((sum, value) => sum + value, 0) / runs,
    target_ms, within_reference_target: target_ms === null ? null : percentile(0.95) <= target_ms,
    notes, raw_ms,
  }
  measurements.push(result)
  console.log(`${name}: p50=${result.p50_ms.toFixed(2)}ms p95=${result.p95_ms.toFixed(2)}ms p99=${result.p99_ms.toFixed(2)}ms`)
}

const report = {
  timestamp: new Date().toISOString(),
  environment: { cpu: os.cpus()[0].model, logical_cpus: os.cpus().length,
    ram_gib: os.totalmem() / 1024 ** 3, platform: os.platform(), arch: os.arch(),
    node: process.version, transformers: JSON.parse(readFileSync('node_modules/@xenova/transformers/package.json', 'utf8')).version },
  scope: 'Local CPU, one request at a time, production TypeScript loaders, no external LLM/API calls. Fixtures are about 140 characters per message, not maximum-length stress inputs. Reference targets do not certify production container performance.',
  model: { path: 'ml/cts_relevance/onnx/model_quantized.onnx',
    sha256: createHash('sha256').update(readFileSync('ml/cts_relevance/onnx/model_quantized.onnx')).digest('hex') },
  measurements,
}

const firstStarted = performance.now()
const firstScores = await scoreRelevance('Why does checkout fail with 503 at /api/orders/sync?', [
  { role: 'user', content: 'The checkout endpoint returns 503 from /api/orders/sync with error ERR-48213.' },
  { role: 'assistant', content: 'Sounds good.' },
  { role: 'assistant', content: 'Hey, what are you working on?' },
])
report.first_load_and_three_message_score_ms = performance.now() - firstStarted
checkScores(firstScores)
assert(firstScores[0] > firstScores[1] && firstScores[0] > firstScores[2])
report.loading_check = { scores: firstScores, health: getRelevanceHealth() }
console.log(`First load + score: ${report.first_load_and_three_message_score_ms.toFixed(1)}ms`)

try { await classifyDomainML('Debug a TypeScript Express API returning 500') } catch {}
await warmUpSemanticCache()
report.other_models = [getClassifierHealth(), getSemanticCacheHealth()]
assert(report.other_models.every(model => !model.loaded), 'Additional models became available; expand the benchmark scope')

const stable20 = history(20, 'stable20')
const cachedQuery = 'Why does the TypeScript API return 500?'
await scoreRelevance(cachedQuery, stable20)
await measure('relevance_20_all_embeddings_cached',
  () => scoreRelevance(cachedQuery, stable20), checkScores, null,
  'All 21 texts have cached embeddings; no model inference. Not an inference latency result.')
await measure('relevance_20_cached_history_new_query',
  () => scoreRelevance(`Request ${sequence++}: Why does the TypeScript API return 500?`, stable20),
  checkScores, 35, '20 history embeddings cached; unique query on every warmup and measured call. One new embedding inference.')
await measure('relevance_20_uncached_query_and_history',
  () => { const tag = `batch${sequence++}`; return scoreRelevance(`${tag}: Why does the TypeScript API return 500?`, history(20, tag)) },
  checkScores, 35, 'All 21 texts are unique per call. Warm model; uncached embeddings; one batch forward.')

const stable40 = history(40, 'stable40')
const frame = classify(stable40.at(-1).content, stable40)
function changingHistory() {
  return [...stable40.slice(0, -1), { role: 'user', content: `Live request ${sequence++}: My TypeScript API returns 500. How do I fix the PostgreSQL connection timeout?` }]
}
await measure('rule_classification_40_messages',
  () => { const messages = changingHistory(); return classify(messages.at(-1).content, messages) },
  result => assert.equal(result.domain, 'coding'), 15,
  'Deterministic rule classification, no classifier model inference. Includes history context.')
await measure('rule_compression_40_messages',
  () => compressHistory(changingHistory(), frame),
  result => assert(result.originalTokens > 0 && result.compressedTokens > 0), 100,
  'Sync rule path used by the token-savings benchmark; stable older history, changing current turn. No model inference.')
await measure('ml_compression_40_cached_history_new_query',
  () => compressHistoryML(changingHistory(), frame), checkCompression, 50,
  'Loaded relevance model; older history cached; one unique current query per call. Precomputed routing frame.')
await measure('ml_compression_40_uncached_query_and_history',
  () => compressHistoryML(history(40, `fresh40-${sequence++}`), frame), checkCompression, 50,
  'Loaded relevance model; every history message and query unique per call. Precomputed routing frame.')
await measure('combined_rule_classify_ml_compress_serialize_40',
  async () => { const messages = changingHistory(); const route = classify(messages.at(-1).content, messages); const result = await compressHistoryML(messages, route); return { result, serialized: JSON.stringify(result.compressed) } },
  value => { checkCompression(value.result); assert(value.serialized.length > 0) }, 50,
  'Available local pipeline: rule classification + ML relevance compression + JSON serialization. Cached older history and unique query. DistilBERT unavailable.')

report.final_health = getRelevanceHealth()
report.output = `reports/latency_${report.timestamp.replaceAll(/[-:.]/g, '')}.json`
writeFileSync(report.output, JSON.stringify(report, null, 2) + '\n')
console.log(`Saved ${report.output}`)
