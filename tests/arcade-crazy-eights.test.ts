import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decide, sampleWorld } from '../src/os/arcade/games/crazy-eights/ai.ts';
import {
  apply,
  applyMut,
  canPlay,
  cardOf,
  cardPoints,
  drawable,
  handPoints,
  isAction,
  isLegal,
  legalMoves,
  newMatch,
  nextHand,
  observe,
  parseMove,
  randomFrom,
  rankOf,
  suitOf,
  type Move,
  type State,
} from '../src/os/arcade/games/crazy-eights/logic.ts';

const c = (suit: number, rank: number) => cardOf(suit, rank);

type FixtureOptions = {
  seed?: number;
  pile?: number[];
  suit?: number;
  deck?: number[];
  turn?: number;
  pending?: number;
  drew?: number | null;
  dir?: 1 | -1;
  scores?: number[];
  target?: number;
};

function fixture(hands: number[][], options: FixtureOptions = {}): State {
  const s = newMatch(hands.length, options.seed ?? 1, options.target);
  s.hands = hands.map((hand) => hand.slice());
  s.pile = (options.pile ?? [c(0, 5)]).slice();
  s.suit = options.suit ?? suitOf(s.pile[s.pile.length - 1]);
  s.deck = (options.deck ?? []).slice();
  s.turn = options.turn ?? 0;
  s.pending = options.pending ?? 0;
  s.drew = options.drew ?? null;
  s.dir = options.dir ?? 1;
  s.scores = options.scores?.slice() ?? Array(hands.length).fill(0);
  s.stuck = 0;
  s.voids = Array(hands.length).fill(0);
  s.voidCards = Array(hands.length).fill(0);
  s.last = null;
  s.winner = null;
  s.phase = 'play';
  s.log = [];
  return s;
}

const playCards = (moves: Move[]) => moves.filter((m) => m.t === 'play');

test('new matches deal the right hand size, account for all cards, and replay by seed', () => {
  for (const players of [2, 3, 4]) {
    for (let seed = 0; seed < 256; seed++) {
      const s = newMatch(players, seed);
      const cards = [...s.hands.flat(), ...s.deck, ...s.pile];
      assert.equal(s.hands.every((hand) => hand.length === (players === 2 ? 7 : 5)), true);
      assert.equal(cards.length, 52);
      assert.equal(new Set(cards).size, 52);
      assert.deepEqual([...cards].sort((a, b) => a - b), Array.from({ length: 52 }, (_, i) => i));
      assert.equal(isAction(s.pile.at(-1)!), false);
      assert.deepEqual(s, newMatch(players, seed));
    }
  }
});

test('play legality follows suit or rank, eights offer each suit, and draw states narrow moves', () => {
  const s = fixture([[c(1, 5), c(2, 8), c(3, 4)], [c(2, 3)]], { deck: [c(3, 9)] });
  assert.equal(canPlay(s, c(1, 5)), true);
  assert.equal(canPlay(s, c(3, 5)), true);
  assert.equal(canPlay(s, c(2, 8)), true);
  assert.equal(canPlay(s, c(3, 4)), false);
  const moves = legalMoves(s, 0);
  assert.ok(moves.some((m) => m.t === 'play' && m.card === c(1, 5)));
  assert.deepEqual(playCards(moves).filter((m) => m.card === c(2, 8)).map((m) => m.suit), [0, 1, 2, 3]);

  const pending = fixture([[c(0, 2), c(2, 2), c(3, 9)], [c(1, 4)]], { pending: 2, deck: [c(2, 7)] });
  assert.deepEqual(legalMoves(pending, 0), [
    { t: 'play', card: c(0, 2) },
    { t: 'play', card: c(2, 2) },
    { t: 'draw' },
  ]);

  const voluntary = fixture([[c(0, 7), c(1, 3)], [c(3, 4)]], { deck: [c(0, 9)] });
  assert.equal(applyMut(voluntary, 0, { t: 'draw' }), true);
  assert.deepEqual(legalMoves(voluntary, 0), [
    { t: 'play', card: c(0, 9) },
    { t: 'pass' },
  ]);

  const empty = fixture([[c(1, 3)], [c(2, 4)]]);
  assert.equal(drawable(empty), 0);
  assert.deepEqual(legalMoves(empty, 0), [{ t: 'pass' }]);
  const noDrawButPlayable = fixture([[c(0, 9)], [c(2, 4)]]);
  assert.deepEqual(legalMoves(noDrawButPlayable, 0), [{ t: 'play', card: c(0, 9) }]);
});

