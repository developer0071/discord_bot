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
  addMember,
  isMember,
  isInQueue,
  getAllMembers,
} = require('../utils/firebase');

const {
  queueStatusEmbed,
  errorEmbed,
  successEmbed,
  removeRegimentRole,
  assignRegimentRole,
  hasRegimentRole,
  adminNotifyEmbed,
  notifyAdmins,
} = require('../utils/helpers');

const { canManage, canAdd } = require('../utils/permissions');
const { promoteFromQueue } = require('../events/guildMemberRemove');
const info = require('../config/info');

// Reply used when a member lacks permission for a command.
function deny(interaction) {
  return interaction.reply({
    embeds: [errorEmbed("You don't have permission to use this command.")],
    flags: MessageFlags.Ephemeral,
  });
}

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

// ─── /promote — ADD ─────────────────────────────────────────────────────────────
const promoteCommand = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote the next person in queue into the regiment')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!canAdd(interaction.member)) return deny(interaction);
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

// ─── /add — ADD ─────────────────────────────────────────────────────────────────
const addCommand = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a specific user to the regiment')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to add')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canAdd(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');

    if (!member) {
      return interaction.editReply({ embeds: [errorEmbed('That user is not in this server.')] });
    }
    if ((await isMember(member.id)) || hasRegimentRole(member)) {
      return interaction.editReply({ embeds: [errorEmbed(`**${user.tag}** is already in the regiment.`)] });
    }

    try {
      await assignRegimentRole(member); // +Cadet, -Recruit
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed(`Couldn't assign the role: ${err.message}`)] });
    }

    if (await isInQueue(member.id)) await removeFromQueue(member.id);
    await addMember(member.id, user.tag);
    await notifyAdmins(interaction.guild, adminNotifyEmbed(member, 'joined'));

    await interaction.editReply({ embeds: [successEmbed(`**${user.tag}** has been added to the regiment.`)] });
  },
};

// ─── /members — ADD (view roster) ───────────────────────────────────────────────
const membersCommand = {
  data: new SlashCommandBuilder()
    .setName('members')
    .setDescription('Show everyone currently in the regiment')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

  async execute(interaction) {
    if (!canAdd(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [members, status] = await Promise.all([getAllMembers(), getRegimentStatus()]);

    const list = members.length
      ? members.map((m, i) => `**${i + 1}.** <@${m.userId}> — ${m.username}`).join('\n').slice(0, 4000)
      : '*No regiment members yet.*';

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`🎖️ Regiment Members — ${status.currentCount}/${status.maxSlots}`)
        .setDescription(list)
        .setTimestamp()],
    });
  },
};

// ─── /setslots — MANAGE ─────────────────────────────────────────────────────────
const setSlotsCommand = {
  data: new SlashCommandBuilder()
    .setName('setslots')
    .setDescription('Change the max regiment slots')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addIntegerOption(opt =>
      opt.setName('slots')
        .setDescription('New maximum number of regiment slots')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
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

// ─── /removemember — KICK ───────────────────────────────────────────────────────
const removeMemberCommand = {
  data: new SlashCommandBuilder()
    .setName('removemember')
    .setDescription('Remove a user from the regiment (frees their slot)')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to remove')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');

    try {
      // member is null if the user already left the server — only the role swap needs them.
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

// ─── /removequeue — KICK ────────────────────────────────────────────────────────
const removeQueueCommand = {
  data: new SlashCommandBuilder()
    .setName('removequeue')
    .setDescription('Remove a user from the queue')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to remove from queue')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    await removeFromQueue(user.id);
    await interaction.editReply({
      embeds: [successEmbed(`**${user.tag}** has been removed from the queue.`)],
    });
  },
};

// ─── /setuppanel — MANAGE ───────────────────────────────────────────────────────
const setupPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('setuppanel')
    .setDescription('Post the regiment join panel (with buttons) in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

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

// ─── /infopanel — MANAGE ────────────────────────────────────────────────────────
const infoPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('infopanel')
    .setDescription('Post the information panel (rules, guidelines, etc.) in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    const embed = new EmbedBuilder()
      .setColor(info.panel.color)
      .setTitle(info.panel.title)
      .setDescription(info.panel.description);
    if (info.panel.thumbnail) embed.setThumbnail(info.panel.thumbnail);

    // Discord allows max 5 buttons per row, 5 rows per message.
    const rows = [];
    for (let i = 0; i < info.sections.length; i += 5) {
      const row = new ActionRowBuilder().addComponents(
        info.sections.slice(i, i + 5).map((s) =>
          new ButtonBuilder()
            .setCustomId(s.id)
            .setLabel(s.label)
            .setEmoji(s.emoji)
            .setStyle(ButtonStyle[s.style] || ButtonStyle.Secondary))
      );
      rows.push(row);
    }

    await interaction.channel.send({ embeds: [embed], components: rows });
    await interaction.reply({
      embeds: [successEmbed('Information panel posted in this channel.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ─── /setupverify — MANAGE ──────────────────────────────────────────────────────
const setupVerifyCommand = {
  data: new SlashCommandBuilder()
    .setName('setupverify')
    .setDescription('Post the verification panel in this channel')
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Verify Yourself')
      .setDescription(
        'Welcome to **Moonlight Soldiers**!\n\n' +
        'Click the **Verify** button below to confirm you\'re human and unlock the rest of the server.'
      )
      .setFooter({ text: 'You only need to do this once.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_member')
        .setLabel('Verify')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({
      embeds: [successEmbed('Verification panel posted in this channel.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

module.exports = [
  queueCommand,
  myPositionCommand,
  promoteCommand,
  addCommand,
  membersCommand,
  setSlotsCommand,
  removeMemberCommand,
  removeQueueCommand,
  setupPanelCommand,
  infoPanelCommand,
  setupVerifyCommand,
];
