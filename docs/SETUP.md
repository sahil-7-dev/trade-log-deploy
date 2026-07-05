# Setup Guide

## 1. Supabase Project

1. Go to [supabase.com](https://supabase.com) and create a new project.
2. Wait for the project to finish provisioning (~2 minutes).
3. In the left sidebar, go to **SQL Editor**.
4. Open `sql/schema.sql` from this repo, copy its full contents, paste into the SQL Editor, and click **Run**.
5. This creates the `trades`, `investments`, `profiles`, and `user_settings` tables, indexes, RPC function, and Row Level Security policies that ensure each signed-in user only ever sees their own data.

### Verify the schema

Go to **Table Editor** in Supabase — you should see four tables: `trades`, `investments`, `profiles`, and `user_settings`, all empty.

### Already have `trades`/`investments` set up?

If you ran an earlier version of `schema.sql`, re-running the whole file will error on `create table trades` (already exists). Just run the snippet(s) below for whichever tables you're missing.

**`user_settings`** (cash balance + realized history — see the cash balance section further down if you don't need this yet):

```sql
create table user_settings (
  user_id           uuid primary key references auth.users(id) on delete cascade,
  cash_balance      numeric(18,2) not null default 0,
  trading_balance   numeric(18,2) not null default 0,
  realized_history  jsonb not null default '[]'::jsonb,
  updated_at        timestamptz default now()
);

alter table user_settings enable row level security;

create policy "Users manage own settings"
  on user_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Already created `user_settings` before the trading balance feature shipped? Just add the column:

```sql
alter table user_settings add column if not exists trading_balance numeric(18,2) not null default 0;
```

**`profiles`** (unique display names):

```sql
create table profiles (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null,
  updated_at    timestamptz default now()
);

create unique index idx_profiles_display_name_lower on profiles (lower(display_name));

alter table profiles enable row level security;

create policy "Users manage own profile"
  on profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function is_display_name_available(check_name text)
returns boolean
language sql
security definer
set search_path = public
as $$
  select not exists (
    select 1 from profiles
    where lower(display_name) = lower(check_name)
      and user_id <> auth.uid()
  );
$$;

revoke all on function is_display_name_available(text) from public;
grant execute on function is_display_name_available(text) to authenticated;
```

Your existing cash balance, realized history, and display name (currently only in browser `localStorage`) will migrate up to these tables automatically the next time you sign in — for the display name specifically, only if no one else has already claimed it; otherwise it stays local-only until you pick an available one in the profile modal.

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

> **`SUPABASE_URL` must be the bare project URL — no trailing path.** Use
> `https://xxxxx.supabase.co`, not `https://xxxxx.supabase.co/rest/v1/` or
> anything with `/auth/v1` etc. tacked on. Supabase's dashboard sometimes
> shows the REST endpoint (with `/rest/v1`) right next to the plain Project
> URL — grab the plain one. (The app now auto-strips an accidental trailing
> path at both build time and runtime as a safety net, but starting from the
> right value avoids relying on that.)

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

**Cash balance / realized history not syncing across devices** — the `user_settings` table hasn't been created yet; run the migration snippet above. The app falls back to browser `localStorage` if that table is missing, so nothing breaks, but it also won't sync until the table exists.

**"Already taken" on a display name you're sure is free** — names are matched case-insensitively, so someone may already hold a different-cased version of it (e.g. `TraderETH` blocks `tradereth`). Try a variant.

**"DB error: 401" or session loss on refresh** — sign out and sign back in once to get fresh tokens; the app auto-refreshes sessions after that.

**Live prices not loading** — check `COINGECKO_API_KEY` is set correctly, or that the coin's symbol resolves (very obscure tokens may not be found via CoinGecko search).
