import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'dino',
  title: 'Dino Run',
  blurb: 'The offline classic, redrawn. Jump the cacti, duck the flyers and survive the night.',
  category: 'arcade',
  players: '1P',
  controls: 'Space or Up to jump, Down to duck. On touch, tap to jump and hold Duck to duck. P pauses.',
  howTo: [
    "The dino runs on its own and speeds up over time. Your score climbs with the distance you cover.",
    "Jump over cacti. Hold jump for a full leap, or tap it for a short hop.",
    "Once you pass 250 points, flyers show up at three heights. Jump the low ones, duck the middle ones, and run under the high ones.",
    "Press down in midair to drop back to the ground faster.",
    "Online, everyone in the room runs the same course, so the best run wins.",
    "Every 700 points day turns to night and back again. One hit ends the run.",
  ],
  accent: '#636366',
  glyph: 'M5 20v-4M9 20v-3M4 13c0 2 1.5 3.5 4 3.5h3l2-3V9h5a2 2 0 0 0 2-2V5a1 1 0 0 0-1-1h-6a2 2 0 0 0-2 2v6M13 12h2.5M16 6.5h.01',
  order: 1,
  music: 'chip',
  leaderboard: { order: 'desc', max: 1_000_000 },
  online: { seats: 4, race: true },
};
