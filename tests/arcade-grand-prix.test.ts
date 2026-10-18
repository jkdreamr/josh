import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildLine, createDriver, drive, profileTime, speedProfile } from '../src/os/arcade/games/grand-prix/ai.ts';
import { NO_ASSISTS, SPEC, createCar, curve, engineTorque, kmh, stepCar, tempGrip, type Assists } from '../src/os/arcade/games/grand-prix/car.ts';
import { keyLock, lockPedal, newDriver, readInput, SOLO, tractionPedal } from '../src/os/arcade/games/grand-prix/input.ts';
import { endOf, finishOrder, guestState, hostState, packCar, parsePacket, unpackCar, winnerOf } from '../src/os/arcade/games/grand-prix/net.ts';
import { createRace, gapLeader, liveDelta, resetCar, stepRace, type Entry, type NetCar } from '../src/os/arcade/games/grand-prix/race.ts';
import { DRIVERS, TEAMS, codeOf } from '../src/os/arcade/games/grand-prix/teams.ts';
import { buildCircuit, circuit, deltaS, gridSlot, locate, pointAt, surfaceAt } from '../src/os/arcade/games/grand-prix/track.ts';

const DT = 1 / 60;
const AUTO: Assists = { tc: true, abs: true, autoGears: true };

test('the circuit is Monza sized and closes on itself', () => {
  const c = circuit();
  assert.ok(Math.abs(c.length - 5793) < 60, `length ${c.length}`);
  // consecutive samples are evenly spaced and the last joins the first
  for (let i = 0; i < c.n; i++) {
    const j = (i + 1) % c.n;
    const gap = Math.hypot(c.px[j] - c.px[i], c.py[j] - c.py[i]);
    assert.ok(Math.abs(gap - c.ds) < 0.05, `gap ${gap} at ${i}`);
    // heading never jumps (smoothed corners)
    const turn = Math.abs(Math.atan2(c.tx[i] * c.ty[j] - c.ty[i] * c.tx[j], c.tx[i] * c.tx[j] + c.ty[i] * c.ty[j]));
    assert.ok(turn < 0.12, `turn ${turn} at ${i}`);
  }
  for (const name of ['rettifilo', 'grande', 'roggia', 'lesmo1', 'lesmo2', 'ascari', 'parabolica']) assert.ok(c.marks[name], name);
  assert.ok(c.sectors[0] < c.sectors[1] && c.sectors[1] < c.length);
});

test('walls stay clear of the track and of other parts of the circuit', () => {
  const c = circuit();
  for (let i = 0; i < c.n; i++) {
    assert.ok(c.wallL[i] >= c.hw[i] + c.kerbL[i] + 3, `left wall at ${i}`);
    assert.ok(c.wallR[i] >= c.hw[i] + c.kerbR[i] + 3, `right wall at ${i}`);
  }
  // a point on each wall is nearest to its own stretch of track
  for (let i = 0; i < c.n; i += 7) {
    for (const side of [1, -1]) {
      const d = side > 0 ? c.wallL[i] : -c.wallR[i];
      const p = pointAt(c, i * c.ds, d);
      const spot = locate(c, p.x, p.y);
      assert.ok(Math.abs(deltaS(c, spot.s, i * c.ds)) < 80, `wall ${i} side ${side} is closest to s=${spot.s}`);
    }
  }
});

test('locate and pointAt agree, and surfaces step out from the asphalt', () => {
  const c = circuit();
  for (const s of [10, 700, 1500, 3000, 4500, 5600]) {
    for (const d of [-5, 0, 4]) {
      const p = pointAt(c, s, d);
      const spot = locate(c, p.x, p.y);
      assert.ok(Math.abs(deltaS(c, spot.s, s)) < 0.6, `s ${spot.s} vs ${s}`);
      assert.ok(Math.abs(spot.d - d) < 0.3, `d ${spot.d} vs ${d}`);
    }
  }
  const i = Math.round(c.marks.parabolica[0] / c.ds) + 20;
  assert.equal(surfaceAt(c, i, 0), 'asphalt');
  assert.equal(surfaceAt(c, i, c.hw[i] + 0.5), 'kerb');
  assert.notEqual(surfaceAt(c, i, c.hw[i] + c.kerbL[i] + 10), 'asphalt');
});

