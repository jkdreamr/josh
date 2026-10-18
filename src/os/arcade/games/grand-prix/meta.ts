import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'grand-prix',
  title: 'Grand Prix',
  blurb: 'A hybrid open-wheel racer at Monza with real physics: tyre grip and temperature, downforce, DRS, ERS and an 8-speed box. Hot lap your ghost, race 19 cars from a standing start, split screen with a friend or race online.',
  category: '3d',
  players: '1-8P',
  controls: 'Arrows or WASD drive (on a phone, the on-screen pedals and steering). E and Q shift (auto by default), Space opens DRS in a zone, C changes camera, V looks back, R resets to the track. Gamepads work too.',
  accent: '#e10600',
  glyph: 'M3 15.5h18M5.5 15.5l1.2-3.2h10.6l1.2 3.2M8.5 12.3l1-2.6h5l1 2.6M2.5 9h4M17.5 9h4M12 7.2V9.7M5.2 17.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0M15.6 17.6a1.6 1.6 0 1 0 3.2 0a1.6 1.6 0 1 0-3.2 0',
  order: 0,
  // fastest valid lap in a time trial, one board with driving aids and one without
  leaderboard: {
    order: 'asc',
    min: 60_000,
    max: 600_000,
    format: 'time',
    measure: 'Fastest Lap',
    variants: { pro: 'Monza, No Assists', assisted: 'Monza, With Assists' },
  },
  online: { seats: 8, lateJoin: true, bots: true },
};
