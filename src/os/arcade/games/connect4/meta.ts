import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'connect4',
  title: 'Connect Four',
  blurb: 'Drop discs, line up four. Three computer levels or two players on one screen.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Tap or click a column to drop. Arrows move, Enter or Space drops.',
  howTo: [
    "Take turns dropping a disc into any column. It falls to the lowest open space.",
    "Line up four of your discs in a row, across, up and down or diagonally, to win.",
    "Block your opponent when they have three in a row with an open end.",
    "If all 42 spaces fill with no four in a row, the game is a draw.",
    "Against the computer, pick Easy, Normal or Hard and choose who moves first. In 2 Players, Red always starts.",
  ],
  accent: '#ff453a',
  glyph: 'M6 7a1 1 0 1 0 0 .01M12 7a1 1 0 1 0 0 .01M18 7a1 1 0 1 0 0 .01M6 12a1 1 0 1 0 0 .01M12 12a1 1 0 1 0 0 .01M18 12a1 1 0 1 0 0 .01M6 17a1 1 0 1 0 0 .01M12 17a1 1 0 1 0 0 .01M18 17a1 1 0 1 0 0 .01',
  order: 3,
  online: { seats: 2 },
};
