// ── Avatar color palette ──
const AVATAR_COLORS = [
  'linear-gradient(135deg,#e0303c,#8b0000)',
  'linear-gradient(135deg,#a855f7,#6366f1)',
  'linear-gradient(135deg,#f43f5e,#e11d48)',
  'linear-gradient(135deg,#f59e0b,#d97706)',
  'linear-gradient(135deg,#3b82f6,#2563eb)',
  'linear-gradient(135deg,#ec4899,#db2777)',
  'linear-gradient(135deg,#10b981,#059669)',
  'linear-gradient(135deg,#f97316,#ea580c)',
  'linear-gradient(135deg,#8b5cf6,#7c3aed)',
  'linear-gradient(135deg,#06b6d4,#0891b2)',
];

export function getAvatarColor(name) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = name.charCodeAt(i) + ((h << 5) - h);
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

export function getInitials(name) {
  return name.split(/[\s_]/).map(w => w[0]).join('').toUpperCase().slice(0, 2);
}

export function formatDate(d) {
  if (!(d instanceof Date)) d = new Date(d);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function getTimeAgo(date) {
  const seconds = Math.floor((new Date() - date) / 1000);
  if (seconds < 60) return 'Just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function pad2(n) { return String(n).padStart(2, '0'); }

export function formatCountdown(ms) {
  if (ms <= 0) return '00:00:00:00';
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${pad2(d)}:${pad2(h)}:${pad2(m)}:${pad2(sec)}`;
}

export function statusLabel(status) {
  if (status === 'active') return 'In Regiment';
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// ── Audit log action style map ──
export const ACTION_STYLES = {
  MEMBER_ADDED:     { icon: 'fa-user-plus',      color: 'var(--success)', bg: 'var(--success-dim)' },
  MEMBER_KICKED:    { icon: 'fa-user-slash',      color: 'var(--danger)',  bg: 'var(--danger-dim)' },
  MEMBER_EDITED:    { icon: 'fa-pen',             color: 'var(--info)',    bg: 'var(--info-dim)' },
  MEMBER_REINSTATED:{ icon: 'fa-rotate-left',     color: 'var(--accent)',  bg: 'var(--accent-dim)' },
  STATUS_CHANGED:   { icon: 'fa-arrows-rotate',   color: 'var(--warning)', bg: 'var(--warning-dim)' },
  QUEUE_ACCEPTED:   { icon: 'fa-circle-check',    color: 'var(--success)', bg: 'var(--success-dim)' },
  QUEUE_REJECTED:   { icon: 'fa-circle-xmark',    color: 'var(--danger)',  bg: 'var(--danger-dim)' },
  DASHBOARD_LOGIN:  { icon: 'fa-right-to-bracket', color: 'var(--info)',   bg: 'var(--info-dim)' },
  SETTINGS_CHANGED: { icon: 'fa-gear',            color: 'var(--warning)', bg: 'var(--warning-dim)' },
  GIVEAWAY_CREATED: { icon: 'fa-gift',            color: 'var(--success)', bg: 'var(--success-dim)' },
  GIVEAWAY_ENDED:   { icon: 'fa-flag-checkered',  color: 'var(--warning)', bg: 'var(--warning-dim)' },
  GIVEAWAY_DELETED: { icon: 'fa-trash',           color: 'var(--danger)',  bg: 'var(--danger-dim)' },
  GIVEAWAY_REROLL:  { icon: 'fa-dice',            color: 'var(--purple)',  bg: 'var(--purple-dim)' },
};
