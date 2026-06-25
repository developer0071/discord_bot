const { getDb, getFullQueue, getRegimentStatus } = require('../utils/firebase');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

function generateProgressBar(value, max, length = 16) {
  const percentage = Math.max(0, Math.min(value / max, 1));
  const filledCount = Math.round(percentage * length);
  const emptyCount = length - filledCount;
  return '▰'.repeat(filledCount) + '▱'.repeat(emptyCount);
}

const QUEUE_VOTING_CHANNEL_ID = '1519725084808450139';

let unsubscribeQueue = null;
let unsubscribeConfig = null;
let lastMessageId = null;

let isUpdating = false;
let pendingUpdate = false;

async function updateVotingMessage(client) {
  if (isUpdating) {
    pendingUpdate = true;
    return;
  }
  isUpdating = true;
  pendingUpdate = false;

  try {
    const channel = await client.channels.fetch(QUEUE_VOTING_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const queue = await getFullQueue();
    const status = await getRegimentStatus();

    const topQueue = queue.slice(0, 25); // Top 25 users max
    const maxVotesInQueue = queue.length > 0 ? Math.max(...queue.map(u => u.votes || 0)) : 1;
    const scaleMax = Math.max(10, maxVotesInQueue);

    const payloads = [];

    // Payload 0: Status message
    payloads.push({
      content: '',
      embeds: [
        new EmbedBuilder()
          .setColor(0x5865f2)
          .setTitle('📋 Regiment Queue Status')
          .setDescription(`**👥 Slots:** ${status.currentCount} / ${status.maxSlots} | **🟢 Open Slots:** ${status.openSlots} | **⏳ In Queue:** ${queue.length}`)
          .setTimestamp()
      ],
      components: []
    });

    // Payloads 1-N: User messages
    for (const u of topQueue) {
      let avatarURL = 'https://cdn.discordapp.com/embed/avatars/0.png';
      try {
        const user = await client.users.fetch(u.userId).catch(() => null);
        if (user) avatarURL = user.displayAvatarURL();
      } catch(e) {}

      const votes = u.votes || 0;
      const progress = generateProgressBar(votes, scaleMax, 16);

      const userEmbed = new EmbedBuilder()
        .setColor(0x5cb8b2)
        .setThumbnail(avatarURL)
        .setDescription(`## @${u.username}\n**Position:** #${u.position}  |  **Votes:** ${votes} / ${scaleMax}\n\n${progress}`);

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`vote_user_${u.userId}`)
          .setLabel('🗳️ Vote for User')
          .setStyle(ButtonStyle.Primary)
      );

      payloads.push({
        content: '',
        embeds: [userEmbed],
        components: [row]
      });
    }

    // Sync messages
    const fetched = await channel.messages.fetch({ limit: 50 });
    const botMessages = Array.from(fetched.filter(m => m.author.id === client.user.id).values())
      .sort((a, b) => a.createdTimestamp - b.createdTimestamp); // oldest first

    for (let i = 0; i < payloads.length; i++) {
      if (i < botMessages.length) {
        await botMessages[i].edit(payloads[i]).catch(() => {});
      } else {
        await channel.send(payloads[i]).catch(() => {});
      }
    }

    // Delete excess messages
    for (let i = payloads.length; i < botMessages.length; i++) {
      await botMessages[i].delete().catch(() => {});
    }

  } catch (error) {
    console.error('Error updating voting messages:', error);
  } finally {
    isUpdating = false;
    if (pendingUpdate) {
      setTimeout(() => updateVotingMessage(client), 1000);
    }
  }
}

function initQueueVotingListener(client) {
  if (unsubscribeQueue) unsubscribeQueue();
  if (unsubscribeConfig) unsubscribeConfig();

  const db = getDb();
  
  // Listen to queue collection
  unsubscribeQueue = db.collection('queue').onSnapshot(() => {
    updateVotingMessage(client);
  }, err => {
    console.error('Queue voting snapshot error:', err);
  });

  // Listen to config/regiment to update slots correctly
  unsubscribeConfig = db.collection('config').doc('regiment').onSnapshot(() => {
    updateVotingMessage(client);
  });
}

module.exports = {
  initQueueVotingListener
};
