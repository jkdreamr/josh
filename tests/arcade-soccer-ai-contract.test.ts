import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, cpuShotChoice } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, FIELD, groundPassPower, groundPassSpeed, nearestCarrier, shotAim, shotTargetZ, STEP } from '../src/os/arcade/games/soccer/logic.ts';

function shootingWorld() {
  const world = createWorld(47);
  world.phase = 'live'; world.restart = null;
  for (const p of world.players) { p.human = true; p.controlled = false; p.x = -30; p.z = 15; }
  const player = world.players[6]!;
  player.human = false; player.x = FIELD.length / 2 - 9; player.z = 0; player.facing = Math.PI / 2;
  world.ball.x = player.x + 0.4; world.ball.z = 0;
  return { world, player };
}

test('shot aiming round-trips goal targets in both directions, with neutral and bounded extremes', () => {
  for (const direction of [-1, 1]) for (const z of [-FIELD.goalWidth * 0.35, 0, FIELD.goalWidth * 0.35]) {
    const aim = shotAim(z, direction);
    assert.ok(Math.abs(Math.hypot(aim.x, aim.z) - 1) < 1e-12);
    assert.ok(Math.abs(shotTargetZ({ z: 5 }, aim) - z) < 1e-12);
  }
  assert.equal(shotTargetZ({ z: 5 }, { x: 0, z: 0 }), -FIELD.goalWidth * 0.24);
  assert.equal(shotTargetZ({ z: -5 }, { x: 0, z: 0 }), FIELD.goalWidth * 0.24);
  assert.equal(shotTargetZ({ z: 0 }, shotAim(100, 1)), FIELD.goalWidth * 0.43);
  assert.equal(shotTargetZ({ z: 0 }, shotAim(-100, -1)), -FIELD.goalWidth * 0.43);
});

test('ground-pass power inverts the calibrated rolling speed, including capped ranges', () => {
  for (const range of [0, 5, 15, 35, 80]) {
    const power = groundPassPower(range);
    assert.ok(Math.abs(power - 0.45) < 1e-12);
    const speed = groundPassSpeed(range) * (0.82 + power * 0.4);
    assert.ok(speed >= 8 && speed <= 25);
    assert.ok(groundPassPower(range, 100) <= 1);
  }
});

test('CPU only kicks for the mechanics carrier, respecting knock-ons, slides and kick cooldowns', () => {
  for (const unavailable of ['touch', 'slide', 'cooldown'] as const) {
    const { world, player } = shootingWorld();
    if (unavailable === 'touch') player.touchCd = 0.3;
    if (unavailable === 'slide') player.slide = { x: 1, z: 0, t: 0.1, won: false };
    if (unavailable === 'cooldown') { player.cooldown = 0.2; player.action = 'kick'; }
    world.lastTouch = player.team;
    assert.equal(nearestCarrier(world), undefined);
    const command = computeAI(world, 'normal', STEP, 0).get(player.id)!;
    assert.ok(!command.pressed || !command.action);
    assert.equal(world.lastTouch, player.team);
  }
  const { world, player } = shootingWorld();
  const carrier = world.players[7]!;
  carrier.human = false; carrier.x = player.x + 0.1; carrier.z = 0; carrier.facing = Math.PI / 2;
  world.carrierId = carrier.id;
  const commands = computeAI(world, 'normal', STEP, 15);
  assert.equal(nearestCarrier(world)?.id, carrier.id);
  assert.equal(commands.get(carrier.id)?.action, 'shoot');
  assert.notEqual(commands.get(player.id)?.action, 'shoot');
});

test('CPU shoots using the shared target-aim inverse', () => {
  const { world, player } = shootingWorld();
  const command = computeAI(world, 'normal', STEP, 0).get(player.id)!;
  assert.equal(command.action, 'shoot');
  const z = shotTargetZ(player, command.aim!);
  assert.ok(Math.abs(z - cpuShotChoice(world, player, 'normal', 0).targetZ) < 1e-12);
});

test('CPU through-ball receiver steers toward the authoritative pass point', () => {
  const { world, player } = shootingWorld();
  player.x = player.z = 0;
  world.ball.x = -10; world.ball.z = 0; world.ball.vx = 12;
  world.lastTouch = player.team; world.passTarget = player.id; world.passPoint = { x: 20, z: 8 };
  const command = computeAI(world, 'normal', STEP, 1).get(player.id)!;
  assert.ok(command.move.x > 0 && command.move.z > 0);
  assert.ok(Math.abs(command.move.x * 8 - command.move.z * 20) < 1e-9);
  assert.deepEqual(world.passPoint, { x: 20, z: 8 });
});
