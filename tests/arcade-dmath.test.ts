import assert from 'node:assert/strict';
import { test } from 'node:test';
import { atan, atan2, cos, hypot, powi, sin } from '../src/os/arcade/verify/dmath.ts';

const close = (a: number, b: number, tol = 4e-16) => Math.abs(a - b) <= tol * Math.max(1, Math.abs(b));

test('sin and cos match the engine to within an ulp or two over the angles games use', () => {
  let worst = 0;
  for (let i = -20000; i <= 20000; i++) {
    const x = i * 0.000731 + (i % 7) * 1e-9;
    for (const [mine, theirs] of [[sin(x), Math.sin(x)], [cos(x), Math.cos(x)]]) {
      worst = Math.max(worst, Math.abs(mine - theirs));
      assert.ok(close(mine, theirs), `x=${x}: ${mine} vs ${theirs}`);
    }
  }
  assert.ok(worst < 1e-15, `worst ${worst}`);
  assert.equal(sin(0), 0);
  assert.equal(cos(0), 1);
  assert.ok(Number.isNaN(sin(Number.POSITIVE_INFINITY)));
});

test('atan and atan2 match the engine, quadrants and edges included', () => {
  for (let i = -3000; i <= 3000; i++) {
    const x = i * 0.0137;
    assert.ok(close(atan(x), Math.atan(x)), `atan ${x}`);
    for (const y of [-2.5, -1, -0.3, 0.3, 1, 2.5]) assert.ok(close(atan2(y, x), Math.atan2(y, x)), `atan2 ${y} ${x}`);
  }
  for (const [y, x] of [[0, 1], [0, -1], [1, 0], [-1, 0], [0, 0], [-0, -1], [1, 1], [-1, -1]]) assert.ok(close(atan2(y, x), Math.atan2(y, x)), `atan2 ${y} ${x}`);
});

test('hypot and whole powers are exact arithmetic', () => {
  assert.equal(hypot(3, 4), 5);
  assert.equal(powi(1.1, 3), 1.1 * 1.1 * 1.1);
  assert.equal(powi(2, 10), 1024);
  assert.equal(powi(2, -2), 0.25);
  assert.equal(powi(5, 0), 1);
  assert.ok(Number.isNaN(powi(2, 0.5)));
});

test('the same inputs always give the same bits (no Math.sin, cos, atan2, hypot, exp or pow inside)', async () => {
  const { readFileSync } = await import('node:fs');
  const src = readFileSync(new URL('../src/os/arcade/verify/dmath.ts', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const fn of ['sin', 'cos', 'tan', 'atan', 'atan2', 'hypot', 'exp', 'log', 'pow', 'cbrt']) assert.ok(!new RegExp(`Math\\.${fn}\\(`).test(src), `uses Math.${fn}`);
});

test('semitones are 2^(k/12) for whole k, any octave', async () => {
  const { semitone } = await import('../src/os/arcade/verify/dmath.ts');
  for (let k = -36; k <= 36; k++) assert.ok(close(semitone(k), Math.pow(2, k / 12), 2e-16), `k=${k}`);
  assert.equal(semitone(12), 2);
  assert.equal(semitone(0), 1);
  assert.ok(Number.isNaN(semitone(0.5)));
});
