import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  autoStep,
  bestMove,
  canAutoFinish,
  canMove,
  clock,
  deal,
  drawStock,
  finalScore,
  foundationFor,
  hasMoves,
  isDealRequest,
  isWon,
  makeCard,
  move,
  parseDeal,
  redealFor,
  pileCards,
  score,
  shortcut,
  shuffled,
  undo,
  MAX_SCORE,
  POINTS,
  TABLEAU,
  TIME_LIMIT,
  type Card,
  type State,
  type Suit,
} from '../src/os/arcade/games/solitaire/logic.ts';

const card = (rank: number, suit: Suit = 'spades', up = true): Card => ({
  id: ['spades', 'hearts', 'diamonds', 'clubs'].indexOf(suit) * 13 + rank - 1,
  rank,
  suit,
  up,
});

const stateWith = (overrides: Partial<State> = {}): State => ({
  ...deal(9, 3),
  stock: [],
  waste: [],
  found: [[], [], [], []],
  tab: Array.from({ length: 7 }, () => []),
  ...overrides,
});

const emptyTableau = (): Card[][] => Array.from({ length: 7 }, () => []);

test('seeded deals are deterministic, distinct by seed, and contain 52 unique cards', () => {
  for (const draw of [1, 3] as const) {
    const first = deal(42, draw);
    const repeated = deal(42, draw);
    assert.deepEqual(first, repeated);
    assert.equal(first.draw, draw);
    assert.notDeepEqual(first, deal(43, draw));
    const ids = [...first.stock, ...first.waste, ...first.found.flat(), ...first.tab.flat()].map(({ id }) => id);
    assert.equal(ids.length, 52);
    assert.equal(new Set(ids).size, 52);
  }
});

test('deal has seven tableau columns, exposed tops, and a face-down stock', () => {
  const state = deal(7, 1);
  assert.deepEqual(state.tab.map((pile) => pile.length), [1, 2, 3, 4, 5, 6, 7]);
  assert.ok(state.tab.every((pile) => pile.slice(0, -1).every((c) => !c.up) && pile.at(-1)?.up));
  assert.equal(state.stock.length, 24);
  assert.ok(state.stock.every((c) => !c.up));
  assert.deepEqual(state.waste, []);
  assert.deepEqual(state.found, [[], [], [], []]);
  assert.equal(score(state), 0);
});

test('stock draws one or three cards in playable order and handles a short stock', () => {
  const one = deal(4, 1);
  const oneDrawn = drawStock(one);
  assert.ok(oneDrawn);
  assert.equal(oneDrawn.stock.length, 23);
  assert.equal(oneDrawn.waste.length, 1);
  assert.equal(oneDrawn.fan, 1);
  assert.deepEqual(oneDrawn.waste[0], { ...one.stock.at(-1), up: true });
  assert.equal(oneDrawn.moves, one.moves + 1);

  const three = deal(5, 3);
  const threeDrawn = drawStock(three);
  assert.ok(threeDrawn);
  assert.equal(threeDrawn.stock.length, 21);
  assert.deepEqual(threeDrawn.waste.map((c) => c.id), three.stock.slice(-3).reverse().map((c) => c.id));
  assert.equal(threeDrawn.fan, 3);
  const short = drawStock(stateWith({ draw: 3, stock: [card(2, 'clubs', false), card(3, 'spades', false)] }));
  assert.ok(short);
  assert.equal(short.stock.length, 0);
  assert.equal(short.fan, 2);
});

test('recycling turns waste face down, reverses it, scores penalties, and handles empty piles', () => {
  const waste = [card(2, 'hearts'), card(3, 'clubs')];
  const one = stateWith({ draw: 1, waste, points: 20, fan: 1 });
  const recycled = drawStock(one);
  assert.ok(recycled);
  assert.deepEqual(recycled.stock, waste.slice().reverse().map((c) => ({ ...c, up: false })));
  assert.deepEqual(recycled.waste, []);
  assert.equal(recycled.passes, one.passes + 1);
  assert.equal(recycled.points, 20 + POINTS.recycle1);
  assert.equal(recycled.fan, 0);
  assert.equal(score(recycled), 0);
  const three = drawStock(stateWith({ draw: 3, waste, points: 30 }));
  assert.ok(three);
  assert.equal(three.points, 30 + POINTS.recycle3);
  assert.equal(drawStock(stateWith()), null);
});

