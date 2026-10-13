import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'hot-potato',
  title: 'Hot Potato',
  blurb: 'The phone is the bomb. Say a word that fits the prompt and pass it on before the fuse runs out.',
  category: 'party',
  players: '3-20P',
  controls: 'Say a word that fits, then pass the phone left. Whoever holds it at the boom loses the round.',
  accent: '#ff4d1a',
  // A lumpy potato with its eyes, a fuse out the top and sparks at the end.
  glyph: 'M3.2 17.4c-1-2.9 1.2-5.9 5-7.2 3.9-1.3 7.9-.6 9 2.2 1.1 2.9-.8 6-4.8 7.4-4 1.4-8.2.5-9.2-2.4zM7.5 16.2h.01M11 13.4h.01M12.4 17.4h.01M15 10.2c.2-2.3 1.1-3.8 2.7-4.6M17 3.6l-.9-.9M18.9 3.1l.4-1.3M20.3 4.5l1.3-.4M19.8 6.4l.9.9',
  order: 5,
};
