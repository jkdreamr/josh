import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'coxbox',
  title: 'Cox Box',
  blurb: 'A typing regatta. Type clean and fast to row your eight past rival crews, or race up to eight friends online.',
  category: 'multiplayer',
  players: '1-8P',
  controls: 'Type the passage to row. A wrong key stalls the boat until you hit the right one.',
  howTo: [
    "Wait for sit ready, attention and go, then start typing the passage shown.",
    "Every correct character moves your boat down the 2000 m course. Finish the passage to cross the line.",
    "A wrong key counts as an error and your boat stalls until you type the right character.",
    "Solo, you race four rival crews. Pick Novice, Club, Varsity or Olympic to set how fast they row.",
    "Your score is your words per minute, with your accuracy and time shown at the finish.",
    "Online, race up to eight friends. Anyone who types nothing for 30 seconds is counted as done.",
  ],
  accent: '#b1040e',
  glyph: 'M2 11.5c5 2.2 15 2.2 20 0M6.5 12.4L4.5 18M10.5 12.9L8.5 18.5M14.5 12.9l-2 5.6M18.5 12.4l-2 5.6M18 6.5h.01',
  order: 0,
  music: 'drive',
  leaderboard: { order: 'desc', max: 250 },
  online: { seats: 8, lateJoin: true, bots: true },
};
