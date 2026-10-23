import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BOT_NAMES, botPasses, passChance, skillOf } from '../src/os/arcade/games/dead-week/bots.ts';
import { GRACE, INTRO, createDirector, playEnd, report, tick, vote } from '../src/os/arcade/games/dead-week/director.ts';
import { Beat, bpmOf, stepVoices } from '../src/os/arcade/games/dead-week/music.ts';
import { gameOf, parsePacket, reportOf, resultOf, tallyOf, voteOf } from '../src/os/arcade/games/dead-week/net.ts';
import { BOSS_EVERY, TIERS_EVERY, commandTime, isBoss, planGame, resultsTime, tierOf } from '../src/os/arcade/games/dead-week/plan.ts';
import { LIVES, botVote, createRoyale, leaders, leave, resolveGame, tallyCurse } from '../src/os/arcade/games/dead-week/rules.ts';
import type { Curse, Entry } from '../src/os/arcade/games/dead-week/rules.ts';

const entries = (count: number, bots: readonly number[] = []): Entry[] =>
  Array.from({ length: count }, (_, seat) => ({
    seat,
    name: bots.includes(seat) ? BOT_NAMES[seat % BOT_NAMES.length] : `student ${seat}`,
    bot: bots.includes(seat),
  }));

test('rules start with four lives and charge one life for a regular fail', () => {
  const royale = createRoyale(entries(2));
  assert.deepEqual(royale.entrants.map((e) => e.lives), [4, 4]);
  const result = resolveGame(royale, new Map([[0, true], [1, false]]));
  assert.deepEqual(result.lost, [1]);
  assert.deepEqual(result.eliminated, []);
  assert.equal(royale.entrants[1].lives, LIVES - 1);
  assert.equal(royale.entrants[0].passed, 1);
});

test('a shared all-alive fail loses no lives and enters sudden death', () => {
  const royale = createRoyale(entries(3));
  const result = resolveGame(royale, new Map([[0, false], [1, false], [2, false]]));
  assert.equal(result.shared, true);
  assert.deepEqual(result.lost, []);
  assert.deepEqual(royale.entrants.map((e) => e.lives), [4, 4, 4]);
  assert.equal(royale.sudden, true);
});

test('in sudden death a non-shared fail eliminates regardless of remaining lives', () => {
  const royale = createRoyale(entries(3));
  royale.sudden = true;
  const result = resolveGame(royale, new Map([[0, true], [1, false], [2, true]]));
  assert.deepEqual(result.lost, [1]);
  assert.deepEqual(result.eliminated, [1]);
  assert.equal(royale.entrants[1].lives, 0);
  assert.equal(royale.entrants[1].out, true);
  assert.equal(royale.sudden, false);
});

test('last alive wins and finishing places follow elimination order', () => {
  const royale = createRoyale(entries(4));
  const eliminate = (seat: number) => {
    for (let life = 0; life < LIVES; life++) {
      const results = new Map(royale.entrants.filter((e) => !e.out).map((e) => [e.seat, e.seat !== seat]));
      resolveGame(royale, results);
    }
  };
  eliminate(3);
  assert.equal(royale.entrants[3].place, 4);
  eliminate(2);
  assert.equal(royale.entrants[2].place, 3);
  eliminate(1);
  assert.equal(royale.entrants[1].place, 2);
  assert.equal(royale.entrants[0].place, 1);
  assert.equal(royale.winner, 0);
  assert.equal(royale.over, true);
});

test('leaving marks a player out and can settle the winner', () => {
  const royale = createRoyale(entries(2));
  assert.equal(leave(royale, 0), true);
  assert.equal(royale.entrants[0].out, true);
  assert.equal(royale.entrants[0].left, true);
  assert.equal(royale.entrants[0].place, 2);
  assert.equal(royale.winner, 1);
  assert.equal(royale.over, true);
  assert.equal(leave(royale, 0), false);
});

test('leaders returns every alive player tied for the most lives', () => {
  const royale = createRoyale(entries(3));
  assert.deepEqual(leaders(royale), [0, 1, 2]);
  resolveGame(royale, new Map([[0, false], [1, true], [2, true]]));
  assert.deepEqual(leaders(royale), [1, 2]);
});

