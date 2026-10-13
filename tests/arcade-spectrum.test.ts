import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32, Pile } from '../src/os/arcade/kit/party-core.ts';
import { AFTER_DARK, CARDS, STOCKS, deckFor, stockOf } from '../src/os/arcade/games/spectrum/cards.ts';
import {
  BAND,
  DIAL,
  MIN_PLAYERS,
  SPAN,
  TOGETHER_CARDS,
  TOGETHER_MAX,
  addPoints,
  bandsAround,
  callPoints,
  clampDial,
  clueTip,
  makeTeams,
  psychicFor,
  randomTarget,
  rating,
  scoreGuess,
  scoresBefore,
  sideOf,
  startScores,
  togetherDone,
  verdict,
  winner,
} from '../src/os/arcade/games/spectrum/logic.ts';

// Copy must not name the board game this riffs on, use filler text or long dashes.
const banned = new RegExp(['wave' + 'length', 'lo' + 'rem', '\\u2013', '\\u2014'].join('|'), 'i');

test('bands are 7 degrees wide: 4 in the middle, then 3, then 2', () => {
  assert.equal(BAND, 7);
  const t = 90;
  assert.equal(scoreGuess(t, t), 4);
  assert.equal(scoreGuess(t, t + 3.5), 4);
  assert.equal(scoreGuess(t, t - 3.5), 4);
  assert.equal(scoreGuess(t, t + 3.6), 3);
  assert.equal(scoreGuess(t, t - 10.5), 3);
  assert.equal(scoreGuess(t, t + 10.6), 2);
  assert.equal(scoreGuess(t, t - 17.5), 2);
  assert.equal(scoreGuess(t, t + 17.6), 0);
  assert.equal(scoreGuess(t, 0), 0);
  assert.equal(scoreGuess(t, 180), 0);
});

test('bandsAround lays out 2, 3, 4, 3, 2 edge to edge and agrees with scoreGuess', () => {
  const t = 63.5;
  const bands = bandsAround(t);
  assert.deepEqual(
    bands.map((b) => b.points),
    [2, 3, 4, 3, 2],
  );
  assert.equal(bands[0].from, t - SPAN);
  assert.equal(bands[4].to, t + SPAN);
  for (let i = 0; i < bands.length; i++) {
    assert.ok(Math.abs(bands[i].to - bands[i].from - BAND) < 1e-9);
    if (i) assert.equal(bands[i].from, bands[i - 1].to);
    assert.equal(scoreGuess(t, (bands[i].from + bands[i].to) / 2), bands[i].points);
  }
});

test('random targets keep every band on the dial and are repeatable with a seed', () => {
  const rng = mulberry32(42);
  const targets = Array.from({ length: 2000 }, () => randomTarget(rng));
  for (const t of targets) {
    assert.ok(t - SPAN >= 0 && t + SPAN <= DIAL, `target ${t} pushes a band off the dial`);
    assert.equal(t * 2, Math.round(t * 2), 'targets land on half degrees');
  }
  assert.ok(Math.min(...targets) < 25 && Math.max(...targets) > 155, 'targets reach both ends');
  const a = mulberry32(7);
  const b = mulberry32(7);
  assert.deepEqual(
    Array.from({ length: 10 }, () => randomTarget(a)),
    Array.from({ length: 10 }, () => randomTarget(b)),
  );
  assert.equal(randomTarget(() => 0), SPAN);
  assert.equal(randomTarget(() => 0.999999), DIAL - SPAN);
});

test('clampDial keeps the needle on the dial', () => {
  assert.equal(clampDial(-20), 0);
  assert.equal(clampDial(200), 180);
  assert.equal(clampDial(42.5), 42.5);
  assert.equal(clampDial(Number.NaN), 90);
});

test('the left or right call scores 1 when correct, never on a bullseye', () => {
  assert.equal(sideOf(50, 90), 'left');
  assert.equal(sideOf(120, 90), 'right');
  assert.equal(sideOf(90, 90), null);
  assert.equal(callPoints(50, 90, 'left'), 1);
  assert.equal(callPoints(50, 90, 'right'), 0);
  assert.equal(callPoints(130, 90, 'right'), 1);
  // Inside the 3 band the call still counts.
  assert.equal(callPoints(95, 90, 'right'), 1);
  // Bullseye: nothing to call either way.
  assert.equal(callPoints(92, 90, 'right'), 0);
  assert.equal(callPoints(92, 90, 'left'), 0);
  assert.equal(callPoints(90, 90, 'left'), 0);
});

test('teams alternate seats', () => {
  assert.deepEqual(makeTeams(4), [
    [0, 2],
    [1, 3],
  ]);
  assert.deepEqual(makeTeams(5), [
    [0, 2, 4],
    [1, 3],
  ]);
  assert.deepEqual(makeTeams(0), [[], []]);
  assert.equal(MIN_PLAYERS.teams, 4);
  assert.equal(MIN_PLAYERS.together, 2);
});

