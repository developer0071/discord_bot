const xpMath = require('./xp');
const cache = require('./cache');
const metrics = require('./metrics');
const firebaseXP = require('./firebaseXP');
const { sendLevelUpAnnouncement } = require('./levelUp');

const DEFAULT_COOLDOWN_MS = 5000;

function getCooldownMs() {
  return Number(process.env.XP_COOLDOWN_MS) || DEFAULT_COOLDOWN_MS;
}

/**
 * Award message XP when the user is off cooldown.
 * @param {import('discord.js').Message} message Discord message.
 * @param {import('discord.js').Client} client Discord client.
 */
async function awardMessageXp(message, client) {
  const userId = message.author.id;
  const now = Date.now();
  const previous = cache.getUser(userId) || {
    xp: 0,
    level: 0,
    username: message.author.username,
    lastMessageTime: 0,
  };

  if (now - previous.lastMessageTime < getCooldownMs()) return;

  const earnedXp = xpMath.generateRandomXp();
  const nextXp = previous.xp + earnedXp;
  const nextLevel = xpMath.getLevelFromXp(nextXp);

  cache.setUser(userId, {
    xp: nextXp,
    level: nextLevel,
    username: message.author.username,
    lastMessageTime: now,
  }, { dirty: true });

  if (nextLevel <= previous.level) return;

  // Level up!
  const context = { client, cache, firebase: firebaseXP, metrics };
  await sendLevelUpAnnouncement(context, userId, previous.level, nextLevel, message.guild.id);

  await firebaseXP.writeAuditLog(message.guild.id, {
    userId,
    action: 'auto_level_up',
    oldLevel: previous.level,
    newLevel: nextLevel,
    xpChange: earnedXp,
    adminId: null,
    adminName: 'system',
    reason: 'Message XP',
  }, metrics);

  await firebaseXP.appendRankHistory(message.guild.id, userId, {
    action: 'auto_level_up',
    oldLevel: previous.level,
    newLevel: nextLevel,
    xpChange: earnedXp,
    adminId: null,
    adminName: 'system',
  }, metrics);
}

module.exports = {
  awardMessageXp,
};
