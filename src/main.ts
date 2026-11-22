import './styles.css'
import { initStarfield } from './stars.js'

initStarfield()

const API = ''  // relative — proxied in dev, same-origin in production

// ── Quickstart tab switching ───────────────────────────────────────────────
document.querySelectorAll<HTMLButtonElement>('.qs-tab').forEach(tab => {
  tab.addEventListener('click', () => {
    const lang = tab.dataset.lang!
    document.querySelectorAll('.qs-tab').forEach(t => t.classList.remove('active'))
    tab.classList.add('active')
    document.querySelectorAll<HTMLElement>('.qs-panel').forEach(p => {
      p.classList.toggle('active', p.dataset.lang === lang)
    })
  })
})


// ── Demo chatbot ──────────────────────────────────────────────────────────
const chatMessages = document.getElementById('chat-messages')!
const chatInput = document.getElementById('chat-input') as HTMLInputElement
const chatSend = document.getElementById('chat-send') as HTMLButtonElement
const demoFrame = document.getElementById('demo-frame')!

type Message = { role: 'user' | 'assistant'; content: string }
const history: Message[] = []

const BOT_RESPONSES: Record<string, string> = {
  'coding:debugging': "I can see this is a debugging request. Let me trace through the issue and identify the root cause — I'll need the full error message and relevant code.",
  'coding:generation': "Got it — I'll generate clean, well-structured code for that. Let me start with the core logic.",
  'coding:information_seeking': "Here's how that works in practice. The key thing to understand is...",
  'coding:task_execution': "On it. Here's what I'll do step by step...",
  'medical:information_seeking': "I can share general information here, though please consult a healthcare professional for advice specific to your situation.",
  'medical:decision_support': "Let me help you think through the considerations — your doctor should make the final call, but here's the relevant context.",
  'legal:decision_support': "I can outline the key legal considerations here. You should verify this with a licensed attorney for your specific jurisdiction.",
  'legal:information_seeking': "Here's how this typically works from a legal standpoint...",
  'sales:objection_handling': "I understand your concern — let me address that directly and show you why it's actually less of an issue than it might seem.",
  'sales:decision_support': "Let me walk you through what makes sense for your specific situation.",
  'customer_support:escalation': "I completely understand your frustration and I want to make this right immediately. Let me escalate this now.",
  'customer_support:task_execution': "I'm on it — let me pull up the details and get this resolved for you right away.",
  'customer_support:information_seeking': "Let me look that up for you now.",
  'education:information_seeking': "Great question! Let me break this down step by step in a way that makes it click.",
  'education:summarization': "Here's a clear summary of the key points — I'll focus on what's most important to remember.",
  'commerce:comparison': "Let me compare those options side by side based on your specific needs.",
  'commerce:information_seeking': "Here's what you should know before making a decision...",
  'general:task_execution': "I'll take care of that. Here's how I'll approach it...",
  'general:information_seeking': "Here's what I know about that...",
  'general:exploration': "Good question to explore. A few different angles worth considering...",
}

function getBotResponse(domain: string, intent: string): string {
  return BOT_RESPONSES[`${domain}:${intent}`]
    || BOT_RESPONSES[`${domain}:information_seeking`]
    || BOT_RESPONSES[`general:information_seeking`]
    || "Let me help you with that."
}

function addMessage(role: 'user' | 'bot', text: string, isTyping = false) {
  const div = document.createElement('div')
  div.className = `chat-msg ${role}`
  div.innerHTML = `
    <span class="msg-label">${role === 'user' ? 'You' : 'CTS Demo'}</span>
    <div class="msg-bubble${isTyping ? ' typing' : ''}">${escHtml(text)}</div>
  `
  chatMessages.appendChild(div)
  chatMessages.scrollTop = chatMessages.scrollHeight
  return div
}

function renderFrame(data: { domain: string; intent: string; state: string; tokensSaved: number; confidence: Record<string, number>; risk: string[] }) {
  const conf = data.confidence || {}
  const risks = data.risk || []

  demoFrame.innerHTML = `
    <div class="frame-header">CTS Routing Analysis</div>
    <div class="frame-domain domain-${data.domain}">${data.domain.replace('_', ' ')}</div>
    ${frameRow('Intent', data.intent.replace(/_/g, ' '))}
    ${frameRow('State', data.state)}
    ${frameBarRow('Intent confidence', Math.round((conf.intent || 0.7) * 100))}
    ${frameBarRow('Domain confidence', Math.round((conf.domain || 0.8) * 100))}
    ${risks.length ? `<div class="frame-row"><span class="frame-key">Risk</span><span>${risks.map(r => `<span class="risk-badge">${r.replace(/_/g, ' ')}</span>`).join(' ')}</span></div>` : ''}
    <div class="frame-tokens">
      ${data.tokensSaved > 0
        ? `<strong>${data.tokensSaved}</strong> tokens saved this turn`
        : 'Token compression activates after a few messages'}
    </div>
  `
}

function frameRow(key: string, val: string): string {
  return `<div class="frame-row"><span class="frame-key">${key}</span><span class="frame-val">${escHtml(val)}</span></div>`
}

function frameBarRow(key: string, pct: number): string {
  return `<div class="frame-row">
    <span class="frame-key">${key}</span>
    <div class="frame-bar-wrap">
      <div class="frame-bar"><div class="frame-bar-fill" style="width:${pct}%"></div></div>
      <span class="frame-val">${pct}%</span>
    </div>
  </div>`
}

