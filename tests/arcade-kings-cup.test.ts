import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import {
  ALTERNATE_RULES,
  CLASSIC_RULES,
  DECK_SIZE,
  KING,
  LAST_KING,
  SPICY_RULES,
  MADE_RULE_MAX,
  RULE_NAME_MAX,
  RULE_TEXT_MAX,
  addMate,
  cardName,
  cardsLeft,
  cupLevel,
  draw,
  dropRule,
  isClassic,
  isRed,
  isSpicy,
  makeDeck,
  makeRule,
  mateGroups,
  mateOf,
  matesOf,
  nearestSlot,
  newGame,
  nextSeat,
  nextSlot,
  nth,
  parseRules,
  parseSpicy,
  rankOfKind,
  rankLabel,
  ruleFor,
  ruleKind,
  rulesEdited,
  setRule,
  slotAngle,
  stripSpicy,
  swapsFor,
  tidy,
  type Card,
  type Game,
} from '../src/os/arcade/games/kings-cup/logic.ts';

/** Draws until the game ends, returning every step. */
function playOut(game: Game) {
  const steps: NonNullable<ReturnType<typeof draw>>[] = [];
  let g = game;
  for (;;) {
    const r = draw(g);
    if (!r) break;
    steps.push(r);
    g = r.game;
  }
  return { steps, game: g };
}

/** A game whose ring is exactly these cards (slot 0 first). */
const rigged = (cards: Card[], seats = 0): Game => ({ ...newGame(seats, mulberry32(1)), ring: cards.slice() });
const card = (rank: number, id = rank): Card => ({ id, rank, suit: 'spades' });

test('the deck has 52 unique cards, four of each rank', () => {
  const deck = makeDeck();
  assert.equal(deck.length, DECK_SIZE);
  assert.equal(new Set(deck.map((c) => c.id)).size, DECK_SIZE);
  assert.equal(new Set(deck.map((c) => `${c.rank}-${c.suit}`)).size, DECK_SIZE);
  for (let r = 1; r <= 13; r++) assert.equal(deck.filter((c) => c.rank === r).length, 4);
  assert.equal(deck.filter(isRed).length, 26);
  assert.equal(rankLabel(1), 'A');
  assert.equal(rankLabel(10), '10');
  assert.equal(rankLabel(13), 'K');
  assert.equal(cardName({ id: 0, rank: 12, suit: 'hearts' }), 'Queen of Hearts');
});

test('shuffles are seeded and keep every card', () => {
  const a = newGame(3, mulberry32(42));
  const b = newGame(3, mulberry32(42));
  const c = newGame(3, mulberry32(43));
  assert.deepEqual(a.ring, b.ring);
  assert.notDeepEqual(a.ring, c.ring);
  assert.deepEqual(
    a.ring.map((x) => x!.id).sort((x, y) => x - y),
    makeDeck().map((x) => x.id),
  );
  assert.equal(cardsLeft(a), 52);
  assert.equal(a.kings, 0);
  assert.equal(a.over, false);
});

test('drawing goes clockwise from the last card and empties the slot', () => {
  let g = rigged([card(2), card(3), card(4), card(5)]);
  let r = draw(g)!;
  assert.equal(r.drawn.slot, 0);
  assert.equal(r.drawn.card.rank, 2);
  g = r.game;
  assert.equal(g.ring[0], null);
  assert.equal(cardsLeft(g), 3);
  // Picking a slot draws that card; the next default draw continues clockwise after it.
  r = draw(g, 2)!;
  assert.equal(r.drawn.card.rank, 4);
  g = r.game;
  assert.equal(nextSlot(g), 3);
  r = draw(g)!;
  assert.equal(r.drawn.slot, 3);
  g = r.game;
  // Wraps around to the only card left, and an empty slot falls back to it too.
  assert.equal(nextSlot(g), 1);
  r = draw(g, 0)!;
  assert.equal(r.drawn.slot, 1);
  assert.equal(r.game.drawn.map((c) => c.rank).join(','), '2,4,5,3');
  assert.equal(nextSlot(r.game), -1);
  assert.equal(draw(r.game), null);
});

