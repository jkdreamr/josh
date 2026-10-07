import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEVELS,
  PEERS,
  UNITS,
  completedUnits,
  conflicts,
  countSolutions,
  generate,
  grade,
  hasUniqueSolution,
  isSolved,
  mulberry32,
  solve,
  solvedGrid,
} from '../src/os/arcade/games/sudoku/logic.ts';

const parse = (s: string) => [...s].map((ch) => (ch === '.' ? 0 : Number(ch)));
const validFull = (g: number[]) => g.every((v) => v >= 1 && v <= 9) && UNITS.every((u) => new Set(u.map((i) => g[i])).size === 9);

// A classic singles-only puzzle and its solution.
const EASY = parse('53..7....6..195....98....6.8...6...34..8.3..17...2...6.6....28....419..5....8..79');
const EASY_SOLUTION = parse('534678912672195348198342567859761423426853791713924856961537284287419635345286179');

test('units and peers', () => {
  assert.equal(UNITS.length, 27);
  for (const u of UNITS) assert.equal(new Set(u).size, 9);
  for (const p of PEERS) assert.equal(p.length, 20);
});

test('solver finds the known solution and it is unique', () => {
  assert.deepEqual(solve(EASY), EASY_SOLUTION);
  assert.equal(countSolutions(EASY, 2), 1);
  assert.ok(hasUniqueSolution(EASY));
});

test('an empty grid has many solutions and an invalid grid has none', () => {
  assert.equal(countSolutions(new Array(81).fill(0), 2), 2);
  const bad = EASY.slice();
  bad[2] = 5; // second 5 in the first row
  assert.equal(countSolutions(bad, 2), 0);
});

test('random solved grids are valid', () => {
  const rand = mulberry32(3);
  for (let i = 0; i < 20; i++) assert.ok(validFull(solvedGrid(rand)));
});

test('grader: the classic puzzle needs only singles', () => {
  assert.ok(grade(EASY) <= 2);
  assert.equal(grade(EASY_SOLUTION), 1);
});

for (const level of LEVELS) {
  test(`generate ${level}: unique, consistent, graded, fast`, () => {
    for (let seed = 1; seed <= 25; seed++) {
      const t = performance.now();
      const p = generate(level, mulberry32(seed * 7919));
      const ms = performance.now() - t;
      assert.ok(ms < 250, `generation took ${ms.toFixed(1)}ms`);
      assert.ok(validFull(p.solution));
      assert.ok(hasUniqueSolution(p.puzzle), 'puzzle must have exactly one solution');
      assert.deepEqual(solve(p.puzzle), p.solution);
      p.puzzle.forEach((v, i) => v && assert.equal(v, p.solution[i]));
      assert.equal(p.clues, p.puzzle.filter(Boolean).length);
      p.puzzle.forEach((v, i) => assert.equal(!!v, !!p.puzzle[80 - i], 'clues are symmetric'));
      if (level === 'easy') {
        assert.ok(p.clues >= 36, `easy has ${p.clues} clues`);
        assert.ok(p.grade <= 2);
      }
      if (level === 'medium') {
        assert.ok(p.clues <= 34 && p.clues >= 28, `medium has ${p.clues} clues`);
        assert.ok(p.grade <= 2);
      }
      if (level === 'hard') {
        assert.ok(p.clues <= 32, `hard has ${p.clues} clues`);
        assert.ok(p.grade >= 3, 'hard needs more than singles');
      }
    }
  });
}

test('conflicts flags repeated values in a row, column or box', () => {
  const g = new Array(81).fill(0);
  g[0] = 4;
  g[8] = 4; // same row
  g[72] = 7;
  g[80] = 1;
  assert.deepEqual([...conflicts(g)].sort((a, b) => a - b), [0, 8]);
  g[8] = 0;
  g[10] = 4; // same box as 0
  assert.deepEqual([...conflicts(g)].sort((a, b) => a - b), [0, 10]);
  g[10] = 0;
  g[36] = 4; // same column as 0
  assert.deepEqual([...conflicts(g)].sort((a, b) => a - b), [0, 36]);
  assert.equal(conflicts(EASY_SOLUTION).size, 0);
});

test('completed units and solved detection', () => {
  const g = EASY_SOLUTION.slice();
  assert.deepEqual(completedUnits(g, 0), [0, 9, 18]);
  g[1] = 0;
  assert.deepEqual(completedUnits(g, 0), [9]);
  assert.ok(!isSolved(g, EASY_SOLUTION));
  assert.ok(isSolved(EASY_SOLUTION.slice(), EASY_SOLUTION));
});
