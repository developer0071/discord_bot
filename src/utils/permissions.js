// ─── Role-based permissions ──────────────────────────────────────────────────
// Who is allowed to operate the regiment bot, configured in .env:
//   REGIMENT_MANAGE_ROLE_IDS — full control: add + kick + manage (e.g. PREMIER, Commander)
//   REGIMENT_ADD_ROLE_IDS    — add only (e.g. Lieutenant, Sergeant)

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
  return hasAnyRole(member, roleIds('REGIMENT_MANAGE_ROLE_IDS'));
}

/**
 * Add people to the regiment. Managers can do everything an adder can.
 */
function canAdd(member) {
  return canManage(member) || hasAnyRole(member, roleIds('REGIMENT_ADD_ROLE_IDS'));
}

module.exports = { canManage, canAdd };
