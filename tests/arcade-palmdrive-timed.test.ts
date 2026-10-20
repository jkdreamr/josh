import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { BANK, CLASSES, GREEN_V, HAMMER, JET, KART_R, RIVALS, cpuLane, createRace, hazSpans, hazState, hazardD, hazardS, moveHazards, rescue, rightOfWay, spanGone, spawn, step, trafficD, type Ev, type Kart, type LiveHazard, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { BUS_LEN, cycleAt, deltaS, drives, headingOf, lengthOf, locate, pointAt, solid, timed, type Hazard } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

/** A race at Hoover Nights, past the lights, with n hand-driven karts. */
function hoover(n = 1, seed = 5, cc: '100cc' | '150cc' | '200cc' = '100cc'): Race {
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

/** Sets the race clock so that hazard h is `c` seconds into its cycle (plus whole cycles past `from`). */
function atCycle(r: Race, h: Hazard, c: number, from = 20) {
  const every = h.every ?? 1;
  const base = from - cycleAt(h, from, every);
  r.time = base + every + c;
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

test('Hoover Nights has its set pieces where the plan puts them, and only it, the Skyway, the slough and the golf course have any', () => {
  const t = trackOf('hoover');
  const lay = COURSES.hoover.layout(t);
  const by = (kind: string) => lay.hazards.filter((h) => h.kind === kind).map((h) => Math.round(h.s));
  assert.deepEqual(by('hammer'), [153, 360, 372, 1068]);
  assert.deepEqual(by('wrecker'), [214, 642]);
  assert.deepEqual(by('rotor'), [440, 468]);
  assert.deepEqual(by('wet'), [445, 459, 474]);
  // the Claw's fountain jets from lap 4, the Tree, and the Marguerite crossing both ways
  assert.deepEqual(by('geyser'), [594, 606, 618]);
  assert.ok(lay.hazards.filter((h) => h.kind === 'geyser').every((h) => h.lap === 4 && h.d === -4.4 && h.every === 2.4 && h.on === 0.8 && h.warn === 0.8));
  assert.deepEqual(by('tether'), [913]);
  assert.deepEqual(by('shuttle'), [990, 990]);
  assert.deepEqual(by('bollard'), [100, 100, 100, 100, 548, 548, 548, 548]);
  // a row of banks covers the road wall to wall, rippling across
  for (const s of [100, 548]) {
    const row = lay.hazards.filter((h) => h.kind === 'bollard' && Math.round(h.s) === s).sort((a, b) => a.d - b.d);
    assert.equal(row.reduce((w, h) => w + (h.w ?? 0), 0), 2 * t.edge);
    assert.ok(Math.abs(row[0].d - (row[0].w ?? 0) / 2 + t.edge) < 1e-9 && Math.abs(row[3].d + (row[3].w ?? 0) / 2 - t.edge) < 1e-9);
    const phases = row.map((h) => h.phase);
    assert.deepEqual([...phases].sort((a, b) => a! - b!), [0, 0.8, 1.6, 2.4]);
    assert.ok(row.every((h) => h.lap === 2 && h.every === 3.2 && h.on === 1.6 && h.warn === 0.9));
  }
  assert.deepEqual([...new Set(lay.hazards.filter((h) => h.kind === 'bollard' && Math.round(h.s) === 100).map((h) => h.phase))].length, 4);
  // the laps they come in on
  const lapOf = (kind: string, s: number) => lay.hazards.find((h) => h.kind === kind && Math.round(h.s) === s)?.lap;
  assert.deepEqual([lapOf('hammer', 153), lapOf('hammer', 360), lapOf('hammer', 372), lapOf('hammer', 1068)], [undefined, undefined, 5, 3]);
  assert.deepEqual([lapOf('rotor', 440), lapOf('rotor', 468), lapOf('wet', 445)], [2, 2, 3]);
  // the two balls swing opposite ways to the two rotors' spin, and the double pile driver is on opposite beats
  const h2 = lay.hazards.find((h) => h.kind === 'hammer' && Math.round(h.s) === 360)!;
  const h3 = lay.hazards.find((h) => h.kind === 'hammer' && Math.round(h.s) === 372)!;
  assert.ok(Math.abs(Math.abs((h2.phase ?? 0) - (h3.phase ?? 0)) - 1.8) < 1e-9);
  // (the golf course has its geese and its mower: see the golf tests)
  for (const id of COURSE_IDS) if (id !== 'hoover' && id !== 'skyway' && id !== 'slough' && id !== 'golf') assert.ok(COURSES[id].layout(trackOf(id)).hazards.every((h) => !timed(h.kind) && h.kind !== 'wet'), `${id} has no set pieces`);
  assert.ok(timed('hammer') && timed('bollard') && timed('wrecker') && timed('rotor') && !timed('wet') && !timed('bike'));
  assert.ok(solid('hammer') && solid('bollard') && solid('rotor') && solid('wrecker') && !solid('wet'));
});

test('A10.1 purity: two races built apart agree about every set piece at every moment, on every lap', () => {
  const a = hoover(1, 1);
  const b = hoover(1, 77);
  for (let i = 0; i < a.hazards.length; i++) {
    const h = a.hazards[i];
    if (!timed(h.kind) && h.kind !== 'wet') continue;
    for (const time of [0, 1.7, 33.3, 100.1, 201.4]) {
      for (let lap = 1; lap <= 5; lap++) {
        assert.deepEqual(hazState(a, h, time, lap), hazState(b, b.hazards[i], time, lap), `${h.kind} at ${h.s} t=${time} lap ${lap}`);
        for (const ds of [0, 2, -3.5]) assert.deepEqual(hazSpans(a, h, time, lap, ds), hazSpans(b, b.hazards[i], time, lap, ds));
      }
    }
  }
  // and the state depends on nothing but the clock and the lap: stepping a race changes nothing about it
  const c = hoover(1, 5);
  const before = c.hazards.filter((h) => timed(h.kind)).map((h) => hazState(c, h, 50, 2));
  run(c, 1);
  assert.deepEqual(c.hazards.filter((h) => timed(h.kind)).map((h) => hazState(c, h, 50, 2)), before);
});

test('A10.2 a way through always exists: at every set piece, at every instant, on every lap, with the buses driving', () => {
  const r = hoover();
  const t = r.track;
  // (the Marguerite crossing shuts the road for a moment as it goes over, by design: see the crossing's own test)
  const pieces = r.hazards.filter((h) => timed(h.kind) && h.kind !== 'shuttle');
  const buses = r.hazards.filter((h) => drives(h));
  /** The lines across the road to check: each piece's own, and a rotor's either side of its hub. */
  const lines = [...new Set(pieces.flatMap((h) => (h.kind === 'rotor' ? [h.s - 4, h.s - 2, h.s, h.s + 2, h.s + 4] : [h.s])))];
  let narrowest = Infinity;
  let where = '';
  for (let lap = 1; lap <= 5; lap++) {
    for (let time = 0; time <= 240; time += 0.02) {
      for (const s of lines) {
        const i = Math.round(s / t.step) % t.n;
        const spans: [number, number][] = [];
        for (const h of pieces) {
          const ds = deltaS(t, h.s, s);
          if (Math.abs(ds) > Math.max(h.r, h.arm ?? 0) + 1) continue;
          spans.push(...hazSpans(r, h, time, lap, ds));
        }
        for (const b of buses) {
          if (b.span && spanGone(b, time)) continue;
          const ds = deltaS(t, hazardS(t, b, time), s);
          if (Math.abs(ds) < lengthOf(b) / 2) spans.push([trafficD(b, time) - b.r, trafficD(b, time) + b.r]);
        }
        const gap = widest(t.lo[i], t.hi[i], spans);
        if (gap < narrowest) {
          narrowest = gap;
          where = `s=${s.toFixed(1)} t=${time.toFixed(2)} lap ${lap}`;
        }
      }
    }
  }
  assert.ok(narrowest >= 2.6, `only ${narrowest.toFixed(2)} m left at ${where}`);
});

test('A10.4 the Marguerite has right of way: a set piece stands aside while a bus is near it', () => {
  const r = hoover();
  const t = r.track;
  // (the crossing Marguerite sits out a crossing a bus would meet instead: see its own test)
  const pieces = r.hazards.filter((h) => timed(h.kind) && h.kind !== 'shuttle');
  const buses = r.hazards.filter((h) => drives(h) && !h.span);
  let yields = 0;
  for (let time = 0; time <= 240; time += 0.05) {
    for (const h of pieces) {
      const near = buses.some((b) => Math.abs(deltaS(t, hazardS(t, b, time), h.s)) < BUS_LEN / 2 + (h.kind === 'bollard' ? h.w! : h.r) + 6);
      assert.equal(rightOfWay(r, h, time), near, `${h.kind} at ${h.s} t=${time}`);
      if (!near) continue;
      yields++;
      for (let lap = 1; lap <= 5; lap++) {
        const st = hazState(r, h, time, lap);
        assert.ok(!st.live, `${h.kind} at ${h.s} live with a bus beside it at t=${time}`);
        // (the rotor's hub still stands, and the Tree sits by its post; nothing else is in the way)
        assert.equal(st.solid, h.kind === 'rotor' || h.kind === 'tether');
        if (h.kind === 'tether') assert.equal(st.d, h.d + 1.2, 'sat by its post');
        if (h.kind === 'hammer' || h.kind === 'wrecker') assert.equal(st.lift, 1, 'hauled up');
        if (h.kind === 'bollard') assert.equal(st.lift, 0, 'down');
      }
    }
  }
  assert.ok(yields > 100, 'the buses do come by');
  // a shell flies on under a hammer hauled up for a bus, where it would have broken
  const h = find(r, 'hammer', (x) => Math.abs(x.s - 153) < 1);
  const bus = buses.find((b) => deltaS(t, b.s, h.s) < 0)!;
  const when = ((h.s - bus.s + t.length) % t.length) / bus.drive!;
  r.time = when;
  moveHazards(r);
  assert.ok(rightOfWay(r, h, r.time));
  const k = r.karts[0];
  place(r, k, h.s - 80, 0, 0);
  const from = pointAt(t, h.s - 14, h.d);
  const shell = spawn(r, { kind: 'green', owner: 0, x: from.x, z: from.z, y: 0.35, vx: from.tx * GREEN_V, vz: from.tz * GREEN_V, vy: 0, grace: 9, target: -1, prog: 0 });
  run(r, 0.3);
  assert.ok(r.things.some((th) => th.id === shell.id), 'flew on');
});

test('A10.5 lap gating: the banks, the jets, the wet road and the later hammers are not there until their lap, each kart on its own lap', () => {
  const r = hoover();
  const over = (h: Hazard, lap: number, what: (st: ReturnType<typeof hazState>) => boolean) => {
    // (three cycles: a bus goes by the north row at t=33, and after one the piece waits for a beat it can telegraph in full)
    for (let time = 30; time < 30 + 3 * (h.every ?? 3); time += 0.02) if (what(hazState(r, h, time, lap))) return true;
    return false;
  };
  for (const h of r.hazards) {
    // (traffic runs on the clock for everyone alike, whatever lap: see the traffic tests)
    if ((!timed(h.kind) && h.kind !== 'wet') || h.kind === 'shuttle') continue;
    const from = h.lap ?? 1;
    for (let lap = 1; lap <= 5; lap++) {
      const live = over(h, lap, (st) => st.live);
      assert.equal(live, lap >= from, `${h.kind} at ${h.s} on lap ${lap}`);
      if (lap < from) {
        const st = hazState(r, h, 31, lap);
        assert.equal(st.phase, 'off');
        // asleep: the hammer parked high, the bank flush, the hub capped but standing
        if (h.kind === 'hammer') assert.equal(st.lift, 1);
        if (h.kind === 'bollard') assert.equal(st.lift, 0);
        assert.equal(st.solid, h.kind === 'rotor' || h.kind === 'tether');
      }
    }
  }
  // the same bank squashes a kart on lap 2 and is nothing to one on lap 1, at the same moment
  for (const lap of [1, 2]) {
    const s = hoover();
    const k = s.karts[0];
    const bank = find(s, 'bollard', (h) => Math.abs(h.s - 100) < 1 && Math.abs(h.d + 2.125) < 0.1);
    k.lap = lap;
    atCycle(s, bank, 0.6);
    place(s, k, bank.s - 10, bank.d, 20);
    const evs = run(s, 0.8);
    assert.equal(evs.some((e) => e.t === 'haz' && e.kind === 'bollard'), lap === 2, `lap ${lap}`);
    assert.equal(deltaS(s.track, bank.s, k.s) > 1, lap === 1, `lap ${lap}: ${lap === 1 ? 'through' : 'held back'}`);
  }
});

test('A10.9 same view: a skilled CPU takes a lane that misses the set pieces when it gets there, nearly every time', () => {
  const r = createRace({ cc: '150cc', course: 'hoover', seed: 11, countdown: 0, racers: [RIVALS[0]] });
  const t = r.track;
  const [k] = r.karts;
  k.ai!.skill = 1;
  const pieces = r.hazards.filter((h) => timed(h.kind));
  const rand = (() => {
    let a = 12345;
    return () => ((a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  })();
  const v = CLASSES['150cc'].top;
  let n = 0;
  let clean = 0;
  while (n < 2000) {
    const h = pieces[Math.floor(rand() * pieces.length)];
    const back = 8 + rand() * 32;
    r.time = 20 + rand() * 200;
    moveHazards(r);
    k.lap = Math.max(h.lap ?? 1, 1 + Math.floor(rand() * 5));
    place(r, k, h.s - back, (rand() - 0.5) * 8, v);
    k.ai!.errLap = 0;
    const dodge = cpuLane(r, k);
    if (!dodge) continue;
    n++;
    const lane = dodge.lane * t.half;
    const when = dodge.wait ? back / Math.max(6, v - 7) : back / v;
    const offs = h.kind === 'rotor' ? [-0.7 * (h.arm ?? 5), 0, 0.7 * (h.arm ?? 5)] : [0];
    let hit = false;
    for (const o of offs) for (const [lo, hi] of hazSpans(r, h, r.time + when + o / v, k.lap, o)) if (lane + KART_R > lo && lane - KART_R < hi) hit = true;
    if (!hit) clean++;
  }
  assert.ok(clean / n >= 0.95, `${((clean / n) * 100).toFixed(1)}% clean`);

  // and a kart at a crawl (put back behind a bank, thrown by the ball) that sets off from there: the lane it takes misses
  // the piece the whole time it is going over or under it, from its nose reaching it to its tail leaving it
  const top = CLASSES['150cc'].top;
  const a = CLASSES['150cc'].accel;
  let slow = 0;
  let slowClean = 0;
  while (slow < 1000) {
    const h = pieces[Math.floor(rand() * pieces.length)];
    const back = 5 + rand() * 15;
    const v0 = 1 + rand() * 6;
    r.time = 20 + rand() * 200;
    moveHazards(r);
    k.lap = Math.max(h.lap ?? 1, 1 + Math.floor(rand() * 5));
    place(r, k, h.s - back, (rand() - 0.5) * 8, v0);
    k.ai!.errLap = 0;
    const dodge = cpuLane(r, k);
    if (!dodge) continue;
    slow++;
    const lane = dodge.lane * t.half;
    const speed = dodge.wait ? 6 : top;
    /** Where the kart is (meters on from where it set off) `u` seconds on, getting up to `speed` from v0. */
    const at = (u: number) => {
      const tr = Math.max(0, (speed - v0) / a);
      return u <= tr ? v0 * u + 0.5 * a * u * u : v0 * tr + 0.5 * a * tr * tr + speed * (u - tr);
    };
    const ext = h.kind === 'rotor' ? (h.arm ?? 5) : h.kind === 'bollard' ? BANK.thick : h.r;
    let hit = false;
    for (let u = 0; u < 6 && !hit; u += 0.02) {
      const o = at(u) - back;
      if (o > ext + KART_R) break;
      // (the stretch of the kart's length over the piece's lines, nose to tail)
      for (let along = -KART_R; along <= KART_R && !hit; along += 0.35) {
        const line = o + along;
        if (Math.abs(line) > ext) continue;
        for (const [lo, hi] of hazSpans(r, h, r.time + u, k.lap, line)) if (lane + KART_R > lo && lane - KART_R < hi) hit = true;
      }
    }
    if (!hit) slowClean++;
  }
  assert.ok(slowClean / slow >= 0.95, `from a crawl: ${((slowClean / slow) * 100).toFixed(1)}% clean`);
});

test('a pile driver: flattened under the head as it comes down, bounced off it (and squashed, hitting it hard) while it is down, free to pass while it hovers', () => {
  const r = hoover();
  const k = r.karts[0];
  const h = find(r, 'hammer', (x) => Math.abs(x.s - 153) < 1);
  assert.equal(h.r, 1.7);
  // parked under it just before it drops
  atCycle(r, h, (h.every ?? 3.6) - 0.05);
  place(r, k, h.s, h.d, 0);
  k.input.brake = true;
  const evs = run(r, 0.3);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'hammer' && e.k === k.idx), 'caught');
  assert.ok(evs.some((e) => e.t === 'hit' && e.how === 'squash' && e.by === -1), 'flattened');
  assert.ok(hazState(r, h, r.time, 1).solid, 'down now');
  // driving into it while it is down (the one on the causeway, on the straight): it is solid, and hitting it that hard
  // squashes you against it
  const s = hoover();
  const q = s.karts[0];
  const h2 = find(s, 'hammer', (x) => Math.abs(x.s - 360) < 1);
  atCycle(s, h2, HAMMER.slam + 0.05);
  place(s, q, h2.s - 10, h2.d, 20);
  let closest = Infinity;
  const ev2 = run(s, 0.6, () => (closest = Math.min(closest, Math.hypot(q.x - h2.x, q.z - h2.z))));
  assert.ok(closest >= h2.r + KART_R - 0.05, `got within ${closest}`);
  assert.ok(ev2.some((e) => e.t === 'haz' && e.kind === 'hammer'), 'squashed against it');
  assert.ok(deltaS(s.track, q.s, h2.s) > 0, 'held before it');
  // and while it hovers you drive straight under it
  const u = hoover();
  const w = u.karts[0];
  const h3 = find(u, 'hammer', (x) => Math.abs(x.s - 360) < 1);
  atCycle(u, h3, HAMMER.slam + HAMMER.on + HAMMER.lift + 0.1);
  assert.ok(!hazState(u, h3, u.time, 1).live && !hazState(u, h3, u.time, 1).solid);
  place(u, w, h3.s - 10, h3.d, 20);
  const ev3 = run(u, 0.6);
  assert.ok(!ev3.some((e) => e.t === 'haz' || e.t === 'hit' || e.t === 'wall'), 'clean through');
  assert.ok(deltaS(u.track, h3.s, w.s) > 1, 'past it');
  // the telegraph: it shakes for the last part of the hover, and the cycle adds up
  assert.ok(HAMMER.slam + HAMMER.on + HAMMER.lift + HAMMER.warn <= HAMMER.every);
  atCycle(u, h3, (h3.every ?? 3.6) - 0.2);
  const late = hazState(u, h3, u.time, 1);
  assert.ok(late.warn > 0.5 && late.warn <= 1 && late.phase === 'idle' && !late.live, `warn ${late.warn} ${late.phase}`);
  // stars and megas drive on through, and a hop does not help
  for (const power of ['star', 'mega'] as const) {
    const p = hoover();
    const pk = p.karts[0];
    pk[power] = 3;
    const ph = find(p, 'hammer', (x) => Math.abs(x.s - 360) < 1);
    atCycle(p, ph, HAMMER.slam + 0.05);
    place(p, pk, ph.s - 10, ph.d, 20);
    assert.ok(!run(p, 0.6).some((e) => e.t === 'haz' || e.t === 'hit'), `${power} untouched`);
  }
  const j = hoover();
  const jk = j.karts[0];
  const jh = find(j, 'hammer', (x) => Math.abs(x.s - 360) < 1);
  atCycle(j, jh, HAMMER.slam + 0.05);
  place(j, jk, jh.s - 3, jh.d, 20);
  jk.y = 0.4;
  jk.vy = 2;
  assert.ok(run(j, 0.3).some((e) => e.t === 'haz' && e.kind === 'hammer'), 'hit in the air');
});

test('a bank of bollards: squashed and stopped behind it while it is up, tumbled if it pops up under you, nothing while it is flush; a hop does not clear it', () => {
  const r = hoover();
  const k = r.karts[0];
  k.lap = 2;
  const bank = find(r, 'bollard', (h) => Math.abs(h.s - 100) < 1 && Math.abs(h.d + 2.125) < 0.1);
  atCycle(r, bank, BANK.rise + 0.2);
  place(r, k, bank.s - 10, bank.d, 20);
  const evs = run(r, 0.8);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'bollard' && e.k === k.idx));
  assert.ok(evs.some((e) => e.t === 'hit' && e.how === 'squash'));
  assert.ok(deltaS(r.track, k.s, bank.s) > BANK.thick, 'put back behind the line');
  assert.ok(k.v < 3.5, `nearly stopped: ${k.v}`);
  // popping up under a kart sitting on it
  const s = hoover();
  const q = s.karts[0];
  q.lap = 2;
  const b2 = find(s, 'bollard', (h) => Math.abs(h.s - 100) < 1 && Math.abs(h.d + 2.125) < 0.1);
  atCycle(s, b2, (b2.every ?? 3.2) - 0.05);
  place(s, q, b2.s, b2.d, 0);
  q.input.brake = true;
  const ev2 = run(s, 0.3);
  assert.ok(ev2.some((e) => e.t === 'hit' && e.how === 'tumble') && ev2.some((e) => e.t === 'haz' && e.kind === 'bollard'), 'tumbled');
  // flush: nothing
  const u = hoover();
  const w = u.karts[0];
  w.lap = 2;
  const b3 = find(u, 'bollard', (h) => Math.abs(h.s - 100) < 1 && Math.abs(h.d + 2.125) < 0.1);
  atCycle(u, b3, BANK.rise + BANK.on + BANK.fall + 0.1);
  place(u, w, b3.s - 10, b3.d, 20);
  assert.ok(!run(u, 0.6).some((e) => e.t === 'haz' || e.t === 'hit'), 'through');
  assert.ok(deltaS(u.track, b3.s, w.s) > 1);
  // the rest of the row is up and down by turns: with this bank up its neighbour across the gap is down
  const row = u.hazards.filter((h) => h.kind === 'bollard' && Math.abs(h.s - 100) < 1);
  atCycle(u, b3, BANK.rise + 0.3);
  const up = row.filter((h) => hazState(u, h, u.time, 2).solid);
  assert.ok(up.length >= 1 && up.length <= 3, `${up.length} banks up`);
  // a hop does not clear a bank standing up
  const j = hoover();
  const jk = j.karts[0];
  jk.lap = 2;
  const b4 = find(j, 'bollard', (h) => Math.abs(h.s - 100) < 1 && Math.abs(h.d + 2.125) < 0.1);
  atCycle(j, b4, BANK.rise + 0.2);
  place(j, jk, b4.s - 3, b4.d, 20);
  jk.y = 0.5;
  jk.vy = 2;
  assert.ok(run(j, 0.3).some((e) => e.t === 'haz' && e.kind === 'bollard'), 'hit in the air');
  // a star ploughs through
  const p = hoover();
  const pk = p.karts[0];
  pk.lap = 2;
  pk.star = 3;
  const b5 = find(p, 'bollard', (h) => Math.abs(h.s - 100) < 1 && Math.abs(h.d + 2.125) < 0.1);
  atCycle(p, b5, BANK.rise + 0.2);
  place(p, pk, b5.s - 10, b5.d, 20);
  assert.ok(!run(p, 0.6).some((e) => e.t === 'haz' || e.t === 'hit'));
  assert.ok(deltaS(p.track, b5.s, pk.s) > 1, 'through');
});

test('a sprinkler: the hub is solid from the first lap, and from its lap the jet spins whoever it sweeps over, in the air too', () => {
  const r = hoover();
  const k = r.karts[0];
  const rotor = find(r, 'rotor', (h) => Math.abs(h.s - 440) < 1);
  assert.equal(rotor.lap, 2);
  // into the hub on lap 1: a bump, no spin
  place(r, k, rotor.s - 10, rotor.d, 20);
  let closest = Infinity;
  const evs = run(r, 0.6, () => (closest = Math.min(closest, Math.hypot(k.x - rotor.x, k.z - rotor.z))));
  assert.ok(closest >= rotor.r + KART_R - 0.05, `got within ${closest}`);
  assert.ok(evs.some((e) => e.t === 'wall') && !evs.some((e) => e.t === 'hit'));
  // the jet pointing to the right, a kart sitting in it: spun on lap 2, dry on lap 1
  for (const lap of [1, 2]) {
    const s = hoover();
    const q = s.karts[0];
    q.lap = lap;
    const ro = find(s, 'rotor', (h) => Math.abs(h.s - 440) < 1);
    s.time = 20 + ((Math.PI / 2 - (ro.a0 ?? 0) - (ro.spin ?? 0) * 20) % (2 * Math.PI)) / (ro.spin ?? 1);
    while (s.time < 20) s.time += (2 * Math.PI) / Math.abs(ro.spin ?? 1);
    moveHazards(s);
    const st = hazState(s, ro, s.time, lap);
    assert.ok(Math.abs(Math.sin(st.ang) - 1) < 1e-6, 'arm to the right');
    assert.equal(st.live, lap === 2);
    // the spans say the same: the jet across the right half, the hub in the middle
    const spans = hazSpans(s, ro, s.time, lap);
    place(s, q, ro.s, 3, 0);
    q.input.brake = true;
    const got = run(s, 0.2).some((e) => e.t === 'haz' && e.kind === 'rotor');
    assert.equal(got, lap === 2, `lap ${lap}`);
    assert.ok(spans.some(([lo, hi]) => lo < -0.5 && hi > 0.5), 'the hub');
    assert.equal(spans.some(([lo, hi]) => lo < 3 && hi > 3), lap === 2, 'the jet');
    if (lap === 2) assert.ok(spans.every(([lo]) => lo > -1), 'the left side is clear');
  }
  // a hop does not clear the jet
  const j = hoover();
  const jk = j.karts[0];
  jk.lap = 2;
  const jr = find(j, 'rotor', (h) => Math.abs(h.s - 440) < 1);
  j.time = 20 + ((Math.PI / 2 - (jr.a0 ?? 0) - (jr.spin ?? 0) * 20) % (2 * Math.PI)) / (jr.spin ?? 1);
  while (j.time < 20) j.time += (2 * Math.PI) / Math.abs(jr.spin ?? 1);
  moveHazards(j);
  place(j, jk, jr.s, 3, 0);
  jk.y = 0.6;
  jk.vy = 3;
  jk.input.brake = true;
  assert.ok(run(j, 0.1).some((e) => e.t === 'haz' && e.kind === 'rotor'));
  assert.ok(JET.high > 1);
  // the arm sweeps right round: the side the jet is on swaps
  const w = hoover();
  const wr = find(w, 'rotor', (h) => Math.abs(h.s - 440) < 1);
  // (at a time with no bus about: the jet stands aside for one)
  const sides = new Set<number>();
  for (let time = 60; time < 64; time += 0.05) for (const [lo, hi] of hazSpans(w, wr, time, 2, 3)) if (Math.abs(lo + hi) > 1) sides.add(Math.sign((lo + hi) / 2));
  assert.deepEqual([...sides].sort(), [-1, 1]);
});

test('a wrecking ball: swings across on the clock, tumbles you and throws you clear; hauled up for a bus', () => {
  const r = hoover();
  const k = r.karts[0];
  const ball = find(r, 'wrecker', (h) => Math.abs(h.s - 214) < 1);
  assert.ok(ball.swing && ball.speed);
  // the ball swinging through the middle toward the right, with a kart parked in its way
  r.time = 20 + ((2 * Math.PI - ((ball.speed! * 20 + (ball.phase ?? 0)) % (2 * Math.PI))) % (2 * Math.PI)) / ball.speed!;
  moveHazards(r);
  assert.ok(Math.abs(ball.at - ball.d) < 0.05 && hazardD(ball, r.time + 0.01) > ball.at, 'through the middle, going right');
  place(r, k, ball.s, ball.d + ball.r + KART_R + 1.2, 0);
  k.input.brake = true;
  const from = { x: k.x, z: k.z };
  const evs = run(r, 0.5);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'wrecker' && e.k === k.idx), 'hit');
  assert.ok(evs.some((e) => e.t === 'hit' && e.how === 'tumble'), 'tumbled');
  assert.ok(Math.hypot(k.x - from.x, k.z - from.z) > 1, 'thrown clear');
  // the same on every screen
  const b = hoover(1, 77);
  b.time = r.time;
  moveHazards(b);
  const twin = find(b, 'wrecker', (h) => Math.abs(h.s - 214) < 1);
  assert.deepEqual([twin.x, twin.z, twin.at], [ball.x, ball.z, ball.at]);
  // hauled up while a bus goes by underneath: a kart in its path is untouched
  const s = hoover();
  const q = s.karts[0];
  const w2 = find(s, 'wrecker', (h) => Math.abs(h.s - 214) < 1);
  const bus = s.hazards.find((h) => h.kind === 'bus' && deltaS(s.track, h.s, w2.s) > 0)!;
  const when = ((w2.s - bus.s + s.track.length) % s.track.length) / bus.drive!;
  s.time = when;
  moveHazards(s);
  const st = hazState(s, w2, s.time, 1);
  assert.ok(!st.live && st.lift === 1 && st.phase === 'idle');
  assert.deepEqual(hazSpans(s, w2, s.time, 1), []);
  place(s, q, w2.s, -5, 0);
  q.input.brake = true;
  assert.ok(!run(s, 0.4).some((e) => e.t === 'haz'), 'nothing swinging');
});

