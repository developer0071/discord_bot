const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const xpMath = require('../xp');
const { sendLevelUpAnnouncement } = require('../levelUp');

const COMMANDS = new Set(['rank', 'leaderboard', 'stats', 'resetstats', 'boostrank']);

/**
 * Get the configured text-command prefix.
 * @returns {string}
 */
function getPrefix() {
  return process.env.COMMAND_PREFIX || '!';
}

/**
 * Test whether a message starts with a supported bot command.
 * @param {string} content Message content.
 * @returns {boolean}
 */
function isCommand(content) {
  const prefix = getPrefix();
  if (!content.startsWith(prefix)) return false;
  const command = content.slice(prefix.length).trim().split(/\s+/)[0]?.toLowerCase();
  return COMMANDS.has(command);
}

/**
 * Parse a prefixed text command.
 * @param {string} content Message content.
 * @returns {{command:string, args:Array<string>}}
 */
function parseCommand(content) {
  const prefix = getPrefix();
  const args = content.slice(prefix.length).trim().split(/\s+/).filter(Boolean);
  const command = (args.shift() || '').toLowerCase();
  return { command, args };
}

/**
 * Check whether a member can use admin rank commands.
 * @param {import('discord.js').Message} message Discord message.
 * @returns {boolean}
 */
function isAdmin(message) {
  const configuredIds = [
    process.env.ADMIN_USER_ID,
    ...(process.env.ADMIN_USER_IDS || '').split(','),
  ].map((id) => id?.trim()).filter(Boolean);

  if (configuredIds.includes(message.author.id)) return true;
  return Boolean(message.member?.permissions?.has(PermissionFlagsBits.Administrator));
}

/**
 * Build cached rank stats for a user.
 * @param {object} context Runtime context.
 * @param {string} userId Discord user ID.
 * @param {object} userData Cached user data.
 * @returns {object}
 */
function getRankStats(context, userId, userData) {
  const cached = context.cache.getRankCache(userId);
  if (cached) {
    context.metrics.recordCacheHit();
    return cached;
  }

  context.metrics.recordCacheMiss();
  const progress = xpMath.getProgress(userData.xp, userData.level);
  const stats = {
    level: userData.level,
    xp: userData.xp,
    nextLevelXp: progress.nextLevelXp,
    progressPercent: progress.percent,
    progressBar: xpMath.formatProgressBar(progress.percent),
  };

  context.cache.setRankCache(userId, stats);
  return stats;
}

