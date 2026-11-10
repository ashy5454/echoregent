// Local measurements only: no provider requests or model downloads.
// Run from the repository: node --import tsx audit/bench/local-savings-report.mjs
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { encode } from 'gpt-tokenizer/encoding/o200k_base'
import { EchoRegent, restoreCompressedRequest } from '../../packages/core/src/index.ts'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const require = createRequire(import.meta.url)
const tsxLoader = pathToFileURL(require.resolve('tsx')).href
const evidence = join(root, 'docs/evidence')
const percent = (before, after) => Number(((before - after) / before * 100).toFixed(2))
const tokenCount = value => encode(JSON.stringify(value), { disallowedSpecial: new Set() }).length
const fixtureHash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex')

function requestFor(name, text, context = 'Diagnose the build and preserve unique observations.', array = false) {
  const output = array ? [{ type: 'input_text', text, marker: 'keep-this-metadata' }] : text
  return {
    model: 'local-measurement-fixture',
    instructions: 'Use the provided observations to answer the latest question accurately.',
    input: [
      { role: 'user', content: [{ type: 'input_text', text: context }] },
      { type: 'custom_tool_call', call_id: name, name: 'shell', input: 'node test.mjs' },
      { type: 'custom_tool_call_output', call_id: name, output },
    ],
  }
}

function outputTexts(request) {
  return request.input.flatMap(item => {
    if (item.type !== 'custom_tool_call_output') return []
    return typeof item.output === 'string'
      ? [item.output]
      : item.output.filter(part => typeof part.text === 'string').map(part => part.text)
  })
}

function structure(request) {
  const next = structuredClone(request)
  for (const item of next.input) {
    for (const field of ['content', 'output']) {
      if (typeof item[field] === 'string') item[field] = '<text>'
      else if (Array.isArray(item[field])) for (const part of item[field]) if (typeof part.text === 'string') part.text = '<text>'
    }
  }
  return JSON.stringify(next)
}

function packagedFixtures() {
  const repeated = '[INFO] fixture input validated\n'.repeat(600) + 'RESULT 8/8 passed\n'
  const mixed = Array.from({ length: 40 }, (_, index) =>
    ('[INFO] build stage ' + index + ' waiting\n').repeat(8)
      + '[WARN] stage ' + index + ' retained observation\n',
  ).join('') + 'FAIL endpoint /v2/reconcile status 503 trace QZ-8407\n'
  const timestamped = Array.from({ length: 600 }, (_, index) =>
    '[INFO] timestamp=' + index + ' fixture input validated',
  ).join('\n')
  const dense = Array.from({ length: 240 }, (_, index) =>
    '[INFO] stage=' + index + ' endpoint=/v2/item/' + index + ' status=' + (200 + index % 5),
  ).join('\n')
  const fence = String.fromCharCode(96).repeat(3)
  const cases = [
    { name: '600 repeated fixture logs', request: requestFor('repeat600', repeated) },
    { name: 'mixed logs with duplicate runs', request: requestFor('mixed', mixed) },
    { name: 'custom input_text output block', request: requestFor('text-block', repeated, undefined, true) },
    { name: 'timestamped non-identical logs', request: requestFor('timestamps', timestamped) },
    { name: 'dense unique tool output', request: requestFor('dense', dense) },
    { name: 'structured JSON tool output', request: requestFor('json', JSON.stringify({ events: Array(300).fill('[INFO] fixture input validated') })), unchanged: true },
    { name: 'fenced tool output', request: requestFor('fenced', fence + '\n' + repeated + fence), unchanged: true },
    { name: 'medical protected context', request: requestFor('medical', repeated, 'My prescription dosage is 20 mg. Please preserve my medical context.'), unchanged: true, protected: true },
    { name: 'legal protected context', request: requestFor('legal', repeated, 'Preserve the legal contract and indemnity clause.'), unchanged: true, protected: true },
    { name: 'older uncompressed tool output', request: requestFor('older', repeated), unchanged: true },
    {
      name: 'ordinary conversation without tool output',
      label: 'Templated conversation: 40 numbered build turns',
      request: {
        model: 'local-measurement-fixture',
        instructions: 'Answer the latest question.',
        input: Array.from({ length: 40 }, (_, index) => ({
          role: index % 2 ? 'assistant' : 'user',
          content: [{ type: 'input_text', text: 'We are discussing the build step ' + index + ' and its next action.' }],
        })),
      },
      historyOnly: true,
    },
  ]
  cases.find(item => item.name === 'older uncompressed tool output').request.input.push({
    role: 'user', content: [{ type: 'input_text', text: 'Now explain the final result.' }],
  })
  return cases
}

