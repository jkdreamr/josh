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

After changing which games opt in to leaderboards or online rooms (including the app games in `src/os/arcade/apps.ts`), run `npm run arcade:specs` from the repository root and redeploy the Worker. Until it is redeployed, the deployed Worker rejects scores and rooms for games it does not know: scores then stay on the player's device and Create Room shows an error.
