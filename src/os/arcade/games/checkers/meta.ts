import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'checkers',
  title: 'Checkers',
  blurb: 'American rules: forced captures, multi-jumps and kings. Three computer levels or pass and play.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Tap or drag a piece, then its landing square. Arrow keys and Enter also work.',
  accent: '#ff375f',
  glyph: 'M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  order: 5,
};
