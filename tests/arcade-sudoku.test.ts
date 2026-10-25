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
  hintCell,
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
    const grades: number[] = [];
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
        grades.push(p.grade);
      }
      if (level === 'medium') {
        grades.push(p.grade);
        assert.ok(p.clues <= 34 && p.clues >= 28, `medium has ${p.clues} clues`);
        assert.ok(p.grade <= 2);
      }
      if (level === 'hard') {
        assert.ok(p.clues <= 32, `hard has ${p.clues} clues`);
        assert.ok(p.grade >= 3, 'hard needs more than singles');
      }
    }
    // easy is naked singles and medium needs hidden singles, so the two levels feel different
    if (level !== 'hard') assert.ok(grades.filter((g) => g === (level === 'easy' ? 1 : 2)).length >= 23, `${level} grades ${grades}`);
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

test('hint picks the selected cell, then wrong entries, then the most constrained open cell', () => {
  const locked = EASY.map((v) => v > 0);
  const g = EASY.slice();
  assert.equal(hintCell(g, EASY_SOLUTION, locked, 2), 2);
  assert.equal(hintCell(g, EASY_SOLUTION, locked, 0), hintCell(g, EASY_SOLUTION, locked, -1), 'a given cell is never the hint');
  g[3] = EASY_SOLUTION[3] === 1 ? 2 : 1; // a wrong entry
  assert.equal(hintCell(g, EASY_SOLUTION, locked, 0), 3);
  const open = hintCell(EASY, EASY_SOLUTION, locked, -1);
  assert.equal(EASY[open], 0);
  assert.equal(hintCell(EASY_SOLUTION, EASY_SOLUTION, locked, 5), -1);
});

test('layout keeps every part inside the game area and clear of the shell controls', async () => {
  const { layout } = await import('../src/os/arcade/games/sudoku/layout.ts');
  const sizes: [number, number, boolean, number][] = [
    [464, 157, false, 1],
    [601, 260, false, 1],
    [1000, 560, false, 1],
    [1440, 820, false, 1],
    [390, 648, true, 1],
    [820, 998, true, 1.224],
    [540, 360, false, 1],
  ];
  for (const [W, H, touch, u] of sizes) {
    const pill = { left: W - 110, bottom: 40 };
    const L = layout(W, H, pill, touch, u);
    const parts = [L.board, L.info, L.tools, L.pad];
    for (const b of parts) {
      assert.ok(b.x >= 0 && b.y >= 0 && b.x + b.w <= W && b.y + b.h <= H, `${W}x${H} ${L.kind} ${JSON.stringify(b)}`);
      assert.ok(!(b.x + b.w > pill.left && b.y < pill.bottom), `${W}x${H} ${L.kind} under the pill ${JSON.stringify(b)}`);
    }
    for (let a = 0; a < parts.length; a++)
      for (let b = a + 1; b < parts.length; b++) {
        const p = parts[a];
        const q = parts[b];
        assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, `${W}x${H} ${L.kind} overlap ${a} ${b}`);
      }
    const key = Math.min(L.pad.w / L.padCols, L.pad.h / Math.ceil(9 / L.padCols));
    assert.ok(key >= (touch ? 40 : 24), `${W}x${H} pad key ${key}`);
    assert.ok(L.board.w >= 120, `${W}x${H} board ${L.board.w}`);
  }
});
