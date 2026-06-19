/**
 * Domain plugin eval — proves that custom domain plugins:
 *   1. Override the built-in classifier when keywords match
 *   2. Inject plugin behavior and constraints into the system prompt
 *   3. Do not fire when keywords are absent
 *   4. Compose correctly when multiple plugins are registered
 */

import { classify, routePrompt } from '../cts-core/index.js'
import type { CustomDomainPlugin, Message } from '../cts-core/index.js'

interface PluginCase {
  id: string
  description: string
  plugins: CustomDomainPlugin[]
  message: string
  history?: Message[]
  expectedDomain: string
  systemPromptContains?: string[]
  systemPromptExcludes?: string[]
}

const fintech: CustomDomainPlugin = {
  id: 'fintech',
  label: 'Fintech',
  keywords: ['upi', 'payments', 'wallet', 'banking api'],
  behavior: 'Handle this as a fintech product interaction with implementation and compliance awareness.',
  constraints: 'Avoid implying regulatory approval; distinguish product guidance from financial advice.',
}

const healthcare: CustomDomainPlugin = {
  id: 'healthcare',
  label: 'Healthcare',
  keywords: ['hipaa', 'ehr', 'patient record', 'phi'],
  behavior: 'Treat all data as potentially sensitive. Prioritize compliance and patient safety.',
  constraints: 'Never provide clinical advice. Flag any PHI-handling question for legal review.',
}

const devops: CustomDomainPlugin = {
  id: 'devops',
  label: 'DevOps',
  keywords: ['kubernetes', 'helm chart', 'ci/cd pipeline', 'terraform'],
  behavior: 'Provide infrastructure and deployment guidance with idempotency and rollback in mind.',
  constraints: 'Always recommend reviewing changes in staging before production.',
}

const cases: PluginCase[] = [
  {
    id: 'plugin_001',
    description: 'Fintech keyword triggers custom domain',
    plugins: [fintech],
    message: 'How do I integrate UPI payments into my mobile app?',
    expectedDomain: 'fintech',
    systemPromptContains: ['fintech', 'regulatory approval'],
  },
  {
    id: 'plugin_002',
    description: 'Healthcare keyword triggers custom domain',
    plugins: [healthcare],
    message: 'What is the best way to store patient record data to meet HIPAA requirements?',
    expectedDomain: 'healthcare',
    systemPromptContains: ['healthcare', 'PHI'],
  },
  {
    id: 'plugin_003',
    description: 'DevOps keyword triggers custom domain',
    plugins: [devops],
    message: 'How do I structure my Kubernetes helm chart for a multi-environment setup?',
    expectedDomain: 'devops',
    systemPromptContains: ['devops', 'staging before production'],
  },
  {
    id: 'plugin_004',
    description: 'Plugin does not fire when keywords are absent — falls through to built-in',
    plugins: [fintech],
    message: 'How do I debug a 401 error on my API endpoint?',
    expectedDomain: 'coding',
    systemPromptExcludes: ['regulatory approval'],
  },
  {
    id: 'plugin_005',
    description: 'Multiple plugins registered — only matching one activates',
    plugins: [fintech, healthcare, devops],
    message: 'How do I deploy my CI/CD pipeline using Terraform?',
    expectedDomain: 'devops',
    systemPromptContains: ['devops', 'staging before production'],
    systemPromptExcludes: ['regulatory approval', 'PHI'],
  },
  {
    id: 'plugin_006',
    description: 'Plugin keyword in history (not current message) triggers domain',
    plugins: [fintech],
    message: 'What is the best error handling strategy for this?',
    history: [
      { role: 'user', content: 'I am building a UPI payments flow for my app.' },
      { role: 'assistant', content: 'Sure, let me walk you through the integration.' },
    ],
    expectedDomain: 'fintech',
    systemPromptContains: ['fintech'],
  },
  {
    id: 'plugin_007',
    description: 'Plugin behavior appears in system prompt behavior field',
    plugins: [fintech],
    message: 'How do I handle wallet balance reconciliation?',
    expectedDomain: 'fintech',
    systemPromptContains: ['compliance awareness'],
  },
  {
    id: 'plugin_008',
    description: 'Plugin constraints replace default domain constraints',
    plugins: [fintech],
    message: 'What are the best practices for a payments wallet?',
    expectedDomain: 'fintech',
    systemPromptContains: ['distinguish product guidance from financial advice'],
    systemPromptExcludes: ['Use general assistant language'],
  },
  {
    id: 'plugin_009',
    description: 'Empty plugin list falls through to built-in domain',
    plugins: [],
    message: 'My blood pressure is 145/95, should I adjust my medication?',
    expectedDomain: 'medical',
    systemPromptContains: ['medical'],
  },
  {
    id: 'plugin_010',
    description: 'Plugin with banking api keyword (multi-word) triggers correctly',
    plugins: [fintech],
    message: 'I need help designing my banking api architecture.',
    expectedDomain: 'fintech',
    systemPromptContains: ['fintech'],
  },
  {
    id: 'plugin_011',
    description: 'Healthcare plugin does not fire on general coding message',
    plugins: [healthcare],
    message: 'How do I write a TypeScript interface for a user object?',
    expectedDomain: 'coding',
    systemPromptExcludes: ['PHI', 'patient safety'],
  },
  {
    id: 'plugin_012',
    description: 'Plugin domain id flows into system prompt domain label',
    plugins: [devops],
    message: 'Walk me through a Terraform destroy plan.',
    expectedDomain: 'devops',
    systemPromptContains: ['devops'],
  },
]

