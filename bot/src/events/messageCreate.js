const xpMath = require('../xp');
const { handleCommand } = require('../commands');
const { sendLevelUpAnnouncement } = require('../levelUp');

const DEFAULT_COOLDOWN_MS = 5000;

/**
 * Return the XP award cooldown in milliseconds.
 * @returns {number}
 */
function getCooldownMs() {
  return Number(process.env.XP_COOLDOWN_MS) || DEFAULT_COOLDOWN_MS;
}

/**
 * Award message XP when the user is off cooldown.
 * @param {import('discord.js').Message} message Discord message.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function awardMessageXp(message, context) {
  const userId = message.author.id;
  const now = Date.now();
  const previous = context.cache.getUser(userId) || {
    xp: 0,
    level: 0,
    username: message.author.username,
    lastMessageTime: 0,
  };

  if (now - previous.lastMessageTime < getCooldownMs()) return;

  const earnedXp = xpMath.generateRandomXp();
  const nextXp = previous.xp + earnedXp;
  const nextLevel = xpMath.getLevelFromXp(nextXp);

  context.cache.setUser(userId, {
    xp: nextXp,
    level: nextLevel,
    username: message.author.username,
    lastMessageTime: now,
  }, { dirty: true });

  if (nextLevel <= previous.level) return;

  await sendLevelUpAnnouncement(context, userId, previous.level, nextLevel, message.guild.id);

  await context.firebase.writeAuditLog(message.guild.id, {
    userId,
    action: 'auto_level_up',
    oldLevel: previous.level,
    newLevel: nextLevel,
    xpChange: earnedXp,
    adminId: null,
    adminName: 'system',
    reason: 'Message XP',
  }, context.metrics);

  await context.firebase.appendRankHistory(message.guild.id, userId, {
    action: 'auto_level_up',
    oldLevel: previous.level,
    newLevel: nextLevel,
    xpChange: earnedXp,
    adminId: null,
    adminName: 'system',
  }, context.metrics);
}

/**
 * Handle Discord messageCreate events.
 * @param {import('discord.js').Message} message Discord message.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function handleMessageCreate(message, context) {
  if (message.author.bot || !message.guild) return;

  const handled = await handleCommand(message, context);
  if (handled) return;

  await awardMessageXp(message, context);
}

module.exports = {
  awardMessageXp,
  handleMessageCreate,
};
