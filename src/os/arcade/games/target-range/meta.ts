import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'target-range',
  title: 'Target Range',
  blurb: 'A moving bullseye gallery. The waves never stop, so keep your streak alive.',
  category: 'arcade',
  players: '1P',
  controls: 'Click or tap to shoot. Bullseyes earn more; misses reset your combo. Clear each wave before its clock runs out; past wave five they never stop, and they only get wilder. Arrows aim, Space shoots, P pauses.',
  accent: '#48b8a3',
  glyph: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  order: 12,
  leaderboard: { order: 'desc', max: 1_000_000, variants: { relaxed: 'Relaxed', standard: 'Standard' } },
};
