import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'sudoku',
  title: 'Sudoku',
  blurb: 'Fill the grid so every row, column and box holds 1 to 9. Three levels, always one answer.',
  category: 'puzzle',
  players: '1P',
  controls: 'Click or tap a cell, then type or tap a number. N for notes, U to undo, arrows to move.',
  accent: '#0a84ff',
  glyph: 'M4 4h16v16H4zM9.33 4v16M14.67 4v16M4 9.33h16M4 14.67h16',
  order: 4,
};
