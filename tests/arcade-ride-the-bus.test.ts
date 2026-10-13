import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32, shuffle } from '../src/os/arcade/kit/party-core.ts';
import {
  ACE,
  CHOICES,
  SUITS,
  advance,
  answer,
  boardBus,
  cardName,
  checkColor,
  checkHigherLower,
  checkInsideOutside,
  checkSuit,
  chooseRider,
  colorOf,
  dealHand,
  isEdge,
  isRight,
  makeDeck,
  rankPlural,
  sipsFor,
  startBus,
  startGame,
  upcoming,
  withMercy,
  type Card,
  type Game,
  type Guess,
  type Suit,
} from '../src/os/arcade/games/ride-the-bus/logic.ts';

let nextId = 100;
const c = (rank: number, suit: Suit = 'spades'): Card => ({ id: nextId++, rank, suit });

/** A stacked shoe: the hands in order, four cards each. */
const stack = (...hands: Card[][]) => hands.flat();

/** Answers and advances once. */
const play = (g: Game, guess: Guess, rng = mulberry32(1)) => {
  const answered = answer(g, guess);
  assert.ok(answered.verdict, `expected a verdict for ${guess}`);
  return { answered, next: advance(answered, rng) };
};

test('the deck has 52 unique cards with aces high', () => {
  const deck = makeDeck();
  assert.equal(deck.length, 52);
  assert.equal(new Set(deck.map((x) => x.id)).size, 52);
  for (const suit of SUITS) assert.equal(deck.filter((x) => x.suit === suit).length, 13);
  for (let rank = 2; rank <= ACE; rank++) assert.equal(deck.filter((x) => x.rank === rank).length, 4);
  assert.equal(ACE, 14);
  assert.equal(cardName({ id: 0, rank: 14, suit: 'spades' }), 'Ace of Spades');
  assert.equal(cardName({ id: 0, rank: 12, suit: 'hearts' }), 'Queen of Hearts');
  assert.equal(rankPlural(7), '7s');
  assert.equal(rankPlural(11), 'Jacks');
});

test('shuffles and deals are repeatable with a seed', () => {
  const a = startGame(3, mulberry32(42));
  const b = startGame(3, mulberry32(42));
  assert.deepEqual(a.hand, b.hand);
  assert.deepEqual(a.shoe, b.shoe);
  assert.notDeepEqual(a.hand, startGame(3, mulberry32(43)).hand);
  assert.equal(a.hand.length + a.shoe.length, 52);
  assert.equal(new Set([...a.hand, ...a.shoe].map((x) => x.id)).size, 52);
  assert.deepEqual(shuffle(makeDeck(), mulberry32(5)), shuffle(makeDeck(), mulberry32(5)));
});

test('a hand comes off the top, and a low shoe is reshuffled into a fresh deck', () => {
  const shoe = [c(2), c(3), c(4), c(5), c(6)];
  const d = dealHand(shoe, mulberry32(1));
  assert.deepEqual(d.hand, shoe.slice(0, 4));
  assert.deepEqual(d.shoe, shoe.slice(4));
  assert.equal(d.reshuffled, false);

  const low = dealHand(d.shoe, mulberry32(1));
  assert.equal(low.reshuffled, true);
  assert.equal(low.hand.length, 4);
  assert.equal(low.shoe.length, 48);
  assert.equal(new Set([...low.hand, ...low.shoe].map((x) => x.id)).size, 52);
});

test('red or black', () => {
  assert.equal(colorOf(c(5, 'hearts')), 'red');
  assert.equal(colorOf(c(5, 'diamonds')), 'red');
  assert.equal(colorOf(c(5, 'clubs')), 'black');
  assert.ok(checkColor(c(9, 'diamonds'), 'red'));
  assert.ok(!checkColor(c(9, 'diamonds'), 'black'));
  assert.ok(checkColor(c(9, 'spades'), 'black'));
});

test('higher or lower, with ties wrong and aces high', () => {
  const seven = c(7);
  assert.ok(checkHigherLower(seven, c(9), 'higher'));
  assert.ok(!checkHigherLower(seven, c(9), 'lower'));
  assert.ok(checkHigherLower(seven, c(3), 'lower'));
  assert.ok(!checkHigherLower(seven, c(7, 'hearts'), 'higher'));
  assert.ok(!checkHigherLower(seven, c(7, 'hearts'), 'lower'));
  assert.ok(checkHigherLower(c(13), c(ACE), 'higher'));
  assert.ok(checkHigherLower(c(ACE), c(2), 'lower'));
  assert.ok(!checkHigherLower(seven, c(9), 'red'));
});

