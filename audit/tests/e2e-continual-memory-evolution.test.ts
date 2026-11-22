import { describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { EchoRegent, scopeKey, type MemoryScope } from '../../packages/core/src/index.js'
import { startProxy } from '../../packages/cli/src/proxy.js'

async function createUpstreamFixture(handler: (req: any, res: any) => void) {
  const server = createServer(handler)
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections()
        server.close(() => resolve())
      }),
  }
}

describe('End-to-End Multi-Session Continual Memory Evolution & Context-Wipe Test Suite', () => {
  it('Test 1: 5-Session Continual Learning Trajectory Across Context Wipes & Process Restarts', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-continual-e2e-'))
    const testScope: MemoryScope = { project: '/workspace/fintech-core', session: 'dev-cluster-main' }

    try {
      // =========================================================================
      // SESSION 1 (Initial Architecture Onboarding)
      // =========================================================================
      const session1Engine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
      })

      const mysqlFact = await session1Engine.remember(testScope, {
        content: 'Primary database is MySQL 5.7 on port 3306',
        sources: ['docs/architecture/database.md:14', 'config/database.ts:10'],
      })
      expect(mysqlFact.id).toBeDefined()

      const memcachedFact = await session1Engine.remember(testScope, {
        content: 'Cache layer uses Memcached 1.6',
        sources: ['docs/architecture/cache.md:8', 'config/cache.ts:5'],
      })
      expect(memcachedFact.id).toBeDefined()

      const authFact = await session1Engine.remember(testScope, {
        content: 'Authentication uses server-side session cookies',
        sources: ['packages/auth/src/session.ts:22'],
      })
      expect(authFact.id).toBeDefined()

      const deployFact = await session1Engine.remember(testScope, {
        content: 'Deployment target is AWS ECS Fargate',
        sources: ['infra/terraform/ecs.tf:45'],
      })
      expect(deployFact.id).toBeDefined()

      // Verify Session 1 active recall
      const s1Facts = await session1Engine.recall(testScope, '')
      expect(s1Facts).toHaveLength(4)

      // =========================================================================
      // SESSION 2 (Context Wipe #1 + Architecture Pivot via relation: 'updates')
      // Process restart: brand new EchoRegent instance with 0 in-memory state
      // =========================================================================
      const session2Engine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
      })

      // Supersede MySQL with PostgreSQL 16
      const pgFact = await session2Engine.remember(testScope, {
        content: 'Primary database migrated to PostgreSQL 16 via PgBouncer on port 6432',
        sources: ['docs/architecture/database.md:28', 'config/database.ts:15'],
        relation: 'updates',
        supersedesId: mysqlFact.id,
      })
      expect(pgFact.id).toBeDefined()
      expect(pgFact.relation).toBe('updates')
      expect(pgFact.supersedesId).toBe(mysqlFact.id)

      // Supersede Memcached with Redis 7 Cluster
      const redisFact = await session2Engine.remember(testScope, {
        content: 'Cache layer migrated to Redis 7 Cluster with 1h TTL',
        sources: ['docs/architecture/cache.md:20', 'config/cache.ts:18'],
        relation: 'updates',
        supersedesId: memcachedFact.id,
      })
      expect(redisFact.id).toBeDefined()
      expect(redisFact.relation).toBe('updates')
      expect(redisFact.supersedesId).toBe(memcachedFact.id)

      // Active recall should return exactly 4 active facts (MySQL and Memcached superseded)
      const s2Active = await session2Engine.recall(testScope, '')
      expect(s2Active).toHaveLength(4)
      const s2Ids = s2Active.map((f) => f.id)
      expect(s2Ids).toContain(pgFact.id)
      expect(s2Ids).toContain(redisFact.id)
      expect(s2Ids).toContain(authFact.id)
      expect(s2Ids).toContain(deployFact.id)
      expect(s2Ids).not.toContain(mysqlFact.id)
      expect(s2Ids).not.toContain(memcachedFact.id)

      // =========================================================================
      // SESSION 3 (Context Wipe #2 + Architecture Enrichment via relation: 'extends')
      // Process restart: brand new EchoRegent instance with 0 in-memory state
      // =========================================================================
      const session3Engine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
      })

      // Extend PostgreSQL 16 with pgvector read replicas
      const pgVectorFact = await session3Engine.remember(testScope, {
        content: 'PostgreSQL 16 read replicas use pgvector for hybrid semantic search',
        sources: ['docs/architecture/database-replicas.md:12', 'config/database-connection.ts:35'],
        relation: 'extends',
        supersedesId: pgFact.id,
      })
      expect(pgVectorFact.id).toBeDefined()
      expect(pgVectorFact.relation).toBe('extends')
      expect(pgVectorFact.supersedesId).toBe(pgFact.id)

      // Relation 'extends' does NOT supersede pgFact; both pgFact and pgVectorFact are active
      const s3Active = await session3Engine.recall(testScope, '')
      expect(s3Active).toHaveLength(5)
      const s3Ids = s3Active.map((f) => f.id)
      expect(s3Ids).toContain(pgFact.id)
      expect(s3Ids).toContain(pgVectorFact.id)
      expect(s3Ids).toContain(redisFact.id)
      expect(s3Ids).toContain(authFact.id)
      expect(s3Ids).toContain(deployFact.id)

      // =========================================================================
      // SESSION 4 (Context Wipe #3 + Live HTTP Proxy Single-Line Context Injection)
      // Process restart: startProxy with a fresh EchoRegent instance against mock LLM
      // =========================================================================
      let receivedUpstreamBody: any = null
      let receivedHeaders: Record<string, string | string[] | undefined> = {}

      const upstream = await createUpstreamFixture((req, res) => {
        let text = ''
        req.on('data', (chunk: any) => {
          text += chunk
        })
        req.on('end', () => {
          receivedUpstreamBody = JSON.parse(text)
          receivedHeaders = req.headers
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(
            JSON.stringify({
              id: 'chatcmpl-continual-e2e',
              object: 'chat.completion',
              choices: [
                {
                  index: 0,
                  message: {
                    role: 'assistant',
                    content: 'Database connection configured with PostgreSQL 16 and Redis 7 cluster.',
                  },
                  finish_reason: 'stop',
                },
              ],
            }),
          )
        })
      })

      const session4Engine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
      })

      const proxy = await startProxy({
        upstream: upstream.url,
        engine: session4Engine as any,
        scope: testScope,
      })

      try {
        // Send single-turn POST /v1/chat/completions request with exactly 1 user message
        const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: 'gpt-4o',
            messages: [
              {
                role: 'user',
                content: 'Write the database and cache layer connection configuration',
              },
            ],
          }),
        })

        expect(response.status).toBe(200)
        expect(response.headers.get('x-echoregent-compressed')).toBe('true')
        expect(response.headers.get('x-echoregent-reason')).toBe('memory-injected')

        const responseJson = await response.json()
        expect(responseJson.id).toBe('chatcmpl-continual-e2e')

        // Upstream mock must receive injected role: 'system' message containing [EchoRegent LLM-Wiki Memory Context]
        expect(receivedUpstreamBody).toBeDefined()
        expect(receivedUpstreamBody.messages).toHaveLength(2)

        const systemMessage = receivedUpstreamBody.messages[0]
        expect(systemMessage.role).toBe('system')
        expect(systemMessage.content).toContain('[EchoRegent LLM-Wiki Memory Context]')

        // Verify the 3 relevant facts are present
        expect(systemMessage.content).toContain(
          'Primary database migrated to PostgreSQL 16 via PgBouncer on port 6432',
        )
        expect(systemMessage.content).toContain(
          'PostgreSQL 16 read replicas use pgvector for hybrid semantic search',
        )
        expect(systemMessage.content).toContain(
          'Cache layer migrated to Redis 7 Cluster with 1h TTL',
        )

        // Verify 0% STALE FACT LEAKAGE: must NOT contain MySQL 5.7, 3306, or Memcached
        const fullUpstreamPayload = JSON.stringify(receivedUpstreamBody)
        expect(fullUpstreamPayload).not.toContain('MySQL 5.7')
        expect(fullUpstreamPayload).not.toContain('3306')
        expect(fullUpstreamPayload).not.toContain('Memcached')

        // Verify On-Disk Markdown LLM-Wiki Integrity
        const scopeId = scopeKey(testScope)
        const wikiDir = join(directory, scopeId, 'wiki')
        expect(existsSync(wikiDir)).toBe(true)

        // 1. SCHEMA.md exists and contains schema contracts
        const schemaPath = join(wikiDir, 'SCHEMA.md')
        expect(existsSync(schemaPath)).toBe(true)
        const schemaText = readFileSync(schemaPath, 'utf8')
        expect(schemaText).toContain('EchoRegent LLM-Wiki Continually Learning Memory Schema')
        expect(schemaText).toContain('SCHEMA.md')
        expect(schemaText).toContain('index.md')
        expect(schemaText).toContain('log.md')
        expect(schemaText).toContain('concepts/<slug>.md')

        // 2. log.md exists and contains append-only audit trail
        const logPath = join(wikiDir, 'log.md')
        expect(existsSync(logPath)).toBe(true)
        const logText = readFileSync(logPath, 'utf8')
        expect(logText).toContain('# EchoRegent Memory Audit Log')
        expect(logText).toContain('REMEMBER')
        expect(logText).toContain(mysqlFact.id)
        expect(logText).toContain(memcachedFact.id)
        expect(logText).toContain(pgFact.id)
        expect(logText).toContain(redisFact.id)
        expect(logText).toContain(pgVectorFact.id)
        expect(logText).toContain(`updates ${mysqlFact.id}`)
        expect(logText).toContain(`updates ${memcachedFact.id}`)
        expect(logText).toContain(`extends ${pgFact.id}`)

        // 3. index.md exists and lists active facts + superseded history with strikethrough & wikilinks
        const indexPath = join(wikiDir, 'index.md')
        expect(existsSync(indexPath)).toBe(true)
        const indexText = readFileSync(indexPath, 'utf8')
        expect(indexText).toContain('# EchoRegent LLM-Wiki Knowledge Index')
        expect(indexText).toContain('## Active Facts')
        expect(indexText).toContain('## Superseded Facts (History)')
        expect(indexText).toContain('## Concepts')

        // Active facts present under Active Facts section
        expect(indexText).toContain(pgFact.id)
        expect(indexText).toContain('Primary database migrated to PostgreSQL 16')
        expect(indexText).toContain(redisFact.id)
        expect(indexText).toContain('Cache layer migrated to Redis 7 Cluster')
        expect(indexText).toContain(pgVectorFact.id)
        expect(indexText).toContain('pgvector for hybrid semantic search')
        expect(indexText).toContain(authFact.id)
        expect(indexText).toContain(deployFact.id)

        // Superseded facts preserved with strikethrough and audit links
        expect(indexText).toContain(
          `- ~~**[${mysqlFact.id}]**: Primary database is MySQL 5.7 on port 3306~~ -> Superseded by [[${pgFact.id}]]`,
        )
        expect(indexText).toContain(
          `- ~~**[${memcachedFact.id}]**: Cache layer uses Memcached 1.6~~ -> Superseded by [[${redisFact.id}]]`,
        )

        // 4. concepts/*.md exist with concepts extracted and interlinked
        const conceptsDir = join(wikiDir, 'concepts')
        expect(existsSync(conceptsDir)).toBe(true)
        const conceptFiles = readdirSync(conceptsDir)
        expect(conceptFiles.length).toBeGreaterThan(0)

        // Verify concept files for postgresql, redis, mysql, memcached
        const postgresConcept = conceptFiles.find((f) => f.includes('postgresql'))
        const redisConcept = conceptFiles.find((f) => f.includes('redis'))
        const mysqlConcept = conceptFiles.find((f) => f.includes('mysql'))
        const memcachedConcept = conceptFiles.find((f) => f.includes('memcached'))

        expect(postgresConcept).toBeDefined()
        expect(redisConcept).toBeDefined()
        expect(mysqlConcept).toBeDefined()
        expect(memcachedConcept).toBeDefined()

        const pgConceptText = readFileSync(join(conceptsDir, postgresConcept!), 'utf8')
        expect(pgConceptText).toContain('## Facts')
        expect(pgConceptText).toContain('## Related Concepts')
      } finally {
        await proxy.close()
        await upstream.close()
      }

      // =========================================================================
      // SESSION 5 (Context Wipe #4 + Evolution Audit & Focused Query Verification)
      // Process restart: 5th fresh EchoRegent instance with 0 in-memory state
      // =========================================================================
      const session5Engine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
      })

      // Query specifically for deployment target and authentication
      const deployQueryReq = {
        model: 'gpt-4o',
        messages: [
          {
            role: 'user',
            content: 'What is our deployment target and authentication mechanism?',
          },
        ],
      }
      const deployRes = session5Engine.process(deployQueryReq, 'chat-completions', testScope)
      expect(deployRes.changed).toBe(true)
      expect(deployRes.reason).toBe('memory-injected')
      expect(deployRes.request.messages).toHaveLength(2)

      const s5SystemMessage = deployRes.request.messages[0].content
      expect(s5SystemMessage).toContain('Authentication uses server-side session cookies')
      expect(s5SystemMessage).toContain('Deployment target is AWS ECS Fargate')
      // Database and cache facts should not be ranked/injected for this disjoint query
      expect(s5SystemMessage).not.toContain('PostgreSQL 16')
      expect(s5SystemMessage).not.toContain('Redis 7')

      // Confirm all 5 active facts are persistent across all 5 sessions
      const s5AllActive = await session5Engine.recall(testScope, '')
      expect(s5AllActive).toHaveLength(5)
      const s5ActiveIds = s5AllActive.map((f) => f.id)
      expect(s5ActiveIds).toContain(pgFact.id)
      expect(s5ActiveIds).toContain(pgVectorFact.id)
      expect(s5ActiveIds).toContain(redisFact.id)
      expect(s5ActiveIds).toContain(authFact.id)
      expect(s5ActiveIds).toContain(deployFact.id)
      expect(s5ActiveIds).not.toContain(mysqlFact.id)
      expect(s5ActiveIds).not.toContain(memcachedFact.id)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('Test 2: Multi-Tenant / Multi-Project Strict Namespace Isolation', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-isolation-e2e-'))
    const scopeA: MemoryScope = { project: '/org/payments-service', session: 'main' }
    const scopeB: MemoryScope = { project: '/org/analytics-service', session: 'main' }

    try {
      const engine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
      })

      // Store conflicting secrets and configs in scopeA (payments-service)
      await engine.remember(scopeA, {
        content: 'Payment gateway API private signing key is pk_live_payments_vault_secure_9918',
        sources: ['services/payments/config.ts:14'],
      })
      await engine.remember(scopeA, {
        content: 'Primary database cluster endpoint is postgres://payments-db.internal.net:5432/ledger',
        sources: ['services/payments/db.ts:6'],
      })

      // Store conflicting secrets and configs in scopeB (analytics-service)
      await engine.remember(scopeB, {
        content: 'Payment gateway API private signing key is pk_test_analytics_sandbox_mock_1120',
        sources: ['services/analytics/config.ts:20'],
      })
      await engine.remember(scopeB, {
        content: 'Primary database cluster endpoint is postgres://analytics-warehouse.internal.net:5432/events',
        sources: ['services/analytics/db.ts:8'],
      })

      // 100% overlapping recall query terms
      const overlappingQuery =
        'Payment gateway API private signing key and primary database cluster endpoint'

      // Prove engine.recall() for scopeA returns ONLY scopeA facts
      const recalledA = await engine.recall(scopeA, overlappingQuery)
      expect(recalledA).toHaveLength(2)
      for (const fact of recalledA) {
        expect(fact.content).toContain('payments')
        expect(fact.content).not.toContain('analytics')
        expect(fact.content).not.toContain('sandbox')
        expect(fact.content).not.toContain('pk_test_analytics_sandbox_mock_1120')
      }

      // Prove engine.recall() for scopeB returns ONLY scopeB facts
      const recalledB = await engine.recall(scopeB, overlappingQuery)
      expect(recalledB).toHaveLength(2)
      for (const fact of recalledB) {
        expect(fact.content).toContain('analytics')
        expect(fact.content).not.toContain('payments')
        expect(fact.content).not.toContain('vault')
        expect(fact.content).not.toContain('pk_live_payments_vault_secure_9918')
      }

      // Prove engine.process() with 100% overlapping user query
      const userMessage = {
        role: 'user',
        content: 'What is the payment gateway API private signing key and primary database cluster endpoint?',
      }

      const processResultA = engine.process(
        { model: 'gpt-4o', messages: [userMessage] },
        'chat-completions',
        scopeA,
      )
      expect(processResultA.changed).toBe(true)
      const contextA = processResultA.request.messages[0].content
      expect(contextA).toContain('pk_live_payments_vault_secure_9918')
      expect(contextA).toContain('payments-db.internal.net')
      expect(contextA).not.toContain('pk_test_analytics_sandbox_mock_1120')
      expect(contextA).not.toContain('analytics-warehouse')

      const processResultB = engine.process(
        { model: 'gpt-4o', messages: [userMessage] },
        'chat-completions',
        scopeB,
      )
      expect(processResultB.changed).toBe(true)
      const contextB = processResultB.request.messages[0].content
      expect(contextB).toContain('pk_test_analytics_sandbox_mock_1120')
      expect(contextB).toContain('analytics-warehouse.internal.net')
      expect(contextB).not.toContain('pk_live_payments_vault_secure_9918')
      expect(contextB).not.toContain('payments-db')

      // Verify on-disk file system namespace separation
      const keyA = scopeKey(scopeA)
      const keyB = scopeKey(scopeB)
      expect(keyA).not.toBe(keyB)

      const fileA = join(directory, `${keyA}.json`)
      const fileB = join(directory, `${keyB}.json`)
      expect(existsSync(fileA)).toBe(true)
      expect(existsSync(fileB)).toBe(true)

      const rawA = readFileSync(fileA, 'utf8')
      const rawB = readFileSync(fileB, 'utf8')
      expect(rawA).toContain('payments')
      expect(rawA).not.toContain('analytics')
      expect(rawB).toContain('analytics')
      expect(rawB).not.toContain('payments')

      // Process restart verification: fresh engine loading from directory respects isolation
      const freshEngine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
      })
      const freshRecalledA = await freshEngine.recall(scopeA, '')
      expect(freshRecalledA).toHaveLength(2)
      expect(freshRecalledA.every((f) => f.content.includes('payments'))).toBe(true)

      const freshRecalledB = await freshEngine.recall(scopeB, '')
      expect(freshRecalledB).toHaveLength(2)
      expect(freshRecalledB.every((f) => f.content.includes('analytics'))).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('Test 3: Clock Progression TTL Expiration & Mid-Session Protected Context Lockdown', async () => {
    let clock = 1_000_000
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-ttl-lockdown-e2e-'))
    const scope: MemoryScope = { project: '/org/mission-critical', session: 'worker-1' }

    try {
      const engine = new EchoRegent({
        now: () => clock,
        memory: { mode: 'file', directory, retentionMs: 60_000 },
        injectMemory: true,
      })

      // Remember foundational fact at t = 1_000_000 (retentionMs = 60_000 -> expiresAt = 1_060_000)
      await engine.remember(scope, {
        content: 'Ephemeral maintenance authorization token is maint_tok_9941_prod',
        sources: ['ops/runbook.md:12'],
      })

      // 1. Advance clock to t = 1_030_000: fact is valid and MUST be injected
      clock = 1_030_000
      const queryReq = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'What is the ephemeral maintenance authorization token?' },
        ],
      }

      const resAt30 = engine.process(queryReq, 'chat-completions', scope)
      expect(resAt30.changed).toBe(true)
      expect(resAt30.reason).toBe('memory-injected')
      expect(resAt30.request.messages[0].role).toBe('system')
      expect(resAt30.request.messages[0].content).toContain('maint_tok_9941_prod')

      const recallAt30 = await engine.recall(scope, 'maintenance authorization token')
      expect(recallAt30).toHaveLength(1)
      expect(recallAt30[0].content).toContain('maint_tok_9941_prod')

      // 2. Advance clock to t = 1_065_000: fact has expired (> 1_060_000) and MUST NOT inject
      clock = 1_065_000
      const resAt65 = engine.process(queryReq, 'chat-completions', scope)
      expect(resAt65.changed).toBe(false)
      expect(resAt65.request.messages).toHaveLength(1)
      expect(resAt65.request.messages[0].role).toBe('user')

      const recallAt65 = await engine.recall(scope, 'maintenance authorization token')
      expect(recallAt65).toEqual([])

      // 3. Remember a fresh fact at t = 1_070_000
      clock = 1_070_000
      await engine.remember(scope, {
        content: 'Cluster telemetry mesh endpoint is https://telemetry-mesh.ops.internal:9443',
        sources: ['ops/telemetry.ts:8'],
      })

      const recallFresh = await engine.recall(scope, 'telemetry mesh endpoint')
      expect(recallFresh).toHaveLength(1)
      expect(recallFresh[0].content).toContain('telemetry-mesh')

      // 4. Mid-session protected medical / crisis disclosure
      const sensitiveReq = {
        input: [
          {
            role: 'user',
            content: 'Patient is experiencing acute chest pain, bleeding and took a medication overdose',
          },
        ],
      }

      const sensitiveRes = engine.process(sensitiveReq, 'responses', scope)
      expect(sensitiveRes.policy.protected).toBe(true)
      expect(sensitiveRes.policy.reasons).toContain('medical')
      expect(sensitiveRes.policy.memory).toBe(false)
      expect(sensitiveRes.policy.compression).toBe(false)
      expect(sensitiveRes.changed).toBe(false)
      expect(sensitiveRes.reason).toBe('protected-context')

      // Scope is now immediately locked
      expect(engine.memory.isProtected(scope)).toBe(true)

      // 5. Subsequent benign query in the same scope: locked against memory injection
      const benignQueryReq = {
        model: 'gpt-4o',
        messages: [
          { role: 'user', content: 'What is the cluster telemetry mesh endpoint?' },
        ],
      }
      const benignRes = engine.process(benignQueryReq, 'chat-completions', scope)
      expect(benignRes.policy.protected).toBe(true)
      expect(benignRes.policy.reasons).toContain('protected-session')
      expect(benignRes.changed).toBe(false)
      expect(benignRes.request.messages).toHaveLength(1) // no injected system message!

      // Scope is locked against memory writes
      await expect(
        engine.remember(scope, {
          content: 'Confidential microservice key',
          sources: ['src:1'],
        }),
      ).rejects.toThrow(/Protected session cannot write memory/)

      // Scope is locked against memory recall
      expect(await engine.recall(scope, 'telemetry mesh endpoint')).toEqual([])
      expect(await engine.recall(scope, '')).toEqual([])
      expect(engine.compileContextBlock(scope, 'telemetry mesh endpoint')).toBe('')

      // Scope is locked against compression
      const repeatedLog = 'info: processing step\n'.repeat(40)
      const compressReq = {
        input: [
          { role: 'user', content: 'run job' },
          { type: 'function_call_output', call_id: 'c1', output: repeatedLog },
        ],
      }
      const compressRes = engine.process(compressReq, 'responses', scope)
      expect(compressRes.policy.protected).toBe(true)
      expect(compressRes.changed).toBe(false)
      expect(compressRes.charactersRemoved).toBe(0)

      // Process restart: fresh EchoRegent reading from file directory retains protection lockdown
      const freshEngine = new EchoRegent({
        now: () => clock,
        memory: { mode: 'file', directory, retentionMs: 60_000 },
        injectMemory: true,
      })
      expect(freshEngine.memory.isProtected(scope)).toBe(true)
      const freshRes = freshEngine.process(benignQueryReq, 'chat-completions', scope)
      expect(freshRes.policy.protected).toBe(true)
      expect(freshRes.changed).toBe(false)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })

  it('Test 4: True Cross-Session Project-Wide Memory (session-monday -> session-tuesday -> session-wednesday) & Non-Stacking Multi-Turn Injection', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'echoregent-projwide-'))
    try {
      const mondayScope: MemoryScope = { project: '/workspace/checkout-api', session: 'session-monday-101' }
      const tuesdayScope: MemoryScope = { project: '/workspace/checkout-api', session: 'session-tuesday-202' }
      const wednesdayScope: MemoryScope = { project: '/workspace/checkout-api', session: 'session-wednesday-303' }

      // Monday Session: store initial fact under session-monday-101 with projectWideMemory: true
      const mondayEngine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
        projectWideMemory: true,
      })
      const f1 = await mondayEngine.remember(mondayScope, {
        content: 'Checkout service uses Stripe PaymentIntents API v2026-08',
        sources: ['src/billing/stripe.ts:12'],
      })

      // Tuesday Session (completely different session ID in the same project!): supersede f1
      const tuesdayEngine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
        projectWideMemory: true,
      })
      const recalledOnTuesday = await tuesdayEngine.recall(tuesdayScope, 'Stripe')
      expect(recalledOnTuesday).toHaveLength(1)
      expect(recalledOnTuesday[0].id).toBe(f1.id)

      await tuesdayEngine.remember(tuesdayScope, {
        content: 'Checkout service migrated to Stripe PaymentIntents API v2026-11 with idempotency keys',
        sources: ['src/billing/stripe.ts:44'],
        relation: 'updates',
        supersedesId: f1.id,
      })

      // Wednesday Session (3rd distinct session ID): verify multi-turn resending never stacks duplicate memory blocks
      const wednesdayEngine = new EchoRegent({
        memory: { mode: 'file', directory, retentionMs: 86_400_000 },
        injectMemory: true,
        projectWideMemory: true,
      })

      const turn1 = wednesdayEngine.process(
        {
          model: 'gpt-4o',
          messages: [{ role: 'user', content: 'How does the Checkout service call Stripe?' }],
        },
        'chat-completions',
        wednesdayScope,
      )
      expect(turn1.changed).toBe(true)
      expect(turn1.request.messages).toHaveLength(2)
      expect(turn1.request.messages[0].content).toContain('v2026-11 with idempotency keys')
      expect(turn1.request.messages[0].content).not.toContain('v2026-08')

      // Client resends Turn 1's messages (including the injected system block!) plus assistant reply and Turn 2 user message
      const turn2 = wednesdayEngine.process(
        {
          model: 'gpt-4o',
          messages: [
            ...turn1.request.messages,
            { role: 'assistant', content: 'It uses PaymentIntents v2026-11.' },
            { role: 'user', content: 'Show me the Stripe idempotency header format for Checkout' },
          ],
        },
        'chat-completions',
        wednesdayScope,
      )
      const wikiBlocks = turn2.request.messages.filter(
        (m: any) => typeof m.content === 'string' && m.content.startsWith('[EchoRegent LLM-Wiki Memory Context]'),
      )
      // Must be exactly 1 injected memory block, NEVER stacked to 2!
      expect(wikiBlocks).toHaveLength(1)
      expect(turn2.request.messages).toHaveLength(4)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
