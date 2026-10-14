import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pile, mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import {
  BURN_END,
  FUSES,
  LOSER_SIPS,
  RESUME_BEAT,
  RESUME_BEATS,
  TICK_MAX,
  TICK_MIN,
  addLoss,
  burnAt,
  burnProfile,
  fuseLength,
  fuseTicks,
  leaders,
  lossesOf,
  nextStarter,
  promptsFor,
  removeLoss,
  standingLine,
  standings,
  tickHeat,
  verdict,
  type FuseSetting,
} from '../src/os/arcade/games/hot-potato/logic.ts';
import { AFTER_DARK, CATEGORIES, LETTERS } from '../src/os/arcade/games/hot-potato/prompts.ts';

test('fuse lengths stay inside each setting and cover the range', () => {
  const rng = mulberry32(3);
  for (const setting of Object.keys(FUSES) as FuseSetting[]) {
    const [lo, hi] = FUSES[setting];
    const seen = Array.from({ length: 400 }, () => fuseLength(setting, rng));
    assert.ok(seen.every((s) => s >= lo && s <= hi), `${setting} stays in ${lo} to ${hi}`);
    assert.ok(Math.min(...seen) < lo + (hi - lo) * 0.1, `${setting} reaches near its shortest`);
    assert.ok(Math.max(...seen) > hi - (hi - lo) * 0.1, `${setting} reaches near its longest`);
  }
  assert.ok(FUSES.short[0] < FUSES.normal[0] && FUSES.normal[0] < FUSES.long[0]);
  assert.ok(FUSES.short[1] < FUSES.normal[1] && FUSES.normal[1] < FUSES.long[1]);
  assert.deepEqual(FUSES.normal, [10, 40]);
  assert.deepEqual(FUSES.long, [15, 60]);
  // No setting has a long guaranteed-safe opening: even Long can blow while the second person is talking.
  for (const setting of Object.keys(FUSES) as FuseSetting[]) assert.ok(FUSES[setting][0] <= 15, `${setting} can go early`);
});

test('the fuse burns forward from 0 and stops short, at a different stub each round', () => {
  const ends = new Set<number>();
  for (let seed = 1; seed <= 60; seed++) {
    const burn = burnProfile(mulberry32(seed));
    assert.deepEqual(burn[0], [0, 0]);
    const [lastT, end] = burn[burn.length - 1];
    assert.equal(lastT, 1);
    assert.ok(end >= BURN_END[0] && end <= BURN_END[1], `ends between ${BURN_END[0]} and ${BURN_END[1]} (got ${end})`);
    ends.add(Math.round(end * 100));
    let prev = -1;
    for (let i = 0; i <= 200; i++) {
      const b = burnAt(burn, i / 200);
      assert.ok(b >= prev - 1e-12, 'never unburns');
      assert.ok(b >= 0 && b <= end + 1e-12);
      prev = b;
    }
    assert.equal(burnAt(burn, 0), 0);
    assert.ok(Math.abs(burnAt(burn, 1) - end) < 1e-9);
    assert.equal(burnAt(burn, -3), 0, 'clamps before the start');
    assert.ok(Math.abs(burnAt(burn, 7) - end) < 1e-9, 'clamps after the end');
  }
  assert.ok(ends.size > 10, 'the stub left at the boom varies');
});

test('the fuse display is not linear, so the time left cannot be read off it', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const burn = burnProfile(mulberry32(seed));
    const end = burn[burn.length - 1][1];
    // Somewhere the shown burn is well off a straight line from 0 to the end.
    let worst = 0;
    for (let i = 0; i <= 100; i++) worst = Math.max(worst, Math.abs(burnAt(burn, i / 100) - end * (i / 100)));
    assert.ok(worst > 0.04, `seed ${seed} bends (max gap ${worst.toFixed(3)})`);
    // Its speed changes a lot from one stretch to the next.
    const speeds = burn.slice(1).map(([t, b], i) => (b - burn[i][1]) / (t - burn[i][0]));
    assert.ok(Math.max(...speeds) / Math.min(...speeds) > 1.8, `seed ${seed} surges and crawls`);
  }
  // Two rounds with the same time gone show different amounts of fuse.
  const a = burnProfile(mulberry32(1));
  const b = burnProfile(mulberry32(2));
  assert.notEqual(burnAt(a, 0.5).toFixed(3), burnAt(b, 0.5).toFixed(3));
  // Same seed, same fuse.
  assert.deepEqual(burnProfile(mulberry32(9)), burnProfile(mulberry32(9)));
});

