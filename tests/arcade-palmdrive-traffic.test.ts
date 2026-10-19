import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { CLASSES, GREEN_V, KART_R, RIVALS, SHUTTLE, TREE, cpuLane, createRace, hazSpans, hazState, hazardS, moveHazards, rescue, shuttleRun, spanGone, spawn, step, trafficD, type Ev, type Kart, type LiveHazard, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { cycleAt, deltaS, drives, headingOf, lengthOf, locate, pointAt, traffic, type Hazard } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;
type Cc = '50cc' | '100cc' | '150cc' | '200cc';

/** A race at Hoover Nights, past the lights, with n hand-driven karts. */
function hoover(n = 1, seed = 5, cc: Cc = '150cc'): Race {
  return createRace({ cc, course: 'hoover', seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0, turn = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz) + turn, v, i: at.i, s: at.s, d: at.d, prog: s + (k.lap - 1) * r.track.length });
}

function run(r: Race, seconds: number, each?: () => void): Ev[] {
  const all: Ev[] = [];
  for (let n = Math.round(seconds / DT); n > 0; n--) {
    step(r, DT);
    all.push(...r.events.splice(0));
    each?.();
  }
  return all;
}

const find = (r: Race, kind: LiveHazard['kind'], pick: (h: LiveHazard) => boolean = () => true) => {
  const h = r.hazards.find((x) => x.kind === kind && pick(x));
  assert.ok(h, `a ${kind} on the course`);
  return h;
};

function setTime(r: Race, time: number) {
  r.time = time;
  moveHazards(r);
}

/** The widest stretch of road left clear between the edges `lo` and `hi` and the spans across it. */
function widest(lo: number, hi: number, spans: [number, number][]) {
  let best = 0;
  let edge = lo;
  for (const [a, b] of [...spans].sort((p, q) => p[0] - q[0])) {
    best = Math.max(best, Math.min(a, hi) - edge);
    edge = Math.max(edge, b);
  }
  return Math.max(best, hi - edge);
}

/** The first time from `from` (in steps of 0.01 s) that a shuttle comes out onto the road. */
function nextCrossing(r: Race, h: Hazard, from: number) {
  for (let time = from; time < from + 200; time += 0.01) if (hazState(r, h, time, 1).live && !hazState(r, h, time - 0.01, 1).live) return time;
  throw new Error('never crosses');
}

test('Hoover Nights has its traffic and the Tree where the plan puts them, and no other course has any', () => {
  const t = trackOf('hoover');
  const lay = COURSES.hoover.layout(t);
  const cars = lay.hazards.filter((h) => traffic(h.kind));
  assert.deepEqual(cars.map((h) => h.kind).sort(), ['car', 'car', 'car', 'van']);
  for (const h of cars) {
    // oncoming down Memorial Church's straight in the left lane, out of a side street at 892 and off into one at 782
    assert.ok(h.drive! < 0 && h.d === -3.6 && h.span![0] === 782 && h.span![1] === 892 && h.bay === -11 && h.every === 16 && h.tau, `${h.kind} at ${h.phase}`);
    assert.ok(drives(h));
  }
  assert.deepEqual(cars.filter((h) => h.kind === 'car').map((h) => h.phase), [0, 5.3, 10.6]);
  // the van joins from the third or so lap (traffic time 98.6 is about two laps in at every class)
  assert.ok(cars.find((h) => h.kind === 'van')!.phase! > 80);
  const xing = lay.hazards.filter((h) => h.kind === 'shuttle');
  assert.equal(xing.length, 2);
  assert.ok(xing.every((h) => h.s === 990 && h.every === 17 && h.tau && lengthOf(h) === 18 && h.cross === 16));
  assert.deepEqual(xing.map((h) => Math.sign(h.speed!)), [1, -1]);
  // the one the other way only from about lap 4, between the first one's crossings
  assert.ok(xing[1].phase! > 120 && Math.abs(cycleAt(xing[1], xing[1].phase!, 17) - cycleAt(xing[1], xing[0].phase! + 8.5, 17)) < 1e-9);
  const tree = lay.hazards.filter((h) => h.kind === 'tether');
  assert.equal(tree.length, 1);
  assert.ok(tree[0].s === 913 && tree[0].d === -7.4 && tree[0].aim === -1.8 && tree[0].every === 3.2 && !tree[0].lap);
  // the crossing's side streets have open campus either side, clear of every other stretch of road
  for (const d of [-34, -25, -18, 18, 25, 34]) {
    const p = pointAt(t, 990, d);
    assert.ok(Math.abs(deltaS(t, locate(t, p.x, p.z).s, 990)) < 1, `side street at d=${d} near other road`);
  }
  for (const id of COURSE_IDS) if (id !== 'hoover') assert.ok(COURSES[id].layout(trackOf(id)).hazards.every((h) => !traffic(h.kind) && h.kind !== 'shuttle' && h.kind !== 'tether'), `${id} has no traffic`);
});

