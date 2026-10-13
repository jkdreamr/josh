import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'bubble-shooter',
  title: 'Bubble Shooter',
  blurb: 'Bank shots off the walls, pop three of a kind and drop whole clusters before the ceiling closes in.',
  category: 'arcade',
  players: '1P',
  controls: 'Aim with the mouse or a finger and release to shoot. Tap the next bubble or press S to swap. Arrow keys and Space work too.',
  accent: '#ff375f',
  glyph: 'M2 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M9 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M16 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M5.5 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12 21l3-5',
  order: 7,
  leaderboard: { order: 'desc', max: 10_000_000 },
  online: { seats: 4, race: true },
};
