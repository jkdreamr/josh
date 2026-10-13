import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EDGE, LANDMARKS, ROAD_HALF, buildTrack, deltaS, gridSpot, headingOf, layout, locate, pointAt } from '../src/os/arcade/games/palmdrive/track.ts';
import {
  BOOST_DV,
  CASH_COST,
  CASH_T,
  CCS,
  CLASSES,
  COUNTDOWN,
  LAPS,
  MAX_COINS,
  OFFROAD,
  RIVALS,
  ROLL_T,
  TURBO_AT,
  TURBO_T,
  coinTop,
  createRace,
  fmtTime,
  giveItem,
  hitKart,
  isCc,
  lapOf,
  ordinal,
  pressGas,
  rankKarts,
  rollItem,
  soloRace,
  standings,
  step,
  useItem,
  type Cc,
  type Ev,
  type Kart,
  type Race,
  type Racer,
} from '../src/os/arcade/games/palmdrive/logic.ts';
import { F_DRAFT, F_SLAM, F_STAR, F_TRICK, F_WOBBLE, applyFlags, carOf, configOf, endOf, events, finishOrder, flagsOf, guestState, hostState, parsePacket, winnerOf } from '../src/os/arcade/games/palmdrive/net.ts';

const t = buildTrack();
const you = (name = 'you'): Racer => ({ name, color: '#e53935', kind: 'player' });

/** A race already past the lights with only the karts a test needs. */
function race(n = 1, cc: Cc = '100cc'): Race {
  return createRace({ cc, seed: 7, countdown: 0, racers: Array.from({ length: n }, (_, i) => you(`p${i}`)) });
}

/** Puts a kart at distance s along the loop, d to the right, facing down the road (or turned by `turn`). */
function place(r: Race, k: Kart, s: number, d = 0, v = 0, turn = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  k.x = p.x;
  k.z = p.z;
  k.h = headingOf(p.tx, p.tz) + turn;
  k.v = v;
  k.i = at.i;
  k.s = at.s;
  k.d = at.d;
  k.prog = s;
}

function run(r: Race, seconds: number, dt = 1 / 60, each?: (evs: Ev[]) => void) {
  const all: Ev[] = [];
  for (let e = 0; e < seconds; e += dt) {
    step(r, dt);
    const evs = r.events.splice(0);
    all.push(...evs);
    each?.(evs);
  }
  return all;
}

test('the circuit is one closed loop of about 900 meters that never runs into itself', () => {
  assert.ok(t.length > 850 && t.length < 1000, `length ${t.length}`);
  for (let i = 0; i < t.n; i++) {
    const j = (i + 1) % t.n;
    assert.ok(Math.abs(Math.hypot(t.x[j] - t.x[i], t.z[j] - t.z[i]) - t.step) < 0.2, 'evenly sampled');
  }
  // any two stretches more than a few walls apart along the loop stay well clear of each other
  for (let i = 0; i < t.n; i += 2) {
    for (let j = i + 1; j < t.n; j += 2) {
      const along = Math.min(j - i, t.n - (j - i)) * t.step;
      if (along < 4 * EDGE) continue;
      assert.ok(Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) > 2 * EDGE + 10, `stretches at ${i * t.step} and ${j * t.step} come too close`);
    }
  }
  const tightest = Math.max(...Array.from(t.curv, Math.abs));
  assert.ok(1 / tightest > 18, `tightest bend radius ${1 / tightest}`);
});

test('pointAt and locate agree, and the landmarks stand clear of the walls', () => {
  for (const s of [0, 37.5, 200, 444.4, t.length - 1]) {
    for (const d of [-9, 0, 6]) {
      const p = pointAt(t, s, d);
      const at = locate(t, p.x, p.z);
      assert.ok(Math.abs(deltaS(t, s, at.s)) < 0.2, `s ${s} came back as ${at.s}`);
      assert.ok(Math.abs(at.d - d) < 0.1, `d ${d} came back as ${at.d}`);
    }
  }
  for (const [name, spot] of Object.entries(LANDMARKS)) assert.ok(Math.abs(locate(t, spot.x, spot.z).d) > EDGE + 15, `${name} is too close to the road`);
  const oval = LANDMARKS.oval;
  for (let a = 0; a < Math.PI * 2; a += 0.1) {
    assert.ok(Math.abs(locate(t, oval.x + Math.cos(a) * oval.rx, oval.z + Math.sin(a) * oval.rz).d) > EDGE + 2, 'the Oval lawn stays off the course');
  }
});

