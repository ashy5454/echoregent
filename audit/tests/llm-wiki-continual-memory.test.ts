import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, mkdir, utimes } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import * as sdk from '../../packages/core/src/index.js'

const testScope = { project: '/workspace/project-alpha', session: 'session-dev-1' }

describe('Workstream 3B: LLM-Wiki Continually Learning Memory Layer & Bug Fixes', () => {
  describe('Bug 1: Policy False-Positive Bricking Fix', () => {
    it('does NOT protect coding requests containing standalone words like doctor, contract, clause, lease, or pain', () => {
      const benignCodingQueries = [
        'echoregent doctor',
        'run echoregent doctor on the repository',
        'npm run doctor to inspect workspace health',
        'implement a smart contract in Solidity',
        'how to acquire a database lease in Redis with TTL',
        'fix performance pain points in the SQL where clause',
      ]

      for (const query of benignCodingQueries) {
        const policy = sdk.evaluatePolicy(query)
        expect(policy.protected, `Expected "${query}" not to be protected`).toBe(false)
        expect(policy.memory, `Expected memory to be enabled for "${query}"`).toBe(true)
      }
    })

    it('does not brick a file-memory session when a coding command with doctor is processed', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'echoregent-nobrick-'))
      try {
        const engine = new sdk.EchoRegent({
          memory: { mode: 'file', directory, retentionMs: 60_000 },
        })

        // Process a request containing 'echoregent doctor'
        const req = {
          input: [
            { role: 'user', content: 'Run echoregent doctor to verify environment' },
            { type: 'function_call_output', call_id: 'c1', output: 'ok\n'.repeat(60) },
          ],
        }
        const res = engine.process(req, 'responses', testScope)
        expect(res.policy.protected).toBe(false)

        // Session must NOT be bricked: remember and recall should succeed!
        const fact = await engine.remember(testScope, {
          content: 'Engine configured with TypeScript 5.6',
          sources: ['config:1'],
        })
        expect(fact.id).toBeDefined()

        const recalled = await engine.recall(testScope, 'TypeScript')
        expect(recalled).toHaveLength(1)
        expect(recalled[0].content).toBe('Engine configured with TypeScript 5.6')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })

    it('STILL protects genuine clinical/medical, legal-advice, and crisis phrases', () => {
      const sensitiveQueries = [
        { text: 'My medication dose causes dizziness', expectedReason: 'medical' },
        { text: 'Patient has severe chest pain and bleeding', expectedReason: 'medical' },
        { text: 'Review my lease contract clause', expectedReason: 'legal' },
        { text: 'Our client is filing a lawsuit and demanded legal advice on indemnity', expectedReason: 'legal' },
        { text: 'I want to kill myself', expectedReason: 'crisis-or-protected-context' },
        { text: 'This pressure is unbearable, I want to end my life', expectedReason: 'crisis-or-protected-context' },
      ]

      for (const { text, expectedReason } of sensitiveQueries) {
        const policy = sdk.evaluatePolicy(text)
        expect(policy.protected, `Expected "${text}" to be protected`).toBe(true)
        expect(policy.reasons).toContain(expectedReason)
        expect(policy.memory).toBe(false)
        expect(policy.compression).toBe(false)
      }
    })

    it('protects medical or legal requests even when coding terms are present', () => {
      const mixedQueries = [
        'I am debugging python code but experiencing severe chest pain and took a medication overdose',
        'In our typescript project the landlord sent an eviction lawsuit demanding legal advice',
      ]
      for (const q of mixedQueries) {
        const policy = sdk.evaluatePolicy(q)
        expect(policy.protected).toBe(true)
      }
    })
  })

  describe('Bug 2: Natural-Language Ranked Recall', () => {
    it('returns all active non-expired facts when query is empty', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
      })
      await engine.remember(testScope, { content: 'Use Postgres 16', sources: ['src:1'] })
      await engine.remember(testScope, { content: 'Use Redis 7', sources: ['src:2'] })

      const facts = await engine.recall(testScope, '')
      expect(facts).toHaveLength(2)

      const whitespaceFacts = await engine.recall(testScope, '   ')
      expect(whitespaceFacts).toHaveLength(2)
    })

    it('filters conversational stopwords and ranks facts by query token match count', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
      })

      // Fact 1: mentions database and postgresql
      await engine.remember(testScope, {
        content: 'We use PostgreSQL for primary relational database storage',
        sources: ['arch:db'],
      })
      // Fact 2: mentions redis caching
      await engine.remember(testScope, {
        content: 'We use Redis for session caching layer',
        sources: ['arch:cache'],
      })
      // Fact 3: mentions postgresql migration rules and database schema
      await engine.remember(testScope, {
        content: 'PostgreSQL database migration rules and schema versions',
        sources: ['arch:migration'],
      })

      // Query: "What database do we use for PostgreSQL migration?"
      // Stripped tokens without stopwords ('what', 'do', 'we', 'use', 'for'): ['database', 'postgresql', 'migration']
      // Fact 3 matches all 3 tokens ('database', 'postgresql', 'migration') -> score 3
      // Fact 1 matches 2 tokens ('database', 'postgresql') -> score 2
      // Fact 2 matches 0 tokens -> score 0
      const results = await engine.recall(
        testScope,
        'What database do we use for PostgreSQL migration?',
      )
      expect(results).toHaveLength(2)
      expect(results[0].content).toContain('migration rules')
      expect(results[1].content).toContain('primary relational database')

      // Query with punctuation
      const punctResults = await engine.recall(testScope, 'Redis?!')
      expect(punctResults).toHaveLength(1)
      expect(punctResults[0].content).toContain('Redis for session caching')
    })

    it('matches query tokens present in fact sources', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
      })
      await engine.remember(testScope, {
        content: 'Secret rotation schedule is every 30 days',
        sources: ['security_auth_vault.md:12'],
      })

      const results = await engine.recall(testScope, 'vault')
      expect(results).toHaveLength(1)
      expect(results[0].content).toContain('Secret rotation schedule')
    })
  })

  describe('Bug 5: Stale File Lock Recovery', () => {
    it('automatically recovers from a stale file lock older than 30 seconds', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'echoregent-stalelock-'))
      try {
        const engine = new sdk.EchoRegent({
          memory: { mode: 'file', directory, retentionMs: 60_000 },
        })

        // Calculate lock path
        const key = sdk.scopeKey ? sdk.scopeKey(testScope) : ''
        const lockPath = join(directory, `${key}.json.lock`)

        // Create a stale lock folder modified 35 seconds ago
        await mkdir(lockPath, { recursive: true })
        const staleMtime = (Date.now() - 35_000) / 1000
        await utimes(lockPath, staleMtime, staleMtime)

        // Remember should detect stale lock (>30s), clean it up, and succeed
        const fact = await engine.remember(testScope, {
          content: 'Lock recovery verified',
          sources: ['test:lock'],
        })

        expect(fact.id).toBeDefined()
        expect(fact.content).toBe('Lock recovery verified')

        const recalled = await engine.recall(testScope, 'recovery')
        expect(recalled).toHaveLength(1)
        expect(recalled[0].content).toBe('Lock recovery verified')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })

  describe('Continual Learning: updates vs extends Relations & Superseding', () => {
    it('marks older facts superseded when a new fact updates them, hiding them from active recall', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
      })

      // Initial architecture decision
      const v1 = await engine.remember(testScope, {
        content: 'Primary database is MySQL 5.7',
        sources: ['decision:1'],
      })

      expect((await engine.recall(testScope, 'database'))[0].id).toBe(v1.id)

      // Updated decision superseding v1
      const v2 = await engine.remember(testScope, {
        content: 'Primary database migrated to PostgreSQL 16',
        sources: ['decision:2'],
        relation: 'updates',
        supersedesId: v1.id,
      })

      // Active recall should only return v2
      const activeRecall = await engine.recall(testScope, 'database')
      expect(activeRecall).toHaveLength(1)
      expect(activeRecall[0].id).toBe(v2.id)
      expect(activeRecall[0].content).toContain('PostgreSQL 16')

      // Empty recall should only return active non-superseded facts
      const allActive = await engine.recall(testScope, '')
      expect(allActive).toHaveLength(1)
      expect(allActive[0].id).toBe(v2.id)

      // Extending fact does NOT supersede
      const v3 = await engine.remember(testScope, {
        content: 'Read replicas for PostgreSQL on Google Cloud SQL',
        sources: ['decision:3'],
        relation: 'extends',
        supersedesId: v2.id,
      })

      const extendedRecall = await engine.recall(testScope, 'PostgreSQL')
      expect(extendedRecall).toHaveLength(2)
      expect(extendedRecall.map((f) => f.id)).toContain(v2.id)
      expect(extendedRecall.map((f) => f.id)).toContain(v3.id)
    })
  })

  describe('External LLM-Wiki Knowledge Directory Generation (wiki-memory.ts)', () => {
    it('maintains SCHEMA.md, index.md, log.md, and concepts/<slug>.md in file mode', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'echoregent-wiki-'))
      try {
        const engine = new sdk.EchoRegent({
          memory: { mode: 'file', directory, retentionMs: 60_000 },
        })

        const f1 = await engine.remember(testScope, {
          content: 'We use TypeScript for all backend API services',
          sources: ['arch/services.md:4'],
        })

        const f2 = await engine.remember(testScope, {
          content: 'Redis cache cluster configured with 1 hour TTL',
          sources: ['arch/cache.md:10'],
        })

        // Update f1 with relation: 'updates'
        await engine.remember(testScope, {
          content: 'We use TypeScript with StrictMode for all backend API microservices',
          sources: ['arch/services.md:15'],
          relation: 'updates',
          supersedesId: f1.id,
        })

        const key = sdk.scopeKey(testScope)
        const wikiDir = join(directory, key, 'wiki')

        // 1. Verify SCHEMA.md
        const schemaPath = join(wikiDir, 'SCHEMA.md')
        expect(existsSync(schemaPath)).toBe(true)
        const schemaContent = readFileSync(schemaPath, 'utf8')
        expect(schemaContent).toContain('EchoRegent LLM-Wiki Continually Learning Memory Schema')
        expect(schemaContent).toContain('SCHEMA.md')
        expect(schemaContent).toContain('index.md')
        expect(schemaContent).toContain('log.md')
        expect(schemaContent).toContain('concepts/<slug>.md')

        // 2. Verify log.md
        const logPath = join(wikiDir, 'log.md')
        expect(existsSync(logPath)).toBe(true)
        const logContent = readFileSync(logPath, 'utf8')
        expect(logContent).toContain('REMEMBER')
        expect(logContent).toContain(f1.id)
        expect(logContent).toContain(f2.id)
        expect(logContent).toContain('updates')

        // 3. Verify index.md
        const indexPath = join(wikiDir, 'index.md')
        expect(existsSync(indexPath)).toBe(true)
        const indexContent = readFileSync(indexPath, 'utf8')
        expect(indexContent).toContain('## Active Facts')
        expect(indexContent).toContain('## Superseded Facts (History)')
        expect(indexContent).toContain('## Concepts')
        expect(indexContent).toContain(f1.id)
        expect(indexContent).toContain(`Superseded by [[`)

        // 4. Verify concepts/<slug>.md
        const conceptsDir = join(wikiDir, 'concepts')
        expect(existsSync(conceptsDir)).toBe(true)
        const conceptFiles = readdirSync(conceptsDir)
        expect(conceptFiles.length).toBeGreaterThan(0)

        // Concepts should have .md files like typescript.md or redis.md
        const typescriptFile = conceptFiles.find((f) => f.includes('typescript'))
        expect(typescriptFile).toBeDefined()

        const tsConceptContent = readFileSync(join(conceptsDir, typescriptFile!), 'utf8')
        expect(tsConceptContent).toContain('^[arch/services.md')
        expect(tsConceptContent).toContain('## Related Concepts')
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })

    it('compiles a compact [EchoRegent LLM-Wiki Memory Context] block', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
      })

      await engine.remember(testScope, {
        content: 'Use PostgreSQL 16 database with connection pooling',
        sources: ['README.md:12'],
      })
      await engine.remember(testScope, {
        content: 'Use Redis 7 for distributed session store',
        sources: ['README.md:14'],
      })

      const block = engine.compileContextBlock(testScope, 'What database do we use?')
      expect(block).toContain('[EchoRegent LLM-Wiki Memory Context]')
      expect(block).toContain('Use PostgreSQL 16 database with connection pooling ^[README.md:12]')
      expect(block).not.toContain('Use Redis 7')

      // Query matching nothing returns empty string
      const emptyBlock = engine.compileContextBlock(testScope, 'Kubernetes clusters')
      expect(emptyBlock).toBe('')

      // Sensitive query returns empty string
      const sensitiveBlock = engine.compileContextBlock(testScope, 'My medication dose causes dizziness')
      expect(sensitiveBlock).toBe('')
    })
  })

  describe('EchoRegent.process with injectMemory', () => {
    it('injects compact wiki memory into responses protocol as a developer message without mutating caller request', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
        injectMemory: true,
      })

      await engine.remember(testScope, {
        content: 'Use PostgreSQL 16 database for all relational tables',
        sources: ['db.md:1'],
      })

      const originalRequest = {
        model: 'gpt-4o',
        input: [
          { role: 'user', content: 'What database do we use for users?' },
        ],
      }

      const cloneBefore = JSON.parse(JSON.stringify(originalRequest))
      const result = engine.process(originalRequest, 'responses', testScope)

      // Caller request must NOT be mutated!
      expect(originalRequest).toEqual(cloneBefore)
      expect(result.request).not.toBe(originalRequest)

      // Result request must have developer context injected
      expect(result.changed).toBe(true)
      expect(result.reason).toBe('memory-injected')
      expect(result.request.input).toHaveLength(2)
      expect(result.request.input[0].role).toBe('developer')
      expect(result.request.input[0].content).toContain('[EchoRegent LLM-Wiki Memory Context]')
      expect(result.request.input[0].content).toContain('Use PostgreSQL 16 database for all relational tables ^[db.md:1]')
      expect(result.request.input[1]).toEqual(originalRequest.input[0])
    })

    it('injects compact wiki memory into chat-completions protocol as a system message', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
        injectMemory: true,
      })

      await engine.remember(testScope, {
        content: 'Use Redis 7 for caching layer',
        sources: ['cache.md:2'],
      })

      const request = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'What caching layer do we use?' },
        ],
      }

      const result = engine.process(request, 'chat-completions', testScope)

      expect(result.changed).toBe(true)
      expect(result.request.messages).toHaveLength(2)
      expect(result.request.messages[0].role).toBe('system')
      expect(result.request.messages[0].content).toContain('[EchoRegent LLM-Wiki Memory Context]')
      expect(result.request.messages[0].content).toContain('Use Redis 7 for caching layer ^[cache.md:2]')
      expect(result.request.messages[1]).toEqual(request.messages[0])
    })

    it('does not inject memory when injectMemory is false or omitted', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
      })

      await engine.remember(testScope, {
        content: 'Use Redis 7 for caching layer',
        sources: ['cache.md:2'],
      })

      const request = {
        input: [{ role: 'user', content: 'What caching layer do we use?' }],
      }

      const result = engine.process(request, 'responses', testScope)
      expect(result.changed).toBe(false)
      expect(result.request).toBe(request)
    })

    it('does not inject memory when request is protected', async () => {
      const engine = new sdk.EchoRegent({
        memory: { mode: 'ephemeral', retentionMs: 60_000 },
        injectMemory: true,
      })

      await engine.remember(testScope, {
        content: 'Use Redis 7 for caching layer',
        sources: ['cache.md:2'],
      })

      const request = {
        input: [{ role: 'user', content: 'My prescription causes dizziness and I need a doctor' }],
      }

      const result = engine.process(request, 'responses', testScope)
      expect(result.policy.protected).toBe(true)
      expect(result.changed).toBe(false)
      expect(result.request).toBe(request)
    })
  })
})
