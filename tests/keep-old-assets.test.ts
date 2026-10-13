import assert from 'node:assert/strict';
import { test } from 'node:test';
import { bootFiles, KEEP_MS, plan, refsIn } from '../scripts/keep-old-assets.ts';

const DAY = 24 * 60 * 60 * 1000;

test('finds every file the built page and scripts refer to', () => {
  const page = '<link rel="stylesheet" href="/_astro/index.zkFG34QT.css"><astro-island component-url="/_astro/OS.ChqdTJMm.js" renderer-url="/_astro/client.CUfHnAYa.js">';
  assert.deepEqual(refsIn(page).sort(), ['OS.ChqdTJMm.js', 'client.CUfHnAYa.js', 'index.zkFG34QT.css']);
  // The shapes Vite writes: static imports, lazy imports, preload lists, workers, and wasm URLs.
  const script = [
    'import{a as b}from"./canvas.BaPSwNg_.js";',
    '()=>We(()=>import("./index.C_25zyHt.js"),__vite__mapDeps([0,1]))',
    'm.f=["_astro/index.PAYuSHbK.js","_astro/three.DhcWLvU1.js"]',
    'new Worker(new URL("/_astro/go.worker-Ddpv7D29.js",import.meta.url),{type:"module"})',
    'var pV="/_astro/tfjs-backend-wasm-BIA8cDLW.wasm"',
    'JSON.parse("./data.json")',
  ].join('\n');
  assert.deepEqual(refsIn(script).sort(), ['canvas.BaPSwNg_.js', 'go.worker-Ddpv7D29.js', 'index.C_25zyHt.js', 'index.PAYuSHbK.js', 'tfjs-backend-wasm-BIA8cDLW.wasm', 'three.DhcWLvU1.js']);
});

test("skips the files an open page already loaded at startup, but not the ones it loads later", () => {
  const files: Record<string, string> = {
    'OS.a.js': 'import"./OS.b.js";',
    'OS.b.js': 'import{x}from"./react.c.js";const g=()=>import("./game.d.js");',
    'react.c.js': '',
    'game.d.js': 'import{y}from"./kit.e.js";',
  };
  const boot = bootFiles('<astro-island component-url="/_astro/OS.a.js"><link href="/_astro/index.css">', (name) => files[name]);
  assert.deepEqual([...boot].sort(), ['OS.a.js', 'OS.b.js', 'index.css', 'react.c.js']);
});

test('keeps the files the live site serves and this build drops, newest first, for a week', () => {
  const now = 100 * DAY;
  const prev = { files: { 'game.v1.js': now - 2 * DAY, 'game.v0.js': now - KEEP_MS - 1, 'game.v2.js': 0, 'shared.js': 0, '../escape.js': now } };
  const { keep, files } = plan(prev, ['game.v2.js', 'OS.v2.js', 'shared.js'], ['game.v3.js', 'OS.v3.js', 'shared.js'], now, new Set(['OS.v2.js']));
  assert.deepEqual(keep, [['game.v2.js', now], ['game.v1.js', now - 2 * DAY]], 'v2 retires now; v1 keeps its date; v0 is past a week');
  assert.deepEqual(files, { 'game.v3.js': 0, 'OS.v3.js': 0, 'shared.js': 0 }, 'this build records its own files, and the caller adds what it kept');
});

test('the first deploy, with no history yet, keeps what the live site serves', () => {
  const { keep } = plan(null, ['game.v1.js', 'worker-v1.js'], ['game.v2.js'], 5);
  assert.deepEqual(keep.map(([name]) => name).sort(), ['game.v1.js', 'worker-v1.js']);
});
