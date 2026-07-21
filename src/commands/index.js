const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const ValueItem = require('../models/ValueItem');
const { calculateSide, formatNumber, fuzzyMatch, parseNumericalValue } = require('../utils/tradeParser');
const {
  getRegimentStatus,
  getFullQueue,
  getQueuePosition,
  removeFromQueue,
  removeMember,
  setMaxSlots,
  addMember,
  isMember,
  isInQueue,
  getAllMembers,
  syncRegimentCount,
} = require('../utils/firebase');

const {
  queueStatusEmbed,
  errorEmbed,
  successEmbed,
  removeRegimentRole,
  assignRegimentRole,
  hasRegimentRole,
  adminNotifyEmbed,
  notifyAdmins,
} = require('../utils/helpers');

const { canManage, canAdd } = require('../utils/permissions');
const { promoteFromQueue } = require('../events/guildMemberRemove');
const info = require('../config/info');
const tradeInfo = require('../config/trade_info');
const timevote = require('../utils/timevote');
const vip = require('../config/vipServers');


// Reply used when a member lacks permission for a command.
function deny(interaction) {
  return interaction.reply({
    embeds: [errorEmbed("You don't have permission to use this command.")],
    flags: MessageFlags.Ephemeral,
  });
}

// ─── /queue ───────────────────────────────────────────────────────────────────
const queueCommand = {
  data: new SlashCommandBuilder()
    .setName('queue')
    .setDescription('View the current regiment queue and slot status'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [queue, status] = await Promise.all([getFullQueue(), getRegimentStatus()]);
    await interaction.editReply({ embeds: [queueStatusEmbed(queue, status)] });
  },
};

// ─── /myposition ─────────────────────────────────────────────────────────────
const myPositionCommand = {
  data: new SlashCommandBuilder()
    .setName('myposition')
    .setDescription('Check your position in the regiment queue'),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const position = await getQueuePosition(interaction.user.id);
    if (position === null) {
      return interaction.editReply({
        embeds: [errorEmbed("You're not currently in the queue.")],
      });
    }
    const status = await getRegimentStatus();
    await interaction.editReply({
      embeds: [{
        color: 0xf0a500,
        title: '🎟️ Your Queue Position',
        fields: [
          { name: 'Position', value: `#${position}`, inline: true },
          { name: 'Slots', value: `${status.currentCount}/${status.maxSlots}`, inline: true },
        ],
        footer: { text: "You'll be notified when a spot opens up!" },
        timestamp: new Date().toISOString(),
      }],
    });
  },
};

