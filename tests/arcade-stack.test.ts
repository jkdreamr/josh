import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BASE, PERFECT_TOL, RANGE, create, drop, hueFor, place, speedFor, step, towerTop } from '../src/os/arcade/games/stack/logic.ts';

const base = { x: 0, z: 0, w: BASE, d: BASE };

test('a flush drop is perfect and snaps to the slab below', () => {
  const r = place({ ...base, x: PERFECT_TOL * 0.9 }, base, 'x');
  assert.equal(r.kind, 'perfect');
  if (r.kind === 'perfect') {
    assert.equal(r.slab.x, 0);
    assert.equal(r.slab.w, BASE);
    assert.equal(r.cuts.length, 0);
  }
});

test('an offset drop keeps the overlap and cuts the overhang', () => {
  const r = place({ ...base, x: 1 }, base, 'x');
  assert.equal(r.kind, 'cut');
  if (r.kind === 'cut') {
    assert.ok(Math.abs(r.slab.w - 2) < 1e-9);
    assert.ok(Math.abs(r.slab.x - 0.5) < 1e-9);
    assert.equal(r.cuts.length, 1);
    assert.ok(Math.abs(r.cuts[0].w - 1) < 1e-9);
    assert.ok(Math.abs(r.cuts[0].x - 2) < 1e-9);
    assert.equal(r.slab.d, BASE, 'the other axis is untouched');
  }
});

test('slicing works on the z axis too', () => {
  const r = place({ ...base, z: -0.8 }, base, 'z');
  assert.equal(r.kind, 'cut');
  if (r.kind === 'cut') {
    assert.ok(Math.abs(r.slab.d - 2.2) < 1e-9);
    assert.ok(Math.abs(r.cuts[0].z - (-1.9)) < 1e-9);
  }
});

test('no overlap is a miss', () => {
  const r = place({ ...base, x: BASE + 0.1 }, base, 'x');
  assert.equal(r.kind, 'miss');
  assert.equal(r.cuts.length, 1);
});

test('a bigger slab dropped off center loses pieces on both sides', () => {
  const r = place({ x: 0.5, z: 0, w: BASE, d: BASE }, { x: 0, z: 0, w: 1.5, d: BASE }, 'x');
  assert.equal(r.kind, 'cut');
  if (r.kind === 'cut') {
    assert.equal(r.cuts.length, 2);
    assert.ok(Math.abs(r.slab.w - 1.5) < 1e-9);
    assert.ok(Math.abs(r.cuts[0].w - 0.25) < 1e-9 && Math.abs(r.cuts[1].w - 1.25) < 1e-9);
  }
});

test('the moving slab bounces between -RANGE and RANGE', () => {
  const s = create();
  for (let i = 0; i < 400; i++) {
    step(s, 1 / 60);
    assert.ok(s.pos >= -RANGE - 1e-9 && s.pos <= RANGE + 1e-9);
  }
  assert.equal(s.moving.x, s.pos);
});

test('drops alternate axes, raise the tower and speed up', () => {
  const s = create();
  s.moving.x = 0;
  const a = drop(s);
  assert.equal(a.result.kind, 'perfect');
  assert.equal(s.score, 1);
  assert.equal(s.axis, 'z');
  assert.equal(s.stack.length, 2);
  assert.ok(Math.abs(towerTop(s) - 1) < 1e-9);
  assert.ok(s.speed > speedFor(0));
  s.moving.z = 0.7;
  const b = drop(s);
  assert.equal(b.result.kind, 'cut');
  assert.equal(s.streak, 0);
  assert.equal(s.axis, 'x');
});

test('three perfects in a row grow the slab back', () => {
  const s = create();
  s.moving.x = 0.6;
  drop(s);
  const shrunk = s.stack[1].w;
  assert.ok(shrunk < BASE);
  let grew = false;
  for (let i = 0; i < 3; i++) {
    s.moving.x = s.stack[s.stack.length - 1].x;
    s.moving.z = s.stack[s.stack.length - 1].z;
    grew = drop(s).grew;
  }
  assert.ok(grew);
  assert.equal(s.streak, 3);
  const top = s.moving;
  assert.ok(top.w > shrunk || top.d > shrunk, 'the next slab is bigger');
});

test('a miss ends the game and keeps the score', () => {
  const s = create();
  s.moving.x = 0;
  drop(s);
  s.moving.z = 10;
  const r = drop(s);
  assert.equal(r.result.kind, 'miss');
  assert.ok(s.over);
  assert.equal(s.score, 1);
  const before = s.pos;
  step(s, 0.1);
  assert.equal(s.pos, before, 'nothing moves after game over');
});

test('speed is capped and hues wrap', () => {
  assert.equal(speedFor(1000), 6.5);
  assert.ok(hueFor(100, 300) < 360);
});
