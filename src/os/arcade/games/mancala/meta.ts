import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'mancala',
  title: 'Mancala',
  blurb: 'Sow seeds around the board, land in your store for another turn and capture across. Three computer levels, pass and play or online.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Tap one of your pits to sow it. Arrow keys pick a pit, Enter sows.',
  accent: '#ff9f0a',
  glyph: 'M6 7h12a5 5 0 0 1 0 10H6a5 5 0 0 1 0-10M9 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M15 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  order: 6,
  online: { seats: 2 },
};