// ── runner ────────────────────────────────────────────────────────────────────

interface CaseResult {
  id: string
  description: string
  pass: boolean
  actualDomain: string
  expectedDomain: string
  domainPass: boolean
  containsChecks: { term: string; found: boolean }[]
  excludesChecks: { term: string; absent: boolean }[]
}

function runCase(c: PluginCase): CaseResult {
  const frame = classify(c.message, c.history ?? [], c.plugins)
  const route = routePrompt(frame, { customDomainPlugins: c.plugins })
  const prompt = route.systemPrompt

  const domainPass = frame.domain === c.expectedDomain

  const containsChecks = (c.systemPromptContains ?? []).map((term) => ({
    term,
    found: prompt.toLowerCase().includes(term.toLowerCase()),
  }))

  const excludesChecks = (c.systemPromptExcludes ?? []).map((term) => ({
    term,
    absent: !prompt.toLowerCase().includes(term.toLowerCase()),
  }))

  const pass = domainPass &&
    containsChecks.every((x) => x.found) &&
    excludesChecks.every((x) => x.absent)

  return {
    id: c.id,
    description: c.description,
    pass,
    actualDomain: frame.domain,
    expectedDomain: c.expectedDomain,
    domainPass,
    containsChecks,
    excludesChecks,
  }
}

function main(): void {
  const results: CaseResult[] = cases.map(runCase)

  for (const result of results) {
    const status = result.pass ? '[PASS]' : '[FAIL]'
    console.log(`${status} ${result.id}: ${result.description}`)
    if (!result.pass) {
      if (!result.domainPass) {
        console.log(`  domain: expected=${result.expectedDomain} actual=${result.actualDomain}`)
      }
      const missingContains = result.containsChecks.filter((x) => !x.found)
      const presentExcludes = result.excludesChecks.filter((x) => !x.absent)
      if (missingContains.length > 0) console.log(`  prompt missing: ${missingContains.map((x) => x.term).join(', ')}`)
      if (presentExcludes.length > 0) console.log(`  prompt should not contain: ${presentExcludes.map((x) => x.term).join(', ')}`)
    }
  }

  const passed = results.filter((r) => r.pass).length
  const total = results.length
  console.log(`\n=== DOMAIN PLUGIN EVAL SUMMARY ===`)
  console.log(`Cases: ${total}`)
  console.log(`Passed: ${passed}/${total} (${Math.round((passed / total) * 100)}%)`)
  console.log(`Domain accuracy: ${results.filter((r) => r.domainPass).length}/${total}`)
  console.log(`System prompt accuracy: ${results.filter((r) => r.containsChecks.every((x) => x.found) && r.excludesChecks.every((x) => x.absent)).length}/${total}`)

  if (passed < total) process.exit(1)
}

main()
