import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  BALLOONS,
  CAR_W,
  COIN_TOP,
  COUNTDOWN,
  GAP_TIME,
  LANES,
  LANE_TIME,
  LANE_W,
  MAX_COINS,
  MAX_SPEED,
  MIN_SPEED,
  ROLL_T,
  SAFE_T,
  baseSpeed,
  create,
  createCourse,
  extend,
  gapFor,
  gas,
  hitHalf,
  hits,
  kmh,
  laneX,
  ordinal,
  placeOf,
  reach,
  score,
  steer,
  step,
  topSpeed,
  fireItem,
  zOf,
  type Obstacle,
  type State,
} from '../src/os/arcade/games/palmdrive/logic.ts';
import { F_BOOST, F_OUT, F_STAR, fallbackSeed, guestPacket, hostPacket, parseNet, predict } from '../src/os/arcade/games/palmdrive/net.ts';

const seeded = (seed: number) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

/** A state already past the countdown with an empty road ahead. */
function open(seed = 1): State {
  const s = create(seed, 0);
  s.course.obstacles = [];
  s.course.pickups = [];
  s.course.last = { m: 1e9, h: 0, open: [0, 1, 2] };
  s.speed = MIN_SPEED;
  return s;
}

const car = (lane: number, m: number, id = 1): Obstacle => ({ id, kind: 'car', lane, m, hue: 0 });

test('lanes are centered on the road', () => {
  assert.equal(laneX(1), 0);
  assert.equal(laneX(0), -LANE_W);
  assert.equal(laneX(LANES - 1), LANE_W);
});

test('the countdown holds the kart, then GO lets it drive', () => {
  const s = create(3);
  assert.equal(s.time, -COUNTDOWN);
  steer(s, 1);
  assert.equal(s.lane, 1, 'no steering before GO');
  const beeps: number[] = [];
  let went = false;
  for (let i = 0; i < 70; i++) {
    const ev = step(s, 0.05);
    if (ev.beep) beeps.push(ev.beep);
    if (ev.go) went = true;
  }
  assert.deepEqual(beeps, [2, 1]);
  assert.ok(went);
  assert.ok(s.dist > 0);
  steer(s, 1);
  assert.equal(s.lane, 2);
});

test('gas right before GO is a rocket start, early gas is not', () => {
  const good = create(4, 1);
  step(good, 0.7);
  gas(good);
  assert.ok(step(good, 0.4).rocket);
  assert.ok(good.boost > 0);
  const early = create(4, 1);
  gas(early);
  step(early, 0.7);
  assert.ok(!step(early, 0.4).rocket);
});

test('steering clamps to the outer lanes and the kart eases over', () => {
  const s = open();
  steer(s, -1);
  steer(s, -1);
  assert.equal(s.lane, 0);
  for (let i = 0; i < 5; i++) steer(s, 1);
  assert.equal(s.lane, LANES - 1);
  for (let i = 0; i < 60; i++) step(s, 1 / 60);
  assert.ok(Math.abs(s.x - laneX(2)) < 0.05);
  assert.equal(score(s), Math.floor(s.dist));
  assert.equal(kmh(s), Math.round(s.speed * 3.6));
});

test('base speed follows distance up to MAX_SPEED and coins raise the top end', () => {
  assert.equal(baseSpeed(0), MIN_SPEED);
  assert.equal(baseSpeed(1e6), MAX_SPEED);
  const s = open();
  s.dist = 5000;
  for (let i = 0; i < 400; i++) step(s, 1 / 20);
  assert.ok(Math.abs(s.speed - MAX_SPEED) < 1e-9);
  s.coins = MAX_COINS;
  for (let i = 0; i < 100; i++) step(s, 1 / 20);
  assert.ok(Math.abs(s.speed - (MAX_SPEED + MAX_COINS * COIN_TOP)) < 1e-9);
  assert.ok(gapFor(0) > gapFor(5000));
});

test('the same seed builds the same course, another seed does not', () => {
  const a = createCourse(42);
  const b = createCourse(42);
  const c = createCourse(43);
  for (const k of [a, b, c]) extend(k, 3000);
  const sig = (k: typeof a) => JSON.stringify([k.rows, k.obstacles, k.pickups]);
  assert.equal(sig(a), sig(b));
  assert.notEqual(sig(a), sig(c));
});