test('the fuse ticks on a schedule of its own, inside sane bounds', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const total = fuseLength('normal', mulberry32(seed));
    const ticks = fuseTicks(total, mulberry32(seed * 31));
    assert.ok(ticks.length > 3, 'ticks from start to boom');
    assert.ok(ticks[0] >= 0.2 && ticks[0] <= 0.45, 'the first tick comes right after the match');
    assert.ok(ticks[ticks.length - 1] < total, 'nothing ticks after the boom');
    for (let i = 1; i < ticks.length; i++) {
      const gap = ticks[i] - ticks[i - 1];
      assert.ok(gap >= TICK_MIN - 1e-9 && gap <= TICK_MAX + 1e-9, `gap ${gap}`);
    }
  }
  // The ticks up to any moment are the same whatever the fuse length: the schedule never looks at the time left.
  for (let seed = 1; seed <= 50; seed++) {
    const short = fuseTicks(12, mulberry32(seed));
    const long = fuseTicks(55, mulberry32(seed));
    assert.deepEqual(long.slice(0, short.length), short);
    assert.ok(long[short.length] >= 12);
  }
  assert.deepEqual(fuseTicks(0, mulberry32(1)), []);
  assert.deepEqual(fuseTicks(Number.NaN, mulberry32(1)), []);
  // Same seed, same ticks; different seeds, a different rhythm.
  assert.deepEqual(fuseTicks(30, mulberry32(5)), fuseTicks(30, mulberry32(5)));
  assert.notDeepEqual(fuseTicks(30, mulberry32(5)), fuseTicks(30, mulberry32(6)));
  // Sound heat comes from the tempo: fast ticks run hot, slow ones calm, always 0 to 1.
  assert.equal(tickHeat(TICK_MAX), 0);
  assert.equal(tickHeat(TICK_MIN), 1);
  assert.ok(tickHeat(0.3) > tickHeat(0.6));
  for (const g of [-1, 0, 0.5, 9, Number.NaN]) assert.ok(tickHeat(g) >= 0 && tickHeat(g) <= 1);
  assert.equal(RESUME_BEATS, 3);
  assert.ok(RESUME_BEATS * RESUME_BEAT <= 2, 'the count-in after a pause is short');
});

/** Pearson correlation. */
function corr(xs: readonly number[], ys: readonly number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}
const mean = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

test('simulated rounds: the ticks give away neither the time left nor the fuse length, and still build', () => {
  for (const setting of Object.keys(FUSES) as FuseSetting[]) {
    const gaps: number[] = [];
    const lefts: number[] = [];
    const firstGaps: number[] = [];
    const totals: number[] = [];
    const opening: number[] = [];
    const closing: number[] = [];
    const lastTwo: number[] = [];
    for (let seed = 1; seed <= 1500; seed++) {
      // Each round exactly as the game plays it: a fuse length, then its ticks.
      const rng = mulberry32(seed * 7919 + setting.length);
      const total = fuseLength(setting, rng);
      const ticks = fuseTicks(total, rng);
      for (let i = 0; i + 1 < ticks.length; i++) {
        const gap = ticks[i + 1] - ticks[i];
        const left = total - ticks[i];
        gaps.push(gap);
        lefts.push(left);
        if (ticks[i] < 3) opening.push(gap);
        if (left < 3) closing.push(gap);
        if (left < 2) lastTwo.push(gap);
      }
      firstGaps.push(ticks[1] - ticks[0]);
      totals.push(total);
    }
    // The old fuse ticked as a function of the time left (correlation about 0.9): the last seconds were audible.
    const r = corr(gaps, lefts);
    assert.ok(r < 0.3, `${setting}: tick gap vs time left correlates at ${r.toFixed(3)}`);
    // The old Short fuse's opening speed gave its length away (about 0.75).
    const opener = corr(firstGaps, totals);
    assert.ok(Math.abs(opener) < 0.1, `${setting}: opening tick vs fuse length correlates at ${opener.toFixed(3)}`);
    // In the last two seconds a slow tick is common, so a calm stretch is no promise of time.
    const slow = lastTwo.filter((g) => g > 0.4).length / lastTwo.length;
    assert.ok(slow > 0.2, `${setting}: ${(slow * 100).toFixed(0)}% of ticks in the last 2 s are slow`);
    // Tension still builds: on average the closing seconds tick much faster than the opening ones.
    assert.ok(mean(closing) < mean(opening) * 0.75, `${setting}: closing ${mean(closing).toFixed(2)} s vs opening ${mean(opening).toFixed(2)} s`);
  }
});

