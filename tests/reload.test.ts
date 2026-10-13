import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOf, isLoadError, LoadError, reloadedRecently, reloadInto, RECENT_MS, RESUME_MS, tagLoad, takeResume, trackScreen } from '../src/os/reload.ts';

function memory() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

test('code that failed to load is told apart from a game that crashed', async () => {
  // Wrapped imports are recognized whatever the browser says, including a module that threw while loading.
  const failed = await tagLoad(() => Promise.reject(new TypeError('Load failed')))().catch((e: unknown) => e);
  assert.ok(failed instanceof LoadError && isLoadError(failed));
  assert.equal(await tagLoad(() => Promise.resolve(7))(), 7);
  // Unwrapped imports fall back to what each engine says.
  assert.ok(isLoadError(new TypeError('Failed to fetch dynamically imported module: https://joshuakoo.xyz/_astro/index.C_25zyHt.js')));
  assert.ok(isLoadError(new TypeError('error loading dynamically imported module: https://joshuakoo.xyz/_astro/index.C_25zyHt.js')));
  assert.ok(isLoadError(new TypeError('Importing a module script failed.')));
  assert.ok(isLoadError(new Error('Unable to preload CSS for /_astro/index.zkFG34QT.css')));
  assert.ok(!isLoadError(new TypeError("Cannot read properties of undefined (reading 'x')")));
  assert.ok(!isLoadError(null));
});

test('a reload comes back to the game being opened, in full screen if it was', () => {
  const store = memory();
  let reloads = 0;
  trackScreen(() => ({ fullscreen: true }));
  reloadInto({ app: 'arcade', args: { play: 'target-range' } }, { store, now: 1_000_000, reload: () => reloads++ });
  trackScreen(() => ({ fullscreen: false }));
  assert.equal(reloads, 1);
  assert.deepEqual(takeResume(store, 1_002_000), { app: 'arcade', args: { play: 'target-range' }, fullscreen: true });
  assert.equal(takeResume(store, 1_002_000), null, 'read once');
});

test('a file still missing right after a reload is reported as a problem, not an update', () => {
  const store = memory();
  assert.equal(reloadedRecently(store, 0), false);
  reloadInto({ app: 'chrome' }, { store, now: 10_000, reload: () => {} });
  assert.equal(reloadedRecently(store, 10_000 + RECENT_MS - 1), true);
  assert.equal(reloadedRecently(store, 10_000 + RECENT_MS), false);
});

test('blocked storage still reloads, just without coming back to the same place', () => {
  let reloads = 0;
  const blocked = { getItem: () => { throw new Error('SecurityError'); }, setItem: () => { throw new Error('SecurityError'); }, removeItem: () => {} };
  reloadInto({ app: 'arcade' }, { store: blocked, reload: () => reloads++ });
  reloadInto({ app: 'arcade' }, { store: null, reload: () => reloads++ });
  assert.equal(reloads, 2);
  assert.equal(takeResume(blocked, 0), null);
  assert.equal(reloadedRecently(blocked, 0), false);
});

test('a stale or garbled resume is ignored', () => {
  const store = memory();
  store.setItem('os:resume', JSON.stringify({ app: 'arcade', args: { play: 'snake' }, at: 0 }));
  assert.equal(takeResume(store, RESUME_MS + 1), null, 'too old: a tab restored much later boots normally');
  store.setItem('os:resume', '{not json');
  assert.equal(takeResume(store, 0), null);
  store.setItem('os:resume', JSON.stringify({ args: {}, at: 0 }));
  assert.equal(takeResume(store, 0), null, 'no app');
});

test('the build a page runs is read from its app script', () => {
  assert.equal(buildOf('<astro-island uid="x" component-url="/_astro/OS.ChqdTJMm.js" renderer-url="/_astro/client.js">'), '/_astro/OS.ChqdTJMm.js');
  assert.equal(buildOf('<html></html>'), null);
});
