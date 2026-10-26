import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'tennis',
  title: 'Tennis',
  blurb: 'Taube Stadium at golden hour, singles or doubles, vs the computer.',
  category: '3d',
  players: '1-4P',
  controls: 'WASD / arrows move · Space/J topspin · K slice · L flat · I lob · U drop. Hold Left/Right to place shots; hold Up for short or Down for deep.',
  howTo: [
    'serve with two presses: toss, then Space/J for kick, K for slice, or L for flat.',
    'move with WASD or arrows; no input means no movement.',
    'Space/J topspin, K slice, L flat power, I lob, and U drop shot.',
    'hold Left/Right to place laterally; hold Up for short, neutral for deep, or Down for very deep.',
    'high balls become smashes; near-net shots become volleys.',
    'win points, games, and sets. online, teams can play singles or doubles.',
  ],
  accent: '#c8e632',
  glyph: 'M3.5 17.5 17.5 3.5M6 15l-2.5 2.5M15 6l2.5-2.5M9.5 10.5l4 4M5.5 14.5l4 4M10.5 9.5l4 4M19 19a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  order: 1,
  online: { seats: 4, bots: true, quick: true, watch: true },
};
