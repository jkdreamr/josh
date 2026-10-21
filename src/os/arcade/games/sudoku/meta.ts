import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'sudoku',
  title: 'Sudoku',
  blurb: 'Fill the grid so every row, column and box holds 1 to 9. Three levels, always one answer.',
  category: 'puzzle',
  players: '1P',
  controls: 'Click or tap a cell, then type or tap a number. N for notes, U to undo, H for a hint, arrows to move.',
  howTo: [
    "Fill every empty cell so each row, column and 3 by 3 box holds the numbers 1 to 9 once.",
    "Pick Easy, Medium or Hard. Every puzzle has exactly one solution.",
    "Numbers that clash with another in the same row, column or box turn red.",
    "Turn on notes to pencil in candidates. Placing a number clears it from the notes around it.",
    "Stuck? A hint fills in one cell and adds 30 seconds to the clock.",
    "The clock runs until the grid is solved, and your fastest time is kept for each level. Leave mid-puzzle and it waits for you.",
  ],
  accent: '#0a84ff',
  glyph: 'M4 4h16v16H4zM9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16',
  order: 4,
  music: 'ambient',
  leaderboard: { order: 'asc', min: 20_000, max: 24 * 3_600_000, format: 'time', measure: 'Fastest Solve', variants: { easy: 'Easy', medium: 'Medium', hard: 'Hard' } },
};