test('inside or outside, with either edge wrong', () => {
  const four = c(4);
  const jack = c(11);
  assert.ok(checkInsideOutside(four, jack, c(7), 'inside'));
  assert.ok(!checkInsideOutside(four, jack, c(7), 'outside'));
  assert.ok(checkInsideOutside(jack, four, c(7), 'inside'), 'order of the first two does not matter');
  assert.ok(checkInsideOutside(four, jack, c(2), 'outside'));
  assert.ok(checkInsideOutside(four, jack, c(ACE), 'outside'));
  for (const edge of [4, 11]) {
    assert.ok(!checkInsideOutside(four, jack, c(edge, 'hearts'), 'inside'), `edge ${edge} is not inside`);
    assert.ok(!checkInsideOutside(four, jack, c(edge, 'hearts'), 'outside'), `edge ${edge} is not outside`);
  }
  // Neighbours leave no room inside; a pair leaves none at all.
  assert.ok(!checkInsideOutside(c(5), c(6), c(5, 'hearts'), 'inside'));
  assert.ok(!checkInsideOutside(c(8), c(8, 'clubs'), c(8, 'hearts'), 'outside'));
  assert.ok(checkInsideOutside(c(8), c(8, 'clubs'), c(9), 'outside'));
  assert.ok(!checkInsideOutside(c(8), c(8, 'clubs'), c(9), 'inside'));
});

test('which suit', () => {
  assert.ok(checkSuit(c(2, 'clubs'), 'clubs'));
  assert.ok(!checkSuit(c(2, 'clubs'), 'spades'));
  assert.ok(!checkSuit(c(2, 'clubs'), 'black'));
});

test('isRight routes each question to its check', () => {
  const hand = [c(4, 'hearts'), c(10, 'clubs'), c(7, 'diamonds'), c(2, 'spades')];
  assert.ok(isRight(hand, 0, 'red'));
  assert.ok(isRight(hand, 1, 'higher'));
  assert.ok(isRight(hand, 2, 'inside'));
  assert.ok(isRight(hand, 3, 'spades'));
  assert.ok(!isRight(hand, 3, 'hearts'));
  assert.ok(!isRight(hand, 4, 'red'));
});

test('an edge is a card that matches a rank the call depends on', () => {
  const hand = [c(7), c(7, 'hearts'), c(12), c(3)];
  assert.ok(isEdge(hand, 1), 'same rank as card one on higher or lower');
  assert.ok(!isEdge(hand, 0), 'red or black has no edge');
  assert.ok(!isEdge(hand, 3), 'the suit has no edge');
  assert.ok(!isEdge([c(4), c(9), c(6)], 2));
  assert.ok(isEdge([c(4), c(9), c(9, 'clubs')], 2), 'matching the second card');
  assert.ok(isEdge([c(4), c(9), c(4, 'clubs')], 2), 'matching the first card');
  assert.ok(!isEdge([c(4), c(5)], 1));
  assert.ok(!isEdge([c(4)], 1), 'no card there yet');
});

test('sips match the question number', () => {
  assert.deepEqual([0, 1, 2, 3].map(sipsFor), [1, 2, 3, 4]);
});