test('human curse votes override any number of bot votes; ties and bot votes are seeded', () => {
  const bots = new Set([0, 1, 2, 3, 4, 5]);
  const votes = new Map<number, Curse>([[0, 'quiz'], [1, 'quiz'], [2, 'quiz'], [3, 'quiz'], [4, 'quiz'], [5, 'quiz'], [20, 'flip']]);
  assert.equal(tallyCurse(votes, bots, 71), 'flip');
  const tied = new Map<number, Curse>([[20, 'quiz'], [21, 'flip']]);
  assert.equal(tallyCurse(tied, new Set(), 99), tallyCurse(tied, new Set(), 99));
  assert.equal(tallyCurse(new Map(), new Set(), 99), null);
  assert.equal(botVote(551, 12, 3), botVote(551, 12, 3));
});

test('plans are deterministic, tier every five games, and boss indexes are explicit', () => {
  assert.deepEqual(planGame(4312, 17), planGame(4312, 17));
  assert.equal(TIERS_EVERY, 5);
  assert.deepEqual([0, 4, 5, 9, 10, 14, 15].map(tierOf), [0, 0, 1, 1, 2, 2, 3]);
  assert.equal(BOSS_EVERY, 10);
  assert.equal(isBoss(8), false);
  assert.equal(isBoss(9), true);
  assert.equal(isBoss(10), false);
  assert.equal(isBoss(19), true);
  assert.equal(planGame(4312, 9).boss, true);
  assert.equal(planGame(4312, 9).ids.length, 3);
  assert.equal(planGame(4312, 10).boss, false);
});

test('the first twelve non-boss plans do not repeat a micro-game', () => {
  const selected: string[] = [];
  for (let n = 0; selected.length < 12; n++) {
    const plan = planGame(89231, n);
    if (!plan.boss) selected.push(plan.ids[0]);
  }
  assert.equal(new Set(selected).size, 12);
});

test('command and results time shrink by tier, and decoy adds command time', () => {
  for (let tier = 0; tier < 20; tier++) {
    assert.ok(commandTime(tier + 1, false) <= commandTime(tier, false));
    assert.ok(commandTime(tier + 1, true) <= commandTime(tier, true));
    assert.ok(Math.abs(commandTime(tier, true) - commandTime(tier, false) - 0.6) < 1e-9);
    assert.ok(resultsTime(tier + 1) <= resultsTime(tier));
  }
});

test('bot skills are stable and varied; pass chance and pass rolls respond to difficulty', () => {
  const skills = BOT_NAMES.map((name) => skillOf(name));
  assert.deepEqual(skills, BOT_NAMES.map((name) => skillOf(name)));
  assert.ok(new Set(skills).size > 1);
  assert.ok(passChance(0.9, 1, false) < passChance(0.9, 0, false));
  assert.ok(passChance(0.9, 0, true) < passChance(0.9, 0, false));
  assert.equal(botPasses(123, 8, 2, 0.9, 3, true), botPasses(123, 8, 2, 0.9, 3, true));

  let topPasses = 0;
  let lowPasses = 0;
  for (let seed = 0; seed < 2000; seed++) {
    topPasses += Number(botPasses(seed, 0, 0, skillOf(BOT_NAMES[0]), 0, false));
    lowPasses += Number(botPasses(seed, 0, 0, skillOf(BOT_NAMES[4]), 0, false));
  }
  assert.ok(topPasses > lowPasses, `top skill passed ${topPasses}/2000, low skill passed ${lowPasses}/2000`);
});

test('director advances through game and results packets as humans report', () => {
  const d = createDirector(118, entries(2), 0);
  const present = new Set([0, 1]);
  const intro = tick(d, INTRO, present);
  assert.equal(intro[0]?.k, 'G');
  assert.equal(d.phase, 'game');
  assert.equal(report(d, 0, d.royale.n, true), true);
  assert.equal(report(d, 1, d.royale.n, false), true);
  assert.equal(report(d, 1, d.royale.n, true), false);
  const result = tick(d, playEnd(d), present);
  assert.equal(result[0]?.k, 'R');
  assert.equal(d.phase, 'results');
  const next = tick(d, d.at + resultsTime(d.plan!.tier), present);
  assert.equal(next[0]?.k, 'G');
  assert.equal(d.phase, 'game');
  assert.equal(d.royale.n, 1);
});

test('a missing human report after the grace deadline is recorded as a fail', () => {
  const d = createDirector(91, entries(2, [1]), 0);
  tick(d, INTRO, new Set([0]));
  assert.equal(d.deadline, playEnd(d) + GRACE);
  const result = tick(d, d.deadline, new Set([0]));
  assert.equal(result[0]?.k, 'R');
  if (result[0]?.k === 'R') assert.deepEqual(result[0].r.res.find(([seat]) => seat === 0), [0, 0]);
});

