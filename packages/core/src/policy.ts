import { classify } from './classifier.js'
import type { CustomDomainPlugin, RoutingFrame } from './types.js'

export interface PolicyDecision {
  protected: boolean
  compression: boolean
  memory: boolean
  responseCache: false
  reasons: string[]
  frame: RoutingFrame
}

const BASE_CODING_KEYWORDS = [
  'echoregent',
  'smart contract',
  'smart contracts',
  'solidity',
  'db lease',
  'database lease',
  'pain point',
  'pain points',
  'brew doctor',
  'flutter doctor',
  'npm doctor',
  'pnpm doctor',
  'yarn doctor',
]

/** Built-in protection cannot be weakened by a domain plugin or an adapter. */
export function evaluatePolicy(text: string): PolicyDecision {
  const keywords = [...BASE_CODING_KEYWORDS]
  if (
    /\b(?:npm|yarn|pnpm|npx|brew|flutter|echoregent|git|cli|workspace|cargo|rustup)\b/i.test(text) &&
    /\bdoctor\b/i.test(text)
  ) {
    keywords.push('doctor')
  }
  if (
    /\b(?:solidity|ethereum|web3|crypto|erc\d+|evm)\b/i.test(text) &&
    /\bcontract\b/i.test(text)
  ) {
    keywords.push('contract')
  }
  if (
    /\b(?:redis|postgres|mysql|sqlite|db|database|lock)\b/i.test(text) &&
    /\blease\b/i.test(text)
  ) {
    keywords.push('lease')
  }
  if (/\bpain\s+points?\b/i.test(text)) {
    keywords.push('pain')
  }

  const codingPlugin: CustomDomainPlugin = {
    id: 'coding',
    label: 'coding',
    keywords,
    behavior: 'coding',
    constraints: 'none',
  }

  const frame = classify(text, [], [codingPlugin])
  const reasons: string[] = []
  const isCoding = frame.domain === 'coding'

  // Crisis / self-harm / protected_context: always protects regardless of domain
  if (
    frame.risk.some((risk) => risk === 'crisis' || risk === 'protected_context') ||
    /\b(suicid\w*|self[- ]harm|kill myself|end my life|want to die|protected_context)\b/i.test(text)
  ) {
    reasons.push('crisis-or-protected-context')
  }

  // Medical check:
  if (isCoding) {
    // When coding, standalone words like 'doctor' (e.g. 'echoregent doctor') or 'pain' (e.g. 'pain points')
    // must NOT trigger protection unless genuine clinical/medical phrases are present.
    if (
      /\b(medical (?:advice|condition|care|treatment|history|attention)|medication|prescription|dosage|symptoms?|diagnosis|diagnosed|blood pressure|chest pain|bleeding|(?:see|consult|visit)\s+(?:a\s+)?doctor|doctor\s+prescribed)\b/i.test(
        text,
      )
    ) {
      reasons.push('medical')
    }
  } else {
    if (
      frame.domain === 'medical' ||
      /\b(medical|medication|prescription|dosage|symptoms?|diagnosis|diagnosed|blood pressure|chest pain|bleeding|doctor)\b/i.test(
        text,
      )
    ) {
      reasons.push('medical')
    }
  }

  // Legal check:
  if (isCoding) {
    // When coding, standalone words like 'contract' (smart contracts), 'clause' (SQL/code clause),
    // or 'lease' (DB lease) must NOT trigger protection unless genuine legal-advice/litigation phrases are present.
    if (
      /\b(legal advice|lawsuit|litigation|eviction|indemnity|legal counsel|attorney|breach of contract|liable for damages)\b/i.test(
        text,
      )
    ) {
      reasons.push('legal')
    }
  } else {
    if (
      frame.domain === 'legal' ||
      /\b(legal advice|lawsuit|litigation|lease|contract|clause|eviction|indemnity)\b/i.test(
        text,
      )
    ) {
      reasons.push('legal')
    }
  }

  return {
    protected: reasons.length > 0,
    compression: reasons.length === 0,
    memory: reasons.length === 0,
    responseCache: false,
    reasons,
    frame,
  }
}
