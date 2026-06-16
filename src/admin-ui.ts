/** Returns the full HTML string for the CTS admin dashboard. */
export function getAdminDashboardHtml(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>CTS Admin Dashboard</title>
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
    --green: #22c55e;
    --red: #ef4444;
    --yellow: #f59e0b;
    --radius: 10px;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; font-size: 14px; min-height: 100vh; }

  /* ── Login ── */
  #login-screen {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; gap: 16px;
  }
  #login-screen h1 { font-size: 28px; font-weight: 700; }
  #login-screen h1 span { color: var(--accent); }
  #login-screen p { color: var(--text2); }
  #login-screen input {
    background: var(--surface); border: 1px solid var(--border); color: var(--text);
    padding: 12px 16px; border-radius: var(--radius); width: 320px; font-size: 14px;
    outline: none;
  }
  #login-screen input:focus { border-color: var(--accent); }
  #login-error { color: var(--red); font-size: 13px; display: none; }

  /* ── Header ── */
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 28px; background: var(--surface); border-bottom: 1px solid var(--border);
    position: sticky; top: 0; z-index: 100;
  }
  .logo { font-weight: 700; font-size: 18px; }
  .logo span { color: var(--accent); }
  .header-right { display: flex; align-items: center; gap: 12px; }
  .header-right span { color: var(--text2); font-size: 13px; }

  /* ── Layout ── */
  main { max-width: 1200px; margin: 0 auto; padding: 28px 24px; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex; align-items: center; gap: 6px;
    padding: 8px 16px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; transition: opacity .15s;
  }
  .btn:hover { opacity: .85; }
  .btn-primary { background: var(--accent); color: #fff; }
  .btn-danger  { background: transparent; border: 1px solid var(--red); color: var(--red); padding: 5px 11px; font-size: 12px; }
  .btn-ghost   { background: var(--surface2); color: var(--text2); }
  .btn-small   { padding: 5px 11px; font-size: 12px; }
  .btn-fulfill { background: transparent; border: 1px solid var(--accent); color: var(--accent); padding: 5px 11px; font-size: 12px; }

  /* ── Stats row ── */
  .stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 14px; margin-bottom: 28px; }
  .stat-card {
    background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); padding: 18px 20px;
  }
  .stat-label { color: var(--text2); font-size: 12px; text-transform: uppercase; letter-spacing: .05em; margin-bottom: 8px; }
  .stat-value { font-size: 28px; font-weight: 700; }
  .stat-value.accent { color: var(--accent); }
  .stat-value.green  { color: var(--green); }
  .stat-value.teal   { color: var(--accent2); }

  /* ── Section ── */
  .section { margin-bottom: 36px; }
  .section-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 16px;
  }
  .section-title { font-size: 16px; font-weight: 700; }
  .badge {
    display: inline-block; padding: 2px 8px; border-radius: 99px; font-size: 11px; font-weight: 600;
  }
  .badge-pending { background: rgba(245,158,11,.15); color: var(--yellow); margin-left: 8px; }
  .badge-active  { background: rgba(34,197,94,.15);  color: var(--green); }
  .badge-revoked { background: rgba(239,68,68,.15);  color: var(--red); }

  /* ── Table ── */
  .table-wrap { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }
  table { width: 100%; border-collapse: collapse; }
  th { padding: 11px 16px; text-align: left; font-size: 11px; text-transform: uppercase; letter-spacing: .05em; color: var(--text2); border-bottom: 1px solid var(--border); background: var(--surface2); }
  td { padding: 13px 16px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(124,106,255,.04); }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: var(--text2); }
  .empty-row td { color: var(--text2); text-align: center; padding: 28px; }

  /* ── Progress bar ── */
  .quota-bar { display: flex; align-items: center; gap: 8px; }
  .bar-track { flex: 1; height: 4px; background: var(--surface2); border-radius: 99px; overflow: hidden; min-width: 60px; }
  .bar-fill  { height: 100%; border-radius: 99px; background: var(--accent); }
  .bar-fill.warn  { background: var(--yellow); }
  .bar-fill.full  { background: var(--red); }
  .bar-text { font-size: 11px; color: var(--text2); white-space: nowrap; }

  /* ── Modal backdrop ── */
  .modal-backdrop {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,.6);
    backdrop-filter: blur(4px); z-index: 200; align-items: center; justify-content: center;
  }
  .modal-backdrop.open { display: flex; }
  .modal {
    background: var(--surface); border: 1px solid var(--border); border-radius: 14px;
    padding: 28px; width: 420px; max-width: 95vw;
  }
  .modal h3 { font-size: 18px; font-weight: 700; margin-bottom: 6px; }
  .modal p  { color: var(--text2); font-size: 13px; margin-bottom: 20px; }
  .form-group { margin-bottom: 14px; }
  .form-group label { display: block; font-size: 12px; color: var(--text2); margin-bottom: 6px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .form-group input, .form-group textarea {
    width: 100%; background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); padding: 10px 14px; border-radius: 8px; font-size: 14px; outline: none;
  }
  .form-group input:focus, .form-group textarea:focus { border-color: var(--accent); }
  .modal-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px; }

  /* ── Key reveal box ── */
  .key-reveal {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 8px; padding: 14px 16px; margin: 16px 0;
    font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px;
    color: var(--accent2); word-break: break-all; line-height: 1.6;
  }
  .copy-success { color: var(--green); font-size: 12px; display: none; margin-top: 6px; }

  /* ── Refresh indicator ── */
  .refresh-hint { color: var(--text2); font-size: 12px; }

  @media (max-width: 900px) {
    .stats { grid-template-columns: repeat(3, 1fr); }
  }
  @media (max-width: 700px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
    main { padding: 16px 14px; }
    .hide-mobile { display: none; }
  }
