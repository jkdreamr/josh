import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bestMove } from '../src/os/arcade/games/chess/ai.ts';
import { BLACK, WHITE, QUEEN, findMove, moveCaptured, moveFrom, moveTo, newGame, parseSquare, pieces, play, toFen, type Game } from '../src/os/arcade/games/chess/engine.ts';
import { PieceDrag, boardPoint, columnOf, initialIds, nextIds, pieceTransform, rowOf, squareAtPoint, type BoardQuad, type Point } from '../src/os/arcade/games/chess/interaction.ts';

const sq = parseSquare;
const near = (actual: Point | null, expected: Point) => {
  assert.ok(actual);
  assert.ok(Math.abs(actual.x - expected.x) < 1e-8, `${actual.x} vs ${expected.x}`);
  assert.ok(Math.abs(actual.y - expected.y) < 1e-8, `${actual.y} vs ${expected.y}`);
};

test('board coordinates invert translation, CSS3D scale, perspective and rotation', () => {
  const transforms = [
    (p: Point) => ({ x: 250 + p.x * 320, y: 110 + p.y * 320 }),
    (p: Point) => ({ x: 500 + p.x * 156, y: 240 + p.y * 156 }),
    (p: Point) => ({ x: (300 + 420 * p.x + 25 * p.y) / (1 + 0.2 * p.x + 0.1 * p.y), y: (200 + 40 * p.x + 350 * p.y) / (1 + 0.2 * p.x + 0.1 * p.y) }),
    (p: Point) => ({ x: 700 - 70 * p.x - 310 * p.y, y: 230 + 310 * p.x - 70 * p.y }),
  ];
  for (const project of transforms) {
    const quad = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }].map(project) as unknown as BoardQuad;
    for (const flipped of [false, true]) {
      for (const [square] of pieces(newGame().pos)) {
        const local = { x: (columnOf(square, flipped) + 0.5) / 8, y: (rowOf(square, flipped) + 0.5) / 8 };
        const mapped = boardPoint(project(local), quad);
        near(mapped, local);
        assert.equal(squareAtPoint(mapped, flipped), square);
      }
      near(boardPoint(project({ x: -0.1, y: 1.2 }), quad), { x: -0.1, y: 1.2 });
    }
  }
});

test('off-board release and degenerate/hidden boards cannot name a legal square', () => {
  for (const point of [null, { x: -0.001, y: 0.5 }, { x: 1, y: 0.5 }, { x: 0.5, y: -0.001 }, { x: 0.5, y: 1 }]) {
    assert.equal(squareAtPoint(point, false), -1);
    assert.equal(squareAtPoint(point, true), -1);
  }
  assert.equal(boardPoint({ x: 2, y: 3 }, [{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 0 }]), null);
});

test('click/hover/release retains every home transform, including a1 and h8', () => {
  const drag = new PieceDrag();
  for (const [square] of pieces(newGame().pos)) {
    const home = pieceTransform(square, false, 320, null);
    assert.ok(home.length > 0);
    assert.ok(drag.begin(1, square, { x: 100, y: 100 }));
    assert.equal(drag.move(1, { x: 102, y: 101 }, { x: 0.6, y: 0.8 }), null);
    assert.equal(drag.end(1)?.moved, false);
    assert.equal(pieceTransform(square, false, 320, null), home);
  }
});

test('drag threshold uses actual pointer-down in client pixels, not local square center', () => {
  const drag = new PieceDrag();
  drag.begin(7, sq('e2'), { x: 800, y: 430 });
  assert.equal(drag.move(7, { x: 803, y: 432 }, { x: 0.6, y: 0.8 }), null);
  const view = drag.move(7, { x: 806, y: 430 }, { x: 0.6, y: 0.7 });
  assert.ok(view);
  assert.equal(pieceTransform(sq('e2'), false, 320, view), 'translate(172px, 204px) scale(1.12)');
  assert.equal(pieceTransform(sq('d2'), false, 320, view), 'translate(300%, 600%)');
  assert.equal(drag.end(7)?.moved, true);
  assert.equal(pieceTransform(sq('e2'), false, 320, null), 'translate(400%, 600%)');
});

test('illegal/outside drops and all cancellation paths restore the home square without changing the game', () => {
  const g = newGame();
  const before = toFen(g.pos);
  for (const reason of ['illegal drop', 'outside drop', 'pointercancel', 'lostpointercapture', 'pause', 'inactive', 'flip', 'resize', 'restart', 'unmount', 'promotion']) {
    const drag = new PieceDrag();
    drag.begin(1, sq('e2'), { x: 10, y: 10 });
    assert.ok(drag.move(1, { x: 30, y: 30 }, { x: 0.7, y: 0.5 }));
    assert.ok(drag.cancel(), reason);
    assert.equal(drag.current, null, reason);
    assert.equal(drag.end(1), null, 'stale up after cancellation ignored');
    assert.equal(pieceTransform(sq('e2'), false, 320, null), 'translate(400%, 600%)');
    assert.equal(toFen(g.pos), before);
  }
  assert.equal(findMove(g.legal, sq('e2'), sq('e5')), undefined);
});

