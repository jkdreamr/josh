import assert from 'node:assert/strict';
import { test } from 'node:test';
import { blocksLayout, spinTitle } from '../src/os/arcade/games/blocks/layout.ts';
import {
  cellsFor, createBag, createBoard, createGame, gravitySeconds, hardDrop, holdPiece, LOCK_DELAY, lock, move, rotate, seededRandom, spawnPiece, spinKind, step,
  type BlocksGame, type Piece,
} from '../src/os/arcade/games/blocks/logic.ts';

const fixedRand = () => 0;
const empty = (piece: Piece = 'T'): BlocksGame => {
  const state = createGame(fixedRand);
  state.active = { type: piece, rotation: 0, x: 3, y: 18 };
  state.board = createBoard();
  state.over = false;
  return state;
};

test('seven-bag yields each piece exactly once in every bag', () => {
  let seed = 123;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  for (let i = 0; i < 12; i++) assert.deepEqual([...createBag(rand)].sort(), ['I', 'J', 'L', 'O', 'S', 'T', 'Z']);
});

test('T has four rotation states with the spawn and rotated cells', () => {
  const state = empty('T');
  const start = state.active!.rotation;
  const states = new Set<string>();
  assert.equal(start, 0);
  for (let i = 0; i < 4; i++) {
    states.add(JSON.stringify(cellsFor('T', state.active!.rotation)));
    assert.equal(rotate(state), true);
  }
  assert.equal(states.size, 4);
  assert.equal(state.active!.rotation, 0);
});

test('I uses its wall kick table at the left wall', () => {
  const state = empty('I');
  state.active = { type: 'I', rotation: 1, x: -1, y: 22 };
  assert.equal(rotate(state, -1), true);
  assert.equal(state.active!.rotation, 0);
  assert.equal(state.active!.x, 1);
});

test('O rotates without kicking', () => {
  const state = empty('O');
  state.active = { type: 'O', rotation: 0, x: 7, y: 22 };
  assert.equal(rotate(state), true);
  assert.equal(state.active!.rotation, 1);
  assert.equal(state.active!.x, 7);
});

test('hard drop returns its distance and awards two points per cell', () => {
  const state = empty('O');
  const distance = hardDrop(state, fixedRand);
  assert.equal(distance, 19);
  assert.equal(state.score, distance * 2);
  assert.ok(state.board.some((row) => row.includes('O')));
});

test('lock records the absolute cells of the piece that just locked', () => {
  const state = empty('T');
  const active = state.active!;
  const expected = cellsFor(active.type, active.rotation).map(([dx, dy]) => [active.x + dx, active.y + dy]);
  lock(state, fixedRand);
  assert.equal(state.lastLocked.length, 4);
  assert.deepEqual(state.lastLocked, expected);
});

test('line clear scores scale by level and back-to-back four line clears', () => {
  for (const [count, expected] of [[1, 200], [2, 600], [3, 1000], [4, 1600]] as const) {
    const state = empty('I');
    state.level = 2;
    for (let y = 40 - count; y < 40; y++) for (let x = 0; x < 10; x++) state.board[y][x] = 'J';
    for (let y = 40 - count; y < 40; y++) state.board[y][5] = null;
    state.board[30][0] = 'S';
    state.active = { type: 'I', rotation: 1, x: 3, y: 36 };
    lock(state, fixedRand);
    assert.equal(state.score, expected);
  }
  const state = empty('I');
  state.level = 2;
  state.lines = 10;
  state.board[30][0] = 'S';
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let y = 36; y < 40; y++) for (let x = 0; x < 10; x++) state.board[y][x] = 'J';
    for (let y = 36; y < 40; y++) state.board[y][5] = null;
    state.active = { type: 'I', rotation: 1, x: 3, y: 36 };
    lock(state, fixedRand);
  }
  // The second is back to back (half again) and the first link of a combo (50 times the level).
  assert.equal(state.score, 1600 + 2400 + 100);
});

test('hold is available once until the active piece locks', () => {
  const state = createGame(fixedRand);
  assert.equal(holdPiece(state, fixedRand), true);
  assert.equal(holdPiece(state, fixedRand), false);
  state.active = { type: 'T', rotation: 0, x: 3, y: 37 };
  lock(state, fixedRand);
  assert.equal(state.canHold, true);
  assert.equal(holdPiece(state, fixedRand), true);
});

test('level increases after every ten cleared lines', () => {
  const state = empty('I');
  for (let i = 0; i < 10; i++) {
    for (let x = 0; x < 10; x++) state.board[39][x] = 'J';
    for (let x = 3; x < 7; x++) state.board[39][x] = null;
    state.active = { type: 'I', rotation: 0, x: 3, y: 38 };
    lock(state, fixedRand);
  }
  assert.equal(state.lines, 10);
  assert.equal(state.level, 2);
});

test('spawn overlap causes block-out game over', () => {
  const state = empty('T');
  state.board[18][4] = 'J';
  state.active = null;
  assert.equal(spawnPiece(state, 'T'), false);
  assert.equal(state.over, true);
});

const fillRows = (state: BlocksGame, rows: number[], gaps: number[]) => {
  for (const y of rows) for (let x = 0; x < 10; x++) state.board[y][x] = gaps.includes(x) ? null : 'J';
};

test('a seeded game deals the same pieces every time', () => {
  const a = createGame(seededRandom('blocks|3|Josh'));
  const b = createGame(seededRandom('blocks|3|Josh'));
  const c = createGame(seededRandom('blocks|4|Josh'));
  assert.deepEqual([a.active!.type, ...a.next], [b.active!.type, ...b.next]);
  assert.notDeepEqual([a.active!.type, ...a.next, ...a.bag], [c.active!.type, ...c.next, ...c.bag]);
});

