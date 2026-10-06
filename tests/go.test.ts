import assert from 'node:assert/strict';
import test from 'node:test';
import { aiMove, BLACK, boardKey, newGame, pass, play, score, WHITE, type GameState } from '../src/os/games/go.ts';

function position(size: number, stones: Array<[number, number, number]>, toPlay = BLACK): GameState {
  const state = newGame(size);
  const board = [...state.board];
  for (const [x, y, color] of stones) board[y * size + x] = color;
  return { ...state, board, toPlay, positions: [boardKey(board)] };
}

test('captures a single stone', () => {
  const state = position(5, [[2, 2, -1], [1, 2, BLACK], [3, 2, BLACK], [2, 1, BLACK]]);
  const result = play(state, 2, 3);
  assert.equal(result.ok, true);
  assert.deepEqual(result.captured, [12]);
  assert.equal(result.state.board[12], 0);
  assert.equal(result.state.captures.black, 1);
});

test('captures a multi-stone group', () => {
  const state = position(5, [
    [1, 1, -1], [2, 1, -1],
    [0, 1, BLACK], [1, 0, BLACK], [1, 2, BLACK], [2, 0, BLACK], [2, 2, BLACK],
  ]);
  const result = play(state, 3, 1);
  assert.equal(result.ok, true);
  assert.equal(result.captured.length, 2);
  assert.equal(result.state.board[6], 0);
  assert.equal(result.state.board[7], 0);
});

test('rejects suicide', () => {
  const state = position(5, [[2, 1, -1], [1, 2, -1], [3, 2, -1], [2, 3, -1]]);
  const result = play(state, 2, 2);
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'suicide');
});

test('allows a suicidal-looking move that captures', () => {
  const state = position(3, [
    [0, 0, BLACK], [2, 0, BLACK], [0, 2, BLACK], [2, 2, BLACK],
    [1, 0, -1], [0, 1, -1], [2, 1, -1], [1, 2, -1],
  ]);
  const result = play(state, 1, 1);
  assert.equal(result.ok, true);
  assert.equal(result.captured.length, 4);
});

test('rejects a simple ko recapture by positional superko', () => {
  const state = position(5, [
    [2, 2, -1],
    [1, 2, BLACK], [3, 2, BLACK], [2, 1, BLACK],
    [1, 3, -1], [3, 3, -1], [2, 4, -1],
  ]);
  const capture = play(state, 2, 3);
  assert.equal(capture.ok, true);
  const recapture = play(capture.state, 2, 2);
  assert.equal(recapture.ok, false);
  assert.equal(recapture.reason, 'ko');
});

test('two passes enter the dead-stone marking phase', () => {
  const afterFirst = pass(newGame());
  assert.equal(afterFirst.phase, 'play');
  assert.equal(pass(afterFirst).phase, 'mark');
});

test('AI passes after the opponent passes in a settled endgame', () => {
  const stones: Array<[number, number, number]> = [];
  for (let y = 0; y < 9; y += 1) {
    for (let x = 0; x < 9; x += 1) {
      if ((x === 0 && y === 0) || (x === 1 && y === 0) || (x === 8 && y === 8)) continue;
      stones.push([x, y, WHITE]);
    }
  }
  stones.push([0, 0, BLACK]);
  const state = pass(position(9, stones, BLACK));
  assert.equal(state.consecutivePasses, 1);
  assert.equal(aiMove(state, 40), null);
});

test('scores a finished area position with 7.5 komi', () => {
  const state = position(9, [
    [0, 1, BLACK], [1, 0, BLACK], [2, 1, BLACK], [1, 2, BLACK],
    [8, 8, -1],
  ]);
  const result = score(state);
  assert.equal(result.blackStones, 4);
  assert.equal(result.blackTerritory, 2);
  assert.equal(result.whiteStones, 1);
  assert.equal(result.whiteTerritory, 0);
  assert.equal(result.result, 'W+2.5');
});

test('AI returns a legal move within its budget', () => {
  const state = newGame(9);
  const started = performance.now();
  const move = aiMove(state, 25);
  assert.ok(move);
  assert.ok(play(state, move.x, move.y).ok);
  assert.ok(performance.now() - started < 1000);
});
