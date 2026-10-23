import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'wacky-walk',
  title: 'Wacky Walk',
  blurb: 'a wobbly commencement run: dodge the campus chaos, outlast the tiles and climb hoover tower for the crown.',
  category: '3d',
  players: '1-20P',
  controls: 'WASD or arrows move, Space jumps, Shift or X or C dives. Q and E orbit the camera; drag to look around. On touch, use the left stick and jump and dive buttons.',
  accent: '#24b6a2',
  glyph: 'M5 17.5h14M7 17.5l1-4h8l1 4M9 13.5V9l3-3 3 3v4.5M12 6V3M9.5 10.5h5M10 17.5v2M14 17.5v2',
  order: 30,
  music: 'bouncy',
  online: { seats: 20, lateJoin: true, bots: true, quick: true, watch: true },
  howTo: [
    'run, jump and dive through three rounds of Stanford commencement chaos.',
    'race past diploma tubes, fountain jets and rolling coconuts to qualify.',
    'keep moving when the quad tiles crack, then climb hoover tower for the crown.',
    'falling in a race sends you back to your last checkpoint. a fall on the tiles is final.',
    'WASD or arrows move, Space jumps, Shift or X or C dives. Q and E orbit the camera.',
    'on touch, steer with the left stick and tap jump or dive. spectate with the arrows.',
  ],
};
