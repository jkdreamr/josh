import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'example',
  title: 'Catch',
  blurb: 'Slide the tray and catch the falling dots. Miss three and it is over.',
  category: 'arcade',
  players: '1P',
  controls: 'Arrow keys or A/D to move. P to pause.',
  howTo: [
    "Dots fall from the top of the screen at random spots.",
    "Slide the tray under a dot to catch it and score a point.",
    "The more you catch, the faster and more often new dots fall.",
    "Miss three dots and the game is over.",
  ],
  accent: '#7c5cff',
  glyph: 'M4 17h16M7 17l1.5 3h7l1.5-3M12 4v6M9 7l3 3 3-3',
  order: 0,
  music: 'chip',
};
