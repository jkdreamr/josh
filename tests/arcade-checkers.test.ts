import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, KING, RED, applyMove, bestMove, count, legalMoves, newGame, parse, play, sq, startBoard } from '../src/os/arcade/games/checkers/checkers.ts';

test('start position: 12 men each, red has 7 opening moves', () => {
  const b = startBoard();
  assert.deepEqual(count(b, RED), { men: 12, kings: 0 });
  assert.deepEqual(count(b, BLACK), { men: 12, kings: 0 });
  assert.equal(legalMoves(b, RED).length, 7);
  assert.equal(legalMoves(b, BLACK).length, 7);
});

test('men only move forward, kings move both ways', () => {
  const b = parse(['........', '........', '........', '...r....', '........', '........', '........', '........']);
  const red = legalMoves(b, RED).map((m) => m.to).sort();
  assert.deepEqual(red, [sq(2, 2), sq(2, 4)]);
  const k = parse(['........', '........', '........', '...R....', '........', '........', '........', '........']);
  assert.equal(legalMoves(k, RED).length, 4);
});

test('captures are mandatory and replace plain moves', () => {
  const b = parse(['........', '........', '........', '..b.....', '...r....', '........', '....r...', '........']);
  const moves = legalMoves(b, RED);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { from: sq(4, 3), to: sq(2, 1), path: [sq(2, 1)], captured: [sq(3, 2)] });
  const after = applyMove(b, moves[0]);
  assert.equal(after[sq(3, 2)], 0);
  assert.equal(after[sq(2, 1)], RED);
});

test('multi-jumps must be completed and can change direction', () => {
  const b = parse(['........', '........', '..b.b...', '........', '..b.....', '...r....', '........', '........']);
  const moves = legalMoves(b, RED);
  assert.equal(moves.length, 1);
  const m = moves[0];
  assert.equal(m.captured.length, 2);
  assert.deepEqual(m.path, [sq(3, 1), sq(1, 3)]);
  assert.equal(m.to, sq(1, 3));
});

test('crowning ends the jump sequence and makes a king', () => {
  // Jumping onto the back rank crowns the man; the new king may not keep jumping this turn.
  const b = parse(['........', '..b.b...', '.r......', '........', '........', '........', '........', '........']);
  const moves = legalMoves(b, RED);
  assert.equal(moves.length, 1);
  assert.deepEqual(moves[0], { from: sq(2, 1), to: sq(0, 3), path: [sq(0, 3)], captured: [sq(1, 2)] });
  const after = applyMove(b, moves[0]);
  assert.equal(after[sq(0, 3)], RED | KING);
  assert.equal(after[sq(1, 4)], BLACK);
  // The chain continues when the landing square is not the back rank.
  const chain = parse(['........', '..b.....', '........', '..b.....', '...r....', '........', '........', '........']);
  const [cm] = legalMoves(chain, RED);
  assert.deepEqual(cm.path, [sq(2, 1), sq(0, 3)]);
  assert.equal(cm.captured.length, 2);
});

test('the longest chain is generated and a king can sweep a loop backward', () => {
  const b = parse(['........', '..b.....', '........', '..b.b...', '........', '....b...', '.....r..', '........']);
  const moves = legalMoves(b, RED);
  const lengths = moves.map((m) => m.captured.length).sort();
  assert.deepEqual(lengths, [2, 3]);
  const k = parse(['........', '........', '....b.b.', '........', '....b.b.', '.....R..', '........', '........']);
  const km = legalMoves(k, RED).reduce((a, m) => (m.captured.length > a.captured.length ? m : a));
  assert.equal(km.captured.length, 4, 'king sweeps all four');
  assert.equal(km.to, sq(5, 5));
});

test('the side with no moves loses, the game reports the winner', () => {
  const stuck = parse(['........', '........', '........', '........', '........', 'b.b.....', '.b......', 'r.......']);
  assert.equal(legalMoves(stuck, RED).length, 0);
  const before = parse(['........', '........', '........', '........', '...b....', 'b.......', '.b......', 'r.......']);
  const g = { ...newGame(), board: before, turn: BLACK as 1 | 2, legal: legalMoves(before, BLACK) };
  const s = play(g, { from: sq(4, 3), to: sq(5, 2), path: [sq(5, 2)], captured: [] });
  assert.equal(s.status, 'black');
  assert.equal(s.legal.length, 0);
});

test('forty quiet king moves each draw the game', () => {
  const b = parse(['B.......', '........', '........', '........', '........', '........', '........', '.......R']);
  let g = { ...newGame(), board: b, turn: RED as 1 | 2, legal: legalMoves(b, RED), status: 'playing' as const, quietPlies: 0 };
  const home: Record<number, number> = {};
  for (let i = 0; i < 80; i++) {
    assert.equal(g.status, 'playing', `ply ${i}`);
    const back = g.legal.find((x) => x.to === home[g.turn]);
    const m = back ?? g.legal[0];
    home[g.turn] = m.from;
    g = play(g, m);
  }
  assert.equal(g.status, 'draw');
  assert.equal(g.quietPlies, 80);
});

test('computer takes the forced capture and finds a two-for-one shot', () => {
  const b = parse(['........', '........', '........', '..b.....', '...r....', '........', '........', '........']);
  assert.equal(bestMove(b, RED, 0, () => 0)!.captured.length, 1);
  // Red gives up the man on (4,3) so that whichever black man takes it gets double-jumped.
  const shot = parse(['........', '........', '...b.b..', '........', '...r....', '....r.r.', '...r.r.r', '........']);
  const m = bestMove(shot, RED, 2)!;
  assert.deepEqual([m.from, m.to], [sq(4, 3), sq(3, 4)]);
  const after = applyMove(shot, m);
  for (const reply of legalMoves(after, BLACK)) {
    assert.equal(reply.captured.length, 1);
    const red = legalMoves(applyMove(after, reply), RED);
    assert.ok(red.some((x) => x.captured.length === 2));
  }
});

test('hard computer beats easy computer in self play', () => {
  let seed = 11;
  const rng = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
  let g = newGame();
  let plies = 0;
  while (g.status === 'playing' && plies < 300) {
    const m = bestMove(g.board, g.turn, g.turn === RED ? 2 : 0, rng)!;
    g = play(g, m);
    plies++;
  }
  assert.equal(g.status, 'red', `status ${g.status} after ${plies} plies`);
});
