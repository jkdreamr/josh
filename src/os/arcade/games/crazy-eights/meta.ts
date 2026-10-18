import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'crazy-eights',
  title: 'Crazy Eights',
  blurb: 'Match the suit or the rank and empty your hand first. Eights are wild. First to 100 wins.',
  category: 'multiplayer',
  players: '1-4P',
  controls: 'Tap or drag a card onto the pile. Eights are wild, twos make the next player draw two, jacks skip, queens reverse.',
  howTo: [
    "Play a card that matches the suit or the rank of the top card on the pile.",
    "Eights are wild: play one anytime and pick the suit the next player must follow.",
    "A two makes the next player draw two unless they answer with a two of their own, which passes the total on.",
    "Jacks skip the next player and queens reverse the direction. With two players, a queen skips too.",
    "Can't play, or would rather not? Draw a card. If it fits you may play it, otherwise your turn passes.",
    "Empty your hand to win the hand and score the cards left with everyone else: eights 50, twos, jacks and queens 20, kings 10, others face value. First to 100 wins.",
  ],
  accent: '#e5484d',
  glyph: 'M6 5h7a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM15 7.5l3 .8a2 2 0 0 1 1.4 2.4l-2.4 8.8M9.5 10.2a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 1 0 0-3.2zM9.5 13.4a1.8 1.8 0 1 0 0 3.6 1.8 1.8 0 1 0 0-3.6z',
  order: 7,
  online: { seats: 4, bots: true },
};
