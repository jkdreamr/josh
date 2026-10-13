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
};

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
  },
  { id: goBoardOwner(13), title: 'Go', app: 'baduk', leaderboard: goBoards(13) },
  { id: goBoardOwner(19), title: 'Go', app: 'baduk', leaderboard: goBoards(19) },
  {
    id: 'omok',
    title: 'Omok',
    app: 'baduk',
    leaderboard: { order: 'asc', min: 5, max: 113, unit: 'moves', measure: 'Fewest Moves to Beat the Computer', variants: { easy: 'Easy', normal: 'Normal' } },
    online: { seats: 2 },
  },
  {
    id: 'badminton',
    title: 'Badminton',
    app: 'badminton',
    leaderboard: { order: 'desc', min: 1, max: 63, unit: 'pts', measure: 'Point Margin in a Win vs Computer', variants: { easy: 'Easy', normal: 'Normal', hard: 'Hard' } },
    online: { seats: 2 },
  },
];

export const getAppGame = (id: string) => appGames.find((game) => game.id === id);
