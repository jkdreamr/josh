import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampOrigin, FACE_SLOP, followOrigin, hitButton, STICK, stickVector } from '../src/os/arcade/games/soccer/pad.ts';

test('phone stick ignores small thumb jitter inside the radial dead zone', () => {
  const inside = stickVector(STICK.deadZone * 50 * 0.9, 0, 50);
  assert.deepEqual(inside.move, { x: 0, z: 0 });
  assert.equal(inside.magnitude, 0);
  assert.ok(inside.knob.x > 0, 'the knob still follows the thumb visually');
  const diagonal = stickVector(4, 4, 50);
  assert.deepEqual(diagonal.move, { x: 0, z: 0 });
});

test('phone stick reaches full speed before the rim and keeps the thumb direction', () => {
  const full = stickVector(0, -50 * STICK.outerZone, 50);
  assert.equal(full.magnitude, 1);
  assert.deepEqual(full.move, { x: 0, z: -1 });
  const past = stickVector(300, 400, 50);
  assert.ok(Math.abs(Math.hypot(past.knob.x, past.knob.y) - 50) < 1e-9, 'knob clamps to max travel');
  assert.ok(Math.abs(past.move.x - 0.6) < 1e-9 && Math.abs(past.move.z - 0.8) < 1e-9);
});

test('phone stick response curve is monotonic and finer than linear at small deflections', () => {
  let last = 0;
  for (let px = 0; px <= 50; px += 1) {
    const { magnitude } = stickVector(px, 0, 50);
    assert.ok(magnitude >= last, `monotonic at ${px}px`);
    assert.ok(magnitude <= 1);
    last = magnitude;
  }
  const mid = (0.5 - STICK.deadZone) / (STICK.outerZone - STICK.deadZone);
  assert.ok(stickVector(25, 0, 50).magnitude < mid, 'half deflection is below the linear response');
  assert.deepEqual(stickVector(0, 0, 50).move, { x: 0, z: 0 });
  assert.deepEqual(stickVector(10, 0, 0).move, { x: 0, z: 0 });
});

test('matching thumb offsets produce matching movement vectors in portrait and landscape layouts', () => {
  const layouts = [
    { width: 390, height: 844, base: 136 },
    { width: 844, height: 390, base: 136 },
  ];
  const vectors = layouts.map(({ base }) => stickVector(22, -31, base * STICK.travel).move);
  const [portrait, landscape] = vectors;
  assert.deepEqual(portrait, landscape);
});

test('floating stick base recentres under the thumb but stays inside its zone', () => {
  assert.deepEqual(clampOrigin({ x: 200, y: 120 }, 400, 300, 60), { x: 200, y: 120 });
  assert.deepEqual(clampOrigin({ x: 5, y: 299 }, 400, 300, 60), { x: 60, y: 240 });
  assert.deepEqual(clampOrigin({ x: 5, y: 5 }, 100, 80, 60), { x: 50, y: 40 });
});

test('floating stick base follows a thumb that drifts past max travel', () => {
  assert.deepEqual(followOrigin({ x: 0, y: 0 }, { x: 30, y: 0 }, 40), { x: 0, y: 0 });
  const dragged = followOrigin({ x: 0, y: 0 }, { x: 100, y: 0 }, 40);
  assert.deepEqual(dragged, { x: 60, y: 0 });
  assert.equal(stickVector(100 - dragged.x, 0, 40).magnitude, 1);
});

test('face buttons hit the nearest button with slop and miss empty space', () => {
  const buttons = [
    { id: 'a', x: 100, y: 160, r: 30 },
    { id: 'b', x: 160, y: 100, r: 30 },
    { id: 'x', x: 40, y: 100, r: 30 },
    { id: 'y', x: 100, y: 40, r: 30 },
  ] as const;
  assert.equal(hitButton({ x: 100, y: 160 }, buttons), 'a');
  assert.equal(hitButton({ x: 100, y: 160 + 30 * (FACE_SLOP - 0.05) }, buttons), 'a', 'just outside the drawn edge still counts');
  assert.equal(hitButton({ x: 125, y: 140 }, buttons), 'a', 'between A and B, nearer A');
  assert.equal(hitButton({ x: 140, y: 120 }, buttons), 'b');
  assert.equal(hitButton({ x: 400, y: 400 }, buttons), null);
  assert.equal(hitButton({ x: 100, y: 100 }, [], 2), null);
});
