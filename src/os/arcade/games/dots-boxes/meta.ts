import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'dots-boxes',
  title: 'Dots and Boxes',
  blurb: 'Draw lines between dots, close boxes and go again. Play the computer, friends on one screen or an online room.',
  category: 'multiplayer',
  players: '1-4P',
  controls: 'Tap or click between two dots to draw a line. Arrows move, Enter or Space draws.',
  accent: '#0a84ff',
  glyph: 'M5 5h7v7H5zM5 5a.5.5 0 1 0 0 .01M12 5a.5.5 0 1 0 0 .01M19 5a.5.5 0 1 0 0 .01M5 12a.5.5 0 1 0 0 .01M12 12a.5.5 0 1 0 0 .01M19 12a.5.5 0 1 0 0 .01M5 19a.5.5 0 1 0 0 .01M12 19a.5.5 0 1 0 0 .01M19 19a.5.5 0 1 0 0 .01',
  order: 13,
  online: { seats: 4, bots: true },
};
