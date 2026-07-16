const ValueItem = require('../models/ValueItem');

// Parses string like "2.5k" -> 2500, "180" -> 180, "46.8k" -> 46800
function parseNumericalValue(str) {
  if (!str || str === 'N/A' || str.toLowerCase() === 'stable' || str.toLowerCase() === 'rising' || str.toLowerCase() === 'dropping') return 0;
  
  // Extract the first number with optional decimal and k/m suffix
  const match = str.match(/[\d,.]+[km]?/i);
  if (!match) return 0;
  
  let valStr = match[0].toLowerCase().replace(/,/g, '');
  let multiplier = 1;
  if (valStr.endsWith('k')) {
    multiplier = 1000;
    valStr = valStr.slice(0, -1);
  } else if (valStr.endsWith('m')) {
    multiplier = 1000000;
    valStr = valStr.slice(0, -1);
  }
  
  const num = parseFloat(valStr);
  return isNaN(num) ? 0 : num * multiplier;
}

// Parses "2x colossal serum, 1x fritz" -> [{ amount: 2, name: "colossal serum" }, ...]
function parseInputString(input) {
  const parts = input.split(',').map(s => s.trim()).filter(s => s);
  const items = [];
  
  for (const part of parts) {
    // Regex to match optional amount at start: "2x item", "2 item", "item"
    const match = part.match(/^(\d+(?:\.\d+)?)\s*x?\s+(.+)$/i);
    if (match) {
      items.push({ amount: parseFloat(match[1]), name: match[2].trim() });
    } else {
      items.push({ amount: 1, name: part });
    }
  }
  
  return items;
}

async function calculateSide(inputString) {
  const parsedItems = parseInputString(inputString);
  const results = {
    items: [],
    totalKeys: 0,
    totalGems: 0,
    totalGold: 0,
    errors: []
  };

  for (const item of parsedItems) {
    // Try exact match first
    let dbItem = await ValueItem.findOne({ itemName: { $regex: new RegExp(`^${item.name}$`, 'i') } });
    if (!dbItem) {
      // Try partial match if exact fails
      dbItem = await ValueItem.findOne({ itemName: { $regex: item.name, $options: 'i' } });
      if (!dbItem) {
        results.errors.push(`Could not find item: **${item.name}**`);
        continue;
      }
    }

    const valueKeys = parseNumericalValue(dbItem.value) * item.amount;
    const taxGems = parseNumericalValue(dbItem.taxGems) * item.amount;
    const taxGold = parseNumericalValue(dbItem.taxGold) * item.amount;

    results.totalKeys += valueKeys;
    results.totalGems += taxGems;
    results.totalGold += taxGold;

    results.items.push({
      amount: item.amount,
      name: dbItem.itemName,
      keys: valueKeys,
      gems: taxGems,
      gold: taxGold
    });
  }

  return results;
}

function formatNumber(num) {
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'm';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'k';
  return num.toString();
}

module.exports = {
  calculateSide,
  formatNumber
};
