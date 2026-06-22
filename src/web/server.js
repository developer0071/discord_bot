const path = require('path');
const express = require('express');

const fb = require('../utils/firebase');
const auth = require('./auth');
const { canAccessDashboard, canManage, getDashboardTier, isModSide, canManageGiveaways } = require('../utils/permissions');
const { assignRegimentRole, removeRegimentRole } = require('../utils/helpers');
const { promoteFromQueue } = require('../events/guildMemberRemove');
const giveawayUtil = require('../utils/giveaway');
const { RateLimiter } = require('../utils/ratelimit');
const cache = require('../leveling/cache');

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

  // ── Body size limit (prevent oversized payloads) ──
  app.use(express.json({ limit: '50kb' }));

  // CORS — lets the Vercel-hosted frontend call this API. Auth is via Bearer
  // password (not cookies), so a wildcard origin is safe. Lock it down with
  // DASHBOARD_ORIGIN=https://your-site.vercel.app if you prefer.
  app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', process.env.DASHBOARD_ORIGIN || '*');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
  });

  // ── HTTP rate limiting (per IP) ──
  const apiReadLimiter  = new RateLimiter(30, 60_000); // 30 reads per minute
  const apiWriteLimiter = new RateLimiter(10, 60_000); // 10 writes per minute

  function getClientIp(req) {
    return req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip || 'unknown';
  }

  // Rate-limit middleware for read endpoints
  function rlRead(req, res, next) {
    const ip = getClientIp(req);
    if (apiReadLimiter.isLimited(ip)) {
      const retry = apiReadLimiter.retryAfterSec(ip);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests — slow down', retryAfter: retry });
    }
    next();
  }

  // Rate-limit middleware for write/mutation endpoints
  function rlWrite(req, res, next) {
    const ip = getClientIp(req);
    if (apiWriteLimiter.isLimited(ip)) {
      const retry = apiWriteLimiter.retryAfterSec(ip);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'Too many requests — slow down', retryAfter: retry });
    }
    next();
  }

  // ── Concurrent request guard (prevents Firestore overload from stacked requests) ──
  let activeRequests = 0;
  const MAX_CONCURRENT = 10;

  function concurrencyGuard(req, res, next) {
    if (activeRequests >= MAX_CONCURRENT) {
      return res.status(503).json({ error: 'Server is busy — try again in a moment' });
    }
    activeRequests++;
    let counted = true;
    const done = () => { if (counted) { counted = false; activeRequests = Math.max(0, activeRequests - 1); } };
    res.on('finish', done);
    res.on('close', done);
    next();
  }

  // Apply concurrency guard and read rate-limit to all /api routes
  app.use('/api', concurrencyGuard);

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
    allowed.add('https://speak.hunterstar.online');
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

  // Serve built static assets from the dashboard
  app.use(express.static(path.join(rootDir, 'dashboard', 'dist')));
  app.use('/family', express.static(path.join(rootDir, 'family')));
  app.use('/logo.png', express.static(path.join(rootDir, 'logo.png')));
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

      const tier = getDashboardTier(member);
      const session = auth.makeSession({ id: discordUser.id, tag: member.user.tag, tier });
      log('DASHBOARD_LOGIN', member.user.tag, `Signed in to the dashboard (${tier})`);
      res.redirect(`${safeRedirect(st.redirect)}#token=${encodeURIComponent(session)}`);
    } catch (e) {
      console.error('[web] auth callback:', e);
      res.status(500).send(authMessagePage('Login failed', 'Something went wrong during sign-in — please try again.'));
    }
  });

  // ── Public giveaway info (no auth) ──
  app.get('/api/giveaways/:id/public', async (req, res) => {
    try {
      const g = await fb.getGiveaway(req.params.id);
      if (!g) return res.status(404).json({ error: 'Giveaway not found' });
      res.json({
        id: g.id,
        title: g.title,
        prize: g.prize || '',
        status: g.status,
        entryCount: giveawayUtil.entrantCount(g),
        winnerCount: g.winnerCount || 1,
        startsAt: tsToMs(g.startsAt),
        endsAt: tsToMs(g.endsAt),
        hostTag: g.hostTag || '',
        winners: (g.winners || []).map((w) => ({ userId: w.userId, tag: w.tag })),
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Public giveaway page (shareable link, like dyno.gg/giveaway/xxx)
  app.get('/giveaway/:id', (req, res) => {
    const apiBase = process.env.DASHBOARD_ORIGIN || '';
    const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Giveaway</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;600;700&display=swap" rel="stylesheet">
<style>
*{margin:0;padding:0;box-sizing:border-box}body{font-family:'Space Grotesk',system-ui,sans-serif;background:#0a0708;color:#f1e9ea;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
.card{max-width:520px;width:100%;background:#161011;border:1px solid #34262a;border-radius:16px;padding:32px;text-align:center}
h1{font-size:24px;margin-bottom:8px;color:#e0303c}
.prize{color:#b29aa0;margin-bottom:24px;line-height:1.6;font-size:14px}
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-bottom:24px}
.stat{background:#1c1515;border-radius:10px;padding:16px 8px}
.stat .num{font-size:22px;font-weight:700;color:#f1e9ea}
.stat .lbl{font-size:11px;color:#7c666a;text-transform:uppercase;margin-top:4px}
.timer{font-size:28px;font-weight:700;font-variant-numeric:tabular-nums;color:#e0303c;margin-bottom:20px}
.btn{display:inline-block;padding:12px 28px;border-radius:10px;border:none;font-size:15px;font-weight:600;cursor:pointer;text-decoration:none;margin:4px}
.btn-primary{background:#e0303c;color:#fff}.btn-discord{background:#5865F2;color:#fff}
.winners{color:#2ed573;font-size:16px;font-weight:600;margin:16px 0}
.host{font-size:12px;color:#7c666a;margin-top:16px}
.share{margin-top:20px;padding-top:20px;border-top:1px solid #34262a}
.share input{width:100%;padding:10px;background:#1c1515;border:1px solid #34262a;border-radius:8px;color:#b29aa0;font-size:13px;margin-bottom:8px}
.msg{padding:12px;border-radius:8px;font-size:13px;margin-bottom:12px;display:none}
.msg.ok{display:block;background:rgba(46,213,115,.12);color:#2ed573}
.msg.err{display:block;background:rgba(255,71,87,.12);color:#ff4757}
</style></head><body>
<div class="card" id="card"><p style="color:#7c666a">Loading giveaway…</p></div>
<script>
const ID='${req.params.id}';
const API=location.origin;
const TOKEN=localStorage.getItem('dash_token')||'';
function pad(n){return String(n).padStart(2,'0')}
function fmt(ms){if(ms<=0)return'00:00:00:00';const s=Math.floor(ms/1000);const d=Math.floor(s/86400);const h=Math.floor((s%86400)/3600);const m=Math.floor((s%3600)/60);const sec=s%60;return pad(d)+':'+pad(h)+':'+pad(m)+':'+pad(sec)}
let endsAt=0,timerId;
async function load(){
  const r=await fetch(API+'/api/giveaways/'+ID+'/public');
  if(!r.ok){document.getElementById('card').innerHTML='<p style="color:#ff4757">Giveaway not found.</p>';return}
  const g=await r.json();endsAt=g.endsAt||0;
  const active=g.status==='active'||g.status==='scheduled';
  document.getElementById('card').innerHTML=
    '<h1>'+g.title+'</h1>'+
    (g.prize?'<p class="prize">'+g.prize.replace(/</g,'&lt;')+'</p>':'')+
    '<div class="stats"><div class="stat"><div class="num" id="entryNum">'+g.entryCount+'</div><div class="lbl">Entries</div></div>'+
    '<div class="stat"><div class="num">'+g.winnerCount+'</div><div class="lbl">Winners</div></div>'+
    '<div class="stat"><div class="num" id="myEntries">—</div><div class="lbl">Your Entries</div></div></div>'+
    (active?'<div class="timer" id="timer">'+fmt(endsAt-Date.now())+'</div><div class="lbl" style="margin-bottom:16px">Time Left</div>':'')+
    (g.status==='ended'&&g.winners.length?'<div class="winners">🏆 '+g.winners.map(w=>w.tag).join(', ')+'</div>':'')+
    (g.status==='ended'&&!g.winners.length?'<div class="winners">No winners</div>':'')+
    '<div id="msg" class="msg"></div>'+
    (active?'<button class="btn btn-primary" id="enterBtn" onclick="enterGiveaway()">Enter Giveaway</button> ':'')+
    '<a class="btn btn-discord" href="https://discord.com/channels/@me" target="_blank">Open Discord</a>'+
    (g.hostTag?'<p class="host">Hosted by '+g.hostTag+'</p>':'')+
    '<div class="share"><p style="font-size:12px;color:#7c666a;margin-bottom:8px">Share this giveaway</p>'+
    '<input readonly value="'+location.href+'" onclick="this.select();navigator.clipboard.writeText(this.value)"></div>';
  if(active){timerId=setInterval(()=>{const el=document.getElementById('timer');if(el)el.textContent=fmt(endsAt-Date.now())},1000)}
  if(TOKEN)checkEntry();
}
async function checkEntry(){
  try{const r=await fetch(API+'/api/giveaways/'+ID+'/me',{headers:{Authorization:'Bearer '+TOKEN}});
  if(r.ok){const d=await r.json();document.getElementById('myEntries').textContent=d.entered?'1':'0';}}catch(e){}
}
async function enterGiveaway(){
  if(!TOKEN){location.href=API+'/auth/discord/login?redirect='+encodeURIComponent(location.href);return}
  const msg=document.getElementById('msg');msg.className='msg';msg.textContent='';
  try{const r=await fetch(API+'/api/giveaways/'+ID+'/enter',{method:'POST',headers:{Authorization:'Bearer '+TOKEN,'Content-Type':'application/json'}});
  const d=await r.json();if(!r.ok)throw new Error(d.error||'Failed');
  msg.className='msg ok';msg.textContent='Giveaway entered!';document.getElementById('myEntries').textContent='1';
  const n=document.getElementById('entryNum');if(n)n.textContent=String(parseInt(n.textContent,10)+1);
  }catch(e){msg.className='msg err';msg.textContent=e.message}
}
load();
</script></body></html>`;
    res.send(page);
  });

  // Everything under /api requires a valid session token from here on.
  app.use('/api', auth.requireAuth);

  // Full dashboard access (mods) — blocks read-only viewers from mutations.
  async function requireModSide(req, res, next) {
    if (req.user.tier === 'mod') return next();
    const member = await fetchMember(req.user.id);
    if (member && isModSide(member)) {
      req.user.tier = 'mod';
      return next();
    }
    return res.status(403).json({ error: 'You need moderator permissions for this action' });
  }

  // Managers only (create / end / delete giveaways).
  async function requireManage(req, res, next) {
    const member = await fetchMember(req.user.id);
    if (!member || !canManage(member)) {
      return res.status(403).json({ error: 'You need manage permissions for this action' });
    }
    req.member = member;
    next();
  }

  // Giveaway dashboard access (managers, mods, or generous role)
  async function requireGiveawayMod(req, res, next) {
    const member = await fetchMember(req.user.id);
    if (!member) return res.status(403).json({ error: 'User not found in server' });
    if (req.user.tier === 'mod' || isModSide(member) || canManageGiveaways(member) || canManage(member)) {
      req.member = member;
      return next();
    }
    return res.status(403).json({ error: 'You need giveaway permissions for this action' });
  }

  // ── Data (with server-side cache to reduce Firestore reads) ──
  let dataCache = null;
  let dataCacheTime = 0;
  const DATA_CACHE_TTL = 60_000; // 60 seconds

  async function refreshUserTier(req, res) {
    const member = await fetchMember(req.user.id);
    const tier = member ? getDashboardTier(member) : null;
    if (!tier) {
      res.status(403).json({ error: 'Your dashboard access was revoked' });
      return null;
    }
    req.user.tier = tier;
    req.user.member = member;
    return tier;
  }

  app.get('/api/me', rlRead, async (req, res) => {
    const tier = await refreshUserTier(req, res);
    if (!tier) return;
    const canGv = canManageGiveaways(req.user.member);
    res.json({ id: req.user.id, tag: req.user.tag, tier, canManageGiveaways: canGv });
  });

  app.get('/api/families', rlRead, async (req, res) => {
    try {
      const familyConfig = require('../config/families');
      const profile = await fb.getUserProfile(req.user.id);
      res.json({
        options: familyConfig.options,
        current: profile?.families || []
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  app.post('/api/families', rlWrite, async (req, res) => {
    try {
      const { families: newFamilies } = req.body;
      if (!Array.isArray(newFamilies)) return res.status(400).json({ error: 'families must be an array' });

      const familyConfig = require('../config/families');
      const validValues = familyConfig.options.map(f => f.value);
      const validSelection = newFamilies.filter(v => validValues.includes(v));

      const member = await fetchMember(req.user.id);
      if (!member) return res.status(404).json({ error: 'You are not in the server' });

      const rolesToAdd = validSelection
        .map(v => familyConfig.options.find(o => o.value === v)?.roleId)
        .filter(Boolean);
      
      const allFamilyRoles = familyConfig.options.map(o => o.roleId);
      const rolesToRemove = allFamilyRoles.filter(r => !rolesToAdd.includes(r));

      if (rolesToRemove.length) await member.roles.remove(rolesToRemove).catch(() => {});
      if (rolesToAdd.length) await member.roles.add(rolesToAdd).catch(() => {});

      await fb.saveUserProfile(req.user.id, { families: validSelection });
      log('FAMILY_UPDATED', req.user.tag, `Updated families to: ${validSelection.join(', ') || 'none'}`);

      res.json({ ok: true, families: validSelection });
    } catch (e) {
      console.error('[web] family update error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  app.get('/api/data', rlRead, async (req, res) => {
    try {
      const tier = await refreshUserTier(req, res);
      if (!tier) return;
      const isReadOnly = tier !== 'mod';
      const now = Date.now();
      const canGv = canManageGiveaways(req.user.member);

      if (!isReadOnly && dataCache && (now - dataCacheTime) < DATA_CACHE_TTL) {
        return res.json({ ...dataCache, tier: 'mod', canManageGiveaways: canGv });
      }

      const [status, members, queue, users, logs, settings] = await Promise.all([
        fb.getRegimentStatus(), fb.getAllMembers(), fb.getFullQueue(),
        isReadOnly ? Promise.resolve([]) : fb.getAllUsers(),
        isReadOnly ? Promise.resolve([]) : fb.getLogs(50),
        isReadOnly ? Promise.resolve({}) : fb.getDashboardSettings(),
      ]);
      const profile = Object.fromEntries(users.map((u) => [u.discordId || u.userId, u]));
      const result = {
        status,
        settings: isReadOnly ? {} : settings,
        members: members.map((m) => {
          const userData = cache.getUser(m.userId) || {};
          return {
            userId: m.userId,
            discord: m.username,
            roblox: profile[m.userId]?.robloxUsername || '',
            families: profile[m.userId]?.families || [],
            status: profile[m.userId]?.status || 'active',
            joinedAt: tsToMs(m.joinedAt),
            xp: userData.xp || 0,
            level: userData.level || 0,
          };
        }),
        queue: queue.map((q) => ({
          userId: q.userId,
          discord: q.username,
          position: q.position,
          roblox: profile[q.userId]?.robloxUsername || '',
          families: profile[q.userId]?.families || [],
          joinedAt: tsToMs(q.joinedAt),
        })),
        leveling: await (async () => {
          try {
            const g = guild();
            if (!g) return [];
            // Fetch all guild members (force cache refresh)
            await g.members.fetch();
            const cadetRoleId = process.env.REGIMENT_ROLE_ID;      // 1512684275714097263
            const recruitRoleId = process.env.RECRUIT_ROLE_ID;     // 1512943823154581635
            const allMembers = g.members.cache.filter(m =>
              !m.user.bot &&
              (m.roles.cache.has(cadetRoleId) || m.roles.cache.has(recruitRoleId))
            );
            return allMembers.map(m => {
              const userData = cache.getUser(m.id) || {};
              return {
                userId: m.id,
                discord: m.user.username,
                displayName: m.displayName,
                roblox: profile[m.id]?.robloxUsername || '',
                xp: userData.xp || 0,
                level: userData.level || 0,
              };
            });
          } catch (e) {
            console.error('[web] leveling guild fetch error:', e);
            return [];
          }
        })(),
        logs: isReadOnly ? [] : logs.map((l) => ({ action: l.action, target: l.target, detail: l.detail, at: tsToMs(l.at) })),
        feedback: isReadOnly ? [] : users
          .filter((u) => u.feedback)
          .map((u) => ({ author: u.discordTag || u.discordId, text: u.feedback, date: tsToMs(u.verifiedAt) || Date.now() })),
        tier: isReadOnly ? 'readonly' : 'mod',
        canManageGiveaways: canGv,
      };

      if (!isReadOnly) {
        dataCache = result;
        dataCacheTime = now;
      }
      result.canManageGiveaways = canGv;
      res.json(result);
    } catch (e) {
      console.error('[web] /api/data:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Leveling Management (Boost, Set Level, Reset) ──
  app.post('/api/leveling', requireModSide, rlWrite, async (req, res) => {
    try {
      const { userId, action, amount } = req.body;
      if (!userId || !action) return res.status(400).json({ error: 'Missing userId or action' });
      
      const { sendLevelUpAnnouncement } = require('../leveling/levelUp');
      const { getLevelFromXp, getXpForLevel } = require('../leveling/xp');
      const metrics = require('../leveling/metrics');
      
      const userData = cache.getUser(userId) || { xp: 0, level: 0 };
      let newXp = userData.xp;
      let newLevel = userData.level;
      
      const val = parseInt(amount, 10);
      
      if (action === 'add_xp') {
        if (isNaN(val) || val <= 0) return res.status(400).json({ error: 'Invalid amount' });
        newXp += val;
        newLevel = getLevelFromXp(newXp);
      } else if (action === 'set_xp') {
        if (isNaN(val) || val < 0) return res.status(400).json({ error: 'Invalid amount' });
        newXp = val;
        newLevel = getLevelFromXp(newXp);
      } else if (action === 'set_level') {
        if (isNaN(val) || val < 0) return res.status(400).json({ error: 'Invalid level' });
        newLevel = val;
        newXp = getXpForLevel(newLevel);
      } else if (action === 'reset') {
        newXp = 0;
        newLevel = 0;
      } else {
        return res.status(400).json({ error: 'Unknown action' });
      }
      
      const oldLevel = userData.level;
      
      // Update cache
      cache.setUser(userId, { xp: newXp, level: newLevel });
      
      // Log it
      await log('LEVELING_MODIFIED', req.user.tag, `Action: ${action}, UserId: ${userId}, NewXP: ${newXp}, NewLevel: ${newLevel}`);
      
      // If level changed, trigger level up role assignment and announcement
      if (newLevel !== oldLevel) {
        // Construct mock context for levelUp.js
        const context = {
          client,
          cache,
          firebase: require('../leveling/firebaseXP'),
          metrics
        };
        await sendLevelUpAnnouncement(context, userId, oldLevel, newLevel, guild().id);
      }
      
      res.json({ ok: true, xp: newXp, level: newLevel });
    } catch (e) {
      console.error('[web] /api/leveling error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Accept a specific user from the queue (assign role, record member) ──
  app.post('/api/accept', requireModSide, rlWrite, async (req, res) => {
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
  app.post('/api/reject', requireModSide, rlWrite, async (req, res) => {
    try {
      const member = await fetchMember(req.body.userId);
      await fb.removeFromQueue(req.body.userId);
      log('QUEUE_REJECTED', member?.user.tag || req.body.userId, 'Removed from queue');
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Kick a member from the regiment ──
  app.post('/api/kick', requireModSide, rlWrite, async (req, res) => {
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
  app.post('/api/add', requireModSide, rlWrite, async (req, res) => {
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

  // ── Update a member's saved profile (e.g. Roblox username, status) ──
  app.post('/api/update', requireModSide, rlWrite, async (req, res) => {
    try {
      const { userId, roblox, status } = req.body;
      if (!userId) return res.status(400).json({ error: 'userId required' });
      const updates = {};
      if (roblox !== undefined) updates.robloxUsername = roblox;
      if (status !== undefined) updates.status = status;
      await fb.saveUserProfile(userId, updates);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Bulk update status ──
  app.post('/api/bulk-update', requireModSide, rlWrite, async (req, res) => {
    try {
      const { userIds, status } = req.body;
      if (!userIds || !Array.isArray(userIds)) return res.status(400).json({ error: 'userIds array required' });
      const updates = { status };
      for (const userId of userIds) {
        await fb.saveUserProfile(userId, updates);
      }
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Sync members with Discord ──
  app.post('/api/sync', requireModSide, rlWrite, async (req, res) => {
    try {
      const g = guild();
      if (!g) return res.status(500).json({ error: 'Guild not found' });
      await g.members.fetch(); // Load all members into cache

      const roleId = process.env.REGIMENT_ROLE_ID;
      const validDiscordMembers = g.members.cache.filter(m => m.roles.cache.has(roleId));

      const dbMembers = await fb.getAllMembers();
      let added = 0, removed = 0;

      // Remove DB members not in Discord (or missing the role)
      for (const dbM of dbMembers) {
        if (!validDiscordMembers.has(dbM.userId)) {
          await fb.removeMember(dbM.userId);
          removed++;
        }
      }

      // Add missing Discord members to DB
      for (const [id, member] of validDiscordMembers) {
        if (!dbMembers.find(m => m.userId === id)) {
          await fb.addMember(id, member.user.tag);
          added++;
        }
      }

      const newCount = await fb.syncRegimentCount();
      log('MEMBERS_SYNCED', req.user.tag, `Synced members: added ${added}, removed ${removed}, total ${newCount}`);
      res.json({ ok: true, added, removed, total: newCount });
    } catch (e) {
      console.error('[web] /api/sync error:', e);
      res.status(500).json({ error: e.message });
    }
  });

  // ── Promote the next person in the queue ──
  app.post('/api/promote', requireModSide, rlWrite, async (req, res) => {
    try {
      await promoteFromQueue(guild());
      log('QUEUE_ACCEPTED', 'Next in queue', 'Promoted next from queue');
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Change max slots (auto-promotes if increased) ──
  app.post('/api/setslots', requireModSide, rlWrite, async (req, res) => {
    try {
      const newMax = parseInt(req.body.slots, 10);
      if (!Number.isInteger(newMax) || newMax < 0 || newMax > 500) return res.status(400).json({ error: 'invalid slots (0-500)' });
      await fb.getRegimentStatus(); // ensure config doc exists
      await fb.setMaxSlots(newMax);
      const status = await fb.getRegimentStatus();
      const toFill = Math.min(newMax - status.currentCount, 50); // cap at 50 promotions per call
      for (let i = 0; i < toFill; i++) await promoteFromQueue(guild());
      log('SETTINGS_CHANGED', 'System', `Max slots set to ${newMax}`);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Chat (Mod Side) ──
  app.get('/api/chat/channels', requireModSide, rlRead, async (req, res) => {
    try {
      const g = guild();
      if (!g) return res.json({ channels: [] });
      const channels = g.channels.cache
        .filter((c) => c.isTextBased() && !c.isThread())
        .map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name || null }))
        .sort((a, b) => a.name.localeCompare(b.name));
      res.json({ channels });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/chat/send', requireModSide, rlWrite, async (req, res) => {
    try {
      const { channelId, content } = req.body;
      if (!channelId || !content || typeof content !== 'string') {
        return res.status(400).json({ error: 'Channel ID and content are required' });
      }
      const g = guild();
      if (!g) return res.status(500).json({ error: 'Guild not found' });
      const channel = g.channels.cache.get(channelId);
      if (!channel || !channel.isTextBased()) {
        return res.status(404).json({ error: 'Text channel not found' });
      }
      await channel.send({ content: content.slice(0, 2000) });
      res.json({ success: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // ── Giveaways (dashboard-only management) ──
  app.get('/api/channels', requireGiveawayMod, rlRead, async (req, res) => {
    try {
      const g = guild();
      if (!g) return res.json({ channels: [] });
      const channels = g.channels.cache
        .filter((c) => c.isTextBased() && !c.isThread())
        .map((c) => ({ id: c.id, name: c.name, parent: c.parent?.name || null }))
        .sort((a, b) => a.name.localeCompare(b.name));
      const defaultChannelId = process.env.GIVEAWAYS_CHANNEL?.trim() || '';
      res.json({ channels, defaultChannelId });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/giveaways', requireGiveawayMod, rlRead, async (req, res) => {
    try {
      const list = await fb.getAllGiveaways();
      res.json({
        giveaways: list.map((g) => ({
          id: g.id,
          title: g.title,
          prize: g.prize || '',
          status: g.status,
          entryCount: giveawayUtil.entrantCount(g),
          winnerCount: g.winnerCount || 1,
          channelId: g.channelId || '',
          messageId: g.messageId || '',
          hostId: g.hostId || '',
          hostTag: g.hostTag || '',
          startsAt: tsToMs(g.startsAt),
          endsAt: tsToMs(g.endsAt),
          winners: g.winners || [],
          requiredRoleIds: g.requiredRoleIds || [],
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/giveaways/:id/me', rlRead, async (req, res) => {
    try {
      const entered = await fb.isGiveawayEntrant(req.params.id, req.user.id);
      res.json({ entered });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.get('/api/giveaways/:id', requireGiveawayMod, rlRead, async (req, res) => {
    try {
      const g = await fb.getGiveaway(req.params.id);
      if (!g) return res.status(404).json({ error: 'Giveaway not found' });
      res.json({
        ...g,
        entryCount: giveawayUtil.entrantCount(g),
        startsAt: tsToMs(g.startsAt),
        endsAt: tsToMs(g.endsAt),
        entrants: Object.entries(g.entrants || {}).map(([userId, e]) => ({
          userId, tag: e.tag, enteredAt: tsToMs(e.enteredAt),
        })),
      });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/giveaways/:id/enter', rlWrite, async (req, res) => {
    try {
      const member = await fetchMember(req.user.id);
      if (!member) return res.status(403).json({ error: 'You must be in the server to enter' });

      const g = await fb.getGiveaway(req.params.id);
      if (!g || g.status !== 'active') return res.status(400).json({ error: 'Giveaway is not active' });

      const endMs = giveawayUtil.endsAtMs(g);
      if (endMs && Date.now() >= endMs) return res.status(400).json({ error: 'Giveaway has ended' });

      const requiredRoles = g.requiredRoleIds || [];
      if (requiredRoles.length && !requiredRoles.some((id) => member.roles.cache.has(id))) {
        return res.status(403).json({ error: "You don't have the required role" });
      }

      if (await fb.isGiveawayEntrant(req.params.id, req.user.id)) {
        return res.status(400).json({ error: 'Already entered' });
      }

      await fb.addGiveawayEntrant(req.params.id, req.user.id, member.user.tag);
      const updated = await fb.getGiveaway(req.params.id);
      await giveawayUtil.refreshMessage(client, updated);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/giveaways/:id/leave', rlWrite, async (req, res) => {
    try {
      const g = await fb.getGiveaway(req.params.id);
      if (!g || g.status !== 'active') return res.status(400).json({ error: 'Giveaway is not active' });
      if (!(await fb.isGiveawayEntrant(req.params.id, req.user.id))) {
        return res.status(400).json({ error: 'Not entered' });
      }
      await fb.removeGiveawayEntrant(req.params.id, req.user.id);
      const updated = await fb.getGiveaway(req.params.id);
      await giveawayUtil.refreshMessage(client, updated);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/giveaways', requireGiveawayMod, async (req, res) => {
    try {
      const { title, prize, startsAt, endsAt, winnerCount, channelId, requiredRoleIds } = req.body;
      if (!title?.trim()) return res.status(400).json({ error: 'Title is required' });

      const endMs = endsAt ? new Date(endsAt).getTime() : null;
      if (!endMs || endMs <= Date.now()) return res.status(400).json({ error: 'End time must be in the future' });

      const winners = parseInt(winnerCount, 10) || 1;
      if (winners < 1) return res.status(400).json({ error: 'At least 1 winner required' });

      const ch = channelId?.trim() || process.env.GIVEAWAYS_CHANNEL?.trim();
      if (!ch) return res.status(400).json({ error: 'No giveaway channel selected' });

      const id = giveawayUtil.generateId();

      const data = {
        title: title.trim(),
        prize: (prize || '').trim(),
        startsAt: new Date(),
        endsAt: new Date(endMs),
        winnerCount: winners,
        channelId: ch,
        hostId: req.user.id,
        hostTag: req.user.tag,
        status: 'active', // always post immediately
        requiredRoleIds: Array.isArray(requiredRoleIds) ? requiredRoleIds : [],
      };

      await fb.createGiveaway(id, data);
      // Always post to Discord immediately so users can see and enter
      await giveawayUtil.postGiveaway(client, { id, ...data });

      log('GIVEAWAY_CREATED', req.user.tag, `Created "${title.trim()}" (${id})`);
      res.json({ ok: true, id });
    } catch (e) {
      console.error('[web] create giveaway:', e);
      res.status(400).json({ error: e.message });
    }
  });

  app.post('/api/giveaways/:id/end', requireGiveawayMod, async (req, res) => {
    try {
      const result = await giveawayUtil.endGiveaway(client, req.params.id);
      if (!result) return res.status(404).json({ error: 'Giveaway not found or already ended' });
      log('GIVEAWAY_ENDED', req.user.tag, `Ended giveaway ${req.params.id}`);
      res.json({ ok: true, winners: result.winners });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.post('/api/giveaways/:id/reroll', requireGiveawayMod, async (req, res) => {
    try {
      const g = await fb.getGiveaway(req.params.id);
      if (!g || g.status !== 'ended') return res.status(400).json({ error: 'Giveaway must be ended to reroll' });

      const entrantIds = Object.keys(g.entrants || {});
      const winnerIds = giveawayUtil.pickWinners(entrantIds, g.winnerCount || 1);
      const winners = winnerIds.map((userId) => ({
        userId,
        tag: g.entrants[userId]?.tag || userId,
      }));

      await fb.updateGiveaway(req.params.id, { winners });
      const updated = await fb.getGiveaway(req.params.id);
      await giveawayUtil.refreshMessage(client, updated);

      if (winners.length && g.channelId) {
        const channel = await client.channels.fetch(g.channelId).catch(() => null);
        if (channel) {
          const mentions = winners.map((w) => `<@${w.userId}>`).join(', ');
          await channel.send({
            content: `🔄 **Giveaway rerolled!** New winner(s): ${mentions} for **${g.title}**`,
          });
        }
      }

      log('GIVEAWAY_REROLL', req.user.tag, `Rerolled ${req.params.id}`);
      res.json({ ok: true, winners });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.delete('/api/giveaways/:id', requireGiveawayMod, async (req, res) => {
    try {
      const g = await fb.getGiveaway(req.params.id);
      if (!g) return res.status(404).json({ error: 'Giveaway not found' });

      if (g.messageId && g.channelId) {
        try {
          const channel = await client.channels.fetch(g.channelId);
          const message = await channel.messages.fetch(g.messageId);
          await message.delete();
        } catch { /* message may already be gone */ }
      }

      await fb.updateGiveaway(req.params.id, { status: 'cancelled' });
      await fb.deleteGiveaway(req.params.id);
      log('GIVEAWAY_DELETED', req.user.tag, `Deleted ${req.params.id}`);
      res.json({ ok: true });
    } catch (e) { res.status(400).json({ error: e.message }); }
  });

  // ── Save dashboard settings (max size + cosmetic prefs) ──
  app.post('/api/settings', requireModSide, rlWrite, async (req, res) => {
    try {
      const { name, maxSize, autoAccept, kickReason } = req.body;
      const max = parseInt(maxSize, 10);
      if (Number.isInteger(max) && max >= 0 && max <= 500) {
        await fb.getRegimentStatus();
        await fb.setMaxSlots(max);
        const status = await fb.getRegimentStatus();
        const toFill = Math.min(max - status.currentCount, 50); // cap at 50 promotions per call
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

  // ── Private Servers ──
  app.get('/api/private-servers', rlRead, async (req, res) => {
    try {
      const servers = await fb.getPrivateServers();
      res.json({ servers: servers.map(s => ({ id: s.id, userId: s.userId, tag: s.tag, link: s.link, addedAt: s.addedAt ? s.addedAt.toMillis() : Date.now() })) });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.post('/api/private-servers', rlWrite, async (req, res) => {
    try {
      const { link } = req.body;
      if (!link) return res.status(400).json({ error: 'Server link or code required' });
      await fb.addPrivateServer(req.user.id, req.user.tag, link);
      log('PRIVATE_SERVER_ADDED', req.user.tag, 'Added a private server link');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  app.delete('/api/private-servers/:id', rlWrite, async (req, res) => {
    try {
      if (req.params.id !== req.user.id && req.user.tier !== 'mod') {
        return res.status(403).json({ error: 'You can only delete your own server' });
      }
      await fb.deletePrivateServer(req.params.id);
      log('PRIVATE_SERVER_REMOVED', req.user.tag, 'Removed private server link');
      res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: e.message }); }
  });

  // Fallback all routes to the dashboard's index.html
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (req.path.startsWith('/api') || req.path.startsWith('/auth')) return next();
    res.sendFile(path.join(rootDir, 'dashboard', 'dist', 'index.html'));
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
