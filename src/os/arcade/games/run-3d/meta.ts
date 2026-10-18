import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'run-3d',
  title: 'Void Run',
  blurb: 'Sprint through a tunnel floating in space. Step off the edge to run on the walls, and jump the gaps as it speeds up.',
  category: '3d',
  players: '1P',
  controls: 'Arrows or A/D move, Space or Up jumps. Walk off a side to run on the wall. On touch, use the buttons or tap to jump.',
  howTo: [
    "You run forward on your own and the tunnel keeps speeding up the farther you go.",
    "Fall through a gap or off the end of the tiles and the run is over.",
    "Step off the side of a floor to roll onto the next wall, which is handy when the path slides away.",
    "Jump to clear gaps. They get wider as you speed up.",
    "Your score is the distance you cover in meters.",
  ],
  accent: '#6c63ff',
  glyph: 'M3 3h18v18H3zM9 9h6v6H9zM3 3l6 6M21 3l-6 6M3 21l6-6M21 21l-6-6',
  order: 6,
  music: 'synth',
  leaderboard: { order: 'desc', max: 1_000_000, unit: 'm' },
  online: { seats: 4, race: true },
};
