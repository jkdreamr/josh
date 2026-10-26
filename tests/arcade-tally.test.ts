import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatTally } from '../src/os/arcade/kit/tally.ts';

test('two-side tallies put the leader first by default and honor an explicit lead', () => {
  assert.equal(formatTally([1, 3]), '3 to 1');
  assert.equal(formatTally([1, 3], { lead: 0 }), '1 to 3');
  assert.equal(formatTally([2, 2]), '2 to 2');
  assert.equal(formatTally([1, 3], { to: 'To' }), '3 To 1');
});

test('three- and four-side tallies preserve seat order and use provided names', () => {
  assert.equal(formatTally([0, 1, 1], { names: ['Red', 'Green', 'Blue'] }), 'Red 0 · Green 1 · Blue 1');
  assert.equal(formatTally([0, 1, 1, 0], { names: ['Red', 'Green', 'Blue', 'Gold'] }), 'Red 0 · Green 1 · Blue 1 · Gold 0');
});

test('missing multiplayer names fall back to player numbers', () => {
  assert.equal(formatTally([2, 0, 4, 1]), 'P1 2 · P2 0 · P3 4 · P4 1');
});

test('empty and single-side tallies are concise', () => {
  assert.equal(formatTally([]), '');
  assert.equal(formatTally([7]), '7');
});
