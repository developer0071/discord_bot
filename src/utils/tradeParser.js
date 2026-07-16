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

function fuzzyMatch(query, itemNames) {
  query = query.toLowerCase().trim();
  const cleanQuery = query.replace(/[^a-z0-9\\s]/gi, '');
  
  const exact = itemNames.find(n => n.toLowerCase() === query);
  if (exact) return exact;

  const contains = itemNames.find(n => n.toLowerCase().includes(query));
  if (contains) return contains;

  const queryTokens = cleanQuery.split(/\\s+/).filter(Boolean);
  let bestMatch = null;
  let maxScore = 0;

  for (const name of itemNames) {
    const cleanName = name.toLowerCase().replace(/[^a-z0-9\\s]/gi, '');
    const nameTokens = cleanName.split(/\\s+/).filter(Boolean);
    let score = 0;
    
    let allTokensMatched = true;
    for (const q of queryTokens) {
      const match = nameTokens.find(n => n.startsWith(q));
      if (match) {
        score += q.length;
      } else {
        const subMatch = nameTokens.find(n => n.includes(q));
        if (subMatch) {
          score += q.length * 0.5;
        } else {
          allTokensMatched = false;
          break;
        }
      }
    }

    if (allTokensMatched && score > maxScore) {
      maxScore = score;
      bestMatch = name;
    }
  }

  if (!bestMatch && queryTokens.length === 1 && cleanQuery.length >= 2) {
    for (const name of itemNames) {
      const cleanName = name.toLowerCase().replace(/[^a-z0-9\\s]/gi, '');
      const nameTokens = cleanName.split(/\\s+/).filter(Boolean);
      const acronym = nameTokens.map(t => t[0]).join('');
      if (acronym === cleanQuery || acronym.startsWith(cleanQuery)) {
        return name;
      }
    }
  }

  return bestMatch;
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

  const allItems = await ValueItem.find({});
  const itemNames = allItems.map(i => i.itemName);

  for (const item of parsedItems) {
    const matchedName = fuzzyMatch(item.name, itemNames);
    if (!matchedName) {
      results.errors.push(`Could not find item: **${item.name}**`);
      continue;
    }

    const dbItem = allItems.find(i => i.itemName === matchedName);

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
  formatNumber,
  fuzzyMatch,
  parseNumericalValue
};