test('engine, tyre and temperature curves have the right shape', () => {
  assert.ok(engineTorque(10500) > engineTorque(6000));
  assert.ok(engineTorque(13000) < engineTorque(11000));
  // the tyre curve peaks at 1 and falls off to roughly three quarters when sliding hard
  assert.ok(Math.abs(curve(1) - 1) < 1e-9);
  assert.ok(curve(0.5) < 1 && curve(2) < 1);
  assert.ok(curve(9) > 0.65 && curve(9) < 0.85, `slide ${curve(9)}`);
  assert.equal(tempGrip(100), 1);
  assert.ok(tempGrip(60) < 0.85 && tempGrip(140) < 0.85);
});

/** A long straight to test on. */
const oval = () => buildCircuit({ id: 'oval', name: 'oval', pieces: [{ len: 9000 }, { turn: 180, r: 600 }, { len: 9000 }, { turn: 180, r: 600 }], solve: [0, 2], heading: 0, halfWidth: 20 });

test('acceleration, top speed and braking are in the range of a real car', () => {
  const c = oval();
  const p0 = pointAt(c, 1500);
  const car = createCar(c, p0.x, p0.y, p0.heading, 0);
  let t = 0;
  let t100 = 0;
  let t200 = 0;
  for (; t < 40; t += DT) {
    stepCar(car, { steer: 0, throttle: 1, brake: 0 }, DT, c, AUTO, false);
    if (!t100 && kmh(car) >= 100) t100 = t;
    if (!t200 && kmh(car) >= 200) t200 = t;
  }
  assert.ok(t100 > 2.4 && t100 < 3.6, `0-100 ${t100}`);
  assert.ok(t200 > 4.5 && t200 < 6.5, `0-200 ${t200}`);
  const top = kmh(car);
  assert.ok(top > 325 && top < 360, `top ${top}`);
  assert.equal(car.gear, 8);
  // DRS buys extra top speed
  for (let i = 0; i < 600; i++) stepCar(car, { steer: 0, throttle: 1, brake: 0, drs: true }, DT, c, AUTO, true);
  assert.ok(kmh(car) > top + 4, `drs ${kmh(car)} vs ${top}`);
  // full braking from top speed: well over 4 g at first, stopped in under 250 m
  const s0 = car.s;
  let peak = 0;
  for (let i = 0; i < 600 && kmh(car) > 1; i++) {
    const v0 = car.vx;
    stepCar(car, { steer: 0, throttle: 0, brake: 1 }, DT, c, AUTO, false);
    peak = Math.max(peak, (v0 - car.vx) / DT / 9.81);
  }
  assert.ok(peak > 4, `peak ${peak} g`);
  assert.ok(car.s - s0 < 250, `stop ${car.s - s0} m`);
});

test('without ABS a full pedal locks the wheels as speed drops; with it they keep turning', () => {
  const c = oval();
  const p0 = pointAt(c, 1500);
  for (const abs of [false, true]) {
    const car = createCar(c, p0.x, p0.y, p0.heading, 50, 95);
    for (let i = 0; i < 60; i++) stepCar(car, { steer: 0, throttle: 0, brake: 1 }, DT, c, { ...NO_ASSISTS, abs, autoGears: true }, false);
    const locked = car.wheels.slice(0, 2).every((w) => w.slipX < -0.5);
    assert.equal(locked, !abs, `abs ${abs}: ${car.wheels.map((w) => w.slipX.toFixed(2))}`);
  }
});

test('cornering grip grows with speed through downforce', () => {
  const lateral = (R: number) => {
    const ring = buildCircuit({ id: 'ring', name: 'ring', pieces: [{ turn: 360, r: R }], solve: [], heading: 0, halfWidth: 30 });
    let best = 0;
    for (let vt = 15; vt < 100; vt += 2) {
      const car = createCar(ring, 0, 0, 0, vt, 95);
      let ok = true;
      let si = Math.atan(3.6 / R) / 0.3;
      for (let t = 0; t < 8; t += DT) {
        const rdes = -car.vx / R - car.d * 0.02;
        si = Math.max(-1, Math.min(1, si + (car.r - rdes) * DT * 6));
        const steer = Math.max(-1, Math.min(1, si + (car.r - rdes) * 0.4));
        const thr = car.vx < vt ? Math.min(1, (vt - car.vx) * 0.5 + 0.3) : 0.15;
        stepCar(car, { steer, throttle: thr, brake: 0 }, DT, ring, NO_ASSISTS, false);
        if (Math.abs(car.d) > 8) {
          ok = false;
          break;
        }
      }
      if (!ok || car.vx < vt - 3) break;
      best = vt;
    }
    return (best * best) / R / 9.81;
  };
  const slow = lateral(30);
  const fast = lateral(200);
  assert.ok(slow > 1.4 && slow < 2.4, `slow corner ${slow} g`);
  assert.ok(fast > 2.8 && fast < 4.5, `fast corner ${fast} g`);
});

