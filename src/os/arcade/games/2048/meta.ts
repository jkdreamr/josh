import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: '2048',
  title: '2048',
  blurb: 'Slide matching tiles together and keep building toward the golden tile.',
  category: 'puzzle',
  players: '1P',
  controls: 'Arrow keys or WASD to slide. Swipe or drag on the board. U undoes once. Your game is saved.',
  howTo: [
    "Every slide pushes all the tiles as far as they go, then a new 2 or 4 appears.",
    "Two tiles with the same number merge into one, and the new value is added to your score.",
    "Make the 2048 tile to win, then keep going for a bigger tile and a higher score.",
    "You get one undo per game, so save it for a slide you really regret.",
    "The game ends when the board is full and no neighboring tiles match.",
    "Online, everyone gets the same tiles and three minutes. Highest score wins.",
  ],
  accent: '#ff9f0a',
  glyph: 'M5 4h6v6H5zM13 4h6v6h-6zM5 12h6v8H5zM13 12h6v8h-6z',
  order: 2,
  music: 'lofi',
  leaderboard: { order: 'desc', max: 4_000_000 },
  online: { seats: 4, race: true },
};
