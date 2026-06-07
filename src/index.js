require('dotenv').config();
const {
  Client,
  GatewayIntentBits,
  Partials,
  Collection,
  REST,
  Routes,
  MessageFlags,
} = require('discord.js');

const guildMemberAdd    = require('./events/guildMemberAdd');
const guildMemberRemove = require('./events/guildMemberRemove');
const messageCreate     = require('./events/messageCreate');
const { handleButton, handleJoinModal, handleJoinFamilies } = require('./events/buttons');
const verification      = require('./events/verification');
const { startWebServer } = require('./web/server');
const commands          = require('./commands/index');

// ─── Client Setup ─────────────────────────────────────────────────────────────
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.GuildMember],
});

// ─── Slash Commands Collection ────────────────────────────────────────────────
client.commands = new Collection();
for (const cmd of commands) {
  client.commands.set(cmd.data.name, cmd);
}

// ─── Events ───────────────────────────────────────────────────────────────────
client.once('clientReady', async () => {
  console.log(`\n✅ Logged in as ${client.user.tag}`);
  console.log(`📡 Serving ${client.guilds.cache.size} guild(s)\n`);
  await registerSlashCommands();
  startWebServer(client);
});

client.on('guildMemberAdd',    member => guildMemberAdd.execute(member));
client.on('guildMemberRemove', member => guildMemberRemove.execute(member));
client.on('messageCreate',     message => messageCreate.execute(message));

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);
      if (!command) return;
      await command.execute(interaction);
    } else if (interaction.isButton()) {
      await handleButton(interaction);
    } else if (interaction.isModalSubmit()) {
      if (interaction.customId === 'verify_modal') await verification.handleVerifyModal(interaction);
      else if (interaction.customId === 'join_modal') await handleJoinModal(interaction);
    } else if (interaction.isStringSelectMenu()) {
      if (interaction.customId === 'verify_families') await verification.handleFamilySelect(interaction);
      else if (interaction.customId === 'join_families') await handleJoinFamilies(interaction);
    }
  } catch (err) {
    console.error('[Interaction Error]', err);
    if (!interaction.isRepliable()) return;
    const msg = { content: '❌ Something went wrong.', flags: MessageFlags.Ephemeral };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(msg).catch(() => {});
    } else {
      await interaction.reply(msg).catch(() => {});
    }
  }
});

// ─── Register Slash Commands ──────────────────────────────────────────────────
async function registerSlashCommands() {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commandData = commands.map(c => c.data.toJSON());

  try {
    // Register to all guilds the bot is in
    for (const [guildId] of client.guilds.cache) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: commandData }
      );
      console.log(`✅ Registered ${commandData.length} slash command(s) in guild ${guildId}`);
    }
  } catch (err) {
    console.error('Failed to register slash commands:', err);
  }
}

// ─── Login ────────────────────────────────────────────────────────────────────
client.login(process.env.DISCORD_TOKEN);

// ─── Graceful Shutdown ────────────────────────────────────────────────────────
process.on('SIGINT', () => {
  console.log('\n👋 Shutting down...');
  client.destroy();
  process.exit(0);
});

process.on('unhandledRejection', err => {
  console.error('[Unhandled Rejection]:', err);
});
