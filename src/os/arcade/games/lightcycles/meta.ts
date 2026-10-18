import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'lightcycles',
  title: 'Light Cycles',
  blurb: 'Carve glowing walls across the grid and make the other riders crash first. Best of five.',
  category: 'multiplayer',
  players: '1-4P',
  controls: 'WASD or arrow keys to turn, swipe on touch. Two players: WASD vs arrow keys, or swipe on your half.',
  howTo: [
    "Your cycle never stops moving and leaves a solid wall behind it.",
    "Hit the arena edge, any trail or your own wall and you crash. Riders who meet head on both go down.",
    "You cannot turn straight back on yourself, so plan your turns a beat early.",
    "The last rider still moving takes the round. If everyone crashes at once, it is a draw.",
    "The first to win 3 rounds takes the match, and the cycles speed up a little every round.",
    "Against the computer, pick 1 to 3 rivals and a difficulty.",
  ],
  accent: '#32d4ff',
  glyph: 'M4 18V8h6v6h6V4h4',
  order: 4,
  music: 'synth',
  online: { seats: 4, bots: true },
};
