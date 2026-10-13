import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'paperio',
  title: 'Paper.io: The Farm',
  blurb: 'Paper.io 2 on campus. Leave your land, loop back and claim everything you closed off. Cut trails, never your own.',
  category: 'multiplayer',
  players: '1-8P',
  controls: 'Steer toward the mouse, or turn with A and D or the arrow keys. Touch: drag anywhere. Two players: A and D against the arrow keys, or drag on your half.',
  accent: '#b1161c',
  glyph: 'M5 13h4a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4a2 2 0 0 1 2-2zM11 17h4a3 3 0 0 0 3-3V9.5M15.5 4.5h5v5h-5z',
  order: 0.5,
  // no global board: the arcade keeps those off multiplayer games. Solo bests are kept per difficulty on the device,
  // and online rounds count toward the Online Wins board.
  online: { seats: 8, lateJoin: true },
};
