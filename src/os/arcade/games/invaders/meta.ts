import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'invaders',
  title: 'Invaders',
  blurb: 'Hold the line. The longer they last, the faster they move.',
  category: 'arcade',
  players: '1P',
  controls: 'Arrow keys or A/D to move, Space to fire, or steer with the mouse and click. On touch, drag to move and hold to fire. P pauses.',
  howTo: [
    "Move along the bottom and shoot the invaders before they reach you. You can have two shots in the air at once.",
    "Top row invaders are worth 30, the middle rows 20 and the bottom rows 10.",
    "Hit the saucer that crosses the top for a bonus of 50 to 300 points.",
    "Shields block shots from both sides but wear away as they're hit.",
    "You have three lives. The invaders speed up as their numbers drop, and if they reach your line the game ends.",
    "Clear a wave for 100 bonus points. Each new wave starts lower, moves faster and shoots straighter.",
    "Your shots can knock theirs out of the air. You earn an extra life at 1,500 points and every 5,000 after.",
  ],
  accent: '#5e5ce6',
  glyph: 'M4 9l2-3 2 2 4-4 4 4 2-2 2 3v6l-3-2-2 3-3-2-3 2-2-3-3 2zM8 12h.1M16 12h.1',
  order: 4,
  music: 'tension',
  leaderboard: { order: 'desc', max: 1_000_000 },
  online: { seats: 4, race: true },
};
