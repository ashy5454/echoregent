import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { evaluatePolicy } from './policy.js'

export interface MemoryScope { project: string; session: string }
export interface FactInput { content: string; sources: string[] }
export interface MemoryFact extends FactInput { id: string; createdAt: number; updatedAt: number; expiresAt: number }
export type MemorySettings = { mode: 'off' } | { mode: 'ephemeral'; retentionMs: number } | { mode: 'file'; directory: string; retentionMs: number }

export function scopeKey(scope: MemoryScope): string {
  if (!scope || typeof scope.project !== 'string' || !scope.project.trim() || typeof scope.session !== 'string' || !scope.session.trim()) throw new Error('Explicit project and session memory scope required')
  return createHash('sha256').update(JSON.stringify([scope.project, scope.session])).digest('hex')
}

export class ScopedMemory {
  private readonly volatile = new Map<string, MemoryFact[]>()
  private readonly protectedUntil = new Map<string, number>()
  readonly settings: MemorySettings
  constructor(settings: MemorySettings = { mode: 'off' }, private readonly now = Date.now) {
    if (settings.mode !== 'off' && (!Number.isFinite(settings.retentionMs) || settings.retentionMs <= 0)) throw new Error('Positive memory retentionMs required')
    if (!['off', 'ephemeral', 'file'].includes(settings.mode)) throw new Error('Invalid memory mode')
    if (settings.mode === 'file' && !settings.directory?.trim()) throw new Error('Explicit memory directory required')
    this.settings = settings.mode === 'file' ? { ...settings, directory: resolve(settings.directory) } : { ...settings }
  }

  /** Persist only a timed protection marker, never protected request content. */
  protect(scope: MemoryScope): void {
    const key = scopeKey(scope)
    const expiresAt = this.now() + (this.settings.mode === 'off' ? 86_400_000 : this.settings.retentionMs)
    this.protectedUntil.set(key, expiresAt)
    if (this.settings.mode === 'off') return
    if (this.settings.mode === 'file') {
      mkdirSync(this.settings.directory, { recursive: true, mode: 0o700 })
      const path = join(this.settings.directory, `${key}.protected.json`)
      const temporary = `${path}.${randomUUID()}.tmp`
      try {
        writeFileSync(temporary, JSON.stringify({ expiresAt }), { mode: 0o600, flag: 'wx' })
        renameSync(temporary, path)
      } finally { rmSync(temporary, { force: true }) }
    }
  }

  isProtected(scope: MemoryScope): boolean {
    const key = scopeKey(scope)
    if ((this.protectedUntil.get(key) ?? 0) > this.now()) return true
    this.protectedUntil.delete(key)
    if (this.settings.mode === 'file') {
      const path = join(this.settings.directory, `${key}.protected.json`)
      try {
        const { expiresAt } = JSON.parse(readFileSync(path, 'utf8'))
        if (!Number.isFinite(expiresAt)) throw new Error('Invalid protection marker')
        if (expiresAt > this.now()) return true
        rmSync(path, { force: true })
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
    }
    return false
  }

  private validateFact(input: FactInput): void {
    if (typeof input?.content !== 'string' || !input.content.trim()) throw new Error('Fact content required')
    if (!Array.isArray(input.sources) || !input.sources.length || input.sources.some((source) => typeof source !== 'string' || !source.trim())) throw new Error('At least one explicit source citation required')
    if (!evaluatePolicy(input.content + '\n' + input.sources.join('\n')).memory) throw new Error('Protected content cannot be remembered')
  }

  private async transact<T>(scope: MemoryScope, operation: (facts: MemoryFact[]) => T): Promise<T> {
    const key = scopeKey(scope)
    if (this.settings.mode === 'off') throw new Error('Memory disabled; enable it explicitly')
    const settings = this.settings
    if (settings.mode === 'ephemeral') {
      const facts = (this.volatile.get(key) ?? []).filter((fact) => fact.expiresAt > this.now())
      const result = operation(facts)
      this.volatile.set(key, facts)
      return structuredClone(result)
    }
    await mkdir(settings.directory, { recursive: true, mode: 0o700 })
    const path = join(settings.directory, `${key}.json`)
    const lock = `${path}.lock`
    const deadline = Date.now() + 5_000
    for (;;) {
      try { await mkdir(lock); break } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
        if (Date.now() >= deadline) throw new Error('Memory store busy; a stale lock may need removal after verifying no writer is running')
        await new Promise((resolveWait) => setTimeout(resolveWait, 20))
      }
    }
    const temporary = `${path}.${randomUUID()}.tmp`
    try {
      let facts: MemoryFact[] = []
      try {
        const stored = JSON.parse(await readFile(path, 'utf8'))
        if (!Array.isArray(stored) || stored.some((fact) => !fact || typeof fact.id !== 'string' || typeof fact.content !== 'string' || !Array.isArray(fact.sources) || !Number.isFinite(fact.expiresAt))) throw new Error('Invalid memory store')
        facts = stored.filter((fact: MemoryFact) => fact.expiresAt > this.now())
      } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const result = operation(facts)
      if (facts.length) {
        // Commit without yielding after the transaction's protection check.
        writeFileSync(temporary, JSON.stringify(facts, null, 2), { mode: 0o600, flag: 'wx' })
        renameSync(temporary, path)
      } else rmSync(path, { force: true })
      return structuredClone(result)
    } finally {
      await rm(temporary, { force: true })
      await rm(lock, { recursive: true, force: true })
    }
  }

  async remember(scope: MemoryScope, input: FactInput): Promise<MemoryFact> {
    this.validateFact(input)
    return this.transact(scope, (facts) => {
      if (this.isProtected(scope)) throw new Error('Protected session cannot write memory')
      const now = this.now()
      const retentionMs = this.settings.mode === 'off' ? 0 : this.settings.retentionMs
      const fact = { ...structuredClone(input), id: randomUUID(), createdAt: now, updatedAt: now, expiresAt: now + retentionMs }
      facts.push(fact)
      return fact
    })
  }

  async recall(scope: MemoryScope, query: string): Promise<MemoryFact[]> {
    const result = await this.transact(scope, (facts) => {
      if (this.isProtected(scope) || !evaluatePolicy(query).memory) return []
      const words = query.toLowerCase().split(/\s+/).filter(Boolean)
      return facts.filter((fact) => evaluatePolicy(fact.content).memory && words.every((word) => fact.content.toLowerCase().includes(word)))
    })
    return this.isProtected(scope) ? [] : result
  }

  async update(scope: MemoryScope, id: string, input: FactInput): Promise<MemoryFact> {
    this.validateFact(input)
    return this.transact(scope, (facts) => {
      if (this.isProtected(scope)) throw new Error('Protected session cannot write memory')
      const fact = facts.find((item) => item.id === id)
      if (!fact) throw new Error('Fact not found in this scope')
      Object.assign(fact, structuredClone(input), { updatedAt: this.now() })
      return fact
    })
  }

  async forget(scope: MemoryScope, id: string): Promise<boolean> {
    return this.transact(scope, (facts) => {
      const index = facts.findIndex((fact) => fact.id === id)
      if (index < 0) return false
      facts.splice(index, 1)
      return true
    })
  }

  async purge(scope: MemoryScope): Promise<number> {
    return this.transact(scope, (facts) => { const count = facts.length; facts.splice(0); return count })
  }
}
