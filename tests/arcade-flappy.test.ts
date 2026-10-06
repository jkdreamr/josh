import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CEIL,
  COL_W,
  FLAP_V,
  GAP_MIN,
  GAP_START,
  GRAVITY,
  GROUND,
  MARGIN,
  MAX_FALL,
  MAX_SHIFT,
  MAX_SPEED,
  R,
  SPACING,
  START_SPEED,
  autopilot,
  createState,
  flap,
  gapFor,
  hitRect,
  hitsColumn,
  medalFor,
  nextGapY,
  nextMedal,
  rng32,
  speedFor,
  step,
  type State,
} from '../src/os/arcade/games/flappy/logic.ts';

const idle = { flap: false };
const run = (s: State, seconds: number, rng = rng32(1), input = idle) => {
  const out = { scored: 0, crashed: 0, landed: 0 };
  for (let t = 0; t < seconds; t += 1 / 60) {
    const ev = step(s, 1 / 60, input, rng);
    out.scored += ev.scored;
    out.crashed += ev.crashed ? 1 : 0;
    out.landed += ev.landed ? 1 : 0;
  }
  return out;
};

test('medals unlock at 10, 20, 30 and 40 columns', () => {
  assert.equal(medalFor(0), 'none');
  assert.equal(medalFor(9), 'none');
  assert.equal(medalFor(10), 'bronze');
  assert.equal(medalFor(19), 'bronze');
  assert.equal(medalFor(20), 'silver');
  assert.equal(medalFor(30), 'gold');
  assert.equal(medalFor(40), 'platinum');
  assert.equal(medalFor(400), 'platinum');
  assert.equal(nextMedal(0), 10);
  assert.equal(nextMedal(10), 20);
  assert.equal(nextMedal(39), 40);
  assert.equal(nextMedal(40), null);
});

test('a flap kicks the tree upward and gravity brings it back down', () => {
  const s = createState(400);
  const y0 = s.y;
  const ev = step(s, 1 / 60, { flap: true }, rng32(2));
  assert.equal(ev.flapped, true);
  assert.ok(s.vy < 0 && s.vy > FLAP_V, 'moving up, already slowed by gravity');
  run(s, 0.12);
  assert.ok(s.y < y0, 'rose above the start');
  run(s, 0.4);
  assert.ok(s.vy > 0, 'falling again');
});

test('fall speed is capped', () => {
  const s = createState(400);
  s.y = -30;
  s.cols = [];
  for (let i = 0; i < 40; i++) {
    step(s, 1 / 60, idle, () => 0.5);
    s.cols = [];
    assert.ok(s.vy <= MAX_FALL + 1e-9);
  }
});

test('the tree cannot fly off the top of the screen', () => {
  const s = createState(400);
  for (let i = 0; i < 120; i++) {
    step(s, 1 / 60, { flap: i % 4 === 0 }, () => 0.5);
    s.cols = [];
    assert.ok(s.y >= CEIL);
  }
});

test('touching the ground ends the run exactly once', () => {
  const s = createState(400);
  const out = run(s, 3);
  assert.equal(out.crashed, 1);
  assert.equal(out.landed, 1);
  assert.equal(s.dead, true);
  assert.equal(s.y, GROUND - R);
  assert.equal(flap(s), false, 'dead trees do not flap');
  assert.equal(step(s, 1 / 60, { flap: true }, rng32(1)).flapped, false);
});

test('passing a column scores one point', () => {
  const s = createState(400);
  s.cols = [{ x: s.birdX - COL_W / 2 + 2, gapY: s.y, gap: 200, passed: false }];
  const ev = step(s, 1 / 30, idle, () => 0.5);
  assert.equal(ev.scored, 1);
  assert.equal(s.score, 1);
  const again = step(s, 1 / 30, idle, () => 0.5);
  assert.equal(again.scored, 0);
  assert.equal(s.score, 1);
});

