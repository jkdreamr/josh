import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, STEP } from '../src/os/arcade/games/soccer/logic.ts';
import { LUNGE_COMMIT, PERCEPTION_DELAY } from '../src/os/arcade/games/soccer/perception.ts';

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

function advance(world: ReturnType<typeof createWorld>, player: ReturnType<typeof fixture>['player'], tick: number, level: 'easy' | 'hard' = 'hard') {
  player.human = true;
  const frames = Math.round(PERCEPTION_DELAY[level] * 60) + Math.round(LUNGE_COMMIT * 60) + 1;
  for (let i = 0; i < frames; i++, tick++) computeAI(world, level, STEP, tick, 0);
  player.human = false;
  const period = level === 'easy' ? 36 : 11;
  const rosterIndex = world.players.filter((entry) => entry.team === player.team).indexOf(player);
  while ((tick + rosterIndex * 2) % period !== 0) tick++;
  return tick;
}

test('hard reads front and exposed tackle windows instead of tackling protected balls from behind', () => {
  const { world, player, enemy } = fixture();
  let tick = 9;
  tick = advance(world, player, tick);
  const command = () => computeAI(world, 'hard', STEP, tick++, 0).get(player.id)!;
  const front = command();
  assert.equal(front.action, 'tackle'); assert.equal(front.pressed, true);
  player.z = -0.9;
  tick = advance(world, player, tick);
  assert.notEqual(command().action, 'tackle');
  tick = advance(world, player, tick, 'easy');
  assert.equal(computeAI(world, 'easy', STEP, tick++, 0).get(player.id)!.action, 'tackle');
  player.z = 1; enemy.action = 'shield';
  tick = advance(world, player, tick);
  assert.notEqual(command().action, 'tackle');
  enemy.action = 'idle'; player.z = -0.1; world.ball.z = 0.8;
  tick = advance(world, player, tick);
  assert.equal(command().action, 'tackle');
  tick = advance(world, player, tick, 'easy');
  assert.notEqual(computeAI(world, 'easy', STEP, tick++, 0).get(player.id)!.action, 'tackle');
  world.ball.y = 0.9;
  tick = advance(world, player, tick);
  assert.notEqual(command().action, 'tackle');
});

test('window decisions are deterministic and an empty opponent team causes no tackle', () => {
  const { world, player } = fixture();
  let tick = advance(world, player, 9);
  const before = structuredClone(world);
  const first = computeAI(world, 'hard', STEP, tick, 0);
  const second = computeAI(world, 'hard', STEP, tick, 0);
  assert.deepEqual([...first], [...second]);
  assert.deepEqual(world, before);
  world.players = world.players.filter((p) => p.team === 0);
  player.z = 2;
  world.lastToucherId = null; world.carrierId = null;
  tick = advance(world, player, tick + 1);
  assert.notEqual(computeAI(world, 'hard', STEP, tick, 0).get(player.id)!.action, 'tackle');
});