test('the traffic is a pure function of the race clock and the class: two races agree, and 200cc runs the same timetable faster', () => {
  const a = hoover(1, 1);
  const b = hoover(1, 77);
  const moving = a.hazards.map((h, i) => [h, b.hazards[i]] as const).filter(([h]) => traffic(h.kind) || h.kind === 'shuttle');
  for (const time of [0, 3.3, 47.1, 99.9, 150.2, 233.7]) {
    for (const [h, g] of moving) {
      if (h.kind === 'shuttle') {
        for (const lap of [1, 3, 5]) assert.deepEqual(hazState(a, h, time, lap), hazState(b, g, time, lap));
        // (and the same whatever the kart's lap: traffic is everybody's)
        assert.deepEqual(hazState(a, h, time, 1), hazState(a, h, time, 5));
        continue;
      }
      assert.equal(spanGone(h, time), spanGone(g, time));
      assert.equal(hazardS(a.track, h, time), hazardS(b.track, g, time));
      assert.equal(trafficD(h, time), trafficD(g, time));
    }
  }
  // traffic time: what the cars do at 150cc at time T they do at 200cc at T times 27.5/33
  const slow = hoover(1, 3, '150cc');
  const fast = hoover(1, 3, '200cc');
  const k = CLASSES['200cc'].top / CLASSES['150cc'].top;
  for (const T of [12, 64.4, 130.5]) {
    slow.hazards.forEach((h, i) => {
      if (!traffic(h.kind)) return;
      const g = fast.hazards[i];
      assert.equal(spanGone(h, T), spanGone(g, T / k), `${h.kind} at ${T}`);
      if (!spanGone(h, T)) assert.ok(Math.abs(hazardS(slow.track, h, T) - hazardS(fast.track, g, T / k)) < 1e-6);
    });
    // (the crossing keeps the same timetable; which crossings it sits out depends on the buses, which keep their own)
    for (const [i, h] of slow.hazards.entries()) if (h.kind === 'shuttle') assert.ok(Math.abs(cycleAt(h, T) - cycleAt(fast.hazards[i], T / k) * k) < 1e-6);
  }
  // and stepping a race changes none of it
  const c = hoover(1, 5);
  const before = c.hazards.filter((h) => h.kind === 'shuttle' || h.kind === 'tether').map((h) => hazState(c, h, 80, 2));
  run(c, 1);
  assert.deepEqual(c.hazards.filter((h) => h.kind === 'shuttle' || h.kind === 'tether').map((h) => hazState(c, h, 80, 2)), before);
});

