// ═══════════════════════════════════════════════════════════════════════════
// Risk page: drawdown (underwater) chart, rolling 20-trade win rate and
// expectancy (separate charts — never two scales on one), R-multiple
// distribution, open exposure and risk to stops, today's loss vs the limit.
// ═══════════════════════════════════════════════════════════════════════════

registerPage('risk', {
  title: 'Risk', subtitle: 'Drawdowns, consistency and exposure', icon: '◬', section: 'Trading', order: 5,
  render: renderRiskPage,
});

const ROLLING_WINDOW = 20;

// Open trade's money at risk if its stop is hit (null without a stop)
function riskToStop(t) {
  if (t.sl == null || !t.entry) return null;
  const adverse = t.dir === 'Long' ? t.entry - t.sl : t.sl - t.entry;
  return adverse > 0 ? adverse / t.entry * t.size : 0; // stop past entry = locked in, no risk
}

function renderRiskPage(ctx) {
  const s = ctx.stats;
  const { start, base, points } = equityPath(s.closed);

  // ── Drawdown series (% below running peak)
  let peak = start, maxDdAmt = 0;
  const dd = points.map(p => {
    peak = Math.max(peak, p.equity);
    maxDdAmt = Math.max(maxDdAmt, peak - p.equity);
    return peak > 0 ? round2((p.equity - peak) / peak * 100) : 0;
  });
  const currentDd = dd.length ? dd[dd.length - 1] : 0;
  lineChart('drawdownChart', points.map(p => p.t.date), [{ label: 'Drawdown', data: dd, color: CHART.loss, fill: true }],
    { format: v => v.toFixed(2) + '%', yAxis: { max: 0, ticks: { callback: v => v + '%' } }, empty: !points.length || base <= 0 });

  // ── Losing streak (longest run of losses in close order; same rule as everywhere: breakeven ends a run)
  const longest = Math.abs(s.worstStreak);

  // ── Open exposure
  const open = TRADES.filter(t => t.status === 'Open');
  const exposure = sum(open, t => t.size);
  const risks = open.map(riskToStop);
  const atRisk = sum(risks.filter(v => v != null));
  const noStop = risks.filter(v => v == null).length;
  const bal = tradingBalance > 0 ? tradingBalance : null;
  const pctOf = v => bal ? (v / bal * 100).toFixed(1) + '%' : '—';

  setHtml('risk-kpis', [
    statTile({ label: 'Current drawdown', value: currentDd ? currentDd.toFixed(1) + '%' : '0%', cls: currentDd < 0 ? 'red' : 'green',
      sub: currentDd < 0 ? 'below the last equity high' : 'at an equity high', spark: dd.slice(-30), sparkColor: CHART.loss }),
    statTile({ label: 'Max drawdown', value: s.maxDrawdown ? s.maxDrawdown.toFixed(1) + '%' : '—', cls: 'red',
      sub: maxDdAmt ? bv('−' + fmtMoney(maxDdAmt)) + ' from peak' : 'none in this period' }),
    statTile({ label: 'Longest losing streak', value: longest ? `${longest} trade${longest !== 1 ? 's' : ''}` : '—', cls: longest >= 5 ? 'red' : '',
      sub: 'plan for this happening again' }),
    statTile({ label: 'Avg loss', value: s.losses.length ? bv(fmt(s.avgLoss)) : '—', cls: 'red',
      sub: s.avgWin && s.avgLoss ? `avg win is ${(s.avgWin / Math.abs(s.avgLoss)).toFixed(2)}× bigger` : '' }),
    statTile({ label: 'Open exposure', value: open.length ? bv(fmtMoney(exposure)) : '—', sub: open.length ? `${pctOf(exposure)} of balance · ${open.length} open` : 'no open trades',
      tip: 'Total position size of open trades. Above 100% of your balance means leverage.' }),
    statTile({ label: 'Risk to stops', value: open.length ? bv(fmtMoney(atRisk)) : '—', cls: atRisk ? 'amber' : '',
      sub: open.length ? `${pctOf(atRisk)} of balance${noStop ? ` · ${noStop} without a stop ⚠` : ''}` : '—',
      tip: 'What you lose if every open trade hits its stop loss. Trades without a stop are not counted — their risk is unlimited.' }),
  ].join(''));

  // ── Rolling 20-trade win rate & expectancy (two charts, one scale each)
  const chrono = chronological(s.closed);
  const rollLabels = [], rollWr = [], rollEx = [];
  for (let i = ROLLING_WINDOW; i <= chrono.length; i++) {
    const win = chrono.slice(i - ROLLING_WINDOW, i);
    const w = win.filter(t => t.status === 'Win').length, l = win.filter(t => t.status === 'Loss').length;
    rollLabels.push(chrono[i - 1].date);
    rollWr.push(w + l ? round2(w / (w + l) * 100) : null);
    rollEx.push(round2(sum(win, t => t.pnl) / win.length));
  }
  const tooFew = `Needs ${ROLLING_WINDOW}+ closed trades (you have ${chrono.length})`;
  lineChart('rollingWinChart', rollLabels, [{ label: 'Win rate', data: rollWr, color: CHART.series[0] }],
    { format: v => v.toFixed(1) + '%', yAxis: { min: 0, max: 100, ticks: { callback: v => v + '%' } }, empty: !rollLabels.length,
      opts: {} });
  lineChart('rollingExpChart', rollLabels, [{ label: 'Expectancy', data: rollEx, color: CHART.series[2], fill: true }],
    { empty: !rollLabels.length });
  ['rollingWinChart', 'rollingExpChart'].forEach(id => {
    const ov = document.getElementById(id) && document.getElementById(id).parentElement.querySelector('.chart-empty');
    if (ov) ov.textContent = tooFew;
  });

  // ── R-multiple distribution
  const rs = s.closed.filter(t => t.rr != null).map(t => t.rr);
  const h = histogram(rs, [-2, -1, 0, 1, 2, 3], (lo, hi) => lo == null ? '< −2R' : hi == null ? '≥ 3R' : `${lo}R…${hi}R`);
  barChart('rDistChart', h.labels, h.counts, {
    colors: h.labels.map((_, i) => i < 3 ? CHART.loss : CHART.profit), label: 'Trades',
    format: v => `${v} trade${v !== 1 ? 's' : ''}`, axis: { ticks: { precision: 0 } }, empty: !rs.length,
  });
  const ov = document.getElementById('rDistChart') && document.getElementById('rDistChart').parentElement.querySelector('.chart-empty');
  if (ov) ov.textContent = 'Add stop losses to your trades to see results in R';

  // ── Exposure table
  setText('exposure-meta', open.length ? `${open.length} open · ${fmtMoney(exposure)}` : '');
  setHtml('exposure-body', open.length ? open.map((t, i) => {
    const r = risks[i], u = unrealizedPnl(t);
    return `<tr>
      <td style="font-weight:600"><span class="trade-link" data-action="open-trade-detail" data-id="${esc(t.id)}">${esc(t.symbol)}</span></td>
      <td><span class="badge ${t.dir === 'Long' ? 'badge-long' : 'badge-short'}">${esc(t.dir)}</span></td>
      <td class="num"><span class="balance-val">${fmtMoney(t.size)}</span></td>
      <td class="num">${pctOf(t.size)}</td>
      <td class="num">${t.sl ?? '<span class="amber" data-tip="No stop loss — risk is unlimited">none ⚠</span>'}</td>
      <td class="num ${r ? 'amber' : ''}">${r == null ? '—' : `<span class="balance-val">${fmtMoney(r)}</span> <span class="muted">${pctOf(r)}</span>`}</td>
      <td class="num ${u > 0 ? 'green' : u < 0 ? 'red' : ''}">${u != null ? `<span class="balance-val">${fmt(u)}</span>` : '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="7">${emptyState('◌', 'Nothing open', 'Open trades and their risk to stop show here.')}</td></tr>`);

  setHtml('risk-goals', goalsHtml());
}