test('the fourth king ends the game and fills the cup', () => {
  const { steps, game } = playOut(newGame(4, mulberry32(7)));
  const kings = steps.filter((s) => s.drawn.card.rank === 13);
  assert.equal(kings.length, LAST_KING);
  assert.deepEqual(
    kings.map((k) => k.drawn.kings),
    [1, 2, 3, 4],
  );
  const last = steps[steps.length - 1].drawn;
  assert.equal(last.card.rank, 13);
  assert.equal(last.last, true);
  assert.ok(steps.slice(0, -1).every((s) => !s.drawn.last));
  assert.equal(game.over, true);
  assert.equal(game.kings, 4);
  assert.equal(game.kingSeats.length, 4);
  assert.deepEqual(
    game.kingSeats,
    kings.map((k) => k.drawn.seat),
    'every king remembers who drew it',
  );
  assert.equal(draw(game), null, 'no draws after the fourth king');
  assert.equal(cardsLeft(game) + game.drawn.length, 52);
  assert.equal(cupLevel(0), 0);
  assert.equal(cupLevel(2), 0.5);
  assert.equal(cupLevel(4), 1);
  assert.equal(cupLevel(9), 1);
});

test('turns go around the table in seat order', () => {
  let g = newGame(3, mulberry32(3), 1);
  const seats: (number | null)[] = [];
  for (let k = 0; k < 7; k++) {
    const r = draw(g);
    if (!r) break;
    seats.push(r.drawn.seat);
    g = r.game;
  }
  assert.deepEqual(seats.slice(0, 7), [1, 2, 0, 1, 2, 0, 1].slice(0, seats.length));
  assert.equal(nextSeat(2, 3), 0);
  assert.equal(nextSeat(0, 0), 0);
  // No names: nobody is called, and the first seat wraps safely.
  const solo = draw(newGame(0, mulberry32(3)))!;
  assert.equal(solo.drawn.seat, null);
  assert.equal(newGame(3, mulberry32(1), 7).turn, 1);
  assert.equal(newGame(3, mulberry32(1), -1).turn, 2);
});

test('a queen makes the drawer the Question Master until the next queen', () => {
  const q1: Card = { id: 1, rank: 12, suit: 'hearts' };
  const q2: Card = { id: 2, rank: 12, suit: 'clubs' };
  let g = rigged([q1, card(5), q2], 3);
  g = draw(g)!.game;
  assert.deepEqual(g.roles, [{ kind: 'questions', seat: 0, card: q1 }]);
  g = draw(g)!.game;
  assert.equal(g.roles[0].seat, 0, 'other cards leave the Question Master alone');
  g = draw(g)!.game;
  assert.deepEqual(g.roles, [{ kind: 'questions', seat: 2, card: q2 }]);
  // Without names the card still records who to look for.
  const anon = draw(rigged([q1], 0))!.game;
  assert.deepEqual(anon.roles, [{ kind: 'questions', seat: null, card: q1 }]);
});

test('tracked rules follow the house rules, not the card', () => {
  const rules = setRule(setRule(parseRules(null), 8, 'Thumb Master', 'Thumb on the table.'), 12, 'Social', 'Everyone drinks.');
  assert.equal(ruleKind(ruleFor(rules, 8)), 'thumb');
  assert.equal(ruleKind(ruleFor(rules, 12)), null);
  assert.equal(rankOfKind(rules, 'mate'), null, 'nobody picks mates once the eight is something else');
  assert.equal(rankOfKind(parseRules(null), 'mate'), 8);
  assert.equal(rankOfKind(parseRules(null), 'make'), 11);
  const e1: Card = { id: 1, rank: 8, suit: 'hearts' };
  const q: Card = { id: 2, rank: 12, suit: 'clubs' };
  const e2: Card = { id: 3, rank: 8, suit: 'spades' };
  let g = rigged([e1, q, e2], 2);
  g = draw(g, undefined, rules)!.game;
  g = draw(g, undefined, rules)!.game;
  assert.deepEqual(g.roles, [{ kind: 'thumb', seat: 0, card: e1 }], 'the queen is just Social now');
  g = draw(g, undefined, rules)!.game;
  assert.deepEqual(g.roles, [{ kind: 'thumb', seat: 0, card: e2 }], 'the next Thumb Master takes over');
  // Names are matched loosely, and unrelated names that share a word don't count.
  assert.equal(ruleKind({ name: ' question   MASTER! ', text: '' }), 'questions');
  assert.equal(ruleKind({ name: 'Snake Eyes', text: '' }), 'snake');
  assert.equal(ruleKind({ name: 'Mates', text: '' }), 'mate');
  assert.equal(ruleKind({ name: 'Thumb War', text: '' }), null);
  assert.equal(ruleKind({ name: 'Rhyme', text: '' }), null);
  assert.equal(ruleKind(undefined), null);
});