test('the middle of the gap is safe, the lips are not', () => {
  const s = createState(400);
  const c = { x: s.birdX - COL_W / 2, gapY: 260, gap: 160, passed: false };
  s.y = 260;
  assert.equal(hitsColumn(s, c), false);
  s.y = 260 - 80 + R - 2;
  assert.equal(hitsColumn(s, c), true);
  s.y = 260 + 80 - R + 2;
  assert.equal(hitsColumn(s, c), true);
  s.y = 100;
  s.birdX = c.x - R - 1;
  assert.equal(hitsColumn(s, c), false, 'just before the column');
});

test('hitting a column crashes and stops scrolling', () => {
  const s = createState(400);
  s.vy = 0;
  s.cols = [{ x: s.birdX + R - 1, gapY: s.y + 200, gap: 140, passed: false }];
  const ev = step(s, 1 / 60, idle, () => 0.5);
  assert.equal(ev.crashed, true);
  const x = s.cols[0].x;
  run(s, 0.3);
  assert.equal(s.cols[0].x, x);
});

test('circle versus rectangle overlap', () => {
  assert.equal(hitRect(0, 0, 5, 4, -10, 10, 20), true);
  assert.equal(hitRect(0, 0, 5, 6, -10, 10, 20), false);
  assert.equal(hitRect(0, 0, 5, 3.6, 3.6, 10, 10), false, 'corner gap');
  assert.equal(hitRect(0, 0, 5, 3, 3, 10, 10), true);
});

test('gap centers stay on screen and never jump too far', () => {
  const rng = rng32(9);
  let prev: number | null = null;
  for (let i = 0; i < 500; i++) {
    const gap = gapFor(i % 60);
    const y = nextGapY(prev, gap, rng());
    assert.ok(y - gap / 2 >= MARGIN - 1e-9 && y + gap / 2 <= GROUND - MARGIN + 1e-9);
    if (prev !== null) assert.ok(Math.abs(y - prev) <= MAX_SHIFT + 1e-9);
    prev = y;
  }
});

test('columns spawn off screen, evenly spaced, and are recycled', () => {
  const s = createState(500);
  step(s, 1 / 60, { flap: true }, rng32(4));
  assert.ok(s.cols.length >= 2);
  assert.ok(s.cols[0].x > 500, 'first column starts off screen');
  for (let i = 1; i < s.cols.length; i++) assert.ok(Math.abs(s.cols[i].x - s.cols[i - 1].x - SPACING) < 1e-6);
  for (let i = 0; i < 2400 && !s.dead; i++) step(s, 1 / 60, { flap: autopilot(s) }, rng32(4 + i));
  assert.ok(s.cols.every((c) => c.x + COL_W > -41));
  assert.ok(s.cols.length < 8);
});

test('the course gets harder but stays fair', () => {
  assert.equal(speedFor(0), START_SPEED);
  assert.ok(speedFor(20) > speedFor(0));
  assert.equal(speedFor(1000), MAX_SPEED);
  assert.equal(gapFor(0), GAP_START);
  assert.ok(gapFor(20) < GAP_START);
  assert.equal(gapFor(1000), GAP_MIN);
  assert.ok(GAP_MIN > R * 6, 'the smallest gap is still several trees tall');
});

test('a big drop between columns is always reachable', () => {
  const window = (SPACING - COL_W - 2 * R) / MAX_SPEED;
  assert.ok(0.5 * GRAVITY * window * window > MAX_SHIFT, 'free fall covers the largest drop in time');
  assert.ok((FLAP_V * FLAP_V) / (2 * GRAVITY) < GAP_MIN - 2 * R, 'one flap from the bottom of the smallest gap stays under the top lip');
});

test('a simple pilot earns gold on every seeded course', () => {
  for (let seed = 1; seed <= 8; seed++) {
    const s = createState(420);
    const rng = rng32(seed);
    for (let i = 0; i < 60 * 300 && !s.dead && s.score < 40; i++) step(s, 1 / 60, { flap: autopilot(s) }, rng);
    assert.ok(s.score >= 30, `seed ${seed} reached ${s.score}`);
  }
});
