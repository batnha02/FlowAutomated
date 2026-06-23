'use strict';

/* ═══════════════════════════ CONSTANTS ═══════════════════════════════════════ */

const ACTION_TYPES = {
  left_click:          { label: 'Left Click',           group: 'Windows GUI',          targetLabel: 'Coordinates (x,y)',              valueLabel: '',                            badgeClass: 'ab-gui',      coordPicker: true  },
  right_click:         { label: 'Right Click',          group: 'Windows GUI',          targetLabel: 'Coordinates (x,y)',              valueLabel: '',                            badgeClass: 'ab-gui',      coordPicker: true  },
  double_click:        { label: 'Double Click',         group: 'Windows GUI',          targetLabel: 'Coordinates (x,y)',              valueLabel: '',                            badgeClass: 'ab-gui',      coordPicker: true  },
  keyboard_input:      { label: 'Keyboard Input',       group: 'Windows GUI',          targetLabel: 'Window Title (optional)',        valueLabel: 'Text to Type',                badgeClass: 'ab-keyboard', coordPicker: false },
  open_app:            { label: 'Open App',             group: 'Windows GUI',          targetLabel: 'App Path / Command',            valueLabel: '',                            badgeClass: 'ab-gui',      coordPicker: false },
  hot_key:             { label: 'Hot Key',              group: 'Windows GUI',          targetLabel: 'Key Combination (e.g. ctrl+c)', valueLabel: 'Window Title (optional)',     badgeClass: 'ab-keyboard', coordPicker: false },
  close_app:           { label: 'Close App',            group: 'Windows GUI',          targetLabel: 'App Name or Window Title',       valueLabel: '',                            badgeClass: 'ab-gui',      coordPicker: false },
  move_window:         { label: 'Move Window',          group: 'Windows GUI',          targetLabel: 'Coordinates (x,y)',              valueLabel: 'Window Title (optional)',     badgeClass: 'ab-gui',      coordPicker: true  },
  browser_click:       { label: 'Browser: Click',       group: 'Browser (Playwright)', targetLabel: 'CSS Selector / XPath',          valueLabel: '',                            badgeClass: 'ab-browser',  coordPicker: false },
  browser_type:        { label: 'Browser: Type',        group: 'Browser (Playwright)', targetLabel: 'CSS Selector / XPath',          valueLabel: 'Text to Type',                badgeClass: 'ab-browser',  coordPicker: false },
  browser_navigate:    { label: 'Browser: Navigate',    group: 'Browser (Playwright)', targetLabel: 'URL',                           valueLabel: '',                            badgeClass: 'ab-browser',  coordPicker: false },
  browser_wait:        { label: 'Browser: Wait',        group: 'Browser (Playwright)', targetLabel: 'CSS Selector / XPath',          valueLabel: 'Timeout (ms)',                badgeClass: 'ab-browser',  coordPicker: false },
  browser_screenshot:  { label: 'Browser: Screenshot',  group: 'Browser (Playwright)', targetLabel: 'File Path to Save',             valueLabel: '',                            badgeClass: 'ab-browser',  coordPicker: false },
  delay:               { label: 'Delay',                group: 'Utility',              targetLabel: '',                              valueLabel: 'Duration (ms)',               badgeClass: 'ab-delay',    coordPicker: false },
};

const ACTION_GROUPS = ['Windows GUI', 'Browser (Playwright)', 'Utility'];

const WS_PROTO = location.protocol === 'https:' ? 'wss:' : 'ws:';

/* ═══════════════════════════ STATE ═══════════════════════════════════════════ */

const S = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  wf: { name: 'Untitled Workflow', description: '', steps: [] },
  wfId: null,
  wfOwner: true,
  execStates: {},   // { [index]: { status, error } }
  logs: [],
  running: false,
  ws: null,
  dashTab: 'mine',
  dashSearch: '',
  _allWorkflows: [],
  _stepEditIndex: null,
  _savePublic: false,
  // Local agent execution mode
  localMode: localStorage.getItem('localMode') === '1',
  agentPort: parseInt(localStorage.getItem('agentPort') || '8001', 10),
};

/* ═══════════════════════════ UTILITIES ═══════════════════════════════════════ */

function uuid() { return crypto.randomUUID(); }

/**
 * Nếu user paste raw HTML element (copy từ F12 DevTools),
 * trả về CSS selector phù hợp nhất. Trả về null nếu không phải HTML.
 */
