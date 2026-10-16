import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'pool',
  title: 'Pool',
  blurb: 'Eight ball on a felt table. Sink your group, then the 8. Take on the computer, a friend, or play online.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Point the cue at the ball, then pull back and let go to shoot. Arrow keys aim, Space shoots.',
  accent: '#1f9d63',
  glyph: 'M8 16m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M13 11l8-8',
  order: 6,
  online: { seats: 2 },
};
