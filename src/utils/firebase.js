const admin = require('firebase-admin');

// Fail fast with a clear message if Firebase credentials are not configured.
const REQUIRED_ENV = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
const missingEnv = REQUIRED_ENV.filter((key) => !process.env[key]);
if (missingEnv.length) {
  throw new Error(
    `Missing required Firebase env var(s): ${missingEnv.join(', ')}. ` +
    'Set them in your .env file (see .env.example).'
  );
}

// Initialize Firebase Admin SDK
if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    databaseURL: process.env.FIREBASE_DATABASE_URL,
  });
}

const db = admin.firestore();

// ─── Regiment ────────────────────────────────────────────────────────────────

/**
 * Get current regiment status: { currentCount, maxSlots, openSlots }
 */
async function getRegimentStatus() {
  const doc = await db.collection('config').doc('regiment').get();
  if (!doc.exists) {
    // First run: initialise config
    const defaultConfig = {
      maxSlots: parseInt(process.env.REGIMENT_MAX_SLOTS) || 20,
      currentCount: 0,
    };
    await db.collection('config').doc('regiment').set(defaultConfig);
    return { ...defaultConfig, openSlots: defaultConfig.maxSlots };
  }
  const data = doc.data();
  return {
    maxSlots: data.maxSlots,
    currentCount: data.currentCount,
    openSlots: data.maxSlots - data.currentCount,
  };
}

/**
 * Increment or decrement the regiment member count
 */
async function updateRegimentCount(delta) {
  const ref = db.collection('config').doc('regiment');
  await ref.update({
    currentCount: admin.firestore.FieldValue.increment(delta),
  });
}

/**
 * Manually update the max slots (admin command)
 */
async function setMaxSlots(newMax) {
  await db.collection('config').doc('regiment').update({ maxSlots: newMax });
}

// ─── Queue ────────────────────────────────────────────────────────────────────

/**
 * Add a user to the waiting queue.
 * Returns their position (1-based).
 */
async function addToQueue(userId, username) {
  // Prevent duplicates
  const existing = await db.collection('queue').doc(userId).get();
  if (existing.exists) {
    const position = await getQueuePosition(userId);
    return { alreadyQueued: true, position };
  }

  const queueRef = db.collection('queue');
  const snapshot = await queueRef.orderBy('joinedAt').get();
  const position = snapshot.size + 1;

  await queueRef.doc(userId).set({
    userId,
    username,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    ticketNumber: position,
    notified: false,
    votes: 0,
  });

  return { alreadyQueued: false, position };
}

/**
 * Remove a user from the queue (they left or got promoted).
 */
async function removeFromQueue(userId) {
  await db.collection('queue').doc(userId).delete();
}

/**
 * Get full queue list ordered by votes (desc), then join time (asc).
 */
async function getFullQueue() {
  const snapshot = await db.collection('queue').get();
  const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));

  docs.sort((a, b) => {
    const aVotes = a.votes || 0;
    const bVotes = b.votes || 0;
    if (aVotes !== bVotes) {
      return bVotes - aVotes;
    }
    const aTime = a.joinedAt ? a.joinedAt.toMillis() : 0;
    const bTime = b.joinedAt ? b.joinedAt.toMillis() : 0;
    return aTime - bTime;
  });

  return docs.map((doc, i) => ({
    position: i + 1,
    ...doc,
  }));
}

/**
 * Get the next person in queue (highest votes, then oldest joinedAt).
 * Returns the document data or null.
 */
async function getNextInQueue() {
  const queue = await getFullQueue();
  if (queue.length === 0) return null;
  return queue[0];
}

/**
 * Get a user's current position in the queue (1-based).
 */
async function getQueuePosition(userId) {
  const queue = await getFullQueue();
  const user = queue.find(u => u.userId === userId);
  return user ? user.position : null;
}

/**
 * Check if a user is currently in the queue.
 */
async function isInQueue(userId) {
  const doc = await db.collection('queue').doc(userId).get();
  return doc.exists;
}

/**
 * Cast a vote for a user in the queue.
 * Limit: 1 vote per voter per 24 hours.
 */
async function castQueueVote(voterId, targetUserId) {
  const voteDoc = await db.collection('queue_votes').doc(voterId).get();
  const now = Date.now();
  
  if (voteDoc.exists) {
    const lastVotedAt = voteDoc.data().lastVotedAt?.toMillis() || 0;
    const timeSinceLastVote = now - lastVotedAt;
    const cooldownMs = 24 * 60 * 60 * 1000; // 24 hours
    
    if (timeSinceLastVote < cooldownMs) {
      const remainingTime = cooldownMs - timeSinceLastVote;
      return { success: false, remainingTime };
    }
  }

  // Verify target user is in queue
  const targetDoc = await db.collection('queue').doc(targetUserId).get();
  if (!targetDoc.exists) {
    return { success: false, error: 'Target user is not in the queue.' };
  }

  // Use a batch to update both atomically
  const batch = db.batch();
  batch.set(db.collection('queue_votes').doc(voterId), {
    lastVotedAt: admin.firestore.FieldValue.serverTimestamp(),
    targetUserId
  });
  batch.update(db.collection('queue').doc(targetUserId), {
    votes: admin.firestore.FieldValue.increment(1)
  });

  await batch.commit();
  return { success: true };
}

// ─── Members ─────────────────────────────────────────────────────────────────

/**
 * Record a member as an official regiment member.
 */
