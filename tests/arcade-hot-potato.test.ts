import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Pile, mulberry32 } from '../src/os/arcade/kit/party-core.ts';
import {
  BURN_END,
  FUSES,
  LOSER_SIPS,
  TICK_MAX,
  TICK_MIN,
  addLoss,
  burnAt,
  burnProfile,
  fuseLength,
  leaders,
  lossesOf,
  nextStarter,
  promptsFor,
  removeLoss,
  standings,
  tickGap,
  type FuseSetting,
} from '../src/os/arcade/games/hot-potato/logic.ts';
import { CATEGORIES, LETTERS } from '../src/os/arcade/games/hot-potato/prompts.ts';

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
  assert.deepEqual(FUSES.normal, [15, 40]);
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

test('ticks speed up as the end nears, with jitter, inside sane bounds', () => {
  const rng = mulberry32(21);
  const avg = (left: number) => {
    let sum = 0;
    for (let i = 0; i < 400; i++) sum += tickGap(left, rng);
    return sum / 400;
  };
  const far = avg(40);
  const mid = avg(10);
  const near = avg(3);
  const last = avg(0.5);
  assert.ok(far > mid && mid > near && near > last, `slows to speeds: ${far.toFixed(2)} ${mid.toFixed(2)} ${near.toFixed(2)} ${last.toFixed(2)}`);
  assert.ok(far > 0.7 && far < 1.1, 'about once a second with plenty left');
  assert.ok(last < 0.25, 'a fast rattle at the very end');
  const spread = new Set(Array.from({ length: 50 }, () => tickGap(10, rng).toFixed(3)));
  assert.ok(spread.size > 20, 'never a metronome');
  for (const left of [-5, 0, 0.01, 1, 5, 24, 60, 1e6, Number.NaN]) {
    for (let i = 0; i < 50; i++) {
      const g = tickGap(left, rng);
      assert.ok(g >= TICK_MIN && g <= TICK_MAX, `gap ${g} for ${left}s left`);
    }
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
