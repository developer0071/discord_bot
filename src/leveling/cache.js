const DEFAULT_TTL_MS = 10 * 60 * 1000;
const DEFAULT_MAX_RANK_CACHE = 1000;

const users = new Map();
const dirtyUserIds = new Set();
const rankCache = new Map();

let primaryGuildId = null;
let leaderboardCache = null;

/**
 * Convert arbitrary Firebase data into the stable user shape used by the bot.
 * @param {object} data Raw user data.
 * @returns {{xp:number, level:number, username:string, lastMessageTime:number}}
 */
function normalizeUser(data = {}) {
  return {
    xp: Math.max(0, Number(data.xp) || 0),
    level: Math.max(0, Number(data.level) || 0),
    username: String(data.username || 'Unknown'),
    lastMessageTime: Number(data.lastMessageTime) || 0,
  };
}

/**
 * Initialize the in-memory store for one guild.
 * @param {string} guildId Discord guild ID.
 * @param {Record<string, object>} initialUsers Users loaded from Firebase.
 * @returns {void}
 */
function initCache(guildId, initialUsers = {}) {
  primaryGuildId = guildId;
  users.clear();
  dirtyUserIds.clear();
  rankCache.clear();
  clearLeaderboardCache();

  for (const [userId, data] of Object.entries(initialUsers || {})) {
    users.set(userId, {
      ...normalizeUser(data),
      lastAccessed: Date.now(),
    });
  }
}

/**
 * Return the guild ID this cache is currently serving.
 * @returns {string|null}
 */
function getPrimaryGuildId() {
  return primaryGuildId;
}

/**
 * Read a user from memory.
 * @param {string} userId Discord user ID.
 * @returns {object|null}
 */
function getUser(userId) {
  const user = users.get(userId);
  if (!user) return null;

  user.lastAccessed = Date.now();
  return {
    xp: user.xp,
    level: user.level,
    username: user.username,
    lastMessageTime: user.lastMessageTime,
  };
}

/**
 * Insert or update a user and optionally mark them dirty for the next batch save.
 * @param {string} userId Discord user ID.
 * @param {object} data User data to merge.
 * @param {{dirty?: boolean}} options Update options.
 * @returns {object} The normalized user data.
 */
function setUser(userId, data, options = {}) {
  const existing = users.get(userId) || {};
  const normalized = normalizeUser({ ...existing, ...data });

  users.set(userId, {
    ...normalized,
    lastAccessed: Date.now(),
  });

  if (options.dirty !== false) {
    dirtyUserIds.add(userId);
  }

  invalidateUserCaches(userId);
  return normalized;
}

/**
 * Return every cached user as an array.
 * @returns {Array<object>}
 */
function getAllUsers() {
  return Array.from(users.entries()).map(([userId, user]) => ({
    userId,
    xp: user.xp,
    level: user.level,
    username: user.username,
    lastMessageTime: user.lastMessageTime,
  }));
}

/**
 * Return dirty users waiting for a Firebase batch write.
 * @returns {Array<object>}
 */
function getDirtyUsers() {
  return Array.from(dirtyUserIds)
    .map((userId) => {
      const user = users.get(userId);
      return user ? { userId, ...normalizeUser(user) } : null;
    })
    .filter(Boolean);
}

/**
 * Mark one user as clean after a successful write.
 * @param {string} userId Discord user ID.
 * @returns {void}
 */
function markClean(userId) {
  dirtyUserIds.delete(userId);
}

/**
 * Check whether a user still needs to be written.
 * @param {string} userId Discord user ID.
 * @returns {boolean}
 */
function isDirty(userId) {
  return dirtyUserIds.has(userId);
}

/**
 * Remove cached rank and leaderboard projections after a user changes.
 * @param {string} userId Discord user ID.
 * @returns {void}
 */
function invalidateUserCaches(userId) {
  rankCache.delete(userId);
  clearLeaderboardCache();
}

/**
 * Remove expired rank cache entries and evict least recently used entries.
 * @param {number} now Current timestamp.
 * @returns {void}
 */
function pruneRankCache(now = Date.now()) {
  for (const [key, entry] of rankCache.entries()) {
    if (now - entry.timestamp > DEFAULT_TTL_MS) {
      rankCache.delete(key);
    }
  }

  if (rankCache.size <= DEFAULT_MAX_RANK_CACHE) return;

  const oldest = Array.from(rankCache.entries())
    .sort((a, b) => a[1].lastAccessed - b[1].lastAccessed)
    .slice(0, rankCache.size - DEFAULT_MAX_RANK_CACHE);

  for (const [key] of oldest) {
    rankCache.delete(key);
  }
}

/**
 * Read a cached rank projection.
 * @param {string} userId Discord user ID.
 * @returns {object|null}
 */
function getRankCache(userId) {
  const now = Date.now();
  pruneRankCache(now);

  const entry = rankCache.get(userId);
  if (!entry || now - entry.timestamp > DEFAULT_TTL_MS) {
    rankCache.delete(userId);
    return null;
  }

  entry.lastAccessed = now;
  return entry.data;
}

/**
 * Store a rank projection for 10 minutes.
 * @param {string} userId Discord user ID.
 * @param {object} data Rank projection.
 * @returns {void}
 */
function setRankCache(userId, data) {
  rankCache.set(userId, {
    data,
    timestamp: Date.now(),
    lastAccessed: Date.now(),
  });
  pruneRankCache();
}

/**
 * Read the cached leaderboard.
 * @returns {Array<object>|null}
 */
function getLeaderboardCache() {
  if (!leaderboardCache) return null;
  if (Date.now() - leaderboardCache.timestamp > DEFAULT_TTL_MS) {
    clearLeaderboardCache();
    return null;
  }
  leaderboardCache.lastAccessed = Date.now();
  return leaderboardCache.data;
}

/**
 * Cache the leaderboard for 10 minutes.
 * @param {Array<object>} data Leaderboard rows.
 * @returns {void}
 */
function setLeaderboardCache(data) {
  leaderboardCache = {
    data,
    timestamp: Date.now(),
    lastAccessed: Date.now(),
  };
}

/**
 * Clear the leaderboard cache.
 * @returns {void}
 */
function clearLeaderboardCache() {
  leaderboardCache = null;
}

module.exports = {
  clearLeaderboardCache,
  getAllUsers,
  getDirtyUsers,
  getLeaderboardCache,
  getPrimaryGuildId,
  getRankCache,
  getUser,
  initCache,
  invalidateUserCaches,
  isDirty,
  markClean,
  normalizeUser,
  setLeaderboardCache,
  setRankCache,
  setUser,
};
