import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  DINO_X,
  FLYER_SCORE,
  FLYER_Y,
  GRAVITY,
  JUMP_V,
  MAX_SPEED,
  START_SPEED,
  autopilot,
  collides,
  createState,
  gapFor,
  isNight,
  pickObstacle,
  rng32,
  speedAt,
  step,
  type Obstacle,
} from '../src/os/arcade/games/dino/logic.ts';

const idle = { jump: false, duck: false };
const run = (s: ReturnType<typeof createState>, secs: number, input = idle, rng = rng32(1)) => {
  for (let t = 0; t < secs; t += 1 / 60) step(s, 1 / 60, input, rng);
};
const flyer = (y: number, x = DINO_X): Obstacle => ({ kind: 'flyer', x, y, w: 46, h: 30, count: 1, seed: 1 });
const cactus = (x = DINO_X + 10): Obstacle => ({ kind: 'large', x, y: 0, w: 25, h: 50, count: 1, seed: 1 });

test('jump follows the arc and lands back on the ground', () => {
  const s = createState(600);
  const ev = step(s, 1 / 60, { jump: true, duck: false }, rng32(1));
  assert.ok(ev.jumped);
  let peak = 0;
  let landed = false;
  for (let i = 0; i < 120 && !landed; i++) {
    const e = step(s, 1 / 60, { jump: true, duck: false }, rng32(1));
    peak = Math.max(peak, s.y);
    landed = e.landed;
  }
  assert.ok(landed, 'lands');
  assert.ok(Math.abs(peak - (JUMP_V * JUMP_V) / (2 * GRAVITY)) < 4, `peak ${peak}`);
  assert.equal(s.y, 0);
  assert.ok(s.ground);
});

test('releasing jump early gives a shorter hop', () => {
  const full = createState(600);
  const hop = createState(600);
  step(full, 1 / 60, { jump: true, duck: false }, rng32(1));
  step(hop, 1 / 60, { jump: true, duck: false }, rng32(1));
  let a = 0;
  let b = 0;
  for (let i = 0; i < 60; i++) {
    step(full, 1 / 60, { jump: true, duck: false }, rng32(1));
    step(hop, 1 / 60, idle, rng32(1));
    a = Math.max(a, full.y);
    b = Math.max(b, hop.y);
  }
  assert.ok(b < a * 0.75 && b > 40, `hop ${b} vs full ${a}`);
});

test('holding down while airborne falls faster', () => {
  const a = createState(600);
  const b = createState(600);
  step(a, 1 / 60, { jump: true, duck: false }, rng32(1));
  step(b, 1 / 60, { jump: true, duck: false }, rng32(1));
  let ta = 0;
  let tb = 0;
  while (!a.ground) (step(a, 1 / 60, { jump: true, duck: false }, rng32(1)), ta++);
  while (!b.ground) (step(b, 1 / 60, { jump: false, duck: true }, rng32(1)), tb++);
  assert.ok(tb < ta, `${tb} < ${ta}`);
});

test('ducking only on the ground, and jump wins over duck', () => {
  const s = createState(600);
  step(s, 1 / 60, { jump: false, duck: true }, rng32(1));
  assert.ok(s.ducking);
  step(s, 1 / 60, { jump: true, duck: true }, rng32(1));
  assert.ok(!s.ground && !s.ducking);
});

test('collisions: cactus hits a grounded dino, a jumping dino clears it', () => {
  const s = createState(600);
  assert.ok(collides(s, cactus()));
  s.y = 60;
  assert.ok(!collides(s, cactus()));
});

test('flyer heights: low must be jumped, mid must be ducked, high clears a standing dino', () => {
  const s = createState(600);
  assert.ok(collides(s, flyer(FLYER_Y[0])));
  s.ducking = true;
  assert.ok(collides(s, flyer(FLYER_Y[0])), 'ducking does not dodge a low flyer');
  assert.ok(!collides(s, flyer(FLYER_Y[1])), 'ducking dodges a mid flyer');
  s.ducking = false;
  assert.ok(collides(s, flyer(FLYER_Y[1])), 'standing hits a mid flyer');
  assert.ok(!collides(s, flyer(FLYER_Y[2])), 'standing clears a high flyer');
});

test('crash ends the run and freezes the world', () => {
  const s = createState(600);
  s.obstacles.push(cactus(DINO_X + 60));
  let crashed = false;
  for (let i = 0; i < 60 && !crashed; i++) crashed = step(s, 1 / 60, idle, rng32(1)).crashed;
  assert.ok(crashed && s.dead);
  const d = s.distance;
  step(s, 1, idle, rng32(1));
  assert.equal(s.distance, d);
});

test('speed ramps from the start speed and caps', () => {
  assert.equal(speedAt(0), START_SPEED);
  assert.ok(speedAt(10) > speedAt(5));
  assert.equal(speedAt(10_000), MAX_SPEED);
});

test('score grows with distance, milestones fire every 100, night flips every 700', () => {
  const s = createState(600);
  s.next = Infinity;
  const marks: number[] = [];
  const nights: boolean[] = [];
  for (let i = 0; i < 60 * 200; i++) {
    const ev = step(s, 1 / 60, idle, rng32(1));
    if (ev.milestone) marks.push(ev.milestone);
    if (ev.night !== null) nights.push(ev.night);
    if (s.score >= 1500) break;
  }
  assert.deepEqual(marks.slice(0, 3), [100, 200, 300]);
  assert.deepEqual(nights, [true, false]);
  assert.equal(isNight(699), false);
  assert.equal(isNight(700), true);
  assert.equal(isNight(1400), false);
});

test('no flyers before the flyer score, never three of a kind in a row', () => {
  const s = createState(600);
  const rng = rng32(7);
  for (let i = 0; i < 400; i++) assert.notEqual(pickObstacle(s, rng).kind, 'flyer');
  s.score = FLYER_SCORE;
  s.speed = 600;
  const kinds: string[] = [];
  for (let i = 0; i < 400; i++) {
    const o = pickObstacle(s, rng);
    kinds.push(o.kind);
    s.lastKinds = [...s.lastKinds, o.kind].slice(-2);
  }
  assert.ok(kinds.includes('flyer'));
  for (let i = 2; i < kinds.length; i++) assert.ok(!(kinds[i] === kinds[i - 1] && kinds[i] === kinds[i - 2]), `run at ${i}`);
});

test('gaps leave room to land and jump again at any speed', () => {
  const air = (2 * JUMP_V) / GRAVITY;
  for (const v of [START_SPEED, 500, MAX_SPEED]) assert.ok(gapFor(v, 0, 0) > v * air + 40, `speed ${v}`);
});

test('every generated course is clearable: an autopilot survives three minutes on several seeds', () => {
  for (const seed of [1, 2, 3, 42, 1234]) {
    const s = createState(600);
    const rng = rng32(seed);
    for (let i = 0; i < 60 * 180 && !s.dead; i++) step(s, 1 / 60, autopilot(s), rng);
    assert.ok(!s.dead, `seed ${seed} crashed at score ${Math.floor(s.score)}`);
    assert.equal(s.speed, MAX_SPEED);
  }
});

test('obstacles leave the world once off screen', () => {
  const s = createState(600);
  s.obstacles.push({ ...cactus(-100) });
  step(s, 1 / 60, idle, rng32(1));
  assert.equal(s.obstacles.length, 0);
});
