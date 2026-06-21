const { sendLevelUpAnnouncement } = require('../levelUp');

/**
 * Resolve the single guild this bot should serve.
 * @param {import('discord.js').Client} client Discord client.
 * @returns {Promise<import('discord.js').Guild|null>}
 */
async function resolveGuild(client) {
  const configuredGuildId = process.env.GUILD_ID || process.env.DISCORD_GUILD_ID;
  if (configuredGuildId) {
    return client.guilds.cache.get(configuredGuildId) || client.guilds.fetch(configuredGuildId).catch(() => null);
  }

  return client.guilds.cache.first() || null;
}

/**
 * Handle the Discord ready event.
 * @param {object} context Runtime context.
 * @returns {Promise<void>}
 */
async function handleReady(context) {
  const { client, cache, firebase, metrics } = context;
  const guild = await resolveGuild(client);

  if (!guild) {
    console.warn('[ready] Bot is online but is not in a guild yet.');
    return;
  }

  const firebaseReady = firebase.initFirebase();
  const initialUsers = firebaseReady ? await firebase.loadGuildUsers(guild.id, metrics) : {};
  cache.initCache(guild.id, initialUsers);

  firebase.startBatchWriteInterval({
    cache,
    metrics,
    intervalMs: Number(process.env.BATCH_WRITE_INTERVAL_MS) || 60000,
  });

  firebase.setupFirebaseListeners({
    guildId: guild.id,
    cache,
    metrics,
    announceLevelUp: (userId, oldLevel, newLevel, guildId) =>
      sendLevelUpAnnouncement(context, userId, oldLevel, newLevel, guildId),
  });

  metrics.startHourlyLogger();

  console.log(
    `[${new Date().toISOString()}] Bot online as ${client.user.tag}. ` +
    `Guild=${guild.name} (${guild.id}). Users loaded=${Object.keys(initialUsers).length}.`
  );
}

module.exports = {
  handleReady,
  resolveGuild,
};
