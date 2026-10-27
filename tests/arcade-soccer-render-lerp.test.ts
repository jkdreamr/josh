import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld } from '../src/os/arcade/games/soccer/logic.ts';
import { captureSnapshot, createSnapshot, interpolateInto } from '../src/os/arcade/games/soccer/render-lerp.ts';

test('render interpolation blends positions and velocity with shortest-angle facing', () => {
  const previous = createWorld();
  previous.players[0]!.x = 2;
  previous.players[0]!.z = 3;
  previous.players[0]!.facing = Math.PI - 0.1;
  previous.players[0]!.vx = 1;
  previous.ball.x = 1;
  previous.ball.y = 0.2;
  previous.ball.z = 3;
  const snapshot = captureSnapshot(previous, createSnapshot(previous));
  const current = structuredClone(previous);
  current.players[0]!.x = 4;
  current.players[0]!.z = 5;
  current.players[0]!.facing = -Math.PI + 0.1;
  current.players[0]!.vx = 3;
  current.ball.x = 3;
  current.ball.y = 0.6;
  current.ball.z = 5;
  const out = structuredClone(previous);

  interpolateInto(out, snapshot, current, 0.5);

  assert.equal(out.players[0]!.x, 3);
  assert.equal(out.players[0]!.z, 4);
  assert.ok(Math.abs(Math.abs(out.players[0]!.facing) - Math.PI) < 1e-5);
  assert.equal(out.players[0]!.vx, 2);
  assert.equal(out.ball.x, 2);
  assert.ok(Math.abs(out.ball.y - 0.4) < 1e-5);
  assert.equal(out.ball.z, 4);
});

test('teleports snap players and balls rather than interpolating across the field', () => {
  const previous = createWorld();
  const snapshot = captureSnapshot(previous, createSnapshot(previous));
  const current = structuredClone(previous);
  current.players[0]!.x = 5;
  current.players[0]!.vx = 4;
  current.ball.x = 5;
  const out = structuredClone(previous);

  interpolateInto(out, snapshot, current, 0.25);

  assert.equal(out.players[0]!.x, 5);
  assert.equal(out.players[0]!.vx, 4);
  assert.equal(out.ball.x, 5);
});