test('the grid lines up behind the start line and the pickups sit on the road', () => {
  for (let slot = 0; slot < 8; slot++) {
    const g = gridSpot(t, slot);
    const at = locate(t, g.x, g.z);
    assert.ok(deltaS(t, 0, at.s) < -5 && deltaS(t, 0, at.s) > -40, `slot ${slot} at ${at.s}`);
    assert.ok(Math.abs(at.d) < ROAD_HALF - 2);
  }
  const lay = layout(t);
  assert.equal(lay.boxes.length, 12);
  for (const p of [...lay.boxes, ...lay.coins, ...lay.dashes]) assert.ok(Math.abs(p.d) < ROAD_HALF - 1);
  const rows = new Set(lay.boxes.map((b) => Math.round(b.s)));
  assert.equal(rows.size, 3, 'three rows of item boxes');
});

test('the lights count down, nobody moves until GO, and a well timed gas press is a rocket start', () => {
  const r = createRace({ cc: '100cc', seed: 1, racers: [you(), you('late'), you('early')] });
  assert.equal(r.time, -(COUNTDOWN + 0.4));
  const [a, late, early] = r.karts;
  const start = { x: a.x, z: a.z };
  const beeps: number[] = [];
  let go = false;
  const rockets: number[] = [];
  for (let i = 0; i < 400 && !go; i++) {
    if (Math.abs(r.time - -2) < 0.01) pressGas(r, early);
    if (Math.abs(r.time - -0.4) < 0.01) pressGas(r, a);
    step(r, 1 / 100);
    for (const e of r.events.splice(0)) {
      if (e.t === 'beep') beeps.push(e.n);
      if (e.t === 'go') go = true;
      if (e.t === 'rocket') rockets.push(e.k);
    }
    if (!go) assert.deepEqual({ x: a.x, z: a.z }, start);
  }
  assert.deepEqual(beeps, [3, 2, 1]);
  assert.ok(go);
  assert.deepEqual(rockets, [a.idx], 'only the press just before GO counts');
  assert.ok(a.boost > 0 && late.boost === 0 && early.boost === 0);
});

test('karts reach their class top speed, and steering right turns right', () => {
  for (const cc of CCS) {
    const r = race(1, cc);
    run(r, 5);
    assert.ok(Math.abs(r.karts[0].v - CLASSES[cc].top) < 0.01, `${cc} top speed`);
  }
  const r = race();
  const k = r.karts[0];
  place(r, k, 20, 0, 20);
  const h = k.h;
  k.input.steer = 1;
  run(r, 0.4);
  assert.ok(k.h < h, 'heading turns clockwise');
  k.input.steer = 0;
  run(r, 0.4);
  assert.ok(k.d > 0.5, 'and the kart moves to the right of the line');
});

test('walls keep karts on the course and grass slows them down', () => {
  const r = race();
  const k = r.karts[0];
  place(r, k, 30, 0, 23, -1.1);
  let worst = 0;
  run(r, 3, 1 / 60, () => (worst = Math.max(worst, Math.abs(k.d))));
  assert.ok(worst <= EDGE, `went ${worst} from the line`);
  place(r, k, 30, 11, 23);
  run(r, 2.5);
  assert.ok(k.offroad);
  assert.ok(Math.abs(k.v - CLASSES['100cc'].top * OFFROAD) < 0.5, `grass speed ${k.v}`);
  k.boost = 1;
  run(r, 0.5);
  assert.ok(k.v > CLASSES['100cc'].top, 'a boost ignores the grass');
});

test('hop into a drift, hold it to charge the sparks, let go for a mini-turbo', () => {
  const r = race();
  const k = r.karts[0];
  place(r, k, 20, -4, 20);
  k.input.steer = 1;
  k.input.drift = true;
  k.input.hop = true;
  const evs = run(r, 0.5);
  assert.equal(k.drift, 1, 'drifting right after landing');
  k.input.steer = -1;
  const charge = k.charge;
  run(r, 0.3);
  assert.ok(k.charge > charge, 'the drift charges');
  k.charge = TURBO_AT[2] + 0.01;
  k.input.drift = false;
  const out = run(r, 1 / 60);
  assert.equal(k.drift, 0);
  assert.deepEqual(out.filter((e) => e.t === 'turbo').map((e) => (e as { level: number }).level), [2]);
  assert.ok(Math.abs(k.boost - TURBO_T[2]) < 1e-6);
  assert.ok(!evs.some((e) => e.t === 'turbo'));
});

