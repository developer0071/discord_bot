const fs = require('fs');
let code = fs.readFileSync('src/events/buttons.js', 'utf8');

// Update doJoin to take regiment
code = code.replace(/async function doJoin\(interaction, member\) \{/, 'async function doJoin(interaction, member, regiment) {');
code = code.replace('const status = await getRegimentStatus();', 'const status = await getRegimentStatus(regiment);');
code = code.replace('await assignRegimentRole(member);', 'await assignRegimentRole(member, regiment);');
code = code.replace('await addMember(member.id, member.user.tag);', 'await addMember(member.id, member.user.tag, regiment);');
code = code.replace('await addToQueue(member.id, member.user.tag);', 'await addToQueue(member.id, member.user.tag, regiment);');
code = code.replace('await assignRecruitRole(member)', 'await assignRecruitRole(member, regiment)');

// Update handleJoin
code = code.replace(/async function handleJoin\(interaction\) \{/, 'async function handleJoin(interaction, regiment) {');
code = code.replace('if ((await isMember(member.id)) || hasRegimentRole(member)) {', 'if ((await isMember(member.id, regiment)) || hasRegimentRole(member, regiment)) {');
code = code.replace('if (await isInQueue(member.id)) {', 'if (await isInQueue(member.id, regiment)) {');
code = code.replace('const position = await getQueuePosition(member.id);', 'const position = await getQueuePosition(member.id, regiment);');
// showJoinModal needs to pass regiment, or we store it.
// Actually, if we use a modal, the customId can be 'join_modal_moonlight'
code = code.replace('return showJoinModal(interaction);', 'return showJoinModal(interaction, regiment);');
code = code.replace('await doJoin(interaction, member);', 'await doJoin(interaction, member, regiment);');

// Update showJoinModal
code = code.replace(/async function showJoinModal\(interaction\) \{/, 'async function showJoinModal(interaction, regiment) {');
code = code.replace("setCustomId('join_modal')", "setCustomId(`join_modal_${regiment}`)");

// Update handleJoinModal
code = code.replace(/async function handleJoinModal\(interaction\) \{/, 'async function handleJoinModal(interaction) {\n  const regiment = interaction.customId.replace("join_modal_", "");');
code = code.replace("setCustomId('join_families')", "setCustomId(`join_families_${regiment}`)");

// Update handleJoinFamilies
code = code.replace(/async function handleJoinFamilies\(interaction\) \{/, 'async function handleJoinFamilies(interaction) {\n  const regiment = interaction.customId.replace("join_families_", "");');
code = code.replace('await doJoin(interaction, interaction.member);', 'await doJoin(interaction, interaction.member, regiment);');

// Update view queue, etc
code = code.replace(/async function handleViewQueue\(interaction\) \{/, 'async function handleViewQueue(interaction, regiment) {');
code = code.replace('const [queue, status] = await Promise.all([getFullQueue(), getRegimentStatus()]);', 'const [queue, status] = await Promise.all([getFullQueue(regiment), getRegimentStatus(regiment)]);');

code = code.replace(/async function handleMyPosition\(interaction\) \{/, 'async function handleMyPosition(interaction, regiment) {');
code = code.replace('const position = await getQueuePosition(interaction.user.id);', 'const position = await getQueuePosition(interaction.user.id, regiment);');
code = code.replace('const status = await getRegimentStatus();', 'const status = await getRegimentStatus(regiment);');

code = code.replace(/async function handleLeaveQueue\(interaction\) \{/, 'async function handleLeaveQueue(interaction, regiment) {');
code = code.replace('if (!(await isInQueue(interaction.user.id))) {', 'if (!(await isInQueue(interaction.user.id, regiment))) {');
code = code.replace('await removeFromQueue(interaction.user.id);', 'await removeFromQueue(interaction.user.id, regiment);');

// Update the router / handleButton
code = code.replace(`  // ── Join Regiment → may open a modal or defer+join; manages its own response ──
  if (interaction.customId === 'regiment_join') {
    return handleJoin(interaction);
  }`, `  // ── Join Regiment → may open a modal or defer+join; manages its own response ──
  if (interaction.customId.startsWith('regiment_join_')) {
    const r = interaction.customId.replace('regiment_join_', '');
    return handleJoin(interaction, r);
  }`);

code = code.replace(`  // ── Other regiment buttons (need Firestore work → defer first) ──
  const handler = handlers[interaction.customId];
  if (handler) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handler(interaction);
  }`, `  // ── Other regiment buttons (need Firestore work → defer first) ──
  let handler;
  let regimentMatch;
  for (const key of Object.keys(handlers)) {
    if (interaction.customId.startsWith(key + '_')) {
      handler = handlers[key];
      regimentMatch = interaction.customId.replace(key + '_', '');
      break;
    }
  }
  if (handler) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handler(interaction, regimentMatch);
  }`);

fs.writeFileSync('src/events/buttons.js', code);
console.log('done refactoring buttons');
