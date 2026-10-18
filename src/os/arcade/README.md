# Arcade

Little games that live inside the Chrome app at `chrome://games`, and in the Arcade app on the desktop and phone home screen (`src/os/apps/Arcade.tsx`, the same page outside the browser). Each game is one folder. Adding a game never touches a shared file: drop a folder in `games/`, and the arcade grid, routing (`chrome://games/<id>`), lazy loading and code splitting pick it up automatically.

## Interface

```ts
// src/os/arcade/types.ts
export type GameCategory = 'arcade' | 'puzzle' | '3d' | 'multiplayer' | 'party' | 'drinking';
export type LeaderboardSpec = { order: 'desc' | 'asc'; max: number; min?: number; format?: 'number' | 'time'; unit?: string; measure?: string; variants?: Record<string, string> };
export type OnlineSpec = { seats: number; race?: boolean; lateJoin?: boolean; bots?: boolean; quick?: boolean; watch?: boolean };
export type GameMeta = { id: string; title: string; blurb: string; category: GameCategory; players: string; controls: string; accent: string; glyph: string; order: number; leaderboard?: LeaderboardSpec; online?: OnlineSpec };
export type GameProps = { compact?: boolean; onExit?: () => void; roomCode?: string };
```

```
src/os/arcade/games/<id>/
  meta.ts      export const meta: GameMeta   (meta.id must equal the folder name)
  index.tsx    export default function Game(props: GameProps)
  <id>.css     optional, imported by index.tsx, every selector prefixed .g-<id>
  *.ts         optional logic modules, workers, data
```

| Field | Meaning |
| --- | --- |
| `id` | folder name, used in the URL `chrome://games/<id>` and as the high score key |
| `title` | tile and tab title |
| `blurb` | one or two short sentences for the tile |
| `category` | section on the arcade page: Arcade, Puzzles, 3D, Multiplayer, Group Games, Drinking Games |
| `players` | `'1P'`, `'2P'`, `'1-2P'`, or a range like `'3-20P'` for group games |
| `controls` | one line how-to, shown on the Start and Pause cards |
| `accent` | CSS color for the tile icon and shell accents |
| `glyph` | SVG path data (`d`) for a 24x24 viewBox, drawn as a white 2px stroke |
| `order` | sort order inside its category (lower first) |
| `leaderboard` | optional, opts the game into a top 100 board (see Leaderboards) |
| `online` | optional, enables online rooms for the configured number of seats (see Online Rooms). Rooms lock when the host starts, unless `lateJoin: true` lets people join between rounds (they wait in the lobby and play the next one). `bots: true` lets the host fill empty seats with computer players (see Bots), `quick: true` makes Play quick play (see Quick Play) and `watch: true` lets people watch rounds (see Spectators) |

`manifest.ts` reads every `games/*/meta.ts` eagerly (they are tiny) and every `games/*/index.tsx` lazily through `React.lazy`, so each game is its own chunk and downloads only when opened. A deploy renames the chunks it changed, so production builds keep a week of older chunks alongside their own (`scripts/keep-old-assets.ts`) and a page left open across a deploy keeps playing its own version. If a chunk is still missing (a tab older than that), the server answers with `scripts/missing-file.js` and `GameFrame` says so and offers a Reload that comes straight back to the game (hosts pass `resume` to say how, see `src/os/reload.ts`); it never reloads on its own. The stand-in also gives pages from before any of this (they show an older "didn't load" card) the same Reload. A game that throws while running gets a Restart card instead. Folders starting with `_` are ignored. In dev you can list them with `localStorage.setItem('arcade:dev', '1')` and a reload; `_example` then appears as "Catch".

`compact` is true when the game renders in a small strip (the New Tab dino strip renders the game with id `dino` in compact mode). The shell hides its control row and uses slim one-line overlays. `onExit` returns to the arcade grid; the shell wires it to the back button.

## Kit

Import everything from `../../kit`.