test('a human missing from the present set is marked left and out', () => {
  const d = createDirector(417, entries(2), 0);
  tick(d, INTRO, new Set([0, 1]));
  const result = tick(d, d.at + 0.1, new Set([0]));
  const absent = d.royale.entrants.find((e) => e.seat === 1)!;
  assert.equal(absent.left, true);
  assert.equal(absent.out, true);
  assert.equal(d.royale.over, true);
  assert.equal(result[0]?.k, 'R');
});

test('offline play with one failing human and three bots eventually ends', () => {
  const d = createDirector(99012, entries(4, [1, 2, 3]), 0);
  let now = INTRO;
  tick(d, now, null);
  for (let i = 0; i < 600 && d.phase !== 'over'; i++) {
    if (d.phase === 'game') {
      const human = d.royale.entrants.find((e) => e.seat === 0);
      if (human && !human.out) assert.equal(report(d, 0, d.royale.n, false), true);
      now = playEnd(d);
      tick(d, now, null);
    } else if (d.phase === 'results') {
      now = d.at + resultsTime(d.plan!.tier);
      tick(d, now, null);
    }
  }
  assert.equal(d.royale.over, true);
  assert.equal(d.phase, 'over');
});

test('only eliminated, present players may cast curse votes', () => {
  const d = createDirector(321, entries(3), 0);
  assert.equal(vote(d, 2, 'quiz'), false);
  for (let i = 0; i < LIVES; i++) resolveGame(d.royale, new Map([[0, true], [1, true], [2, false]]));
  assert.equal(d.royale.entrants.find((e) => e.seat === 2)?.out, true);
  assert.equal(d.royale.over, false);
  assert.equal(vote(d, 2, 'quiz'), true);
  assert.equal(vote(d, 0, 'flip'), false);
});

test('network packets round-trip each packet kind', () => {
  const st = [
    { s: 0, l: 4, p: -1, b: 0 as const, nm: 'student 0', x: 0 as const },
    { s: 1, l: 3, p: 4, b: 1 as const, nm: 'bot 1', x: 0 as const },
  ];
  const game = { n: 3, seed: 12345, curse: 'quiz' as const, cursed: [0], sudden: false, st };
  const result = { n: 3, res: [[0, 1], [1, 0]] as [number, 0 | 1][], shared: false, lost: [1], elim: [], st, sudden: false, over: false, winner: null };
  assert.deepEqual(parsePacket(gameOf(game)), { k: 'G', ...game });
  assert.deepEqual(parsePacket(resultOf(result)), { k: 'R', ...result });
  assert.deepEqual(parsePacket(reportOf(3, true)), { k: 'P', n: 3, pass: true });
  assert.deepEqual(parsePacket(voteOf(3, 'decoy')), { k: 'V', n: 3, c: 'decoy' });
  const tally = { n: 3, done: [[0, 1], [1, 0]] as [number, 0 | 1][], votes: [1, 2, 0] as [number, number, number] };
  assert.deepEqual(parsePacket(tallyOf(tally.n, tally.done, tally.votes)), { k: 'T', ...tally });
});

test('network parser rejects bad seats, wrong packet tags, non-finite numbers, and oversized arrays', () => {
  assert.equal(parsePacket({ ...tallyOf(1, [[40, 1]], [0, 0, 0]) }), null);
  assert.equal(parsePacket({ ...reportOf(1, true), t: 'wrong' }), null);
  assert.equal(parsePacket(reportOf(Number.NaN, true)), null);
  const hugeDone = Array.from({ length: 33 }, (_, seat) => [seat % 32, 1] as [number, 0 | 1]);
  assert.equal(parsePacket(tallyOf(1, hugeDone, [0, 0, 0])), null);
  assert.equal(parsePacket({ ...reportOf(100_001, true) }), null);
});

test('music voice steps are deterministic and tempo rises with tier', () => {
  for (let step = 0; step < 16; step++) {
    assert.deepEqual(stepVoices(step, 2, 4), stepVoices(step, 2, 4));
  }
  for (let tier = 0; tier < 9; tier++) assert.ok(bpmOf(tier + 1) >= bpmOf(tier));
  assert.ok(bpmOf(1) > bpmOf(0));
});

test('beat scheduler emits increasing delays within the requested lookahead', () => {
  const beat = new Beat();
  const scheduled: number[] = [];
  beat.tick(10, 2, (_voice, delay) => scheduled.push(delay), 0.5);
  assert.ok(scheduled.length > 0);
  const delays = [...new Set(scheduled)];
  assert.ok(delays.every((delay) => delay >= 0 && delay < 0.5));
  assert.ok(delays.every((delay, i) => i === 0 || delay > delays[i - 1]));
});
