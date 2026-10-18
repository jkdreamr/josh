import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'breakout',
  title: 'Breakout',
  blurb: 'One paddle and a wall of color. Keep the rally alive.',
  category: 'arcade',
  players: '1P',
  controls: 'Move with the mouse, touch or arrow keys. Space or tap to launch. P pauses.',
  howTo: [
    "Bounce the ball off your paddle to break the bricks. Where it hits the paddle sets the angle.",
    "Some bricks take two hits. Every hit scores 5, and breaking a brick adds 10 more.",
    "Clear every brick for a 100 point bonus and a new layout, where the ball launches a little faster.",
    "Broken bricks sometimes drop a power-up to catch: W widens the paddle, 3 splits into three balls and S slows the ball for a while.",
    "You have three lives. You lose one when every ball falls past the paddle.",
  ],
  accent: '#ff9f0a',
  glyph: 'M3 6h5v4H3zM10 6h5v4h-5zM17 6h4v4h-4zM3 13h5v4H3zM10 13h5v4h-5zM17 13h4v4h-4zM8 21h8',
  order: 3,
  music: 'chip',
  leaderboard: { order: 'desc', max: 1_000_000 },
  online: { seats: 4, race: true },
};
