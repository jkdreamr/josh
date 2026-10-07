import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gunzipIfNeeded, parseKataGoModel } from '../src/os/games/katago/model.ts';

test('parses the shipped b10c128 model metadata', async () => {
  const compressed = new Uint8Array(await readFile('public/models/kata1-b10c128-s1141046784-d204142634.bin.gz'));
  const model = parseKataGoModel(await gunzipIfNeeded(compressed));
  assert.equal(model.modelVersion, 8);
  assert.equal(model.numInputChannels, 22);
  assert.equal(model.numInputGlobalChannels, 19);
  assert.equal(model.trunk.numBlocks, 10);
  assert.equal(model.trunk.trunkNumChannels, 128);
});
