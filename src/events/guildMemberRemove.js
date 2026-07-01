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
      if (wasInQueue) {
        await removeFromQueue(member.id);
        console.log(`[QUEUE] ${member.user.tag} removed from global queue (left server)`);
      }

      const checkAndRemove = async (reg) => {
        const wasInReg = await isMember(member.id, reg);
        if (wasInReg || hasRegimentRole(member, reg)) {
          await removeMember(member.id, reg);
          await notifyAdmins(member.guild, adminNotifyEmbed(member, 'left'), reg);
          console.log(`[LEAVE] ${member.user.tag} removed from ${reg} regiment. Slot opened, waiting for manual promotion.`);
        }
      };

      await checkAndRemove('moonlight');
      await checkAndRemove('sunshine');

    } catch (err) {
      console.error('[guildMemberRemove] Error:', err);
    }
  },
};

/**
 * Promote the next person in the queue to the regiment.
 * Called whenever a slot opens up (member leaves).
 *
 * Uses a loop with a hard cap (MAX_STALE_RETRIES) instead of recursion to
 * prevent infinite loops when many stale queue entries exist.
 */
const MAX_STALE_RETRIES = 50;

async function promoteFromQueue(guild, regiment = 'moonlight') {
  for (let attempt = 0; attempt < MAX_STALE_RETRIES; attempt++) {
    const next = await getNextInQueue(regiment);
    if (!next) {
      console.log('[QUEUE] No one in queue to promote');
      return;
    }

    // Fetch the guild member object
    let nextMember;
    try {
      nextMember = await guild.members.fetch(next.userId);
    } catch {
      // User is no longer in the server — remove stale queue entry and try next
      console.log(`[QUEUE] ${next.username} no longer in server, removing stale entry (attempt ${attempt + 1})`);
      await removeFromQueue(next.userId, regiment);
      continue; // try next person in queue (no recursion)
    }

    // Assign role and record in DB
    await assignRegimentRole(nextMember, regiment);
    await removeFromQueue(next.userId, regiment);
    await addMember(next.userId, nextMember.user.tag, regiment);

    const status = await getRegimentStatus(regiment);
    console.log(`[PROMOTE] ${nextMember.user.tag} promoted from queue (${status.currentCount}/${status.maxSlots})`);

    // Notify the promoted user
    try {
      await nextMember.send({ embeds: [promotedEmbed(nextMember)] });
    } catch {
      await sendWelcomeMessage(guild, nextMember, promotedEmbed(nextMember));
    }

    // Notify admins
    await notifyAdmins(guild, adminNotifyEmbed(nextMember, 'joined'), regiment);
    return; // done — promoted one person
  }

  console.warn(`[QUEUE] Hit stale-entry limit (${MAX_STALE_RETRIES}), aborting promote`);
}

module.exports.promoteFromQueue = promoteFromQueue;