test('wet road: the kart turns less (a drift less so) and charges a mini-turbo slower, but loses no speed; dry on lap 1 and 2', () => {
  const turned = (lap: number, drift: boolean) => {
    const r = hoover(1, 5, '150cc');
    const k = r.karts[0];
    k.lap = lap;
    const wet = find(r, 'wet', (h) => Math.abs(h.s - 459) < 1);
    place(r, k, wet.s - 2, wet.d, 24);
    const h0 = k.h;
    let top = 0;
    let soaked = false;
    run(r, 0.3, () => {
      k.input.steer = -1;
      if (drift) {
        k.drift = -1;
        k.input.drift = true;
      }
      top = Math.max(top, k.v);
      soaked ||= k.wet;
    });
    return { turn: Math.abs(k.h - h0), charge: k.charge, soaked, top };
  };
  const dry = turned(2, false);
  const wet = turned(3, false);
  assert.ok(!dry.soaked && wet.soaked);
  assert.ok(Math.abs(wet.turn / dry.turn - 0.7) < 0.08, `turned ${wet.turn.toFixed(3)} against ${dry.turn.toFixed(3)} dry`);
  assert.ok(wet.top >= dry.top - 0.01, 'no slower');
  const dryD = turned(1, true);
  const wetD = turned(3, true);
  assert.ok(Math.abs(wetD.turn / dryD.turn - 0.85) < 0.08, `drift turned ${wetD.turn.toFixed(3)} against ${dryD.turn.toFixed(3)}`);
  assert.ok(Math.abs(wetD.charge / dryD.charge - 0.8) < 0.08, `charge ${wetD.charge} against ${dryD.charge}`);
  assert.equal(hazState(hoover(), find(hoover(), 'wet'), 10, 3).live, true);
  assert.deepEqual(hazSpans(hoover(), find(hoover(), 'wet'), 10, 3), []);
});

