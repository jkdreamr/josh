import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BALL_R,
  BOARD_OFF,
  HOOP_Z,
  MAX_LIVE,
  RIM_R,
  RIM_Y,
  ROUND_SECONDS,
  aimFromDrag,
  canShoot,
  collideBalls,
  create,
  currentSpot,
  fire,
  fmtClock,
  hoopX,
  launch,
  launchVelocity,
  makeBall,
  makeWindow,
  pointsFor,
  releasePos,
  roundSpec,
  simulate,
  stepBall,
  stepGame,
  targetFor,
  type Ball,
} from '../src/os/arcade/games/hoops/logic.ts';

const hoop = { x: 0, y: RIM_Y, z: HOOP_Z, r: RIM_R };
const run = (b: Ball, secs = 6) => {
  const hits = { rim: 0, board: 0, score: undefined as undefined | 'swish' | 'make' };
  for (let i = 0; i < secs * 60 && b.live; i++) {
    const c = stepBall(b, hoop, 1 / 60);
    if (c.rim) hits.rim++;
    if (c.board) hits.board++;
    if (c.score) hits.score = c.score;
  }
  return hits;
};

test('hoops flight: launch velocity passes through the target on the way down', () => {
  const p0 = { x: 0.4, y: 2, z: 5 };
  const t = { x: 0, y: RIM_Y, z: HOOP_Z };
  const v = launchVelocity(p0, t, 1.5);
  const time = (t.z - p0.z) / v.z;
  assert.ok(Math.abs((p0.x + v.x * time) - (t.x)) < 5e-06);
  assert.ok(Math.abs((p0.y + v.y * time - 0.5 * 9.81 * time * time) - (t.y)) < 5e-06);
  assert.ok(v.y - 9.81 * time < 0);
});

test('hoops flight: every spot has a make window around its straight shot, with a swish band inside it', () => {
  for (let r = 1; r <= 6; r++)
    for (const s of roundSpec(r).spots) {
      const w = makeWindow(s);
      assert.equal(simulate(s, { yaw: 0, power: w.best }), 'swish');
      assert.ok(w.hi - w.lo > 0.025);
      assert.ok(w.swishLo >= w.lo);
      assert.ok(w.swishHi <= w.hi);
    }
});

test('hoops flight: short and long shots off the window miss, wide shots miss', () => {
  const s = roundSpec(1).spots[0];
  const w = makeWindow(s);
  assert.equal(simulate(s, { yaw: 0, power: w.lo - 0.05 }), 'miss');
  assert.equal(simulate(s, { yaw: 0, power: w.hi + 0.2 }), 'miss');
  assert.equal(simulate(s, { yaw: 0.3, power: w.best }), 'miss');
});

test('hoops flight: a slightly long shot touches the rim or board on the way', () => {
  const s = roundSpec(2).spots[0];
  const w = makeWindow(s);
  const b = launch(s, { yaw: 0, power: w.hi + 0.01 });
  const hits = run(b);
  assert.ok(hits.rim + hits.board > 0);
});

test('hoops flight: balls carry backspin, and the rim bounces a falling ball back out', () => {
  const b = launch(roundSpec(1).spots[0], { yaw: 0, power: 0.2 });
  assert.ok(Math.hypot(b.w.x, b.w.z) > 5);
  const r = makeBall();
  r.live = true;
  r.p = { x: RIM_R + 0.05, y: RIM_Y + BALL_R + 0.02, z: HOOP_Z };
  r.v = { x: 0, y: -3, z: 0 };
  stepBall(r, hoop, 1 / 30);
  assert.ok(r.v.y > 0);
  assert.equal(r.rim, true);
});

test('hoops flight: the backboard reflects the ball', () => {
  const b = makeBall();
  b.live = true;
  b.p = { x: 0, y: 3.5, z: HOOP_Z - BOARD_OFF + BALL_R + 0.05 };
  b.v = { x: 0, y: 0, z: -6 };
  const c = stepBall(b, hoop, 1 / 30);
  assert.ok(c.board > 0);
  assert.ok(b.v.z > 0);
});

test('hoops flight: going up through the ring does not count', () => {
  const b = makeBall();
  b.live = true;
  b.p = { x: 0, y: RIM_Y - 0.3, z: HOOP_Z };
  b.v = { x: 0, y: 4, z: 0 };
  const c = stepBall(b, hoop, 0.1);
  assert.equal(c.score, undefined);
  assert.equal(b.scored, false);
});

