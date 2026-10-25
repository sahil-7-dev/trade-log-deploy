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
//
// `side` here is always the POSITION's own side (Buy = Long, Sell = Short),
// whichever endpoint the record came from — see positionSideFromClosed().
function openKeyFor(symbol, side, positionIdx) {
  return `bybit-open:${symbol}:${side}:${positionIdx}`;
}

// Bybit's closed-pnl "side" field reflects the order that CLOSED the
// position, not the position's own direction — closing a Long means placing
// a Sell order, so "side: Sell" there means the position was Long. The open
// key must be built from the position's side (what position/list reports),
// otherwise a close never finds the row its open created: the open row is
// left stuck as "Open" forever and the close is imported as a second row.
function positionSideFromClosed(closingSide) {
  return closingSide === 'Buy' ? 'Sell' : 'Buy';
}

// Bybit timestamps are epoch ms. Trade dates are calendar days in the
// user's own timezone (offset in minutes east of UTC, e.g. 330 for IST) —
// a plain toISOString() would file a 2am IST close under the previous day.
function toLocalDate(ms, tzOffsetMinutes) {
  return new Date(parseInt(ms, 10) + tzOffsetMinutes * 60000).toISOString().slice(0, 10);
}

// Entry prices from the same position agree to well within this; a
// different position that happens to reuse the same open key almost never
// does. Guards against merging a close into the wrong row.
function sameEntry(a, b) {
  const x = parseFloat(a), y = parseFloat(b);
  return y > 0 && Math.abs(x - y) / y < 0.005;
}

function appendNote(existing, note) {
  return existing ? `${existing}\n${note}` : note;
}

const round2 = n => parseFloat(n.toFixed(2));
const toIso = ms => new Date(parseInt(ms, 10)).toISOString();
// Total fees across a trade's fills (trading + funding, from Bybit's own P&L)
const sumFees = closes => round2(closes.reduce((s, f) => s + (f.fee || 0), 0));

const STALE_NOTE = 'No longer open on Bybit — its close was not matched. Check for a separate closed copy of this trade before keeping it.';

function syncNote(closes, merged) {
  const exchangePnl = closes.reduce((s, f) => s + (f.exchangePnl || 0), 0);
  const how = merged ? ` (merged across ${closes.length} closes)` : '';
  return `Synced from Bybit${how} · exchange-reported P&L (incl. fees): $${exchangePnl.toFixed(2)}`;
}

/**
 * dbFetch(method, path, body) — caller supplies this, already carrying the
 * right Supabase credentials (a user's session token for the manual button,
 * or the service_role key for the unattended cron path). This function
 * doesn't know or care which one it's given.
 *
 * A position is ONE trade row for its whole life. Partial closes are kept
 * as fills in that row's `closes` and only shrink its open size — the row
 * stays Open (out of the stats) until the final close, which sets exit to
 * the size-weighted average of every fill and size back to the original.
 */
