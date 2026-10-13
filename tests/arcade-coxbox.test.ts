import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  MAX_RACE_MS,
  PASSAGES,
  RIVAL_LEVELS,
  RIVAL_WPM,
  STALL_MS,
  accuracy,
  CATCH_UP_MAX,
  applyProgress,
  catchUp,
  createBot,
  createTyping,
  encodeProgress,
  encodeRace,
  formatClock,
  marginText,
  normalizeKey,
  ordinal,
  parseProgress,
  parseRace,
  pickPassage,
  racePace,
  raceOver,
  rank,
  rivalField,
  rng,
  stepBot,
  strokeRate,
  typeKey,
  wordAt,
  wpm,
} from '../src/os/arcade/games/coxbox/logic.ts';

test('passages are plain ASCII sentences of race length', () => {
  assert.ok(PASSAGES.length >= 30);
  assert.equal(new Set(PASSAGES).size, PASSAGES.length, 'no duplicates');
  for (const p of PASSAGES) {
    assert.match(p, /^[\x20-\x7e]+$/, `non-ASCII character in: ${p}`);
    assert.doesNotMatch(p, /\s{2}|^\s|\s$/, `stray whitespace in: ${p}`);
    assert.match(p, /^[A-Z]/, `starts with a capital: ${p}`);
    assert.match(p, /[.!?]$/, `ends with punctuation: ${p}`);
    assert.ok(p.length >= 240 && p.length <= 320, `length ${p.length}: ${p}`);
  }
});

test('passage picks avoid recent races until every passage has been used', () => {
  const recent = PASSAGES.map((_, i) => i).filter((i) => i !== 5);
  assert.equal(pickPassage(() => 0.99, recent), 5);
  const all = PASSAGES.map((_, i) => i);
  const pick = pickPassage(() => 0.5, all);
  assert.ok(pick >= 0 && pick < PASSAGES.length);
});

test('a wrong key stalls the cursor and counts an error', () => {
  const t = createTyping('go row.');
  assert.equal(typeKey(t, 'g'), 'hit');
  assert.equal(typeKey(t, 'x'), 'miss');
  assert.equal(t.pos, 1);
  assert.equal(t.errors, 1);
  assert.equal(typeKey(t, 'o'), 'hit');
  assert.equal(typeKey(t, ' '), 'hit');
  for (const ch of 'row') assert.equal(typeKey(t, ch), 'hit');
  assert.equal(typeKey(t, '.'), 'done');
  assert.equal(typeKey(t, 'x'), 'skip');
  assert.equal(t.pos, 7);
  assert.equal(t.errors, 1);
});

test('typing ignores non-character keys and accepts curly quotes from phones', () => {
  const t = createTyping("it's \"go\"");
  assert.equal(typeKey(t, 'Shift'), 'skip');
  for (const ch of 'it') typeKey(t, ch);
  assert.equal(typeKey(t, '’'), 'hit');
  for (const ch of 's ') typeKey(t, ch);
  assert.equal(typeKey(t, '“'), 'hit');
  for (const ch of 'go') typeKey(t, ch);
  assert.equal(typeKey(t, '”'), 'done');
  assert.equal(normalizeKey(' '), ' ');
});

test('clean words build a streak and a miss resets it', () => {
  const t = createTyping('one two three four');
  for (const ch of 'one two ') typeKey(t, ch);
  assert.equal(t.streak, 2);
  typeKey(t, 'x');
  assert.equal(t.streak, 0);
  for (const ch of 'three ') typeKey(t, ch);
  assert.equal(t.streak, 0, 'the word with the miss does not count');
  for (const ch of 'four') typeKey(t, ch);
  assert.equal(t.streak, 1);
});

test('the current word includes the space the cursor sits on', () => {
  const text = 'catch the drive';
  assert.deepEqual(wordAt(text, 0), [0, 5]);
  assert.deepEqual(wordAt(text, 3), [0, 5]);
  assert.deepEqual(wordAt(text, 5), [0, 6]);
  assert.deepEqual(wordAt(text, 6), [6, 9]);
  assert.deepEqual(wordAt(text, 12), [10, 15]);
  assert.deepEqual(wordAt(text, 15), [15, 15]);
});

