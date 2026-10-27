import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'soccer',
  title: 'Soccer',
  blurb: 'Lead the counter, bend a finish around the keeper, and take the cup under the lights.',
  category: '3d',
  players: '1-4P',
  controls: 'Your phone is the primary controller: scan the QR on the Start screen. PlayStation and Xbox pads work too; keyboard is the fallback.',
  howTo: [
    'On your Mac, choose Connect Phone and scan the QR with your iPhone camera. Your phone joins as the controller while the Mac shows the match.',
    'Use the left stick to move. Hold A to pass, B to shoot, Y for a through ball, or X to lob; hold Sprint to run faster.',
    'Play five a side for Bay City FC or Northshore United. Move your selected player by hand while teammates hold their shape.',
    'PlayStation and Xbox pads use the left stick, A/Cross to pass, B/Circle to shoot, Y/Triangle through, X/Square to lob, and RT/R2 to sprint.',
    'Keyboard fallback: WASD or arrows to move, Shift to sprint, J to pass or switch, K to shoot or tackle, L through or slide, I lob or press, and U for skill.',
    'Hold K to charge a shot and aim for a corner. Hold U as you release for a finesse curler.',
    'Without the ball, J switches players, K tackles, L slides, and I asks a teammate to press.',
    'Move sideways with U for a feint, backwards for a roulette, or tap U with no direction for a drag-back.',
    'Hold an action button to charge it, then release for a quick or driven pass, shot, through ball, or lob. There is no offside or cards.',
  ],
  accent: '#cf3348',
  glyph: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.25l9 4.5',
  order: 5,
  online: { seats: 4, bots: true, quick: false, watch: true },
};