async function sendDemo(message: string) {
  if (!message.trim()) return
  chatInput.value = ''
  chatSend.disabled = true

  // Clear welcome message on first send
  const welcome = chatMessages.querySelector('.chat-welcome')
  if (welcome) welcome.remove()

  addMessage('user', message)
  const typingEl = addMessage('bot', 'Analyzing…', true)
  history.push({ role: 'user', content: message })

  try {
    const res = await fetch(`${API}/demo/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: history.slice(0, -1) }),
    })

    if (!res.ok) throw new Error(`${res.status}`)
    const data = await res.json()

    renderFrame({
      domain: data.domain,
      intent: data.intent,
      state: data.state,
      tokensSaved: data.tokensSaved ?? 0,
      confidence: data.frame?.confidence ?? {},
      risk: data.frame?.risk ?? [],
    })

    const botText = String(data.reply || 'No response.')
    typingEl.querySelector('.msg-bubble')!.textContent = botText
    typingEl.querySelector('.msg-bubble')!.classList.remove('typing')
    history.push({ role: 'assistant', content: botText })
  } catch {
    typingEl.querySelector('.msg-bubble')!.textContent = 'Demo unavailable — check server or API key.'
    typingEl.querySelector('.msg-bubble')!.classList.remove('typing')
  } finally {
    chatSend.disabled = false
  }
}

chatSend.addEventListener('click', () => sendDemo(chatInput.value))
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') sendDemo(chatInput.value)
})

// Hint clicks
document.querySelectorAll<HTMLElement>('.hint').forEach((el) => {
  el.addEventListener('click', () => {
    chatInput.value = el.dataset.msg ?? el.textContent ?? ''
    chatInput.focus()
  })
})

// ── API key request form ───────────────────────────────────────────────────
const reqName = document.getElementById('req-name') as HTMLInputElement
const reqEmail = document.getElementById('req-email') as HTMLInputElement
const reqUse = document.getElementById('req-use') as HTMLInputElement
const reqSubmit = document.getElementById('req-submit') as HTMLButtonElement
const reqStatus = document.getElementById('req-status')!

reqSubmit.addEventListener('click', async () => {
  const name = reqName.value.trim()
  const email = reqEmail.value.trim()
  const useCase = reqUse.value.trim()

  if (!name || !email) {
    setStatus(reqStatus, 'Please fill in your name and email.', 'error')
    return
  }

  reqSubmit.disabled = true
  reqSubmit.textContent = 'JOINING…'
  setStatus(reqStatus, '', '')

  try {
    const res = await fetch(`${API}/demo/request-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, useCase }),
    })
    if (res.ok) {
      const data = await res.json()
      const pos = data.position ? `You're #${data.position} on the waitlist. ` : ''
      setStatus(reqStatus, `${pos}We'll be in touch within 24 hours.`, 'success')
      reqName.value = ''
      reqEmail.value = ''
      reqUse.value = ''
      // Refresh the live counter
      fetchWaitlistCount()
    } else {
      setStatus(reqStatus, 'Something went wrong. Try emailing us directly.', 'error')
    }
  } catch {
    setStatus(reqStatus, 'Could not reach server. Try again shortly.', 'error')
  } finally {
    reqSubmit.disabled = false
    reqSubmit.textContent = 'JOIN WAITLIST →'
  }
})

// ── Dashboard ─────────────────────────────────────────────────────────────
const dashKey = document.getElementById('dash-key') as HTMLInputElement
const dashLoad = document.getElementById('dash-load') as HTMLButtonElement
const dashStats = document.getElementById('dash-stats')!

dashLoad.addEventListener('click', async () => {
  const key = dashKey.value.trim()
  if (!key) return

  dashLoad.disabled = true
  dashLoad.textContent = 'LOADING…'
  dashStats.classList.add('hidden')

  try {
    const res = await fetch(`${API}/api/usage`, {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (!res.ok) {
      dashStats.innerHTML = `<p style="color:#ff6464;text-align:center;grid-column:1/-1">Invalid or revoked key.</p>`
      dashStats.classList.remove('hidden')
      return
    }
    const data = await res.json()
    dashStats.innerHTML = `
      <div class="dash-stat">
        <div class="dash-stat-num">${data.totalCalls ?? 0}</div>
        <div class="dash-stat-label">Total Calls</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-num">${data.totalTokensSaved ?? 0}</div>
        <div class="dash-stat-label">Tokens Saved</div>
      </div>
      <div class="dash-stat">
        <div class="dash-stat-num">${data.last24hCalls ?? 0}</div>
        <div class="dash-stat-label">Last 24h</div>
      </div>
    `
    dashStats.classList.remove('hidden')
  } catch {
    dashStats.innerHTML = `<p style="color:#ff6464;text-align:center;grid-column:1/-1">Could not reach server.</p>`
    dashStats.classList.remove('hidden')
  } finally {
    dashLoad.disabled = false
    dashLoad.textContent = 'LOAD →'
  }
})

// ── Waitlist live counter ─────────────────────────────────────────────────────
async function fetchWaitlistCount() {
  try {
    const res = await fetch(`${API}/demo/waitlist-count`)
    if (!res.ok) return
    const { count } = await res.json()
    const counterEl = document.getElementById('waitlist-count')
    if (counterEl && typeof count === 'number') {
      counterEl.textContent = count > 0 ? `Join ${count} developer${count === 1 ? '' : 's'} on the waitlist` : 'Be the first on the waitlist'
    }
  } catch { /* silently ignore — counter is decorative */ }
}
fetchWaitlistCount()

// ── Helpers ───────────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
}

function delay(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

function setStatus(el: HTMLElement, msg: string, type: string) {
  el.textContent = msg
  el.className = `req-status${type ? ' ' + type : ''}`
}
