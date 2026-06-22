const MIN_XP_PER_MESSAGE = 10;
const MAX_XP_PER_MESSAGE = 25;

/**
 * Return the cumulative XP required to reach a level.
 * Level 2 requires 300 total XP; level 3 requires 600 total XP.
 * @param {number} level Level number.
 * @returns {number}
 */
function getXpForLevel(level) {
  const safeLevel = Math.max(0, Math.floor(Number(level) || 0));
  return 500 * safeLevel * (safeLevel + 1);
}

/**
 * Calculate the current level from total XP.
 * @param {number} xp Total XP.
 * @returns {number}
 */
function getLevelFromXp(xp) {
  const safeXp = Math.max(0, Number(xp) || 0);
  return Math.floor((-1 + Math.sqrt(1 + (4 * safeXp) / 500)) / 2);
}

/**
 * Generate a random message XP award between 10 and 25.
 * @returns {number}
 */
function generateRandomXp() {
  return Math.floor(Math.random() * (MAX_XP_PER_MESSAGE - MIN_XP_PER_MESSAGE + 1)) + MIN_XP_PER_MESSAGE;
}

/**
 * Calculate progress within the user's current level.
 * @param {number} xp Total XP.
 * @param {number} level Current level.
 * @returns {{currentLevelXp:number, nextLevelXp:number, xpIntoLevel:number, xpForNextLevel:number, percent:number}}
 */
function getProgress(xp, level) {
  const currentLevelXp = getXpForLevel(level);
  const nextLevelXp = getXpForLevel(level + 1);
  const xpForNextLevel = Math.max(1, nextLevelXp - currentLevelXp);
  const xpIntoLevel = Math.max(0, xp - currentLevelXp);
  const percent = Math.max(0, Math.min(100, Math.floor((xpIntoLevel / xpForNextLevel) * 100)));

  return {
    currentLevelXp,
    nextLevelXp,
    xpIntoLevel,
    xpForNextLevel,
    percent,
  };
}

/**
 * Render a plain ASCII progress bar that cannot be mojibaked.
 * @param {number} percent Completion percentage.
 * @param {number} width Bar width in characters.
 * @returns {string}
 */
function formatProgressBar(percent, width = 10) {
  const safeWidth = Math.max(1, Math.floor(width));
  const filled = Math.max(0, Math.min(safeWidth, Math.floor((percent / 100) * safeWidth)));
  return `[${'#'.repeat(filled)}${'-'.repeat(safeWidth - filled)}]`;
}

module.exports = {
  formatProgressBar,
  generateRandomXp,
  getLevelFromXp,
  getProgress,
  getXpForLevel,
};
