export type GameCategory = 'arcade' | 'puzzle' | '3d' | 'multiplayer';

/** Opt-in global leaderboard. The server uses it to validate submissions. */
export type LeaderboardSpec = {
  /** 'desc' when a higher score wins, 'asc' for times where lower wins. */
  order: 'desc' | 'asc';
  /** Highest plausible score. Anything above it is rejected. */
  max: number;
  /** Lowest plausible score (default 0). Useful for times. */
  min?: number;
  /** 'time' shows milliseconds as seconds on the arcade home board (default 'number'). */
  format?: 'number' | 'time';
  /** Shown after the number on boards, e.g. 'pts' (ignored for times). */
  unit?: string;
  /** What the board ranks, shown above the list when the game title alone does not say, e.g. 'Win Margin vs Computer'. */
  measure?: string;
  /**
   * Separate boards for a setting that changes how hard a score is (a level or pace picker).
   * Each key becomes its own board `<id>-<key>` and the value is its label. The game names
   * the board when it ends a round: `gameOver(score, { board: key })`.
   */
  variants?: Record<string, string>;
};

/**
 * Online rooms. 'match' games play each other through useOnline(); 'race' games run the same round side by side and the
 * best score wins. Rooms lock when the host starts unless lateJoin lets players join between rounds.
 */
export type OnlineSpec = { seats: number; race?: boolean; lateJoin?: boolean };

export type GameMeta = {
  /** Must equal the folder name in src/os/arcade/games/<id>/. Lowercase, a-z 0-9 and dashes. */
  id: string;
  title: string;
  /** One short sentence for the tile. */
  blurb: string;
  category: GameCategory;
  /** e.g. '1P' or '1-2P' */
  players: string;
  /** One-line how-to shown on the Start overlay. */
  controls: string;
  /** CSS color for the tile and the Play button. */
  accent: string;
  /** SVG path data drawn in a 24x24 viewBox, stroked in white. */
  glyph: string;
  /** Sort order inside its category (ascending). */
  order: number;
  /** Set to give the game a top 100 board. Leave out for games without a comparable score. */
  leaderboard?: LeaderboardSpec;
  /** Set to allow online rooms with this many seats. */
  online?: OnlineSpec;
};

export type GameProps = { compact?: boolean; onExit?: () => void; roomCode?: string };
