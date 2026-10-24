import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'dead-week',
  title: 'Dead Week',
  blurb: 'finals week as a battle royale. everyone gets the same tiny game at once. fail and you spill a coffee. last student awake wins.',
  category: 'arcade',
  players: '1-12P',
  controls: 'mouse or touch for everything. keys work too: arrows move, space taps.',
  howTo: [
    'a command flashes, then a tiny game runs for a few seconds. do what it says.',
    'fail and you lose a coffee. lose all four and you are out.',
    'every 5 games it gets faster. every 10th game is a final exam: three games in a row.',
    'if everyone left fails the same game, nobody loses a coffee, but it goes to sudden death.',
    'out players become ghosts and vote on a curse for whoever is in the lead.',
    'solo endless: survive as many games as you can.',
  ],
  accent: '#e8484f',
  glyph: 'M6 8h10v7a4 4 0 0 1-4 4h-2a4 4 0 0 1-4-4V8zM16 10h1.5a2 2 0 0 1 0 4H16M9 3c0 1.5 1 1.5 1 3M12.5 3c0 1.5 1 1.5 1 3',
  order: 12,
  leaderboard: { order: 'desc', max: 5000, unit: 'games', measure: 'games survived' },
  online: { seats: 12, lateJoin: true, bots: true, quick: true, watch: true },
};
