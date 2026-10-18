import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'run-3d',
  title: 'Void Run',
  blurb: 'Run a glowing tube through deep space. Step off an edge and the wall becomes your floor. Thirty levels, an endless run, and live races with friends or bots.',
  category: '3d',
  players: '1P',
  controls: 'Arrows or A/D steer, Space or Up jumps and holding it jumps higher. On touch, use the buttons, or tap the screen to jump.',
  howTo: [
    "You run on your own. Steer, and jump over the gaps.",
    "Walk off the side of a floor to roll onto the next wall. Gravity turns with you.",
    "Every five levels the tunnel changes shape and gets meaner: crumbling tiles, low gravity, a dark stretch.",
    "Bright arrow tiles give you a burst of speed. Grab the three cells in a level if you can.",
    "Endless keeps going until you fall, and your score is how far you got in meters.",
    "Online, everyone runs the same course and sees each other live. Fall and you come back a bit behind. First to the finish wins.",
  ],
  accent: '#6c63ff',
  glyph: 'M3 3h18v18H3zM9 9h6v6H9zM3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6',
  order: 6,
  music: 'synth',
  leaderboard: { order: 'desc', max: 1_000_000, unit: 'm' },
  online: { seats: 4, bots: true, quick: true },
};
