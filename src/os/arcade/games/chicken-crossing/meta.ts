import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'chicken-crossing',
  title: 'Chicken Crossing',
  blurb: 'One brave chicken, a very long road. Find a gap, grab some corn, and keep hopping.',
  category: 'arcade',
  players: '1P',
  controls: 'Arrows or WASD to hop. Use the direction pad on touch. Grass is safe. Corn adds 3 points. P pauses.',
  accent: '#c66b32',
  glyph: 'M7 15c-4-1-3-6 0-6 0-3 5-5 7-2l2 2 4 1-4 2c1 4-3 7-7 5M10 17v4M14 17v4M11 5V3M14 5V3M12 9h.01',
  order: 6,
  leaderboard: { order: 'desc', max: 100_000 },
};
