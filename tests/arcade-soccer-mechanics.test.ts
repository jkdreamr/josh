import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, distance, FIELD, TEAM_SIZE, movePlayer, nearestCarrier, STEP, stepWorld, type Command } from '../src/os/arcade/games/soccer/logic.ts';
import { cloneSnapshot, parsePacket } from '../src/os/arcade/games/soccer/net.ts';

function fixture(seed = 71423) {
  const world = createWorld(seed);
  world.phase = 'live'; world.restart = null; world.controlled = [1, TEAM_SIZE + 1];
  for (const p of world.players) { p.x = -15; p.z = 10; p.human = true; p.controlled = false; }
  const player = world.players[1]!;
  player.x = player.z = 0; player.controlled = true; player.facing = Math.PI / 2;
  world.ball.x = 0.4; world.ball.z = 0;
  return { world, player, tick: (command: Command) => stepWorld(world, STEP, new Map([[player.id, command]])) };
}

test('jog responds in 0.2 seconds, neutral stops and clamps derive from FIELD', () => {
  const { player } = fixture();
  let frames = 0;
  while (player.vx < 7 - 1e-9 && frames < 30) { movePlayer(player, { x: 1, z: 0 }, false, false, STEP); frames++; }
  console.log(`time to run: ${(frames * STEP).toFixed(3)} s`);
  assert.ok(frames * STEP <= 0.2);
  for (let i = 0; i < 15; i++) movePlayer(player, { x: 0, z: 0 }, false, false, STEP);
  assert.equal(Math.hypot(player.vx, player.vz), 0);
  player.x = FIELD.length; player.z = FIELD.width;
  movePlayer(player, { x: 0, z: 0 }, false, false, STEP);
  assert.equal(player.x, FIELD.length / 2 - 0.3);
  assert.equal(player.z, FIELD.width / 2 - 0.3);
});

test('sprint reversal plants before turning, with bounded drift', () => {
  const { player } = fixture(); player.vx = 9;
  let frames = 0, drift = 0;
  while (player.vx >= 0 && frames < 60) {
    movePlayer(player, { x: -1, z: 0 }, true, false, STEP); frames++;
    drift = Math.max(drift, player.x);
    if (frames === 6) assert.ok(player.vx > 0);
  }
  console.log(`sprint reversal: ${(frames * STEP).toFixed(3)} s; drift: ${drift.toFixed(3)} m`);
  assert.ok(frames * STEP >= 0.2 && frames * STEP <= 0.45);
  assert.ok(drift > 0.5 && drift < 1.5);
});

test('slow turns are instant and depleted stamina reduces sprint top speed', () => {
  const { player } = fixture(); player.vx = 2.5;
  movePlayer(player, { x: 0, z: 1 }, false, false, STEP);
  assert.ok(Math.abs(player.vx) < 1e-9 && player.vz > 0);
  const low = { ...player, stamina: 0.05 }, fresh = { ...player, stamina: 1 };
  for (let i = 0; i < 60; i++) {
    movePlayer(low, { x: 1, z: 0 }, true, false, STEP);
    movePlayer(fresh, { x: 1, z: 0 }, true, false, STEP);
  }
  assert.ok(Math.hypot(fresh.vx, fresh.vz) > Math.hypot(low.vx, low.vz) + 1);
});

test('slow 90 degree dribble retains close control', () => {
  const { world, player, tick } = fixture(); world.carrierId = player.id;
  let max = 0;
  for (let i = 0; i < 120; i++) {
    tick({ move: i < 60 ? { x: 0.4, z: 0 } : { x: 0, z: 0.4 } });
    max = Math.max(max, distance(player, world.ball));
    assert.equal(nearestCarrier(world)?.id, player.id);
  }
  console.log(`slow turn max ball distance: ${max.toFixed(3)} m`);
  assert.ok(max <= 0.7);
});

