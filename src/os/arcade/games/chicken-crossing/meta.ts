import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'chicken-crossing',
  title: 'Chicken Crossing',
  blurb: 'One brave chicken, roads, rivers and rails. Ride the logs, mind the trains, and keep hopping.',
  category: 'arcade',
  players: '1P',
  controls: 'Arrows or WASD to hop. On touch, tap to hop and swipe to turn. Ride logs, wait for trains, coins add 3. P pauses.',
  howTo: [
    "Hop forward across grass, roads, rivers and rails. Each new row you reach scores a point.",
    "Cars and trucks will flatten you, so wait for a gap. Trees block your path on the grass.",
    "Rivers can't be swum. Land on a log or lily pad and hop off before it carries you off the edge.",
    "When a rail light flashes and the bell rings, a train is coming. Stay off the tracks until it passes.",
    "Grab coins for 3 extra points each.",
    "Keep moving. The view creeps forward and a hawk takes any chicken that falls behind or stands still too long.",
  ],
  accent: '#c66b32',
  glyph: 'M7 15c-4-1-3-6 0-6 0-3 5-5 7-2l2 2 4 1-4 2c1 4-3 7-7 5M10 17v4M14 17v4M11 5V3M14 5V3M12 9h.01',
  order: 6,
  music: 'bouncy',
  leaderboard: { order: 'desc', max: 100_000 },
  online: { seats: 4, race: true },
};
