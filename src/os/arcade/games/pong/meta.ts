import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'pong',
  title: 'Pong',
  blurb: 'The classic duel. Spin the ball off a moving paddle, first to 11 wins.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'W/S, arrow keys or drag to move. Two players: W/S vs arrow keys, or each side of the screen.',
  howTo: [
    "Move your paddle to return the ball. Let it past you and your opponent scores.",
    "Where the ball hits your paddle sets its angle, and moving as you hit it adds spin that curves its path.",
    "The ball gets a little faster with every hit, so long rallies get tense.",
    "After each point, the ball is served toward the player who lost it.",
    "First to 11 points wins. Play the computer at three difficulties, a friend on the same screen, or online.",
  ],
  accent: '#0a84ff',
  glyph: 'M4 6v12M20 6v12M13.5 12a1.5 1.5 0 1 0-3 0a1.5 1.5 0 1 0 3 0',
  order: 1,
  music: 'synth',
  online: { seats: 2, watch: true },
};
