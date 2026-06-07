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

  function getPw() {
    let p = localStorage.getItem('dash_pw');
    if (!p) {
      p = (prompt('Enter dashboard password:') || '').trim();
      if (p) localStorage.setItem('dash_pw', p);
    }
    return p;
  }

  async function api(method, path, body) {
    const res = await fetch(getApiBase() + path, {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + getPw() },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) { localStorage.removeItem('dash_pw'); throw new Error('Wrong password'); }
    if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error || ('HTTP ' + res.status)); }
    return res.json();
  }
  window.api = api;
  // Console helpers to reconfigure: setBackend('https://...'), then reload.
  window.setBackend = (url) => { localStorage.setItem('dash_api', (url || '').replace(/\/+$/, '')); location.reload(); };

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

    if (typeof renderMembers === 'function') renderMembers();
    if (typeof updateCounts === 'function') updateCounts();
    const qt = document.getElementById('tab-queue');
    if (qt && qt.classList.contains('active') && typeof renderQueue === 'function') renderQueue();
  }
  window.loadData = loadData;

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
    try { await loadData(); }
    catch (e) { showToast('Load failed: ' + e.message, 'error'); }
  })();
  setInterval(() => { if (localStorage.getItem('dash_pw')) loadData().catch(() => {}); }, 30000);
})();
