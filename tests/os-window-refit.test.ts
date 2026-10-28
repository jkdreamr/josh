import assert from 'node:assert/strict';
import { test } from 'node:test';
import { refit } from '../src/os/placement.ts';

const TOP = 26;
const DOCK = 78;

test('a window that fit the old screen stays on screen and clear of the dock when it shrinks', () => {
  const prev = { w: 1120, h: 700 };
  const next = { w: 990, h: 618 };
  const win = { x: 230, y: 60, w: 880, h: 560 };
  assert.ok(win.x + win.w <= prev.w - 8 && win.y + win.h <= prev.h - DOCK);
  const r = refit(win, prev, next, TOP, DOCK);
  assert.ok(r.x >= 8 && r.x + r.w <= next.w - 8, `x ${r.x}..${r.x + r.w}`);
  assert.ok(r.y >= TOP + 4 && r.y + r.h <= next.h - DOCK, `y ${r.y}..${r.y + r.h}`);
  assert.equal(r.w, win.w);
});

test('a window wider than the new screen shrinks to fit inside it', () => {
  const r = refit({ x: 20, y: 40, w: 1000, h: 500 }, { w: 1100, h: 700 }, { w: 700, h: 500 }, TOP, DOCK);
  assert.equal(r.w, 684);
  assert.equal(r.x, 8);
  assert.ok(r.y + r.h <= 500 - DOCK);
});

test('windows that still fit do not move', () => {
  const win = { x: 100, y: 50, w: 400, h: 300 };
  assert.deepEqual(refit(win, { w: 1100, h: 700 }, { w: 1000, h: 640 }, TOP, DOCK), win);
  assert.deepEqual(refit(win, { w: 1000, h: 640 }, { w: 1400, h: 880 }, TOP, DOCK), win);
});

test('a window dragged partly off screen only stays reachable', () => {
  const win = { x: 900, y: 300, w: 400, h: 300 };
  const r = refit(win, { w: 1100, h: 700 }, { w: 1000, h: 640 }, TOP, DOCK);
  assert.equal(r.x, 800);
  assert.equal(r.y, 300);
  assert.equal(r.w, 400);
  assert.equal(r.h, 300);
});
