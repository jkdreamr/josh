import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'chess',
  title: 'Chess',
  blurb: 'Full rules, three computer levels that think off the main thread, or pass and play.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Tap or drag a piece to move. Arrow keys and Enter also work. F flips the board.',
  howTo: [
    "White moves first. Win by checkmate: put the enemy king in check with no way out.",
    "Castling, en passant and promotion all work. When a pawn reaches the last rank, pick the piece it becomes.",
    "Stalemate, threefold repetition, the fifty move rule and too little material to mate are all draws.",
    "Against the computer, choose Easy, Normal or Hard and whether you play White or Black.",
    "In pass and play, two players share the board and take turns.",
  ],
  accent: '#5e5ce6',
  glyph: 'M12 3v4M10 5h4M9 20h6M8.5 17h7l-1.5-6.5a2.5 2.5 0 0 0-4 0z',
  order: 2,
  online: { seats: 2 },
};
