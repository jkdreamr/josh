import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'tank-maze',
  title: 'Tank Maze',
  blurb: 'Tanks in a fresh maze every round. Shells bounce off the walls, and they can hit you too. First to the target score wins.',
  category: 'multiplayer',
  players: '1-4P',
  controls: 'WASD or arrows to drive, Space to fire. More players: WASD+Q, arrows+slash, IJKL+U. Touch: stick plus fire button.',
  howTo: [
    "Every round drops all tanks into a new maze. Shoot the others and be the last one standing to score a point.",
    "Shells bounce off walls and can come back to hit you, so watch your angles.",
    "You can have five shells out at once. They fade after about nine seconds and cancel out when they collide.",
    "Grab pickups for one special shot: a laser that bounces off five walls, a triple spread for your next three shots, or a mine that drops behind you.",
    "Mines arm after a second and blow up anyone who rolls over them, you included.",
    "First to 3, 5 or 10 points wins, as chosen in setup. If the last tanks go down together, nobody scores.",
  ],
  accent: '#e0533d',
  glyph: 'M4 14.5h11.5v4.5H4zM6.5 14.5V11h7v3.5M13.5 12.5H20',
  order: 6,
  music: 'tension',
  online: { seats: 4, bots: true, lateJoin: true },
};
