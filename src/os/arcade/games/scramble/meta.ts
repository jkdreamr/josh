import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'scramble',
  title: 'Scramble',
  blurb: 'An egg battle royale for up to eight. Jump from the bus, loot up, build walls and be the last egg standing as the storm closes in.',
  category: '3d',
  players: '1-8P',
  controls: 'WASD walks, the mouse aims, click shoots. Space jumps from the bus and builds walls, E picks up, R reloads, 1 2 3 switch, H heals, G shields, F shoots the nearest egg.',
  accent: '#7b3fd1',
  glyph: 'M12 2.5c-4 0-7 6.3-7 11a7 7 0 0 0 14 0c0-4.7-3-11-7-11zM8.5 12.5l2 1.6 1.6-2.2 1.9 1.7 1.6-1.4',
  order: 2,
  // solo matches against seven computer eggs, one board per difficulty: damage dealt, 100 an elimination, 500 a win
  leaderboard: { order: 'desc', max: 10_000, unit: 'pts', measure: 'Best Match vs Computer', variants: { easy: 'Easy', normal: 'Normal', hard: 'Hard' } },
  online: { seats: 8, lateJoin: true, bots: true },
};
