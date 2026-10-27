import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createWorld, tackleWindow } from '../src/os/arcade/games/soccer/logic.ts';

test('shared tackle window includes front, side, behind, shielding, exposure, reach and height', () => {
  const world = createWorld(254), player = world.players[1]!, enemy = world.players[12]!;
  world.players = [player, enemy];
  enemy.x = enemy.z = enemy.facing = world.ball.x = 0; world.ball.z = 0.4;
  player.x = 0; player.z = 1;
  assert.equal(tackleWindow(world, player).probability, 0.55);
  player.x = 1; player.z = 0;
  assert.equal(tackleWindow(world, player).probability, 0.3);
  player.x = 0; player.z = -0.9;
  assert.equal(tackleWindow(world, player).probability, 0.15 * 0.65);
  player.z = 1; enemy.action = 'shield';
  assert.equal(tackleWindow(world, player).probability, 0.55 * 0.4);
  world.ball.z = 0.8;
  assert.equal(tackleWindow(world, player).probability, 1);
  world.ball.y = 0.75;
  assert.equal(tackleWindow(world, player).inReach, false);
  world.ball.y = 0.11; player.z = 3;
  assert.equal(tackleWindow(world, player).inReach, false);
  world.players = [player];
  assert.equal(tackleWindow(world, player).enemy, undefined);
  assert.ok(Number.isFinite(tackleWindow(world, player).probability));
});
