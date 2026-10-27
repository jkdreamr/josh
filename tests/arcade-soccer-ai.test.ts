import assert from 'node:assert/strict';
import { test } from 'node:test';
import { computeAI, simulateCpuMatch } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld } from '../src/os/arcade/games/soccer/logic.ts';

test('human players never receive AI movement', () => {
  const g = createWorld();
  const commands = computeAI(g, 'normal', 1 / 60, 1);
  assert.equal(commands.has(g.players[1]!.id), false);
  assert.ok([...commands.keys()].every((id) => !g.players[id]!.human));
});

test('players respect the sprint speed cap', () => {
  const g = createWorld();
  const fast = simulateCpuMatch(1234, 'hard', 'easy', 8);
  for (const p of [...g.players, ...fast.players]) assert.ok(Math.hypot(p.vx, p.vz) <= 8.01);
});

test('seeded cpu matches terminate with bounded scoring', () => {
  for (const seed of [2, 17]) {
    const g = simulateCpuMatch(seed, 'normal', 'normal', 20);
    assert.equal(g.phase, 'full-time');
    assert.ok(g.score[0] + g.score[1] <= 15);
  }
});
