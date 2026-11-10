// audit/tests/relevance-scorer.test.ts
//
// Tests for the ml-relevance.ts module (Phase 4) and the existing compressHistory()
// function from compressor.ts (Phase 3 — runnable now without ml-relevance.ts).
//
// Structure:
//   1. "scoreRelevance() fallback when model absent"   — test.todo (ml-relevance.ts not yet created)
//   2. "selectFocusMessages() graceful degradation"    — live tests against compressHistory()
//   3. "score ordering"                                — test.todo (ml-relevance.ts not yet created)
//   4. "protected zone bypass"                         — live tests against compressHistory()

import { describe, it, expect, test } from 'vitest'
import { compressHistory } from '../../src/cts-core/compressor'
import type { Message, RoutingFrame } from '../../src/cts-core/types'

// ── Helpers ───────────────────────────────────────────────────────────────────

function codingFrame(): RoutingFrame {
  return {
    intent: 'debugging',
    state: 'deepening',
    domain: 'coding',
    risk: [],
    signals: { keywords: ['TypeError', 'async', 'fetch'], structures: [], urgency: 'medium', affect: 'neutral' },
    confidence: { intent: 0.85, state: 0.76, domain: 0.91, risk: 1 },
  }
}

function medicalFrame(): RoutingFrame {
  return {
    intent: 'information_seeking',
    state: 'deepening',
    domain: 'medical',
    risk: ['medical_caution'],
    signals: { keywords: [], structures: [], urgency: 'low', affect: 'neutral' },
    confidence: { intent: 0.78, state: 0.74, domain: 0.88, risk: 0.88 },
  }
}

function crisisFrame(): RoutingFrame {
  return {
    intent: 'task_execution',
    state: 'escalating',
    domain: 'general',
    risk: ['crisis', 'protected_context'],
    signals: { keywords: ['crisis'], structures: [], urgency: 'high', affect: 'distressed' },
    confidence: { intent: 0.7, state: 0.74, domain: 0.62, risk: 0.88 },
  }
}

function makeCodingHistory(count: number): Message[] {
  const turns: Message[] = [
    { role: 'user',      content: 'My async fetch call is throwing a TypeError in production.' },
    { role: 'assistant', content: 'Can you share the stack trace?' },
    { role: 'user',      content: 'TypeError: Cannot read properties of undefined (reading "json") at line 42.' },
    { role: 'assistant', content: 'That looks like the response is undefined. Are you awaiting the fetch correctly?' },
    { role: 'user',      content: 'I think so — I have `const res = await fetch(url)` then `res.json()`.' },
    { role: 'assistant', content: 'Check that `url` is a valid string and that fetch is not timing out silently.' },
    { role: 'user',      content: 'The URL is correct. Could it be a CORS issue blocking the response?' },
    { role: 'assistant', content: 'Possible — open DevTools Network tab and look for a CORS preflight failure.' },
  ]
  return turns.slice(0, count)
}

function makeMedicalHistory(count: number): Message[] {
  const turns: Message[] = [
    { role: 'user',      content: 'I started taking Lisinopril two weeks ago for blood pressure.' },
    { role: 'assistant', content: 'How are you feeling so far on Lisinopril?' },
    { role: 'user',      content: 'I have a persistent dry cough — my blood pressure is 140/90 now.' },
    { role: 'assistant', content: 'A dry cough is a common side effect of Lisinopril. Please mention it to your doctor.' },
    { role: 'user',      content: 'Is it safe to take ibuprofen alongside Lisinopril for my knee pain?' },
    { role: 'assistant', content: 'NSAIDs like ibuprofen can reduce Lisinopril effectiveness. Consult your doctor before mixing them.' },
    { role: 'user',      content: 'I have also noticed some shortness of breath — should I be concerned?' },
  ]
  return turns.slice(0, count)
}

