// ═══════════════════════════════════════════════════════════════════════════
// Bybit sync — manual button path. Authenticates as the logged-in user (their
// own Supabase session token), so every write still goes through Row Level
// Security exactly like any other request this app makes. See
// docs/BYBIT_INTEGRATION.md for the full setup and security writeup, and
// api/bybit-cron.js for the automated (no button click) alternative.
// ═══════════════════════════════════════════════════════════════════════════

const { syncBybitPositions, normalizedSupabaseUrl } = require('./_bybit-shared');

async function verifySupabaseUser(accessToken) {
  const res = await fetch(`${normalizedSupabaseUrl()}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) {
    // Never log the token itself — but the status/body here is safe and is
    // exactly what distinguishes "token really is invalid" from "this request
    // itself is misconfigured" (e.g. a bad SUPABASE_URL/ANON_KEY reaching
    // Supabase at all, which would show up here as a 4xx unrelated to the
    // token's actual validity).
    const body = await res.text().catch(() => '');
    console.error(`[bybit-sync] Supabase auth check failed: ${res.status} ${body}`);
    return null;
  }
  const user = await res.json();
  return user && user.id ? user : null;
}

function makeDbFetch(accessToken) {
  return async function dbFetch(method, path, body) {
    const res = await fetch(`${normalizedSupabaseUrl()}/rest/v1/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': process.env.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Prefer': method === 'POST' ? 'resolution=merge-duplicates,return=minimal' : 'return=representation',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.message || `Supabase ${method} failed: ${res.status}`);
    }
    return method === 'GET' || method === 'PATCH' ? res.json() : null;
  };
}


module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const accessToken = (req.headers.authorization || '').replace('Bearer ', '');
  if (!accessToken) return res.status(401).json({ error: 'Missing Authorization header' });

  try {
    const user = await verifySupabaseUser(accessToken);
    if (!user) return res.status(401).json({ error: 'Invalid or expired session' });

    // The Bybit API keys on the server belong to ONE person. Anyone can sign
    // up, so a valid login alone must not pull that person's trades into the
    // caller's account — only the configured owner may sync.
    const owner = process.env.TRADELOG_SYNC_USER_ID;
    if (!owner) return res.status(403).json({ error: 'Bybit sync not configured: set TRADELOG_SYNC_USER_ID (your Supabase user id) in Vercel' });
    if (user.id !== owner) return res.status(403).json({ error: 'Bybit sync is linked to a different account' });

    // The browser sends its UTC offset so synced trades land on the user's
    // own calendar day; anything missing or out of range falls back to UTC.
    const offset = Number(req.body && req.body.tzOffsetMinutes);
    const tzOffsetMinutes = Number.isFinite(offset) && Math.abs(offset) <= 14 * 60 ? offset : 0;

    const result = await syncBybitPositions(makeDbFetch(accessToken), user.id, { tzOffsetMinutes });
    return res.status(200).json(result);
  } catch (e) {
    // Never include tokens, headers, or API keys in error responses/logs.
    console.error('[bybit-sync] Failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
};

