import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ANSWERS } from '../src/os/arcade/games/wordguess/answers.ts';
import { GUESSES } from '../src/os/arcade/games/wordguess/guesses.ts';
import {
  dailyIndex,
  dayNumber,
  emptyStats,
  formatWait,
  letterStates,
  msUntilNextDay,
  pacificDate,
  practiceIndex,
  recordDaily,
  score,
  unpack,
} from '../src/os/arcade/games/wordguess/logic.ts';

const answers = unpack(ANSWERS);
const guesses = unpack(GUESSES);
const C = 'correct', P = 'present', A = 'absent';

test('word lists are clean', () => {
  assert.equal(ANSWERS.length % 5, 0);
  assert.equal(answers.length, 2000);
  assert.equal(new Set(answers).size, answers.length);
  assert.ok(guesses.length > 5000);
  assert.equal(new Set(guesses).size, guesses.length);
  for (const w of [...answers, ...guesses]) assert.match(w, /^[a-z]{5}$/);
  const a = new Set(answers);
  assert.ok(guesses.every((w) => !a.has(w)), 'guess list excludes answers');
  for (const w of ['crane', 'house', 'water', 'light', 'heart']) assert.ok(a.has(w), `${w} is an answer`);
});

test('score: exact, present, absent', () => {
  assert.deepEqual(score('crane', 'crane'), [C, C, C, C, C]);
  assert.deepEqual(score('react', 'crane'), [P, P, C, P, A]);
  assert.deepEqual(score('ghost', 'crane'), [A, A, A, A, A]);
});

test('score: duplicate letters are never over-counted', () => {
  // one e in the answer, already matched exactly at the end
  assert.deepEqual(score('eerie', 'crane'), [A, A, P, A, C]);
  // two b's in the answer, one exact and one elsewhere
  assert.deepEqual(score('kebab', 'abbey'), [A, P, C, P, P]);
  // guess has three e's, answer has one at the end
  assert.deepEqual(score('geese', 'those'), [A, A, A, C, C]);
  // guess has three l's, answer has one: the exact match uses it up, the others are absent
  assert.deepEqual(score('lolly', 'world'), [A, C, A, C, A]);
  // two l's in the guess, one in the answer, no exact match: only the first copy is present
  assert.deepEqual(score('llama', 'world'), [P, A, A, A, A]);
  // exact match takes priority over an earlier present
  assert.deepEqual(score('speed', 'abide'), [A, A, P, A, P]);
  assert.deepEqual(score('alley', 'fella'), [P, P, C, P, A]);
});

test('letterStates keeps the best state per letter', () => {
  const s = letterStates(['eerie', 'crane'], 'crane');
  assert.equal(s.c, C);
  assert.equal(s.e, C);
  assert.equal(s.i, A);
  const t = letterStates(['react'], 'crane');
  assert.equal(t.r, P);
  assert.equal(t.t, A);
});

test('pacific date rolls over at California midnight, with daylight saving', () => {
  assert.equal(pacificDate(new Date('2026-03-01T07:59:00Z')), '2026-02-28'); // PST, 23:59
  assert.equal(pacificDate(new Date('2026-03-01T08:00:00Z')), '2026-03-01');
  assert.equal(pacificDate(new Date('2026-07-01T06:30:00Z')), '2026-06-30'); // PDT, 23:30
  assert.equal(pacificDate(new Date('2026-07-01T07:00:00Z')), '2026-07-01');
});

test('day numbers and the time to the next word', () => {
  assert.equal(dayNumber('2026-01-01'), 0);
  assert.equal(dayNumber('2026-01-02'), 1);
  assert.equal(dayNumber('2027-01-01'), 365);
  assert.equal(msUntilNextDay(new Date('2026-01-01T08:00:00Z')), 86400000);
  assert.equal(msUntilNextDay(new Date('2026-01-02T07:30:00Z')), 30 * 60000);
  assert.equal(formatWait(30 * 60000), '30m');
  assert.equal(formatWait((5 * 60 + 12) * 60000), '5h 12m');
});

test('daily word is deterministic and does not repeat for years', () => {
  assert.equal(dailyIndex(100, 2000), dailyIndex(100, 2000));
  const seen = new Set<number>();
  for (let d = 0; d < 2000; d++) seen.add(dailyIndex(d, 2000));
  assert.equal(seen.size, 2000);
  assert.notEqual(answers[dailyIndex(0, 2000)], answers[0], 'order is shuffled');
});

test('practice never serves the daily word', () => {
  const daily = dailyIndex(10, 2000);
  for (const r of [0, 0.25, 0.5, 0.999999, daily / 1999, (daily - 0.5) / 1999]) {
    const i = practiceIndex(10, 2000, () => r);
    assert.ok(i >= 0 && i < 2000);
    assert.notEqual(i, daily);
  }
});

test('daily stats and streaks', () => {
  let s = recordDaily(emptyStats(), 5, 3);
  assert.deepEqual([s.played, s.wins, s.streak, s.max, s.dist[2]], [1, 1, 1, 1, 1]);
  s = recordDaily(s, 6, 4);
  assert.deepEqual([s.streak, s.max], [2, 2]);
  s = recordDaily(s, 8, 2); // skipped day 7
  assert.deepEqual([s.streak, s.max], [1, 2]);
  s = recordDaily(s, 9, 0);
  assert.deepEqual([s.played, s.wins, s.streak, s.max], [4, 3, 0, 2]);
});