async function syncBybitPositions(dbFetch, userId, { tzOffsetMinutes = 0 } = {}) {
  let imported = 0, updated = 0;

  // Snapshot open positions FIRST. Anything still tracked as open afterwards
  // that isn't in this snapshot (and wasn't matched to a close below) is
  // definitively closed on Bybit — taking the snapshot before reading closes
  // means a position closing mid-sync can never be misjudged that way.
  const openResult = await bybitGet('/v5/position/list', { category: 'linear', settleCoin: 'USDT' });
  const openPositions = (openResult.list || []).filter(p => p.size && parseFloat(p.size) !== 0); // Bybit can list zero-size/flat entries here
  const positionsByKey = new Map(openPositions.map(p => [openKeyFor(p.symbol, p.side, p.positionIdx || '0'), p]));

  // Bybit returns newest first. Process oldest first so fills apply in the
  // order they happened and the final close is the last one applied.
  const closedResult = await bybitGet('/v5/position/closed-pnl', { category: 'linear', limit: '50' });
  const closedList = [...(closedResult.list || [])]
    .sort((a, b) => parseInt(a.updatedTime, 10) - parseInt(b.updatedTime, 10));

  // Idempotency: a close already in the journal — as a trade of its own
  // (external_id) or as a fill inside a trade (closes[].id) — must never be
  // applied again. Without this, re-syncing after a partial close shrank the
  // open size a second time, and the "remaining" size then looked fully
  // closed: the trade was closed early and a duplicate Open row created.
  const known = await dbFetch('GET', `trades?user_id=eq.${userId}&source=eq.bybit&select=external_id,closes`);
  const recorded = new Set();
  for (const r of known || []) {
    if (r.external_id) recorded.add(r.external_id);
    for (const f of r.closes || []) recorded.add(`bybit-closed:${f.id}`);
  }
  const pending = closedList.filter(t => !recorded.has(`bybit-closed:${t.orderId}`));

  const closeKey = t => openKeyFor(t.symbol, positionSideFromClosed(t.side), t.positionIdx || '0');
  // Pending closes that belong to the currently open position p (same key,
  // happened after p was opened) — i.e. partial closes of p not yet applied.
  const pendingCloseOf = (key, p) => pending.filter(t =>
    closeKey(t) === key && parseInt(t.updatedTime, 10) >= parseInt(p.createdTime, 10));

  // 1. Open positions — make sure each has exactly one tracked row, sized as
  //    it was BEFORE any of its pending partial closes (step 2 applies them).
  for (const [key, p] of positionsByKey) {
    const positionValue = parseFloat(p.positionValue);
    const pendingClosed = pendingCloseOf(key, p).reduce((s, t) => s + parseFloat(t.cumEntryValue), 0);
    const existing = await dbFetch(
      'GET',
      `trades?user_id=eq.${userId}&external_id=eq.${encodeURIComponent(key)}&select=id,created_at,size,original_size,notes`
    );
    let row = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;

    // The tracked row is from an OLDER position that reused this key (Bybit
    // opened this one after the row was written) — its close was missed.
    // Retire it so the current position gets its own row below.
    if (row && parseInt(p.createdTime, 10) > new Date(row.created_at).getTime()) {
      await dbFetch('PATCH', `trades?id=eq.${row.id}`, {
        external_id: `bybit-stale:${row.id}`,
        notes: appendNote(row.notes, STALE_NOTE),
      });
      updated++;
      row = null;
    }

    if (row) {
      // Same position, scaled into since it was last synced: Bybit's average
      // entry and position value both move, so follow them, and grow
      // original_size by the added amount so the final close still blends
      // over the whole position.
      const trackedSize = parseFloat(row.size);
      const added = positionValue - (trackedSize - pendingClosed);
      if (added > trackedSize * 0.005) {
        const originalSize = row.original_size != null ? parseFloat(row.original_size) : trackedSize;
        await dbFetch('PATCH', `trades?id=eq.${row.id}`, {
          entry: parseFloat(p.avgPrice),
          size: round2(trackedSize + added),
          original_size: round2(originalSize + added),
        });
        updated++;
      }
      continue;
    }

    const fullSize = round2(positionValue + pendingClosed);
    await dbFetch('POST', 'trades?on_conflict=user_id,external_id', [{
      user_id: userId,
      date: toLocalDate(p.createdTime, tzOffsetMinutes),
      symbol: p.symbol,
      type: 'Crypto',
      // Unlike closed-pnl, position/list's "side" genuinely represents the
      // position's own direction, so this mapping is intentionally NOT inverted.
      dir: p.side === 'Buy' ? 'Long' : 'Short',
      entry: parseFloat(p.avgPrice),
      exit: null,
      size: fullSize,
      original_size: fullSize,
      realized_exit_value: 0,
      closes: [],
      opened_at: toIso(p.createdTime),
      sl: null, tp: null,
      source: 'bybit',
      external_id: key,
    }]);
    imported++;
  }

  // 2. Closes not yet in the journal, oldest first.
  const mergedThisRun = new Map(); // untracked closes of one position → the row they were imported into
  for (const t of pending) {
    const key = closeKey(t);
    const dir = positionSideFromClosed(t.side) === 'Buy' ? 'Long' : 'Short';
    const closedDate = toLocalDate(t.updatedTime, tzOffsetMinutes);
    const closedNotional = parseFloat(t.cumEntryValue); // entry-side $ THIS close took off the position
    const exitValue = parseFloat(t.cumExitValue);        // exit-side $ THIS close realized
    const fill = {
      id: t.orderId,
      date: closedDate,
      exit: parseFloat(t.avgExitPrice),
      size: round2(closedNotional),
      pnl: round2(dir === 'Long' ? exitValue - closedNotional : closedNotional - exitValue),
      exchangePnl: round2(parseFloat(t.closedPnl)),
    };
    // Bybit's closedPnl is net of trading + funding fees; the difference from
    // the price-move P&L is what this close cost in fees.
    fill.fee = round2(fill.pnl - fill.exchangePnl);

    const existing = await dbFetch(
      'GET',
      `trades?user_id=eq.${userId}&external_id=eq.${encodeURIComponent(key)}&select=id,entry,size,original_size,realized_exit_value,notes,closes`
    );
    // While the position is open, its row (just ensured in step 1) owns every
    // close since it opened. Once it's gone from Bybit, only accept a row
    // with the same entry — never fold a close into some unrelated old row.
    const p = positionsByKey.get(key);
    const candidate = Array.isArray(existing) && existing.length > 0 ? existing[0] : null;
    const row = candidate && (p
      ? parseInt(t.updatedTime, 10) >= parseInt(p.createdTime, 10)
      : sameEntry(candidate.entry, t.avgEntryPrice)) ? candidate : null;

    if (row) {
      const trackedSize = parseFloat(row.size);
      const originalSize = row.original_size != null ? parseFloat(row.original_size) : trackedSize;
      const cumExitValue = parseFloat(row.realized_exit_value || 0) + exitValue;
      const closes = [...(row.closes || []), fill];
      // Small tolerance for float rounding — Bybit's notional figures rarely
      // land on an exact match even for a genuine full close.
      const isFullClose = closedNotional >= trackedSize * 0.99;

      if (isFullClose) {
        // Sizes are entry-side notional (qty × entry) and exit values are
        // qty × exit, so total exit value ÷ original size is the exit/entry
        // RATIO — multiply by entry for the size-weighted average exit price.
        // Size goes back to the original so Postgres's P&L covers the whole
        // position. User notes on the open trade are kept.
        const blendedExit = parseFloat(row.entry) * cumExitValue / originalSize;
        await dbFetch('PATCH', `trades?id=eq.${row.id}`, {
          exit: parseFloat(blendedExit.toFixed(12)),
          date: closedDate,
          size: originalSize,
          original_size: originalSize,
          realized_exit_value: round2(cumExitValue),
          closes,
          fees: sumFees(closes),
          closed_at: toIso(t.updatedTime),
          external_id: `bybit-closed:${t.orderId}`,
          notes: appendNote(row.notes, syncNote(closes, closes.length > 1)),
        });
      } else {
        // Partial close — stays the same Open trade: shrink the open size,
        // record the fill. Stats ignore it until the final close.
        await dbFetch('PATCH', `trades?id=eq.${row.id}`, {
          size: round2(trackedSize - closedNotional),
          original_size: originalSize,
          realized_exit_value: round2(cumExitValue),
          closes,
          fees: sumFees(closes),
        });
      }
      updated++;
      continue;
    }

    // Not tracked: the position opened and closed entirely between syncs.
    // Several closes of it in one batch (partials then final) share a key
    // and the exact same average entry — fold them into one trade.
    const mergeKey = `${key}|${t.avgEntryPrice}`;
    const prev = mergedThisRun.get(mergeKey);
    if (prev) {
      prev.size += closedNotional;
      prev.exitValue += exitValue;
      prev.closes.push(fill);
      await dbFetch('PATCH', `trades?user_id=eq.${userId}&external_id=eq.${encodeURIComponent(prev.externalId)}`, {
        exit: parseFloat((prev.entry * prev.exitValue / prev.size).toFixed(12)),
        date: closedDate,
        size: round2(prev.size),
        original_size: round2(prev.size),
        realized_exit_value: round2(prev.exitValue),
        closes: prev.closes,
        fees: sumFees(prev.closes),
        closed_at: toIso(t.updatedTime),
        notes: syncNote(prev.closes, true),
      });
      continue;
    }

    const externalId = `bybit-closed:${t.orderId}`;
    const entry = parseFloat(t.avgEntryPrice);
    await dbFetch('POST', 'trades?on_conflict=user_id,external_id', [{
      user_id: userId,
      date: closedDate, symbol: t.symbol, type: 'Crypto', dir,
      entry,
      exit: parseFloat(t.avgExitPrice),
      size: round2(closedNotional),
      realized_exit_value: round2(exitValue),
      closes: [fill],
      fees: fill.fee,
      closed_at: toIso(t.updatedTime),
      sl: null, tp: null,
      source: 'bybit',
      external_id: externalId,
      notes: syncNote([fill], false),
    }]);
    mergedThisRun.set(mergeKey, { externalId, entry, size: closedNotional, exitValue, closes: [fill] });
    imported++;
  }

  // 3. Rows still tracked as open whose position is gone from Bybit and
  //    whose close didn't match above. Retire their open key so they can
  //    never absorb some future position's close by mistake.
  const tracked = await dbFetch(
    'GET',
    `trades?user_id=eq.${userId}&external_id=like.${encodeURIComponent('bybit-open:*')}&select=id,external_id,notes`
  );
  for (const row of tracked || []) {
    if (positionsByKey.has(row.external_id)) continue;
    await dbFetch('PATCH', `trades?id=eq.${row.id}`, {
      external_id: `bybit-stale:${row.id}`,
      notes: appendNote(row.notes, STALE_NOTE),
    });
    updated++;
  }

  return { imported, updated };
}

module.exports = { bybitGet, syncBybitPositions, openKeyFor, normalizedSupabaseUrl };
