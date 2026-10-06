import assert from 'node:assert/strict';
import test from 'node:test';
import { newOmok, omokAiMove, playOmok, type OmokColor, type OmokPoint, type OmokState } from '../src/os/games/omok.ts';

function position(stones: Array<[number, number, OmokColor]>, toPlay: OmokColor = 1): OmokState {
  const state = newOmok();
  const board = [...state.board];
  for (const [x, y, color] of stones) board[y * state.size + x] = color;
  return { ...state, board, toPlay };
}

function playLine(direction: OmokPoint): void {
  const start = { x: direction.x === 0 ? 7 : 5, y: direction.y === 0 ? 7 : 5 };
  const stones: Array<[number, number, OmokColor]> = [];
  for (let step = 0; step < 4; step += 1) {
    stones.push([start.x + direction.x * step, start.y + direction.y * step, 1]);
  }
  const result = playOmok(position(stones), start.x + direction.x * 4, start.y + direction.y * 4);
  assert.equal(result.ok, true);
  assert.equal(result.state.winner, 1);
  assert.equal(result.state.winLine.length, 5);
}

test('wins with five horizontally', () => playLine({ x: 1, y: 0 }));
test('wins with five vertically', () => playLine({ x: 0, y: 1 }));
test('wins with five on the rising diagonal', () => playLine({ x: 1, y: 1 }));
test('wins with five on the falling diagonal', () => playLine({ x: 1, y: -1 }));

test('four in a row does not win', () => {
  const result = playOmok(position([[4, 7, 1], [5, 7, 1], [6, 7, 1]]), 7, 7);
  assert.equal(result.ok, true);
  assert.equal(result.state.winner, null);
  assert.equal(result.state.winLine.length, 0);
});

test('six in a row wins under free-style rules', () => {
  const stones: Array<[number, number, OmokColor]> = [];
  for (let x = 4; x < 9; x += 1) stones.push([x, 7, 1]);
  const result = playOmok(position(stones), 9, 7);
  assert.equal(result.ok, true);
  assert.equal(result.state.winner, 1);
  assert.equal(result.state.winLine.length, 5);
});

test('AI takes an immediate five', () => {
  const move = omokAiMove(position([[4, 7, 1], [5, 7, 1], [6, 7, 1], [7, 7, 1]], 1), 'normal');
  assert.ok(move);
  assert.ok(move.x === 3 || move.x === 8);
});

test('AI blocks an opponent four', () => {
  const move = omokAiMove(position([[4, 7, -1], [5, 7, -1], [6, 7, -1], [7, 7, -1]], 1), 'normal');
  assert.ok(move);
  assert.ok(move.x === 3 || move.x === 8);
});

test('normal AI blocks an opponent open three', () => {
  const move = omokAiMove(position([[5, 7, -1], [6, 7, -1], [7, 7, -1]], 1), 'normal');
  assert.ok(move);
  assert.ok(move.x === 4 || move.x === 8);
});

test('a full board with no five is a draw', () => {
  const state = newOmok();
  const board = Array<OmokColor | 0>(state.size * state.size).fill(0);
  const pattern: OmokColor[] = [1, 1, -1, -1];
  for (let y = 0; y < state.size; y += 1) {
    for (let x = 0; x < state.size; x += 1) board[y * state.size + x] = pattern[(x + 2 * y) % 4];
  }
  const x = 14;
  const y = 14;
  const color = board[y * state.size + x] as OmokColor;
  board[y * state.size + x] = 0;
  const result = playOmok({ ...state, board, toPlay: color }, x, y);
  assert.equal(result.ok, true);
  assert.equal(result.state.winner, 0);
});

test('rejects occupied and finished positions', () => {
  const first = playOmok(newOmok(), 7, 7);
  assert.equal(playOmok(first.state, 7, 7).reason, 'occupied');
  const win = playOmok(position([[4, 7, 1], [5, 7, 1], [6, 7, 1], [7, 7, 1]]), 8, 7);
  assert.equal(playOmok(win.state, 2, 2).reason, 'finished');
});
