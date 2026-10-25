import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'tennis',
  title: 'Tennis',
  blurb: 'Taube Stadium at golden hour, singles or doubles, vs the computer.',
  category: '3d',
  players: '1-4P',
  controls: 'Space or Enter to hit. Up for lob, Down for slice, Left and Right to aim. Swipe for pace, shot type, and aim.',
  howTo: [
    'serve with two presses: toss first, then hit near the top.',
    'move automatically. press to swing as the ball reaches you.',
    'early and late hits change direction. perfect timing adds pace.',
    'use Up for a lob, Down for slice, and Left or Right to aim.',
    'win points, games, and sets. online, teams can play singles or doubles.',
  ],
  accent: '#c8e632',
  glyph: 'M3.5 17.5 17.5 3.5M6 15l-2.5 2.5M15 6l2.5-2.5M9.5 10.5l4 4M5.5 14.5l4 4M10.5 9.5l4 4M19 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  order: 1,
  online: { seats: 4, bots: true, quick: true, watch: true },
};
