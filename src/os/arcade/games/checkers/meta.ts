import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'checkers',
  title: 'Checkers',
  blurb: 'American rules: forced captures, multi-jumps and kings. Three computer levels or pass and play.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Tap or drag a piece, then its landing square. Arrow keys and Enter also work.',
  howTo: [
    "Red moves first. Pieces step one square diagonally forward on the dark squares.",
    "Captures are forced: jump an enemy piece to the empty square beyond it, and keep jumping while you can.",
    "Reach the far row to crown a king, which moves and jumps both forward and back. Crowning ends the turn.",
    "Win by capturing every enemy piece or leaving your opponent with no legal move.",
    "Forty moves each with only kings moving and nothing captured is a draw.",
    "Play Red against the computer on Easy, Normal or Hard, or pass and play with a friend.",
  ],
  accent: '#ff375f',
  glyph: 'M12 12m-6 0a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 12m-3 0a3 3 0 1 0 6 0a3 3 0 1 0-6 0',
  order: 5,
  online: { seats: 2 },
};
