// ═══════════════════════════════════════════════════════════════════════════
// Live crypto prices (CoinGecko) for holdings and open trades.
// ═══════════════════════════════════════════════════════════════════════════

// ─── LIVE CRYPTO PRICES (CoinGecko Pro) ──────────────────────────────────────
const CG_KEY = APP_CONFIG.COINGECKO_API_KEY;
const CG_BASE = 'https://api.coingecko.com/api/v3';
const CG_HEADERS = { 'x-cg-demo-api-key': CG_KEY };

// Well-known overrides to avoid ambiguity (symbol → coingecko id)
const CG_OVERRIDES = {
  BTC:'bitcoin', ETH:'ethereum', SOL:'solana', BNB:'binancecoin',
  XRP:'ripple', ADA:'cardano', DOGE:'dogecoin', MATIC:'matic-network',
  AVAX:'avalanche-2', DOT:'polkadot', LINK:'chainlink', UNI:'uniswap',
  LTC:'litecoin', ATOM:'cosmos', FTM:'fantom', NEAR:'near',
  ALGO:'algorand', VET:'vechain', SHIB:'shiba-inu', TON:'the-open-network',
  PEPE:'pepe', WIF:'dogwifcoin', BONK:'bonk', JUP:'jupiter-exchange-solana',
  OP:'optimism', ARB:'arbitrum', SUI:'sui', INJ:'injective-protocol',
  TIA:'celestia', SEI:'sei-network', PYTH:'pyth-network', RENDER:'render-token',
  FET:'fetch-ai', GRT:'the-graph', AAVE:'aave', MKR:'maker',
  CRV:'curve-dao-token', SNX:'synthetix-network-token', COMP:'compound-governance-token',
  SUSHI:'sushi', YFI:'yearn-finance', BAT:'basic-attention-token',
  CHZ:'chiliz', XLM:'stellar', TRX:'tron', XMR:'monero',
  BCH:'bitcoin-cash', ETC:'ethereum-classic', LDO:'lido-dao',
  STETH:'staked-ether', WBTC:'wrapped-bitcoin', APT:'aptos',
};

// Cache: symbol → coingecko id (session only)
let symbolIdCache = JSON.parse(sessionStorage.getItem('cg_id_cache') || '{}');

function cleanSymbol(raw) {
  return (raw || '').toUpperCase()
    .replace('/USDT','').replace('/USDC','').replace('/USD','')
    .replace('/BTC','').replace('/ETH','').trim();
}

// Exchange contract symbol → coin + price multiplier: "BTCUSDT" → BTC ×1,
// "1000PEPEUSDT" → PEPE ×1000 (Bybit quotes those per 1000 coins, so the
// CoinGecko per-coin price has to be scaled to compare with the entry).
function tradePriceKey(raw) {
  let s = cleanSymbol(raw);
  if (!/[/]/.test(raw || '')) s = s.replace(/(USDT|USDC|BUSD|PERP)$/, '') || s;
  let mult = 1;
  const m = s.match(/^(1000000|10000|1000)(?=[A-Z])/);
  if (m) { mult = parseInt(m[1], 10); s = s.slice(m[1].length); }
  return { sym: s, mult };
}

function livePriceForTrade(t) {
  if (t.type !== 'Crypto') return null;
  const { sym, mult } = tradePriceKey(t.symbol);
  return livePrices[sym] ? livePrices[sym].price * mult : null;
}

// Open trade's P&L at the live price (on the size still open), or null
function unrealizedPnl(t) {
  if (t.status !== 'Open') return null;
  const price = livePriceForTrade(t);
  return price ? fillPnl(t.dir, t.entry, price, t.size) : null;
}

// Resolve unknown symbols via CoinGecko search (one call per unknown symbol)
async function resolveSymbolIds(symbols) {
  const unknown = symbols.filter(s => !symbolIdCache[s] && !CG_OVERRIDES[s]);
  for (const sym of unknown) {
    try {
      const res = await fetch(`${CG_BASE}/search?query=${encodeURIComponent(sym)}`, { headers: CG_HEADERS });
      if (!res.ok) continue;
      const data = await res.json();
      // Pick first coin whose symbol matches exactly
      const match = (data.coins || []).find(c => c.symbol.toUpperCase() === sym);
      if (match) {
        symbolIdCache[sym] = match.id;
      }
    } catch(e) {
      log.warn('CoinGecko search failed for', sym, e.message);
    }
  }
  try {
    sessionStorage.setItem('cg_id_cache', JSON.stringify(symbolIdCache));
  } catch (e) {
    log.warn('Failed to persist symbol ID cache to sessionStorage:', e.message);
  }
}

async function fetchLivePrices() {
  // Crypto holdings + open crypto trades (for their unrealized P&L)
  const symbols = [...new Set([
    ...HOLDINGS.filter(h => h.type === 'Crypto').map(h => cleanSymbol(h.symbol)),
    ...TRADES.filter(t => t.type === 'Crypto' && t.status === 'Open').map(t => tradePriceKey(t.symbol).sym),
  ].filter(Boolean))];
  if (symbols.length === 0) return;

  setPriceStatus('fetching');

  // Resolve unknown symbols
  await resolveSymbolIds(symbols);

  // Build id list: overrides first, then cache
  const ids = symbols.map(s => CG_OVERRIDES[s] || symbolIdCache[s]).filter(Boolean);
  if (ids.length === 0) { setPriceStatus('error'); return; }

  try {
    const res = await fetch(
      `${CG_BASE}/simple/price?ids=${ids.join(',')}&vs_currencies=usd&include_24hr_change=true`,
      { headers: CG_HEADERS }
    );
    if (!res.ok) throw new Error('CoinGecko ' + res.status);
    const data = await res.json();

    // Map results back to symbols
    symbols.forEach(sym => {
      const id = CG_OVERRIDES[sym] || symbolIdCache[sym];
      // no longer quoted → drop the old price instead of showing it as LIVE
      if (!(id && data[id] && data[id].usd)) {
        delete livePrices[sym];
        HOLDINGS.forEach(h => { if (h.type === 'Crypto' && cleanSymbol(h.symbol) === sym) h.livePrice = false; });
      }
      if (id && data[id] && data[id].usd) {
        livePrices[sym] = {
          price: data[id].usd,
          change24h: data[id].usd_24h_change || 0,
        };
      }
    });

    // Apply live prices to HOLDINGS
    HOLDINGS.forEach(h => {
      if (h.type !== 'Crypto') return;
      const sym = cleanSymbol(h.symbol);
      if (livePrices[sym]) {
        h.curPrice = livePrices[sym].price;
        h.livePrice = true;
      }
    });

    lastPriceUpdate = new Date();
    setPriceStatus('live');
    renderAll();
  } catch (e) {
    log.warn('Live price fetch failed:', e.message);
    setPriceStatus('error');
  }
}

function setPriceStatus(status) {
  const el = document.getElementById('price-status');
  if (!el) return;
  const map = {
    fetching: { text: '⟳ Fetching prices…', color: 'var(--muted)' },
    live:     { text: `● Live · ${new Date().toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}`, color: 'var(--green)' },
    error:    { text: '⚠ Price fetch failed', color: 'var(--amber)' },
  };
  const s = map[status] || map.error;
  el.textContent = s.text;
  el.style.color = s.color;
}

function startPriceRefresh() {
  fetchLivePrices();
  if (priceRefreshTimer) clearInterval(priceRefreshTimer);
  priceRefreshTimer = setInterval(fetchLivePrices, 60000); // refresh every 60s
}