test('laps count only going forward, and three laps finish the race', () => {
  const r = race();
  const k = r.karts[0];
  const L = r.track.length;
  place(r, k, L - 3, 0, 20);
  k.prog = -3;
  let laps = run(r, 0.4).filter((e) => e.t === 'lap');
  assert.equal(laps.length, 0, 'crossing from the grid starts lap 1');
  place(r, k, L - 3, 0, 20);
  k.prog = L - 3;
  laps = run(r, 0.4).filter((e) => e.t === 'lap');
  assert.deepEqual(laps.map((e) => (e as { lap: number }).lap), [2]);
  assert.equal(lapOf(r, k), 2);
  // back over the line and forward again is not another lap
  place(r, k, 3, 0, 20, Math.PI);
  k.prog = L + 3;
  run(r, 0.5);
  assert.ok(k.prog < L);
  k.h += Math.PI;
  laps = run(r, 0.6).filter((e) => e.t === 'lap');
  assert.equal(laps.length, 0);
  assert.equal(k.lap, 2);
  place(r, k, L - 3, 0, 20);
  k.prog = LAPS * L - 3;
  k.lap = LAPS;
  k.laps = [40, 41];
  const fin = run(r, 0.4).filter((e) => e.t === 'finish');
  assert.equal(fin.length, 1);
  assert.ok(k.done !== null && k.laps.length === 3);
  assert.equal(r.first, k.done);
  assert.equal(k.place, 1);
});

test('places rank finishers by time, then everyone else by distance; standings estimate the rest', () => {
  const r = race(3);
  const [a, b, c] = r.karts;
  a.prog = 500;
  b.prog = 900;
  c.prog = 700;
  c.done = 80;
  rankKarts(r);
  assert.deepEqual([a.place, b.place, c.place], [3, 2, 1]);
  r.time = 90;
  const table = standings(r);
  assert.deepEqual(table.map((x) => x.k.idx), [2, 1, 0]);
  assert.ok(!table[0].estimated && table[1].estimated && table[1].time > 90);
  assert.equal(ordinal(2), '2nd');
  assert.equal(fmtTime(83.456), '1:23.46');
});

test('item boxes roll an item, and the odds favor whoever is behind', () => {
  const r = race(2);
  const [k] = r.karts;
  place(r, k, 30, 0, 15);
  r.boxes = [{ x: pointAt(r.track, 33).x, z: pointAt(r.track, 33).z, s: 33, t: 0 }];
  const evs = run(r, ROLL_T + 0.4);
  assert.ok(evs.some((e) => e.t === 'box'));
  assert.ok(evs.some((e) => e.t === 'got'));
  assert.ok(k.item !== null && k.roll === 0);
  assert.ok(r.boxes[0].t > 0, 'the box is gone for a moment');
  const field = createRace({ cc: '100cc', seed: 3, countdown: 0, racers: Array.from({ length: 8 }, (_, i) => you(`p${i}`)) });
  field.karts.forEach((x, i) => (x.place = i + 1));
  const lead = new Set(Array.from({ length: 400 }, () => rollItem(field, field.karts[0])));
  const last = new Set(Array.from({ length: 400 }, () => rollItem(field, field.karts[7])));
  for (const big of ['star', 'bolt', 'blue']) assert.ok(!lead.has(big as never), `the leader never gets ${big}`);
  assert.ok(!last.has('banana') && last.has('star'));
});

test('a dropped banana spins out whoever runs over it', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 60, 0, 10);
  place(r, b, 30, 0, 20);
  giveItem(r, a, 'banana', 0);
  assert.equal(useItem(r, a), 'banana');
  assert.equal(r.things.length, 1);
  a.input.steer = 1;
  const evs = run(r, 2);
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === b.idx && e.how === 'spin'));
  assert.equal(r.things.length, 0);
});

test('green shells fly straight, bounce off walls, and knock over the kart they hit', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 20, 0, 0);
  place(r, b, 50, 0, 0);
  giveItem(r, a, 'green', 0);
  useItem(r, a);
  const evs = run(r, 1.5);
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === b.idx && e.how === 'tumble'));
  assert.ok(b.tumble > 0 || b.safe > 0);
  // fired at the wall it bounces
  const w = race(1);
  const k = w.karts[0];
  place(w, k, 40, 0, 0, -1.2);
  giveItem(w, k, 'green', 0);
  useItem(w, k);
  run(w, 0.6);
  assert.ok(w.things[0]?.bounces > 0);
});

