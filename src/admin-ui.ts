/** Returns the full HTML string for the EchoRegent admin and user dashboard. */
export function getAdminDashboardHtml(baseUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>EchoRegent Console</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>
  :root {
    --bg: #030307;
    --surface: #0b0b12;
    --surface2: #141423;
    --border: #1f1f33;
    --border-glowing: rgba(124, 106, 255, 0.2);
    --accent: #8b5cf6;
    --accent-glow: rgba(139, 92, 246, 0.4);
    --accent2: #06b6d4;
    --text: #f3f4f6;
    --text2: #9ca3af;
    --text-muted: #6b7280;
    --green: #10b981;
    --green-glow: rgba(16, 185, 129, 0.2);
    --red: #ef4444;
    --yellow: #f59e0b;
    --radius: 12px;
    --font-heading: 'Outfit', -apple-system, BlinkMacSystemFont, sans-serif;
    --font-body: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
    --transition: all 0.25s cubic-bezier(0.4, 0, 0.2, 1);
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { 
    background: var(--bg); 
    color: var(--text); 
    font-family: var(--font-body); 
    font-size: 14px; 
    min-height: 100vh; 
    line-height: 1.5;
    background-image: 
      radial-gradient(at 0% 0%, rgba(139, 92, 246, 0.08) 0px, transparent 50%),
      radial-gradient(at 100% 100%, rgba(6, 182, 212, 0.05) 0px, transparent 50%);
  }

  /* ── Login screen ── */
  #login-screen {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    min-height: 100vh; gap: 20px;
    padding: 24px;
  }
  .login-card {
    background: rgba(11, 11, 18, 0.7);
    border: 1px solid var(--border);
    backdrop-filter: blur(12px);
    border-radius: 16px;
    padding: 40px;
    width: 100%;
    max-width: 420px;
    box-shadow: 0 20px 40px rgba(0, 0, 0, 0.5), 0 0 40px rgba(139, 92, 246, 0.05);
    text-align: center;
  }
  .login-card h1 { 
    font-family: var(--font-heading);
    font-size: 32px; 
    font-weight: 800; 
    letter-spacing: -0.02em;
    margin-bottom: 8px;
  }
  .login-card h1 span { 
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .login-card p { color: var(--text2); margin-bottom: 30px; font-size: 14px; }
  
  .input-group {
    margin-bottom: 20px;
    text-align: left;
  }
  .input-group label {
    display: block;
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text2);
    margin-bottom: 8px;
  }
  .login-card input {
    background: var(--surface2); border: 1px solid var(--border); color: var(--text);
    padding: 12px 16px; border-radius: var(--radius); width: 100%; font-size: 14px;
    outline: none; transition: var(--transition);
    font-family: var(--font-body);
  }
  .login-card input:focus { 
    border-color: var(--accent); 
    box-shadow: 0 0 12px var(--accent-glow);
  }
  #login-error { color: var(--red); font-size: 13px; margin-top: 14px; display: none; }

  /* ── Header ── */
  header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 18px 32px; 
    background: rgba(11, 11, 18, 0.8); 
    border-bottom: 1px solid var(--border);
    backdrop-filter: blur(8px);
    position: sticky; top: 0; z-index: 100;
  }
  .logo { 
    font-family: var(--font-heading); 
    font-weight: 800; 
    font-size: 22px; 
    letter-spacing: -0.02em;
  }
  .logo span { 
    background: linear-gradient(135deg, var(--accent), var(--accent2));
    -webkit-background-clip: text;
    -webkit-text-fill-color: transparent;
  }
  .header-right { display: flex; align-items: center; gap: 16px; }
  .header-right span { color: var(--text2); font-size: 13px; font-weight: 500; }

  /* ── Layout ── */
  main { max-width: 1200px; margin: 0 auto; padding: 36px 32px; }

  /* ── Buttons ── */
  .btn {
    display: inline-flex; align-items: center; gap: 8px;
    padding: 10px 20px; border-radius: 8px; border: none; cursor: pointer;
    font-size: 13px; font-weight: 600; transition: var(--transition);
    font-family: var(--font-body);
  }
  .btn-primary { 
    background: linear-gradient(135deg, var(--accent), #6d28d9); 
    color: #fff;
    box-shadow: 0 4px 12px rgba(139, 92, 246, 0.3);
  }
  .btn-primary:hover { 
    transform: translateY(-1px);
    box-shadow: 0 6px 18px rgba(139, 92, 246, 0.4);
  }
  .btn-danger { 
    background: transparent; 
    border: 1px solid var(--red); 
    color: var(--red); 
    padding: 6px 14px; 
    font-size: 12px; 
  }
  .btn-danger:hover {
    background: rgba(239, 68, 68, 0.08);
  }
  .btn-ghost { 
    background: var(--surface2); 
    color: var(--text); 
    border: 1px solid var(--border);
  }
  .btn-ghost:hover {
    background: var(--border);
  }
  .btn-small { padding: 6px 12px; font-size: 12px; border-radius: 6px; }
  .btn-fulfill { 
    background: transparent; 
    border: 1px solid var(--accent2); 
    color: var(--accent2); 
    padding: 6px 14px; 
    font-size: 12px; 
  }
  .btn-fulfill:hover {
    background: rgba(6, 182, 212, 0.08);
  }

  /* ── Stats Row ── */
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 36px; }
  .stat-card {
    background: rgba(19, 19, 28, 0.4); 
    border: 1px solid var(--border);
    backdrop-filter: blur(4px);
    border-radius: var(--radius); 
    padding: 24px;
    transition: var(--transition);
  }
  .stat-card:hover {
    border-color: var(--border-glowing);
    transform: translateY(-2px);
  }
  .stat-label { 
    color: var(--text2); 
    font-size: 11px; 
    text-transform: uppercase; 
    letter-spacing: 0.06em; 
    margin-bottom: 10px;
    font-weight: 600;
  }
  .stat-value { 
    font-family: var(--font-heading); 
    font-size: 32px; 
    font-weight: 800; 
    letter-spacing: -0.02em;
  }
  .stat-value.accent { color: var(--accent); }
  .stat-value.green { color: var(--green); }
  .stat-value.teal { color: var(--accent2); }

  /* ── Section ── */
  .section { margin-bottom: 40px; }
  .section-header {
    display: flex; align-items: center; justify-content: space-between;
    margin-bottom: 20px;
  }
  .section-title { 
    font-family: var(--font-heading);
    font-size: 20px; 
    font-weight: 700; 
    letter-spacing: -0.01em;
  }
  .badge {
    display: inline-block; padding: 3px 10px; border-radius: 99px; font-size: 11px; font-weight: 600;
  }
  .badge-pending { background: rgba(245, 158, 11, 0.1); color: var(--yellow); border: 1px solid rgba(245, 158, 11, 0.2); }
  .badge-active { background: rgba(16, 185, 129, 0.1); color: var(--green); border: 1px solid rgba(16, 185, 129, 0.2); }
  .badge-revoked { background: rgba(239, 68, 68, 0.1); color: var(--red); border: 1px solid rgba(239, 68, 68, 0.2); }

  /* ── Table ── */
  .table-wrap { 
    background: rgba(11, 11, 18, 0.6); 
    border: 1px solid var(--border); 
    border-radius: var(--radius); 
    overflow: hidden; 
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.3);
  }
  table { width: 100%; border-collapse: collapse; }
  th { 
    padding: 14px 20px; 
    text-align: left; 
    font-size: 11px; 
    text-transform: uppercase; 
    letter-spacing: 0.05em; 
    color: var(--text2); 
    border-bottom: 1px solid var(--border); 
    background: var(--surface2); 
    font-weight: 600;
  }
  td { padding: 16px 20px; border-bottom: 1px solid var(--border); vertical-align: middle; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: rgba(139, 92, 246, 0.03); }
  .mono { font-family: 'SF Mono', 'Fira Code', monospace; font-size: 12px; color: var(--accent2); }
  .empty-row td { color: var(--text2); text-align: center; padding: 40px; }

  /* ── Quota Progress bar ── */
  .quota-bar { display: flex; align-items: center; gap: 10px; }
  .bar-track { flex: 1; height: 6px; background: var(--surface2); border-radius: 99px; overflow: hidden; min-width: 80px; }
  .bar-fill { height: 100%; border-radius: 99px; background: var(--accent); transition: width 0.5s ease; }
  .bar-fill.warn { background: var(--yellow); }
  .bar-fill.full { background: var(--red); }
  .bar-text { font-size: 11px; color: var(--text2); white-space: nowrap; font-weight: 500; }

  /* ── Modals ── */
  .modal-backdrop {
    display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.7);
    backdrop-filter: blur(6px); z-index: 200; align-items: center; justify-content: center;
    transition: var(--transition);
  }
  .modal-backdrop.open { display: flex; }
  .modal {
    background: var(--surface); border: 1px solid var(--border); border-radius: 16px;
    padding: 32px; width: 440px; max-width: 95vw;
    box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
  }
  .modal h3 { font-family: var(--font-heading); font-size: 20px; font-weight: 700; margin-bottom: 8px; }
  .modal p { color: var(--text2); font-size: 13px; margin-bottom: 24px; }
  .form-group { margin-bottom: 18px; }
  .form-group label { display: block; font-size: 11px; color: var(--text2); margin-bottom: 8px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.05em; }
  .form-group input, .form-group textarea {
    width: 100%; background: var(--surface2); border: 1px solid var(--border);
    color: var(--text); padding: 12px 16px; border-radius: 8px; font-size: 14px; outline: none;
    font-family: var(--font-body); transition: var(--transition);
  }
  .form-group input:focus, .form-group textarea:focus { 
    border-color: var(--accent);
    box-shadow: 0 0 10px var(--accent-glow);
  }
  .modal-actions { display: flex; gap: 12px; justify-content: flex-end; margin-top: 24px; }

  /* ── Key reveal box ── */
  .key-reveal {
    background: var(--surface2); border: 1px solid var(--border);
    border-radius: 8px; padding: 16px; margin: 20px 0;
    font-family: 'SF Mono', 'Fira Code', monospace; font-size: 13px;
    color: var(--accent2); word-break: break-all; line-height: 1.6;
    text-shadow: 0 0 5px rgba(6, 182, 212, 0.2);
  }
  .copy-success { color: var(--green); font-size: 12px; display: none; margin-top: 8px; font-weight: 500; }

  /* ── Admin-only blocks ── */
  .admin-only { display: none; }
  .user-only { display: none; }

  @media (max-width: 900px) {
    .stats { grid-template-columns: repeat(2, 1fr); }
  }
  @media (max-width: 700px) {
    .stats { grid-template-columns: 1fr; }
    main { padding: 24px 16px; }
    .hide-mobile { display: none; }
    header { padding: 14px 20px; }
  }