function supplementalFixtures() {
  // Non-monotonic timestamps/IDs prove that a decoder cannot infer changing values from row numbers.
  const productionLogs = Array.from({ length: 600 }, (_, index) => {
    const event = (index * 137) % 600
    const time = new Date(Date.UTC(2026, 10, 10, 18, 0, event)).toISOString()
    return `${time} [INFO] worker=alpha seq=${String(event).padStart(6, '0')} object=/item/${event} status=${200 + index % 5} event=validated`
  }).join('\r\n') + '\r\n'
  const descriptions = [
    'The build folder contains generated bundles.', 'Use the small icon in the toolbar.',
    'The worker consumes tasks from a queue.', 'Move sorting into the table component.',
    'Each deployment reads environment settings.', 'The editor stores tabs separately.',
    'Archive the completed import after verification.', 'The metrics page defaults to last week.',
    'Colors must remain visible against white.', 'Upload the document through the sidebar.',
    'The parser accepts quoted field names.', 'The branch selector shows recent activity.',
    'A connection closes after its last response.', 'The search panel remembers its width.',
    'Pin the welcome document in the navigation.', 'Background jobs retry after a short delay.',
    'Rendered images follow the available space.', 'The export command writes a single archive.',
    'Inspect network events in the debugging panel.', 'The chart groups observations by category.',
    'Load the font before computing text positions.', 'The shell launches from the project directory.',
    'Every row links to its source entry.', 'Filter the collection before computing totals.',
    'The preview shares settings with the editor.', 'Dates follow the configured display format.',
    'Save the canvas after the drag completes.', 'The menu closes when focus moves away.',
    'Wait for the worker to announce readiness.', 'The footer contains release information.',
    'Select an existing workspace from the list.', 'The report includes unsuccessful imports.',
    'Move the title above the description.', 'The link opens its target in a separate tab.',
    'Choose a narrower column for the timestamp.', 'The console prints the final execution status.',
    'Include file sizes in the archive listing.', 'The renderer shares a single texture atlas.',
    'Round displayed totals only at presentation.', 'The session ends after its final acknowledgement.',
  ]
  return [
    { name: 'ISO timestamps, changing IDs and statuses', request: requestFor('iso-timestamps', productionLogs) },
    { name: 'unique opaque event payloads', request: requestFor('opaque', Array.from({ length: 240 }, (_, i) =>
      '[INFO] payload=' + createHash('sha256').update('opaque-event-' + i).digest('hex')).join('\n')), unchanged: true },
    { name: 'diverse conversation: 40 different sentences', request: {
      model: 'local-measurement-fixture', instructions: 'Answer the latest question.',
      input: descriptions.map((text, index) => ({ role: index % 2 ? 'assistant' : 'user', content: [{ type: 'input_text', text }] })),
    }, unchanged: true },
  ]
}

function measurePackagedRuntime(cases, compactHistory) {
  return cases.map(item => {
    const original = JSON.stringify(item.request)
    const result = new EchoRegent({ compactHistory }).process(item.request, 'responses')
    const restored = restoreCompressedRequest(result.request, 'responses')
    const before = tokenCount(item.request)
    const after = tokenCount(result.request)
    const originalLines = [...new Set(outputTexts(item.request).flatMap(text => text.split(/\r?\n/)).filter(line => line.trim()))]
    const resultText = outputTexts(restored).join('\n')
    const missingLines = originalLines.filter(line => !resultText.includes(line))
    const checks = {
      exactRequestReconstruction: JSON.stringify(restored) === original,
      uniqueLinesPreserved: missingLines.length === 0,
      inputNotMutated: JSON.stringify(item.request) === original,
      structurePreserved: structure(item.request) === structure(result.request),
      recentConversationPreserved: item.request.input.every((entry, index) =>
        index < item.request.input.length - 8 || !['user', 'assistant'].includes(entry.role)
          || JSON.stringify(result.request.input[index]) === JSON.stringify(entry)),
      currentUserPreserved: item.request.input.findLastIndex(entry => entry.role === 'user') < 0
        || JSON.stringify(result.request.input[item.request.input.findLastIndex(entry => entry.role === 'user')])
          === JSON.stringify(item.request.input[item.request.input.findLastIndex(entry => entry.role === 'user')]),
      expectedPassThrough: !(item.unchanged || item.historyOnly && !compactHistory) || JSON.stringify(result.request) === original,
      protectedWhenExpected: !item.protected || result.policy.protected,
      noTokenGrowth: after <= before,
    }
    assert(Object.values(checks).every(Boolean), item.name + ': ' + JSON.stringify(checks))
    return { name: item.name, label: item.label ?? item.name, compactHistory, before, after, saved: before - after,
      savingsPct: percent(before, after), changed: result.changed, reason: result.reason,
      fixtureHash: fixtureHash(item.request), reconstructionHash: fixtureHash(restored),
      checks, uniqueLines: originalLines.length, messages: item.request.input.filter(entry => ['user', 'assistant'].includes(entry.role)).length }
  })
}

