const { MessageFlags, EmbedBuilder } = require('discord.js');

const info = require('../config/info');
const timevote = require('../utils/timevote');

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

// ─── Join Regiment ──────────────────────────────────────────────────────────
async function handleJoin(interaction) {
  const member = interaction.member;

  if ((await isMember(member.id)) || hasRegimentRole(member)) {
    return interaction.editReply({ embeds: [errorEmbed("You're already in the regiment! 🎖️")] });
  }

  if (await isInQueue(member.id)) {
    const position = await getQueuePosition(member.id);
    return interaction.editReply({ embeds: [errorEmbed(`You're already in the queue at position **#${position}**.`)] });
  }

  const status = await getRegimentStatus();

  // Slot available → assign the role straight away.
  if (status.openSlots > 0) {
    try {
      await assignRegimentRole(member);
    } catch (err) {
      console.error('[button:join] role assign failed:', err.message);
      return interaction.editReply({
        embeds: [errorEmbed("I couldn't assign the regiment role — an admin needs to check my **Manage Roles** permission and role position.")],
      });
    }
    await addMember(member.id, member.user.tag);
    await notifyAdmins(interaction.guild, adminNotifyEmbed(member, 'joined'));
    return interaction.editReply({ embeds: [welcomeEmbed(member)] });
  }

  // Regiment full → add to the queue and mark them as a Recruit.
  const { position } = await addToQueue(member.id, member.user.tag);
  await assignRecruitRole(member).catch(err =>
    console.error('[button:join] failed to assign Recruit role:', err.message));
  return interaction.editReply({ embeds: [welcomeEmbed(member, position)] });
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

// ─── Verify ───────────────────────────────────────────────────────────────────
async function handleVerify(interaction) {
  const roleId = process.env.VERIFIED_ROLE_ID;
  if (!roleId) {
    return interaction.reply({ embeds: [errorEmbed('Verification role is not configured. Ask an admin to set VERIFIED_ROLE_ID.')], flags: MessageFlags.Ephemeral });
  }
  const role = interaction.guild.roles.cache.get(roleId);
  if (!role) {
    return interaction.reply({ embeds: [errorEmbed('The verification role no longer exists. Ask an admin to fix it.')], flags: MessageFlags.Ephemeral });
  }
  // Already verified if they hold the access role (Recruit) or are a regiment member (Cadet).
  if (interaction.member.roles.cache.has(roleId) || hasRegimentRole(interaction.member)) {
    return interaction.reply({ embeds: [successEmbed("You're already verified! ✅")], flags: MessageFlags.Ephemeral });
  }
  try {
    await interaction.member.roles.add(role);
  } catch (err) {
    console.error('[button:verify] role add failed:', err.message);
    return interaction.reply({ embeds: [errorEmbed("I couldn't give you the role — an admin needs to check my permissions.")], flags: MessageFlags.Ephemeral });
  }
  return interaction.reply({
    embeds: [successEmbed('✅ You are now **verified** — welcome! You can see the rest of the server now.')],
    flags: MessageFlags.Ephemeral,
  });
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
  regiment_join: handleJoin,
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

  // ── Regiment action buttons (need Firestore work → defer first) ──
  const handler = handlers[interaction.customId];
  if (handler) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handler(interaction);
  }

  // ── Verify button (single role add → reply directly) ──
  if (interaction.customId === 'verify_member') {
    return handleVerify(interaction);
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

module.exports = { handleButton };
