const admin = require('firebase-admin');

const REQUIRED_ENV = [
  'FIREBASE_PROJECT_ID',
  'FIREBASE_CLIENT_EMAIL',
  'FIREBASE_PRIVATE_KEY',
  'FIREBASE_DATABASE_URL',
];

let db = null;
let batchTimer = null;
let usersRef = null;
let childAddedHandler = null;
let childChangedHandler = null;
let shuttingDown = false;

/**
 * Return the configured Firebase data root.
 * @returns {string}
 */
function getRootPath() {
  return process.env.FIREBASE_ROOT || 'discord-bot';
}

/**
 * Build a Realtime Database path under the bot root.
 * @param {...string} parts Path parts.
 * @returns {string}
 */
function rootPath(...parts) {
  return [getRootPath(), ...parts].filter(Boolean).join('/');
}

/**
 * Check whether Firebase has been initialized.
 * @returns {boolean}
 */
function isReady() {
  return Boolean(db);
}

/**
 * Initialize Firebase Admin SDK if the required env vars exist.
 * @param {NodeJS.ProcessEnv} env Environment variables.
 * @returns {boolean} True when Firebase is ready.
 */
function initFirebase(env = process.env) {
  if (db) return true;

  const missing = REQUIRED_ENV.filter((key) => !env[key]);
  if (missing.length) {
    console.warn(`[firebase] Missing ${missing.join(', ')}. Running in memory-only mode.`);
    return false;
  }

  try {
    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: env.FIREBASE_PROJECT_ID,
          clientEmail: env.FIREBASE_CLIENT_EMAIL,
          privateKey: env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
        databaseURL: env.FIREBASE_DATABASE_URL,
      });
    }

    db = admin.database();
    console.log(`[${new Date().toISOString()}] Firebase Realtime Database connected`);
    return true;
  } catch (error) {
    console.error('[firebase] Initialization failed. Running in memory-only mode:', error);
    db = null;
    return false;
  }
}

/**
 * Load all users for a guild once on startup.
 * @param {string} guildId Discord guild ID.
 * @param {object} metrics Metrics recorder.
 * @returns {Promise<Record<string, object>>}
 */
async function loadGuildUsers(guildId, metrics) {
  if (!isReady()) return {};

  try {
    const snapshot = await db.ref(rootPath('guilds', guildId, 'users')).once('value');
    metrics?.recordRead();
    return snapshot.exists() ? snapshot.val() : {};
  } catch (error) {
    console.error('[firebase] Failed to load guild users:', error);
    return {};
  }
}

/**
 * Serialize user data for Firebase writes.
 * @param {object} user User row from cache.
 * @returns {object}
 */
function serializeUser(user) {
  return {
    xp: Math.max(0, Number(user.xp) || 0),
    level: Math.max(0, Number(user.level) || 0),
    username: String(user.username || 'Unknown'),
    lastMessageTime: Number(user.lastMessageTime) || 0,
  };
}

/**
 * Write all dirty users in one Realtime Database update.
 * @param {object} cache In-memory cache module.
 * @param {object} metrics Metrics recorder.
 * @returns {Promise<number>} Number of user records written.
 */
async function performBatchWrite(cache, metrics) {
  if (!isReady() || shuttingDown) return 0;

  const guildId = cache.getPrimaryGuildId();
  const dirtyUsers = cache.getDirtyUsers();
  if (!guildId || dirtyUsers.length === 0) return 0;

  const updates = {};
  for (const user of dirtyUsers) {
    updates[rootPath('guilds', guildId, 'users', user.userId)] = serializeUser(user);
  }

  try {
    await db.ref().update(updates);
    for (const user of dirtyUsers) {
      cache.markClean(user.userId);
    }
    metrics?.recordWrite(dirtyUsers.length);
    console.log(`[${new Date().toISOString()}] Batch save: ${dirtyUsers.length} users to Firebase`);
    return dirtyUsers.length;
  } catch (error) {
    console.error('[firebase] Batch write failed; users remain dirty for retry:', error);
    return 0;
  }
}

/**
 * Start the 60-second dirty-user batch write loop.
 * @param {object} options Options.
 * @param {object} options.cache In-memory cache module.
 * @param {object} options.metrics Metrics recorder.
 * @param {number} options.intervalMs Write interval.
 * @returns {NodeJS.Timeout|null}
 */
