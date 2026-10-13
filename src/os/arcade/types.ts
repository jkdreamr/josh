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
};

/** Online rooms. lateJoin lets players join between rounds instead of locking the room after the first start. */
export type OnlineSpec = { seats: number; lateJoin?: boolean };

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
