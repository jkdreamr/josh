import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import {
  AFTER_DARK_SHARE,
  BURST_CAP,
  BURST_GAP,
  Bursts,
  ROUNDS,
  SAVED_MIN,
  SLIP_MAX,
  addSlip,
  bestTurn,
  bowlNow,
  bowlOf,
  bowlSize,
  buildTeams,
  builtInBowl,
  builtInSlips,
  buzz,
  deal,
  draw,
  endTurn,
  fix,
  giverNow,
  giverOf,
  gotIn,
  isOver,
  leader,
  markGot,
  markSkip,
  newMatch,
  parseBowl,
  points,
  pointsByRound,
  replay,
  reviewRows,
  roundNow,
  roundOf,
  scoreTable,
  teamNow,
  teamOf,
  tidySlip,
  toggleSlip,
  totals,
  toughest,
  type Card,
  type Match,
} from '../src/os/arcade/games/fishbowl/logic.ts';
import { AFTER_DARK, BUILT_IN } from '../src/os/arcade/games/fishbowl/slips.ts';

test('teams alternate by seat, the first team takes the extra player', () => {
  assert.deepEqual(buildTeams(4), [
    [0, 2],
    [1, 3],
  ]);
  assert.deepEqual(buildTeams(5), [
    [0, 2, 4],
    [1, 3],
  ]);
  assert.deepEqual(buildTeams(0), [[], []]);
});

test('teams alternate turns and the clue giver rotates inside each team', () => {
  const teams = buildTeams(5); // [0, 2, 4] and [1, 3]
  const order = Array.from({ length: 8 }, (_, i) => [teamOf(i, 0), giverOf(teams, i, 0)]);
  assert.deepEqual(order, [
    [0, 0],
    [1, 1],
    [0, 2],
    [1, 3],
    [0, 4],
    [1, 1],
    [0, 0],
    [1, 3],
  ]);
  // When the second team starts, it starts with its own first player.
  assert.equal(teamOf(0, 1), 1);
  assert.equal(giverOf(teams, 0, 1), 1);
  assert.equal(giverOf(teams, 1, 1), 0);
});

test('drawing avoids the slip that was just skipped unless it is the only one left', () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 50; i++) assert.notEqual(draw([4, 7], rng, 4), 4);
  assert.equal(draw([9], rng, 9), 9);
  assert.equal(draw([], rng), undefined);
  const a = Array.from(
    { length: 10 },
    (
      (r) => () =>
        draw([0, 1, 2, 3, 4, 5], r)
    )(mulberry32(42)),
  );
  const b = Array.from(
    { length: 10 },
    (
      (r) => () =>
        draw([0, 1, 2, 3, 4, 5], r)
    )(mulberry32(42)),
  );
  assert.deepEqual(a, b);
});

test('a guessed slip leaves the bowl for the round, a skipped one goes back in', () => {
  const rng = mulberry32(1);
  let m = deal(newMatch(4, buildTeams(4)), rng);
  assert.equal(bowlNow(m).length, 4);
  const first = m.slip!;
  m = markSkip(m, rng);
  assert.equal(bowlNow(m).length, 4, 'skipping keeps the slip in the bowl');
  assert.notEqual(m.slip, first, 'a different slip comes out after a skip');
  const second = m.slip!;
  m = markGot(m, 30, rng).match;
  assert.equal(bowlNow(m).length, 3);
  assert.ok(!bowlNow(m).includes(second));
  assert.equal(points(m.cards), 1);
});

test('skip does nothing useful on the last slip: it comes straight back', () => {
  const rng = mulberry32(5);
  let m = deal(newMatch(2, buildTeams(4)), rng);
  m = markGot(m, 20, rng).match;
  const last = m.slip;
  m = markSkip(m, rng);
  assert.equal(m.slip, last);
});

test('emptying the bowl mid-turn ends the round and the clue giver keeps the leftover time', () => {
  const rng = mulberry32(9);
  let m = deal(newMatch(3, buildTeams(4)), rng);
  m = markGot(m, 40, rng).match;
  m = markGot(m, 31, rng).match;
  const r = markGot(m, 23, rng);
  assert.equal(r.ended, 'round');
  assert.equal(r.match.carry, 23);
  assert.equal(r.match.slip, null);
  assert.equal(roundNow(r.match), 1);
  // Same turn, same team and giver, a full bowl again.
  assert.equal(r.match.turns.length, 0);
  assert.equal(teamNow(r.match), 0);
  assert.equal(giverNow(r.match), 0);
  assert.equal(bowlNow(r.match).length, 3);
  const on = deal(r.match, rng);
  assert.equal(on.carry, null);
  assert.notEqual(on.slip, null);
  assert.equal(points(on.cards), 3);
});