function htmlToSelector(raw) {
  const t = raw.trim();
  if (!t.startsWith('<')) return null;

  const tagM = t.match(/^<(\w+)/);
  const tag = tagM ? tagM[1].toLowerCase() : '';

  // id → #id (chính xác nhất)
  const idM = t.match(/\bid=["']([^"']+)['"]/);
  if (idM) return `#${idM[1]}`;

  // class → tag.class1.class2
  const clsM = t.match(/\bclass=["']([^"']+)['"]/);
  if (clsM) {
    const classes = clsM[1].trim().split(/\s+/).join('.');
    return tag ? `${tag}.${classes}` : `.${classes}`;
  }

  // text content → text=Sign In
  const textM = t.match(/>([^<]+)</);
  if (textM) {
    const text = textM[1].trim();
    if (text) return `text=${text}`;
  }

  return null;
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmtDate(s) {
  return new Date(s).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function toast(msg, type = 'success') {
  const root = document.getElementById('toast-root');
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  root.appendChild(t);
  setTimeout(() => {
    t.classList.add('toast-out');
    setTimeout(() => t.remove(), 280);
  }, 2800);
}

/* ═══════════════════════════ API ═════════════════════════════════════════════ */

async function api(method, path, body) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (S.token) opts.headers['Authorization'] = 'Bearer ' + S.token;
  if (body !== undefined) opts.body = JSON.stringify(body);
  const res = await fetch('/api' + path, opts);
  if (res.status === 401) { doLogout(); return null; }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || `HTTP ${res.status}`);
  return data;
}

/* ═══════════════════════════ AUTH ════════════════════════════════════════════ */

function setAuth(user, token) {
  S.user = user; S.token = token;
  localStorage.setItem('user', JSON.stringify(user));
  localStorage.setItem('token', token);
}

function doLogout() {
  S.user = null; S.token = null;
  localStorage.removeItem('user'); localStorage.removeItem('token');
  navigate('/login');
}

/* ═══════════════════════════ ROUTER ══════════════════════════════════════════ */

function navigate(path) { location.hash = '#' + path; }

function router() {
  if (S.ws) { S.ws.close(); S.ws = null; S.running = false; }
  const path = (location.hash.slice(1) || '/').replace(/\/$/, '') || '/';
  if (!S.token) { renderLogin(); return; }
  if (path === '/' || path === '/dashboard') { renderDashboard(); return; }
  if (path === '/workflow/new') { renderEditor(null); return; }
  if (path.startsWith('/workflow/')) { renderEditor(path.split('/')[2]); return; }
  if (path === '/admin') { S.user?.isAdmin ? renderAdmin() : navigate('/dashboard'); return; }
  navigate('/dashboard');
}

window.addEventListener('hashchange', router);
window.addEventListener('DOMContentLoaded', router);

/* ═══════════════════════════ LAYOUT ══════════════════════════════════════════ */

function renderLayout(innerHtml) {
  const hash = location.hash.slice(1);
  document.getElementById('app').innerHTML = `
    <div class="layout">
      <nav class="sidebar">
        <div class="sidebar-brand"><span class="brand-icon">⚡</span><span class="brand-name">AutoStep</span></div>
        <div class="sidebar-user">
          <span class="sidebar-username">${esc(S.user?.username)}</span>
          ${S.user?.isAdmin ? '<span class="badge-admin">Admin</span>' : ''}
        </div>
        <div class="sidebar-nav">
          <button class="nav-link ${hash === '/dashboard' || hash === '/' ? 'active' : ''}" onclick="navigate('/dashboard')">📋 Dashboard</button>
          <button class="nav-link" onclick="navigate('/workflow/new')">➕ New Workflow</button>
          ${S.user?.isAdmin ? `<button class="nav-link ${hash === '/admin' ? 'active' : ''}" onclick="navigate('/admin')">🛡 Users</button>` : ''}
        </div>
        <div class="sidebar-footer">
          <button class="btn-logout" onclick="doLogout()">🚪 Logout</button>
        </div>
      </nav>
      <main class="main-content">${innerHtml}</main>
    </div>`;
}

/* ═══════════════════════════ LOGIN PAGE ══════════════════════════════════════ */

function renderLogin() {
  document.getElementById('app').innerHTML = `
    <div class="login-page">
      <div class="login-box">
        <div class="login-brand">
          <div class="login-brand-icon">⚡</div>
          <h1>AutoStep</h1>
          <p>Automation Workflow Manager</p>
        </div>
        <div class="login-form">
          <div class="form-group">
            <label class="form-label" for="l-user">Username</label>
            <input class="input" id="l-user" type="text" placeholder="Enter username" autocomplete="username" />
          </div>
          <div class="form-group">
            <label class="form-label" for="l-pass">Password</label>
            <input class="input" id="l-pass" type="password" placeholder="Enter password" autocomplete="current-password" />
          </div>
          <button class="btn btn-primary" style="width:100%;padding:10px" onclick="doLogin()">Sign In</button>
        </div>
        <p class="login-hint">Default: admin / 123456</p>
      </div>
    </div>`;
  document.getElementById('l-user').focus();
  document.getElementById('l-pass').addEventListener('keydown', e => e.key === 'Enter' && doLogin());
  document.getElementById('l-user').addEventListener('keydown', e => e.key === 'Enter' && document.getElementById('l-pass').focus());
}

async function doLogin() {
  const username = document.getElementById('l-user').value.trim();
  const password = document.getElementById('l-pass').value;
  if (!username || !password) { toast('Please enter username and password', 'error'); return; }
  try {
    const data = await api('POST', '/auth/login', { username, password });
    if (!data) return;
    setAuth(data.user, data.token);
    navigate('/dashboard');
  } catch (e) { toast(e.message, 'error'); }
}

/* ═══════════════════════════ DASHBOARD PAGE ══════════════════════════════════ */

function renderDashboard() {
  renderLayout(`
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">Workflows</div>
          <div class="page-subtitle">Manage and run your automation workflows</div>
        </div>
        <div class="page-actions">
          <button class="btn btn-secondary" onclick="loadDashboard()">↺ Refresh</button>
          <button class="btn btn-primary" onclick="navigate('/workflow/new')">＋ New Workflow</button>
        </div>
      </div>
      <div class="search-row">
        <div class="tabs">
          <button class="tab ${S.dashTab === 'mine' ? 'active' : ''}" onclick="switchTab('mine')">My Workflows</button>
          <button class="tab ${S.dashTab === 'community' ? 'active' : ''}" onclick="switchTab('community')">Community</button>
        </div>
        <div class="search-wrap">
          <span class="search-icon">🔍</span>
          <input class="input" style="width:220px" placeholder="Search..." value="${esc(S.dashSearch)}"
            oninput="S.dashSearch=this.value;renderWfList()" />
        </div>
      </div>
      <div id="wf-list"><div class="loading">Loading...</div></div>
    </div>`);
  loadDashboard();
}

async function loadDashboard() {
  try {
    S._allWorkflows = await api('GET', '/workflows') || [];
    renderWfList();
  } catch (e) { toast(e.message, 'error'); }
}

function switchTab(tab) {
  S.dashTab = tab;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.textContent.trim().toLowerCase().startsWith(tab)));
  renderWfList();
}

function renderWfList() {
  const mine = S._allWorkflows.filter(w => w.ownerId === S.user.id);
  const comm = S._allWorkflows.filter(w => w.ownerId !== S.user.id && w.isPublic);
  const list = (S.dashTab === 'mine' ? mine : comm)
    .filter(w => !S.dashSearch || w.name.toLowerCase().includes(S.dashSearch.toLowerCase()));

  // Update tab counts
  const tabs = document.querySelectorAll('.tab');
  if (tabs[0]) tabs[0].textContent = `My Workflows (${mine.length})`;
  if (tabs[1]) tabs[1].textContent = `Community (${comm.length})`;

  const el = document.getElementById('wf-list');
  if (!el) return;
  if (list.length === 0) {
    el.innerHTML = `<div class="empty-state">
      <div class="empty-icon">📋</div>
      <p>${S.dashTab === 'mine' ? 'No workflows yet.' : 'No public workflows from colleagues yet.'}</p>
      ${S.dashTab === 'mine' ? '<button class="btn btn-primary" style="margin-top:12px" onclick="navigate(\'/workflow/new\')">＋ Create Workflow</button>' : ''}
    </div>`;
    return;
  }
  el.innerHTML = `<div class="wf-grid">${list.map(wf => wfCard(wf)).join('')}</div>`;
}

function wfCard(wf) {
  const isOwner = wf.ownerId === S.user.id;
  return `
    <div class="wf-card">
      <div class="wf-card-head">
        <span class="wf-card-title">${esc(wf.name)}</span>
        <span class="badge ${wf.isPublic ? 'badge-public' : 'badge-private'}">${wf.isPublic ? '🌐 Public' : '🔒 Private'}</span>
      </div>
      ${wf.description ? `<div class="wf-card-desc">${esc(wf.description)}</div>` : ''}
      <div class="wf-card-meta">
        <span>📌 ${wf.steps.length} steps</span>
        <span>👤 ${esc(wf.ownerUsername)}</span>
        <span>🕐 ${fmtDate(wf.updatedAt)}</span>
      </div>
      <div class="wf-card-actions">
        <button class="btn btn-success btn-sm" style="flex:1" onclick="navigate('/workflow/${esc(wf.id)}?run=1')">▶ Run</button>
        <button class="btn btn-secondary btn-sm" onclick="navigate('/workflow/${esc(wf.id)}')">✏</button>
        ${isOwner ? `<button class="btn btn-danger btn-sm" onclick="deleteDashWf('${esc(wf.id)}','${esc(wf.name)}')">✕</button>` : ''}
      </div>
    </div>`;
}

async function deleteDashWf(id, name) {
  if (!confirm(`Delete "${name}"?`)) return;
  try {
    await api('DELETE', `/workflows/${id}`);
    S._allWorkflows = S._allWorkflows.filter(w => w.id !== id);
    renderWfList();
    toast('Workflow deleted');
  } catch (e) { toast(e.message, 'error'); }
}

/* ═══════════════════════════ WORKFLOW EDITOR ════════════════════════════════ */

function renderEditor(id) {
  S.wfId = id || null;
  S.wf = { name: 'Untitled Workflow', description: '', steps: [] };
  S.wfOwner = true;
  S.execStates = {};
  S.logs = [];
  S.running = false;

  renderLayout(`
    <div class="editor">
      <div class="editor-toolbar">
        <button class="btn btn-ghost btn-sm" onclick="navigate('/dashboard')">← Back</button>
        <input class="wf-name-input" id="wf-name" value="${esc(S.wf.name)}" placeholder="Workflow name" />
        <div style="display:flex;gap:6px;margin-left:auto">
          <button class="btn btn-secondary btn-sm" onclick="openFromFile()">📂 Open</button>
          <button class="btn btn-secondary btn-sm" onclick="saveToFile()">💾 Export</button>
          <button class="btn btn-primary btn-sm" id="btn-save" onclick="showSaveDialog()">☁ Save</button>
          <label class="local-toggle" id="local-toggle-wrap" title="Thực thi trên máy PC này (cần chạy agent.py)">
            <input type="checkbox" id="chk-local" onchange="setLocalMode(this.checked)" ${S.localMode ? 'checked' : ''} />
            <span>🖥 Local PC</span>
          </label>
          <span class="agent-dot" id="agent-dot"></span>
          <button class="btn btn-success btn-sm" id="btn-run" onclick="runWorkflow()">▶ Run</button>
        </div>
      </div>
      <div class="editor-desc-bar">
        <input class="wf-desc-input" id="wf-desc" placeholder="Add a description (optional)..." />
      </div>
      <div class="editor-body">
        <div class="steps-panel" id="steps-panel">
          <div class="steps-header">
            <span class="steps-title" id="steps-title">Steps (0)</span>
            <button class="btn btn-primary btn-sm" id="btn-add" onclick="openAddStep()">＋ Add Step</button>
          </div>
          <div class="steps-list" id="steps-list"><div class="loading">Loading...</div></div>
        </div>
        <div class="log-panel" id="log-panel" style="display:none">
          <div class="log-header">
            <span>🖥 Execution Log</span>
            <button class="btn-close-log" onclick="toggleLog(false)">✕</button>
          </div>
          <div class="log-body" id="log-body"></div>
        </div>
      </div>
    </div>`);

  if (id) {
    loadEditorWorkflow(id);
  } else {
    syncEditorUI();
  }

  document.getElementById('wf-name').addEventListener('input', e => { S.wf.name = e.target.value; });
  document.getElementById('wf-desc').addEventListener('input', e => { S.wf.description = e.target.value; });

  updateAgentDot();

  // Auto-run
  if (location.search.includes('run=1') && id) {
    // Will run after load
  }
}

async function loadEditorWorkflow(id) {
  try {
    const wf = await api('GET', `/workflows/${id}`);
    if (!wf) return;
    S.wf = { name: wf.name, description: wf.description, steps: wf.steps };
    S.wfOwner = wf.ownerId === S.user.id || S.user.isAdmin;
    syncEditorUI();

    if (location.search.includes('run=1')) {
      history.replaceState(null, '', location.pathname + location.hash);
      setTimeout(runWorkflow, 300);
    }
  } catch (e) {
    toast(e.message, 'error');
    navigate('/dashboard');
  }
}

function syncEditorUI() {
  const nameEl = document.getElementById('wf-name');
  const descEl = document.getElementById('wf-desc');
  if (nameEl) nameEl.value = S.wf.name;
  if (descEl) descEl.value = S.wf.description;

  const isOwner = S.wfOwner;
  if (nameEl) nameEl.disabled = !isOwner;
  if (descEl) descEl.disabled = !isOwner;
  const btnSave = document.getElementById('btn-save');
  const btnAdd  = document.getElementById('btn-add');
  if (btnSave) btnSave.style.display = isOwner ? '' : 'none';
  if (btnAdd)  btnAdd.style.display  = isOwner ? '' : 'none';

  renderSteps();
}

/* ── Steps rendering ──────────────────────────────────────────────────────── */

function renderSteps() {
  const list = document.getElementById('steps-list');
  const title = document.getElementById('steps-title');
  if (!list) return;
  if (title) title.textContent = `Steps (${S.wf.steps.length})`;

  if (S.wf.steps.length === 0) {
    list.innerHTML = `<div class="step-empty">
      <p style="margin-bottom:10px;color:#6b7280">No steps yet. Start building your automation.</p>
      ${S.wfOwner ? '<button class="btn btn-primary" onclick="openAddStep()">＋ Add First Step</button>' : ''}
    </div>`;
    return;
  }
  list.innerHTML = S.wf.steps.map((step, i) => stepCardHtml(step, i)).join('');
}

function stepCardHtml(step, i) {
  const es = S.execStates[i] || {};
  const status = es.status || 'pending';
  const info = ACTION_TYPES[step.actionType] || { label: step.actionType, badgeClass: 'ab-delay' };
  const numClass = status === 'running' ? 'running' : status === 'done' ? 'done' : status === 'failed' ? 'failed' : '';
  const numContent = status === 'running' ? '⟳' : status === 'done' ? '✓' : status === 'failed' ? '✗' : i + 1;

  return `
    <div class="step-card step-${status}" data-idx="${i}">
      <div class="step-num ${numClass}">${numContent}</div>
      <div class="step-info">
        <div class="step-head">
          <span class="step-name">${esc(step.name)}</span>
          <span class="action-badge ${info.badgeClass}">${esc(info.label)}</span>
          ${step.delay ? `<span class="step-delay">+${step.delay}ms</span>` : ''}
        </div>
        ${step.target ? `<div class="step-target">→ ${esc(step.target)}</div>` : ''}
        ${step.value  ? `<div class="step-target">✎ ${esc(step.value)}</div>`  : ''}
        ${es.error    ? `<div class="step-error">${esc(es.error)}</div>`        : ''}
      </div>
      ${S.wfOwner && !S.running ? `
        <div class="step-controls">
          <button class="btn btn-ghost btn-icon" title="Move up"   ${i === 0 ? 'disabled' : ''} onclick="moveStep(${i},-1)">↑</button>
          <button class="btn btn-ghost btn-icon" title="Move down" ${i === S.wf.steps.length - 1 ? 'disabled' : ''} onclick="moveStep(${i},1)">↓</button>
          <button class="btn btn-ghost btn-icon" title="Edit"   onclick="openEditStep(${i})" style="color:#2563eb">✏</button>
          <button class="btn btn-ghost btn-icon" title="Delete" onclick="deleteStep(${i})" style="color:#dc2626">✕</button>
        </div>` : ''}
    </div>`;
}

function updateStepCard(index) {
  const card = document.querySelector(`[data-idx="${index}"]`);
  if (!card) return;
  const step = S.wf.steps[index];
  card.outerHTML = stepCardHtml(step, index);
}

/* ── Step CRUD ────────────────────────────────────────────────────────────── */

function openAddStep() {
  S._stepEditIndex = null;
  openStepModal({ id: uuid(), name: `Step ${S.wf.steps.length + 1}`, actionType: 'left_click', delay: 0 });
}

function openEditStep(i) {
  S._stepEditIndex = i;
  openStepModal({ ...S.wf.steps[i] });
}

function deleteStep(i) {
  if (!confirm(`Delete step "${S.wf.steps[i].name}"?`)) return;
  S.wf.steps.splice(i, 1);
  renderSteps();
}

function moveStep(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= S.wf.steps.length) return;
  [S.wf.steps[i], S.wf.steps[j]] = [S.wf.steps[j], S.wf.steps[i]];
  renderSteps();
}

/* ═══════════════════════════ EXECUTION ══════════════════════════════════════ */

async function runWorkflow() {
  if (S.wf.steps.length === 0) { toast('No steps to execute', 'error'); return; }

  if (S.localMode) {
    const ok = await checkAgentStatus();
    if (!ok) {
      toast(`Local agent không chạy — hãy chạy start_agent.bat (port ${S.agentPort})`, 'error');
      updateAgentDot();
      return;
    }
  }

  S.running = true;
  S.execStates = {};
  S.logs = [];
  toggleLog(true);
  document.getElementById('log-body').innerHTML = '';

  const btn = document.getElementById('btn-run');
  if (btn) { btn.textContent = '⏹ Stop'; btn.onclick = stopWorkflow; btn.className = 'btn btn-danger btn-sm'; }
  renderSteps();

  const wsUrl = S.localMode
    ? `ws://localhost:${S.agentPort}/ws`
    : `${WS_PROTO}//${location.host}/ws?token=${encodeURIComponent(S.token)}`;

  const ws = new WebSocket(wsUrl);
  S.ws = ws;

  ws.onopen = () => ws.send(JSON.stringify({ type: 'start', steps: S.wf.steps }));
  ws.onmessage = e => handleWsMsg(JSON.parse(e.data));
  ws.onerror = () => { toast('WebSocket error', 'error'); endExecution(); };
  ws.onclose = () => { if (S.running) endExecution(); };
}

function stopWorkflow() {
  if (S.ws) S.ws.send(JSON.stringify({ type: 'cancel' }));
  endExecution();
}

function setLocalMode(on) {
  S.localMode = on;
  localStorage.setItem('localMode', on ? '1' : '0');
  updateAgentDot();
}

async function updateAgentDot() {
  const dot = document.getElementById('agent-dot');
  if (!dot) return;
  if (!S.localMode) { dot.className = 'agent-dot'; return; }
  dot.className = 'agent-dot checking';
  dot.title = 'Đang kiểm tra...';
  const ok = await checkAgentStatus();
  dot.className = 'agent-dot ' + (ok ? 'online' : 'offline');
  dot.title = ok
    ? `Agent đang chạy trên port ${S.agentPort}`
    : `Agent chưa chạy — hãy chạy start_agent.bat`;
}

async function checkAgentStatus() {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1500);
    const r = await fetch(`http://localhost:${S.agentPort}/health`, { signal: ctrl.signal });
    clearTimeout(timer);
    const d = await r.json();
    return d.agent === true;
  } catch {
    return false;
  }
}

