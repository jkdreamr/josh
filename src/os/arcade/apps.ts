import { GO_LEVELS, type GoSize } from '../games/go-levels.ts';
import type { LeaderboardSpec, OnlineSpec } from './types';

/**
 * Games that live in their own desktop apps instead of chrome://games. They share the arcade's
 * Worker: their boards show on the arcade Leaderboards page, their rooms use the same room codes,
 * and `npm run arcade:specs` writes them into the Worker specs next to the arcade games.
 */
export type AppGame = {
  /** Board and room id. Must not clash with an arcade game id. */
  id: string;
  title: string;
  /** Desktop app that plays it, opened by invite links. */
  app: 'baduk' | 'badminton';
  leaderboard?: LeaderboardSpec;
  online?: OnlineSpec;
  /** Icon color and glyph (24x24 path data) where the arcade lists the game, like its Open Rooms. */
  accent?: string;
  glyph?: string;
};

/** A circle as path data, for glyphs. */
const circle = (x: number, y: number, r: number) => `M${x} ${y}m-${r} 0a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0-${2 * r} 0`;
/** Two stones on the grid. */
const GO_GLYPH = `M3 9h2.8M12.2 9H21M3 15h8.8M18.2 15H21M9 3v2.8M9 12.2V21M15 3v8.8M15 18.2V21${circle(9, 9, 3.2)}${circle(15, 15, 3.2)}`;

/** Go boards: one per board size and computer level, titled "Go · 13×13 Master" and so on. */
const goBoards = (size: GoSize): LeaderboardSpec => ({
  order: 'desc',
  min: 0.5,
  max: size * size,
  unit: 'pts',
  measure: 'Win Margin vs Computer',
  variants: Object.fromEntries(GO_LEVELS.map((level) => [level.id, `${size}×${size} ${level.label}`])),
});

/** The board id owner for a Go board size. 9×9 keeps the original `go` id; online rooms use it for every size. */
export const goBoardOwner = (size: GoSize) => (size === 9 ? 'go' : `go${size}`);

export const appGames: AppGame[] = [
  {
    id: 'go',
    title: 'Go',
    app: 'baduk',
    leaderboard: goBoards(9),
    online: { seats: 2 },
    accent: '#b07d45',
    glyph: GO_GLYPH,
  },
  { id: goBoardOwner(13), title: 'Go', app: 'baduk', leaderboard: goBoards(13) },
  { id: goBoardOwner(19), title: 'Go', app: 'baduk', leaderboard: goBoards(19) },
  {
    id: 'omok',
    title: 'Omok',
    app: 'baduk',
    leaderboard: { order: 'asc', min: 5, max: 113, unit: 'moves', measure: 'Fewest Moves to Beat the Computer', variants: { easy: 'Easy', normal: 'Normal' } },
    online: { seats: 2 },
    accent: '#7d5733',
    // Five in a row.
    glyph: [[3.8, 20.2], [7.9, 16.1], [12, 12], [16.1, 7.9], [20.2, 3.8]].map(([x, y]) => circle(x, y, 1.75)).join(''),
  },
  {
    id: 'badminton',
    title: 'Badminton',
    app: 'badminton',
    leaderboard: { order: 'desc', min: 1, max: 63, unit: 'pts', measure: 'Point Margin in a Win vs Computer', variants: { easy: 'Easy', normal: 'Normal', hard: 'Hard', pro: 'Pro' } },
    online: { seats: 2, watch: true },
    accent: '#2f7a6d',
    // A shuttlecock.
    glyph: 'M9 16h6M9 16 5.5 4M15 16l3.5-12M12 16V4.5M5.5 4c4.3 1.4 8.7 1.4 13 0M9.5 16v1.5a2.5 2.5 0 0 0 5 0V16',
  },
];

export const getAppGame = (id: string) => appGames.find((game) => game.id === id);

/**
 * Where a room's game opens from anywhere on the OS, for invite links and Open Rooms: Cox Box and the app games in
 * their own apps, every other game in Chrome's arcade.
 */
export function roomApp(game: string, code: string): { app: 'coxbox' | 'baduk' | 'badminton' | 'chrome'; args: { room?: string; game?: 'go' | 'omok'; url?: string } } {
  const owner = getAppGame(game);
  if (game === 'coxbox') return { app: 'coxbox', args: { room: code } };
  if (owner?.app === 'baduk') return { app: 'baduk', args: { game: owner.id === 'omok' ? 'omok' : 'go', room: code } };
  if (owner?.app === 'badminton') return { app: 'badminton', args: { room: code } };
  return { app: 'chrome', args: { url: `chrome://games/${encodeURIComponent(game)}?room=${encodeURIComponent(code)}` } };
}