</style>
</head>
<body>

<!-- ── Login screen ──────────────────────────────────────────────── -->
<div id="login-screen">
  <h1>CTS <span>Admin</span></h1>
  <p>Enter your admin secret to continue</p>
  <input type="password" id="admin-secret-input" placeholder="Admin secret" autocomplete="off"
    onkeydown="if(event.key==='Enter') login()">
  <div id="login-error">Invalid admin secret. Check CTS_ADMIN_SECRET.</div>
  <button class="btn btn-primary" onclick="login()">Sign in</button>
</div>

<!-- ── Dashboard ─────────────────────────────────────────────────── -->
<div id="dashboard" style="display:none">

  <header>
    <div class="logo">CTS <span>Admin</span></div>
    <div class="header-right">
      <span class="refresh-hint" id="last-refreshed">–</span>
      <button class="btn btn-ghost btn-small" onclick="loadDashboard()">↻ Refresh</button>
      <button class="btn btn-ghost btn-small" onclick="logout()">Sign out</button>
    </div>
  </header>

  <main>
    <!-- Stats -->
    <div class="stats">
      <div class="stat-card">
        <div class="stat-label">Total Keys</div>
        <div class="stat-value accent" id="s-total">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Active Keys</div>
        <div class="stat-value green" id="s-active">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">API Calls (24h)</div>
        <div class="stat-value" id="s-calls">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Tokens Saved (total)</div>
        <div class="stat-value teal" id="s-tokens">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Waitlist (pending)</div>
        <div class="stat-value" style="color:var(--yellow)" id="s-waitlist">–</div>
      </div>
    </div>

    <!-- API Keys section -->
    <div class="section">
      <div class="section-header">
        <div class="section-title">API Keys</div>
        <button class="btn btn-primary" onclick="openNewKeyModal()">+ New Key</button>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name / Email</th>
              <th>Created</th>
              <th class="hide-mobile">Quota Usage</th>
              <th>Calls (24h / total)</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="keys-tbody">
            <tr class="empty-row"><td colspan="6">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Waitlist section -->
    <div class="section">
      <div class="section-header">
        <div class="section-title">
          Waitlist
          <span class="badge badge-pending" id="pending-count" style="display:none">0 pending</span>
        </div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Name / Email</th>
              <th>Use Case</th>
              <th>Requested</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="reqs-tbody">
            <tr class="empty-row"><td colspan="5">Loading…</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  </main>
