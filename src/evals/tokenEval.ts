import { cts, type Message } from '../cts-core/index.js'

type EvalCase = {
  name: string
  message: string
  history: Message[]
  expectedDomain: string
  expectedIntent: string
}

const repeatedSmallTalk: Message[] = [
  { role: 'user', content: 'hey' },
  { role: 'assistant', content: 'Hey, what are you working on?' },
  { role: 'user', content: 'random thought, I might build something later' },
  { role: 'assistant', content: 'Sounds good.' },
]

const cases: EvalCase[] = [
  {
    name: 'coding-debugging',
    expectedDomain: 'coding',
    expectedIntent: 'debugging',
    message: 'This webhook throws a 401 on every third request. Why is it failing?',
    history: [
      ...repeatedSmallTalk,
      { role: 'user', content: 'Help me build an auth system with JWT refresh tokens.' },
      { role: 'assistant', content: 'Use access tokens, refresh tokens, and server-side revocation.' },
      { role: 'user', content: 'Here is the error: 401 Unauthorized from /api/webhook/callback.' },
      { role: 'assistant', content: 'Check the signature validation and token expiry.' },
      { role: 'user', content: 'I tried rotating the signing secret but it still fails.' },
    ],
  },
  {
    name: 'customer-support-escalation',
    expectedDomain: 'customer_support',
    expectedIntent: 'escalation',
    message: "My order still hasn't arrived after 2 weeks. I want a refund now.",
    history: [
      ...repeatedSmallTalk,
      { role: 'user', content: "My order hasn't arrived." },
      { role: 'assistant', content: 'I can help check the status.' },
      { role: 'user', content: 'Tracking has not moved for days.' },
      { role: 'assistant', content: 'The carrier may be delayed.' },
      { role: 'user', content: 'This is getting urgent because it was a gift.' },
    ],
  },
  {
    name: 'sales-objection',
    expectedDomain: 'sales',
    expectedIntent: 'objection_handling',
    message: "I'm not sure yet. Your pricing seems higher than the competitor.",
    history: [
      ...repeatedSmallTalk,
      { role: 'user', content: 'Tell me about your product for support teams.' },
      { role: 'assistant', content: 'It routes tickets and summarizes customer history.' },
      { role: 'user', content: 'How does it compare to Zendesk?' },
      { role: 'assistant', content: 'It is lighter and more AI-native, but Zendesk has more enterprise workflows.' },
    ],
  },
  {
    name: 'medical-decision',
    expectedDomain: 'medical',
    expectedIntent: 'decision_support',
    message: 'I have had a headache and fever for 3 days. Should I see a doctor?',
    history: [
      ...repeatedSmallTalk,
      { role: 'user', content: 'I have a headache.' },
      { role: 'assistant', content: 'How long has it been happening?' },
      { role: 'user', content: 'The pain is moderate and I also have fever.' },
    ],
  },
]

function runEval(): void {
  const rows = cases.map((item) => {
    const result = cts({ message: item.message, history: item.history })
    const routePass = result.frame.domain === item.expectedDomain && result.frame.intent === item.expectedIntent
    const compressionRatio = result.compression.originalTokens === 0
      ? 0
      : result.compression.tokensSaved / result.compression.originalTokens

    return {
      case: item.name,
      route: `${result.frame.intent}/${result.frame.domain}`,
      routePass,
      originalTokens: result.compression.originalTokens,
      compressedTokens: result.compression.compressedTokens,
      tokensSaved: result.compression.tokensSaved,
      compressionRatio: `${Math.round(compressionRatio * 100)}%`,
    }
  })

  console.table(rows)
  const routePasses = rows.filter((row) => row.routePass).length
  const totalOriginal = rows.reduce((sum, row) => sum + row.originalTokens, 0)
  const totalSaved = rows.reduce((sum, row) => sum + row.tokensSaved, 0)
  const totalRatio = totalOriginal === 0 ? 0 : totalSaved / totalOriginal

  console.log(`\nRoute accuracy: ${routePasses}/${rows.length}`)
  console.log(`Estimated token savings: ${totalSaved}/${totalOriginal} (${Math.round(totalRatio * 100)}%)`)
}

runEval()

