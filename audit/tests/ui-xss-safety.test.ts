import { describe, expect, it } from 'vitest'
import { getAdminDashboardHtml, escHtml as adminEscHtml } from '../../src/admin-ui.js'
import { getMemoryViewHtml, escHtml as memoryEscHtml } from '../../src/memory-ui.js'

describe('Bug E: HTML XSS Hardening for Admin UI and Memory UI', () => {
  const baseUrl = 'http://127.0.0.1:8787'
  const adminHtml = getAdminDashboardHtml(baseUrl)
  const memoryHtml = getMemoryViewHtml(baseUrl)

  describe('escHtml utility function', () => {
    it.each([
      ['adminEscHtml', adminEscHtml],
      ['memoryEscHtml', memoryEscHtml],
    ])('%s properly escapes &, <, >, ", and \'', (_name, esc) => {
      expect(esc('&')).toBe('&amp;')
      expect(esc('<')).toBe('&lt;')
      expect(esc('>')).toBe('&gt;')
      expect(esc('"')).toBe('&quot;')
      expect(esc("'")).toBe('&#39;')
      expect(esc('<script>alert("XSS & attack")</script>')).toBe(
        '&lt;script&gt;alert(&quot;XSS &amp; attack&quot;)&lt;/script&gt;'
      )
      expect(esc("'; alert('xss'); '")).toBe('&#39;; alert(&#39;xss&#39;); &#39;')
    })

    it.each([
      ['adminEscHtml', adminEscHtml],
      ['memoryEscHtml', memoryEscHtml],
    ])('%s safely handles null, undefined, numbers, and plain text', (_name, esc) => {
      expect(esc(null)).toBe('')
      expect(esc(undefined)).toBe('')
      expect(esc('')).toBe('')
      expect(esc(12345)).toBe('12345')
      expect(esc('safe string 42')).toBe('safe string 42')
    })
  })

  describe('getAdminDashboardHtml() XSS safety', () => {
    it('defines an escHtml helper function inside inline <script> escaping all 5 dangerous characters', () => {
      expect(adminHtml).toContain('function escHtml(v)')
      expect(adminHtml).toMatch(/&amp;/)
      expect(adminHtml).toMatch(/&lt;/)
      expect(adminHtml).toMatch(/&gt;/)
      expect(adminHtml).toMatch(/&quot;/)
      expect(adminHtml).toMatch(/&#39;/)
    })

    it('does NOT interpolate raw r.name, r.useCase, k.name, or u.endpoint into .innerHTML', () => {
      // Must not contain raw unescaped template literals in innerHTML
      expect(adminHtml).not.toMatch(/tbody\.innerHTML\s*=.*?\$\{r\.name\}/s)
      expect(adminHtml).not.toMatch(/tbody\.innerHTML\s*=.*?\$\{r\.useCase\}/s)
      expect(adminHtml).not.toMatch(/tbody\.innerHTML\s*=.*?\$\{k\.name\}/s)
      expect(adminHtml).not.toMatch(/innerHTML\s*=.*?\$\{u\.endpoint\}/s)
      expect(adminHtml).not.toMatch(/innerHTML\s*=.*?\+\s*u\.endpoint\s*\+/s)
      expect(adminHtml).not.toMatch(/innerHTML\s*=.*?\+\s*r\.name\s*\+/s)
      expect(adminHtml).not.toMatch(/innerHTML\s*=.*?\+\s*k\.name\s*\+/s)
    })

    it('wraps all key dynamic interpolations with escHtml(...) in keys table rendering', () => {
      expect(adminHtml).toContain('${escHtml(k.name)}')
      expect(adminHtml).toContain('${escHtml(k.ownerEmail)}')
      expect(adminHtml).toContain('${escHtml(k.id)}')
    })

    it('wraps all request dynamic interpolations with escHtml(...) in waitlist table rendering', () => {
      expect(adminHtml).toContain('${escHtml(r.name)}')
      expect(adminHtml).toContain('${escHtml(r.email)}')
      expect(adminHtml).toContain('escHtml(r.useCase)')
    })

    it('escapes modal action button arguments to prevent attribute breakout', () => {
      expect(adminHtml).toContain("openRevokeModal('${escHtml(k.id)}','${escHtml(k.name)}','${escHtml(k.ownerEmail)}')")
      expect(adminHtml).toContain("fulfillRequest(${r.id}, '${escHtml(r.name)}', '${escHtml(r.email)}')")
    })
  })

  describe('getMemoryViewHtml() XSS safety', () => {
    it('defines an escHtml helper function inside inline <script> escaping all 5 dangerous characters', () => {
      expect(memoryHtml).toContain('function escHtml(v)')
      expect(memoryHtml).toMatch(/&amp;/)
      expect(memoryHtml).toMatch(/&lt;/)
      expect(memoryHtml).toMatch(/&gt;/)
      expect(memoryHtml).toMatch(/&quot;/)
      expect(memoryHtml).toMatch(/&#39;/)
    })

    it('does NOT interpolate raw r.name, r.useCase, k.name, or u.endpoint into .innerHTML', () => {
      expect(memoryHtml).not.toMatch(/innerHTML\s*=.*?\$\{r\.name\}/s)
      expect(memoryHtml).not.toMatch(/innerHTML\s*=.*?\$\{r\.useCase\}/s)
      expect(memoryHtml).not.toMatch(/innerHTML\s*=.*?\$\{k\.name\}/s)
      expect(memoryHtml).not.toMatch(/innerHTML\s*=.*?\$\{u\.endpoint\}/s)
      expect(memoryHtml).not.toMatch(/innerHTML\s*=.*?\+\s*u\.endpoint\s*\+/s)
      expect(memoryHtml).not.toMatch(/innerHTML\s*=.*?\+\s*c\.endpoint\s*\+/s)
    })

    it('escapes dynamic wiki content and tags with escHtml(...) before innerHTML insertion', () => {
      expect(memoryHtml).toContain("escHtml(s.title)")
      expect(memoryHtml).toContain("escHtml(emptyText)")
      expect(memoryHtml).toContain("escHtml(t)")
    })

    it('escapes activity table columns with escHtml(...) before innerHTML insertion', () => {
      expect(memoryHtml).toContain("escHtml(time)")
      expect(memoryHtml).toContain("escHtml(u.domain || '—')")
      expect(memoryHtml).toContain("escHtml(modelLabel)")
      expect(memoryHtml).toContain("escHtml(u.compressionMode || '—')")
      expect(memoryHtml).toContain("escHtml(kept)")
      expect(memoryHtml).toContain("escHtml(pct)")
      expect(memoryHtml).toContain("escHtml(String(u.tokensSaved ?? 0))")
    })
  })

  describe('Simulated Attack Payloads Injection Safety', () => {
    const maliciousPayloads = [
      '<script>alert("XSS")</script>',
      '"><img src=x onerror=alert(1)>',
      '\'><svg onload=alert(document.domain)>',
      '<iframe src="javascript:alert(1)"></iframe>',
      'user&name<test>"quote\'',
    ]

    it('neutralizes all malicious payloads so that no raw HTML tags or script injection survives', () => {
      for (const payload of maliciousPayloads) {
        const escaped = adminEscHtml(payload)
        expect(escaped).not.toContain('<script')
        expect(escaped).not.toContain('<img')
        expect(escaped).not.toContain('<svg')
        expect(escaped).not.toContain('<iframe')
        expect(escaped).not.toContain('"')
        expect(escaped).not.toContain("'")
        expect(escaped).not.toContain('<')
        expect(escaped).not.toContain('>')
      }
    })
  })
})
