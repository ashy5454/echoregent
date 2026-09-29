/** Returns the full HTML string for the customer-facing "what's been memorized about me" page. */
export function getMemoryViewHtml(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Your Memory — EchoRegent</title>
<style>
  :root {
    --bg: #0a0a0f;
    --surface: #13131a;
    --surface2: #1c1c26;
    --border: #2a2a38;
    --accent: #7c6aff;
    --accent2: #5eead4;
    --text: #e8e8f0;
    --text2: #8888a8;
    --red: #ef4444;
    --radius: 10px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; min-height: 100vh; }

  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 28px; background: var(--surface); border-bottom: 1px solid var(--border);
  }
  .logo { font-weight: 700; font-size: 18px; }
  .logo span { color: var(--accent); }

  main { max-width: 720px; margin: 0 auto; padding: 40px 24px; }

  #login-screen { display: flex; flex-direction: column; gap: 14px; max-width: 420px; margin: 60px auto 0; text-align: center; }
  #login-screen h1 { font-size: 22px; }
  #login-screen p { color: var(--text2); line-height: 1.5; }
  input {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    padding: 12px 16px; border-radius: var(--radius); font-size: 14px; outline: none; width: 100%;
  }
  input:focus { border-color: var(--accent); }
  .field-label { display: block; text-align: left; color: var(--text2); font-size: 12px; margin-bottom: 6px; }
  .field-group { margin-bottom: 14px; }
  #login-error { color: var(--red); font-size: 13px; display: none; }

  .btn {
    display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    padding: 10px 18px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 14px; font-weight: 600; transition: opacity .15s;
  }
  .btn:hover { opacity: 0.85; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-danger { background: transparent; color: var(--red); border: 1px solid var(--red); }
  .btn-ghost { background: transparent; color: var(--text2); border: 1px solid var(--border); }

  #memory-screen { display: none; }
  .top-row { display: flex; align-items: center; justify-content: space-between; margin-bottom: 24px; }
  .top-row h1 { font-size: 20px; }
  .top-row .sub { color: var(--text2); font-size: 13px; margin-top: 4px; }

  .card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 20px; margin-bottom: 18px;
  }
  .card h2 { font-size: 14px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--text2); margin-bottom: 12px; }
  .tag-list { display: flex; flex-wrap: wrap; gap: 8px; }
  .tag {
    background: var(--surface2); border: 1px solid var(--border); border-radius: 999px;
    padding: 6px 12px; font-size: 13px; color: var(--text);
  }
  .empty-note { color: var(--text2); font-size: 13px; }
  .meta-row { color: var(--text2); font-size: 12px; margin-top: 10px; }

  .danger-zone { border-color: rgba(239,68,68,0.35); }
  .danger-zone p { color: var(--text2); font-size: 13px; margin-bottom: 14px; line-height: 1.5; }

  #confirm-clear { display: none; margin-top: 10px; gap: 10px; }

  .activity-table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .activity-table th {
    text-align: left; color: var(--text2); font-weight: 500; text-transform: uppercase;
    letter-spacing: 0.04em; font-size: 10px; padding: 0 10px 8px 0; border-bottom: 1px solid var(--border);
  }
  .activity-table td { padding: 8px 10px 8px 0; border-bottom: 1px solid rgba(255,255,255,0.04); color: var(--text); }
  .activity-table tr:last-child td { border-bottom: none; }
  .mode-pill {
    display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px;
    background: var(--surface2); border: 1px solid var(--border);
  }
</style>
</head>
<body>

<header>
  <div class="logo">Echo<span>Regent</span></div>
</header>

