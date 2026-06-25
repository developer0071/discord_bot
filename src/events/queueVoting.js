const { getDb, getFullQueue, getRegimentStatus } = require('../utils/firebase');
const { queueStatusEmbed } = require('../utils/helpers');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

const QUEUE_VOTING_CHANNEL_ID = '1519725084808450139';

let unsubscribeQueue = null;
let unsubscribeConfig = null;
let lastMessageId = null;

async function updateVotingMessage(client) {
  try {
    const channel = await client.channels.fetch(QUEUE_VOTING_CHANNEL_ID).catch(() => null);
    if (!channel) return;

    const queue = await getFullQueue();
    const status = await getRegimentStatus();
    const embed = queueStatusEmbed(queue, status);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('vote_queue')
        .setLabel('🗳️ Vote for User')
        .setStyle(ButtonStyle.Primary)
    );

    if (lastMessageId) {
      const msg = await channel.messages.fetch(lastMessageId).catch(() => null);
      if (msg) {
        await msg.edit({ embeds: [embed], components: [row] });
        return;
      }
    }

    // Try to find an existing bot message in the channel
    const messages = await channel.messages.fetch({ limit: 10 });
    const botMsg = messages.find(m => m.author.id === client.user.id && m.components.length > 0 && m.components[0].components.some(c => c.customId === 'vote_queue'));

    if (botMsg) {
      lastMessageId = botMsg.id;
      await botMsg.edit({ embeds: [embed], components: [row] });
    } else {
      const newMsg = await channel.send({ embeds: [embed], components: [row] });
      lastMessageId = newMsg.id;
    }
  } catch (error) {
    console.error('Error updating voting message:', error);
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
