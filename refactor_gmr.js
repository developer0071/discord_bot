const fs = require('fs');

// REFACTOR guildMemberRemove.js
let code = fs.readFileSync('src/events/guildMemberRemove.js', 'utf8');

code = code.replace(/async function execute\(member\) \{[\s\S]*?\}\n  \},/, `  async execute(member) {
    console.log(\`[LEAVE] \${member.user.tag} left the server\`);

    for (const regiment of ['moonlight', 'sunshine']) {
      try {
        const wasInQueue = await isInQueue(member.id, regiment);
        const wasAMember = await isMember(member.id, regiment);

        if (wasInQueue) {
          await removeFromQueue(member.id, regiment);
          console.log(\`[QUEUE] \${member.user.tag} removed from \${regiment} queue (left server)\`);
        }

        if (wasAMember || hasRegimentRole(member, regiment)) {
          await removeMember(member.id, regiment);
          await notifyAdmins(member.guild, adminNotifyEmbed(member, 'left'));
          console.log(\`[LEAVE] \${member.user.tag} removed from \${regiment} regiment\`);
          await promoteFromQueue(member.guild, regiment);
        }
      } catch (err) {
        console.error(\`[guildMemberRemove] Error (\${regiment}):\`, err);
      }
    }
  },`);

code = code.replace(/async function promoteFromQueue\(guild\) \{/g, 'async function promoteFromQueue(guild, regiment = \'moonlight\') {');
code = code.replace(/await getNextInQueue\(\)/g, 'await getNextInQueue(regiment)');
code = code.replace(/await removeFromQueue\(next\.userId\)/g, 'await removeFromQueue(next.userId, regiment)');
code = code.replace(/await assignRegimentRole\(nextMember\)/g, 'await assignRegimentRole(nextMember, regiment)');
code = code.replace(/await addMember\(next\.userId, nextMember\.user\.tag\)/g, 'await addMember(next.userId, nextMember.user.tag, regiment)');
code = code.replace(/await getRegimentStatus\(\)/g, 'await getRegimentStatus(regiment)');

fs.writeFileSync('src/events/guildMemberRemove.js', code);

console.log('done');
