import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { join } from 'node:path';
import { isPhoneControllerInvite } from '../src/os/arcade/apps.ts';
import { BALL_RADIUS, countsAsGoal, createBall, stepBall } from '../src/os/arcade/games/soccer/physics.ts';
import { createWorld, distance, FIELD, restartTaker, STEP, stepWorld, type World } from '../src/os/arcade/games/soccer/logic.ts';
import { reconcileControllers } from '../src/os/arcade/games/soccer/input.ts';
import { cloneSnapshot, parsePacket } from '../src/os/arcade/games/soccer/net.ts';
import { missingPhoneSeats } from '../src/os/arcade/games/soccer/seats.ts';

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

function setupPassWorld(humans: 1 | 2, passerId: number, receiverId: number) {
  const world = createWorld(113, 120, humans);
  world.phase = 'live';
  world.restart = null;
  for (const player of world.players) {
    const index = player.id % 11;
    player.x = player.team === 0 ? -32 - index : 32 + index;
    player.z = -18 + index * 3.6;
    player.vx = 0;
    player.vz = 0;
    player.cooldown = 0;
    player.touchCd = 0;
    player.action = 'idle';
  }
  const passer = world.players[passerId]!;
  const receiver = world.players[receiverId]!;
  passer.x = -10;
  passer.z = 0;
  receiver.x = 0;
  receiver.z = 0;
  world.ball.x = passer.x;
  world.ball.y = 0.11;
  world.ball.z = passer.z;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.ball.vz = 0;
  world.ball.grounded = true;
  return { world, passer, receiver };
}

