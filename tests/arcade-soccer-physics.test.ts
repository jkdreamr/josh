import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALL_RADIUS, countsAsGoal, createBall, resolvePostCollision, stepBall } from '../src/os/arcade/games/soccer/physics.ts';
import { createWorld, FIELD, resolveKeeperContact, stepWorld, TEAM_SIZE } from '../src/os/arcade/games/soccer/logic.ts';

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
  assert.equal(countsAsGoal({ ...ball, x: FIELD.length / 2 + BALL_RADIUS - 0.001, z: 0, y: 0.4 }, FIELD.length / 2 - BALL_RADIUS - 0.1), false);
  assert.equal(countsAsGoal({ ...ball, x: FIELD.length / 2 + BALL_RADIUS + 0.01, z: 0, y: 0.4 }, FIELD.length / 2 - BALL_RADIUS - 0.1), true);
});

test('a ball inside the net is heavily damped', () => {
  const ball = createBall();
  ball.x = FIELD.length / 2 + 0.8; ball.y = 0.6; ball.vx = 12; ball.inNet = true;
  for (let i = 0; i < 120; i++) stepBall(ball, 1 / 60);
  assert.ok(Math.abs(ball.vx) < 0.4);
});

test('a goalkeeper claims a weak central shot but cannot reach the far corner', () => {
  const g = createWorld();
  const keeper = g.players[TEAM_SIZE]!;
  keeper.z = 0;
  g.ball.x = FIELD.length / 2 - 0.9; g.ball.y = 0.6; g.ball.z = 0; g.ball.vx = 11;
  assert.equal(resolveKeeperContact(g, FIELD.length / 2 - 1.6), true);
  assert.equal(g.ball.grounded, true);
  const corner = createWorld();
  corner.players[TEAM_SIZE]!.z = -4.5;
  corner.ball.x = FIELD.length / 2 - 0.9; corner.ball.y = 0.8; corner.ball.z = 2.2; corner.ball.vx = 25;
  assert.equal(resolveKeeperContact(corner, FIELD.length / 2 - 1.6), false);
});

test('a goalkeeper parries a reachable 25 m/s shot', () => {
  const g = createWorld();
  const keeper = g.players[TEAM_SIZE]!;
  keeper.z = 0;
  g.ball.x = FIELD.length / 2 - 0.9; g.ball.y = 0.8; g.ball.z = 0.5; g.ball.vx = 25; g.ball.vy = 0;
  assert.equal(resolveKeeperContact(g, FIELD.length / 2 - 1.6), true);
  assert.equal(g.ball.grounded, false);
  assert.ok(Math.hypot(g.ball.vx, g.ball.vy, g.ball.vz) > 1);
  assert.equal(keeper.action, 'parry');
});

test('a keeper dive extends lateral reach but a ready keeper cannot claim the same shot', () => {
  const g = createWorld();
  const keeper = g.players[TEAM_SIZE]!;
  keeper.z = 0;
  g.ball.x = FIELD.length / 2 - 0.9; g.ball.y = 0.8; g.ball.z = 1.8; g.ball.vx = 12;
  assert.equal(resolveKeeperContact(g, FIELD.length / 2 - 1.6), false);
  keeper.action = 'dive';
  g.ball.x = FIELD.length / 2 - 0.9; g.ball.y = 0.8; g.ball.z = 1.8; g.ball.vx = 12;
  assert.equal(resolveKeeperContact(g, FIELD.length / 2 - 1.6), true);
  assert.equal(g.ball.grounded, true);
});

test('assisted 70% shots stay on target more often than maximum-power shots', () => {
  const onTarget = (seed: number, power: number) => {
    const g = createWorld(seed, 120);
    g.phase = 'live'; g.restart = null;
    const shooter = g.players[1]!;
    shooter.x = FIELD.length / 2 - FIELD.penaltyDepth / 2; shooter.z = 0.5; shooter.human = true; shooter.controlled = true;
    g.ball.x = shooter.x + 0.3; g.ball.z = 0.5; g.ball.y = 0.11;
    for (const opponent of g.players.filter((p) => p.team === 1)) {
      opponent.x = 18; opponent.z = 9;
    }
    stepWorld(g, 1 / 60, new Map([[shooter.id, {
      move: { x: 0, z: 0 }, action: 'shoot', pressed: true, power, aim: { x: 1, z: -2 },
    }]]));
    for (let i = 0; i < 180 && g.ball.x < FIELD.length / 2 + 0.2; i++) stepBall(g.ball, 1 / 60);
    return Math.abs(g.ball.z) < FIELD.goalWidth / 2 - 0.11
      && g.ball.y <= FIELD.goalHeight - 0.11 && g.ball.x >= FIELD.length / 2 + 0.1;
  };
  let assisted = 0;
  let maximum = 0;
  for (let seed = 1; seed <= 40; seed++) {
    if (onTarget(seed, 0.7)) assisted++;
    if (onTarget(seed, 1)) maximum++;
  }
  assert.ok(assisted >= 30, `70% shot target rate: ${assisted}/40`);
  assert.ok(maximum < assisted, `maximum-power target rate: ${maximum}/40`);
});
