import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'paperio',
  title: 'Paper.io: The Farm',
  blurb: 'Paper.io 2 on campus. Leave your land, loop back and claim everything you closed off. Cut trails, never your own.',
  category: 'multiplayer',
  players: '1-8P',
  controls: 'Steer toward the mouse, or point the way with the arrow keys or WASD (two keys go diagonally). Touch: drag anywhere. Two players: WASD against the arrow keys, or drag on your half.',
  accent: '#b1161c',
  glyph: 'M5 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM11 17h4a3 3 0 0 0 3-3V9.5M15.5 4.5h5v5h-5z',
  order: 0.5,
  // Solo games against the standard field of bots (match.ts RANKED_BOTS) rank the most of the map you held, one board
  // per bot level, so everyone on a board faced the same opponents. Other bot counts, two players and online rounds
  // are not ranked; online wins count toward the Online Wins board.
  leaderboard: { order: 'desc', min: 0.5, max: 100, unit: '%', measure: 'Most of the Map vs Bots', variants: { easy: 'Easy', normal: 'Normal', hard: 'Hard' } },
  online: { seats: 8, lateJoin: true },
};