function startBatchWriteInterval({ cache, metrics, intervalMs = 60000 }) {
  if (!isReady()) return null;
  if (batchTimer) clearInterval(batchTimer);

  batchTimer = setInterval(() => {
    performBatchWrite(cache, metrics).catch((error) => {
      console.error('[firebase] Scheduled batch write failed:', error);
    });
  }, intervalMs);

  batchTimer.unref?.();
  return batchTimer;
}

/**
 * Attach Firebase listeners so dashboard edits update the bot cache.
 * @param {object} options Listener options.
 * @param {string} options.guildId Discord guild ID.
 * @param {object} options.cache In-memory cache module.
 * @param {object} options.metrics Metrics recorder.
 * @param {(userId:string, oldLevel:number, newLevel:number, guildId:string) => Promise<void>} options.announceLevelUp Announcer.
 * @returns {Function|null} Unsubscribe function.
 */
function setupFirebaseListeners({ guildId, cache, metrics, announceLevelUp }) {
  if (!isReady()) return null;

  usersRef = db.ref(rootPath('guilds', guildId, 'users'));

  childAddedHandler = (snapshot) => {
    metrics?.recordRead();
    const userId = snapshot.key;
    if (!cache.getUser(userId)) {
      cache.setUser(userId, snapshot.val() || {}, { dirty: false });
    }
  };

  childChangedHandler = async (snapshot) => {
    metrics?.recordRead();
    const userId = snapshot.key;
    const incoming = cache.normalizeUser(snapshot.val() || {});
    const existing = cache.getUser(userId);
    const oldLevel = existing?.level || 0;

    cache.setUser(userId, incoming, { dirty: false });

    if (existing && incoming.level > oldLevel && !cache.isDirty(userId)) {
      await announceLevelUp(userId, oldLevel, incoming.level, guildId);
    }
  };

  usersRef.on('child_added', childAddedHandler);
  usersRef.on('child_changed', childChangedHandler);

  return () => {
    usersRef.off('child_added', childAddedHandler);
    usersRef.off('child_changed', childChangedHandler);
  };
}

/**
 * Write one audit-log entry.
 * @param {string} guildId Discord guild ID.
 * @param {object} auditData Audit data.
 * @param {object} metrics Metrics recorder.
 * @returns {Promise<void>}
 */
async function writeAuditLog(guildId, auditData, metrics) {
  if (!isReady() || !guildId) return;

  try {
    await db.ref(rootPath('guilds', guildId, 'auditLogs')).push({
      timestamp: admin.database.ServerValue.TIMESTAMP,
      ...auditData,
    });
    metrics?.recordWrite();
  } catch (error) {
    console.error('[firebase] Failed to write audit log:', error);
  }
}

/**
 * Append a user rank-history entry.
 * @param {string} guildId Discord guild ID.
 * @param {string} userId Discord user ID.
 * @param {object} entry History data.
 * @param {object} metrics Metrics recorder.
 * @returns {Promise<void>}
 */
async function appendRankHistory(guildId, userId, entry, metrics) {
  if (!isReady() || !guildId || !userId) return;

  try {
    await db.ref(rootPath('guilds', guildId, 'history', userId)).push({
      timestamp: admin.database.ServerValue.TIMESTAMP,
      ...entry,
    });
    metrics?.recordWrite();
  } catch (error) {
    console.error('[firebase] Failed to append rank history:', error);
  }
}

/**
 * Save pending dirty users before process shutdown.
 * @param {object} cache In-memory cache module.
 * @param {object} metrics Metrics recorder.
 * @returns {Promise<void>}
 */
async function saveOnShutdown(cache, metrics) {
  shuttingDown = true;
  if (batchTimer) clearInterval(batchTimer);

  if (!isReady()) return;
  shuttingDown = false;
  await performBatchWrite(cache, metrics);
  shuttingDown = true;
}

module.exports = {
  appendRankHistory,
  initFirebase,
  isReady,
  loadGuildUsers,
  performBatchWrite,
  rootPath,
  saveOnShutdown,
  setupFirebaseListeners,
  startBatchWriteInterval,
  writeAuditLog,
};