function totals(rows) {
  const before = rows.reduce((sum, row) => sum + row.before, 0)
  const after = rows.reduce((sum, row) => sum + row.after, 0)
  return { before, after, saved: before - after, savingsPct: percent(before, after),
    cases: rows.length, changedCases: rows.filter(row => row.changed).length,
    invariantChecksPassed: rows.every(row => Object.values(row.checks).every(Boolean)) }
}

function runHistoryWorker(script, cwd, arm, ml) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, ['--import', tsxLoader, script], {
      cwd, shell: false, stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CTS_BENCH_ML: ml ? '1' : '0', ECHOREGENT_MEASUREMENT_ARM: arm },
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => stdout += chunk)
    child.stderr.on('data', chunk => stderr += chunk)
    child.once('error', reject)
    child.once('close', code => {
      const line = stdout.split(/\r?\n/).find(line => line.startsWith('{"measurement":"legacy-history"'))
      if (!line) return reject(new Error('History measurement failed for ' + arm + ': ' + stderr + stdout))
      resolveRun({ ...JSON.parse(line), exitCode: code, rawOutput: stdout })
    })
  })
}

async function main() {
  const temporaryParent = await realpath(tmpdir())
  const temporary = await mkdtemp(join(temporaryParent, 'echoregent-local-savings-'))
  try {
    const originalSource = await readFile(join(root, 'audit/bench/token-savings-bench.ts'), 'utf8')
    assert.equal((originalSource.match(/process\.exit\(aggregateCompressible/g) ?? []).length, 1)
    // Capture the existing benchmark's counters without editing its source or fixtures.
    const capture = [
      'console.log(JSON.stringify({',
      "measurement: 'legacy-history', arm: process.env.ECHOREGENT_MEASUREMENT_ARM,",
      'templates: TEMPLATES.length, variantsPerTemplate: RUNS_PER_DOMAIN, cases: results.length,',
      'before: totalOriginal, after: totalCompressed, saved: totalOriginal - totalCompressed,',
      'savingsPct: (totalOriginal - totalCompressed) / totalOriginal * 100,',
      'factsKept, factsTotal, currentKept,',
      'modelHealth: getRelevanceHealth(),',
      "fixtureHash: createMeasurementHash('sha256').update(JSON.stringify(TEMPLATES.flatMap(t => Array.from({ length: RUNS_PER_DOMAIN }, (_, i) => buildConversation(t, mulberry32(1000 + i * 31 + t.domain.length)))))).digest('hex'),",
      'domains: Array.from(byDomain, ([domain, rows]) => ({ domain, before: rows.reduce((sum, row) => sum + row.original, 0), after: rows.reduce((sum, row) => sum + row.compressed, 0), factsKept: rows.reduce((sum, row) => sum + row.factHits, 0), factsTotal: rows.reduce((sum, row) => sum + row.factTotal, 0) })),',
      'failedCases: results.filter(row => !row.currentKept || row.missing.length),',
      '}));',
    ].join('\n')
    const instrumented = "import { createHash as createMeasurementHash } from 'node:crypto';\n"
      + originalSource.replace(/from ['"]\.\.\/\.\.\/src\/cts-core\/([^'"]+)['"]/g,
        (_match, name) => "from '" + pathToFileURL(join(root, 'src/cts-core', name + '.ts')).href + "'")
        .replace('process.exit(aggregateCompressible', capture + '\nprocess.exit(aggregateCompressible')
    const script = join(temporary, 'history-measurement.mts')
    await writeFile(script, instrumented)
    const baseCwd = join(temporary, 'base-minilm')
    const baseModel = join(baseCwd, 'ml/cts_relevance')
    await mkdir(join(baseModel, 'onnx'), { recursive: true })
    for (const name of ['config.json', 'tokenizer.json', 'tokenizer_config.json']) {
      await copyFile(join(root, 'ml/cts_minilm', name), join(baseModel, name))
    }
    await copyFile(join(root, 'ml/cts_minilm/onnx/model_pooled_quantized.onnx'), join(baseModel, 'onnx/model_pooled_quantized.onnx'))
    const history = []
    for (const [arm, cwd, ml] of [['rules', root, false], ['fine-tuned relevance', root, true], ['base MiniLM', baseCwd, true]]) {
      history.push(await runHistoryWorker(script, cwd, arm, ml))
    }
    assert.equal(new Set(history.map(result => result.fixtureHash)).size, 1, 'History inputs differ between arms')
    const fixtures = packagedFixtures()
    const supplementalInputs = supplementalFixtures()
    const packaged = measurePackagedRuntime(fixtures, false)
    const packagedHistoryEnabled = measurePackagedRuntime(fixtures, true)
    const supplemental = measurePackagedRuntime(supplementalInputs, false)
    const supplementalHistoryEnabled = measurePackagedRuntime(supplementalInputs, true)
    assert.deepEqual(packaged.map(row => row.fixtureHash), packagedHistoryEnabled.map(row => row.fixtureHash))
    assert.deepEqual(supplemental.map(row => row.fixtureHash), supplementalHistoryEnabled.map(row => row.fixtureHash))
    const packagedTotals = totals(packaged)
    const historyEnabledTotals = totals(packagedHistoryEnabled)
    const baseline = JSON.parse(await readFile(join(evidence, 'local-token-savings-baseline.json'), 'utf8'))
    const comparisonToBaseline = packaged.map(row => {
      const prior = baseline.packaged.find(previous => previous.name === row.name)
      assert(prior, 'No baseline for ' + row.name)
      assert.equal(prior.before, row.before, 'Baseline input token count changed for ' + row.name)
      return { name: row.name, before: row.before, previousAfter: prior.after, defaultAfter: row.after,
        historyEnabledAfter: packagedHistoryEnabled.find(enabled => enabled.name === row.name).after }
    })
    const report = {
      measuredAt: new Date().toISOString(),
      inference: 'Local only. No provider calls or API credits.',
      counting: 'gpt-tokenizer 4.0.0: o200k_base on serialized request JSON for package cases; existing gpt-4o chat-token estimator for history cases.',
      limitations: [
        'History benchmark has 8 known synthetic templates with 40 acknowledgement variants each; it is not a held-out or production benchmark.',
        'History results describe legacy development compression, not the current packaged proxy. Its medical/legal policy differs from the packaged protected-context policy.',
        'Package totals depend on this deliberately selected mixture of repeated logs and pass-through controls.',
        'The numbered build-turn fixture is templated prose, not arbitrary ordinary conversation. Diverse prose and opaque unique payloads are separate pass-through controls.',
        'Optional history factoring preserves the latest user message and at least the last eight items. A newly aged chunk may change a provider prefix once; already factored chunks are deterministic.',
        'Tokenizer estimates do not establish provider-billed savings, cache hits, output-token changes, or monetary savings.',
        'Exact reconstructed package requests verify every text character, value, association, role, ID and metadata field in these fixtures. Upstream interpretation of templates and semantic answer quality were not tested.',
      ],
      baseline: { file: 'local-token-savings-baseline.json', measuredAt: baseline.measuredAt, totals: baseline.packagedTotals },
      history, packagedTotals, historyEnabledTotals, comparisonToBaseline,
      packaged, packagedHistoryEnabled, supplemental, supplementalHistoryEnabled,
    }
    await mkdir(evidence, { recursive: true })
    await writeFile(join(evidence, 'local-token-savings-report.json'), JSON.stringify(report, null, 2) + '\n')
    const markdown = [
      '# Local token savings measurement', '',
      'Measured: ' + report.measuredAt, '', report.inference, '',
      '## Existing synthetic history regression', '',
      'Eight known templates, 40 acknowledgement variants per template. The three arms receive identical fixture inputs. These results describe the legacy development history compressor.', '',
      '| Path | Before | After | Saved | Reduction | Facts | Current turn |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...history.map(row => '| ' + row.arm + ' | ' + row.before + ' | ' + row.after + ' | ' + row.saved + ' | ' + row.savingsPct.toFixed(2) + '% | ' + row.factsKept + '/' + row.factsTotal + ' | ' + row.currentKept + '/' + row.cases + ' |'),
      '', '## Current packaged runtime', '',
      'The same eleven input fixtures as the preserved baseline are measured with history off and on. Input token counts match the baseline; both current arms use identical fixture hashes. Counts include serialized request JSON and fixed context.', '',
      'Every reconstructed request equals its original exactly. Separate checks cover roles, IDs, ordering, metadata, unique lines, caller mutation, current/recent messages, protected context and token growth.', '',
      '| Input | Before | Previous after | Default after | Default reduction | History on after | History on reduction |',
      '| --- | ---: | ---: | ---: | ---: | ---: | ---: |',
      ...packaged.map((row, index) => '| ' + row.label + ' | ' + row.before + ' | ' + comparisonToBaseline[index].previousAfter + ' | ' + row.after + ' | ' + row.savingsPct.toFixed(2) + '% | ' + packagedHistoryEnabled[index].after + ' | ' + packagedHistoryEnabled[index].savingsPct.toFixed(2) + '% |'),
      '| Selected mixture total | ' + packagedTotals.before + ' | ' + baseline.packagedTotals.after + ' | ' + packagedTotals.after + ' | ' + packagedTotals.savingsPct.toFixed(2) + '% | ' + historyEnabledTotals.after + ' | ' + historyEnabledTotals.savingsPct.toFixed(2) + '% |',
      '', '## Additional controls', '',
      'These fixtures are excluded from the eleven-case mixture total. ISO log timestamps and IDs vary in non-monotonic order and every value must reconstruct exactly.', '',
      '| Input | Before | Default after | History on after | History on reduction |',
      '| --- | ---: | ---: | ---: | ---: |',
      ...supplemental.map((row, index) => '| ' + row.label + ' | ' + row.before + ' | ' + row.after + ' | ' + supplementalHistoryEnabled[index].after + ' | ' + supplementalHistoryEnabled[index].savingsPct.toFixed(2) + '% |'),
      '', '## Enable older conversation compaction', '',
      'Log compaction is automatic. History factoring is optional and requires repeated wording. Recent turns stay verbatim.', '',
      '```sh', 'echoregent proxy --compact-history', 'echoregent wrap codex --compact-history', '```', '',
      'SDK: `new EchoRegent({ compactHistory: true })`. Inspect original text with `restoreCompressedRequest(result.request, protocol)` or `decompressText(result.text)` for standalone log text.',
      '', '## Limits', '', ...report.limitations.map(item => '- ' + item),
      '', 'Previous evidence: [LOCAL_TOKEN_SAVINGS_BASELINE.md](LOCAL_TOKEN_SAVINGS_BASELINE.md).',
      '', 'Reproduce from the repository with: node --import tsx audit/bench/local-savings-report.mjs', '',
    ].join('\n')
    await writeFile(join(evidence, 'LOCAL_TOKEN_SAVINGS_REPORT.md'), markdown)
    console.log(JSON.stringify({ history: history.map(({ rawOutput, domains, failedCases, ...row }) => row), packagedTotals, historyEnabledTotals,
      packaged: packaged.map(({ checks, ...row }) => row), packagedHistoryEnabled: packagedHistoryEnabled.map(({ checks, ...row }) => row),
      supplemental: supplementalHistoryEnabled.map(({ checks, ...row }) => row), report: join(evidence, 'LOCAL_TOKEN_SAVINGS_REPORT.md') }, null, 2))
  } finally {
    // Only delete the exact task-created child of the resolved temporary directory.
    const resolvedTemporary = await realpath(temporary)
    assert.equal(dirname(resolvedTemporary).toLowerCase(), temporaryParent.toLowerCase())
    assert(basename(resolvedTemporary).startsWith('echoregent-local-savings-'))
    await rm(resolvedTemporary, { recursive: true, force: true })
  }
}

await main()
