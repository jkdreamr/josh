// Party Mix: the deck content, fair player picks, deck building by intensity and length, rule lifetimes and stats.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import { CARDS, type Template } from '../src/os/arcade/games/party-mix/cards.ts';
import {
  LENGTHS,
  LEVELS,
  LIFETIME,
  OPENERS,
  Picker,
  RULES,
  activeRules,
  arrange,
  buildDeck,
  eligible,
  fill,
  hasTriple,
  plain,
  quotas,
  slots,
  stats,
  step,
  type Card,
  type Intensity,
  type Kind,
  type Length,
} from '../src/os/arcade/games/party-mix/logic.ts';

const INTENSITIES: Intensity[] = ['chill', 'party', 'wild'];
const LENGTH_IDS: Length[] = ['short', 'normal', 'long'];
const names = (n: number) => Array.from({ length: n }, (_, i) => `P${i}`);
const allText = (t: Template) => [t.text, t.or, t.label, t.end].filter((s): s is string => !!s);

test('content: about 150 cards across every type and level', () => {
  assert.ok(CARDS.length >= 150, `${CARDS.length} cards`);
  for (const type of ['challenge', 'give', 'everyone', 'vote', 'duel', 'game', 'rule', 'wyr'] as const) {
    const of = CARDS.filter((c) => c.type === type);
    assert.ok(of.length >= 12, `${type} has ${of.length} cards`);
    for (const level of [1, 2, 3] as const) assert.ok(of.some((c) => c.level === level), `${type} has a level ${level} card`);
  }
});

test('content: no dashes, tidy sentences, unique cards', () => {
  const seen = new Set<string>();
  for (const c of CARDS) {
    for (const s of allText(c)) {
      assert.doesNotMatch(s, /[–—]/, `"${s}" has no long dashes`);
      assert.doesNotMatch(s, /\s{2}|^\s|\s$/, `"${s}" has tidy spaces`);
      assert.doesNotMatch(s, /!/, `"${s}" doesn't shout`);
      assert.ok(s.length <= 130, `"${s}" fits on a card`);
    }
    assert.match(c.text, /^(\{p1\}|[A-Z])/, `"${c.text}" starts with a capital or a name`);
    if (c.type === 'wyr') {
      assert.ok(c.or, 'would you rather has two options');
      assert.doesNotMatch(c.text + c.or, /[.?]$/, 'options are fragments');
    } else assert.match(c.text, /[.?]$/, `"${c.text}" ends a sentence`);
    const key = (c.text + '|' + (c.or ?? '')).toLowerCase();
    assert.ok(!seen.has(key), `"${c.text}" appears once`);
    seen.add(key);
  }
});

test('content: every placeholder fills with two players', () => {
  for (const c of CARDS) {
    for (const s of allText(c)) {
      for (const m of s.matchAll(/\{([^}]*)\}/g)) assert.match(m[0], /^\{p[12]\}$/, `"${s}" only uses {p1} and {p2}`);
      const parts = fill(s, [0, 1]);
      assert.ok(parts.every((p) => typeof p !== 'string' || !p.includes('{')), `"${s}" fills completely`);
    }
    if (slots(c) === 2) assert.match(c.text, /\{p1\}/, `"${c.text}" names p1 before p2`);
    assert.ok(slots(c) <= 2);
  }
  // Rule Over and strip labels only name players the rule card itself named.
  for (const c of CARDS.filter((x) => x.type === 'rule')) {
    assert.ok(c.label && c.end, `rule "${c.text}" has a label and an end`);
    assert.ok(c.label.length <= 30, `"${c.label}" is short`);
    assert.equal(slots({ text: c.label }) <= slots({ text: c.text }), true);
    assert.equal(slots({ text: c.end }) <= slots({ text: c.text }), true);
  }
  // A vote needs someone to point at besides yourself and one other.
  for (const c of CARDS.filter((x) => x.type === 'vote')) assert.equal(c.min, 3);
});

test('content: sips stay small, nobody is told to chug, and water shows up', () => {
  for (const c of CARDS)
    for (const s of allText(c)) {
      assert.doesNotMatch(s, /\b(chug|shot|shots|finish your|down your|waterfall|bottoms up)\b/i, `"${s}" keeps it to sips`);
      for (const m of s.matchAll(/\b(?:drinks?|gives? out|hand out|hands out|give)\s+(\d+)/gi)) assert.ok(Number(m[1]) <= 3, `"${s}" asks for ${m[1]}`);
      for (const m of s.matchAll(/(\d+) sips?/g)) assert.ok(Number(m[1]) <= 3, `"${s}" asks for ${m[1]} sips`);
    }
  const water = CARDS.filter((c) => /\bwater\b|\bbreak\./i.test(c.text));
  assert.ok(water.length >= 4, `${water.length} water or break cards`);
  assert.ok(water.every((c) => c.level === 1), 'water and breaks come at every intensity');
});

