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

test('the selected player used by rings and name tags stays interpolated on live, goal and restart frames', () => {
  const previous = createWorld(), snapshot = captureSnapshot(previous, createSnapshot(previous));
  const current = structuredClone(previous), out = structuredClone(previous);
  current.controlled[0] = 8;
  for (const p of current.players) { p.x += 1; p.z += 0.5; p.controlled = p.id === 8; }
  for (const phase of ['live', 'goal', 'restart'] as const) {
    current.phase = phase;
    interpolateInto(out, snapshot, current, 0.5);
    const selected = out.players.find((p) => p.id === out.controlled[0])!;
    assert.equal(selected.controlled, true);
    assert.equal(selected.x, previous.players[8]!.x + 0.5);
    assert.equal(selected.z, previous.players[8]!.z + 0.25);
    assert.equal(out.phase, phase);
    assert.equal(current.players[8]!.x, previous.players[8]!.x + 1, 'rendering never changes simulation state');
  }
});
