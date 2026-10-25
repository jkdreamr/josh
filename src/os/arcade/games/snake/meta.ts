import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'snake',
  title: 'Snake',
  blurb: "Eat, grow and don't bite yourself. It gets faster.",
  category: 'arcade',
  players: '1P',
  controls: 'Arrow keys or WASD to steer, or swipe or tap the side you want to turn to. P pauses.',
  howTo: [
    "Steer into the food to eat it. Each bite is worth 10 points and adds a link to your tail.",
    "Every link you add makes the snake a little faster.",
    "Hitting a wall or your own body ends the game.",
    "You can't turn straight back on yourself, but quick turns queue up, so plan your corners.",
    "The snake waits for your first turn, and gives you a split second at the edge to swerve.",
    "Fill the whole board to win.",
  ],
  accent: '#30d158',
  glyph: 'M4 12h4l2-3 3 6 2-3h5M5 8V5h3M5 16v3h3',
  order: 2,
  music: 'chip',
  leaderboard: { order: 'desc', max: 100_000 },
  online: { seats: 4, race: true },
};
