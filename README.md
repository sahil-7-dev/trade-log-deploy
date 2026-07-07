# TradeLog

A single-page trading journal and portfolio tracker for crypto, forex, and stock trades — built on Supabase (auth + Postgres + Row Level Security) with live crypto pricing via CoinGecko. No framework, no build tooling beyond a small config-generation step, deployable to Vercel in minutes.

## Table of Contents

- [Features](#features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Database Schema](#database-schema)
- [Security](#security)
- [Known Limitations](#known-limitations)
- [License](#license)

## Features

**Trade Log**
- Entry/exit price, size, SL/TP, R:R, setup tags, and free-text notes
- Auto-computed P&L and win/loss status (generated columns in Postgres — never drifts from source data)
- **R:R is "achieved," not "planned"** — computed from your actual exit vs. your stop-loss distance, not your take-profit target. A 3:1 setup you exit early at breakeven honestly shows `0.00R`, not `3.00R`
- Filterable table (All / Open / Wins / Losses), CSV export
- **Trading balance** that moves with realized P&L — closing a trade at +$1 nudges the balance up by $1, a −$0.50 loss nudges it down, automatically, with editing or deleting a trade correctly reversing its effect. Deposit additional funds anytime via "+ Add Funds"

**Portfolio / Investing**
- Buy/sell tracking with live crypto prices (CoinGecko)
- **Cash balance** that automatically debits on buy, credits on sell, and adjusts correctly on edit or delete — so total equity (cash + holdings) always reconciles. Deposit funds directly anytime via "+ Deposit"
- Cash balance shows up as its own row in the holdings list (and its own slice in the portfolio allocation chart) — a true picture of the portfolio instead of a disconnected number floating outside it
- Full or partial position closing with realized P&L history
- Cash balance, trading balance, and realized history all sync to Supabase (`user_settings` table), not just the browser — consistent across devices and sign-ins

Note the two balances track different things by design: **cash balance** is a buy/sell ledger (debits on purchase, credits on sale), while **trading balance** is a running equity figure driven by realized trade P&L plus manual deposits — it never gets debited by "buying" anything, since a trade isn't a purchase of an asset you hold.

**Analytics & Tools**
- Equity curve, win/loss split, R:R distribution, win rate by asset
- Monthly P&L heatmap, correctly scoped to a single year — hovering shows exact figures, small accounts get 2-decimal precision instead of rounding to an indistinguishable "$0"
- **Yearly Recap** — pick any year from a dropdown (auto-populated from your actual trade history) and see win rate, total P&L, avg R:R achieved, expectancy, and best/worst trade for that year in isolation, reusing the exact same stats engine as the main dashboard so the numbers can't drift out of sync
- P&L calendar with daily breakdown and a running daily log
- Visual query builder with live SQL preview

**Account**
- Email/password auth via Supabase, with automatic token refresh (no re-login mid-session) and clear error messages on failure — a bad request never just hangs on "Signing in…" with no feedback
- Editable profile with a globally unique, case-insensitive display name — live "available / taken" check as you type, enforced by a database constraint (not just client-side validation)
- USD / INR currency toggle, hide-balance privacy toggle

## Tech Stack

- **Frontend:** Vanilla HTML/CSS/JS — no framework, no bundler
- **Charts:** [Chart.js](https://www.chartjs.org/)
- **Backend:** [Supabase](https://supabase.com) (Postgres + Auth + PostgREST, accessed directly via `fetch`, no client SDK)
- **Prices:** [CoinGecko API](https://www.coingecko.com/en/api)
- **Hosting:** [Vercel](https://vercel.com), static output with a one-step build

## Architecture

**Config generation, not hardcoded keys.** `public/js/config.js` (which holds live API keys) is gitignored and never committed. On Vercel, `scripts/build.js` runs as the build command and generates it from environment variables at deploy time. Locally, you copy `config.example.js` → `config.js` by hand. Either way, the Supabase URL is normalized (stripped of any accidental trailing path) before it's written, so a copy-paste mistake in the URL can't silently break auth.

**Strict CSP, no inline scripts.** `vercel.json` sets a locked-down `Content-Security-Policy` (`script-src 'self'` plus the Chart.js CDN — no `unsafe-inline`, no `unsafe-eval`). Every interactive element uses `data-action="..."` attributes routed through a single set of delegated `click`/`change`/`input`/`keydown` listeners in `app.js`, instead of inline `onclick` handlers — so the CSP stays strict without sacrificing functionality.

**Security enforced at the database, not just the client.** Every table has Row Level Security scoped to `auth.uid()`. The display-name uniqueness check is a `SECURITY DEFINER` Postgres function that returns only `true`/`false` — the client never gets read access to any other user's row, and the actual uniqueness guarantee comes from a database constraint, not client-side validation.

## Project Structure

```
tradelog/
├── public/                  # Deployable static site (Vercel root)
│   ├── index.html           # App shell and all markup
│   ├── css/
│   │   └── styles.css       # All styling
│   └── js/
│       ├── config.js        # Generated at build time — gitignored, never committed
│       ├── config.example.js
│       └── app.js           # All application logic (auth, data, rendering, event delegation)
├── scripts/
│   └── build.js             # Generates config.js from env vars; runs automatically on Vercel
├── sql/
│   └── schema.sql           # Full Supabase schema: tables, indexes, RLS policies, RPC function
├── docs/
│   └── SETUP.md             # Step-by-step setup + troubleshooting guide
├── package.json
├── vercel.json               # Build command, output dir, security headers (CSP, HSTS, etc.)
├── .gitignore
└── README.md
```

## Getting Started

For full step-by-step instructions (including Supabase project creation and troubleshooting), see **[docs/SETUP.md](docs/SETUP.md)**. Quick version:

### 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com).
2. Open **SQL Editor** and run the full contents of `sql/schema.sql`. This creates all four tables (`trades`, `investments`, `profiles`, `user_settings`), their indexes, RLS policies, and the display-name availability function.
3. Go to **Settings → API** and copy your **Project URL** (bare origin, e.g. `https://xxxxx.supabase.co` — no `/rest/v1` or other path suffix) and **anon public key**.

### 2. (Optional) Set up CoinGecko

Create a free account at [coingecko.com/en/api/pricing](https://www.coingecko.com/en/api/pricing) and grab a **Demo API key** for live crypto prices. The app works without one, at a lower rate limit.

### 3. Local development

```bash
cp public/js/config.example.js public/js/config.js
```

Fill in your keys in `public/js/config.js`, then:

```bash
npm run dev
```

Opens at `http://localhost:3000`. `config.js` is gitignored — it will never be committed.

### 4. Deploy to Vercel

1. Push this repo to GitHub.
2. Import it into Vercel.
3. In **Project → Settings → Environment Variables**, add:
   - `SUPABASE_URL`
   - `SUPABASE_ANON_KEY`
   - `COINGECKO_API_KEY` (optional)
4. Deploy. Vercel runs `node scripts/build.js` automatically (configured in `vercel.json`), which generates `config.js` from those env vars at build time — the file itself never touches your git history.

## Database Schema

| Table | Purpose | Key constraint |
|---|---|---|
| `trades` | Trade log entries | P&L and status are Postgres generated columns — always derived, never stale |
| `investments` | Portfolio holdings | — |
| `user_settings` | Cash balance + trading balance + realized (closed-position) P&L history | One row per user, upserted via `on_conflict=user_id` |
| `profiles` | Display name | Case-insensitive **unique index** on `display_name` |

All four tables have Row Level Security enabled, scoped to `auth.uid() = user_id`. Full definitions, indexes, and the `is_display_name_available()` RPC function are in `sql/schema.sql`.

## Security

- **Row Level Security everywhere.** Every table restricts reads and writes to the authenticated user's own rows. This holds even if client-side code is tampered with (e.g. via browser DevTools) — Postgres checks `auth.uid()` from the JWT server-side, not anything sent in the request body.
- **Strict CSP.** No inline scripts, no `unsafe-eval`. Combined with `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, and HSTS (see `vercel.json`).
- **The Supabase anon key is safe to expose client-side** — it carries no special privileges on its own; RLS is what actually protects data.
- **Narrow-scope RPC for uniqueness checks.** `is_display_name_available()` runs as `SECURITY DEFINER` (so it can see across all users despite RLS) but returns only a boolean — never row data — keeping the privilege escalation as narrow as possible.
- **XSS-safe rendering.** All user-supplied text (trade notes, symbols, display names, etc.) is HTML-escaped before being inserted into the DOM.

## Known Limitations

- Single-user-per-account personal tool — there's no team/sharing model.
- Profile photos are stored client-side only (compressed to a base64 data URL in `localStorage`), not synced across devices.
- Currency toggle covers USD/INR display only; all figures are stored in a single base currency internally.

## License

Personal project — not licensed for redistribution.
