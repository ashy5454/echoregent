import type { ContextPolicy, PolicyDecision, RoutingFrame } from './types'

/**
 * The default is deliberately conservative. A classifier false-positive costs
 * a little optimisation; a false-negative can expose or discard sensitive
 * context. Tenant policies can add protection, but cannot weaken these floors.
 */
export const DEFAULT_CONTEXT_POLICY: ContextPolicy = {
  version: 'cts-default-v1',
  protectedDomains: ['medical', 'legal'],
  protectedRisks: ['crisis', 'protected_context'],
  defaultRetentionDays: 90,
}

export function resolveContextPolicy(input: Partial<ContextPolicy> | undefined): ContextPolicy {
  return {
    version: cleanVersion(input?.version) ?? DEFAULT_CONTEXT_POLICY.version,
    protectedDomains: unique([
      ...DEFAULT_CONTEXT_POLICY.protectedDomains,
      ...(input?.protectedDomains ?? []),
    ]),
    protectedRisks: unique([
      ...DEFAULT_CONTEXT_POLICY.protectedRisks,
      ...(input?.protectedRisks ?? []),
    ]),
    defaultRetentionDays: clampRetention(input?.defaultRetentionDays),
  }
}

export function evaluateContextPolicy(
  frame: RoutingFrame,
  input?: Partial<ContextPolicy>,
): PolicyDecision {
  const policy = resolveContextPolicy(input)
  const reasons: string[] = []

  if (policy.protectedDomains.includes(frame.domain)) {
    reasons.push(`Domain "${frame.domain}" is protected by policy.`)
  }

  const protectedRisks = frame.risk.filter((risk) => policy.protectedRisks.includes(risk))
  if (protectedRisks.length > 0) {
    reasons.push(`Risk signal(s) require protected handling: ${protectedRisks.join(', ')}.`)
  }

  const protectedContext = reasons.length > 0
  return {
    policyVersion: policy.version,
    protected: protectedContext,
    compression: protectedContext ? 'block' : 'allow',
    responseCache: protectedContext ? 'block' : 'allow',
    memoryWrite: protectedContext ? 'block' : 'allow',
    // Retrieval is allowed only from the current request's already-authorized
    // history. Cross-session retrieval is disabled for protected contexts.
    retrieval: protectedContext ? 'block' : 'allow',
    reasons: protectedContext ? reasons : ['No protected-context policy matched.'],
  }
}

export function isProtectedFrame(frame: RoutingFrame, input?: Partial<ContextPolicy>): boolean {
  return evaluateContextPolicy(frame, input).protected
}

export function isResponseCacheAllowed(frame: RoutingFrame, input?: Partial<ContextPolicy>): boolean {
  return evaluateContextPolicy(frame, input).responseCache === 'allow'
}

function unique<T>(values: T[]): T[] {
  return Array.from(new Set(values))
}

function cleanVersion(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim().slice(0, 80)
  return trimmed || undefined
}

function clampRetention(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_CONTEXT_POLICY.defaultRetentionDays
  return Math.max(1, Math.min(3650, Math.floor(value)))
}