test('a red shell chases the kart one place ahead', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 10, -5, 0);
  place(r, b, 70, 5, 0);
  rankKarts(r);
  assert.equal(b.place, 1);
  giveItem(r, a, 'red', 0);
  useItem(r, a);
  assert.equal(r.things[0].target, b.idx);
  const evs = run(r, 3);
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === b.idx));
});

test('thrown back, a shell goes backwards; shells and bananas break each other', () => {
  const r = race(2);
  const [a] = r.karts;
  place(r, a, 60, 0, 0);
  giveItem(r, a, 'green', 0);
  a.input.back = true;
  useItem(r, a);
  const shell = r.things[0];
  const fx = Math.sin(a.h);
  const fz = Math.cos(a.h);
  assert.ok(shell.vx * fx + shell.vz * fz < 0, 'it flies the other way');
  a.input.back = false;
  r.things = [];
  place(r, a, 20, 0, 0);
  giveItem(r, a, 'banana', 0);
  r.karts[1].x = 999;
  const banana = pointAt(r.track, 45);
  useItem(r, a);
  r.things[0].x = banana.x;
  r.things[0].z = banana.z;
  giveItem(r, a, 'green', 0);
  useItem(r, a);
  const evs = run(r, 1.2);
  assert.equal(r.things.length, 0);
  assert.equal(evs.filter((e) => e.t === 'gone').length, 2);
});

test('mushrooms boost past top speed, three at a time from a triple', () => {
  const r = race();
  const k = r.karts[0];
  place(r, k, 10, 0, CLASSES['100cc'].top);
  giveItem(r, k, 'triple', 0);
  for (let n = 3; n > 0; n--) {
    assert.equal(k.uses, n);
    assert.equal(useItem(r, k), 'triple');
    run(r, 0.6);
    assert.ok(k.v > CLASSES['100cc'].top + BOOST_DV * 0.5);
  }
  assert.equal(k.item, null);
});

test('a star makes you unstoppable and flattens anyone you touch', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 20, 0, 10);
  place(r, b, 26, 0, 0);
  giveItem(r, a, 'star', 0);
  useItem(r, a);
  assert.equal(hitKart(r, a, 'tumble', b.idx), false);
  const evs = run(r, 1);
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === b.idx));
  assert.ok(!evs.some((e) => e.t === 'hit' && e.k === a.idx));
});

test('lightning shrinks everyone else and takes their items, but not under a star', () => {
  const r = race(3);
  const [a, b, c] = r.karts;
  place(r, a, 10, -4, 10);
  place(r, b, 40, 0, 10);
  place(r, c, 70, 4, 10);
  giveItem(r, b, 'green', 0);
  c.star = 3;
  giveItem(r, a, 'bolt', 0);
  useItem(r, a);
  assert.ok(b.shrink > 0 && b.item === null && b.spin > 0);
  assert.equal(a.shrink, 0);
  assert.equal(c.shrink, 0);
  // a full-size kart squashes a shrunken one
  place(r, a, 40, -0.5, 12);
  b.spin = 0;
  b.safe = 0;
  place(r, b, 42, 0, 0);
  const evs = run(r, 0.5);
  assert.ok(evs.some((e) => e.t === 'hit' && e.k === b.idx && e.how === 'squash'));
});

test('the blue shell flies down the course and blows up the leader', () => {
  const r = race(3);
  const [a, b, c] = r.karts;
  place(r, a, 10, 0, 0);
  place(r, b, 300, 0, 0);
  place(r, c, 302, 4, 0);
  rankKarts(r);
  giveItem(r, a, 'blue', 0);
  useItem(r, a);
  const evs = run(r, 10);
  assert.equal(evs.filter((e) => e.t === 'boom').length, 1);
  const blown = evs.filter((e) => e.t === 'hit' && e.how === 'boom').map((e) => (e as { k: number }).k);
  assert.deepEqual(blown.sort(), [b.idx, c.idx], 'the leader and anyone right next to them');
  assert.equal(r.things.length, 0);
});