function handleWsMsg(data) {
  switch (data.type) {
    case 'start':
      appendLog(`Starting execution of ${data.total} steps...`);
      break;
    case 'step':
      S.execStates[data.index] = { status: data.status, error: data.error };
      updateStepCard(data.index);
      break;
    case 'log':
      appendLog(data.message);
      break;
    case 'done':
      appendLog(`\n✓ All ${data.total} steps completed.`, 'success');
      toast('Execution completed!');
      endExecution();
      break;
    case 'error':
      appendLog(`✗ Failed at step ${data.stepIndex + 1}: ${data.error}`, 'error');
      toast(`Step ${data.stepIndex + 1} failed`, 'error');
      endExecution();
      break;
    case 'cancelled':
      appendLog('--- Execution cancelled ---');
      toast('Execution stopped');
      endExecution();
      break;
  }
}

function appendLog(msg, cls = '') {
  S.logs.push(msg);
  const body = document.getElementById('log-body');
  if (!body) return;
  const line = document.createElement('div');
  line.className = 'log-line' + (cls ? ' ' + cls : '');
  line.textContent = msg;
  body.appendChild(line);
  body.scrollTop = body.scrollHeight;
}

function endExecution() {
  S.running = false;
  if (S.ws) { try { S.ws.close(); } catch (_) {} S.ws = null; }
  const btn = document.getElementById('btn-run');
  if (btn) { btn.textContent = '▶ Run'; btn.onclick = runWorkflow; btn.className = 'btn btn-success btn-sm'; }
  renderSteps();
}

