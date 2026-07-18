# Bybit Derivatives Auto-Sync

Automatically journal every Bybit derivatives position — opened, still open, or closed — into TradeLog. Covers both ways to run it (manual button vs. fully automated), the exact rules applied, setup, and the security model. Working code: `api/_bybit-shared.js`, `api/bybit-sync.js`, `api/bybit-cron.js`, `sql/schema.sql`.

## Two ways to run this

| | Manual button | Automated (no button) |
|---|---|---|
| **File** | `api/bybit-sync.js` | `api/bybit-cron.js` |
| **Auth** | Your own session token | Supabase `service_role` key |
| **Respects RLS?** | Yes — same as every other request | No — bypasses RLS entirely |
| **Trigger** | You click "Sync Bybit" | A scheduler hits the endpoint on a timer |
| **Setup effort** | Just env vars | Env vars + a scheduler (see below) |

Start with the manual button — it's simpler and lower-privilege. Move to automated only once you're comfortable with what a service-role key means (see the security section).

## Why this can't be client-side

Your Bybit API secret must never reach the browser — anyone who can view page source or inspect network requests can read anything sitting in client-side JS, no matter how it's disguised. Both sync paths run as **Vercel serverless functions**: server-only code that reads `BYBIT_API_KEY`/`BYBIT_API_SECRET` from environment variables and only ever sends the browser a JSON summary like `{ imported: 3, updated: 1 }`.

## Architecture

```
┌──────────┐  click "Sync Bybit"   ┌──────────────────┐   HMAC-signed    ┌───────┐
│  Browser │ ────────────────────► │ bybit-sync.js    │ ───────────────► │ Bybit │
└──────────┘ ◄── { imported, updated } └───────┬────────┘ ◄────────────── └───────┘
                                                │
                          scheduler (cron / GH Actions)
                                                │
                                     ┌──────────▼──────────┐
                                     │   bybit-cron.js     │──► Bybit (same as above)
                                     │ (service_role key)  │
                                     └──────────┬───────────┘
                                                │
                              both paths share: _bybit-shared.js
                                     (open+close matching logic)
                                                │
                                                ▼
                                          ┌───────────┐
                                          │ Supabase  │
                                          │  trades   │
                                          └───────────┘
```

Both entry points call the exact same `syncBybitPositions()` function in `api/_bybit-shared.js` — there's one copy of the actual matching logic, not two slightly-different implementations to keep in sync.

## What actually happens on each sync

1. **Fetch recently closed positions** from Bybit (`/v5/position/closed-pnl`). For each one, check whether an "Open" row already exists for that position. If the closed amount covers the whole tracked size, **update that row in place** (fill in exit price, close date, switch it to a permanent closed-record ID). If it only covers part of it — a partial close — insert a separate, correctly-sized trade for just that portion and reduce the tracked open row's size instead of closing it. If no open row exists at all, insert it as a complete already-closed trade.
2. **Fetch currently open positions** (`/v5/position/list`). For each one not already tracked, insert a new trade row with `exit: null` — which the existing schema already renders as `status = 'Open'`, no changes needed there.

This means opening a position gets it into the Trade Log (as Open) on the *next* sync after you open it, and closing it updates that same row (rather than creating a duplicate) on the next sync after you close it. "Next sync" is either whenever you click the button, or however often your automation runs — see below for what "automatic" actually costs to make frequent.

### The matching problem, and how it's solved

Bybit doesn't give a position one stable ID across its whole lifetime the way a single order does. To match an open row to its later close, each currently-open position gets a deterministic key: `bybit-open:{symbol}:{side}:{positionIdx}`. When that same symbol+side later shows up in the closed-positions feed, the matching open row (if any) gets updated and its key permanently swapped to `bybit-closed:{orderId}` — so it can never be matched or touched again by the open-position step.

