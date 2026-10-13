import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mulberry32, Pile } from '../src/os/arcade/kit/party-core.ts';
import { CARDS } from '../src/os/arcade/games/spectrum/cards.ts';
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
  makeTeams,
  psychicFor,
  randomTarget,
  rating,
  scoreGuess,
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
  assert.equal(verdict(4), 'Bullseye!');
  assert.notEqual(verdict(0), verdict(2));
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
  assert.ok(CARDS.length >= 110, `only ${CARDS.length} cards`);
  const keys = new Set<string>();
  for (const [left, right] of CARDS) {
    for (const label of [left, right]) {
      assert.ok(label.trim() === label && label.length > 0 && label.length <= 24, `label "${label}"`);
      assert.doesNotMatch(label, banned);
    }
    assert.notEqual(left.toLowerCase(), right.toLowerCase());
    const key = `${left}|${right}`.toLowerCase();
    assert.ok(!keys.has(key), `duplicate card ${key}`);
    keys.add(key);
  }
  const pile = new Pile(CARDS, mulberry32(3));
  const seen = new Set();
  for (let i = 0; i < CARDS.length; i++) seen.add(pile.draw());
  assert.equal(seen.size, CARDS.length);
});
