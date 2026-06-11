// ── Dashboard authentication: Discord OAuth2 → signed session token ──────────────
// The admin dashboard is gated behind "Login with Discord". After the OAuth round
// trip we look the user up in the guild (via the live bot client) and only let them
// in if they hold a REGIMENT_MANAGE_ROLE_IDS role. We then mint a short, HMAC-signed
// session token the frontend sends as `Authorization: Bearer <token>` on every
// /api/* call.
//
// No external JWT/auth library: the token is a compact HMAC-SHA256 construction
// (`payloadB64.sigB64`) signed with DASHBOARD_SESSION_SECRET, using Node's built-in
// crypto. All Firestore access is server-side via the Admin SDK, so this token only
// needs to guard the bot's own HTTP API.

const crypto = require('crypto');

const DISCORD_API = 'https://discord.com/api';
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // session token: 7 days
const STATE_TTL_MS = 10 * 60 * 1000;            // OAuth state token: 10 minutes

function cfg() {
  return {
    clientId: process.env.DISCORD_CLIENT_ID,
    clientSecret: process.env.DISCORD_CLIENT_SECRET,
    redirectUri: process.env.DISCORD_OAUTH_REDIRECT,
    secret: process.env.DASHBOARD_SESSION_SECRET,
  };
}

// True only when every piece needed for OAuth + token signing is present.
function isConfigured() {
  const c = cfg();
  return !!(c.clientId && c.clientSecret && c.redirectUri && c.secret);
}

// Names of the env vars that still need setting (for a helpful startup warning).
function missingVars() {
  const c = cfg();
  return Object.entries({
    DISCORD_CLIENT_ID: c.clientId,
    DISCORD_CLIENT_SECRET: c.clientSecret,
    DISCORD_OAUTH_REDIRECT: c.redirectUri,
    DASHBOARD_SESSION_SECRET: c.secret,
  }).filter(([, v]) => !v).map(([k]) => k);
}

// ── base64url helpers ──
const b64url = (buf) => Buffer.from(buf).toString('base64url');
const fromB64url = (s) => Buffer.from(s, 'base64url');

// ── Signed token: `payloadB64.sigB64` (HMAC-SHA256) ──
function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = b64url(crypto.createHmac('sha256', cfg().secret).update(body).digest());
  return `${body}.${sig}`;
}

// Returns the payload object if the token is well-formed, untampered and unexpired;
// otherwise null.
function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = b64url(crypto.createHmac('sha256', cfg().secret).update(body).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  let payload;
  try { payload = JSON.parse(fromB64url(body).toString()); } catch { return null; }
  if (!payload.exp || Date.now() > payload.exp) return null;
  return payload;
}

// ── OAuth state (CSRF protection + post-login redirect target) ──
function makeState(redirect) {
  return sign({
    k: 'state',
    redirect: redirect || '',
    nonce: crypto.randomBytes(8).toString('hex'),
    exp: Date.now() + STATE_TTL_MS,
  });
}
function readState(state) {
  const p = verify(state);
  return p && p.k === 'state' ? p : null;
}

// ── Session token for an authorized user ──
// tier: 'mod' (full access) or 'readonly' (members + queue view only)
function makeSession(user) {
  return sign({
    k: 'session',
    sub: user.id,
    name: user.tag,
    tier: user.tier === 'readonly' ? 'readonly' : 'mod',
    exp: Date.now() + SESSION_TTL_MS,
  });
}

function authorizeUrl(state) {
  const c = cfg();
  const params = new URLSearchParams({
    client_id: c.clientId,
    redirect_uri: c.redirectUri,
    response_type: 'code',
    scope: 'identify',
    state,
  });
  return `https://discord.com/oauth2/authorize?${params}`;
}

// Exchange an authorization code for an access token.
async function exchangeCode(code) {
  const c = cfg();
  const res = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.clientId,
      client_secret: c.clientSecret,
      grant_type: 'authorization_code',
      code,
      redirect_uri: c.redirectUri,
    }),
  });
  if (!res.ok) throw new Error(`Discord token exchange failed (${res.status})`);
  return res.json();
}

// Fetch the Discord user behind an access token (needs the `identify` scope).
async function fetchDiscordUser(accessToken) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord user fetch failed (${res.status})`);
  return res.json();
}

// Express middleware: require a valid session token. Attaches req.user.
function requireAuth(req, res, next) {
  if (!isConfigured()) {
    return res.status(503).json({ error: 'Dashboard auth is not configured on the server.' });
  }
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const payload = verify(token);
  if (!payload || payload.k !== 'session') {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  req.user = {
    id: payload.sub,
    tag: payload.name,
    tier: payload.tier === 'readonly' ? 'readonly' : 'mod',
  };
  next();
}

module.exports = {
  isConfigured,
  missingVars,
  makeState,
  readState,
  makeSession,
  authorizeUrl,
  exchangeCode,
  fetchDiscordUser,
  requireAuth,
};
