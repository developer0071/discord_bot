const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { EmbedBuilder } = require('discord.js');
const ValueItem = require('../models/ValueItem');
const SystemState = require('../models/SystemState');

async function syncValues(client) {
  // GIDs for different tabs in the Google Sheet
  const gids = [
    '1606480838', // ALL Cosmetics
    '1161641948', // Anime All Star Crates
    '931952227',  // Blade Burst Crate
    '346887600',  // Scout Fashions
    '300368556',  // Battlepass
    '30110624',   // Event
    '824267924',  // Other Cosmetics
    '1985243848', // Family
    '1256383298', // Artifact
    '365176366',  // Perks
    '1207135228', // Raid & Mission Drops
    '1350029234', // Shop
    '760101351'   // Robux Items
  ];

  try {
    const itemsToSave = [];
    const fullListText = {
      Legendary: [], Epic: [], Rare: [], Uncommon: [], Common: []
    };

    // GID for the Perks tab — needs special section-header detection
    const PERKS_GID = '365176366';

    for (const gid of gids) {
      const url = `https://docs.google.com/spreadsheets/d/e/2PACX-1vR7naBmry1w8WlHFrtpxJ0n3XdgDj5cehW6XxTdJVDPMDivrnOefz83uuFCoYEGd028tjFQ6tcfPyBA/pub?gid=${gid}&single=true&output=csv`;
      const response = await axios.get(url);
      const records = parse(response.data, { columns: true, skip_empty_lines: true });

      const isPerksTab = (gid === PERKS_GID);
      let currentPerkLevel = ''; // e.g. "+10" or "+0" — only used on the Perks tab

      for (const row of records) {
        const rawItemName = row['Item Name'];
        if (!rawItemName) continue;

        // ── Perk section-header detection ───────────────────────────────────────
        // The Perks tab contains rows like "PERKS +10" and "PERKS +0" that mark
        // which upgrade level the items below belong to. These rows have no Rarity.
        if (isPerksTab) {
          const headerMatch = rawItemName.match(/perks?\s*(\+\s*\d+)/i);
          if (headerMatch) {
            // Normalise spacing: "+10" not "+ 10"
            currentPerkLevel = ' ' + headerMatch[1].replace(/\s+/g, '');
            continue; // this row is a header, not an item
          }
        }

        if (!row.Rarity) continue; // skip any other non-item rows

        // Append perk level suffix so both "+10" and "+0" variants are stored
        // as unique entries, e.g. "Founder's Blessing +10" / "Founder's Blessing +0"
        const itemName = isPerksTab && currentPerkLevel
          ? `${rawItemName}${currentPerkLevel}`
          : rawItemName;

        const rarity = row['Rarity'];

        itemsToSave.push({
          updateOne: {
            filter: { itemName: itemName },
            update: {
              $set: {
                itemName: itemName,
                rarity: rarity,
                demand: row['Demand'] || 'N/A',
                value: row['Value'] || 'N/A',
                rateOfChange: row['Rate Of Change'] || 'N/A',
                taxGems: row['Tax (Gems)'] || 'N/A',
                taxGold: row['Tax (Gold)'] || 'N/A',
                lastUpdated: new Date()
              }
            },
            upsert: true
          }
        });

        // Organize for the panel
        if (fullListText[rarity]) {
          let entry = `**${itemName}** - ${row['Value'] || 'N/A'}`;
          if (row['Rate Of Change']) {
            if (row['Rate Of Change'].toLowerCase() === 'rising') entry += ' 📈';
            else if (row['Rate Of Change'].toLowerCase() === 'dropping') entry += ' 📉';
          }
          fullListText[rarity].push(entry);
        }
      }
    }

    if (itemsToSave.length > 0) {
      await ValueItem.bulkWrite(itemsToSave);
      console.log(`✅ Synced ${itemsToSave.length} AOT:R values to MongoDB across multiple tabs.`);
    }

    // Update Live Panel (Removed per user request)
    // The bot will only sync data to MongoDB silently.
    /*
    const channelId = process.env.VALUE_LIST_CHANNEL;
    if (channelId && client) {
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        await updateLivePanel(channel, fullListText);
      } else {
        console.warn(`⚠️ VALUE_LIST_CHANNEL ${channelId} not found in cache.`);
      }
    }
    */
  } catch (err) {
    console.error('❌ Failed to sync AOT:R values:', err.message);
  }
}

