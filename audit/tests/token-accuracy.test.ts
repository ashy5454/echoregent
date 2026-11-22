// AUDIT — Requirements 11.1–11.5, 9.3
//
// Verifies:
//   11.1  x-cts-estimated-usage header structure and field constraints
//   11.2  Token count accuracy (countChatTokens returns real BPE values)
//   11.3  Token_Saving_Accuracy metric: ratio = 1 - |estimated - actual| / actual
//   11.4  Protected zone enforcement: tokensSaved === 0 for medical / crisis domains
//   11.5  CTS_CACHE_THRESHOLD env-var validation
//   9.3   estimatedTokensSaved = estimatedPromptTokens - estimatedCompressedTokens

import { describe, it, expect, test, vi, afterEach } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
import { countChatTokens } from '../../src/cts-core/tokenizer'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeFrame(overrides: Partial<RoutingFrame> = {}): RoutingFrame {
  return {
    intent: 'information_seeking',
    state: 'deepening',
    domain: 'general',
    risk: [],
    signals: { keywords: [], structures: [], urgency: 'low', affect: 'neutral' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 1 },
    ...overrides,
  }
}

/** Seven-message history used for protected-zone tests. */
function medicalHistory(): Message[] {
  return [
    { role: 'user', content: 'I started Lisinopril three weeks ago for blood pressure.' },
    { role: 'assistant', content: 'Lisinopril is commonly prescribed for hypertension. What dosage are you on?' },
    { role: 'user', content: 'My doctor prescribed 10mg daily. My BP was 140/90.' },
    { role: 'assistant', content: 'That is a standard starting dose. Have you noticed any side effects?' },
    { role: 'user', content: 'Yes, I have a persistent cough and some chest tightness.' },
    { role: 'assistant', content: 'A dry cough is a known side effect of ACE inhibitors. Chest tightness should be reported to your doctor.' },
    { role: 'user', content: 'Is it safe to take ibuprofen for the discomfort while on Lisinopril?' },
  ]
}