test('rounds progress one to three and the game ends when the last bowl empties', () => {
  const rng = mulberry32(12);
  let m = deal(newMatch(2, buildTeams(4)), rng);
  const ends: string[] = [];
  for (let k = 0; k < 6; k++) {
    const r = markGot(m, 10, rng);
    ends.push(r.ended);
    m = r.ended === 'round' ? deal(r.match, rng) : r.match;
  }
  assert.deepEqual(ends, ['none', 'round', 'none', 'round', 'none', 'game']);
  assert.ok(isOver(m));
  assert.equal(roundNow(m), ROUNDS);
  assert.equal(deal(m, rng).slip, null);
});

test('time running out puts the slip back as a buzzer card and the next team is up', () => {
  const rng = mulberry32(2);
  let m = deal(newMatch(5, buildTeams(6)), rng);
  m = markGot(m, 12, rng).match;
  const held = m.slip!;
  m = buzz(m);
  assert.equal(m.slip, null);
  const last = m.cards[m.cards.length - 1];
  assert.deepEqual(last, { slip: held, round: 0, got: false, buzzer: true });
  assert.ok(bowlNow(m).includes(held));
  m = endTurn(m);
  assert.equal(m.turns.length, 1);
  assert.equal(m.turns[0].team, 0);
  assert.equal(teamNow(m), 1);
  assert.equal(giverNow(m), 1);
  assert.deepEqual(m.cards, []);
});

test('the review groups each slip once and fixes flip it in and out of the bowl', () => {
  const cards: Card[] = [
    { slip: 3, round: 0, got: false },
    { slip: 5, round: 0, got: true },
    { slip: 3, round: 0, got: false },
    { slip: 1, round: 0, got: false, buzzer: true },
  ];
  const rows = reviewRows(cards, 0);
  assert.deepEqual(
    rows.map((r) => [r.slip, r.got, r.buzzer, r.skips]),
    [
      [3, false, false, 2],
      [5, true, false, 0],
      [1, false, true, 0],
    ],
  );
  const credited = toggleSlip(cards, 1, 0);
  assert.equal(points(credited), 2);
  assert.ok(gotIn(credited, 0).has(1));
  const undone = toggleSlip(credited, 5, 0);
  assert.equal(points(undone), 1);
  assert.ok(!gotIn(undone, 0).has(5));
  // A slip skipped twice is credited once.
  assert.equal(points(toggleSlip(cards, 3, 0)), 2);
  // A slip an earlier turn already guessed this round can't be guessed twice.
  assert.equal(points(toggleSlip(cards, 1, 0, new Set([1]))), 1);
  // Slips that never came out this turn are left alone.
  assert.deepEqual(toggleSlip(cards, 9, 0), cards);
});

test('a fix at the round break can reopen the round and the turn plays on in it', () => {
  const rng = mulberry32(4);
  let m = deal(newMatch(2, buildTeams(4)), rng);
  m = markGot(m, 30, rng).match;
  const r = markGot(m, 18, rng);
  assert.equal(r.ended, 'round');
  const undone = fix(r.match, r.match.cards[0].slip, 0);
  assert.equal(roundNow(undone), 0);
  assert.equal(bowlNow(undone).length, 1);
  const on = deal(undone, rng);
  assert.equal(on.slip, r.match.cards[0].slip);
  // Fixing a buzzer slip at the end of a turn can empty the bowl; the next team starts the next round.
  let t = deal(newMatch(2, buildTeams(4)), rng);
  t = markGot(t, 3, rng).match;
  t = buzz(t);
  t = fix(t, t.cards[1].slip, 0);
  assert.equal(roundNow(t), 1);
  t = endTurn(t);
  assert.equal(teamNow(t), 1);
  assert.equal(bowlNow(t).length, 2);
});

test('fixes respect slips guessed by earlier turns', () => {
  const rng = mulberry32(8);
  let m: Match = deal(newMatch(3, buildTeams(4)), rng);
  const firstSlip = m.slip!;
  m = endTurn(markGot(m, 10, rng).match);
  // Pretend the second turn somehow holds a skipped card for the slip the first turn guessed.
  m = { ...m, cards: [{ slip: firstSlip, round: 0, got: false }] };
  assert.equal(points(fix(m, firstSlip, 0).cards), 0);
});

