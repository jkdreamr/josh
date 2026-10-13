import assert from 'node:assert/strict';
import { test } from 'node:test';
import { GUARD_MS, isChunkError, reloadInto, RESUME_MS, takeResume, trackScreen } from '../src/os/reload.ts';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test('a file missing after a deploy is told apart from a game that crashed', () => {
  // What each engine actually throws when a lazily imported file 404s.
  assert.ok(isChunkError(new TypeError('Failed to fetch dynamically imported module: https://joshuakoo.xyz/_astro/index.C_25zyHt.js')));
  assert.ok(isChunkError(new TypeError('error loading dynamically imported module: https://joshuakoo.xyz/_astro/index.C_25zyHt.js')));
  assert.ok(isChunkError(new TypeError('Importing a module script failed.')));
  assert.ok(isChunkError(new Error('Unable to preload CSS for /_astro/index.zkFG34QT.css')));
  assert.ok(!isChunkError(new TypeError("Cannot read properties of undefined (reading 'x')")));
  assert.ok(!isChunkError(new RangeError('Maximum call stack size exceeded')));
  assert.ok(!isChunkError(null));
  assert.ok(!isChunkError({ message: 'Failed to fetch dynamically imported module' }), 'only real errors or strings');
});

test('a reload brings the visitor back to the game they were opening, once', () => {
  const store = memory();
  let reloads = 0;
  const reload = () => reloads++;
  trackScreen(() => ({ fullscreen: true }));
  assert.equal(reloadInto({ app: 'arcade', args: { play: 'target-range' } }, { store, now: 1_000_000, reload }), true);
  assert.equal(reloads, 1);
  assert.deepEqual(takeResume(store, 1_002_000), { app: 'arcade', args: { play: 'target-range' }, fullscreen: true });
  assert.equal(takeResume(store, 1_002_000), null, 'read once');
  trackScreen(() => ({ fullscreen: false }));
});

test('a file missing from the live deploy too never loops', () => {
  const store = memory();
  let reloads = 0;
  const reload = () => reloads++;
  const resume = { app: 'chrome' as const, args: { url: 'chrome://games/dino' } };
  assert.equal(reloadInto(resume, { store, now: 0, reload }), true);
  assert.equal(reloadInto(resume, { store, now: GUARD_MS - 1, reload }), false, 'the reloaded page fails again: show the error instead');
  assert.equal(reloads, 1);
  assert.equal(reloadInto(resume, { store, now: GUARD_MS - 1, reload, force: true }), true, 'Try Again always reloads');
  assert.equal(reloadInto(resume, { store, now: GUARD_MS * 3, reload }), true, 'a later deploy can reload again');
  assert.equal(reloads, 3);
});

test('without storage there is no loop guard, so only Try Again reloads', () => {
  let reloads = 0;
  const reload = () => reloads++;
  const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); }, removeItem: () => {} };
  assert.equal(reloadInto({ app: 'arcade' }, { store: null, reload }), false);
  assert.equal(reloadInto({ app: 'arcade' }, { store: blocked, reload }), false);
  assert.equal(reloadInto({ app: 'arcade' }, { store: blocked, reload, force: true }), true);
  assert.equal(reloads, 1);
});

test('a stale or garbled resume is ignored', () => {
  const store = memory();
  store.setItem('os:resume', JSON.stringify({ app: 'arcade', args: { play: 'snake' }, at: 0 }));
  assert.equal(takeResume(store, RESUME_MS + 1), null, 'too old: a tab restored much later boots normally');
  store.setItem('os:resume', '{not json');
  assert.equal(takeResume(store, 0), null);
  store.setItem('os:resume', JSON.stringify({ args: {}, at: 0 }));
  assert.equal(takeResume(store, 0), null, 'no app');
  assert.equal(takeResume(null, 0), null);
});
