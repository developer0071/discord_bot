const crypto = require('crypto');
const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');

const fb = require('./firebase');

function generateId() {
  return crypto.randomBytes(4).toString('hex');
}

function entrantCount(giveaway) {
  return Object.keys(giveaway.entrants || {}).length;
}

function endsAtMs(giveaway) {
  const ts = giveaway.endsAt;
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts._seconds) return ts._seconds * 1000;
  return typeof ts === 'number' ? ts : null;
}

function startsAtMs(giveaway) {
  const ts = giveaway.startsAt;
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  if (ts._seconds) return ts._seconds * 1000;
  return typeof ts === 'number' ? ts : null;
}

/**
 * Pick `count` unique winners from entrant IDs using CSPRNG.
 */
function pickWinners(entrantIds, count) {
  const pool = [...entrantIds];
  const winners = [];
  const n = Math.min(count, pool.length);
  for (let i = 0; i < n; i++) {
    const idx = crypto.randomInt(0, pool.length);
    winners.push(pool[idx]);
    pool.splice(idx, 1);
  }
  return winners;
}

function buildEmbed(giveaway, guild) {
  const count = entrantCount(giveaway);
  const endMs = endsAtMs(giveaway);
  const endUnix = endMs ? Math.floor(endMs / 1000) : null;
  const status = giveaway.status;

  const embed = new EmbedBuilder()
    .setColor(status === 'ended' ? 0x57f287 : 0xe0303c)
    .setTitle(`🎉 ${giveaway.title}`)
    .setTimestamp();

  if (giveaway.prize) {
    embed.setDescription(giveaway.prize);
  }

  const fields = [];

  if (status === 'ended' && giveaway.winners?.length) {
    const winnerText = giveaway.winners.map((w) => `<@${w.userId}>`).join(', ');
    fields.push({ name: '🏆 Winner(s)', value: winnerText, inline: false });
  } else if (status === 'ended') {
    fields.push({ name: '🏆 Winner(s)', value: '*No valid entries*', inline: false });
  } else if (endUnix) {
    fields.push({
      name: '⏰ Ends',
      value: `<t:${endUnix}:R> (<t:${endUnix}:f>)`,
      inline: true,
    });
  }

  fields.push(
    { name: '🎟️ Entries', value: `${count}`, inline: true },
    { name: '🏅 Winners', value: `${giveaway.winnerCount || 1}`, inline: true },
  );

  if (giveaway.hostTag) {
    fields.push({ name: '👤 Hosted by', value: giveaway.hostTag, inline: true });
  }

  embed.addFields(fields);

  if (guild?.iconURL()) embed.setFooter({ text: guild.name, iconURL: guild.iconURL() });

  return embed;
}

function buildButtons(giveaway) {
  if (giveaway.status !== 'active') return [];

  const endMs = endsAtMs(giveaway);
  if (endMs && Date.now() >= endMs) return [];

  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`giveaway_enter_${giveaway.id}`)
        .setLabel('🎁 Enter Giveaway')
        .setStyle(ButtonStyle.Primary),
    ),
  ];
}

async function refreshMessage(client, giveaway) {
  if (!giveaway.messageId || !giveaway.channelId) return;
  try {
    const channel = await client.channels.fetch(giveaway.channelId);
    const message = await channel.messages.fetch(giveaway.messageId);
    const guild = channel.guild;
    await message.edit({
      embeds: [buildEmbed(giveaway, guild)],
      components: buildButtons(giveaway),
    });
  } catch (err) {
    console.error('[giveaway] message refresh failed:', err.message);
  }
}

async function postGiveaway(client, giveaway) {
  const channelId = giveaway.channelId || process.env.GIVEAWAYS_CHANNEL?.trim();
  if (!channelId) throw new Error('No giveaway channel configured');

  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased()) throw new Error('Giveaway channel is not a text channel');

  const guild = channel.guild;
  const message = await channel.send({
    embeds: [buildEmbed({ ...giveaway, status: 'active' }, guild)],
    components: buildButtons({ ...giveaway, status: 'active', id: giveaway.id }),
  });

  await fb.updateGiveaway(giveaway.id, {
    messageId: message.id,
    channelId: channel.id,
    status: 'active',
  });

  return message;
}

async function endGiveaway(client, giveawayId) {
  const giveaway = await fb.getGiveaway(giveawayId);
  if (!giveaway || giveaway.status === 'ended' || giveaway.status === 'cancelled') return null;

  const entrantIds = Object.keys(giveaway.entrants || {});
  const winnerIds = pickWinners(entrantIds, giveaway.winnerCount || 1);

  const winners = [];
  for (const userId of winnerIds) {
    const entrant = giveaway.entrants[userId];
    winners.push({ userId, tag: entrant?.tag || userId });
  }

  const updated = {
    status: 'ended',
    winners,
    endedAt: new Date(),
  };
  await fb.updateGiveaway(giveawayId, updated);

  const final = { ...giveaway, ...updated, id: giveawayId };
  await refreshMessage(client, final);

  if (winners.length && giveaway.channelId) {
    try {
      const channel = await client.channels.fetch(giveaway.channelId);
      const mentions = winners.map((w) => `<@${w.userId}>`).join(', ');
      await channel.send({
        content: `🎉 **Giveaway ended!** Congratulations ${mentions} — you won **${giveaway.title}**!`,
      });
    } catch (err) {
      console.error('[giveaway] winner announcement failed:', err.message);
    }
  }

  return final;
}

async function activateScheduled(client) {
  const scheduled = await fb.getGiveawaysByStatus('scheduled');
  const now = Date.now();

  for (const g of scheduled) {
    const startMs = startsAtMs(g);
    if (startMs && startMs <= now) {
      try {
        await postGiveaway(client, g);
        console.log(`[giveaway] Started giveaway ${g.id}: ${g.title}`);
      } catch (err) {
        console.error(`[giveaway] Failed to start ${g.id}:`, err.message);
      }
    }
  }
}

async function endExpired(client) {
  const active = await fb.getGiveawaysByStatus('active');
  const now = Date.now();

  for (const g of active) {
    const endMs = endsAtMs(g);
    if (endMs && endMs <= now) {
      try {
        await endGiveaway(client, g.id);
        console.log(`[giveaway] Ended giveaway ${g.id}: ${g.title}`);
      } catch (err) {
        console.error(`[giveaway] Failed to end ${g.id}:`, err.message);
      }
    }
  }
}

function startGiveawayScheduler(client) {
  const tick = async () => {
    try {
      await activateScheduled(client);
      await endExpired(client);
    } catch (err) {
      console.error('[giveaway] scheduler tick:', err.message);
    }
  };

  tick();
  const interval = setInterval(tick, 30_000);
  return () => clearInterval(interval);
}

module.exports = {
  generateId,
  entrantCount,
  endsAtMs,
  startsAtMs,
  pickWinners,
  buildEmbed,
  buildButtons,
  refreshMessage,
  postGiveaway,
  endGiveaway,
  startGiveawayScheduler,
};
