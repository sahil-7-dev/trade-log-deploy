# Free alternative to Vercel's paid per-minute cron. GitHub Actions' free tier
# runs scheduled workflows on public repos (and private repos, within the
# free minutes quota) at whatever interval you want — no Vercel plan
# restriction applies here, since this just makes a normal HTTPS request to
# your deployed /api/bybit-cron endpoint from GitHub's infrastructure.
#
# Setup:
#   1. Add these as GitHub repo secrets (Settings → Secrets and variables →
#      Actions): DEPLOY_URL (e.g. https://trade-log-deploy.vercel.app) and
#      CRON_SECRET (same value you set in Vercel's env vars).
#   2. That's it — this runs automatically once committed. Check the
#      Actions tab on GitHub to see run history / failures.
#
# Note: GitHub's schedule triggers are best-effort, not exact-to-the-second —
# expect runs to land within a few minutes of the scheduled time, especially
# during GitHub's peak load periods. Fine for this use case; not fine if you
# need second-level precision.

name: Bybit Sync

on:
  schedule:
    - cron: '*/5 * * * *'   # every 5 minutes — adjust to taste
  workflow_dispatch:         # lets you trigger a run manually from the Actions tab

jobs:
  sync:
    runs-on: ubuntu-latest
    steps:
      - name: Trigger Bybit sync
        run: |
          curl -sf -X POST "${{ secrets.DEPLOY_URL }}/api/bybit-cron" \
            -H "Authorization: Bearer ${{ secrets.CRON_SECRET }}" \
            -w "\nHTTP %{http_code}\n"