async function addMember(userId, username) {
  await db.collection('members').doc(userId).set({
    userId,
    username,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await updateRegimentCount(1);
}

/**
 * Remove a member record.
 */
async function removeMember(userId) {
  const doc = await db.collection('members').doc(userId).get();
  if (doc.exists) {
    await db.collection('members').doc(userId).delete();
    await updateRegimentCount(-1);
  }
}

/**
 * Check if a user is a regiment member.
 */
async function isMember(userId) {
  const doc = await db.collection('members').doc(userId).get();
  return doc.exists;
}

/**
 * Get all regiment members, ordered by join time.
 */
async function getAllMembers() {
  const snapshot = await db.collection('members').orderBy('joinedAt').get();
  return snapshot.docs.map((doc) => doc.data());
}

// ─── User profiles (verification info) ─────────────────────────────────────────

/**
 * Save/merge a user's profile (Discord info, Roblox username, families, etc.).
 */
async function saveUserProfile(userId, data) {
  await db.collection('users').doc(userId).set(data, { merge: true });
}

/**
 * Get a user's saved profile, or null.
 */
async function getUserProfile(userId) {
  const doc = await db.collection('users').doc(userId).get();
  return doc.exists ? doc.data() : null;
}

/**
 * Get all saved user profiles.
 */
async function getAllUsers() {
  const snapshot = await db.collection('users').get();
  return snapshot.docs.map((doc) => doc.data());
}

// ─── Audit logs ────────────────────────────────────────────────────────────────

/**
 * Append an audit-log entry.
 */
async function addLog(action, target, detail) {
  await db.collection('logs').add({
    action,
    target: target || 'Unknown',
    detail: detail || '',
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

/**
 * Get the most recent audit-log entries (newest first).
 */
async function getLogs(max = 50) {
  const snapshot = await db.collection('logs').orderBy('at', 'desc').limit(max).get();
  return snapshot.docs.map((doc) => doc.data());
}

// ─── Dashboard settings ─────────────────────────────────────────────────────────

async function getDashboardSettings() {
  const doc = await db.collection('config').doc('dashboard').get();
  return doc.exists ? doc.data() : {};
}

async function saveDashboardSettings(data) {
  await db.collection('config').doc('dashboard').set(data, { merge: true });
}

// ─── Giveaways ────────────────────────────────────────────────────────────────

async function createGiveaway(id, data) {
  await db.collection('giveaways').doc(id).set({
    ...data,
    entrants: {},
    winners: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return id;
}

async function getGiveaway(id) {
  const doc = await db.collection('giveaways').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function getAllGiveaways() {
  const snapshot = await db.collection('giveaways').orderBy('createdAt', 'desc').get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function getGiveawaysByStatus(status) {
  const snapshot = await db.collection('giveaways').where('status', '==', status).get();
  return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
}

async function updateGiveaway(id, data) {
  await db.collection('giveaways').doc(id).set(data, { merge: true });
}

async function deleteGiveaway(id) {
  await db.collection('giveaways').doc(id).delete();
}

async function addGiveawayEntrant(giveawayId, userId, tag) {
  await db.collection('giveaways').doc(giveawayId).set(
    {
      entrants: {
        [userId]: {
          tag,
          enteredAt: admin.firestore.FieldValue.serverTimestamp(),
        },
      },
    },
    { merge: true },
  );
}

async function removeGiveawayEntrant(giveawayId, userId) {
  await db.collection('giveaways').doc(giveawayId).update({
    [`entrants.${userId}`]: admin.firestore.FieldValue.delete(),
  });
}

async function isGiveawayEntrant(giveawayId, userId) {
  const doc = await db.collection('giveaways').doc(giveawayId).get();
  if (!doc.exists) return false;
  return !!(doc.data().entrants || {})[userId];
}

// ─── Polls (time votes) ───────────────────────────────────────────────────────

/**
 * Record (or change) a user's vote for a poll. One vote per user.
 */
async function setVote(pollId, userId, option) {
  await db.collection('polls').doc(pollId).set(
    { votes: { [userId]: option } },
    { merge: true }
  );
}

/**
 * Get all votes for a poll as { userId: option }.
 */
async function getVotes(pollId) {
  const doc = await db.collection('polls').doc(pollId).get();
  return doc.exists ? (doc.data().votes || {}) : {};
}

// ─── Private Servers ─────────────────────────────────────────────────────────

async function getPrivateServers() {
  const snapshot = await db.collection('private_servers').orderBy('addedAt', 'desc').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function addPrivateServer(userId, tag, link) {
  // Overwrite if exists, so a user can only have 1 active
  await db.collection('private_servers').doc(userId).set({
    userId,
    tag,
    link,
    addedAt: admin.firestore.FieldValue.serverTimestamp()
  });
}

async function deletePrivateServer(userId) {
  await db.collection('private_servers').doc(userId).delete();
}

/**
 * Sync the currentCount in config/regiment to exactly match the number of members.
 */
async function syncRegimentCount() {
  const snapshot = await db.collection('members').get();
  const count = snapshot.size;
  await db.collection('config').doc('regiment').update({ currentCount: count });
  return count;
}

module.exports = {
  getRegimentStatus,
  updateRegimentCount,
  syncRegimentCount,
  setMaxSlots,
  addToQueue,
  removeFromQueue,
  getNextInQueue,
  getQueuePosition,
  getFullQueue,
  isInQueue,
  addMember,
  removeMember,
  isMember,
  getAllMembers,
  setVote,
  getVotes,
  saveUserProfile,
  getUserProfile,
  getAllUsers,
  addLog,
  getLogs,
  getDashboardSettings,
  saveDashboardSettings,
  createGiveaway,
  getGiveaway,
  getAllGiveaways,
  getGiveawaysByStatus,
  updateGiveaway,
  deleteGiveaway,
  addGiveawayEntrant,
  removeGiveawayEntrant,
  isGiveawayEntrant,
  getPrivateServers,
  addPrivateServer,
  deletePrivateServer,
  castQueueVote,
  getDb: () => db,
};
