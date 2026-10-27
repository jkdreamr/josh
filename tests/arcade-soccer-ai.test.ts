import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, keeperTarget, simulateCpuMatch } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, stepWorld } from '../src/os/arcade/games/soccer/logic.ts';

test('human players never receive AI movement', () => {
  const g = createWorld();
  const commands = computeAI(g, 'normal', 1 / 60, 1);
  assert.equal(commands.has(g.players[1]!.id), false);
  assert.ok([...commands.keys()].every((id) => !g.players[id]!.human));
});

test('players respect the sprint speed cap', () => {
  simulateCpuMatch(1234, 'hard', 'easy', 8, (world) => {
    for (const p of world.players) assert.ok(Math.hypot(p.vx, p.vz) <= 8.01);
  });
});

test('seeded four-minute halves have plausible average scoring', () => {
  let total = 0;
  for (const seed of [2, 17, 31, 47, 59, 71, 89, 103]) {
    const g = simulateCpuMatch(seed, 'normal', 'normal', 480);
    assert.equal(g.phase, 'full-time');
    assert.ok(g.score[0] + g.score[1] <= 15);
    total += g.score[0] + g.score[1];
  }
  assert.ok(total / 8 >= 1 && total / 8 <= 15, `average goals: ${total / 8}`);
});

test('keeper shades toward the predicted ball crossing and steps out one-on-one', () => {
  const g = createWorld();
  const keeper = g.players[5]!;
  g.ball.x = 10;
  g.ball.z = -1;
  g.ball.vx = 10;
  g.ball.vz = 2;
  const intercept = keeperTarget(g, keeper);
  assert.ok(intercept.z > 0);
  const normalX = intercept.x;
  g.ball.x = 15;
  const oneOnOneX = keeperTarget(g, keeper).x;
  assert.ok(oneOnOneX < normalX);
});

test('hard CPU wins more than it loses across seeded four-minute halves', () => {
  let wins = 0;
  let losses = 0;
  for (let seed = 1; seed <= 10; seed++) {
    const game = simulateCpuMatch(seed * 113, 'hard', 'easy', 480);
    if (game.score[0] > game.score[1]) wins++;
    if (game.score[0] < game.score[1]) losses++;
  }
  assert.ok(wins > losses + 2, `hard wins ${wins}, loses ${losses}`);
});

test('CPU carrier completes a progressive pass to a teammate', () => {
  const g = createWorld(47);
  g.phase = 'live';
  g.restart = null;
  const carrier = g.players[1]!;
  const receiver = g.players[2]!;
  carrier.human = false;
  carrier.controlled = false;
  carrier.x = -5; carrier.z = 0;
  g.ball.x = -4.7; g.ball.z = 0;
  receiver.x = 0; receiver.z = 0; receiver.slot = 'DEF';
  for (const p of g.players.filter((player) => player.team === 1)) {
    p.x = 14 + p.id * 0.2;
    p.z = 10;
  }
  const command = computeAI(g, 'hard', 1 / 60, 0, 0).get(carrier.id)!;
  assert.ok(command.action === 'pass' || command.action === 'through');
  stepWorld(g, 1 / 60, new Map([[carrier.id, command]]));
  assert.ok(g.kickEvent);
  let completed = false;
  for (let i = 0; i < 180; i++) {
    stepWorld(g, 1 / 60);
    if (g.players.some((p) => p.team === carrier.team && p.id !== carrier.id && distance(p, g.ball) < 0.64)) {
      completed = true;
      break;
    }
  }
  assert.ok(completed, 'expected a teammate to control the pass');
});
