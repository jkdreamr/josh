import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BALL_R,
  BOARD_OFF,
  HOOP_Z,
  RIM_R,
  RIM_Y,
  ROUND_SECONDS,
  START,
  aimFromDrag,
  canShoot,
  create,
  fire,
  fmtClock,
  hoopX,
  launchVelocity,
  makeBall,
  shoot,
  stepBall,
  stepGame,
  targetFor,
} from '../src/os/arcade/games/hoops/logic.ts';

const hoop = { x: 0, y: RIM_Y, z: HOOP_Z, r: RIM_R };
const DT = 1 / 240;

function fly(ball: ReturnType<typeof makeBall>, h = hoop) {
  const events: string[] = [];
  for (let i = 0; i < 240 * 6 && ball.live; i++) {
    const c = stepBall(ball, h, DT);
    if (c.rim) events.push('rim');
    if (c.board) events.push('board');
    if (c.score) events.push(c.score);
    if (c.floor) events.push('floor');
  }
  return events;
}

test('launchVelocity passes through the target on the way down', () => {
  const target = { x: 0.4, y: RIM_Y, z: HOOP_Z };
  const v = launchVelocity(START, target);
  const p = { ...START };
  const vel = { ...v };
  let best = Infinity;
  let peaked = false;
  for (let i = 0; i < 240 * 4; i++) {
    vel.y -= 9.81 * DT;
    p.x += vel.x * DT;
    p.y += vel.y * DT;
    p.z += vel.z * DT;
    if (vel.y < 0) peaked = true;
    if (peaked) best = Math.min(best, Math.hypot(p.x - target.x, p.y - target.y, p.z - target.z));
  }
  assert.ok(best < 0.03, `closest approach ${best}`);
});

test('a perfect shot is a swish and never touches the rim', () => {
  const b = makeBall();
  shoot(b, hoop, { lateral: 0, depth: 0 });
  const ev = fly(b);
  assert.ok(ev.includes('swish'));
  assert.ok(!ev.includes('rim') && !ev.includes('board'));
  assert.ok(b.scored);
});

test('a slightly long shot can use the board or rim and still count as a make', () => {
  const b = makeBall();
  shoot(b, hoop, { lateral: 0, depth: 0.42 });
  const ev = fly(b);
  assert.ok(ev.includes('board') || ev.includes('rim'), `touched something: ${ev.join(',')}`);
  if (ev.includes('make')) assert.ok(!ev.includes('swish'));
});

test('a wide shot misses and the ball dies on the floor', () => {
  const b = makeBall();
  shoot(b, hoop, { lateral: 1.5, depth: -0.5 });
  const ev = fly(b);
  assert.ok(!ev.includes('swish') && !ev.includes('make'));
  assert.ok(!b.live);
  assert.ok(ev.includes('floor'));
});

test('the rim pushes the ball out and reverses its approach', () => {
  const b = makeBall();
  b.live = true;
  b.p = { x: hoop.r + BALL_R - 0.005, y: RIM_Y + 0.01, z: HOOP_Z };
  b.v = { x: -2, y: 0, z: 0 };
  const c = stepBall(b, hoop, DT);
  assert.ok(c.rim);
  assert.ok(b.v.x > 0, 'bounced back');
  assert.ok(b.rim);
});

test('the backboard reflects a ball flying into it', () => {
  const b = makeBall();
  b.live = true;
  b.p = { x: 0, y: 3.3, z: HOOP_Z - BOARD_OFF + BALL_R + 0.01 };
  b.v = { x: 0, y: 0, z: -4 };
  const c = stepBall(b, hoop, DT);
  assert.ok(c.board);
  assert.ok(b.v.z > 0);
  assert.ok(b.p.z >= HOOP_Z - BOARD_OFF + BALL_R - 1e-9);
});

test('coming up through the hoop does not score', () => {
  const b = makeBall();
  b.live = true;
  b.p = { x: 0, y: RIM_Y - 0.3, z: HOOP_Z };
  b.v = { x: 0, y: 6, z: 0 };
  let scored = false;
  for (let i = 0; i < 60; i++) if (stepBall(b, hoop, DT).score) scored = true;
  assert.ok(!scored);
});

test('aimFromDrag maps a medium swipe to a perfect shot and clamps extremes', () => {
  const a = aimFromDrag(0, -0.42 * 800, 400, 800);
  assert.ok(Math.abs(a.depth) < 1e-9);
  assert.equal(a.lateral, 0);
  const far = aimFromDrag(4000, -100000, 400, 800);
  assert.equal(far.lateral, 1.6);
  assert.ok(Math.abs(far.depth - 0.7 * 1.4) < 1e-9);
  const none = aimFromDrag(0, 50, 400, 800);
  assert.ok(none.depth < 0);
});

test('the hoop stands still in round one and sways later', () => {
  assert.equal(hoopX(1, 3), 0);
  assert.ok(Math.abs(hoopX(2, 1.5)) > 0.1);
});

test('rounds advance when you hit the target and end the game when you do not', () => {
  const g = create();
  assert.ok(canShoot(g));
  assert.ok(fire(g, { lateral: 0, depth: 0 }));
  assert.ok(!canShoot(g), 'one ball at a time');
  assert.equal(g.attempts, 1);
  let total = 0;
  for (let i = 0; i < 240 * 6 && g.ball.live; i++) total += stepGame(g, DT).points ?? 0;
  assert.equal(total, 3);
  assert.equal(g.score, 3);
  assert.equal(g.makes, 1);
  // finish the round with enough makes
  g.makes = targetFor(1);
  g.timeLeft = 0.001;
  const t = stepGame(g, 0.01);
  assert.ok(t.roundUp);
  assert.equal(g.round, 2);
  assert.equal(g.timeLeft, ROUND_SECONDS);
  assert.equal(g.makes, 0);
  // and fail the next one
  g.timeLeft = 0.001;
  const o = stepGame(g, 0.01);
  assert.ok(o.over);
  assert.ok(g.over);
  assert.ok(!fire(g, { lateral: 0, depth: 0 }));
});

test('the clock waits for a ball in the air before ending a round', () => {
  const g = create();
  fire(g, { lateral: 0, depth: 0 });
  g.timeLeft = 0.001;
  stepGame(g, 0.01);
  assert.ok(!g.over && g.round === 1);
});

test('clock formatting', () => {
  assert.equal(fmtClock(60), '1:00');
  assert.equal(fmtClock(9.2), '0:10');
  assert.equal(fmtClock(-1), '0:00');
});
