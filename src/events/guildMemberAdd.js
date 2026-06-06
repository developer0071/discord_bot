const {
  getRegimentStatus,
  addToQueue,
  addMember,
} = require('../utils/firebase');

const {
  assignRegimentRole,
  assignRecruitRole,
  welcomeEmbed,
  adminNotifyEmbed,
  notifyAdmins,
  sendWelcomeMessage,
} = require('../utils/helpers');

module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    console.log(`[JOIN] ${member.user.tag} joined the server`);

    try {
      const status = await getRegimentStatus();

      // ── CASE A: Slots available → assign role immediately ─────────────────
      if (status.openSlots > 0) {
        await assignRegimentRole(member);
        await addMember(member.id, member.user.tag);

        const embed = welcomeEmbed(member);
        await sendWelcomeMessage(member.guild, member, embed);
        await notifyAdmins(member.guild, adminNotifyEmbed(member, 'joined'));

        console.log(`[JOIN] ${member.user.tag} → assigned regiment role (${status.currentCount + 1}/${status.maxSlots})`);

      // ── CASE B: Regiment full → add to queue ──────────────────────────────
      } else {
        const { alreadyQueued, position } = await addToQueue(member.id, member.user.tag);

        if (!alreadyQueued) {
          // Mark them as a Recruit while they wait.
          await assignRecruitRole(member).catch(err =>
            console.error('[guildMemberAdd] failed to assign Recruit role:', err.message));

          // Try to DM the user
          try {
            await member.send({ embeds: [welcomeEmbed(member, position)] });
          } catch {
            // DMs disabled — fall back to welcome channel
            await sendWelcomeMessage(member.guild, member, welcomeEmbed(member, position));
          }

          console.log(`[QUEUE] ${member.user.tag} → queued at position #${position} (regiment full ${status.currentCount}/${status.maxSlots})`);
        }
      }
    } catch (err) {
      console.error('[guildMemberAdd] Error:', err);
    }
  },
};