```ts
function GameShell(props: {
  meta: GameMeta; compact?: boolean; onExit?: () => void; children: ReactNode;
  autoStart?: boolean;            // skip the Start overlay
  lowerIsBetter?: boolean;        // time based scores
  formatScore?: (n: number) => string;
  remount?: boolean;              // remount children on restart (default true)
  roomCode?: string;              // join an online room from an invite link
  setup?: ReactNode;              // settings on the Start, Pause and Game Over cards
  hostSetup?: ReactNode;          // settings for online rooms, in the lobby and on the online Game Over card
  botNames?: readonly string[];   // names for online bots in seat order (default Bot 1, Bot 2...)
  defaultBots?: number;           // bots a host's room starts with until they pick their own number
  className?: string; style?: CSSProperties;
}): JSX.Element;

function useShell(): ShellApi;
type GameStatus = 'ready' | 'playing' | 'paused' | 'over';
type ShellApi = {
  meta: GameMeta; status: GameStatus; round: number; active: boolean; compact: boolean; touch: boolean;
  keys: KeyState; root: RefObject<HTMLDivElement | null>;
  start(): void; pause(): void; resume(): void; restart(): void;
  gameOver(score?: number, info?: { title?: string; detail?: string; board?: string; rank?: number; wait?: string }): void;
  updateOver(info: { title?: string; detail?: string; wait?: string }): void; // change the card that is up
  setScore(score: number | null): void;     // live score pill, null hides it
  invalidate(): void;                       // request one redraw while idle
  onInvalidate(fn: () => void): () => void;
};

function useGameLoop(update: (dt: number) => void, render?: () => void, opts?: { always?: boolean }): void;
function useCanvas<T extends HTMLElement = HTMLCanvasElement>(opts?: { maxDpr?: number }): {
  ref: MutableRefObject<T | null>; size: { w: number; h: number; dpr: number }; ctx(): CanvasRenderingContext2D | null;
};
function useKeys(onPress?: (code: string, e: KeyboardEvent | null) => void): KeyState;
class KeyState {
  down(...names: string[]): boolean;     // held right now
  pressed(...names: string[]): boolean;  // once per press, consumes it
  axis(neg: string, pos: string): -1 | 0 | 1;
  press(code: string, e?: KeyboardEvent | null): void;
  release(code: string): void;
  clear(): void;
}
function useHighScore(id: string, opts?: { lowerIsBetter?: boolean }): { best: number | null; submit(score: number): boolean };
function TouchControls(props: { dpad?: boolean | 'x' | 'y'; buttons?: { key: string; label: string }[]; always?: boolean }): JSX.Element | null;
const sfx: {
  play(name: 'blip' | 'select' | 'jump' | 'coin' | 'hit' | 'boom' | 'win' | 'lose' | 'tick', pitch?: number): void;
  tone(t: { freq: number; to?: number; dur?: number; type?: OscillatorType; vol?: number; delay?: number }): void;
  noise(dur?: number, vol?: number, delay?: number): void;
  unlock(): void; isMuted(): boolean; setMuted(m: boolean): void; toggleMute(): void; subscribe(fn: () => void): () => void;
  clock(): number | null;   // audio time in seconds while sound is on and playing
};
function useMuted(): [boolean, (m: boolean) => void];
function loadThree(): Promise<typeof import('three')>;
function useThree(): typeof import('three') | null;   // null until loaded
```

**GameShell** owns the frame every game shares: Start overlay (glyph, title, controls line, Play), Pause overlay (Esc or P, the pause button, or automatically when the game stops being visible), Game Over overlay (score, best, "new best", Play again, Arcade), the live score pill, and the top-right control row (pause, restart, mute, back to arcade). Restart remounts the children, so a round's state can live in plain refs and `useState`. Call `shell.gameOver(score)` to end a round; the shell records the best via `useHighScore`.

**Settings** from `defineSetting(key, values, fallback)` (key starting with the game id, like `pong:mode`) are remembered per device and shown through the shell's `setup` slot on the Start, Pause and Game Over cards. Changing one on the Pause card swaps Resume for New Game, since the round in progress was set up the old way; switching back brings Resume back. Pass `{ live: true }` for purely cosmetic settings the game applies mid-round, such as scenery, to keep Resume. Online games can also pass `hostSetup`: settings for the room (a speed class, a course) shown in the lobby and on the online Game Over card. The game decides who may change them (usually just the host, `useOnline().isHost`) and sends the host's choice to everyone itself.

**useGameLoop** runs `update(dt)` then `render()` on `requestAnimationFrame` while the shell is `playing`. `dt` is in seconds and clamped to 1/20 s, so a stalled frame never teleports anything. It stops when the browser tab is hidden, the Chrome tab is in the background, the window is minimized or off screen, or the game is paused. While idle it still calls `render()` once after resizes and status changes. Pass `{ always: true }` for an attract loop that animates on the Start overlay.

