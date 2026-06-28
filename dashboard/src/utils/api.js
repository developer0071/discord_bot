// ── API layer — mirrors app-api.js but as clean ES modules ──

const DEFAULT_API_BASE = 'https://api.hunterstar.online';

export function getApiBase() {
  return (localStorage.getItem('dash_api') || DEFAULT_API_BASE).replace(/\/+$/, '');
}

export function setBackend(url) {
  localStorage.setItem('dash_api', (url || '').replace(/\/+$/, ''));
  location.reload();
}

export function getRegiment() {
  return localStorage.getItem('dash_regiment') || 'moonlight';
}

export function setRegiment(r) {
  localStorage.setItem('dash_regiment', r);
  location.reload();
}

export function getToken() {
  return localStorage.getItem('dash_token') || '';
}

export function setToken(t) {
  if (t) localStorage.setItem('dash_token', t);
  else localStorage.removeItem('dash_token');
}

// Capture token from URL hash after Discord OAuth redirect
export function captureTokenFromHash() {
  const m = location.hash.match(/(?:^|#|&)token=([^&]+)/);
  if (m) {
    setToken(decodeURIComponent(m[1]));
    history.replaceState(null, '', location.pathname + location.search);
    return true;
  }
  return false;
}

export function loginRedirect() {
  const back = location.origin + location.pathname;
  location.href = getApiBase() + '/auth/discord/login?redirect=' + encodeURIComponent(back);
}

export function logout() {
  setToken('');
  location.reload();
}

// Core fetch wrapper with auth
export async function apiFetch(method, path, body) {
  const isFormData = body instanceof FormData;
  const headers = {
    ...(getToken() ? { Authorization: 'Bearer ' + getToken() } : {}),
    'x-regiment': getRegiment(),
  };
  if (!isFormData) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(getApiBase() + path, {
    method,
    headers,
    body: isFormData ? body : (body ? JSON.stringify(body) : undefined),
  });

  if (res.status === 401) {
    setToken('');
    throw new Error('Not authenticated');
  }
  if (res.status === 403) {
    const authPaths = ['/api/data', '/api/me'];
    if (authPaths.some((p) => path.startsWith(p))) {
      setToken('');
      throw new Error("Your Discord account doesn't have permission to use this dashboard.");
    }
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || 'Permission denied');
  }

  if (!res.ok) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || ('HTTP ' + res.status));
  }
  return res.json();
}

// ── Current user / tier ──
export async function fetchCurrentUser() {
  return apiFetch('GET', '/api/me');
}

// ── Data loading ──
export async function fetchDashboardData() {
  const data = await apiFetch('GET', '/api/data');

  const members = (data.members || [])
    .sort((a, b) => (a.joinedAt || 0) - (b.joinedAt || 0))
    .map((m, i) => ({
      id: i + 1,
      userId: m.userId,
      discord: m.discord,
      roblox: m.roblox || '—',
      status: m.status || 'active',
      joined: new Date(m.joinedAt || Date.now()),
      feedback: (m.families || []).join(', '),
      notes: '',
      selected: false,
    }));

  const queue = (data.queue || [])
    .sort((a, b) => (a.position || 0) - (b.position || 0))
    .map((q, i) => ({
      id: 100000 + i + 1,
      userId: q.userId,
      discord: q.discord,
      roblox: q.roblox || '—',
      reason: (q.families || []).length ? 'Families: ' + q.families.join(', ') : 'In queue',
      requestedAt: new Date(q.joinedAt || Date.now()),
      discordId: q.userId,
    }));

  const logs = (data.logs || []).map(l => ({
    action: l.action,
    target: l.target,
    detail: l.detail,
    by: 'dashboard',
    at: new Date(l.at || Date.now()),
  }));

  const feedback = (data.feedback || []).map((f, i) => ({
    id: i + 1,
    author: f.author,
    text: f.text,
    category: 'general',
    date: new Date(f.date || Date.now()),
  }));

  const settings = data.settings || {};
  const status = data.status || {};
  const leveling = data.leveling || [];

  return { members, queue, logs, feedback, settings, status, leveling, tier: data.tier || 'mod' };
}

// ── Giveaways ──
export async function fetchGiveaways() {
  const data = await apiFetch('GET', '/api/giveaways');
  return data.giveaways || [];
}

export async function fetchGiveawayDetail(id) {
  return apiFetch('GET', '/api/giveaways/' + id);
}

export async function fetchChannels() {
  return apiFetch('GET', '/api/channels');
}

export async function createGiveaway(payload) {
  return apiFetch('POST', '/api/giveaways', payload);
}

export async function endGiveaway(id) {
  return apiFetch('POST', `/api/giveaways/${id}/end`);
}

export async function rerollGiveaway(id) {
  return apiFetch('POST', `/api/giveaways/${id}/reroll`);
}

export async function deleteGiveaway(id) {
  return apiFetch('DELETE', `/api/giveaways/${id}`);
}

// ── Member actions ──
export async function apiKickMember(userId) {
  return apiFetch('POST', '/api/kick', { userId });
}

export async function apiAcceptQueue(userId) {
  return apiFetch('POST', '/api/accept', { userId });
}

export async function apiRejectQueue(userId) {
  return apiFetch('POST', '/api/reject', { userId });
}

export async function apiAddMember({ userId, username, roblox }) {
  return apiFetch('POST', '/api/add', { userId, username, roblox });
}

export async function apiUpdateMember({ userId, roblox, status }) {
  return apiFetch('POST', '/api/update', { userId, roblox, status });
}

export async function apiBulkUpdateStatus(userIds, status) {
  return apiFetch('POST', '/api/bulk-update', { userIds, status });
}

export async function apiReinstateM(userId) {
  return apiFetch('POST', '/api/add', { userId });
}

export async function apiSyncMembers() {
  return apiFetch('POST', '/api/sync');
}

// ── Settings ──
export async function apiSaveSettings(settings) {
  return apiFetch('POST', '/api/settings', settings);
}
