import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'mini-golf',
  title: 'Mini Golf',
  blurb: 'Nine holes around campus. Bank it off the Quad fountain, climb Hoover, loop The Dish and stay out of Lagunita.',
  category: '3d',
  players: '1-4P',
  controls: 'Drag back from anywhere and let go to putt. Or aim with the arrow keys and hold space for power.',
  howTo: [
    "Play nine holes around campus and try to sink the ball in as few strokes as you can.",
    "Pull back further for a harder putt. Bank shots off walls and posts, and time your putt past the moving obstacles.",
    "Landing in the water costs a penalty stroke and you play again from where you hit.",
    "Each hole is capped at 7 strokes. Hit the cap and you pick up and move on.",
    "With more than one golfer, whoever is farthest from the cup putts next, and the best score on the last hole tees off first.",
    "Lowest total after nine holes wins. Add up to 3 computer golfers and pick their difficulty.",
  ],
  accent: '#3f9b4f',
  glyph: 'M12 3v12M12 3l6 2.5-6 2.5M7.5 17.5c0 1.7 2 3 4.5 3s4.5-1.3 4.5-3-2-3-4.5-3-4.5 1.3-4.5 3z',
  order: 13,
  music: 'lofi',
  leaderboard: { order: 'asc', min: 9, max: 63, unit: 'strokes', measure: 'Strokes for 9 Holes' },
  online: { seats: 4, bots: true, quick: true },
};
