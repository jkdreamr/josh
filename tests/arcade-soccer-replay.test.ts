import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../src/os/arcade/games/soccer/logic.ts';
import { appendReplayFrame, createReplayWorld, REPLAY_SECONDS, sampleReplay, selectReplay, type ReplayFrame } from '../src/os/arcade/games/soccer/replay.ts';

test('replay snapshots stay compact and bounded to the ring window', () => {
  const world = createWorld();
  const frames: ReplayFrame[] = [];
  for (let time = 0; time <= 10; time += 0.05) {
    world.players[1]!.x = time;
    world.ball.x = time * 2;
    appendReplayFrame(frames, world, time);
  }
  assert.ok(frames.length <= REPLAY_SECONDS / 0.05 + 2);
  assert.ok(frames[0]!.time >= 10 - REPLAY_SECONDS - 0.051);
  assert.equal('world' in frames[0]!, false);
  assert.ok(selectReplay(frames, 10).at(-1)!.time <= 10);
  assert.ok(selectReplay(frames, 10).at(-1)!.time >= 9.9);
});

test('replay sampling interpolates player and ball transforms', () => {
  const world = createWorld();
  const frames: ReplayFrame[] = [];
  world.players[1]!.x = 0;
  world.players[1]!.vx = 2;
  world.players[1]!.vz = -4;
  world.players[1]!.cooldown = 0.2;
  world.ball.x = 2;
  appendReplayFrame(frames, world, 0);
  world.players[1]!.x = 10;
  world.players[1]!.vx = 6;
  world.players[1]!.vz = 4;
  world.players[1]!.cooldown = 0.8;
  world.ball.x = 22;
  appendReplayFrame(frames, world, 1);
  const sampled = sampleReplay(frames, 0.5, world)!;
  assert.equal(sampled.players[1]!.x, 5);
  assert.equal(sampled.players[1]!.vx, 4);
  assert.equal(sampled.players[1]!.vz, 0);
  assert.equal(sampled.players[1]!.cooldown, 0.5);
  assert.equal(sampled.ball.x, 12);
});

test('replay facing interpolates across the wrapped shortest angle', () => {
  const world = createWorld();
  const frames: ReplayFrame[] = [];
  world.players[1]!.facing = 3;
  appendReplayFrame(frames, world, 0);
  world.players[1]!.facing = -3;
  appendReplayFrame(frames, world, 1);
  const sampled = sampleReplay(frames, 0.5, world)!;
  assert.ok(Math.abs(sampled.players[1]!.facing) > 3);
});

test('replay sampling can reuse its output world during playback', () => {
  const world = createWorld();
  world.kickEvent = { playerId: 1, action: 'shoot', power: 0.8, time: 0 };
  const output = createReplayWorld(world);
  assert.equal(output.kickEvent, null);
  const frames: ReplayFrame[] = [];
  world.players[1]!.x = 0;
  appendReplayFrame(frames, world, 0);
  world.players[1]!.x = 10;
  appendReplayFrame(frames, world, 1);
  const sampled = sampleReplay(frames, 0.5, world, output);
  assert.equal(sampled, output);
  assert.equal(sampled?.players[1]!.x, 5);
  assert.equal(sampled?.kickEvent, null);
});
