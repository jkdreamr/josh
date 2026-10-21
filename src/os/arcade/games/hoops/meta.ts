import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'hoops',
  title: 'Hoops',
  blurb: 'Shoot around the arc against the clock. Swish it, get hot, and keep up when the hoop starts moving.',
  category: '3d',
  players: '1P',
  controls: 'Drag up to shoot and sideways to aim. Or hold space for power and use the arrow keys to aim.',
  howTo: [
    'Each round lasts 45 seconds. Hit the target number of baskets before the buzzer to move on.',
    'Drag or swipe up further for a longer shot, and sideways to aim. The green band on the meter is the make zone, the bright line in it is a swish.',
    'On a keyboard, hold space and let go when the meter is in the green. Arrow keys turn your aim.',
    'A basket is 2, a swish adds 1 and a shot from the three point line adds 1 more.',
    'Make three in a row to catch fire and every basket counts double until you miss.',
    'You move to a new spot after every make. Spots get deeper each round, and from round three the hoop slides side to side.',
  ],
  accent: '#e8702a',
  glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 10.5c3 .5 6 2 8.5 4.5M20.5 13.5c-3-.5-6-2-8.5-4.5M7 5.5c3 3 5 7 5 13M17 5.5c-3 3-5 7-5 13',
  order: 3,
  music: 'house',
  leaderboard: { order: 'desc', max: 10_000 },
  online: { seats: 4, race: true },
};