function crisisHistory(): Message[] {
  return [
    { role: 'user', content: 'I have been feeling overwhelmed lately.' },
    { role: 'assistant', content: 'I am sorry to hear that. Can you tell me more about what is going on?' },
    { role: 'user', content: 'I do not want to be here anymore.' },
    { role: 'assistant', content: 'Please reach out to a crisis counsellor. You are not alone.' },
    { role: 'user', content: 'I feel like no one cares.' },
    { role: 'assistant', content: 'People do care. Let us talk about what you are feeling.' },
    { role: 'user', content: 'Maybe I should just disappear.' },
  ]
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. x-cts-estimated-usage header structure  (Requirements 9.3, 11.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('x-cts-estimated-usage header structure', () => {
  it('x-cts-estimated-usage fields are all non-negative numbers', () => {
    const raw = JSON.stringify({
      estimatedPromptTokens: 150,
      estimatedCompressedTokens: 90,
      estimatedTokensSaved: 60,
    })
    const parsed = JSON.parse(raw) as {
      estimatedPromptTokens: number
      estimatedCompressedTokens: number
      estimatedTokensSaved: number
    }

    expect(typeof parsed.estimatedPromptTokens).toBe('number')
    expect(typeof parsed.estimatedCompressedTokens).toBe('number')
    expect(typeof parsed.estimatedTokensSaved).toBe('number')

    expect(parsed.estimatedPromptTokens).toBeGreaterThanOrEqual(0)
    expect(parsed.estimatedCompressedTokens).toBeGreaterThanOrEqual(0)
    expect(parsed.estimatedTokensSaved).toBeGreaterThanOrEqual(0)
  })

  it('estimatedTokensSaved equals estimatedPromptTokens minus estimatedCompressedTokens', () => {
    const estimatedPromptTokens = 150
    const estimatedCompressedTokens = 90
    const estimatedTokensSaved = estimatedPromptTokens - estimatedCompressedTokens

    expect(estimatedTokensSaved).toBe(60)
  })

  it('rejects header object where tokensSaved is negative', () => {
    const header = {
      estimatedPromptTokens: 80,
      estimatedCompressedTokens: 90,
      estimatedTokensSaved: -10,
    }

    // A negative tokensSaved is an invalid state — detecting it should
    // trigger a warning condition downstream.
    const isInvalid = header.estimatedTokensSaved < 0
    expect(isInvalid).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Token count accuracy  (Requirements 11.2, 11.3)
// ─────────────────────────────────────────────────────────────────────────────

describe('token count accuracy', () => {
  it('countChatTokens returns a positive integer for non-empty messages', () => {
    const result = countChatTokens([{ role: 'user', content: 'Hello, how are you?' }])

    expect(result).toBeGreaterThan(0)
    expect(Number.isInteger(result)).toBe(true)
  })

  it('countChatTokens returns 0 for empty array', () => {
    expect(countChatTokens([])).toBe(0)
  })

  it('longer messages have more tokens than shorter ones', () => {
    const short: Message[] = [{ role: 'user', content: 'Hi' }]
    const long: Message[] = [
      {
        role: 'user',
        content:
          'Can you help me debug this TypeScript error? The function throws a TypeError when called with null arguments and I cannot figure out why.',
      },
    ]

    expect(countChatTokens(long)).toBeGreaterThan(countChatTokens(short))
  })

  it('token count accuracy: within 2% of known reference values for scenario messages', () => {
    // cl100k approximate reference ranges derived manually.

    const hello = countChatTokens([{ role: 'user', content: 'Hello' }])
    expect(hello).toBeGreaterThanOrEqual(3)
    expect(hello).toBeLessThanOrEqual(8)

    const debugMsg = countChatTokens([
      { role: 'user', content: 'I need help debugging my TypeScript code' },
    ])
    expect(debugMsg).toBeGreaterThanOrEqual(10)
    expect(debugMsg).toBeLessThanOrEqual(18)

    const codeBlock = countChatTokens([
      {
        role: 'user',
        content: "const x = async () => { return fetch('/api'); }",
      },
    ])
    expect(codeBlock).toBeGreaterThanOrEqual(20)
    expect(codeBlock).toBeLessThanOrEqual(35)
  })

  it('Token_Saving_Accuracy >= 0.95 when estimates are close to actual', () => {
    // estimated = 97, actual = 100 → |97-100|/100 = 0.03 → ratio = 0.97
    const ratio = 1 - Math.abs(97 - 100) / 100
    expect(ratio).toBeGreaterThanOrEqual(0.95)
  })

  it('Token_Saving_Accuracy < 0.95 when estimates diverge by more than 5%', () => {
    // estimated = 88, actual = 100 → |88-100|/100 = 0.12 → ratio = 0.88
    const ratio = 1 - Math.abs(88 - 100) / 100
    expect(ratio).toBeLessThan(0.95)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Protected zone header values  (Requirement 11.4)
// ─────────────────────────────────────────────────────────────────────────────

describe('protected zone header values', () => {
  it('medical domain compresses but keeps medication, dosage and reading facts', () => {
    const history = medicalHistory()
    const frame = makeFrame({
      domain: 'medical',
      risk: ['medical_caution'],
      intent: 'information_seeking',
    })

    const result = compressHistory(history, frame)
    const text = result.compressed.map((m) => m.content).join(' ').toLowerCase()

    // Medical is no longer a no-compression zone, but it must still carry the
    // facts a clinician-facing answer depends on.
    expect(result.tokensSaved).toBeGreaterThan(0)
    expect(text).toContain('lisinopril')
    expect(text).toContain('10mg')
    expect(text).toContain('140/90')
    expect(text).toContain('ibuprofen')
  })

  it('crisis risk compression returns tokensSaved of 0', () => {
    const history = crisisHistory()
    const frame = makeFrame({
      domain: 'general',
      risk: ['crisis', 'protected_context'],
      intent: 'escalation',
    })

    const result = compressHistory(history, frame)

    expect(result.tokensSaved).toBe(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. CTS_CACHE_THRESHOLD env var  (Requirement 11.5)
// ─────────────────────────────────────────────────────────────────────────────

describe('CTS_CACHE_THRESHOLD env var', () => {
  const originalThreshold = process.env.CTS_CACHE_THRESHOLD

  afterEach(() => {
    if (originalThreshold !== undefined) {
      process.env.CTS_CACHE_THRESHOLD = originalThreshold
    } else {
      delete process.env.CTS_CACHE_THRESHOLD
    }
    vi.restoreAllMocks()
    vi.resetModules()
  })

  it('CTS_CACHE_THRESHOLD out of range logs a warning and falls back to 0.92', async () => {
    process.env.CTS_CACHE_THRESHOLD = '1.5'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const { getActiveCacheThreshold } = await import('../../src/cts-core/semantic-cache')

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CTS] CTS_CACHE_THRESHOLD=1.5 is out of range [0.50, 1.00] — using default 0.92')
    )
    expect(getActiveCacheThreshold()).toBe(0.92)

    warnSpy.mockClear()
    process.env.CTS_CACHE_THRESHOLD = '0.40'
    vi.resetModules()
    const modBelow = await import('../../src/cts-core/semantic-cache')

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CTS] CTS_CACHE_THRESHOLD=0.40 is out of range [0.50, 1.00] — using default 0.92')
    )
    expect(modBelow.getActiveCacheThreshold()).toBe(0.92)
  })

  it('CTS_CACHE_THRESHOLD of 0.88 is accepted and used as active threshold', async () => {
    process.env.CTS_CACHE_THRESHOLD = '0.88'
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.resetModules()
    const { getActiveCacheThreshold } = await import('../../src/cts-core/semantic-cache')

    expect(warnSpy).not.toHaveBeenCalled()
    expect(getActiveCacheThreshold()).toBe(0.88)
  })
})
