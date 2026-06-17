// ─── Family options for verification ─────────────────────────────────────────
// Shown as a multi-select menu during verification. Each picked option grants
// the matching role. EDIT the roleIds / labels / emojis to taste.

module.exports = {
  options: [
    { value: 'shiki',    label: 'Shiki',        emoji: '🔵', roleId: '1503612996117598318' },
    { value: 'helos',    label: 'Helos',        emoji: '❤️', roleId: '1503612775279362189' },
    { value: 'fritz',    label: 'Fritz',        emoji: '🔴', roleId: '1503612658182520963' },
    { value: 'ackerman', label: 'Ackerman',     emoji: '💛', roleId: '1503612899506258001' },
    { value: 'yeager',   label: 'Yeager',       emoji: '🟡', roleId: '1503612855348498492' },
    { value: 'reiss',    label: 'Reiss',        emoji: '🟨', roleId: '1503612943936520324' },
    { value: 'epic',     label: 'Any epic fam', emoji: '🟣', roleId: '1503613035288203314' },
  ],
};
