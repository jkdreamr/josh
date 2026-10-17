import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'sumo',
  title: 'Bumper Bowl',
  blurb: 'Bumper cars on a shrinking float over the lagoon. Ram the others, charge a dash and knock everyone into the water. First to three rounds wins.',
  category: '3d',
  players: '1-8P',
  controls: 'WASD or arrow keys drive. Hold Space to charge a dash, let go to launch. Two players: WASD and Space vs arrow keys and Enter. On touch, drag to drive and hold Dash.',
  accent: '#ff6b5a',
  glyph: 'M7 4.5h10l3 5.5v7h-2v2h-2v-2H8v2H6v-2H4v-7l3-5.5zM7 10h10M8 7.5h.01M16 7.5h.01M7 14h2M15 14h2',
  order: 7,
  online: { seats: 8, lateJoin: true, bots: true },
};
