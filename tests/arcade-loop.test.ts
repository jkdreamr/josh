import assert from 'node:assert/strict';
import test from 'node:test';
import { loopSteps, MAX_CATCH_UP, MAX_DT } from '../src/os/arcade/kit/loop-core.ts';

const sum = (steps: number[]) => steps.reduce((a, b) => a + b, 0);

test('a plain loop takes one step, clamped to 1/20 s', () => {
  assert.deepEqual(loopSteps(0, false), [0]);
  assert.deepEqual(loopSteps(1 / 60, false), [1 / 60]);
  assert.deepEqual(loopSteps(0.2, false), [MAX_DT]);
  assert.deepEqual(loopSteps(-1, false), [0]);
  assert.deepEqual(loopSteps(Number.NaN, false), [0]);
});

test('a realtime loop covers a slow frame in steps of at most 1/20 s, up to a quarter second', () => {
  assert.deepEqual(loopSteps(0, true), [0]);
  assert.deepEqual(loopSteps(1 / 60, true), [1 / 60]);
  const slow = loopSteps(0.12, true);
  assert.equal(slow.length, 3);
  assert.ok(slow.every((dt) => dt > 0 && dt <= MAX_DT + 1e-12));
  assert.ok(Math.abs(sum(slow) - 0.12) < 1e-9);
  // exactly a whole number of steps: no sliver left over
  assert.equal(loopSteps(0.1, true).length, 2);
  const stalled = loopSteps(3, true);
  assert.ok(Math.abs(sum(stalled) - MAX_CATCH_UP) < 1e-9);
  assert.equal(stalled.length, Math.round(MAX_CATCH_UP / MAX_DT));
  assert.deepEqual(loopSteps(Number.POSITIVE_INFINITY, true), [0]);
});
