import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, keeperShotCoverage } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, nearestCarrier, resolveKeeperContact, STEP, stepWorld, teamDir } from '../src/os/arcade/games/soccer/logic.ts';

test('a keeper collects nearby rolling balls without a save-plane crossing and keeps possession', () => {
  for (const swapped of [false, true]) for (const team of [0, 1] as const) {
    const world = createWorld();
    world.phase = 'live'; world.restart = null; world.endsSwapped = swapped;
    for (const p of world.players) { p.x = 0; p.z = 20; }
    const keeper = world.players.find((p) => p.team === team && p.slot === 'GK')!;
    const dir = teamDir(team, swapped);
    keeper.x = -dir * (FIELD.length / 2 - 2); keeper.z = 0;
    world.ball.x = keeper.x - dir * 0.5; world.ball.z = 0.4;
    world.ball.vx = -dir * 2; world.lastTouch = team === 0 ? 1 : 0;
    assert.equal(resolveKeeperContact(world, world.ball.x), true);
    assert.equal(nearestCarrier(world)?.id, keeper.id);
    assert.ok(distance(keeper, world.ball) < 0.64);
    stepWorld(world, STEP);
    assert.equal(nearestCarrier(world)?.id, keeper.id);
    assert.equal(keeper.action, 'catch');
    for (let tick = 0; tick < 20; tick++) stepWorld(world, STEP);
    assert.ok(world.eventTime < 0.9, 'holding a catch must not repeatedly renew the claim event');
  }
});

test('collection does not reach distant, high, fast or out-of-area balls', () => {
  for (const kind of ['distant', 'high', 'fast', 'outside', 'scored']) {
    const world = createWorld(), keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
    keeper.x = 50; keeper.z = 0;
    world.ball.x = 49.5; world.ball.z = 0; world.ball.vx = 2;
    if (kind === 'distant') world.ball.z = 2;
    if (kind === 'high') world.ball.y = 3;
    if (kind === 'fast') world.ball.vx = 25;
    if (kind === 'outside') { keeper.x = 20; world.ball.x = 20.5; }
    if (kind === 'scored') { keeper.x = 52.2; world.ball.x = 52.7; }
    assert.equal(resolveKeeperContact(world, world.ball.x), false, kind);
  }
});

test('coverage projection is deterministic, pure and extends reach only after a read', () => {
  const world = createWorld(), keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
  const before = JSON.stringify(world);
  assert.equal(keeperShotCoverage(world, keeper, 2, 0.1).reach, 1.1);
  const coverage = keeperShotCoverage(world, keeper, 2, 0.4);
  assert.equal(coverage.reach, 2.4);
  assert.deepEqual(coverage, keeperShotCoverage(world, keeper, 2, 0.4));
  assert.equal(JSON.stringify(world), before);
});

test('normal keeper reads a close-range shot before it reaches the save plane', () => {
  const world = createWorld();
  world.phase = 'live'; world.restart = null;
  const keeper = world.players.find((p) => p.team === 1 && p.slot === 'GK')!;
  keeper.z = 0;
  world.ball.x = 40; world.ball.z = 2; world.ball.vx = 30;
  world.kickEvent = { playerId: 1, action: 'shoot', power: 0.8, time: world.clock };
  computeAI(world, 'normal', STEP, 10, 1);
  world.kickEvent = null;
  computeAI(world, 'normal', STEP, 27, 1);
  assert.equal(keeper.action, 'ready');
  computeAI(world, 'normal', STEP, 28, 1);
  assert.equal(keeper.action, 'dive');
});

test('CPU takes an open edge-of-box shot without changing power physics', () => {
  const world = createWorld();
  world.phase = 'live'; world.restart = null;
  for (const p of world.players) { p.x = -25; p.z = 20; p.human = false; p.controlled = false; }
  const player = world.players[1]!;
  player.x = FIELD.length / 2 - 17; player.z = 0;
  world.ball.x = player.x + 0.3; world.ball.z = 0;
  world.lastTouch = 0; world.lastToucherId = player.id;
  const command = computeAI(world, 'normal', STEP, 15, 0).get(player.id)!;
  assert.equal(command.action, 'shoot');
  assert.ok(command.power! <= 0.9);
});
