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

// ── Moonlight → Firestore ─────────────────────────────────────────────────────
const { getFirestore } = require('firebase-admin/firestore');
const firestoreDb = getFirestore();

// ── Sunshine → Realtime Database ──────────────────────────────────────────────
const rtdb = admin.database();

// Helper: get a snapshot from RTD and convert it to an array of objects
async function rtdGetAll(path) {
  const snap = await rtdb.ref(path).once('value');
  if (!snap.exists()) return [];
  const val = snap.val();
  return Object.entries(val).map(([key, data]) => ({ _key: key, ...data }));
}

// Helper: get a single value from RTD
async function rtdGet(path) {
  const snap = await rtdb.ref(path).once('value');
  return snap.exists() ? snap.val() : null;
}

// Helper: set a value in RTD
async function rtdSet(path, data) {
  await rtdb.ref(path).set(data);
}

// Helper: update (merge) a value in RTD
async function rtdUpdate(path, data) {
  await rtdb.ref(path).update(data);
}

// Helper: delete a node in RTD
async function rtdDelete(path) {
  await rtdb.ref(path).remove();
}

// Helper: push a new item to an RTD list (auto-generates key)
async function rtdPush(path, data) {
  const ref = await rtdb.ref(path).push(data);
  return ref.key;
}

// ─── Cache to prevent Quota Exhaustion ────────────────────────────────────────
const _cache = {
  users: { data: null, lastFetch: 0 },
  members: { data: null, lastFetch: 0 },
  queue: { data: null, lastFetch: 0 },
};

// ─── Regiment ────────────────────────────────────────────────────────────────

async function getRegimentStatus(regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const data = await rtdGet('sunshine/config/regiment');
    if (!data) {
      const defaultConfig = {
        maxSlots: parseInt(process.env.REGIMENT_MAX_SLOTS) || 20,
        currentCount: 0,
      };
      await rtdSet('sunshine/config/regiment', defaultConfig);
      return { ...defaultConfig, openSlots: defaultConfig.maxSlots };
    }
    return { ...data, openSlots: (data.maxSlots || 0) - (data.currentCount || 0) };
  }

  // Moonlight → Firestore
  const db = firestoreDb;
  const doc = await db.collection('config').doc('regiment').get();
  if (!doc.exists) {
    const defaultConfig = {
      maxSlots: parseInt(process.env.REGIMENT_MAX_SLOTS) || 20,
      currentCount: 0,
    };
    await db.collection('config').doc('regiment').set(defaultConfig);
    return { ...defaultConfig, openSlots: defaultConfig.maxSlots };
  }
  const d = doc.data();
  return { maxSlots: d.maxSlots, currentCount: d.currentCount, openSlots: d.maxSlots - d.currentCount };
}

async function updateRegimentCount(delta, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const current = await rtdGet('sunshine/config/regiment/currentCount') || 0;
    await rtdUpdate('sunshine/config/regiment', { currentCount: Math.max(0, current + delta) });
    return;
  }
  const ref = firestoreDb.collection('config').doc('regiment');
  await ref.update({ currentCount: admin.firestore.FieldValue.increment(delta) });
}

async function setMaxSlots(newMax, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdUpdate('sunshine/config/regiment', { maxSlots: newMax });
    return;
  }
  await firestoreDb.collection('config').doc('regiment').update({ maxSlots: newMax });
}

async function syncRegimentCount(regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const snap = await rtdb.ref('sunshine/members').once('value');
    const count = snap.exists() ? Object.keys(snap.val()).length : 0;
    await rtdUpdate('sunshine/config/regiment', { currentCount: count });
    return count;
  }
  const snapshot = await firestoreDb.collection('members').get();
  const count = snapshot.size;
  await firestoreDb.collection('config').doc('regiment').update({ currentCount: count });
  return count;
}

// ─── Queue ────────────────────────────────────────────────────────────────────
// Queue is global (moonlight RTD path used for both regiments)

async function addToQueue(userId, username, regiment = 'moonlight') {
  const db = firestoreDb; // global queue always uses Firestore/moonlight
  const existing = await db.collection('queue').doc(userId).get();
  if (existing.exists) {
    const position = await getQueuePosition(userId, regiment);
    return { alreadyQueued: true, position };
  }
  const queueRef = db.collection('queue');
  const snapshot = await queueRef.orderBy('joinedAt').get();
  const position = snapshot.size + 1;
  await queueRef.doc(userId).set({
    userId, username,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
    ticketNumber: position,
    notified: false,
    votes: 0,
  });
  _cache.queue.data = null; // Invalidate queue cache
  return { alreadyQueued: false, position };
}