test('scores by round and team, totals, the leader, the best turn and the hardest slip', () => {
  const turns = [
    {
      index: 0,
      team: 0 as const,
      giver: 0,
      cards: [
        { slip: 0, round: 0, got: true },
        { slip: 1, round: 0, got: false },
        { slip: 2, round: 0, got: true },
      ],
    },
    {
      index: 1,
      team: 1 as const,
      giver: 1,
      cards: [
        { slip: 1, round: 0, got: false },
        { slip: 1, round: 0, got: true },
        { slip: 0, round: 1, got: true },
      ],
    },
    {
      index: 2,
      team: 0 as const,
      giver: 2,
      cards: [
        { slip: 1, round: 1, got: false },
        { slip: 2, round: 1, got: true },
        { slip: 1, round: 1, got: true },
        { slip: 0, round: 2, got: true },
      ],
    },
  ];
  const table = scoreTable(turns);
  assert.deepEqual(table, [
    [2, 1],
    [2, 1],
    [1, 0],
  ]);
  assert.deepEqual(totals(table), [5, 2]);
  assert.equal(leader(totals(table)), 0);
  assert.equal(leader([4, 4]), null);
  assert.equal(leader([1, 6]), 1);
  assert.deepEqual(scoreTable([], { team: 1, cards: [{ slip: 0, round: 2, got: true }] })[2], [0, 1]);
  const best = bestTurn(turns);
  assert.equal(best?.turn.index, 2);
  assert.equal(best?.points, 3);
  assert.deepEqual(toughest(turns), { slip: 1, skips: 3 });
  assert.equal(toughest([turns[0]]), null, 'one skip is not a story');
  assert.equal(bestTurn([{ index: 0, team: 0, giver: 0, cards: [] }]), null);
});

test('a whole seeded game guesses every slip exactly once per round', () => {
  for (const seed of [1, 7, 99]) {
    const rng = mulberry32(seed);
    const count = 12;
    let m = newMatch(count, buildTeams(5));
    let turns = 0;
    while (!isOver(m) && turns < 500) {
      m = deal(m, rng);
      let time = 45;
      while (time > 0 && m.slip !== null) {
        time -= 3 + Math.floor(rng() * 8);
        if (time <= 0) break;
        if (rng() < 0.25 && bowlNow(m).length > 1) m = markSkip(m, rng);
        else {
          const r = markGot(m, time, rng);
          m = r.match;
          if (r.ended === 'round') m = deal(m, rng);
        }
      }
      if (m.slip !== null) m = buzz(m);
      m = endTurn(m);
      turns++;
    }
    assert.ok(isOver(m), `seed ${seed} finished`);
    const all = m.turns.flatMap((t) => t.cards);
    for (let r = 0; r < ROUNDS; r++) {
      const got = all.filter((c) => c.got && c.round === r).map((c) => c.slip);
      assert.equal(got.length, count, `round ${r + 1} guesses each slip once`);
      assert.equal(new Set(got).size, count);
    }
    const [a, b] = totals(scoreTable(m.turns));
    assert.equal(a + b, count * ROUNDS);
    // Teams strictly alternate.
    m.turns.forEach((t, i) => assert.equal(t.team, i % 2));
  }
});

test('play again keeps the slips and teams, clears the game and lets the other team start', () => {
  const rng = mulberry32(6);
  let m = deal(newMatch(3, buildTeams(4)), rng);
  m = endTurn(markGot(m, 9, rng).match);
  const again = replay(m);
  assert.equal(again.count, 3);
  assert.deepEqual(again.teams, m.teams);
  assert.deepEqual(again.turns, []);
  assert.equal(again.first, 1);
  assert.equal(teamNow(again), 1);
  assert.equal(giverNow(again), 1);
  assert.equal(roundNow(again), 0);
  assert.equal(replay(again).first, 0);
});

test('round and bowl helpers', () => {
  assert.equal(roundOf(0, []), ROUNDS);
  assert.equal(roundOf(2, [{ slip: 0, round: 0, got: true }]), 0);
  assert.deepEqual(
    bowlOf(
      3,
      [
        { slip: 1, round: 0, got: true },
        { slip: 2, round: 0, got: false },
      ],
      0,
    ),
    [0, 2],
  );
  assert.deepEqual(bowlOf(3, [{ slip: 1, round: 0, got: true }], 1), [0, 1, 2]);
});

