// ═══════════════════════════════════════════════════════════════════════════
// Full JSON backup of every table (Settings → Your data).
// ═══════════════════════════════════════════════════════════════════════════

// ─── FULL BACKUP (JSON) ──────────────────────────────────────────────────────
async function downloadBackup() {
  const backup = { app: 'TradeLog', format: 1, exported_at: new Date().toISOString() };
  try {
    if (isDemoMode || !currentUser) {
      Object.assign(backup, { demo: true, trades: TRADES, investments: HOLDINGS, fund_transactions: FUNDS,
        realized_positions: realizedHistory, portfolio_snapshots: SNAPSHOTS,
        user_settings: { cash_balance: cashBalance, trading_balance: tradingBalance, preferences: PREFS } });
    } else {
      // Straight from the database, exactly as stored
      // every table in full (paged past the 1,000-row cap); a table that
      // fails to load fails the whole backup rather than leaving a hole
      const get = async (path, optional) => {
        const res = await sbGetAll(path);
        if (res.ok) return res.rows;
        if (optional) return null; // table not created yet (migration not run)
        throw new Error(`couldn't read ${path.split('?')[0]} (${res.status})`);
      };
      const [trades, investments, settings, profile, funds, realized, snaps] = await Promise.all([
        get('trades?select=*&order=date.asc,id.asc'), get('investments?select=*&order=id.asc'),
        get(`user_settings?user_id=eq.${currentUser.id}&select=*`), get(`profiles?user_id=eq.${currentUser.id}&select=*`),
        get('fund_transactions?select=*&order=date.asc,id.asc', !DB_READY), get('realized_positions?select=*&order=date.asc,id.asc', !DB_READY),
        get('portfolio_snapshots?select=*&order=date.asc', !DB_READY),
      ]);
      Object.assign(backup, { account: currentUser.email, trades, investments, user_settings: settings && settings[0],
        profile: profile && profile[0], fund_transactions: funds, realized_positions: realized, portfolio_snapshots: snaps });
    }
    downloadFile(`tradelog-backup-${localToday()}.json`, JSON.stringify(backup, null, 2), 'application/json');
    toast('Backup downloaded ✓');
  } catch (e) {
    toast('Backup failed: ' + e.message, 'err');
  }
}
ACTIONS['download-backup'] = () => downloadBackup();
