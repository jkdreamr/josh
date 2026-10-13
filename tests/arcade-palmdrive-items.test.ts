import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BOMB_LIFE,
  BULLET_DV,
  BULLET_T,
  CLASSES,
  GOLD_T,
  HORN_R,
  INK_T,
  ITEMS,
  MAX_COINS,
  MEGA_T,
  RIVALS,
  createRace,
  giveItem,
  hitKart,
  rankKarts,
  rollItem,
  spawn,
  step,
  trailable,
  useItem,
  type Ev,
  type Item,
  type Kart,
  type Race,
} from '../src/os/arcade/games/palmdrive/logic.ts';
import { F_BULLET, F_INK, F_MEGA, applyFlags, events, flagsOf, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';
import { EDGE, headingOf, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

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

test('every item can turn up from the boxes, and the big ones only further back', () => {
  const r = race(8);
  r.karts.forEach((k, i) => (k.prog = 100 - i * 10));
  rankKarts(r);
  const seen = new Map<number, Set<Item>>();
  for (const k of r.karts) {
    const got = new Set<Item>();
    for (let n = 0; n < 3000; n++) got.add(rollItem(r, k));
    seen.set(k.place, got);
  }
  const all = new Set([...seen.values()].flatMap((s) => [...s]));
  assert.deepEqual([...all].sort(), [...ITEMS].sort(), 'every item turns up somewhere');
  for (const big of ['bullet', 'star', 'mega', 'golden', 'blue', 'bolt'] as Item[]) assert.ok(!seen.get(1)!.has(big), `no ${big} in first`);
  for (const small of ['banana', 'green', 'coin'] as Item[]) assert.ok(!seen.get(8)!.has(small), `no ${small} in last`);
});

test('triple bananas and triple greens give three goes and can be held out behind', () => {
  const r = race(1);
  const k = r.karts[0];
  place(r, k, 30, 0, 15);
  for (const item of ['bananas', 'greens'] as Item[]) {
    giveItem(r, k, item, 0);
    assert.equal(k.uses, 3);
    assert.ok(trailable(item));
    const spawned: Ev[] = [];
    for (let n = 0; n < 4; n++) {
      k.input.use = true;
      spawned.push(...run(r, 0.2));
    }
    assert.equal(k.item, null);
    const kind = item === 'bananas' ? 'banana' : 'green';
    assert.equal(only(spawned, 'spawn').filter((e) => e.thing.kind === kind).length, 3, `${item}: three, then nothing`);
  }
  // held out behind, three bananas look like a banana to everyone else
  giveItem(r, k, 'bananas', 0);
  k.input.hold = true;
  run(r, 0.1);
  assert.ok(k.trail);
  const copy = race(1).karts[0];
  applyFlags(copy, flagsOf(k));
  assert.ok(copy.trail && copy.item === 'banana');
});

test('a bomb is lobbed up the road, sits, and blows up karts nearby when its fuse runs out', () => {
  const r = race(3);
  const [a, b, c] = r.karts;
  place(r, a, 30, -4, 0);
  place(r, b, 300, 0, 0);
  place(r, c, 600, 0, 0);
  use(r, a, 'bomb');
  const bomb = r.things.find((t) => t.kind === 'bomb')!;
  assert.ok(bomb && bomb.y > 0, 'thrown in an arc');
  run(r, 1);
  assert.equal(bomb.y, 0, 'it lands');
  const ahead = locate(r.track, bomb.x, bomb.z).s - 30;
  assert.ok(ahead > 12, `it lands well ahead (${ahead} m)`);
  // put a kart next to where it will go off, just outside the trigger range
  place(r, b, locate(r.track, bomb.x, bomb.z).s + 4.5, locate(r.track, bomb.x, bomb.z).d, 0);
  const evs = run(r, BOMB_LIFE);
  assert.equal(only(evs, 'boom').length, 1, 'one explosion');
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx && e.how === 'boom'), 'the kart beside it is blown up');
  assert.ok(!only(evs, 'hit').some((e) => e.k === c.idx), 'karts far away are fine');
  assert.ok(!r.things.some((t) => t.kind === 'bomb'));
});