test('shells break on a bank that is up, a hammer that is down and a sprinkler hub, and fly past a flush bank, a hovering hammer and the jet', () => {
  const fire = (r: Race, s: number, d: number) => {
    const from = pointAt(r.track, s, d);
    r.karts[0].lap = 5;
    place(r, r.karts[0], s - 60, -5, 0);
    return spawn(r, { kind: 'green', owner: 0, x: from.x, z: from.z, y: 0.35, vx: from.tx * GREEN_V, vz: from.tz * GREEN_V, vy: 0, grace: 9, target: -1, prog: 0 });
  };
  const gone = (r: Race, id: number) => !r.things.some((th) => th.id === id);
  for (const up of [true, false]) {
    const r = hoover();
    const bank = find(r, 'bollard', (h) => Math.abs(h.s - 100) < 1 && Math.abs(h.d + 2.125) < 0.1);
    atCycle(r, bank, up ? BANK.rise + 0.3 : BANK.rise + BANK.on + BANK.fall + 0.1);
    const shell = fire(r, bank.s - 14, bank.d);
    run(r, 0.5);
    assert.equal(gone(r, shell.id), up, `bank ${up ? 'up' : 'flush'}`);
  }
  for (const down of [true, false]) {
    const r = hoover();
    const h = find(r, 'hammer', (x) => Math.abs(x.s - 360) < 1);
    atCycle(r, h, down ? HAMMER.slam + 0.2 : HAMMER.slam + HAMMER.on + HAMMER.lift + 0.1);
    const shell = fire(r, h.s - 14, h.d);
    run(r, 0.4);
    assert.equal(gone(r, shell.id), down, `hammer ${down ? 'down' : 'hovering'}`);
  }
  {
    const r = hoover();
    const ro = find(r, 'rotor', (h) => Math.abs(h.s - 440) < 1);
    // (from close by: the road bends here, and a shell flies straight)
    const shell = fire(r, ro.s - 6, ro.d);
    run(r, 0.3);
    assert.ok(gone(r, shell.id), 'the hub');
    // through the jet, beside the hub
    const s = hoover();
    const r2 = find(s, 'rotor', (h) => Math.abs(h.s - 440) < 1);
    s.time = 20 + ((Math.PI / 2 - (r2.a0 ?? 0) - (r2.spin ?? 0) * 20) % (2 * Math.PI)) / (r2.spin ?? 1);
    while (s.time < 20) s.time += (2 * Math.PI) / Math.abs(r2.spin ?? 1);
    moveHazards(s);
    const sh = fire(s, r2.s - 6, 3);
    run(s, 2 * DT);
    assert.ok(hazState(s, r2, s.time, 5).live, 'the jet is on');
    run(s, 0.3);
    assert.ok(!gone(s, sh.id), 'through the jet');
  }
  // and on the ball
  const w = hoover();
  const ball = find(w, 'wrecker', (h) => Math.abs(h.s - 642) < 1);
  w.time = 20;
  moveHazards(w);
  const sh = fire(w, ball.s - 14, ball.at);
  run(w, 0.4);
  assert.ok(gone(w, sh.id), 'the ball');
});

