import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import { deal, imposterCount, maxImposters, secretsFor, vote } from '../src/os/arcade/games/imposter/logic.ts';
import { CATEGORIES, CATEGORY_IDS } from '../src/os/arcade/games/imposter/words.ts';

test('imposters stay a minority', () => {
  assert.deepEqual([3, 4, 5, 6, 7, 8, 20].map(maxImposters), [1, 1, 2, 2, 3, 3, 3]);
  assert.equal(imposterCount(3, 4), 1);
  assert.equal(imposterCount(2, 6), 2);
  assert.equal(imposterCount(0, 6), 1);
});

test('deal picks the right number of distinct imposters and a first speaker', () => {
  const rng = mulberry32(11);
  for (let n = 3; n <= 20; n++) {
    for (const want of [1, 2, 3]) {
      const round = deal(n, want, { word: 'Pizza', category: 'food' }, rng);
      assert.equal(round.imposters.length, imposterCount(want, n));
      assert.equal(new Set(round.imposters).size, round.imposters.length);
      assert.ok(round.imposters.every((i) => i >= 0 && i < n));
      assert.deepEqual(round.imposters, [...round.imposters].sort((a, b) => a - b));
      assert.ok(round.first >= 0 && round.first < n);
      assert.equal(round.word, 'Pizza');
    }
  }
});

test('every seat can be the imposter', () => {
  const rng = mulberry32(5);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) seen.add(deal(5, 1, { word: 'Dog', category: 'animals' }, rng).imposters[0]);
  assert.equal(seen.size, 5);
});

test('votes: innocent loses, the last imposter caught ends it', () => {
  const round = { word: 'Beach', category: 'places' as const, imposters: [1, 3], first: 0 };
  assert.equal(vote(round, [], 0), 'innocent');
  assert.equal(vote(round, [], 1), 'caught');
  assert.equal(vote(round, [1], 3), 'caught-all');
  assert.equal(vote({ ...round, imposters: [2] }, [], 2), 'caught-all');
});

test('word lists are full and clean', () => {
  for (const id of CATEGORY_IDS) {
    const words = CATEGORIES[id].words;
    assert.ok(words.length >= 30, `${id} has at least 30 words`);
    assert.equal(new Set(words.map((w) => w.toLowerCase())).size, words.length, `${id} has no duplicates`);
    for (const w of words) assert.match(w, /^[A-Z0-9][A-Za-z0-9 '.-]*$/, `${id}: "${w}" is a clean word`);
  }
  assert.equal(secretsFor([]).length, CATEGORY_IDS.reduce((n, id) => n + CATEGORIES[id].words.length, 0));
  assert.ok(secretsFor(['food']).every((s) => s.category === 'food'));
});
