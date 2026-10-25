// ═══════════════════════════════════════════════════════════════════════════
// Bybit sync — automated path, no button click. Triggered on a schedule
// (Vercel Cron and/or an external scheduler — see docs/BYBIT_INTEGRATION.md)
// with no logged-in user attached, so it can't use a session token the way
// api/bybit-sync.js does. Instead it uses Supabase's service_role key.
//
// READ THIS BEFORE YOU WIRE THIS UP:
// The service_role key bypasses Row Level Security completely — it can read
// and write every row for every user, not just one. That's categorically
// more dangerous than the anon key + user token this app uses everywhere
// else. This endpoint is deliberately hardcoded to a single target user
// (TRADELOG_SYNC_USER_ID) rather than looping over "all users," because this
// integration is designed for one person syncing their own Bybit account,
// not a general multi-tenant "everyone connects their own exchange" feature
// (that would need per-user encrypted credential storage — a materially
// bigger feature than this).
//
// Required env vars (in addition to the ones api/bybit-sync.js needs):
//   SUPABASE_SERVICE_ROLE_KEY   — from Supabase → Settings → API. NOT the
//                                 anon key. Treat this like a root password.
//   TRADELOG_SYNC_USER_ID       — the one Supabase auth user_id this cron
//                                 job is allowed to write trades for.
//   CRON_SECRET                — set this yourself; Vercel automatically
//                                 sends it back as a Bearer token on every
//                                 cron invocation, which is how this file
//                                 tells "the real cron trigger" apart from
//                                 "anyone who found this URL."
// ═══════════════════════════════════════════════════════════════════════════

const { syncBybitPositions, normalizedSupabaseUrl } = require('./_bybit-shared');

function makeServiceRoleDbFetch() {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return async function dbFetch(method, path, body) {
    const res = await fetch(`${normalizedSupabaseUrl()}/rest/v1/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'apikey': serviceKey,
        'Authorization': `Bearer ${serviceKey}`,
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
  // Vercel sends this header automatically on every cron invocation once
  // CRON_SECRET is set as an env var. Anyone else hitting this URL won't
  // have it, and gets rejected before touching Bybit or Supabase at all.
  // With CRON_SECRET unset, the expected header would be the literal string
  // "Bearer undefined" — which anyone can send — so refuse outright instead.
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = req.headers.authorization || '';
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const userId = process.env.TRADELOG_SYNC_USER_ID;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!userId || !serviceKey) {
    return res.status(500).json({ error: 'TRADELOG_SYNC_USER_ID / SUPABASE_SERVICE_ROLE_KEY not configured' });
  }

  try {
    // No browser here to report a timezone — optional env var, minutes east
    // of UTC (330 for IST). Defaults to UTC dates.
    const tzOffsetMinutes = parseInt(process.env.TRADELOG_TZ_OFFSET_MINUTES || '0', 10) || 0;
    const result = await syncBybitPositions(makeServiceRoleDbFetch(), userId, { tzOffsetMinutes });
    console.log(`[bybit-cron] imported=${result.imported} updated=${result.updated}`);
    return res.status(200).json(result);
  } catch (e) {
    console.error('[bybit-cron] Failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
