import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'the-axe',
  title: 'The Axe',
  blurb: 'Steal the axe, break your friends out of jail, and race it home. tag on your half, then carry your team to three.',
  category: 'multiplayer',
  players: '1-10P',
  controls: 'WASD or arrows to move, Shift to sprint. Drag to move on touch, then tap sprint.',
  howTo: [
    'grab the other team’s axe from their end zone and bring it back to your own.',
    'tag enemies only on your half. tagged players go to jail, and a teammate can free everyone there.',
    'every 15 seconds both jails open on their own. escapees get a one second head start, then they can be tagged again.',
    'axe carriers move slower and cannot sprint. freed players walk home safely.',
    'first team to three captures wins, or lead when four minutes end. a tie goes to golden capture.',
    'play big game with one neutral axe, or tree tag where the tree keeps score.',
    'grab a drum to stun nearby rivals, or a tree costume for a speed boost.',
  ],
  accent: '#b1040e',
  glyph: 'M5 19 16 8m-2-5 7 7-4 4-7-7zM7 17l-2-2',
  order: 14,
  music: 'drive',
  online: { seats: 10, lateJoin: true, bots: true, quick: true, watch: true },
};