test('every rule reads out in one breath', () => {
  for (const rule of [...CLASSIC_RULES, ...ALTERNATE_RULES, ...SPICY_RULES]) {
    assert.ok(rule.name.length <= RULE_NAME_MAX, rule.name);
    assert.ok(rule.text.length <= RULE_TEXT_MAX, rule.name);
    assert.ok(rule.text.split(/\s+/).length <= 16, `${rule.name} is too long to read out: ${rule.text}`);
    assert.ok(!/[\u2013\u2014!]/.test(rule.name + rule.text), `${rule.name} has a dash or an exclamation mark`);
    assert.deepEqual(parseRules([rule])[0], rule, 'library rules survive the stored-rule cleanup');
  }
  const names = [...CLASSIC_RULES, ...ALTERNATE_RULES, ...SPICY_RULES].map((r) => r.name.toLowerCase());
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
  assert.equal(ruleKind(ALTERNATE_RULES.find((r) => r.name === 'Thumb Master')), 'thumb');
  assert.equal(ruleKind(ALTERNATE_RULES.find((r) => r.name === 'Snake Eyes')), 'snake');
});

test('mates come in pairs: a new mate splits the old pair instead of chaining', () => {
  let pairs = addMate([], 0, 2);
  assert.deepEqual(pairs, [[0, 2]]);
  assert.deepEqual(addMate(pairs, 1, 1), pairs, 'nobody mates themselves');
  assert.deepEqual(addMate(pairs, 2, 0), pairs, 'no duplicate pairs');
  pairs = addMate(pairs, 3, 1);
  assert.deepEqual(mateGroups(pairs), [[0, 2], [1, 3]]);
  // 2 picks 3: both old pairs split, 0 and 1 are on their own.
  pairs = addMate(pairs, 2, 3);
  assert.deepEqual(mateGroups(pairs), [[2, 3]]);
  assert.deepEqual(matesOf(pairs, 3), [2]);
  assert.equal(mateOf(pairs, 2), 3);
  assert.equal(mateOf(pairs, 0), null);
  assert.deepEqual(matesOf(pairs, 5), []);
  assert.deepEqual(mateGroups([]), []);
  // However the eights fall, nobody ever drinks with more than one mate.
  const rng = mulberry32(5);
  let p: ReturnType<typeof addMate> = [];
  for (let k = 0; k < 500; k++) {
    p = addMate(p, Math.floor(rng() * 8), Math.floor(rng() * 8));
    assert.ok(mateGroups(p).every((g) => g.length === 2));
    for (let s = 0; s < 8; s++) assert.ok(matesOf(p, s).length <= 1);
  }
});

test('the king always fills the cup: its rule cannot be edited or stored away', () => {
  const classic = parseRules(null);
  assert.deepEqual(setRule(classic, KING, 'Social', 'Everyone drinks.'), classic);
  const stored = parseRules(CLASSIC_RULES.map((r, i) => (i === KING - 1 ? { name: 'Social', text: 'Everyone drinks.' } : r)));
  assert.deepEqual(ruleFor(stored, KING), CLASSIC_RULES[KING - 1]);
  assert.equal(rulesEdited(stored), false);
  // And the fourth king still ends the game whatever the other rules say.
  const wild = CLASSIC_RULES.map((_, i) => ({ name: `Rule ${i}`, text: '' }));
  const { steps } = playOut(newGame(3, mulberry32(11)));
  assert.equal(steps[steps.length - 1].drawn.card.rank, KING);
  assert.equal(parseRules(wild)[KING - 1].name, 'Kings Cup');
});

