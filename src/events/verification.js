const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  MessageFlags,
} = require('discord.js');

const families = require('../config/families');
const { saveUserProfile } = require('../utils/firebase');
const { successEmbed, errorEmbed } = require('../utils/helpers');

// Already verified if they hold the access role (Recruit) or are a regiment member (Cadet).
function isVerified(member) {
  const verifiedId = process.env.VERIFIED_ROLE_ID;
  const cadetId = process.env.REGIMENT_ROLE_ID;
  return (
    (verifiedId && member.roles.cache.has(verifiedId)) ||
    (cadetId && member.roles.cache.has(cadetId))
  );
}

// ─── Step 1: Verify button → show the Roblox-username modal ───────────────────
async function showVerifyModal(interaction) {
  if (isVerified(interaction.member)) {
    return interaction.reply({
      embeds: [successEmbed("You're already verified! ✅")],
      flags: MessageFlags.Ephemeral,
    });
  }

  const modal = new ModalBuilder().setCustomId('verify_modal').setTitle('Verification');
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

// ─── Step 2: Modal submit → save profile, then show the family picker ─────────
async function handleVerifyModal(interaction) {
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const roblox = interaction.fields.getTextInputValue('roblox_username').trim();

  await saveUserProfile(interaction.user.id, {
    discordId: interaction.user.id,
    discordTag: interaction.user.tag,
    discordUsername: interaction.user.username,
    robloxUsername: roblox,
    verifiedAt: Date.now(),
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('verify_families')
    .setPlaceholder('Pick the families you use')
    .setMinValues(1)
    .setMaxValues(families.options.length)
    .addOptions(families.options.map((f) => ({ label: f.label, value: f.value, emoji: f.emoji })));

  await interaction.editReply({
    content: `✅ Roblox username saved: **${roblox}**\n\nNow pick the **families** you use — then you'll be verified:`,
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

// ─── Step 3: Family select → assign family roles + access role, finish ─────────
async function handleFamilySelect(interaction) {
  await interaction.deferUpdate();

  const chosen = interaction.values;
  const assigned = [];
  const roleIdsToAdd = [];

  for (const val of chosen) {
    const fam = families.options.find((f) => f.value === val);
    if (fam && interaction.guild.roles.cache.has(fam.roleId)) {
      roleIdsToAdd.push(fam.roleId);
      assigned.push(fam.label);
    }
  }

  // Grant the access (Recruit) role too.
  const verifiedId = process.env.VERIFIED_ROLE_ID;
  if (verifiedId && interaction.guild.roles.cache.has(verifiedId)) {
    roleIdsToAdd.push(verifiedId);
  }

  try {
    await interaction.member.roles.add(roleIdsToAdd);
  } catch (err) {
    console.error('[verify] role add failed:', err.message);
    return interaction.editReply({
      embeds: [errorEmbed("I couldn't assign your roles — an admin needs to check my permissions / role position.")],
      components: [],
    });
  }

  await saveUserProfile(interaction.user.id, { families: chosen });

  await interaction.editReply({
    content:
      '✅ **Verified — welcome to Moonlight Soldiers!**\n' +
      `Families: ${assigned.length ? assigned.join(', ') : 'none'}\n` +
      'You can now see the rest of the server. Head to **#tickets** to join the regiment.',
    components: [],
  });
}

module.exports = { showVerifyModal, handleVerifyModal, handleFamilySelect };
