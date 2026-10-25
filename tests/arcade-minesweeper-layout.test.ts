import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPan, computeLayout, stepCursor, type LayoutInput } from '../src/os/arcade/games/minesweeper/layout.ts';

const hud = { rowW: 270, rowH: 28, colW: 93, colH: 96 };
const base = (over: Partial<LayoutInput>): LayoutInput => ({ w: 464, h: 157, rows: 9, cols: 9, ctrlLeft: 270, ctrlBottom: 40, hud, bar: 0, minCell: 15, maxCell: 64, ...over });
const inside = (a: { x: number; y: number; w: number; h: number }, w: number, h: number) => a.x >= 0 && a.y >= 0 && a.x + a.w <= w && a.y + a.h <= h;

test('the tiny framed laptop window still gets a playable beginner board', () => {
  const L = computeLayout(base({}));
  assert.ok(L.fit >= 15, `cell ${L.fit}`);
  assert.ok(inside(L.view, 464, 157));
  // Never under the control pill.
  assert.ok(L.view.x + L.view.w <= 270 - 8 || L.view.y >= 40);
  // Never under the stats.
  if (L.hud.column) assert.ok(L.view.x >= 10 + hud.colW);
  else assert.ok(L.view.y >= L.hud.y + hud.rowH);
});

test('a phone keeps finger sized squares and pans an expert board instead of shrinking it', () => {
  const L = computeLayout(base({ w: 390, h: 648, rows: 16, cols: 30, ctrlLeft: 120, ctrlBottom: 55, bar: 50, minCell: 40 }));
  assert.equal(L.transposed, true);
  assert.equal(L.base, 40);
  assert.ok(L.cols * L.base > L.view.w || L.rows * L.base > L.view.h);
  assert.ok(L.view.y + L.view.h <= 648 - 10 - 50);
  // Stats go in a row above the board so the board keeps the full width.
  assert.equal(L.hud.column, false);
});

test('a board a few percent too big shrinks to fit instead of panning', () => {
  const L = computeLayout(base({ w: 601, h: 260, rows: 16, cols: 30, ctrlLeft: 405, ctrlBottom: 44, minCell: 13 }));
  assert.ok(L.fit < 13);
  assert.equal(L.base, L.fit);
  const big = computeLayout(base({ w: 601, h: 260, rows: 16, cols: 30, ctrlLeft: 405, ctrlBottom: 44, minCell: 15 }));
  assert.equal(big.base, 15);
});

test('pan centers a small board and keeps a big one covering the view', () => {
  assert.equal(clampPan(-50, 100, 300), 100);
  assert.equal(clampPan(20, 500, 300), 0);
  assert.equal(clampPan(-400, 500, 300), -200);
});

test('arrow keys follow the screen on a rotated board', () => {
  assert.deepEqual(stepCursor([3, 3], 0, 1, false, 16, 30), [3, 4]);
  assert.deepEqual(stepCursor([3, 3], 0, 1, true, 16, 30), [4, 3]);
  assert.deepEqual(stepCursor([0, 0], -1, -1, false, 16, 30), [0, 0]);
  assert.deepEqual(stepCursor([15, 29], 1, 1, true, 16, 30), [15, 29]);
});