test('Waterfall stays a few seconds, and Guys and Girls have ungendered swaps on offer first', () => {
  assert.match(CLASSIC_RULES[0].text, /few seconds/);
  assert.equal(CLASSIC_RULES[4].name, 'Guys');
  assert.equal(CLASSIC_RULES[5].name, 'Girls');
  for (const rank of [5, 6]) {
    const swaps = swapsFor(rank);
    assert.deepEqual(swaps[0], CLASSIC_RULES[rank - 1], 'the classic rule comes first');
    assert.doesNotMatch(swaps[1].name + swaps[1].text, /\b(guys|girls|men|women|boys|ladies)\b/i, 'then one without a gender');
  }
  for (let rank = 1; rank <= 13; rank++) {
    const names = swapsFor(rank).map((r) => r.name);
    assert.equal(new Set(names).size, names.length, `rank ${rank} lists each swap once`);
  }
});

test('18+ swaps: off by default, offered only when 18+ Rules is on, and gone again when it is off', () => {
  assert.equal(parseSpicy(undefined), false);
  assert.equal(parseSpicy(null), false);
  assert.equal(parseSpicy('true'), false);
  assert.equal(parseSpicy(1), false);
  assert.equal(parseSpicy(true), true);
  assert.ok(SPICY_RULES.length >= 8);
  for (let rank = 1; rank <= 13; rank++) {
    assert.ok(!swapsFor(rank).some(isSpicy), `rank ${rank}: no 18+ swaps when off`);
    if (rank !== KING) assert.ok(SPICY_RULES.every((r) => swapsFor(rank, true).includes(r)), `rank ${rank}: every 18+ swap when on`);
  }
  // No 18+ rule shares a name with the everyday ones.
  for (const r of SPICY_RULES) assert.ok(![...CLASSIC_RULES, ...ALTERNATE_RULES].some((x) => x.name.toLowerCase() === r.name.toLowerCase()));
  // Turning it off puts the classic rule back on any card that had an 18+ swap; house rules of the table's own stay.
  let rules = setRule(parseRules(null), 3, SPICY_RULES[0].name, SPICY_RULES[0].text);
  rules = setRule(rules, 7, 'Thumb Master', ALTERNATE_RULES.find((r) => r.name === 'Thumb Master')!.text);
  const off = stripSpicy(rules);
  assert.deepEqual(off[2], CLASSIC_RULES[2]);
  assert.equal(off[6].name, 'Thumb Master');
  assert.ok(!off.some(isSpicy));
  // 18+ swaps aren't tracked as roles, mates or made rules.
  for (const r of SPICY_RULES) assert.equal(ruleKind(r), null, r.name);
});

test('18+ swaps: frank, never over the line, and anyone else involved has to say yes', () => {
  for (const r of SPICY_RULES) {
    const all = `${r.name} ${r.text}`;
    // Never, at any setting: minors or school settings, coercion or intoxication, nudity past swimwear,
    // sending anything outside the room, mocking bodies or identities, heavy drinking.
    assert.doesNotMatch(all, /\b(high school|school|teen\w*|underage|minor|student|teacher|passed out|blackout|unconscious|forced?|naked|nude|nudes|underwear off|send|text|post|call|fat|ugly|slut|whore|chug|bottoms up)\b|\b(?<!body )shots?\b/i, all);
    // A body shot is one sip.
    if (/body shot/i.test(all)) assert.match(r.text, /\bsip\b/);
    // Clothing only comes off with a floor.
    if (/\b(strip|layer|clothing|take off)\b/i.test(all)) assert.match(all, /swimwear|swimsuit/i, `${r.name} keeps it at swimwear`);
    // Touch, laps, kisses and body shots need the other person's yes, in the same words every time.
    if (/\b(kiss|lap|collarbone|body shot|touch|hold)\b/i.test(all)) assert.match(r.text, /if they say yes/, `${r.name} asks first`);
  }
});