test('rapid and multiple pointers cannot replace or finish the active drag', () => {
  const drag = new PieceDrag();
  assert.ok(drag.begin(1, sq('e2'), { x: 0, y: 0 }));
  assert.equal(drag.begin(2, sq('d2'), { x: 0, y: 0 }), false);
  assert.equal(drag.move(2, { x: 50, y: 50 }, { x: 0.5, y: 0.5 }), null);
  assert.equal(drag.end(2), null);
  assert.equal(drag.end(1)?.from, sq('e2'));
  assert.equal(drag.end(1), null);
  assert.ok(drag.begin(2, sq('d2'), { x: 0, y: 0 }));
  assert.equal(drag.cancel()?.pid, 2);
});

function tracked(fen?: string) {
  let game = newGame(fen);
  let ids = initialIds(game.pos);
  const move = (m: number) => {
    assert.ok(game.legal.includes(m));
    const fromId = ids.get(moveFrom(m));
    ids = nextIds(ids, game.pos, m);
    game = play(game, m);
    assert.equal(ids.get(moveTo(m)), fromId, 'moving/promotion piece identity preserved');
    assert.equal(new Set(ids.values()).size, ids.size, 'no duplicate piece identity');
    assert.deepEqual([...ids.keys()].sort((a, b) => a - b), pieces(game.pos).map(([s]) => s).sort((a, b) => a - b));
    for (const [s] of pieces(game.pos)) assert.ok(pieceTransform(s, false, 320, null));
    return game;
  };
  return { get game() { return game; }, get ids() { return ids; }, move, human: (from: string, to: string, promo = 0) => {
    const m = findMove(game.legal, sq(from), sq(to), promo);
    assert.notEqual(m, undefined, `${from}${to} must be legal`);
    return move(m!);
  } };
}

test('local two-player opening supports captures and castles for both players with stable identities', () => {
  const match = tracked();
  for (const [from, to] of [['e2', 'e4'], ['e7', 'e5'], ['g1', 'f3'], ['b8', 'c6'], ['f1', 'c4'], ['g8', 'f6'], ['e1', 'g1'], ['f8', 'c5'], ['d2', 'd3'], ['e8', 'g8'], ['c1', 'g5'], ['d7', 'd6'], ['g5', 'f6'], ['d8', 'f6']]) match.human(from, to);
  assert.ok(match.game.history.some((h) => h.san === 'O-O'));
  assert.equal(match.ids.size, 30);
  assert.equal(match.game.pos.turn, WHITE);
});

test('en passant removes only the captured identity and promotion keeps the pawn identity', () => {
  const ep = tracked('rnbqkbnr/ppp1pppp/8/8/3pP3/8/PPP2PPP/RNBQKBNR w KQkq - 0 3');
  ep.human('c2', 'c4');
  const captured = ep.ids.get(sq('c4'));
  ep.human('d4', 'c3');
  assert.ok(![...ep.ids.values()].includes(captured!));
  for (const [fen, from, to] of [['7k/P7/8/8/8/8/8/K7 w - - 0 1', 'a7', 'a8'], ['7k/8/8/8/8/8/p7/7K b - - 0 1', 'a2', 'a1']]) {
    const match = tracked(fen);
    const id = match.ids.get(sq(from));
    match.human(from, to, QUEEN);
    assert.equal(match.ids.get(sq(to)), id);
  }
});

for (const human of [WHITE, BLACK]) {
  test(`a human playing ${human === WHITE ? 'white' : 'black'} can alternate legal moves with the computer`, () => {
    const match = tracked();
    let humanMoves = 0;
    let cpuMoves = 0;
    for (let ply = 0; ply < 24 && match.game.status === 'playing'; ply++) {
      const g = match.game;
      if (g.pos.turn === human) {
        const ranked = [...g.legal].sort((a, b) => moveCaptured(b) - moveCaptured(a));
        match.move(ranked[0]);
        humanMoves++;
      } else {
        const before = toFen(g.pos);
        const reply = bestMove(g.pos, 0, g.keys, () => 0.5)!;
        assert.equal(toFen(g.pos), before, 'search must not mutate the displayed game');
        match.move(reply.move);
        cpuMoves++;
      }
    }
    assert.ok(humanMoves >= 3 && cpuMoves >= 3);
  });
}

test('computer and two-human games reach checkmate without losing surviving identities', () => {
  const local = tracked();
  for (const [from, to] of [['f2', 'f3'], ['e7', 'e5'], ['g2', 'g4'], ['d8', 'h4']]) local.human(from, to);
  assert.equal(local.game.status, 'checkmate');
  assert.equal(local.ids.size, 32);
  for (const fen of ['6k1/5ppp/8/8/8/8/8/R5K1 w - - 0 1', 'r5k1/8/8/8/8/8/5PPP/6K1 b - - 0 1']) {
    const cpu = tracked(fen);
    const reply = bestMove(cpu.game.pos, 1, cpu.game.keys)!;
    cpu.move(reply.move);
    assert.equal(cpu.game.status, 'checkmate');
  }
});