test('the racing line stays inside the track and its lap time is realistic', () => {
  const c = circuit();
  const line = buildLine(c);
  for (let i = 0; i < c.n; i++) assert.ok(Math.abs(line.off[i]) <= c.hw[i] - 1, `line at ${i}`);
  const t = profileTime(line);
  assert.ok(t > 76 && t < 86, `profile ${t}`);
});

test('a computer driver laps cleanly at a realistic pace', () => {
  const c = circuit();
  const line = buildLine(c);
  const s0 = c.marks.main[0] + 100;
  const p0 = pointAt(c, s0, line.off[Math.round(s0 / c.ds)]);
  const car = createCar(c, p0.x, p0.y, p0.heading, 60, 90);
  const drv = createDriver(line, 1, 1);
  let lastS = car.s;
  let start = -1;
  const laps: number[] = [];
  let hits = 0;
  let off = 0;
  for (let t = 0; t < 300 && laps.length < 2; t += DT) {
    const input = drive(drv, car, c, line, [], DT);
    stepCar(car, input, DT, c, AUTO, false);
    if (car.impact) hits++;
    if (car.offTrack) off++;
    if (lastS > c.length - 200 && car.s < 200) {
      if (start >= 0) laps.push(t - start);
      start = t;
      car.ersDeployed = 0;
      car.ersHarvested = 0;
    }
    lastS = car.s;
  }
  assert.equal(laps.length, 2);
  for (const lap of laps) assert.ok(lap > 80 && lap < 92, `lap ${lap}`);
  assert.equal(hits, 0);
  assert.equal(off, 0);
});

const field = (n: number, player = -1): Entry[] =>
  Array.from({ length: n }, (_, k) => (k === player ? { name: 'You', team: 0, kind: 'player', seat: -1, pad: 0 } : { name: DRIVERS[k], team: k >> 1, kind: 'ai', seat: -1, pad: -1, pace: 0.92 + 0.08 * ((n - k) / n) }));

test('a race starts on the lights and every car finishes the distance', () => {
  const r = createRace({ mode: 'race', laps: 2, entries: field(12), assists: [AUTO], lead: 0.5, hold: 0.5 });
  const lights: number[] = [];
  let go = -1;
  let contacts = 0;
  while (r.time < 400 && r.runners.some((x) => x.fin === null)) {
    // nobody moves before lights out
    if (r.time < -0.01) for (const rn of r.runners) assert.equal(rn.car.vx, 0);
    stepRace(r, DT, new Map());
    for (const e of r.events) {
      if (e.t === 'light') lights.push(e.n);
      if (e.t === 'go') go = r.time;
      if (e.t === 'contact') contacts++;
    }
    r.events.length = 0;
  }
  assert.deepEqual(lights, [1, 2, 3, 4, 5]);
  assert.ok(go >= 0 && go < 0.05);
  for (const rn of r.runners) {
    assert.notEqual(rn.fin, null, `${rn.entry.name} finished`);
    assert.equal(rn.lap, 2);
    assert.equal(rn.laps.length, 2);
    // lap one includes the standing start
    assert.ok(rn.laps[0].time > rn.laps[1].time);
    assert.ok(rn.laps[1].time > 80 && rn.laps[1].time < 95, `${rn.entry.name} lap ${rn.laps[1].time}`);
  }
  // the order is by finish time
  const fins = r.order.map((i) => r.runners[i].fin!);
  for (let k = 1; k < fins.length; k++) assert.ok(fins[k] >= fins[k - 1]);
  assert.equal(gapLeader(r, r.order[0]), null);
  assert.ok(contacts < 400, `contacts ${contacts}`);
});

test('a time trial times laps from the line, with sectors, delta and track limits', () => {
  const r = createRace({ mode: 'trial', laps: 1, entries: field(1, 0), assists: [AUTO] });
  const me = r.runners[0];
  const drv = createDriver(r.line, 0.97, 1);
  let sectors = 0;
  let laps = 0;
  let trace: Float32Array | null = null;
  while (r.time < 200 && me.laps.length < 2) {
    const input = drive(drv, me.car, r.c, r.line, [], DT);
    stepRace(r, DT, new Map([[0, input]]));
    for (const e of r.events) {
      if (e.t === 'sector') sectors++;
      if (e.t === 'lap') laps++;
    }
    r.events.length = 0;
    if (me.laps.length === 1 && !trace) trace = Float32Array.from(me.trace);
    if (me.laps.length === 1 && me.car.s > 1000 && me.car.s < 1010) {
      const d = liveDelta(r, me, trace);
      assert.ok(d === null || Math.abs(d) < 5);
    }
  }
  assert.equal(laps, 2);
  assert.equal(sectors, 6);
  assert.ok(me.best && me.best.valid);
  const [a, b, c] = me.best!.sectors;
  assert.ok(Math.abs(a + b + c - me.best!.time) < 1e-6);
  // running off the track invalidates the lap and reports it
  const p = pointAt(r.c, me.car.s, r.c.hw[me.car.i] + r.c.kerbL[me.car.i] + 6);
  me.car.x = p.x;
  me.car.y = p.y;
  stepRace(r, DT, new Map([[0, { steer: 0, throttle: 0, brake: 0 }]]));
  assert.ok(r.events.some((e) => e.t === 'limits' && e.invalid));
  assert.equal(me.lapValid, false);
  // a reset puts the car back on the line, stopped
  resetCar(r, me);
  assert.ok(Math.abs(me.car.d - r.line.off[me.car.i]) < 1);
  assert.equal(me.car.vx, 0);
});

