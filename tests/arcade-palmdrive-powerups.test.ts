import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BLAST_CLEAR,
  BOO_T,
  CLASSES,
  CLOUD_DV,
  CLOUD_HOLD,
  CLOUD_T,
  FEATHER_V,
  FIRE_GAP,
  FIRE_T,
  FREEZE_T,
  ITEMS,
  KART_R,
  ODDS,
  PIRANHA_GAP,
  PIRANHA_T,
  POW_GAP,
  POW_T,
  RIVALS,
  ROLL_T,
  ZAP_SHRINK,
  boom,
  catchCloud,
  createRace,
  giveItem,
  hitKart,
  powFrom,
  rankKarts,
  robbed,
  rollItem,
  spawn,
  step,
  useItem,
  type Ev,
  type Item,
  type Kart,
  type Race,
  type Racer,
  type ThingKind,
} from '../src/os/arcade/games/palmdrive/logic.ts';
import { F_BOO, F_CLOUD, F_FROZEN, F_PIRANHA, applyFlags, events, flagsOf, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';
import { EDGE, HAZARD_R, deltaS, headingOf, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;
const BATCH: Item[] = ['boomerang', 'fire', 'ice', 'piranha', 'boo', 'feather', 'cloud', 'pow'];

/** A race already past the lights with n hand-driven karts. */
function race(n: number, seed = 5): Race {
  return createRace({ cc: '100cc', seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz), v, i: at.i, s: at.s, d: at.d, prog: s });
}

function run(r: Race, seconds: number): Ev[] {
  const all: Ev[] = [];
  for (let n = Math.round(seconds / DT); n > 0; n--) {
    step(r, DT);
    all.push(...r.events.splice(0));
  }
  return all;
}

/** Hands a kart an item straight away and presses the item button. */
function use(r: Race, k: Kart, item: Item, opts: { back?: boolean } = {}) {
  giveItem(r, k, item, 0);
  k.input.use = true;
  k.input.back = !!opts.back;
  return run(r, DT);
}

const only = <T extends Ev['t']>(evs: Ev[], t: T) => evs.filter((e): e is Extract<Ev, { t: T }> => e.t === t);

/** Something of `kind` sitting (or flying) on the road at (s, d). */
function thing(r: Race, kind: ThingKind, owner: number, s: number, d = 0, v = 0) {
  const p = pointAt(r.track, s, d);
  return spawn(r, { kind, owner, x: p.x, z: p.z, y: kind === 'banana' ? 0 : 0.35, vx: p.tx * v, vz: p.tz * v, vy: 0, grace: 0, target: -1, prog: 0 });
}

/** Puts a puddle of mud on the road for a test (Palm Drive itself has none). */
function mud(r: Race, s: number, d = 0) {
  const p = pointAt(r.track, s, d);
  r.hazards.push({ kind: 'mud', s, d, r: HAZARD_R.mud, x: p.x, z: p.z, along: s, at: d, tx: p.tx, tz: p.tz, walk: 0 });
}

/** Where a thing is along the road from kart k (positive ahead). */
const aheadOf = (r: Race, k: Kart, x: number, z: number) => deltaS(r.track, k.s, locate(r.track, x, z).s);

test('the new items come out of the boxes by place: the strong ones only further back, and rarely', () => {
  const r = race(8);
  r.karts.forEach((k, i) => (k.prog = 100 - i * 10));
  rankKarts(r);
  const seen = new Map<number, Map<Item, number>>();
  const N = 4000;
  for (const k of r.karts) {
    const got = new Map<Item, number>();
    for (let n = 0; n < N; n++) {
      const item = rollItem(r, k);
      got.set(item, (got.get(item) ?? 0) + 1);
    }
    seen.set(k.place, got);
  }
  const all = new Set([...seen.values()].flatMap((m) => [...m.keys()]));
  assert.deepEqual([...all].sort(), [...ITEMS].sort(), 'every item turns up somewhere');
  const share = (place: number, items: Item[]) => items.reduce((sum, i) => sum + (seen.get(place)!.get(i) ?? 0), 0) / N;
  for (const big of ['fire', 'piranha', 'pow', 'boo', 'ice'] as Item[]) assert.ok(!seen.get(1)!.has(big), `no ${big} in first`);
  for (const small of ['feather', 'cloud', 'boomerang', 'ice'] as Item[]) assert.ok(!seen.get(8)!.has(small), `no ${small} in last`);
  // the batch is a sixth or less of what comes out of a box anywhere, and a POW block a few percent at most
  for (let place = 1; place <= 8; place++) assert.ok(share(place, BATCH) < 0.2, `${place}: ${share(place, BATCH).toFixed(2)}`);
  for (let place = 1; place <= 8; place++) assert.ok(share(place, ['pow']) < 0.03, `${place}: POW ${share(place, ['pow']).toFixed(3)}`);
  // every band of the table adds up to 100 with the batch in it
  for (const [, table] of ODDS) assert.ok(Object.values(table).reduce((a, b) => a + b, 0) >= 100);
});

test('only one POW block and one thunder cloud about at a time, and no POW block straight after lightning', () => {
  const r = race(8);
  r.karts.forEach((k, i) => (k.prog = 100 - i * 10));
  rankKarts(r);
  r.time = 50;
  const last = r.karts.find((k) => k.place === 8)!;
  const fifth = r.karts.find((k) => k.place === 5)!;
  const rolls = (k: Kart) => new Set(Array.from({ length: 3000 }, () => rollItem(r, k)));
  assert.ok(rolls(last).has('pow'));
  r.boltAt = 45;
  assert.ok(!rolls(last).has('pow') && !rolls(last).has('bolt'), 'not straight after lightning');
  r.boltAt = -99;
  powFrom(r, 0, r.time);
  assert.ok(!rolls(last).has('pow'), 'not while one is counting down');
  const first = r.karts.find((k) => k.place === 1)!;
  r.pows = [];
  assert.ok(rolls(first).has('cloud'));
  fifth.cloud = 3;
  assert.ok(!rolls(first).has('cloud'), 'not while one is out');
});

test('a boomerang flies out about 40 m and back past you, hitting karts both ways; three throws, one at a time', () => {
  // all at top speed down the Palm Drive straight: one kart 25 m ahead, one 20 m behind (too far back to draft)
  const r = race(3);
  const [a, b, c] = r.karts;
  const top = CLASSES['100cc'].top;
  place(r, a, -40, 0, top);
  place(r, b, -15, 0, top);
  place(r, c, -60, 0, top);
  const banana = thing(r, 'banana', c.idx, -28);
  giveItem(r, a, 'boomerang', 0);
  assert.equal(a.uses, 3);
  a.input.use = true;
  let far = 0;
  let back = 0;
  const hits: { k: number; out: boolean }[] = [];
  for (let n = 0; n < 4.6 / DT; n++) {
    // pressing again while it is still out does nothing
    if (n === 30) a.input.use = true;
    step(r, DT);
    const boomerang = r.things.find((th) => th.kind === 'boomerang');
    let out = false;
    if (boomerang) {
      const at = locate(r.track, boomerang.x, boomerang.z);
      const ahead = deltaS(r.track, a.s, at.s);
      far = Math.max(far, ahead);
      back = Math.min(back, ahead);
      out = boomerang.vx * at.tx + boomerang.vz * at.tz > 0;
    }
    for (const e of only(r.events.splice(0), 'hit')) hits.push({ k: e.k, out });
  }
  assert.ok(far > 32 && far < 48, `it got ${far.toFixed(1)} m ahead`);
  assert.ok(back < -8, `and came back past (${back.toFixed(1)} m)`);
  assert.ok(hits.some((h) => h.k === b.idx && h.out), 'the kart ahead is hit on the way out');
  assert.ok(hits.some((h) => h.k === c.idx && !h.out), 'the kart behind on the way back');
  assert.ok(!hits.some((h) => h.k === a.idx), 'never the thrower');
  assert.ok(!r.things.includes(banana), 'it knocked the banana aside');
  assert.equal(a.uses, 2, 'one throw at a time');
  for (const left of [1, 0]) {
    a.input.use = true;
    run(r, 4.6);
    assert.equal(a.uses, left);
  }
  assert.equal(a.item, null);
});

test('a fire flower throws a stream of bouncing fireballs for a few seconds that spin out whoever they touch', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 10, 0, 15);
  place(r, b, 40, 0, 15);
  giveItem(r, a, 'fire', 0);
  const evs: Ev[] = [];
  let low = Infinity;
  let high = 0;
  for (let n = 0; n < (FIRE_T + 0.5) / DT; n++) {
    // mashing the button
    a.input.use = true;
    step(r, DT);
    evs.push(...r.events.splice(0));
    for (const th of r.things) {
      if (th.kind !== 'fire') continue;
      low = Math.min(low, th.y);
      high = Math.max(high, th.y);
    }
  }
  const balls = only(evs, 'spawn').filter((e) => e.thing.kind === 'fire').length;
  assert.ok(balls >= FIRE_T / FIRE_GAP - 3 && balls <= FIRE_T / FIRE_GAP + 1, `${balls} fireballs`);
  assert.equal(a.item, null, 'the flower wilts');
  assert.equal(a.fireT, 0);
  assert.ok(low < 0.4 && high > 0.8, `they bounce (${low.toFixed(2)} to ${high.toFixed(2)} m)`);
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx && e.how === 'spin' && e.by === a.idx), 'the kart ahead spins out');
  assert.ok(!only(evs, 'hit').some((e) => e.k === a.idx), 'never the thrower');
});