test('prompt piles: the right kinds per mode, no repeats until the pile runs out', () => {
  const cats = promptsFor('categories');
  const lets = promptsFor('letters');
  const mix = promptsFor('mix');
  assert.ok(cats.every((p) => p.kind === 'category'));
  assert.ok(lets.every((p) => p.kind === 'letters'));
  assert.equal(cats.length, CATEGORIES.length);
  assert.equal(lets.length, LETTERS.length);
  assert.equal(mix.length, CATEGORIES.length + LETTERS.length);

  const pile = new Pile(mix, mulberry32(4));
  const seen = new Set<string>();
  let last;
  for (let i = 0; i < mix.length; i++) {
    const p = pile.draw(last);
    assert.ok(p);
    const key = `${p.kind}:${p.text}`;
    assert.ok(!seen.has(key), `${key} came up twice in one pass`);
    seen.add(key);
    last = p;
  }
  assert.equal(seen.size, mix.length);
  assert.notEqual(pile.draw(last), last, 'a reshuffle never repeats the last prompt');
});

test('prompt content is full, varied and clean', () => {
  assert.ok(CATEGORIES.length >= 110 && CATEGORIES.length <= 140, `about 120 categories (got ${CATEGORIES.length})`);
  assert.ok(LETTERS.length >= 75 && LETTERS.length <= 90, `about 80 letter chunks (got ${LETTERS.length})`);
  assert.equal(new Set(CATEGORIES.map((c) => c.toLowerCase())).size, CATEGORIES.length, 'no duplicate categories');
  assert.equal(new Set(LETTERS).size, LETTERS.length, 'no duplicate letter chunks');
  for (const c of CATEGORIES) {
    assert.match(c, /^[A-Z]/, `"${c}" starts with a capital`);
    assert.notEqual(c, c.toUpperCase(), `"${c}" is sentence case, not shouting`);
    assert.ok(c.length <= 40, `"${c}" fits on the card`);
    assert.doesNotMatch(c, /[\u2013\u2014.!]$|[\u2013\u2014]/, `"${c}" has no dashes or end punctuation`);
  }
  for (const l of LETTERS) assert.match(l, /^[A-Z]{1,4}$/, `"${l}" is one to four capital letters`);
  // Varied shapes and topics, not a list of "Things that..." and dogs.
  const things = CATEGORIES.filter((c) => /^Things\b/.test(c)).length;
  assert.ok(things <= CATEGORIES.length * 0.15, `${things} categories start with "Things"`);
  assert.ok(CATEGORIES.filter((c) => /\bdogs?\b/i.test(c)).length <= 1, 'one dog prompt is plenty');
  assert.ok(LETTERS.includes('ING') && LETTERS.includes('TION') && LETTERS.includes('OU'));
});

test('losses tally by name, undo takes one back, standings and the session leader', () => {
  const names = ['Josh', 'Sam', 'Alex', 'Jordan'];
  let t = {};
  assert.deepEqual(leaders(t, names), [], 'no leader before the first boom');
  t = addLoss(t, 'Sam');
  t = addLoss(t, 'Alex');
  t = addLoss(t, 'Sam');
  assert.equal(lossesOf(t, 'Sam'), 2);
  assert.equal(lossesOf(t, 'Josh'), 0);
  assert.deepEqual(leaders(t, names), ['Sam']);
  assert.deepEqual(
    standings(t, names).map((s) => [s.name, s.losses, s.seat]),
    [
      ['Sam', 2, 1],
      ['Alex', 1, 2],
      ['Josh', 0, 0],
      ['Jordan', 0, 3],
    ],
  );
  t = addLoss(t, 'Alex');
  assert.deepEqual(leaders(t, names), ['Sam', 'Alex'], 'a tie at the top keeps seating order');
  t = removeLoss(t, 'Alex');
  assert.deepEqual(leaders(t, names), ['Sam']);
  t = removeLoss(t, 'Josh');
  assert.equal(lossesOf(t, 'Josh'), 0, 'undo never goes below zero');
  assert.ok(!Object.keys(t).includes('Josh'));
  // A player who left the table doesn't lead it.
  assert.deepEqual(leaders(t, ['Josh', 'Alex']), ['Alex']);
  // Names that look like object internals are just names.
  let odd = {};
  odd = addLoss(odd, 'constructor');
  odd = addLoss(odd, '__proto__');
  odd = addLoss(odd, '__proto__');
  assert.equal(lossesOf(odd, 'constructor'), 1);
  assert.equal(lossesOf(odd, '__proto__'), 2);
  assert.equal(lossesOf(odd, 'toString'), 0);
  assert.deepEqual(leaders(odd, ['constructor', '__proto__']), ['__proto__']);
  odd = removeLoss(odd, '__proto__');
  odd = removeLoss(odd, '__proto__');
  assert.equal(lossesOf(odd, '__proto__'), 0);
  assert.equal(LOSER_SIPS, 2);
});

