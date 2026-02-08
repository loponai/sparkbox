// ==========================================
// SparkBox — Friendly Dashboard Frontend
// ==========================================

(function () {
  'use strict';

  let socket = null;
  let currentLogStream = null;

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => document.querySelectorAll(s);
  function show(el) { el.classList.remove('hidden'); el.classList.add('active'); }
  function hide(el) { el.classList.add('hidden'); el.classList.remove('active'); }

  // --- Dynamic metadata (loaded from API) ---

  let _serviceMeta = {};   // keyed by container name (e.g. 'sb-pihole')
  let _moduleMeta = {};    // keyed by module id (e.g. 'privacy')
  let _criticalSet = new Set();
  let _storeData = null;   // cached /api/modules/store response

  const CATEGORY_LABELS = {
    infrastructure: 'Infrastructure',
    privacy: 'Privacy & Security',
    productivity: 'Productivity',
    cloud: 'Cloud & Files',
    network: 'Networking',
    system: 'System',
    tools: 'Tools',
    media: 'Media',
    documents: 'Documents',
    development: 'Development',
    automation: 'Automation',
    communication: 'Communication',
    other: 'Other'
  };

  // Load metadata from /api/modules/store and build SERVICE_META + MODULE_META dynamically
  async function loadMetadata() {
    if (_storeData) return; // already loaded
    try {
      const mods = await api('GET', '/modules/store');
      _storeData = mods;

      _serviceMeta = {};
      _moduleMeta = {};
      _criticalSet = new Set();

      for (const mod of mods) {
        // Build MODULE_META
        const theme = mod.theme || {};
        _moduleMeta[mod.id] = {
          emoji: theme.emoji || '\uD83D\uDCE6',
          color: theme.color || '#6e6e73',
          bg: theme.bg || '#f5f5f7',
          friendly: mod.name,
          desc: mod.description || ''
        };

        // Build critical containers set
        if (mod.critical_services) {
          for (const cs of mod.critical_services) {
            _criticalSet.add(cs);
          }
        }

        // Build SERVICE_META from services
        if (mod.services) {
          for (const svc of mod.services) {
            const containerName = 'sb-' + svc.id;
            _serviceMeta[containerName] = {
              emoji: theme.emoji || '\uD83D\uDCE6',
              color: theme.color || '#6e6e73',
              bg: theme.bg || '#f5f5f7',
              name: svc.name || svc.id,
              port: svc.port || null,
              https: svc.https || false,
              desc: svc.description || '',
              tip: svc.tip || ''
            };
          }
        }
      }
    } catch {
      // If store endpoint fails, metadata stays empty — graceful fallback
    }
  }

  function isCritical(containerName) {
    return _criticalSet.has(containerName);
  }

  // --- API ---

  async function api(method, path, body) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(`/api${path}`, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed`);
    return data;
  }

  // --- Helpers ---

  function formatBytes(b) {
    if (!b) return '0 B';
    const k = 1024;
    const s = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(b) / Math.log(k));
    return parseFloat((b / Math.pow(k, i)).toFixed(1)) + ' ' + s[i];
  }

  function getGreeting() {
    const h = new Date().getHours();
    if (h < 12) return 'Good morning! \u2600\uFE0F';
    if (h < 17) return 'Good afternoon! \uD83D\uDC4B';
    return 'Good evening! \uD83C\uDF19';
  }

  function toast(msg, type = 'info') {
    const wrap = $('#toast-wrap');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', 'alert');
    el.textContent = msg;
    wrap.appendChild(el);
    setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3500);
  }

  // --- Loading Button Helper ---
  function btnLoading(btn, loading) {
    if (!btn) return;
    if (loading) {
      btn.classList.add('btn-loading');
      btn.disabled = true;
      btn._origText = btn.textContent;
    } else {
      btn.classList.remove('btn-loading');
      btn.disabled = false;
      if (btn._origText) btn.textContent = btn._origText;
    }
  }

  // Escape HTML to prevent XSS from API data
  function esc(s) {
    if (!s) return '';
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
  }

  function meta(name) {
    return _serviceMeta[name] || { emoji: '\uD83D\uDCE6', color: '#6e6e73', bg: '#f5f5f7', name: name.replace('sb-', ''), port: null, desc: '', tip: '' };
  }

  // --- Confirm Dialog ---

  function confirm(title, message) {
    return new Promise((resolve) => {
      const overlay = $('#confirm-overlay');
      $('#confirm-title').textContent = title;
      $('#confirm-message').textContent = message;
      show(overlay);

      function cleanup() {
        hide(overlay);
        $('#confirm-ok').removeEventListener('click', onOk);
        $('#confirm-cancel').removeEventListener('click', onCancel);
      }
      function onOk() { cleanup(); resolve(true); }
      function onCancel() { cleanup(); resolve(false); }

      $('#confirm-ok').addEventListener('click', onOk);
      $('#confirm-cancel').addEventListener('click', onCancel);
    });
  }

  // --- Auth ---

  async function checkAuth() {
    try {
      const s = await api('GET', '/auth/status');
      if (s.authenticated) { showDashboard(); }
      else if (s.firstRun) { showFirstRun(); }
      else { showLogin(); }
    } catch { showLogin(); }
  }

  function showLogin() {
    show($('#login-screen'));
    hide($('#dashboard'));
    $('#login-title').textContent = 'Welcome to SparkBox';
    $('#login-sub').textContent = 'Your private server is ready for you.';
    $('#login-password').placeholder = 'Enter your password';
    $('#login-btn').textContent = 'Let me in';
    $('#login-password').focus();
  }

  function showFirstRun() {
    show($('#login-screen'));
    hide($('#dashboard'));
    $('#login-title').textContent = 'Set Up Your Password';
    $('#login-sub').textContent = 'This is your first time here! Create a password to protect your dashboard (minimum 8 characters).';
    $('#login-password').placeholder = 'Create a password (8+ characters)';
    $('#login-btn').textContent = 'Set Password & Continue';
    $('#login-password').focus();
  }

  async function showDashboard() {
    hide($('#login-screen'));
    show($('#dashboard'));
    await loadMetadata();
    initSocket();
    loadHome();
    loadSystemInfo();
    renderHelpServices();
    showOnboarding();
  }

  $('#login-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const btn = $('#login-btn');
    btnLoading(btn, true);
    try {
      const result = await api('POST', '/login', { password: $('#login-password').value });
      if (result.firstRun) {
        toast('Password set! Welcome to SparkBox!', 'success');
        sessionStorage.setItem('sb-first-run', '1');
      }
      showDashboard();
    } catch (err) {
      const el = $('#login-error');
      el.textContent = err.message;
      el.classList.remove('hidden');
    } finally {
      btnLoading(btn, false);
    }
  });

  $('#logout-btn').addEventListener('click', async () => {
    try { await api('POST', '/logout'); } catch {}
    if (socket) socket.disconnect(); socket = null;
    _storeData = null; // clear cache on logout
    showLogin();
  });

  // --- Navigation ---

  $$('.tab').forEach(t => t.addEventListener('click', (e) => {
    e.preventDefault();
    switchPage(t.dataset.page);
  }));

  function switchPage(page) {
    $$('.tab').forEach(t => {
      const isActive = t.dataset.page === page;
      t.classList.toggle('active', isActive);
      if (isActive) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    $$('.page').forEach(p => { p.classList.add('hidden'); p.classList.remove('active'); });
    const el = $(`#page-${page}`);
    if (el) { el.classList.remove('hidden'); el.classList.add('active'); }

    switch (page) {
      case 'home': loadHome(); break;
      case 'apps': loadApps(); break;
      case 'logs': loadLogs(); break;
      case 'settings': loadSettings(); break;
    }
  }

  // --- Socket ---

  function initSocket() {
    if (socket) return;
    socket = io();
    socket.on('status:update', renderHome);
    socket.on('hoststats:update', renderGauges);
    socket.on('logs:data', ({ line }) => {
      const o = $('#log-output');
      o.textContent += line;
      o.scrollTop = o.scrollHeight;
    });
    socket.emit('status:subscribe');
    socket.emit('hoststats:subscribe');
    socket.on('connect', () => {
      socket.emit('status:subscribe');
      socket.emit('hoststats:subscribe');
    });
  }

  // --- System Gauges ---

  function updateGauge(id, percent) {
    const ring = $(`#${id}`);
    if (!ring) return;
    const fill = ring.querySelector('.gauge-fill');
    const text = ring.querySelector('.gauge-text');
    if (!fill || !text) return;
    fill.setAttribute('stroke-dasharray', `${percent}, 100`);
    fill.classList.remove('warn', 'danger');
    if (percent > 80) fill.classList.add('danger');
    else if (percent > 60) fill.classList.add('warn');
    text.textContent = `${percent}%`;
  }

  function formatUptime(seconds) {
    const d = Math.floor(seconds / 86400);
    const h = Math.floor((seconds % 86400) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    if (d > 0) return `${d}d ${h}h`;
    if (h > 0) return `${h}h ${m}m`;
    return `${m}m`;
  }

  function renderGauges(stats) {
    updateGauge('gauge-cpu', stats.cpu.percent);
    updateGauge('gauge-ram', stats.memory.percent);
    updateGauge('gauge-disk', stats.disk.percent);

    const ramDetail = $(`#gauge-ram-detail`);
    if (ramDetail) ramDetail.textContent = `${formatBytes(stats.memory.used)} / ${formatBytes(stats.memory.total)}`;

    const diskDetail = $(`#gauge-disk-detail`);
    if (diskDetail && stats.disk.total) diskDetail.textContent = `${formatBytes(stats.disk.used)} / ${formatBytes(stats.disk.total)}`;

    const uptime = $(`#gauge-uptime`);
    if (uptime) uptime.textContent = formatUptime(stats.uptime);
  }

  // --- HOME ---

  async function loadHome() {
    try {
      const containers = await api('GET', '/containers');
      renderHome(containers);
    } catch (err) { toast('Could not load services.', 'error'); }
  }

  function renderHome(containers) {
    $('#greeting').textContent = getGreeting();

    const running = containers.filter(c => c.state === 'running').length;
    const total = containers.length;

    if (running === total) {
      $('#hero-sub').textContent = "All your services are humming along perfectly.";
    } else if (running === 0) {
      $('#hero-sub').textContent = "Looks like nothing's running. Let's fix that!";
    } else {
      $('#hero-sub').textContent = `${running} of ${total} services are up. Almost there!`;
    }

    $('#stat-running').textContent = running;
    $('#stat-total').textContent = total;

    api('GET', '/modules').then(mods => {
      $('#stat-modules').textContent = mods.filter(m => m.enabled).length;
    }).catch(() => {});

    // Service cards with descriptions
    const withUI = containers.filter(c => {
      const m = meta(c.name);
      return m.port !== null;
    });

    $('#services-grid').innerHTML = withUI.map(c => {
      const m = meta(c.name);
      const on = c.state === 'running';
      const proto = m.https ? 'https' : 'http';
      const url = m.port ? `${proto}://${location.hostname}:${m.port}${m.path || ''}` : '#';
      return `
        <a href="${url}" target="_blank" class="service-card" title="${m.tip || ''}">
          <div class="service-icon" style="background:${m.bg}; color:${m.color}">${m.emoji}</div>
          <div class="service-info">
            <div class="service-name">${m.name}</div>
            <div class="service-desc">${m.desc || ''}</div>
            <div class="service-status" style="color:${on ? 'var(--green)' : 'var(--text-muted)'}">
              <span class="status-dot ${on ? 'on' : 'off'}"></span>
              ${on ? 'Running' : 'Stopped'}
            </div>
          </div>
        </a>`;
    }).join('');

    // Running list
    $('#running-list').innerHTML = containers.map(c => {
      const m = meta(c.name);
      const on = c.state === 'running';
      const critical = isCritical(c.name);
      return `
        <div class="running-row">
          <div class="running-icon" style="background:${m.bg}; color:${m.color}">${m.emoji}</div>
          <div class="running-info">
            <div class="running-name">${esc(m.name)} ${critical ? '<span class="critical-badge">Critical</span>' : ''}</div>
            <div class="running-detail">${esc(c.status || c.state)}</div>
          </div>
          <div class="running-stats">
            <div class="mini-stat">
              <div class="mini-stat-val" id="cpu-${c.id}">--</div>
              <div class="mini-stat-label">CPU</div>
            </div>
            <div class="mini-stat">
              <div class="mini-stat-val" id="mem-${c.id}">--</div>
              <div class="mini-stat-label">MEM</div>
            </div>
          </div>
          <div class="running-actions">
            ${on
              ? `<button class="btn-pill" onclick="sbAction('restart','${c.id}','${m.name}',${critical},this)" aria-label="Restart ${m.name}">Restart</button>
                 <button class="btn-pill danger" onclick="sbAction('stop','${c.id}','${m.name}',${critical},this)" aria-label="Stop ${m.name}">Stop</button>`
              : `<button class="btn-pill" onclick="sbAction('start','${c.id}','${m.name}',false,this)" aria-label="Start ${m.name}">Start</button>`
            }
          </div>
        </div>`;
    }).join('');

    // Load stats
    containers.filter(c => c.state === 'running').forEach(c => {
      api('GET', `/containers/${c.id}/stats`).then(s => {
        const cpuEl = $(`#cpu-${c.id}`);
        const memEl = $(`#mem-${c.id}`);
        if (cpuEl) cpuEl.textContent = s.cpu.toFixed(1) + '%';
        if (memEl) memEl.textContent = formatBytes(s.memory.usage);
      }).catch(() => {});
    });
  }

  window.sbAction = async function (action, id, name, isCrit, btnEl) {
    if (action === 'stop' && isCrit) {
      const ok = await confirm(
        `Stop ${name}?`,
        `${name} is a critical service. Stopping it may break other services or lock you out. Are you sure?`
      );
      if (!ok) return;
    } else if (action === 'stop') {
      const ok = await confirm(`Stop ${name}?`, `This will shut down ${name}. You can restart it later.`);
      if (!ok) return;
    } else if (action === 'restart' && isCrit) {
      const ok = await confirm(
        `Restart ${name}?`,
        `${name} is a critical service. It will be briefly unavailable during restart.`
      );
      if (!ok) return;
    }

    // Disable all action buttons for this container to prevent double-fire
    const row = btnEl ? btnEl.closest('.running-row') : null;
    const btns = row ? row.querySelectorAll('.btn-pill') : [];
    btns.forEach(b => btnLoading(b, true));

    try {
      await api('POST', `/containers/${id}/${action}`);
      toast(`${name} ${action === 'restart' ? 'restarted' : action === 'stop' ? 'stopped' : 'started'}!`, 'success');
      setTimeout(loadHome, 800);
    } catch (err) {
      toast(err.message, 'error');
      btns.forEach(b => btnLoading(b, false));
    }
  };

  // --- APPS (App Store) ---

  let currentStoreFilter = 'all';

  async function loadApps() {
    try {
      const mods = await api('GET', '/modules/store');
      renderApps(mods);
    } catch {
      // Fallback to basic endpoint
      try {
        const mods = await api('GET', '/modules');
        renderAppsBasic(mods);
      } catch (err) { toast('Could not load modules.', 'error'); }
    }
  }

  function renderAppsBasic(modules) {
    const grid = $('#apps-grid');
    grid.innerHTML = modules.map(m => {
      const mm = _moduleMeta[m.id] || { emoji: '\uD83D\uDCE6', color: '#6e6e73', bg: '#f5f5f7', friendly: m.name, desc: m.description };
      return `
        <div class="app-card ${m.enabled ? 'enabled' : ''} ${m.required ? 'required' : ''}">
          <div class="app-top">
            <div class="app-icon" style="background:${mm.bg}; color:${mm.color}">${mm.emoji}</div>
            <div class="toggle-wrap">
              <label class="toggle">
                <input type="checkbox" ${m.enabled ? 'checked' : ''} ${m.required ? 'disabled' : ''}
                  onchange="sbToggle('${m.id}', this.checked, '${mm.friendly}')"
                  aria-label="Toggle ${mm.friendly} ${m.required ? '(always on)' : ''}">
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="app-name">${mm.friendly}</div>
          <div class="app-desc">${mm.desc || m.description}</div>
          <div class="app-meta">
            <span class="app-tag ${m.required ? 'required' : 'optional'}">${m.required ? 'Always On' : 'Optional'}</span>
            <span class="app-tag ram">${m.ram}</span>
          </div>
        </div>`;
    }).join('');
  }

  function renderApps(modules) {
    // Build category filter bar
    const categories = [...new Set(modules.map(m => m.category))];
    const filterBar = $('#store-filters');
    if (filterBar) {
      filterBar.innerHTML = `<button class="store-filter ${currentStoreFilter === 'all' ? 'active' : ''}" onclick="sbStoreFilter('all')">All</button>` +
        categories.map(cat =>
          `<button class="store-filter ${currentStoreFilter === cat ? 'active' : ''}" onclick="sbStoreFilter('${cat}')">${CATEGORY_LABELS[cat] || cat}</button>`
        ).join('');
    }

    // Filter modules
    const filtered = currentStoreFilter === 'all' ? modules : modules.filter(m => m.category === currentStoreFilter);

    // Render cards
    const grid = $('#apps-grid');
    grid.innerHTML = filtered.map(m => {
      const theme = m.theme || {};
      const emoji = theme.emoji || '\uD83D\uDCE6';
      const color = theme.color || '#6e6e73';
      const bg = theme.bg || '#f5f5f7';
      const escapedName = (m.name || '').replace(/'/g, "\\'");
      return `
        <div class="app-card ${m.enabled ? 'enabled' : ''} ${m.required ? 'required' : ''}">
          <div class="app-top">
            <div class="app-icon" style="background:${bg}; color:${color}">${emoji}</div>
            <div class="toggle-wrap">
              <label class="toggle">
                <input type="checkbox" ${m.enabled ? 'checked' : ''} ${m.required ? 'disabled' : ''}
                  onchange="sbToggle('${m.id}', this.checked, '${escapedName}')"
                  aria-label="Toggle ${m.name} ${m.required ? '(always on)' : ''}">
                <span class="toggle-track"></span>
              </label>
            </div>
          </div>
          <div class="app-name">${esc(m.name)}</div>
          ${m.tagline ? `<div class="app-tagline">${esc(m.tagline)}</div>` : ''}
          <div class="app-desc">${esc(m.description)}</div>
          ${m.services && m.services.length ? `
            <div class="app-services">
              <div class="app-services-title">Included services</div>
              ${m.services.map(svc => `
                <div class="app-service-row">
                  <span class="app-service-name">${esc(svc.name)}</span>
                  ${svc.port ? `<span class="app-service-port">:${svc.port}</span>` : ''}
                </div>`).join('')}
            </div>` : ''}
          ${m.tips && m.tips.length ? `
            <div class="app-tips">
              ${m.tips.map(t => `<div class="app-tip">${esc(t)}</div>`).join('')}
            </div>` : ''}
          <div class="app-meta">
            <span class="app-tag ${m.required ? 'required' : 'optional'}">${m.required ? 'Always On' : 'Optional'}</span>
            <span class="app-tag ram">${m.ram}</span>
            <span class="app-tag category">${CATEGORY_LABELS[m.category] || m.category}</span>
          </div>
        </div>`;
    }).join('');

    // Update store stats
    const enabledCount = modules.filter(m => m.enabled && !m.required).length;
    const totalOptional = modules.filter(m => !m.required).length;
    const storeStats = $('#store-stats');
    if (storeStats) {
      storeStats.textContent = `${enabledCount} of ${totalOptional} optional modules enabled`;
    }
  }

  window.sbStoreFilter = function (cat) {
    currentStoreFilter = cat;
    loadApps();
  };

  window.sbToggle = async function (id, on, friendlyName) {
    if (!on) {
      const ok = await confirm(
        `Disable ${friendlyName}?`,
        `This will stop all services in the ${friendlyName} module. You can re-enable it anytime.`
      );
      if (!ok) { loadApps(); return; }
    }
    // Disable all toggles while the operation is in progress
    $$('.toggle input').forEach(inp => { inp.disabled = true; });
    toast(`${on ? 'Enabling' : 'Disabling'} ${friendlyName}...`, 'info');
    try {
      await api('POST', `/modules/${id}/${on ? 'enable' : 'disable'}`);
      toast(`${friendlyName} ${on ? 'enabled' : 'disabled'}!`, 'success');
      _storeData = null; // bust metadata cache
      await loadMetadata();
      loadApps();
    } catch (err) { toast(err.message, 'error'); loadApps(); }
  };

  // --- LOGS ---

  async function loadLogs() {
    try {
      const containers = await api('GET', '/containers');
      const sel = $('#log-select');
      sel.innerHTML = '<option value="">Pick a service...</option>' +
        containers.map(c => {
          const m = meta(c.name);
          return `<option value="${c.id}">${m.emoji} ${m.name}</option>`;
        }).join('');
    } catch (err) { toast('Could not load services.', 'error'); }
  }

  $('#log-select').addEventListener('change', (e) => {
    const id = e.target.value;
    const o = $('#log-output');
    o.textContent = '';
    if (currentLogStream) { socket.emit('logs:unsubscribe'); currentLogStream = null; }
    if (id) {
      currentLogStream = id;
      socket.emit('logs:subscribe', id);
      o.textContent = 'Connecting...\n';
    } else {
      o.textContent = 'Pick a service above to see its logs here.';
    }
  });

  // --- SETTINGS ---

  async function loadSettings() {
    try {
      const [cfg, schema] = await Promise.all([
        api('GET', '/config'),
        api('GET', '/config/schema').catch(() => null)
      ]);
      renderSettings(cfg, schema);
      const backups = await api('GET', '/backups');
      renderBackups(backups);
    } catch (err) { toast('Could not load settings.', 'error'); }
  }

  function renderSettings(cfg, schema) {
    const isSecret = (k) => /PASSWORD|SECRET|TOKEN|KEY|HASH/.test(k);

    // If we have a dynamic schema, use it
    if (schema && schema.length) {
      $('#settings-cards').innerHTML = schema.map(group => {
        const hasDangerous = group.keys.some(k => k.dangerous);
        const rows = group.keys.filter(k => k.key in cfg || k.config_editable === false).map(k => {
          return `
          <div class="setting-row ${k.dangerous ? 'dangerous' : ''}">
            <label class="setting-label">
              ${esc(k.label)}
              ${k.tip ? `<span class="setting-tip" title="${esc(k.tip)}">i</span>` : ''}
              ${k.dangerous ? '<span class="danger-badge">Don\'t change</span>' : ''}
            </label>
            <input class="setting-input" type="${isSecret(k.key) ? 'password' : 'text'}"
                   data-key="${k.key}" value="${cfg[k.key] || ''}" placeholder="${isSecret(k.key) ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : ''}"
                   ${k.dangerous || k.config_editable === false ? 'readonly' : ''}>
          </div>`;
        }).join('');
        if (!rows) return '';
        return `
          <div class="settings-group ${hasDangerous ? 'dangerous-group' : ''}">
            <div class="settings-group-title">
              ${esc(group.title)}
              ${hasDangerous ? '<span class="group-warning">Contains security keys \u2014 be careful!</span>' : ''}
            </div>
            ${rows}
          </div>`;
      }).join('');
      return;
    }

    // Fallback: render all config keys in a single group
    $('#settings-cards').innerHTML = `
      <div class="settings-group">
        <div class="settings-group-title">Configuration</div>
        ${Object.entries(cfg).map(([k, v]) => `
          <div class="setting-row">
            <label class="setting-label">${esc(k)}</label>
            <input class="setting-input" type="${isSecret(k) ? 'password' : 'text'}"
                   data-key="${k}" value="${v || ''}" placeholder="${isSecret(k) ? '\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022' : ''}">
          </div>`).join('')}
      </div>`;
  }

  $('#btn-save-config').addEventListener('click', async () => {
    const updates = {};
    $$('#settings-cards .setting-input').forEach(inp => {
      if (inp.value !== '********' && !inp.readOnly) updates[inp.dataset.key] = inp.value;
    });

    if (Object.keys(updates).length === 0) {
      toast('No changes to save.', 'info');
      return;
    }

    const ok = await confirm(
      'Save settings?',
      'This will update your server configuration. Some changes may require a service restart to take effect.'
    );
    if (!ok) return;

    const btn = $('#btn-save-config');
    btnLoading(btn, true);
    try {
      await api('PUT', '/config', updates);
      toast('Settings saved!', 'success');
    } catch (err) { toast(err.message, 'error'); }
    finally { btnLoading(btn, false); }
  });

  function renderBackups(list) {
    const el = $('#backup-list');
    if (!list.length) { el.innerHTML = '<p style="color:var(--text-muted); font-size:0.9rem;">No backups yet. Create your first one!</p>'; return; }
    el.innerHTML = list.map(b => `
      <div class="backup-row">
        <div class="backup-row-info">
          <span class="backup-row-name">${b.filename}${b.encrypted ? ' <span class="badge-encrypted">\uD83D\uDD12 Encrypted</span>' : ''}</span>
          <span class="backup-row-meta">${formatBytes(b.size)} \u00b7 ${new Date(b.created).toLocaleDateString()}</span>
        </div>
        <a href="/api/backups/${b.filename}" class="btn-pill" download>Download</a>
      </div>`).join('');
  }

  $('#btn-create-backup').addEventListener('click', async () => {
    const btn = $('#btn-create-backup');
    btnLoading(btn, true);
    try {
      await api('POST', '/backup');
      toast('Backup created!', 'success');
      const backups = await api('GET', '/backups');
      renderBackups(backups);
    } catch (err) { toast(err.message, 'error'); }
    finally { btnLoading(btn, false); }
  });

  // --- Help Page ---

  function renderHelpServices() {
    const el = $('#help-services');
    if (!el) return;
    el.innerHTML = Object.entries(_serviceMeta)
      .filter(([, m]) => m.desc)
      .map(([key, m]) => `
        <div class="help-service-card">
          <div class="help-service-icon" style="background:${m.bg}; color:${m.color}">${m.emoji}</div>
          <div class="help-service-info">
            <div class="help-service-name">${m.name}</div>
            <div class="help-service-desc">${m.desc}</div>
            ${m.tip ? `<div class="help-service-tip">${m.tip}</div>` : ''}
          </div>
        </div>`
      ).join('');
  }

  // --- Onboarding ---

  function showOnboarding() {
    if (localStorage.getItem('sb-onboarding-dismissed')) return;
    const isFirstRun = sessionStorage.getItem('sb-first-run');
    // Show onboarding for first-run users, or anyone who hasn't dismissed it
    const banner = $('#onboarding-banner');
    if (!banner) return;
    banner.innerHTML = `
      <button class="onboarding-dismiss" onclick="sbDismissOnboarding()" aria-label="Dismiss welcome guide">&times;</button>
      <h2>Welcome to your SparkBox server!</h2>
      <p>${isFirstRun ? 'Your password is set and you\'re all ready to go.' : 'Here\'s a quick guide to get you started.'}</p>
      <div class="onboarding-steps">
        <div class="onboarding-step">
          <strong>1. Check Home</strong>
          See all your services and their status at a glance.
        </div>
        <div class="onboarding-step">
          <strong>2. Toggle Apps</strong>
          Turn features on/off in the Apps tab. Each module is a group of related services.
        </div>
        <div class="onboarding-step">
          <strong>3. Read Help</strong>
          The Help tab explains every service in plain English.
        </div>
      </div>`;
    banner.classList.remove('hidden');
  }

  window.sbDismissOnboarding = function () {
    localStorage.setItem('sb-onboarding-dismissed', '1');
    const banner = $('#onboarding-banner');
    if (banner) banner.classList.add('hidden');
  };

  // --- System Info ---

  async function loadSystemInfo() {
    try {
      const info = await api('GET', '/system');
      $('#host-pill').textContent = `${info.hostname} \u00b7 ${info.cpus} CPU \u00b7 ${formatBytes(info.memory)}`;
    } catch {
      $('#host-pill').textContent = '';
    }
  }

  // --- Init ---
  checkAuth();
})();
