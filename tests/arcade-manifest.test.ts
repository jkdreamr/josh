// Checks every game folder against the arcade contract (see src/os/arcade/README.md). Runs under plain node.
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';

const root = join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'games');
const categories = ['arcade', 'puzzle', '3d', 'multiplayer'];
const folders = existsSync(root) ? readdirSync(root).filter((f) => statSync(join(root, f)).isDirectory()) : [];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
}

/** Top-level selectors (inside @media/@supports too) and @keyframes names of a stylesheet. */
function cssNames(css: string) {
  const src = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors: string[] = [];
  const keyframes: string[] = [];
  const stack: ('group' | 'rule' | 'frames')[] = [];
  let buf = '';
  for (const ch of src) {
    if (ch === '{') {
      const prelude = buf.trim();
      buf = '';
      const inFrames = stack.includes('frames');
      if (/^@(-webkit-)?keyframes/.test(prelude)) {
        keyframes.push(prelude.split(/\s+/)[1]);
        stack.push('frames');
      } else if (prelude.startsWith('@')) stack.push('group');
      else {
        if (!inFrames && !stack.includes('rule')) selectors.push(...prelude.split(',').map((x) => x.trim()));
        stack.push('rule');
      }
    } else if (ch === '}') {
      stack.pop();
      buf = '';
    } else if (ch === ';' && stack.at(-1) !== 'group') buf = '';
    else buf += ch;
  }
  return { selectors, keyframes };
}

test('games folder exists', () => assert.ok(existsSync(root)));

const ids = new Set<string>();
for (const folder of folders) {
  test(`game ${folder} follows the arcade contract`, async () => {
    const dir = join(root, folder);
    const id = folder.replace(/^_/, '');
    assert.ok(existsSync(join(dir, 'meta.ts')), 'meta.ts is missing');
    assert.ok(existsSync(join(dir, 'index.tsx')), 'index.tsx is missing');

    const { meta } = await import(pathToFileURL(join(dir, 'meta.ts')).href);
    assert.equal(meta.id, id, 'meta.id must equal the folder name');
    assert.match(meta.id, /^[a-z0-9]+(-[a-z0-9]+)*$/, 'id must be lowercase a-z, 0-9 and dashes');
    assert.ok(!ids.has(meta.id), `duplicate id ${meta.id}`);
    ids.add(meta.id);
    for (const k of ['title', 'blurb', 'players', 'controls', 'accent', 'glyph'])
      assert.ok(typeof meta[k] === 'string' && meta[k].trim(), `meta.${k} must be a non-empty string`);
    assert.ok(categories.includes(meta.category), `category must be one of ${categories.join(', ')}`);
    assert.ok(Number.isFinite(meta.order), 'order must be a number');
    assert.match(meta.players, /^\d(-\d)?P$/, "players looks like '1P' or '1-2P'");
    assert.match(meta.glyph, /^[MmLlHhVvCcSsQqTtAaZz0-9.,\s-]+$/, 'glyph must be SVG path data');
    for (const k of ['title', 'blurb', 'controls']) assert.ok(!meta[k].includes('\u2014'), `meta.${k} must not contain an em dash`);

    const index = readFileSync(join(dir, 'index.tsx'), 'utf8');
    assert.match(index, /export default function/, 'index.tsx must default-export the game component');
    assert.doesNotMatch(index, /from ['"]three['"]/, "load three via loadThree()/useThree(), never import 'three' statically");

    for (const file of walk(dir)) {
      const text = readFileSync(file, 'utf8');
      if (/\.(tsx?|css)$/.test(file)) assert.ok(!text.includes('\u2014'), `${file} contains an em dash`);
      if (/\.(tsx?)$/.test(file)) {
        for (const m of text.matchAll(/from ['"](\.\.\/[^'"]+)['"]/g))
          assert.ok(m[1].startsWith('../../kit') || m[1].startsWith('../../types'), `${file} may only import ../../kit and ../../types from outside its folder (got ${m[1]})`);
      }
      if (!file.endsWith('.css')) continue;
      const { selectors, keyframes } = cssNames(text);
      for (const sel of selectors) assert.ok(sel.startsWith(`.g-${id}`), `${file}: selector "${sel}" must start with .g-${id}`);
      for (const k of keyframes) assert.ok(k.startsWith(`g-${id}`), `${file}: @keyframes ${k} must start with g-${id}`);
    }
  });
}
