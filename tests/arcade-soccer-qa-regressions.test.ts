import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BALL_RADIUS, countsAsGoal, createBall } from '../src/os/arcade/games/soccer/physics.ts';
import { createWorld, FIELD, stepWorld, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { cloneSnapshot, parsePacket } from '../src/os/arcade/games/soccer/net.ts';

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

function scoreSlowGoal() {
  const world = liveWorld();
  for (let i = 0; i < 300 && world.phase === 'live'; i++) stepWorld(world, 1 / 60);
  assert.equal(world.phase, 'goal');
  assert.deepEqual(world.score, [1, 0]);
  return world;
}

test('slow rolling ball scores after crossing the whole-ball goal line', () => {
  scoreSlowGoal();
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

test('kickoff after a goal fully resets the ball', () => {
  const world = scoreSlowGoal();
  world.ball.inNet = true;
  world.ball.vx = 1;
  world.ball.vy = -2;
  world.ball.vz = 3;
  world.ball.spin = 4;

  for (let i = 0; i < 300 && world.phase === 'goal'; i++) stepWorld(world, 1 / 60);

  assert.equal(world.phase, 'restart');
  assert.deepEqual(world.ball, {
    x: 0, y: 0.11, z: 0, vx: 0, vy: 0, vz: 0, spin: 0, grounded: true, inNet: false,
  });
});

test('goal-kick and corner pushes keep every player in bounds and snapshots valid', () => {
  const restarts = [
    {
      restart: 'goal-kick' as const,
      restartAt: { x: -FIELD.length / 2 + FIELD.goalAreaDepth, z: 0 },
      playerPosition: { x: -FIELD.length / 2 + FIELD.goalAreaDepth - 2, z: 0 },
    },
    {
      restart: 'corner' as const,
      restartAt: { x: -FIELD.length / 2, z: FIELD.width / 2 },
      playerPosition: { x: -FIELD.length / 2 - 0.8, z: FIELD.width / 2 + 0.6 },
    },
  ];

  for (const { restart, restartAt, playerPosition } of restarts) {
    const world = createWorld();
    world.phase = 'restart';
    world.restart = restart;
    world.restartTeam = 0;
    world.restartAt = restartAt;
    const opponent = world.players[11]!;
    opponent.x = playerPosition.x;
    opponent.z = playerPosition.z;

    stepWorld(world, 1 / 60);

    for (const player of world.players) {
      assert.ok(player.x >= -FIELD.length / 2 + 0.3 && player.x <= FIELD.length / 2 - 0.3);
      assert.ok(player.z >= -FIELD.width / 2 + 0.3 && player.z <= FIELD.width / 2 - 0.3);
    }
    assert.notEqual(parsePacket({
      t: 'soccer', k: 's', r: 1, seq: 1, state: cloneSnapshot(world),
    }), null);
  }
});