test('eights call a suit, twos stack, penalties draw available cards, and action turns resolve', () => {
  const eight = fixture([[c(1, 8), c(1, 3)], [c(2, 4)]]);
  assert.equal(applyMut(eight, 0, { t: 'play', card: c(1, 8), suit: 2 }), true);
  assert.equal(eight.suit, 2);
  assert.equal(eight.turn, 1);

  const two = fixture([[c(0, 2), c(1, 3)], [c(2, 2), c(3, 4)]]);
  assert.equal(applyMut(two, 0, { t: 'play', card: c(0, 2) }), true);
  assert.equal(two.pending, 2);
  assert.equal(two.turn, 1);
  assert.equal(applyMut(two, 1, { t: 'play', card: c(2, 2) }), true);
  assert.equal(two.pending, 4);
  assert.equal(two.turn, 0);

  const penalty = fixture([[c(1, 3)], [c(2, 4)]], {
    pending: 4,
    deck: [c(2, 6), c(3, 9)],
  });
  assert.equal(applyMut(penalty, 0, { t: 'draw' }), true);
  assert.equal(penalty.hands[0].length, 3);
  assert.equal(penalty.pending, 0);
  assert.equal(penalty.turn, 1);
  assert.deepEqual(penalty.log.find((ev) => ev.k === 'draw'), { k: 'draw', p: 0, n: 2, forced: true });

  for (const players of [2, 3]) {
    const jack = fixture([[c(0, 11), c(1, 3)], ...Array.from({ length: players - 1 }, () => [c(2, 4)])]);
    assert.equal(applyMut(jack, 0, { t: 'play', card: c(0, 11) }), true);
    assert.equal(jack.turn, players === 2 ? 0 : 2);
  }

  for (const players of [2, 3, 4]) {
    const queen = fixture([[c(0, 12), c(1, 3)], ...Array.from({ length: players - 1 }, () => [c(2, 4)])]);
    assert.equal(applyMut(queen, 0, { t: 'play', card: c(0, 12) }), true);
    if (players === 2) {
      assert.equal(queen.dir, 1);
      assert.equal(queen.turn, 0);
    } else {
      assert.equal(queen.dir, -1);
      assert.equal(queen.turn, players - 1);
    }
  }
});

test('illegal moves preserve state and apply returns an independent state', () => {
  const s = fixture([[c(1, 3), c(0, 9)], [c(2, 4)]]);
  for (const [player, move] of [
    [0, { t: 'play', card: c(1, 3) }],
    [1, { t: 'play', card: c(0, 9) }],
    [0, { t: 'play', card: c(3, 12) }],
  ] as const) {
    const before = structuredClone(s);
    assert.equal(applyMut(s, player, move), false);
    assert.deepEqual(s, before);
    assert.equal(apply(s, player, move), null);
    assert.deepEqual(s, before);
  }

  const before = structuredClone(s);
  const next = apply(s, 0, { t: 'play', card: c(0, 9) });
  assert.ok(next);
  assert.deepEqual(s, before);
  assert.notEqual(next, s);
  next.hands[0].push(c(3, 10));
  assert.deepEqual(s, before);
});

test('voluntary draws update void knowledge and either hold the playable card or auto-pass', () => {
  const unplayable = fixture([[c(1, 3)], [c(2, 4)]], { deck: [c(2, 9)] });
  assert.equal(applyMut(unplayable, 0, { t: 'draw' }), true);
  assert.equal(unplayable.turn, 1);
  assert.equal(unplayable.drew, null);
  assert.equal(unplayable.voids[0], 1 << 0);
  assert.equal(unplayable.voidCards[0], 1);

  const playable = fixture([[c(0, 7)], [c(2, 4)]], { deck: [c(0, 9)] });
  assert.equal(applyMut(playable, 0, { t: 'draw' }), true);
  assert.equal(playable.turn, 0);
  assert.equal(playable.drew, c(0, 9));
  assert.equal(playable.voids[0], 1 << 0);
  assert.equal(playable.voidCards[0], 1);
});

test('drawing with an empty deck reshuffles discards while preserving the top card', () => {
  const s = fixture([[c(1, 3)], [c(2, 4)]], {
    pile: [c(0, 6), c(2, 10), c(3, 7)],
    deck: [],
  });
  const oldTop = s.pile.at(-1);
  const oldDrawable = drawable(s);
  assert.equal(applyMut(s, 0, { t: 'draw' }), true);
  assert.equal(s.pile.length, 1);
  assert.equal(s.pile[0], oldTop);
  assert.equal(s.deck.length + s.hands[0].length - 1, oldDrawable);
  assert.ok(s.log.some((ev) => ev.k === 'reshuffle'));
});

