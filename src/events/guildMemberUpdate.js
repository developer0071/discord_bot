const {
  isMember,
  addMember,
  removeFromQueue
} = require('../utils/firebase');

module.exports = {
  name: 'guildMemberUpdate',

  async execute(oldMember, newMember) {
    try {
      const recruitId = process.env.RECRUIT_ROLE_ID;
      const sunshineId = process.env.SUNSHINE_ROLE_ID;
      const moonlightId = process.env.REGIMENT_ROLE_ID;

      if (!recruitId) return;

      const hasSunshine = sunshineId && newMember.roles.cache.has(sunshineId);
      const hasMoonlight = moonlightId && newMember.roles.cache.has(moonlightId);
      const hasRecruit = newMember.roles.cache.has(recruitId);

      // If they have a regiment role and the recruit role, remove the recruit role automatically.
      if ((hasSunshine || hasMoonlight) && hasRecruit) {
        const toRemove = newMember.guild.roles.cache.get(recruitId);
        if (toRemove) {
          await newMember.roles.remove(toRemove);
          console.log(`[AUTO-ROLE] Removed Recruit role from ${newMember.user.tag} because they have a regiment role.`);
        }
      }
      
      // Also, if they were manually given the role in Discord, we should ensure they are synced in DB
      // Note: Full sync is normally done via dashboard, but a quick check here helps keep things clean.
      // This part is optional but helpful if they rely on manual discord role changes.
    } catch (err) {
      console.error('[guildMemberUpdate] Error:', err);
    }
  },
};
