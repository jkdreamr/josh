import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'moto-trials',
  title: 'Moto Trials',
  blurb: 'Ride a dirt bike over ramps, gaps and loops. Flip in the air to shave time off and land on your wheels.',
  category: 'arcade',
  players: '1P',
  controls: 'Up or W for gas, Down or S to brake, Left and Right lean back and forward. Flip in the air for time bonuses. On touch, use the buttons.',
  accent: '#ff6a2b',
  glyph: 'M4 17a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0zm10 0a3.5 3.5 0 1 0 7 0 3.5 3.5 0 0 0-7 0zM7.5 17l3-5h4l3.5 5M10.5 12L8 7h3M17.5 17L14 9l-1.5-2.5',
  order: 8,
  // race games may not use variant boards, so the one board ranks the Full Tour:
  // the sum of a rider's best time on every level. min sits far above any single
  // race time so online finishes are never plausible tour entries.
  leaderboard: { order: 'asc', min: 150_000, max: 3_600_000, format: 'time', measure: 'Full Tour, Sum of Best Times' },
  online: { seats: 4, race: true },
};
