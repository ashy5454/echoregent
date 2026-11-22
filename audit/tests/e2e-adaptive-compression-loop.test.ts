import { describe, expect, it } from 'vitest'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { EchoRegent, extractSignature, type MemoryScope } from '../../packages/core/src/index.js'
import { startProxy } from '../../packages/cli/src/proxy.js'

async function fixture(handler: (req: any, res: any) => void) {
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

describe('End-to-End Multi-Turn Adaptive Compression Learning Loop Suite', () => {
  describe('Test 1: Live 4-Turn Delta-Rule Learning & Selective Line Protection inside EchoRegent.process()', () => {
    it('executes 4-turn delta-rule learning loop, dropping utility on regret and selectively protecting lines', () => {
      const engine = new EchoRegent({ adaptiveCompression: true })
      const scope: MemoryScope = { project: '/app/payments', session: 's1' }

      const infoLine = '[INFO] Health check worker=1 status=200'
      const errorLine = '[ERROR] Ledger checksum mismatch shard=0x9a4f'
      const sigInfo = extractSignature(infoLine)
      const sigError = extractSignature(errorLine)

      // Turn 1: Mixed tool output containing 80 INFO lines and 20 ERROR lines
      const turn1Req = {
        model: 'gpt-4o',
        input: [
          { role: 'user', content: 'Check payments worker health and ledger integrity' },
          {
            type: 'function_call_output',
            call_id: 'call_1',
            output: [
              ...Array(80).fill(infoLine),
              ...Array(20).fill(errorLine),
            ].join('\n'),
          },
        ],
      }
      const res1 = engine.process(turn1Req, 'responses', scope)

      // Verify Turn 1: changed === true, charactersRemoved > 3000, and both patterns are compacted
      expect(res1.changed).toBe(true)
      expect(res1.charactersRemoved).toBeGreaterThan(3000)
      const output1 = res1.request.input[1].output
      expect(output1).toContain('[EchoRegent: previous line repeated 79 additional times]')
      expect(output1).toContain('[EchoRegent: previous line repeated 19 additional times]')

      const learner = engine.getAdaptiveLearner(scope)

      // Turn 2 (Regret #1 — User Complaint):
      // Latest user message complains about truncation. Tool output has only ERROR lines repeated 20 times.
      const turn2Req = {
        model: 'gpt-4o',
        input: [
          {
            role: 'user',
            content: 'You truncated the output! Please show full output for the ledger checksum error',
          },
          {
            type: 'function_call_output',
            call_id: 'call_2',
            output: Array(20).fill(errorLine).join('\n'),
          },
        ],
      }
      const res2 = engine.process(turn2Req, 'responses', scope)

      // Verify Turn 2: regret update reduced pending weights from 1.0 to 0.65
      expect(learner.getUtility(sigError)).toBeCloseTo(0.65, 4)
      expect(learner.getUtility(sigInfo)).toBeCloseTo(0.65, 4)
      expect(learner.isProtected(sigError)).toBe(false)
      // Since 0.65 >= 0.45 threshold, ERROR lines were still compressed in Turn 2
      expect(res2.changed).toBe(true)
      expect(res2.request.input[1].output).toContain('[EchoRegent: previous line repeated 19 additional times]')

      // Turn 3 (Regret #2 — User Complaint):
      // User says "still truncated, show full logs", dropping ERROR utility weight to 0.4225 < 0.45
      const turn3Req = {
        model: 'gpt-4o',
        input: [
          {
            role: 'user',
            content: 'still truncated, show full logs',
          },
          {
            type: 'function_call_output',
            call_id: 'call_3',
            output: Array(20).fill(errorLine).join('\n'),
          },
        ],
      }
      const res3 = engine.process(turn3Req, 'responses', scope)

      // Verify Turn 3: utility weight dropped to 0.4225 < 0.45 and promoted to protected status
      expect(learner.getUtility(sigError)).toBeCloseTo(0.4225, 4)
      expect(learner.isProtected(sigError)).toBe(true)
      expect(learner.getProtectedSignatures()).toContain(sigError)

      // INFO signature was not in Turn 2 output, so its weight remained at 0.65 >= 0.45 (unprotected)
      expect(learner.getUtility(sigInfo)).toBeCloseTo(0.65, 4)
      expect(learner.isProtected(sigInfo)).toBe(false)
      expect(learner.getProtectedSignatures()).not.toContain(sigInfo)

      // In Turn 3 itself, ERROR lines are now protected and preserved verbatim
      expect(res3.changed).toBe(false)
      expect(res3.request.input[1].output).toBe(turn3Req.input[1].output)

      // Turn 4 (Selective Compression Verification):
      // Send mixed tool output containing 80 INFO lines and 10 ERROR lines
      const turn4Req = {
        model: 'gpt-4o',
        input: [
          { role: 'user', content: 'Run routine audit pass' },
          {
            type: 'function_call_output',
            call_id: 'call_4',
            output: [
              ...Array(80).fill(infoLine),
              ...Array(10).fill(errorLine),
            ].join('\n'),
          },
        ],
      }
      const res4 = engine.process(turn4Req, 'responses', scope)

      // Verify Turn 4: compacts the 80 INFO lines into repeat marker while preserving all 10 ERROR lines 100% verbatim
      expect(res4.changed).toBe(true)
      const output4 = res4.request.input[1].output
      expect(output4).toContain('[INFO] Health check worker=1 status=200\n[EchoRegent: previous line repeated 79 additional times]')
      expect(output4).not.toContain('[EchoRegent: previous line repeated 9 additional times]')

      const errorOccurrences = output4.split('\n').filter((l: string) => l === errorLine)
      expect(errorOccurrences).toHaveLength(10)
    })
  })

  describe('Test 2: Tool Re-Execution Regret Detection inside EchoRegent.process()', () => {
    it('automatically detects tool re-read regret and reduces pattern utility from 1.0 to 0.65 without user complaint text', () => {
      const engine = new EchoRegent({ adaptiveCompression: true })
      const scope: MemoryScope = { project: '/app/ledger', session: 's-tool-loop' }
      const logLine = '[INFO] Ledger checksum verified block=4092'
      const sig = extractSignature(logLine)

      // Turn t: contains function_call with compressed tool output
      const turnT = {
        model: 'gpt-4o',
        input: [
          { role: 'user', content: 'Inspect the ledger file' },
          { type: 'function_call', name: 'read_log', arguments: '{"file":"ledger.log"}' },
          {
            type: 'function_call_output',
            call_id: 'call_t_1',
            output: Array(30).fill(logLine).join('\n'),
          },
        ],
      }
      const resT = engine.process(turnT, 'responses', scope)
      expect(resT.changed).toBe(true)

      const learner = engine.getAdaptiveLearner(scope)
      expect(learner.getUtility(sig)).toBe(1.0)

      // Turn t+1: immediately repeats the exact same function_call without any user complaint text
      const neutralUserPrompt = 'Proceed with subsequent processing step'
      expect(neutralUserPrompt).not.toMatch(/truncated|show full|show all|full logs|missing/i)

      const turnT1 = {
        model: 'gpt-4o',
        input: [
          { role: 'user', content: neutralUserPrompt },
          { type: 'function_call', name: 'read_log', arguments: '{"file":"ledger.log"}' },
          {
            type: 'function_call_output',
            call_id: 'call_t_2',
            output: Array(30).fill(logLine).join('\n'),
          },
        ],
      }
      const resT1 = engine.process(turnT1, 'responses', scope)

      // EchoRegent.process() automatically detects tool re-read regret and reduces utility weight from 1.0 to 0.65
      expect(learner.getUtility(sig)).toBeCloseTo(0.65, 4)
    })
  })

  describe('Test 3: Cross-Restart Disk Persistence & Live HTTP Proxy', () => {
    it('persists learned protected signatures across disk restart and respects them in live HTTP proxy', async () => {
      const directory = await mkdtemp(join(tmpdir(), 'echoregent-restart-e2e-'))
      const scope: MemoryScope = { project: '/sys/kernel', session: 'srv-1' }
      const fatalLine = '[FATAL] Kernel panic at 0xdeadbeef'
      const fatalSig = extractSignature(fatalLine)

      try {
        // Step 1: Train an EchoRegent instance with file-backed memory until fatal signature is protected (w = 0.4225 < 0.45)
        const trainingEngine = new EchoRegent({
          memory: { mode: 'file', directory, retentionMs: 60_000 },
          adaptiveCompression: true,
        })

        // Turn 1: tool output containing fatal error
        trainingEngine.process(
          {
            model: 'gpt-4o',
            messages: [
              { role: 'user', content: 'Diagnostic log check' },
              {
                role: 'tool',
                tool_call_id: 'call_diag_1',
                content: Array(20).fill(fatalLine).join('\n'),
              },
            ],
          },
          'chat-completions',
          scope
        )

        // Turn 2: Regret #1 -> weight drops to 0.65
        trainingEngine.process(
          {
            model: 'gpt-4o',
            messages: [
              { role: 'user', content: 'You truncated the output! Show full logs' },
              {
                role: 'tool',
                tool_call_id: 'call_diag_2',
                content: Array(20).fill(fatalLine).join('\n'),
              },
            ],
          },
          'chat-completions',
          scope
        )

        // Turn 3: Regret #2 -> weight drops to 0.4225 < 0.45, promoting signature to protected status
        trainingEngine.process(
          {
            model: 'gpt-4o',
            messages: [
              { role: 'user', content: 'still truncated, show full logs' },
            ],
          },
          'chat-completions',
          scope
        )

        const initialLearner = trainingEngine.getAdaptiveLearner(scope)
        expect(initialLearner.getUtility(fatalSig)).toBeCloseTo(0.4225, 4)
        expect(initialLearner.isProtected(fatalSig)).toBe(true)
        expect(initialLearner.getProtectedSignatures()).toContain(fatalSig)

        // Step 2: Instantiate a brand-new EchoRegent instance pointed at the same directory (simulating restart)
        const reopenedEngine = new EchoRegent({
          memory: { mode: 'file', directory, retentionMs: 60_000 },
          adaptiveCompression: true,
        })

        // Step 3: Set up mock upstream server
        let upstreamReceivedBody: any = null
        const mockUpstream = await fixture((req, res) => {
          let raw = ''
          req.on('data', (chunk: Buffer) => {
            raw += chunk
          })
          req.on('end', () => {
            upstreamReceivedBody = JSON.parse(raw)
            res.setHeader('content-type', 'application/json')
            res.end(
              JSON.stringify({
                id: 'chatcmpl-restarted',
                choices: [{ message: { role: 'assistant', content: 'Analysis recorded' } }],
              })
            )
          })
        })

        // Step 4: Start proxy passing reopenedEngine and scope
        const proxy = await startProxy({
          upstream: mockUpstream.url,
          engine: reopenedEngine,
          scope,
        })

        try {
          // Step 5: Send POST /v1/chat/completions request containing 40 [INFO] lines and 8 [FATAL] lines
          const chatRequest = {
            model: 'gpt-4o',
            messages: [
              { role: 'user', content: 'Investigate the crash dump' },
              {
                role: 'tool',
                tool_call_id: 'call_dump',
                content: [
                  ...Array(40).fill('[INFO] Keepalive ping'),
                  ...Array(8).fill(fatalLine),
                ].join('\n'),
              },
            ],
          }

          const response = await fetch(`${proxy.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(chatRequest),
          })

          expect(response.status).toBe(200)
          expect(response.headers.get('x-echoregent-compressed')).toBe('true')

          // Step 6: Assert that mock upstream receives 40 [INFO] lines compacted AND all 8 [FATAL] lines preserved 100% verbatim
          expect(upstreamReceivedBody).toBeDefined()
          const toolMsg = upstreamReceivedBody.messages.find((m: any) => m.role === 'tool')
          expect(toolMsg).toBeDefined()
          expect(toolMsg.content).toContain(
            '[INFO] Keepalive ping\n[EchoRegent: previous line repeated 39 additional times]'
          )
          expect(toolMsg.content).not.toContain('[EchoRegent: previous line repeated 7 additional times]')

          const preservedFatalLines = toolMsg.content.split('\n').filter((l: string) => l === fatalLine)
          expect(preservedFatalLines).toHaveLength(8)
        } finally {
          await proxy.close()
          await mockUpstream.close()
        }
      } finally {
        await rm(directory, { recursive: true, force: true })
      }
    })
  })
})
