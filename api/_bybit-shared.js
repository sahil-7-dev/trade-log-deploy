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

// The frontend build (scripts/build.js) already strips any accidental
// trailing path/slash from SUPABASE_URL before it reaches the browser — this
// project has hit that exact misconfiguration before (a stray "/rest/v1/"
// baked into the raw env var breaks every request built from it, silently,
// since the resulting URL is just wrong rather than obviously invalid). These
// serverless functions read process.env.SUPABASE_URL directly and never had
// that same protection, so the same historical mistake could break auth
// verification here even after being "fixed" for the frontend. Applying it
// here too closes that gap.
function normalizedSupabaseUrl() {
  const raw = process.env.SUPABASE_URL;
  if (!raw) return raw;
  try {
    const u = new URL(raw);
    return `${u.protocol}//${u.host}`;
  } catch {
    return String(raw).replace(/\/+$/, '');
  }
}

function signBybit(queryString, secret, timestamp, apiKey) {
  const payload = timestamp + apiKey + RECV_WINDOW + queryString;
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

async function bybitGet(path, queryParams) {
  // .trim() matters here specifically: a trailing space or newline pasted
  // into Vercel's env var UI is invisible in the dashboard but silently
  // changes the HMAC output, producing exactly a "signature mismatch" error
  // with no other symptom — this is the single most common cause of that
  // error and worth guarding against unconditionally.
  const apiKey = (process.env.BYBIT_API_KEY || '').trim();
  const apiSecret = (process.env.BYBIT_API_SECRET || '').trim();
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
    const closedExternalId = `bybit-closed:${t.orderId}`;

    // Idempotency guard — this is the part that actually matters for partial
    // closes specifically. A full close retires the open row's external_id,
    // so re-seeing the same record later naturally falls through to a safe,
    // upsert-deduplicated insert. A partial close deliberately leaves the
    // open row's external_id untouched (so a *later, different* close event
    // can still find it) — but without this check, re-processing the exact
    // same partial-close record on a later sync would reduce the tracked
    // open size a second time for the same real-world event, silently
    // corrupting it further with every repeated run.
    const alreadyRecorded = await dbFetch(
      'GET',
      `trades?user_id=eq.${userId}&external_id=eq.${encodeURIComponent(closedExternalId)}&select=id`
    );
    if (Array.isArray(alreadyRecorded) && alreadyRecorded.length > 0) continue;

    const key = openKeyFor(t.symbol, t.side, t.positionIdx || '0');
    const existing = await dbFetch(
      'GET',
      `trades?user_id=eq.${userId}&external_id=eq.${encodeURIComponent(key)}&select=id,size,original_size,realized_exit_value`
    );

    const closedDate = new Date(parseInt(t.updatedTime, 10)).toISOString().slice(0, 10);
    const closedNotional = parseFloat(t.cumEntryValue); // entry-side notional THIS event closed, not the position's original total
    const exitValue = parseFloat(t.cumExitValue);        // exit-side notional THIS event realized — needed to compute a correct blended average price across multiple partial fills
    // NOTE: Bybit's closed-pnl "side" field reflects the order that CLOSED
    // the position, not the position's own direction — closing a Short means
    // placing a Buy order to cover, so "side: Buy" here actually means the
    // position itself was Short. Confirmed against a real account.
    const dir = t.side === 'Buy' ? 'Short' : 'Long';

    if (Array.isArray(existing) && existing.length > 0) {
      const row = existing[0];
      const trackedSize = parseFloat(row.size);
      // Older rows synced before original_size existed won't have it — fall
      // back to the current tracked size (the best available estimate of
      // "the whole position") rather than failing on them.
      const originalSize = row.original_size != null ? parseFloat(row.original_size) : trackedSize;
      const cumExitValue = parseFloat(row.realized_exit_value || 0) + exitValue;
      // Small tolerance for float rounding — Bybit's notional figures rarely
      // land on an exact match even for a genuine full close.
      const isFullClose = closedNotional >= trackedSize * 0.99;

      if (isFullClose) {
        // The position is now fully closed — whether this was the only fill
        // or the last of several partial closes, it becomes ONE merged trade
        // row: exit is the value-weighted average price across every close
        // combined (total exit value ÷ the position's original full size),
        // and size is restored to that original full size so Postgres's P&L
        // formula reflects the whole position's outcome, not just its final
        // remaining sliver.
        const blendedExit = cumExitValue / originalSize;
        const mergedNote = cumExitValue > exitValue ? ' (merged across multiple partial closes)' : '';
        await dbFetch('PATCH', `trades?id=eq.${row.id}`, {
          exit: parseFloat(blendedExit.toFixed(6)),
          date: closedDate,
          size: originalSize,
          external_id: closedExternalId,
          notes: `Synced from Bybit${mergedNote} · exchange-reported P&L (incl. fees): $${parseFloat(t.closedPnl).toFixed(2)}`,
        });
        updated++;
      } else {
        // Partial close — accumulate into the SAME row rather than creating
        // a new one: reduce the tracked remaining size, and add this fill's
        // exit value to the running total that the eventual full close will
        // use to compute the correct blended price. The row stays Open and
        // keeps its open-key, so the next close (partial or final) can still
        // find and match it.
        await dbFetch('PATCH', `trades?id=eq.${row.id}`, {
          size: parseFloat((trackedSize - closedNotional).toFixed(2)),
          realized_exit_value: parseFloat(cumExitValue.toFixed(2)),
        });
        updated++;
      }
    } else {
      // No matching open row — likely closed before this integration was
      // ever set up, or an open-position poll was missed. Either way, import
      // it as a single complete already-closed trade (nothing to blend).
      await dbFetch('POST', 'trades?on_conflict=user_id,external_id', [{
        user_id: userId,
        date: closedDate, symbol: t.symbol, type: 'Crypto', dir,
        entry: parseFloat(t.avgEntryPrice),
        exit: parseFloat(t.avgExitPrice),
        size: closedNotional,
        sl: null, tp: null,
        source: 'bybit',
        external_id: closedExternalId,
        notes: `Synced from Bybit · exchange-reported P&L (incl. fees): $${parseFloat(t.closedPnl).toFixed(2)}`,
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
      // Unlike closed-pnl above, position/list's "side" genuinely represents
      // the position's own direction (Bybit's docs and behavior agree here),
      // so this mapping is intentionally NOT inverted.
      dir: p.side === 'Buy' ? 'Long' : 'Short',
      entry: parseFloat(p.avgPrice),
      exit: null,
      size: parseFloat(p.positionValue),
      original_size: parseFloat(p.positionValue), // baseline for blending future partial closes
      realized_exit_value: 0,
      sl: null, tp: null,
      source: 'bybit',
      external_id: key,
    }]);
    imported++;
  }

  return { imported, updated };
}

module.exports = { bybitGet, syncBybitPositions, openKeyFor, normalizedSupabaseUrl };
