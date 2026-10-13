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

## Site Stats

The menu bar Stats panel reads `GET /stats`. The site counts with `POST /stats/view` (every page load, refresh, back/forward restore, return to the tab after 30 minutes, in-OS restart or wake) and `POST /stats/play` (opening a game and every round started). Both take a small JSON body sent as `text/plain`, so browsers skip the CORS preflight. Counts live in the `Stats` Durable Object (migration `v2`); days roll over at midnight Pacific. Until the Worker is redeployed, the panel shows Stats Unavailable.

## Messages Live Chat

What a visitor types in Messages goes to Josh's Telegram through a bot, and his replies show up in their Messages window. The site calls `GET /chat?s=<conversation>&after=<n>` (opening the app, then polling while a conversation is active) and `POST /chat` with `{ s, text, after }` as `text/plain`. Telegram calls `POST /telegram`. Conversations live in the `Chat` Durable Object (migration `v3`) and are dropped 90 days after their last message. Until the bot is set up, `/chat` reports `live: false` and sending falls back to the email offer.

Setup, once:

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token it gives you.
2. From `worker/`, run `npx wrangler secret put TELEGRAM_BOT_TOKEN` and paste the token, then `npx wrangler deploy`.
3. Open `https://josh-arcade.joshuakoo.workers.dev/telegram` in a browser. It points the bot's webhook at the Worker and says what is left.
4. From the `@temporary_jk` Telegram account, open the bot and tap Start. The first chat from that username becomes the one visitor messages go to. Reload the page from step 3 to confirm it says All set.

To answer a visitor, swipe left on their message in Telegram and reply. A message that isn't a reply goes to whoever you talked with last; a 👍 on it means it was delivered.

Optional Worker variables: `TELEGRAM_OWNER` changes which username can claim the bot, and `TELEGRAM_CHAT_ID` pins the chat messages go to (it overrides the claimed one, which is the way to move the bot to a different account).

To test locally against a fake Telegram, see `scripts/smoke-chat.mjs`.