function makeCrisisHistory(count: number): Message[] {
  const turns: Message[] = [
    { role: 'user',      content: 'I have not been sleeping and everything feels pointless lately.' },
    { role: 'assistant', content: 'I am really glad you told me. How long has this been going on?' },
    { role: 'user',      content: 'About two weeks. I keep thinking my family would be better off without me.' },
    { role: 'assistant', content: 'That sounds incredibly heavy. You are not a burden, and I want to make sure you are safe.' },
    { role: 'user',      content: 'I do not want to be here anymore. I have been thinking about how I would do it.' },
    { role: 'assistant', content: 'Thank you for trusting me. Right now, are you in a safe place and is someone nearby?' },
    { role: 'user',      content: 'My sister is home. I have not told her anything.' },
  ]
  return turns.slice(0, count)
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. scoreRelevance() fallback when model absent
// ─────────────────────────────────────────────────────────────────────────────
// ml-relevance.ts does not yet exist. These tests define the contract it must
// satisfy and will be un-todo'd in Phase 4.

describe('scoreRelevance() fallback when model absent', () => {
  test.todo('scoreRelevance returns array of zeros with correct length when model absent')
  test.todo('scoreRelevance never throws even when ONNX model is missing')
  test.todo('scoreRelevance returns length equal to messages array length')
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. selectFocusMessages() graceful degradation
// ─────────────────────────────────────────────────────────────────────────────
// These tests exercise the existing compressHistory() / selectFocusMessages()
// logic directly — no ml-relevance.ts dependency.

describe('selectFocusMessages() graceful degradation', () => {
  it('compressHistory returns non-empty compressed result for 6-turn history', () => {
    const history = makeCodingHistory(6)
    const frame = codingFrame()
    const result = compressHistory(history, frame)

    expect(result.compressed.length).toBeGreaterThan(0)
    expect(result.compressed.length).toBeLessThanOrEqual(history.length)
  })

  it('compressHistory result compressed array never exceeds original length', () => {
    const history = makeCodingHistory(8)
    const frame = codingFrame()
    const result = compressHistory(history, frame)

    expect(result.compressed.length).toBeLessThanOrEqual(result.original.length)
  })

  it('compressHistory keeps recent messages (last 2 turns always present)', () => {
    // Build a 10-message history where the last user message has a distinctive marker
    const history: Message[] = [
      { role: 'user',      content: 'My async fetch call is throwing a TypeError.' },
      { role: 'assistant', content: 'Can you share the stack trace?' },
      { role: 'user',      content: 'TypeError: Cannot read properties of undefined.' },
      { role: 'assistant', content: 'That looks like the response is undefined.' },
      { role: 'user',      content: 'I have `const res = await fetch(url)` then `res.json()`.' },
      { role: 'assistant', content: 'Check that fetch is not timing out silently.' },
      { role: 'user',      content: 'The URL is correct. Could it be a CORS issue?' },
      { role: 'assistant', content: 'Open DevTools Network tab and look for a CORS preflight failure.' },
      { role: 'user',      content: 'No CORS errors. I see a 401 response instead.' },
      { role: 'user',      content: 'DISTINCTIVE_MARKER_12345' },
    ]
    const frame = codingFrame()
    const result = compressHistory(history, frame)

    const markerAppears = result.compressed.some((m) =>
      m.content.includes('DISTINCTIVE_MARKER_12345'),
    )
    expect(markerAppears).toBe(true)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. score ordering
// ─────────────────────────────────────────────────────────────────────────────

describe('score ordering', () => {
  test.todo('messages with higher relevance scores appear earlier in selectFocusMessages result')
  test.todo('scoreRelevance returns higher scores for semantically similar messages')
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. protected zone bypass
// ─────────────────────────────────────────────────────────────────────────────

describe('protected zone bypass', () => {
  it('compressHistory with a medical frame compresses but keeps medication facts', () => {
    const history = makeMedicalHistory(7)
    const frame = medicalFrame()
    const result = compressHistory(history, frame)
    const text = result.compressed.map((m) => m.content).join(' ').toLowerCase()

    // Medical is compressible, but the medication / reading facts survive.
    expect(result.tokensSaved).toBeGreaterThan(0)
    expect(text).toContain('lisinopril')
    expect(text).toContain('140/90')
  })

  it('compressHistory with crisis frame returns tokensSaved === 0', () => {
    const history = makeCrisisHistory(7)
    const frame = crisisFrame()
    const result = compressHistory(history, frame)

    // Crisis + protected_context risk — no tokens should be removed
    expect(result.tokensSaved).toBe(0)
  })

  test.todo('when ml-relevance.ts is loaded, scoreRelevance is NOT called for protected zone frames')
})
