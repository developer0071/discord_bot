const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} = require('discord.js');
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles),

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
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

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
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

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

// ─── /timevote — MANAGE ─────────────────────────────────────────────────────────
const timeVoteCommand = {
  data: new SlashCommandBuilder()
    .setName('timevote')
    .setDescription("Post a UTC time vote that auto-converts to each member's local time")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

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
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers),

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
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

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
module.exports = [
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
  setupVerifyCommand,
  timeVoteCommand,
  giveRoleCommand,
  psCommand,
  utcCommand,
  transferBannerCommand,
  transferSunBannerCommand,
];