test('a bomb goes off as soon as a kart rolls up to it, and only its thrower sets it off online', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 30, 0, 0);
  use(r, a, 'bomb', { back: true });
  const bomb = r.things.find((t) => t.kind === 'bomb')!;
  assert.equal(bomb.y, 0, 'dropped behind');
  run(r, 1.5);
  const at = locate(r.track, bomb.x, bomb.z);
  place(r, b, at.s - 8, at.d, 12);
  const evs = run(r, 1);
  assert.equal(only(evs, 'boom').length, 1);
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx));
  // someone else's bomb waits for its owner's word, then is cleared away if that never comes
  const r2 = race(2);
  place(r2, r2.karts[1], 80, 0, 0);
  spawn(r2, { kind: 'bomb', owner: 0, x: r2.karts[1].x, z: r2.karts[1].z + 0.5, y: 0, vx: 0, vz: 0, vy: 0, grace: 0, target: -1, prog: 0 }, false);
  const evs2 = run(r2, BOMB_LIFE + 0.5);
  assert.equal(only(evs2, 'boom').length, 0);
  assert.equal(r2.things.length, 1);
  run(r2, 2);
  assert.equal(r2.things.length, 0);
});

test('a golden mushroom boosts as often as you press until its time is up', () => {
  const r = race(1);
  const k = r.karts[0];
  place(r, k, 20, 0, 10);
  let boosts = 0;
  giveItem(r, k, 'golden', 0);
  for (let t = 0; t < GOLD_T + 1; t += 0.5) {
    k.input.use = true;
    boosts += only(run(r, 0.5), 'use').length;
  }
  assert.ok(boosts >= GOLD_T * 2 - 2, `${boosts} boosts`);
  assert.equal(k.item, null, 'gone when the time is up');
  assert.equal(k.goldT, 0);
});

test('a coin item drops two coins in your pocket', () => {
  const r = race(1);
  const k = r.karts[0];
  k.coins = 3;
  const evs = use(r, k, 'coin');
  assert.equal(k.coins, 5);
  assert.equal(k.earned, 2);
  assert.equal(only(evs, 'coin').length, 1);
  k.coins = MAX_COINS - 1;
  use(r, k, 'coin');
  assert.equal(k.coins, MAX_COINS);
});

test('a mega mushroom makes you big, quicker and hard to stop, and flattens karts you touch', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 30, -2, CLASSES['100cc'].top);
  place(r, b, 34, -2, 5);
  use(r, a, 'mega');
  assert.equal(a.mega > MEGA_T - 0.1, true);
  assert.equal(hitKart(r, a, 'spin', b.idx), false, 'bananas and shells bounce off');
  const evs = run(r, 1);
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx && e.how === 'squash'), 'the kart in the way is flattened');
  assert.ok(a.v > CLASSES['100cc'].top, 'a little quicker');
  // an explosion still gets through, and shrinks it back
  assert.equal(hitKart(r, a, 'boom', b.idx), true);
  assert.equal(a.mega, 0);
});

test('a bullet flies you down the middle of the road at speed, through the bends, bowling karts over', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 520, 4, 10);
  a.input.steer = 1; // the player's steering does nothing in a bullet
  use(r, a, 'bullet');
  let widest = 0;
  let fastest = 0;
  const evs: Ev[] = [];
  for (let t = 0; t < BULLET_T - 0.1; t += DT) {
    if (t > 1 && t < 1.1) place(r, b, a.s + 6, a.d, 2);
    step(r, DT);
    evs.push(...r.events.splice(0));
    widest = Math.max(widest, Math.abs(a.d));
    fastest = Math.max(fastest, a.v);
  }
  assert.ok(fastest > CLASSES['100cc'].top + BULLET_DV - 1, `top speed ${fastest}`);
  assert.ok(widest < EDGE - 1.5, `stays off the walls (${widest})`);
  assert.equal(only(evs, 'wall').filter((e) => e.k === a.idx).length, 0);
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx && e.how === 'tumble'), 'the kart in the way goes flying');
  assert.equal(hitKart(r, a, 'tumble', b.idx), false, 'nothing touches a bullet');
  run(r, 0.3);
  assert.equal(a.bullet, 0);
  assert.ok(a.boost > 0, 'it hands back with a little boost');
});

test('ink splatters everyone ahead of you but nobody behind, and stars stay clean', () => {
  const r = race(4);
  r.karts.forEach((k, i) => place(r, k, 300 - i * 40, 0, 0));
  rankKarts(r);
  const [first, second, third, last] = r.karts;
  second.star = 5;
  const evs = use(r, third, 'ink');
  assert.equal(first.ink > INK_T - 0.1, true);
  assert.equal(second.ink, 0, 'the star shrugs it off');
  assert.equal(third.ink, 0);
  assert.equal(last.ink, 0, 'nobody behind');
  assert.deepEqual(only(evs, 'inked').map((e) => e.k), [first.idx]);
  assert.equal(only(evs, 'ink').length, 1, 'one event goes online');
});

