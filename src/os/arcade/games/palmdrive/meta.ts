import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'palmdrive',
  title: 'Palm Drive',
  blurb: 'Kart down Palm Drive toward Memorial Church. Grab item boxes and coins, dodge traffic and keep your three balloons.',
  category: '3d',
  players: '1-8P',
  controls: 'Arrows or A/D steer, Space or Up uses your item. Press Up just before GO for a rocket start. On touch, tap or swipe to steer and tap the item.',
  accent: '#d8812f',
  glyph: 'M5 17l2-6h10l2 6M5 17h14M7 17v2M17 17v2M8 11l1.5-4h5L16 11M12 3v2',
  order: 2,
  leaderboard: { order: 'desc', max: 1_000_000 },
  online: { seats: 8, race: true },
};
