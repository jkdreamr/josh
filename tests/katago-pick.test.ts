import assert from 'node:assert/strict';
import test from 'node:test';
import { BLACK, boardKey, legalMoves, newGame, type GameState } from '../src/os/games/go.ts';
import { GO_LEVELS } from '../src/os/games/go-levels.ts';
import { candidateCount, pickMove } from '../src/os/games/katago/pick.ts';
import type { Evaluator } from '../src/os/games/katago/search.ts';

/** A policy over `size`: `weights` by board index (the pass index is size * size), the rest spread thin. */
function evaluatorFor(weights: Record<number, number>): Evaluator {
  return {
    async evaluate(states) {
      return states.map((state) => {
        const area = state.size * state.size;
        const policy = new Float32Array(area + 1);
        const legal = legalMoves(state);
        const named = Object.values(weights).reduce((sum, value) => sum + value, 0);
        for (const point of legal) policy[point.y * state.size + point.x] = (1 - named) / (legal.length + 1);
        policy[area] = (1 - named) / (legal.length + 1);
        for (const [index, value] of Object.entries(weights)) policy[Number(index)] = value;
        return { policy, win: 0.5, loss: 0.5, noResult: 0, scoreLead: 0, ownership: new Float32Array(area) };
      });
    },
  };
}

const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

test('weaker ranks look at fewer moves on every board size', () => {
  for (const area of [81, 169, 361]) {
    const legal = Math.round(area * 0.9);
    const counts = [18, 12, 6, 1].map((kyu) => candidateCount(kyu, area, legal));
    for (let index = 1; index < counts.length; index += 1) assert.ok(counts[index]! > counts[index - 1]!, `${area}: ${counts}`);
    assert.ok(counts[0]! >= 1 && counts.at(-1)! <= legal);
  }
});

test('a move the network is sure of is always found, even at the weakest rank', async () => {
  const state = newGame(19);
  const sure = 3 * 19 + 15;
  for (let seed = 1; seed <= 20; seed += 1) {
    assert.deepEqual(await pickMove(state, evaluatorFor({ [sure]: 0.9 }), 18, seeded(seed)), { x: 15, y: 3 });
  }
});

test('plays the top idea once pass is among the top five', async () => {
  const state = newGame(13);
  const pass = 13 * 13;
  assert.equal(await pickMove(state, evaluatorFor({ [pass]: 0.4, 7: 0.1 }), 18, seeded(3)), null);
  assert.deepEqual(await pickMove(state, evaluatorFor({ 7: 0.4, [pass]: 0.3 }), 18, seeded(3)), { x: 7, y: 0 });
});

test('the unlimited level always plays the top move; weak ranks often do not', async () => {
  const state = newGame(19);
  const weights = { [3 * 19 + 3]: 0.12, [15 * 19 + 15]: 0.11, [3 * 19 + 15]: 0.1 };
  let weakTop = 0;
  for (let seed = 1; seed <= 40; seed += 1) {
    assert.deepEqual(await pickMove(state, evaluatorFor(weights), null, seeded(seed)), { x: 3, y: 3 });
    const weak = await pickMove(state, evaluatorFor(weights), 18, seeded(seed));
    assert.ok(weak && state.board[weak.y * 19 + weak.x] === 0);
    if (weak.x === 3 && weak.y === 3) weakTop += 1;
  }
  assert.ok(weakTop < 20, `the beginner found the top move ${weakTop} of 40 times`);
});

test('never fills its own eye', async () => {
  const size = 9;
  const board = newGame(size).board.slice();
  for (const [x, y] of [[1, 0], [0, 1], [1, 1]]) board[y * size + x] = BLACK;
  const state: GameState = { ...newGame(size), board, positions: [boardKey(board)] };
  for (let seed = 1; seed <= 30; seed += 1) {
    const move = await pickMove(state, evaluatorFor({ 0: 0.05 }), 18, seeded(seed));
    assert.notDeepEqual(move, { x: 0, y: 0 });
  }
});

test('levels run weakest to strongest and keep the original board ids for the search levels', () => {
  assert.deepEqual(GO_LEVELS.map((level) => level.id), ['beginner', 'novice', 'intermediate', 'advanced', 'fast', 'strong']);
  const ranks = GO_LEVELS.filter((level) => 'kyu' in level && level.kyu !== null).map((level) => (level as { kyu: number }).kyu);
  assert.deepEqual(ranks, [...ranks].sort((a, b) => b - a));
});