test('A10.3 the crossing: bells well before, shut for two seconds at most, never with a bus on its rounds near, and no two vehicles ever meet', () => {
  for (const cc of ['50cc', '150cc', '200cc'] as const) {
    const r = hoover(1, 2, cc);
    const t = r.track;
    const xing = r.hazards.filter((h) => h.kind === 'shuttle');
    const buses = r.hazards.filter((h) => h.kind === 'bus');
    const cars = r.hazards.filter((h) => traffic(h.kind));
    const i = Math.round(990 / t.step) % t.n;
    let shut = 0;
    let longest = 0;
    let crossings = 0;
    const was = xing.map(() => false);
    /** Each vehicle as a box: its middle, which way it faces, half its length and half its width. */
    const boxes = (time: number) => {
      const out: { x: number; z: number; ax: number; az: number; hl: number; hw: number; what: string }[] = [];
      for (const b of buses) {
        const p = pointAt(t, hazardS(t, b, time), b.d);
        out.push({ x: p.x, z: p.z, ax: p.tx, az: p.tz, hl: lengthOf(b) / 2, hw: b.r, what: `bus ${b.s}` });
      }
      for (const c of cars) {
        if (spanGone(c, time)) continue;
        const p = pointAt(t, hazardS(t, c, time), trafficD(c, time));
        out.push({ x: p.x, z: p.z, ax: p.tx, az: p.tz, hl: lengthOf(c) / 2, hw: c.r, what: `${c.kind} ${c.phase}` });
      }
      for (const h of xing) {
        const st = hazState(r, h, time, 1);
        // (on its way across: waiting in its side street it is not there)
        if (st.d === shuttleRun(r, h).at(0)) continue;
        const p = pointAt(t, h.s, st.d);
        // (across the road, its length across it)
        out.push({ x: p.x, z: p.z, ax: -p.tz, az: p.tx, hl: lengthOf(h) / 2, hw: h.r, what: `shuttle ${h.speed}` });
      }
      return out;
    };
    const apart = (a: ReturnType<typeof boxes>[number], b: ReturnType<typeof boxes>[number]) => {
      for (const [ux, uz] of [[a.ax, a.az], [-a.az, a.ax], [b.ax, b.az], [-b.az, b.ax]]) {
        const ext = (o: typeof a) => o.hl * Math.abs(o.ax * ux + o.az * uz) + o.hw * Math.abs(-o.az * ux + o.ax * uz);
        if (Math.abs((a.x - b.x) * ux + (a.z - b.z) * uz) > ext(a) + ext(b)) return true;
      }
      return false;
    };
    for (let time = 0; time <= 400; time += 0.05) {
      const spans: [number, number][] = [];
      xing.forEach((h, n) => {
        const st = hazState(r, h, time, 1);
        spans.push(...hazSpans(r, h, time, 1, 0, st));
        if (st.live && !was[n]) {
          crossings++;
          // the bells were going (and the gates coming down) from SHUTTLE.warn before it reached the road
          for (const before of [0.1, 1, 2.5]) assert.ok(hazState(r, h, time - before, 1).warn > 0, `${cc}: no bells ${before} s before the crossing at t=${time.toFixed(2)}`);
          assert.ok(hazState(r, h, time - 0.3, 1).lift > 0.3, `${cc}: gates down`);
        }
        was[n] = st.live;
        // never with a bus on its rounds near the crossing
        if (st.live) for (const b of buses) assert.ok(Math.abs(deltaS(t, hazardS(t, b, time), h.s)) > lengthOf(b) / 2 + SHUTTLE.clear, `${cc}: a bus by the crossing at t=${time.toFixed(2)}`);
      });
      if (widest(t.lo[i], t.hi[i], spans) < 2.6) shut += 0.05;
      else {
        longest = Math.max(longest, shut);
        shut = 0;
      }
      const all = boxes(time);
      for (let p = 0; p < all.length; p++) for (let q = p + 1; q < all.length; q++) assert.ok(apart(all[p], all[q]), `${cc}: the ${all[p].what} and the ${all[q].what} meet at t=${time.toFixed(2)}`);
    }
    assert.ok(longest > 0 && longest <= 2.0 + 1e-9, `${cc}: the road shut for ${longest.toFixed(2)} s`);
    assert.ok(crossings >= 15, `${cc}: only ${crossings} crossings in 400 s`);
  }
});

