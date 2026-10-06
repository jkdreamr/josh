import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canMove, createGame, emptyGrid, move, spawn, undo } from '../src/os/arcade/games/2048/logic.ts';

const grid = (rows: number[][]) => rows.map((row) => [...row]);

test('left merges each adjacent pair once, including three and four equal tiles', () => {
  assert.deepEqual(move(grid([[2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left').grid[0], [4, 4, 0, 0]);
  assert.deepEqual(move(grid([[2, 2, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left').grid[0], [4, 4, 0, 0]);
  assert.deepEqual(move(grid([[4, 4, 4, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'right').grid[0], [0, 0, 4, 8]);
});

test('all directions compact and merge toward the requested edge', () => {
  const source = grid([[2, 0, 0, 0], [2, 0, 0, 0], [4, 0, 0, 0], [0, 0, 0, 0]]);
  assert.deepEqual(move(source, 'up').grid.map((row) => row[0]), [4, 4, 0, 0]);
  assert.deepEqual(move(source, 'down').grid.map((row) => row[0]), [0, 0, 4, 4]);
  assert.deepEqual(move(grid([[0, 0, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left').grid[0], [4, 0, 0, 0]);
  assert.deepEqual(move(grid([[2, 2, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), 'right').grid[0], [0, 0, 0, 4]);
});

test('tiles never double-merge and gained points sum merged values', () => {
  const result = move(grid([[2, 2, 4, 0], [2, 2, 2, 2], [0, 0, 0, 0], [0, 0, 0, 0]]), 'left');
  assert.deepEqual(result.grid[0], [4, 4, 0, 0]);
  assert.deepEqual(result.grid[1], [4, 4, 0, 0]);
  assert.equal(result.gained, 12);
});

test('moved is false when the grid cannot change', () => {
  const source = grid([[2, 4, 8, 16], [4, 8, 16, 32], [8, 16, 32, 64], [16, 32, 64, 128]]);
  assert.equal(move(source, 'left').moved, false);
  assert.equal(move(source, 'up').moved, false);
});

test('canMove is false on a full checkerboard', () => {
  const checker = grid(Array.from({ length: 4 }, (_, r) => Array.from({ length: 4 }, (_, c) => ((r + c) % 2 ? 4 : 2))));
  assert.equal(canMove(checker), false);
});

test('spawn selects only an empty cell and creates a 2 or 4', () => {
  const source = grid([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  let draw = 0;
  const twos = spawn(source, () => draw++ === 0 ? 0 : 0.5);
  assert.deepEqual(twos.position, [0, 1]);
  assert.equal(twos.value, 2);
  draw = 0;
  const fours = spawn(source, () => draw++ === 0 ? 0.95 : 0.05);
  assert.deepEqual(fours.position, [3, 3]);
  assert.equal(fours.value, 4);
  assert.equal(source[0][1], 0);
});

test('new game begins with two tiles and undo restores only once', () => {
  const started = createGame(() => 0);
  assert.equal(started.flat().filter(Boolean).length, 2);
  const previous = { grid: emptyGrid(), score: 0 };
  const first = undo({ grid: started, score: 8, used: false }, previous);
  assert.equal(first.restored, true);
  assert.deepEqual(first.state.grid, emptyGrid());
  assert.equal(first.state.score, 0);
  const second = undo(first.state, previous);
  assert.equal(second.restored, false);
  assert.equal(second.state.used, true);
});
