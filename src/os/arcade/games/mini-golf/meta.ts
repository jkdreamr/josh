import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'mini-golf',
  title: 'Mini Golf',
  blurb: 'Nine holes around campus. Bank it off the Quad fountain, climb Hoover, loop The Dish and stay out of Lagunita.',
  category: '3d',
  players: '1-4P',
  controls: 'Drag back from anywhere and let go to putt. Or aim with the arrow keys and hold space for power.',
  accent: '#3f9b4f',
  glyph: 'M12 3v12M12 3l6 2.5-6 2.5M7.5 17.5c0 1.7 2 3 4.5 3s4.5-1.3 4.5-3-2-3-4.5-3-4.5 1.3-4.5 3z',
  order: 13,
  leaderboard: { order: 'asc', min: 9, max: 63, unit: 'strokes', measure: 'Strokes for 9 Holes' },
  online: { seats: 4, bots: true },
};
