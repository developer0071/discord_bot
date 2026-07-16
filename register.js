require('dotenv').config();
const { Client, GatewayIntentBits, REST, Routes } = require('discord.js');
const commands = require('./src/commands/index');

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

client.once('ready', async () => {
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const commandData = commands.map(c => c.data.toJSON());

  try {
    console.log('Started refreshing application (/) commands.');
    for (const [guildId] of client.guilds.cache) {
      await rest.put(
        Routes.applicationGuildCommands(client.user.id, guildId),
        { body: commandData }
      );
      console.log(`Successfully registered commands in guild ${guildId}`);
    }
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
});

client.login(process.env.DISCORD_TOKEN);
