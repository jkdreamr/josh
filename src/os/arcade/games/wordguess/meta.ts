import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'wordguess',
  title: 'Word Guess',
  blurb: 'Find the five-letter word in six tries. A new one every day, or practice as much as you like.',
  category: 'puzzle',
  players: '1P',
  controls: 'Type or tap letters, Enter to guess. Green is right, gold is in the word.',
  howTo: [
    "Guess the hidden five-letter word in six tries. Each guess has to be a real word.",
    "After each guess the tiles change color: green means the right letter in the right spot, gold means it's in the word somewhere else, and grey means it isn't in the word.",
    "The on-screen keyboard keeps track of which letters you've ruled in or out.",
    "Everyone gets the same Daily word, with a new one at midnight Pacific time. Solve it on consecutive days to build your streak.",
    "Practice gives you a fresh random word as often as you like and doesn't touch your streak.",
  ],
  accent: '#30d158',
  glyph: 'M3 9h4.5v6H3zM9.75 9h4.5v6h-4.5zM16.5 9H21v6h-4.5z',
  order: 5,
  music: 'ambient',
  leaderboard: { order: 'desc', max: 10_000, unit: 'days', measure: 'Daily Word Streak' },
};