test('every row leaves a lane open and room to reach it at top speed', () => {
  for (let seed = 1; seed <= 40; seed++) {
    const c = createCourse(seed * 7919);
    extend(c, 12_000);
    let prev = { m: 0, h: 0, open: [0, 1, 2] };
    for (const row of c.rows) {
      const here = c.obstacles.filter((o) => Math.abs(o.m - row.m) <= 1);
      assert.ok(row.open.length >= 1 && row.open.length < LANES, `seed ${seed}: a row blocks 1 or 2 lanes`);
      assert.equal(new Set(here.map((o) => o.lane)).size, here.length, 'no two obstacles in one lane');
      for (const o of here) {
        assert.ok(!row.open.includes(o.lane));
        assert.ok(Math.abs(o.m - row.m) + hitHalf(o.kind) <= row.h + 1e-9);
      }
      const free = row.m - row.h - (prev.m + prev.h);
      const need = topSpeed(row.m) * (GAP_TIME + LANE_TIME * reach(prev.open, row.open));
      assert.ok(free >= need - 1e-9, `seed ${seed}: row at ${row.m.toFixed(1)} has ${free.toFixed(1)} m free, needs ${need.toFixed(1)}`);
      prev = row;
    }
    for (const p of c.pickups) {
      for (const row of c.rows) assert.ok(Math.abs(p.m - row.m) > row.h, 'pickups never sit inside a hazard row');
    }
  }
});

test('a bot driving flat out with every coin and a mushroom never gets hit', () => {
  for (const dt of [1 / 60, 1 / 20]) {
    for (let seed = 1; seed <= 12; seed++) {
      const s = create(seed * 104729, 0, seed % LANES);
      while (s.dist < 8000) {
        s.coins = MAX_COINS;
        s.boost = 1;
        const row = s.course.rows.find((r) => r.m + r.h >= s.dist);
        if (row && s.dist < row.m - row.h) {
          const target = row.open.reduce((a, b) => (Math.abs(b - s.lane) < Math.abs(a - s.lane) ? b : a));
          for (let k = 0; k < 2 && s.lane !== target; k++) steer(s, target > s.lane ? 1 : -1);
        }
        step(s, dt, seeded(seed));
        assert.equal(s.balloons, BALLOONS, `seed ${seed} dt ${dt.toFixed(3)}: hit at ${s.dist.toFixed(1)} m`);
      }
      assert.ok(s.speed > MAX_SPEED + 10);
    }
  }
});

test('oncoming cars close faster than cones but both meet you at their mark', () => {
  const carO = car(0, 100);
  const cone: Obstacle = { id: 2, kind: 'cone', lane: 2, m: 100, hue: 0 };
  assert.ok(zOf(carO, 50) > zOf(cone, 50));
  assert.equal(zOf(carO, 100), 0);
  assert.equal(zOf(cone, 100), 0);
});

test('hits only count in your lane while the obstacle is alongside', () => {
  const o = car(1, 10);
  assert.ok(hits(0, o, 9.5));
  assert.ok(!hits(laneX(0), o, 9.5));
  assert.ok(!hits(0, o, -50));
  assert.ok(hits(0, o, 5, 15), 'a fast frame still catches it');
  const cone: Obstacle = { id: 2, kind: 'cone', lane: 1, m: 1, hue: 0 };
  assert.ok(hits(0, cone, 1));
  assert.ok(!hits(CAR_W / 2 + 0.5, cone, 1));
});

test('a hit pops a balloon, spins you out and drops coins; the third one ends the run', () => {
  const s = open();
  s.coins = 5;
  s.course.obstacles = [car(1, 6, 9)];
  let ev = step(s, 0.05);
  for (let i = 0; i < 40 && !ev.hit; i++) ev = step(s, 1 / 30);
  assert.equal(ev.hit?.id, 9);
  assert.equal(s.balloons, BALLOONS - 1);
  assert.equal(s.coins, 2);
  assert.ok(s.spin > 0 && s.safe > 0);
  steer(s, 1);
  assert.equal(s.lane, 1, 'no steering while spinning');

  // invulnerable right after a hit
  s.course.obstacles = [car(1, s.dist + 1, 10)];
  assert.equal(step(s, 1 / 30).hit, null);
  for (let t = 0; t < SAFE_T + 0.1; t += 0.05) step(s, 0.05);

  for (let n = 0; n < 2; n++) {
    s.safe = 0;
    s.course.obstacles = [car(1, s.dist + 1, 20 + n)];
    ev = step(s, 1 / 30);
    assert.ok(ev.hit);
  }
  assert.equal(s.balloons, 0);
  assert.ok(s.out && ev.out);
  const d = s.dist;
  step(s, 1);
  steer(s, -1);
  assert.equal(s.dist, d);
  assert.equal(s.lane, 1);
});

