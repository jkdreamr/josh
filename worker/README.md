# Arcade Worker

## Local Development

In one terminal:

```sh
cd worker && npm ci && npx wrangler dev --port 8787
```

In another terminal from the repository root, point the site at the local Worker:

```sh
PUBLIC_ARCADE_API=http://127.0.0.1:8787 npm run dev
```

Wrangler runs the SQLite-backed Durable Objects locally. No Cloudflare login is needed for local development.

## Deploy

Set `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment, then deploy from `worker/`:

```sh
npx wrangler deploy
```

After changing which games opt in to leaderboards, run `npm run arcade:specs` from the repository root and redeploy the Worker.

## Site Stats

The menu bar Stats panel reads `GET /stats`. The site counts with `POST /stats/view` (every page load, refresh, back/forward restore, return to the tab after 30 minutes, in-OS restart or wake) and `POST /stats/play` (opening a game and every round started). Both take a small JSON body sent as `text/plain`, so browsers skip the CORS preflight. Counts live in the `Stats` Durable Object (migration `v2`); days roll over at midnight Pacific. Until the Worker is redeployed, the panel shows Stats Unavailable.
