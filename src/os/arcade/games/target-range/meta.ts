import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'target-range',
  title: 'Target Range',
  blurb: 'A moving bullseye gallery. The waves never stop, so keep your streak alive.',
  category: 'arcade',
  players: '1P',
  controls: 'Click or tap to shoot. Bullseyes earn more; misses reset your combo. Clear each wave before its clock runs out; past wave five they never stop, and they only get wilder. Arrows aim, Space shoots, P pauses.',
  howTo: [
    "Shoot the moving targets. Each wave asks for a set number of hits before its clock runs out.",
    "A hit is worth 100 and a bullseye 150. Every three hits in a row raise your multiplier, up to 4x.",
    "A miss resets your streak, so make each shot count.",
    "Clear a wave early for a bonus of 10 points per second left.",
    "The waves never end. They get faster, smaller and stranger, and every fourth one mixes three patterns at once.",
    "The game ends when a wave's clock hits zero. Relaxed gives more time and slower targets.",
  ],
  accent: '#48b8a3',
  glyph: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zM12 6a6 6 0 1 0 0 12 6 6 0 0 0 0-12zM12 10a2 2 0 1 0 0 4 2 2 0 0 0 0-4z',
  order: 12,
  music: 'drive',
  leaderboard: { order: 'desc', max: 1_000_000, variants: { relaxed: 'Relaxed', standard: 'Standard' } },
};