**Known edge cases this doesn't specially handle:**
- **Partial closes are handled as their own trade.** Taking 50% off a position to reduce risk, for example, gets logged as a complete, correctly-sized closed trade for just that portion — not folded into (or mistaken for) the position's eventual full close. Detected by comparing the notional value Bybit reports as closed in that specific event (`cumEntryValue`) against the tracked open row's current size: if it covers the whole tracked size (within a small rounding tolerance), that's a full close; otherwise the open row's size is reduced by exactly what closed, and it stays Open — so a second partial close, or the eventual final close, still matches correctly against the right remaining amount.
- **Hedge mode** (simultaneous long+short on the same symbol) is disambiguated via `positionIdx`, which Bybit assigns per side in hedge mode — should work correctly, but I haven't been able to test this against a real hedge-mode account.
- **A position closing and a new one opening on the same symbol+side between two poll cycles** could theoretically race — the close-matching step runs before the open-scanning step specifically to reduce this, but with infrequent polling (e.g. once a day) it's more likely to matter than with frequent polling.

## The rules, exactly as specified

- **A trade closed without a matching SL/TP gets `sl = tp = null`.** Both sync paths always import with null SL/TP (see "Known limitation" below on why) — which means Postgres's generated `rr` column stays null too: no risk defined, no R:R computed. `pnl` and `status` are still computed normally, so it still "cuts or adds" to your P&L, just without an R:R figure.
- **Breakeven detection needs zero special-casing.** The schema already flags `status = 'Breakeven'` whenever `exit = entry` exactly, regardless of whether the trade was logged by hand or synced.
- **Breakeven P&L still rolls into total P&L / trading balance** — it's a display category, not an exclusion (see `computeStats()` in `app.js`).

## Setup — manual button (do this first)

### 1. Create a read-only Bybit API key
Bybit → API Management → Create New Key. **Permissions: read-only.** Do not enable Trade/Withdraw/Transfer — this only ever reads closed-pnl and position-list data. IP-restrict to Vercel's outbound ranges if your plan exposes static IPs.

### 2. Run the schema migration
Already in the full `sql/schema.sql` for fresh setups. For an existing `trades` table:
```sql
alter table trades add column if not exists source text default 'manual';
alter table trades add column if not exists external_id text;
alter table trades add constraint uq_trades_external_id unique (user_id, external_id);
```

### 3. Add Vercel env vars
```
BYBIT_API_KEY
BYBIT_API_SECRET
```
Redeploy after adding them.

### 4. Wire the button
```html
<button class="btn btn-ghost" data-action="sync-bybit" style="font-size:11px">⟳ Sync Bybit</button>
```
```js
async function syncBybit() {
  const btn = document.querySelector('[data-action="sync-bybit"]');
  if (btn) { btn.textContent = 'Syncing…'; btn.disabled = true; }
  try {
    const token = userToken || localStorage.getItem('sb_token') || '';
    const res = await fetch('/api/bybit-sync', { method: 'POST', headers: { 'Authorization': `Bearer ${token}` } });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    toast(`Synced ✓ ${data.imported} imported, ${data.updated} updated`);
    await loadAllData();
  } catch (e) { toast(e.message, 'err'); }
  if (btn) { btn.textContent = '⟳ Sync Bybit'; btn.disabled = false; }
}
```
`case 'sync-bybit': syncBybit(); break;` in the click dispatcher, same pattern as every other button.

Test it: click the button, then check Supabase → Table Editor → `trades` filtered to `source = eq.bybit`. Re-clicking with nothing new on Bybit should report `imported: 0, updated: 0` — that's the idempotency working, not a failure.

## Setup — full automation (optional, higher privilege)

This is what makes it truly automatic (open a position on Bybit → it shows up without touching anything). It requires a **Supabase `service_role` key**, which is meaningfully more dangerous than what the rest of this app uses:

> The `service_role` key bypasses Row Level Security **completely** — for every table, every user, not just yours. It is the single highest-privilege credential this app could possibly hold. Treat it like a root password: Vercel env var only, never logged, never in any client-reachable code path.

That's why `api/bybit-cron.js` is a separate file from the manual button, hardcoded to one target user rather than looping over "all users" — this integration is designed for one person syncing their own account, not a general "everyone connects their own exchange" feature (that would need per-user encrypted credential storage, a substantially bigger feature than this).

