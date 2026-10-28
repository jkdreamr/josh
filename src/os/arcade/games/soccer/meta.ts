import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'soccer',
  title: 'Soccer',
  blurb: 'Lead the counter, bend a finish around the keeper, and take the cup under the lights.',
  category: '3d',
  players: '1-4P',
  controls: 'Your iPhone is the controller. Scan the QR code on your Mac.',
  howTo: [
    'Scan the QR code on your Mac with your iPhone camera. Your phone becomes the controller.',
    'Move with the left stick. Press A to pass, B to shoot, X to cross, and Y for a through ball.',
    'Hold a button to charge your pass or shot. Choose Practice to learn the controls.',
    'In two-player matches, scan with a second phone to control the other club.',
    'Offside and cards are in play: time your runs and keep tackles clean.',
  ],
  accent: '#cf3348',
  glyph: 'M3 7.5 12 3l9 4.5v9L12 21l-9-4.5v-9ZM3 7.5l9 4.5 9-4.5M12 12v9M7.5 5.25l9 4.5',
  order: 5,
  online: { seats: 4, bots: true, quick: false, watch: true },
};
