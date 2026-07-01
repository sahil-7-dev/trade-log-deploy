# TradeLog — Personal Trading Journal

A single-page trading journal and portfolio tracker for crypto, forex, and stock trades. Built on Supabase (auth + Postgres) with live crypto pricing via CoinGecko.

## Features

- Trade journal with entry/exit, P&L, RR, setup tags, and notes
- Portfolio tracker with live crypto prices, realized P&L, and cash balance
- Close position flow (full or partial) with automatic realized P&L tracking
- P&L calendar with daily breakdown and a running daily log
- Analytics dashboard: equity curve, win/loss split, RR distribution, win rate by asset
- Visual query builder with auto-generated SQL
- CSV export
- USD / INR currency toggle
- Hide-balance privacy toggle
- Editable profile (name + photo, stored locally)
- Persistent login (auto-refreshing session, no re-login needed across days)

## Project Structure

```
tradelog/
├── public/                  # Deployable static site (this is the Vercel root)
│   ├── index.html           # App shell and all markup
│   ├── css/
│   │   └── styles.css       # All styling
│   └── js/
│       ├── config.js        # Your live API keys (gitignored — create from config.example.js)
│       ├── config.example.js
│       └── app.js           # All application logic
├── sql/
│   └── schema.sql           # Supabase table + RLS setup (also viewable in-app under DB Schema)
├── docs/
│   └── SETUP.md             # Step-by-step setup guide
├── package.json
├── vercel.json
├── .gitignore
└── README.md
```

## Quick Start

### 1. Set up Supabase

1. Create a project at [supabase.com](https://supabase.com)
2. Go to **SQL Editor** and run the contents of `sql/schema.sql`
3. Go to **Settings → API** and copy your **Project URL** and **anon public key**

### 2. Set up CoinGecko (optional, for live crypto prices)

1. Create a free account at [coingecko.com/en/api/pricing](https://www.coingecko.com/en/api/pricing)
2. Get a **Demo API key**

### 3. Configure the app

```bash
cp public/js/config.example.js public/js/config.js
```

Edit `public/js/config.js` and fill in your keys:

```js
const APP_CONFIG = {
  SUPABASE_URL: 'https://your-project.supabase.co',
  SUPABASE_ANON_KEY: 'your-anon-key',
  COINGECKO_API_KEY: 'your-coingecko-demo-key', // optional
};
```

`config.js` is gitignored — it will never be committed.

### 4. Run locally

```bash
npm run dev
```

Opens at `http://localhost:3000`. Sign up with any email/password to create your account (handled by Supabase Auth).

### 5. Deploy to Vercel

```bash
npm install -g vercel
vercel --prod
```

Vercel auto-detects `vercel.json` and serves the `public/` folder as the site root. Since `config.js` is gitignored, you'll need to either:

- **Option A (simple):** Manually upload `config.js` content directly in the Vercel dashboard as part of your deployed files (not ideal for git-based deploys)
- **Option B (recommended):** Don't gitignore `config.js` if this is a private repo only you access — comment out that line in `.gitignore`. For a personal single-user tool, the anon key alone is not sensitive (Supabase Row Level Security still protects all data) — but never commit it to a public repo.

## Security Notes

- The Supabase **anon key** is safe to expose client-side — it has no special privileges. All data access is protected by **Row Level Security (RLS)** policies defined in `sql/schema.sql`, which restrict each user to only their own rows.
- The CoinGecko key only grants higher API rate limits — not sensitive.
- Your trading data, profile photo, and balance-visibility preference are stored in `localStorage` and Supabase, scoped to your account only.

## Tech Stack

- Vanilla HTML/CSS/JS — no build step, no framework
- [Chart.js](https://www.chartjs.org/) for all charts
- [Supabase](https://supabase.com) for auth + Postgres database
- [CoinGecko API](https://www.coingecko.com/en/api) for live crypto prices

## License

Personal project — not licensed for redistribution.