test('coins add up to ten and item boxes roll an item you can use', () => {
  const s = open();
  s.course.pickups = Array.from({ length: 14 }, (_, i) => ({ id: i + 1, kind: 'coin' as const, lane: 1, m: 3 + i * 3 }));
  let got = 0;
  for (let i = 0; i < 120; i++) got += step(s, 1 / 60).coins;
  assert.ok(got >= 10);
  assert.equal(s.coins, MAX_COINS);

  s.course.pickups = [{ id: 99, kind: 'box', lane: 1, m: s.dist + 2 }];
  let ev = step(s, 1 / 10, () => 0.5);
  assert.ok(ev.box);
  assert.equal(s.item, 'mushroom');
  assert.equal(fireItem(s), null, 'the roulette has to stop first');
  let seen = null;
  for (let t = 0; t < ROLL_T + 0.1; t += 0.05) {
    ev = step(s, 0.05);
    seen ??= ev.got;
  }
  assert.equal(seen, 'mushroom');
  assert.equal(fireItem(s), 'mushroom');
  assert.equal(s.item, null);
  assert.ok(s.boost > 0);
  const slow = s.speed;
  step(s, 0.2);
  assert.ok(s.speed > slow);
});

test('a star smashes through traffic without popping balloons', () => {
  const s = open();
  s.item = 'star';
  assert.equal(fireItem(s), 'star');
  s.course.obstacles = [car(1, s.dist + 1, 5)];
  const ev = step(s, 1 / 30);
  assert.equal(ev.smash[0]?.id, 5);
  assert.equal(ev.hit, null);
  assert.equal(s.balloons, BALLOONS);
});

test('a green shell knocks out the first obstacle in its lane', () => {
  const s = open();
  s.course.obstacles = [car(1, 60, 1), car(1, 40, 2), car(0, 30, 3)];
  s.item = 'shell';
  assert.equal(fireItem(s), 'shell');
  const smashed: number[] = [];
  for (let i = 0; i < 60 && !smashed.length; i++) smashed.push(...step(s, 1 / 60).smash.map((o) => o.id));
  assert.deepEqual(smashed, [2]);
  assert.equal(s.shells.length, 0);
  assert.equal(s.course.obstacles.find((o) => o.id === 3)?.hitAt, undefined);
});

test('dash pads boost and passed things are dropped', () => {
  const s = open();
  s.course.pickups = [{ id: 1, kind: 'dash', lane: 1, m: 2 }];
  const ev = step(s, 0.1);
  assert.ok(ev.dash && s.boost > 0);
  s.course.obstacles = [{ id: 1, kind: 'cone', lane: 0, m: s.dist - 29.9, hue: 0 }];
  step(s, 0.1);
  assert.equal(s.course.obstacles.length, 0);
});

test('places and ordinals', () => {
  assert.equal(placeOf(100, [50, 200, 300]), 3);
  assert.equal(placeOf(100, [100]), 1);
  assert.deepEqual([1, 2, 3, 4, 11, 12, 13, 21, 22].map(ordinal), ['1st', '2nd', '3rd', '4th', '11th', '12th', '13th', '21st', '22nd']);
});

test('online packets round-trip and junk is ignored', () => {
  const host = parseNet(JSON.parse(JSON.stringify(hostPacket(3, 123456, 2.345, [{ seat: 0, d: 10.04, x: -2.3, v: 20.06, f: F_STAR }, { seat: 5, d: 99, x: 0, v: 0, f: F_OUT }]))));
  assert.deepEqual(host, { kind: 'host', round: 3, seed: 123456, go: 2.35, racers: [{ seat: 0, d: 10, x: -2.3, v: 20.1, f: F_STAR }, { seat: 5, d: 99, x: 0, v: 0, f: F_OUT }] });
  const guest = parseNet(guestPacket(3, { d: 50.55, x: 2.3, v: 30, f: F_BOOST | (2 << 4) }));
  assert.deepEqual(guest, { kind: 'guest', round: 3, racer: { d: 50.6, x: 2.3, v: 30, f: F_BOOST | (2 << 4) } });
  for (const junk of [null, 1, 'pd', { t: 'race', round: 1, score: 3 }, { t: 'pd', r: 1 }, { t: 'pd', r: 1, d: 'x', x: 0, v: 0, f: 0 }, { t: 'pd', r: 1, seed: -1, go: 0, cars: [] }]) {
    assert.equal(parseNet(junk), null, JSON.stringify(junk));
  }
  const bad = parseNet({ t: 'pd', r: 1, seed: 1, go: 0, cars: [[99, 1, 1, 1, 0], ['a', 1, 1, 1, 0], [2, 1, 1, 1, 0]] });
  assert.deepEqual(bad && bad.kind === 'host' && bad.racers.map((r) => r.seat), [2]);
});

test('ghosts move forward at their last speed for a moment, out racers stay put', () => {
  assert.equal(predict({ seat: 1, d: 100, x: 0, v: 40, f: 0 }, 250), 110);
  assert.equal(predict({ seat: 1, d: 100, x: 0, v: 40, f: 0 }, 5000), 120);
  assert.equal(predict({ seat: 1, d: 100, x: 0, v: 40, f: F_OUT }, 250), 100);
  assert.equal(fallbackSeed(4), fallbackSeed(4));
  assert.notEqual(fallbackSeed(4), fallbackSeed(5));
});
