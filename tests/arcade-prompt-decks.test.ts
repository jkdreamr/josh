// Content checks for the prompt deck drinking games: Never Have I Ever, Most Likely To, Truth or Dare.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import * as nhie from '../src/os/arcade/games/never-have-i-ever/prompts.ts';
import * as mlt from '../src/os/arcade/games/most-likely-to/prompts.ts';
import * as tod from '../src/os/arcade/games/truth-or-dare/prompts.ts';

const { CONSENT, DARES, DEFAULT_SPICE, EMPTY, SPICES, TRUTHS, cardsFor, most, nextSeat, recordLine } = tod;

const dashes = /[\u2013\u2014]/;
/** Straight quotes look like typewriter marks at card size; prompts use ’ “ ” instead. */
const straight = /['"]/;
/** Every deck holds exactly this many cards. */
const FULL = 40;

for (const [name, game] of [['never have i ever', nhie], ['most likely to', mlt]] as const) {
  test(`${name}: decks are full, unique and finish the sentence cleanly`, () => {
    const all: string[] = [];
    for (const id of game.DECK_IDS) {
      const prompts: readonly string[] = game.DECKS[id].prompts;
      assert.equal(prompts.length, FULL, `${id} has ${FULL} prompts (has ${prompts.length})`);
      for (const p of prompts) {
        assert.match(p, /^[a-z]/, `"${p}" starts lowercase`);
        assert.doesNotMatch(p, /[.?!]$/, `"${p}" has no final punctuation`);
        assert.doesNotMatch(p, dashes, `"${p}" has no long dashes`);
        assert.doesNotMatch(p, straight, `"${p}" uses typeset quotes`);
        assert.doesNotMatch(p, /\s{2}|^\s|\s$/, `"${p}" has clean spacing`);
        assert.ok(p.length <= 80, `"${p}" fits on a card`);
        all.push(p.toLowerCase());
      }
    }
    assert.equal(new Set(all).size, all.length, 'no prompt appears twice');
  });

  test(`${name}: both 18+ decks are off by default, labeled 18+, and only deal when picked`, () => {
    assert.deepEqual([...game.ADULT_DECKS], ['spicy', 'after']);
    for (const id of game.ADULT_DECKS) {
      assert.ok(!game.DEFAULT_DECKS.includes(id), `${id} starts off`);
      assert.match(game.DECKS[id].label, /18\+$/, `${id} says 18+ on its chip`);
    }
    for (const id of game.DEFAULT_DECKS) assert.doesNotMatch(game.DECKS[id].label, /18/);
    assert.equal(game.DECKS.after.label, 'After Dark 18+');
    assert.deepEqual(game.parseDecks(['spicy', 'nope']), ['spicy']);
    assert.deepEqual(game.parseDecks(['after']), ['after']);
    assert.deepEqual(game.parseDecks('classic'), game.DEFAULT_DECKS);
    assert.deepEqual(game.parseDecks([]), game.DEFAULT_DECKS);
    assert.ok(game.promptsFor([]).every((p) => !game.ADULT_DECKS.includes(p.deck)));
    assert.ok(game.promptsFor(game.DEFAULT_DECKS).every((p) => !game.ADULT_DECKS.includes(p.deck)));
    assert.ok(game.promptsFor(['spicy']).every((p) => p.deck === 'spicy'));
    assert.ok(game.promptsFor(['after']).every((p) => p.deck === 'after'));
  });

  test(`${name}: a session never repeats a card until it has seen them all, even after changing decks`, () => {
    const rng = mulberry32(7);
    const seen = new Set<string>();
    const shown: string[] = [];
    const deal = (items: readonly { text: string }[], n: number) => {
      for (let i = 0; i < n; i++) {
        const card = game.drawFresh(items as never, seen, shown[shown.length - 1], rng);
        assert.ok(card);
        game.markSeen(items as never, seen, card.text);
        shown.push(card.text);
      }
    };
    // 60 cards from the default decks, then Spicy goes on halfway through the night.
    const first = game.promptsFor(game.DEFAULT_DECKS);
    deal(first, 60);
    const both = game.promptsFor(game.DECK_IDS);
    deal(both, both.length - 60);
    assert.equal(new Set(shown).size, both.length, 'every card came up exactly once');
    // Once everything has been seen, the next pass starts, and never with the card just shown.
    const last = shown[shown.length - 1];
    deal(both, 1);
    assert.notEqual(shown[shown.length - 1], last);
    assert.deepEqual([...seen].sort(), [last, shown[shown.length - 1]].sort(), 'the new pass forgot the old one');
  });
}

test('never have i ever: cards read as a sentence and story cards never come twice in a row', () => {
  assert.equal(nhie.asSentence('cried over a video game character'), 'cried over a video game character.');
  assert.equal(nhie.asSentence('texted someone “u up?”'), 'texted someone “u up?”');
  // A closing quote takes the period inside it.
  assert.equal(nhie.asSentence('called a teacher “mom” or “dad”'), 'called a teacher “mom” or “dad.”');
  assert.equal(nhie.storyRoll(false, 0.1), true);
  assert.equal(nhie.storyRoll(true, 0.1), false);
  assert.equal(nhie.storyRoll(false, 0.5), false);
});

test('never have i ever: no theme takes over the deck', () => {
  const all = nhie.promptsFor(nhie.DECK_IDS).map((p) => p.text);
  const count = (re: RegExp) => all.filter((p) => re.test(p)).length;
  assert.ok(count(/\bpretend/) <= 2, 'pretending');
  assert.ok(count(/\blied\b/) <= 3, 'lying');
  assert.ok(count(/\bwoken up\b/) <= 2, 'waking up somewhere');
  assert.ok(count(/\bcr(y|ied)\b/) <= 3, 'crying');
  assert.ok(count(/\b[1-5]am\b/) <= 1, 'small hours');
  for (const id of nhie.DECK_IDS) assert.ok(nhie.DECKS[id].prompts.filter((p) => /\bin this room\b/.test(p)).length <= 3, `${id}: in this room`);
});

test('most likely to: titles replace per card, ties share them, and the table ranks them', () => {
  let titles = mlt.crown([], 'fight a goose and lose', ['Sam']);
  titles = mlt.crown(titles, 'adopt a raccoon', ['Jo']);
  titles = mlt.crown(titles, 'eat a bug on a dare', ['Sam']);
  // Changing the pick for a card moves the title, it doesn't add one.
  titles = mlt.crown(titles, 'adopt a raccoon', ['Sam']);
  assert.equal(titles.length, 3);
  assert.ok(titles.every((t) => t.names.join() === 'Sam'));
  // No names takes it back.
  titles = mlt.crown(titles, 'adopt a raccoon', []);
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
  assert.equal(mlt.leaders(mlt.standings(['Jo'], [])), null);

  // A tie on the Point screen: both get the title, and both count it.
  const shared = mlt.crown([], 'adopt a raccoon', ['Jo', 'Sam']);
  const tied = mlt.standings(['Jo', 'Sam', 'Max'], shared);
  assert.deepEqual(mlt.leaders(tied), { names: ['Jo', 'Sam'], count: 1 });
  // The count comes first, so a long name can't push it off the Titles bar.
  assert.equal(mlt.leadLine(tied), 'Tied on 1: Jo and Sam');
  const crowd = ['A', 'B', 'C', 'D'];
  assert.equal(mlt.leadLine(mlt.standings(crowd, crowd.map((n) => ({ text: n, names: [n] })))), '4 people tied on 1');
});

test('most likely to: tapping names on the Point screen', () => {
  const room = ['Jo', 'Sam', 'Max', 'Bea'];
  let picked = mlt.togglePick(room, [], 'Max');
  assert.deepEqual(picked, ['Max']);
  picked = mlt.togglePick(room, picked, 'Jo');
  assert.deepEqual(picked, ['Jo', 'Max'], 'seating order, not tap order');
  assert.deepEqual(mlt.togglePick(room, picked, 'Max'), ['Jo']);
  assert.equal(mlt.titleLine(['Sam']), 'Sam takes the title');
  assert.equal(mlt.titleLine(['Jo', 'Sam']), 'Jo and Sam share the title');
  assert.equal(mlt.titleLine(room), '4 people share the title');
  assert.equal(mlt.SIP_CAP, 3);
});

test('truth or dare: cards are full, unique, punctuated and mild unless asked', () => {
  for (const set of [TRUTHS, DARES]) {
    for (const tier of SPICES) assert.equal(set[tier].length, FULL, `${tier} has ${FULL} cards`);
    const all = SPICES.flatMap((tier) => set[tier]);
    assert.equal(new Set(all).size, all.length);
    for (const c of all) {
      assert.match(c, /^[A-Z]/, `"${c}" starts with a capital`);
      assert.match(c, /[.?][”]?$/, `"${c}" ends a sentence`);
      assert.doesNotMatch(c, dashes);
      assert.doesNotMatch(c, straight, `"${c}" uses typeset quotes`);
      assert.ok(c.length <= 100, `"${c}" fits on a card`);
    }
  }
});

test('truth or dare: 18+ is off by default, and each heat deals only its own tiers', () => {
  assert.equal(DEFAULT_SPICE, 'mild');
  assert.deepEqual([...SPICES], ['mild', 'spicy', 'after']);
  for (const kind of ['truth', 'dare'] as const) {
    assert.ok(cardsFor(kind, 'mild').every((c) => c.tier === 'mild' && c.kind === kind));
    // Spicy shuffles into Mild; After Dark shuffles into Spicy and never shows up below it.
    assert.deepEqual([...new Set(cardsFor(kind, 'spicy').map((c) => c.tier))], ['mild', 'spicy']);
    assert.deepEqual([...new Set(cardsFor(kind, 'after').map((c) => c.tier))], ['spicy', 'after']);
    assert.equal(cardsFor(kind, 'after').length, 2 * FULL);
  }
});

test('truth or dare: one way to ask for a yes, and no dare that drags on for a whole round', () => {
  const dares = SPICES.flatMap((tier) => DARES[tier]);
  for (const d of dares) {
    assert.doesNotMatch(d, /up for it|their okay|have to say yes|with their (ok|permission)/, `"${d}" uses “${CONSENT}”`);
    assert.doesNotMatch(d, /until your next turn/, `"${d}" ends before the circle comes back around`);
    // Touching, whispering to or pairing up with someone always asks first.
    if (/\b(rub|kiss someone|kiss whoever|lap|hold hands|hold someone|slow dance|swap|feed|whisper something|whisper a|speed date|style your hair|propose|body shot|ice cube to|undo|push-ups over|footsie|dance dip|trace a heart|seduce)\b/i.test(d)) assert.ok(d.endsWith(`, ${CONSENT}.`), `"${d}" asks for a yes`);
  }
  // Truths don't all open the same way.
  const truths = [...TRUTHS.mild, ...TRUTHS.spicy];
  assert.ok(truths.filter((t) => t.startsWith('What’s the')).length <= 12);
  assert.ok(TRUTHS.after.filter((t) => t.startsWith('What’s the')).length <= 8);
});

test('truth or dare: a session never repeats a card until it has seen them all', () => {
  const rng = mulberry32(3);
  const seen = new Set<string>();
  const shown: string[] = [];
  const deal = (cards: readonly tod.Card[], n: number) => {
    for (let i = 0; i < n; i++) {
      const c = tod.drawFresh(cards, seen, shown[shown.length - 1], rng);
      assert.ok(c);
      tod.markSeen(cards, seen, c.text);
      shown.push(c.text);
    }
  };
  // 30 mild dares, then Spicy goes on mid-game: the other 50 all come up before anything repeats.
  deal(cardsFor('dare', 'mild'), 30);
  deal(cardsFor('dare', 'spicy'), DARES.mild.length + DARES.spicy.length - 30);
  assert.equal(new Set(shown).size, shown.length);
});

test('truth or dare: turns go around the circle', () => {
  assert.equal(nextSeat(0, 3), 1);
  assert.equal(nextSeat(2, 3), 0);
  assert.equal(nextSeat(0, 0), 0);
});

test('truth or dare: records read like a person said them', () => {
  assert.equal(recordLine(EMPTY), '');
  assert.equal(recordLine({ truth: 1, dare: 0, chicken: 0 }), '1 truth');
  assert.equal(recordLine({ truth: 2, dare: 1, chicken: 1 }), '2 truths, 1 dare, chickened out once');
  assert.equal(recordLine({ truth: 0, dare: 0, chicken: 2 }), 'chickened out twice');
  assert.equal(recordLine({ truth: 0, dare: 3, chicken: 4 }), '3 dares, chickened out 4 times');

  const records = { Sam: { truth: 1, dare: 0, chicken: 3 }, Jo: { truth: 0, dare: 4, chicken: 3 }, Max: { truth: 2, dare: 1, chicken: 0 } };
  assert.deepEqual(most(records, ['Sam', 'Jo', 'Max'], 'chicken'), { names: ['Sam', 'Jo'], n: 3 });
  assert.deepEqual(most(records, ['Sam', 'Jo', 'Max'], 'dare'), { names: ['Jo'], n: 4 });
  assert.equal(most({ Max: EMPTY }, ['Max'], 'chicken'), null);
});

// A group often plays these three back to back, so the same idea shouldn't turn up in two of them (or twice in one).
const IRREGULAR: Record<string, string> = { said: 'say', eaten: 'eat', ate: 'eat', went: 'go', gone: 'go', done: 'do', made: 'make', told: 'tell', lost: 'lose', left: 'leave', slept: 'sleep', woke: 'wake', woken: 'wake', fell: 'fall', fallen: 'fall', stole: 'steal', stolen: 'steal', sent: 'send', thrown: 'throw', threw: 'throw', bought: 'buy', caught: 'catch', kept: 'keep', broke: 'break', broken: 'break', sung: 'sing', sang: 'sing', swore: 'swear', sworn: 'swear', wore: 'wear', worn: 'wear', hidden: 'hide', hid: 'hide', found: 'find', met: 'meet', taken: 'take', took: 'take', given: 'give', gave: 'give', forgotten: 'forget', forgot: 'forget', ran: 'run', drunk: 'drink', drank: 'drink', slid: 'slide', snuck: 'sneak', cried: 'cry', lied: 'lie', dumped: 'dump', kissed: 'kiss', texted: 'text', hooked: 'hook', ghosted: 'ghost', dated: 'date', married: 'marry', flirted: 'flirt' };
const STOP = new Set(
  'a an the to of in on at and or my your their our i you me we us someone something anyone everyone with for by from it is was be been being have has had that this who what here than out up off down as into over just about all them they its are do did does if not no person room one get got gotten ever still most likely how when where why which would could should will can let group tonight there then too very really so some any more while after before back away own every each other another like right now want next turn'.split(' '),
);
/** The content words of a prompt, roughly stemmed, without the consent phrase every dare shares. */
function core(text: string): Set<string> {
  const t = text
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(new RegExp(CONSENT, 'g'), ' ')
    .replace(/'(s|d|ve|re|ll|m)\b/g, ' ')
    .replace(/n't\b/g, ' ')
    .replace(/[^a-z ]/g, ' ');
  const out = new Set<string>();
  for (const raw of t.split(/\s+/)) {
    if (!raw || STOP.has(raw)) continue;
    const w = IRREGULAR[raw] ?? raw.replace(/(ing|ed|es|s)$/, '').replace(/(.)\1$/, '$1');
    if (w.length > 1 && !STOP.has(w)) out.add(w);
  }
  return out;
}

test('prompt decks: no near-duplicates within or across the three games', () => {
  const items: [string, string][] = [];
  for (const p of nhie.promptsFor(nhie.DECK_IDS)) items.push([`Never Have I Ever (${p.deck})`, p.text]);
  for (const p of mlt.promptsFor(mlt.DECK_IDS)) items.push([`Most Likely To (${p.deck})`, p.text]);
  for (const kind of ['truth', 'dare'] as const) for (const tier of SPICES) for (const text of (kind === 'truth' ? TRUTHS : DARES)[tier]) items.push([`Truth or Dare (${kind}, ${tier})`, text]);
  const cores = items.map(([, text]) => core(text));
  const close: string[] = [];
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      const [a, b] = cores[i].size <= cores[j].size ? [cores[i], cores[j]] : [cores[j], cores[i]];
      let shared = 0;
      a.forEach((w) => b.has(w) && shared++);
      // The same idea: every word of the shorter one with little added, or three or more words and most of it.
      if ((a.size >= 2 && shared === a.size && b.size - a.size <= 2) || (shared >= 3 && shared / a.size >= 0.6)) close.push(`${items[i].join(': ')}  ~  ${items[j].join(': ')}`);
    }
  assert.deepEqual(close, []);
  // The pairs a playtest found, as a check that the check works.
  assert.ok([...core('had a vacation fling')].every((w) => core('have a vacation fling').has(w)));
  assert.ok([...core('drunk text an ex tonight')].every((w) => core('drunk texted an ex').has(w)));
});
