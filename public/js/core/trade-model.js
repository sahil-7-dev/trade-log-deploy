// ═══════════════════════════════════════════════════════════════════════════
// Trade model: normalizing rows, partial-close math, colors per asset.
// ═══════════════════════════════════════════════════════════════════════════

// ─── NORMALIZE TRADE ──────────────────────────────────────────────────────────
// Normalize trade fields from DB (generated columns come back from Supabase)
// pnl is NET of fees (the net_pnl column, once migrated) — every stat, the
// trading balance and Win/Loss use it; grossPnl keeps the price-move P&L.
function normalizeTrade(t) {
  const gross = parseFloat(t.pnl) || 0;
  return {
    ...t,
    entry: parseFloat(t.entry),
    exit: t.exit != null ? parseFloat(t.exit) : null,
    size: parseFloat(t.size),
    pnl: t.net_pnl != null ? (parseFloat(t.net_pnl) || 0) : gross,
    grossPnl: gross,
    fees: parseFloat(t.fees) || 0,
    buyFee: t.buy_fee != null ? parseFloat(t.buy_fee) : null,
    sellFee: t.sell_fee != null ? parseFloat(t.sell_fee) : null,
    mistakes: Array.isArray(t.mistakes) ? t.mistakes : [],
    rr: t.rr != null ? parseFloat(t.rr) : null,
    sl: t.sl != null ? parseFloat(t.sl) : null,
    tp: t.tp != null ? parseFloat(t.tp) : null,
    original_size: t.original_size != null ? parseFloat(t.original_size) : null,
    realized_exit_value: parseFloat(t.realized_exit_value) || 0,
    closes: Array.isArray(t.closes) ? t.closes : [],
  };
}

// ─── PARTIAL CLOSES ───────────────────────────────────────────────────────────
// A position stays ONE trade for its whole life. Closing part of it records a
// fill in t.closes and shrinks t.size to what's still open — the trade stays
// Open, so it's left out of every stat. Closing the rest sets exit to the
// size-weighted average of all fills and size back to original_size, and only
// then does it count (P&L, win rate, trading balance...) as one trade.

// For an Open trade with partial closes: how much has been closed so far and
// what it realized. null when nothing has been closed yet (or trade is closed).
function partialCloseInfo(t) {
  if (t.status !== 'Open') return null;
  if (t.closes.length) {
    const closedSize = t.closes.reduce((s, f) => s + (parseFloat(f.size) || 0), 0);
    // net of each fill's fees, same as closed trades
    const realized = t.closes.reduce((s, f) => s + (parseFloat(f.pnl) || 0) - (parseFloat(f.fee) || 0), 0);
    return { closedSize, realized, fills: t.closes.length, originalSize: t.original_size || (t.size + closedSize) };
  }
  // Rows partially closed by an older Bybit sync, before fills were recorded
  if (t.original_size && t.original_size > t.size && t.realized_exit_value > 0) {
    const closedSize = t.original_size - t.size;
    const realized = t.dir === 'Long' ? t.realized_exit_value - closedSize : closedSize - t.realized_exit_value;
    return { closedSize, realized, fills: null, originalSize: t.original_size };
  }
  return null;
}

// Realized P&L of one fill: size is entry-side $, so the price move as a
// fraction of entry, times size.
function fillPnl(dir, entry, exit, size) {
  return parseFloat(((dir === 'Long' ? (exit - entry) : (entry - exit)) / entry * size).toFixed(2));
}

function assetColor(sym) {
  const map = { BTC: '#F7931A', ETH: '#627EEA', SOL: '#9945FF', BNB: '#F3BA2F', ADA: '#0033AD', NVDA: '#76B900', AAPL: '#555', MSFT: '#00A4EF', SPY: '#4A9EFF', GOLD: '#FFD700' };
  return map[(sym||'').toUpperCase()] || '#8B8FA8';
}

function showLoading(on) {
  document.getElementById('loading-bar').style.display = on ? 'block' : 'none';
}

