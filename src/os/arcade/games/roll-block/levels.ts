// Handcrafted original boards for Roll Block. Glyphs: '.' void, '#' floor, 'S' start, 'G' goal,
// 'F' fragile (never stands), 'a'-'f' bridge off / 'A'-'F' bridge on, '1'-'9' switch (see switches).
// `par` is the BFS-optimal move count; tests/arcade-roll-block.test.ts keeps it honest.
import type { LevelDef } from './logic';

export const LEVELS: LevelDef[] = [
  {
    id: 'l01',
    name: 'first roll',
    par: 9,
    rows: ['.......', '.#####.', '.#S#G#.', '.#####.', '.......'],
  },
  {
    id: 'l02',
    name: 'upright',
    par: 9,
    rows: ['##########', '#S##..##G#', '##########', '##########'],
  },
  {
    id: 'l03',
    name: 'the bend',
    par: 8,
    rows: ['...........', '.#S##.####.', '.######G##.', '.######.##.', '.#####....#', '.##########'],
  },
  {
    id: 'l04',
    name: 'cracked',
    par: 4,
    rows: ['...........', '.S#F#F#G##.', '...........'],
  },
  {
    id: 'l05',
    name: 'ice path',
    par: 6,
    rows: ['.............', '.S#F##F###G#.', '.............'],
  },
  {
    id: 'l06',
    name: 'light touch',
    par: 8,
    rows: ['...............', '.S###FF#FF###G#', '...............'],
  },
  {
    id: 'l07',
    name: 'drawbridge',
    par: 6,
    rows: ['.............', '.S#1#aa###G#.', '.............'],
    switches: { '1': { kind: 'soft', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l08',
    name: 'round trip',
    par: 6,
    rows: ['.............', '.#S#####1####', '........a....', '........#....', '........G....', '.............'],
    switches: { '1': { kind: 'soft', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l09',
    name: 'two bridges',
    par: 8,
    rows: ['...............', '.S#1#aa#2#b##G#', '...............'],
    switches: {
      '1': { kind: 'soft', act: 'on', bridges: 'a' },
      '2': { kind: 'soft', act: 'on', bridges: 'b' },
    },
  },
  {
    id: 'l10',
    name: 'switchback',
    par: 22,
    rows: ['.............', '.#S#1#######.', '...........a.', '...........a.', '.###########.', '..#..........', '..#..........', '.##########G.', '.............'],
    switches: { '1': { kind: 'soft', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l11',
    name: 'heavy plate',
    par: 22,
    rows: ['.............', '.#S#####1###.', '...........#.', '...........#.', '.###########.', '..a..........', '..a..........', '.##########G.', '.............'],
    switches: { '1': { kind: 'hard', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l12',
    name: 'stamp',
    par: 22,
    rows: ['.............', '.#S#########.', '...........#.', '...........#.', '.####1######.', '..#..........', '..#..........', '.#####aa###G.', '.............'],
    switches: { '1': { kind: 'hard', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l13',
    name: 'anvil',
    par: 22,
    rows: ['.............', '.#S###FF####.', '...........#.', '...........#.', '.####1######.', '..a..........', '..a..........', '.##########G.', '.............'],
    switches: { '1': { kind: 'hard', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l14',
    name: 'kill switch',
    par: 15,
    rows: ['.............', '.#S#AA#1#bb#.', '.###########.', '..........#G#', '..........###', '.............'],
    switches: { '1': { kind: 'soft', act: 'toggle', bridges: 'ab' } },
  },
  {
    id: 'l15',
    name: 'no return',
    par: 8,
    rows: ['...............', '.S##1#a#2####G#', '...............'],
    switches: {
      '1': { kind: 'hard', act: 'on', bridges: 'a' },
      '2': { kind: 'soft', act: 'off', bridges: 'a' },
    },
  },
  {
    id: 'l16',
    name: 'trapdoor',
    par: 22,
    rows: ['.............', '.#S#########.', '...........#.', '...........#.', '.####1###FF#.', '..#..........', '..#..........', '.#####aa###G.', '.............'],
    switches: { '1': { kind: 'hard', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l17',
    name: 'crossed wires',
    par: 6,
    rows: ['.............', '.S##1##2abG#.', '.............'],
    switches: {
      '1': { kind: 'hard', act: 'on', bridges: 'b' },
      '2': { kind: 'hard', act: 'on', bridges: 'a' },
    },
  },
  {
    id: 'l18',
    name: 'gatehouse',
    par: 28,
    rows: ['...............', '.S##1#########.', '.............a.', '.............a.', '.######2######.', '.b.............', '.b.............', '.############G.', '...............'],
    switches: {
      '1': { kind: 'soft', act: 'toggle', bridges: 'a' },
      '2': { kind: 'hard', act: 'toggle', bridges: 'b' },
    },
  },
  {
    id: 'l19',
    name: 'ember walk',
    par: 8,
    rows: ['...............', '.S####1#aa#F#G#', '...............'],
    switches: { '1': { kind: 'soft', act: 'on', bridges: 'a' } },
  },
  {
    id: 'l20',
    name: 'the long way',
    par: 28,
    rows: ['...............', '.S########1###.', '.............a.', '.............a.', '.######2######.', '.b.............', '.b.............', '.#######FF###G.', '...............'],
    switches: {
      '1': { kind: 'hard', act: 'toggle', bridges: 'a' },
      '2': { kind: 'hard', act: 'toggle', bridges: 'b' },
    },
  },
];
