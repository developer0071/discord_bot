const { EmbedBuilder } = require('discord.js');

// ─── Embed Builders ───────────────────────────────────────────────────────────

function welcomeEmbed(member, position = null) {
  if (position) {
    // Queued welcome
    return new EmbedBuilder()
      .setColor(0xf0a500)
      .setTitle('⏳ You\'re in the Queue!')
      .setDescription(
        `Welcome, **${member.displayName}**! The regiment is currently full.\n\n` +
        `You've been added to the waiting list.`
      )
      .addFields(
        { name: '🎟️ Your Queue Position', value: `#${position}`, inline: true },
        { name: '📋 Status', value: 'Waiting for a slot to open', inline: true }
      )
      .setThumbnail(member.user.displayAvatarURL())
      .setFooter({ text: 'You will be automatically promoted when a spot opens.' })
      .setTimestamp();
  }

  // Direct welcome (slot available)
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Welcome to the Regiment!')
    .setDescription(
      `Welcome, **${member.displayName}**! You've been assigned the regiment role.`
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: 'Glad to have you with us!' })
    .setTimestamp();
}

function promotedEmbed(member) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('🎉 You\'ve Been Promoted from the Queue!')
    .setDescription(
      `Good news, **${member.displayName}**! A slot has opened up in the regiment.\n` +
      `You've been automatically assigned the regiment role.`
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setFooter({ text: 'Welcome to the regiment!' })
    .setTimestamp();
}

function adminNotifyEmbed(member, action = 'joined') {
  const isJoin = action === 'joined';
  return new EmbedBuilder()
    .setColor(isJoin ? 0x5865f2 : 0xed4245)
    .setTitle(isJoin ? '👤 New Regiment Member' : '👤 Member Left Regiment')
    .addFields(
      { name: 'User', value: `${member.user.tag} (${member.id})`, inline: true },
      { name: 'Display Name', value: member.displayName, inline: true },
      { name: 'Action', value: isJoin ? '✅ Added to regiment' : '❌ Removed from regiment', inline: false }
    )
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();
}

function queueStatusEmbed(queue, status) {
  const queueList = queue.length > 0
    ? queue.slice(0, 20).map(u => `**#${u.position}** — ${u.username}`).join('\n')
    : '*Queue is empty*';

  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle('📋 Regiment Queue Status')
    .addFields(
      { name: '👥 Slots', value: `${status.currentCount} / ${status.maxSlots}`, inline: true },
      { name: '🟢 Open Slots', value: `${status.openSlots}`, inline: true },
      { name: '⏳ In Queue', value: `${queue.length}`, inline: true },
      { name: '📜 Queue (first 20)', value: queueList }
    )
    .setTimestamp();
}

function errorEmbed(message) {
  return new EmbedBuilder()
    .setColor(0xed4245)
    .setTitle('❌ Error')
    .setDescription(message)
    .setTimestamp();
}

function successEmbed(message) {
  return new EmbedBuilder()
    .setColor(0x57f287)
    .setTitle('✅ Success')
    .setDescription(message)
    .setTimestamp();
}

// ─── Role Helpers ─────────────────────────────────────────────────────────────
// Regiment members hold the "Cadet" role (REGIMENT_ROLE_ID); everyone waiting holds
// the "Recruit" role (RECRUIT_ROLE_ID). The two are mutually exclusive — joining the
// regiment swaps Recruit → Cadet, and leaving swaps Cadet → Recruit.

async function swapRoles(member, addId, removeId) {
  const toAdd = addId ? member.guild.roles.cache.get(addId) : null;
  if (addId && !toAdd) throw new Error(`Role ${addId} not found in server`);

  if (toAdd && !member.roles.cache.has(addId)) {
    await member.roles.add(toAdd);
  }
  if (removeId && member.roles.cache.has(removeId)) {
    const toRemove = member.guild.roles.cache.get(removeId);
    if (toRemove) await member.roles.remove(toRemove);
  }
}

// Join / promote into the regiment: give Cadet, take Recruit.
async function assignRegimentRole(member) {
  if (!process.env.REGIMENT_ROLE_ID) throw new Error('REGIMENT_ROLE_ID not set in .env');
  await swapRoles(member, process.env.REGIMENT_ROLE_ID, process.env.RECRUIT_ROLE_ID);
}

// Waiting in queue: give Recruit, take Cadet.
async function assignRecruitRole(member) {
  if (!process.env.RECRUIT_ROLE_ID) return; // Recruit role is optional
  await swapRoles(member, process.env.RECRUIT_ROLE_ID, process.env.REGIMENT_ROLE_ID);
}

// Removed from the regiment → back to Recruit.
async function removeRegimentRole(member) {
  await swapRoles(member, process.env.RECRUIT_ROLE_ID, process.env.REGIMENT_ROLE_ID);
}

function hasRegimentRole(member) {
  return member.roles.cache.has(process.env.REGIMENT_ROLE_ID);
}

// ─── Channel Helpers ──────────────────────────────────────────────────────────

async function sendToChannel(guild, channelId, payload) {
  if (!channelId) return;
  const channel = guild.channels.cache.get(channelId);
  if (!channel) return;
  await channel.send(payload);
}

async function notifyAdmins(guild, embed) {
  await sendToChannel(guild, process.env.LOG_CHANNEL_ID, { embeds: [embed] });
}

async function sendWelcomeMessage(guild, member, embed) {
  await sendToChannel(guild, process.env.WELCOME_CHANNEL_ID, {
    content: `<@${member.id}>`,
    embeds: [embed],
  });
}

module.exports = {
  welcomeEmbed,
  promotedEmbed,
  adminNotifyEmbed,
  queueStatusEmbed,
  errorEmbed,
  successEmbed,
  assignRegimentRole,
  assignRecruitRole,
  removeRegimentRole,
  hasRegimentRole,
  notifyAdmins,
  sendWelcomeMessage,
  sendToChannel,
};
