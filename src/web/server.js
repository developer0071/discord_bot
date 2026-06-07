const path = require('path');
const express = require('express');

const fb = require('../utils/firebase');
const auth = require('./auth');
const { canAccessDashboard } = require('../utils/permissions');
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

  // Only redirect back to known origins after login (prevents open redirects).
  function safeRedirect(redirect) {
    const allowed = new Set();
    if (process.env.DASHBOARD_ORIGIN) allowed.add(process.env.DASHBOARD_ORIGIN.replace(/\/+$/, ''));
    try { allowed.add(new URL(process.env.DISCORD_OAUTH_REDIRECT).origin); } catch { /* ignore */ }
    try { const u = new URL(redirect); if (allowed.has(u.origin)) return redirect.split('#')[0]; } catch { /* ignore */ }
    return process.env.DASHBOARD_ORIGIN || '/';
  }

  // Minimal HTML page for auth outcomes shown directly in the browser.
  function authMessagePage(title, message) {
    return `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
      `<div style="font-family:system-ui,sans-serif;background:#0b0b0f;color:#f5f5f7;height:100vh;display:flex;align-items:center;justify-content:center;text-align:center">` +
      `<div style="max-width:360px;padding:32px"><h1 style="font-size:22px">${title}</h1>` +
      `<p style="opacity:.7">${message}</p>` +
      `<p><a href="${process.env.DASHBOARD_ORIGIN || '/'}" style="color:#7aa2ff">Back to dashboard</a></p></div></div>`;
  }

  // ── Public: the dashboard UI (login happens client-side; data needs auth) ──
  app.get('/', (req, res) => res.sendFile(path.join(rootDir, 'index.html')));
  app.get('/app-api.js', (req, res) => res.sendFile(path.join(rootDir, 'app-api.js')));
  app.get('/logo.png', (req, res) => res.sendFile(path.join(rootDir, 'logo.png')));

  // Write an audit-log entry (best-effort, never blocks an action).
  const log = (action, target, detail) => fb.addLog(action, target, detail).catch(() => {});

  // ── Auth: "Login with Discord" → signed session token ──
  // Only guild members holding a REGIMENT_MANAGE_ROLE_IDS role may sign in.
  app.get('/auth/discord/login', (req, res) => {
    if (!auth.isConfigured()) return res.status(503).send('Dashboard auth is not configured on the server.');
    const redirect = typeof req.query.redirect === 'string' ? req.query.redirect : '';
    res.redirect(auth.authorizeUrl(auth.makeState(redirect)));
  });

  app.get('/auth/discord/callback', async (req, res) => {
    if (!auth.isConfigured()) return res.status(503).send('Dashboard auth is not configured on the server.');
    try {
      const { code, state } = req.query;
      const st = auth.readState(state);
      if (!code || !st) return res.status(400).send(authMessagePage('Login failed', 'The login link expired or was invalid — please try again.'));

      const tok = await auth.exchangeCode(code);
      const discordUser = await auth.fetchDiscordUser(tok.access_token);

      const member = await fetchMember(discordUser.id);
      if (!member || !canAccessDashboard(member)) {
        return res.status(403).send(authMessagePage('Access denied', "Your Discord account isn't in the server or doesn't have a dashboard-access role."));
      }

      const session = auth.makeSession({ id: discordUser.id, tag: member.user.tag });
      log('DASHBOARD_LOGIN', member.user.tag, 'Signed in to the dashboard');
      res.redirect(`${safeRedirect(st.redirect)}#token=${encodeURIComponent(session)}`);
    } catch (e) {
      console.error('[web] auth callback:', e);
      res.status(500).send(authMessagePage('Login failed', 'Something went wrong during sign-in — please try again.'));
    }
  });

  // Everything under /api requires a valid session token from here on.
  app.use('/api', auth.requireAuth);

  // ── Data ──
  app.get('/api/data', async (req, res) => {
    try {
      const [status, members, queue, users, logs, settings] = await Promise.all([
        fb.getRegimentStatus(), fb.getAllMembers(), fb.getFullQueue(),
        fb.getAllUsers(), fb.getLogs(50), fb.getDashboardSettings(),
      ]);
      const profile = Object.fromEntries(users.map((u) => [u.discordId || u.userId, u]));
      res.json({
        status,
        settings,
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
        logs: logs.map((l) => ({ action: l.action, target: l.target, detail: l.detail, at: tsToMs(l.at) })),
        feedback: users
          .filter((u) => u.feedback)
          .map((u) => ({ author: u.discordTag || u.discordId, text: u.feedback, date: tsToMs(u.verifiedAt) || Date.now() })),
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
      log('QUEUE_ACCEPTED', member.user.tag, 'Accepted from queue');
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Reject (remove) a user from the queue ──
  app.post('/api/reject', async (req, res) => {
    try {
      const member = await fetchMember(req.body.userId);
      await fb.removeFromQueue(req.body.userId);
      log('QUEUE_REJECTED', member?.user.tag || req.body.userId, 'Removed from queue');
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
      log('MEMBER_KICKED', member?.user.tag || userId, 'Removed from regiment');
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
      log('MEMBER_ADDED', member.user.tag, 'Added to regiment');
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
      log('QUEUE_ACCEPTED', 'Next in queue', 'Promoted next from queue');
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Change max slots (auto-promotes if increased) ──
  app.post('/api/setslots', async (req, res) => {
    try {
      const newMax = parseInt(req.body.slots, 10);
      if (!Number.isInteger(newMax) || newMax < 0) return res.status(400).json({ error: 'invalid slots' });
      await fb.getRegimentStatus(); // ensure config doc exists
      await fb.setMaxSlots(newMax);
      const status = await fb.getRegimentStatus();
      const toFill = newMax - status.currentCount;
      for (let i = 0; i < toFill; i++) await promoteFromQueue(guild());
      log('SETTINGS_CHANGED', 'System', `Max slots set to ${newMax}`);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Save dashboard settings (max size + cosmetic prefs) ──
  app.post('/api/settings', async (req, res) => {
    try {
      const { name, maxSize, autoAccept, kickReason } = req.body;
      const max = parseInt(maxSize, 10);
      if (Number.isInteger(max) && max >= 0) {
        await fb.getRegimentStatus();
        await fb.setMaxSlots(max);
        const status = await fb.getRegimentStatus();
        const toFill = max - status.currentCount;
        for (let i = 0; i < toFill; i++) await promoteFromQueue(guild());
      }
      await fb.saveDashboardSettings({
        name: name || '',
        autoAccept: autoAccept || '',
        kickReason: kickReason || '',
      });
      log('SETTINGS_CHANGED', 'System', 'Dashboard settings updated');
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.listen(port, () => {
    console.log(`🌐 Dashboard running on port ${port}`);
    if (!auth.isConfigured()) {
      console.warn(
        `⚠️  Dashboard auth is DISABLED — /api routes will reject every request until you set: ${auth.missingVars().join(', ')}`
      );
    }
  });
}

module.exports = { startWebServer };
