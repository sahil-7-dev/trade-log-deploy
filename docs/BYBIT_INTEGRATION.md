# Bybit Derivatives Auto-Sync

Automatically journal every closed Bybit derivatives trade into TradeLog — no manual entry. This doc covers the architecture, exact rules applied, setup steps, and the security model. The working code lives at `api/bybit-sync.js` (a Vercel serverless function) and `sql/schema.sql` (already updated with the columns this needs).

## Why this can't be a client-side feature

Your Bybit API secret must never reach the browser. Anyone who can view your page's source, inspect network requests, or use dev tools can read anything sitting in client-side JavaScript — no amount of obfuscation changes that. The only safe place for the secret is a server that the browser talks to over HTTPS but never sees the internals of.

That's what `api/bybit-sync.js` is: a **Vercel serverless function**. It runs on Vercel's infrastructure, reads `BYBIT_API_KEY`/`BYBIT_API_SECRET` from environment variables (same mechanism as `SUPABASE_URL` etc. — see `scripts/build.js`), and only ever sends the browser a JSON summary (`{ imported: 12 }`), never the credentials themselves.

## Architecture

```
┌──────────┐   click "Sync Bybit"   ┌────────────────────┐   HMAC-signed    ┌───────┐
│  Browser │ ─────────────────────► │ /api/bybit-sync.js │ ───────────────► │ Bybit │
│ (app.js) │                        │  (Vercel function)  │ ◄─────────────── │  API  │
└──────────┘ ◄───── { imported: N } └──────────┬──────────┘  closed trades  └───────┘
                                                │
                                     upsert (on_conflict=user_id,external_id)
                                                ▼
                                          ┌───────────┐
                                          │ Supabase  │
                                          │  trades   │
                                          └───────────┘
```