test('a way past the oncoming traffic all the way down Memorial Church straight, with the buses on their rounds', () => {
  for (const cc of ['50cc', '200cc'] as const) {
    const r = hoover(1, 2, cc);
    const t = r.track;
    const movers = r.hazards.filter((h) => drives(h));
    let narrowest = Infinity;
    for (let time = 0; time <= 300; time += 0.05) {
      for (let s = 782; s <= 892; s += 2) {
        const i = Math.round(s / t.step) % t.n;
        const spans: [number, number][] = [];
        for (const v of movers) {
          if (v.span && spanGone(v, time)) continue;
          if (Math.abs(deltaS(t, hazardS(t, v, time), s)) > lengthOf(v) / 2) continue;
          const d = trafficD(v, time);
          spans.push([d - v.r, d + v.r]);
        }
        narrowest = Math.min(narrowest, widest(t.lo[i], t.hi[i], spans));
      }
    }
    // (the oncoming lane and the bus lane leave the middle of the road between them)
    assert.ok(narrowest >= 4.5, `${cc}: only ${narrowest.toFixed(2)} m`);
  }
});

test('an oncoming car: head on it tumbles you and the item in your hand goes flying, you are thrown clear and never carried back down the road', () => {
  const r = hoover();
  const k = r.karts[0];
  const car = find(r, 'car', (h) => h.phase === 0);
  // the car halfway down its stretch, coming at a kart in its lane
  const when = 60 * 16 / 16 + 55 / Math.abs(car.drive!);
  setTime(r, Math.ceil(when / 16) * 16 + 55 / Math.abs(car.drive!));
  const cs = hazardS(r.track, car, r.time);
  assert.ok(!spanGone(car, r.time) && Math.abs(trafficD(car, r.time) - car.d) < 1e-9, 'in its lane');
  place(r, k, cs - 20, car.d, 25);
  k.item = 'red';
  let worst = Infinity;
  const evs = run(r, 1.6, () => (worst = Math.min(worst, k.s)));
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'car'), 'hit');
  assert.ok(evs.some((e) => e.t === 'hit' && e.how === 'tumble'), 'tumbled');
  assert.equal(k.item, null, 'the item went flying');
  assert.ok(worst > cs - 25, `carried back to ${worst.toFixed(1)}`);
  assert.ok(Math.abs(k.d - trafficD(car, r.time)) > car.r + KART_R - 0.05 || spanGone(car, r.time) || deltaS(r.track, hazardS(r.track, car, r.time), k.s) > 0, 'out of its way');
  // brushing it at a crawl is only a bump; a star ploughs through
  for (const power of [null, 'star'] as const) {
    const s = hoover();
    const q = s.karts[0];
    const c2 = find(s, 'car', (h) => h.phase === 0);
    setTime(s, 160 + 55 / Math.abs(c2.drive!));
    const at = hazardS(s.track, c2, s.time);
    if (power) {
      q.star = 3;
      place(s, q, at - 12, c2.d, 20);
    } else place(s, q, at - 4.5, c2.d + c2.r + KART_R + 0.4, 0, 0.12);
    const ev = run(s, 0.8);
    assert.ok(!ev.some((e) => e.t === 'hit'), power ?? 'a brush');
  }
});

test('the crossing Marguerite: run into its side and you tumble back off it, never carried across; it never hits you on another stretch', () => {
  const r = hoover();
  const k = r.karts[0];
  const h = find(r, 'shuttle', (x) => x.speed! > 0);
  // the bus right across the middle of the road
  const run1 = shuttleRun(r, h);
  const start = nextCrossing(r, h, 30);
  setTime(r, start - (run1.enter - (run1.from - run1.half) / Math.abs(run1.v)) + run1.from / Math.abs(run1.v) - run1.enter + run1.enter);
  // (find the moment its middle is over the middle of the road)
  let mid = start;
  while (Math.abs(hazState(r, h, mid, 1).d) > 0.1) mid += 0.005;
  setTime(r, mid - 0.6);
  place(r, k, h.s - 14, 0, 22);
  const evs = run(r, 1.2);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'shuttle'), 'hit');
  assert.ok(evs.some((e) => e.t === 'hit' && e.how === 'tumble'), 'tumbled');
  assert.ok(deltaS(r.track, k.s, h.s) > h.r + KART_R - 0.1, `put back before it, at ${deltaS(r.track, k.s, h.s).toFixed(2)}`);
  // the bus is gone from the road soon after, and the kart can go
  const st = hazState(r, h, r.time + run1.leave, 1);
  assert.ok(!st.live);
  // the bells and lights: warn climbs for SHUTTLE.warn before it reaches the road, the gates are down from SHUTTLE.gate
  const enter = nextCrossing(r, h, 100);
  assert.ok(hazState(r, h, enter - SHUTTLE.warn + 0.05, 1).warn > 0 && hazState(r, h, enter - SHUTTLE.warn - 0.1, 1).warn === 0);
  assert.ok(hazState(r, h, enter - SHUTTLE.gate + SHUTTLE.drop + 0.01, 1).lift >= 0.99 && hazState(r, h, enter - SHUTTLE.gate - 0.05, 1).lift === 0);
  // shells break on it while it is across the road
  const s = hoover();
  const sh = find(s, 'shuttle', (x) => x.speed! > 0);
  let m2 = nextCrossing(s, sh, 50);
  while (Math.abs(hazState(s, sh, m2, 1).d) > 0.1) m2 += 0.005;
  setTime(s, m2 - 0.15);
  place(s, s.karts[0], sh.s - 60, -5, 0);
  const from = pointAt(s.track, sh.s - 12, 0);
  const shell = spawn(s, { kind: 'green', owner: 0, x: from.x, z: from.z, y: 0.35, vx: from.tx * GREEN_V, vz: from.tz * GREEN_V, vy: 0, grace: 9, target: -1, prog: 0 });
  run(s, 0.4);
  assert.ok(!s.things.some((th) => th.id === shell.id), 'the shell broke on it');
});

