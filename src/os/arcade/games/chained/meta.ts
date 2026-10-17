import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'chained',
  title: 'Chained',
  blurb: 'Climb out of the inferno chained to your friends. Six circles, one chain, and a single slip drags everyone down.',
  category: '3d',
  players: '1-4P',
  controls: 'Arrows or WASD move, Space jumps, Shift swaps souls. Two players share the keyboard: WASD and Space, arrows and Enter.',
  accent: '#e8532a',
  glyph: 'M9.5 8.5a3 3 0 0 1 0-4.2l1.3-1.3a3 3 0 0 1 4.2 4.2l-1.3 1.3M14.5 15.5a3 3 0 0 1 0 4.2l-1.3 1.3a3 3 0 0 1-4.2-4.2l1.3-1.3M10 10l-2.2 2.2a3 3 0 0 0 4.2 4.2L14 14M14 14l2.2-2.2a3 3 0 0 0-4.2-4.2L10 10',
  order: 3,
  // the time it takes a team (or a soul and its shadow) to climb out, one board per mode and party
  leaderboard: {
    order: 'asc',
    min: 45_000,
    max: 3_600_000,
    format: 'time',
    measure: 'Fastest Escape',
    variants: {
      'solo-normal': 'Solo Normal',
      'solo-beginner': 'Solo Beginner',
      'solo-lava': 'Solo Lava',
      'team-normal': 'Team Normal',
      'team-beginner': 'Team Beginner',
      'team-lava': 'Team Lava',
    },
  },
  online: { seats: 4 },
};
