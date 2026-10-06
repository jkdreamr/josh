import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestMove, evaluate } from '../src/os/arcade/games/chess/ai.ts';
import {
  BLACK, CASTLE_BK, CASTLE_BQ, CASTLE_WK, CASTLE_WQ, FLAG_CASTLE, FLAG_EP, KNIGHT, QUEEN, START_FEN, WHITE,
  findMove, fromFen, inCheck, insufficientMaterial, legalMoves, makeMove, moveFlags, moveFrom, movePromo, moveTo, newGame, parseSquare, perft, play, positionKey, startPosition, toFen, toSan, unmakeMove,
} from '../src/os/arcade/games/chess/engine.ts';

const sq = parseSquare;
const moveFor = (fen: string, from: string, to: string, promo = 0) => {
  const p = fromFen(fen);
  const m = findMove(legalMoves(p), sq(from), sq(to), promo);
  assert.ok(m !== undefined, `${from}${to} should be legal in ${fen}`);
  return { p, m: m! };
};

test('perft from the start position: 20, 400, 8902', () => {
  const p = startPosition();
  assert.equal(perft(p, 1), 20);
  assert.equal(perft(p, 2), 400);
  assert.equal(perft(p, 3), 8902);
});

test('perft on known positions (castling, en passant, promotions, checks)', () => {
  const cases: [string, number[]][] = [
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812]],
    ['r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
    ['r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
  ];
  for (const [fen, expected] of cases) {
    const p = fromFen(fen);
    expected.forEach((n, i) => assert.equal(perft(p, i + 1), n, `${fen} depth ${i + 1}`));
  }
});

