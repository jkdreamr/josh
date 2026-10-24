import assert from 'node:assert/strict';
import { test } from 'node:test';
import { apply, create, faceTurn, fmtTime, inferTurn, inverse, isSolved, notation, quarter, mulVec, scramble, seeded, sliceTurn, frameNotation, frameTurn, tick, undo, viewFrame, type Face } from '../src/os/arcade/games/cube/logic.ts';

const seq = (cube: ReturnType<typeof create>, s: string) => {
  for (const tok of s.trim().split(/\s+/)) apply(cube, faceTurn(tok[0] as Face, tok.endsWith("'")));
};

test('a fresh cube is solved and has 26 cubies', () => {
  const c = create();
  assert.equal(c.cubies.length, 26);
  assert.ok(isSolved(c));
});

test('quarter turns rotate vectors by the right hand rule', () => {
  assert.deepEqual(mulVec(quarter(1, 1), [1, 0, 0]), [0, 0, -1]);
  assert.deepEqual(mulVec(quarter(0, 1), [0, 1, 0]), [0, 0, 1]);
  assert.deepEqual(mulVec(quarter(2, 1), [1, 0, 0]), [0, 1, 0]);
});

test('one face turn leaves the cube unsolved and moves exactly nine cubies', () => {
  const c = create();
  apply(c, faceTurn('R'));
  assert.ok(!isSolved(c));
  const moved = c.cubies.filter((k) => k.pos.join() !== k.home.join()).length;
  assert.equal(moved, 8, 'eight cubies move, the R centre stays put');
});

test('a turn and its inverse cancel, and four quarter turns are a full turn', () => {
  const c = create();
  apply(c, faceTurn('U'));
  apply(c, inverse(faceTurn('U')));
  assert.ok(isSolved(c));
  seq(c, 'F F F F');
  assert.ok(isSolved(c));
});

test("R U R' U' repeated six times returns to solved", () => {
  const c = create();
  for (let i = 0; i < 6; i++) seq(c, "R U R' U'");
  assert.ok(isSolved(c));
  for (let i = 0; i < 5; i++) seq(c, "R U R' U'");
  assert.ok(!isSolved(c));
});

test('notation round trips for faces and primes', () => {
  for (const f of ['U', 'D', 'L', 'R', 'F', 'B'] as Face[]) {
    assert.equal(notation(faceTurn(f)), f);
    assert.equal(notation(faceTurn(f, true)), `${f}'`);
  }
  assert.equal(notation({ axis: 0, layer: 0, dir: faceTurn('L').dir }), 'M');
});

test('undo walks the history back and counts as moves', () => {
  const c = create();
  seq(c, "R U F'");
  assert.equal(c.history.length, 3);
  assert.equal(c.moves, 3);
  undo(c);
  undo(c);
  undo(c);
  assert.ok(isSolved(c));
  assert.equal(c.history.length, 0);
  assert.equal(c.moves, 6);
  assert.equal(undo(c), null);
});

test('scramble is deterministic for a seeded rng, never solved, and clears history', () => {
  let seed = 7;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const a = create();
  const turns = scramble(a, 22, rng);
  assert.equal(turns.length, 22);
  assert.ok(!a.solved);
  assert.equal(a.history.length, 0);
  assert.equal(a.moves, 0);
  assert.ok(a.scrambled);
  for (let i = 1; i < turns.length; i++) assert.notEqual(turns[i].axis, turns[i - 1].axis);
  // undoing the scramble by hand solves it
  for (let i = turns.length - 1; i >= 0; i--) apply(a, inverse(turns[i]));
  assert.ok(a.solved);
});

test('the timer runs from the first turn after a scramble until solved', () => {
  let seed = 3;
  const rng = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const c = create();
  const turns = scramble(c, 5, rng);
  tick(c, 500);
  assert.equal(c.time, 0, 'not started yet');
  apply(c, inverse(turns[4]));
  tick(c, 1000);
  assert.equal(c.time, 1000);
  for (let i = 3; i >= 0; i--) apply(c, inverse(turns[i]));
  assert.ok(c.solved);
  assert.ok(!c.timing);
  tick(c, 1000);
  assert.equal(c.time, 1000);
});

test('inferTurn reads layer turns from a drag across a face', () => {
  // dragging right across the top row of the front face spins the top layer counter clockwise (U prime)
  const t = inferTurn([0, 0, 1], [1, 0, 0], [0, 1, 1]);
  assert.ok(t);
  assert.equal(notation(t!), "U'");
  // dragging up on the right column of the front face is R
  const r = inferTurn([0, 0, 1], [0, 1, 0], [1, 0, 1]);
  assert.equal(notation(r!), 'R');
  // on the middle column it is a slice
  const m = inferTurn([0, 0, 1], [0, 1, 0], [0, 0, 1]);
  assert.equal(m!.layer, 0);
  assert.equal(m!.axis, 0);
  // drags along the normal or of zero length are ignored
  assert.equal(inferTurn([0, 0, 1], [0, 0, 1], [0, 0, 1]), null);
  assert.equal(inferTurn([0, 0, 1], [0, 0, 0], [0, 0, 1]), null);
  // noisy drag still snaps
  const n = inferTurn([0, 1, 0], [0.9, 0.05, 0.3], [1, 1, 1]);
  assert.equal(notation(n!), 'F');
});

test('time formatting', () => {
  assert.equal(fmtTime(0), '0.00');
  assert.equal(fmtTime(12345), '12.34');
  assert.equal(fmtTime(61230), '1:01.23');
});

test('seeded scrambles match for the same seed and differ for another', () => {
  const a = scramble(create(), 22, seeded(1234));
  const b = scramble(create(), 22, seeded(1234));
  const c = scramble(create(), 22, seeded(99));
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('keys follow the view: the default view matches standard notation', () => {
  const f = viewFrame(-0.62);
  for (const face of ['U', 'D', 'L', 'R', 'F', 'B'] as Face[]) {
    assert.deepEqual(frameTurn(f, face), faceTurn(face, false));
    assert.deepEqual(frameTurn(f, face, true), faceTurn(face, true));
    assert.equal(frameNotation(f, faceTurn(face, false)), face);
    assert.equal(frameNotation(f, faceTurn(face, true)), `${face}'`);
  }
});

test('after a quarter orbit, F is the side now facing the viewer', () => {
  // turning the rig by -90 degrees brings the cube's right side to the front
  const f = viewFrame(-0.62 - Math.PI / 2);
  assert.deepEqual(f.F, { axis: 0, layer: 1 });
  assert.deepEqual(f.U, { axis: 1, layer: 1 });
  const c = create();
  apply(c, frameTurn(f, 'F'));
  apply(c, faceTurn('R', true));
  assert.ok(isSolved(c));
});

test('slice turns move the middle layer the same way as their reference face', () => {
  const f = viewFrame(-0.62);
  const m = sliceTurn(f, 'M');
  assert.equal(m.layer, 0);
  assert.equal(m.axis, 0);
  assert.equal(m.dir, faceTurn('L', false).dir);
  assert.equal(sliceTurn(f, 'E').dir, faceTurn('D', false).dir);
  assert.equal(sliceTurn(f, 'S', true).dir, faceTurn('F', true).dir);
  assert.equal(frameNotation(f, m), 'M');
  assert.equal(frameNotation(f, sliceTurn(f, 'S', true)), "S'");
  assert.equal(frameNotation(f, faceTurn('U', false), 2), 'U2');
  const c = create();
  for (let i = 0; i < 4; i++) apply(c, m);
  assert.ok(isSolved(c));
});