</div>

<!-- ── New Key modal ──────────────────────────────────────────────── -->
<div class="modal-backdrop" id="new-key-modal">
  <div class="modal">
    <h3>Create API Key</h3>
    <p>The raw key will be shown once. Save it before closing.</p>
    <div class="form-group">
      <label>Customer / Company Name</label>
      <input type="text" id="nk-name" placeholder="e.g. Acme Corp" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Email</label>
      <input type="email" id="nk-email" placeholder="user@example.com" autocomplete="off">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeNewKeyModal()">Cancel</button>
      <button class="btn btn-primary" onclick="createKey()" id="create-key-btn">Create Key</button>
    </div>
  </div>
</div>

<!-- ── Key created modal ──────────────────────────────────────────── -->
<div class="modal-backdrop" id="key-created-modal">
  <div class="modal">
    <h3>🎉 Key Created</h3>
    <p>This is the only time the full key is shown. Copy it and send it to the customer.</p>
    <div class="key-reveal" id="created-key-value">–</div>
    <button class="btn btn-ghost btn-small" onclick="copyCreatedKey()">Copy to clipboard</button>
    <div class="copy-success" id="copy-success-msg">✓ Copied!</div>
    <div class="modal-actions">
      <button class="btn btn-primary" onclick="closeKeyCreatedModal()">Done</button>
    </div>
  </div>
</div>

<!-- ── Revoke confirm modal ───────────────────────────────────────── -->
<div class="modal-backdrop" id="revoke-modal">
  <div class="modal">
    <h3>Revoke Key?</h3>
    <p>This immediately blocks all requests from this key. This cannot be undone.</p>
    <div style="background:var(--surface2);border-radius:8px;padding:12px 14px;margin-bottom:4px">
      <div id="revoke-key-name" style="font-weight:600"></div>
      <div id="revoke-key-email" style="color:var(--text2);font-size:12px;margin-top:2px"></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeRevokeModal()">Cancel</button>
      <button class="btn btn-danger" onclick="confirmRevoke()">Yes, Revoke</button>
    </div>
  </div>
</div>

<!-- ── Edit Key modal ───────────────────────────────────────────── -->
<div class="modal-backdrop" id="edit-modal">
  <div class="modal">
    <h3>Edit Quota</h3>
    <p>Adjust the quota limit or usage for this key.</p>
    <div class="form-group">
      <label>Quota Limit</label>
      <input type="number" id="edit-quota-limit" autocomplete="off">
    </div>
    <div class="form-group">
      <label>Quota Used</label>
      <input type="number" id="edit-quota-used" autocomplete="off">
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" onclick="closeEditModal()">Cancel</button>
      <button class="btn btn-primary" onclick="saveEditModal()">Save</button>
    </div>
  </div>
</div>