test('an ice ball freezes the kart it hits: it slides on along the road with no steering and no items; two throws', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 10, 0, 15);
  place(r, b, 30, 0, 20);
  giveItem(r, b, 'mushroom', 0);
  giveItem(r, a, 'ice', 0);
  assert.equal(a.uses, 2);
  a.input.use = true;
  const evs: Ev[] = [];
  for (let n = 0; n < 2 / DT && b.frozen === 0; n++) {
    step(r, DT);
    evs.push(...r.events.splice(0));
  }
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx && e.how === 'freeze' && e.by === a.idx));
  assert.ok(b.frozen > FREEZE_T - 0.1);
  assert.equal(a.uses, 1);
  const h = b.h;
  const v = b.v;
  b.input.steer = 1;
  b.input.use = true;
  run(r, 0.5);
  assert.ok(Math.abs(b.h - h) < 0.02, 'no steering');
  assert.ok(b.v > v * 0.7, `it slides on (${v.toFixed(1)} to ${b.v.toFixed(1)} m/s)`);
  assert.equal(b.item, 'mushroom', 'and cannot use its item');
  assert.equal(hitKart(r, b, 'spin', a.idx), false, 'nothing else lands while it is frozen');
  run(r, FREEZE_T);
  assert.equal(b.frozen, 0);
  const thawed = b.h;
  run(r, 0.4);
  assert.ok(Math.abs(b.h - thawed) > 0.1, 'it steers again once thawed');
  a.input.use = true;
  run(r, 0.1);
  assert.equal(a.item, null, 'two throws');
});

