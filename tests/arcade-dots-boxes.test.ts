import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chainValue, chooseMove, geo, isGame, leaders, lineAt, lineEnds, mulberry, newGame, play, safeCount, stepCursor, type Game, type Level } from '../src/os/arcade/games/dots-boxes/dots.ts';

const must = (g: Game, l: number) => {
  const r = play(g, l);
  assert.ok(r, `line ${l} should be legal`);
  return r;
};
/** Line ids for box (r, c): top, bottom, left, right. */
const sides = (g: Game, r: number, c: number) => {
  const G = geo(g.rows, g.cols);
  return Array.from(G.boxLines.slice((r * g.cols + c) * 4, (r * g.cols + c) * 4 + 4));
};
const withLines = (rows: number, cols: number, lines: number[]): Game => {
  const g = newGame(rows, cols, 2);
  for (const l of lines) g.lines[l] = 1;
  return g;
};

test('geometry counts lines and boxes', () => {
  const G = geo(3, 4);
  assert.equal(G.lines, 4 * 4 + 3 * 5);
  assert.equal(G.boxes, 12);
  for (let b = 0; b < G.boxes; b++)
    for (let s = 0; s < 4; s++) {
      const l = G.boxLines[b * 4 + s];
      assert.ok(G.lineBoxes[l * 2] === b || G.lineBoxes[l * 2 + 1] === b);
    }
  assert.deepEqual(lineEnds(G, 0), [0, 0, 1, 0]);
  assert.deepEqual(lineEnds(G, G.h), [0, 0, 0, 1]);
});

test('drawing a line passes the turn, a duplicate is rejected', () => {
  const g = newGame(3, 3, 2);
  const r = must(g, 0);
  assert.equal(r.game.turn, 1);
  assert.equal(r.game.lines[0], 1);
  assert.equal(play(r.game, 0), null);
  assert.equal(play(r.game, -1), null);
  assert.equal(play(r.game, 999), null);
  assert.equal(play(r.game, 1.5), null);
  assert.equal(g.lines[0], 0, 'play never mutates the old game');
});

test('closing a box scores and keeps the turn, two at once score two', () => {
  let g = newGame(1, 2, 2);
  const [t, b, l] = sides(g, 0, 0);
  const [t2, b2, , r2] = sides(g, 0, 1);
  for (const x of [t, b, l, t2, b2, r2]) g = must(g, x).game;
  const turn = g.turn;
  const shared = sides(g, 0, 0)[3];
  const r = must(g, shared);
  assert.deepEqual(r.completed.sort(), [0, 1]);
  assert.equal(r.game.scores[turn], 2);
  assert.equal(r.game.turn, turn);
  assert.ok(r.game.over);
  assert.deepEqual(leaders(r.game), [turn]);
  assert.equal(play(r.game, 0), null);
});

test('turns rotate through four players', () => {
  let g = newGame(3, 3, 4, 2);
  const seen: number[] = [];
  for (const l of [0, 5, 10, 20, 15]) {
    seen.push(g.turn);
    g = must(g, l).game;
  }
  assert.deepEqual(seen, [2, 3, 0, 1, 2]);
});

test('a ball of lines always finishes with every box owned', () => {
  const rng = mulberry(7);
  let g = newGame(4, 4, 3);
  while (!g.over) {
    const open = g.lines.flatMap((v, i) => (v ? [] : [i]));
    g = must(g, open[Math.floor(rng() * open.length)]).game;
  }
  assert.equal(g.scores.reduce((a, b) => a + b, 0), 16);
  assert.ok(g.boxes.every((o) => o >= 0));
});

test('tapping near a line finds it, far away finds nothing', () => {
  const g = newGame(3, 3, 2);
  const G = geo(3, 3);
  assert.equal(lineAt(G, g.lines, 0.5, 0.1), 0);
  assert.equal(lineAt(G, g.lines, 0.05, 0.5), G.h);
  assert.equal(lineAt(G, g.lines, 0.5, 0.5, 0.3), -1);
  g.lines[0] = 1;
  assert.notEqual(lineAt(G, g.lines, 0.5, 0.1), 0);
  const mid = (l: number) => lineEnds(G, l)[0] + lineEnds(G, l)[2];
  assert.ok(mid(stepCursor(G, 0, 1, 0)) > mid(0));
  assert.equal(stepCursor(G, G.h, -1, 0), G.h, 'nothing further left');
  assert.equal(stepCursor(G, 2, -1, 0), G.h + 2);
});

