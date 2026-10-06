import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bestCol, createBoard, drop, dropRow, evaluate, findWin, idx, isFull, legalCols, LINES, parse, winLine } from '../src/os/arcade/games/connect4/connect4.ts';

test('board has 69 four-in-a-row windows', () => {
  assert.equal(LINES.length, 69);
});

test('discs stack from the bottom and columns fill up', () => {
  let b = createBoard();
  for (let i = 0; i < 6; i++) {
    const d = drop(b, 3, (i % 2 === 0 ? 1 : 2) as 1 | 2)!;
    assert.equal(d.row, i);
    b = d.board;
  }
  assert.equal(dropRow(b, 3), -1);
  assert.equal(drop(b, 3, 1), null);
  assert.deepEqual(legalCols(b), [0, 1, 2, 4, 5, 6]);
});

test('detects horizontal, vertical and both diagonal wins through the last move', () => {
  const h = parse(['.......', '.......', '.......', '.......', '.......', 'rrrr...']);
  assert.deepEqual(winLine(h, idx(3, 0)), [idx(0, 0), idx(1, 0), idx(2, 0), idx(3, 0)]);
  const v = parse(['.......', '.......', 'y......', 'y......', 'y......', 'y......']);
  assert.ok(winLine(v, idx(0, 3)));
  const d1 = parse(['.......', '.......', '...r...', '..ry...', '.ryy...', 'ryyr...']);
  assert.ok(winLine(d1, idx(3, 3)));
  const d2 = parse(['.......', '.......', 'y......', 'ry.....', 'rry....', 'yrry...']);
  assert.ok(winLine(d2, idx(0, 3)));
  assert.equal(winLine(d2, idx(0, 0)), null);
  assert.equal(findWin(d1)?.player, 1);
});

test('three in a row is not a win and a full board is a draw', () => {
  const b = parse(['.......', '.......', '.......', '.......', '.......', 'rrr.yyy']);
  assert.equal(winLine(b, idx(2, 0)), null);
  const full = parse(['ryryryr', 'ryryryr', 'yryryry', 'yryryry', 'ryryryr', 'ryryryr']);
  assert.ok(isFull(full));
  assert.equal(findWin(full), null);
});

test('computer takes an immediate win', () => {
  const b = parse(['.......', '.......', '.......', '.......', 'yy.....', 'rrr.y..']);
  assert.equal(bestCol(b, 1, 0, () => 0.99), 3);
  assert.equal(bestCol(b, 1, 2), 3);
});

test('computer blocks an immediate loss at every level', () => {
  const b = parse(['.......', '.......', '.......', '.......', '.......', '.yyyr..']);
  assert.equal(bestCol(b, 1, 0, () => 0.99), 0);
  assert.equal(bestCol(b, 1, 1), 0);
  assert.equal(bestCol(b, 1, 2), 0);
});

test('hard computer avoids handing the opponent a win', () => {
  // Playing column 3 would let yellow land on top and complete a diagonal.
  const b = parse(['.......', '.......', '.......', '....y..', 'y..ry..', 'yrrry..']);
  assert.notEqual(bestCol(b, 1, 2), 5);
  const c = bestCol(b, 1, 2);
  const d = drop(b, c, 1)!;
  assert.equal(findWin(d.board), null);
});

test('hard computer beats easy computer in self play', () => {
  let seed = 7;
  const rng = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let b = createBoard();
  let p: 1 | 2 = 1;
  let winner = 0;
  for (let turn = 0; turn < 42; turn++) {
    const c = bestCol(b, p, p === 1 ? 2 : 0, rng);
    const d = drop(b, c, p)!;
    b = d.board;
    if (winLine(b, idx(c, d.row))) {
      winner = p;
      break;
    }
    p = p === 1 ? 2 : 1;
  }
  assert.equal(winner, 1);
});

test('evaluate favours the side with more open windows', () => {
  const b = parse(['.......', '.......', '.......', '.......', '.......', '...r...']);
  assert.ok(evaluate(b, 1) > 0);
  assert.ok(evaluate(b, 2) < 0);
});

test('bestCol only returns playable columns', () => {
  const b = parse(['ryryry.', 'yryryr.', 'ryryry.', 'yryryr.', 'ryryry.', 'yryryr.']);
  assert.equal(bestCol(b, 1, 2), 6);
});
