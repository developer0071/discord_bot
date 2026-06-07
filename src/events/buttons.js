const {
  MessageFlags, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, StringSelectMenuBuilder,
} = require('discord.js');

const info = require('../config/info');
const families = require('../config/families');
const timevote = require('../utils/timevote');
const verification = require('./verification');

const {
  getRegimentStatus,
  getFullQueue,
  getQueuePosition,
  addToQueue,
  removeFromQueue,
  addMember,
  isMember,
  isInQueue,
  setVote,
  getVotes,
  getUserProfile,
  saveUserProfile,
} = require('../utils/firebase');

const {
  assignRegimentRole,
  assignRecruitRole,
  hasRegimentRole,
  welcomeEmbed,
  queueStatusEmbed,
  errorEmbed,
  successEmbed,
  adminNotifyEmbed,
  notifyAdmins,
} = require('../utils/helpers');

// ─── Core join (assumes the interaction is already deferred) ──────────────────
async function doJoin(interaction, member) {
  const status = await getRegimentStatus();

  if (status.openSlots > 0) {
    try {
      await assignRegimentRole(member);
    } catch (err) {
      console.error('[join] role assign failed:', err.message);
      return interaction.editReply({
        embeds: [errorEmbed("I couldn't assign the regiment role — an admin needs to check my **Manage Roles** permission and role position.")],
        components: [],
      });
    }
    await addMember(member.id, member.user.tag);
    await notifyAdmins(interaction.guild, adminNotifyEmbed(member, 'joined'));
    return interaction.editReply({ embeds: [welcomeEmbed(member)], components: [] });
  }

  const { position } = await addToQueue(member.id, member.user.tag);
  await assignRecruitRole(member).catch((err) => console.error('[join] recruit role:', err.message));
  return interaction.editReply({ embeds: [welcomeEmbed(member, position)], components: [] });
}

