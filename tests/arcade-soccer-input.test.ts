import assert from 'node:assert/strict';
import { test } from 'node:test';
import { IDENTITY_BASIS, screenToWorld, type ViewBasis } from '../src/os/arcade/games/soccer/input.ts';

test('identity view basis leaves input unchanged', () => {
  assert.deepEqual(screenToWorld({ x: 0.35, z: -0.8 }, IDENTITY_BASIS), { x: 0.35, z: -0.8 });
});

test('broadcast basis maps screen directions onto the field', () => {
  const basis: ViewBasis = { right: { x: -1, z: 0 }, forward: { x: 0, z: 1 } };
  assert.deepEqual(screenToWorld({ x: 1, z: 0 }, basis), { x: -1, z: 0 });
  assert.deepEqual(screenToWorld({ x: 0, z: -1 }, basis), { x: 0, z: 1 });
  assert.deepEqual(screenToWorld({ x: 0, z: 1 }, basis), { x: 0, z: -1 });
});

test('portrait basis maps screen directions onto the field', () => {
  const basis: ViewBasis = { right: { x: 0, z: 1 }, forward: { x: 1, z: 0 } };
  assert.deepEqual(screenToWorld({ x: 0, z: -1 }, basis), { x: 1, z: 0 });
  assert.deepEqual(screenToWorld({ x: 1, z: 0 }, basis), { x: 0, z: 1 });
});
