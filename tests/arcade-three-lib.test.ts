import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const gamesRoot = join(process.cwd(), 'src/os/arcade/games');
const facadePath = join(process.cwd(), 'src/os/arcade/kit/three-lib.ts');

function sourceFiles(path: string): string[] {
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = join(path, entry.name);
    if (entry.isDirectory()) return sourceFiles(fullPath);
    return entry.isFile() && /\.(ts|tsx)$/.test(entry.name) ? [fullPath] : [];
  });
}

test('three.js namespace references are exported from the arcade facade', () => {
  const facade = readFileSync(facadePath, 'utf8');
  const exportBlock = facade.match(/export\s*\{([^}]*)\}\s*from\s*['"]three['"]/s)?.[1];
  assert.ok(exportBlock, 'three-lib.ts must re-export named classes from three');
  const exported = new Set(exportBlock.split(',').map((name) => name.trim().split(/\s+as\s+/)[0]));
  const missing = new Set<string>();

  for (const file of sourceFiles(gamesRoot)) {
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/\bTHREE\.([A-Z][A-Za-z0-9_]*)/g)) {
      if (!exported.has(match[1]!)) missing.add(match[1]!);
    }
  }

  assert.deepEqual([...missing].sort(), []);
});