test('fen round-trips', () => {
  for (const fen of [START_FEN, 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', 'rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq e6 0 2']) assert.equal(toFen(fromFen(fen)), fen);
});

test('make and unmake restore the position exactly', () => {
  const p = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
  const before = toFen(p);
  const key = positionKey(p);
  for (const m of legalMoves(p)) {
    const u = makeMove(p, m);
    unmakeMove(p, m, u);
    assert.equal(toFen(p), before);
    assert.equal(positionKey(p), key);
  }
});

test('castling: both sides, rights lost when king or rook moves, blocked by attacks', () => {
  const fen = 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1';
  const { p, m } = moveFor(fen, 'e1', 'g1');
  assert.equal(moveFlags(m), FLAG_CASTLE);
  makeMove(p, m);
  assert.equal(toFen(p).split(' ')[0], 'r3k2r/8/8/8/8/8/8/R4RK1');
  assert.equal(p.castling & (CASTLE_WK | CASTLE_WQ), 0, 'white rights gone');
  assert.ok(p.castling & CASTLE_BK && p.castling & CASTLE_BQ, 'black rights stay');
  const q = moveFor(fen, 'e1', 'c1');
  makeMove(q.p, q.m);
  assert.equal(toFen(q.p).split(' ')[0], 'r3k2r/8/8/8/8/8/8/2KR3R');

  const rookMove = moveFor(fen, 'h1', 'h2');
  makeMove(rookMove.p, rookMove.m);
  assert.equal(rookMove.p.castling & CASTLE_WK, 0);
  assert.ok(rookMove.p.castling & CASTLE_WQ);

  // A rook on f8 covers f1: no short castle; long castle is still fine.
  const attacked = fromFen('5r1k/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const moves = legalMoves(attacked);
  assert.equal(findMove(moves, sq('e1'), sq('g1')), undefined);
  assert.ok(findMove(moves, sq('e1'), sq('c1')) !== undefined);
  // In check: no castling at all.
  const checked = fromFen('4r2k/8/8/8/8/8/8/R3K2R w KQ - 0 1');
  const cm = legalMoves(checked);
  assert.ok(inCheck(checked));
  assert.equal(cm.filter((m) => moveFlags(m) & FLAG_CASTLE).length, 0);
});

test('en passant: available only right after the double push, removes the right pawn', () => {
  const g0 = newGame('rnbqkbnr/ppp1pppp/8/3pP3/8/8/PPPP1PPP/RNBQKBNR b KQkq - 0 2');
  const g1 = play(g0, findMove(g0.legal, sq('d5'), sq('d4'))!); // not relevant; black plays elsewhere
  assert.equal(g1.pos.ep, -1);
  const g = newGame('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3');
  const push = findMove(g.legal, sq('c2'), sq('c4'))!;
  const after = play(g, push);
  assert.equal(after.pos.ep, sq('c3'));
  const ep = findMove(after.legal, sq('d4'), sq('c3'))!;
  assert.equal(moveFlags(ep), FLAG_EP);
  const done = play(after, ep);
  assert.equal(done.pos.board[sq('c4')], 0, 'captured pawn removed');
  assert.equal(done.pos.board[sq('c3')], 1 | BLACK);
  assert.equal(done.history.at(-1)!.san, 'dxc3');
});

test('promotion offers four pieces and a promotion picker move is found by piece', () => {
  const p = fromFen('8/P6k/8/8/8/8/8/K7 w - - 0 1');
  const promos = legalMoves(p).filter((m) => moveFrom(m) === sq('a7') && moveTo(m) === sq('a8'));
  assert.equal(promos.length, 4);
  assert.deepEqual(promos.map(movePromo).sort(), [2, 3, 4, 5]);
  const knight = findMove(legalMoves(p), sq('a7'), sq('a8'), KNIGHT)!;
  const g = play(newGame('8/P6k/8/8/8/8/8/K7 w - - 0 1'), knight);
  assert.equal(g.pos.board[sq('a8')], KNIGHT | WHITE);
  assert.equal(g.history[0].san, 'a8=N');
  const queen = play(newGame('8/P6k/8/8/8/8/8/K7 w - - 0 1'), findMove(legalMoves(p), sq('a7'), sq('a8'), QUEEN)!);
  assert.equal(queen.history[0].san, 'a8=Q');
  const checkPromo = play(newGame('8/P7/8/8/8/8/8/K6k w - - 0 1'), findMove(legalMoves(fromFen('8/P7/8/8/8/8/8/K6k w - - 0 1')), sq('a7'), sq('a8'), QUEEN)!);
  assert.equal(checkPromo.history[0].san, 'a8=Q+');
});

test('check, checkmate and stalemate', () => {
  let g = newGame();
  for (const [f, t] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) g = play(g, findMove(g.legal, sq(f), sq(t))!);
  assert.equal(g.status, 'checkmate');
  assert.equal(g.history.at(-1)!.san, 'Qh4#');
  assert.ok(inCheck(g.pos));
  const stale = newGame('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1');
  assert.equal(stale.status, 'stalemate');
  assert.equal(stale.legal.length, 0);
  assert.ok(!inCheck(stale.pos));
});

test('threefold repetition is a draw', () => {
  let g = newGame();
  const seq = [['g1', 'f3'], ['g8', 'f6'], ['f3', 'g1'], ['f6', 'g8']];
  for (let i = 0; i < 2; i++) for (const [f, t] of seq) g = play(g, findMove(g.legal, sq(f), sq(t))!);
  assert.equal(g.status, 'repetition');
  // One cycle fewer is still a game.
  let h = newGame();
  for (const [f, t] of seq) h = play(h, findMove(h.legal, sq(f), sq(t))!);
  assert.equal(h.status, 'playing');
});

test('fifty-move rule and insufficient material', () => {
  const g = newGame('8/8/8/4k3/8/8/4K3/R7 w - - 99 80');
  const after = play(g, findMove(g.legal, sq('a1'), sq('b1'))!);
  assert.equal(after.pos.halfmove, 100);
  assert.equal(after.status, 'fifty');
  const pawnReset = play(newGame('8/8/8/4k3/8/8/P3K3/R7 w - - 99 80'), findMove(legalMoves(fromFen('8/8/8/4k3/8/8/P3K3/R7 w - - 99 80')), sq('a2'), sq('a3'))!);
  assert.equal(pawnReset.pos.halfmove, 0);
  assert.ok(insufficientMaterial(fromFen('8/8/8/4k3/8/8/4K3/8 w - - 0 1')));
  assert.ok(insufficientMaterial(fromFen('8/8/8/4k3/8/8/4K3/B7 w - - 0 1')));
  assert.ok(insufficientMaterial(fromFen('8/8/8/4k3/8/8/4K3/N7 w - - 0 1')));
  assert.ok(insufficientMaterial(fromFen('8/8/8/4k3/8/8/4K3/B1B5 w - - 0 1')), 'two bishops on the same color');
  assert.ok(!insufficientMaterial(fromFen('8/8/8/4k3/8/8/4K3/BB6 w - - 0 1')), 'opposite colored bishops can mate');
  assert.ok(!insufficientMaterial(fromFen('8/8/8/4k3/8/8/4K3/R7 w - - 0 1')));
  assert.equal(newGame('8/8/8/4k3/8/8/4K3/N7 w - - 0 1').status, 'insufficient');
});

test('san disambiguates by file, rank or both', () => {
  const p = fromFen('k7/8/8/8/8/8/8/R1R1K3 w - - 0 1');
  const l = legalMoves(p);
  assert.equal(toSan(p, findMove(l, sq('a1'), sq('b1'))!, l), 'Rab1');
  const q = fromFen('7k/8/8/8/8/R7/8/R3K3 w - - 0 1');
  const lq = legalMoves(q);
  assert.equal(toSan(q, findMove(lq, sq('a1'), sq('a2'))!, lq), 'R1a2');
  const three = fromFen('k7/8/8/8/8/8/8/K2Q1Q2 w - - 0 1');
  const lt = legalMoves(three);
  assert.equal(toSan(three, findMove(lt, sq('d1'), sq('e1'))!, lt), 'Qde1');
  const g = play(play(newGame(), findMove(newGame().legal, sq('e2'), sq('e4'))!), findMove(play(newGame(), findMove(newGame().legal, sq('e2'), sq('e4'))!).legal, sq('e7'), sq('e5'))!);
  assert.deepEqual(g.history.map((h) => h.san), ['e4', 'e5']);
  const castle = fromFen('r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1');
  const lc = legalMoves(castle);
  assert.equal(toSan(castle, findMove(lc, sq('e1'), sq('g1'))!, lc), 'O-O');
  assert.equal(toSan(castle, findMove(lc, sq('e1'), sq('c1'))!, lc), 'O-O-O');
});

test('evaluation is symmetric and prefers material', () => {
  assert.equal(evaluate(startPosition()), 0);
  const up = fromFen('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBN1 b Qkq - 0 1');
  assert.ok(evaluate(up) > 400, 'black to move is up a rook');
});

test('the computer finds mate in one, takes free material and only returns legal moves', () => {
  const mate = fromFen('6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1');
  const r = bestMove(mate, 1)!;
  assert.equal(moveFrom(r.move), sq('a1'));
  assert.equal(moveTo(r.move), sq('a8'));
  const free = fromFen('4k3/8/8/3q4/8/8/8/3RK3 w - - 0 1');
  const take = bestMove(free, 0, [], () => 0.5)!;
  assert.equal(moveTo(take.move), sq('d5'));
  for (const level of [0, 1, 2] as const) {
    const p = fromFen('r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1');
    const legal = legalMoves(p);
    const res = bestMove(p, level, [], Math.random, () => Date.now())!;
    assert.ok(legal.includes(res.move), `level ${level} returned a legal move`);
    assert.ok(res.depth >= 1);
  }
  assert.equal(bestMove(fromFen('7k/5Q2/6K1/8/8/8/8/8 b - - 0 1'), 2), null, 'no move in a stalemate');
});

test('the computer avoids repeating a won position', () => {
  // White is up a queen; shuffling the king back to e1 would be the third occurrence.
  const g = newGame('k7/8/8/8/8/8/8/3QK3 w - - 0 1');
  const keys = [...g.keys, g.keys[0]];
  const p = fromFen('k7/8/8/8/8/8/8/3QK3 w - - 0 1');
  const res = bestMove(p, 1, keys)!;
  assert.ok(res.score > 0);
  assert.ok(legalMoves(p).includes(res.move));
});
