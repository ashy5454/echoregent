import { describe, expect, it, beforeEach } from 'vitest'
import {
  AdaptiveCompressionLearner,
  extractSignature,
  type AdaptiveCompressorState,
  type TurnObservation,
} from '../../packages/core/src/adaptive-compressor.js'

describe('AdaptiveCompressionLearner (Workstream 2)', () => {
  let learner: AdaptiveCompressionLearner

  beforeEach(() => {
    learner = new AdaptiveCompressionLearner({
      learningRate: 0.35,
      protectionThreshold: 0.45,
      initialWeight: 1.0,
      minRepeatCount: 4,
    })
  })

  describe('a) Signature extraction & normalization', () => {
    it('normalizes ISO-8601, bracketed, and time-of-day timestamps to <TS>', () => {
      const line1 = '2026-11-21T08:30:15.123Z [INFO] Application booted successfully'
      const line2 = '[2026-11-21 14:22:01.456] [INFO] Worker pool initialized'
      const line3 = '14:22:01 [DEBUG] Keepalive ping'

      expect(extractSignature(line1)).toBe('<TS> [INFO] Application booted successfully')
      expect(extractSignature(line2)).toBe('[<TS>] [INFO] Worker pool initialized')
      expect(extractSignature(line3)).toBe('<TS> [DEBUG] Keepalive ping')
    })

    it('normalizes hex addresses, UUIDs, and git hashes to <HEX>', () => {
      const lineHex = 'Allocation at 0x7f8b2c4e00 freed'
      const lineUuid = 'Session 550e8400-e29b-41d4-a716-446655440000 established'
      const lineGit = 'commit 4f3b2a1c merged branch feat'

      expect(extractSignature(lineHex)).toBe('Allocation at <HEX> freed')
      expect(extractSignature(lineUuid)).toBe('Session <HEX> established')
      expect(extractSignature(lineGit)).toBe('commit <HEX> merged branch feat')
    })

    it('normalizes numbers, floats, and quantities to <NUM>', () => {
      const lineInt = 'Processed 45 items in 120ms'
      const lineFloat = 'Memory usage ratio is 0.785 with delta -12.4'
      const linePort = 'Listening on 127.0.0.1:8080'

      expect(extractSignature(lineInt)).toBe('Processed <NUM> items in <NUM>ms')
      expect(extractSignature(lineFloat)).toBe('Memory usage ratio is <NUM> with delta <NUM>')
      expect(extractSignature(linePort)).toBe('Listening on <NUM>.<NUM>.<NUM>.<NUM>:<NUM>')
    })

    it('projects structurally identical log lines with varying variables to identical signatures', () => {
      const lineA = '[2026-11-21 10:14:02.120] [INFO] Request 0x9a4f completed in 14ms with code 200'
      const lineB = '[2026-11-21 10:15:33.891] [INFO] Request 0x3b1c completed in 220ms with code 200'

      const sigA = extractSignature(lineA)
      const sigB = extractSignature(lineB)

      expect(sigA).toBe(sigB)
      expect(sigA).toBe('[<TS>] [INFO] Request <HEX> completed in <NUM>ms with code <NUM>')
    })
  })

  describe('b) Online delta-rule utility update (survival vs regret)', () => {
    it('initializes unknown signatures with default initial weight 1.0', () => {
      const sig = extractSignature('[INFO] Health check ok')
      expect(learner.getUtility(sig)).toBe(1.0)
      expect(learner.shouldCompressSignature(sig)).toBe(true)
      expect(learner.isProtected(sig)).toBe(false)
    })

    it('updates utility with delta rule on regret (target = 0.0)', () => {
      const sig = extractSignature('[ERROR] Database connection timed out')

      // Turn 1 Regret: w_1 = 1.0 + 0.35 * (0.0 - 1.0) = 0.65
      const w1 = learner.updateUtility(sig, 0.0)
      expect(w1).toBeCloseTo(0.65, 4)
      expect(learner.getUtility(sig)).toBeCloseTo(0.65, 4)
    })

    it('updates utility with delta rule on survival (reward / target = 1.0)', () => {
      const sig = extractSignature('[DEBUG] Cache hit')

      // Set to 0.65 first
      learner.updateUtility(sig, 0.0)
      expect(learner.getUtility(sig)).toBeCloseTo(0.65, 4)

      // Survival turn: w_2 = 0.65 + 0.35 * (1.0 - 0.65) = 0.7725
      const w2 = learner.updateUtility(sig, 1.0)
      expect(w2).toBeCloseTo(0.7725, 4)
      expect(learner.getUtility(sig)).toBeCloseTo(0.7725, 4)
    })

    it('supports batch feedback via recordFeedback for survival and regret', () => {
      const sigA = 'sig-alpha'
      const sigB = 'sig-beta'

      learner.recordFeedback([sigA, sigB], 'regret')
      expect(learner.getUtility(sigA)).toBeCloseTo(0.65, 4)
      expect(learner.getUtility(sigB)).toBeCloseTo(0.65, 4)

      learner.recordFeedback([sigA], 'survival')
      expect(learner.getUtility(sigA)).toBeCloseTo(0.7725, 4)
      expect(learner.getUtility(sigB)).toBeCloseTo(0.65, 4)
    })
  })

  describe('c) Automatic promotion to protected status after 2 regret turns', () => {
    it('keeps signature compressible after 1 regret turn (0.65 >= 0.45)', () => {
      const sig = extractSignature('[WARN] High latency detected on worker')

      learner.updateUtility(sig, 0.0) // 1st regret

      expect(learner.getUtility(sig)).toBeCloseTo(0.65, 4)
      expect(learner.shouldCompressSignature(sig)).toBe(true)
      expect(learner.isProtected(sig)).toBe(false)
      expect(learner.getProtectedSignatures()).not.toContain(sig)
    })

    it('automatically promotes signature to protected status after 2 consecutive regrets (0.4225 < 0.45)', () => {
      const sig = extractSignature('[FATAL] Panic in core loop at offset <HEX>')

      learner.updateUtility(sig, 0.0) // 1st regret -> 0.65
      expect(learner.shouldCompressSignature(sig)).toBe(true)

      learner.updateUtility(sig, 0.0) // 2nd regret -> 0.4225 < 0.45
      expect(learner.getUtility(sig)).toBeCloseTo(0.4225, 4)
      expect(learner.shouldCompressSignature(sig)).toBe(false)
      expect(learner.isProtected(sig)).toBe(true)
      expect(learner.getProtectedSignatures()).toContain(sig)
    })

    it('detects regret from user prompt markers in Turn t+1 loop', () => {
      expect(learner.detectRegret({ userPrompt: 'Please show full output, I cannot see the error' })).toBe(true)
      expect(learner.detectRegret({ userPrompt: 'You missed line in the log trace' })).toBe(true)
      expect(learner.detectRegret({ userPrompt: 'The output was truncated, uncompressed please' })).toBe(true)
      expect(learner.detectRegret({ userPrompt: 'Looks good! Now please write the tests.' })).toBe(false)
    })

    it('detects regret from immediate repeated tool call in Turn t+1 loop', () => {
      const prevCalls = [{ name: 'read_file', args: { path: 'src/main.rs' } }]
      const immediateReRead = [{ name: 'read_file', args: { path: 'src/main.rs' } }]
      const differentCall = [{ name: 'read_file', args: { path: 'src/lib.rs' } }]

      expect(learner.detectRegret({ toolCalls: immediateReRead, previousToolCalls: prevCalls })).toBe(true)
      expect(learner.detectRegret({ toolCalls: differentCall, previousToolCalls: prevCalls })).toBe(false)
    })

    it('processes turn observation through observeTurn with automatic delta update and protection', () => {
      const sig = extractSignature('[ERROR] Compilation error: unresolved import')

      // Turn 1: compressed sig, downstream agent re-reads file (regret)
      const obs1: TurnObservation = {
        signatures: [sig],
        toolCalls: [{ name: 'terminal', args: { command: 'cargo build' } }],
        previousToolCalls: [{ name: 'terminal', args: { command: 'cargo build' } }],
      }
      const res1 = learner.observeTurn(obs1)
      expect(res1.regretDetected).toBe(true)
      expect(learner.getUtility(sig)).toBeCloseTo(0.65, 4)
      expect(learner.isProtected(sig)).toBe(false)

      // Turn 2: compressed sig, user complains "show full output"
      const obs2: TurnObservation = {
        signatures: [sig],
        userPrompt: 'show full output, why did build fail?',
      }
      const res2 = learner.observeTurn(obs2)
      expect(res2.regretDetected).toBe(true)
      expect(learner.getUtility(sig)).toBeCloseTo(0.4225, 4)
      expect(learner.isProtected(sig)).toBe(true)
      expect(res2.newlyProtected).toContain(sig)
    })
  })

  describe('d) Line-selective compression (compressWithLearnedPolicy)', () => {
    it('compacts repeated lines matching unprotected signatures', () => {
      const text = [
        '[INFO] Ping worker 1',
        '[INFO] Ping worker 1',
        '[INFO] Ping worker 1',
        '[INFO] Ping worker 1',
      ].join('\n')

      const result = learner.compressWithLearnedPolicy(text)
      expect(result).toBe(
        '[INFO] Ping worker 1\n[EchoRegent: previous line repeated 3 additional times]'
      )
    })

    it('preserves protected log lines verbatim even when repeated 4+ times', () => {
      const errorLine = '[ERROR] Segfault at address 0xdeadbeef'
      const sig = extractSignature(errorLine)

      // Cause 2 regrets to promote pattern to protected status
      learner.updateUtility(sig, 0.0)
      learner.updateUtility(sig, 0.0)
      expect(learner.isProtected(sig)).toBe(true)

      const text = [
        errorLine,
        errorLine,
        errorLine,
        errorLine,
        errorLine,
      ].join('\n')

      const result = learner.compressWithLearnedPolicy(text)
      // Must be kept completely verbatim: no collapsing!
      expect(result).toBe(text)
      expect(result).not.toContain('[EchoRegent: previous line repeated')
    })

    it('selectively compacts safe lines while preserving protected lines in mixed logs', () => {
      const safeLine = '[INFO] Health check passed status 200'
      const errorLine = '[ERROR] Core dump trace recorded'

      const errorSig = extractSignature(errorLine)
      learner.updateUtility(errorSig, 0.0)
      learner.updateUtility(errorSig, 0.0) // now protected

      const mixed = [
        safeLine,
        safeLine,
        safeLine,
        safeLine,
        errorLine,
        errorLine,
        errorLine,
        errorLine,
        safeLine,
        safeLine,
        safeLine,
        safeLine,
      ].join('\n')

      const result = learner.compressWithLearnedPolicy(mixed)

      // The safe lines are compacted:
      expect(result).toContain('[INFO] Health check passed status 200\n[EchoRegent: previous line repeated 3 additional times]')
      // The error lines are NOT compacted:
      expect(result).toContain(`${errorLine}\n${errorLine}\n${errorLine}\n${errorLine}`)
      expect(result).not.toContain(`[ERROR] Core dump trace recorded\n[EchoRegent: previous line repeated`)
    })
  })

  describe('e) Persistence export / import across restarts', () => {
    it('exports complete state to serializable object and JSON string', () => {
      const sig1 = extractSignature('[INFO] Service ready on port 3000')
      const sig2 = extractSignature('[WARN] Rate limit approaching threshold')

      learner.updateUtility(sig1, 1.0)
      learner.updateUtility(sig2, 0.0)
      learner.updateUtility(sig2, 0.0) // protected

      const state = learner.exportState()

      expect(state.version).toBe(1)
      expect(state.learningRate).toBe(0.35)
      expect(state.protectionThreshold).toBe(0.45)
      expect(state.weights[sig1]).toBeDefined()
      expect(state.weights[sig2]).toBeCloseTo(0.4225, 4)
      expect(state.protectedSignatures).toContain(sig2)
      expect(state.protectedSignatures).not.toContain(sig1)
    })

    it('restores state into a fresh instance and maintains identical compression decisions', () => {
      const protectedSig = extractSignature('[PANIC] Thread pool starvation')
      const safeSig = extractSignature('[INFO] Tick event received')

      learner.updateUtility(protectedSig, 0.0)
      learner.updateUtility(protectedSig, 0.0) // protected
      learner.updateUtility(safeSig, 1.0)

      const exportedJson = JSON.stringify(learner.exportState())

      // Create completely new learner instance
      const freshLearner = new AdaptiveCompressionLearner()
      expect(freshLearner.isProtected(protectedSig)).toBe(false)

      freshLearner.loadState(exportedJson)

      // Verify all properties are accurately restored
      expect(freshLearner.getUtility(protectedSig)).toBeCloseTo(0.4225, 4)
      expect(freshLearner.isProtected(protectedSig)).toBe(true)
      expect(freshLearner.shouldCompressSignature(protectedSig)).toBe(false)
      expect(freshLearner.shouldCompressSignature(safeSig)).toBe(true)

      // Verify that compression behavior is faithfully restored
      const text = [
        '[PANIC] Thread pool starvation',
        '[PANIC] Thread pool starvation',
        '[PANIC] Thread pool starvation',
        '[PANIC] Thread pool starvation',
      ].join('\n')

      expect(freshLearner.compressWithLearnedPolicy(text)).toBe(text)
    })
  })
})