The browser never talks to Bybit directly. It calls your own `/api/bybit-sync` endpoint (passing the user's existing Supabase session token, exactly like every other authenticated request this app already makes), and that endpoint does the Bybit call + Supabase upsert server-side.

## The rules, exactly as specified

- **A trade closed without a matching SL/TP gets `sl = tp = null`.** This isn't missing data — it means Postgres's `rr` (generated column) stays `null` for that trade too, because there's no risk defined to compute an R:R against. `pnl` and `status` are still computed normally. In short: no SL/TP → still logs the P&L, just with no R:R attached — matching exactly how a manually-logged trade with no stop-loss already behaves.
- **Breakeven detection needs zero special-casing.** The schema already flags `status = 'Breakeven'` whenever `exit = entry` exactly (see the "Breakeven Trades" feature — same rule applies uniformly whether a trade was logged by hand or synced from Bybit).
- **Breakeven P&L still rolls into total P&L / trading balance.** It's a display category for clarity, not an exclusion — `computeStats()` already sums it into `totalPnl` regardless of status.

## Setup

### 1. Create a read-only Bybit API key

Bybit → API Management → Create New Key.

- **Permissions: read-only.** Do not enable Trade, Withdraw, or Transfer permissions for this key — this integration only ever reads your closed position history, it never places or modifies orders. A read-only key means that even if it somehow leaked, nothing could be traded or withdrawn with it.
- If your Bybit plan supports IP allowlisting, restrict the key to Vercel's outbound IP ranges. Not all Vercel plans expose static outbound IPs — check your plan before relying on this.

### 2. Run the schema migration

Already included in the full `sql/schema.sql` if you're setting up fresh. If you have an existing `trades` table, run just this:

```sql
alter table trades add column if not exists source text default 'manual';
alter table trades add column if not exists external_id text;
alter table trades add constraint uq_trades_external_id unique (user_id, external_id);
```

The unique constraint is what makes syncing idempotent — running the sync twice never creates duplicate trades. It's a plain (non-partial) constraint deliberately: SQL treats every `NULL` as distinct from every other `NULL`, so your existing manually-logged trades (`external_id` always null) are completely unaffected by it.

### 3. Add environment variables in Vercel

Project → Settings → Environment Variables:

```
BYBIT_API_KEY
BYBIT_API_SECRET
```

Same place `SUPABASE_URL` and friends already live. Redeploy after adding them.

### 4. Wire up the frontend button

Add a button anywhere sensible (Trade Log page topbar is a natural spot) and a small handler in `app.js`:

```html
<button class="btn btn-ghost" data-action="sync-bybit" style="font-size:11px">⟳ Sync Bybit</button>
```

```js
async function syncBybit() {
  const btn = document.querySelector('[data-action="sync-bybit"]');
  if (btn) { btn.textContent = 'Syncing…'; btn.disabled = true; }
  try {
    const res = await fetch('/api/bybit-sync', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${userToken}` }
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Sync failed');
    toast(`Synced ✓ ${data.imported} trade${data.imported === 1 ? '' : 's'} imported`);
    await loadAllData(); // pulls the newly-imported trades into TRADES
  } catch (e) {
    toast(e.message, 'err');
  }
  if (btn) { btn.textContent = '⟳ Sync Bybit'; btn.disabled = false; }
}
```

Add `case 'sync-bybit': syncBybit(); break;` to the click dispatcher in `app.js`, same pattern as every other button in the app.

This gives you a manual "Sync Bybit" button — click it, it pulls everything closed since your last sync. That's the safer, simpler design, and what `api/bybit-sync.js` implements as-is.

## Going further: true "fully automated, no button" sync

The manual button above is deliberately the default here, and worth understanding *why* before reaching for full automation:

`api/bybit-sync.js` authenticates the request using **the logged-in user's own Supabase session token** — the same one already sitting in `localStorage` after sign-in. That's what lets it write to `trades` while still respecting Row Level Security normally (it can only ever write rows for whoever's token it was given).

A Vercel Cron Job, by contrast, isn't triggered by a logged-in user — Vercel just hits your endpoint on a schedule with no session attached. To make that work, the endpoint would need to bypass RLS using Supabase's **`service_role` key** instead of a user token, and write to a specific, hardcoded `user_id` (since there's no session to derive one from).

That's a meaningfully bigger security surface: a service role key has **unrestricted** read/write across every table for every user, with RLS completely bypassed. It's the kind of credential that, if it ever leaked, exposes everyone's data — not just yours. If you want this:

1. Add `SUPABASE_SERVICE_ROLE_KEY` and `TRADELOG_SYNC_USER_ID` as Vercel env vars (never the same key as `SUPABASE_ANON_KEY` — grab the actual `service_role` key from Supabase's API settings).
2. Create a second endpoint (e.g. `api/bybit-cron.js`) that mirrors `bybit-sync.js` but uses the service role key in the `apikey`/`Authorization` headers instead of a user token, and hardcodes `user_id: process.env.TRADELOG_SYNC_USER_ID` in the mapped rows instead of deriving it from a session.
3. Add a `crons` block to `vercel.json`:
   ```json
   "crons": [{ "path": "/api/bybit-cron", "schedule": "0 */6 * * *" }]
   ```
   (every 6 hours — Bybit's closed-pnl data isn't real-time-critical, no need to poll aggressively)
4. Protect `api/bybit-cron.js` from being called by anyone but Vercel's own cron trigger — check the `Authorization: Bearer <CRON_SECRET>` header Vercel sends automatically when `CRON_SECRET` is set as an env var ([Vercel's cron docs](https://vercel.com/docs/cron-jobs) cover this).

This is intentionally left as a documented extension rather than shipped code — a service-role-key endpoint is the highest-privilege thing in this entire app, and it deserves to be added deliberately by whoever's going to own that credential, not pasted in as a default.

## Known limitation: P&L won't match Bybit's number exactly

Bybit's `closedPnl` field includes trading fees and funding payments. This app computes `pnl` as a Postgres generated column from `entry`/`exit`/`size`/`dir` — the same formula every manually-logged trade uses — which doesn't account for fees, to stay consistent across the whole trade log. Expect small discrepancies (typically a few tenths of a percent) between what TradeLog shows and what Bybit's own P&L tab shows for the same trade. Bybit's fee-inclusive figure is preserved in the trade's `notes` field for reference, so it's never actually lost — just not what drives the dashboard numbers.

## Known limitation: SL/TP aren't imported (yet)

Bybit's closed-position endpoint reports the realized trade, not the conditional stop/take-profit orders that may have been attached to it — those live in a separate part of Bybit's API (order history, filtered for conditional/trigger orders) and would need to be fetched separately and correlated by symbol + time window to reliably reconstruct what SL/TP was actually set. That correlation is non-trivial to get right (partial fills, order modifications mid-trade, etc.), so v1 intentionally leaves `sl`/`tp` null for every synced trade — which, per the rules above, is exactly the documented "no SL/TP set" behavior, not a bug.