<main>
  <div id="login-screen">
    <h1>See what EchoRegent remembers about you</h1>
    <p>Enter your EchoRegent API key to view or clear the memory built up from your conversations. Nothing is sent anywhere except this server — the key stays in your browser.</p>
    <div class="field-group">
      <label class="field-label">API key</label>
      <input type="password" id="key-input" placeholder="cts_..." autocomplete="off">
    </div>
    <div class="field-group">
      <label class="field-label">End-user ID (optional — only if your integration scopes memory per end user)</label>
      <input type="text" id="enduser-input" placeholder="e.g. user_123" autocomplete="off">
    </div>
    <button class="btn btn-primary" onclick="login()">View my memory</button>
    <div id="login-error">Could not load memory for that key. Check the key and try again.</div>
  </div>

  <div id="memory-screen">
    <div class="top-row">
      <div>
        <h1>Your memory</h1>
        <div class="sub" id="scope-label"></div>
      </div>
      <button class="btn btn-ghost" onclick="logout()">Log out</button>
    </div>

    <div class="card">
      <h2>Profile</h2>
      <div id="wiki-profile"></div>
    </div>
    <div class="card">
      <h2>Patterns</h2>
      <div id="wiki-patterns"></div>
    </div>
    <div class="card">
      <h2>Active context</h2>
      <div id="wiki-context"></div>
    </div>
    <div class="card">
      <h2>Corrections &amp; mistakes noted</h2>
      <div id="wiki-mistakes"></div>
    </div>
    <div class="card">
      <h2>Knowledge sources ingested</h2>
      <div id="wiki-sources"></div>
    </div>

    <div class="card">
      <h2>Recent activity — what was compressed</h2>
      <p class="meta-row" style="margin-top:0;margin-bottom:12px;">
        Structure only — call time, domain, compression mode, and message/token counts.
        Never the actual conversation content. Scoped to this whole API key, not just an end-user ID.
      </p>
      <div id="activity-table"></div>
    </div>

    <div class="card danger-zone">
      <h2>Clear my memory</h2>
      <p>This permanently deletes everything EchoRegent has learned about you (or this end user) from this key's conversations. It does not affect other end users under the same key. This cannot be undone.</p>
      <button class="btn btn-danger" onclick="showConfirmClear()">Clear my memory</button>
      <div id="confirm-clear">
        <button class="btn btn-danger" onclick="clearMemory()">Yes, permanently delete it</button>
        <button class="btn btn-ghost" onclick="hideConfirmClear()">Cancel</button>
      </div>
    </div>
  </div>
</main>

