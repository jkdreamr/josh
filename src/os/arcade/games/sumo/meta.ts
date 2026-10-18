import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'sumo',
  title: 'Bumper Bowl',
  blurb: 'Bumper cars on a shrinking float over the lagoon. Ram the others, charge a dash and knock everyone into the water. First to three rounds wins.',
  category: '3d',
  players: '1-8P',
  controls: 'WASD or arrow keys drive. Hold Space to charge a dash, let go to launch. Two players: WASD and Space vs arrow keys and Enter. On touch, drag to drive and hold Dash.',
  howTo: [
    "Push the other bumper cars off the floating platform into the water.",
    "Hold dash to charge it up, then let go to launch. A dashing car hits twice as hard, and there's a short wait before the next one.",
    "The platform shrinks as the round goes on, then shrinks again for a sudden finish.",
    "The last car on the platform takes the round. If time runs out, the car closest to the middle wins.",
    "First to three rounds wins the match. Against the computer, pick one to seven rivals and how tough they are.",
  ],
  accent: '#ff6b5a',
  glyph: 'M7 4.5h10l3 5.5v7h-2v2h-2v-2H8v2H6v-2H4v-7l3-5.5zM7 10h10M8 7.5h.01M16 7.5h.01M7 14h2M15 14h2',
  order: 7,
  music: 'bouncy',
  online: { seats: 8, lateJoin: true, bots: true, quick: true, watch: true },
};
