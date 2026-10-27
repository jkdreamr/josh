import assert from 'node:assert/strict';
import test from 'node:test';
import { renderPixelRatio } from '../src/os/laptop3d/pixels.ts';

test('pixel ratio follows DPR while respecting the performance cap', () => {
  assert.equal(renderPixelRatio({ dpr: 2, width: 1272, height: 837, maxDim: 8192 }), 2);
  assert.equal(renderPixelRatio({ dpr: 3, width: 1272, height: 837, maxDim: 8192 }), 2);
  assert.equal(renderPixelRatio({ dpr: 6, width: 424, height: 279, maxDim: 8192 }), 2);
});

test('pixel ratio accounts for reduced browser zoom and stale DPR', () => {
  assert.equal(renderPixelRatio({ dpr: 0.5, width: 5088, height: 3348, maxDim: 8192 }), 0.5);
  const ratio = renderPixelRatio({ dpr: 2, width: 5088, height: 3348, maxDim: 8192 });
  assert.ok(5088 * ratio <= 8192);
  assert.ok(5088 * 3348 * ratio ** 2 <= 4096 ** 2);
});

test('pixel ratio normalizes invalid or unusually small DPR values', () => {
  assert.equal(renderPixelRatio({ dpr: 0.1, width: 1272, height: 837, maxDim: 8192 }), 0.25);
  assert.equal(renderPixelRatio({ dpr: 0, width: 1272, height: 837, maxDim: 8192 }), 1);
  assert.equal(renderPixelRatio({ dpr: Number.NaN, width: 1272, height: 837, maxDim: 8192 }), 1);
});

test('pixel ratio respects dimensions even when that requires going below the minimum', () => {
  const ratio = renderPixelRatio({ dpr: 2, width: 20000, height: 100, maxDim: 8192, min: 0.5 });
  assert.ok(ratio < 0.5);
  assert.ok(20000 * ratio <= 8192);
});