test('a frozen kart in a bend slides round it with the road rather than straight off it', () => {
  const r = createRace({ cc: '150cc', course: 'skyway', seed: 5, countdown: 0, racers: [{ name: 'p', color: '#e53935', kind: 'player' }] });
  const [k] = r.karts;
  // the tightest bend on the Skyway, frozen on the way in
  let s0 = 0;
  for (let s = 0, worst = 0; s < r.track.length; s += 2) {
    const c = Math.abs(r.track.curv[Math.floor(s / r.track.step) % r.track.n]);
    if (c > worst) [worst, s0] = [c, s];
  }
  place(r, k, s0 - 12, 0, 22);
  assert.ok(hitKart(r, k, 'freeze', 1));
  const evs = run(r, FREEZE_T);
  assert.equal(only(evs, 'fall').length, 0, 'it never went over');
  assert.ok(k.v > 5, 'still sliding');
});

test('a piranha plant rides up front for a while, eating items and biting karts just ahead, with a boost each bite', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 10, 0, 15);
  place(r, b, 300, 0, 0);
  const banana = thing(r, 'banana', b.idx, 24);
  use(r, a, 'piranha');
  assert.ok(a.piranha > PIRANHA_T - 0.1);
  let bites = 0;
  let boosted = 0;
  const watch = (seconds: number) => {
    const evs: Ev[] = [];
    for (let n = Math.round(seconds / DT); n > 0; n--) {
      step(r, DT);
      const now = r.events.splice(0);
      if (only(now, 'chomp').some((e) => e.k === a.idx)) {
        bites++;
        if (a.boost > 0) boosted++;
      }
      evs.push(...now);
    }
    return evs;
  };
  watch(1);
  assert.ok(!r.things.includes(banana), 'the banana is eaten');
  assert.equal(a.spin, 0, 'before it can trip anyone up');
  // a kart right in front is bitten
  place(r, b, a.s + 4, a.d, a.v);
  const evs = watch(PIRANHA_GAP + 0.2);
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx && e.how === 'spin' && e.by === a.idx), 'the kart ahead is bitten');
  // with nothing in reach it still snaps at the air now and then
  place(r, b, a.s + 200, 0, 0);
  const before = bites;
  watch(3);
  assert.ok(bites - before >= 1 && bites - before <= 3, `${bites - before} snaps at nothing`);
  assert.equal(boosted, bites, 'every bite is a boost');
  watch(PIRANHA_T);
  assert.equal(a.piranha, 0);
  assert.equal(only(watch(3), 'chomp').length, 0, 'gone');
});