test('the loser starts the next round, otherwise anyone can', () => {
  const rng = mulberry32(8);
  assert.equal(nextStarter(5, 3, rng), 3);
  assert.equal(nextStarter(0, null, rng), 0);
  const seen = new Set<number>();
  for (let i = 0; i < 200; i++) {
    const s = nextStarter(5, null, rng);
    assert.ok(s >= 0 && s < 5);
    seen.add(s);
  }
  assert.equal(seen.size, 5);
  const fallback = nextStarter(3, 7, rng);
  assert.ok(fallback >= 0 && fallback < 3, 'a stale seat falls back to random');
});

test('the round result names the loser once, then says where they stand', () => {
  const names = ['Josh', 'Sam', 'Christopher Lee', 'Jordan', 'Bo'];
  assert.equal(verdict('Sam', false), 'Sam takes a point');
  assert.equal(verdict('Sam', true), `Sam drinks ${LOSER_SIPS} sips`);
  let t = addLoss({}, 'Christopher Lee');
  assert.equal(standingLine(t, names, 'Christopher Lee', false), 'Fewest points wins.');
  assert.equal(standingLine(t, names, 'Christopher Lee', true), 'First boom of the night.');
  t = addLoss(t, 'Christopher Lee');
  assert.equal(standingLine(t, names, 'Christopher Lee', false), "That's 2, the most so far.");
  assert.equal(standingLine(t, names, 'Christopher Lee', true), '2 lost, the most so far.');
  t = addLoss(addLoss(t, 'Sam'), 'Sam');
  assert.equal(standingLine(t, names, 'Sam', false), "That's 2, level with Christopher Lee for the most.");
  t = addLoss(addLoss(t, 'Bo'), 'Bo');
  assert.equal(standingLine(t, names, 'Bo', false), "That's 2, tied with 2 others for the most.");
  t = addLoss(t, 'Josh');
  assert.equal(standingLine(t, names, 'Josh', false), "That's 1. 3 players are on 2, the most.");
  t = addLoss(t, 'Sam');
  assert.equal(standingLine(t, names, 'Josh', false), "That's 1. Sam is on 3, the most.");
  assert.equal(standingLine(t, names, 'Josh', true), '1 lost so far. Sam has lost 3, the most.');
  t = addLoss(t, 'Bo');
  assert.equal(standingLine(t, names, 'Josh', false), "That's 1. Sam and Bo are on 3, the most.");
  assert.equal(standingLine(t, names, 'Josh', true), '1 lost so far. Sam and Bo have lost 3 each.');
  for (const name of names) for (const drinks of [false, true]) assert.doesNotMatch(standingLine(t, names, name, drinks) + verdict(name, drinks), /[\u2013\u2014]/);
});

test('After Dark 18+ mixes its categories in only when turned on', () => {
  assert.ok(AFTER_DARK.length >= 35 && AFTER_DARK.length <= 50, `about 40 (got ${AFTER_DARK.length})`);
  assert.equal(new Set(AFTER_DARK.map((c) => c.toLowerCase())).size, AFTER_DARK.length, 'no duplicates inside After Dark');
  const base = new Set(CATEGORIES.map((c) => c.toLowerCase()));
  for (const c of AFTER_DARK) {
    assert.ok(!base.has(c.toLowerCase()), `"${c}" is in both tiers`);
    assert.match(c, /^[A-Z]/, `"${c}" starts with a capital`);
    assert.notEqual(c, c.toUpperCase(), `"${c}" is sentence case`);
    assert.ok(c.length <= 40, `"${c}" fits on the card`);
    assert.doesNotMatch(c, /[\u2013\u2014.!]$|[\u2013\u2014]/, `"${c}" has no dashes or end punctuation`);
    // The spice guide's hard lines: nothing about minors or school, consent or cruelty.
    assert.doesNotMatch(c, /\b(school|teen|minor|underage|student|roofie|drugged|passed out|blackout|fat|ugly)\b/i, `"${c}" crosses a line`);
  }
  // Off (the default): exactly the usual prompts, none of them spicy.
  for (const mode of ['categories', 'letters', 'mix'] as const) {
    assert.deepEqual(promptsFor(mode, false), promptsFor(mode));
    assert.ok(!promptsFor(mode).some((p) => p.spicy));
  }
  // On: the usual categories plus every After Dark one, marked. Letters has nothing to spice.
  const on = promptsFor('mix', true);
  assert.equal(on.length, promptsFor('mix').length + AFTER_DARK.length);
  assert.equal(on.filter((p) => p.spicy).length, AFTER_DARK.length);
  assert.ok(on.filter((p) => p.spicy).every((p) => p.kind === 'category'));
  assert.equal(promptsFor('categories', true).length, CATEGORIES.length + AFTER_DARK.length);
  assert.deepEqual(promptsFor('letters', true), promptsFor('letters'));
});
