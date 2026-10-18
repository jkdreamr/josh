import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'hoops',
  title: 'Hoops',
  blurb: 'Sixty seconds a round. Swipe to shoot, swish for three, and keep up when the hoop starts moving.',
  category: '3d',
  players: '1P',
  controls: 'Drag up to shoot, drift sideways to aim. Or hold space for power and use arrows to aim.',
  howTo: [
    "Shoot from the line before the round clock runs out. Each round lasts 60 seconds.",
    "Drag or swipe further for more distance, and sideways to aim. On a keyboard, release space when the power bar hits the sweet spot.",
    "A clean swish is worth 3 points. A shot off the rim or backboard is worth 2.",
    "Make at least 4 baskets in round one to move on. Each round needs one more than the last.",
    "From round two the hoop starts sliding side to side, and it moves faster each round after.",
    "Fall short of the target when time runs out and the game is over.",
  ],
  accent: '#e8702a',
  glyph: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 10.5c3 .5 6 2 8.5 4.5M20.5 13.5c-3-.5-6-2-8.5-4.5M7 5.5c3 3 5 7 5 13M17 5.5c-3 3-5 7-5 13',
  order: 3,
  music: 'house',
  leaderboard: { order: 'desc', max: 10_000 },
  online: { seats: 4, race: true },
};
