import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveContextPolicy } from '../cts-core/policy.js'
import type { ContextPolicy } from '../cts-core/types.js'
import { getDb } from './database.js'

const policyPath = join(process.cwd(), 'data', 'context-policies.json')

type LocalPolicies = Record<string, ContextPolicy>

/** Loads a tenant policy. Defaults are resolved centrally, never in callers. */
export async function getContextPolicy(keyId: string): Promise<ContextPolicy> {
  const db = getDb()
  if (db) {
    const { rows } = await db.query<{ policy: Partial<ContextPolicy> | null }>(
      'SELECT policy FROM context_policies WHERE key_id = $1',
      [keyId],
    )
    return resolveContextPolicy(rows[0]?.policy ?? undefined)
  }

  const policies = await loadLocalPolicies()
  return resolveContextPolicy(policies[keyId])
}

/** Persists a fully-resolved policy so defaults and tenant decisions are visible. */
export async function saveContextPolicy(keyId: string, input: Partial<ContextPolicy>): Promise<ContextPolicy> {
  const policy = resolveContextPolicy(input)
  const db = getDb()
  if (db) {
    await db.query(
      `INSERT INTO context_policies (key_id, policy, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key_id) DO UPDATE SET policy = $2, updated_at = NOW()`,
      [keyId, JSON.stringify(policy)],
    )
    return policy
  }

  const policies = await loadLocalPolicies()
  policies[keyId] = policy
  await mkdir(dirname(policyPath), { recursive: true })
  await writeFile(policyPath, JSON.stringify(policies, null, 2), 'utf-8')
  return policy
}

async function loadLocalPolicies(): Promise<LocalPolicies> {
  try {
    return JSON.parse(await readFile(policyPath, 'utf-8')) as LocalPolicies
  } catch {
    return {}
  }
}
