// AUDIT — static/structural checks for issues that cannot be safely or fully exercised
// at runtime in this environment (no proprietary ml/ weights, no real provider API keys,
// no egress override for hardcoded provider URLs). Each check cites the exact source
// pattern it is asserting against, and the corresponding AUDIT.md entry says plainly
// that this is a structural check, not a live end-to-end call.
//
// Rationale for using source-text assertions instead of importing+calling the code:
//  - Issue #2/#4: the relevant branch lives inline inside src/server.ts's HTTP route
//    handler (not a small pure function), and #4's T5 path additionally requires the
//    proprietary `ml/cts_t5` ONNX weights, which are gitignored and not present in
//    this checkout (README.md:195, .gitignore:9) — so summarizeWithT5() cannot run here.
//  - Issue #6/#10b: exercising these live would mean sending a real request (with a
//    real paid API key) to https://api.anthropic.com or https://generativelanguage.
//    googleapis.com, which this audit was not given credentials for and should not
//    spend money on speculatively.
//
// These tests will start failing (as a build break, not an assertion failure) the
// day someone refactors server.ts — which is a feature: it forces re-verification
// against the new code rather than silently going stale.

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const serverSrc     = readFileSync(join(__dirname, '../../src/server.ts'), 'utf-8')
const compressorSrc = readFileSync(join(__dirname, '../../src/cts-core/compressor.ts'), 'utf-8')

describe('Issue #2 — the OpenAI-compatible proxy uses the rule-based path, not T5', () => {
  it('FAILS: /v1/chat/completions should call compressHistoryAsync (T5 path) but calls compressHistory (rule path)', () => {
    const routeBlock = serverSrc.slice(
      serverSrc.indexOf("url.pathname === '/v1/chat/completions'"),
      serverSrc.lastIndexOf("sendJson(res, 404, { error: 'Not found.' })"),
    )
    // This assertion documents the desired behavior (README implies the T5 compressor
    // is the product's compression engine) and fails against the actual code, which
    // calls the synchronous rule-based compressHistory() at server.ts:795.
    expect(routeBlock).toMatch(/compressHistoryAsync\(/)
    expect(routeBlock).not.toMatch(/(?<!Async)compressHistory\(/)
  })
})

describe('Issue #4 — compressHistoryAsync truncates T5 input to ~1500 characters', () => {
  it('confirms the literal 1500-character slice before building the T5 prompt', () => {
    expect(compressorSrc).toMatch(/\.slice\(0,\s*1500\)/)
  })
})

describe('Issue #6 — provider=anthropic forwards an OpenAI-shaped body to /v1/messages', () => {
  it('FAILS: the anthropic branch of /v1/chat/completions should build an Anthropic-shaped body (top-level "system", no "system" role in messages) but instead reuses the OpenAI body shape', () => {
    const anthropicBranchStart = serverSrc.indexOf("llmProvider === 'anthropic'")
    const anthropicBranchBlock = serverSrc.slice(anthropicBranchStart, anthropicBranchStart + 400)
    // Actual code: sets the URL/headers for Anthropic but sends `{ ...body, messages:
    // forwardMessages, model: llmModel, stream }` — the same OpenAI-shaped payload used
    // for every other provider (server.ts:847-851), which still contains a `role:"system"`
    // message pushed earlier (server.ts:816) instead of Anthropic's required top-level
    // `system` string field. Anthropic's Messages API rejects `system` as a message role.
    const fetchCallBlock = serverSrc.slice(
      serverSrc.indexOf('llmResponse = await fetch(llmUrl'),
      serverSrc.indexOf('llmResponse = await fetch(llmUrl') + 300,
    )
    expect(anthropicBranchBlock).toMatch(/api\.anthropic\.com\/v1\/messages/)
    // This is what SHOULD be true for a correct Anthropic translation and is NOT:
    expect(fetchCallBlock).toMatch(/system:\s*systemMsg/)
  })
})

describe('Issue #10 — arbitrary x-llm-base-url (still open), and the Gemini key travels in the URL (FIXED)', () => {
  it('confirms x-llm-base-url is read directly from the request with no allowlist — still open, not part of this pass', () => {
    expect(serverSrc).toMatch(/x-llm-base-url['"]\]\s*\?\?\s*['"]https:\/\/api\.openai\.com['"]/)
  })

  it('FIXED: the Gemini key now travels in an Authorization header, not the request URL', () => {
    // Was `?key=${llmKey}` in the URL — also matched a comment already in this
    // file (server.ts, callGemini()) noting Gemini's OpenAI-compat endpoint
    // rejects that form with a 400 now and requires Bearer auth instead.
    expect(serverSrc).not.toMatch(/generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions\?key=/)
    const geminiBranch = serverSrc.slice(
      serverSrc.indexOf("llmProvider === 'gemini'"),
      serverSrc.indexOf("llmProvider === 'gemini'") + 700,
    )
    expect(geminiBranch).toMatch(/authorization:\s*`Bearer \$\{llmKey\}`/)
  })
})
