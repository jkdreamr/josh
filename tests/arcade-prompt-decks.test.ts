// Content checks for the prompt deck drinking games: Never Have I Ever, Most Likely To, Truth or Dare.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as nhie from '../src/os/arcade/games/never-have-i-ever/prompts.ts';
import * as mlt from '../src/os/arcade/games/most-likely-to/prompts.ts';
import { DARES, EMPTY, TRUTHS, cardsFor, nextSeat, recordLine } from '../src/os/arcade/games/truth-or-dare/prompts.ts';

const dashes = /[–—]/;
/** Every deck should last a night: at least this many cards. */
const FULL = 30;

for (const [name, game] of [['never have i ever', nhie], ['most likely to', mlt]] as const) {
  test(`${name}: decks are full, unique and finish the sentence cleanly`, () => {
    const all: string[] = [];
    for (const id of game.DECK_IDS) {
      const prompts: readonly string[] = game.DECKS[id].prompts;
      assert.ok(prompts.length >= FULL, `${id} has at least ${FULL} prompts (has ${prompts.length})`);
      for (const p of prompts) {
        assert.match(p, /^[a-z]/, `"${p}" starts lowercase`);
        assert.doesNotMatch(p, /[.?!]$/, `"${p}" has no final punctuation`);
        assert.doesNotMatch(p, dashes, `"${p}" has no long dashes`);
        assert.doesNotMatch(p, /\s{2}|^\s|\s$/, `"${p}" has clean spacing`);
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

test('never have i ever: cards read as a sentence and story cards never come twice in a row', () => {
  assert.equal(nhie.asSentence('cried at a Pixar movie'), 'cried at a Pixar movie.');
  assert.equal(nhie.asSentence('texted someone "u up?"'), 'texted someone "u up?"');
  assert.equal(nhie.storyRoll(false, 0.1), true);
  assert.equal(nhie.storyRoll(true, 0.1), false);
  assert.equal(nhie.storyRoll(false, 0.5), false);
});

test('most likely to: titles replace per card and the table ranks them', () => {
  let titles = mlt.crown([], 'fight a goose and lose', 'Sam');
  titles = mlt.crown(titles, 'adopt a raccoon', 'Jo');
  titles = mlt.crown(titles, 'eat a bug on a dare', 'Sam');
  // Changing the pick for a card moves the title, it doesn't add one.
  titles = mlt.crown(titles, 'adopt a raccoon', 'Sam');
  assert.equal(titles.length, 3);
  assert.ok(titles.every((t) => t.name === 'Sam'));
  // Tapping the same name again takes it back.
  titles = mlt.crown(titles, 'adopt a raccoon', null);
  assert.equal(titles.length, 2);

  const table = mlt.standings(['Jo', 'Sam', 'Max'], titles);
  assert.deepEqual(
    table.map((s) => [s.name, s.count]),
    [['Sam', 2], ['Jo', 0], ['Max', 0]],
  );
  assert.equal(table[0].latest, 'eat a bug on a dare');
  assert.equal(table[0].seat, 1);
  assert.equal(mlt.leadLine(table), 'Sam leads with 2');
  assert.equal(mlt.leadLine(mlt.standings(['Jo'], [])), null);
  const tied = mlt.standings(['Jo', 'Sam'], [{ text: 'a', name: 'Jo' }, { text: 'b', name: 'Sam' }]);
  assert.equal(mlt.leadLine(tied), 'Jo and Sam are tied on 1');
  const crowd = ['A', 'B', 'C', 'D'];
  assert.equal(mlt.leadLine(mlt.standings(crowd, crowd.map((n) => ({ text: n, name: n })))), '4 people tied on 1');
});

test('truth or dare: cards are unique, punctuated and mild unless asked', () => {
  for (const set of [TRUTHS, DARES]) {
    assert.ok(set.mild.length >= FULL && set.spicy.length >= FULL, `each pile has at least ${FULL} cards`);
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

test('truth or dare: the record line reads like a person said it', () => {
  assert.equal(recordLine(EMPTY), '');
  assert.equal(recordLine({ truth: 1, dare: 0, chicken: 0 }), '1 truth');
  assert.equal(recordLine({ truth: 2, dare: 1, chicken: 1 }), '2 truths, 1 dare, chickened out once');
  assert.equal(recordLine({ truth: 0, dare: 0, chicken: 2 }), 'Chickened out twice');
  assert.equal(recordLine({ truth: 0, dare: 3, chicken: 4 }), '3 dares, chickened out 4 times');
});
