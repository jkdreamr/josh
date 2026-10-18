import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'airhockey',
  title: 'Air Hockey',
  blurb: 'First to seven. Take on the computer or play a friend on the same screen.',
  category: '3d',
  players: '1-2P',
  controls: 'Move the mouse or drag to steer your mallet. Keyboard: WASD or arrows. Sharing a screen, blue uses WASD and pink the arrows.',
  howTo: [
    "Knock the puck into the goal at the far end. First to seven goals wins.",
    "Each mallet stays on its own half of the table.",
    "Swing through the puck to hit it harder, since your mallet's speed carries into the shot.",
    "After a goal, the puck waits on the side that was scored on until a mallet touches it.",
    "Play the computer on Easy, Normal or Hard, or pick 2 Players to share one screen. On touch, each player drags on their own half.",
  ],
  accent: '#34c3ff',
  glyph: 'M4 5h16a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2zM12 5v14M9 12h6M22 10v4M2 10v4',
  order: 5,
  music: 'house',
  online: { seats: 2 },
};
