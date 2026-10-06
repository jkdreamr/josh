export type GameCategory = 'arcade' | 'puzzle' | '3d' | 'multiplayer';

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
};

export type GameProps = { compact?: boolean; onExit?: () => void };