test('the Tree: it crouches first, lunges across the inside line and tumbles whoever it catches (in the air too), and is a planter sat by its post', () => {
  const r = hoover();
  const t = r.track;
  const tree = find(r, 'tether');
  const every = tree.every!;
  // over a whole cycle: never out past -0.6 (the outside lane, by the ditch, always clear), out to about -3 at full stretch
  let reach = -Infinity;
  let deepest = Infinity;
  let firstLive = -1;
  let firstWarn = -1;
  const from = 40 - cycleAt(tree, 40) + 0.01;
  for (let c = 0; c < every; c += 0.005) {
    const time = from + c;
    const st = hazState(r, tree, time, 1);
    if (st.warn > 0 && firstWarn < 0) firstWarn = c;
    if (st.live && firstLive < 0) firstLive = c;
    for (const ds of [-1, 0, 1]) for (const [lo, hi] of hazSpans(r, tree, time, 1, ds)) {
      reach = Math.max(reach, hi);
      deepest = Math.min(deepest, lo);
    }
  }
  assert.ok(reach <= -0.6 + 1e-6 && reach >= -0.7, `reaches ${reach.toFixed(2)}`);
  assert.ok(firstLive - firstWarn >= 0.6 - 1e-6, `crouches ${(firstLive - firstWarn).toFixed(2)} s first`);
  assert.equal(firstLive >= 0, true);
  assert.ok(Math.abs(TREE.crouch - TREE.out - 0.6) < 1e-9);
  // caught as it lunges
  const k = r.karts[0];
  const lunge = (time: number) => hazState(r, tree, time, 1).lift > 0.99;
  let at = 60;
  while (!lunge(at)) at += 0.01;
  setTime(r, at - 0.4);
  place(r, k, tree.s - 8, tree.aim!, 16);
  const evs = run(r, 0.8);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'tether') && evs.some((e) => e.t === 'hit' && e.how === 'tumble'), 'bowled over');
  // and in the air
  const s = hoover();
  const q = s.karts[0];
  setTime(s, at - 0.1);
  place(s, q, tree.s - 2.5, tree.aim!, 16);
  q.y = 0.5;
  q.vy = 3;
  assert.ok(run(s, 0.4).some((e) => e.t === 'haz' && e.kind === 'tether'), 'in the air');
  // sat by its post it is only something to bounce off
  const u = hoover();
  const w = u.karts[0];
  let rest = 60;
  while (hazState(u, tree, rest, 1).warn > 0 || hazState(u, tree, rest, 1).live || hazState(u, tree, rest + 0.8, 1).warn > 0) rest += 0.01;
  setTime(u, rest);
  const sat = hazState(u, tree, rest, 1);
  assert.ok(sat.solid && !sat.live && Math.abs(sat.d - (tree.d + TREE.rest)) < 1e-9);
  place(u, w, tree.s - 4, sat.d + 0.6, 8);
  const ev2 = run(u, 0.6);
  assert.ok(!ev2.some((e) => e.t === 'hit'), 'no spin off it at rest');
  assert.ok(Math.hypot(w.x - pointAt(t, tree.s, sat.d).x, w.z - pointAt(t, tree.s, sat.d).z) >= tree.r + KART_R - 0.05, 'bounced off');
});

