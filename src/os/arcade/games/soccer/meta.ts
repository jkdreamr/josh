import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'soccer',
  title: 'Soccer',
  blurb: 'Lead the counter, bend a finish around the keeper, and take the cup under the lights.',
  category: '3d',
  players: '1-4P',
  controls: 'WASD move, Shift sprint, J pass or switch, K shoot or tackle, L through or slide, I lob or press, U skill. Gamepads use left stick, A pass, B shoot, Y through, X lob, RT sprint, LB switch and RB finesse. P2 uses arrows and punctuation keys.',
  howTo: [
    'Play five a side for Bay City FC or Northshore United. Move your selected player by hand while teammates hold their shape.',
    'Pass with J, send a runner into space with L, or lift a cross with I. Aim passes with your movement direction.',
    'Hold K to charge a shot and aim for a corner. Hold U as you release for a finesse curler.',
    'Without the ball, J switches players, K tackles, L slides, and I asks a teammate to press.',
    'Move sideways with U for a feint, backwards for a roulette, or tap U with no direction for a drag-back.',
    'P1 uses WASD and Shift. P2 uses arrow keys and ShiftRight, with Period, Slash, Semicolon, Quote, and Comma for actions.',
    'On touch, steer with the analog stick and hold the round buttons to sprint or charge a shot. There is no offside or cards.',
    'Hold an action button to charge it, then release for a quick or driven pass, shot, through ball, or lob. A phone can join a room as a controller.',
  ],
  accent: '#cf3348',
  glyph: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.25l9 4.5',
  order: 5,
  online: { seats: 4, bots: true, quick: true, watch: true },
};