function toggleLog(show) {
  const panel = document.getElementById('log-panel');
  if (panel) panel.style.display = show ? '' : 'none';
}

/* ═══════════════════════════ STEP MODAL ══════════════════════════════════════ */

function openStepModal(step) {
  const root = document.getElementById('modal-root');
  const groups = ACTION_GROUPS.map(g => {
    const opts = Object.entries(ACTION_TYPES)
      .filter(([, v]) => v.group === g)
      .map(([k, v]) => `<option value="${k}" ${step.actionType === k ? 'selected' : ''}>${esc(v.label)}</option>`)
      .join('');
    return `<optgroup label="${esc(g)}">${opts}</optgroup>`;
  }).join('');

  root.innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">${S._stepEditIndex === null ? 'Add Step' : 'Edit Step'}</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Step Name *</label>
            <input class="input" id="m-name" value="${esc(step.name)}" placeholder="e.g. Click Submit" />
          </div>
          <div class="form-group">
            <label class="form-label">Action Type *</label>
            <select class="input" id="m-action" onchange="updateModalFields()">${groups}</select>
          </div>
          <div class="form-group" id="m-fg-target">
            <label class="form-label" id="m-label-target">Target</label>
            <div class="input-with-btn">
              <input class="input" id="m-target" value="${esc(step.target || '')}" />
              <button class="btn btn-secondary btn-pick" id="btn-pick-coord" onclick="startCoordPick()" style="display:none" title="Move cursor to target position, then click Pick">&#x1F4CD; Pick</button>
            </div>
            <span class="form-hint" id="m-hint"></span>
          </div>
          <div class="form-group" id="m-fg-value">
            <label class="form-label" id="m-label-value">Value</label>
            <input class="input" id="m-value" value="${esc(step.value || '')}" />
          </div>
          <div class="form-group">
            <label class="form-label">Delay after step (ms)</label>
            <input class="input" type="number" id="m-delay" min="0" step="100" value="${step.delay ?? 0}" />
            <span class="form-hint">Wait this many milliseconds before moving to the next step</span>
          </div>
          <div class="form-group">
            <label class="form-label">Description (optional)</label>
            <textarea class="input" id="m-desc" rows="2">${esc(step.description || '')}</textarea>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="submitStep('${esc(step.id)}')">💾 Save Step</button>
        </div>
      </div>
    </div>`;
  updateModalFields();
  document.getElementById('m-name').focus();
}

function updateModalFields() {
  const action = document.getElementById('m-action')?.value;
  if (!action) return;
  const info = ACTION_TYPES[action];
  const fgT  = document.getElementById('m-fg-target');
  const fgV  = document.getElementById('m-fg-value');
  const lblT = document.getElementById('m-label-target');
  const lblV = document.getElementById('m-label-value');
  const hint = document.getElementById('m-hint');
  const pickBtn = document.getElementById('btn-pick-coord');

  if (fgT)  fgT.style.display  = info.targetLabel ? '' : 'none';
  if (fgV)  fgV.style.display  = info.valueLabel  ? '' : 'none';
  if (lblT) lblT.textContent = info.targetLabel;
  if (lblV) lblV.textContent = info.valueLabel;
  if (pickBtn) pickBtn.style.display = info.coordPicker ? '' : 'none';

  const isBrowserSelector = ['browser_click', 'browser_type', 'browser_wait'].includes(action);

  const tEl = document.getElementById('m-target');
  if (tEl) {
    tEl.placeholder = action === 'browser_navigate' ? 'https://example.com'
      : isBrowserSelector ? 'Paste HTML element hoặc nhập #id / .class / text=...'
      : action === 'open_app' ? '/usr/bin/gedit or notepad.exe'
      : action === 'browser_screenshot' ? '/home/user/screenshot.png'
      : action === 'hot_key' ? 'e.g. ctrl+c  alt+F4  ctrl+shift+s'
      : action === 'close_app' ? 'e.g. notepad.exe  Notepad  gedit'
      : info.coordPicker ? 'x,y (e.g. 500,300)'
      : '';

    // Paste handler: tự convert HTML element → CSS selector
    tEl.onpaste = isBrowserSelector ? function (e) {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const sel = htmlToSelector(text);
      if (!sel) return; // không phải HTML, cho paste bình thường
      e.preventDefault();
      tEl.value = sel;
      if (hint) {
        hint.style.color = '#2563eb';
        hint.textContent = `✓ Extracted: ${sel}`;
        setTimeout(() => {
          hint.style.color = '';
          hint.textContent = '💡 Dán HTML element (F12 → Copy element) để tự extract selector';
        }, 3000);
      }
    } : null;
  }

  if (hint) {
    hint.textContent = isBrowserSelector
      ? '💡 Dán HTML element (F12 → Copy element) để tự extract selector'
      : action === 'browser_navigate' || action === 'browser_screenshot'
      ? ''
      : info.coordPicker
      ? 'Type x,y manually or click Pick — move cursor to target then wait 3s'
      : '';
  }
  const vEl = document.getElementById('m-value');
  if (vEl) {
    vEl.placeholder = action === 'delay' || action === 'browser_wait' ? '1000'
      : action === 'keyboard_input' || action === 'browser_type' ? 'Text to type...'
      : action === 'hot_key' || action === 'move_window' ? 'Window title (optional)'
      : '';
  }
}

async function startCoordPick() {
  const btn = document.getElementById('btn-pick-coord');
  const inp = document.getElementById('m-target');
  if (!btn || !inp) return;

  btn.disabled = true;
  const orig = btn.innerHTML;

  for (let i = 3; i >= 1; i--) {
    btn.innerHTML = `&#x23F3; ${i}s`;
    await new Promise(r => setTimeout(r, 1000));
  }
  btn.innerHTML = '&#x1F4E1; Đang đọc...';

  try {
    const res = await fetch('/api/tools/pick-coordinate', {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + S.token }
    });
    if (!res.ok) {
      const d = await res.json();
      throw new Error(d.detail || 'Không đọc được tọa độ');
    }
    const data = await res.json();
    inp.value = `${data.x},${data.y}`;
    toast(`Tọa độ: ${data.x},${data.y}`);
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    btn.disabled = false;
    btn.innerHTML = orig;
  }
}

