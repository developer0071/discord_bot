// ─── VIP / Private server codes ──────────────────────────────────────────────
// EDIT THIS FILE to change the codes the bot shares and the words that trigger it.
// When someone says a trigger word in the CHATTING channel, the bot replies with
// the list below.

module.exports = {
  title: '🔐 Private Server Codes',
  color: 0x9b59b6,

  // Whole-word, case-insensitive triggers. A space also matches a hyphen or nothing
  // (so 'vip server' matches "vip server", "vip-server", and "vipserver").
  triggers: ['vip server', 'vip', 'private server', 'ps'],

  // The codes to share. Add / edit / remove freely.
  servers: [
    { name: 'Hunters', code: '56A013DF' },
    { name: 'Ubels', code: '1722B2C5' },
    { name: 'drk_edis', code: '7ADB8E4C' }
  ],
};
