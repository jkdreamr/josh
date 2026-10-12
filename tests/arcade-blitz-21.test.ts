import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  breakdown,
  cardValue,
  createGame,
  currentCard,
  laneTotal,
  makeDeck,
  mulberry32,
  play,
  preview,
  ROUND_SECONDS,
  streakBonus,
  tick,
  type Card,
  type State,
  type Suit,
} from '../src/os/arcade/games/blitz-21/logic.ts';

let nextCardId = 0;
const c = (rank: number, suit: Suit = 'spades', id = nextCardId++): Card => ({ id, rank, suit });

const act = (state: State, lane: number) => {
  const outcome = play(state, lane);
  assert.ok(outcome);
  return outcome;
};

test('lane totals count aces as hard and soft when possible', () => {
  assert.deepEqual(laneTotal([c(1), c(6)]), { hard: 7, soft: 17, best: 17 });
  assert.deepEqual(laneTotal([c(1), c(1), c(9)]), { hard: 11, soft: 21, best: 21 });
  assert.deepEqual(laneTotal([c(1), c(13), c(5)]), { hard: 16, soft: null, best: 16 });
  assert.equal(cardValue(c(11)), 10);
  assert.equal(cardValue(c(12)), 10);
  assert.equal(cardValue(c(13)), 10);
  assert.deepEqual(laneTotal([]), { hard: 0, soft: null, best: 0 });
});

test('seeded decks contain the standard cards and shuffle deterministically', () => {
  const deck = makeDeck(mulberry32(7));
  assert.equal(new Set(deck.map((card) => card.id)).size, 52);
  for (const suit of ['spades', 'hearts', 'diamonds', 'clubs'] as const) {
    assert.equal(deck.filter((card) => card.suit === suit).length, 13);
  }
  for (let rank = 1; rank <= 13; rank++) {
    assert.equal(deck.filter((card) => card.rank === rank).length, 4);
  }
  assert.deepEqual(deck, makeDeck(mulberry32(7)));
  assert.notDeepEqual(deck, makeDeck(mulberry32(8)));
});

test('an ace completing 21 clears the lane as a blackjack', () => {
  const deck = [c(13), c(1)];
  const initial = createGame(Math.random, deck);
  const placed = act(initial, 0);
  assert.equal(placed.result.kind, 'place');

  const cleared = act(placed.state, 0);
  assert.equal(cleared.result.kind, 'clear');
  assert.equal(cleared.result.blackjack, true);
  assert.equal(cleared.result.points, 400 + 200);
  assert.deepEqual(cleared.state.lanes[0], []);
  assert.equal(cleared.state.score, 600);
  assert.equal(cleared.state.tally.blackjacks, 1);
});

test('five cards clear a lane, with or without totaling exactly 21', () => {
  const fiveCardDeck = [c(2), c(2), c(3), c(3), c(4)];
  let state = createGame(Math.random, fiveCardDeck);
  let result = act(state, 0);
  state = result.state;
  for (let i = 1; i < fiveCardDeck.length; i++) {
    result = act(state, 0);
    state = result.state;
  }
  assert.equal(result.result.kind, 'clear');
  assert.equal(result.result.total, 14);
  assert.equal(result.result.fiveCard, true);
  assert.equal(result.result.points, 400 + 600);
  assert.deepEqual(state.lanes[0], []);

  const exactTwentyOneDeck = [c(2), c(3), c(4), c(5), c(7)];
  state = createGame(Math.random, exactTwentyOneDeck);
  for (let i = 0; i < exactTwentyOneDeck.length; i++) {
    result = act(state, 0);
    state = result.state;
  }
  assert.equal(result.result.kind, 'clear');
  assert.equal(result.result.total, 21);
  assert.equal(result.result.fiveCard, true);
  assert.equal(result.result.points, 1000);
});

test('busts empty the lane, award no points, and reset a streak', () => {
  const deck = [c(13), c(12), c(1), c(1), c(13), c(12), c(5)];
  let state = createGame(Math.random, deck);
  state = act(state, 0).state;
  state = act(state, 1).state;
  state = act(state, 0).state;
  state = act(state, 1).state;
  assert.equal(state.streak, 2);
  state = act(state, 2).state;
  state = act(state, 2).state;
  const busted = act(state, 2);
  assert.equal(busted.result.kind, 'bust');
  assert.equal(busted.state.busts, 1);
  assert.deepEqual(busted.state.lanes[2], []);
  assert.equal(busted.state.streak, 0);
  assert.equal(busted.result.points, 0);
  assert.equal(busted.result.total, 25);
});