test('a Boo steals the item of the nearest kart ahead holding one, and makes you see-through to items and karts', () => {
  const r = race(4);
  const [a, b, c, d] = r.karts;
  place(r, c, 300, 0, 20);
  place(r, b, 200, 0, 20);
  place(r, a, 100, 0, 20);
  place(r, d, 50, 0, 20);
  rankKarts(r);
  giveItem(r, c, 'star', 0);
  giveItem(r, b, 'greens', 0);
  b.uses = 2;
  giveItem(r, d, 'blue', 0);
  const evs = use(r, a, 'boo');
  assert.ok(a.boo > BOO_T - 0.1);
  assert.deepEqual(only(evs, 'boo').map((e) => [e.k, e.by, e.item]), [[b.idx, a.idx, 'greens']], 'the next kart up the road');
  assert.ok(b.item === null && b.uses === 0, 'gone from its hands');
  assert.equal(c.item, 'star', 'not from further up');
  assert.ok(a.item === 'greens' && a.uses === 2 && a.roll > 0, 'and it is ours, after a short roll');
  run(r, ROLL_T);
  assert.equal(a.roll, 0);
  // nothing anyone throws or does touches it
  assert.equal(hitKart(r, a, 'tumble', b.idx), false);
  place(r, b, a.s + 300, 0, 0);
  const banana = thing(r, 'banana', b.idx, a.s + 8);
  const shell = thing(r, 'green', b.idx, a.s + 25, -1.5, -30);
  const hits = only(run(r, 1), 'hit');
  assert.equal(hits.length, 0, 'nothing touches it');
  assert.ok(r.things.includes(banana) && r.things.includes(shell), 'the banana and the shell pass straight through');
  // another kart drives right through it
  place(r, b, a.s, a.d + 1, a.v);
  assert.equal(only(run(r, 0.2), 'bump').length, 0);
  assert.ok(Math.hypot(a.x - b.x, a.z - b.z) < 2 * KART_R);
  // (but the course itself still bites)
  assert.equal(hitKart(r, a, 'spin', -1), true);
  // with nobody ahead holding anything, it takes from the nearest behind; with nobody at all, nothing
  const r2 = race(3);
  const [e, f, g] = r2.karts;
  place(r2, e, 300, 0, 20);
  place(r2, f, 200, 0, 20);
  place(r2, g, 100, 0, 20);
  rankKarts(r2);
  giveItem(r2, g, 'red', 0);
  use(r2, e, 'boo');
  assert.ok(e.item === 'red' && g.item === null);
  run(r2, BOO_T + 0.1);
  assert.equal(e.boo, 0);
  const r3 = race(2);
  assert.equal(only(use(r3, r3.karts[0], 'boo'), 'boo').length, 0);
  assert.equal(r3.karts[0].item, null);
});

