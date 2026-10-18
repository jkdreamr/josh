import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'stack',
  title: 'Stack',
  blurb: 'Drop slabs on the tower. Overhang falls away, perfect drops grow it back.',
  category: '3d',
  players: '1P',
  controls: 'Tap, click or press space to drop the slab. Land it flush for a perfect.',
  howTo: [
    "A slab slides back and forth over the tower. Drop it to land it on top.",
    "Any part that hangs over the edge is sliced off, so the tower gets narrower.",
    "Land it almost exactly on the slab below for a perfect: nothing is cut.",
    "Three or more perfects in a row and each new slab grows back a little.",
    "Every slab scores a point and the slabs speed up as you climb. Miss the tower completely and it's over.",
  ],
  accent: '#ff7a59',
  glyph: 'M5 17h14v3H5zM7 12h10v3H7zM9 7h6v3H9zM12 3v2',
  order: 1,
  music: 'ambient',
  leaderboard: { order: 'desc', max: 10_000 },
  online: { seats: 4, race: true },
};
