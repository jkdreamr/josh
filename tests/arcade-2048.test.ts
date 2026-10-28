import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canMove, createGame, departed, emptyGrid, frameUnit, layout, leftNotice, mergePitch, move, parseSave, parseSeed, seeded, spawn, undo } from '../src/os/arcade/games/2048/logic.ts';

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

test('the same seed deals the same boards and tiles', () => {
  const a = seeded(1234);
  const b = seeded(1234);
  assert.deepEqual(createGame(a), createGame(b));
  const g = grid([[2, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]);
  assert.deepEqual(spawn(g, a), spawn(g, b));
  assert.notDeepEqual(createGame(seeded(1)), createGame(seeded(99999)));
});

test('saved games restore only when they are valid and still playable', () => {
  const live = { grid: grid([[2, 4, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]]), score: 12, won: false, undoUsed: false, previous: null };
  assert.deepEqual(parseSave(JSON.stringify(live)), live);
  assert.equal(parseSave(null), null);
  assert.equal(parseSave('nope'), null);
  assert.equal(parseSave(JSON.stringify({ ...live, grid: [[3]] })), null);
  const stuck = grid([[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]]);
  assert.equal(parseSave(JSON.stringify({ ...live, grid: stuck })), null);
});

test('seed packets are checked', () => {
  assert.equal(parseSeed({ t: '2048-seed', seed: 42 }), 42);
  assert.equal(parseSeed({ t: '2048-seed', seed: -1 }), null);
  assert.equal(parseSeed({ t: 'other', seed: 1 }), null);
});

test('layout keeps the board square, on screen and clear of the controls', () => {
  const sizes: [number, number][] = [[464, 157], [601, 260], [390, 648], [820, 998], [1440, 860], [320, 200]];
  for (const [w, h] of sizes) {
    const ctrl = { x: w - 130, y: 10, w: 120, h: 28 };
    const { board, hud } = layout(w, h, ctrl, null);
    assert.ok(board.w > 0 && board.w === board.h, `${w}x${h}`);
    assert.ok(board.x >= 0 && board.y >= 0 && board.x + board.w <= w && board.y + board.h <= h, `${w}x${h} on screen`);
    assert.ok(hud.x >= 0 && hud.x + hud.w <= w, `${w}x${h} hud`);
    const overlaps = board.x < ctrl.x + ctrl.w && board.x + board.w > ctrl.x && board.y < ctrl.y + ctrl.h && board.y + board.h > ctrl.y;
    assert.ok(!overlaps, `${w}x${h} clear of controls`);
  }
  assert.equal(layout(464, 157, { x: 334, y: 10, w: 120, h: 28 }, null).mode, 'column');
  assert.equal(layout(390, 648, { x: 260, y: 10, w: 120, h: 28 }, null).mode, 'row');
});

test('merge pitch rises with the tile and frame scale rounds up', () => {
  assert.ok(mergePitch(4) < mergePitch(8) && mergePitch(8) < mergePitch(2048));
  assert.equal(frameUnit(820, 820), 1);
  assert.equal(frameUnit(670.3, 820), 1.23);
});

test('online leavers are found by seat and named in the notice', () => {
  const before = [{ seat: 1, name: 'Ana' }, { seat: 2, name: 'Bo' }, { seat: 3, name: 'Cy' }];
  assert.deepEqual(departed(before, [{ seat: 0 }, { seat: 1 }, { seat: 2 }, { seat: 3 }]), []);
  assert.deepEqual(departed(before, [{ seat: 0 }, { seat: 2 }]), ['Ana', 'Cy']);
  assert.equal(leftNotice([]), '');
  assert.equal(leftNotice(['Ana']), 'Ana Left. Keep Racing to the End.');
  assert.equal(leftNotice(['Ana', 'Cy']), 'Ana and Cy Left. Keep Racing to the End.');
  assert.equal(leftNotice(['Ana', 'Bo', 'Cy']), '3 Players Left. Keep Racing to the End.');
});