test('coins raise your top speed, most for the first ten, and stack up to fifty; hits cost coins', () => {
  assert.equal(MAX_COINS, 50);
  assert.equal(coinTop(0), 0);
  assert.ok(Math.abs(coinTop(10) - 1.2) < 1e-9 && Math.abs(coinTop(50) - 2.8) < 1e-9);
  assert.ok(coinTop(11) - coinTop(10) < coinTop(10) - coinTop(9), 'coins past ten add less each');
  const r = race();
  const k = r.karts[0];
  // from the class top speed, along the opening straight
  place(r, k, 20, 0, CLASSES['100cc'].top);
  k.coins = MAX_COINS;
  run(r, 1.5);
  assert.ok(!k.offroad && Math.abs(k.v - (CLASSES['100cc'].top + coinTop(MAX_COINS))) < 0.01, `speed ${k.v}`);
  const ahead = pointAt(r.track, k.prog + 4);
  r.coins = [{ x: ahead.x, z: ahead.z, t: 0 }];
  run(r, 0.5);
  assert.equal(k.coins, MAX_COINS);
  assert.ok(hitKart(r, k, 'tumble', -1));
  assert.equal(k.coins, MAX_COINS - 3);
});

test('five coins cash in for a boost, once per press; with fewer nothing happens', () => {
  const r = race();
  const k = r.karts[0];
  place(r, k, 20, 0, CLASSES['100cc'].top);
  k.coins = CASH_COST + 2;
  k.input.cash = true;
  const evs = run(r, 1 / 60);
  assert.equal(k.coins, 2);
  assert.ok(k.boost > CASH_T - 0.05);
  assert.equal(evs.filter((e) => e.t === 'cash').length, 1);
  assert.equal(k.input.cash, false, 'the press is used up');
  run(r, 0.5);
  assert.ok(k.v > CLASSES['100cc'].top + coinTop(2) + 1, `the boost lifts you past top speed: ${k.v}`);
  k.input.cash = true;
  const none = run(r, 1 / 60);
  assert.equal(k.coins, 2);
  assert.equal(none.filter((e) => e.t === 'cash').length, 0);
});

test('classes get quicker from 50cc to 200cc, and only those four are classes', () => {
  assert.deepEqual(CCS, ['50cc', '100cc', '150cc', '200cc']);
  for (let i = 1; i < CCS.length; i++) {
    assert.ok(CLASSES[CCS[i]].top > CLASSES[CCS[i - 1]].top);
    assert.ok(CLASSES[CCS[i]].accel > CLASSES[CCS[i - 1]].accel);
  }
  for (const cc of CCS) assert.ok(isCc(cc));
  for (const junk of ['250cc', '', '150', null, 150, undefined]) assert.equal(isCc(junk), false);
  assert.equal(LAPS, 5);
});

