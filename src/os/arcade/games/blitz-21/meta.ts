import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'blitz-21',
  title: 'Blitz 21',
  blurb: 'Deal fast onto four columns. Hit 21 to clear them, but three busts ends the round.',
  category: 'puzzle',
  players: '1P',
  controls: 'Click a column or press 1 to 4 to place the card. Make 21 or five cards to clear it. Three busts ends the round.',
  howTo: [
    "Cards come one at a time from a shuffled deck. Put each one on any of the four columns, and peek at the next card to plan ahead.",
    "Face cards count 10 and aces count 1 or 11.",
    "A column that makes exactly 21, or holds five cards without going over, clears for points. Five card clears and two card 21s pay extra.",
    "Clear on back to back cards to build a streak bonus. Any card that doesn't clear resets it.",
    "Going over 21 busts and empties the column. Three busts, or the 2:30 clock running out, ends the round.",
    "Play through the whole deck to earn a bonus for time left, plus more if you never busted.",
  ],
  accent: '#30a46c',
  glyph: 'M7 4h8a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zM17 7l2 .5a2 2 0 0 1 1.4 2.4l-2.4 9M9 9.5l2.5 2.5L9 14.5M13 9.5v5',
  order: 7,
  music: 'lofi',
  leaderboard: { order: 'desc', max: 500_000 },
  online: { seats: 4, race: true },
};
