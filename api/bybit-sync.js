// ═══════════════════════════════════════════════════════════════════════════
// Bybit derivatives → TradeLog auto-sync
// ═══════════════════════════════════════════════════════════════════════════
//
// This is a Vercel serverless function — it runs on Vercel's servers, never
// in the browser. That's the entire reason it exists as a separate file
// instead of a fetch() call in app.js: your Bybit API secret must NEVER be
// reachable from client-side JavaScript. Anyone who can read your page's
// source can read anything sitting in browser-side code, no matter how it's
// obfuscated. A serverless function's source is never sent to the browser —
// only its JSON response is.
//
// SETUP (see docs/BYBIT_INTEGRATION.md for the full walkthrough):
//   1. On Bybit: API Management → Create API Key → permissions: READ-ONLY.
//      Do not enable Trade or Withdraw permissions for this key. Ever.
//      Optionally restrict it to Vercel's IPs if your plan supports static IPs.
//   2. In Vercel: Project → Settings → Environment Variables, add:
//        BYBIT_API_KEY
//        BYBIT_API_SECRET
//      (Same place SUPABASE_URL etc. already live — never in this repo.)
//   3. Deploy. This file is automatically available at /api/bybit-sync.
//
// WHAT IT DOES
//   Fetches your closed Bybit derivatives positions, maps each one onto
//   TradeLog's trade schema using the exact rules below, and upserts them
//   into Supabase — safe to call repeatedly, already-imported trades are
//   never duplicated (see "Idempotency" below).
//
// THE RULES THIS FOLLOWS (as specified)
//   - A trade closed on Bybit without a matching SL/TP on our side gets
//     sl=tp=null. That's not a bug — it means Postgres's `rr` stays null for
//     it too (no risk defined, so no R:R to compute), while `pnl` and
//     `status` are computed exactly like any manual trade. It still "cuts or
//     adds" to P&L; it just doesn't get an R:R figure attached.
//   - Breakeven detection is the same rule as manual trades: Postgres flags
//     status='Breakeven' whenever exit equals entry exactly. No special
//     casing needed here — it falls out of the schema automatically.
//   - Breakeven P&L still flows into total P&L / trading balance normally —
//     it's a display category, not an exclusion. Also automatic; the app's
//     stats already treat it this way (see computeStats() in app.js).
//
// KNOWN LIMITATION — worth understanding before you rely on this
//   Bybit's closedPnl figure includes trading fees and funding payments;
//   the pnl this app computes (via the `entry`/`exit`/`size`/`dir` generated
//   column) does not, to stay consistent with how every manual trade is
//   already calculated. Expect small discrepancies vs. Bybit's own P&L tab —
//   usually a few tenths of a percent from fees, not a bug in either number.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const BYBIT_BASE = 'https://api.bybit.com';
const RECV_WINDOW = '5000';

function sign(params, secret, timestamp, apiKey) {
  const payload = timestamp + apiKey + RECV_WINDOW + params;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function bybitGet(path, queryParams) {
  const apiKey = process.env.BYBIT_API_KEY;
  const apiSecret = process.env.BYBIT_API_SECRET;
  if (!apiKey || !apiSecret) {
    throw new Error('BYBIT_API_KEY / BYBIT_API_SECRET not configured on the server');
  }

  const timestamp = Date.now().toString();
  const query = new URLSearchParams(queryParams).toString();
  const signature = sign(query, apiSecret, timestamp, apiKey);

  const res = await fetch(`${BYBIT_BASE}${path}?${query}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    },
  });

  if (!res.ok) {
    throw new Error(`Bybit API error: ${res.status}`);
  }
  const data = await res.json();
  if (data.retCode !== 0) {
    throw new Error(`Bybit API rejected request: ${data.retMsg || data.retCode}`);
  }
  return data.result;
}

// Verifies the caller is a real, currently-authenticated TradeLog user
// before this endpoint does anything — otherwise anyone who discovers the
// URL could trigger syncs (harmless to Bybit's data, but still your
// database being written to by a stranger).
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

function mapBybitTradeToRow(t, userId) {
  const closedAt = new Date(parseInt(t.updatedTime, 10));
  const date = closedAt.toISOString().slice(0, 10);
  const dir = t.side === 'Buy' ? 'Long' : 'Short';
  const entry = parseFloat(t.avgEntryPrice);
  const exit = parseFloat(t.avgExitPrice);
  // cumEntryValue is the total notional at entry, in quote currency (USDT) —
  // matches how "size" is defined everywhere else in this app (a dollar
  // amount, not a coin quantity), so the same pnl formula applies uniformly.
  const size = parseFloat(t.cumEntryValue);

  return {
    user_id: userId,
    date, symbol: t.symbol, type: 'Crypto', dir,
    entry, exit, size,
    sl: null, tp: null, // see the file header — intentional, not missing data
    source: 'bybit',
    external_id: t.orderId,
    notes: `Synced from Bybit · exchange-reported P&L (incl. fees): $${parseFloat(t.closedPnl).toFixed(2)}`,
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const accessToken = authHeader.replace('Bearer ', '');
  if (!accessToken) {
    return res.status(401).json({ error: 'Missing Authorization header' });
  }

  try {
    const user = await verifySupabaseUser(accessToken);
    if (!user) return res.status(401).json({ error: 'Invalid or expired session' });

    // "linear" = USDT-margined perpetuals/futures, the common Bybit derivatives market.
    // Bybit paginates via cursor; loop until exhausted or a sane page cap is hit.
    let cursor = '';
    let allTrades = [];
    for (let page = 0; page < 20; page++) {
      const result = await bybitGet('/v5/position/closed-pnl', {
        category: 'linear',
        limit: '100',
        ...(cursor ? { cursor } : {}),
      });
      allTrades = allTrades.concat(result.list || []);
      cursor = result.nextPageCursor;
      if (!cursor) break;
    }

    const rows = allTrades.map(t => mapBybitTradeToRow(t, user.id));
    if (rows.length === 0) {
      return res.status(200).json({ imported: 0, message: 'No closed positions found on Bybit' });
    }

    // Upsert on (user_id, external_id) — a repeated sync silently skips
    // anything already imported instead of creating duplicate trade rows.
    const upsertRes = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/trades?on_conflict=user_id,external_id`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': process.env.SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${accessToken}`,
          'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        body: JSON.stringify(rows),
      }
    );

    if (!upsertRes.ok) {
      const err = await upsertRes.json().catch(() => ({}));
      throw new Error(err.message || `Supabase upsert failed: ${upsertRes.status}`);
    }

    return res.status(200).json({ imported: rows.length });
  } catch (e) {
    // Never include req headers, tokens, or API keys in error responses/logs.
    console.error('[bybit-sync] Failed:', e.message);
    return res.status(500).json({ error: e.message });
  }
};
