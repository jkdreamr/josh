import assert from 'node:assert/strict';
import test from 'node:test';
import { BLACK, boardKey, newGame, pass, play, type GameState } from '../src/os/games/go.ts';
import { encodeV7, moveHistory, symmetryIndex } from '../src/os/games/katago/features.ts';

function position(stones: Array<[number, number, number]>, toPlay = BLACK): GameState {
  const state = newGame(9);
  const board = [...state.board];
  for (const [x, y, color] of stones) board[y * 9 + x] = color;
  return { ...state, board, toPlay, positions: [boardKey(board)] };
}

function plane(features: Float32Array, index: number, channel: number): number {
  return features[index * 22 + channel]!;
}

test('encodes the empty 9x9 board and KataGo global defaults', () => {
  const { spatial, global } = encodeV7(newGame(9));
  assert.equal(spatial.length, 9 * 9 * 22);
  assert.equal(global.length, 19);
  for (let index = 0; index < 81; index += 1) assert.equal(plane(spatial, index, 0), 1);
  assert.equal(global[5], -0.375);
  assert.equal(global[6], 1);
  assert.equal(global[7], 0.5);
  assert.equal(global[8], 0);
  assert.equal(global[9], 0);
  assert.equal(global[14], 0);
  assert.equal(global[18], -0.5);
});

test('encodes the last black move and white-to-play komi globals', () => {
  const played = play(newGame(9), 4, 4);
  assert.equal(played.ok, true);
  const { spatial, global } = encodeV7(played.state);
  const center = 4 * 9 + 4;
  assert.equal(plane(spatial, center, 2), 1);
  assert.equal(plane(spatial, center, 9), 1);
  assert.equal(global[5], 0.375);
  assert.equal(global[18], 0.5);
});

test('marks an atari group in the one-liberty plane', () => {
  const state = position([[4, 4, -1], [3, 4, BLACK], [5, 4, BLACK], [4, 3, BLACK]]);
  const { spatial } = encodeV7(state);
  assert.equal(plane(spatial, 4 * 9 + 4, 3), 1);
});

test('records pass history and pass status', () => {
  const state = pass(newGame(9));
  const { global } = encodeV7(state);
  assert.equal(global[0], 1);
  assert.equal(global[14], 1);
  assert.deepEqual(moveHistory(state), [{ player: BLACK, move: -1 }]);
  const afterTwoPasses = encodeV7(pass(state));
  assert.equal(afterTwoPasses.global[0], 1);
  assert.equal(afterTwoPasses.global[1], 0);
});

test('marks a positional-superko recapture in plane 6', () => {
  const state = position([
    [4, 4, -1],
    [3, 4, BLACK], [5, 4, BLACK], [4, 3, BLACK],
    [3, 5, -1], [5, 5, -1], [4, 6, -1],
  ]);
  const capture = play(state, 4, 5);
  assert.equal(capture.ok, true);
  const recapture = play(capture.state, 4, 4);
  assert.equal(recapture.ok, false);
  assert.equal(recapture.reason, 'ko');
  const { spatial } = encodeV7(capture.state);
  assert.equal(plane(spatial, 4 * 9 + 4, 6), 1);
});

test('derives chronological move history including passes', () => {
  let state = play(newGame(9), 0, 0).state;
  state = pass(state);
  state = play(state, 1, 0).state;
  assert.deepEqual(moveHistory(state), [
    { player: BLACK, move: 0 },
    { player: -1, move: -1 },
    { player: BLACK, move: 1 },
  ]);
});

test('marks laddered stones and the working capture move', () => {
  const state = position([[2, 4, BLACK], [4, 4, -1], [5, 4, BLACK], [4, 5, BLACK]]);
  const { spatial } = encodeV7(state);
  assert.equal(plane(spatial, 4 * 9 + 4, 14), 1);
  assert.equal(plane(spatial, 3 * 9 + 4, 17), 1);
});

test('all eight symmetry transforms are bijections', () => {
  for (let symmetry = 0; symmetry < 8; symmetry += 1) {
    const transformed = Array.from({ length: 81 }, (_, index) => symmetryIndex(symmetry, index));
    const inverse = new Int16Array(81);
    transformed.forEach((position, index) => { inverse[position] = index; });
    assert.equal(new Set(transformed).size, 81);
    for (let index = 0; index < 81; index += 1) assert.equal(inverse[transformed[index]!], index);
  }
});
