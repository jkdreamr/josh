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

After changing which games opt in to leaderboards, online rooms or bots (including the app games in `src/os/arcade/apps.ts`), run `npm run arcade:specs` from the repository root and redeploy the Worker. Until it is redeployed, the deployed Worker rejects scores and rooms for games it does not know: scores then stay on the player's device and Create Room shows an error. Rooms only offer bots once the Worker knows the game allows them; until then the lobby simply has no Bots stepper.

## Leaderboards

Scores and online wins live in the `Boards` Durable Object. A game's Game Over card reads and submits with `GET /leaderboard?game=<board>` and `POST /leaderboard`, and Online Wins boards are `GET /wins?game=<game>` (top 100 each). The arcade's Leaderboards cards read `GET /leaderboard/top` once: the best 3 entries (`?n=` asks for 1 to 10) of every score board and every Online Wins board, as `{ "boards": { "<board>": [{ "name", "score", "date" }] }, "wins": { "<game>": [...] } }`, with empty boards as empty lists. Until the Worker is redeployed with it, that route 404s: the score cards then show the visitor's own scores, labeled This Device (opening one still loads its global top 100), and Online Wins say they are unavailable.

## Open Rooms

Public rooms are listed for strangers to join. `POST /rooms?game=<id>&public=1` makes a public room, and the host can switch any room with `{ t: 'listed', on }` on its socket; `welcome` and `players` say whether the room is public (`listed`). Each room keeps its own line in the `Lobby` Durable Object (migration `v5`): it adds the line once its host is in, updates it as people come and go, refreshes it every minute from an alarm, and removes it when the room fills with people, starts in a game nobody can join mid-game, goes private, or closes. Lines nobody refreshed for three minutes are dropped. `GET /rooms` (optionally `?game=<id>`) lists up to 40 open rooms, the ones still gathering first. Until the Worker is redeployed, Open Rooms stay hidden and new rooms are private.

## Quick play

Games whose meta sets `online.quick` (with `bots`) get quick play, like an .io game. `POST /rooms/quick?game=<id>` answers `{ code }`: the `Lobby` picks, one request at a time, the fullest quick room of that game still gathering people (with a seat free and more than 2.5 s to go), or keeps a new code for a room the Worker then opens. Each person sent to a room counts in its line until the room updates it, so a crowd pressing Play at once fills one room and spills into the next. A quick room is public, starts with bots in every seat nobody holds, and starts its one round on its own from an alarm 20 s after it opens (3 s once people fill every seat, or it closes then if nobody came); its host cannot start it early. `welcome`, `players` and `host` say `quick: true`, and `startIn` (milliseconds) while it gathers. Once its round starts it leaves Open Rooms for good and nobody else is sent there: someone who reaches it late is told it `started` and goes on to the next one. Until the Worker is redeployed, Play shows Could Not Find A Match and Play with Bots and Play with Friends work as before.

## Spectators

Games whose spec sets `watch` can be watched. `GET /rooms/<code>/ws?watch=1` comes in as a spectator: seat -1 in `welcome` (with `watch: true`, and `roundBots` while a round is under way), no seat taken, at most 16 per room, whether the room is playing or full. Spectators get everything the room says, and the host's broadcasts that its client copies to the room as `{ t: 'watch', d }` (the players get those over their direct links); anything a spectator sends is ignored. `welcome`, `players` and `host` carry `watchers` (names) and `watchable`; the host sends `{ t: 'watchable', on }` to switch it, and turning it off closes every spectator's socket with `closed` reason `no-watching`. A public room nobody can join that is playing a watchable round stays in Open Rooms with `watchOnly: true` (lines say `watch: true` whenever people can watch). When the last player leaves, spectators get `closed` with `room-closed`.

Clients that speak protocol 3 (`v=3`) are turned away on the socket instead of with a refused request: it opens, says `{ t: 'closed', reason, watch? }` (`not-found`, `started`, `full`, `no-watching`; `watch` when they could watch instead) and closes, so the site can say why and offer to watch. Older clients get the refused requests as before.

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

The Lounge app is one global chat for finding someone to play with. While it is open, the site holds a hibernating WebSocket at `GET /lounge?v=2&name=<name>&game=<id>&room=<code>` (it sends `ping` every 25 seconds, answered by the auto-response without waking the object). On connect the `Lounge` Durable Object (migration `v4`) sends `{ t: 'welcome', v: 2, you, messages, members, online }`: the newest 100 messages of each channel (`general`, `find-a-game`, `ideas`), everyone here as `{ id, name?, game?, room? }`, and which of them you are. Then it sends `msg` (with the sender's member id as `by`), `join`, `member` (someone picked a name or started or stopped playing), `leave`, `typing` (`{ ch, id }`) and `cleared` as they happen.

The site posts with `{ t: 'say', ch, name, text, c, invite? }`, where `invite` is a room to share (`{ game, code }`, a game with online rooms) and `c` is the sender's own tag: it comes back on that message, or on `{ t: 'error', error, c }` when the Worker turns it down (`name`, `text`, `channel`, `invite`, `slow` or `repeat`). It sends `{ t: 'me', name?, game?, room? }` when its name or game changes, and `{ t: 'typing', ch }` at most every 3 seconds while someone types. A room only shows on a member when it is a game with online rooms (the site only sends public ones). The shapes, cleaning and limits live in `src/os/arcade/lounge-core.ts`. Until the Worker is redeployed, the Lounge says it is unavailable.

A socket without `v=2` (a tab open from before the Lounge app) gets #general only, as before: `{ t: 'welcome', messages, online }`, then `msg`, `online` and `cleared`, and it can only post there. The first time the object starts after this deploy it adds the `ch` and `invite` columns to its table; everything said before is in #general.

The Worker checks everything. Names are 1 to 16 characters and messages 1 to 280, after control, zero width and bidi characters are stripped and whitespace is squeezed. A connection can send 5 messages per 10 seconds, an IP 10 per 10 seconds and 30 a minute, and the same line twice in a row within a minute is dropped. A connection can change its name or game 5 times per 10 seconds and say it is typing once every 2 seconds (only with a name); past that they are ignored. An IP can hold 20 chat sockets and join 40 times a minute, with 1,000 sockets in all. Frames over 2 KB, binary frames and more than 20 frames in 10 seconds close the socket. Only the newest 100 messages of each channel are stored, and no IPs.

To be able to wipe the chat, set a long random secret once from `worker/` (for example the output of `openssl rand -hex 32`):

```sh
npx wrangler secret put LOUNGE_ADMIN_TOKEN
```

Then clearing deletes every message and empties the chat on every open screen (add `?ch=ideas` to clear one channel):

```sh
curl -X POST -H "Authorization: Bearer $LOUNGE_ADMIN_TOKEN" https://josh-arcade.joshuakoo.workers.dev/lounge/clear
```

It answers `{ "ok": true, "removed": <count> }`, 401 for a wrong token, or 404 for a channel that doesn't exist. Without the secret, clearing is off (403). To test locally, start `wrangler dev` with `scripts/smoke/wrangler.jsonc`, which sets the token to `test-admin-token`, and run `node scripts/smoke-lounge.mjs` (the exact commands are at the top of that file).
