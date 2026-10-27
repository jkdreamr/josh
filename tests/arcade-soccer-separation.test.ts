import assert from 'node:assert/strict';
import { test } from 'node:test';
import { simulateCpuMatch } from '../src/os/arcade/games/soccer/ai.ts';
import { createWorld, distance, FIELD, separatePlayers, STEP } from '../src/os/arcade/games/soccer/logic.ts';

test('soft separation is deterministic, symmetric, bounded and leaves distant players alone', () => {
  const pair = createWorld(254).players.slice(0, 2);
  for (const p of pair) { p.x = 0; p.z = 0; }
  const copy = structuredClone(pair);
  separatePlayers(pair, STEP); separatePlayers(copy, STEP);
  assert.deepEqual(pair, copy);
  assert.ok(distance(pair[0]!, pair[1]!) > 0.5);
  assert.ok(Math.abs(pair[0]!.x + pair[1]!.x) < 1e-12);
  assert.ok(Math.abs(pair[0]!.z + pair[1]!.z) < 1e-12);
  pair[0]!.x = -10; pair[1]!.x = 10;
  const before = structuredClone(pair);
  separatePlayers(pair, STEP);
  assert.deepEqual(pair, before);
  for (const p of pair) { p.x = FIELD.length / 2 - 0.3; p.z = FIELD.width / 2 - 0.3; }
  separatePlayers(pair, STEP);
  assert.ok(pair.every((p) => Math.abs(p.x) <= FIELD.length / 2 - 0.3 && Math.abs(p.z) <= FIELD.width / 2 - 0.3));
  separatePlayers([], STEP);
});

test('soft separation prevents players clipping within 0.15 metres over a simulated match', () => {
  let minimum = Infinity, samples = 0;
  simulateCpuMatch(254, 'normal', 'normal', 120, (world) => {
    if (world.phase !== 'live') return;
    for (let i = 0; i < world.players.length; i++) for (let j = i + 1; j < world.players.length; j++) {
      minimum = Math.min(minimum, distance(world.players[i]!, world.players[j]!)); samples++;
    }
  });
  assert.ok(samples > 0);
  console.log(`minimum player separation: ${minimum.toFixed(3)} m`);
  assert.ok(minimum > 0.15);
});
