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

describe('Issue #6 — provider=anthropic forwards an OpenAI-shaped body to /v1/messages (FIXED)', () => {
  it('confirms the anthropic branch builds an Anthropic-shaped body: top-level "system", no "system" role in messages, required max_tokens', () => {
    const anthropicBranchStart = serverSrc.indexOf("llmProvider === 'anthropic'")
    const anthropicBranchEnd   = serverSrc.indexOf("else if (llmProvider === 'gemini')", anthropicBranchStart)
    const anthropicBranchBlock = serverSrc.slice(anthropicBranchStart, anthropicBranchEnd)
    expect(anthropicBranchBlock).toMatch(/api\.anthropic\.com\/v1\/messages/)
    // The fix: llmBody for the anthropic branch carries system as a top-level field
    // (from systemMsg.content, not a role:"system" message) and always sets max_tokens,
    // which Anthropic's Messages API requires and OpenAI-style bodies don't.
    expect(anthropicBranchBlock).toMatch(/system:\s*systemMsg\.content/)
    expect(anthropicBranchBlock).toMatch(/max_tokens:/)
    expect(anthropicBranchBlock).toMatch(/messages:\s*forwardHistory/)
  })
})

describe('Issue #10 — arbitrary x-llm-base-url (FIXED), and the Gemini key travels in the URL (FIXED)', () => {
  it('confirms x-llm-base-url is validated (protocol + resolved-hostname check) before being used, not read straight into a fetch URL', () => {
    // validateLlmBaseUrl() rejects non-https URLs and hostnames that resolve to a
    // private/loopback/link-local address (the SSRF vector: pointing this server's
    // own outbound fetch at an internal address and relaying the response back).
    expect(serverSrc).toMatch(/function validateLlmBaseUrl/)
    expect(serverSrc).toMatch(/isPrivateOrUnresolvableHost/)
    const openAiBranchStart = serverSrc.indexOf('Default: OpenAI-compatible')
    const openAiBranchBlock = serverSrc.slice(openAiBranchStart, openAiBranchStart + 400)
    expect(openAiBranchBlock).toMatch(/await validateLlmBaseUrl\(baseUrl\)/)
    expect(openAiBranchBlock).toMatch(/sendJson\(res, 400,/)
  })

  it('FIXED: the Gemini key now travels in an Authorization header, not the request URL', () => {
    // Was `?key=${llmKey}` in the URL — also matched a comment already in this
    // file (server.ts, callGemini()) noting Gemini's OpenAI-compat endpoint
    // rejects that form with a 400 now and requires Bearer auth instead.
    expect(serverSrc).not.toMatch(/generativelanguage\.googleapis\.com\/v1beta\/openai\/chat\/completions\?key=/)
    // Anchored on "else if (...)" specifically — the URL-resolution branch,
    // not the (now also present, since the embedding-compression fallback
    // added this session) ternary `llmProvider === 'gemini' ? llmKey : ''`
    // that reads the same provider check earlier in the route to decide
    // whether to reuse it as the embedding key.
    const geminiBranch = serverSrc.slice(
      serverSrc.indexOf("else if (llmProvider === 'gemini')"),
      serverSrc.indexOf("else if (llmProvider === 'gemini')") + 700,
    )
    expect(geminiBranch).toMatch(/authorization:\s*`Bearer \$\{llmKey\}`/)
  })
})