test('the grid fills two by two behind the line', () => {
  const c = circuit();
  for (let k = 0; k < 20; k++) {
    const g = gridSlot(c, k);
    assert.ok(deltaS(c, g.s, 0) > 0, `slot ${k} is behind the line`);
    assert.ok(Math.abs(g.d) < c.hw[g.i]);
  }
});

test('online packets round trip and junk is rejected', () => {
  const car: NetCar = { x: 101.234, y: -55.5, yaw: 1.2345, vx: 80.12, vy: -0.5, r: 0.12, steer: -0.2, rpm: 11234, gear: 7, brake: 0.5, drs: true, lap: 2, dist: 12345.6, fin: -1, best: 82345 };
  const back = unpackCar(packCar(car))!;
  assert.ok(Math.abs(back.x - car.x) < 0.01 && Math.abs(back.yaw - car.yaw) < 0.001 && back.drs && back.gear === 7 && back.lap === 2);
  const S = parsePacket(JSON.parse(JSON.stringify(hostState(3, 4.5, 5, [0, 1, 2], [0, 1, 2], [[0, car]]))));
  assert.ok(S && S.k === 'S' && S.laps === 5 && S.roster.length === 3 && S.cars.length === 1 && S.cars[0][0] === 0);
  const s = parsePacket(guestState(3, car));
  assert.ok(s && s.k === 's');
  const end = parsePacket(endOf(3, 1, [[1, 170000], [0, 171000]]));
  assert.ok(end && end.k === 'end' && end.w === 1);
  assert.equal(parsePacket({ t: 'gp', r: 1, k: 's', c: [1, 2, 3] }), null);
  assert.equal(parsePacket({ t: 'gp', r: 1, k: 's', c: [...packCar(car).slice(0, 3), 900, ...packCar(car).slice(4)] }), null);
  assert.equal(parsePacket({ t: 'pk', r: 1, k: 's' }), null);
  assert.equal(parsePacket(null), null);
  // laps outside the choices fall back to three
  const odd = parsePacket({ ...hostState(1, 1, 5, [0], [0], []), laps: 99 });
  assert.ok(odd && odd.k === 'S' && odd.laps === 3);
});

test('the finishing order ranks finishers by time, then the rest by distance', () => {
  const order = finishOrder([
    { seat: 2, fin: -1, dist: 9000 },
    { seat: 0, fin: 171000, dist: 17400 },
    { seat: 1, fin: 170500, dist: 17400 },
    { seat: 3, fin: -1, dist: 12000 },
  ]);
  assert.deepEqual(
    order.map(([s]) => s),
    [1, 0, 3, 2],
  );
  assert.equal(winnerOf(order), 1);
  assert.equal(winnerOf([[4, -1]]), null);
});

test('keyboard steering eases in, shrinks with speed and centers', () => {
  assert.equal(keyLock(0), 1);
  assert.equal(keyLock(8), 1);
  assert.ok(keyLock(80) < keyLock(30) && keyLock(30) < keyLock(15));
  // at Monza's top speed a held key still has a few degrees of lock, enough for the Curva Grande
  assert.ok(keyLock(95) > 0.15 && keyLock(95) < 0.25);
  const held = new Set<string>(['ArrowRight']);
  const keys = { down: (...n: string[]) => n.some((k) => held.has(k)), pressed: () => false };
  const d = newDriver();
  const first = readInput(d, keys, SOLO, -1, 50, DT).input.steer;
  assert.ok(first > 0 && first < 0.1);
  for (let i = 0; i < 60; i++) readInput(d, keys, SOLO, -1, 50, DT);
  assert.ok(Math.abs(d.steer - keyLock(50)) < 1e-6);
  held.clear();
  for (let i = 0; i < 30; i++) readInput(d, keys, SOLO, -1, 50, DT);
  assert.equal(d.steer, 0);
});

