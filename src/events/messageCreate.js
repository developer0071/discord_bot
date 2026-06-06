const { EmbedBuilder } = require('discord.js');
const vip = require('../config/vipServers');
const funny = require('../config/funny');

// Build a whole-word, case-insensitive regex from a list of trigger phrases.
// A space in a phrase also matches a hyphen or nothing.
function buildTriggerPattern(triggers) {
  return new RegExp(
    '\\b(' + triggers
      .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s-]?'))
      .join('|') + ')\\b',
    'i'
  );
}

// ─── Regiment join detection ─────────────────────────────────────────────────
// Fires when a message mentions the regiment. Word boundaries keep it from
// matching unrelated words like "register" or "region".
const REGIMENT_PATTERN = /\b(regiment(s|al)?|regi)\b/i;

function mentionsRegiment(content) {
  return REGIMENT_PATTERN.test(content);
}

// ─── VIP / private-server detection ──────────────────────────────────────────
const VIP_PATTERN = buildTriggerPattern(vip.triggers);

function matchesVipRequest(content) {
  return VIP_PATTERN.test(content);
}

function vipEmbed() {
  const lines = vip.servers.length
    ? vip.servers.map((s) => `**${s.name}** — \`${s.code}\``).join('\n')
    : '_No codes have been set yet._';
  return new EmbedBuilder().setColor(vip.color || 0x9b59b6).setTitle(vip.title).setDescription(lines);
}

// ─── Fun-fact detection (random fact each time) ──────────────────────────────
const FUNNY_PATTERN = buildTriggerPattern(funny.triggers);

function matchesFunny(content) {
  return FUNNY_PATTERN.test(content);
}

function funnyEmbed() {
  const facts = funny.facts || [];
  const fact = facts.length
    ? facts[Math.floor(Math.random() * facts.length)]
    : 'No facts set yet.';
  const desc = (funny.intro ? funny.intro + '\n\n' : '') + `• ${fact}`;
  return new EmbedBuilder().setColor(funny.color || 0x9b59b6).setTitle(funny.title).setDescription(desc);
}

// ─── Per-user cooldowns ──────────────────────────────────────────────────────
const COOLDOWN_MS = 60 * 1000;
const regimentCooldown = new Map();
const vipCooldown = new Map();
const funnyCooldown = new Map();

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

    // Only listen in the configured chatting channel(s). CHATTING may be a single
    // ID or a comma-separated list of IDs.
    const channelIds = (process.env.CHATTING || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!channelIds.includes(message.channel.id)) return;

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

    // ── Fun facts (random each time) ──
    if (matchesFunny(content)) {
      if (onCooldown(funnyCooldown, message.author.id)) return;
      try {
        await message.reply({ embeds: [funnyEmbed()] });
        console.log(`[FUNNY] Sent a fact to ${message.author.tag}`);
      } catch (err) {
        console.error('[messageCreate] Funny reply failed:', err);
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
  matchesFunny,
};