test('writing slips: tidy, no blanks, no repeats, a fixed number each', () => {
  assert.equal(tidySlip('  Taylor   Swift \n'), 'Taylor Swift');
  assert.equal(Array.from(tidySlip('x'.repeat(80))).length, SLIP_MAX);
  assert.deepEqual(addSlip([], ' Shrek ', 3), { ok: true, slips: ['Shrek'] });
  assert.equal(addSlip(['Shrek'], 'shrek', 3).ok, false);
  assert.equal(addSlip([], '   ', 3).ok, false);
  assert.equal(addSlip(['a', 'b', 'c'], 'd', 3).ok, false);
});

test('the built-in bowl: a good long list, sized to the table, no repeats', () => {
  assert.ok(BUILT_IN.length >= 140, `${BUILT_IN.length} built-in slips`);
  assert.equal(new Set(BUILT_IN.map((s) => s.toLocaleLowerCase())).size, BUILT_IN.length, 'no duplicates');
  for (const s of BUILT_IN) {
    assert.equal(tidySlip(s), s, `"${s}" is tidy`);
    assert.ok(!/[\u2013\u2014]/.test(s));
  }
  assert.equal(bowlSize(4), 20);
  assert.equal(bowlSize(7), 28);
  assert.equal(bowlSize(20), 40);
  const a = builtInSlips(BUILT_IN, 28, mulberry32(10));
  assert.equal(a.length, 28);
  assert.equal(new Set(a).size, 28);
  assert.deepEqual(a, builtInSlips(BUILT_IN, 28, mulberry32(10)));
  assert.notDeepEqual(a, builtInSlips(BUILT_IN, 28, mulberry32(11)));
});

test('fixing the very last slip of the game plays on with the time that was left, not a fresh clock', () => {
  const rng = mulberry32(21);
  let m = deal(newMatch(2, buildTeams(4)), rng);
  for (let k = 0; k < 4; k++) {
    const r = markGot(m, 40 - k, rng);
    m = r.ended === 'round' ? deal(r.match, rng) : r.match;
  }
  m = markGot(m, 50, rng).match;
  const end = markGot(m, 48, rng);
  assert.equal(end.ended, 'game');
  assert.equal(end.match.carry, 48, 'the clock stopped on 0:48');
  // The final break: un-mark a slip and the round reopens; the giver keeps going with 0:48.
  const reopened = fix(end.match, end.match.cards[end.match.cards.length - 1].slip, 2);
  assert.equal(roundNow(reopened), 2);
  assert.equal(reopened.carry, 48, 'still 0:48 when play resumes');
  assert.equal(deal(reopened, rng).carry, null);
  // Ending the game closes the turn and clears the carry.
  assert.equal(endTurn(end.match).carry, null);
});

test('a turn that carried into the next round splits its points by round', () => {
  assert.deepEqual(pointsByRound([]), []);
  const cards: Card[] = [
    { slip: 0, round: 0, got: true },
    { slip: 1, round: 0, got: true },
    { slip: 2, round: 1, got: false },
    { slip: 0, round: 1, got: true },
    { slip: 1, round: 1, got: false, buzzer: true },
  ];
  assert.deepEqual(pointsByRound(cards), [
    { round: 0, points: 2 },
    { round: 1, points: 1 },
  ]);
  assert.deepEqual(pointsByRound([{ slip: 3, round: 2, got: false }]), [{ round: 2, points: 0 }]);
});

test('a written bowl survives a reload: stored slips come back tidy, junk comes back as nothing', () => {
  assert.equal(parseBowl(null), null);
  assert.equal(parseBowl('slips'), null);
  assert.equal(parseBowl({ slips: 'Shrek' }), null);
  assert.equal(parseBowl({ slips: ['Shrek', 'Mom'] }), null, `fewer than ${SAVED_MIN} slips is not a bowl`);
  const bowl = parseBowl({ slips: ['  Taylor   Swift ', 'Shrek', 4, '', 'Mom', 'Kim', 'x'.repeat(90)], by: ['Josh', 7, 'Sam'] });
  assert.deepEqual(bowl?.slips.slice(0, 4), ['Taylor Swift', 'Shrek', 'Mom', 'Kim']);
  assert.equal(Array.from(bowl!.slips[4]).length, SLIP_MAX);
  assert.deepEqual(bowl?.by, ['Josh', 'Sam']);
  // Two players writing the same name is part of the game; both stay in.
  assert.equal(parseBowl({ slips: ['Shrek', 'Shrek', 'Mom', 'Kim'] })?.slips.length, 4);
});

