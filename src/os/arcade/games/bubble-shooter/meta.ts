import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'bubble-shooter',
  title: 'Bubble Shooter',
  blurb: 'Bank shots off the walls, pop three of a kind and drop whole clusters before the ceiling closes in.',
  category: 'arcade',
  players: '1P',
  controls: 'Aim with the mouse or a finger and release to shoot. Tap the next bubble or press S to swap. Arrow keys and Space work too.',
  howTo: [
    "Shoot a bubble into the cluster. Connect three or more of the same color to pop them.",
    "Bubbles left hanging with nothing holding them to the ceiling fall too, and they're worth much more than popped ones.",
    "Pop on shot after shot to build a combo that multiplies your points. A shot that pops nothing resets it.",
    "Every few shots that pop nothing, or when the timer runs out, the ceiling drops a row.",
    "Clear the board for a level bonus. Later levels bring more rows, more colors and a faster ceiling.",
    "The game ends when the bubbles reach the line above your shooter.",
  ],
  accent: '#ff375f',
  glyph: 'M2 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M9 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M16 6a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M5.5 12a3 3 0 1 0 6 0a3 3 0 1 0 -6 0M12 21l3-5',
  order: 7,
  music: 'bouncy',
  leaderboard: { order: 'desc', max: 10_000_000 },
  online: { seats: 4, race: true },
};