test('speed, accuracy and readout formatting', () => {
  assert.equal(wpm(300, 60_000), 60);
  assert.equal(wpm(150, 30_000), 60);
  assert.equal(wpm(0, 1000), 0);
  assert.equal(wpm(10, 0), 0);
  assert.equal(accuracy(0, 0), 1);
  assert.equal(accuracy(95, 5), 0.95);
  assert.equal(formatClock(42_345), '0:42.3');
  assert.equal(formatClock(75_000), '1:15.0');
  assert.equal(ordinal(1), '1st');
  assert.equal(ordinal(2), '2nd');
  assert.equal(ordinal(3), '3rd');
  assert.equal(ordinal(4), '4th');
  assert.equal(ordinal(11), '11th');
  assert.equal(ordinal(22), '22nd');
  assert.ok(strokeRate(0) >= 20 && strokeRate(200) <= 46);
  assert.ok(strokeRate(80) > strokeRate(40));
});

test('margins are called in bow balls, seats and lengths', () => {
  assert.equal(marginText(1), 'a bow ball');
  assert.equal(marginText(2.25), 'a seat');
  assert.equal(marginText(-6.75), '3 seats');
  assert.equal(marginText(18), '1 length');
  assert.equal(marginText(45), '2.5 lengths');
});

test('rival fields pack toward the top of their level, slowest first', () => {
  for (const level of RIVAL_LEVELS) {
    for (let seed = 1; seed <= 20; seed++) {
      const field = rivalField(level, rng(seed));
      const [lo, hi] = RIVAL_WPM[level];
      assert.equal(field.length, 4);
      assert.equal(new Set(field.map((f) => f.crew.name)).size, 4, 'four different crews');
      for (const f of field) assert.ok(f.wpm >= lo && f.wpm <= hi, `${level} ${f.wpm}`);
      for (let i = 1; i < field.length; i++) assert.ok(field[i].wpm >= field[i - 1].wpm);
      assert.ok(field[3].wpm >= lo + (hi - lo) * 0.9, `${level} leader ${field[3].wpm} sits near the top`);
      assert.ok(field[1].wpm >= lo + (hi - lo) * 0.5, `${level} pack ${field[1].wpm} is past the middle`);
    }
  }
  // Each level starts where the one below it ends, so moving up is always a step.
  for (let i = 1; i < RIVAL_LEVELS.length; i++) assert.equal(RIVAL_WPM[RIVAL_LEVELS[i]][0], RIVAL_WPM[RIVAL_LEVELS[i - 1]][1]);
});

test('rivals push when they are behind and follow a race plan', () => {
  assert.equal(catchUp(-0.3), 1, 'no slowing down when ahead');
  assert.equal(catchUp(0), 1);
  assert.ok(catchUp(0.05) > 1 && catchUp(0.05) < 1 + CATCH_UP_MAX);
  assert.equal(catchUp(0.9), 1 + CATCH_UP_MAX, 'capped');
  assert.ok(racePace(0.02) > 1, 'quick start');
  assert.ok(racePace(0.5) < 1, 'settle');
  assert.ok(racePace(0.95) > racePace(0.02), 'sprint');
  const text = PASSAGES[0];
  const finish = (boost: number) => {
    const bot = createBot(80, rng(3));
    let ms = 0;
    while (bot.doneMs === null) {
      ms += 16;
      stepBot(bot, text, 0.016, ms, boost);
    }
    return bot.doneMs!;
  };
  assert.ok(finish(1 + CATCH_UP_MAX) < finish(1), 'a pushing rival finishes sooner');
});

test('bots finish close to their target speed', () => {
  for (const target of [25, 60, 100]) {
    const results: number[] = [];
    for (let seed = 1; seed <= 12; seed++) {
      const text = PASSAGES[seed % PASSAGES.length];
      const bot = createBot(target, rng(seed));
      let ms = 0;
      while (bot.doneMs === null && ms < MAX_RACE_MS) {
        ms += 16;
        stepBot(bot, text, 0.016, ms);
      }
      assert.ok(bot.doneMs !== null, 'bot finished');
      assert.ok(bot.doneMs! <= ms && bot.doneMs! > ms - 20);
      results.push(wpm(text.length, bot.doneMs!));
    }
    const mean = results.reduce((a, b) => a + b, 0) / results.length;
    assert.ok(Math.abs(mean - target) / target < 0.1, `target ${target}, got ${mean.toFixed(1)}`);
  }
});

