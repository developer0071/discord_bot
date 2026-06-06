const { EmbedBuilder } = require('discord.js');
const vip = require('../config/vipServers');

// ─── Regiment join detection ─────────────────────────────────────────────────
// Fires when a message mentions the regiment. Word boundaries keep it from
// matching unrelated words like "register" or "region".
const REGIMENT_PATTERN = /\b(regiment(s|al)?|regi)\b/i;

function mentionsRegiment(content) {
  return REGIMENT_PATTERN.test(content);
}

// ─── VIP / private-server detection ──────────────────────────────────────────
// Built from the configured trigger words. A space in a trigger also matches a
// hyphen or nothing (so 'vip server' matches "vip-server" / "vipserver").
const VIP_PATTERN = new RegExp(
  '\\b(' + vip.triggers
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?'))
    .join('|') + ')\\b',
  'i'
);

function matchesVipRequest(content) {
  return VIP_PATTERN.test(content);
}

function vipEmbed() {
  const lines = vip.servers.length
    ? vip.servers.map((s) => `**${s.name}** — \`${s.code}\``).join('\n')
    : '_No codes have been set yet._';
  return new EmbedBuilder().setColor(vip.color || 0x9b59b6).setTitle(vip.title).setDescription(lines);
}

// ─── Per-user cooldowns ──────────────────────────────────────────────────────
const COOLDOWN_MS = 60 * 1000;
const regimentCooldown = new Map();
const vipCooldown = new Map();

function onCooldown(map, userId) {
  const now = Date.now();
  if (now - (map.get(userId) || 0) < COOLDOWN_MS) return true;
  map.set(userId, now);
  return false;
}

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    // Ignore bots/webhooks and DMs.
    if (message.author.bot || !message.guild) return;

    // Only listen in the configured chatting channel.
    const channelId = process.env.CHATTING;
    if (!channelId || message.channel.id !== channelId) return;

    const content = message.content;

    // ── VIP / private-server codes ──
    if (matchesVipRequest(content)) {
      if (onCooldown(vipCooldown, message.author.id)) return;
      try {
        await message.reply({ embeds: [vipEmbed()] });
        console.log(`[VIP] Sent server codes to ${message.author.tag}`);
      } catch (err) {
        console.error('[messageCreate] VIP reply failed:', err);
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
  matchesVipRequest,
};
