const path = require('path');
const express = require('express');

const fb = require('../utils/firebase');
const { assignRegimentRole, removeRegimentRole } = require('../utils/helpers');
const { promoteFromQueue } = require('../events/guildMemberRemove');

// Firestore Timestamp → epoch ms (or null).
function tsToMs(ts) {
  if (!ts) return null;
  if (typeof ts.toMillis === 'function') return ts.toMillis();
  return ts;
}

/**
 * Start the admin dashboard web server. Needs the live Discord client so actions
 * (assign/remove roles) can run against the guild.
 */
function startWebServer(client) {
  const password = process.env.DASHBOARD_PASSWORD;
  if (!password) {
    console.log('⚠️  DASHBOARD_PASSWORD not set — web dashboard disabled.');
    return;
  }
  const port = parseInt(process.env.DASHBOARD_PORT, 10) || 3000;

  const app = express();
  app.use(express.json());

  // CORS — lets the Vercel-hosted frontend call this API. Auth is via Bearer
  // password (not cookies), so a wildcard origin is safe. Lock it down with
  // DASHBOARD_ORIGIN=https://your-site.vercel.app if you prefer.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.DASHBOARD_ORIGIN || '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  const rootDir = path.join(__dirname, '..', '..');
  const guild = () => client.guilds.cache.first();
  const fetchMember = async (userId) => {
    try { return await guild().members.fetch(userId); } catch { return null; }
  };

  // ── Public: the dashboard UI (login happens client-side; data needs auth) ──
  app.get('/', (req, res) => res.sendFile(path.join(rootDir, 'index.html')));
  app.get('/app-api.js', (req, res) => res.sendFile(path.join(rootDir, 'app-api.js')));
  app.get('/logo.png', (req, res) => res.sendFile(path.join(rootDir, 'logo.png')));

  // ── Auth gate for everything under /api ──
  app.use('/api', (req, res, next) => {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : '';
    if (token !== password) return res.status(401).json({ error: 'unauthorized' });
    next();
  });

  // ── Data ──
  app.get('/api/data', async (req, res) => {
    try {
      const [status, members, queue, users] = await Promise.all([
        fb.getRegimentStatus(), fb.getAllMembers(), fb.getFullQueue(), fb.getAllUsers(),
      ]);
      const profile = Object.fromEntries(users.map((u) => [u.discordId || u.userId, u]));
      res.json({
        status,
        members: members.map((m) => ({
          userId: m.userId,
          discord: m.username,
          roblox: profile[m.userId]?.robloxUsername || '',
          families: profile[m.userId]?.families || [],
          joinedAt: tsToMs(m.joinedAt),
        })),
        queue: queue.map((q) => ({
          userId: q.userId,
          discord: q.username,
          position: q.position,
          roblox: profile[q.userId]?.robloxUsername || '',
          families: profile[q.userId]?.families || [],
          joinedAt: tsToMs(q.joinedAt),
        })),
      });
    } catch (e) {
      console.error('[web] /api/data:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Accept a specific user from the queue (assign role, record member) ──
  app.post('/api/accept', async (req, res) => {
    try {
      const { userId } = req.body;
      const member = await fetchMember(userId);
      if (!member) return res.status(404).json({ error: 'User is no longer in the server' });
      await assignRegimentRole(member);
      await fb.removeFromQueue(userId);
      await fb.addMember(userId, member.user.tag);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Reject (remove) a user from the queue ──
  app.post('/api/reject', async (req, res) => {
    try {
      await fb.removeFromQueue(req.body.userId);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Kick a member from the regiment ──
  app.post('/api/kick', async (req, res) => {
    try {
      const { userId } = req.body;
      const member = await fetchMember(userId);
      if (member) await removeRegimentRole(member).catch(() => {});
      await fb.removeMember(userId);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Add a member: by userId, or resolve by exact Discord username ──
  app.post('/api/add', async (req, res) => {
    try {
      let { userId, username, roblox } = req.body;
      let member = userId ? await fetchMember(userId) : null;

      if (!member && username) {
        const matches = await guild().members.fetch({ query: username, limit: 10 });
        member = matches.find(
          (m) => m.user.username.toLowerCase() === username.toLowerCase() ||
                 m.displayName.toLowerCase() === username.toLowerCase()
        ) || (matches.size === 1 ? matches.first() : null);
      }
      if (!member) return res.status(404).json({ error: 'Could not find that user in the server' });

      await assignRegimentRole(member);
      if (await fb.isInQueue(member.id)) await fb.removeFromQueue(member.id);
      if (!(await fb.isMember(member.id))) await fb.addMember(member.id, member.user.tag);
      if (roblox) await fb.saveUserProfile(member.id, { discordId: member.id, discordTag: member.user.tag, robloxUsername: roblox });
      res.json({ ok: true, tag: member.user.tag });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Update a member's saved profile (e.g. Roblox username) ──
  app.post('/api/update', async (req, res) => {
    try {
      const { userId, roblox } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      await fb.saveUserProfile(userId, { ...(roblox ? { robloxUsername: roblox } : {}) });
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Promote the next person in the queue ──
  app.post('/api/promote', async (req, res) => {
    try {
      await promoteFromQueue(guild());
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Change max slots (auto-promotes if increased) ──
  app.post('/api/setslots', async (req, res) => {
    try {
      const newMax = parseInt(req.body.slots, 10);
      if (!Number.isInteger(newMax) || newMax < 0) return res.status(400).json({ error: 'invalid slots' });
      await fb.setMaxSlots(newMax);
      const status = await fb.getRegimentStatus();
      const toFill = newMax - status.currentCount;
      for (let i = 0; i < toFill; i++) await promoteFromQueue(guild());
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.listen(port, () => console.log(`🌐 Dashboard running on port ${port}`));
}

module.exports = { startWebServer };
