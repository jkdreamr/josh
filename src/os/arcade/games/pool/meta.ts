import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'pool',
  title: 'Pool',
  blurb: 'Eight ball on a felt table. Sink your group, then the 8. Take on the computer, a friend, or play online.',
  category: 'multiplayer',
  players: '1-2P',
  controls: 'Point the cue at the ball, then pull back and let go to shoot. Arrow keys aim, Space shoots.',
  howTo: [
    "Break the rack to start. The first ball you sink on a clean shot makes solids or stripes your group.",
    "Keep shooting while you sink your own balls. Miss and the turn passes.",
    "Fouls give your opponent ball in hand: sinking the cue ball, hitting nothing, hitting the wrong group first, or no ball reaching a rail after contact.",
    "Once your group is cleared, sink the 8 in the pocket you aim it at to win. The highlighted pocket is your call.",
    "Sink the 8 early, in the wrong pocket, or on a foul and you lose. Tap the spin button to switch between center, follow and draw.",
  ],
  accent: '#1f9d63',
  glyph: 'M8 16m-5 0a5 5 0 1 0 10 0a5 5 0 1 0-10 0M13 11l8-8',
  order: 6,
  music: 'lofi',
  online: { seats: 2 },
};
