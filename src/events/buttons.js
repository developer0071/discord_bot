const { MessageFlags } = require('discord.js');

const {
  getRegimentStatus,
  getFullQueue,
  getQueuePosition,
  addToQueue,
  removeFromQueue,
  addMember,
  isMember,
  isInQueue,
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

const EPHEMERAL = { flags: MessageFlags.Ephemeral };

// ─── Join Regiment ──────────────────────────────────────────────────────────
async function handleJoin(interaction) {
  const member = interaction.member;

  if ((await isMember(member.id)) || hasRegimentRole(member)) {
    return interaction.reply({ embeds: [errorEmbed("You're already in the regiment! 🎖️")], ...EPHEMERAL });
  }

  if (await isInQueue(member.id)) {
    const position = await getQueuePosition(member.id);
    return interaction.reply({ embeds: [errorEmbed(`You're already in the queue at position **#${position}**.`)], ...EPHEMERAL });
  }

  const status = await getRegimentStatus();

  // Slot available → assign the role straight away.
  if (status.openSlots > 0) {
    try {
      await assignRegimentRole(member);
    } catch (err) {
      console.error('[button:join] role assign failed:', err.message);
      return interaction.reply({
        embeds: [errorEmbed("I couldn't assign the regiment role — an admin needs to check my **Manage Roles** permission and role position.")],
        ...EPHEMERAL,
      });
    }
    await addMember(member.id, member.user.tag);
    await notifyAdmins(interaction.guild, adminNotifyEmbed(member, 'joined'));
    return interaction.reply({ embeds: [welcomeEmbed(member)], ...EPHEMERAL });
  }

  // Regiment full → add to the queue and mark them as a Recruit.
  const { position } = await addToQueue(member.id, member.user.tag);
  await assignRecruitRole(member).catch(err =>
    console.error('[button:join] failed to assign Recruit role:', err.message));
  return interaction.reply({ embeds: [welcomeEmbed(member, position)], ...EPHEMERAL });
}

// ─── View Queue ─────────────────────────────────────────────────────────────
async function handleViewQueue(interaction) {
  const [queue, status] = await Promise.all([getFullQueue(), getRegimentStatus()]);
  return interaction.reply({ embeds: [queueStatusEmbed(queue, status)], ...EPHEMERAL });
}

// ─── My Position ────────────────────────────────────────────────────────────
async function handleMyPosition(interaction) {
  const position = await getQueuePosition(interaction.user.id);
  if (position === null) {
    return interaction.reply({ embeds: [errorEmbed("You're not currently in the queue.")], ...EPHEMERAL });
  }
  const status = await getRegimentStatus();
  return interaction.reply({
    embeds: [successEmbed(`You're at position **#${position}** in the queue. Slots: ${status.currentCount}/${status.maxSlots}.`)],
    ...EPHEMERAL,
  });
}

// ─── Leave Queue ────────────────────────────────────────────────────────────
async function handleLeaveQueue(interaction) {
  if (!(await isInQueue(interaction.user.id))) {
    return interaction.reply({ embeds: [errorEmbed("You're not in the queue.")], ...EPHEMERAL });
  }
  await removeFromQueue(interaction.user.id);
  return interaction.reply({ embeds: [successEmbed('You have been removed from the queue.')], ...EPHEMERAL });
}

// ─── Router ─────────────────────────────────────────────────────────────────
const handlers = {
  regiment_join: handleJoin,
  regiment_queue: handleViewQueue,
  regiment_position: handleMyPosition,
  regiment_leavequeue: handleLeaveQueue,
};

async function handleButton(interaction) {
  const handler = handlers[interaction.customId];
  if (!handler) return;
  await handler(interaction);
}

module.exports = { handleButton };