/**
 * Reply with rank stats for the author or mentioned user.
 * @param {import('discord.js').Message} message Discord message.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function handleRankCommand(message, context) {
  const targetUser = message.mentions.users.first() || message.author;
  const userData = context.cache.getUser(targetUser.id);

  if (!userData) {
    await message.reply(`${targetUser.username} has no XP yet.`);
    return;
  }

  const stats = getRankStats(context, targetUser.id, userData);
  const embed = new EmbedBuilder()
    .setTitle(`${targetUser.username}'s Rank`)
    .setThumbnail(targetUser.displayAvatarURL())
    .addFields(
      { name: 'Level', value: String(stats.level), inline: true },
      { name: 'Total XP', value: stats.xp.toLocaleString(), inline: true },
      { name: 'Progress', value: `${stats.progressBar} (${stats.progressPercent}%)`, inline: false },
      { name: 'Next Level', value: `${stats.xp.toLocaleString()} / ${stats.nextLevelXp.toLocaleString()} XP`, inline: false }
    )
    .setColor('#0099ff')
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

/**
 * Reply with the top 10 users by XP.
 * @param {import('discord.js').Message} message Discord message.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function handleLeaderboardCommand(message, context) {
  let leaders = context.cache.getLeaderboardCache();

  if (leaders) {
    context.metrics.recordCacheHit();
  } else {
    context.metrics.recordCacheMiss();
    leaders = context.cache.getAllUsers()
      .sort((a, b) => b.xp - a.xp)
      .slice(0, 10);
    context.cache.setLeaderboardCache(leaders);
  }

  if (!leaders.length) {
    await message.reply('The leaderboard is empty.');
    return;
  }

  const description = leaders
    .map((user, index) => `**${index + 1}.** ${user.username} - Level ${user.level} (${user.xp.toLocaleString()} XP)`)
    .join('\n');

  const embed = new EmbedBuilder()
    .setTitle('Top 10 Leaderboard')
    .setDescription(description)
    .setColor('#FFD700')
    .setTimestamp();

  await message.reply({ embeds: [embed] });
}

/**
 * Reply with stats for the author or mentioned user.
 * @param {import('discord.js').Message} message Discord message.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function handleStatsCommand(message, context) {
  await handleRankCommand(message, context);
}

/**
 * Reset a mentioned user's rank data.
 * @param {import('discord.js').Message} message Discord message.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function handleResetStatsCommand(message, context) {
  if (!isAdmin(message)) {
    await message.reply('You do not have permission to use that command.');
    return;
  }

  const targetUser = message.mentions.users.first();
  if (!targetUser) {
    await message.reply('Please mention a user to reset.');
    return;
  }

  const guildId = message.guild.id;
  const previous = context.cache.getUser(targetUser.id) || {
    xp: 0,
    level: 0,
    username: targetUser.username,
    lastMessageTime: 0,
  };

  context.cache.setUser(targetUser.id, {
    xp: 0,
    level: 0,
    username: targetUser.username,
    lastMessageTime: 0,
  }, { dirty: true });

  await context.firebase.writeAuditLog(guildId, {
    userId: targetUser.id,
    action: 'reset_stats',
    oldLevel: previous.level,
    newLevel: 0,
    xpChange: -previous.xp,
    adminId: message.author.id,
    adminName: message.author.tag,
    reason: 'Discord command',
  }, context.metrics);

  await context.firebase.appendRankHistory(guildId, targetUser.id, {
    action: 'reset_stats',
    oldLevel: previous.level,
    newLevel: 0,
    xpChange: -previous.xp,
    adminId: message.author.id,
    adminName: message.author.tag,
  }, context.metrics);

  await message.reply(`Reset stats for ${targetUser.username}.`);
}

/**
 * Add XP to a mentioned user and announce if they level up.
 * @param {import('discord.js').Message} message Discord message.
 * @param {Array<string>} args Command args.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function handleBoostRankCommand(message, args, context) {
  if (!isAdmin(message)) {
    await message.reply('You do not have permission to use that command.');
    return;
  }

  const targetUser = message.mentions.users.first();
  if (!targetUser) {
    await message.reply('Please mention a user to boost.');
    return;
  }

  const amountArg = args.find((arg) => /^-?\d+$/.test(arg));
  const amount = Number.parseInt(amountArg, 10);
  if (!Number.isFinite(amount) || amount <= 0) {
    await message.reply('Please provide a positive XP amount, for example `!boostrank @user 500`.');
    return;
  }

  const guildId = message.guild.id;
  const previous = context.cache.getUser(targetUser.id) || {
    xp: 0,
    level: 0,
    username: targetUser.username,
    lastMessageTime: 0,
  };

  const nextXp = previous.xp + amount;
  const nextLevel = xpMath.getLevelFromXp(nextXp);

  context.cache.setUser(targetUser.id, {
    xp: nextXp,
    level: nextLevel,
    username: targetUser.username,
    lastMessageTime: previous.lastMessageTime,
  }, { dirty: true });

  await context.firebase.writeAuditLog(guildId, {
    userId: targetUser.id,
    action: 'boost_rank',
    oldLevel: previous.level,
    newLevel: nextLevel,
    xpChange: amount,
    adminId: message.author.id,
    adminName: message.author.tag,
    reason: 'Discord command',
  }, context.metrics);

  await context.firebase.appendRankHistory(guildId, targetUser.id, {
    action: 'boost_rank',
    oldLevel: previous.level,
    newLevel: nextLevel,
    xpChange: amount,
    adminId: message.author.id,
    adminName: message.author.tag,
  }, context.metrics);

  if (nextLevel > previous.level) {
    await sendLevelUpAnnouncement(context, targetUser.id, previous.level, nextLevel, guildId);
  }

  await message.reply(`Boosted ${targetUser.username} by ${amount.toLocaleString()} XP. New level: ${nextLevel}.`);
}

/**
 * Dispatch a supported prefix command.
 * @param {import('discord.js').Message} message Discord message.
 * @param {object} context Runtime context.
 * @returns {Promise<boolean>} True when a command was handled.
 */
async function handleCommand(message, context) {
  if (!isCommand(message.content)) return false;

  const { command, args } = parseCommand(message.content);

  try {
    if (command === 'rank') await handleRankCommand(message, context);
    if (command === 'leaderboard') await handleLeaderboardCommand(message, context);
    if (command === 'stats') await handleStatsCommand(message, context);
    if (command === 'resetstats') await handleResetStatsCommand(message, context);
    if (command === 'boostrank') await handleBoostRankCommand(message, args, context);
  } catch (error) {
    console.error(`[commands] Failed to handle ${command}:`, error);
    await message.reply('Something went wrong while running that command.').catch(() => {});
  }

  return true;
}

module.exports = {
  COMMANDS,
  handleCommand,
  isCommand,
  parseCommand,
};