// ─── /promote — ADD ─────────────────────────────────────────────────────────────
const promoteCommand = {
  data: new SlashCommandBuilder()
    .setName('promote')
    .setDescription('Promote the next person in queue into the regiment')
    .setDefaultMemberPermissions(0)
    .addStringOption(opt =>
      opt.setName('regiment')
        .setDescription('Which regiment to promote the user to')
        .setRequired(true)
        .addChoices(
          { name: 'Moonlight Soldiers', value: 'moonlight' },
          { name: 'Sunshine Soldiers', value: 'sunshine' }
        )
    ),

  async execute(interaction) {
    if (!canAdd(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const regiment = interaction.options.getString('regiment');
    try {
      await promoteFromQueue(interaction.guild, regiment);
      await interaction.editReply({
        embeds: [successEmbed(`Next person in queue has been promoted to the **${regiment}** regiment.`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Failed to promote: ${err.message}`)] });
    }
  },
};

// ─── /add — ADD ─────────────────────────────────────────────────────────────────
const addCommand = {
  data: new SlashCommandBuilder()
    .setName('add')
    .setDescription('Add a specific user to the regiment')
    .setDefaultMemberPermissions(0)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to add')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canAdd(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');

    if (!member) {
      return interaction.editReply({ embeds: [errorEmbed('That user is not in this server.')] });
    }
    if ((await isMember(member.id)) || hasRegimentRole(member)) {
      return interaction.editReply({ embeds: [errorEmbed(`**${user.tag}** is already in the regiment.`)] });
    }

    try {
      await assignRegimentRole(member); // +Cadet, -Recruit
    } catch (err) {
      return interaction.editReply({ embeds: [errorEmbed(`Couldn't assign the role: ${err.message}`)] });
    }

    if (await isInQueue(member.id)) await removeFromQueue(member.id);
    await addMember(member.id, user.tag);
    await notifyAdmins(interaction.guild, adminNotifyEmbed(member, 'joined'));

    await interaction.editReply({ embeds: [successEmbed(`**${user.tag}** has been added to the regiment.`)] });
  },
};

// ─── /members — ADD (view roster) ───────────────────────────────────────────────
const membersCommand = {
  data: new SlashCommandBuilder()
    .setName('members')
    .setDescription('Show everyone currently in the regiment')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canAdd(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const [members, status] = await Promise.all([getAllMembers(), getRegimentStatus()]);

    const list = members.length
      ? members.map((m, i) => `**${i + 1}.** <@${m.userId}> — ${m.username}`).join('\n').slice(0, 4000)
      : '*No regiment members yet.*';

    await interaction.editReply({
      embeds: [new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle(`🎖️ Regiment Members — ${status.currentCount}/${status.maxSlots}`)
        .setDescription(list)
        .setTimestamp()],
    });
  },
};

// ─── /setslots — MANAGE ─────────────────────────────────────────────────────────
const setSlotsCommand = {
  data: new SlashCommandBuilder()
    .setName('setslots')
    .setDescription('Change the max regiment slots')
    .setDefaultMemberPermissions(0)
    .addIntegerOption(opt =>
      opt.setName('slots')
        .setDescription('New maximum number of regiment slots')
        .setRequired(true)
        .setMinValue(1)
        .setMaxValue(500)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const newMax = interaction.options.getInteger('slots');
    await setMaxSlots(newMax);

    const status = await getRegimentStatus();

    await interaction.editReply({
      embeds: [successEmbed(
        `Max slots updated to **${newMax}**.`
      )],
    });
  },
};

// ─── /removemember — KICK ───────────────────────────────────────────────────────
const removeMemberCommand = {
  data: new SlashCommandBuilder()
    .setName('removemember')
    .setDescription('Remove a user from the regiment (frees their slot)')
    .setDefaultMemberPermissions(0)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to remove')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');

    try {
      // member is null if the user already left the server — only the role swap needs them.
      if (member) await removeRegimentRole(member);
      await removeMember(user.id);

      await interaction.editReply({
        embeds: [successEmbed(`**${user.tag}** has been removed from the regiment.`)],
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Error: ${err.message}`)] });
    }
  },
};

// ─── /removequeue — KICK ────────────────────────────────────────────────────────
const removeQueueCommand = {
  data: new SlashCommandBuilder()
    .setName('removequeue')
    .setDescription('Remove a user from the queue')
    .setDefaultMemberPermissions(0)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to remove from queue')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const user = interaction.options.getUser('user');
    await removeFromQueue(user.id);
    await interaction.editReply({
      embeds: [successEmbed(`**${user.tag}** has been removed from the queue.`)],
    });
  },
};

// ─── /setuppanel — MANAGE ───────────────────────────────────────────────────────
const setupPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('setuppanel')
    .setDescription('Post the regiment join panel (with buttons) in this channel')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    const panel = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle(`🎖️ Join the Regiment`)
      .setDescription(
        'Use the buttons below — no commands needed.\n\n' +
        `**🎖️ Join Queue** — enlist now to join the waiting list\n` +
        '**📋 View Queue** — see the waiting list\n' +
        '**🎟️ My Position** — check your spot in the queue\n' +
        '**❌ Leave Queue** — drop out of the waiting list'
      )
      .setFooter({ text: 'You will be promoted by a moderator when a slot opens.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`regiment_join_unified`).setLabel(`Join Queue`).setEmoji('🎖️').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`regiment_queue_unified`).setLabel('View Queue').setEmoji('📋').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`regiment_position_unified`).setLabel('My Position').setEmoji('🎟️').setStyle(ButtonStyle.Secondary),
      new ButtonBuilder().setCustomId(`regiment_leavequeue_unified`).setLabel('Leave Queue').setEmoji('❌').setStyle(ButtonStyle.Danger),
    );

    await interaction.channel.send({ embeds: [panel], components: [row] });
    await interaction.reply({
      embeds: [successEmbed(`Unified Regiment Queue panel posted in this channel.`)],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ─── /infopanel — MANAGE ────────────────────────────────────────────────────────
const infoPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('infopanel')
    .setDescription('Post the information panel (rules, guidelines, etc.) in this channel')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    const embed = new EmbedBuilder()
      .setColor(info.panel.color)
      .setTitle(info.panel.title)
      .setDescription(info.panel.description);
    if (info.panel.thumbnail) embed.setThumbnail(info.panel.thumbnail);

    // Discord allows max 5 buttons per row, 5 rows per message.
    const rows = [];
    for (let i = 0; i < info.sections.length; i += 5) {
      const row = new ActionRowBuilder().addComponents(
        info.sections.slice(i, i + 5).map((s) =>
          new ButtonBuilder()
            .setCustomId(s.id)
            .setLabel(s.label)
            .setEmoji(s.emoji)
            .setStyle(ButtonStyle[s.style] || ButtonStyle.Secondary))
      );
      rows.push(row);
    }

    await interaction.channel.send({ embeds: [embed], components: rows });
    await interaction.reply({
      embeds: [successEmbed('Information panel posted in this channel.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ─── /sendtradeinstructionpanel — MANAGE ────────────────────────────────────────────────────────
const sendTradeInstructionPanelCommand = {
  data: new SlashCommandBuilder()
    .setName('sendtradeinstructionpanel')
    .setDescription('Post the trade instructions panel in this channel')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    const embed = new EmbedBuilder()
      .setColor(tradeInfo.panel.color)
      .setTitle(tradeInfo.panel.title)
      .setDescription(tradeInfo.panel.description);
    if (tradeInfo.panel.thumbnail) embed.setThumbnail(tradeInfo.panel.thumbnail);

    const rows = [];
    for (let i = 0; i < tradeInfo.sections.length; i += 5) {
      const row = new ActionRowBuilder().addComponents(
        tradeInfo.sections.slice(i, i + 5).map((s) =>
          new ButtonBuilder()
            .setCustomId(s.id)
            .setLabel(s.label)
            .setEmoji(s.emoji)
            .setStyle(ButtonStyle[s.style] || ButtonStyle.Secondary))
      );
      rows.push(row);
    }

    await interaction.channel.send({ embeds: [embed], components: rows });
    await interaction.reply({
      embeds: [successEmbed('Trade instructions panel posted in this channel.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ─── /clearchat — MANAGE ────────────────────────────────────────────────────────
const clearChatCommand = {
  data: new SlashCommandBuilder()
    .setName('clearchat')
    .setDescription('Delete up to 10 messages in the current channel')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    let deletedCount = 0;
    let fetching = true;

    try {
      while (fetching && deletedCount < 10) {
        const messages = await interaction.channel.messages.fetch({ limit: 10 });
        if (messages.size === 0) {
          fetching = false;
          break;
        }

        const twoWeeksAgo = Date.now() - 14 * 24 * 60 * 60 * 10;
        const messagesToDelete = messages.filter(msg => msg.createdTimestamp > twoWeeksAgo);

        if (messagesToDelete.size === 0) {
          fetching = false;
          break;
        }

        const deleted = await interaction.channel.bulkDelete(messagesToDelete, true);
        deletedCount += deleted.size;

        if (deleted.size < messages.size) {
          fetching = false;
        }

        await new Promise(r => setTimeout(r, 10));
      }

      await interaction.editReply({ embeds: [successEmbed(`✅ Cleared ${deletedCount} messages.`)] });
    } catch (err) {
      console.error('Clear chat error:', err);
      await interaction.editReply({ embeds: [errorEmbed(`❌ Error clearing chat: ${err.message}`)] });
    }
  }
};

// ─── /timevote — MANAGE ─────────────────────────────────────────────────────────
const timeVoteCommand = {
  data: new SlashCommandBuilder()
    .setName('timevote')
    .setDescription("Post a UTC time vote that auto-converts to each member's local time")
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    await interaction.channel.send({
      content: timevote.buildContent(),
      components: timevote.buildButtons(),
    });
    await interaction.reply({
      embeds: [successEmbed('Time vote posted — members can click a letter to vote.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ─── /setupverify — MANAGE ──────────────────────────────────────────────────────
const setupVerifyCommand = {
  data: new SlashCommandBuilder()
    .setName('setupverify')
    .setDescription('Post the verification panel in this channel')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    const embed = new EmbedBuilder()
      .setColor(0x57f287)
      .setTitle('✅ Verify Yourself')
      .setDescription(
        'Welcome to **Moonlight Soldiers**!\n\n' +
        'Click the **Verify** button below to confirm you\'re human and unlock the rest of the server.'
      )
      .setFooter({ text: 'You only need to do this once.' });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('verify_member')
        .setLabel('Verify')
        .setEmoji('✅')
        .setStyle(ButtonStyle.Success)
    );

    await interaction.channel.send({ embeds: [embed], components: [row] });
    await interaction.reply({
      embeds: [successEmbed('Verification panel posted in this channel.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ─── /giverole — MANAGE (mass-assign a role) ────────────────────────────────────
const giveRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('giverole')
    .setDescription('Give a role to all members (or a single user) in the server')
    .setDefaultMemberPermissions(0)
    .addRoleOption(opt =>
      opt.setName('role')
        .setDescription('The role to assign')
        .setRequired(true)
    )
    .addStringOption(opt =>
      opt.setName('who')
        .setDescription('Who to give the role to ("all" or mention a user)')
        .setRequired(false)
    )
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('A specific user to give the role to (instead of all)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    const role = interaction.options.getRole('role');
    const who  = (interaction.options.getString('who') || 'all').toLowerCase().trim();
    const singleUser = interaction.options.getUser('user');

    // Validate the role is assignable by the bot
    const botMember = interaction.guild.members.me;
    if (role.position >= botMember.roles.highest.position) {
      return interaction.reply({
        embeds: [errorEmbed(`I can't assign **${role.name}** — it's higher than (or equal to) my highest role.`)],
        flags: MessageFlags.Ephemeral,
      });
    }
    if (role.managed) {
      return interaction.reply({
        embeds: [errorEmbed(`**${role.name}** is a bot/integration-managed role and can't be assigned manually.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── Single-user mode ──
    if (singleUser || (who !== 'all')) {
      let targetMember;
      if (singleUser) {
        targetMember = interaction.options.getMember('user');
      } else {
        // Try to parse a user ID from the 'who' string
        const idMatch = who.replace(/[<@!>]/g, '');
        try { targetMember = await interaction.guild.members.fetch(idMatch); } catch { targetMember = null; }
      }
      if (!targetMember) {
        return interaction.reply({
          embeds: [errorEmbed('Could not find that user in this server. Use `all` or mention a valid user.')],
          flags: MessageFlags.Ephemeral,
        });
      }
      if (targetMember.roles.cache.has(role.id)) {
        return interaction.reply({
          embeds: [errorEmbed(`**${targetMember.user.tag}** already has the **${role.name}** role.`)],
          flags: MessageFlags.Ephemeral,
        });
      }
      await targetMember.roles.add(role);
      return interaction.reply({
        embeds: [successEmbed(`Assigned **${role.name}** to **${targetMember.user.tag}**.`)],
        flags: MessageFlags.Ephemeral,
      });
    }

    // ── All-members mode ──
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    // Fetch every member (forces the cache to be complete)
    const allMembers = await interaction.guild.members.fetch();

    // Filter out bots and members who already have the role
    const targets = allMembers.filter(m => !m.user.bot && !m.roles.cache.has(role.id));

    if (targets.size === 0) {
      return interaction.editReply({
        embeds: [successEmbed(`Everyone already has the **${role.name}** role — nothing to do! ✅`)],
      });
    }

    await interaction.editReply({
      embeds: [{
        color: 0xf0a500,
        title: '⏳ Assigning role…',
        description: `Giving **${role.name}** to **${targets.size}** member(s). This may take a moment…`,
      }],
    });

    let assigned = 0, failed = 0;
    for (const [, member] of targets) {
      try {
        await member.roles.add(role);
        assigned++;
      } catch {
        failed++;
      }
      // Progress update every 25 members
      if ((assigned + failed) % 25 === 0) {
        await interaction.editReply({
          embeds: [{
            color: 0xf0a500,
            title: '⏳ Assigning role…',
            description: `Progress: **${assigned + failed}**/${targets.size}\n✅ ${assigned} assigned · ❌ ${failed} failed`,
          }],
        }).catch(() => {});
      }
    }

    const embed = new EmbedBuilder()
      .setColor(failed === 0 ? 0x57f287 : 0xf0a500)
      .setTitle('✅ Role assignment complete')
      .setDescription(
        `**${role.name}** has been given to **${assigned}** member(s).` +
        (failed > 0 ? `\n⚠️ Failed for **${failed}** member(s) (permission issues).` : '')
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

// ─── /ps — Private server codes ─────────────────────────────────────────────
const psCommand = {
  data: new SlashCommandBuilder()
    .setName('ps')
    .setDescription('Show private server codes'),

  async execute(interaction) {
    const lines = vip.servers.length
      ? vip.servers.map((s) => `**${s.name}** — \`${s.code}\``).join('\n')
      : '_No codes have been set yet._';

    const embed = new EmbedBuilder()
      .setColor(vip.color || 0x9b59b6)
      .setTitle(vip.title)
      .setDescription(lines);

    await interaction.reply({ embeds: [embed] });
  },
};

// ─── /utc — Post a UTC time vote ─────────────────────────────────────────────
const utcCommand = {
  data: new SlashCommandBuilder()
    .setName('utc')
    .setDescription('Post a UTC time vote that auto-converts to each member\'s local time'),

  async execute(interaction) {
    await interaction.channel.send({
      content: timevote.buildContent(),
      components: timevote.buildButtons(),
    });
    await interaction.reply({
      embeds: [successEmbed('Time vote posted — members can click a letter to vote.')],
      flags: MessageFlags.Ephemeral,
    });
  },
};

// ─── /transferbannerticketowner ────────────────────────────────────────────────
const transferBannerCommand = {
  data: new SlashCommandBuilder()
    .setName('transferbannerticketowner')
    .setDescription('Transfer join/leave banners from tickets to the new TICKET-OWNERS channel')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sourceChannelId = process.env.LOG_CHANNEL_ID;
    const targetChannelId = process.env.TICKET_OWNERS_CHANNEL_ID;

    if (!sourceChannelId || !targetChannelId) {
      return interaction.editReply({ embeds: [errorEmbed('Source or target channel ID is missing in .env.')] });
    }
    if (sourceChannelId === targetChannelId) {
      return interaction.editReply({ embeds: [errorEmbed('Source and target channels are the same.')] });
    }

    const sourceChannel = interaction.guild.channels.cache.get(sourceChannelId);
    const targetChannel = interaction.guild.channels.cache.get(targetChannelId);

    if (!sourceChannel || !targetChannel) {
      return interaction.editReply({ embeds: [errorEmbed('Could not find the source or target channel in this server.')] });
    }

    await interaction.editReply({ embeds: [{ color: 0xf0a500, title: '⏳ Transferring Banners...', description: 'Fetching and moving banners...' }] });

    let transferred = 0;
    let failed = 0;
    let lastMessageId = null;
    let keepGoing = true;

    while (keepGoing) {
      const options = { limit: 100 };
      if (lastMessageId) options.before = lastMessageId;
      
      const messages = await sourceChannel.messages.fetch(options).catch(() => null);
      if (!messages || messages.size === 0) break;

      lastMessageId = messages.last().id;

      for (const [, msg] of messages) {
        if (msg.author.id !== interaction.client.user.id) continue;
        if (msg.embeds.length === 0) continue;

        const embed = msg.embeds[0];
        const isBanner = embed.title === '👤 New Regiment Member' || embed.title === '👤 Member Left Regiment';
        
        if (isBanner) {
          try {
            await targetChannel.send({ embeds: [embed] });
            await msg.delete();
            transferred++;
          } catch (e) {
            failed++;
          }
        }
      }
    }

    await interaction.editReply({ 
      embeds: [successEmbed(`Transferred **${transferred}** banner(s) to the new channel.\n${failed > 0 ? `Failed to transfer ${failed} banner(s).` : ''}`)] 
    });
  },
};

// ─── /transfersunticketowners ────────────────────────────────────────────────
const transferSunBannerCommand = {
  data: new SlashCommandBuilder()
    .setName('transfersunticketowners')
    .setDescription('Transfer join/leave banners for Sunshine to the new Sunshine TICKET-OWNERS channel')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);

    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const sourceChannelId = process.env.TICKET_OWNERS_CHANNEL_ID || process.env.LOG_CHANNEL_ID;
    const targetChannelId = process.env['TICKET-HOLDERS-SUNSHINE'];

    if (!sourceChannelId || !targetChannelId) {
      return interaction.editReply({ embeds: [errorEmbed('Source or target channel ID is missing in .env.')] });
    }
    if (sourceChannelId === targetChannelId) {
      return interaction.editReply({ embeds: [errorEmbed('Source and target channels are the same.')] });
    }

    const sourceChannel = interaction.guild.channels.cache.get(sourceChannelId);
    const targetChannel = interaction.guild.channels.cache.get(targetChannelId);

    if (!sourceChannel || !targetChannel) {
      return interaction.editReply({ embeds: [errorEmbed('Could not find the source or target channel in this server.')] });
    }

    await interaction.editReply({ embeds: [{ color: 0xf0a500, title: '⏳ Transferring Sunshine Banners...', description: 'Fetching and moving banners...' }] });

    let transferred = 0;
    let failed = 0;
    let lastMessageId = null;
    let keepGoing = true;

    while (keepGoing) {
      const options = { limit: 100 };
      if (lastMessageId) options.before = lastMessageId;
      
      const messages = await sourceChannel.messages.fetch(options).catch(() => null);
      if (!messages || messages.size === 0) break;

      lastMessageId = messages.last().id;

      for (const [, msg] of messages) {
        if (msg.author.id !== interaction.client.user.id) continue;
        if (msg.embeds.length === 0) continue;

        const embed = msg.embeds[0];
        const isBanner = embed.title === '👤 New Regiment Member' || embed.title === '👤 Member Left Regiment';
        
        if (isBanner) {
          const userField = embed.fields?.find(f => f.name === 'User');
          if (!userField) continue;
          
          const match = userField.value.match(/\((\d+)\)/);
          if (!match) continue;
          const userId = match[1];

          // Check if user is currently in sunshine
          const inSunshine = await isMember(userId, 'sunshine');
          if (inSunshine) {
            try {
              await targetChannel.send({ embeds: [embed] });
              await msg.delete();
              transferred++;
            } catch (e) {
              failed++;
            }
          }
        }
      }
    }

    await interaction.editReply({ 
      embeds: [successEmbed(`Transferred **${transferred}** Sunshine banner(s) to the new channel.\n${failed > 0 ? `Failed to transfer ${failed} banner(s).` : ''}`)] 
    });
  },
};
// ─── /fixrole — MANAGE (swap roles) ────────────────────────────────────────────────
const fixRoleCommand = {
  data: new SlashCommandBuilder()
    .setName('fixrole')
    .setDescription('Swap roles for a user (e.g. remove Recruit, add Suncadet)')
    .setDefaultMemberPermissions(0)
    .addUserOption(opt =>
      opt.setName('user')
        .setDescription('The user to modify')
        .setRequired(true)
    )
    .addRoleOption(opt =>
      opt.setName('remove')
        .setDescription('Role to remove (e.g., Recruit)')
        .setRequired(false)
    )
    .addRoleOption(opt =>
      opt.setName('add')
        .setDescription('Role to add (e.g., Suncadet)')
        .setRequired(false)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const user = interaction.options.getUser('user');
    const member = interaction.options.getMember('user');
    const removeRole = interaction.options.getRole('remove');
    const addRole = interaction.options.getRole('add');

    if (!member) {
      return interaction.editReply({ embeds: [errorEmbed('That user is not in this server.')] });
    }
    
    if (!removeRole && !addRole) {
      return interaction.editReply({ embeds: [errorEmbed('You must specify a role to remove or add (or both).')] });
    }
    
    // Check role hierarchy before attempting changes
    const botMember = interaction.guild.members.me;
    if (removeRole && removeRole.position >= botMember.roles.highest.position) {
      return interaction.editReply({ embeds: [errorEmbed(`I can't remove **${removeRole.name}** — it's higher than or equal to my highest role.`)] });
    }
    if (addRole && addRole.position >= botMember.roles.highest.position) {
      return interaction.editReply({ embeds: [errorEmbed(`I can't assign **${addRole.name}** — it's higher than or equal to my highest role.`)] });
    }

    let replyMsg = `Fixed roles for **${user.tag}**:`;
    let changesMade = false;
    
    try {
      if (removeRole) {
        if (member.roles.cache.has(removeRole.id)) {
          await member.roles.remove(removeRole);
          replyMsg += `\n➖ Removed **${removeRole.name}**`;
          changesMade = true;
        } else {
          replyMsg += `\n⚠️ User didn't have **${removeRole.name}**`;
        }
      }
      
      if (addRole) {
        if (!member.roles.cache.has(addRole.id)) {
          await member.roles.add(addRole);
          replyMsg += `\n➕ Added **${addRole.name}**`;
          changesMade = true;
        } else {
          replyMsg += `\n⚠️ User already had **${addRole.name}**`;
        }
      }
      
      if (!changesMade) {
        replyMsg += `\n\nNo actual role changes were needed.`;
      }
      
      await interaction.editReply({ embeds: [successEmbed(replyMsg)] });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Error modifying roles: ${err.message}`)] });
    }
  },
};

// ─── /givechannelaccess — MANAGE (grant permissions) ──────────────────────────
const giveChannelAccessCommand = {
  data: new SlashCommandBuilder()
    .setName('givechannelaccess')
    .setDescription('Grant specific permissions to a role for a category or channel')
    .setDefaultMemberPermissions(0)
    .addRoleOption(opt =>
      opt.setName('role')
        .setDescription('The role to grant access to (e.g. SunCadet)')
        .setRequired(true)
    )
    .addChannelOption(opt =>
      opt.setName('target')
        .setDescription('The category or channel to modify')
        .setRequired(true)
        .addChannelTypes(
          ChannelType.GuildCategory,
          ChannelType.GuildText,
          ChannelType.GuildVoice,
          ChannelType.GuildAnnouncement,
          ChannelType.GuildForum
        )
    )
    .addBooleanOption(opt =>
      opt.setName('view_channel')
        .setDescription('Grant View Channel permission? (True = Yes, False = Leave unchanged)')
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('send_messages')
        .setDescription('Grant Send Messages permission? (True = Yes, False = Leave unchanged)')
        .setRequired(true)
    )
    .addBooleanOption(opt =>
      opt.setName('read_history')
        .setDescription('Grant Read Message History permission? (True = Yes, False = Leave unchanged)')
        .setRequired(true)
    ),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const role = interaction.options.getRole('role');
    const target = interaction.options.getChannel('target');
    const view = interaction.options.getBoolean('view_channel');
    const send = interaction.options.getBoolean('send_messages');
    const read = interaction.options.getBoolean('read_history');

    const permsToSet = {};
    if (view) permsToSet.ViewChannel = true;
    if (send) permsToSet.SendMessages = true;
    if (read) permsToSet.ReadMessageHistory = true;

    if (Object.keys(permsToSet).length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('You must select True for at least one permission to grant.')] });
    }

    try {
      await target.permissionOverwrites.edit(role.id, permsToSet);
      
      const grantedList = Object.keys(permsToSet).join(', ');
      await interaction.editReply({ 
        embeds: [successEmbed(`Successfully granted **${grantedList}** to **${role.name}** in **${target.name}**.`)] 
      });
    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Failed to update permissions: ${err.message}`)] });
    }
  },
};

// ─── /syncdata — Auto Sync Databases ──────────────────────────────────────────
const syncDataCommand = {
  data: new SlashCommandBuilder()
    .setName('syncdata')
    .setDescription('Auto-analyze and synchronize Discord members with the website databases')
    .setDefaultMemberPermissions(0),

  async execute(interaction) {
    if (!canManage(interaction.member)) return deny(interaction);
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const moonlightRoleId = process.env.REGIMENT_ROLE_ID;
    const sunshineRoleId = process.env.SUNSHINE_ROLE_ID;

    if (!moonlightRoleId || !sunshineRoleId) {
      return interaction.editReply({ embeds: [errorEmbed('REGIMENT_ROLE_ID or SUNSHINE_ROLE_ID is missing in .env')] });
    }

    try {
      // 1. Fetch all members from Discord
      const allMembers = await interaction.guild.members.fetch();
      
      // 2. Separate by role
      const discordMoonlight = allMembers.filter(m => !m.user.bot && m.roles.cache.has(moonlightRoleId));
      const discordSunshine = allMembers.filter(m => !m.user.bot && m.roles.cache.has(sunshineRoleId));

      // 3. Fetch from DB
      const dbMoonlight = await getAllMembers('moonlight');
      const dbSunshine = await getAllMembers('sunshine');

      let mlAdded = 0, mlRemoved = 0;
      let sunAdded = 0, sunRemoved = 0;

      // --- MOONLIGHT SYNC ---
      // Add missing to DB
      for (const [id, member] of discordMoonlight) {
        if (!dbMoonlight.find(m => m.userId === id)) {
          await addMember(id, member.user.tag, 'moonlight');
          mlAdded++;
        }
      }
      // Remove extraneous from DB
      for (const dbUser of dbMoonlight) {
        if (!discordMoonlight.has(dbUser.userId)) {
          await removeMember(dbUser.userId, 'moonlight');
          mlRemoved++;
        }
      }
      await syncRegimentCount('moonlight');

      // --- SUNSHINE SYNC ---
      // Add missing to DB
      for (const [id, member] of discordSunshine) {
        if (!dbSunshine.find(m => m.userId === id)) {
          await addMember(id, member.user.tag, 'sunshine');
          sunAdded++;
        }
      }
      // Remove extraneous from DB
      for (const dbUser of dbSunshine) {
        if (!discordSunshine.has(dbUser.userId)) {
          await removeMember(dbUser.userId, 'sunshine');
          sunRemoved++;
        }
      }
      await syncRegimentCount('sunshine');

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle('✅ Database Sync Complete')
        .setDescription('The website databases have been perfectly synchronized with current Discord roles.')
        .addFields(
          { name: 'Moonlight Soldiers', value: `➕ Added: ${mlAdded}\\n➖ Removed: ${mlRemoved}`, inline: true },
          { name: 'Sunshine Soldiers', value: `➕ Added: ${sunAdded}\\n➖ Removed: ${sunRemoved}`, inline: true }
        )
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      await interaction.editReply({ embeds: [errorEmbed(`Failed to sync data: ${err.message}`)] });
    }
  },
};

// ─── /value — AOT:R Trade Values ──────────────────────────────────────────────
function multiplyValueString(str, amount) {
  if (!str || str === 'N/A' || str.toLowerCase() === 'stable' || str.toLowerCase() === 'rising' || str.toLowerCase() === 'dropping') return str;
  if (amount <= 1) return str;
  
  return str.replace(/[\d,.]+/g, (match) => {
    let cleanNum = match.replace(/,/g, '');
    let num = parseFloat(cleanNum);
    if (isNaN(num)) return match;
    
    let result = num * amount;
    if (result >= 1000 && !result.toString().includes('.')) {
      return result.toLocaleString('en-US');
    }
    return Number(result.toFixed(2)).toString();
  });
}

// Detects if an item name is a perk (contains +N level suffix)
// Returns true if the item belongs to the perk category
function isPerkItem(itemName) {
  return /\+\d+\s*$/.test(itemName);
}

// Given a perk base name (e.g. "Founder's Blessing"), find all level variants in DB
function getPerkLevelVariants(baseName, allItemNames) {
  const lowerBase = baseName.replace(/\s*\+\s*\d+\s*$/i, '').toLowerCase().trim();
  return allItemNames.filter(n => {
    const stripped = n.replace(/\s*\+\s*\d+\s*$/i, '').toLowerCase().trim();
    return stripped === lowerBase && isPerkItem(n);
  });
}

// Extract inline amount prefix from a search string like "2x angel wings" -> { amount: 2, name: "angel wings" }
function extractInlineAmount(str) {
  str = str.trim();
  const match = str.match(/^(\d+(?:\.\d+)?)\s*x?\s+(.+)$/i);
  if (match) {
    return { amount: parseFloat(match[1]), name: match[2].trim() };
  }
  return { amount: null, name: str };
}

const valueCommand = {
  data: new SlashCommandBuilder()
    .setName('value')
    .setDescription('Get the trade value of an AOT:R item')
    .addStringOption(opt =>
      opt.setName('item')
        .setDescription('Item name — e.g. "Founder\'s Blessing" or "Angel Wings"')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('level')
        .setDescription('Perk level — only appears as suggestions for perk items (e.g. +0, +5, +10)')
        .setRequired(false)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true); // { name, value }

    try {
      const allItems = await ValueItem.find({});
      const itemNames = allItems.map(i => i.itemName);

      // ── Autocomplete for the ITEM field ──────────────────────────────────
      if (focused.name === 'item') {
        const searchLower = focused.value.toLowerCase();
        if (!searchLower) return await interaction.respond([]);

        const filtered = itemNames
          .filter(choice => choice.toLowerCase().includes(searchLower))
          .slice(0, 25);

        return await interaction.respond(
          filtered.map(choice => ({ name: choice, value: choice }))
        );
      }

      // ── Autocomplete for the LEVEL field ─────────────────────────────────
      if (focused.name === 'level') {
        // Read whatever the user has typed/selected in the item field
        const currentItem = interaction.options.getString('item') || '';
        if (!currentItem) return await interaction.respond([]);

        // Strip any existing +N suffix to get the base perk name
        const baseName = currentItem.replace(/\s*\+\s*\d+\s*$/i, '').trim();

        // Find all level variants for this perk in the DB
        const variants = getPerkLevelVariants(baseName, itemNames);
        if (variants.length === 0) return await interaction.respond([]);

        // Sort levels numerically ascending (+0, +5, +10 …)
        const sorted = variants.sort((a, b) => {
          const la = parseInt(a.match(/\+(\d+)/)?.[1] ?? '0');
          const lb = parseInt(b.match(/\+(\d+)/)?.[1] ?? '0');
          return la - lb;
        });

        // Return each level as a suggestion; value is the full variant name
        // so execute can look it up directly
        return await interaction.respond(
          sorted.map(v => {
            const lvl = v.match(/\+(\d+)/)?.[1] ?? '0';
            return { name: `+${lvl}`, value: v };
          })
        );
      }

      await interaction.respond([]);
    } catch (err) {
      console.error(err);
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    const valueListChannelId = process.env.VALUE_LIST_CHANNEL;
    if (valueListChannelId && interaction.channel && interaction.channel.id !== valueListChannelId) {
      return interaction.reply({
        embeds: [errorEmbed('This command can only be used in the **#value-list** channel.')],
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    const rawSearch  = interaction.options.getString('item');
    const levelValue = interaction.options.getString('level'); // full variant name OR raw text

    // If level was chosen from autocomplete it IS the full variant name (e.g. "Founder's Blessing +10")
    // If the user typed a raw number like "10" or "+10" we append it manually
    let searchTerm = rawSearch.trim();
    if (levelValue) {
      if (isPerkItem(levelValue)) {
        // Autocomplete gave us the full variant name — use it directly
        searchTerm = levelValue.trim();
      } else {
        // User typed a raw number, strip existing suffix and append
        const lvlNum = levelValue.replace(/[^0-9]/g, '');
        if (lvlNum) {
          searchTerm = searchTerm.replace(/\s*\+\s*\d+\s*$/i, '').trim() + ` +${lvlNum}`;
        }
      }
    }
    const amount = 1;
    
    try {
      const allItems = await ValueItem.find({});
      const itemNames = allItems.map(i => i.itemName);
      const matchedName = fuzzyMatch(searchTerm, itemNames);

      if (!matchedName) {
        return interaction.editReply({ 
          embeds: [errorEmbed(`Could not find an item matching **${searchTerm}**. Try being more specific!`)] 
        });
      }

      // ── Perk level check ──────────────────────────────────────────────────────
      // If the matched item is a perk (has +N suffix) but the user typed a base
      // name without a level, prompt them to pick a level.
      if (isPerkItem(matchedName)) {
        const variants = getPerkLevelVariants(matchedName, itemNames);
        if (variants.length > 1) {
          // Check if the user's search already includes a level suffix like "+10" or "+0"
          const userSpecifiedLevel = /\+\s*\d+/.test(searchTerm);
          if (!userSpecifiedLevel) {
            const levelList = variants
              .sort((a, b) => {
                const la = parseInt(a.match(/\+(\d+)/)?.[1] ?? '0');
                const lb = parseInt(b.match(/\+(\d+)/)?.[1] ?? '0');
                return lb - la;
              })
              .map(v => `\`${v}\``)
              .join(', ');
            return interaction.editReply({
              embeds: [errorEmbed(
                `**${matchedName.replace(/\s*\+\s*\d+\s*$/, '')}** is a perk with multiple levels!\n` +
                `Please specify the level in your search.\n\n` +
                `**Available levels:** ${levelList}`
              )]
            });
          }
        }
      }

      const itemData = allItems.find(i => i.itemName === matchedName);

      // Determine embed color based on rarity
      let embedColor = 0x2b2d31;
      const rarity = itemData.rarity.toLowerCase();
      let rarityEmoji = '🔸';
      
      if (rarity === 'mythic')    { embedColor = 0xe74c3c; rarityEmoji = '🔴'; }
      else if (rarity === 'legendary') { embedColor = 0xf1c40f; rarityEmoji = '🟡'; }
      else if (rarity === 'epic') { embedColor = 0x9b59b6; rarityEmoji = '🟣'; }
      else if (rarity === 'rare') { embedColor = 0x3498db; rarityEmoji = '🔵'; }
      else if (rarity === 'uncommon') { embedColor = 0x2ecc71; rarityEmoji = '🟢'; }
      else if (rarity === 'common') { embedColor = 0x95a5a6; rarityEmoji = '⚪'; }

      const title = `Trade Value: ${itemData.itemName}`;

      const embed = new EmbedBuilder()
        .setColor(embedColor)
        .setTitle(`📊 ${title}`)
        .setDescription(`*Current market values based on official data.*\n\u200B`)
        .addFields(
          { name: '🌟 Rarity', value: `> ${rarityEmoji} **${itemData.rarity}**\n\u200B`, inline: true },
          { name: '🔥 Demand', value: `> **${itemData.demand || 'N/A'}**\n\u200B`, inline: true },
          { name: '📈 Trend', value: `> **${itemData.rateOfChange || 'N/A'}**\n\u200B`, inline: true },
          { name: '💰 Trade Value', value: `> 🔑 **${itemData.value || 'N/A'}**\n\u200B`, inline: false },
          { name: '💎 Tax (Gems)', value: `> **${itemData.taxGems || 'N/A'}**`, inline: true },
          { name: '🪙 Tax (Gold)', value: `> **${itemData.taxGold || 'N/A'}**`, inline: true }
        );
        
      const baseValue = parseNumericalValue(itemData.value);
      if (baseValue > 0) {
        const similarItems = [];
        const upgradeItems = [];
        
        for (const item of allItems) {
          if (item.itemName === itemData.itemName) continue;
          const itemVal = parseNumericalValue(item.value);
          if (itemVal <= 0) continue;
          if (itemVal >= baseValue * 0.9 && itemVal <= baseValue * 1.1) similarItems.push(item);
          else if (itemVal > baseValue * 1.1 && itemVal <= baseValue * 1.4) upgradeItems.push(item);
        }
        
        const shuffle = (array) => array.sort(() => 0.5 - Math.random());
        const selectedSimilar = shuffle(similarItems).slice(0, 2);
        const selectedUpgrade = shuffle(upgradeItems).slice(0, 1);
        
        let recText = '';
        if (selectedSimilar.length > 0) {
          recText += `**🔄 Even Trades:**\n${selectedSimilar.map(i => `> ${i.itemName} *(🔑 ${i.value})*`).join('\n')}\n`;
        }
        if (selectedUpgrade.length > 0) {
          recText += `**📈 Upgrade Goals:**\n${selectedUpgrade.map(i => `> ${i.itemName} *(🔑 ${i.value})*`).join('\n')}\n`;
        }
        
        if (recText) {
          embed.addFields({ name: '\u200B', value: '\u200B', inline: false });
          embed.addFields({ name: '💡 Trade Recommendations', value: recText, inline: false });
        }
      }

      embed.setFooter({ text: 'Data sourced from AOT:R Value List', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp(itemData.lastUpdated);

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await interaction.editReply({ 
        embeds: [errorEmbed('Failed to fetch data from the database. Please try again later.')] 
      });
    }
  },
};

// ─── /valuem — Multi-item value lookup ────────────────────────────────────────
// Usage: /valuem items:angel wings : founders blessing +10 amount:1 : 2
// Or simpler with just one item: /valuem items:angel wings
const valuemCommand = {
  data: new SlashCommandBuilder()
    .setName('valuem')
    .setDescription('Get values for multiple items at once')
    .addStringOption(opt =>
      opt.setName('items')
        .setDescription('Items separated by " : " — e.g. "angel wings : founders blessing +10"')
        .setRequired(true)
        .setAutocomplete(false)
    )
    .addStringOption(opt =>
      opt.setName('amounts')
        .setDescription('Amounts for each item separated by " : " — e.g. "1 : 2" (omit for all x1)')
        .setRequired(false)
    ),

  async execute(interaction) {
    const valueListChannelId = process.env.VALUE_LIST_CHANNEL;
    if (valueListChannelId && interaction.channel && interaction.channel.id !== valueListChannelId) {
      return interaction.reply({
        embeds: [errorEmbed('This command can only be used in the **#value-list** channel.')],
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    const itemsRaw = interaction.options.getString('items');
    const amountsRaw = interaction.options.getString('amounts') || '';

    // Split on " : " (with spaces) or plain ":" as separator
    const itemParts = itemsRaw.split(/\s*:\s*/).map(s => s.trim()).filter(Boolean);
    const amountParts = amountsRaw.split(/\s*:\s*/).map(s => s.trim()).filter(Boolean);

    if (itemParts.length === 0) {
      return interaction.editReply({ embeds: [errorEmbed('Please provide at least one item name.')] });
    }
    if (itemParts.length > 10) {
      return interaction.editReply({ embeds: [errorEmbed('You can look up a maximum of **10 items** at once.')] });
    }

    try {
      const allItems = await ValueItem.find({});
      const itemNames = allItems.map(i => i.itemName);

      const results = [];
      const errors = [];

      for (let idx = 0; idx < itemParts.length; idx++) {
        const rawEntry = itemParts[idx];
        // Support inline amount like "2x angel wings" within the items string too
        const { amount: inlineAmt, name: searchName } = extractInlineAmount(rawEntry);
        const amount = (amountParts[idx] ? parseFloat(amountParts[idx]) : null) || inlineAmt || 1;

        const matchedName = fuzzyMatch(searchName, itemNames);
        if (!matchedName) {
          errors.push(`❌ Could not find: **${searchName}**`);
          continue;
        }

        // Perk level check
        if (isPerkItem(matchedName)) {
          const variants = getPerkLevelVariants(matchedName, itemNames);
          if (variants.length > 1 && !/\+\s*\d+/.test(searchName)) {
            const levelList = variants
              .sort((a, b) => {
                const la = parseInt(a.match(/\+(\d+)/)?.[1] ?? '0');
                const lb = parseInt(b.match(/\+(\d+)/)?.[1] ?? '0');
                return lb - la;
              })
              .map(v => `\`${v}\``).join(', ');
            errors.push(
              `⚠️ **${matchedName.replace(/\s*\+\s*\d+\s*$/, '')}** is a perk — specify level: ${levelList}`
            );
            continue;
          }
        }

        const itemData = allItems.find(i => i.itemName === matchedName);
        const label = amount > 1 ? `${amount}x ${itemData.itemName}` : itemData.itemName;
        const tradeVal = multiplyValueString(itemData.value, amount);
        const taxGems  = multiplyValueString(itemData.taxGems, amount);
        const taxGold  = multiplyValueString(itemData.taxGold, amount);

        let rarityEmoji = '🔸';
        const r = itemData.rarity.toLowerCase();
        if (r === 'mythic')    rarityEmoji = '🔴';
        else if (r === 'legendary') rarityEmoji = '🟡';
        else if (r === 'epic') rarityEmoji = '🟣';
        else if (r === 'rare') rarityEmoji = '🔵';
        else if (r === 'uncommon') rarityEmoji = '🟢';
        else if (r === 'common') rarityEmoji = '⚪';

        results.push(
          `**${label}** ${rarityEmoji}\n` +
          `> 🔑 **${tradeVal || 'N/A'}**  |  💎 ${taxGems || 'N/A'}  |  🪙 ${taxGold || 'N/A'}`
        );
      }

      if (results.length === 0 && errors.length > 0) {
        return interaction.editReply({ embeds: [errorEmbed(errors.join('\n'))] });
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle('📊 Multi-Item Trade Values')
        .setDescription(
          (results.length > 0 ? results.join('\n\n') : '') +
          (errors.length > 0 ? `\n\n${errors.join('\n')}` : '')
        )
        .setFooter({ text: 'Data sourced from AOT:R Value List', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await interaction.editReply({ embeds: [errorEmbed('Failed to fetch data. Please try again later.')] });
    }
  },
};

// ─── /tradecalc — AOT:R Trade Calculator ───────────────────────────────────────
const tradeCalcCommand = {
  data: new SlashCommandBuilder()
    .setName('tradecalc')
    .setDescription('Calculate and compare trade values')
    .addStringOption(opt =>
      opt.setName('offer')
        .setDescription('Your offer — e.g. "2x colossal serum, founders blessing +10"')
        .setRequired(true)
        .setAutocomplete(true)
    )
    .addStringOption(opt =>
      opt.setName('request')
        .setDescription('What you want — e.g. "1x black flash aura, kengo +0"')
        .setRequired(true)
        .setAutocomplete(true)
    ),

  async autocomplete(interaction) {
    const focusedValue = interaction.options.getFocused();
    if (!focusedValue) return await interaction.respond([]);

    try {
      const allItems = await ValueItem.find({});
      const itemNames = allItems.map(i => i.itemName);
      
      // Split on comma to support multi-item strings like "2x serum, angel"
      const parts = focusedValue.split(',');
      const lastPart = parts[parts.length - 1];

      // Detect inline amount prefix at the start of the last part: "2x " or "2 "
      const amountMatch = lastPart.match(/^(\s*\d+(?:\.\d+)?\s*x?\s+)(.*)$/i);
      let prefix = '';
      let searchTerm = lastPart.trim();
      
      if (amountMatch) {
        prefix = amountMatch[1];
        searchTerm = amountMatch[2].trim();
      }
      
      if (!searchTerm) return await interaction.respond([]);

      const filtered = itemNames
        .filter(choice => choice.toLowerCase().includes(searchTerm.toLowerCase()))
        .slice(0, 25);
        
      const baseString = parts.slice(0, -1).join(',');
      const comma = baseString ? ', ' : '';
        
      await interaction.respond(
        filtered.map(choice => {
          const fullValue = `${baseString}${comma}${prefix}${choice}`;
          return { name: fullValue.slice(0, 100), value: fullValue.slice(0, 100) };
        })
      );
    } catch (err) {
      console.error(err);
      await interaction.respond([]);
    }
  },

  async execute(interaction) {
    const valueListChannelId = process.env.VALUE_LIST_CHANNEL;
    if (valueListChannelId && interaction.channel && interaction.channel.id !== valueListChannelId) {
      return interaction.reply({
        embeds: [errorEmbed('This command can only be used in the **#value-list** channel.')],
        flags: MessageFlags.Ephemeral
      });
    }

    await interaction.deferReply();

    const offerStr = interaction.options.getString('offer');
    const requestStr = interaction.options.getString('request');

    // ── Perk-level pre-check for tradecalc ────────────────────────────────────
    // Warn the user if any perk in offer/request is missing its level suffix.
    try {
      const allItems = await ValueItem.find({});
      const itemNames = allItems.map(i => i.itemName);

      const checkSideForPerkErrors = (inputStr) => {
        const parts = inputStr.split(',').map(s => s.trim()).filter(Boolean);
        const perkErrors = [];
        for (const part of parts) {
          const { name: itemName } = extractInlineAmount(part);
          // strip leading amount without prefix helper
          const cleanName = itemName.replace(/^\d+(?:\.\d+)?\s*x?\s+/i, '').trim();
          const matched = fuzzyMatch(cleanName, itemNames);
          if (!matched) continue;
          if (isPerkItem(matched)) {
            const variants = getPerkLevelVariants(matched, itemNames);
            if (variants.length > 1 && !/\+\s*\d+/.test(cleanName)) {
              const levelList = variants
                .sort((a, b) => {
                  const la = parseInt(a.match(/\+(\d+)/)?.[1] ?? '0');
                  const lb = parseInt(b.match(/\+(\d+)/)?.[1] ?? '0');
                  return lb - la;
                })
                .map(v => `\`${v}\``).join(', ');
              perkErrors.push(
                `⚠️ **${matched.replace(/\s*\+\s*\d+\s*$/, '')}** is a perk — please specify a level.\nAvailable: ${levelList}`
              );
            }
          }
        }
        return perkErrors;
      };

      const offerPerkErrors  = checkSideForPerkErrors(offerStr);
      const requestPerkErrors = checkSideForPerkErrors(requestStr);
      const allPerkErrors = [...offerPerkErrors, ...requestPerkErrors];

      if (allPerkErrors.length > 0) {
        return interaction.editReply({
          embeds: [errorEmbed(`**Perk level required!**\n\n${allPerkErrors.join('\n\n')}`)]
        });
      }
    } catch (_) { /* If pre-check fails, let calculateSide handle it */ }

    try {
      const offerSide = await calculateSide(offerStr);
      const requestSide = await calculateSide(requestStr);

      if (offerSide.errors.length > 0 || requestSide.errors.length > 0) {
        const allErrors = [...offerSide.errors, ...requestSide.errors].join('\n');
        return interaction.editReply({ embeds: [errorEmbed(`**Errors found:**\n${allErrors}`)] });
      }

      const offerTotal = offerSide.totalKeys;
      const requestTotal = requestSide.totalKeys;

      let verdict = '';
      let color = 0x2b2d31;
      let diff = requestTotal - offerTotal; 
      
      const margin = Math.max(offerTotal, requestTotal) * 0.05;

      if (Math.abs(diff) <= margin) {
        verdict = '⚖️ FAIR TRADE';
        color = 0xf1c40f; // Yellow
      } else if (diff > 0) {
        verdict = '🎉 WIN (Profit)';
        color = 0x2ecc71; // Green
      } else {
        verdict = '💀 LOSS (Overpay)';
        color = 0xe74c3c; // Red
      }

      const formatItemList = (items) => {
        return items.map(i => `> ${i.amount}x **${i.name}**\n> *🔑 ${formatNumber(i.keys)}*`).join('\n\n') || '> None';
      };

      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle('⚖️ Trade Calculator Analysis')
        .setDescription(`*Compare your offer against their offer to determine trade fairness.*\n\u200B`)
        .addFields(
          { name: '📤 Your Offer', value: `${formatItemList(offerSide.items)}\n\n**Total Value:** 🔑 **${formatNumber(offerTotal)}**\n\u200B`, inline: true },
          { name: '📥 Their Offer', value: `${formatItemList(requestSide.items)}\n\n**Total Value:** 🔑 **${formatNumber(requestTotal)}**\n\u200B`, inline: true },
          { name: '\u200B', value: '\u200B', inline: false }, // Spacer
          { name: '📊 Verdict', value: `> **${verdict}**\n> Difference: 🔑 **${formatNumber(Math.abs(diff))}**`, inline: true },
          { name: '💎 Total Taxes', value: `> **You pay:** 💎 ${formatNumber(offerSide.totalGems)} | 🪙 ${formatNumber(offerSide.totalGold)}\n> **They pay:** 💎 ${formatNumber(requestSide.totalGems)} | 🪙 ${formatNumber(requestSide.totalGold)}`, inline: true }
        )
        .setFooter({ text: 'Calculated in Keys 🔑', iconURL: interaction.client.user.displayAvatarURL() })
        .setTimestamp();

      await interaction.editReply({ embeds: [embed] });

    } catch (err) {
      console.error(err);
      await interaction.editReply({ embeds: [errorEmbed('An error occurred while calculating the trade.')] });
    }
  }
};

// ─── /whisper ─────────────────────────────────────────────────────────────────
const whisperCommand = {
  data: new SlashCommandBuilder()
    .setName('whisper')
    .setDescription('Whisper a message to another user')
    .addUserOption(option =>
      option.setName('who')
        .setDescription('The user to whisper to')
        .setRequired(true))
    .addStringOption(option =>
      option.setName('message')
        .setDescription('The message to send')
        .setRequired(true)),

  async execute(interaction) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    
    const targetUser = interaction.options.getUser('who');
    const message = interaction.options.getString('message');

    if (targetUser.bot) {
      return interaction.editReply({ embeds: [errorEmbed('You cannot whisper to a bot.')] });
    }

    try {
      if (!global.whispers) global.whispers = new Map();
      const whisperId = Date.now().toString(36) + Math.random().toString(36).substring(2, 8);
      global.whispers.set(whisperId, { from: interaction.user.username, to: targetUser.id, message });

      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`whisper_read_${whisperId}`)
          .setLabel('Read Whisper')
          .setEmoji('💬')
          .setStyle(ButtonStyle.Secondary)
      );

      await interaction.channel.send({ 
        content: `🤫 ${targetUser}, you received a whisper!`, 
        components: [row] 
      });
      await interaction.editReply({ embeds: [successEmbed(`Whisper successfully sent to ${targetUser.tag}.`)] });
    } catch (err) {
      console.error('Error sending whisper:', err);
      await interaction.editReply({ embeds: [errorEmbed(`Could not send a whisper to ${targetUser.tag}.`)] });
    }
  },
};

module.exports = [
  valueCommand,
  valuemCommand,
  tradeCalcCommand,
  queueCommand,
  myPositionCommand,
  promoteCommand,
  addCommand,
  membersCommand,
  setSlotsCommand,
  removeMemberCommand,
  removeQueueCommand,
  setupPanelCommand,
  infoPanelCommand,
  sendTradeInstructionPanelCommand,
  clearChatCommand,
  setupVerifyCommand,
  timeVoteCommand,
  giveRoleCommand,
  psCommand,
  utcCommand,
  transferBannerCommand,
  transferSunBannerCommand,
  fixRoleCommand,
  giveChannelAccessCommand,
  syncDataCommand,
  whisperCommand,
];
