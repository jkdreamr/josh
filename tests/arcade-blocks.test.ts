import assert from 'node:assert/strict';
import { test } from 'node:test';
import { cellsFor, createBag, createBoard, createGame, hardDrop, holdPiece, lock, rotate, spawnPiece, type BlocksGame, type Piece } from '../src/os/arcade/games/blocks/logic.ts';

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
    state.active = { type: 'I', rotation: 1, x: 3, y: 36 };
    lock(state, fixedRand);
    assert.equal(state.score, expected);
  }
  const state = empty('I');
  state.level = 2;
  state.lines = 10;
  for (let repeat = 0; repeat < 2; repeat++) {
    for (let y = 36; y < 40; y++) for (let x = 0; x < 10; x++) state.board[y][x] = 'J';
    for (let y = 36; y < 40; y++) state.board[y][5] = null;
    state.active = { type: 'I', rotation: 1, x: 3, y: 36 };
    lock(state, fixedRand);
  }
  assert.equal(state.score, 1600 + 2400);
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