test('a feather jumps you high over bananas, shells and mud, and a blue shell can go off underneath', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 20, 0, 20);
  place(r, b, 300, 0, 0);
  const banana = thing(r, 'banana', b.idx, 27);
  const shell = thing(r, 'green', b.idx, 32);
  mud(r, 34);
  use(r, a, 'feather');
  assert.equal(a.vy, FEATHER_V);
  giveItem(r, a, 'feather', 0);
  assert.equal(useItem(r, a), null, 'nothing to jump off in the air');
  a.input.hop = true;
  let peak = 0;
  let muddy = false;
  const evs: Ev[] = [];
  for (let n = 0; n < 1.2 / DT; n++) {
    step(r, DT);
    evs.push(...r.events.splice(0));
    peak = Math.max(peak, a.y);
    muddy ||= a.mud;
  }
  assert.ok(peak > 2.5 && peak < 3.2, `${peak.toFixed(2)} m up`);
  assert.equal(only(evs, 'hit').length, 0, 'the banana and the shell miss');
  assert.ok(r.things.includes(banana) && r.things.includes(shell) && !muddy);
  assert.ok(aheadOf(r, a, shell.x, shell.z) < 0, 'and are behind it now');
  assert.equal(a.y, 0, 'back down');
  assert.ok(only(evs, 'turbo').some((e) => e.k === a.idx), 'a trick in the air lands with a boost');
  // a blue shell going off right under a feather jump misses; on the ground it does not
  a.input.use = true;
  let missed = false;
  for (let n = 0; n < 0.6 / DT; n++) {
    step(r, DT);
    if (!missed && a.y > BLAST_CLEAR + 0.2) {
      missed = true;
      boom(r, a.x, a.z, b.idx);
      assert.equal(a.tumble, 0);
    }
  }
  assert.ok(missed);
  run(r, 1);
  boom(r, a.x, a.z, b.idx);
  assert.ok(a.tumble > 0);
});

test('a thunder cloud speeds you up and keeps you quick on the grass, then zaps you unless you bump it onto someone', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 10, -3, 20);
  place(r, b, 10, 3, 20);
  // it lands over your head as soon as the roulette stops
  giveItem(r, a, 'cloud');
  run(r, ROLL_T + 0.1);
  assert.ok(a.cloud > CLOUD_T - 0.5 && a.item === null);
  run(r, 2);
  assert.ok(a.v > CLASSES['100cc'].top + CLOUD_DV - 0.5 && a.v > b.v + 2, `${a.v.toFixed(1)} with the cloud, ${b.v.toFixed(1)} without`);
  // out on the grass
  place(r, a, 30, -EDGE + 2, a.v);
  place(r, b, 30, EDGE - 2, a.v);
  run(r, 1.2);
  assert.ok(a.offroad && b.offroad);
  assert.ok(a.v > CLASSES['100cc'].top && b.v < CLASSES['100cc'].top * 0.75, `${a.v.toFixed(1)} vs ${b.v.toFixed(1)} on the grass`);
  // nobody takes it: zap
  place(r, b, 400, 0, 0);
  giveItem(r, a, 'mushroom', 0);
  const evs = run(r, a.cloud + 0.1);
  assert.equal(only(evs, 'zap').length, 1);
  assert.ok(a.shrink > ZAP_SHRINK - 0.2 && a.item === null && a.cloud === 0, 'shrunk, and the mushroom is gone');
  assert.equal(b.shrink, 0);
  // bump it onto someone instead
  const r2 = race(2);
  const [c, d] = r2.karts;
  place(r2, c, 30, -0.8, 20);
  place(r2, d, 30, 0.8, 20);
  const passed = [...use(r2, c, 'cloud'), ...run(r2, 0.2)];
  assert.ok(only(passed, 'cloud').some((e) => e.k === d.idx && e.by === c.idx));
  assert.ok(d.cloud > 0 && c.cloud === 0);
  // the new owner can't hand it straight back
  place(r2, c, d.s, d.d + 1.2, d.v);
  run(r2, CLOUD_HOLD * 0.5);
  assert.ok(d.cloud > 0 && c.cloud === 0);
  // a cloud caught with a moment to go always leaves time to pass it on
  catchCloud(r2, c, 0.1, d.idx);
  assert.ok(c.cloud > CLOUD_HOLD + 1);
});