### 1. Add these Vercel env vars
```
SUPABASE_SERVICE_ROLE_KEY   — Supabase → Settings → API → service_role (NOT anon)
TRADELOG_SYNC_USER_ID       — your own Supabase auth user_id (Table Editor → auth.users)
CRON_SECRET                 — any random string you generate yourself
```

`CRON_SECRET` is what stops a stranger from finding `/api/bybit-cron`'s URL and triggering syncs — the handler rejects any request that doesn't send `Authorization: Bearer <CRON_SECRET>` exactly.

### 2. Pick a scheduler — and know the real constraint before choosing

**Vercel's built-in cron is plan-gated in a way that matters here:** the Hobby (free) plan only allows cron schedules that run **once per day**, and even that one run can fire anywhere within the scheduled hour, not at an exact time. Anything more frequent (`*/5 * * * *`, hourly, etc.) **fails at deploy time** on Hobby — not silently ignored, the whole deployment breaks. Per-minute schedules need Vercel Pro ($20/mo).

That's exactly why this repo does **not** ship a `crons` block in `vercel.json` by default — adding one that's too frequent would break your next deploy if you're on Hobby, which is the likely case for a personal project.

**Option A — Vercel Cron, once a day (free, works on Hobby):**
```json
"crons": [{ "path": "/api/bybit-cron", "schedule": "0 0 * * *" }]
```
Add this to `vercel.json` yourself if once-daily is enough for you.

**Option B — Vercel Cron, frequent (needs Pro):**
```json
"crons": [{ "path": "/api/bybit-cron", "schedule": "*/5 * * * *" }]
```
Only add this if you've actually upgraded to Pro — otherwise this exact line is what breaks your deployment.

**Option C — GitHub Actions, frequent, free (recommended default).** A ready-to-use workflow is already at `.github/workflows/bybit-sync.yml` — it's a normal HTTPS request to your `/api/bybit-cron` endpoint made from GitHub's infrastructure on a schedule, so Vercel's plan restrictions don't apply to it at all (Vercel doesn't care who calls its API routes, only its *own* built-in scheduler is plan-gated). Setup:
1. GitHub repo → Settings → Secrets and variables → Actions → add `DEPLOY_URL` (your Vercel URL) and `CRON_SECRET` (same value as the Vercel env var).
2. Done — it runs automatically once committed. GitHub Actions' schedule triggers are best-effort too (expect a few minutes of drift, not second-level precision), which is fine for this use case.

## Known limitation: P&L won't match Bybit's number exactly

Bybit's `closedPnl` includes trading fees and funding payments; TradeLog's `pnl` is a Postgres generated column computed from `entry`/`exit`/`size`/`dir` — the same formula every manually-logged trade uses, which doesn't account for fees, to stay consistent across the whole log. Expect small discrepancies (typically a few tenths of a percent). Bybit's fee-inclusive figure is preserved in the trade's `notes` field, so it isn't lost — just not what drives the dashboard numbers.

## Known limitation: SL/TP aren't imported

Bybit's position/closed-pnl data doesn't include the conditional stop/take-profit orders that may have been attached to a position — those live separately in order history and would need correlating by symbol + time window to reconstruct reliably (partial fills and order modifications make this genuinely fiddly to get right). Both sync paths leave `sl`/`tp` null for every synced trade, which — per the rules above — is exactly the documented "no SL/TP set" behavior, not missing functionality.

## Want truly instant (sub-second) updates instead of polling?

Everything above is **polling** — checking Bybit every N minutes, however small N is. Bybit also has a WebSocket API that pushes position/order updates the instant they happen, which would be genuinely instant rather than "checked recently." The reason this repo doesn't implement that: a WebSocket needs a connection that stays open continuously, and Vercel serverless functions are the opposite of that by design — they spin up per request and terminate immediately after responding. Real-time push would need actual always-on hosting (a small persistent Node process on something like Railway, Render, or Fly.io) — a genuine infrastructure change, not a config addition, and out of scope for what's built here.
