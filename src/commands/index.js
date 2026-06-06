const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
const {
  getRegimentStatus,
  getFullQueue,
  getQueuePosition,
  removeFromQueue,
  removeMember,
  setMaxSlots,
} = require('../utils/firebase');

const {
  queueStatusEmbed,
  errorEmbed,
  successEmbed,
  removeRegimentRole,
} = require('../utils/helpers');

const { promoteFromQueue } = require('../events/guildMemberRemove');

// ─── /queue ───────────────────────────────────────────────────────────────────
const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View the current regiment queue and slot status'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [queue, status] = await Promise.all([getFullQueue(), getRegimentStatus()]);
    await interaction.editReply({ embeds: [queueStatusEmbed(queue, status)] });
  },
};

// ─── /myposition ─────────────────────────────────────────────────────────────
const myPositionCommand = {
  data: new SlashCommandBuilder()
    .setName('myposition')
    .setDescription('Check your position in the regiment queue'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const position = await getQueuePosition(interaction.user.id);
    if (position === null) {
      return interaction.editReply({
        embeds: [errorEmbed("You're not currently in the queue.")],
      });
    }
    const status = await getRegimentStatus();
    await interaction.editReply({
      embeds: [{
        color: 0xf0a500,
        title: '🎟️ Your Queue Position',
        fields: [
          { name: 'Position', value: `#${position}`, inline: true },
          { name: 'Slots', value: `${status.currentCount}/${status.maxSlots}`, inline: true },
        ],
        footer: { text: "You'll be notified when a spot opens up!" },
        timestamp: new Date().toISOString(),
      }],
    });
  },
};

// ─── /promote ─────────────────────────────────────────────────────────────────
const promoteCommand = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Admin: Manually promote the next person in queue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    try {
      await promoteFromQueue(interaction.guild);
      await interaction.editReply({
        embeds: [successEmbed('Next person in queue has been promoted to the regiment.')],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Failed to promote: ${err.message}`)] });
    }
  },
};

// ─── /setslots ────────────────────────────────────────────────────────────────
const setSlotsCommand = {
  data: new SlashCommandBuilder()
    .setName('setslots')
    .setDescription('Admin: Change the max regiment slots')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addIntegerOption(opt =>
      opt.setName('slots')
        .setDescription('New maximum number of regiment slots')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const newMax = interaction.options.getInteger('slots');
    await setMaxSlots(newMax);

    const status = await getRegimentStatus();

    // If new max is higher than current count, auto-promote from queue
    const slotsToFill = newMax - status.currentCount;
    if (slotsToFill > 0) {
      for (let i = 0; i < slotsToFill; i++) {
        await promoteFromQueue(interaction.guild);
      }
    }

    await interaction.editReply({
      embeds: [successEmbed(
        `Max slots updated to **${newMax}**.\n` +
        (slotsToFill > 0 ? `Attempted to promote **${slotsToFill}** user(s) from queue.` : '')
      )],
    });
  },
};

// ─── /removemember ────────────────────────────────────────────────────────────
const removeMemberCommand = {
  data: new SlashCommandBuilder()
    .setName('removemember')
    .setDescription('Admin: Remove a user from the regiment (frees their slot)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to remove')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');

    try {
      // member is null if the user already left the server — only the role removal needs them.
      if (member) await removeRegimentRole(member);
      await removeMember(user.id);
      await promoteFromQueue(interaction.guild);

      await interaction.editReply({
        embeds: [successEmbed(`**${user.tag}** has been removed from the regiment. Next person in queue (if any) has been promoted.`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Error: ${err.message}`)] });
    }
  },
};

// ─── /removequeue ─────────────────────────────────────────────────────────────
const removeQueueCommand = {
  data: new SlashCommandBuilder()
    .setName('removequeue')
    .setDescription('Admin: Remove a user from the queue')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to remove from queue')
        .setRequired(true)
    ),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    await removeFromQueue(user.id);
    await interaction.editReply({
      embeds: [successEmbed(`**${user.tag}** has been removed from the queue.`)],
    });
  },
};

// ─── /setuppanel ──────────────────────────────────────────────────────────────
const setupPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('setuppanel')
    .setDescription('Admin: Post the regiment join panel (with buttons) in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    const panel = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('🎖️ Join the Regiment')
      .setDescription(
        'Use the buttons below — no commands needed.\n\n' +
        '**🎖️ Join Regiment** — enlist now (or join the queue if we\'re full)\n' +
        '**📋 View Queue** — see open slots and the waiting list\n' +
        '**🎟️ My Position** — check your spot in the queue\n' +
        '**❌ Leave Queue** — drop out of the waiting list'
      )
      .setFooter({ text: 'You will be promoted automatically when a slot opens.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId('regiment_join').setLabel('Join Regiment').setEmoji('🎖️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId('regiment_queue').setLabel('View Queue').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('regiment_position').setLabel('My Position').setEmoji('🎟️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId('regiment_leavequeue').setLabel('Leave Queue').setEmoji('❌').setStyle(ButtonStyle.Danger),
    );

    await interaction.channel.send({ embeds: [panel], components: [row] });
    await interaction.reply({
      embeds: [successEmbed('Panel posted in this channel.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

module.exports = [
  queueCommand,
  myPositionCommand,
  promoteCommand,
  setSlotsCommand,
  removeMemberCommand,
  removeQueueCommand,
  setupPanelCommand,
];
