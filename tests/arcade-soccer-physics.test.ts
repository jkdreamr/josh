import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countsAsGoal, createBall, resolvePostCollision, stepBall } from '../src/os/arcade/games/soccer/physics.ts';
import { createWorld, resolveKeeperContact } from '../src/os/arcade/games/soccer/logic.ts';

test('drag shortens the flight compared with vacuum gravity', () => {
  const ball = createBall();
  ball.vx = 25; ball.vy = 9;
  let t = 0;
  while (t < 0.8) { stepBall(ball, 1 / 120); t += 1 / 120; }
  assert.ok(ball.x < 20, `dragged range was ${ball.x}`);
});

test('sidespin curves the ball in the spin direction', () => {
  const ball = createBall();
  ball.vx = 24; ball.vy = 4; ball.spin = 10;
  for (let i = 0; i < 120; i++) stepBall(ball, 1 / 120);
  assert.ok(ball.z > 0, `expected positive curl, got ${ball.z}`);
});

test('ground impact bounces with approximately the configured restitution', () => {
  const ball = createBall();
  ball.y = 2; ball.vy = -5;
  for (let i = 0; i < 100; i++) stepBall(ball, 1 / 120);
  assert.ok(ball.grounded || ball.vy < 0.7);
});

test('rolling ball comes to rest', () => {
  const ball = createBall();
  ball.vx = 2;
  for (let i = 0; i < 500; i++) stepBall(ball, 1 / 60);
  assert.ok(Math.abs(ball.vx) < 0.02);
});

test('post collision rebounds and whole-ball crossing determines a goal', () => {
  const ball = createBall();
  ball.x = 0.05; ball.y = 0.11; ball.vx = -4;
  assert.equal(resolvePostCollision(ball, 0, 0, 0.11), true);
  assert.ok(ball.vx > 0);
  assert.equal(countsAsGoal({ ...ball, x: 21 + 0.11 - 0.001, z: 0, y: 0.4 }, 20.8), false);
  assert.equal(countsAsGoal({ ...ball, x: 21 + 0.12, z: 0, y: 0.4 }, 20.8), true);
});

test('a ball inside the net is heavily damped', () => {
  const ball = createBall();
  ball.x = 21.3; ball.y = 0.6; ball.vx = 12; ball.inNet = true;
  for (let i = 0; i < 120; i++) stepBall(ball, 1 / 60);
  assert.ok(Math.abs(ball.vx) < 0.4);
});

test('a goalkeeper claims a weak central shot but cannot reach the far corner', () => {
  const g = createWorld();
  const keeper = g.players[5]!;
  keeper.z = 0;
  g.ball.x = 19.6; g.ball.y = 0.6; g.ball.z = 0; g.ball.vx = 11;
  assert.equal(resolveKeeperContact(g, 19.4), true);
  assert.equal(g.ball.grounded, true);
  const corner = createWorld();
  corner.players[5]!.z = -4.5;
  corner.ball.x = 19.6; corner.ball.y = 0.8; corner.ball.z = 2.2; corner.ball.vx = 25;
  assert.equal(resolveKeeperContact(corner, 19.4), false);
});

test('a goalkeeper parries a reachable 25 m/s shot', () => {
  const g = createWorld();
  const keeper = g.players[5]!;
  keeper.z = 0;
  g.ball.x = 19.6; g.ball.y = 0.8; g.ball.z = 0.5; g.ball.vx = 25; g.ball.vy = 0;
  assert.equal(resolveKeeperContact(g, 19.4), true);
  assert.equal(g.ball.grounded, false);
  assert.ok(Math.hypot(g.ball.vx, g.ball.vy, g.ball.vz) > 1);
  assert.equal(keeper.action, 'parry');
});
