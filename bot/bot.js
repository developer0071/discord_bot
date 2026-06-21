require('dotenv').config();

const { Client, Events, GatewayIntentBits } = require('discord.js');
const cache = require('./src/cache');
const firebase = require('./src/firebase');
const metrics = require('./src/metrics');
const { handleReady } = require('./src/events/ready');
const { handleMessageCreate } = require('./src/events/messageCreate');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const context = {
  client,
  cache,
  firebase,
  metrics,
};

client.once(Events.ClientReady, async () => {
  await handleReady(context);
});

client.on(Events.MessageCreate, async (message) => {
  await handleMessageCreate(message, context);
});

/**
 * Flush pending writes and close the Discord connection.
 * @param {string} signal Process signal name.
 * @returns {Promise<void>}
 */
async function shutdown(signal) {
  console.log(`[${new Date().toISOString()}] ${signal} received. Saving pending XP data...`);
  try {
    await firebase.saveOnShutdown(cache, metrics);
  } catch (error) {
    console.error('[shutdown] Failed to save pending data:', error);
  } finally {
    client.destroy();
  }
}

process.once('SIGINT', () => {
  shutdown('SIGINT').finally(() => process.exit(0));
});

process.once('SIGTERM', () => {
  shutdown('SIGTERM').finally(() => process.exit(0));
});

process.on('unhandledRejection', (error) => {
  console.error('[unhandledRejection]', error);
});

/**
 * Start the Discord bot.
 * @returns {Promise<void>}
 */
async function start() {
  if (!process.env.DISCORD_TOKEN) {
    throw new Error('Missing DISCORD_TOKEN in the environment.');
  }

  await client.login(process.env.DISCORD_TOKEN);
}

if (require.main === module) {
  start().catch((error) => {
    console.error('[startup] Bot failed to start:', error);
    process.exitCode = 1;
  });
}

module.exports = {
  client,
  context,
  shutdown,
  start,
};
