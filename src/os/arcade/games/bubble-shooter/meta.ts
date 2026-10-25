import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'bubble-shooter',
  title: 'Bubble Shooter',
  blurb: '36 handmade boards with limited shots, stars to earn, bombs, ice and stone, plus an Endless mode that keeps speeding up.',
  category: 'arcade',
  players: '1P',
  controls: 'Aim with the mouse or a finger and release to shoot. Tap the next bubble or press S to swap. Arrow keys and Space work too.',
  howTo: [
    'Shoot a bubble into the cluster. Connect three or more of the same color to pop them.',
    "Bubbles left hanging with nothing holding them to the ceiling fall too, and they're worth much more than popped ones.",
    'Levels give you a set number of shots. Clear the board with shots to spare for up to three stars, and each clear opens the next level.',
    'Every shot counts toward the next ceiling drop. The dots by your shot count show how many are left, and later levels add a timer too.',
    'Bombs blow up everything around them when you hit one or pop next to one. Ice will not match until you land or pop beside it. Stones never pop, so cut them loose.',
    'Drop a big cluster or keep a combo going and you get a rainbow bubble that matches any color.',
    'Endless has no shot limit, but new rows push the board down faster, with more colors as you go. The game ends when the bubbles reach the line above your shooter.',
  ],
  accent: '#ff375f',
  glyph: 'M2 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M9 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M16 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M5.5 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12 21l3-5',
  order: 7,
  music: 'bouncy',
  leaderboard: { order: 'desc', max: 10_000_000 },
  online: { seats: 4, race: true },
};
