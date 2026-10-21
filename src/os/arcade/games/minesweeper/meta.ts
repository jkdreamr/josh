import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'minesweeper',
  title: 'Minesweeper',
  blurb: 'Clear the field with a careful read of every number.',
  category: 'puzzle',
  players: '1P',
  controls: 'Tap or click to dig. Hold, right click or F to flag. Arrows move and Space digs.',
  howTo: [
    'Dig a square to reveal it. Your first dig is always safe and opens up a patch of the field.',
    'Each number tells you how many mines touch that square, including diagonals.',
    'Flag the squares you are sure hide mines. The Mines count shows how many are left.',
    'Once a number has all its mines flagged, dig it again (or middle click it) to clear the rest of its neighbors.',
    'Every board can be solved with logic alone, so you never have to guess.',
    'Uncover every safe square to win, and beat your best time on each board.',
    'On touch, the Dig and Flag switch sets what a tap does, and holding does the other. Drag to move around a big board and pinch to zoom.',
  ],
  accent: '#ff453a',
  glyph: 'M12 3v18M4.5 8h15M6.5 16h11M7 8l-2 8m12-8 2 8M9 8l-1 8m7-8 1 8',
  order: 3,
  music: 'ambient',
  leaderboard: { order: 'asc', min: 300, max: 3_600_000, format: 'time', measure: 'Fastest Clear', variants: { beginner: 'Beginner', intermediate: 'Intermediate', expert: 'Expert' } },
};
