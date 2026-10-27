import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, STEP } from '../src/os/arcade/games/soccer/logic.ts';

function fixture() {
  const world = createWorld(254);
  world.phase = 'live'; world.restart = null;
  for (const p of world.players) { p.human = true; p.controlled = false; p.x = -30 + p.id; p.z = -25; }
  const player = world.players[1]!, enemy = world.players[12]!;
  player.human = false; player.x = 0; player.z = 1;
  enemy.x = enemy.z = enemy.facing = 0;
  world.ball.x = 0; world.ball.z = 0.4;
  world.carrierId = world.lastToucherId = enemy.id; world.lastTouch = enemy.team;
  return { world, player, enemy };
}

test('hard reads front and exposed tackle windows instead of tackling protected balls from behind', () => {
  const { world, player, enemy } = fixture();
  let tick = 9;
  const command = () => computeAI(world, 'hard', STEP, tick++, 0).get(player.id)!;
  const front = command();
  assert.equal(front.action, 'tackle'); assert.equal(front.pressed, true);
  player.z = -0.9;
  assert.notEqual(command().action, 'tackle');
  assert.equal(computeAI(world, 'easy', STEP, tick++, 0).get(player.id)!.action, 'tackle');
  player.z = 1; enemy.action = 'shield';
  assert.notEqual(command().action, 'tackle');
  enemy.action = 'idle'; player.z = -0.1; world.ball.z = 0.8;
  assert.equal(command().action, 'tackle');
  assert.notEqual(computeAI(world, 'easy', STEP, tick++, 0).get(player.id)!.action, 'tackle');
  world.ball.y = 0.9;
  assert.notEqual(command().action, 'tackle');
});

test('window decisions are deterministic and an empty opponent team causes no tackle', () => {
  const { world, player } = fixture();
  const before = structuredClone(world);
  assert.deepEqual([...computeAI(world, 'hard', STEP, 9, 0)], [...computeAI(world, 'hard', STEP, 9, 0)]);
  assert.deepEqual(world, before);
  world.players = world.players.filter((p) => p.team === 0);
  player.z = 2;
  world.lastToucherId = null; world.carrierId = null;
  assert.notEqual(computeAI(world, 'hard', STEP, 10, 0).get(player.id)!.action, 'tackle');
});