function closeModal(e) {
  if (e && e.target !== e.currentTarget) return;
  document.getElementById('modal-root').innerHTML = '';
}

function submitStep(stepId) {
  const name = document.getElementById('m-name').value.trim();
  if (!name) { toast('Step name is required', 'error'); return; }
  const step = {
    id: stepId || uuid(),
    name,
    actionType: document.getElementById('m-action').value,
    target: document.getElementById('m-target')?.value.trim() || undefined,
    value:  document.getElementById('m-value')?.value.trim()  || undefined,
    delay:  parseInt(document.getElementById('m-delay').value) || 0,
    description: document.getElementById('m-desc').value.trim() || undefined,
  };
  if (S._stepEditIndex === null) {
    S.wf.steps.push(step);
  } else {
    S.wf.steps[S._stepEditIndex] = step;
  }
  closeModal();
  renderSteps();
}

/* ═══════════════════════════ SAVE DIALOG ════════════════════════════════════ */

function showSaveDialog() {
  if (!document.getElementById('wf-name')) return;
  S.wf.name = document.getElementById('wf-name').value.trim() || S.wf.name;
  if (!S.wf.name) { toast('Workflow name is required', 'error'); return; }

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" style="max-width:400px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">☁ Save to Common Storage</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <p style="font-size:13px;color:#6b7280">Save <strong>"${esc(S.wf.name)}"</strong> so teammates can view and run it.</p>
          <div id="radio-private" class="radio-option ${!S._savePublic ? 'selected' : ''}" onclick="selectVisibility(false)">
            <input type="radio" name="vis" ${!S._savePublic ? 'checked' : ''} onchange="selectVisibility(false)" />
            <div>
              <div class="radio-label">🔒 Private</div>
              <div class="radio-desc">Only you can see and run this workflow</div>
            </div>
          </div>
          <div id="radio-public" class="radio-option ${S._savePublic ? 'selected' : ''}" onclick="selectVisibility(true)">
            <input type="radio" name="vis" ${S._savePublic ? 'checked' : ''} onchange="selectVisibility(true)" />
            <div>
              <div class="radio-label">🌐 Public</div>
              <div class="radio-desc">All colleagues can view and run this workflow</div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" id="btn-confirm-save" onclick="doSave()">💾 Save</button>
        </div>
      </div>
    </div>`;
}

function selectVisibility(isPublic) {
  S._savePublic = isPublic;
  document.getElementById('radio-private').classList.toggle('selected', !isPublic);
  document.getElementById('radio-public').classList.toggle('selected', isPublic);
}

async function doSave() {
  const btn = document.getElementById('btn-confirm-save');
  if (btn) { btn.disabled = true; btn.textContent = 'Saving...'; }
  try {
    S.wf.name = document.getElementById('wf-name')?.value.trim() || S.wf.name;
    S.wf.description = document.getElementById('wf-desc')?.value.trim() || S.wf.description;
    const payload = { name: S.wf.name, description: S.wf.description, steps: S.wf.steps, isPublic: S._savePublic };
    if (S.wfId) {
      await api('PUT', `/workflows/${S.wfId}`, payload);
      toast('Workflow updated');
    } else {
      const data = await api('POST', '/workflows', payload);
      if (data) { S.wfId = data.id; history.replaceState(null, '', `#/workflow/${data.id}`); }
      toast('Workflow saved');
    }
    closeModal();
  } catch (e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save'; }
  }
}

