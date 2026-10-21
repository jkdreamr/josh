import type { GameMeta } from '../../types';

export const meta: GameMeta = {
  id: 'cube',
  title: 'Cube',
  blurb: 'A 3x3 twisty cube. Scramble it, race the clock, and undo when you lose the thread.',
  category: '3d',
  players: '1P',
  controls: 'Drag a face to turn that layer, drag around the cube to look. Keys U D L R F B turn the faces you see, M E S turn the middles, Shift turns the other way, arrows look around, Z undoes, Space scrambles.',
  howTo: [
    'Every game starts with a fresh scramble, shown on screen. In an online race everyone gets the same one.',
    'The clock starts on your first turn and stops when every face is a single color.',
    'Turn layers until the cube is solved. Any orientation counts.',
    'Flick a face to keep it spinning into the next quarter. Undo steps back one turn, but it still counts as a move.',
    'Your time goes on the leaderboard, so faster is better.',
  ],
  accent: '#3d8bff',
  glyph: 'M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3zM12 12l8-4.5M12 12v9M12 12L4 7.5',
  order: 4,
  music: 'ambient',
  leaderboard: { order: 'asc', min: 3_000, max: 3_600_000, format: 'time' },
  online: { seats: 4, race: true },
};