test('canMove validates alternating descending runs, tableau placements, and foundations', () => {
  const tabs = emptyTableau();
  tabs[0] = [card(6, 'spades'), card(5, 'hearts')];
  tabs[1] = [card(7, 'hearts')];
  tabs[2] = [];
  tabs[3] = [card(7, 'spades')];
  const state = stateWith({ tab: tabs });
  assert.equal(canMove(state, 't0', 0, 't1'), true);
  assert.equal(canMove(state, 't0', 0, 't3'), false);
  assert.equal(canMove(state, 't0', 1, 't2'), false);
  assert.equal(canMove(state, 't0', 0, 't0'), false);
  assert.equal(canMove(state, 't1', 0, 't2'), false);

  const kingTabs = emptyTableau();
  kingTabs[0] = [card(13, 'clubs')];
  assert.equal(canMove(stateWith({ tab: kingTabs }), 't0', 0, 't1'), true);

  const ace = stateWith({ waste: [card(1, 'diamonds')], found: [[], [], [], []] });
  assert.equal(canMove(ace, 'waste', 0, 'f0'), true);
  const two = stateWith({ waste: [card(2, 'hearts')], found: [[card(1, 'hearts')], [], [], []] });
  assert.equal(canMove(two, 'waste', 0, 'f0'), true);
  const wrongSuit = stateWith({ waste: [card(2, 'spades')], found: [[card(1, 'hearts')], [], [], []] });
  assert.equal(canMove(wrongSuit, 'waste', 0, 'f0'), false);
});

test('canMove accepts valid tableau runs and rejects broken, face-down, and non-top picks', () => {
  const tabs = emptyTableau();
  tabs[0] = [card(8, 'clubs'), card(7, 'hearts'), card(6, 'spades')];
  tabs[1] = [card(9, 'diamonds')];
  assert.equal(canMove(stateWith({ tab: tabs }), 't0', 0, 't1'), true);

  tabs[0] = [card(8, 'clubs'), card(7, 'spades'), card(6, 'hearts')];
  assert.equal(canMove(stateWith({ tab: tabs }), 't0', 0, 't1'), false);
  tabs[0] = [card(8, 'clubs', false), card(7, 'hearts')];
  assert.equal(canMove(stateWith({ tab: tabs }), 't0', 0, 't1'), false);
  assert.equal(canMove(stateWith({ waste: [card(2), card(3)] }), 'waste', 0, 't0'), false);
  assert.equal(canMove(stateWith({ stock: [card(1)] }), 'stock', 0, 'f0'), false);
});

test('move scoring, reveal flips, fan updates, and input immutability are correct', () => {
  const wasteState = stateWith({ draw: 3, waste: [card(6, 'spades'), card(7, 'hearts'), card(8, 'clubs')], fan: 3 });
  wasteState.tab[0] = [card(9, 'hearts')];
  const before = JSON.stringify(wasteState);
  const wasteMove = move(wasteState, 'waste', 2, 't0');
  assert.ok(wasteMove);
  assert.equal(wasteMove.points, POINTS.wasteToTableau);
  assert.equal(wasteMove.fan, 2);
  assert.equal(wasteMove.moves, 1);
  assert.equal(JSON.stringify(wasteState), before);

  const foundationState = stateWith({ waste: [card(1, 'diamonds')] });
  const foundationMove = move(foundationState, 'waste', 0, 'f0');
  assert.ok(foundationMove);
  assert.equal(foundationMove.points, POINTS.toFoundation);

  const tabs = emptyTableau();
  tabs[0] = [card(4, 'spades', false), card(1, 'spades')];
  const revealState = stateWith({ tab: tabs });
  const reveal = move(revealState, 't0', 1, 'f0');
  assert.ok(reveal);
  assert.equal(reveal.points, POINTS.toFoundation + POINTS.reveal);
  assert.equal(reveal.tab[0][0].up, true);
  assert.equal(revealState.tab[0][0].up, false);

  const foundationToTab = move(stateWith({
    found: [[card(1, 'hearts'), card(2, 'hearts')], [], [], []],
    tab: [[], [card(3, 'clubs')], [], [], [], [], []],
  }), 'f0', 1, 't1');
  assert.ok(foundationToTab);
  assert.equal(foundationToTab.points, POINTS.foundationToTableau);
});

