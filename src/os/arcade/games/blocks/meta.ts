import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'blocks',
  title: 'Blocks',
  blurb: 'Guide each falling shape into a clean stack and clear the lines.',
  category: 'puzzle',
  players: '1P',
  controls: 'Arrows move and drop, X rotates, Z rotates back, C holds. Swipe to play.',
  howTo: [
    "Shapes fall into the well. Fill a whole row with no gaps to clear it.",
    "Clearing 1, 2, 3 or 4 lines at once scores 100, 300, 500 or 800 times your level. Back to back 4 line clears earn 50% more.",
    "Every 10 lines raises the level and speeds up the fall. Soft and hard drops add a few bonus points.",
    "Hold tucks the current piece away for later, once per piece. The ghost shows where it will land, and the next five pieces are shown on the side.",
    "The game ends when a new piece has no room to appear.",
    "On touch, drag sideways to move, drag down to drop faster, flick up to hard drop and tap to rotate.",
  ],
  accent: '#bf5af2',
  glyph: 'M4 4h6v6H4zM14 4h6v6h-6zM9 14h6v6H9zM4 14h3v6H4z',
  order: 1,
  music: 'chip',
  leaderboard: { order: 'desc', max: 10_000_000 },
  online: { seats: 4, race: true },
};