test('sprint touches knock the ball loose beyond a metre and expire', () => {
  const { world, player, tick } = fixture(); world.carrierId = player.id; player.vx = 8; world.ball.x = 0.6;
  tick({ move: { x: 1, z: 0 }, sprint: true });
  assert.ok(player.touchCd! > 0); assert.equal(nearestCarrier(world), undefined);
  let max = 0;
  for (let i = 0; i < 18; i++) {
    tick({ move: { x: 1, z: 0 }, sprint: true });
    max = Math.max(max, distance(player, world.ball));
    assert.equal(nearestCarrier(world), undefined);
  }
  assert.ok(max > 1);
  for (let i = 0; i < 10; i++) tick({ move: { x: 0, z: 0 } });
  assert.equal(player.touchCd, 0);
});

test('neutral carrier shields with ball on far side of opponent', () => {
  const { world, player, tick } = fixture(); world.carrierId = player.id;
  const opponent = world.players.find((p) => p.team !== player.team)!;
  opponent.x = -1; opponent.z = 0;
  tick({ move: { x: 0, z: 0 } });
  assert.equal(player.action, 'shield');
  assert.ok((world.ball.x - player.x) * (opponent.x - player.x) + (world.ball.z - player.z) * (opponent.z - player.z) < 0);
  assert.ok(Math.abs(distance(player, world.ball) - 0.42) < 0.01);
});

test('sprint dribbler keeps close control rather than knocking into a nearby defender', () => {
  for (const inFront of [true, false]) {
    const { world, player, tick } = fixture();
    world.carrierId = world.lastToucherId = player.id;
    player.vx = 8; world.ball.x = 0.6;
    const opponent = world.players.find((p) => p.team !== player.team)!;
    opponent.x = inFront ? 1.5 : -1.5; opponent.z = 0;
    tick({ move: { x: 1, z: 0 }, sprint: true });
    assert.equal(player.touchCd! > 0, !inFront);
  }
});

test('fast pressured sprint reception is heavier than soft standing reception across seeds', () => {
  const count = (hard: boolean) => {
    let heavy = 0;
    for (let i = 1; i <= 1000; i++) {
      const { world, player, tick } = fixture(Math.imul(i, 2654435761) >>> 0);
      if (hard) {
        player.vx = 8;
        const opponent = world.players.find((p) => p.team !== player.team)!;
        opponent.x = 1; opponent.z = 0;
      }
      world.ball.vx = hard ? -23 : 4;
      tick({ move: { x: hard ? 1 : 0, z: 0 }, sprint: hard });
      if (player.touchCd === 0.3) heavy++;
    }
    return heavy;
  };
  const hard = count(true), soft = count(false);
  console.log(`heavy touches: hard ${hard}/1000; soft ${soft}/1000`);
  assert.ok(hard > 500 && soft < 50 && hard > soft);
});

test('snapshots accept new state and reject invalid touch cooldowns', () => {
  const world = createWorld();
  const packet = () => ({ t: 'soccer', k: 's', r: 1, seq: 1, state: cloneSnapshot(world) });
  assert.ok(parsePacket(packet()));
  world.players[1]!.touchCd = -1;
  assert.equal(parsePacket(packet()), null);
});

test('own knock-on recollections and trivial pressured pickups never roll a heavy touch', () => {
  for (const ownTouch of [false, true]) {
    for (let i = 1; i <= 200; i++) {
      const { world, player, tick } = fixture(Math.imul(i, 2654435761) >>> 0);
      world.lastToucherId = ownTouch ? player.id : null;
      player.vx = 8;
      const opponent = world.players.find((p) => p.team !== player.team)!;
      opponent.x = 1; opponent.z = 0;
      world.ball.vx = ownTouch ? -23 : 7;
      tick({ move: { x: 1, z: 0 }, sprint: true });
      assert.notEqual(player.touchCd, 0.3);
      assert.equal(world.lastToucherId, player.id);
    }
  }
});
