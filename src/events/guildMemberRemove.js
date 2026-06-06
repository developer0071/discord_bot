const {
  isMember,
  removeMember,
  isInQueue,
  removeFromQueue,
  getNextInQueue,
  getRegimentStatus,
  addMember,
} = require('../utils/firebase');

const {
  hasRegimentRole,
  assignRegimentRole,
  adminNotifyEmbed,
  promotedEmbed,
  notifyAdmins,
  sendWelcomeMessage,
} = require('../utils/helpers');

module.exports = {
  name: 'guildMemberRemove',

  async execute(member) {
    console.log(`[LEAVE] ${member.user.tag} left the server`);

    try {
      const wasInQueue = await isInQueue(member.id);
      const wasAMember = await isMember(member.id);

      // ── If they were in queue, just remove their ticket ───────────────────
      if (wasInQueue) {
        await removeFromQueue(member.id);
        console.log(`[QUEUE] ${member.user.tag} removed from queue (left server)`);
        return;
      }

      // ── If they were a regiment member, free their slot ───────────────────
      if (wasAMember || hasRegimentRole(member)) {
        await removeMember(member.id);
        await notifyAdmins(member.guild, adminNotifyEmbed(member, 'left'));
        console.log(`[LEAVE] ${member.user.tag} removed from regiment`);

        // Now check if anyone is waiting in the queue
        await promoteFromQueue(member.guild);
      }
    } catch (err) {
      console.error('[guildMemberRemove] Error:', err);
    }
  },
};

/**
 * Promote the next person in the queue to the regiment.
 * Called whenever a slot opens up (member leaves).
 */
async function promoteFromQueue(guild) {
  const next = await getNextInQueue();
  if (!next) {
    console.log('[QUEUE] No one in queue to promote');
    return;
  }

  // Fetch the guild member object
  let nextMember;
  try {
    nextMember = await guild.members.fetch(next.userId);
  } catch {
    // User is no longer in the server — remove stale queue entry and try again
    console.log(`[QUEUE] ${next.username} no longer in server, removing stale entry`);
    await removeFromQueue(next.userId);
    await promoteFromQueue(guild); // recurse to try next person
    return;
  }

  // Assign role and record in DB
  await assignRegimentRole(nextMember);
  await removeFromQueue(next.userId);
  await addMember(next.userId, nextMember.user.tag);

  const status = await getRegimentStatus();
  console.log(`[PROMOTE] ${nextMember.user.tag} promoted from queue (${status.currentCount}/${status.maxSlots})`);

  // Notify the promoted user
  try {
    await nextMember.send({ embeds: [promotedEmbed(nextMember)] });
  } catch {
    await sendWelcomeMessage(guild, nextMember, promotedEmbed(nextMember));
  }

  // Notify admins
  await notifyAdmins(guild, adminNotifyEmbed(nextMember, 'joined'));
}

module.exports.promoteFromQueue = promoteFromQueue;
