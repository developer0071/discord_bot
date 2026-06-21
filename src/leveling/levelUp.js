const { EmbedBuilder } = require('discord.js');

/**
 * Resolve the channel used for level-up announcements.
 * @param {import('discord.js').Guild} guild Discord guild.
 * @returns {Promise<import('discord.js').TextBasedChannel|null>}
 */
async function getAnnouncementChannel(guild) {
  const channelId = process.env.LEVEL_UP_CHANNEL_ID;
  if (!channelId) return null;

  return guild.channels.cache.get(channelId) || guild.channels.fetch(channelId).catch(() => null);
}

/**
 * Send a level-up announcement embed.
 * @param {object} context Runtime context.
 * @param {string} userId Discord user ID.
 * @param {number} oldLevel Previous level.
 * @param {number} newLevel New level.
 * @param {string} guildId Discord guild ID.
 * @returns {Promise<void>}
 */
async function sendLevelUpAnnouncement(context, userId, oldLevel, newLevel, guildId) {
  const { client, cache } = context;

  try {
    const guild = client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
    if (!guild) return;

    const channel = await getAnnouncementChannel(guild);
    if (!channel?.isTextBased?.()) {
      console.warn('[levelUp] LEVEL_UP_CHANNEL_ID is missing or is not a text channel.');
      return;
    }

    const member = await guild.members.fetch(userId).catch(() => null);
    const user = member?.user || await client.users.fetch(userId).catch(() => null);
    const userData = cache.getUser(userId);
    const totalXp = userData?.xp || 0;

    const embed = new EmbedBuilder()
      .setTitle('Level-up!')
      .setDescription(`Congratulations, <@${userId}> you have reached level ${newLevel}. Keep it up!`)
      .addFields(
        { name: 'Previous Level', value: String(oldLevel), inline: true },
        { name: 'New Level', value: String(newLevel), inline: true },
        { name: 'Total XP', value: totalXp.toLocaleString(), inline: false }
      )
      .setColor('#FFD700')
      .setTimestamp();

    if (user) {
      embed.setThumbnail(user.displayAvatarURL());
    }

    await channel.send({ embeds: [embed] });
    console.log(`[${new Date().toISOString()}] ${user?.tag || userId} leveled up: ${oldLevel} -> ${newLevel}`);
  } catch (error) {
    console.error('[levelUp] Failed to send level-up announcement:', error);
  }
}

module.exports = {
  sendLevelUpAnnouncement,
};
