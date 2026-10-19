import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'mancala',
  title: 'Mancala',
  blurb: 'Sow seeds around the board, land in your store for another turn and capture across. Three computer levels, pass and play or online.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Tap one of your pits to sow it. Arrow keys pick a pit, Enter sows.',
  howTo: [
    "Pick one of your six pits to scoop up its seeds and drop one in each pit counterclockwise, including your store but skipping your opponent's.",
    "If your last seed lands in your own store, you take another turn.",
    "If your last seed lands in an empty pit on your side, you capture it plus every seed in the pit across.",
    "When either side runs out of seeds, the game ends and each player banks whatever is left on their own side.",
    "Whoever has more of the 48 seeds in their store wins.",
  ],
  accent: '#ff9f0a',
  glyph: 'M6 7h12a5 5 0 0 1 0 10H6a5 5 0 0 1 0-10M9 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0M15 12m-1.5 0a1.5 1.5 0 1 0 3 0a1.5 1.5 0 1 0-3 0',
  order: 6,
  online: { seats: 2 },
};
