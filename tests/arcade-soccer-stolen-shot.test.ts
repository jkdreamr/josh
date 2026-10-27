import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CONTROL_SPEED, createWorld, nearestCarrier, STEP, stepWorld, TEAM_SIZE, type Command } from '../src/os/arcade/games/soccer/logic.ts';

test('a fast shot cannot be gathered cleanly by goal-side defenders', () => {
  const violations: string[] = [];
  for (const gap of [1.0, 1.4, 1.8, 2.5]) {
    for (let seed = 1; seed <= 50; seed++) {
      const world = createWorld(seed);
      world.phase = 'live';
      world.restart = null;
      for (const player of world.players) {
        player.x = -40;
        player.z = player.id;
        player.human = false;
        player.controlled = false;
      }
      const shooter = world.players[9]!;
      shooter.human = shooter.controlled = true;
      world.controlled[0] = shooter.id;
      shooter.x = 30;
      shooter.z = 0;
      shooter.facing = Math.PI / 2;
      world.ball.x = 30.45;
      world.ball.z = 0;
      world.carrierId = shooter.id;
      const defender = world.players[TEAM_SIZE + 3]!;
      defender.x = 30 + gap;
      defender.z = 0.1;
      defender.facing = -Math.PI / 2;
      stepWorld(world, STEP, new Map([[shooter.id, { move: { x: 1, z: 0 } }]]));
      stepWorld(world, STEP, new Map<number, Command>([[shooter.id, {
        move: { x: 1, z: 0 },
        action: 'shoot',
        pressed: true,
        power: 1,
        aim: { x: 1, z: 0 },
      }]]));

      const shotSpeed = Math.hypot(world.ball.vx, world.ball.vz);
      if (shotSpeed < 3 && world.lastToucherId !== defender.id) {
        violations.push(`gap ${gap}, seed ${seed}: shot speed dropped to ${shotSpeed.toFixed(2)} m/s`);
      }
      for (let frame = 0; frame < 15; frame++) {
        const relativeSpeed = Math.hypot(world.ball.vx - defender.vx, world.ball.vz - defender.vz, world.ball.vy);
        if (nearestCarrier(world)?.id === defender.id && relativeSpeed > CONTROL_SPEED) {
          violations.push(`gap ${gap}, seed ${seed}, frame ${frame}: defender gathered at ${relativeSpeed.toFixed(2)} m/s`);
          break;
        }
        stepWorld(world, STEP, new Map([[shooter.id, { move: { x: 0, z: 0 } }]]));
      }
    }
  }
  assert.deepEqual(violations, [], violations.slice(0, 12).join('\n'));
});