test('the four questions: wrong drinks, right gives, then the next player', () => {
  const sam = [c(4, 'hearts'), c(10, 'clubs'), c(7, 'diamonds'), c(2, 'spades')];
  const jo = [c(9, 'spades'), c(9, 'hearts'), c(3, 'clubs'), c(5, 'diamonds')];
  let g = startGame(2, mulberry32(3), stack(sam, jo, [c(2), c(3), c(4), c(5)]));
  assert.equal(g.phase, 'questions');
  assert.equal(g.seat, 0);
  assert.deepEqual(g.hand, sam);
  assert.equal(upcoming(g), null);
  assert.equal(advance(g, mulberry32(1)), g, 'no moving on before answering');

  // Sam: right (1), wrong (2), right (3), wrong (4).
  let r = play(g, 'red');
  assert.deepEqual(r.answered.verdict, { q: 0, guess: 'red', right: true, sips: 1, card: sam[0] });
  assert.equal(answer(r.answered, 'black'), r.answered, 'a second answer is ignored');
  assert.equal(upcoming(r.answered), 'card');
  g = r.next;
  assert.equal(g.shown, 1);
  assert.equal(g.verdict, null);
  assert.equal(answer(g, 'red'), g, 'a guess for another question is ignored');
  g = play(g, 'lower').next;
  g = play(g, 'inside').next;
  r = play(g, 'hearts');
  assert.equal(r.answered.verdict?.right, false);
  assert.equal(upcoming(r.answered), 'player');
  assert.deepEqual(r.answered.marks, [true, false, true, false], 'each flipped card remembers how it went');
  assert.deepEqual(r.answered.taken, [6, 0]);
  assert.deepEqual(r.answered.given, [4, 0]);
  g = r.next;
  assert.equal(g.seat, 1);
  assert.equal(g.shown, 0);
  assert.deepEqual(g.hand, jo);
  assert.deepEqual(g.marks, [], 'a new hand starts with no marks');

  // Jo: a tie on higher, an edge on outside.
  g = play(g, 'black').next;
  r = play(g, 'higher');
  assert.equal(r.answered.verdict?.right, false, 'a tie on higher or lower is wrong');
  g = r.next;
  r = play(g, 'outside');
  assert.equal(r.answered.verdict?.right, true);
  g = r.next;
  r = play(g, 'diamonds');
  assert.equal(upcoming(r.answered), 'results');
  assert.deepEqual(r.answered.taken, [6, 2]);
  assert.deepEqual(r.answered.given, [4, 8]);
  g = r.next;
  assert.equal(g.phase, 'results');
  assert.equal(g.seat, 0, 'most sips taken rides the bus');
  assert.deepEqual(g.tied, [0]);
});

test('the rider is the most sips taken, and the cards break a tie', () => {
  assert.deepEqual(chooseRider([3, 9, 4]), { rider: 1, tied: [1] });
  assert.deepEqual(chooseRider([5, 2, 5, 5], () => 0), { rider: 0, tied: [0, 2, 3] });
  assert.deepEqual(chooseRider([5, 2, 5, 5], () => 0.5), { rider: 2, tied: [0, 2, 3] });
  assert.deepEqual(chooseRider([5, 2, 5, 5], () => 0.9999), { rider: 3, tied: [0, 2, 3] });
  assert.deepEqual(chooseRider([0, 0], () => 0.99), { rider: 1, tied: [0, 1] });
  assert.deepEqual(chooseRider([7]), { rider: 0, tied: [0] });
  const seeded = chooseRider([1, 1, 1], mulberry32(9));
  assert.deepEqual(seeded, chooseRider([1, 1, 1], mulberry32(9)));
});

test('a solo game plays one hand and the only player rides', () => {
  let g = startGame(0, mulberry32(4));
  assert.equal(g.count, 1, 'no players plays as one');
  for (let q = 0; q < 4; q++) g = advance(answer(g, CHOICES[q][0]), mulberry32(1));
  assert.equal(g.phase, 'results');
  assert.equal(g.seat, 0);
  const bus = boardBus(g, mulberry32(2));
  assert.equal(bus.phase, 'bus');
  assert.equal(bus.attempts, 1);
  assert.equal(bus.busSips, 0);
  assert.equal(bus.best, 0);
  assert.equal(bus.shown, 0);
  assert.equal(bus.hand.length, 4);
  assert.equal(boardBus(bus), bus, 'only boards from the results');
});