test('hoops flight: balls knock each other apart', () => {
  const a = makeBall();
  const b = makeBall();
  a.p = { x: 0, y: 2, z: 0 };
  b.p = { x: BALL_R * 1.8, y: 2, z: 0 };
  a.v = { x: 2, y: 0, z: 0 };
  b.v = { x: 0, y: 0, z: 0 };
  assert.equal(collideBalls(a, b), true);
  assert.ok(b.v.x > a.v.x);
});

test('hoops controls: drag maps up to power and sideways to aim, clamped', () => {
  assert.deepEqual(aimFromDrag(0, -150, 300), { power: 0.5, yaw: 0 });
  assert.equal(aimFromDrag(0, 200, 300).power, 0);
  const a = aimFromDrag(9999, -9999, 300);
  assert.equal(a.power, 1);
  assert.ok(Math.abs((a.yaw) - (0.6)) < 0.005);
});

test('hoops controls: release point sits above the spot, facing the hoop', () => {
  const p = releasePos({ d: 5, a: 0 });
  assert.ok(Math.abs((p.x) - (0)) < 0.005);
  assert.ok(Math.abs((p.z) - (HOOP_Z + 4.7)) < 0.005);
});

test('hoops rounds: points add up for swish, three and fire', () => {
  assert.equal(pointsFor('make', false, false), 2);
  assert.equal(pointsFor('swish', false, false), 3);
  assert.equal(pointsFor('swish', true, false), 4);
  assert.equal(pointsFor('make', true, true), 6);
});

test('hoops rounds: the hoop sits still early and moves later', () => {
  assert.equal(hoopX(1, 3), 0);
  assert.equal(hoopX(2, 3), 0);
  assert.ok(Math.abs(hoopX(3, 2)) > 0);
  assert.ok(targetFor(8) > targetFor(4));
  assert.ok(roundSpec(9).sway <= 1.4);
});

test('hoops rounds: limits balls in the air and spaces shots', () => {
  const g = create();
  assert.notEqual(fire(g, { yaw: 0, power: 0.2 }), null);
  assert.equal(canShoot(g), false);
  for (let i = 1; i < MAX_LIVE; i++) {
    g.cooldown = 0;
    fire(g, { yaw: 0, power: 0.2 });
  }
  g.cooldown = 0;
  assert.equal(canShoot(g), false);
});

test('hoops rounds: a make scores, moves you to the next spot and three in a row catches fire', () => {
  const g = create();
  for (let i = 0; i < 3; i++) {
    g.cooldown = 0;
    g.moving = 0;
    const w = makeWindow(currentSpot(g));
    fire(g, { yaw: 0, power: w.best });
    let made = false;
    for (let f = 0; f < 600 && g.balls.length; f++) if (stepGame(g, 1 / 60, 0).made) made = true;
    assert.equal(made, true);
  }
  assert.equal(g.makes, 3);
  assert.equal(g.spot, 3);
  assert.equal(g.fire, true);
  assert.equal(g.score, 9);
});

test('hoops rounds: a miss ends a streak', () => {
  const g = create();
  g.fire = true;
  g.streak = 4;
  fire(g, { yaw: 0.5, power: 0.3 });
  for (let f = 0; f < 600 && g.balls.length; f++) stepGame(g, 1 / 60, 0);
  assert.equal(g.fire, false);
  assert.equal(g.streak, 0);
});

test('hoops rounds: beating the target moves to the next round, missing it ends the game', () => {
  const g = create();
  g.makes = targetFor(1);
  g.timeLeft = 0.01;
  assert.equal(stepGame(g, 1 / 60).roundUp, true);
  assert.equal(g.round, 2);
  assert.equal(g.timeLeft, ROUND_SECONDS);
  g.pause = 0;
  g.timeLeft = 0.01;
  assert.equal(stepGame(g, 1 / 60).over, true);
  assert.equal(g.over, true);
});

test('hoops rounds: formats the clock', () => {
  assert.equal(fmtClock(45), '0:45');
  assert.equal(fmtClock(9.2), '0:10');
  assert.equal(fmtClock(-1), '0:00');
});
