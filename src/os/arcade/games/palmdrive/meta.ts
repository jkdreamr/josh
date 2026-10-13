import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'palmdrive',
  title: 'Palm Drive',
  blurb: 'Kart racing on campus: five laps up Palm Drive, round the Oval and through the Arboretum. Drift for mini-turbos and throw shells and bananas.',
  category: '3d',
  players: '1-8P',
  controls: 'Left and right steer, hold Space to drift. X uses your item (hold it to keep a banana or shell behind you), Z throws it back, C slams the kart beside you, B cashes 5 coins for a boost, V looks back.',
  accent: '#d8812f',
  glyph: 'M2.5 15h19M4 15l1.5-3h4.5M9.5 15V9.8M14 15l2.4-2.5H20M11.5 12l2.5-1.8M7.7 7.6a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0-3.6 0M4.4 18a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0M15.8 18a1.9 1.9 0 1 0 3.8 0a1.9 1.9 0 1 0-3.8 0',
  order: 2,
  // five-lap races on the Palm Drive course, one board per class
  leaderboard: { order: 'asc', min: 90_000, max: 1_800_000, format: 'time', measure: 'Fastest Race', variants: { 'palm-50cc': '50cc', 'palm-100cc': '100cc', 'palm-150cc': '150cc', 'palm-200cc': '200cc' } },
  online: { seats: 8, lateJoin: true },
};
