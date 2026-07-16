const axios = require('axios');
const { parse } = require('csv-parse/sync');
const { EmbedBuilder } = require('discord.js');
const ValueItem = require('../models/ValueItem');
const SystemState = require('../models/SystemState');

async function syncValues(client) {
  const url = "https://docs.google.com/spreadsheets/d/e/2PACX-1vR7naBmry1w8WlHFrtpxJ0n3XdgDj5cehW6XxTdJVDPMDivrnOefz83uuFCoYEGd028tjFQ6tcfPyBA/pub?gid=1606480838&single=true&output=csv";
  
  try {
    const response = await axios.get(url);
    const records = parse(response.data, { columns: true, skip_empty_lines: true });

    const itemsToSave = [];
    const fullListText = {
      Legendary: [],
      Epic: [],
      Rare: [],
      Uncommon: [],
      Common: []
    };

    for (const row of records) {
      if (!row.Rarity) continue; // skip headers
      
      const itemName = row['Item Name'];
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

    if (itemsToSave.length > 0) {
      await ValueItem.bulkWrite(itemsToSave);
      console.log(`✅ Synced ${itemsToSave.length} AOT:R values to MongoDB.`);
    }

    // Update Live Panel
    const channelId = process.env.VALUE_LIST_CHANNEL;
    if (channelId && client) {
      const channel = client.channels.cache.get(channelId);
      if (channel) {
        await updateLivePanel(channel, fullListText);
      } else {
        console.warn(`⚠️ VALUE_LIST_CHANNEL ${channelId} not found in cache.`);
      }
    }
  } catch (err) {
    console.error('❌ Failed to sync AOT:R values:', err.message);
  }
}

async function updateLivePanel(channel, organizedData) {
  try {
    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle('📊 Live AOT:R Value List')
      .setDescription('Auto-updating values straight from the docs.\\nUse `/value <item> [amount]` to calculate totals.')
      .setFooter({ text: 'Last Updated' })
      .setTimestamp();

    // Add fields for each rarity
    for (const [rarity, items] of Object.entries(organizedData)) {
      if (items.length > 0) {
        // Discord fields max 1024 chars, we might need to split
        let fieldValue = '';
        let part = 1;
        items.forEach(item => {
          if ((fieldValue.length + item.length + 1) > 1000) {
            embed.addFields({ name: `${rarity} (Part ${part})`, value: fieldValue, inline: false });
            fieldValue = item + '\\n';
            part++;
          } else {
            fieldValue += item + '\\n';
          }
        });
        if (fieldValue) {
          const fieldName = part > 1 ? `${rarity} (Part ${part})` : rarity;
          embed.addFields({ name: fieldName, value: fieldValue, inline: false });
        }
      }
    }

    const state = await SystemState.findOne({ key: 'valueListMessageId' });
    let messageId = state ? state.value : null;
    let message;

    if (messageId) {
      try {
        message = await channel.messages.fetch(messageId);
      } catch (err) {
        // Message might be deleted
        message = null;
      }
    }

    if (message) {
      await message.edit({ embeds: [embed] });
    } else {
      const newMsg = await channel.send({ embeds: [embed] });
      await SystemState.updateOne(
        { key: 'valueListMessageId' },
        { $set: { value: newMsg.id } },
        { upsert: true }
      );
    }
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
