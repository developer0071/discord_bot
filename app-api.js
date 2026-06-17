// ── Dashboard API layer ───────────────────────────────────────────────────────
// Lives at the site root (served by Vercel or the bot). Connects the dashboard UI
// to the bot's backend API. On first load it asks for the backend URL + password
// (stored in localStorage). Loaded after the page's inline script, so it can read
// the global `members`/`queue` arrays and override the action functions.

(function () {
  // Backend API URL (the bot's Express server, exposed over HTTPS).
  // The frontend on Vercel calls this automatically — no prompt needed.
  // ⚠️ If your Cloudflare tunnel URL changes (it does on restart unless it's a
  // named tunnel), update this one line and redeploy. A localStorage override
  // via setBackend('https://...') also works without redeploying.
  const DEFAULT_API_BASE = 'https://api.hunterstar.online';

  function getApiBase() {
    return (localStorage.getItem('dash_api') || DEFAULT_API_BASE).replace(/\/+$/, '');
  }

  // ── Auth (Discord OAuth → signed session token) ──
  function getToken() { return localStorage.getItem('dash_token') || ''; }
  function setToken(t) { if (t) localStorage.setItem('dash_token', t); else localStorage.removeItem('dash_token'); }

  // After returning from Discord login the token arrives in the URL fragment.
  (function captureToken() {
    const m = location.hash.match(/(?:^|#|&)token=([^&]+)/);
    if (m) { setToken(decodeURIComponent(m[1])); history.replaceState(null, '', location.pathname + location.search); }
  })();

  window.login = function () {
    const back = location.origin + location.pathname;
    location.href = getApiBase() + '/auth/discord/login?redirect=' + encodeURIComponent(back);
  };
  window.logout = function () { setToken(''); location.reload(); };

  window.dashboardTier = 'mod';

  async function api(method, path, body) {
    const res = await fetch(getApiBase() + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) {
      setToken('');
      showLoginOverlay();
      throw new Error('Not authenticated');
    }
    if (res.status === 403) {
      const authPaths = ['/api/data', '/api/me'];
      if (authPaths.some((p) => path.startsWith(p))) {
        setToken('');
        showLoginOverlay("Your Discord account doesn't have permission to use this dashboard.");
        throw new Error('Not authenticated');
      }
      const e = await res.json().catch(() => ({}));
      throw new Error(e.error || 'Permission denied');
    }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + res.status)); }
    return res.json();
  }
  window.api = api;
  window.isReadOnlyDashboard = function () { return window.dashboardTier === 'readonly'; };
  window.getApiBase = getApiBase;
  // Console helpers to reconfigure: setBackend('https://...'), then reload.
  window.setBackend = (url) => { localStorage.setItem('dash_api', (url || '').replace(/\/+$/, '')); location.reload(); };

  // ── Login overlay (shown whenever there is no valid session) ──
  function showLoginOverlay(message) {
    const existing = document.getElementById('loginOverlay');
    if (existing) {
      if (message) { const mEl = document.getElementById('loginOverlayMsg'); if (mEl) mEl.textContent = message; }
      return;
    }
    const el = document.createElement('div');
    el.id = 'loginOverlay';
    el.style.cssText = 'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;background:#0b0b0f;';
    el.innerHTML =
      '<div style="text-align:center;font-family:system-ui,Segoe UI,sans-serif;color:#f5f5f7;max-width:340px;padding:32px;">' +
        '<img src="' + getApiBase() + '/logo.png" alt="" style="width:72px;height:72px;border-radius:16px;margin-bottom:20px;" onerror="this.style.display=\'none\'">' +
        '<h1 style="font-size:22px;margin:0 0 8px;">Dashboard login</h1>' +
        '<p id="loginOverlayMsg" style="opacity:.7;margin:0 0 24px;font-size:14px;">' + (message || 'Sign in with Discord to manage the regiment.') + '</p>' +
        '<button onclick="login()" style="cursor:pointer;border:none;border-radius:10px;padding:12px 22px;font-size:15px;font-weight:600;color:#fff;background:#5865F2;display:inline-flex;align-items:center;gap:10px;">' +
          '<i class="fab fa-discord"></i> Login with Discord' +
        '</button>' +
      '</div>';
    document.body.appendChild(el);
  }
  function hideLoginOverlay() { const el = document.getElementById('loginOverlay'); if (el) el.remove(); }
  window.showLoginOverlay = showLoginOverlay;

  function applyReadOnlyUI() {
    const readOnly = window.dashboardTier === 'readonly';
    document.body.dataset.tier = readOnly ? 'readonly' : 'mod';

    ['feedback', 'logs', 'settings'].forEach((tab) => {
      const nav = document.querySelector('.nav-item[data-tab="' + tab + '"]');
      if (nav) nav.style.display = readOnly ? 'none' : '';
    });

    const gwNav = document.querySelector('.nav-item[data-tab="giveaways"]');
    if (gwNav) gwNav.style.display = window.canManageGiveaways ? '' : 'none';

    const addBtn = document.querySelector('.header-actions .btn-primary');
    if (addBtn) addBtn.style.display = readOnly ? 'none' : '';

    const queueBulk = document.getElementById('queueBulkActions');
    if (queueBulk) queueBulk.style.display = readOnly ? 'none' : '';

    const bulkBar = document.getElementById('bulkBar');
    if (bulkBar) bulkBar.style.display = readOnly ? 'none' : '';

    const selectAll = document.getElementById('selectAll');
    if (selectAll) selectAll.closest('th').style.display = readOnly ? 'none' : '';

    const actionsHeader = document.querySelector('#tab-members thead th:last-child');
    if (actionsHeader) actionsHeader.style.display = readOnly ? 'none' : '';

    const subtitle = document.querySelector('#tab-members .page-subtitle');
    if (subtitle && readOnly) subtitle.textContent = 'View regiment members (read-only)';

    const queueSubtitle = document.querySelector('#tab-queue .page-subtitle');
    if (queueSubtitle && readOnly) queueSubtitle.textContent = 'View pending join requests (read-only)';

    const userRole = document.querySelector('.sidebar-user-info span');
    if (userRole) userRole.textContent = readOnly ? 'Viewer' : 'Owner';

    if (typeof switchTab === 'function') {
      const restricted = ['feedback', 'logs', 'settings'];
      const active = document.querySelector('.nav-item.active');
      if (active) {
        if (readOnly && restricted.includes(active.dataset.tab)) switchTab('members');
        if (!window.canManageGiveaways && active.dataset.tab === 'giveaways') switchTab('members');
      }
    }
  }

  async function fetchUserTier() {
    try {
      const me = await api('GET', '/api/me');
      window.dashboardTier = me.tier === 'readonly' ? 'readonly' : 'mod';
      window.canManageGiveaways = !!me.canManageGiveaways;
      window.dashboardUserId = me.id;
    } catch (e) {
      if (e.message === 'Not authenticated') throw e;
      window.dashboardTier = 'mod';
      window.canManageGiveaways = false;
    }
    applyReadOnlyUI();
  }

  async function loadData() {
    const data = await api('GET', '/api/data');
    if (data.tier) window.dashboardTier = data.tier === 'readonly' ? 'readonly' : 'mod';
    if (data.canManageGiveaways !== undefined) window.canManageGiveaways = !!data.canManageGiveaways;
    applyReadOnlyUI();

    members.length = 0;
    data.members
      .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
      .forEach((m, i) => members.push({
        id: i + 1, userId: m.userId,
        discord: m.discord, roblox: m.roblox || '—',
        status: 'active', joined: new Date(m.joinedAt || Date.now()),
        feedback: (m.families || []).join(', '), notes: '', selected: false,
      }));

    queue.length = 0;
    data.queue
      .sort((a, b) => (a.position || 0) - (b.position || 0))
      .forEach((q, i) => queue.push({
        id: 100000 + i + 1, userId: q.userId,
        discord: q.discord, roblox: q.roblox || '—',
        reason: (q.families || []).length ? 'Families: ' + q.families.join(', ') : 'In queue',
        requestedAt: new Date(q.joinedAt || Date.now()), discordId: q.userId,
      }));

    // Audit log (real entries from Firestore)
    if (typeof logs !== 'undefined') {
      logs.length = 0;
      (data.logs || []).forEach((l) => logs.push({
        action: l.action, target: l.target, detail: l.detail, by: 'dashboard',
        at: new Date(l.at || Date.now()),
      }));
    }

    // Feedback (collected at verification)
    if (typeof feedbacks !== 'undefined') {
      feedbacks.length = 0;
      (data.feedback || []).forEach((f, i) => feedbacks.push({
        id: i + 1, author: f.author, text: f.text, category: 'general',
        date: new Date(f.date || Date.now()),
      }));
    }

    // Settings fields
    const s = data.settings || {};
    const setVal = (id, v) => { const el = document.getElementById(id); if (el && v != null) el.value = v; };
    setVal('settingName', s.name || (data.status && 'Moonlight Soldiers'));
    setVal('settingMaxSize', data.status ? data.status.maxSlots : '');
    if (s.autoAccept) setVal('settingAutoAccept', s.autoAccept);
    if (s.kickReason) setVal('settingKickReason', s.kickReason);

    if (typeof renderMembers === 'function') renderMembers();
    if (typeof updateCounts === 'function') updateCounts();
    const active = (tab) => { const el = document.getElementById('tab-' + tab); return el && el.classList.contains('active'); };
    if (active('queue') && typeof renderQueue === 'function') renderQueue();
    if (active('logs') && typeof renderLogs === 'function') renderLogs();
    if (active('feedback') && typeof renderFeedback === 'function') renderFeedback();
    if (active('giveaways')) { await loadGiveaways().catch(() => {}); if (typeof renderGiveaways === 'function') renderGiveaways(); }
    if (active('pservers')) { await loadPrivateServers().catch(() => {}); if (typeof renderPrivateServers === 'function') renderPrivateServers(); }
  }
  window.loadData = loadData;

  window.loadGiveaways = async function () {
    const data = await api('GET', '/api/giveaways');
    if (typeof giveaways !== 'undefined') {
      giveaways.length = 0;
      (data.giveaways || []).forEach((g) => giveaways.push(g));
    }
    if (typeof renderGiveaways === 'function') renderGiveaways();
  };

  window.loadPrivateServers = async function () {
    const data = await api('GET', '/api/private-servers');
    if (typeof privateServers !== 'undefined') {
      privateServers.length = 0;
      (data.servers || []).forEach((s) => privateServers.push(s));
    }
    if (typeof renderPrivateServers === 'function') renderPrivateServers();
  };

  window.submitPrivateServer = async function () {
    const link = document.getElementById('pserverLink')?.value?.trim();
    if (!link) { showToast('A server code or link is required', 'error'); return; }
    try {
      await api('POST', '/api/private-servers', { link });
      showToast('Private server added!', 'success');
      document.getElementById('pserverLink').value = '';
      await loadPrivateServers();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };

  window.deletePrivateServer = async function (id) {
    if (!confirm('Remove this private server?')) return;
    try {
      await api('DELETE', '/api/private-servers/' + id);
      showToast('Private server removed', 'success');
      await loadPrivateServers();
    } catch (e) { showToast('Error: ' + e.message, 'error'); }
  };

  window.loadGiveawayChannels = async function () {
    const data = await api('GET', '/api/channels');
    giveawayChannels = data.channels || [];
    const sel = document.getElementById('gwChannel');
    if (!sel) return;
    sel.innerHTML = giveawayChannels.map((c) =>
      `<option value="${c.id}">${c.parent ? c.parent + ' / ' : ''}#${c.name}</option>`
    ).join('');
    const def = data.defaultChannelId;
    if (def && giveawayChannels.some((c) => c.id === def)) sel.value = def;
    else if (giveawayChannels.length) sel.value = giveawayChannels[0].id;
  };

  window.viewGiveaway = async function (id) {
    try {
      const g = await api('GET', '/api/giveaways/' + id);
      const shareUrl = getApiBase() + '/giveaway/' + g.id;
      const entrants = (g.entrants || []).map((e) => e.tag).join(', ') || 'None yet';
      const winners = (g.winners || []).map((w) => w.tag).join(', ') || '—';
      document.getElementById('viewModalBody').innerHTML =
        '<div class="detail-row"><span class="detail-label">Title</span><span class="detail-value">' + g.title + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Prize</span><span class="detail-value">' + (g.prize || '—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Status</span><span class="detail-value">' + g.status + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Entries</span><span class="detail-value">' + (g.entryCount || 0) + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Winners picked</span><span class="detail-value">' + winners + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Hosted by</span><span class="detail-value">' + (g.hostTag || '—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Ends</span><span class="detail-value">' + (g.endsAt ? new Date(g.endsAt).toLocaleString() : '—') + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Share link</span><span class="detail-value" style="font-size:11px;word-break:break-all">' + shareUrl + '</span></div>' +
        '<div class="detail-row"><span class="detail-label">Entrants</span><span class="detail-value" style="font-size:12px">' + entrants + '</span></div>';
      document.getElementById('viewModalFooter').innerHTML =
        '<button class="btn btn-ghost" onclick="closeModal(\'viewModal\')">Close</button>' +
        '<button class="btn btn-primary" onclick="navigator.clipboard.writeText(\'' + shareUrl + '\');showToast(\'Link copied!\',\'success\')"><i class="fas fa-copy"></i> Copy Link</button>';
      openModal('viewModal');
    } catch (e) { showToast('Load failed: ' + e.message, 'error'); }
  };

  window.submitGiveaway = async function () {
    const title = document.getElementById('gwTitle')?.value?.trim();
    const prize = document.getElementById('gwPrize')?.value?.trim();
    const startsAt = document.getElementById('gwStarts')?.value;
    const endsAt = document.getElementById('gwEnds')?.value;
    const winnerCount = document.getElementById('gwWinners')?.value;
    const channelId = document.getElementById('gwChannel')?.value;
    if (!title) { showToast('Title is required', 'error'); return; }
    if (!endsAt) { showToast('End time is required', 'error'); return; }
    try {
      const r = await api('POST', '/api/giveaways', {
        title, prize, startsAt, endsAt, winnerCount, channelId,
      });
      showToast('Giveaway created!', 'success');
      closeModal('giveawayModal');
      await loadGiveaways();
      if (typeof switchTab === 'function') switchTab('giveaways');
    } catch (e) { showToast('Create failed: ' + e.message, 'error'); }
  };

  window.endGiveaway = async function (id) {
    if (!confirm('End this giveaway now and pick winners?')) return;
    try {
      const r = await api('POST', '/api/giveaways/' + id + '/end');
      const names = (r.winners || []).map((w) => w.tag).join(', ') || 'none';
      showToast('Ended — winners: ' + names, 'success');
      await loadGiveaways();
    } catch (e) { showToast('End failed: ' + e.message, 'error'); }
  };

  window.rerollGiveaway = async function (id) {
    if (!confirm('Reroll winners for this giveaway?')) return;
    try {
      const r = await api('POST', '/api/giveaways/' + id + '/reroll');
      const names = (r.winners || []).map((w) => w.tag).join(', ') || 'none';
      showToast('Rerolled — winners: ' + names, 'success');
      await loadGiveaways();
    } catch (e) { showToast('Reroll failed: ' + e.message, 'error'); }
  };

  window.deleteGiveaway = async function (id) {
    if (!confirm('Delete this giveaway? This cannot be undone.')) return;
    try {
      await api('DELETE', '/api/giveaways/' + id);
      showToast('Giveaway deleted', 'warning');
      await loadGiveaways();
    } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
  };

  window.saveSettings = async function () {
    const val = (id) => { const el = document.getElementById(id); return el ? el.value.trim() : ''; };
    try {
      await api('POST', '/api/settings', {
        name: val('settingName'),
        maxSize: val('settingMaxSize'),
        autoAccept: val('settingAutoAccept'),
        kickReason: val('settingKickReason'),
      });
      showToast('Settings saved', 'success');
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); return; }
    await loadData();
  };

  // ── Action overrides (call the API, then reload live data) ──
  window.confirmKick = async function () {
    const m = members.find((x) => x.id === kickTargetId);
    if (!m) return;
    try { await api('POST', '/api/kick', { userId: m.userId }); showToast('Kicked ' + m.discord, 'error'); }
    catch (e) { showToast('Kick failed: ' + e.message, 'error'); }
    closeModal('kickModal');
    await loadData();
  };

  window.acceptFromQueue = async function (id) {
    const q = queue.find((x) => x.id === id);
    if (!q) return;
    try { await api('POST', '/api/accept', { userId: q.userId }); showToast('Accepted ' + q.discord, 'success'); }
    catch (e) { showToast('Accept failed: ' + e.message, 'error'); }
    await loadData(); renderQueue();
  };

  window.rejectFromQueue = async function (id) {
    const q = queue.find((x) => x.id === id);
    if (!q) return;
    try { await api('POST', '/api/reject', { userId: q.userId }); showToast('Rejected ' + q.discord, 'warning'); }
    catch (e) { showToast('Reject failed: ' + e.message, 'error'); }
    await loadData(); renderQueue();
  };

  window.acceptAllQueue = async function () {
    const snapshot = [...queue];
    if (!snapshot.length) { showToast('Queue is empty', 'info'); return; }
    for (const q of snapshot) { try { await api('POST', '/api/accept', { userId: q.userId }); } catch (e) { /* skip */ } }
    showToast('Accepted ' + snapshot.length + ' from queue', 'success');
    await loadData(); renderQueue();
  };

  window.rejectAllQueue = async function () {
    const snapshot = [...queue];
    if (!snapshot.length) { showToast('Queue is empty', 'info'); return; }
    for (const q of snapshot) { try { await api('POST', '/api/reject', { userId: q.userId }); } catch (e) { /* skip */ } }
    showToast('Cleared ' + snapshot.length + ' from queue', 'warning');
    await loadData(); renderQueue();
  };

  window.bulkKick = async function () {
    const sel = members.filter((m) => m.selected);
    if (!sel.length) return;
    for (const m of sel) { try { await api('POST', '/api/kick', { userId: m.userId }); } catch (e) { /* skip */ } }
    showToast('Kicked ' + sel.length + ' member(s)', 'error');
    if (typeof clearSelection === 'function') clearSelection();
    await loadData();
  };

  window.reinstateMember = async function (id) {
    const m = members.find((x) => x.id === id);
    if (!m) return;
    try { await api('POST', '/api/add', { userId: m.userId }); showToast('Reinstated ' + m.discord, 'success'); }
    catch (e) { showToast('Failed: ' + e.message, 'error'); }
    await loadData();
  };

  window.submitAddMember = async function () {
    const discord = document.getElementById('formDiscord').value.trim();
    const roblox = document.getElementById('formRoblox').value.trim();
    if (!discord) { showToast('Discord name is required', 'error'); return; }
    try {
      if (editingId) {
        const m = members.find((x) => x.id === editingId);
        await api('POST', '/api/update', { userId: m.userId, roblox });
        showToast('Updated ' + discord, 'success');
      } else {
        const r = await api('POST', '/api/add', { username: discord, roblox });
        showToast('Added ' + (r.tag || discord), 'success');
      }
    } catch (e) { showToast('Failed: ' + e.message, 'error'); return; }
    closeModal('addModal');
    await loadData();
  };

  // ── Family Management ──
  let availableFamilies = [];
  let userFamilies = [];

  window.loadFamilies = async function () {
    try {
      const data = await api('GET', '/api/families');
      availableFamilies = data.options || [];
      userFamilies = data.current || [];
      if (typeof renderFamilies === 'function') renderFamilies();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Failed to load families: ' + e.message, 'error');
    }
  };

  window.toggleFamily = function (value) {
    const idx = userFamilies.indexOf(value);
    if (idx > -1) {
      userFamilies.splice(idx, 1);
    } else {
      userFamilies.push(value);
    }
    renderFamilies();
  };

  window.renderFamilies = function () {
    const grid = document.getElementById('familyGrid');
    if (!grid) return;
    
    if (availableFamilies.length === 0) {
      grid.innerHTML = '<p style="color:var(--text-muted);grid-column:1/-1;text-align:center;">No families available.</p>';
      return;
    }

    grid.innerHTML = availableFamilies.map(f => {
      const isSelected = userFamilies.includes(f.value);
      let filename = f.value;
      let ext = '.png';
      if (f.value === 'helos') ext = '.jpeg';
      if (f.value === 'reiss') filename = 'Reiss';
      let imgFile = filename + ext;
      return `
        <div class="family-card ${isSelected ? 'selected' : ''}" onclick="toggleFamily('${f.value}')">
          <div class="card-image-wrapper">
            <img src="/dashboard/src/family/${imgFile}" alt="${f.label}" onerror="this.src='/logo.png'">
            <div class="checkmark"><i class="fas fa-check"></i></div>
          </div>
          <div class="family-card-content">
            <h4>${f.label}</h4>
          </div>
        </div>
      `;
    }).join('');
  };

  window.submitFamilies = async function () {
    try {
      const r = await api('POST', '/api/families', { families: userFamilies });
      if (typeof showToast === 'function') showToast('Families updated successfully!', 'success');
      userFamilies = r.families || userFamilies;
      renderFamilies();
    } catch (e) {
      if (typeof showToast === 'function') showToast('Failed to save families: ' + e.message, 'error');
    }
  };
  // ── Init + periodic refresh ──
  (async function init() {
    if (!getToken()) { showLoginOverlay(); return; }
    try {
      await fetchUserTier();
      await loadData();
      hideLoginOverlay();
      injectLogoutButton();
    } catch (e) { if (e.message !== 'Not authenticated') showToast('Load failed: ' + e.message, 'error'); }
  })();
  setInterval(() => {
    if (!getToken()) return;
    loadData().catch(() => {});
    if (typeof giveaways !== 'undefined' && document.getElementById('tab-giveaways')?.classList.contains('active')) {
      loadGiveaways().catch(() => {});
    }
  }, 120000); // 2 minutes (was 30s)

  // Small logout control (kept here so no edits to index.html are needed).
  function injectLogoutButton() {
    if (document.getElementById('dashLogout')) return;
    const b = document.createElement('button');
    b.id = 'dashLogout';
    b.title = 'Log out';
    b.onclick = () => logout();
    b.style.cssText = 'position:fixed;bottom:16px;left:16px;z-index:9000;cursor:pointer;border:1px solid rgba(255,255,255,.15);background:rgba(20,20,28,.85);color:#f5f5f7;border-radius:8px;padding:8px 12px;font-size:13px;font-family:system-ui,sans-serif;';
    b.innerHTML = '<i class="fas fa-right-from-bracket"></i> Log out';
    document.body.appendChild(b);
  }
})();
