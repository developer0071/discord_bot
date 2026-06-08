const { EmbedBuilder } = require('discord.js');
const vip = require('../config/vipServers');

// ─── Regiment join detection ─────────────────────────────────────────────────
// Fires when a message mentions the regiment. Word boundaries keep it from
// matching unrelated words like "register" or "region".
const REGIMENT_PATTERN = /\b(regiment(s|al)?|regi)\b/i;

function mentionsRegiment(content) {
  return REGIMENT_PATTERN.test(content);
}

// ─── Private server trigger ──────────────────────────────────────────────────
// Only matches "private server" or "private-server" (case-insensitive).
// Intentionally narrow — avoids the old triggers ("vip", "ps") that fired on
// every other message.
const PS_PATTERN = /\bprivate[\s-]?server\b/i;

function matchesPrivateServer(content) {
  return PS_PATTERN.test(content);
}

function vipEmbed() {
  const lines = vip.servers.length
    ? vip.servers.map((s) => `**${s.name}** — \`${s.code}\``).join('\n')
    : '_No codes have been set yet._';
  return new EmbedBuilder().setColor(vip.color || 0x9b59b6).setTitle(vip.title).setDescription(lines);
}

// ─── Cooldowns ───────────────────────────────────────────────────────────────
const COOLDOWN_MS = 60 * 1000;              // per-user: 1 min for regiment
const PS_COOLDOWN_MS = 5 * 60 * 1000;       // GLOBAL: 5 min for private-server codes
const regimentCooldown = new Map();
let lastPsSentAt = 0;                        // global timestamp — not per-user

function onCooldown(map, userId, ms = COOLDOWN_MS) {
  const now = Date.now();
  if (now - (map.get(userId) || 0) < ms) return true;
  map.set(userId, now);
  return false;
}

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    // Ignore bots/webhooks and DMs.
    if (message.author.bot || !message.guild) return;

    // Only listen in the configured chatting channel(s). CHATTING may be a single
    // ID or a comma-separated list of IDs.
    const channelIds = (process.env.CHATTING || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!channelIds.includes(message.channel.id)) return;

    const content = message.content;

    // ── Private server codes (global 5-min cooldown) ──
    if (matchesPrivateServer(content)) {
      const now = Date.now();
      if (now - lastPsSentAt < PS_COOLDOWN_MS) return; // still on cooldown — silently ignore
      lastPsSentAt = now;
      try {
        await message.reply({ embeds: [vipEmbed()] });
        console.log(`[PS] Sent server codes (triggered by ${message.author.tag})`);
      } catch (err) {
        console.error('[messageCreate] PS reply failed:', err);
      }
      return;
    }

    // ── Regiment join question ──
    if (mentionsRegiment(content)) {
      if (onCooldown(regimentCooldown, message.author.id)) return;
      const ticketsId = process.env.TICKETS_CHANNEL_ID;
      const ticketsRef = ticketsId ? `<#${ticketsId}>` : '#tickets';
      try {
        await message.reply(
          `🎖️ Want to join the **regiment**? Head over to ${ticketsRef} and open a ticket — ` +
          `we'll get you set up!`
        );
        console.log(`[AUTO-REPLY] Sent join info to ${message.author.tag}`);
      } catch (err) {
        console.error('[messageCreate] Failed to reply:', err);
      }
    }
  },

  // Exported for testing.
  mentionsRegiment,
  matchesPrivateServer,
};