test('soft hands do not bust when an ace adjusts to one', () => {
  const deck = [c(1), c(9), c(13)];
  let state = createGame(Math.random, deck);
  state = act(state, 0).state;
  state = act(state, 0).state;
  const result = act(state, 0);
  assert.equal(result.result.kind, 'place');
  assert.equal(result.result.total, 20);
  assert.equal(laneTotal(result.result.cards).hard, 20);
});

test('the third bust ends the game and prevents further play', () => {
  const deck = [c(13), c(12), c(5), c(13), c(12), c(5), c(13), c(12), c(5)];
  let state = createGame(Math.random, deck);
  for (let i = 0; i < deck.length; i++) state = act(state, 0).state;
  assert.equal(state.busts, 3);
  assert.equal(state.over, 'busts');
  assert.equal(currentCard(state), null);
  assert.equal(play(state, 0), null);
});

test('clear streak bonuses increase and a non-clear resets the streak', () => {
  const deck = [c(13), c(12), c(1), c(1), c(2)];
  let state = createGame(Math.random, deck);
  state = act(state, 0).state;
  state = act(state, 1).state;
  const firstClear = act(state, 0);
  assert.equal(firstClear.result.streak, 1);
  state = firstClear.state;

  const secondClear = act(state, 1);
  assert.equal(secondClear.result.kind, 'clear');
  assert.equal(secondClear.result.streak, 2);
  assert.equal(secondClear.result.points, 400 + 200 + 150);
  state = secondClear.state;
  assert.equal(state.tally.bestStreak, 2);

  const placed = act(state, 2);
  assert.equal(placed.result.kind, 'place');
  assert.equal(placed.state.streak, 0);
  assert.equal(placed.state.tally.bestStreak, 2);
  assert.equal(streakBonus(1), 0);
  assert.equal(streakBonus(2), 150);
  assert.equal(streakBonus(3), 300);
});

test('deck completion awards time and clean bonuses, but busts forfeit the clean bonus', () => {
  const deck = [c(13), c(1)];
  let state = createGame(Math.random, deck);
  state = tick(state, 30);
  assert.equal(state.timeLeft, ROUND_SECONDS - 30);
  state = act(state, 0).state;
  state = act(state, 0).state;
  assert.equal(state.over, 'deck');
  const result = breakdown(state);
  assert.equal(result.timeBonus, 120 * 20);
  assert.equal(result.cleanBonus, 1000);
  assert.equal(result.total, result.clearPoints + result.blackjackPoints + result.timeBonus + result.cleanBonus);

  const bustDeck = [c(13), c(12), c(5)];
  state = createGame(Math.random, bustDeck);
  state = act(state, 0).state;
  state = act(state, 0).state;
  state = act(state, 0).state;
  assert.equal(state.over, 'deck');
  assert.equal(breakdown(state).cleanBonus, 0);
});

test('the timer ends play without bonuses and does not change an ended state', () => {
  const initial = createGame(Math.random, [c(2)]);
  const ended = tick(initial, ROUND_SECONDS);
  assert.equal(ended.timeLeft, 0);
  assert.equal(ended.over, 'time');
  assert.equal(breakdown(ended).timeBonus, 0);
  assert.equal(breakdown(ended).cleanBonus, 0);
  assert.equal(play(ended, 0), null);
  assert.equal(tick(ended, 30), ended);
});

test('play rejects invalid lanes and never mutates its input state', () => {
  const state = createGame(Math.random, [c(5), c(6)]);
  const snapshot = structuredClone(state);
  assert.equal(play(state, -1), null);
  assert.equal(play(state, 4), null);
  assert.equal(play(state, 1.5), null);
  assert.deepEqual(state, snapshot);

  const valid = play(state, 0);
  assert.ok(valid);
  assert.deepEqual(state, snapshot);
});

test('preview agrees with play for place, clear, and bust outcomes', () => {
  const placeCard = c(5);
  const clearCard = c(1);
  const bustCard = c(5);
  const examples = [
    { lane: [], card: placeCard },
    { lane: [c(13)], card: clearCard },
    { lane: [c(13), c(12)], card: bustCard },
  ];

  for (const { lane, card } of examples) {
    let state = createGame(Math.random, [...lane, card]);
    for (const _existingCard of lane) state = act(state, 0).state;
    const outcome = act(state, 0);
    assert.equal(preview(state.lanes[0], card), outcome.result.kind);
  }
});

test('seeded full games reconcile breakdown totals with score and bonuses', () => {
  let state = createGame(mulberry32(3), makeDeck(mulberry32(3)));
  while (!state.over) {
    const card = currentCard(state);
    assert.ok(card);
    let lane = state.lanes.findIndex((cards) => preview(cards, card) !== 'bust');
    if (lane < 0) lane = 0;
    state = act(state, lane).state;
  }

  const result = breakdown(state);
  assert.equal(result.total, state.score + result.timeBonus + result.cleanBonus);
});
