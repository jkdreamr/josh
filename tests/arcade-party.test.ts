import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PLAYERS_MAX, PLAYER_NAME_MAX, Pile, addPlayer, clock, listNames, mulberry32, shuffle, sips, tidyName, tidyRoster } from '../src/os/arcade/kit/party-core.ts';

test('shuffle returns a permutation and repeats with the same seed', () => {
  const items = Array.from({ length: 20 }, (_, i) => i);
  const a = shuffle(items, mulberry32(7));
  assert.deepEqual([...a].sort((x, y) => x - y), items);
  assert.deepEqual(a, shuffle(items, mulberry32(7)));
  assert.notDeepEqual(a, items);
  assert.deepEqual(items, Array.from({ length: 20 }, (_, i) => i), 'the input is left alone');
});

test('tidyName trims, folds spaces, drops control characters and caps the length', () => {
  assert.equal(tidyName('  Sam   Lee \n'), 'Sam Lee');
  assert.equal(tidyName('Jo​ey'), 'Joey');
  assert.equal(tidyName('x'.repeat(40)).length, PLAYER_NAME_MAX);
  assert.equal(tidyName('   '), '');
});

test('tidyRoster keeps unique tidy names and survives junk', () => {
  assert.deepEqual(tidyRoster(['Sam', ' sam ', 'Jo', 3, '', null, 'Max']), ['Sam', 'Jo', 'Max']);
  assert.deepEqual(tidyRoster('Sam'), []);
  assert.deepEqual(tidyRoster(undefined), []);
  assert.equal(tidyRoster(Array.from({ length: 40 }, (_, i) => `P${i}`)).length, PLAYERS_MAX);
});

test('addPlayer refuses blanks, duplicates and a full table', () => {
  assert.deepEqual(addPlayer(['Sam'], ' Jo '), { ok: true, players: ['Sam', 'Jo'] });
  assert.equal(addPlayer(['Sam'], 'SAM').ok, false);
  assert.equal(addPlayer(['Sam'], '  ').ok, false);
  const full = Array.from({ length: PLAYERS_MAX }, (_, i) => `P${i}`);
  assert.equal(addPlayer(full, 'One More').ok, false);
});

test('copy helpers', () => {
  assert.equal(sips(1), '1 sip');
  assert.equal(sips(3), '3 sips');
  assert.equal(listNames([]), '');
  assert.equal(listNames(['Sam']), 'Sam');
  assert.equal(listNames(['Sam', 'Jo']), 'Sam and Jo');
  assert.equal(listNames(['Sam', 'Jo', 'Max']), 'Sam, Jo and Max');
  assert.equal(clock(65), '1:05');
  assert.equal(clock(8.2), '0:09');
  assert.equal(clock(-3), '0:00');
});

test('Pile deals every item once per pass and never repeats across a reshuffle', () => {
  const items = ['a', 'b', 'c', 'd', 'e'];
  const rng = mulberry32(3);
  const pile = new Pile(items, rng);
  let last: string | undefined;
  for (let pass = 0; pass < 50; pass++) {
    const seen: string[] = [];
    for (let i = 0; i < items.length; i++) {
      const card = pile.draw(last);
      assert.ok(card);
      if (i === 0) assert.notEqual(card, last, 'the first card of a pass differs from the last one shown');
      seen.push(card);
      last = card;
    }
    assert.deepEqual([...seen].sort(), items);
  }
  assert.equal(new Pile<string>([]).draw(), undefined);
  assert.equal(new Pile(['only']).draw('only'), 'only');
});
