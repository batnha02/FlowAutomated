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

/* ═══════════════════════════ STATE ══════════════════════════════════════════ */

const S = {
  token: localStorage.getItem('token'),
  user: JSON.parse(localStorage.getItem('user') || 'null'),
  wf: { name: 'Untitled Workflow', description: '', steps: [] },
  wfId: null,
  // Replace wfOwner with wfPerms
  wfPerms: { canView: true, canRun: false, canEdit: false, canDelete: false },
  wfApiKey: null,
  execStates: {},
  logs: [],
  running: false,
  ws: null,
  dashTab: 'mine',
  dashSearch: '',
  _allWorkflows: [],
  _stepEditIndex: null,
  _savePublic: false,
  localMode: true,
  agentPort: parseInt(localStorage.getItem('agentPort') || '8001', 10),
  _stepMasked: false,
};

/* ═══════════════════════════ UTILITIES ══════════════════════════════════════ */

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, c =>
    (+c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> +c / 4).toString(16));
}

function htmlToSelector(raw) {
  const t = raw.trim();
  if (!t.startsWith('<')) return null;
  const tagM = t.match(/^<(\w+)/);
  const tag = tagM ? tagM[1].toLowerCase() : '';
  const idM = t.match(/\bid=["']([^"']+)['"]/);
  if (idM) return `#${idM[1]}`;
  const clsM = t.match(/\bclass=["']([^"']+)['"]/);
  if (clsM) {
    const classes = clsM[1].trim().split(/\s+/).join('.');
    return tag ? `${tag}.${classes}` : `.${classes}`;
  }
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

/* ═══════════════════════════ API ════════════════════════════════════════════ */

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

/* ═══════════════════════════ AUTH ══════════════════════════════════════════ */

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

/* ═══════════════════════════ ROUTER ════════════════════════════════════════ */

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

/* ═══════════════════════════ LAYOUT ════════════════════════════════════════ */

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
          <button class="btn-change-pass" onclick="openChangePassword()">🔑 Change Password</button>
          <button class="btn-logout" onclick="doLogout()">🚪 Logout</button>
        </div>
      </nav>
      <main class="main-content">${innerHtml}</main>
    </div>`;
}

/* ═══════════════════════════ LOGIN PAGE ════════════════════════════════════ */

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

/* ═══════════════════════════ DASHBOARD PAGE ════════════════════════════════ */

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
  const uid = Number(S.user?.id);
  const mine = S._allWorkflows.filter(w => {
    const p = w.myPerms || {};
    return Number(w.ownerId) === uid || p.canEdit || p.canDelete || p.canRun;
  });
  const comm = S._allWorkflows.filter(w => Number(w.ownerId) !== uid && w.isPublic);
  const list = (S.dashTab === 'mine' ? mine : comm)
    .filter(w => !S.dashSearch || w.name.toLowerCase().includes(S.dashSearch.toLowerCase()));

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
  const p = wf.myPerms || {};
  const canDelete = p.canDelete || false;
  const canEdit = p.canEdit || false;
  const apiUrl = wf.apiKey ? `${location.origin}/api/run/${wf.id}?api_key=${wf.apiKey}` : null;
  return `
    <div class="wf-card">
      <div class="wf-card-head">
        <span class="wf-card-title">${esc(wf.name)}</span>
        <div style="display:flex;gap:4px;align-items:center">
          <span class="badge ${wf.isPublic ? 'badge-public' : 'badge-private'}">${wf.isPublic ? '🌐 Public' : '🔒 Private'}</span>
          ${!canEdit && wf.isPublic ? '<span class="badge badge-ro">👁 R/O</span>' : ''}
        </div>
      </div>
      ${wf.description ? `<div class="wf-card-desc">${esc(wf.description)}</div>` : ''}
      <div class="wf-card-meta">
        <span>📌 ${wf.steps.length} steps</span>
        <span>👤 ${esc(wf.ownerUsername)}</span>
        <span>🕐 ${fmtDate(wf.updatedAt)}</span>
      </div>
      <div class="wf-card-actions">
        ${p.canRun ? `<button class="btn btn-success btn-sm" style="flex:1" onclick="navigate('/workflow/${esc(wf.id)}?run=1')">▶ Run</button>` : ''}
        <button class="btn btn-secondary btn-sm" onclick="navigate('/workflow/${esc(wf.id)}')">✏</button>
        ${apiUrl ? `<button class="btn btn-secondary btn-sm" title="Copy API URL" onclick="copyText('${esc(apiUrl)}','API URL copied')">📋</button>` : ''}
        ${canDelete ? `<button class="btn btn-danger btn-sm" onclick="deleteDashWf('${esc(wf.id)}','${esc(wf.name)}')">✕</button>` : ''}
      </div>
    </div>`;
}

function copyText(text, msg = 'Copied') {
  navigator.clipboard.writeText(text).then(() => toast(msg)).catch(() => toast('Copy failed', 'error'));
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

/* ═══════════════════════════ WORKFLOW EDITOR ══════════════════════════════ */

function renderEditor(id) {
  S.wfId = id || null;
  S.wf = { name: 'Untitled Workflow', description: '', steps: [] };
  S.wfPerms = { canView: true, canRun: false, canEdit: false, canDelete: false };
  S.wfApiKey = null;
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
          <span id="readonly-badge" class="badge-readonly" style="display:none">👁 Read Only</span>
          <button class="btn btn-primary btn-sm" id="btn-save" onclick="showSaveDialog()" style="display:none">☁ Save</button>
          <button class="btn btn-secondary btn-sm" id="btn-settings" onclick="openWorkflowSettings()" style="display:none">⚙ Settings</button>
          <span class="agent-dot" id="agent-dot" title="Local Agent"></span>
          <button class="btn btn-success btn-sm" id="btn-run" onclick="runWorkflow()" style="display:none">▶ Run</button>
        </div>
      </div>
      <div class="editor-desc-bar">
        <input class="wf-desc-input" id="wf-desc" placeholder="Add a description (optional)..." />
      </div>
      <div class="editor-body">
        <div class="steps-panel" id="steps-panel">
          <div class="steps-header">
            <span class="steps-title" id="steps-title">Steps (0)</span>
            <button class="btn btn-primary btn-sm" id="btn-add" onclick="openAddStep()" style="display:none">＋ Add Step</button>
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
    // New workflow: owner gets full perms
    S.wfPerms = { canView: true, canRun: true, canEdit: true, canDelete: true };
    syncEditorUI();
  }

  document.getElementById('wf-name').addEventListener('input', e => { S.wf.name = e.target.value; });
  document.getElementById('wf-desc').addEventListener('input', e => { S.wf.description = e.target.value; });

  updateAgentDot();

  if (location.search.includes('run=1') && id) {
    // Will run after load
  }
}

async function loadEditorWorkflow(id) {
  try {
    const wf = await api('GET', `/workflows/${id}`);
    if (!wf) return;
    S.wf = { name: wf.name, description: wf.description, steps: wf.steps };
    S.wfPerms = wf.myPerms || { canView: true, canRun: false, canEdit: false, canDelete: false };
    S.wfApiKey = wf.apiKey || null;
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

  const canEdit = S.wfPerms.canEdit;
  const canRun  = S.wfPerms.canRun;

  if (nameEl) nameEl.disabled = !canEdit;
  if (descEl) descEl.disabled = !canEdit;

  const btnSave     = document.getElementById('btn-save');
  const btnAdd      = document.getElementById('btn-add');
  const btnSettings = document.getElementById('btn-settings');
  const btnRun      = document.getElementById('btn-run');
  const roLabel     = document.getElementById('readonly-badge');

  if (btnSave)     btnSave.style.display     = canEdit ? '' : 'none';
  if (btnAdd)      btnAdd.style.display      = canEdit ? '' : 'none';
  if (btnSettings) btnSettings.style.display = (canEdit && S.wfId) ? '' : 'none';
  if (btnRun)      btnRun.style.display      = canRun  ? '' : 'none';
  if (roLabel)     roLabel.style.display     = (!canEdit && !canRun) ? '' : 'none';

  renderSteps();
}

/* ── Steps rendering ──────────────────────────────────────────────────────── */

function renderSteps() {
  const list = document.getElementById('steps-list');
  const title = document.getElementById('steps-title');
  if (!list) return;
  if (title) title.textContent = `Steps (${S.wf.steps.length})`;

  const canEdit = S.wfPerms.canEdit;

  if (S.wf.steps.length === 0) {
    list.innerHTML = `<div class="step-empty">
      <p style="margin-bottom:10px;color:#6b7280">No steps yet. Start building your automation.</p>
      ${canEdit ? '<button class="btn btn-primary" onclick="openAddStep()">＋ Add First Step</button>' : ''}
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
  const canEdit = S.wfPerms.canEdit;

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
        ${step.value  ? `<div class="step-target">✎ ${step.masked ? '••••••••' : esc(step.value)}</div>`  : ''}
        ${es.error    ? `<div class="step-error">${esc(es.error)}</div>`        : ''}
      </div>
      ${canEdit && !S.running ? `
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

/* ── Step CRUD ──────────────────────────────────────────────────────────── */

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

/* ═══════════════════════════ EXECUTION ════════════════════════════════════ */

async function runWorkflow() {
  if (S.wf.steps.length === 0) { toast('No steps to execute', 'error'); return; }

  const ok = await checkAgentStatus();
  if (!ok) {
    updateAgentDot();
    showAgentOfflineModal();
    return;
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

  ws.onopen = () => ws.send(JSON.stringify({
    type: 'start',
    steps: S.wf.steps,
    workflowId: S.wfId || undefined,
  }));
  ws.onmessage = e => handleWsMsg(JSON.parse(e.data));
  ws.onerror = () => { toast('WebSocket error', 'error'); endExecution(); };
  ws.onclose = () => { if (S.running) endExecution(); };
}

function stopWorkflow() {
  if (S.ws) S.ws.send(JSON.stringify({ type: 'cancel' }));
  endExecution();
}

async function updateAgentDot() {
  const dot = document.getElementById('agent-dot');
  if (!dot) return;
  dot.className = 'agent-dot checking';
  dot.title = 'Đang kiểm tra...';
  const ok = await checkAgentStatus();
  dot.className = 'agent-dot ' + (ok ? 'online' : 'offline');
  dot.title = ok
    ? `Agent đang chạy trên port ${S.agentPort}`
    : `Agent chưa chạy — click để tải start_agent.bat`;
  dot.onclick = ok ? null : () => showAgentOfflineModal();
  dot.style.cursor = ok ? '' : 'pointer';
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

function showAgentOfflineModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" style="max-width:460px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">🖥 Local Agent chưa chạy</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body" style="display:flex;flex-direction:column;gap:12px">
          <p style="margin:0">Agent chưa khởi động trên máy này (port <strong>${S.agentPort}</strong>). Thực hiện 3 bước:</p>
          <ol style="margin:0;padding-left:20px;line-height:2">
            <li>Tải file <strong>autostep-agent.zip</strong> (nút bên dưới)</li>
            <li>Giải nén → vào thư mục <code>autostep-agent</code> → double-click <strong>start_agent.bat</strong></li>
            <li>Chờ terminal hiện <em>"Agent WebSocket : ws://localhost:${S.agentPort}/ws"</em> rồi quay lại nhấn ▶ Run</li>
          </ol>
          <div style="background:var(--bg-secondary,#f4f4f5);border-radius:6px;padding:8px 12px;font-size:12px;font-family:monospace;color:var(--text-muted,#888)">
            Yêu cầu: Python 3.11+ đã cài trên máy
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Đóng</button>
          <a class="btn btn-primary" href="/download/autostep-agent.zip" download>⬇ Tải autostep-agent.zip</a>
        </div>
      </div>
    </div>`;
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

/* ═══════════════════════════ STEP MODAL ═══════════════════════════════════ */

function openStepModal(step) {
  S._stepMasked = !!step.masked;
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
            <div class="input-with-btn">
              <input class="input" id="m-value" value="${esc(step.value || '')}"
                     type="${step.masked ? 'password' : 'text'}" />
              <button class="btn btn-secondary btn-mask" id="btn-mask-toggle"
                      onclick="toggleValueMask()" style="display:none"
                      title="${step.masked ? 'Hiện nội dung (chỉ owner)' : 'Ẩn nội dung (dành cho password)'}">
                ${step.masked ? '🔒' : '👁'}
              </button>
            </div>
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

    tEl.onpaste = isBrowserSelector ? function (e) {
      const text = (e.clipboardData || window.clipboardData).getData('text');
      const sel = htmlToSelector(text);
      if (!sel) return;
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

  const isTextToType = action === 'keyboard_input' || action === 'browser_type';
  const maskBtn = document.getElementById('btn-mask-toggle');
  if (maskBtn) {
    maskBtn.style.display = isTextToType ? '' : 'none';
    if (!isTextToType && S._stepMasked) {
      S._stepMasked = false;
      if (vEl) vEl.type = 'text';
    }
    maskBtn.textContent = S._stepMasked ? '🔒' : '👁';
    maskBtn.title = S._stepMasked ? 'Hiện nội dung (chỉ owner)' : 'Ẩn nội dung (dành cho password)';
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

function toggleValueMask() {
  const inp = document.getElementById('m-value');
  const btn = document.getElementById('btn-mask-toggle');
  if (!inp || !btn) return;
  if (S._stepMasked && !S.wfPerms.canEdit) {
    toast('Chỉ editor của workflow mới có thể xem nội dung ẩn', 'error');
    return;
  }
  S._stepMasked = !S._stepMasked;
  inp.type = S._stepMasked ? 'password' : 'text';
  btn.textContent = S._stepMasked ? '🔒' : '👁';
  btn.title = S._stepMasked ? 'Hiện nội dung (chỉ owner)' : 'Ẩn nội dung (dành cho password)';
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
    masked: S._stepMasked || undefined,
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

/* ═══════════════════════════ SAVE DIALOG ══════════════════════════════════ */

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
      const data = await api('PUT', `/workflows/${S.wfId}`, payload);
      if (data) { S.wfApiKey = data.apiKey; syncEditorUI(); }
      toast('Workflow updated');
    } else {
      const data = await api('POST', '/workflows', payload);
      if (data) {
        S.wfId = data.id;
        S.wfApiKey = data.apiKey;
        S.wfPerms = data.myPerms || S.wfPerms;
        history.replaceState(null, '', `#/workflow/${data.id}`);
        syncEditorUI();
      }
      toast('Workflow saved');
    }
    closeModal();
  } catch (e) {
    toast(e.message, 'error');
    if (btn) { btn.disabled = false; btn.textContent = '💾 Save'; }
  }
}

/* ═══════════════════════════ FILE OPERATIONS ══════════════════════════════ */

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

/* ═══════════════════════════ WORKFLOW SETTINGS MODAL ═════════════════════ */

let _settingsTab = 'permissions';

async function openWorkflowSettings() {
  if (!S.wfId) return;
  _settingsTab = 'permissions';
  renderSettingsModal();
}

function renderSettingsModal() {
  const root = document.getElementById('modal-root');
  root.innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal settings-modal" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">⚙ Workflow Settings</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="settings-tabs">
          <button class="stab ${_settingsTab==='permissions'?'active':''}" onclick="switchSettingsTab('permissions')">🔑 Permissions</button>
          <button class="stab ${_settingsTab==='api'?'active':''}" onclick="switchSettingsTab('api')">🔌 API</button>
          <button class="stab ${_settingsTab==='triggers'?'active':''}" onclick="switchSettingsTab('triggers')">⚡ Triggers</button>
          <button class="stab ${_settingsTab==='schedule'?'active':''}" onclick="switchSettingsTab('schedule')">🕐 Schedule</button>
        </div>
        <div class="modal-body" id="settings-body" style="min-height:200px">
          <div class="loading">Loading...</div>
        </div>
      </div>
    </div>`;
  loadSettingsTab();
}

function switchSettingsTab(tab) {
  _settingsTab = tab;
  document.querySelectorAll('.stab').forEach(b => b.classList.toggle('active', b.textContent.toLowerCase().includes(tab.toLowerCase().slice(0,3))));
  loadSettingsTab();
}

async function loadSettingsTab() {
  const body = document.getElementById('settings-body');
  if (!body) return;
  body.innerHTML = '<div class="loading">Loading...</div>';
  try {
    if (_settingsTab === 'permissions') await renderPermissionsTab(body);
    else if (_settingsTab === 'api')    await renderApiTab(body);
    else if (_settingsTab === 'triggers') await renderTriggersTab(body);
    else if (_settingsTab === 'schedule') await renderScheduleTab(body);
  } catch (e) {
    body.innerHTML = `<div style="color:#dc2626;padding:10px">${esc(e.message)}</div>`;
  }
}

/* ── Tab 1: Permissions ──────────────────────────────────────────────────── */

async function renderPermissionsTab(body) {
  const perms = await api('GET', `/workflows/${S.wfId}/permissions`) || [];
  const allUsers = await api('GET', '/users') || [];

  const rows = perms.map(p => `
    <tr>
      <td>${esc(p.username)}</td>
      <td><input type="checkbox" ${p.canView?'checked':''} onchange="updatePerm(${p.id},'canView',this.checked,'${p.userId}')" /></td>
      <td><input type="checkbox" ${p.canRun?'checked':''} onchange="updatePerm(${p.id},'canRun',this.checked,'${p.userId}')" /></td>
      <td><input type="checkbox" ${p.canEdit?'checked':''} onchange="updatePerm(${p.id},'canEdit',this.checked,'${p.userId}')" /></td>
      <td><input type="checkbox" ${p.canDelete?'checked':''} onchange="updatePerm(${p.id},'canDelete',this.checked,'${p.userId}')" /></td>
      <td><button class="btn btn-danger btn-sm" onclick="deletePerm(${p.id})">✕</button></td>
    </tr>`).join('');

  const existingIds = new Set(perms.map(p => p.userId));
  const availUsers = allUsers.filter(u => !existingIds.has(u.id) && !u.is_admin);
  const userOpts = availUsers.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join('');

  body.innerHTML = `
    <div class="perm-note">Admins always have full access.</div>
    <table class="perm-table">
      <thead><tr><th>User</th><th>View</th><th>Run</th><th>Edit</th><th>Delete</th><th></th></tr></thead>
      <tbody id="perm-rows">${rows}</tbody>
    </table>
    <div class="perm-add-row">
      <select class="input" id="perm-user-sel" style="flex:1">${userOpts || '<option value="">No users available</option>'}</select>
      <label><input type="checkbox" id="pa-view" checked /> View</label>
      <label><input type="checkbox" id="pa-run" checked /> Run</label>
      <label><input type="checkbox" id="pa-edit" /> Edit</label>
      <label><input type="checkbox" id="pa-delete" /> Delete</label>
      <button class="btn btn-primary btn-sm" onclick="addPerm()">Add</button>
    </div>`;

  // Store perm data for inline updates
  window._permCache = {};
  perms.forEach(p => { window._permCache[p.id] = { ...p }; });
}

async function updatePerm(permId, field, value, userId) {
  const cache = window._permCache[permId];
  if (!cache) return;
  cache[field] = value;
  try {
    await api('POST', `/workflows/${S.wfId}/permissions`, {
      userId: cache.userId,
      canView: cache.canView,
      canRun: cache.canRun,
      canEdit: cache.canEdit,
      canDelete: cache.canDelete,
    });
  } catch (e) { toast(e.message, 'error'); }
}

async function deletePerm(permId) {
  try {
    await api('DELETE', `/workflows/${S.wfId}/permissions/${permId}`);
    delete window._permCache[permId];
    await loadSettingsTab();
  } catch (e) { toast(e.message, 'error'); }
}

async function addPerm() {
  const sel = document.getElementById('perm-user-sel');
  if (!sel || !sel.value) { toast('Select a user', 'error'); return; }
  const userId = parseInt(sel.value);
  const canView   = document.getElementById('pa-view')?.checked || false;
  const canRun    = document.getElementById('pa-run')?.checked  || false;
  const canEdit   = document.getElementById('pa-edit')?.checked || false;
  const canDelete = document.getElementById('pa-delete')?.checked || false;
  try {
    await api('POST', `/workflows/${S.wfId}/permissions`, { userId, canView, canRun, canEdit, canDelete });
    await loadSettingsTab();
    toast('Permission added');
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Tab 2: API ──────────────────────────────────────────────────────────── */

let _apiKeyRevealed = false;

async function renderApiTab(body) {
  const apiKey = S.wfApiKey || '(save workflow first to get API key)';
  const apiUrl = `${location.origin}/api/run/${S.wfId}?api_key=${apiKey}`;
  const maskedKey = apiKey.slice(0, 6) + '••••••••••••••••••••';
  const curlCmd = `curl -X POST "${apiUrl}"`;

  body.innerHTML = `
    <div class="api-section">
      <div class="form-group">
        <label class="form-label">API Key</label>
        <div class="input-with-btn">
          <input class="input" id="api-key-inp" type="password" value="${esc(apiKey)}" readonly />
          <button class="btn btn-secondary btn-sm" onclick="toggleApiKey()">👁</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">API Endpoint</label>
        <div class="input-with-btn">
          <input class="input" id="api-url-inp" value="${esc(apiUrl)}" readonly />
          <button class="btn btn-secondary btn-sm" onclick="copyText(document.getElementById('api-url-inp').value,'URL copied')">📋</button>
        </div>
      </div>
      <div class="form-group">
        <label class="form-label">Example cURL</label>
        <div class="code-block" id="curl-block">${esc(curlCmd)}</div>
        <button class="btn btn-secondary btn-sm" style="margin-top:6px" onclick="copyText(document.getElementById('curl-block').textContent,'cURL copied')">📋 Copy cURL</button>
      </div>
      <button class="btn btn-danger btn-sm" style="margin-top:10px" onclick="regenerateApiKey()">🔄 Regenerate API Key</button>
    </div>`;
}

function toggleApiKey() {
  const inp = document.getElementById('api-key-inp');
  if (!inp) return;
  inp.type = inp.type === 'password' ? 'text' : 'password';
}

async function regenerateApiKey() {
  if (!confirm('Regenerate API key? The old key will stop working.')) return;
  try {
    const data = await api('POST', `/workflows/${S.wfId}/permissions/apikey`);
    S.wfApiKey = data.apiKey;
    await loadSettingsTab();
    toast('API key regenerated');
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Tab 3: Triggers ─────────────────────────────────────────────────────── */

async function renderTriggersTab(body) {
  const triggers = await api('GET', `/workflows/${S.wfId}/triggers`) || [];
  const allWfs = S._allWorkflows.filter(w => w.id !== S.wfId);

  const rows = triggers.map(t => `
    <tr>
      <td>${esc(t.sourceWorkflowName)}</td>
      <td>${t.triggerType === 'on_complete' ? 'On complete' : `On step #${t.triggerStepIndex}`}</td>
      <td><button class="btn btn-danger btn-sm" onclick="deleteTrigger(${t.id})">✕</button></td>
    </tr>`).join('');

  const wfOpts = allWfs.map(w => `<option value="${w.id}">${esc(w.name)}</option>`).join('');

  body.innerHTML = `
    <p style="font-size:12px;color:#6b7280;margin-bottom:8px">Run this workflow when another workflow completes or reaches a step.</p>
    <table class="perm-table" style="margin-bottom:12px">
      <thead><tr><th>Source Workflow</th><th>When</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" style="color:#9ca3af;text-align:center">No triggers yet</td></tr>'}</tbody>
    </table>
    <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <select class="input" id="trig-wf" style="flex:1;min-width:140px">${wfOpts || '<option value="">No workflows</option>'}</select>
      <label style="display:flex;gap:4px;align-items:center;font-size:13px">
        <input type="radio" name="trig-type" value="on_complete" checked /> On complete
      </label>
      <label style="display:flex;gap:4px;align-items:center;font-size:13px">
        <input type="radio" name="trig-type" value="on_step" /> On step #
        <input class="input" type="number" id="trig-step" min="1" value="1" style="width:60px" />
      </label>
      <button class="btn btn-primary btn-sm" onclick="addTrigger()">Add</button>
    </div>`;
}

async function addTrigger() {
  const wfSel = document.getElementById('trig-wf');
  if (!wfSel || !wfSel.value) { toast('Select source workflow', 'error'); return; }
  const trigType = document.querySelector('input[name="trig-type"]:checked')?.value || 'on_complete';
  const stepIdx = trigType === 'on_step' ? parseInt(document.getElementById('trig-step')?.value || '1') : null;
  try {
    await api('POST', `/workflows/${S.wfId}/triggers`, {
      targetWorkflowId: wfSel.value,
      triggerType: trigType,
      triggerStepIndex: stepIdx,
    });
    await loadSettingsTab();
    toast('Trigger added');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteTrigger(triggerId) {
  try {
    await api('DELETE', `/workflows/${S.wfId}/triggers/${triggerId}`);
    await loadSettingsTab();
    toast('Trigger removed');
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Tab 4: Schedule ─────────────────────────────────────────────────────── */

async function renderScheduleTab(body) {
  const sched = await api('GET', `/workflows/${S.wfId}/schedule`);

  const tod = sched?.timeOfDay || '09:00';
  const dow = sched?.daysOfWeek || [];
  const dom = sched?.daysOfMonth || [];
  const active = sched?.isActive ?? true;

  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const dowChecks = dayNames.map((d, i) => `
    <label style="font-size:12px;display:flex;gap:3px;align-items:center">
      <input type="checkbox" value="${i}" ${dow.includes(i)?'checked':''} class="dow-cb" /> ${d}
    </label>`).join('');

  const domGrid = Array.from({length:31}, (_,i) => i+1).map(d => `
    <label style="font-size:11px;display:flex;gap:2px;align-items:center">
      <input type="checkbox" value="${d}" ${dom.includes(d)?'checked':''} class="dom-cb" /> ${d}
    </label>`).join('');

  body.innerHTML = `
    <div class="form-group">
      <label class="form-label" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="sched-active" ${active?'checked':''} />
        Schedule enabled
      </label>
    </div>
    <div class="form-group">
      <label class="form-label">Time of day</label>
      <input class="input" type="time" id="sched-time" value="${esc(tod)}" style="max-width:120px" />
    </div>
    <div class="form-group">
      <label class="form-label">Days of week (empty = every day)</label>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${dowChecks}</div>
    </div>
    <div class="form-group">
      <label class="form-label">Days of month (empty = every day)</label>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;max-width:280px">${domGrid}</div>
    </div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-primary btn-sm" onclick="saveSchedule()">💾 Save Schedule</button>
      ${sched ? `<button class="btn btn-danger btn-sm" onclick="deleteSchedule()">Delete</button>` : ''}
    </div>`;
}

async function saveSchedule() {
  const timeOfDay  = document.getElementById('sched-time')?.value || '09:00';
  const isActive   = document.getElementById('sched-active')?.checked ?? true;
  const daysOfWeek = [...document.querySelectorAll('.dow-cb:checked')].map(e => parseInt(e.value));
  const daysOfMonth = [...document.querySelectorAll('.dom-cb:checked')].map(e => parseInt(e.value));
  try {
    await api('PUT', `/workflows/${S.wfId}/schedule`, { timeOfDay, isActive, daysOfWeek, daysOfMonth });
    toast('Schedule saved');
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteSchedule() {
  if (!confirm('Delete schedule?')) return;
  try {
    await api('DELETE', `/workflows/${S.wfId}/schedule`);
    await loadSettingsTab();
    toast('Schedule deleted');
  } catch (e) { toast(e.message, 'error'); }
}

/* ═══════════════════════════ ADMIN PAGE ════════════════════════════════════ */

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
      <thead><tr><th>User</th><th>Role</th><th>Manager</th><th>Created</th><th></th></tr></thead>
      <tbody>
        ${users.map(u => `
          <tr>
            <td><div class="user-row-name">
              <div class="user-avatar">${esc(u.username[0].toUpperCase())}</div>
              <span>${esc(u.username)}</span>
              ${u.id === S.user.id ? '<span class="you-tag">(you)</span>' : ''}
            </div></td>
            <td><span class="badge-role ${u.is_admin ? 'admin' : 'user'}">${u.is_admin ? '⚡ Admin' : 'User'}</span></td>
            <td style="font-size:12px;color:#6b7280">${u.is_admin ? '—' : (u.managerUsername ? esc(u.managerUsername) : '<em>none</em>')}</td>
            <td style="color:#9ca3af;font-size:12px">${fmtDate(u.created_at)}</td>
            <td>
              <div class="table-actions">
                <button class="btn btn-ghost btn-sm" title="Change password"
                  onclick="openAdminChangePassword(${u.id},'${esc(u.username)}')">🔑</button>
                ${u.id !== S.user.id ? `
                <button class="btn btn-ghost btn-sm" title="${u.is_admin ? 'Remove admin' : 'Make admin'}"
                  onclick="toggleAdmin(${u.id},${u.is_admin})" style="color:${u.is_admin ? '#f97316' : '#2563eb'}">
                  ${u.is_admin ? '🔓' : '🛡'}
                </button>
                ${!u.is_admin ? `<button class="btn btn-ghost btn-sm" title="Change manager"
                  onclick="openChangeManager(${u.id},'${esc(u.username)}',${u.managerId||'null'})">👥</button>` : ''}
                <button class="btn btn-danger btn-sm" title="Delete" onclick="deleteUser(${u.id},'${esc(u.username)}')">✕</button>
                ` : ''}
              </div>
            </td>
          </tr>`).join('')}
      </tbody>
    </table>`;
}

function openAddUser() {
  // We need to fetch users to populate manager dropdown
  api('GET', '/users').then(users => {
    const nonAdminUsers = (users || []).filter(u => !u.is_admin);
    const mgrOpts = `<option value="">Default (first admin)</option>` +
      nonAdminUsers.map(u => `<option value="${u.id}">${esc(u.username)}</option>`).join('');

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
            <div class="form-group">
              <label class="form-label">Manager</label>
              <select class="input" id="nu-mgr">${mgrOpts}</select>
            </div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#374151">
              <input type="checkbox" id="nu-admin" style="accent-color:#2563eb" onchange="document.getElementById('nu-mgr').disabled=this.checked" />
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
  });
}

async function doAddUser() {
  const username = document.getElementById('nu-user')?.value.trim();
  const password = document.getElementById('nu-pass')?.value;
  const isAdmin  = document.getElementById('nu-admin')?.checked;
  const mgrVal   = document.getElementById('nu-mgr')?.value;
  const managerId = mgrVal ? parseInt(mgrVal) : null;
  if (!username || !password) { toast('Username and password required', 'error'); return; }
  if (password.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
  try {
    await api('POST', '/users', { username, password, isAdmin, managerId });
    closeModal();
    toast(`User "${username}" created`);
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function openChangeManager(userId, username, currentManagerId) {
  const users = await api('GET', '/users') || [];
  const opts = users
    .filter(u => u.id !== userId && !u.is_admin)
    .map(u => `<option value="${u.id}" ${u.id === currentManagerId ? 'selected' : ''}>${esc(u.username)}</option>`)
    .join('');

  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" style="max-width:340px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">👥 Change Manager — ${esc(username)}</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Manager</label>
            <select class="input" id="mgr-sel">
              <option value="">None</option>
              ${opts}
            </select>
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="doChangeManager(${userId})">Save</button>
        </div>
      </div>
    </div>`;
}

async function doChangeManager(userId) {
  const val = document.getElementById('mgr-sel')?.value;
  const managerId = val ? parseInt(val) : 0; // 0 = clear
  try {
    await api('PATCH', `/users/${userId}`, { managerId });
    closeModal();
    toast('Manager updated');
    await loadUsers();
  } catch (e) { toast(e.message, 'error'); }
}

async function deleteUser(id, username) {
  if (!confirm(`Delete user "${username}"? Their workflows will survive (owner becomes 'deleted').`)) return;
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

/* ── Change own password ────────────────────────────────────────────────── */

function openChangePassword() {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" style="max-width:360px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">🔑 Change Password</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">Current Password *</label>
            <input class="input" type="password" id="cp-current" placeholder="Enter current password" autocomplete="current-password" />
          </div>
          <div class="form-group">
            <label class="form-label">New Password *</label>
            <input class="input" type="password" id="cp-new" placeholder="Min. 6 characters" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label">Confirm New Password *</label>
            <input class="input" type="password" id="cp-confirm" placeholder="Repeat new password" autocomplete="new-password" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="doChangePassword()">Update Password</button>
        </div>
      </div>
    </div>`;
  document.getElementById('cp-current').focus();
}

async function doChangePassword() {
  const currentPassword = document.getElementById('cp-current')?.value;
  const newPassword     = document.getElementById('cp-new')?.value;
  const confirm         = document.getElementById('cp-confirm')?.value;
  if (!currentPassword || !newPassword) { toast('All fields are required', 'error'); return; }
  if (newPassword.length < 6) { toast('New password must be at least 6 characters', 'error'); return; }
  if (newPassword !== confirm) { toast('Passwords do not match', 'error'); return; }
  try {
    await api('PUT', '/auth/password', { currentPassword, newPassword });
    closeModal();
    toast('Password updated successfully');
  } catch (e) { toast(e.message, 'error'); }
}

/* ── Admin change any user's password ──────────────────────────────────── */

function openAdminChangePassword(userId, username) {
  document.getElementById('modal-root').innerHTML = `
    <div class="modal-overlay" onclick="closeModal(event)">
      <div class="modal" style="max-width:360px" onclick="event.stopPropagation()">
        <div class="modal-header">
          <span class="modal-title">🔑 Reset Password — ${esc(username)}</span>
          <button class="btn-close-modal" onclick="closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="form-group">
            <label class="form-label">New Password *</label>
            <input class="input" type="password" id="acp-new" placeholder="Min. 6 characters" autocomplete="new-password" />
          </div>
          <div class="form-group">
            <label class="form-label">Confirm New Password *</label>
            <input class="input" type="password" id="acp-confirm" placeholder="Repeat new password" autocomplete="new-password" />
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
          <button class="btn btn-primary" onclick="doAdminChangePassword(${userId},'${esc(username)}')">Reset Password</button>
        </div>
      </div>
    </div>`;
  document.getElementById('acp-new').focus();
}

async function doAdminChangePassword(userId, username) {
  const newPassword = document.getElementById('acp-new')?.value;
  const confirm     = document.getElementById('acp-confirm')?.value;
  if (!newPassword) { toast('Password is required', 'error'); return; }
  if (newPassword.length < 6) { toast('Password must be at least 6 characters', 'error'); return; }
  if (newPassword !== confirm) { toast('Passwords do not match', 'error'); return; }
  try {
    await api('PUT', `/users/${userId}/password`, { newPassword });
    closeModal();
    toast(`Password for "${username}" updated`);
  } catch (e) { toast(e.message, 'error'); }
}