async function removeFromQueue(userId, regiment = 'moonlight') {
  await firestoreDb.collection('queue').doc(userId).delete();
  _cache.queue.data = null; // Invalidate queue cache
}

async function getFullQueue(regiment = 'moonlight') {
  const now = Date.now();
  if (regiment === 'moonlight' && _cache.queue.data && now - _cache.queue.lastFetch < 60000) {
    return _cache.queue.data;
  }
  const snapshot = await firestoreDb.collection('queue').get();
  const docs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  docs.sort((a, b) => {
    const aVotes = a.votes || 0;
    const bVotes = b.votes || 0;
    if (aVotes !== bVotes) return bVotes - aVotes;
    const aTime = a.joinedAt?.toMillis?.() || 0;
    const bTime = b.joinedAt?.toMillis?.() || 0;
    return aTime - bTime;
  });
  const finalDocs = docs.map((doc, i) => ({ position: i + 1, ...doc }));
  if (regiment === 'moonlight') {
    _cache.queue.data = finalDocs;
    _cache.queue.lastFetch = now;
  }
  return finalDocs;
}

async function getNextInQueue(regiment = 'moonlight') {
  const queue = await getFullQueue(regiment);
  return queue.length === 0 ? null : queue[0];
}

async function getQueuePosition(userId, regiment = 'moonlight') {
  const queue = await getFullQueue(regiment);
  const user = queue.find(u => u.userId === userId);
  return user ? user.position : null;
}

async function isInQueue(userId, regiment = 'moonlight') {
  const doc = await firestoreDb.collection('queue').doc(userId).get();
  return doc.exists;
}

async function castQueueVote(voterId, targetUserId, regiment = 'moonlight') {
  const db = firestoreDb;
  const voteDoc = await db.collection('queue_votes').doc(voterId).get();
  const now = Date.now();
  if (voteDoc.exists) {
    const lastVotedAt = voteDoc.data().lastVotedAt?.toMillis?.() || 0;
    const timeSince = now - lastVotedAt;
    const cooldown = 24 * 60 * 60 * 1000;
    if (timeSince < cooldown) return { success: false, remainingTime: cooldown - timeSince };
  }
  const targetDoc = await db.collection('queue').doc(targetUserId).get();
  if (!targetDoc.exists) return { success: false, error: 'Target user is not in the queue.' };
  const batch = db.batch();
  batch.set(db.collection('queue_votes').doc(voterId), {
    lastVotedAt: admin.firestore.FieldValue.serverTimestamp(), targetUserId,
  });
  batch.update(db.collection('queue').doc(targetUserId), {
    votes: admin.firestore.FieldValue.increment(1),
  });
  await batch.commit();
  _cache.queue.data = null; // Invalidate queue cache
  return { success: true };
}

// ─── Members ─────────────────────────────────────────────────────────────────

async function addMember(userId, username, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdSet(`sunshine/members/${userId}`, {
      userId, username, joinedAt: Date.now(),
    });
    await updateRegimentCount(1, 'sunshine');
    return;
  }
  await firestoreDb.collection('members').doc(userId).set({
    userId, username,
    joinedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await updateRegimentCount(1, 'moonlight');
  _cache.members.data = null; // Invalidate cache
}

async function removeMember(userId, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const exists = await rtdGet(`sunshine/members/${userId}`);
    if (exists) {
      await rtdDelete(`sunshine/members/${userId}`);
      await updateRegimentCount(-1, 'sunshine');
    }
    return;
  }
  const doc = await firestoreDb.collection('members').doc(userId).get();
  if (doc.exists) {
    await firestoreDb.collection('members').doc(userId).delete();
    await updateRegimentCount(-1, 'moonlight');
    _cache.members.data = null; // Invalidate cache
  }
}

async function isMember(userId, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const data = await rtdGet(`sunshine/members/${userId}`);
    return data !== null;
  }
  const doc = await firestoreDb.collection('members').doc(userId).get();
  return doc.exists;
}