test('the horn knocks over karts close by and wipes out items, blue shells included', () => {
  const r = race(3);
  const [a, b, c] = r.karts;
  place(r, a, 100, 0, 10);
  place(r, b, 106, 2, 10);
  place(r, c, 100 + HORN_R + 15, 0, 10);
  spawn(r, { kind: 'blue', owner: c.idx, x: a.x + 3, z: a.z, y: 3, vx: 0, vz: 0, vy: 0, grace: 0, target: a.idx, prog: a.prog });
  spawn(r, { kind: 'banana', owner: c.idx, x: a.x - 2, z: a.z, y: 0, vx: 0, vz: 0, vy: 0, grace: 0, target: -1, prog: 0 });
  r.events.length = 0;
  const evs = use(r, a, 'horn');
  assert.ok(only(evs, 'hit').some((e) => e.k === b.idx && e.how === 'tumble'));
  assert.ok(!only(evs, 'hit').some((e) => e.k === a.idx || e.k === c.idx));
  assert.equal(r.things.length, 0, 'the blue shell and the banana are gone');
  assert.equal(only(evs, 'horn').length, 1);
  assert.equal(only(evs, 'blast').length, 1);
});

test('mega, bullet and ink show on other screens, and ink, horn and bombs travel online', () => {
  const r = race(1);
  const k = r.karts[0];
  k.mega = 2;
  k.bullet = 1;
  k.ink = 3;
  const f = flagsOf(k);
  assert.equal(f & (F_MEGA | F_BULLET | F_INK), F_MEGA | F_BULLET | F_INK);
  const copy = race(1).karts[0];
  applyFlags(copy, f);
  assert.ok(copy.mega > 0 && copy.bullet > 0 && copy.ink > 0);
  applyFlags(copy, 0);
  assert.ok(copy.mega === 0 && copy.bullet === 0 && copy.ink === 0);
  const p = parsePacket(JSON.parse(JSON.stringify(events(3, 1, [{ y: 'ink' }, { y: 'horn', x: 4, z: -2 }, { y: 'spawn', id: 1000001, kind: 'bomb', x: 1, z: 2, vx: 3, vz: 4, vy: 8, yy: 1, tg: -1, pg: 0, gr: 0.8 }]))));
  assert.ok(p && p.k === 'e');
  assert.deepEqual(p.ev.map((e) => e.y), ['ink', 'horn', 'spawn']);
  assert.equal(parsePacket(events(3, 1, [{ y: 'horn', x: 'no' } as never]))!.k === 'e' && (parsePacket(events(3, 1, [{ y: 'horn', x: 'no' } as never])) as { ev: unknown[] }).ev.length, 0);
});

test('CPU drivers use the new items and nobody leaves the track', () => {
  const used = new Set<Item>();
  for (const seed of [31, 32]) {
    const r = createRace({ cc: '150cc', seed, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
    let widest = 0;
    while (r.time < 600 && r.karts.some((k) => k.done === null)) {
      step(r, DT);
      for (const e of r.events.splice(0)) if (e.t === 'use') used.add(e.item);
      for (const k of r.karts) widest = Math.max(widest, Math.abs(k.d));
    }
    assert.ok(r.karts.every((k) => k.done !== null), `everyone finished (seed ${seed})`);
    assert.ok(widest <= EDGE, `a kart got ${widest} from the line`);
  }
  const fresh = ['bananas', 'greens', 'bomb', 'golden', 'coin', 'mega', 'bullet', 'ink', 'horn'].filter((i) => used.has(i as Item));
  assert.ok(fresh.length >= 6, `new items used: ${fresh.join(' ')}`);
});

test('a CPU out in front saves its horn for the blue shell coming for it', () => {
  const r = createRace({ cc: '100cc', seed: 5, countdown: 0, racers: [RIVALS[0], { name: 'p', color: '#e53935', kind: 'player' }] });
  const [cpu, me] = r.karts;
  place(r, cpu, 300, 0, 20);
  place(r, me, 120, 0, 0);
  giveItem(r, cpu, 'horn', 0);
  // nothing to honk at yet
  run(r, 1);
  assert.equal(cpu.item, 'horn');
  const p = pointAt(r.track, cpu.s - 20, 0);
  spawn(r, { kind: 'blue', owner: me.idx, x: p.x, z: p.z, y: 3, vx: 0, vz: 0, vy: 0, grace: 0, target: -1, prog: cpu.prog - 20 });
  const evs = run(r, 1.5);
  assert.ok(evs.some((e) => e.t === 'use' && e.k === cpu.idx && e.item === 'horn'), 'honked');
  assert.ok(!evs.some((e) => e.t === 'boom'), 'the blue shell never went off');
  assert.equal(cpu.tumble, 0);
});
