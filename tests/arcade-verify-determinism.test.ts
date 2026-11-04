// Every ranked game's replay must come out the same in every browser and in the Worker (see verify/dmath.ts): the code
// a verifier runs may not use Math whose last bit can differ between engines.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';

const root = resolve(import.meta.dirname, '..');
const registry = join(root, 'src/os/arcade/verify/registry.ts');
const BANNED = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|sinh|cosh|tanh|asinh|acosh|atanh|hypot|exp|expm1|log|log1p|log2|log10|pow|cbrt|fround)\s*\(|\*\*/;

const strip = (src: string) => src
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:])\/\/.*$/gm, '$1')
  .replace(/`(?:\\[\s\S]|[^`\\])*`|'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"/g, '""');

/** Every file `file` imports at run time (not `import type`), relative imports only, followed all the way down. */
function reach(file: string, seen = new Set<string>()) {
  if (seen.has(file)) return seen;
  seen.add(file);
  const src = readFileSync(file, 'utf8');
  for (const m of src.matchAll(/^\s*(import|export)\s+(type\s+)?[^'"]*?from\s+['"](\.[^'"]+)['"]/gm)) {
    if (m[2]) continue;
    let target = resolve(dirname(file), m[3]);
    if (!existsSync(target)) for (const ext of ['.ts', '.tsx', '/index.ts']) if (existsSync(target + ext)) target += ext;
    if (existsSync(target)) reach(target, seen);
  }
  return seen;
}

test('the code every verifier replays uses no Math that can differ between browsers', () => {
  const games = [...readFileSync(registry, 'utf8').matchAll(/from\s+'(\.\.\/[^']+verify\.ts)'/g)].map((m) => resolve(dirname(registry), m[1]));
  assert.ok(games.length >= 1);
  const offenders: string[] = [];
  for (const entry of games) {
    for (const file of reach(entry)) {
      const lines = strip(readFileSync(file, 'utf8')).split('\n');
      lines.forEach((line, i) => {
        if (BANNED.test(line)) offenders.push(`${file.slice(root.length + 1)}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
  }
  assert.deepEqual(offenders, [], `replayed code must use verify/dmath.ts instead:\n${offenders.join('\n')}`);
});

test('the check itself catches what it should', () => {
  for (const bad of ['x = Math.sin(a)', 'y = Math.pow(2, 3)', 'z = a ** 2', 'Math.hypot (a, b)']) assert.ok(BANNED.test(strip(bad)), bad);
  for (const ok of ['Math.sqrt(a)', 'Math.floor(a)', '// Math.sin(a)', "const s = 'Math.sin('", 'a * b']) assert.ok(!BANNED.test(strip(ok)), ok);
});
