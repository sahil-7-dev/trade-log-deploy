// ═══════════════════════════════════════════════════════════════════════════
// Shared Bybit sync logic — used by both api/bybit-sync.js (manual button,
// authenticated as the logged-in user) and api/bybit-cron.js (automated,
// authenticated via service role). Keeping this in one place means both
// entry points apply the exact same open/close matching rules — nothing to
// keep in sync between two copies of similar-but-not-identical logic.
//
// The leading underscore in this filename is a documented Vercel convention:
// "Files and directories that start with _ are not turned into Serverless
// Functions" — so this stays an importable module, never its own public
// /api/_bybit-shared route.
// ═══════════════════════════════════════════════════════════════════════════

const crypto = require('crypto');

const BYBIT_BASE = 'https://api.bybit.com';
const RECV_WINDOW = '5000';

function signBybit(queryString, secret, timestamp, apiKey) {
  const payload = timestamp + apiKey + RECV_WINDOW + queryString;
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
  const signature = signBybit(query, apiSecret, timestamp, apiKey);

  const res = await fetch(`${BYBIT_BASE}${path}?${query}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey,
      'X-BAPI-SIGN': signature,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': RECV_WINDOW,
    },
  });

  if (!res.ok) throw new Error(`Bybit API error: ${res.status}`);
  const data = await res.json();
  if (data.retCode !== 0) throw new Error(`Bybit API rejected request: ${data.retMsg || data.retCode}`);
  return data.result;
}

// Every currently-open position gets a deterministic key so we can find it
// again on a later poll and either (a) recognize it's still open — skip, or
// (b) recognize it just closed — update that same row instead of leaving an
// orphaned "Open" row and inserting a second "Closed" one.
function openKeyFor(symbol, side, positionIdx) {
  return `bybit-open:${symbol}:${side}:${positionIdx}`;
}

/**
 * dbFetch(method, path, body) — caller supplies this, already carrying the
 * right Supabase credentials (a user's session token for the manual button,
 * or the service_role key for the unattended cron path). This function
 * doesn't know or care which one it's given.
 */
async function syncBybitPositions(dbFetch, userId) {
  let imported = 0, updated = 0;

  // 1. Recently closed positions — check each against an existing "open" row
  //    first, since most closes are positions we already know about.
  const closedResult = await bybitGet('/v5/position/closed-pnl', { category: 'linear', limit: '50' });

  for (const t of closedResult.list || []) {
    const key = openKeyFor(t.symbol, t.side, t.positionIdx || '0');
    const existing = await dbFetch(
      'GET',
      `trades?user_id=eq.${userId}&external_id=eq.${encodeURIComponent(key)}&select=id`
    );

    const closedDate = new Date(parseInt(t.updatedTime, 10)).toISOString().slice(0, 10);
    const closedExternalId = `bybit-closed:${t.orderId}`;
    const notes = `Synced from Bybit · exchange-reported P&L (incl. fees): $${parseFloat(t.closedPnl).toFixed(2)}`;

    if (Array.isArray(existing) && existing.length > 0) {
      // We already had this tracked as "Open" — turn it into a closed trade
      // in place, and retire the open-key so it's never matched again.
      await dbFetch('PATCH', `trades?id=eq.${existing[0].id}`, {
        exit: parseFloat(t.avgExitPrice),
        date: closedDate,
        external_id: closedExternalId,
        notes,
      });
      updated++;
    } else {
      // No matching open row — likely closed before this integration was
      // ever set up, or an open-position poll was missed. Either way, import
      // it as a complete, already-closed trade.
      await dbFetch('POST', 'trades?on_conflict=user_id,external_id', [{
        user_id: userId,
        date: closedDate,
        symbol: t.symbol,
        type: 'Crypto',
        dir: t.side === 'Buy' ? 'Long' : 'Short',
        entry: parseFloat(t.avgEntryPrice),
        exit: parseFloat(t.avgExitPrice),
        size: parseFloat(t.cumEntryValue),
        sl: null, tp: null,
        source: 'bybit',
        external_id: closedExternalId,
        notes,
      }]);
      imported++;
    }
  }

  // 2. Currently open positions — insert any we're not already tracking.
  const openResult = await bybitGet('/v5/position/list', { category: 'linear', settleCoin: 'USDT' });

  for (const p of openResult.list || []) {
    if (!p.size || parseFloat(p.size) === 0) continue; // Bybit can list zero-size/flat entries here

    const key = openKeyFor(p.symbol, p.side, p.positionIdx || '0');
    const existing = await dbFetch(
      'GET',
      `trades?user_id=eq.${userId}&external_id=eq.${encodeURIComponent(key)}&select=id`
    );
    if (Array.isArray(existing) && existing.length > 0) continue; // already tracked

    await dbFetch('POST', 'trades?on_conflict=user_id,external_id', [{
      user_id: userId,
      date: new Date(parseInt(p.createdTime, 10)).toISOString().slice(0, 10),
      symbol: p.symbol,
      type: 'Crypto',
      dir: p.side === 'Buy' ? 'Long' : 'Short',
      entry: parseFloat(p.avgPrice),
      exit: null,
      size: parseFloat(p.positionValue),
      sl: null, tp: null,
      source: 'bybit',
      external_id: key,
    }]);
    imported++;
  }

  return { imported, updated };
}

module.exports = { bybitGet, syncBybitPositions, openKeyFor };
