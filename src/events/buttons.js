const {
  MessageFlags, EmbedBuilder,
  ModalBuilder, TextInputBuilder, TextInputStyle,
  ActionRowBuilder, StringSelectMenuBuilder,
} = require('discord.js');

const info = require('../config/info');
const tradeInfo = require('../config/trade_info');
const families = require('../config/families');
const timevote = require('../utils/timevote');
const verification = require('./verification');

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
  getUserProfile,
  saveUserProfile,
  getGiveaway,
  addGiveawayEntrant,
  isGiveawayEntrant,
  castQueueVote,
} = require('../utils/firebase');

const giveawayUtil = require('../utils/giveaway');

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

// ─── Core join (assumes the interaction is already deferred) ──────────────────
async function doJoin(interaction, member, regiment) {
  if (regiment !== 'unified') {
    const status = await getRegimentStatus(regiment);

    if (status.openSlots > 0) {
      try {
        await assignRegimentRole(member, regiment);
      } catch (err) {
        console.error('[join] role assign failed:', err.message);
        return interaction.editReply({
          embeds: [errorEmbed("I couldn't assign the regiment role — an admin needs to check my **Manage Roles** permission and role position.")],
          components: [],
        });
      }
      await addMember(member.id, member.user.tag, regiment);
      await notifyAdmins(interaction.guild, adminNotifyEmbed(member, 'joined'), regiment);
      return interaction.editReply({ embeds: [welcomeEmbed(member)], components: [] });
    }
  }

  const { position } = await addToQueue(member.id, member.user.tag, regiment);
  await assignRecruitRole(member, regiment).catch((err) => console.error('[join] recruit role:', err.message));
  return interaction.editReply({ embeds: [welcomeEmbed(member, position)], components: [] });
}

// ─── Join Regiment button ─────────────────────────────────────────────────────
async function handleJoin(interaction, regiment) {
  const member = interaction.member;

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const [moonlightMember, sunshineMember, queued, profile] = await Promise.all([
    isMember(member.id, 'moonlight'),
    isMember(member.id, 'sunshine'),
    isInQueue(member.id, regiment),
    getUserProfile(member.id)
  ]);

  const inMoonlight = moonlightMember || hasRegimentRole(member, 'moonlight');
  const inSunshine = sunshineMember || hasRegimentRole(member, 'sunshine');

  if (inMoonlight || inSunshine) {
    return interaction.editReply({ embeds: [errorEmbed("You're already in a regiment! 🎖️")] });
  }
  if (queued) {
    const position = await getQueuePosition(member.id, regiment);
    return interaction.editReply({ embeds: [errorEmbed(`You're already in the queue at position **#${position}**.`)] });
  }

  if (!profile || !profile.robloxUsername) {
    const { ButtonBuilder, ButtonStyle, ActionRowBuilder, EmbedBuilder } = require('discord.js');
    const btn = new ButtonBuilder()
      .setCustomId(`open_join_modal_${regiment}`)
      .setLabel('Link Roblox Account')
      .setStyle(ButtonStyle.Success)
      .setEmoji('🎮');
    return interaction.editReply({ 
      embeds: [new EmbedBuilder().setColor(0x5865f2).setDescription("We need your Roblox username before you can join!\n\nClick the button below to link it.")],
      components: [new ActionRowBuilder().addComponents(btn)]
    });
  }

  await doJoin(interaction, member, regiment);
}