test('a CPU at the crossing stops short of the bus and waits, then goes; down Memorial Church straight it keeps out of the oncoming lane', () => {
  // a skilled CPU coming up to the crossing just as the bus is about to go across in front of it
  const r = createRace({ cc: '150cc', course: 'hoover', seed: 3, countdown: 0, racers: [RIVALS[0]] });
  const [k] = r.karts;
  k.ai!.skill = 1;
  const h = find(r, 'shuttle', (x) => x.speed! > 0);
  r.hazards = r.hazards.filter((x) => x === h);
  const enter = nextCrossing(r, h, 40);
  // it would get there right as the middle of the bus does
  const runH = shuttleRun(r, h);
  const v = 24;
  setTime(r, enter + (runH.from - runH.half - r.track.edge) / Math.abs(runH.v) - 40 / v + 1.2);
  place(r, k, h.s - 40, 0, v);
  let slowest = Infinity;
  const evs = run(r, 7, () => (slowest = Math.min(slowest, k.v)));
  assert.ok(!evs.some((e) => e.t === 'haz' || e.t === 'hit'), 'never hit');
  assert.ok(deltaS(r.track, h.s, k.s) > 20, 'went on');
  assert.ok(slowest < 12, `waited (slowest ${slowest.toFixed(1)} m/s)`);

  // down the straight with a car coming the other way in the left lane: a CPU starting in that lane gets over and by
  const s = createRace({ cc: '150cc', course: 'hoover', seed: 4, countdown: 0, racers: [RIVALS[1]] });
  const [q] = s.karts;
  q.ai!.skill = 0.9;
  const car = find(s, 'car', (x) => x.phase === 0);
  s.hazards = s.hazards.filter((x) => x === car);
  setTime(s, 160 + 20 / Math.abs(car.drive!));
  const cs = hazardS(s.track, car, s.time);
  place(s, q, cs - 70, car.d, 24);
  const ev2 = run(s, 3);
  assert.ok(!ev2.some((e) => e.t === 'haz' || e.t === 'hit'), 'got by');
});

test('nobody is set down in front of oncoming traffic or on the crossing with the bus coming', () => {
  const r = hoover();
  const k = r.karts[0];
  const car = find(r, 'car', (x) => x.phase === 0);
  setTime(r, 160 + 30 / Math.abs(car.drive!));
  const cs = hazardS(r.track, car, r.time);
  k.s = cs - 12;
  k.d = car.d;
  rescue(r, k);
  const at = locate(r.track, k.x, k.z);
  assert.ok(Math.abs(at.d - car.d) > car.r + KART_R + 1 - 0.01, `set down in its lane at d=${at.d.toFixed(2)}`);
  // and at the crossing
  const s = hoover();
  const q = s.karts[0];
  const h = find(s, 'shuttle', (x) => x.speed! > 0);
  const enter = nextCrossing(s, h, 40);
  setTime(s, enter - 0.2);
  q.s = h.s - 1;
  q.d = -3;
  rescue(s, q);
  const qa = locate(s.track, q.x, q.z);
  assert.ok(deltaS(s.track, qa.s, h.s) > 8 || deltaS(s.track, qa.s, h.s) < -4, `set down ${deltaS(s.track, qa.s, h.s).toFixed(1)} m before the crossing`);
});

test('the lap banner tells of the van, the fountain jets, the second crossing and the lights going out', () => {
  const laps = COURSES.hoover.laps!;
  assert.match(laps[3], /van/);
  assert.match(laps[4], /[Ff]ountain/);
  assert.match(laps[4], /crossing/);
  assert.match(laps[5], /lights out/);
});