for (const [label, assists] of [
  ['the default assists', AUTO],
  ['no assists at all', { tc: false, abs: false, autoGears: true }],
] as const) {
  test(`a keyboard driver (keys only, no analog) can lap cleanly with ${label}`, () => {
  // a crude driver: holds left or right toward a point ahead on the line, and gas or brake toward a cautious speed
  const r = createRace({ mode: 'trial', laps: 1, entries: field(1, 0), assists: [assists] });
  const me = r.runners[0];
  const { c, line } = r;
  const target = speedProfile(line, 1.55 * 0.9);
  const st = newDriver();
  const held = new Set<string>();
  const keys = { down: (...n: string[]) => n.some((k) => held.has(k)), pressed: () => false };
  let walls = 0;
  let limits = 0;
  while (r.time < 260 && me.laps.length < 2) {
    held.clear();
    const car = me.car;
    const ahead = (car.i + Math.round((6 + car.vx * 0.35) / c.ds)) % c.n;
    const tx = c.px[ahead] - c.ty[ahead] * line.off[ahead];
    const ty = c.py[ahead] + c.tx[ahead] * line.off[ahead];
    const left = -(tx - car.x) * Math.sin(car.yaw) + (ty - car.y) * Math.cos(car.yaw);
    const fwd = (tx - car.x) * Math.cos(car.yaw) + (ty - car.y) * Math.sin(car.yaw);
    const ang = Math.atan2(left, fwd);
    if (ang > 0.012) held.add('ArrowLeft');
    else if (ang < -0.012) held.add('ArrowRight');
    const v = Math.min(target[(car.i + Math.round((car.vx * 0.25) / c.ds)) % c.n], target[car.i]);
    if (car.vx < v - 1) held.add('ArrowUp');
    else if (car.vx > v + 2) held.add('ArrowDown');
    stepRace(r, DT, new Map([[0, readInput(st, keys, SOLO, -1, Math.abs(car.vx), DT, { tc: assists.tc, abs: assists.abs, gear: car.gear }).input]]));
    for (const e of r.events) {
      if (e.t === 'wall') walls++;
      if (e.t === 'limits') limits++;
    }
    r.events.length = 0;
  }
  assert.equal(me.laps.length, 2);
  assert.equal(walls, 0);
  assert.equal(limits, 0);
  assert.ok(me.laps[1].time < 96, `lap ${me.laps[1].time}`);
  });
}

test('keyboard pedals without aids press as far as the tyres take', () => {
  assert.ok(lockPedal(60 / 3.6) < 0.5 && lockPedal(340 / 3.6) > 0.98);
  assert.ok(tractionPedal(70 / 3.6) < 0.9 && tractionPedal(200 / 3.6) === 1);
  const held = new Set<string>(['ArrowUp']);
  const keys = { down: (...n: string[]) => n.some((k) => held.has(k)), pressed: () => false };
  const d = newDriver();
  let thr = 0;
  for (let i = 0; i < 60; i++) thr = readInput(d, keys, SOLO, -1, 20, DT, { tc: false, abs: false, gear: 2 }).input.throttle;
  assert.ok(Math.abs(thr - tractionPedal(20) * 0.97) < 1e-6, `throttle ${thr}`);
  // with traction control on the key is simply full throttle
  assert.equal(readInput(newDriver(), keys, SOLO, -1, 20, DT, { tc: true, abs: true, gear: 2 }).input.throttle, 1);
  held.clear();
  held.add('ArrowDown');
  let brk = 0;
  for (let i = 0; i < 30; i++) brk = readInput(d, keys, SOLO, -1, 30, DT, { tc: false, abs: false, gear: 2 }).input.brake;
  assert.ok(Math.abs(brk - lockPedal(30) * 0.97) < 1e-6, `brake ${brk}`);
});

test('every team and driver has what the timing tower needs', () => {
  assert.equal(TEAMS.length, 10);
  assert.equal(DRIVERS.length, 20);
  for (const d of DRIVERS) assert.match(codeOf(d), /^[A-Z]{3}$/);
  assert.equal(codeOf('Player 2'), 'P2');
  assert.equal(codeOf('You'), 'YOU');
  for (const t of TEAMS) for (const c of [t.body, t.accent, t.detail]) assert.match(c, /^#[0-9a-f]{6}$/i);
  assert.ok(SPEC.ratios.every((r, k) => k === 0 || r < SPEC.ratios[k - 1]));
});