test('scoring, hand transitions, match completion, and blocked hands use the right winner', () => {
  assert.equal(cardPoints(c(0, 8)), 50);
  for (const rank of [2, 11, 12]) assert.equal(cardPoints(c(1, rank)), 20);
  assert.equal(cardPoints(c(2, 13)), 10);
  assert.equal(cardPoints(c(3, 1)), 1);
  assert.equal(cardPoints(c(0, 7)), 7);
  assert.equal(handPoints([c(0, 8), c(1, 2), c(2, 6)]), 76);

  const handEnd = fixture([[c(0, 9)], [c(2, 8), c(1, 3)]], { target: 500 });
  const oldDealer = handEnd.dealer;
  assert.equal(applyMut(handEnd, 0, { t: 'play', card: c(0, 9) }), true);
  assert.equal(handEnd.phase, 'hand-over');
  assert.equal(handEnd.scores[0], 53);
  assert.deepEqual(handEnd.last?.points, [0, 53]);
  const next = nextHand(handEnd);
  assert.equal(next.phase, 'play');
  assert.equal(next.dealer, (oldDealer + 1) % next.n);
  assert.equal(next.handNo, handEnd.handNo + 1);
  assert.equal(next.hands.every((hand) => hand.length === 7), true);

  const matchEnd = fixture([[c(0, 9)], [c(1, 3)]], { target: 3 });
  assert.equal(applyMut(matchEnd, 0, { t: 'play', card: c(0, 9) }), true);
  assert.equal(matchEnd.phase, 'match-over');
  assert.equal(matchEnd.winner, 0);

  const blocked = fixture([[c(1, 3)], [c(2, 4)]]);
  assert.equal(applyMut(blocked, 0, { t: 'pass' }), true);
  assert.equal(blocked.phase, 'play');
  assert.equal(applyMut(blocked, 1, { t: 'pass' }), true);
  assert.equal(blocked.phase, 'hand-over');
  assert.equal(blocked.last?.blocked, true);
  assert.equal(blocked.last?.winner, 0);
});

test('observations hide opponents’ hands and expose drawn cards only to their holder', () => {
  const s = fixture([[c(0, 3)], [c(1, 4)], [c(2, 6)]], { drew: c(1, 4), turn: 1 });
  const own = observe(s, 1);
  const other = observe(s, 0);
  assert.deepEqual(own.hand, [c(1, 4)]);
  assert.equal(own.drew, c(1, 4));
  assert.equal(other.drew, -1);
  assert.equal(Object.hasOwn(other, 'hands'), false);
  assert.equal(Object.hasOwn(other, 'last'), true);
  assert.equal(other.last, null);
  assert.deepEqual(other.pile, s.pile);
  assert.equal(other.hand.some((card) => s.hands[1].includes(card) || s.hands[2].includes(card)), false);

  s.phase = 'hand-over';
  s.last = { winner: 0, gained: 10, points: [0, 4, 6], hands: s.hands.map((hand) => hand.slice()), blocked: false };
  const ended = observe(s, 1);
  assert.deepEqual(ended.last?.hands, s.hands);
});

test('parseMove rejects malformed network moves', () => {
  for (const junk of [null, undefined, 5, {}, { t: 'noop' }, { t: 'play' }, { t: 'play', card: -1 }, { t: 'play', card: 52 }, { t: 'play', card: 1.5 }, { t: 'play', card: 1, suit: -1 }, { t: 'play', card: 1, suit: 4 }, { t: 'play', card: 1, suit: 0.5 }]) {
    assert.equal(parseMove(junk), null);
  }
  assert.deepEqual(parseMove({ t: 'draw' }), { t: 'draw' });
  assert.deepEqual(parseMove({ t: 'pass' }), { t: 'pass' });
  assert.deepEqual(parseMove({ t: 'play', card: 51 }), { t: 'play', card: 51 });
  assert.deepEqual(parseMove({ t: 'play', card: 7, suit: 3 }), { t: 'play', card: 7, suit: 3 });
});

test('mixed-level seeded full matches always produce legal AI moves', () => {
  for (let game = 0; game < 9; game++) {
    const n = 2 + (game % 3);
    const s = newMatch(n, 900 + game);
    const levels = Array.from({ length: n }, (_, p) => ((p + game) % 3) as 0 | 1 | 2);
    const randoms = Array.from({ length: n }, (_, p) => randomFrom(31_337 + game * 101 + p));
    let plies = 0;
    while (s.phase !== 'match-over' && plies < 5_000) {
      if (s.phase === 'hand-over') {
        Object.assign(s, nextHand(s));
        continue;
      }
      const p = s.turn;
      const move = decide(observe(s, p), levels[p], randoms[p], levels[p] === 2 ? { worlds: 12 } : {});
      assert.ok(isLegal(s, p, move), `game ${game}, player ${p}, level ${levels[p]}, move ${JSON.stringify(move)}`);
      assert.equal(applyMut(s, p, move), true);
      plies++;
    }
    assert.equal(s.phase, 'match-over', `game ${game} did not finish within ${plies} plies`);
  }
});

