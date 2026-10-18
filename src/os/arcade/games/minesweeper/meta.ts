import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'minesweeper',
  title: 'Minesweeper',
  blurb: 'Clear the field with a careful read of every number.',
  category: 'puzzle',
  players: '1P',
  controls: 'Tap to dig, hold to flag. Arrows move, Space digs and F flags.',
  howTo: [
    "Dig a square to reveal it. Your first dig is always safe and opens up a patch of the field.",
    "Each number tells you how many mines touch that square, including diagonals.",
    "Flag the squares you are sure hide mines. The Mines counter shows how many are left unflagged.",
    "Once a number has all its mines flagged, dig it again (or middle click) to clear its other neighbours at once.",
    "Uncover every safe square to win, but dig a mine and it is over. Beat your best time on each of the three sizes.",
    "On touch, the Dig and Flag button swaps what a tap does, and holding does the other one.",
  ],
  accent: '#ff453a',
  glyph: 'M12 3v18M4.5 8h15M6.5 16h11M7 8l-2 8m12-8 2 8M9 8l-1 8m7-8 1 8',
  order: 3,
  music: 'ambient',
  leaderboard: { order: 'asc', min: 300, max: 3_600_000, format: 'time', measure: 'Fastest Clear', variants: { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' } },
};