test('a new piece shows in the well right away', () => {
  for (const type of ['I', 'O', 'T', 'S', 'Z', 'J', 'L'] as Piece[]) {
    const state = createGame(fixedRand);
    state.board = createBoard();
    state.active = null;
    assert.equal(spawnPiece(state, type), true);
    const rows = cellsFor(type).map(([, dy]) => state.active!.y + dy);
    assert.ok(Math.max(...rows) >= 20, `${type} has a visible row`);
  }
});

test('step falls a row per gravity interval and soft drop falls faster for a point a row', () => {
  const state = empty('T');
  state.active!.y = 20;
  step(state, gravitySeconds(1) * 0.99);
  assert.equal(state.active!.y, 20);
  step(state, gravitySeconds(1) * 0.02);
  assert.equal(state.active!.y, 21);
  step(state, 0.1, true);
  assert.ok(state.active!.y >= 23);
  assert.equal(state.score, state.active!.y - 21);
});

test('a grounded piece locks after the lock delay, and moving it restarts the delay', () => {
  const state = empty('T');
  state.active!.y = 38;
  assert.equal(step(state, LOCK_DELAY * 0.8), false);
  assert.equal(move(state, 1), true);
  assert.equal(step(state, LOCK_DELAY * 0.8), false);
  assert.ok(state.active);
  assert.equal(step(state, LOCK_DELAY * 0.3), true);
  assert.equal(state.pieces, 1);
  assert.ok(state.board[39].includes('T'));
});

test('clearing the whole board is a perfect clear', () => {
  const state = empty('I');
  fillRows(state, [39], [3, 4, 5, 6]);
  state.active = { type: 'I', rotation: 0, x: 3, y: 38 };
  lock(state, fixedRand);
  assert.equal(state.event!.perfect, true);
  assert.equal(state.event!.points, 100 + 800);
  assert.equal(spinTitle(state.event!), 'Perfect Clear');
});

test('clears in a row build a combo and a lock without a clear ends it', () => {
  const state = empty('I');
  state.board[30][0] = 'S';
  for (let i = 0; i < 3; i++) {
    fillRows(state, [39], [3, 4, 5, 6]);
    state.active = { type: 'I', rotation: 0, x: 3, y: 38 };
    lock(state, fixedRand);
    assert.equal(state.event!.combo, i);
    assert.equal(state.event!.points, 100 + 50 * i);
  }
  state.active = { type: 'O', rotation: 0, x: 0, y: 28 };
  lock(state, fixedRand);
  assert.equal(state.combo, -1);
});

test('turning a T into a slot under an overhang is a T-spin double', () => {
  const state = empty('T');
  fillRows(state, [39], [4]);
  fillRows(state, [38], [3, 4, 5]);
  state.board[37][3] = 'J';
  state.active = { type: 'T', rotation: 1, x: 3, y: 37 };
  assert.equal(rotate(state, 1), true);
  assert.equal(state.spin, 'full');
  lock(state, fixedRand);
  assert.equal(state.event!.lines, 2);
  assert.equal(state.event!.spin, 'full');
  assert.equal(state.event!.points, 1200);
  assert.equal(spinTitle(state.event!), 'T-Spin Double');
});

test('a T that only slid into place is no spin, and other pieces never spin', () => {
  const board = createBoard();
  assert.equal(spinKind(board, { type: 'T', rotation: 2, x: 3, y: 18 }, 0), 'none');
  board[39][0] = 'J';
  board[39][2] = 'J';
  board[37][0] = 'J';
  assert.equal(spinKind(board, { type: 'L', rotation: 2, x: 0, y: 37 }, 0), 'none');
});

test('back to back survives a lock with no clear but not a plain single', () => {
  const state = empty('I');
  state.board[30][0] = 'S';
  const quad = () => {
    fillRows(state, [36, 37, 38, 39], [9]);
    state.active = { type: 'I', rotation: 1, x: 7, y: 36 };
    lock(state, fixedRand);
  };
  quad();
  state.active = { type: 'O', rotation: 0, x: 0, y: 27 };
  lock(state, fixedRand);
  quad();
  assert.equal(state.event!.backToBack, true);
  fillRows(state, [39], [3, 4, 5, 6]);
  state.active = { type: 'I', rotation: 0, x: 3, y: 38 };
  lock(state, fixedRand);
  quad();
  assert.equal(state.event!.backToBack, false);
});

test('layout fits the small framed window beside the shell controls', () => {
  const ctrl = { x: 360, y: 8, w: 96, h: 28 };
  const L = blocksLayout(464, 157, { avoid: [ctrl] });
  const right = L.next.x + L.next.w;
  assert.ok(L.boardY >= 0 && L.boardY + L.cell * 20 <= 157);
  assert.ok(right <= ctrl.x || L.boardY >= ctrl.y + ctrl.h, 'clear of the controls');
  assert.ok(L.font >= 11);
  assert.ok(L.statRows >= 2);
});

test('layout leaves room for touch buttons on a phone', () => {
  const L = blocksLayout(390, 648, { avoid: [{ x: 230, y: 12, w: 148, h: 40 }], bottom: 76 });
  assert.ok(L.boardY + L.cell * 20 <= 648 - 76);
  assert.ok(L.boardX >= L.hold.x + L.hold.w);
  assert.ok(L.next.x + L.next.w <= 390);
  assert.equal(L.statRows, 3);
  assert.ok(L.cell >= 20);
});
