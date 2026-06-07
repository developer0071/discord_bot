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
  const DEFAULT_API_BASE = 'https://component-yen-historical-socket.trycloudflare.com';

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

  async function api(method, path, body) {
    const res = await fetch(getApiBase() + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 || res.status === 403) {
      setToken('');
      showLoginOverlay(res.status === 403 ? "Your Discord account doesn't have permission to use this dashboard." : '');
      throw new Error('Not authenticated');
    }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + res.status)); }
    return res.json();
  }
  window.api = api;
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

  async function loadData() {
    const data = await api('GET', '/api/data');

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
  }
  window.loadData = loadData;

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

  // ── Init + periodic refresh ──
  (async function init() {
    if (!getToken()) { showLoginOverlay(); return; }
    try { await loadData(); hideLoginOverlay(); injectLogoutButton(); }
    catch (e) { if (e.message !== 'Not authenticated') showToast('Load failed: ' + e.message, 'error'); }
  })();
  setInterval(() => { if (getToken()) loadData().catch(() => {}); }, 30000);

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
