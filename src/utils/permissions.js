// ─── Role-based permissions ──────────────────────────────────────────────────
// Who is allowed to operate the regiment bot, configured in .env:
//   REGIMENT_MANAGE_ROLE_IDS — full control: add + kick + manage (e.g. PREMIER, Commander)
//   REGIMENT_ADD_ROLE_IDS    — add only (e.g. Lieutenant, Sergeant)
//   MODS_SIDE                — full dashboard access (add, kick, settings, etc.)
//   NORMAL_SIDE              — read-only dashboard (members + queue view only)

function roleIds(envVar) {
  return (process.env[envVar] || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

function hasAnyRole(member, ids) {
  return !!member && ids.some((id) => member.roles.cache.has(id));
}

/**
 * Full control: add people, kick people, and manage slots/panel.
 */
function canManage(member) {
  return hasAnyRole(member, roleIds('REGIMENT_MANAGE_ROLE_IDS')) || hasAnyRole(member, roleIds('HAVE_ACCESS_ROLES'));
}

/**
 * Add people to the regiment. Managers can do everything an adder can.
 */
function canAdd(member) {
  return canManage(member) || hasAnyRole(member, roleIds('REGIMENT_ADD_ROLE_IDS'));
}

/**
 * Full dashboard power — can add, kick, change settings, manage giveaways, etc.
 */
function isModSide(member, regiment = null) {
  if (hasAnyRole(member, roleIds('MODS_SIDE'))) return true;
  if (hasAnyRole(member, roleIds('HAVE_ACCESS_ROLES'))) return true;
  
  if (regiment === 'sunshine') {
    if (hasAnyRole(member, roleIds('SUNSHINE_MODS'))) return true;
  } else if (regiment === 'moonlight') {
    if (hasAnyRole(member, roleIds('MOONLIGHT_MODS'))) return true;
  } else {
    // No specific regiment specified: allow if they are a mod of ANY regiment
    if (hasAnyRole(member, roleIds('SUNSHINE_MODS'))) return true;
    if (hasAnyRole(member, roleIds('MOONLIGHT_MODS'))) return true;
  }
  return false;
}

/**
 * Read-only dashboard — can view members and queue, but cannot mutate anything.
 */
function isNormalSide(member) {
  return hasAnyRole(member, roleIds('NORMAL_SIDE'));
}

/**
 * Returns 'mod', 'readonly', or null if the member may not use the dashboard.
 * Mods take precedence when a user holds both role sets.
 */
function getDashboardTier(member, regiment = null) {
  if (isModSide(member, regiment)) return 'mod';
  if (isNormalSide(member)) return 'readonly';
  // Legacy fallback while HAVE_ACCESS_ROLES is still configured
  if (hasAnyRole(member, roleIds('HAVE_ACCESS_ROLES'))) return 'mod';
  return null;
}

/**
 * Allowed to sign in to the web dashboard (mods or read-only viewers).
 */
function canAccessDashboard(member, regiment = null) {
  return getDashboardTier(member, regiment) !== null;
}

/**
 * Allowed to see and manage Giveaways (requires specific role)
 */
function canManageGiveaways(member) {
  return hasAnyRole(member, ['1516397139578716312']);
}

module.exports = {
  canManage,
  canAdd,
  isModSide,
  isNormalSide,
  getDashboardTier,
  canAccessDashboard,
  canManageGiveaways,
};