/* ═══════════════════════════ FILE OPERATIONS ════════════════════════════════ */

function saveToFile() {
  S.wf.name = document.getElementById('wf-name')?.value.trim() || S.wf.name;
  const data = { name: S.wf.name, description: S.wf.description, steps: S.wf.steps };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (S.wf.name || 'workflow').replace(/[^a-z0-9]/gi, '_') + '.json';
  a.click(); URL.revokeObjectURL(url);
  toast('Exported to file');
}

function openFromFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.json';
  inp.onchange = async () => {
    const file = inp.files?.[0]; if (!file) return;
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!data.name || !Array.isArray(data.steps)) throw new Error('Invalid workflow file format');
      S.wf = { name: data.name, description: data.description || '', steps: data.steps.map(s => ({ ...s, id: s.id || uuid() })) };
      S.wfId = null;
      syncEditorUI();
      toast(`Loaded: ${data.name}`);
    } catch (e) { toast(e.message, 'error'); }
  };
  inp.click();
}

/* ═══════════════════════════ ADMIN PAGE ══════════════════════════════════════ */

async function renderAdmin() {
  renderLayout(`
    <div class="page">
      <div class="page-header">
        <div>
          <div class="page-title">🛡 User Management</div>
          <div class="page-subtitle">Manage team members and their permissions</div>
        </div>
        <button class="btn btn-primary" onclick="openAddUser()">＋ Add User</button>
      </div>
      <div class="table-wrap" id="user-table"><div class="loading">Loading...</div></div>
    </div>`);
  await loadUsers();
}