test('undo restores the last snapshot while penalties survive later actions', () => {
  const original = stateWith({ draw: 1, stock: [], waste: [card(9, 'diamonds')], points: 25, fan: 1 });
  const recycled = drawStock(original);
  assert.ok(recycled);
  const restored = undo(recycled);
  assert.ok(restored);
  assert.deepEqual(restored.stock, original.stock);
  assert.deepEqual(restored.waste, original.waste);
  assert.equal(restored.points, original.points);
  assert.equal(restored.moves, original.moves);
  assert.equal(restored.penalty, 10);
  assert.equal(restored.undos, 1);
  const laterMove = drawStock(restored);
  assert.ok(laterMove);
  assert.equal(laterMove.penalty, 10);
  assert.equal(undo(deal(1, 3)), null);
  assert.equal(score(stateWith({ points: 5, penalty: 10 })), 0);
});

test('foundationFor and bestMove prefer foundations and scan tableau targets with wrapping', () => {
  const aceState = stateWith({ waste: [card(1, 'clubs')] });
  assert.equal(foundationFor(aceState, 'waste', 0), 'f0');
  assert.equal(bestMove(aceState, 'waste', 0), 'f0');

  const tabs = emptyTableau();
  tabs[0] = [card(7, 'hearts')];
  tabs[6] = [card(6, 'spades')];
  assert.equal(bestMove(stateWith({ tab: tabs }), 't6', 0), 't0');

  const kingTabs = emptyTableau();
  kingTabs[0] = [card(13, 'clubs')];
  assert.equal(bestMove(stateWith({ tab: kingTabs }), 't0', 0), null);
  assert.equal(bestMove(stateWith({ waste: [card(5, 'hearts')] }), 'waste', 0), null);
});

test('auto-finish moves the lowest available tableau card and final scoring is capped', () => {
  const tabs = emptyTableau();
  tabs[0] = [card(13, 'clubs')];
  const nearWin = stateWith({
    found: [
      Array.from({ length: 13 }, (_, i) => card(i + 1, 'spades')),
      Array.from({ length: 13 }, (_, i) => card(i + 1, 'hearts')),
      Array.from({ length: 13 }, (_, i) => card(i + 1, 'diamonds')),
      Array.from({ length: 12 }, (_, i) => card(i + 1, 'clubs')),
    ],
    tab: tabs,
  });
  assert.equal(canAutoFinish(nearWin), true);
  const step = autoStep(nearWin);
  assert.ok(step);
  assert.equal(step.from, 't0');
  assert.equal(step.to, 'f3');
  assert.equal(step.state.points, POINTS.toFoundation);
  assert.equal(isWon(step.state), true);
  assert.equal(autoStep(step.state), null);
  assert.deepEqual(finalScore(step.state, 120), {
    base: POINTS.toFoundation,
    win: POINTS.win,
    time: (TIME_LIMIT - 120) * POINTS.timePerSecond,
    total: POINTS.toFoundation + POINTS.win + (TIME_LIMIT - 120) * POINTS.timePerSecond,
  });
  assert.equal(canAutoFinish(stateWith({ stock: [card(1, 'clubs')] })), false);
  assert.equal(finalScore(stateWith({ points: 12 }), 120).total, 12);
  assert.equal(finalScore(stateWith({ points: MAX_SCORE + 5 }), 0).total, MAX_SCORE);
});