async function getAllMembers(regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const snap = await rtdb.ref('sunshine/members').once('value');
    if (!snap.exists()) return [];
    return Object.values(snap.val());
  }
  
  const now = Date.now();
  if (_cache.members.data && now - _cache.members.lastFetch < 60000) {
    return _cache.members.data;
  }
  
  const snapshot = await firestoreDb.collection('members').orderBy('joinedAt').get();
  _cache.members.data = snapshot.docs.map(doc => doc.data());
  _cache.members.lastFetch = now;
  return _cache.members.data;
}

// ─── User Profiles ───────────────────────────────────────────────────────────
// Profiles are always stored in Moonlight/Firestore (shared across regiments)

async function saveUserProfile(userId, data) {
  await firestoreDb.collection('users').doc(userId).set(data, { merge: true });
  if (_cache.users.data) {
    const existing = _cache.users.data.find(u => (u.discordId || u.userId) === userId);
    if (existing) {
      Object.assign(existing, data);
    } else {
      _cache.users.data.push({ userId, ...data });
    }
  }
}

async function getUserProfile(userId) {
  const doc = await firestoreDb.collection('users').doc(userId).get();
  return doc.exists ? doc.data() : null;
}

async function getAllUsers() {
  const now = Date.now();
  if (_cache.users.data && now - _cache.users.lastFetch < 3600000) { // 1 hour cache
    return _cache.users.data;
  }
  const snapshot = await firestoreDb.collection('users').get();
  _cache.users.data = snapshot.docs.map(doc => doc.data());
  _cache.users.lastFetch = now;
  return _cache.users.data;
}

// ─── Audit Logs ──────────────────────────────────────────────────────────────

async function addLog(action, target, detail, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdPush('sunshine/logs', {
      action, target: target || 'Unknown', detail: detail || '', at: Date.now(),
    });
    return;
  }
  await firestoreDb.collection('logs').add({
    action, target: target || 'Unknown', detail: detail || '',
    at: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function getLogs(max = 50, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const snap = await rtdb.ref('sunshine/logs').orderByChild('at').limitToLast(max).once('value');
    if (!snap.exists()) return [];
    const items = Object.values(snap.val());
    items.sort((a, b) => (b.at || 0) - (a.at || 0));
    // Normalize: wrap ms timestamp into an object that has a toMillis() fn
    return items.map(l => ({
      ...l,
      at: { toMillis: () => l.at },
    }));
  }
  const snapshot = await firestoreDb.collection('logs').orderBy('at', 'desc').limit(max).get();
  return snapshot.docs.map(doc => doc.data());
}

// ─── Dashboard Settings ───────────────────────────────────────────────────────

async function getDashboardSettings(regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const data = await rtdGet('sunshine/config/dashboard');
    return data || {};
  }
  const doc = await firestoreDb.collection('config').doc('dashboard').get();
  return doc.exists ? doc.data() : {};
}

async function saveDashboardSettings(data, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdUpdate('sunshine/config/dashboard', data);
    return;
  }
  await firestoreDb.collection('config').doc('dashboard').set(data, { merge: true });
}

// ─── Giveaways ────────────────────────────────────────────────────────────────

async function createGiveaway(id, data, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdSet(`sunshine/giveaways/${id}`, {
      ...data,
      startsAt: data.startsAt instanceof Date ? data.startsAt.getTime() : Date.now(),
      endsAt: data.endsAt instanceof Date ? data.endsAt.getTime() : (data.endsAt || null),
      entrants: {},
      winners: [],
      createdAt: Date.now(),
    });
    return id;
  }
  await firestoreDb.collection('giveaways').doc(id).set({
    ...data, entrants: {}, winners: [],
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return id;
}

async function getGiveaway(id, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const data = await rtdGet(`sunshine/giveaways/${id}`);
    if (!data) return null;
    // Normalize timestamps to have a toMillis() method
    return normalizeRTDGiveaway(id, data);
  }
  const doc = await firestoreDb.collection('giveaways').doc(id).get();
  return doc.exists ? { id: doc.id, ...doc.data() } : null;
}

