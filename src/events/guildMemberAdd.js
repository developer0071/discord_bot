module.exports = {
  name: 'guildMemberAdd',

  async execute(member) {
    // Verification gate: new members are NOT given any role automatically.
    // They can only see #verify until they click the Verify button, which grants
    // the Recruit (access) role. Regiment membership is then chosen via the
    // #tickets "Join Regiment" panel.
    console.log(`[JOIN] ${member.user.tag} joined — awaiting verification`);
  },
};