async function updateLivePanel(channel, organizedData) {
  try {
    const embeds = [];
    let currentEmbed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📊 Live AOT:R Value List')
      .setDescription('Auto-updating values straight from the docs.\\nUse `/value <item> [amount]` to calculate totals.\\nUse `/tradecalc` to compare trades!');
    
    let currentEmbedChars = currentEmbed.data.title.length + currentEmbed.data.description.length;
    let currentEmbedFields = 0;

    for (const [rarity, items] of Object.entries(organizedData)) {
      if (items.length === 0) continue;

      let fieldValue = '';
      let part = 1;

      items.forEach((item) => {
        if ((fieldValue.length + item.length + 1) > 1000) {
          const fieldName = `${rarity} (Part ${part})`;
          
          if (currentEmbedFields >= 25 || (currentEmbedChars + fieldName.length + fieldValue.length) > 5000) {
            embeds.push(currentEmbed);
            currentEmbed = new EmbedBuilder().setColor(0x5865f2);
            currentEmbedChars = 0;
            currentEmbedFields = 0;
          }

          currentEmbed.addFields({ name: fieldName, value: fieldValue, inline: false });
          currentEmbedChars += fieldName.length + fieldValue.length;
          currentEmbedFields++;
          
          fieldValue = item + '\\n';
          part++;
        } else {
          fieldValue += item + '\\n';
        }
      });

      if (fieldValue) {
        const fieldName = part > 1 ? `${rarity} (Part ${part})` : rarity;
        if (currentEmbedFields >= 25 || (currentEmbedChars + fieldName.length + fieldValue.length) > 5000) {
          embeds.push(currentEmbed);
          currentEmbed = new EmbedBuilder().setColor(0x5865f2);
          currentEmbedChars = 0;
          currentEmbedFields = 0;
        }
        currentEmbed.addFields({ name: fieldName, value: fieldValue, inline: false });
        currentEmbedChars += fieldName.length + fieldValue.length;
        currentEmbedFields++;
      }
    }

    if (currentEmbedFields > 0) {
      embeds.push(currentEmbed);
    }
    
    if (embeds.length > 0) {
      embeds[embeds.length - 1].setFooter({ text: 'Last Updated' }).setTimestamp();
    }

    const state = await SystemState.findOne({ key: 'valueListMessageIds' });
    let messageIds = [];
    if (state && state.value) {
      try {
        messageIds = JSON.parse(state.value);
      } catch(e) {
        messageIds = [state.value];
      }
    } else {
      const oldState = await SystemState.findOne({ key: 'valueListMessageId' });
      if (oldState && oldState.value) {
        messageIds.push(oldState.value);
      }
    }

    for (let i = 0; i < embeds.length; i++) {
      if (i < messageIds.length) {
        try {
          const msg = await channel.messages.fetch(messageIds[i]);
          await msg.edit({ embeds: [embeds[i]] });
        } catch (err) {
          const newMsg = await channel.send({ embeds: [embeds[i]] });
          messageIds[i] = newMsg.id;
        }
      } else {
        const newMsg = await channel.send({ embeds: [embeds[i]] });
        messageIds.push(newMsg.id);
      }
    }

    await SystemState.updateOne(
      { key: 'valueListMessageIds' },
      { $set: { value: JSON.stringify(messageIds) } },
      { upsert: true }
    );

  } catch (err) {
    console.error('❌ Failed to update live panel:', err.message);
  }
}

function startSyncLoop(client) {
  // Sync immediately, then every 10 minutes
  syncValues(client);
  setInterval(() => syncValues(client), 10 * 60 * 1000);
}

module.exports = { syncValues, startSyncLoop };
