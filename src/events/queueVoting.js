const { getDb, getFullQueue, getRegimentStatus } = require('../utils/firebase');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } = require('discord.js');

function generateProgressBar(value, max, length = 15) {
  const percentage = Math.max(0, Math.min(value / max, 1));
  const filledCount = Math.round(percentage * length);
  const emptyCount = length - filledCount;
  return '█'.repeat(filledCount) + '░'.repeat(emptyCount);
}

async function buildVotingUIEmbeds(queue, status, client) {
  const mainEmbed = new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Regiment Queue Status')
    .setDescription(`**👥 Slots:** ${status.currentCount} / ${status.maxSlots} | **🟢 Open Slots:** ${status.openSlots} | **⏳ In Queue:** ${queue.length}`)
    .setTimestamp();

  const embeds = [mainEmbed];
  
  let topQueue;
  let showOverflow = false;

  if (queue.length > 9) {
    topQueue = queue.slice(0, 8);
    showOverflow = true;
  } else {
    topQueue = queue;
  }

  const maxVotesInQueue = queue.length > 0 ? Math.max(...queue.map(u => u.votes || 0)) : 1;
  const scaleMax = Math.max(10, maxVotesInQueue);

  for (const u of topQueue) {
    let avatarURL = 'https://cdn.discordapp.com/embed/avatars/0.png';
    try {
      const user = await client.users.fetch(u.userId).catch(() => null);
      if (user) avatarURL = user.displayAvatarURL();
    } catch(e) {}

    const votes = u.votes || 0;
    const progress = generateProgressBar(votes, scaleMax, 15);

    const userEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setAuthor({ name: `#${u.position} — ${u.username}`, iconURL: avatarURL })
      .setDescription(`**Votes:** ${votes}\n\`${progress}\``);
    
    embeds.push(userEmbed);
  }

  if (showOverflow) {
    const overflowEmbed = new EmbedBuilder()
      .setColor(0x2b2d31)
      .setDescription(`*...and ${queue.length - 8} more in queue.*`);
    embeds.push(overflowEmbed);
  }

  return embeds;
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
    const embeds = await buildVotingUIEmbeds(queue, status, client);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('vote_queue')
        .setLabel('🗳️ Vote for User')
        .setStyle(ButtonStyle.Primary)
    );

    const messages = await channel.messages.fetch({ limit: 20 });
    const botMessages = messages.filter(m => 
      m.author.id === client.user.id && 
      m.components.length > 0 && 
      m.components[0].components.some(c => c.customId === 'vote_queue')
    );

    let msgToKeep = null;

    if (botMessages.size > 0) {
      // Keep the newest one and delete the rest
      const sorted = Array.from(botMessages.values()).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      msgToKeep = sorted[0];

      for (let i = 1; i < sorted.length; i++) {
        await sorted[i].delete().catch(() => {});
      }
    }

    if (msgToKeep) {
      lastMessageId = msgToKeep.id;
      await msgToKeep.edit({ embeds, components: [row] }).catch(() => {});
    } else {
      const newMsg = await channel.send({ embeds, components: [row] });
      lastMessageId = newMsg.id;
    }
  } catch (error) {
    console.error('Error updating voting message:', error);
  } finally {
    isUpdating = false;
    if (pendingUpdate) {
      // Prevent max call stack size exceeded just in case
      setTimeout(() => updateVotingMessage(client), 100);
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