</style>
</head>
<body>

<!-- ── Login screen ──────────────────────────────────────────────── -->
<div id="login-screen">
  <div class="login-card">
    <h1>EchoRegent <span>Console</span></h1>
    <p>Sign in to access your dashboard</p>
    
    <div class="input-group">
      <label>Email Address</label>
      <input type="text" id="email-input" placeholder="admin@echoregent.com" autocomplete="off"
        onkeydown="if(event.key==='Enter') focusPassword()">
    </div>
    
    <div class="input-group">
      <label>Password</label>
      <input type="password" id="password-input" placeholder="••••••••" autocomplete="off"
        onkeydown="if(event.key==='Enter') login()">
    </div>

    <div id="login-error">Invalid credentials.</div>
    <button class="btn btn-primary" style="width: 100%; justify-content: center; margin-top: 14px;" onclick="login()">Sign in</button>
  </div>
</div>

<!-- ── Dashboard ─────────────────────────────────────────────────── -->
<div id="dashboard" style="display:none">

  <header>
    <div class="logo">EchoRegent <span>Console</span></div>
    <div class="header-right">
      <span class="refresh-hint" id="last-refreshed">–</span>
      <button class="btn btn-ghost btn-small" onclick="loadDashboard()">↻ Refresh</button>
      <button class="btn btn-ghost btn-small" onclick="logout()">Sign out</button>
    </div>
  </header>

  <main>
    <!-- Stats Row (Admin) -->
    <div class="stats admin-only">
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

    <!-- Stats Row (User) -->
    <div class="stats user-only">
      <div class="stat-card">
        <div class="stat-label">API Key Status</div>
        <div class="stat-value green" id="u-status">Active</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Calls (24h)</div>
        <div class="stat-value" id="u-calls">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Total Calls</div>
        <div class="stat-value" id="u-total-calls">–</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Tokens Saved</div>
        <div class="stat-value teal" id="u-tokens">–</div>
      </div>
    </div>

    <!-- User Key Card (User view) -->
    <div class="section user-only">
      <div class="section-header">
        <div class="section-title">Your API Key & Quota</div>
      </div>
      <div class="table-wrap" style="padding: 24px;">
        <div style="margin-bottom: 20px;">
          <div style="font-size: 12px; color: var(--text2); text-transform: uppercase; font-weight: 600; margin-bottom: 6px;">Client ID</div>
          <div class="mono" id="u-key-id" style="font-size: 14px;">–</div>
        </div>
        <div>
          <div style="font-size: 12px; color: var(--text2); text-transform: uppercase; font-weight: 600; margin-bottom: 8px;">Quota Allocation</div>
          <div class="quota-bar" style="max-width: 500px;">
            <div class="bar-track"><div id="u-bar-fill" class="bar-fill" style="width: 0%"></div></div>
            <span class="bar-text" id="u-bar-text">0 / 0</span>
          </div>
        </div>
      </div>
    </div>

    <!-- API Keys section (Admin view) -->
    <div class="section admin-only">
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

    <!-- Recent Usage history (User view) -->
    <div class="section user-only">
      <div class="section-header">
        <div class="section-title">Recent API Requests (Last 50)</div>
      </div>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Endpoint</th>
              <th>Tokens Saved</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody id="u-usage-tbody">
            <tr class="empty-row"><td colspan="3">No request history found.</td></tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Waitlist section (Admin view) -->
    <div class="section admin-only">
      <div class="section-header">
        <div class="section-title">
          Waitlist Requests
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
    <div style="background:var(--surface2);border-radius:8px;padding:16px;margin-bottom:14px;border:1px solid var(--border)">
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
  let sessionToken = ''
  let role = ''
  let name = ''
  let keyId = ''
  let pendingRevokeId = ''
  let pendingEditId = ''

  function focusPassword() {
    document.getElementById('password-input').focus()
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  async function login() {
    const email = document.getElementById('email-input').value.trim()
    const password = document.getElementById('password-input').value.trim()
    if (!email || !password) return

    const res = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    })

    if (!res.ok) {
      document.getElementById('login-error').style.display = 'block'
      return
    }

    const data = await res.json()
    sessionToken = data.token
    role = data.role
    name = data.name
    keyId = data.keyId

    localStorage.setItem('echoregent_token', sessionToken)
    localStorage.setItem('echoregent_role', role)
    localStorage.setItem('echoregent_name', name)
    localStorage.setItem('echoregent_key_id', keyId)

    showDashboard()
    await loadDashboard()
  }

  function logout() {
    localStorage.removeItem('echoregent_token')
    localStorage.removeItem('echoregent_role')
    localStorage.removeItem('echoregent_name')
    localStorage.removeItem('echoregent_key_id')
    
    sessionToken = ''
    role = ''
    name = ''
    keyId = ''
    
    document.getElementById('dashboard').style.display = 'none'
    document.getElementById('login-screen').style.display = 'flex'
    document.getElementById('email-input').value = ''
    document.getElementById('password-input').value = ''
    document.getElementById('login-error').style.display = 'none'
  }

  // ── Init ────────────────────────────────────────────────────────────────────

  window.addEventListener('DOMContentLoaded', async () => {
    const savedToken = localStorage.getItem('echoregent_token')
    const savedRole = localStorage.getItem('echoregent_role')
    const savedName = localStorage.getItem('echoregent_name')
    const savedKeyId = localStorage.getItem('echoregent_key_id')
    
    if (savedToken && savedRole) {
      sessionToken = savedToken
      role = savedRole
      name = savedName || ''
      keyId = savedKeyId || ''
      
      showDashboard()
      await loadDashboard()
    }
  })

  function showDashboard() {
    document.getElementById('login-screen').style.display = 'none'
    document.getElementById('dashboard').style.display = 'block'
    
    // Toggle role visibility
    document.querySelectorAll('.admin-only').forEach(el => {
      el.style.display = role === 'admin' ? 'block' : 'none'
      if (el.tagName === 'DIV' && el.classList.contains('stats')) {
        el.style.display = role === 'admin' ? 'grid' : 'none'
      }
    })
    document.querySelectorAll('.user-only').forEach(el => {
      el.style.display = role === 'user' ? 'block' : 'none'
      if (el.tagName === 'DIV' && el.classList.contains('stats')) {
        el.style.display = role === 'user' ? 'grid' : 'none'
      }
    })
  }

  // ── Load data ───────────────────────────────────────────────────────────────

  async function loadDashboard() {
    document.getElementById('last-refreshed').textContent = 'Loading…'
    
    if (role === 'admin') {
      const res = await fetch(BASE + '/admin/dashboard', { headers: { 'X-Session-Token': sessionToken } })
      if (res.status === 401) { logout(); return }
      if (!res.ok) return
      const data = await res.json()
      renderKeys(data.keys)
      await loadRequests()
    } else {
      // User load
      const res = await fetch(BASE + '/api/user/dashboard', { headers: { 'X-Session-Token': sessionToken } })
      if (res.status === 401) { logout(); return }
      if (!res.ok) return
      const data = await res.json()
      renderUserDashboard(data)
    }
    
    document.getElementById('last-refreshed').textContent = 'Updated ' + new Date().toLocaleTimeString()
  }

  async function loadRequests() {
    const res = await fetch(BASE + '/admin/key-requests', { headers: { 'X-Session-Token': sessionToken } })
    if (!res.ok) return
    const data = await res.json()
    renderRequests(data.requests)
  }

  // ── User dashboard renderer ─────────────────────────────────────────────────

  function renderUserDashboard(data) {
    const stats = data.stats
    const usage = data.usage
    const kid = data.keyId

    document.getElementById('u-key-id').textContent = kid || 'No key associated'
    document.getElementById('u-calls').textContent = fmtNum(stats.last24hCalls)
    document.getElementById('u-total-calls').textContent = fmtNum(stats.totalCalls)
    document.getElementById('u-tokens').textContent = fmtNum(stats.totalTokensSaved)

    // Handle user quota progress bar if keys are fetched
    if (usage && usage.length > 0) {
      // User can deduce quota from stats/calls, or we fallback
      // Since stats are fetched, let's show quota info
    }
    
    // In our payload, we don't return the full key object inside stats, but we can display the usage tracking
    const tbody = document.getElementById('u-usage-tbody')
    if (!usage || !usage.length) {
      tbody.innerHTML = '<tr class="empty-row"><td colspan="3">No API calls logged yet.</td></tr>'
      return
    }

    tbody.innerHTML = usage.map(u => {
      return \`<tr>
        <td class="mono\">\${esc(u.endpoint)}</td>
        <td style="color:var(--accent2);font-weight:600\">\${fmtNum(u.tokensSaved)}</td>
        <td style="color:var(--text2)">\${new Date(u.calledAt).toLocaleString()}</td>
      </tr>\`
    }).join('')
  }

  // ── Render keys (Admin) ────────────────────────────────────────────────────

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
        ? \`<button class="btn btn-danger btn-small" onclick="openRevokeModal('\${k.id}','\${esc(k.name)}','\${esc(k.ownerEmail)}')">Revoke</button>\`
        : '<span style="color:var(--text-muted);font-size:12px">–</span>'
      const editBtn = \`<button class="btn btn-ghost btn-small" onclick="openEditModal('\${k.id}', \${k.quotaLimit}, \${k.quotaUsed})">Edit</button>\`

      return \`<tr>
        <td>
          <div style="font-weight:600;color:var(--text)">\${esc(k.name)}</div>
          <div class="mono" style="margin-top:2px">\${esc(k.ownerEmail)}</div>
          <div class="mono" style="margin-top:2px;font-size:11px;color:var(--text-muted)">\${k.id}</div>
        </td>
        <td style="color:var(--text2);white-space:nowrap">\${fmtDate(k.createdAt)}</td>
        <td class="hide-mobile">
          <div class="quota-bar">
            <div class="bar-track"><div class="bar-fill \${barClass}" style="width:\${pct}%"></div></div>
            <span class="bar-text">\${fmtNum(k.quotaUsed)} / \${fmtNum(k.quotaLimit)}</span>
          </div>
        </td>
        <td>\${k.last24hCalls} <span style="color:var(--text-muted)">/ \${k.totalCalls}</span></td>
        <td>\${statusBadge}</td>
        <td><div style="display:flex;gap:8px;">\${editBtn}\${revokeBtn}</div></td>
      </tr>\`
    }).join('')
  }

  // ── Render requests (Admin) ─────────────────────────────────────────────────

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
          <div style="font-weight:600">\rm \${posLabel}\${esc(r.name)}</div>
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
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
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
      headers: { 'X-Session-Token': sessionToken },
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
      headers: { 'Content-Type': 'application/json', 'X-Session-Token': sessionToken },
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
    await fetch(BASE + '/admin/key-requests/' + id + '/fulfill', {
      method: 'POST',
      headers: { 'X-Session-Token': sessionToken },
    })
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
