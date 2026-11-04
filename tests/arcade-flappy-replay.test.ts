import assert from 'node:assert/strict';
import { test } from 'node:test';
import { autopilot, STEP } from '../src/os/arcade/games/flappy/logic.ts';
import { createReplay, tickReplay, verifyReplay, MAX_RUN_TICKS, RUN_VERSION } from '../src/os/arcade/games/flappy/replay.ts';

export function finishedRun(seed = 42) {
  const run = createReplay(seed);
  while (!run.world.dead && run.tick < MAX_RUN_TICKS) tickReplay(run, run.tick === 0 || (run.world.score < 3 && autopilot(run.world)));
  assert.ok(run.world.dead);
  assert.ok(run.world.score > 0);
  return { score: run.world.score, proof: { seed, version: RUN_VERSION, token: '', ticks: run.tick, flaps: run.flaps }, elapsed: run.tick * STEP * 1000 };
}

test('seeded fixed ticks produce identical completed runs and accept a valid replay', () => {
  const a = finishedRun();
  assert.deepEqual(a, finishedRun());
  assert.deepEqual(verifyReplay(42, a.proof, a.score, a.elapsed), { score: a.score });
});

test('modified score, course, inputs, truncated/extended run and accelerated time are rejected', () => {
  const { proof, score, elapsed } = finishedRun();
  for (const p of [
    { ...proof, seed: 43 }, { ...proof, version: 2 }, { ...proof, flaps: [0] },
    { ...proof, ticks: proof.ticks - 1 }, { ...proof, ticks: proof.ticks + 1 },
    { ...proof, ticks: MAX_RUN_TICKS + 1 }, { ...proof, flaps: [0, 1] },
    { ...proof, flaps: [0, 20, 10] }, { ...proof, flaps: [0, 10.5] },
  ]) assert.ok('error' in verifyReplay(42, p, score, elapsed));
  assert.ok('error' in verifyReplay(42, proof, score + 1, elapsed));
  assert.ok('error' in verifyReplay(42, proof, score, 0));
});

test('the live simulation coalesces too-fast taps instead of disqualifying normal play', () => {
  const run = createReplay(1);
  for (let i = 0; i < 11; i++) tickReplay(run, true);
  assert.deepEqual(run.flaps, [0, 10]);
});