**useCanvas** gives a ref for a `<canvas>` (or any element, for WebGL hosts), its CSS size and the device pixel ratio (capped at 2). For 2D canvases `ctx()` returns a context already scaled to CSS pixels, so draw in `size.w` by `size.h` coordinates.

**useKeys** returns the shell's `KeyState`. Keys are captured only while focus is inside the game. Captured keys stop propagating, so OS shortcuts (F for full screen, window keys) and page scrolling never fire. Cmd, Ctrl and Alt combos always pass through (Cmd+K search still works). Aliases: `left` (ArrowLeft, A), `right` (ArrowRight, D), `up` (ArrowUp, W), `down` (ArrowDown, S), `action` (Space, Enter). Held keys clear on blur, pause and restart.

**TouchControls** renders an on-screen d-pad (left) and round buttons (right) on touch devices only, while playing. They feed the same `KeyState`, so `keys.down('left')` works for both. Example: `<TouchControls dpad buttons={[{ key: 'Space', label: 'jump' }]} />`. Tapping the canvas is also fine; use pointer events.

**sfx** is a tiny WebAudio synth. No audio files. The mute state is shared by every game and persisted in localStorage (`arcade:muted`). For music, schedule notes a little ahead with `tone({ delay })` (and drums with `noise(dur, vol, delay)`) against `sfx.clock()`, which is null while muted or before the first tap, so a song never bunches up when sound comes back (Palm Drive's `music.ts` is an example).

**loadThree / useThree** import `three` dynamically, so every 3D game shares one lazily loaded chunk and none of it lands in the initial bundle.

## Party Kit

Group games (`party`) and drinking games (`drinking`) are played on one phone passed around the room. They import their building blocks from `../../kit/party` (pure helpers also from `../../kit/party-core.ts`, so logic modules stay testable under node). `games/imposter` is the reference.

```ts
usePlayers(): [string[], (players: string[]) => void];  // the roster every party game shares, in seating order
useStored<T>(key, fallback, parse): [T, (v: T) => void]; // JSON remembered under arcade:<key> (decks, house rules)
function PlayerList(props: { min: number; max?: number; label?: string }): JSX.Element; // add names, tap to remove
function Screen(props: { kicker?; title?; sub?; children?; actions?; onEnter?: () => void; center?: boolean; arm?: number }): JSX.Element;
function PassTo(props: { name: string; index: number; note?; onReady: () => void; label?: string; className?: string }): JSX.Element;
function Big(props: { onClick; primary?; disabled?; quiet? }): JSX.Element;  // full width button, Row puts them side by side
function HowToPlay(props: { steps: ReactNode[]; label?: string }): JSX.Element; // folded rules for the setup step
function Option(props: { label; value; options; onChange }): JSX.Element; // label plus Segmented
function Chips(props: { label?; value: T[]; options; onChange }): JSX.Element; // multi-select, keeps one on
function useCountdown(seconds, { running?, onEnd?, tick? }): { left: number; reset(n?): void };
function Countdown(props: { left: number; total: number; size?: number }): JSX.Element;
function useDeck<T>(items: readonly T[]): { card?: T; next(); back(); canBack; dealt; total }; // deals the first card at once
// PlayerList also takes emptyHint for games where names are optional; .arcade-sr hides text from the screen but not from screen readers
Avatar, playerColor, DrinkNote, shuffle, pick, Pile, listNames, sips, clock, mulberry32
```

A party game wraps itself in `<GameShell meta={meta} autoStart>`: its setup step is the start screen, so the shell's Start card is skipped. The rest is a `step` state machine where each step renders one keyed `<Screen>` (or `<PassTo>` before anything secret). Keying steps returns focus to the game after the button that led there unmounts, so Enter and Space keep working. Restart remounts the game back to its setup step, and the roster and settings carry over. A new step ignores taps, Enter and Space for its first `arm` ms (550 by default, 800 on `PassTo`), and `Big` drops a second press within 320 ms, both timed from the event itself, so a double tap can't skip a step or flash a secret. The guard is JS rather than CSS because reduced motion cuts every animation. Party and drinking games also ask for a second tap on the shell's Restart, and pausing hides the stage. Timers use `useCountdown`, so pausing (Esc, or hiding the window) stops the clock. Shared classes for cards, player grids and score rows (`.arcade-party-card`, `.arcade-party-picks`, `.arcade-party-scores`) live in `kit/party.css` and take the game's `--accent`.

The look is printed game night: flat fills, cards with an inset border and a hard edge (`.arcade-party-card`, cream stock with `.is-paper`), buttons with a bottom edge that presses down, and Bricolage Grotesque for titles, card text and buttons. A game sets `--on-accent` to a dark ink when white on its accent falls under 4.5:1 (most bright accents do; check button text), can swap `--party-display` for its own face, and `--party-timer` recolors the countdown ring. Display faces are self-hosted in `public/fonts/` (latin subsets, SIL Open Font License); declare an `@font-face` in the game's CSS and the browser only downloads it when the game shows it. Motion stays short and purposeful, and everything inside `.arcade-party` collapses to instant under `prefers-reduced-motion`.

Drinking games show `<DrinkNote />` on their setup step and keep their 18+ decks off by default.

## Leaderboards

Add `leaderboard` to `meta.ts` and the game gets a top 100 board. There is nothing else to wire: the score a game passes to `shell.gameOver(score)` is the one that is ranked.

```ts
leaderboard: { order: 'desc', max: 100_000 },                              // higher wins
leaderboard: { order: 'asc', min: 3_000, max: 3_600_000, format: 'time' }, // times in ms, lower wins
```

| field | meaning |
| --- | --- |
| `Order` | `'desc'` when a higher score wins, `'asc'` for times. Must match the shell: `'asc'` games pass `lowerIsBetter` |
| `Max` | highest plausible score; the server rejects anything above it, so keep it generous but finite |
| `Min` | lowest plausible score (default 0), mostly for times |
| `Format` | `'time'` shows milliseconds as seconds on the arcade home board (the Game Over card uses the shell's `formatScore`) |
| `Unit` | shown after the number on boards, e.g. `'m'` or `'days'` |
| `Measure` | what the board ranks when the title does not say, e.g. `'Fastest Clear'`, shown above the list |
| `Variants` | one board per setting that changes difficulty, e.g. `{ easy: 'Easy', hard: 'Hard' }`. Each becomes the board `<id>-<key>` |

A game with `variants` names the board when it ends a round: `shell.gameOver(score, { board: 'hard' })`. A round without a valid `board` is not ranked.

Games that keep their own bests (per level, or a streak) and show no score on the Game Over card pass the ranked number as `rank` instead: `shell.gameOver(undefined, { title: 'Cleared', board: 'expert', rank: ms })`. The shell ranks `rank` and formats it with the board's spec.

When a round ends with a score that would make the top 100, the Game Over card shows a name field (1 to 16 characters) and Submit, plus a Leaderboard button that shows the board. The arcade home has a Leaderboards view (`Leaderboards.tsx`): a card per opted in game with its top 3, grouped by category, and a Top Scores / Online Wins switch. A game with `variants` shows one board at a time, with chips to switch (a menu when there are more than four) and the one with the most entries first. Opening a card shows that board's top 100. The cards load from one request, `GET /leaderboard/top`; if that fails (or the Worker predates it) they show this device's boards, labeled This Device.

Global boards come from the Cloudflare Worker in `worker/`, configured through `PUBLIC_ARCADE_API` or its built-in default URL. If the API URL is empty or unavailable, scores stay in localStorage (`arcade:boards`) and the board is labeled This Device. The Worker validates the game id, score and name, and allows a few submissions per IP per minute. After opting a game in, run `npm run arcade:specs` and redeploy the Worker.

Opt in only when the score is comparable across players: leave it out for games without a score and two player games (they get an Online Wins board instead). When a setting changes the difficulty of the score (a pace or level picker), use `variants` so each setting has its own board.

Baduk (Go and Omok) and Badminton are desktop apps, not arcade games, but they share the same Worker. Their boards and rooms are listed in `src/os/arcade/apps.ts`, show up on the arcade Leaderboards page (their cards' colors and glyphs live in `leaderboard-cards.ts`, and Go's three board sizes share one card), and are written into the Worker specs by `npm run arcade:specs`.

## Online Rooms

`online: { seats }` adds Play Online to the Start card (and to the Pause and solo Game Over cards, which drop the round in progress): create a room, share the four character code or link, and the host starts. There are two kinds:

- **Match** (`online: { seats: 2 }`): players play each other. The game reads `useOnline()` for its seat, sends moves with `send()`, listens with `onMessage()` and calls `reportResult(round, winnerSeat)` when a round ends. Chess, Connect Four, Checkers, Pong, Air Hockey, Light Cycles and Cox Box work this way.
- **Race** (`online: { seats: 4, race: true }`): every player runs their own round at the same time and the best score wins. No game code is needed: the shell collects each player's `gameOver` score, shows the standings on the Game Over card and reports the winner. Use it for games with one comparable score (a `leaderboard` without `variants`).

A match game whose round goes on after a player is out (Scramble's done watching) can show that player's card early with `gameOver(undefined, { title, detail, wait })` and keep the round running from a timer, since the frame loop stops with the card. While `wait` is set the host's Play Again is held, with `wait` as the note under it, and the room is not told the round is over; the game calls `updateOver({ title, detail })` without `wait` once the round ends for everyone. A new host clears it, since the old host's game ran the round; `useOnline().handoffs` bumps then too, so a game whose card went up early can say the round is over.

Rooms lock once the host starts. Add `lateJoin: true` to let people join between rounds instead: a latecomer waits in the lobby and plays the next round, and wins only count the players who started that round. Cox Box uses this for eight-crew typing races.

### Public Rooms

Every room is private or public, for every game with `online` (arcade games through the shell, and Go, Omok and Badminton through `apps/online-room.tsx`), so a new game gets it for free. The Play Online card and the app lobbies offer Private (join with the code or link) or Public, remembered per device, and the host can switch a room either way from its lobby (and between rounds in games people can join late). A public room is listed in Open Rooms while its host is in it and someone can still join: until people fill every seat (bots step aside), and after the start only if the game has `lateJoin`. Open Rooms shows on the arcade home above the games (each tile opens the game and joins, or the game's own app for Go, Omok and Badminton) and on each game's Play Online card. `useOpenRooms(game?)` reads the list (`GET /rooms`), refreshing every few seconds while the page is visible.

### Bots

Add `bots: true` to `online` and the lobby (and the online Game Over card, between rounds) gives the host a Bots stepper. Bots fill the seats nobody holds: the room lists them by name, a host can start with just bots to play against, and someone who joins takes a bot's seat (the bot moves to another free seat, or sits out once the room is full of people). The host's last count is remembered per game; `defaultBots` sets where it starts (Scramble fills to eight).

`useOnline().bots` lists the bots as `{ seat, name }`: the ones playing this round while it is under way, otherwise the ones the host has added so far, so a lobby setting can appear only when there are bots to tune. The host's game drives them like its computer players and shares them through its own messages; everyone else just shows them. Bots send nothing, never report results and never block a round's result, and a round a bot wins counts for nobody's Online Wins. Name them with `botNames` (Palm Drive's are its CPU drivers, Cox Box's the rival crews). Light Cycles, Cox Box, Palm Drive and Scramble have bots; two-seat games have no empty seat to fill, and score races have no computer players.

### Quick Play

Add `quick: true` (with `bots`) and the Start card's Play finds a match like an .io game: it joins a public quick-play room of the game that is gathering people, or opens one, and the room starts on its own about 20 seconds later (3 once people fill it) with bots in every seat nobody holds. Whoever came in first hosts. The game's own settings move next to the second button, `soloLabel` (Play Offline by default, Scramble's says Play with Bots), and Play with Friends makes rooms of your own as before. `useOnline().quick` is true in a quick match. The shell never ends a quick round because someone left, so the game must cope: the host hands a departed player's car, snake or rider to a bot, or takes it off the field. Play Again after a quick match finds the next one. Scramble, Slither, Sumo, Tank Maze, Cox Box, Mini Golf, Grand Prix, Palm Drive and Light Cycles have it.

### Spectators

Add `watch: true` and people can watch a room's rounds without a seat. Joining a room that is playing a round nobody can join (or that is full) watches it instead, and a public room like that stays in Open Rooms with Watch on its tile (in the Lounge too). A spectator comes in mid-round straight into the game, sees the lobby between rounds, and gets Play the Next Round (Play Instead in the lobby) once a seat is free. Hosts switch Spectators between Allowed (the default) and Off in the lobby and on the online Game Over card, remembered on their device; Off sends anyone watching away. Everyone sees who is watching, in the room's list and in the status pill.

To the game, a spectator is a guest with seat -1 and `useOnline().watching`: it gets everything the host broadcasts (`send` without `to`, fast messages a few times a second) and never messages addressed to one seat, and its `send` and `reportResult` do nothing. So it should draw the host's state for every player, steer nothing, name the winner instead of saying You, and not wait for its own player to appear in a roster. Pong, Air Hockey, Sumo, Cox Box, Tank Maze and the Badminton app (through `useAppRoom().watching`) support it. Games where guests only see their own seat's view, or rebuild state from a hello, need a public broadcast first.

The online Game Over card also lists who is still in the room (people, bots and spectators), so everyone sees who is there for the next round as people come and go.

Invite links (`/?game=<id>&room=<code>`) open the game and join the room automatically. Online wins go to the game's Online Wins board when every player reports the same winner. After adding `online` to a game, run `npm run arcade:specs` and redeploy the Worker.

## Lounge

The arcade's global chat is the Lounge, an app of its own (`src/os/apps/Lounge.tsx`) so it can stay open next to a game. It opens from the Dock, from the arcade header, and from the chat button in every game's control bar; on a computer, opened next to a game it docks down the right edge and slides the game window aside (`side` in `registry.tsx`, `placement.ts`), and on a phone it opens over the game with a back button to it. It has three channels (#general, #find-a-game and #ideas, in `lounge-core.ts`), a list of who's here, typing notes, unread counts per channel, and an unread badge on its Dock icon and on the games' chat button while you play.

Who's here shows what each person is playing. `GameShell` reports its game with `usePlayingReport` (`playing.ts`), and the Go, Omok and Badminton apps with `usePlayingRoom`; the window most recently in front wins. A room is shown too while it is public, with Join next to it. #find-a-game lists every public room where someone is waiting above its messages (the same Open Rooms the arcade home shows, asked for every few seconds while the list is on screen), each with Join; it folds away, and remembers. Share in Lounge, in every online lobby, opens the Lounge on #find-a-game with the room attached: the message then shows the game, whether the room is still open (from Open Rooms) and Join. Joining opens arcade games in the Arcade app and the others in their own app.

It connects only while the app is open (minimized included), through `LoungeLink` in `lounge.ts` (reconnects with backoff, pings to stay open), to the Worker's `Lounge` object. Messages are plain text from a name of 1 to 16 characters, the same name the leaderboards and rooms remember. The Worker cleans, checks and rate limits everything (`lounge-core.ts`, shared with it); see `worker/README.md` for the protocol, the limits and how to wipe the chat.

## Rules

1. **Prefix CSS.** Every selector in your CSS starts with `.g-<id>` (the shell root carries that class). Keyframes are named `g-<id>-*`. Never style shared classes or `body`.
2. **Use the kit.** Wrap the game in `<GameShell>`, drive animation with `useGameLoop`, read input with `useKeys`, draw with `useCanvas`. Do not add your own `requestAnimationFrame` loops, global `keydown` listeners, or overlays for start, pause and game over.
3. **Clean up on unmount.** Every timer, listener, observer, worker, audio node and WebGL resource you create must be released in an effect cleanup. For three.js: dispose geometries, materials, textures and the renderer (`renderer.dispose()`, `renderer.forceContextLoss()`).
4. **Touch support.** Everything must be playable on the phone and iPad frames: `<TouchControls>` or pointer events on the canvas. Use `pointer*` events, not `mouse*`, and give tap targets at least 40px.
5. **No new dependencies.** Use the platform, React and `three` (via `loadThree`/`useThree`, never a static `import 'three'`).
6. **Responsive.** Fill the parent (the shell is `position: absolute; inset: 0`). It must work from the ~540px laptop window up to full screen, down to the 390px phone sheet, and in `compact` mode if it makes sense.
7. **Copy.** Lowercase, short, friendly. No em dashes, no lorem ipsum.
8. **Stay in your folder.** No edits to shared files.

## Checklist

- [ ] `games/<id>/meta.ts` exports `meta` with `meta.id === '<id>'` and every field filled
- [ ] `games/<id>/index.tsx` default exports the game wrapped in `<GameShell meta={meta} compact={compact} onExit={onExit}>`
- [ ] CSS selectors and keyframes prefixed `.g-<id>` / `g-<id>-`
- [ ] Uses `useGameLoop`, `useKeys`, `useCanvas` (or `useThree`) instead of raw rAF and listeners
- [ ] Calls `shell.gameOver(score)` and `shell.setScore()` where it has a score
- [ ] Adds `leaderboard` to `meta.ts` if the score is comparable between players
- [ ] Pauses cleanly: switching Chrome tabs, minimizing, hiding the browser tab all stop the loop
- [ ] Playable with touch on phone (390x844) and iPad (820x1180)
- [ ] No console errors, no horizontal overflow, everything released on unmount
- [ ] `npm test`, `npx astro check` and `npm run build` pass, and the build shows the game as its own chunk

Start from `games/_example`, a ~60 line game that uses every piece of the kit.