test('set back down clear of the set pieces: never right in front of a hammer about to be down, nor on a bank about to rise', () => {
  const r = hoover();
  const k = r.karts[0];
  const h = find(r, 'hammer', (x) => Math.abs(x.s - 360) < 1);
  // the hammer is coming down for the next second or so: a kart put back just before it, in its lane, goes elsewhere
  atCycle(r, h, (h.every ?? 3.6) - 0.1);
  k.s = h.s - 4;
  k.d = 0;
  rescue(r, k);
  const at = locate(r.track, k.x, k.z);
  const ds = deltaS(r.track, at.s, h.s);
  assert.ok(Math.abs(at.d) > h.r + KART_R + 1 - 0.01 || ds > 12 || ds < -2, `set down ${ds.toFixed(1)} m before it at d=${at.d.toFixed(2)}`);
  // a bank of bollards about to rise under the spot
  const s = hoover();
  const q = s.karts[0];
  q.lap = 2;
  const bank = find(s, 'bollard', (x) => Math.abs(x.s - 548) < 1 && Math.abs(x.d - 2.125) < 0.1);
  atCycle(s, bank, (bank.every ?? 3.2) - 0.3);
  q.s = bank.s - 3;
  q.d = bank.d;
  rescue(s, q);
  const qat = locate(s.track, q.x, q.z);
  const qds = deltaS(s.track, qat.s, bank.s);
  assert.ok(qds > 12 || qds < -2 || Math.abs(qat.d - bank.d) > (bank.w ?? 0) / 2 + KART_R + 1 - 0.01, `set down ${qds.toFixed(1)} m before the bank at d=${qat.d.toFixed(2)}`);
});

