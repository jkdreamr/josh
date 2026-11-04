// Word Guess's ranked runs (games/wordguess/verify.ts): the Daily Word Streak board takes a streak only from the
// Worker, which carries each device's on from one day's word to the next. End to end through the real Boards object.
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import { ANSWERS } from '../src/os/arcade/games/wordguess/answers.ts';
import { dailyIndex, dayNumber, pacificDate, unpack } from '../src/os/arcade/games/wordguess/logic.ts';
import { verifier } from '../src/os/arcade/games/wordguess/verify.ts';
import { VERIFIERS } from '../src/os/arcade/verify/registry.ts';
import { BOARD_OWNERS } from '../worker/src/specs.gen.ts';
import { rankedWorker } from './ranked-harness.ts';
import { replayedSource, UNSTABLE_MATH } from './replayed-math.ts';

let w: ReturnType<typeof rankedWorker>;
beforeEach(() => {
  w = rankedWorker();
  // (the harness's clock starts on a Pacific midnight: start the day at noon)
  w.clock += 12 * 3_600_000;
});
afterEach(() => w.restore());

const LIST = unpack(ANSWERS);
const DAY = 24 * 3_600_000;
const today = () => dayNumber(pacificDate(new Date(w.clock)));
const answerOf = (day: number) => LIST[dailyIndex(day, LIST.length)];
/** Five-letter words that aren't `day`'s answer. */
const misses = (day: number, n: number) => LIST.filter((x) => x !== answerOf(day)).slice(0, n);
const PHONE = 'phone-key-aaaaaaaaaaaaaaaaaaaaaaaa';
const LAPTOP = 'laptop-key-bbbbbbbbbbbbbbbbbbbbbbb';

/** Plays today's word on `device` with `guesses` (the answer last to win), as the page does. The finish reply. */
async function playToday(device: string | undefined, guesses: string[], opts: { claim?: number; day?: number; rows?: string[] } = {}) {
  const { run } = await w.open('wordguess');
  const day = opts.day ?? today();
  const start = await w.call('/runs/start', device ? { run, init: { day, rows: opts.rows ?? [] }, device } : { run, init: { day, rows: opts.rows ?? [] } });
  if (start.status !== 200) return { run, ...start };
  const events = guesses.map((g, i) => [(i + 1) * 9_000, g]);
  w.clock += guesses.length * 9_000 + 500;
  const won = guesses[guesses.length - 1] === answerOf(day);
  const tries = (opts.rows?.length ?? 0) + guesses.length;
  const done = await w.call('/runs/finish', { run, n: 0, e: events, t: guesses.length * 9_000, score: opts.claim ?? (won ? tries : 0) });
  return { run, ...done };
}

test('the replayed rules use only math every browser computes to the same bit', () => {
  const src = replayedSource(new URL('../src/os/arcade/games/wordguess/verify.ts', import.meta.url));
  assert.match(src, /function dailyIndex\b/, 'the walk reaches dailyIndex');
  assert.doesNotMatch(src, UNSTABLE_MATH);
});

test('wordguess is checked, on its own board, as a daily board', () => {
  assert.equal(VERIFIERS.wordguess, verifier);
  assert.equal(BOARD_OWNERS.wordguess, 'wordguess');
  assert.equal(verifier.daily, true);
});

test("a day's word replays: solved in so many guesses, or not at all", () => {
  const issued = w.clock;
  const day = today();
  const solve = (rows: string[], guesses: string[]) => {
    const r = verifier.start(1, { day, rows }, { issued });
    assert.ok(typeof r !== 'string', String(r));
    const fed = verifier.feed(r.state, guesses.map((g, i) => [i * 1000, g]), guesses.length * 1000);
    assert.ok(typeof fed !== 'string', String(fed));
    return verifier.end(r.state);
  };
  assert.deepEqual(solve([], [answerOf(day)]), { score: 1, day: { day, won: true } });
  assert.deepEqual(solve([], [...misses(day, 3), answerOf(day)]), { score: 4, day: { day, won: true } });
  assert.deepEqual(solve(misses(day, 2), [answerOf(day)]), { score: 3, day: { day, won: true } }, 'a daily come back to');
  assert.deepEqual(solve([], misses(day, 6)), { score: 0, day: { day, won: false } });
  assert.equal(solve([], misses(day, 5)), 'still guessing');
});

test('starts and guesses the page could not have sent are refused', () => {
  const issued = w.clock;
  const day = today();
  for (const init of [null, [], 'today', { day: day + 1, rows: [] }, { day: day - 1, rows: [] }, { day, rows: 'abcde' }, { day, rows: [answerOf(day)] }, { day, rows: misses(day, 6) }, { day, rows: ['ABCDE'] }, { day, rows: ['abcd'] }]) {
    const r = verifier.start(1, init, { issued });
    assert.equal(typeof r, 'string', JSON.stringify(init));
  }
  const fresh = () => {
    const r = verifier.start(1, { day, rows: [] }, { issued });
    assert.ok(typeof r !== 'string');
    return r.state;
  };
  // a guess after the word was found
  assert.equal(verifier.feed(fresh(), [[1, answerOf(day)], [2, misses(day, 1)[0]]], 5), 'guess after the end');
  // a seventh guess
  assert.equal(verifier.feed(fresh(), misses(day, 7).map((g, i) => [i, g]), 10), 'bad chunk');
  const sixth = fresh();
  assert.ok(typeof verifier.feed(sixth, misses(day, 6).map((g, i) => [i, g]), 10) !== 'string');
  assert.equal(verifier.feed(sixth, [[11, answerOf(day)]], 12), 'guess after the end');
  // stamps out of order, past the chunk's clock, or a clock run backwards
  assert.equal(verifier.feed(fresh(), [[5, 'about'], [4, 'their']], 9), 'bad chunk');
  assert.equal(verifier.feed(fresh(), [[10, 'about']], 9), 'bad chunk');
  const back = fresh();
  assert.ok(typeof verifier.feed(back, [], 100) !== 'string');
  assert.equal(verifier.feed(back, [], 99), 'bad chunk');
  assert.equal(verifier.feed(back, [[50, 'about']], 200), 'bad chunk', 'a guess stamped before the last chunk');
  for (const bad of [[[1, 'ABOUT']], [[1, 'abou']], [[1, 5]], [['1', 'about']], [[1.5, 'about']], [[1, 'about', 2]], ['about'], 'about', null]) {
    assert.equal(verifier.feed(fresh(), bad, 10), 'bad chunk', JSON.stringify(bad));
  }
  for (const at of [-1, 0.5, '9', null, 27 * 3_600_000]) assert.equal(verifier.feed(fresh(), [], at), 'bad chunk', String(at));
});