test('Hard takes a winning last card, saves an eight when another play is available, and selects its suit', () => {
  const winning = fixture([[c(0, 9)], [c(2, 4)]]);
  assert.deepEqual(decide(observe(winning, 0), 2, randomFrom(5), { worlds: 12 }), { t: 'play', card: c(0, 9) });

  const saveEight = fixture([[c(1, 8), c(0, 7), c(0, 9), c(0, 10)], [c(2, 4), c(3, 6)]]);
  const saved = decide(observe(saveEight, 0), 2, randomFrom(6), { worlds: 12 });
  assert.equal(saved.t, 'play');
  if (saved.t === 'play') assert.notEqual(rankOf(saved.card), 8);

  const holdEight = fixture([[c(1, 8), c(0, 3), c(2, 4)], [c(3, 6)]], { pile: [c(3, 5)], deck: [] });
  const called = decide(observe(holdEight, 0), 2, randomFrom(7), { worlds: 12 });
  assert.equal(called.t, 'play');
  if (called.t === 'play') {
    assert.equal(called.card, c(1, 8));
    assert.ok(Number.isInteger(called.suit) && called.suit! >= 0 && called.suit! <= 3);
  }
});

test('sampled worlds preserve hidden counts and exclude known cards from hidden allocations', () => {
  const s = newMatch(4, 88);
  const me = s.turn;
  const view = observe(s, me);
  const world = sampleWorld(view, randomFrom(1234));
  assert.deepEqual(world.hands.map((hand) => hand.length), view.counts);
  assert.equal(world.deck.length, view.deckCount);
  const hidden = [...world.hands.filter((_, p) => p !== me).flat(), ...world.deck];
  const known = new Set([...view.hand, ...view.pile]);
  assert.equal(hidden.some((card) => known.has(card)), false);
});

test('the top rival never covers the draw and discard piles', async () => {
  const { tableLayout, topSeatBottom, pileTop } = await import('../src/os/arcade/games/crazy-eights/layout.ts');
  const sizes = [
    { w: 1280, h: 496 },
    { w: 1280, h: 620 },
    { w: 1440, h: 780 },
    { w: 1920, h: 980 },
    { w: 900, h: 420 },
    { w: 820, h: 1000 },
    { w: 390, h: 700 },
    { w: 560, h: 360 },
  ];
  for (const { w, h } of sizes) {
    for (const n of [2, 4]) {
      for (const online of [false, true]) {
        for (const [nameH, barH] of [[42, 44], [56, 61]]) {
          const l = tableLayout({ w, h, n, online, nameH, barH });
          if (l.short) continue;
          const seat = topSeatBottom(l, nameH);
          const pile = pileTop(l, h, barH);
          assert.ok(pile >= seat + 8, `${w}x${h} n=${n} online=${online} name=${nameH}: rival ends at ${seat.toFixed(1)}, piles start at ${pile.toFixed(1)}`);
          if (h >= 400) assert.ok(pile + l.ch + 30 <= h - barH - l.handH + 1, `${w}x${h} n=${n}: pile labels run into your bar`);
          if (online) assert.ok(l.seatTop >= 40, 'online, the top rival sits below the room badge');
        }
      }
    }
  }
});

test('the table keeps its old roomy and short layouts where nothing overlapped', async () => {
  const { tableLayout } = await import('../src/os/arcade/games/crazy-eights/layout.ts');
  const short = tableLayout({ w: 700, h: 300, n: 4, online: false, nameH: 42, barH: 44 });
  assert.equal(short.short, true);
  const roomy = tableLayout({ w: 1440, h: 900, n: 3, online: false, nameH: 42, barH: 44 });
  assert.equal(roomy.short, false);
  assert.equal(roomy.cw, 104);
  assert.equal(roomy.pad, Math.round(roomy.ch * 0.3));
  const fourUp = tableLayout({ w: 1280, h: 496, n: 4, online: false, nameH: 42, barH: 44 });
  assert.ok(fourUp.cw >= 70, `cards stay readable at fullscreen 1280x720, got ${fourUp.cw}`);
});
