import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'flappy',
  title: 'Flappy Tree',
  blurb: 'A little tree with big dreams. Flap through the cardinal columns and earn a medal.',
  category: 'arcade',
  players: '1P',
  controls: 'Space, Up or click to flap. Tap to flap on touch. P pauses.',
  howTo: [
    "Flap to keep the tree in the air. It falls as soon as you stop.",
    "Fly through the gaps in the columns. Each column you pass scores a point.",
    "Touching a column or the ground ends the run.",
    "The gaps get tighter and the columns come faster as your score rises.",
    "Earn a bronze medal at 10, silver at 20, gold at 30 and platinum at 40.",
  ],
  accent: '#8c1515',
  glyph: 'M12 3 7.5 9.5H10L6 15h4l-3 4h10l-3-4h4l-4-5.5h2.5zM12 19v2',
  order: 5,
  music: 'bouncy',
  leaderboard: { order: 'desc', max: 10_000 },
  online: { seats: 4, race: true },
};