test('the psychic alternates teams and rotates within each team', () => {
  const seq = Array.from({ length: 8 }, (_, turn) => psychicFor('teams', 5, turn, 0));
  assert.deepEqual(
    seq.map((p) => p.team),
    [0, 1, 0, 1, 0, 1, 0, 1],
  );
  // Team 0 is seats 0, 2, 4 and team 1 is seats 1, 3.
  assert.deepEqual(
    seq.map((p) => p.seat),
    [0, 1, 2, 3, 4, 1, 0, 3],
  );
  const second = Array.from({ length: 4 }, (_, turn) => psychicFor('teams', 4, turn, 1));
  assert.deepEqual(
    second.map((p) => [p.team, p.seat]),
    [
      [1, 1],
      [0, 0],
      [1, 3],
      [0, 2],
    ],
  );
  for (const p of seq) assert.equal(p.seat % 2, p.team, 'the psychic always belongs to the team that is up');
});

test('together mode goes around the table from the first psychic', () => {
  assert.deepEqual(
    Array.from({ length: 5 }, (_, turn) => psychicFor('together', 3, turn, 2).seat),
    [2, 0, 1, 2, 0],
  );
  assert.equal(psychicFor('together', 3, 0).team, 0);
  assert.deepEqual(psychicFor('together', 0, 3), { seat: 0, team: 0 });
});

test('the second team starts a point up and scores add up', () => {
  assert.deepEqual(startScores(0), [0, 1]);
  assert.deepEqual(startScores(1), [1, 0]);
  const s = startScores(0);
  const after = addPoints(s, 0, 3, 1);
  assert.deepEqual(after, [3, 2]);
  assert.deepEqual(s, [0, 1], 'addPoints leaves the old scores alone');
  assert.deepEqual(addPoints(after, 1, 4), [3, 6]);
});

test('first to the goal wins, ties at the goal keep going', () => {
  assert.equal(winner([9, 8], 10), null);
  assert.equal(winner([10, 8], 10), 0);
  assert.equal(winner([7, 11], 10), 1);
  assert.equal(winner([10, 10], 10), null);
  assert.equal(winner([12, 10], 10), 0);
  assert.equal(winner([14, 15], 15), 1);
  assert.equal(winner([14, 14], 15), null);
});

test('together lasts 7 cards for a total out of 28, with a rating for every total', () => {
  assert.equal(TOGETHER_CARDS, 7);
  assert.equal(TOGETHER_MAX, 28);
  assert.equal(togetherDone(6), false);
  assert.equal(togetherDone(7), true);
  const lines = new Set<string>();
  for (let total = 0; total <= TOGETHER_MAX; total++) {
    const line = rating(total);
    assert.ok(line.length > 10);
    assert.doesNotMatch(line, banned);
    lines.add(line);
  }
  assert.ok(lines.size >= 5, 'ratings vary with the score');
  const verdicts = ([0, 2, 3, 4] as const).map(verdict);
  assert.equal(verdict(4), 'Bullseye');
  assert.equal(new Set(verdicts).size, 4, 'every result reads differently');
  for (const v of verdicts) assert.doesNotMatch(v, /!/, 'verdicts are said, not shouted');
});

test('the clue tip follows where the target sits', () => {
  assert.match(clueTip(90, 'Cold', 'Hot'), /middle/);
  assert.match(clueTip(100, 'Cold', 'Hot'), /middle/);
  assert.match(clueTip(SPAN, 'Cold', 'Hot'), /^Close to “Cold”\./);
  assert.match(clueTip(DIAL - SPAN, 'Cold', 'Hot'), /^Close to “Hot”\./);
  assert.match(clueTip(60, 'Cold', 'Hot'), /^Leans toward “Cold”\./);
  assert.match(clueTip(125, 'Cold', 'Hot'), /^Leans toward “Hot”\./);
  // The extreme is quoted as printed, so a card like "Explained by magic" doesn't capitalise mid-sentence.
  assert.equal(clueTip(125, 'Explained by science', 'Explained by magic'), 'Leans toward “Explained by magic”. Think “a bit”, not “very”.');
  for (let t = SPAN; t <= DIAL - SPAN; t += 0.5) assert.doesNotMatch(clueTip(t, 'Cold', 'Hot'), banned);
});

test('scoresBefore undoes a turn so the reveal does not spoil the score bar', () => {
  const before: [number, number] = [3, 5];
  const after = addPoints(before, 1, 3, 1);
  assert.deepEqual(after, [4, 8]);
  assert.deepEqual(scoresBefore(after, 1, 3, 1), before);
  assert.deepEqual(scoresBefore(addPoints(before, 0, 4), 0, 4), before);
});

