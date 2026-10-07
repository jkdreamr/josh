import assert from 'node:assert/strict';
import test from 'node:test';
import { BLACK, boardKey, legalMoves, newGame, pass, play, type GameState } from '../src/os/games/go.ts';
import { search, type Evaluator, type NetOutput, type SearchOptions } from '../src/os/games/katago/search.ts';

function position(stones: Array<[number, number, number]>, toPlay = BLACK): GameState {
  const state = newGame(9);
  const board = [...state.board];
  for (const [x, y, color] of stones) board[y * 9 + x] = color;
  return { ...state, board, toPlay, positions: [boardKey(board)] };
}

function mockEvaluator(
  outputFor: (state: GameState) => Partial<NetOutput> = () => ({}),
): Evaluator {
  return {
    async evaluate(states) {
      return states.map((state) => {
        const overrides = outputFor(state);
        const policy = overrides.policy ?? new Float32Array(82);
        if (!overrides.policy) {
          const moves = legalMoves(state);
          const share = 1 / (moves.length + 1);
          for (const move of moves) policy[move.y * 9 + move.x] = share;
          policy[81] = share;
        }
        return {
          policy,
          win: 0.5,
          loss: 0.5,
          noResult: 0,
          scoreLead: 0,
          ownership: new Float32Array(81),
          ...overrides,
        };
      });
    },
  };
}

const options = (overrides: Partial<SearchOptions> = {}): SearchOptions => ({
  maxVisits: 8,
  maxTimeMs: 2_000,
  batchSize: 1,
  ...overrides,
});

test('chooses the clearly highest-prior move deterministically', async () => {
  const policy = new Float32Array(82);
  policy[4 * 9 + 4] = 0.9;
  policy[81] = 0.1;
  const evaluator = mockEvaluator(() => ({ policy }));
  const result = await search(newGame(9), evaluator, options({ maxVisits: 1 }));
  assert.deepEqual(result.move, { x: 4, y: 4 });
  assert.equal(result.visits, 1);
});

test('does not pass while behind when the pass prior dominates', async () => {
  const policy = new Float32Array(82);
  policy[81] = 0.99;
  const result = await search(newGame(9), mockEvaluator(() => ({ policy, scoreLead: -20 })), options({ maxVisits: 1 }));
  assert.notEqual(result.move, null);
});

test('passes after the opponent passes when the area count is ahead', async () => {
  const stones: Array<[number, number, number]> = [];
  for (let index = 0; index < 81; index += 1) {
    if (index !== 40) stones.push([index % 9, Math.floor(index / 9), -1]);
  }
  const state = pass(position(stones));
  const policy = new Float32Array(82);
  policy[81] = 0.99;
  const result = await search(state, mockEvaluator(() => ({ policy, scoreLead: -20 })), options({ maxVisits: 1 }));
  assert.equal(result.move, null);
});

test('never returns a positional-superko move', async () => {
  const state = position([
    [4, 4, -1],
    [3, 4, BLACK], [5, 4, BLACK], [4, 3, BLACK],
    [3, 5, -1], [5, 5, -1], [4, 6, -1],
  ]);
  const capture = play(state, 4, 5);
  assert.equal(capture.ok, true);
  const policy = new Float32Array(82);
  policy[4 * 9 + 4] = 0.99;
  policy[81] = 0.01;
  const result = await search(capture.state, mockEvaluator(() => ({ policy })), options({ maxVisits: 1 }));
  assert.notDeepEqual(result.move, { x: 4, y: 4 });
  if (result.move) assert.equal(play(capture.state, result.move.x, result.move.y).ok, true);
});

test('respects the requested visit budget', async () => {
  const result = await search(newGame(9), mockEvaluator(), options({ maxVisits: 7, batchSize: 3 }));
  assert.ok(result.visits > 0);
  assert.ok(result.visits <= 7);
});

test('seeded opening sampling varies only inside its configured opening window', async () => {
  const policy = new Float32Array(82);
  policy[0] = 0.55;
  policy[1] = 0.44;
  policy[81] = 0.01;
  const evaluator = mockEvaluator(() => ({ policy }));
  const opening = newGame(9);
  const common = options({ maxVisits: 30, openingSampleMoves: 10 });
  const first = await search(opening, evaluator, { ...common, rng: () => 0 });
  const second = await search(opening, evaluator, { ...common, rng: () => 0.999999 });
  assert.notDeepEqual(first.move, second.move);

  const later = { ...opening, past: Array.from({ length: 20 }, () => opening.past[0] ?? {
    board: [...opening.board],
    toPlay: opening.toPlay,
    captures: { ...opening.captures },
    consecutivePasses: opening.consecutivePasses,
    phase: opening.phase,
    positions: [...opening.positions],
    lastMove: null,
    winner: null,
  }) };
  const lateFirst = await search(later, evaluator, { ...common, rng: () => 0 });
  const lateSecond = await search(later, evaluator, { ...common, rng: () => 0.999999 });
  assert.deepEqual(lateFirst.move, lateSecond.move);
});
