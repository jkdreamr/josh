import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'roll-block',
  title: 'Roll Block',
  blurb: 'Tip a tall block across floating tiles and drop it upright into the hole. Mind the cracked tiles.',
  category: '3d',
  players: '1P',
  controls: 'Arrows or WASD roll the block. Z undoes, R retries the level. On touch, swipe or use the pad.',
  howTo: [
    "Tip the block across the tiles and stand it upright on the hole to finish the level.",
    "Roll any part of the block off the edge and it falls, and you start the level over.",
    "Cracked tiles hold the block lying down but give way if you stand it upright on one.",
    "Switches open and close bridges. Teal switches trigger under any part of the block, while orange X switches only work when it stands on one.",
    "Each level has a par move count. Clear it at or under par for the best result.",
  ],
  accent: '#14857a',
  glyph: 'M4 14h10v6H4zM17 4h3v16h-3z',
  order: 7,
  music: 'ambient',
};
