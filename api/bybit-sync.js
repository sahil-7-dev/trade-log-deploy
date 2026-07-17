// ═══════════════════════════════════════════════════════════════════════════
// Bybit sync — manual button path. Authenticates as the logged-in user (their
// own Supabase session token), so every write still goes through Row Level
// Security exactly like any other request this app makes. See
// docs/BYBIT_INTEGRATION.md for the full setup and security writeup, and
// api/bybit-cron.js for the automated (no button click) alternative.
// ═══════════════════════════════════════════════════════════════════════════

const { syncBybitPositions } = require('./_bybit-shared');

async function verifySupabaseUser(accessToken) {
  const res = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'apikey': process.env.SUPABASE_ANON_KEY,
    },
  });
  if (!res.ok) return null;
  const user = await res.json();
  return user && user.id ? user : null;
}

function makeDbFetch(accessToken) {
  return async function dbFetch(method, path, body) {
    const res = await fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
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

    const result = await syncBybitPositions(makeDbFetch(accessToken), user.id);
    return res.status(200).json(result);
  } catch (e) {
    // Never include tokens, headers, or API keys in error responses/logs.
    console.error('[bybit-sync] Failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