test('the streak is the Worker\'s: a win a day carries it on, a miss or a skipped day starts it again', async () => {
  const day1 = await playToday(PHONE, [answerOf(today())]);
  assert.equal(day1.status, 200, JSON.stringify(day1));
  assert.equal(day1.body.score, 1);
  assert.equal((await w.submit('wordguess', 2, day1.run)).status, 403, 'more than the streak');
  assert.equal((await w.submit('wordguess', 1, day1.run)).status, 200);

  w.clock += DAY;
  const day2 = await playToday(PHONE, [...misses(today(), 2), answerOf(today())]);
  assert.equal(day2.body.score, 2);
  w.clock += DAY;
  const day3 = await playToday(PHONE, [answerOf(today())]);
  assert.equal(day3.body.score, 3);
  assert.equal((await w.submit('wordguess', 3, day3.run)).status, 200);
  assert.deepEqual((await w.board('wordguess')).map((e) => e.score), [3, 1]);

  // the same day again on the same device: one game a day
  const again = await playToday(PHONE, [answerOf(today())]);
  assert.equal(again.status, 403);
  assert.equal(again.body.error, 'already played');

  // a day missed: back to 1
  w.clock += 2 * DAY;
  assert.equal((await playToday(PHONE, [answerOf(today())])).body.score, 1);
  // a day lost: 0, then 1 the day after
  w.clock += DAY;
  const lost = await playToday(PHONE, misses(today(), 6));
  assert.equal(lost.status, 200);
  assert.equal(lost.body.score, 0);
  assert.ok((await w.submit('wordguess', 0, lost.run)).status >= 400, 'nothing to put on the board');
  w.clock += DAY;
  assert.equal((await playToday(PHONE, [answerOf(today())])).body.score, 1);

  // another device has a streak of its own
  assert.equal((await playToday(LAPTOP, [answerOf(today())])).body.score, 1);
});

test('a typed-in streak, a claim the guesses did not make, or a run with no device is refused', async () => {
  assert.equal((await w.submit('wordguess', 500)).status, 403);
  assert.equal((await w.submit('wordguess', 500, 'run-i-made-up')).status, 403);
  const wrong = await playToday(PHONE, [...misses(today(), 1), answerOf(today())], { claim: 1 });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, 'score does not replay');
  const nobody = await playToday(undefined, [answerOf(today())]);
  assert.equal(nobody.status, 403);
  assert.equal(nobody.body.error, 'no device');
  for (const device of ['short', 'has spaces in it, which no key has', 'x'.repeat(65), 42]) {
    const { run } = await w.open('wordguess');
    const r = await w.call('/runs/start', { run, init: { day: today(), rows: [] }, device });
    assert.equal(r.status, 403, String(device));
  }
  assert.deepEqual(await w.board('wordguess'), []);
});

test("a run is the day's it was opened on, by California's clock", async () => {
  // yesterday's word, played today: refused
  const late = await playToday(PHONE, [answerOf(today() - 1)], { day: today() - 1 });
  assert.equal(late.status, 403);
  assert.equal(late.body.error, 'wrong day');
  // tomorrow's word, today: refused
  const early = await playToday(PHONE, [answerOf(today() + 1)], { day: today() + 1 });
  assert.equal(early.body.error, 'wrong day');
  // a run opened a minute before midnight and played after it is still that day's
  w.clock += 12 * 3_600_000 - 60_000;
  const day = today();
  const { run } = await w.open('wordguess');
  w.clock += 5 * 60_000;
  assert.notEqual(today(), day, 'past midnight now');
  assert.equal((await w.call('/runs/start', { run, init: { day, rows: [] }, device: LAPTOP })).status, 200);
  w.clock += 30_000;
  const done = await w.call('/runs/finish', { run, n: 0, e: [[20_000, answerOf(day)]], t: 20_000, score: 1 });
  assert.equal(done.status, 200, JSON.stringify(done));
  assert.equal(done.body.score, 1);
  // and today's word after it carries the streak on
  assert.equal((await playToday(LAPTOP, [answerOf(today())])).body.score, 2);
});

test('a run whose clock runs ahead of the Worker\'s is refused', async () => {
  const { run } = await w.open('wordguess');
  await w.call('/runs/start', { run, init: { day: today(), rows: [] }, device: PHONE });
  w.clock += 1_000;
  const r = await w.call('/runs/finish', { run, n: 0, e: [[60_000, answerOf(today())]], t: 60_000, score: 1 });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'too fast');
});

test('a wordguess run counts only for the wordguess board', async () => {
  const day1 = await playToday(PHONE, [answerOf(today())]);
  assert.equal((await w.submit('flappy', 1, day1.run)).status, 403);
  assert.equal((await w.submit('wordguess', 1, day1.run)).status, 200);
});
