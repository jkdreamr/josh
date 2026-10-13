// Content checks for the prompt deck drinking games: Never Have I Ever, Most Likely To, Truth or Dare.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as nhie from '../src/os/arcade/games/never-have-i-ever/prompts.ts';
import * as mlt from '../src/os/arcade/games/most-likely-to/prompts.ts';
import { DARES, TRUTHS, cardsFor, nextSeat } from '../src/os/arcade/games/truth-or-dare/prompts.ts';

const dashes = /[–—]/;

for (const [name, game] of [['never have i ever', nhie], ['most likely to', mlt]] as const) {
  test(`${name}: decks are full, unique and finish the sentence cleanly`, () => {
    const all: string[] = [];
    for (const id of game.DECK_IDS) {
      const prompts: readonly string[] = game.DECKS[id].prompts;
      assert.ok(prompts.length >= 20, `${id} has at least 20 prompts`);
      for (const p of prompts) {
        assert.match(p, /^[a-z]/, `"${p}" starts lowercase`);
        assert.doesNotMatch(p, /[.?!]$/, `"${p}" has no final punctuation`);
        assert.doesNotMatch(p, dashes, `"${p}" has no long dashes`);
        assert.ok(p.length <= 80, `"${p}" fits on a card`);
        all.push(p.toLowerCase());
      }
    }
    assert.equal(new Set(all).size, all.length, 'no prompt appears twice');
  });

  test(`${name}: the 18+ deck is off by default and stored picks are validated`, () => {
    assert.ok(!game.DEFAULT_DECKS.includes('spicy'));
    assert.deepEqual(game.parseDecks(['spicy', 'nope']), ['spicy']);
    assert.deepEqual(game.parseDecks('classic'), game.DEFAULT_DECKS);
    assert.deepEqual(game.parseDecks([]), game.DEFAULT_DECKS);
    assert.ok(game.promptsFor([]).every((p) => p.deck !== 'spicy'));
    assert.ok(game.promptsFor(['spicy']).every((p) => p.deck === 'spicy'));
  });
}

test('truth or dare: cards are unique, punctuated and mild unless asked', () => {
  for (const set of [TRUTHS, DARES]) {
    const all = [...set.mild, ...set.spicy];
    assert.equal(new Set(all).size, all.length);
    for (const c of all) {
      assert.match(c, /^[A-Z]/, `"${c}" starts with a capital`);
      assert.match(c, /[.?]$/, `"${c}" ends a sentence`);
      assert.doesNotMatch(c, dashes);
      assert.ok(c.length <= 100, `"${c}" fits on a card`);
    }
  }
  assert.ok(cardsFor('truth', 'mild').every((c) => !c.spicy && c.kind === 'truth'));
  assert.ok(cardsFor('dare', 'spicy').some((c) => c.spicy));
  assert.equal(cardsFor('dare', 'spicy').length, DARES.mild.length + DARES.spicy.length);
});

test('truth or dare: turns go around the circle', () => {
  assert.equal(nextSeat(0, 3), 1);
  assert.equal(nextSeat(2, 3), 0);
  assert.equal(nextSeat(0, 0), 0);
});