// ─── Join: collect Roblox username (modal) → family picker → join ─────────────
async function showJoinModal(interaction, regiment) {
  const modal = new ModalBuilder().setCustomId(`join_modal_${regiment}`).setTitle('Join the Regiment');
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

async function handleJoinModal(interaction) {
  let regiment = interaction.customId.replace("join_modal_", "");
  if (regiment === "join_modal") regiment = "moonlight";
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const roblox = interaction.fields.getTextInputValue('roblox_username').trim();

  await saveUserProfile(interaction.user.id, {
    discordId: interaction.user.id,
    discordTag: interaction.user.tag,
    discordUsername: interaction.user.username,
    robloxUsername: roblox,
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId(`join_families_${regiment}`)
    .setPlaceholder('Pick the families you use')
    .setMinValues(1)
    .setMaxValues(families.options.length)
    .addOptions(families.options.map((f) => ({ label: f.label, value: f.value, emoji: f.emoji })));

  await interaction.editReply({
    content: `✅ Roblox username saved: **${roblox}**\n\nNow pick the **families** you use to finish joining:`,
    components: [new ActionRowBuilder().addComponents(select)],
  });
}

async function handleJoinFamilies(interaction) {
  let regiment = interaction.customId.replace("join_families_", "");
  if (regiment === "join_families") regiment = "moonlight";
  await interaction.deferUpdate();

  const chosen = interaction.values;
  const roleIds = [];
  for (const v of chosen) {
    const fam = families.options.find((f) => f.value === v);
    if (fam && interaction.guild.roles.cache.has(fam.roleId)) roleIds.push(fam.roleId);
  }
  if (roleIds.length) {
    await interaction.member.roles.add(roleIds).catch((e) => console.error('[join] family roles:', e.message));
  }
  await saveUserProfile(interaction.user.id, { families: chosen });

  // Info collected — now actually join the regiment.
  await doJoin(interaction, interaction.member, regiment);
}

// ─── View Queue ─────────────────────────────────────────────────────────────
async function handleViewQueue(interaction, regiment) {
  const [queue, status] = await Promise.all([getFullQueue(regiment), getRegimentStatus(regiment)]);
  return interaction.editReply({ embeds: [queueStatusEmbed(queue, status)] });
}

// ─── My Position ────────────────────────────────────────────────────────────
async function handleMyPosition(interaction, regiment) {
  const position = await getQueuePosition(interaction.user.id, regiment);
  if (position === null) {
    return interaction.editReply({ embeds: [errorEmbed("You're not currently in the queue.")] });
  }
  const status = await getRegimentStatus(regiment);
  return interaction.editReply({
    embeds: [successEmbed(`You're at position **#${position}** in the queue. Slots: ${status.currentCount}/${status.maxSlots}.`)],
  });
}

// ─── Leave Queue ────────────────────────────────────────────────────────────
async function handleLeaveQueue(interaction, regiment) {
  if (!(await isInQueue(interaction.user.id, regiment))) {
    return interaction.editReply({ embeds: [errorEmbed("You're not in the queue.")] });
  }
  await removeFromQueue(interaction.user.id, regiment);
  return interaction.editReply({ embeds: [successEmbed('You have been removed from the queue.')] });
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

// ─── Giveaway entry ─────────────────────────────────────────────────────────
async function handleGiveawayEnter(interaction) {
  const giveawayId = interaction.customId.slice('giveaway_enter_'.length);
  const giveaway = await getGiveaway(giveawayId);

  if (!giveaway || giveaway.status !== 'active') {
    return interaction.editReply({ embeds: [errorEmbed('This giveaway is no longer active.')] });
  }

  const endMs = giveawayUtil.endsAtMs(giveaway);
  if (endMs && Date.now() >= endMs) {
    return interaction.editReply({ embeds: [errorEmbed('This giveaway has already ended.')] });
  }

  const requiredRoles = giveaway.requiredRoleIds || [];
  if (requiredRoles.length) {
    const hasRole = requiredRoles.some((id) => interaction.member.roles.cache.has(id));
    if (!hasRole) {
      return interaction.editReply({ embeds: [errorEmbed("You don't have the required role to enter this giveaway.")] });
    }
  }

  if (await isGiveawayEntrant(giveawayId, interaction.user.id)) {
    return interaction.editReply({ embeds: [errorEmbed("You've already entered this giveaway!")] });
  }

  await addGiveawayEntrant(giveawayId, interaction.user.id, interaction.user.tag);
  const updated = await getGiveaway(giveawayId);
  await giveawayUtil.refreshMessage(interaction.client, updated);

  return interaction.editReply({ embeds: [successEmbed(`You're in! 🎉 **${giveaway.title}** — good luck!`)] });
}

// ─── Router ─────────────────────────────────────────────────────────────────
const handlers = {
  regiment_queue: handleViewQueue,
  regiment_position: handleMyPosition,
  regiment_leavequeue: handleLeaveQueue,
};

// Info-panel sections keyed by their button id.
const infoSections = Object.fromEntries(info.sections.map((s) => [s.id, s]));
const tradeInfoSections = Object.fromEntries(tradeInfo.sections.map((s) => [s.id, s]));

async function handleButton(interaction) {
  // ── Giveaway entry (Firestore + message edit → defer first) ──
  if (interaction.customId.startsWith('giveaway_enter_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handleGiveawayEnter(interaction);
  }

  // ── Time-vote buttons (Firestore + message edit → defer first) ──
  if (interaction.customId.startsWith('tvote_')) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handleTimeVote(interaction);
  }

  // ── Vote for Specific User ──
  if (interaction.customId.startsWith('vote_user_')) {
    const targetUserId = interaction.customId.replace('vote_user_', '');
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const result = await castQueueVote(interaction.user.id, targetUserId);
    if (result.success) {
      return interaction.editReply({ embeds: [successEmbed(`✅ Your vote has been successfully cast! You can vote again in 24 hours.`)] });
    } else if (result.remainingTime) {
      const hours = Math.floor(result.remainingTime / (1000 * 60 * 60));
      const minutes = Math.floor((result.remainingTime % (1000 * 60 * 60)) / (1000 * 60));
      return interaction.editReply({ embeds: [errorEmbed(`⏳ You must wait **${hours}h ${minutes}m** before you can vote again.`)] });
    } else {
      return interaction.editReply({ embeds: [errorEmbed(`❌ Failed to cast vote: ${result.error || 'Unknown error'}`)] });
    }
  }

  // ── Join Regiment → deferred checks, might send a button to open modal ──
  if (interaction.customId.startsWith('regiment_join_')) {
    const r = interaction.customId.replace('regiment_join_', '');
    return handleJoin(interaction, r);
  }
  if (interaction.customId === 'regiment_join') {
    return handleJoin(interaction, 'moonlight');
  }

  // ── The button sent by handleJoin if they need to link Roblox (instant modal) ──
  if (interaction.customId.startsWith('open_join_modal_')) {
    const r = interaction.customId.replace('open_join_modal_', '');
    return showJoinModal(interaction, r);
  }
  if (interaction.customId === 'open_join_modal') {
    return showJoinModal(interaction, 'moonlight');
  }

  // ── Other regiment buttons (need Firestore work → defer first) ──
  let handler;
  let regimentMatch;
  for (const key of Object.keys(handlers)) {
    if (interaction.customId.startsWith(key + '_')) {
      handler = handlers[key];
      regimentMatch = interaction.customId.replace(key + '_', '');
      break;
    }
    if (interaction.customId === key) {
      handler = handlers[key];
      regimentMatch = 'moonlight';
      break;
    }
  }
  if (handler) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    return handler(interaction, regimentMatch);
  }

  // ── Verify button → opens the verification modal (must not defer first) ──
  if (interaction.customId === 'verify_member') {
    return verification.showVerifyModal(interaction);
  }

  // ── Info-panel buttons (static text → reply instantly) ──
  let section = infoSections[interaction.customId];
  if (section) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(section.color || info.panel.color)
        .setTitle(section.title)
        .setDescription(section.description)],
      flags: MessageFlags.Ephemeral,
    });
  }

  // ── Trade-panel buttons (static text → reply instantly) ──
  section = tradeInfoSections[interaction.customId];
  if (section) {
    return interaction.reply({
      embeds: [new EmbedBuilder()
        .setColor(section.color || tradeInfo.panel.color)
        .setTitle(section.title)
        .setDescription(section.description)],
      flags: MessageFlags.Ephemeral,
    });
  }
}

module.exports = { handleButton, handleJoinModal, handleJoinFamilies };
