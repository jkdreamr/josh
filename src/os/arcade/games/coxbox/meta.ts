import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'coxbox',
  title: 'Cox Box',
  blurb: 'A typing regatta. Type clean and fast to row your eight past rival crews, or race up to eight friends online.',
  category: 'multiplayer',
  players: '1-8P',
  controls: 'Type the passage to row. A wrong key stalls the boat until you hit the right one.',
  accent: '#b1040e',
  glyph: 'M2 11.5c5 2.2 15 2.2 20 0M6.5 12.4L4.5 18M10.5 12.9L8.5 18.5M14.5 12.9l-2 5.6M18.5 12.4l-2 5.6M18 6.5h.01',
  order: 0,
  leaderboard: { order: 'desc', max: 250 },
  online: { seats: 8, lateJoin: true, bots: true, quick: true, watch: true },
};
