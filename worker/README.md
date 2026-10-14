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

The menu bar Stats panel reads `GET /stats`. The site counts with `POST /stats/view` (every page load, refresh, back/forward restore, return to the tab after 30 minutes, in-OS restart or wake) and `POST /stats/play` (opening a game and every round started). Both take a small JSON body sent as `text/plain`, so browsers skip the CORS preflight. Counts live in the `Stats` Durable Object (migration `v2`); days roll over at midnight Pacific. For "online now", every open tab holds a hibernating WebSocket at `GET /stats/live?visitor=<id>` (it sends `ping` every 25 seconds, answered by the auto-response without waking the object), and the count is the number of distinct visitors connected. Until the Worker is redeployed, the panel shows Stats Unavailable.

## Messages Live Chat

What a visitor types in Messages goes to Josh's Telegram through a bot, and his replies show up in their Messages window. The site calls `GET /chat?s=<conversation>&after=<n>` (opening the app, then polling while a conversation is active) and `POST /chat` with `{ s, text, after }` as `text/plain`. Telegram calls `POST /telegram`. Conversations live in the `Chat` Durable Object (migration `v3`) and are dropped 90 days after their last message. Until the bot is set up, `/chat` reports `live: false` and sending falls back to the email offer.

Setup, once:

1. In Telegram, message [@BotFather](https://t.me/BotFather), send `/newbot`, and copy the token it gives you.
2. From `worker/`, run `npx wrangler secret put TELEGRAM_BOT_TOKEN` and paste the token, then `npx wrangler deploy`.
3. Open `https://josh-arcade.joshuakoo.workers.dev/telegram` in a browser. It points the bot's webhook at the Worker and says what is left.
4. From the `@temporary_jk` Telegram account, open the bot and tap Start. The first chat from that username becomes the one visitor messages go to. Reload the page from step 3 to confirm it says All set.

To answer a visitor, swipe left on their message in Telegram and reply. A message that isn't a reply goes to whoever you talked with last; a 👍 on it means it was delivered.

Optional Worker variables: `TELEGRAM_OWNER` changes which username can claim the bot, and `TELEGRAM_CHAT_ID` pins the chat messages go to (it overrides the claimed one, which is the way to move the bot to a different account).

### Auto-replies

If a visitor's message has gone unanswered for 24 hours, Workers AI answers it (the `AI` binding), and the bot sends Josh what it said; replying to that notice reaches the visitor as usual. In Telegram, reply `/ai` to a visitor's message to have it answer right away. Auto-replies show in Messages labeled "auto-reply · AI", say up front that they are automatic, and only use facts from the site (`src/os/chat-persona.ts`). The `Chat` Durable Object's alarm runs them.

They are built to stay free. Workers AI includes 10,000 Neurons a day (reset at 00:00 UTC; on the Workers Free plan, use past that fails instead of billing). Auto-replies stop for the day after 15 attempts or 5,000 Neurons, whichever comes first, counting every attempt at its worst-case cost (150 Neurons: a prompt under 3,000 tokens and an answer under 300 on the dearest model in the list). Conversations still waiting at the limit get their reply after midnight UTC. The models are tried in order (`MODELS` in `src/chat.ts`), so a retired one falls through to the next.

To test locally against a fake Telegram and a stand-in for Workers AI, with a 3.6 second wait instead of a day, see `scripts/smoke-chat.mjs`.

## Arcade Chat

The Chat view on the arcade home is one global chat for finding someone to play with. While it is open, the site holds a hibernating WebSocket at `GET /lounge` (it sends `ping` every 25 seconds, answered by the auto-response without waking the object). On connect the `Lounge` Durable Object (migration `v4`) sends `{ t: 'welcome', messages, online }` with the newest 100 messages and how many people have the chat open, then `msg`, `online` and `cleared` as they happen. The site posts with `{ t: 'say', name, text, c }`, where `c` is the sender's own tag: it comes back on that message, or on `{ t: 'error', error, c }` when the Worker turns it down (`name`, `text`, `slow` or `repeat`). The shapes, cleaning and limits live in `src/os/arcade/lounge-core.ts`. Until the Worker is redeployed, Chat says it is unavailable.

The Worker checks everything. Names are 1 to 16 characters and messages 1 to 280, after control, zero width and bidi characters are stripped and whitespace is squeezed. A connection can send 5 messages per 10 seconds, an IP 10 per 10 seconds and 30 a minute, and the same line twice in a row within a minute is dropped. An IP can hold 20 chat sockets and join 40 times a minute, with 1,000 sockets in all. Frames over 2 KB, binary frames and more than 20 frames in 10 seconds close the socket. Only the newest 100 messages are stored, and no IPs.

To be able to wipe the chat, set a long random secret once from `worker/` (for example the output of `openssl rand -hex 32`):

```sh
npx wrangler secret put LOUNGE_ADMIN_TOKEN
```

Then clearing deletes every message and empties the chat on every open screen:

```sh
curl -X POST -H "Authorization: Bearer $LOUNGE_ADMIN_TOKEN" https://josh-arcade.joshuakoo.workers.dev/lounge/clear
```

It answers `{ "ok": true, "removed": <count> }`, or 401 for a wrong token. Without the secret, clearing is off (403). To test locally, start `wrangler dev` with `scripts/smoke/wrangler.jsonc`, which sets the token to `test-admin-token`, and run `node scripts/smoke-lounge.mjs` (the exact commands are at the top of that file).