test('fill and plain put names where the placeholders were', () => {
  assert.deepEqual(fill('{p1} vs {p2}: thumb war.', [3, 1]), [{ seat: 3 }, ' vs ', { seat: 1 }, ': thumb war.']);
  assert.deepEqual(fill('Everyone drink 1.', []), ['Everyone drink 1.']);
  assert.equal(plain(fill("{p1}'s rule is over.", [2]), ['Ann', 'Bo', 'Cy']), "Cy's rule is over.");
  assert.equal(slots({ text: '{p1} and {p2}', end: '{p1}' }), 2);
  assert.equal(slots({ text: 'Everyone' }), 0);
});

test('picker: everyone is named once before anyone is named twice, never twice in a row', () => {
  for (const n of [2, 3, 5, 12]) {
    const pick = new Picker(n, mulberry32(n));
    const order: number[] = [];
    for (let i = 0; i < n * 20; i++) order.push(pick.take());
    for (let i = 1; i < order.length; i++) assert.notEqual(order[i], order[i - 1], `n=${n}: no repeat at ${i}`);
    for (let r = 0; r < 20; r++) assert.equal(new Set(order.slice(r * n, (r + 1) * n)).size, n, `n=${n}: round ${r} names everyone`);
    assert.ok(pick.counts.every((c) => c === 20));
  }
});

test('picker: pairs are two different players', () => {
  const pick = new Picker(2, mulberry32(9));
  for (let i = 0; i < 50; i++) {
    const a = pick.take();
    const b = pick.take([a]);
    assert.notEqual(a, b);
  }
});

test('quotas split the deck by weight and spill over when a type runs short', () => {
  assert.deepEqual(quotas(10, { a: 1, b: 1 }, { a: 99, b: 99 }), { a: 5, b: 5 });
  assert.deepEqual(quotas(10, { a: 1, b: 1 }, { a: 2, b: 99 }), { a: 2, b: 8 });
  assert.deepEqual(quotas(10, { a: 1, b: 0 }, { a: 99, b: 99 }), { a: 10, b: 0 });
  assert.deepEqual(quotas(10, { a: 1, b: 1 }, { a: 3, b: 3 }), { a: 3, b: 3 });
  const q = quotas(7, { a: 2, b: 1, c: 1 }, { a: 9, b: 9, c: 9 });
  assert.equal(q.a + q.b + q.c, 7);
  assert.ok(q.a >= 3);
});

test('arrange never deals one kind three times running and opens on a named card', () => {
  for (let seed = 0; seed < 300; seed++) {
    const rng = mulberry32(seed);
    const cards = Array.from({ length: 40 }, (_, i) => ({ kind: (['vote', 'vote', 'vote', 'duel', 'everyone', 'give', 'wyr'] as Kind[])[i % 7], i }));
    const out = arrange(cards, rng);
    assert.equal(out.length, 40);
    assert.equal(new Set(out.map((c) => c.i)).size, 40);
    assert.ok(!hasTriple(out.map((c) => c.kind)), `seed ${seed}`);
    assert.ok(OPENERS.includes(out[0].kind));
  }
  assert.ok(hasTriple(['vote', 'vote', 'vote']));
  assert.ok(!hasTriple(['vote', 'vote', 'duel', 'vote']));
});

const decks = function* () {
  let seed = 1;
  for (const intensity of INTENSITIES)
    for (const length of LENGTH_IDS)
      for (const players of [2, 3, 5, 20]) for (let k = 0; k < 6; k++) yield { intensity, length, players, seed: seed++, deck: buildDeck({ players, intensity, length, rng: mulberry32(seed) }) };
};

test('decks: the right length and intensity for any table', () => {
  for (const { intensity, length, players, deck } of decks()) {
    const tag = `${intensity}/${length}/${players}p`;
    assert.equal(deck.length, LENGTHS[length], `${tag} length`);
    assert.ok(deck.every((c) => c.level <= LEVELS[intensity]), `${tag} stays at its intensity`);
    if (players < 3) assert.ok(!deck.some((c) => c.kind === 'vote'), `${tag} has no votes`);
    assert.ok(OPENERS.includes(deck[0].kind), `${tag} opens on a named card`);
    assert.ok(!hasTriple(deck.map((c) => c.kind)), `${tag} has no triples`);
    const keys = deck.filter((c) => c.kind !== 'end').map((c) => c.key);
    assert.equal(new Set(keys).size, keys.length, `${tag} deals each card once`);
    const kinds = new Set(deck.map((c) => c.kind));
    for (const k of ['challenge', 'give', 'everyone', 'duel', 'game', 'wyr', 'rule', 'end'] as Kind[]) assert.ok(kinds.has(k), `${tag} has a ${k}`);
    for (const c of deck) {
      assert.equal(new Set(c.seats).size, c.seats.length, `${tag} names distinct players on a card`);
      assert.ok(c.seats.every((s) => s >= 0 && s < players));
      for (const p of [...c.text, ...(c.or ?? []), ...(c.rule?.label ?? [])]) if (typeof p !== 'string') assert.ok(c.seats.includes(p.seat));
    }
  }
});