test('standings put finishers by time, then racers by distance, then leavers', () => {
  const racers = [
    { id: 'a', chars: 80, doneMs: null },
    { id: 'b', chars: 150, doneMs: 40_000 },
    { id: 'c', chars: 120, doneMs: null, out: true },
    { id: 'd', chars: 150, doneMs: 38_000 },
    { id: 'e', chars: 90, doneMs: null },
  ];
  assert.deepEqual(rank(racers).map((r) => r.id), ['d', 'b', 'e', 'a', 'c']);
});

test('the host ends a race when every boat is done, gone or idle', () => {
  const done = { chars: 150, doneMs: 30_000, lastMoveMs: 30_000 };
  const racing = { chars: 90, doneMs: null, lastMoveMs: 40_000 };
  assert.equal(raceOver([done, racing], 45_000), false);
  assert.equal(raceOver([done, { ...racing, out: true }], 45_000), true);
  assert.equal(raceOver([done, racing], 40_000 + STALL_MS), true);
  assert.equal(raceOver([done, done], 31_000), true);
  assert.equal(raceOver([{ chars: 0, doneMs: null, lastMoveMs: 0 }], MAX_RACE_MS - 1), true, 'never typed: stalled');
  assert.equal(raceOver([{ ...racing, lastMoveMs: MAX_RACE_MS - 10 }], MAX_RACE_MS), true);
});

test('race packets round trip and reject bad input', () => {
  const race = {
    r: 3,
    s: 41,
    p: 2,
    go: 0,
    el: 12_345,
    end: false,
    rs: [
      { seat: 0, chars: 80, errors: 2, doneMs: null, out: false },
      { seat: 3, chars: 157, errors: 0, doneMs: 31_250, out: false },
      { seat: 5, chars: 10, errors: 9, doneMs: null, out: true },
    ],
  };
  const wire = JSON.parse(JSON.stringify(encodeRace(race)));
  assert.deepEqual(parseRace(wire), race);
  assert.equal(parseRace({ ...wire, k: 'pong' }), null);
  assert.equal(parseRace({ ...wire, p: PASSAGES.length }), null);
  assert.equal(parseRace({ ...wire, rs: [[8, 0, 0, -1, 0]] }), null, 'seat out of range');
  assert.equal(parseRace({ ...wire, rs: [[1, 0, 0, -1, 0], [1, 5, 0, -1, 0]] }), null, 'duplicate seat');
  assert.equal(parseRace({ ...wire, rs: Array.from({ length: 9 }, (_, i) => [i, 0, 0, -1, 0]) }), null, 'too many racers');
  assert.equal(parseRace({ ...wire, rs: [[1, 0.5, 0, -1, 0]] }), null);
  assert.equal(parseRace({ ...wire, go: Number.NaN }), null);
  assert.equal(parseRace(null), null);
  assert.equal(parseRace('race'), null);

  const progress = { r: 3, c: 99, e: 4, d: null };
  assert.deepEqual(parseProgress(JSON.parse(JSON.stringify(encodeProgress(progress)))), progress);
  assert.deepEqual(parseProgress(encodeProgress({ ...progress, d: 30_000 })), { ...progress, d: 30_000 });
  assert.equal(parseProgress({ ...encodeProgress(progress), c: -1 }), null);
  assert.equal(parseProgress({ ...encodeProgress(progress), t: 'race' }), null);
});

test('host progress only moves forward and a finish needs the whole passage', () => {
  const racer = { seat: 1, chars: 40, errors: 1, doneMs: null as number | null, out: false, lastMoveMs: 9_000 };
  assert.equal(applyProgress(racer, { r: 1, c: 30, e: 1, d: null }, 150, 10_000), false);
  assert.equal(racer.chars, 40);
  assert.equal(applyProgress(racer, { r: 1, c: 60, e: 2, d: 12_000 }, 150, 10_000), true);
  assert.equal(racer.chars, 60);
  assert.equal(racer.doneMs, null, 'a finish claim with text left is ignored');
  assert.equal(racer.lastMoveMs, 10_000);
  assert.equal(applyProgress(racer, { r: 1, c: 999, e: 2, d: 30_000 }, 150, 31_000), true);
  assert.equal(racer.chars, 150);
  assert.equal(racer.doneMs, 30_000);
  assert.equal(applyProgress(racer, { r: 1, c: 150, e: 5, d: 20_000 }, 150, 32_000), false, 'finished racers are final');
  assert.equal(racer.doneMs, 30_000);
});