async function getAllGiveaways(regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const snap = await rtdb.ref('sunshine/giveaways').orderByChild('createdAt').once('value');
    if (!snap.exists()) return [];
    const items = [];
    snap.forEach(child => items.unshift(normalizeRTDGiveaway(child.key, child.val())));
    return items;
  }
  const snapshot = await firestoreDb.collection('giveaways').orderBy('createdAt', 'desc').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function getGiveawaysByStatus(status, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const all = await getAllGiveaways('sunshine');
    return all.filter(g => g.status === status);
  }
  const snapshot = await firestoreDb.collection('giveaways').where('status', '==', status).get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function updateGiveaway(id, data, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    // Flatten nested update for RTD
    const flat = {};
    for (const [k, v] of Object.entries(data)) {
      if (v instanceof Date) flat[k] = v.getTime();
      else flat[k] = v;
    }
    await rtdUpdate(`sunshine/giveaways/${id}`, flat);
    return;
  }
  await firestoreDb.collection('giveaways').doc(id).set(data, { merge: true });
}

async function deleteGiveaway(id, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdDelete(`sunshine/giveaways/${id}`);
    return;
  }
  await firestoreDb.collection('giveaways').doc(id).delete();
}

async function addGiveawayEntrant(giveawayId, userId, tag, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdSet(`sunshine/giveaways/${giveawayId}/entrants/${userId}`, {
      tag, enteredAt: Date.now(),
    });
    return;
  }
  await firestoreDb.collection('giveaways').doc(giveawayId).set(
    { entrants: { [userId]: { tag, enteredAt: admin.firestore.FieldValue.serverTimestamp() } } },
    { merge: true }
  );
}

async function removeGiveawayEntrant(giveawayId, userId, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdDelete(`sunshine/giveaways/${giveawayId}/entrants/${userId}`);
    return;
  }
  await firestoreDb.collection('giveaways').doc(giveawayId).update({
    [`entrants.${userId}`]: admin.firestore.FieldValue.delete(),
  });
}

async function isGiveawayEntrant(giveawayId, userId, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const data = await rtdGet(`sunshine/giveaways/${giveawayId}/entrants/${userId}`);
    return data !== null;
  }
  const doc = await firestoreDb.collection('giveaways').doc(giveawayId).get();
  if (!doc.exists) return false;
  return !!(doc.data().entrants || {})[userId];
}

// ─── Polls ───────────────────────────────────────────────────────────────────

async function setVote(pollId, userId, option, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdSet(`sunshine/polls/${pollId}/votes/${userId}`, option);
    return;
  }
  await firestoreDb.collection('polls').doc(pollId).set(
    { votes: { [userId]: option } }, { merge: true }
  );
}

async function getVotes(pollId, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const data = await rtdGet(`sunshine/polls/${pollId}/votes`);
    return data || {};
  }
  const doc = await firestoreDb.collection('polls').doc(pollId).get();
  return doc.exists ? (doc.data().votes || {}) : {};
}

// ─── Private Servers ─────────────────────────────────────────────────────────

async function getPrivateServers(regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    const snap = await rtdb.ref('sunshine/private_servers').orderByChild('addedAt').once('value');
    if (!snap.exists()) return [];
    const items = [];
    snap.forEach(child => items.unshift({ id: child.key, ...child.val() }));
    return items;
  }
  const snapshot = await firestoreDb.collection('private_servers').orderBy('addedAt', 'desc').get();
  return snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
}

async function addPrivateServer(userId, tag, link, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdSet(`sunshine/private_servers/${userId}`, {
      userId, tag, link, addedAt: Date.now(),
    });
    return;
  }
  await firestoreDb.collection('private_servers').doc(userId).set({
    userId, tag, link,
    addedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
}

async function deletePrivateServer(userId, regiment = 'moonlight') {
  if (regiment === 'sunshine') {
    await rtdDelete(`sunshine/private_servers/${userId}`);
    return;
  }
  await firestoreDb.collection('private_servers').doc(userId).delete();
}

// ─── RTD Normalization Helper ─────────────────────────────────────────────────
// Converts RTD numeric timestamps into objects with a toMillis() method,
// so the rest of the codebase (server.js tsToMs) works identically for both DBs.

function wrapTs(ms) {
  if (!ms) return null;
  return { toMillis: () => ms };
}

function normalizeRTDGiveaway(id, data) {
  return {
    id,
    ...data,
    startsAt: wrapTs(data.startsAt),
    endsAt: wrapTs(data.endsAt),
    createdAt: wrapTs(data.createdAt),
    entrants: data.entrants || {},
    winners: data.winners || [],
  };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

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
  getDb: (r) => r === 'sunshine' ? rtdb : firestoreDb,
};