test('a POW block thumps three times, then everyone ahead on the ground spins and drops their item', () => {
  const r = race(5);
  const [a, b, c, d, e] = r.karts;
  place(r, b, 300, 0, 20);
  place(r, c, 260, 0, 20);
  place(r, e, 240, 0, 20);
  place(r, a, 200, 0, 20);
  place(r, d, 150, 0, 20);
  rankKarts(r);
  giveItem(r, b, 'green', 0);
  giveItem(r, c, 'mushroom', 0);
  giveItem(r, d, 'banana', 0);
  e.star = 5;
  use(r, a, 'pow');
  const evs: Ev[] = [];
  for (let n = 0; n < (POW_T + 0.2) / DT; n++) {
    // c hops just as it goes off
    if (n === Math.round((POW_T - 0.12) / DT)) c.input.hop = true;
    step(r, DT);
    evs.push(...r.events.splice(0));
  }
  assert.deepEqual(only(evs, 'thump').map((x) => x.n), [1, 2, 3]);
  assert.equal(only(evs, 'quake').length, 1);
  const kinds = evs.map((x) => x.t);
  assert.ok(kinds.indexOf('quake') > kinds.lastIndexOf('thump'), 'the thumps come first');
  assert.deepEqual([...new Set(only(evs, 'hit').map((x) => x.k))], [b.idx], 'only the kart ahead on the ground');
  assert.ok(b.spin > 0 && b.item === null, 'it spins and drops its shell');
  assert.equal(c.item, 'mushroom', 'the hop got over it');
  assert.equal(d.item, 'banana', 'behind the block is safe');
  assert.equal(r.pows.length, 0);
});

test('the batch shows on other screens and travels online, and older packets still read', () => {
  const k = race(1).karts[0];
  k.boo = 2;
  k.cloud = 3;
  k.frozen = 1;
  k.piranha = 4;
  const f = flagsOf(k);
  const fresh = F_BOO | F_CLOUD | F_FROZEN | F_PIRANHA;
  assert.equal(f & fresh, fresh);
  const copy = race(1).karts[0];
  applyFlags(copy, f);
  assert.ok(copy.boo > 0 && copy.cloud > 0 && copy.frozen > 0 && copy.piranha > 0);
  applyFlags(copy, f & ~fresh);
  assert.ok(copy.boo === 0 && copy.cloud === 0 && copy.frozen === 0 && copy.piranha === 0);
  // the item in hand goes too (once the roulette has stopped), every one of them
  for (const item of ITEMS) {
    giveItem(race(1), k, item, 0);
    applyFlags(copy, flagsOf(k));
    assert.equal(copy.item, item);
  }
  giveItem(race(1), k, 'star');
  applyFlags(copy, flagsOf(k));
  assert.equal(copy.item, null, 'not while it is still rolling');
  const spawnOf = (kind: string) => ({ y: 'spawn', id: 1000002, kind, x: 1, z: 2, vx: 3, vz: 4, vy: 3, yy: 0.6, tg: -1, pg: 0, gr: 0.6 });
  const p = parsePacket(JSON.parse(JSON.stringify(events(3, 1, [{ y: 'cloud', to: 2, left: 5.5 }, { y: 'pow', at: 12.3 }, { y: 'boo', to: 4 }, ...(['boomerang', 'fire', 'ice'].map(spawnOf) as never[])]))));
  assert.ok(p && p.k === 'e');
  assert.deepEqual(p.ev.map((e) => e.y), ['cloud', 'pow', 'boo', 'spawn', 'spawn', 'spawn']);
  assert.deepEqual(p.ev.slice(0, 3), [{ y: 'cloud', to: 2, left: 5.5 }, { y: 'pow', at: 12.3 }, { y: 'boo', to: 4 }]);
  const junk = parsePacket(events(3, 1, [{ y: 'cloud', to: 99, left: 2 }, { y: 'cloud', to: 1, left: 'x' }, { y: 'pow' }, { y: 'boo', to: -1 }, spawnOf('piano')] as never[]));
  assert.ok(junk && junk.k === 'e' && junk.ev.length === 0);
  const long = parsePacket(events(3, 1, [{ y: 'cloud', to: 1, left: 999 }]));
  assert.deepEqual(long && long.k === 'e' && long.ev[0], { y: 'cloud', to: 1, left: CLOUD_T });
  // a packet from before this batch still reads the same
  const old = parsePacket({ t: 'pk', r: 3, k: 'e', o: 1, ev: [{ y: 'ink' }, spawnOf('green')] });
  assert.ok(old && old.k === 'e' && old.ev.length === 2);
});

