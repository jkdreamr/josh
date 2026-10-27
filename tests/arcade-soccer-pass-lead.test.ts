import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FIELD, groundPassSpeed, groundPassTarget } from '../src/os/arcade/games/soccer/logic.ts';

test('assisted pass leads a runner using the calibrated launch-time horizon', () => {
  const receiver = { x: 15, z: 0, vx: 6, vz: 0 };
  const target = groundPassTarget({ x: 0, z: 0 }, receiver);
  assert.ok(Math.abs(target.x - (15 + 6 * 15 / groundPassSpeed(15))) < 1e-9);
  assert.equal(target.z, 0);
  assert.ok(target.x > receiver.x);
  assert.deepEqual(groundPassTarget({ x: 0, z: 0 }, { ...receiver, vx: 0 }), { x: 15, z: 0 });
});

test('assisted runner predictions stay inside FIELD at every touchline and goal line', () => {
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const receiver = { x: x * (FIELD.length / 2 - 1), z: z * (FIELD.width / 2 - 1), vx: x * 7, vz: z * 7 };
    const target = groundPassTarget({ x: 0, z: 0 }, receiver);
    assert.equal(target.x, x * (FIELD.length / 2 - 0.3));
    assert.equal(target.z, z * (FIELD.width / 2 - 0.3));
  }
  assert.deepEqual(groundPassTarget({ x: 0, z: 0 }, { x: 0, z: 0, vx: 0, vz: 0 }), { x: 0, z: 0 });
});