// ─── Join Regiment button ─────────────────────────────────────────────────────
async function handleJoin(interaction) {
  const member = interaction.member;

  if ((await isMember(member.id)) || hasRegimentRole(member)) {
    return interaction.reply({ embeds: [errorEmbed("You're already in the regiment! 🎖️")], flags: MessageFlags.Ephemeral });
  }
  if (await isInQueue(member.id)) {
    const position = await getQueuePosition(member.id);
    return interaction.reply({ embeds: [errorEmbed(`You're already in the queue at position **#${position}**.`)], flags: MessageFlags.Ephemeral });
  }

  // We need their Roblox info before adding. If we already collected it at
  // verification, use it automatically. If not (didn't verify / joined before
  // the system existed), pop up the form to collect it first.
  const profile = await getUserProfile(member.id);
  if (!profile || !profile.robloxUsername) {
    return showJoinModal(interaction); // showModal must be the first response (no defer)
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await doJoin(interaction, member);
}

// ─── Join: collect Roblox username (modal) → family picker → join ─────────────
async function showJoinModal(interaction) {
  const modal = new ModalBuilder().setCustomId('join_modal').setTitle('Join the Regiment');
  const roblox = new TextInputBuilder()
    .setCustomId('roblox_username')
    .setLabel('What is your Roblox username?')
    .setPlaceholder('e.g. Builderman')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(50);
  modal.addComponents(new ActionRowBuilder().addComponents(roblox));
  await interaction.showModal(modal);
}

async function handleJoinModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const roblox = interaction.fields.getTextInputValue('roblox_username').trim();

  await saveUserProfile(interaction.user.id, {
    discordId: interaction.user.id,
    discordTag: interaction.user.tag,
    discordUsername: interaction.user.username,
    robloxUsername: roblox,
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('join_families')
    .setPlaceholder('Pick the families you use')
    .setMinValues(1)
    .setMaxValues(families.options.length)
    .addOptions(families.options.map((f) => ({ label: f.label, value: f.value, emoji: f.emoji })));

  await interaction.editReply({
    content: `✅ Roblox username saved: **${roblox}**\n\nNow pick the **families** you use to finish joining:`,
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

async function handleJoinFamilies(interaction) {
  await interaction.deferUpdate();

  const chosen = interaction.values;
  const roleIds = [];
  for (const v of chosen) {
    const fam = families.options.find((f) => f.value === v);
    if (fam && interaction.guild.roles.cache.has(fam.roleId)) roleIds.push(fam.roleId);
  }
  if (roleIds.length) {
    await interaction.member.roles.add(roleIds).catch((e) => console.error('[join] family roles:', e.message));
  }
  await saveUserProfile(interaction.user.id, { families: chosen });

  // Info collected — now actually join the regiment.
  await doJoin(interaction, interaction.member);
}

// ─── View Queue ─────────────────────────────────────────────────────────────
async function handleViewQueue(interaction) {
  const [queue, status] = await Promise.all([getFullQueue(), getRegimentStatus()]);
  return interaction.editReply({ embeds: [queueStatusEmbed(queue, status)] });
}

// ─── My Position ────────────────────────────────────────────────────────────
async function handleMyPosition(interaction) {
  const position = await getQueuePosition(interaction.user.id);
  if (position === null) {
    return interaction.editReply({ embeds: [errorEmbed("You're not currently in the queue.")] });
  }
  const status = await getRegimentStatus();
  return interaction.editReply({
    embeds: [successEmbed(`You're at position **#${position}** in the queue. Slots: ${status.currentCount}/${status.maxSlots}.`)],
  });
}

// ─── Leave Queue ────────────────────────────────────────────────────────────
async function handleLeaveQueue(interaction) {
  if (!(await isInQueue(interaction.user.id))) {
    return interaction.editReply({ embeds: [errorEmbed("You're not in the queue.")] });
  }
  await removeFromQueue(interaction.user.id);
  return interaction.editReply({ embeds: [successEmbed('You have been removed from the queue.')] });
}

// ─── Time vote ──────────────────────────────────────────────────────────────
async function handleTimeVote(interaction) {
  const option = interaction.customId.slice('tvote_'.length); // e.g. 'A'
  const pollId = interaction.message.id;

  await setVote(pollId, interaction.user.id, option);
  const counts = timevote.tally(await getVotes(pollId));

  try {
    await interaction.message.edit({
      content: timevote.buildContent(counts),
      components: timevote.buildButtons(),
    });
  } catch (err) {
    console.error('[timevote] message edit failed:', err.message);
  }

  return interaction.editReply({ embeds: [successEmbed(`Your vote for **${option}** has been recorded. ✅`)] });
}

// ─── Router ─────────────────────────────────────────────────────────────────
const handlers = {
  regiment_queue: handleViewQueue,
  regiment_position: handleMyPosition,
  regiment_leavequeue: handleLeaveQueue,
};

// Info-panel sections keyed by their button id.
const infoSections = Object.fromEntries(info.sections.map((s) => [s.id, s]));

async function handleButton(interaction) {
  // ── Time-vote buttons (Firestore + message edit → defer first) ──
  if (interaction.customId.startsWith('tvote_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handleTimeVote(interaction);
  }

  // ── Join Regiment → may open a modal or defer+join; manages its own response ──
  if (interaction.customId === 'regiment_join') {
    return handleJoin(interaction);
  }

  // ── Other regiment buttons (need Firestore work → defer first) ──
  const handler = handlers[interaction.customId];
  if (handler) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handler(interaction);
  }

  // ── Verify button → opens the verification modal (must not defer first) ──
  if (interaction.customId === 'verify_member') {
    return verification.showVerifyModal(interaction);
  }

  // ── Info-panel buttons (static text → reply instantly) ──
  const section = infoSections[interaction.customId];
  if (section) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(section.color || info.panel.color)
        .setTitle(section.title)
        .setDescription(section.description)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { handleButton, handleJoinModal, handleJoinFamilies };