/** Two clients' copies of one race: on each, its own kart is the player and the other one is remote. */
function pair() {
  const racer = (seat: number, mine: boolean): Racer => ({ name: `p${seat}`, color: '#e53935', kind: mine ? 'player' : 'remote', seat });
  const one = createRace({ cc: '100cc', seed: 5, countdown: 0, racers: [racer(0, true), racer(1, false)], me: 0 });
  const two = createRace({ cc: '100cc', seed: 5, countdown: 0, racers: [racer(0, false), racer(1, true)], me: 1 });
  return { one, two };
}

/** The other client's view of kart k on client `from`, as its packets would show it. */
function mirror(from: Race, to: Race, idx: number) {
  const k = from.karts[idx];
  const o = to.karts[idx];
  Object.assign(o, { x: k.x, z: k.z, h: k.h, v: k.v, i: k.i, s: k.s, d: k.d, prog: k.prog, y: k.y });
  applyFlags(o, flagsOf(k));
}

test('online, a thunder cloud is passed by the client that has it and taken on by the one that gets it', () => {
  const { one, two } = pair();
  // client one bumps its cloud onto the other player's kart
  place(one, one.karts[0], 30, -0.8, 20);
  place(one, one.karts[1], 30, 0.8, 20);
  const sent = only([...use(one, one.karts[0], 'cloud'), ...run(one, 0.1)], 'cloud');
  assert.equal(sent.length, 1);
  assert.ok(sent[0].k === 1 && sent[0].by === 0 && one.karts[0].cloud === 0);
  // on client two the other kart shows a cloud, but only its own client can pass it on
  place(two, two.karts[0], 30, -0.8, 20);
  place(two, two.karts[1], 30, 0.8, 20);
  applyFlags(two.karts[0], F_CLOUD);
  run(two, 0.1);
  assert.equal(two.karts[1].cloud, 0);
  // then the pass arrives (net 'cloud' round trip)
  const p = parsePacket(JSON.parse(JSON.stringify(events(1, 0, [{ y: 'cloud', to: 1, left: sent[0].left }]))));
  assert.ok(p && p.k === 'e' && p.ev[0].y === 'cloud');
  catchCloud(two, two.karts[1], p.ev[0].left, 0);
  assert.ok(two.karts[1].cloud > 0 && (flagsOf(two.karts[1]) & F_CLOUD) !== 0);
});

