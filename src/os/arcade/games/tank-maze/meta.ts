import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'tank-maze',
  title: 'Tank Maze',
  blurb: 'Tanks in a fresh maze every round. Shells bounce off the walls, and they can hit you too. First to five wins.',
  category: 'multiplayer',
  players: '1-4P',
  controls: 'WASD or arrows to drive, Space to fire. More players: WASD+Q, arrows+slash, IJKL+U. Touch: stick plus fire button.',
  accent: '#e0533d',
  glyph: 'M4 14.5h11.5v4.5H4zM6.5 14.5V11h7v3.5M13.5 12.5H20',
  order: 6,
  online: { seats: 4, bots: true, lateJoin: true, quick: true, watch: true },
};