test('a burst of taps that started before a step appeared does not count on it until it stops', () => {
  const b = new Bursts();
  // A frantic Got It every 150 ms from t=0; the review appears at t=1500.
  for (let t = 0; t <= 4000; t += 150) {
    b.note(t);
    if (t > 1500) assert.equal(b.fresh(1500, t), false, `mashing at ${t} ms`);
  }
  // A pause, then one deliberate tap: it counts.
  b.note(4000 + BURST_GAP + 1);
  assert.equal(b.fresh(1500, 4000 + BURST_GAP + 1), true);
  // A burst that starts on the step counts all the way through (fixing rows, then Pass).
  const c = new Bursts();
  c.note(100);
  c.note(2000);
  c.note(2300);
  c.note(2600);
  assert.equal(c.fresh(1500, 2600), true);
  // A press in the same instant the step appeared belongs to the step before.
  const d = new Bursts();
  d.note(1500);
  assert.equal(d.fresh(1500, 1500), false);
  // Safety valve: after BURST_CAP on a step, presses count again.
  assert.equal(b.fresh(0, BURST_CAP), true);
});

const SMALL = new Set(['a', 'an', 'and', 'at', 'by', 'da', 'de', 'for', 'from', 'in', 'into', 'of', 'on', 'or', 'the', 'to', 'van', 'with']);
const titleCase = (s: string) => s.split(' ').every((w, i) => (i > 0 && SMALL.has(w)) || !/^[a-z]/.test(w));

test('every built-in slip is in Title Case', () => {
  for (const s of [...BUILT_IN, ...AFTER_DARK]) assert.ok(titleCase(s), `"${s}" is in Title Case`);
});

test('After Dark (18+): a full list, clean, no repeats, nothing shared with the classic bowl', () => {
  assert.ok(AFTER_DARK.length >= 75, `${AFTER_DARK.length} After Dark slips`);
  const classic = new Set(BUILT_IN.map((s) => s.toLocaleLowerCase()));
  assert.equal(new Set(AFTER_DARK.map((s) => s.toLocaleLowerCase())).size, AFTER_DARK.length, 'no duplicates');
  for (const s of AFTER_DARK) {
    assert.ok(!classic.has(s.toLocaleLowerCase()), `"${s}" is also in the classic bowl`);
    assert.equal(tidySlip(s), s, `"${s}" is tidy`);
    assert.ok(Array.from(s).length <= SLIP_MAX);
    assert.ok(!/[–—]/.test(s), `"${s}" has a dash`);
    // The never list: minors and teen settings, consent, getting someone drunk, cruelty.
    assert.doesNotMatch(s, /\b(teen|teens|school|student|minor|kid|child|barely|virgin|drunk|roofie|force|forced|rape|grope|slut|whore|fat|titanic|grease|dirty dancing)\b/i, `"${s}" is on the never list`);
  }
});

test('After Dark is off by default and off means the classic bowl exactly', () => {
  const index = readFileSync(join(import.meta.dirname, '..', 'src', 'os', 'arcade', 'games', 'fishbowl', 'index.tsx'), 'utf8');
  assert.match(index, /defineSetting\('fishbowl:heat', \['classic', 'dark'\] as const, 'classic'\)/, 'the 18+ setting defaults to classic');
  assert.match(index, /'After Dark 18\+'/, 'the control says 18+');
  const spicy = new Set(AFTER_DARK);
  for (const seed of [1, 2, 3]) {
    const off = builtInBowl(BUILT_IN, 28, [], mulberry32(seed));
    assert.deepEqual(off, builtInSlips(BUILT_IN, 28, mulberry32(seed)), 'off is the classic deal');
    assert.ok(off.every((s) => !spicy.has(s)), 'no 18+ slip when off');
  }
});

test('After Dark on: half the bowl is 18+, no repeats, the right size', () => {
  for (const [count, seed] of [
    [20, 4],
    [27, 5],
    [40, 6],
  ] as const) {
    const bowl = builtInBowl(BUILT_IN, count, AFTER_DARK, mulberry32(seed));
    assert.equal(bowl.length, count);
    assert.equal(new Set(bowl).size, count);
    const hot = bowl.filter((s) => AFTER_DARK.includes(s)).length;
    assert.equal(hot, Math.ceil(count * AFTER_DARK_SHARE));
    assert.equal(bowl.length - hot, bowl.filter((s) => BUILT_IN.includes(s)).length);
  }
  // Shuffled together, not dealt as a block.
  const bowl = builtInBowl(BUILT_IN, 40, AFTER_DARK, mulberry32(9));
  assert.ok(bowl.slice(0, 20).some((s) => BUILT_IN.includes(s)) && bowl.slice(0, 20).some((s) => AFTER_DARK.includes(s)));
});