test('a full field of CPU drivers races five laps at every class, inside the walls', () => {
  for (const cc of CCS) {
    const r = createRace({ cc, seed: 11, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
    let widest = 0;
    let turbos = 0;
    let items = 0;
    let cashes = 0;
    while (r.time < 700 && r.karts.some((k) => k.done === null)) {
      step(r, 1 / 60);
      for (const e of r.events.splice(0)) {
        if (e.t === 'turbo') turbos++;
        if (e.t === 'use') items++;
        if (e.t === 'cash') cashes++;
      }
      for (const k of r.karts) widest = Math.max(widest, Math.abs(k.d));
    }
    assert.ok(r.karts.every((k) => k.done !== null), `${cc}: everyone finished by ${r.time}`);
    const times = r.karts.map((k) => k.done!);
    const fastest = Math.min(...times);
    // five laps of a 914 m loop: about two minutes at 200cc, four at 50cc
    assert.ok(fastest > 100 && Math.max(...times) < 320, `${cc}: ${times.map((x) => x.toFixed(0)).join(' ')}`);
    assert.ok(widest <= EDGE, `${cc}: a kart got ${widest} from the line`);
    assert.ok(turbos > 5 && items > 5, `${cc}: ${turbos} mini-turbos, ${items} items`);
    assert.ok(cashes > 0, `${cc}: CPU drivers cash in their coins`);
    assert.ok(r.karts.every((k) => k.laps.length === LAPS));
  }
});

test('the solo grid puts you at the back of seven rivals and the autopilot brings you home', () => {
  const r = soloRace('150cc', 5);
  assert.equal(r.karts.length, 8);
  assert.equal(r.me, 7);
  assert.equal(r.karts[r.me].place, 8);
  r.karts[r.me].auto = true;
  run(r, 300, 1 / 30);
  assert.ok(r.karts[r.me].done !== null);
});

test('online packets round trip, and junk or other games’ packets are ignored', () => {
  const r = race(2);
  const k = r.karts[0];
  k.star = 2;
  k.drift = -1;
  k.charge = 1.7;
  const car = carOf(k);
  const host = parsePacket(JSON.parse(JSON.stringify(hostState(4, 2.5, '150cc', [0, 3], [{ seat: 0, ...car }, { seat: 3, ...car, fin: 92.5 }]))));
  assert.ok(host && host.k === 'S');
  assert.equal(host.cc, '150cc');
  assert.deepEqual(host.roster, [0, 3]);
  assert.equal(host.cars[1].fin, 92.5);
  // the host's class, 200cc included, reaches the guests, in the race state and in the lobby
  const fast = parsePacket(JSON.parse(JSON.stringify(hostState(5, 2.5, '200cc', [0], [{ seat: 0, ...car }]))));
  assert.ok(fast && fast.k === 'S' && fast.cc === '200cc');
  const cfg = parsePacket(JSON.parse(JSON.stringify(configOf(5, '200cc'))));
  assert.deepEqual(cfg, { k: 'cfg', round: 5, cc: '200cc' });
  assert.equal(parsePacket({ t: 'pk', r: 5, k: 'cfg', cc: 7 }), null);
  const guest = parsePacket(JSON.parse(JSON.stringify(guestState(4, car))));
  assert.ok(guest && guest.k === 's');
  const copy = race(1).karts[0];
  applyFlags(copy, guest.car.f);
  assert.equal(copy.drift, -1);
  assert.ok(copy.star > 0 && copy.charge >= TURBO_AT[2]);
  assert.equal(flagsOf(copy) & F_STAR, F_STAR);
  const ev = parsePacket(events(4, 3, [{ y: 'spawn', id: 3000001, kind: 'red', x: 1, z: 2, vx: 3, vz: 4, vy: 0, yy: 0.35, tg: 0, pg: 0, gr: 0.6 }, { y: 'gone', id: 9 }, { y: 'bolt' }, { y: 'boom', x: 1, z: 2 }]));
  assert.ok(ev && ev.k === 'e' && ev.ev.length === 4 && ev.o === 3);
  const end = parsePacket(endOf(4, 3, [[3, 90], [0, -2]]));
  assert.ok(end && end.k === 'end' && end.w === 3);
  for (const junk of [null, 'pk', { t: 'race', round: 1, score: 3 }, { t: 'pk', r: 1, k: 's', c: [1, 2] }, { t: 'pk', r: 1, k: 'e', o: 99, ev: [] }, { t: 'pk', r: 1, k: 'zzz' }]) {
    assert.equal(parsePacket(junk), null, JSON.stringify(junk));
  }
  const bad = parsePacket({ t: 'pk', r: 1, k: 'e', o: 1, ev: [{ y: 'spawn', kind: 'rocket' }, { y: 'gone', id: 'x' }, { y: 'bolt' }] });
  assert.ok(bad && bad.k === 'e' && bad.ev.length === 1);
});

test('the host calls the winner from finish times; nobody wins if nobody finished', () => {
  assert.deepEqual(finishOrder([[0, -2], [1, 95.2], [2, 91]]), [[2, 91], [1, 95.2], [0, -2]]);
  assert.equal(winnerOf([[0, -2], [1, 95.2], [2, 91]]), 2);
  assert.equal(winnerOf([[0, -2], [1, -2]]), null);
});

test('slams, tricks, wobbles, slipstreams and items held out behind travel in the kart flags', () => {
  const r = race(2);
  const [k, copy] = r.karts;
  k.slamT = 0.2;
  k.trick = true;
  k.wobble = 0.4;
  k.draft = 0.8;
  for (const item of ['banana', 'green', 'red'] as const) {
    k.item = item;
    k.trail = true;
    const f = flagsOf(k);
    assert.equal(f & (F_SLAM | F_TRICK | F_WOBBLE | F_DRAFT), F_SLAM | F_TRICK | F_WOBBLE | F_DRAFT);
    copy.item = null;
    applyFlags(copy, f);
    assert.ok(copy.slamT > 0 && copy.trick && copy.wobble > 0 && copy.draft > 0);
    assert.ok(copy.trail && copy.item === item, `${item} held out behind`);
  }
  // an item in hand but not held out, or one that cannot trail, shows nothing behind
  k.item = 'mushroom';
  k.trail = false;
  k.slamT = 0;
  k.trick = false;
  k.wobble = 0;
  k.draft = 0;
  applyFlags(copy, flagsOf(k));
  assert.ok(!copy.trail && copy.slamT === 0 && !copy.trick && copy.wobble === 0 && copy.draft === 0);
});