test('the CPUs plan round the set pieces: one that is early waits for a hammer to lift, and once it has it goes', () => {
  // a skilled CPU on the causeway with the hammer down for the next while and nothing else about: it slows (the hammer
  // lifts before it would get there having eased off), and takes the middle once it is up
  const r = createRace({ cc: '150cc', course: 'hoover', seed: 3, countdown: 0, racers: [RIVALS[0]] });
  const [k] = r.karts;
  k.ai!.skill = 1;
  const h = find(r, 'hammer', (x) => Math.abs(x.s - 360) < 1);
  r.hazards = r.hazards.filter((x) => x === h);
  atCycle(r, h, HAMMER.slam + 0.1, 40);
  // boxed into the hammer's lane by the band (as the plates do on the causeway): no way round, only through
  place(r, k, h.s - 22, 0, 26);
  const dodge = cpuLane(r, k);
  assert.ok(dodge, 'sees it');
  assert.ok(Math.abs(dodge!.lane * r.track.half) > h.r + KART_R - 0.3 || dodge!.wait, `lane ${dodge!.lane}`);
  // left to drive, it does not hit it
  const evs = run(r, 2.5);
  assert.ok(!evs.some((e) => e.t === 'haz'), 'got past clean');
  assert.ok(deltaS(r.track, h.s, k.s) > 2, 'past it');
});
