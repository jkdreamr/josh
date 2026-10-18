import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'slither',
  title: 'Noodle',
  blurb: 'Eat glowing pellets to grow and make the others crash into you. Solo against computer noodles, or online with up to eight friends.',
  category: 'multiplayer',
  players: '1-8P',
  controls: 'Steer with the mouse, arrow keys or WASD. Hold Space to boost. Touch: drag to steer and hold Boost.',
  howTo: [
    "Eat the glowing pellets to grow longer.",
    "If your head touches another noodle or the edge of the arena, you burst into pellets. Crossing your own body is safe.",
    "Boost for a burst of speed, but it sheds length behind you. You need to grow a little before you can boost.",
    "Cut across another noodle's path so it crashes into you, then eat what it leaves behind.",
    "Solo, you get one life and your best length is your score. Easy, normal and hard set how sharp the computer noodles are.",
    "Online rounds last two, three or five minutes. You come back a few seconds after a crash, and the longest noodle at the end wins.",
  ],
  accent: '#36d399',
  glyph: 'M4 15c2.5-7 5-7 7 0s4.5 7 8 0M5 8h.01M19 8h.01',
  order: 0.7,
  music: 'house',
  leaderboard: { order: 'desc', min: 0, max: 100000, measure: 'Best Length vs Computer', variants: { easy: 'Easy', normal: 'Normal', hard: 'Hard' } },
  online: { seats: 8, lateJoin: true, bots: true },
};