test('hasMoves identifies both a stuck position and an ordinary deal', () => {
  const stuck = stateWith({
    found: Array.from({ length: 4 }, (_, i) =>
      Array.from({ length: 13 }, (_, rank) => card(rank + 1, (['spades', 'hearts', 'diamonds', 'clubs'] as Suit[])[i]))),
    tab: Array.from({ length: 7 }, (_, i) => [card(13, (['spades', 'hearts', 'diamonds', 'clubs'] as Suit[])[i % 4])]),
  });
  assert.equal(hasMoves(stuck), false);
  assert.equal(hasMoves(deal(23, 3)), true);
});

test('online message parsing validates deal fields and recognizes deal requests', () => {
  assert.deepEqual(parseDeal({ t: 'deal', seed: 0, draw: 1 }), { t: 'deal', seed: 0, draw: 1 });
  assert.deepEqual(parseDeal({ t: 'deal', seed: 2 ** 32 - 1, draw: 3 }), { t: 'deal', seed: 2 ** 32 - 1, draw: 3 });
  for (const invalid of [
    null,
    {},
    { t: 'deal?', seed: 1, draw: 1 },
    { t: 'deal', seed: -1, draw: 1 },
    { t: 'deal', seed: 2 ** 32, draw: 1 },
    { t: 'deal', seed: 1.5, draw: 1 },
    { t: 'deal', seed: 1, draw: 2 },
  ]) assert.equal(parseDeal(invalid), null);
  assert.equal(isDealRequest({ t: 'deal?' }), true);
  assert.equal(isDealRequest({ t: 'deal' }), false);
});

test('card utilities, pile access, and clock formatting expose stable values', () => {
  assert.deepEqual(makeCard(13, true), { id: 13, rank: 1, suit: 'hearts', up: true });
  const deck = shuffled(13);
  assert.equal(new Set(deck.map((c) => c.id)).size, 52);
  const state = deal(5, 1);
  assert.deepEqual(pileCards(state, 't0'), state.tab[0]);
  assert.deepEqual(pileCards(state, 'stock'), state.stock);
  assert.deepEqual(TABLEAU, ['t0', 't1', 't2', 't3', 't4', 't5', 't6']);
  assert.equal(clock(125), '2:05');
  assert.equal(clock(9), '0:09');
});

test('a draw picked on the start card redeals the same untouched shuffle', () => {
  const one = deal(4242, 1);
  const three = redealFor(one, 3);
  assert.ok(three);
  assert.equal(three.draw, 3);
  assert.equal(three.seed, one.seed);
  assert.deepEqual(three.tab, one.tab);
  assert.deepEqual(three.stock, one.stock);
  const drawn = drawStock(three);
  assert.ok(drawn);
  assert.equal(drawn.waste.length, 3);
  assert.equal(redealFor(three, 3), null);
});

test('a deal already played is never redealt for a new draw', () => {
  const played = drawStock(deal(77, 1));
  assert.ok(played);
  assert.equal(redealFor(played, 3), null);
});

test('space and enter draw, and never map to undo', () => {
  for (const code of ['Space', 'Enter', 'KeyD']) assert.deepEqual(shortcut(code), { t: 'draw' });
  for (const code of ['KeyZ', 'KeyU', 'Backspace']) assert.deepEqual(shortcut(code), { t: 'undo' });
  assert.deepEqual(shortcut('KeyW'), { t: 'waste' });
  assert.deepEqual(shortcut('Digit0'), { t: 'waste' });
  assert.deepEqual(shortcut('Digit1'), { t: 'column', col: 0 });
  assert.deepEqual(shortcut('Numpad7'), { t: 'column', col: 6 });
  assert.equal(shortcut('Digit8'), null);
  assert.equal(shortcut('KeyQ'), null);
});

test('draw after undo moves one card from stock to waste again', () => {
  let s = deal(9001, 1);
  s = drawStock(s)!;
  s = drawStock(s)!;
  assert.equal(s.stock.length, 22);
  assert.equal(s.waste.length, 2);
  s = undo(s)!;
  assert.deepEqual([s.stock.length, s.waste.length], [23, 1]);
  s = drawStock(s)!;
  assert.deepEqual([s.stock.length, s.waste.length], [22, 2]);
});
