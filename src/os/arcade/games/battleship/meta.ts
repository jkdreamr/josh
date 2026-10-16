import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'battleship',
  title: 'Broadside',
  blurb: 'Hide your fleet, then trade shots until one navy is gone. Three computer captains, pass and play, or online.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Drag ships to place them, tap one to turn it. Then tap a square to fire. Arrows and Enter work too.',
  accent: '#0a84ff',
  glyph: 'M2 15h20l-3 4H5zM6 15v-3h9l3 3M9 12V8h4v4M11 8V5',
  order: 6,
  online: { seats: 2 },
};
