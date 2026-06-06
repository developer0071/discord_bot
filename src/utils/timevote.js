const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');

// A..X — one per UTC hour (00:00 → 23:00).
const LETTERS = Array.from({ length: 24 }, (_, i) => String.fromCharCode(65 + i));

/**
 * Build the vote message text. `counts` is { A: 3, B: 1, ... } (optional).
 * Uses Discord dynamic timestamps so each viewer sees their own local time.
 */
function buildContent(counts = {}) {
  const now = new Date();
  const baseUnix = Math.floor(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()) / 1000);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  const lines = LETTERS.map((letter, h) => {
    const utc = `${String(h).padStart(2, '0')}:00 UTC`;
    const c = counts[letter] || 0;
    const tally = c > 0 ? `  ·  **${c}** vote${c === 1 ? '' : 's'}` : '';
    return `**${letter}** — ${utc} / <t:${baseUnix + h * 3600}:t>${tally}`;
  });

  return (
    'Vote below. These UTC times auto-convert to your local timezone:\n\n' +
    lines.join('\n') +
    `\n\n*Total votes: ${total}*`
  );
}

/**
 * Build the A–X button grid (5 buttons per row, 5 rows).
 */
function buildButtons() {
  const rows = [];
  for (let i = 0; i < LETTERS.length; i += 5) {
    const row = new ActionRowBuilder().addComponents(
      LETTERS.slice(i, i + 5).map((letter) =>
        new ButtonBuilder()
          .setCustomId(`tvote_${letter}`)
          .setLabel(letter)
          .setStyle(ButtonStyle.Secondary))
    );
    rows.push(row);
  }
  return rows;
}

/**
 * Tally a votes map ({ userId: option }) into { option: count }.
 */
function tally(votes) {
  const counts = {};
  for (const option of Object.values(votes)) {
    counts[option] = (counts[option] || 0) + 1;
  }
  return counts;
}

module.exports = { LETTERS, buildContent, buildButtons, tally };
