import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALL_RADIUS, countsAsGoal, createBall } from '../src/os/arcade/games/soccer/physics.ts';
import { createWorld, FIELD, stepWorld, type World } from '../src/os/arcade/games/soccer/logic.ts';

function liveWorld(): World {
  const world = createWorld();
  world.phase = 'live';
  world.restart = null;
  for (const player of world.players) {
    player.x = 0;
    player.z = 20;
    player.vx = 0;
    player.vz = 0;
    player.human = true;
    player.controlled = false;
  }
  world.ball.x = FIELD.length / 2 - 0.05;
  world.ball.y = 0.11;
  world.ball.z = 0;
  world.ball.vx = 1.5;
  world.ball.vy = 0;
  world.ball.vz = 0;
  world.ball.grounded = true;
  world.ball.inNet = false;
  return world;
}

test('slow rolling ball scores after crossing the whole-ball goal line', () => {
  const world = liveWorld();
  for (let i = 0; i < 300 && world.phase === 'live'; i++) stepWorld(world, 1 / 60);
  assert.equal(world.phase, 'goal');
  assert.deepEqual(world.score, [1, 0]);
});

test('ball resting behind the goal line does not score again', () => {
  const world = liveWorld();
  world.ball.x = FIELD.length / 2 + 0.5;
  world.ball.vx = 0;
  world.ball.inNet = true;
  for (let i = 0; i < 10 && world.phase === 'live'; i++) stepWorld(world, 1 / 60);
  assert.equal(world.score[0], 0);
  assert.notEqual(world.phase, 'goal');
});

test('physics goal crossing accepts a ball that was already over the line', () => {
  const ball = createBall();
  ball.x = FIELD.length / 2 + BALL_RADIUS + 0.01;
  assert.equal(countsAsGoal(ball, FIELD.length / 2 - 0.05), true);
});