function passAndCollect(world: World, passer: World['players'][number], receiver: World['players'][number]) {
  stepWorld(world, STEP, new Map([[passer.id, {
    move: { x: 1, z: 0 }, aim: { x: 1, z: 0 }, action: 'pass' as const, pressed: true, power: 0.45,
  }]]));
  assert.equal(world.passTarget, receiver.id);
  assert.equal(world.passFrom, passer.id);
  world.ball.x = receiver.x;
  world.ball.y = 0.11;
  world.ball.z = receiver.z;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.ball.vz = 0;
  world.ball.grounded = true;
  stepWorld(world, STEP);
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
  assert.equal(world.restart, 'kickoff');
  assert.equal(world.restartTeam, 1);
  const taker = restartTaker(world);
  assert.equal(taker.team, 1);
  assert.ok(distance(taker, { x: 0, z: 0 }) <= 2.01);
  assert.ok(world.players.every((player) => player.vx === 0 && player.vz === 0));
  assert.ok(world.players.filter((player) => player.team === 0)
    .every((player) => distance(player, { x: 0, z: 0 }) >= FIELD.centerRadius));
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

test('a co-op pass from the second human transfers only that human and keeps seat ownership', () => {
  const { world, passer, receiver } = setupPassWorld(2, 9, 7);
  passAndCollect(world, passer, receiver);

  assert.equal(world.players[6]!.human, true);
  assert.equal(passer.human, false);
  assert.equal(receiver.human, true);
  assert.equal(world.players.filter((player) => player.team === 0 && player.human).length, 2);
  assert.equal(world.controlled[0], 6);
  assert.deepEqual([...reconcileControllers(world, new Map([[0, 6], [1, 9]]))], [[0, 6], [1, receiver.id]]);
  assert.equal(world.passTarget, null);
  assert.equal(world.passPoint, null);
  assert.equal(world.passControl, false);
  assert.equal(world.passFrom, null);
});

test('a co-op pass to an already-human teammate leaves both humans in control', () => {
  const { world, passer, receiver } = setupPassWorld(2, 9, 6);
  passAndCollect(world, passer, receiver);

  assert.equal(passer.human, true);
  assert.equal(receiver.human, true);
  assert.equal(world.players.filter((player) => player.team === 0 && player.human).length, 2);
  assert.equal(world.controlled[0], 6);
  assert.equal(world.passTarget, null);
  assert.equal(world.passPoint, null);
  assert.equal(world.passControl, false);
  assert.equal(world.passFrom, null);
});

test('a single-human pass to a CPU teammate still transfers control', () => {
  const { world, passer, receiver } = setupPassWorld(1, 6, 7);
  passAndCollect(world, passer, receiver);

  assert.equal(passer.human, false);
  assert.equal(receiver.human, true);
  assert.equal(world.players.filter((player) => player.team === 0 && player.human).length, 1);
  assert.equal(world.controlled[0], receiver.id);
});

test('an opponent interception clears every pass target field', () => {
  const world = createWorld();
  world.phase = 'live';
  world.restart = null;
  for (const player of world.players) {
    const index = player.id % 11;
    player.x = player.team === 0 ? -32 - index : 32 + index;
    player.z = -18 + index * 3.6;
    player.vx = 0;
    player.vz = 0;
    player.cooldown = 0;
    player.touchCd = 0;
  }
  const receiver = world.players[7]!;
  const interceptor = world.players[11]!;
  receiver.x = -20;
  receiver.z = 0;
  interceptor.x = 20;
  interceptor.z = 0;
  world.ball.x = interceptor.x;
  world.ball.y = 0.11;
  world.ball.z = interceptor.z;
  world.ball.vx = 0;
  world.ball.vy = 0;
  world.ball.vz = 0;
  world.ball.grounded = true;
  world.passTarget = receiver.id;
  world.passPoint = { x: 5, z: 0 };
  world.passControl = true;
  world.passFrom = 6;

  stepWorld(world, STEP);

  assert.equal(world.passTarget, null);
  assert.equal(world.passPoint, null);
  assert.equal(world.passControl, false);
  assert.equal(world.passFrom, null);
});

test('post and crossbar frame collisions clear stale in-net state', () => {
  const post = createBall();
  post.inNet = true;
  post.x = FIELD.length / 2 + 0.2;
  post.z = FIELD.goalWidth / 2;
  post.y = 0.11;
  post.vx = 1;
  stepBall(post, 1 / 120);
  assert.equal(post.x, FIELD.length / 2 - BALL_RADIUS);
  assert.equal(post.inNet, false);

  const crossbar = createBall();
  crossbar.inNet = true;
  crossbar.x = FIELD.length / 2 + 0.2;
  crossbar.z = 0;
  crossbar.y = FIELD.goalHeight - BALL_RADIUS + 0.01;
  crossbar.vx = 1;
  crossbar.grounded = false;
  stepBall(crossbar, 1 / 120);
  assert.equal(crossbar.x, FIELD.length / 2 - BALL_RADIUS);
  assert.equal(crossbar.inNet, false);
});

test('soccer scene uses the valid PCFShadowMap constant', () => {
  const scene = readFileSync(join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'games', 'soccer', 'scene.ts'), 'utf8');
  assert.doesNotMatch(scene, /PCFSoftShadowMap/);
  assert.match(scene, /renderer\.shadowMap\.type\s*=\s*THREE\.PCFShadowMap/);
});

test('welcome toast is suppressed only for mobile soccer phone invites', () => {
  assert.equal(isPhoneControllerInvite('?game=soccer&room=ABCD', true), true);
  assert.equal(isPhoneControllerInvite('?game=soccer&room=ABCD', false), false);
  assert.equal(isPhoneControllerInvite('?game=badminton&room=ABCD', true), false);
  assert.equal(isPhoneControllerInvite('?game=soccer&room=ABCI', true), false);
});

test('missing phone seats only reports phones expected for the current match', () => {
  assert.deepEqual(missingPhoneSeats([1, 2], [0, 1]), [2]);
  assert.deepEqual(missingPhoneSeats([1, 2], [0, 1, 2, 3]), []);
  assert.deepEqual(missingPhoneSeats([], [0, 1]), []);
});