test('online, a Boo takes the item another player holds, and their client lets go of it', () => {
  const { one, two } = pair();
  // client two's player holds a red shell, up the road from client one's
  place(two, two.karts[1], 200, 0, 20);
  place(two, two.karts[0], 100, 0, 20);
  giveItem(two, two.karts[1], 'red', 0);
  place(one, one.karts[0], 100, 0, 20);
  mirror(two, one, 1);
  rankKarts(one);
  assert.equal(one.karts[1].item, 'red', 'what it holds shows from its flags');
  const evs = use(one, one.karts[0], 'boo');
  const took = only(evs, 'boo');
  assert.deepEqual(took.map((e) => [e.k, e.by, e.item]), [[1, 0, 'red']]);
  assert.equal(one.karts[0].item, 'red');
  // the 'boo' goes to its client, which lets go of the shell
  const p = parsePacket(JSON.parse(JSON.stringify(events(1, 0, [{ y: 'boo', to: 1 }]))));
  assert.ok(p && p.k === 'e' && p.ev[0].y === 'boo' && p.ev[0].to === 1);
  robbed(two, two.karts[1]);
  assert.equal(two.karts[1].item, null);
  // and our see-through kart shows that way there
  mirror(one, two, 0);
  assert.ok(two.karts[0].boo > 0);
});

test("online, a POW block goes off on every screen, and someone else's piranha plant bites the kart you drive", () => {
  const { one, two } = pair();
  // client two hears about a POW block a moment late
  place(two, two.karts[0], 100, 0, 20);
  place(two, two.karts[1], 200, 0, 20);
  rankKarts(two);
  two.time = 30;
  const p = parsePacket(JSON.parse(JSON.stringify(events(1, 0, [{ y: 'pow', at: 29 }]))));
  assert.ok(p && p.k === 'e' && p.ev[0].y === 'pow');
  powFrom(two, 0, p.ev[0].at);
  powFrom(two, 0, p.ev[0].at);
  assert.equal(two.pows.length, 1, 'once');
  const evs = run(two, POW_T - POW_GAP + 0.1);
  assert.equal(only(evs, 'quake').length, 1, 'it still goes off, a little sooner');
  assert.ok(only(evs, 'hit').some((e) => e.k === 1 && e.by === 0));
  // a plant on the other kart (known only from its flags) bites ours
  place(one, one.karts[1], 400, 0, 0);
  place(one, one.karts[0], 404, 0, 0);
  applyFlags(one.karts[1], F_PIRANHA);
  const bites = run(one, 0.2);
  assert.ok(only(bites, 'chomp').some((e) => e.k === 1));
  assert.ok(only(bites, 'hit').some((e) => e.k === 0 && e.by === 1), 'our kart spins');
  // but items are for its owner's client to eat
  place(one, one.karts[0], 600, 0, 0);
  const banana = thing(one, 'banana', 0, one.karts[1].s + 3);
  run(one, PIRANHA_GAP * 2.5);
  assert.ok(one.things.includes(banana));
});

test('CPU drivers use the batch: plants bite, clouds get passed on and go off, POW blocks go off, and everyone finishes', () => {
  const used = new Set<Item>();
  const seen = new Set<Ev['t']>();
  for (const [course, seed] of [['palm', 31], ['palm', 32], ['lake', 33], ['stadium', 34]] as const) {
    const r = createRace({ cc: '150cc', course, seed, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
    let widest = 0;
    while (r.time < 600 && r.karts.some((k) => k.done === null)) {
      step(r, DT);
      for (const e of r.events.splice(0)) {
        if (e.t === 'use') used.add(e.item);
        seen.add(e.t);
      }
      for (const k of r.karts) widest = Math.max(widest, Math.abs(k.d));
    }
    assert.ok(r.karts.every((k) => k.done !== null), `everyone finished (${course} ${seed})`);
    assert.ok(widest <= EDGE, `a kart got ${widest} from the line`);
  }
  const third = BATCH.filter((i) => used.has(i));
  assert.ok(third.length >= 7, `batch used: ${third.join(' ')}`);
  for (const t of ['chomp', 'cloud', 'zap', 'boo'] as const) assert.ok(seen.has(t), `no ${t}`);
});