test('decks: wild leans wild, party leans party, chill stays mild', () => {
  let wild = 0;
  let party = 0;
  let n = 0;
  for (let seed = 0; seed < 40; seed++) {
    const w = buildDeck({ players: 6, intensity: 'wild', length: 'normal', rng: mulberry32(seed) });
    const p = buildDeck({ players: 6, intensity: 'party', length: 'normal', rng: mulberry32(seed) });
    wild += w.filter((c) => c.level === 3).length;
    party += p.filter((c) => c.level === 2).length;
    n += w.length;
  }
  assert.ok(wild / n > 0.25, `wild share ${(wild / n).toFixed(2)}`);
  assert.ok(party / n > 0.3, `party share ${(party / n).toFixed(2)}`);
});

test('rules: each one ends with its own Rule Over card, inside the deck, without stacking up', () => {
  for (const { length, deck, players } of decks()) {
    const starts = deck.map((c, i) => [c, i] as const).filter(([c]) => c.kind === 'rule');
    assert.equal(starts.length, RULES[length]);
    for (const [card, i] of starts) {
      const r = card.rule!;
      assert.equal(r.from, i);
      assert.ok(r.to < deck.length - 1, 'a rule ends before the last card');
      const end = deck[r.to];
      assert.equal(end.kind, 'end');
      assert.equal(end.key, card.key);
      assert.deepEqual(end.seats, card.seats);
      assert.equal(r.lasts, r.to - r.from - 1);
      const [lo, hi] = LIFETIME[length];
      assert.ok(r.lasts >= Math.min(lo, 5) && r.lasts <= hi, `lasts ${r.lasts}`);
      for (let at = 0; at < deck.length; at++) assert.equal(activeRules(deck, at).includes(card), at > r.from && at < r.to);
    }
    assert.equal(deck.filter((c) => c.kind === 'end').length, starts.length);
    for (let at = 0; at < deck.length; at++) assert.ok(activeRules(deck, at).length <= 2);
    assert.ok(deck[1].kind !== 'rule' && deck[0].kind !== 'rule', `${players}p: the first two cards aren't rules`);
  }
});

test('names: fair across the deck, nobody named five cards running', () => {
  for (const { players, deck, intensity, length } of decks()) {
    const tag = `${intensity}/${length}/${players}p`;
    const { named } = stats(deck, players);
    if (players <= deck.length / 2) assert.ok(named.every((n) => n > 0), `${tag}: nobody is skipped`);
    assert.ok(Math.max(...named) - Math.min(...named) <= 2, `${tag}: ${named.join(',')}`);
    if (players < 3) continue;
    const run = new Array(players).fill(0);
    for (const c of deck.filter((x) => x.seats.length && x.kind !== 'end'))
      for (let s = 0; s < players; s++) {
        run[s] = c.seats.includes(s) ? run[s] + 1 : 0;
        assert.ok(run[s] < 5, `${tag}: seat ${s} named five times running`);
      }
  }
});

test('decks are repeatable with a seed, and the next deck skips the last one', () => {
  const a = buildDeck({ players: 4, intensity: 'party', length: 'normal', rng: mulberry32(42) });
  const b = buildDeck({ players: 4, intensity: 'party', length: 'normal', rng: mulberry32(42) });
  assert.deepEqual(a, b);
  const c = buildDeck({ players: 4, intensity: 'party', length: 'normal', rng: mulberry32(43) });
  assert.notDeepEqual(a, c);
  const used = new Set(a.map((x) => x.key));
  const next = buildDeck({ players: 4, intensity: 'party', length: 'normal', rng: mulberry32(7), avoid: used });
  const again = next.filter((x) => x.kind !== 'end' && used.has(x.key)).length;
  const room = eligible('party', 4).length - used.size;
  assert.ok(again <= Math.max(0, next.length - room) + 4, `${again} repeats`);
});

test('a long chill deck for two still has enough cards', () => {
  const pool = eligible('chill', 2);
  assert.ok(!pool.some((c) => c.type === 'vote'));
  assert.ok(pool.filter((c) => c.type !== 'rule').length >= LENGTHS.long - RULES.long * 2);
  assert.ok(pool.filter((c) => c.type === 'rule').length >= RULES.long);
});

test('step moves through the deck and onto the end screen', () => {
  assert.equal(step(0, -1, 30), 0);
  assert.equal(step(0, 1, 30), 1);
  assert.equal(step(29, 1, 30), 30);
  assert.equal(step(30, 1, 30), 30);
  assert.equal(step(30, -1, 30), 29);
});

test('stats count cards, duels, rules and who got named the most', () => {
  const card = (kind: Kind, seats: number[]): Card => ({ kind, level: 1, key: kind + seats.join(), text: [], seats });
  const deck = [card('duel', [0, 1]), card('challenge', [0]), card('rule', [2]), card('everyone', []), card('end', [2]), card('give', [0])];
  const s = stats(deck, 4);
  assert.equal(s.cards, 6);
  assert.equal(s.duels, 1);
  assert.equal(s.rules, 1);
  assert.deepEqual(s.named, [3, 1, 1, 0]);
  assert.deepEqual(s.most, { seats: [0], times: 3 });
  assert.deepEqual(s.least, { seats: [3], times: 0 });
  assert.deepEqual(names(2), ['P0', 'P1']);
});