test('the bus starts over with fresh cards on any miss, and four in a row gets off', () => {
  const first = [c(5, 'hearts'), c(8, 'spades'), c(6, 'clubs'), c(12, 'diamonds')];
  const second = [c(10, 'clubs'), c(3, 'hearts'), c(14, 'spades'), c(9, 'diamonds')];
  const third = [c(2, 'diamonds'), c(13, 'clubs'), c(8, 'hearts'), c(4, 'spades')];
  let g = startBus(3, 2, mulberry32(1), stack(first, second, third));
  assert.equal(g.phase, 'bus');
  assert.equal(g.seat, 2);
  assert.equal(g.attempts, 1);
  assert.equal(g.best, 0);
  assert.deepEqual(g.hand, first);

  // Attempt 1: right, right, then a miss on question 3.
  g = play(g, 'red').next;
  g = play(g, 'higher').next;
  let r = play(g, 'outside');
  assert.equal(r.answered.verdict?.right, false);
  assert.equal(r.answered.busSips, 3);
  assert.equal(upcoming(r.answered), 'retry');
  g = r.next;
  assert.equal(g.attempts, 2);
  assert.equal(g.shown, 0);
  assert.deepEqual(g.marks, []);
  assert.deepEqual(g.hand, second, 'a fresh hand after a miss');

  // Attempt 2: a miss on the first card.
  r = play(g, 'red');
  assert.equal(r.answered.busSips, 4);
  g = r.next;
  assert.equal(g.attempts, 3);
  assert.deepEqual(g.hand, third);

  assert.equal(g.best, 2, 'the best run so far was two right on attempt 1');

  // Attempt 3: all four.
  g = play(g, 'red').next;
  g = play(g, 'higher').next;
  assert.equal(g.best, 2, 'matching the best run does not move it');
  g = play(g, 'inside').next;
  assert.equal(g.best, 3);
  r = play(g, 'spades');
  assert.equal(r.answered.best, 4);
  assert.equal(upcoming(r.answered), 'off');
  assert.equal(r.answered.busSips, 4, 'right answers on the bus cost nothing');
  g = r.next;
  assert.equal(g.phase, 'off');
  assert.equal(g.attempts, 3);
  assert.deepEqual(g.hand, third, 'the winning hand stays on the table');
  assert.equal(answer(g, 'red'), g);
  assert.equal(advance(g), g);
  assert.deepEqual(g.taken, [0, 0, 0], 'just the bus has no question round');
});

test('just the bus clamps the rider to the table', () => {
  assert.equal(startBus(2, 5, mulberry32(1)).seat, 1);
  assert.equal(startBus(0, 0, mulberry32(1)).count, 1);
});

test('a long seeded bus ride keeps dealing valid hands until someone gets off', () => {
  const rng = mulberry32(2024);
  let g = startBus(1, 0, rng);
  let steps = 0;
  while (g.phase === 'bus' && steps < 20_000) {
    // A sensible player: guess by the odds.
    const q = g.shown;
    const [a, b] = g.hand;
    let guess: Guess = CHOICES[q][Math.floor(rng() * CHOICES[q].length)];
    if (q === 1) guess = a.rank >= 8 ? 'lower' : 'higher';
    if (q === 2) guess = Math.abs(a.rank - b.rank) > 6 ? 'inside' : 'outside';
    g = advance(answer(g, guess), rng);
    assert.equal(g.hand.length, 4);
    assert.equal(new Set(g.hand.map((x) => x.id)).size, 4, 'no repeats inside a hand');
    steps++;
  }
  assert.equal(g.phase, 'off');
  assert.ok(g.attempts >= 1);
  assert.ok(g.busSips >= 0);
});

test('the mercy rule lets the rider off after the last allowed try', () => {
  const rng = mulberry32(9);
  // Guess the wrong color every time: each attempt misses on the first card.
  const miss = (g: ReturnType<typeof startBus>) => answer(g, g.hand[0].suit === 'hearts' || g.hand[0].suit === 'diamonds' ? 'black' : 'red');
  let g = withMercy(startBus(3, 1, rng), 3);
  for (let attempt = 1; attempt < 3; attempt++) {
    g = miss(g);
    assert.equal(upcoming(g), 'retry');
    g = advance(g, rng);
  }
  g = miss(g);
  assert.equal(upcoming(g), 'mercy');
  g = advance(g, rng);
  assert.equal(g.phase, 'off');
  assert.equal(g.mercy, true);
  assert.equal(g.attempts, 3);
  assert.equal(g.busSips, 3);
  assert.equal(g.best, 0, 'never got past the first card');
  let open = withMercy(startBus(1, 0, rng), 0);
  for (let i = 0; i < 20; i++) {
    open = miss(open);
    assert.equal(upcoming(open), 'retry');
    open = advance(open, rng);
  }
});
