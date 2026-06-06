// ─── Auto-responder ────────────────────────────────────────────────────────────
// Watches the CHATTING channel for people talking about the regiment and points
// them to the tickets channel.

// Fires when a message mentions the regiment. Word boundaries keep it from matching
// unrelated words like "register" or "region".
const REGIMENT_PATTERN = /\b(regiment(s|al)?|regi)\b/i;

// Don't reply to the same person more than once per cooldown window.
const COOLDOWN_MS = 60 * 1000;
const lastReplied = new Map();

/**
 * Returns true if the message text mentions the regiment.
 */
function mentionsRegiment(content) {
  return REGIMENT_PATTERN.test(content);
}

module.exports = {
  name: 'messageCreate',

  async execute(message) {
    // Ignore bots/webhooks and DMs.
    if (message.author.bot || !message.guild) return;

    // Only listen in the configured chatting channel.
    const channelId = process.env.CHATTING;
    if (!channelId || message.channel.id !== channelId) return;

    if (!mentionsRegiment(message.content)) return;

    // Per-user cooldown so we don't spam someone who keeps mentioning the regiment.
    const now = Date.now();
    if (now - (lastReplied.get(message.author.id) || 0) < COOLDOWN_MS) return;
    lastReplied.set(message.author.id, now);

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
  },

  // Exported for testing the keyword matcher.
  mentionsRegiment,
};
