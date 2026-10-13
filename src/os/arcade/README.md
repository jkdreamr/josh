# Arcade

Little games that live inside the Chrome app at `chrome://games`. Each game is one folder. Adding a game never touches a shared file: drop a folder in `games/`, and the arcade grid, routing (`chrome://games/<id>`), lazy loading and code splitting pick it up automatically.

## Interface

```ts
// src/os/arcade/types.ts
export type GameCategory = 'arcade' | 'puzzle' | '3d' | 'multiplayer';
export type LeaderboardSpec = { order: 'desc' | 'asc'; max: number; min?: number; format?: 'number' | 'time' };
export type OnlineSpec = { seats: number; lateJoin?: boolean };
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
| `category` | section on the arcade page: Arcade, Puzzles, 3D, Multiplayer |
| `players` | `'1P'`, `'2P'`, `'1-2P'` |
| `controls` | one line how-to, shown on the Start and Pause cards |
| `accent` | CSS color for the tile icon and shell accents |
| `glyph` | SVG path data (`d`) for a 24x24 viewBox, drawn as a white 2px stroke |
| `order` | sort order inside its category (lower first) |
| `leaderboard` | optional, opts the game into a top 100 board (see Leaderboards) |
| `online` | optional, enables online rooms for `seats` players. Rooms lock when the host starts, unless `lateJoin: true` lets people join between rounds (they wait in the lobby and play the next one) |

`manifest.ts` reads every `games/*/meta.ts` eagerly (they are tiny) and every `games/*/index.tsx` lazily through `React.lazy`, so each game is its own chunk and downloads only when opened. Folders starting with `_` are ignored. In dev you can list them with `localStorage.setItem('arcade:dev', '1')` and a reload; `_example` then appears as "Catch".

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
  className?: string; style?: CSSProperties;
}): JSX.Element;

function useShell(): ShellApi;
type GameStatus = 'ready' | 'playing' | 'paused' | 'over';
type ShellApi = {
  meta: GameMeta; status: GameStatus; round: number; active: boolean; compact: boolean; touch: boolean;
  keys: KeyState; root: RefObject<HTMLDivElement | null>;
  start(): void; pause(): void; resume(): void; restart(): void;
  gameOver(score?: number, info?: { title?: string; detail?: string }): void;
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
  noise(dur?: number, vol?: number): void;
  unlock(): void; isMuted(): boolean; setMuted(m: boolean): void; toggleMute(): void; subscribe(fn: () => void): () => void;
};
function useMuted(): [boolean, (m: boolean) => void];
function loadThree(): Promise<typeof import('three')>;
function useThree(): typeof import('three') | null;   // null until loaded
```

**GameShell** owns the frame every game shares: Start overlay (glyph, title, controls line, Play), Pause overlay (Esc or P, the pause button, or automatically when the game stops being visible), Game Over overlay (score, best, "new best", Play again, Arcade), the live score pill, and the top-right control row (pause, restart, mute, back to arcade). Restart remounts the children, so a round's state can live in plain refs and `useState`. Call `shell.gameOver(score)` to end a round; the shell records the best via `useHighScore`.

**useGameLoop** runs `update(dt)` then `render()` on `requestAnimationFrame` while the shell is `playing`. `dt` is in seconds and clamped to 1/20 s, so a stalled frame never teleports anything. It stops when the browser tab is hidden, the Chrome tab is in the background, the window is minimized or off screen, or the game is paused. While idle it still calls `render()` once after resizes and status changes. Pass `{ always: true }` for an attract loop that animates on the Start overlay.

**useCanvas** gives a ref for a `<canvas>` (or any element, for WebGL hosts), its CSS size and the device pixel ratio (capped at 2). For 2D canvases `ctx()` returns a context already scaled to CSS pixels, so draw in `size.w` by `size.h` coordinates.

**useKeys** returns the shell's `KeyState`. Keys are captured only while focus is inside the game. Captured keys stop propagating, so OS shortcuts (F for full screen, window keys) and page scrolling never fire. Cmd, Ctrl and Alt combos always pass through (Cmd+K search still works). Aliases: `left` (ArrowLeft, A), `right` (ArrowRight, D), `up` (ArrowUp, W), `down` (ArrowDown, S), `action` (Space, Enter). Held keys clear on blur, pause and restart.

**TouchControls** renders an on-screen d-pad (left) and round buttons (right) on touch devices only, while playing. They feed the same `KeyState`, so `keys.down('left')` works for both. Example: `<TouchControls dpad buttons={[{ key: 'Space', label: 'jump' }]} />`. Tapping the canvas is also fine; use pointer events.

**sfx** is a tiny WebAudio synth. No audio files. The mute state is shared by every game and persisted in localStorage (`arcade:muted`).

**loadThree / useThree** import `three` dynamically, so every 3D game shares one lazily loaded chunk and none of it lands in the initial bundle.

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

When a round ends with a score that would make the top 100, the Game Over card shows a name field (1 to 16 characters) and Submit, plus a Leaderboard button that shows the board. The arcade home has a Leaderboards view with every opted in game.

Global boards come from the Cloudflare Worker in `worker/`, configured through `PUBLIC_ARCADE_API` or its built-in default URL. If the API URL is empty or unavailable, scores stay in localStorage (`arcade:boards`) and the board is labeled This Device. The Worker validates the game id, score and name, and allows a few submissions per IP per minute. After opting a game in, run `npm run arcade:specs` and redeploy the Worker.

Opt in only when the score is comparable across players: leave it out for games without a score, two player games, and games where a setting changes the difficulty of the score (for example a pace or level picker), unless each setting is its own game.

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
