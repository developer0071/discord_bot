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
 * Get the next person in queue (oldest joinedAt).
 * Returns the document data or null.
 */
async function getNextInQueue() {
  const snapshot = await db
    .collection('queue')
    .orderBy('joinedAt')
    .limit(1)
    .get();
  if (snapshot.empty) return null;
  return { id: snapshot.docs[0].id, ...snapshot.docs[0].data() };
}

/**
 * Get a user's current position in the queue (1-based).
 */
async function getQueuePosition(userId) {
  const userDoc = await db.collection('queue').doc(userId).get();
  if (!userDoc.exists) return null;

  const userJoinedAt = userDoc.data().joinedAt;
  // Count how many joined before this user
  const before = await db
    .collection('queue')
    .where('joinedAt', '<', userJoinedAt)
    .get();

  return before.size + 1;
}

/**
 * Get full queue list ordered by join time.
 */
async function getFullQueue() {
  const snapshot = await db.collection('queue').orderBy('joinedAt').get();
  return snapshot.docs.map((doc, i) => ({
    position: i + 1,
    ...doc.data(),
  }));
}

/**
 * Check if a user is currently in the queue.
 */
async function isInQueue(userId) {
  const doc = await db.collection('queue').doc(userId).get();
  return doc.exists;
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

module.exports = {
  getRegimentStatus,
  updateRegimentCount,
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
};