<script>
  const BASE = '${baseUrl}'
  let adminSecret = ''
  let pendingRevokeId = ''
  let pendingEditId = ''

  // ── Auth ────────────────────────────────────────────────────────────────────

  async function login() {
    const input = document.getElementById('admin-secret-input')
    const secret = input.value.trim()
    if (!secret) return
    // Validate by hitting the dashboard endpoint
    const res = await fetch(BASE + '/admin/dashboard', { headers: { 'X-Admin-Secret': secret } })
    if (!res.ok) {
      document.getElementById('login-error').style.display = 'block'
      return
    }
    adminSecret = secret
    localStorage.setItem('cts_admin_secret', secret)
    showDashboard()
    const data = await res.json()
    renderKeys(data.keys)
    loadRequests()
  }

  function logout() {
    localStorage.removeItem('cts_admin_secret')
    adminSecret = ''
    document.getElementById('dashboard').style.display = 'none'
    document.getElementById('login-screen').style.display = 'flex'
    document.getElementById('admin-secret-input').value = ''
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  window.addEventListener('DOMContentLoaded', async () => {
    const saved = localStorage.getItem('cts_admin_secret')
    if (saved) {
      const res = await fetch(BASE + '/admin/dashboard', { headers: { 'X-Admin-Secret': saved } })
      if (res.ok) {
        adminSecret = saved
        showDashboard()
        const data = await res.json()
        renderKeys(data.keys)
        loadRequests()
        return
      }
      localStorage.removeItem('cts_admin_secret')
    }
  })

  function showDashboard() {
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('dashboard').style.display = 'block'
  }

  // ── Load data ───────────────────────────────────────────────────────────────

  async function loadDashboard() {
    const res = await fetch(BASE + '/admin/dashboard', { headers: { 'X-Admin-Secret': adminSecret } })
    if (!res.ok) return
    const data = await res.json()
    renderKeys(data.keys)
    loadRequests()
    document.getElementById('last-refreshed').textContent = 'Updated ' + new Date().toLocaleTimeString()
  }

  async function loadRequests() {
    const res = await fetch(BASE + '/admin/key-requests', { headers: { 'X-Admin-Secret': adminSecret } })
    if (!res.ok) return
    const data = await res.json()
    renderRequests(data.requests)
  }

  // ── Render keys ─────────────────────────────────────────────────────────────

  function renderKeys(keys) {
    const tbody = document.getElementById('keys-tbody')

    // Update stats
    const active = keys.filter(k => k.active).length
    const calls24h = keys.reduce((s, k) => s + k.last24hCalls, 0)
    const tokens = keys.reduce((s, k) => s + k.totalTokensSaved, 0)
    document.getElementById('s-total').textContent  = keys.length
    document.getElementById('s-active').textContent = active
    document.getElementById('s-calls').textContent  = fmtNum(calls24h)
    document.getElementById('s-tokens').textContent = fmtNum(tokens)

    if (!keys.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="6">No API keys yet. Create the first one above.</td></tr>'
      return
    }

    tbody.innerHTML = keys.map(k => {
      const pct = k.quotaLimit > 0 ? Math.min(100, Math.round(k.quotaUsed / k.quotaLimit * 100)) : 0
      const barClass = pct >= 90 ? 'full' : pct >= 70 ? 'warn' : ''
      const statusBadge = k.active
        ? '<span class="badge badge-active">Active</span>'
        : '<span class="badge badge-revoked">Revoked</span>'
      const revokeBtn = k.active
        ? \`<button class="btn btn-danger" onclick="openRevokeModal('\${k.id}','\${esc(k.name)}','\${esc(k.ownerEmail)}')">Revoke</button>\`
        : '<span style="color:var(--text2);font-size:12px">–</span>'
      const editBtn = \`<button class="btn btn-ghost btn-small" onclick="openEditModal('\${k.id}', \${k.quotaLimit}, \${k.quotaUsed})">Edit</button>\`

      return \`<tr>
        <td>
          <div style="font-weight:600">\${esc(k.name)}</div>
          <div class="mono" style="margin-top:2px">\${esc(k.ownerEmail)}</div>
          <div class="mono" style="margin-top:2px;font-size:11px;color:var(--text2)">\${k.id}</div>
        </td>
        <td style="color:var(--text2);white-space:nowrap">\${fmtDate(k.createdAt)}</td>
        <td class="hide-mobile">
          <div class="quota-bar">
            <div class="bar-track"><div class="bar-fill \${barClass}" style="width:\${pct}%"></div></div>
            <span class="bar-text">\${fmtNum(k.quotaUsed)} / \${fmtNum(k.quotaLimit)}</span>
          </div>
        </td>
        <td>\${k.last24hCalls} <span style="color:var(--text2)">/ \${k.totalCalls}</span></td>
        <td>\${statusBadge}</td>
        <td><div style="display:flex;gap:8px;">\${editBtn}\${revokeBtn}</div></td>
      </tr>\`
    }).join('')
  }

  // ── Render requests ──────────────────────────────────────────────────────────

  function renderRequests(requests) {
    const tbody = document.getElementById('reqs-tbody')
    const pending = requests.filter(r => !r.fulfilledAt)
    const badge = document.getElementById('pending-count')

    // Update waitlist stat card
    document.getElementById('s-waitlist').textContent = pending.length

    if (pending.length > 0) {
      badge.style.display = 'inline-block'
      badge.textContent = pending.length + ' pending'
    } else {
      badge.style.display = 'none'
    }

    if (!requests.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="5">No waitlist entries yet.</td></tr>'
      return
    }

    // Assign position numbers to pending requests (in chronological order)
    let pendingPos = 0
    const posMap = {}
    requests.slice().reverse().forEach(r => {
      if (!r.fulfilledAt) { pendingPos++; posMap[r.id] = pendingPos }
    })

    tbody.innerHTML = requests.map(r => {
      const isPending = !r.fulfilledAt
      const posLabel  = isPending ? \`<span style="color:var(--text2);font-size:11px">#\${posMap[r.id]}</span> \` : ''
      const statusEl  = isPending
        ? '<span class="badge badge-pending">Pending</span>'
        : '<span style="color:var(--text2);font-size:12px">✓ Fulfilled</span>'
      const actionEl  = isPending
        ? \`<button class="btn btn-fulfill" onclick="fulfillRequest(\${r.id}, '\${esc(r.name)}', '\${esc(r.email)}')">Create Key</button>\`
        : '–'

      return \`<tr>
        <td>
          <div style="font-weight:600">\${posLabel}\${esc(r.name)}</div>
          <div class="mono" style="margin-top:2px">\${esc(r.email)}</div>
        </td>
        <td style="max-width:260px;color:var(--text2)">\${esc(r.useCase) || '<em style="opacity:.4">–</em>'}</td>
        <td style="color:var(--text2);white-space:nowrap">\${fmtDate(r.requestedAt)}</td>
        <td>\${statusEl}</td>
        <td>\${actionEl}</td>
      </tr>\`
    }).join('')
  }

  // ── Create key ───────────────────────────────────────────────────────────────

  function openNewKeyModal(prefillName = '', prefillEmail = '') {
    document.getElementById('nk-name').value  = prefillName
    document.getElementById('nk-email').value = prefillEmail
    document.getElementById('new-key-modal').classList.add('open')
    setTimeout(() => document.getElementById('nk-name').focus(), 100)
  }

  function closeNewKeyModal() {
    document.getElementById('new-key-modal').classList.remove('open')
  }

  async function createKey() {
    const name  = document.getElementById('nk-name').value.trim()
    const email = document.getElementById('nk-email').value.trim()
    if (!name || !email) { alert('Name and email are required.'); return }

    const btn = document.getElementById('create-key-btn')
    btn.textContent = 'Creating…'; btn.disabled = true

    const res = await fetch(BASE + '/admin/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ name, ownerEmail: email }),
    })
    btn.textContent = 'Create Key'; btn.disabled = false

    if (!res.ok) { alert('Failed to create key.'); return }
    const data = await res.json()
    closeNewKeyModal()
    showCreatedKey(data.key, data.emailed)
    loadDashboard()
  }

  function showCreatedKey(keyValue, emailed) {
    document.getElementById('created-key-value').textContent = keyValue
    document.getElementById('copy-success-msg').style.display = 'none'
    const statusEl = document.getElementById('email-status-msg') || document.createElement('div')
    statusEl.id = 'email-status-msg'
    statusEl.style.marginTop = '10px'
    statusEl.style.fontSize = '13px'
    statusEl.style.fontWeight = '600'
    statusEl.style.color = emailed ? 'var(--green)' : 'var(--text2)'
    statusEl.innerHTML = emailed ? '✓ Automatically emailed to developer!' : 'Copy this key manually (email automation not configured).'
    
    const revealBox = document.getElementById('created-key-value')
    if (!document.getElementById('email-status-msg')) revealBox.parentNode.insertBefore(statusEl, revealBox)
    
    document.getElementById('key-created-modal').classList.add('open')
  }

  function closeKeyCreatedModal() {
    document.getElementById('key-created-modal').classList.remove('open')
  }

  async function copyCreatedKey() {
    const key = document.getElementById('created-key-value').textContent
    await navigator.clipboard.writeText(key)
    document.getElementById('copy-success-msg').style.display = 'block'
  }

  // ── Revoke ───────────────────────────────────────────────────────────────────

  function openRevokeModal(id, name, email) {
    pendingRevokeId = id
    document.getElementById('revoke-key-name').textContent  = name
    document.getElementById('revoke-key-email').textContent = email
    document.getElementById('revoke-modal').classList.add('open')
  }

  function closeRevokeModal() {
    pendingRevokeId = ''
    document.getElementById('revoke-modal').classList.remove('open')
  }

  async function confirmRevoke() {
    if (!pendingRevokeId) return
    const res = await fetch(BASE + '/admin/keys/' + pendingRevokeId, {
      method: 'DELETE',
      headers: { 'X-Admin-Secret': adminSecret },
    })
    closeRevokeModal()
    if (res.ok) loadDashboard()
    else alert('Failed to revoke key.')
  }

  // ── Edit Quota ─────────────────────────────────────────────────────────────

  function openEditModal(id, limit, used) {
    pendingEditId = id
    document.getElementById('edit-quota-limit').value = limit
    document.getElementById('edit-quota-used').value = used
    document.getElementById('edit-modal').classList.add('open')
  }

  function closeEditModal() {
    pendingEditId = ''
    document.getElementById('edit-modal').classList.remove('open')
  }

  async function saveEditModal() {
    if (!pendingEditId) return
    const limit = Number(document.getElementById('edit-quota-limit').value)
    const used = Number(document.getElementById('edit-quota-used').value)

    const btn = event.target
    const originalText = btn.textContent
    btn.textContent = 'Saving...'
    btn.disabled = true

    const res = await fetch(BASE + '/admin/keys/' + pendingEditId, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': adminSecret },
      body: JSON.stringify({ quotaLimit: limit, quotaUsed: used }),
    })

    btn.textContent = originalText
    btn.disabled = false

    closeEditModal()
    if (res.ok) loadDashboard()
    else alert('Failed to update quota.')
  }

  // ── Fulfill request (creates key for that person) ───────────────────────────

  async function fulfillRequest(id, name, email) {
    // First mark as fulfilled
    await fetch(BASE + '/admin/key-requests/' + id + '/fulfill', {
      method: 'POST',
      headers: { 'X-Admin-Secret': adminSecret },
    })
    // Then open the create-key modal pre-filled with their info
    openNewKeyModal(name, email)
    loadRequests()
  }

  // ── Close modals on backdrop click ──────────────────────────────────────────

  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        backdrop.classList.remove('open')
        pendingRevokeId = ''
        pendingEditId = ''
      }
    })
  })

  // ── Helpers ──────────────────────────────────────────────────────────────────

  function fmtDate(iso) {
    if (!iso) return '–'
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  }

  function fmtNum(n) {
    if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M'
    if (n >= 1_000)     return (n / 1_000).toFixed(1) + 'k'
    return String(n)
  }

  function esc(str) {
    return String(str ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))
  }
</script>
</body>
</html>`
}
