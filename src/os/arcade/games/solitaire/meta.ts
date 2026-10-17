import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'solitaire',
  title: 'Solitaire',
  blurb: 'Classic Klondike, draw 1 or draw 3. Build every suit from ace to king, and finish fast for a time bonus.',
  category: 'puzzle',
  players: '1P',
  controls: 'Drag cards, or tap one to send it where it fits. Double-click sends a card home. Tap the deck to draw. Z undoes, 1 to 7 plays a column, W plays the waste, Space draws.',
  accent: '#2e9d68',
  glyph: 'M9 3h9a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM7 7.4l-2.4.7A2 2 0 0 0 3.2 10.5l2.6 9.7a2 2 0 0 0 2.4 1.4l6.4-1.7M13.5 14c-2-1.4-3.2-2.5-3.2-3.9 0-1 .8-1.7 1.7-1.7.6 0 1.1.3 1.5.8.4-.5.9-.8 1.5-.8.9 0 1.7.7 1.7 1.7 0 1.4-1.2 2.5-3.2 3.9z',
  order: 8,
  leaderboard: { order: 'desc', max: 20_000 },
  online: { seats: 4, race: true },
};