<script>
  const BASE = '${baseUrl}'
  let apiKey = ''
  let endUserId = ''

  function authHeaders() {
    const h = { Authorization: 'Bearer ' + apiKey }
    if (endUserId) h['x-end-user-id'] = endUserId
    return h
  }

  async function login() {
    const key = document.getElementById('key-input').value.trim()
    const eu  = document.getElementById('enduser-input').value.trim()
    if (!key) return
    apiKey = key
    endUserId = eu
    const res = await fetch(BASE + '/api/wiki', { headers: authHeaders() })
    if (!res.ok) {
      document.getElementById('login-error').style.display = 'block'
      apiKey = ''
      return
    }
    document.getElementById('login-error').style.display = 'none'
    localStorage.setItem('echoregent_memory_key', key)
    if (eu) localStorage.setItem('echoregent_memory_enduser', eu); else localStorage.removeItem('echoregent_memory_enduser')
    const data = await res.json()
    showMemory(data)
    loadActivity()
  }

  function logout() {
    localStorage.removeItem('echoregent_memory_key')
    localStorage.removeItem('echoregent_memory_enduser')
    apiKey = ''; endUserId = ''
    document.getElementById('memory-screen').style.display = 'none'
    document.getElementById('login-screen').style.display = 'flex'
    document.getElementById('key-input').value = ''
    document.getElementById('enduser-input').value = ''
  }

  window.addEventListener('DOMContentLoaded', async () => {
    const savedKey = localStorage.getItem('echoregent_memory_key')
    if (!savedKey) return
    apiKey = savedKey
    endUserId = localStorage.getItem('echoregent_memory_enduser') || ''
    const res = await fetch(BASE + '/api/wiki', { headers: authHeaders() })
    if (!res.ok) { apiKey = ''; return }
    const data = await res.json()
    showMemory(data)
    loadActivity()
  })

  function showMemory(data) {
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('memory-screen').style.display = 'block'
    document.getElementById('scope-label').textContent = endUserId
      ? 'Scoped to end-user ID: ' + endUserId
      : 'Scoped to this API key (no end-user ID set)'

    renderTagList('wiki-profile',  data.userWiki && data.userWiki.profile,           'Nothing recorded yet — this fills in as conversations happen.')
    renderTagList('wiki-patterns', data.userWiki && data.userWiki.patterns,          'No recurring patterns noticed yet.')
    renderTagList('wiki-context',  data.userWiki && data.userWiki.activeContext,     'No active context right now.')
    renderTagList('wiki-mistakes', data.userWiki && data.userWiki.mistakes,          'No corrections logged.')

    const sources = (data.llmWiki && data.llmWiki.sources) || []
    const sourcesEl = document.getElementById('wiki-sources')
    if (!sources.length) {
      sourcesEl.innerHTML = '<div class="empty-note">No knowledge sources ingested.</div>'
    } else {
      sourcesEl.innerHTML = '<div class="tag-list">' + sources.map(s => '<span class="tag">' + esc(s.title) + '</span>').join('') + '</div>'
    }
  }

  async function loadActivity() {
    const el = document.getElementById('activity-table')
    try {
      const res = await fetch(BASE + '/api/usage/calls?limit=25', { headers: { Authorization: 'Bearer ' + apiKey } })
      if (!res.ok) { el.innerHTML = '<div class="empty-note">Could not load activity.</div>'; return }
      const data = await res.json()
      const calls = (data.calls || []).filter(c => c.endpoint === '/v1/chat/completions')
      if (!calls.length) {
        el.innerHTML = '<div class="empty-note">No compressed calls yet.</div>'
        return
      }
      const rows = calls.map(c => {
        const time = new Date(c.calledAt).toLocaleString()
        const modelLabel = [c.provider, c.model].filter(Boolean).join(' / ') || '—'
        const kept = (c.messagesKept != null && c.messagesOriginal != null)
          ? c.messagesKept + ' / ' + c.messagesOriginal
          : '—'
        const pct = c.compressionPct != null ? c.compressionPct + '%' : '—'
        return '<tr>' +
          '<td>' + esc(time) + '</td>' +
          '<td>' + esc(c.domain || '—') + '</td>' +
          '<td>' + esc(modelLabel) + '</td>' +
          '<td><span class="mode-pill">' + esc(c.compressionMode || '—') + '</span></td>' +
          '<td>' + esc(kept) + '</td>' +
          '<td>' + esc(pct) + '</td>' +
          '<td>' + esc(String(c.tokensSaved ?? 0)) + '</td>' +
          '</tr>'
      }).join('')
      el.innerHTML = '<table class="activity-table"><thead><tr>' +
        '<th>Time</th><th>Domain</th><th>Provider / Model</th><th>Mode</th><th>Kept / Original</th><th>Compression</th><th>Tokens saved</th>' +
        '</tr></thead><tbody>' + rows + '</tbody></table>'
    } catch {
      el.innerHTML = '<div class="empty-note">Could not load activity.</div>'
    }
  }

  function renderTagList(elId, items, emptyText) {
    const el = document.getElementById(elId)
    if (!items || !items.length) {
      el.innerHTML = '<div class="empty-note">' + esc(emptyText) + '</div>'
      return
    }
    el.innerHTML = '<div class="tag-list">' + items.map(t => '<span class="tag">' + esc(t) + '</span>').join('') + '</div>'
  }

  function showConfirmClear() { document.getElementById('confirm-clear').style.display = 'flex' }
  function hideConfirmClear() { document.getElementById('confirm-clear').style.display = 'none' }

  async function clearMemory() {
    const res = await fetch(BASE + '/api/wiki', { method: 'DELETE', headers: authHeaders() })
    if (!res.ok) return
    hideConfirmClear()
    const fresh = await fetch(BASE + '/api/wiki', { headers: authHeaders() })
    showMemory(await fresh.json())
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  }
</script>
</body>
</html>`
}
