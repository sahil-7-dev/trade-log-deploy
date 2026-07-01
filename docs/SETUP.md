# Setup Guide

## 1. Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Wait for the project to finish provisioning (~2 minutes).
3. In the left sidebar, go to **SQL Editor**.
4. Open `sql/schema.sql` from this repo, copy its full contents, paste into the SQL Editor, and click **Run**.
5. This creates the `trades` and `investments` tables, indexes, and Row Level Security policies that ensure each signed-in user only ever sees their own data.

### Verify the schema

Go to **Table Editor** in Supabase — you should see two tables: `trades` and `investments`, both empty.

## 2. Get your Supabase keys

1. Go to **Settings → API** in your Supabase project.
2. Copy the **Project URL** (looks like `https://xxxxx.supabase.co`).
3. Copy the **anon / public** key (a long JWT string starting with `eyJ...`).

## 3. CoinGecko API key (optional)

Live crypto prices work without a key on CoinGecko's free tier, but a Demo key gives you higher rate limits.

1. Sign up at [coingecko.com/en/api/pricing](https://www.coingecko.com/en/api/pricing).
2. Choose the **Demo** plan (free).
3. Generate an API key from your dashboard — it starts with `CG-`.

If you skip this, leave `COINGECKO_API_KEY` blank in `config.js`; live prices will simply not load for the Portfolio page, everything else still works.

## 4. Local configuration

```bash
cp public/js/config.example.js public/js/config.js
```

Fill in `public/js/config.js`:

```js
const APP_CONFIG = {
  SUPABASE_URL: 'https://xxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...',
  COINGECKO_API_KEY: 'CG-...',
};
```

## 5. Run locally

No build step needed — it's plain HTML/CSS/JS.

```bash
npm run dev
```

Or just open `public/index.html` directly in a browser (some browsers block `fetch` from `file://` URLs — using `npm run dev` avoids this).

## 6. Create your account

On first load you'll see the sign-in screen. Click **Create Account**, enter any email and password. Supabase sends a confirmation email by default — check **Authentication → Settings** in Supabase if you want to disable email confirmation for faster personal-use signup.

## 7. Deploy

### Vercel (recommended)

```bash
npm install -g vercel
vercel --prod
```

Vercel will detect `vercel.json` and serve the `public/` directory.

Since `config.js` is gitignored by default, for a git-based Vercel deployment you have two options:

- Remove the `public/js/config.js` line from `.gitignore` if this is a **private** repository only you can access (the anon key is not a secret — RLS protects your data either way)
- Or use Vercel's **Environment Variables** + a small build step to inject the config at deploy time (more setup, not necessary for a personal single-user tool)

### Other static hosts

Any static host works since there's no backend beyond Supabase: Netlify, GitHub Pages, Cloudflare Pages, etc. Just point them at the `public/` folder.

## Troubleshooting

**"DB error: 404"** — the schema wasn't run, or table names don't match. Re-run `sql/schema.sql`.

**"DB error: 401" or session loss on refresh** — sign out and sign back in once to get fresh tokens; the app auto-refreshes sessions after that.

**Live prices not loading** — check `COINGECKO_API_KEY` is set correctly, or that the coin's symbol resolves (very obscure tokens may not be found via CoinGecko search).