test('a seeded match plays out: scores only grow and someone reaches the goal', () => {
  const rng = mulberry32(2024);
  let scores = startScores(0);
  let turn = 0;
  let won = null;
  while (won === null && turn < 200) {
    const { team } = psychicFor('teams', 6, turn, 0);
    const target = randomTarget(rng);
    const needle = clampDial(target + (rng() - 0.5) * 50);
    const call = rng() < 0.5 ? 'left' : 'right';
    const pts = scoreGuess(target, needle);
    const next = addPoints(scores, team, pts, callPoints(target, needle, call));
    assert.ok(next[0] >= scores[0] && next[1] >= scores[1]);
    scores = next;
    won = winner(scores, 10);
    turn++;
  }
  assert.notEqual(won, null);
  assert.ok(Math.max(...scores) >= 10);
});

test('cards: plenty, unique, short and clean, and a Pile deals each once', () => {
  assert.ok(CARDS.length >= 120, `only ${CARDS.length} cards`);
  const keys = new Set<string>();
  const words = new Set<string>();
  for (const [left, right] of CARDS) {
    for (const label of [left, right]) {
      assert.ok(label.trim() === label && label.length > 0 && label.length <= 24, `label "${label}"`);
      assert.doesNotMatch(label, banned);
    }
    assert.notEqual(left.toLowerCase(), right.toLowerCase());
    const key = `${left}|${right}`.toLowerCase();
    assert.ok(!keys.has(key), `duplicate card ${key}`);
    keys.add(key);
    for (const label of [left, right]) {
      assert.ok(!words.has(label.toLowerCase()), `"${label}" is on two cards`);
      words.add(label.toLowerCase());
    }
  }
  // Templated cards ("Bad X / Good X", "Normal X / Weird X", "Worst X / Best X") read as filler when two come up
  // back to back, so each shape gets a few cards at most, and no opening word starts more than four.
  const shape = (left: RegExp, right: RegExp) => CARDS.filter(([l, r]) => left.test(l) && right.test(r)).length;
  assert.ok(shape(/^bad /i, /^(good|great) /i) <= 4, `${shape(/^bad /i, /^(good|great) /i)} bad/good cards`);
  assert.ok(shape(/^normal /i, /^(weird|strange) /i) <= 2, `${shape(/^normal /i, /^(weird|strange) /i)} normal/weird cards`);
  assert.ok(shape(/^worst /i, /^(best|dream) /i) <= 2, `${shape(/^worst /i, /^(best|dream) /i)} worst/best cards`);
  const openers = new Map<string, number>();
  for (const [l] of CARDS) {
    const w = l.split(' ')[0].toLowerCase();
    openers.set(w, (openers.get(w) ?? 0) + 1);
  }
  for (const [w, n] of openers) assert.ok(n <= 4, `${n} cards open with "${w}"`);
  // Cards are printed on a few color stocks, steady per card and all of them in use.
  const stocks = new Set(CARDS.map(stockOf));
  assert.equal(stocks.size, STOCKS);
  for (const c of CARDS) assert.equal(stockOf(c), stockOf([c[0], c[1]]));
  const pile = new Pile(CARDS, mulberry32(3));
  const seen = new Set();
  for (let i = 0; i < CARDS.length; i++) seen.add(pile.draw());
  assert.equal(seen.size, CARDS.length);
});

test('After Dark 18+ cards: off by default, only dealt when on, no repeats with the everyday deck', () => {
  assert.equal(deckFor(false), CARDS, 'turned off, the game deals exactly the everyday deck');
  const on = deckFor(true);
  assert.equal(on.length, CARDS.length + AFTER_DARK.length);
  assert.ok(AFTER_DARK.every((c) => on.includes(c)) && CARDS.every((c) => on.includes(c)));
  assert.ok(AFTER_DARK.length >= 36, `only ${AFTER_DARK.length} After Dark cards`);
  const labels = new Set(CARDS.flat().map((l) => l.toLowerCase()));
  const never = /school|teen|kid|child|minor|underage|virgin|drunk|wasted|roofie|passed out|forced|grope|rape|fat|ugly|slut|whore/i;
  for (const [left, right] of AFTER_DARK) {
    for (const label of [left, right]) {
      assert.ok(label.trim() === label && label.length > 0 && label.length <= 24, `label "${label}"`);
      assert.doesNotMatch(label, banned);
      assert.doesNotMatch(label, never, `"${label}"`);
      assert.ok(!labels.has(label.toLowerCase()), `"${label}" is on two cards`);
      labels.add(label.toLowerCase());
    }
    assert.notEqual(left.toLowerCase(), right.toLowerCase());
  }
  // A Pile over the full deck deals every card once, After Dark included.
  const pile = new Pile(on, mulberry32(9));
  const seen = new Set();
  for (let i = 0; i < on.length; i++) seen.add(pile.draw());
  assert.equal(seen.size, on.length);
});
