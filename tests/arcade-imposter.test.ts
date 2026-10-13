import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import { canSteal, cardFor, clueOrder, deal, imposterCount, maxImposters, pairsFor, playersFor, roundPoints, secretsFor, vote } from '../src/os/arcade/games/imposter/logic.ts';
import { CATEGORIES, CATEGORY_IDS } from '../src/os/arcade/games/imposter/words.ts';

const clean = /^[A-Z0-9][A-Za-z0-9 '.-]*$/;

test('imposters stay a minority', () => {
  assert.deepEqual([3, 4, 5, 6, 7, 8, 20].map(maxImposters), [1, 1, 2, 2, 3, 3, 3]);
  assert.equal(imposterCount(3, 4), 1);
  assert.equal(imposterCount(2, 6), 2);
  assert.equal(imposterCount(0, 6), 1);
  for (const k of [1, 2, 3]) {
    assert.equal(playersFor(k), 2 * k + 1);
    assert.equal(maxImposters(playersFor(k)) >= k, true, `${playersFor(k)} players seat ${k}`);
    assert.equal(maxImposters(playersFor(k) - 1) < k || k === 1, true, `${playersFor(k) - 1} players can't seat ${k}`);
  }
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
      assert.equal(round.decoy, undefined);
    }
  }
});

test('every seat can be the imposter', () => {
  const rng = mulberry32(5);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) seen.add(deal(5, 1, { word: 'Dog', category: 'animals' }, rng).imposters[0]);
  assert.equal(seen.size, 5);
});

test('cards: the crew sees the word, the imposter a redacted card, or a close word that looks the same', () => {
  const round = deal(5, 1, { word: 'Beach', category: 'places' }, mulberry32(3));
  const bad = round.imposters[0];
  for (let i = 0; i < 5; i++) assert.deepEqual(cardFor(round, i), i === bad ? { kind: 'imposter' } : { kind: 'word', word: 'Beach' });

  const close = deal(6, 2, { word: 'Beach', decoy: 'Pool', category: 'places' }, mulberry32(9));
  assert.deepEqual([close.word, close.decoy].sort(), ['Beach', 'Pool']);
  for (let i = 0; i < 6; i++) {
    const card = cardFor(close, i);
    assert.equal(card.kind, 'word', 'in Close Word mode nobody is told they are the imposter');
    if (card.kind === 'word') assert.equal(card.word, close.imposters.includes(i) ? close.decoy : close.word);
  }
});

test('either word of a pair can go to the crew', () => {
  const rng = mulberry32(21);
  const crew = new Set<string>();
  for (let i = 0; i < 40; i++) crew.add(deal(4, 1, { word: 'Coffee', decoy: 'Tea', category: 'food' }, rng).word);
  assert.deepEqual([...crew].sort(), ['Coffee', 'Tea']);
});

test('clues go around the circle from the first speaker, skipping anyone voted out', () => {
  const round = { word: 'Owl', category: 'animals' as const, imposters: [2], first: 3 };
  assert.deepEqual(clueOrder(round, 5, []), [3, 4, 0, 1, 2]);
  assert.deepEqual(clueOrder(round, 5, [4, 1]), [3, 0, 2]);
  assert.deepEqual(clueOrder(round, 5, [3]), [4, 0, 1, 2]);
});

test('votes: innocent loses, the last imposter caught ends it', () => {
  const round = { word: 'Beach', category: 'places' as const, imposters: [1, 3], first: 0 };
  assert.equal(vote(round, [], 0), 'innocent');
  assert.equal(vote(round, [], 1), 'caught');
  assert.equal(vote(round, [1], 3), 'caught-all');
  assert.equal(vote({ ...round, imposters: [2] }, [], 2), 'caught-all');
});

test('a caught imposter steals with the word only when they knew they were faking', () => {
  assert.equal(canSteal({ word: 'Beach', category: 'places', imposters: [0], first: 0 }), true);
  assert.equal(canSteal({ word: 'Beach', decoy: 'Pool', category: 'places', imposters: [0], first: 0 }), false);
});

test('points: the crew splits a win, imposters score double when they get away', () => {
  const round = { word: 'Tacos', category: 'food' as const, imposters: [0, 3], first: 1 };
  assert.deepEqual(roundPoints(round, 5, true), [0, 1, 1, 0, 1]);
  assert.deepEqual(roundPoints(round, 5, false), [2, 0, 0, 2, 0]);
});

test('word lists are full, clean and never repeat across categories', () => {
  const everywhere = new Map<string, string>();
  for (const id of CATEGORY_IDS) {
    const words = CATEGORIES[id].words;
    assert.ok(words.length >= 30, `${id} has at least 30 words`);
    assert.equal(new Set(words.map((w) => w.toLowerCase())).size, words.length, `${id} has no duplicates`);
    for (const w of words) {
      assert.match(w, clean, `${id}: "${w}" is a clean word`);
      const other = everywhere.get(w.toLowerCase());
      assert.ok(!other, `"${w}" is in both ${other} and ${id}`);
      everywhere.set(w.toLowerCase(), id);
    }
  }
  assert.equal(secretsFor([]).length, CATEGORY_IDS.reduce((n, id) => n + CATEGORIES[id].words.length, 0));
  assert.ok(secretsFor(['food']).every((s) => s.category === 'food'));
});

test('close word pairs are distinct, clean and plentiful in every category', () => {
  for (const id of CATEGORY_IDS) {
    const pairs = CATEGORIES[id].pairs;
    assert.ok(pairs.length >= 15, `${id} has at least 15 pairs`);
    const keys = new Set<string>();
    for (const [a, b] of pairs) {
      assert.match(a, clean, `${id}: "${a}" is clean`);
      assert.match(b, clean, `${id}: "${b}" is clean`);
      assert.notEqual(a.toLowerCase(), b.toLowerCase(), `${id}: ${a} pairs with something else`);
      const key = [a, b].map((w) => w.toLowerCase()).sort().join('|');
      assert.ok(!keys.has(key), `${id}: ${a} and ${b} appear twice`);
      keys.add(key);
    }
  }
  const food = pairsFor(['food']);
  assert.ok(food.length && food.every((s) => s.category === 'food' && typeof s.decoy === 'string'));
  assert.equal(pairsFor([]).length, CATEGORY_IDS.reduce((n, id) => n + CATEGORIES[id].pairs.length, 0));
});