test('jacks make rules that can be dropped', () => {
  let g = newGame(2, mulberry32(9));
  g = makeRule(g, '   No   pointing  ');
  g = makeRule(g, '');
  g = makeRule(g, 'x'.repeat(200));
  assert.deepEqual(g.made, ['No pointing', 'x'.repeat(MADE_RULE_MAX)]);
  g = dropRule(g, 0);
  assert.equal(g.made.length, 1);
  assert.equal(dropRule(g, 5), g);
});

test('stored rules are validated per rank with a classic fallback', () => {
  assert.deepEqual(parseRules(null), CLASSIC_RULES);
  assert.deepEqual(parseRules('nope'), CLASSIC_RULES);
  assert.deepEqual(parseRules({ 0: { name: 'x', text: 'y' } }), CLASSIC_RULES);
  const stored = [{ name: '  Social ', text: ' Everyone   drinks. ' }, null, { name: '', text: 'blank name' }, { name: 42 }, { name: 'Thumb' }, 'junk'];
  const rules = parseRules(stored);
  assert.equal(rules.length, 13);
  assert.deepEqual(rules[0], { name: 'Social', text: 'Everyone drinks.' });
  assert.deepEqual(rules[1], CLASSIC_RULES[1]);
  assert.deepEqual(rules[2], CLASSIC_RULES[2]);
  assert.deepEqual(rules[3], CLASSIC_RULES[3]);
  assert.deepEqual(rules[4], { name: 'Thumb', text: '' });
  assert.deepEqual(rules.slice(5), CLASSIC_RULES.slice(5));
  const long = parseRules([{ name: 'n'.repeat(99), text: 't'.repeat(999) }]);
  assert.equal(long[0].name.length, RULE_NAME_MAX);
  assert.equal(long[0].text.length, RULE_TEXT_MAX);
  // Extra entries are ignored.
  assert.equal(parseRules([...CLASSIC_RULES, { name: 'Joker', text: '' }]).length, 13);
});

test('editing one rule leaves the rest alone, and a blank name resets it', () => {
  const classic = parseRules(null);
  assert.equal(rulesEdited(classic), false);
  const edited = setRule(classic, 7, 'Thumb Master', 'Put your thumb on the table. Last one drinks.');
  assert.equal(ruleFor(edited, 7).name, 'Thumb Master');
  assert.equal(isClassic(ruleFor(edited, 7), 7), false);
  assert.ok(edited.every((r, i) => i === 6 || isClassic(r, i + 1)));
  assert.equal(rulesEdited(edited), true);
  assert.equal(classic[6].name, 'Heaven', 'the original list is not changed');
  const back = setRule(edited, 7, '   ', 'anything');
  assert.deepEqual(back, classic);
  assert.deepEqual(setRule(classic, 14, 'Joker', ''), classic);
  assert.equal(ruleFor(classic, 13).name, 'Kings Cup');
});

test('tapping the ring picks the nearest card still there', () => {
  let g = rigged([card(1), card(2), card(3), card(4)]);
  assert.equal(slotAngle(1, 4), 90);
  assert.equal(nearestSlot(g, 80), 1);
  assert.equal(nearestSlot(g, 350), 0);
  assert.equal(nearestSlot(g, -100), 3);
  g = draw(g, 1)!.game;
  // Slot 1 is gone, so a tap at 90 degrees lands on a neighbour.
  assert.ok([0, 2].includes(nearestSlot(g, 95)));
  assert.equal(nearestSlot(g, 130), 2);
  const empty = { ...g, ring: g.ring.map(() => null) };
  assert.equal(nearestSlot(empty, 0), -1);
});

test('typed text is tidied: control characters dropped, whitespace folded, length capped', () => {
  assert.equal(tidy('  Thumb\u0000\u200b  Master\n ', 24), 'Thumb Master');
  assert.equal(tidy('\u2028\u2029', 10), '');
  assert.equal(tidy('abcdef', 3), 'abc');
});

test('ordinals read naturally', () => {
  assert.deepEqual([1, 2, 3, 10, 11, 12, 13, 21, 22, 23, 101, 111].map(nth), ['first', 'second', 'third', 'tenth', '11th', '12th', '13th', '21st', '22nd', '23rd', '101st', '111th']);
});