async function loadUsers() {
  try {
    const users = await api('GET', '/users') || [];
    renderUserTable(users);
  } catch (e) { toast(e.message, 'error'); }
}

function renderUserTable(users) {
  const el = document.getElementById('user-table');
  if (!el) return;
  el.innerHTML = `
    <table>
      <thead><tr><th>User</th><th>Role</th><th>Created</th><th></th></tr></thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td><div class="user-row-name">
              <div class="user-avatar">${esc(u.username[0].toUpperCase())}</div>
              <span>${esc(u.username)}</span>
              ${u.id === S.user.id ? '<span class="you-tag">(you)</span>' : ''}
            </div></td>
            <td><span class="badge-role ${u.is_admin ? 'admin' : 'user'}">${u.is_admin ? '⚡ Admin' : 'User'}</span></td>
            <td style="color:#9ca3af;font-size:12px">${fmtDate(u.created_at)}</td>
            <td>
              ${u.id !== S.user.id ? `<div class="table-actions">
                <button class="btn btn-ghost btn-sm" title="${u.is_admin ? 'Remove admin' : 'Make admin'}"
                  onclick="toggleAdmin(${u.id},${u.is_admin})" style="color:${u.is_admin ? '#f97316' : '#2563eb'}">
                  ${u.is_admin ? '🔓' : '🛡'}
                </button>
                <button class="btn btn-danger btn-sm" title="Delete" onclick="deleteUser(${u.id},'${esc(u.username)}')">✕</button>
              </div>` : ''}
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function openAddUser() {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" style="max-width:380px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">＋ New User</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Username *</label>
            <input class="input" id="nu-user" placeholder="Enter username" />
          </div>
          <div class="form-group">
            <label class="form-label">Password *</label>
            <input class="input" type="password" id="nu-pass" placeholder="Min. 6 characters" />
          </div>
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#374151">
            <input type="checkbox" id="nu-admin" style="accent-color:#2563eb" />
            Grant admin privileges
          </label>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="doAddUser()">Create User</button>
        </div>
      </div>
    </div>`;
  document.getElementById('nu-user').focus();
}

async function doAddUser() {
  const username = document.getElementById('nu-user')?.value.trim();
  const password = document.getElementById('nu-pass')?.value;
  const isAdmin  = document.getElementById('nu-admin')?.checked;
  if (!username || !password) { toast('Username and password required', 'error'); return; }
  if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
  try {
    await api('POST', '/users', { username, password, isAdmin });
    closeModal();
    toast(`User "${username}" created`);
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? This will also delete all their workflows.`)) return;
  try {
    await api('DELETE', `/users/${id}`);
    toast(`User "${username}" deleted`);
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function toggleAdmin(id, currentAdmin) {
  try {
    await api('PATCH', `/users/${id}`, { isAdmin: !currentAdmin });
    toast(currentAdmin ? 'Admin removed' : 'Admin granted');
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}
