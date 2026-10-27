import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, cpuShotChoice, LEVEL_NAMES } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, movePlayer, shotAim, shotError, shotOverchargeThreshold, STEP, stepWorld } from '../src/os/arcade/games/soccer/logic.ts';

function fixture() {
  const world = createWorld(47);
  world.phase = 'live'; world.restart = null;
  for (const p of world.players) { p.human = true; p.controlled = false; p.x = -25; p.z = 25; }
  const player = world.players[6]!;
  player.human = false; player.x = FIELD.length / 2 - 9; player.z = 0; player.facing = Math.PI / 2;
  world.ball.x = player.x + 0.4; world.ball.z = 0;
  const keeper = world.players.find((p) => p.team !== player.team && p.slot === 'GK')!;
  keeper.x = FIELD.length / 2 - 1.5; keeper.z = 0;
  return { world, player, keeper };
}

test('shared shot error retains distance, pressure, body, speed, stamina and charge penalties', () => {
  const { world, player, keeper } = fixture();
  const target = { x: FIELD.length / 2, z: 0 };
  const base = 0.03 + 9 * 0.004 + 0.75 * 0.06;
  assert.ok(Math.abs(shotError(world, player, target, 0.75) - base) < 1e-12);
  player.facing = 0; player.vx = 8; player.stamina = 0.5;
  keeper.x = player.x + 1;
  const penalized = base + (Math.PI / 2 - 0.6) * 0.22 + 0.1 + 0.09 + 0.5 * 0.08;
  assert.ok(Math.abs(shotError(world, player, target, 0.75) - penalized) < 1e-12);
  assert.ok(Math.abs(shotError(world, player, target, 0.75, true) - penalized * 0.6) < 1e-12);
  world.players = [player];
  assert.ok(Number.isFinite(shotError(world, player, target, 1)));
  assert.equal(shotError(world, player, target, 5), shotError(world, player, target, 1));
});

test('kicking uses the shared angular error without changing seeded draws', () => {
  const { world, player } = fixture();
  player.facing = 0;
  const target = { x: FIELD.length / 2, z: 2 };
  const angle = Math.atan2(target.z - world.ball.z, target.x - world.ball.x);
  const draw = ((Math.imul(world.seed, 1664525) + 1013904223) >>> 0) / 0x100000000;
  const expected = angle + (draw - 0.5) * shotError(world, player, target, 0.75);
  stepWorld(world, STEP, new Map([[player.id, { move: { x: 0, z: 0 }, aim: shotAim(2, 1), action: 'shoot', pressed: true, power: 0.75 }]]));
  assert.ok(Math.abs(Math.atan2(world.ball.vz, world.ball.vx) - expected) < 1e-10);
});

test('CPU uses a larger aiming inset for a pressured, misaligned, tired shot', () => {
  const { world, player, keeper } = fixture();
  const clear = cpuShotChoice(world, player, 'hard', 0);
  player.facing = 0; player.stamina = 0.2;
  keeper.x = player.x + 1;
  const difficult = cpuShotChoice(world, player, 'hard', 0);
  assert.ok(Math.abs(difficult.targetZ) < Math.abs(clear.targetZ));
  assert.ok(difficult.onTarget >= 0 && difficult.onTarget <= 1 + 1e-12);
});

test('CPU shot choices are deterministic, bounded and below the distance-dependent overcharge threshold', () => {
  for (const level of LEVEL_NAMES) for (const swapped of [false, true]) for (const range of [0.5, 4, 9, 12, 18, 30, 60]) {
    const { world, player } = fixture();
    const dir = swapped ? -1 : 1;
    world.endsSwapped = swapped; player.x = dir * (FIELD.length / 2 - range); player.facing = dir * Math.PI / 2;
    world.ball.x = player.x + dir * 0.4;
    const before = JSON.stringify(world);
    const choice = cpuShotChoice(world, player, level, 13);
    assert.deepEqual(choice, cpuShotChoice(world, player, level, 13));
    assert.equal(JSON.stringify(world), before);
    const prepared = { ...player };
    movePlayer(prepared, { x: 0, z: 0 }, false, true, STEP);
    assert.ok(choice.power < shotOverchargeThreshold(distance(prepared, { x: dir * FIELD.length / 2, z: 0 })));
    assert.ok(Math.abs(choice.targetZ) <= FIELD.goalWidth * 0.43);
    assert.ok(choice.probability >= -1e-12 && choice.probability <= 1 + 1e-12);
  }
  const { world, player } = fixture();
  world.players = [player];
  assert.ok(Number.isFinite(cpuShotChoice(world, player, 'hard', 0).targetZ));
});
