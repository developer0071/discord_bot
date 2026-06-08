import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react';
import {
  getToken, setToken as storeToken, captureTokenFromHash, loginRedirect, logout as doLogout,
  fetchDashboardData, fetchGiveaways, fetchChannels,
  apiKickMember, apiAcceptQueue, apiRejectQueue, apiAddMember, apiUpdateMember, apiReinstateM,
  apiSaveSettings, createGiveaway, endGiveaway as apiEndGw, rerollGiveaway as apiRerollGw,
  deleteGiveaway as apiDeleteGw, fetchGiveawayDetail, getApiBase,
} from '../utils/api';

const AppContext = createContext(null);
export const useApp = () => useContext(AppContext);

export function AppProvider({ children }) {
  // ── Auth state ──
  const [authenticated, setAuthenticated] = useState(!!getToken());
  const [authError, setAuthError] = useState('');

  // ── Data ──
  const [members, setMembers] = useState([]);
  const [queue, setQueue] = useState([]);
  const [logs, setLogs] = useState([]);
  const [feedback, setFeedback] = useState([]);
  const [giveaways, setGiveaways] = useState([]);
  const [channels, setChannels] = useState([]);
  const [settings, setSettings] = useState({});
  const [regimentStatus, setRegimentStatus] = useState({});
  const [loading, setLoading] = useState(true);

  // ── Active tab ──
  const [activeTab, setActiveTab] = useState('members');

  // ── Toasts ──
  const [toasts, setToasts] = useState([]);
  const toastIdRef = useRef(0);

  const showToast = useCallback((message, type = 'success') => {
    const id = ++toastIdRef.current;
    setToasts(prev => [...prev, { id, message, type }]);
    setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id ? { ...t, removing: true } : t));
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 300);
    }, 3000);
  }, []);

  const removeToast = useCallback((id) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  // ── Capture OAuth token from URL hash ──
  useEffect(() => {
    if (captureTokenFromHash()) {
      setAuthenticated(true);
    }
  }, []);

  // ── Load data ──
  const loadData = useCallback(async () => {
    try {
      const data = await fetchDashboardData();
      setMembers(data.members);
      setQueue(data.queue);
      setLogs(data.logs);
      setFeedback(data.feedback);
      setSettings(data.settings);
      setRegimentStatus(data.status);
      setLoading(false);
      return data;
    } catch (e) {
      if (e.message === 'Not authenticated' || e.message.includes('permission')) {
        setAuthenticated(false);
        setAuthError(e.message.includes('permission') ? e.message : '');
      } else {
        showToast('Load failed: ' + e.message, 'error');
      }
      setLoading(false);
      throw e;
    }
  }, [showToast]);

  const loadGiveaways = useCallback(async () => {
    try {
      const list = await fetchGiveaways();
      setGiveaways(list);
      return list;
    } catch (e) {
      showToast('Failed to load giveaways: ' + e.message, 'error');
      throw e;
    }
  }, [showToast]);

  const loadChannels = useCallback(async () => {
    try {
      const data = await fetchChannels();
      setChannels(data.channels || []);
      return data;
    } catch (e) {
      showToast('Failed to load channels', 'error');
      throw e;
    }
  }, [showToast]);

  // ── Init ──
  useEffect(() => {
    if (!authenticated) {
      setLoading(false);
      return;
    }
    loadData().catch(() => {});
    const interval = setInterval(() => {
      if (getToken()) loadData().catch(() => {});
    }, 30000);
    return () => clearInterval(interval);
  }, [authenticated, loadData]);

  // ── Auth actions ──
  const login = useCallback(() => loginRedirect(), []);
  const logout = useCallback(() => doLogout(), []);

  // ── Member actions ──
  const kickMember = useCallback(async (userId) => {
    const m = members.find(x => x.userId === userId);
    try {
      await apiKickMember(userId);
      showToast('Kicked ' + (m?.discord || userId), 'error');
    } catch (e) { showToast('Kick failed: ' + e.message, 'error'); return; }
    await loadData().catch(() => {});
  }, [members, showToast, loadData]);

  const acceptFromQueue = useCallback(async (userId) => {
    const q = queue.find(x => x.userId === userId);
    try {
      await apiAcceptQueue(userId);
      showToast('Accepted ' + (q?.discord || userId), 'success');
    } catch (e) { showToast('Accept failed: ' + e.message, 'error'); return; }
    await loadData().catch(() => {});
  }, [queue, showToast, loadData]);

  const rejectFromQueue = useCallback(async (userId) => {
    const q = queue.find(x => x.userId === userId);
    try {
      await apiRejectQueue(userId);
      showToast('Rejected ' + (q?.discord || userId), 'warning');
    } catch (e) { showToast('Reject failed: ' + e.message, 'error'); return; }
    await loadData().catch(() => {});
  }, [queue, showToast, loadData]);

  const acceptAllQueue = useCallback(async () => {
    if (!queue.length) { showToast('Queue is empty', 'info'); return; }
    for (const q of queue) {
      try { await apiAcceptQueue(q.userId); } catch { /* skip */ }
    }
    showToast('Accepted ' + queue.length + ' from queue', 'success');
    await loadData().catch(() => {});
  }, [queue, showToast, loadData]);

  const rejectAllQueue = useCallback(async () => {
    if (!queue.length) { showToast('Queue is empty', 'info'); return; }
    for (const q of queue) {
      try { await apiRejectQueue(q.userId); } catch { /* skip */ }
    }
    showToast('Cleared ' + queue.length + ' from queue', 'warning');
    await loadData().catch(() => {});
  }, [queue, showToast, loadData]);

  const addMember = useCallback(async ({ username, roblox }) => {
    try {
      const r = await apiAddMember({ username, roblox });
      showToast('Added ' + (r.tag || username), 'success');
    } catch (e) { showToast('Failed: ' + e.message, 'error'); throw e; }
    await loadData().catch(() => {});
  }, [showToast, loadData]);

  const updateMember = useCallback(async ({ userId, roblox }) => {
    try {
      await apiUpdateMember({ userId, roblox });
      showToast('Updated member', 'success');
    } catch (e) { showToast('Failed: ' + e.message, 'error'); throw e; }
    await loadData().catch(() => {});
  }, [showToast, loadData]);

  const reinstateMember = useCallback(async (userId) => {
    try {
      await apiReinstateM(userId);
      showToast('Reinstated member', 'success');
    } catch (e) { showToast('Failed: ' + e.message, 'error'); }
    await loadData().catch(() => {});
  }, [showToast, loadData]);

  const bulkKick = useCallback(async (userIds) => {
    for (const userId of userIds) {
      try { await apiKickMember(userId); } catch { /* skip */ }
    }
    showToast('Kicked ' + userIds.length + ' member(s)', 'error');
    await loadData().catch(() => {});
  }, [showToast, loadData]);

  // ── Settings ──
  const saveSettings = useCallback(async (s) => {
    try {
      await apiSaveSettings(s);
      showToast('Settings saved', 'success');
    } catch (e) { showToast('Save failed: ' + e.message, 'error'); return; }
    await loadData().catch(() => {});
  }, [showToast, loadData]);

  // ── Giveaways ──
  const submitGiveaway = useCallback(async (payload) => {
    try {
      await createGiveaway(payload);
      showToast('Giveaway created!', 'success');
    } catch (e) { showToast('Create failed: ' + e.message, 'error'); throw e; }
    await loadGiveaways().catch(() => {});
  }, [showToast, loadGiveaways]);

  const endGiveaway = useCallback(async (id) => {
    try {
      const r = await apiEndGw(id);
      const names = (r.winners || []).map(w => w.tag).join(', ') || 'none';
      showToast('Ended — winners: ' + names, 'success');
    } catch (e) { showToast('End failed: ' + e.message, 'error'); }
    await loadGiveaways().catch(() => {});
  }, [showToast, loadGiveaways]);

  const rerollGiveaway = useCallback(async (id) => {
    try {
      const r = await apiRerollGw(id);
      const names = (r.winners || []).map(w => w.tag).join(', ') || 'none';
      showToast('Rerolled — winners: ' + names, 'success');
    } catch (e) { showToast('Reroll failed: ' + e.message, 'error'); }
    await loadGiveaways().catch(() => {});
  }, [showToast, loadGiveaways]);

  const removeGiveaway = useCallback(async (id) => {
    try {
      await apiDeleteGw(id);
      showToast('Giveaway deleted', 'warning');
    } catch (e) { showToast('Delete failed: ' + e.message, 'error'); }
    await loadGiveaways().catch(() => {});
  }, [showToast, loadGiveaways]);

  const value = {
    // Auth
    authenticated, authError, login, logout, loading,
    // Data
    members, queue, logs, feedback, giveaways, channels, settings, regimentStatus,
    // Data loading
    loadData, loadGiveaways, loadChannels,
    // Tab
    activeTab, setActiveTab,
    // Toasts
    toasts, showToast, removeToast,
    // Member actions
    kickMember, acceptFromQueue, rejectFromQueue, acceptAllQueue, rejectAllQueue,
    addMember, updateMember, reinstateMember, bulkKick,
    // Settings
    saveSettings,
    // Giveaways
    submitGiveaway, endGiveaway, rerollGiveaway, removeGiveaway,
    // API helpers
    getApiBase,
    fetchGiveawayDetail,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}