test('isGame checks packets from the network', () => {
  assert.ok(isGame(newGame(4, 4, 3)));
  assert.ok(!isGame(null));
  assert.ok(!isGame({ ...newGame(4, 4, 2), lines: [1, 2] }));
  assert.ok(!isGame({ ...newGame(4, 4, 2), rows: 40 }));
  assert.ok(!isGame({ ...newGame(4, 4, 2), turn: 9 }));
});

test('chain values: one long chain is all theirs, two need a double cross', () => {
  assert.equal(chainValue([{ loop: false, n: 3 }]), -3);
  assert.equal(chainValue([{ loop: false, n: 2 }]), -2);
  // opener gives a three-chain, the capturer keeps control and takes the last four
  assert.equal(chainValue([{ loop: false, n: 3 }, { loop: false, n: 4 }]), -3);
  // opening the four-loop first costs one box less than opening the three-chain
  assert.equal(chainValue([{ loop: true, n: 4 }, { loop: false, n: 3 }]), -1);
  assert.equal(chainValue([{ loop: false, n: 1 }, { loop: false, n: 1 }]), 0);
});

test('every level only plays legal lines through a whole game', () => {
  for (const level of [0, 1, 2] as Level[]) {
    const rng = mulberry(level + 11);
    let g = newGame(3, 3, 2);
    while (!g.over) {
      const l = chooseMove(g, level, rng, 60);
      assert.equal(g.lines[l], 0, `level ${level} picked a drawn line`);
      g = must(g, l).game;
    }
  }
});

test('normal and hard take a free box and never hand one over while a safe line is left', () => {
  // box 0 has three sides: take it
  const g = withLines(3, 3, [0, 3, 12]);
  for (const level of [1, 2] as Level[]) assert.equal(chooseMove(g, level, mulberry(1), 60), 13);
  // box (1,1) has two sides; drawing a third would give it away
  const t = withLines(3, 3, sides(newGame(3, 3, 2), 1, 1).slice(0, 2));
  const danger = sides(t, 1, 1).slice(2);
  assert.ok(safeCount(t) > 0);
  for (let i = 0; i < 20; i++) for (const level of [1, 2] as Level[]) assert.ok(!danger.includes(chooseMove(t, level, mulberry(i), 60)));
});

test('hard double crosses: it leaves the last two boxes of a chain to keep control', () => {
  // a 2x3 board with every horizontal line drawn is two three-chains, open to the edge at both ends
  const G = geo(2, 3);
  const g = withLines(2, 3, Array.from({ length: G.h }, (_, l) => l));
  assert.equal(safeCount(g), 0);
  // the opener gives away the top chain from its left end
  const opened = must(g, G.h).game;
  const me = opened.turn;
  const take = chooseMove(opened, 2, mulberry(3), 200);
  assert.equal(take, G.h + 1, 'hard takes the first box');
  const s = must(opened, take).game;
  assert.equal(s.boxes[0], me);
  const r = must(s, chooseMove(s, 2, mulberry(3), 200));
  assert.equal(r.completed.length, 0, 'hard declines the last two boxes');
  assert.equal(r.game.last, G.h + 3, 'by drawing the far end of the chain');
});

test('hard beats normal and normal beats easy', () => {
  const match = (a: Level, b: Level, seed: number) => {
    const rng = mulberry(seed);
    let g = newGame(3, 3, 2, seed % 2);
    while (!g.over) g = must(g, chooseMove(g, g.turn === 0 ? a : b, rng, 80)).game;
    return Math.sign(g.scores[0] - g.scores[1]);
  };
  let hard = 0;
  let normal = 0;
  for (let i = 0; i < 8; i++) {
    hard += match(2, 1, i + 1);
    normal += match(1, 0, i + 1);
  }
  assert.ok(hard >= 6, `hard won ${hard}`);
  assert.ok(normal >= 4, `normal won ${normal}`);
});

test('hard answers within a second on the biggest grid', () => {
  const rng = mulberry(5);
  let g = newGame(6, 6, 2);
  let worst = 0;
  while (!g.over) {
    const t = performance.now();
    const l = chooseMove(g, 2, rng, 450);
    worst = Math.max(worst, performance.now() - t);
    g = must(g, l).game;
  }
  assert.ok(worst < 1000, `slowest move ${worst.toFixed(0)}ms`);
});
