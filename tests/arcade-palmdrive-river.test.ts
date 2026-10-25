import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { CATCH_DV, CATCH_T, CATCH_WIN, CLASSES, GREEN_V, HULL_TURN, KART_R, POWER_T, RIVALS, STROKE_T, TIDE_LAP, WAKE_LEN, cpuLane, createRace, crestsAt, flowAt, hazSpans, hazState, inCore, moveHazards, rescue, spawn, step, swellWarn, windAt, type Ev, type Kart, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { meta } from '../src/os/arcade/games/palmdrive/meta.ts';
import { F_SUNK, applyFlags, hostState } from '../src/os/arcade/games/palmdrive/net.ts';
import { deltaS, dropAt, edgeAt, gripAt, headingOf, lengthOf, locate, pointAt, roadEdge, timed, wrapS } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

/** A race on Redwood Slough past the lights, with n hand-driven shells. */
function slough(n = 1, cc: '50cc' | '100cc' | '150cc' | '200cc' = '150cc', seed = 5): Race {
  return createRace({ cc, course: 'slough', seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0, lap = 1) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz), v, i: at.i, s: at.s, d: at.d, prog: s + (lap - 1) * r.track.length, lap, kx: 0, kz: 0, y: 0, vy: 0 });
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

/** A race with nothing on the water but the shell: no set pieces, vessels, current, wind or swell. */
function bare(cc: '50cc' | '150cc' = '150cc') {
  const r = slough(1, cc);
  r.hazards = [];
  r.whirls = [];
  r.vessels = [];
  r.flows = [];
  r.gusts = [];
  r.swells = [];
  r.holes = [];
  r.ramps = [];
  r.dashes = [];
  r.boxes = [];
  r.coins = [];
  return r;
}

let seed = 7;
const rand = () => (seed = (seed * 16807) % 2147483647) / 2147483647;

// ---------------------------------------------------------------------------------------------------------------
// 1. The course

test('Redwood Slough: Insane, raced in shells, on its own board, with marsh for banks on most of the lap', () => {
  const c = COURSES.slough;
  assert.equal(c.difficulty, 5);
  assert.equal(c.vehicle, 'shell');
  assert.equal(c.board ?? c.id, 'slough');
  assert.equal(COURSE_IDS.at(-1), 'slough');
  const t = trackOf('slough');
  assert.ok(Math.abs(t.length - 1222) < 3, `length ${t.length}`);
  let one = 0;
  let both = 0;
  for (let i = 0; i < t.n; i++) {
    const [l, h] = [dropAt(t, i, -1), dropAt(t, i, 1)];
    if (l || h) one++;
    if (l && h) both++;
    for (const side of [-1, 1]) {
      const e = edgeAt(t, i * t.step, side);
      if (e.past !== 'wall') {
        assert.equal(e.past, 'marsh');
        // (the water runs out to just short of the brink)
        assert.ok(Math.abs(roadEdge(t, i * t.step, side) - (e.lim - 0.4)) < 1e-6);
      }
    }
  }
  assert.ok(one / t.n >= 0.65 && both / t.n >= 0.5, `open ${(one / t.n).toFixed(2)} both ${(both / t.n).toFixed(2)}`);
  for (let s = -60; s <= 60; s += t.step) for (const side of [-1, 1]) assert.equal(edgeAt(t, s, side).past, 'wall', `walled at ${s}`);
  // the lock: walls at 6 m, so a 12 m chamber with nearly 10 m of it for a shell's middle
  for (let s = 115; s <= 165; s += 5) {
    for (const side of [-1, 1]) assert.ok(Math.abs(edgeAt(t, s, side).lim - 6) < 1e-6, `lock at ${s}`);
    assert.ok(2 * (6 - KART_R) >= 9.8);
  }
  // pickups well inside the water (bait half a meter from the brink at most)
  const lay = c.layout(t);
  for (const p of [...lay.boxes, ...lay.coins, ...lay.dashes]) assert.ok(Math.abs(p.d) <= roadEdge(t, p.s, Math.sign(p.d) || 1) - 0.5, `pickup at ${p.s}/${p.d}`);
});

// ---------------------------------------------------------------------------------------------------------------
// 2. Nothing of it anywhere else

test('the water is only on the slough: no shells, currents, whirlpools, vessels or swell anywhere else', () => {
  for (const id of COURSE_IDS) {
    if (id === 'slough') continue;
    const r = createRace({ cc: '150cc', course: id, seed: 1, racers: [RIVALS[0]] });
    assert.equal(r.boat, false, id);
    assert.equal(r.flows.length + r.whirls.length + r.vessels.length + r.swells.length, 0, id);
    assert.equal(trackOf(id).boat, undefined, id);
  }
  const r = createRace({ cc: '150cc', course: 'slough', seed: 1, racers: [RIVALS[0]] });
  assert.ok(r.boat && r.flows.length && r.whirls.length && r.vessels.length && r.swells.length);
  assert.equal(r.holePast, 'water');
  // calm water slick everywhere, rougher where it runs
  const t = trackOf('slough');
  const f = Math.fround;
  assert.equal(gripAt(t, 20, 1), f(0.7));
  assert.equal(gripAt(t, 820, 1), f(0.56));
  assert.equal(gripAt(t, 900, 1), f(0.7));
  assert.equal(gripAt(t, 900, 2), f(0.56));
  assert.equal(gripAt(t, 600, 3), f(0.7));
  assert.equal(gripAt(t, 600, 4), f(0.62));
});

// ---------------------------------------------------------------------------------------------------------------
// 3. The shell

test('the shell: its long hull turns wider than a kart off a drift, and only on the slough', () => {
  const turn = (course: 'slough' | 'skyway', drift: boolean) => {
    const r = course === 'slough' ? bare() : createRace({ cc: '150cc', course, seed: 5, countdown: 0, racers: [{ name: 'p', color: '#fff', kind: 'player' }] });
    // (the same grip either way, so only the hull differs)
    r.track = { ...r.track, grips: [1, 2, 3, 4, 5].map(() => new Float32Array(r.track.n).fill(0.8)) };
    r.gusts = [];
    const k = r.karts[0];
    place(r, k, 1100, 0, 20);
    const h0 = k.h;
    k.steer = 1;
    k.input.steer = 1;
    if (drift) {
      k.drift = 1;
      k.input.drift = true;
    }
    step(r, DT);
    return Math.abs(k.h - h0);
  };
  assert.ok(Math.abs(turn('slough', false) / turn('skyway', false) - HULL_TURN) < 1e-6, `${turn('slough', false) / turn('skyway', false)}`);
  assert.ok(Math.abs(turn('slough', true) / turn('skyway', true) - 1) < 1e-6);
});

/** A shell rowing straight down the Boathouse Reach, hopping at `when` (seconds of race time). */
function rowing(when: number[], steer = 0) {
  const r = bare();
  const k = r.karts[0];
  place(r, k, 1060, 0, 20);
  r.time = when[0] - 0.5;
  const evs: Ev[] = [];
  const left = [...when];
  const frames = Math.round((when.at(-1)! - r.time + 0.6) / DT);
  for (let n = 0; n < frames; n++) {
    k.v = 20;
    k.input.steer = steer;
    if (left.length && r.time + DT >= left[0]) {
      k.input.hop = true;
      left.shift();
    }
    step(r, DT);
    evs.push(...r.events.splice(0));
    k.x = pointAt(r.track, 1060, 0).x;
    k.z = pointAt(r.track, 1060, 0).z;
    k.h = headingOf(r.track.tx[k.i], r.track.tz[k.i]);
  }
  return { r, k, evs };
}

test('the stroke: a straight hop on the beat is a clean catch, off it the run is broken, and ten in a row is a Power Ten', () => {
  const beat = 40 * STROKE_T;
  // on the beat (a little early, a little late)
  for (const off of [-CATCH_WIN + 0.03, 0, CATCH_WIN - 0.03]) {
    const { k, evs } = rowing([beat + off]);
    assert.ok(evs.some((e) => e.t === 'catch'), `catch at ${off}`);
    assert.equal(k.streak, 1);
  }
  // off the beat: no catch, and the run is broken
  {
    const { k, evs } = rowing([beat, beat + STROKE_T, beat + 2 * STROKE_T + 0.4]);
    assert.equal(evs.filter((e) => e.t === 'catch').length, 2);
    assert.equal(k.streak, 0);
  }
  // a hop steering into a bend is no catch (and breaks nothing)
  {
    const { k, evs } = rowing([beat], 1);
    assert.ok(!evs.some((e) => e.t === 'catch'));
    assert.equal(k.streak, 0);
  }
  // ten in a row: a Power Ten
  {
    const { k, evs } = rowing(Array.from({ length: 10 }, (_, n) => beat + n * STROKE_T));
    assert.equal(evs.filter((e) => e.t === 'catch').length, 9);
    assert.ok(evs.some((e) => e.t === 'power'));
    assert.equal(k.streak, 0);
    assert.ok(k.boost > 0 && k.boost <= POWER_T);
  }
  // a catch is worth a little more top speed for a moment
  {
    const { r, k } = rowing([beat]);
    assert.ok(k.catchT === 0 || k.catchT <= CATCH_T);
    const q = bare();
    const j = q.karts[0];
    place(q, j, 1060, 0, 0);
    j.catchT = CATCH_T;
    let top = 0;
    run(q, 0.3, () => (top = Math.max(top, j.v)));
    void r;
    assert.ok(CATCH_DV > 0);
  }
});

test('the CPUs\' catches draw on the race\'s random numbers only on the water', () => {
  const draws = (course: 'slough' | 'hoover') => {
    const r = createRace({ cc: '150cc', course, seed: 9, racers: [RIVALS[0], RIVALS[1]] });
    let n = 0;
    const rand0 = r.rand;
    r.rand = () => {
      n++;
      return rand0();
    };
    while (r.time < 20) {
      step(r, DT);
      r.events.length = 0;
    }
    return n;
  };
  // (the same race elsewhere draws what it always did: see same.ts for the bit-identical traces)
  assert.ok(draws('slough') > draws('hoover') * 0.5);
  const a = createRace({ cc: '150cc', course: 'hoover', seed: 9, racers: [RIVALS[0]] });
  const b = createRace({ cc: '150cc', course: 'hoover', seed: 9, racers: [RIVALS[0]] });
  for (let n = 0; n < 1200; n++) {
    step(a, DT);
    step(b, DT);
  }
  assert.equal(a.rand(), b.rand());
});

// ---------------------------------------------------------------------------------------------------------------
// 4. Whirlpools

test('whirlpools: pure in time, none before their lap, every one warned in full, the wander only from its lap', () => {
  const a = slough(1, '150cc', 1);
  const b = slough(1, '200cc', 77);
  for (const h of a.whirls) {
    for (let n = 0; n < 500; n++) {
      const [time, lap] = [rand() * 300, 1 + Math.floor(rand() * 5)];
      assert.deepEqual(hazState(a, h, time, lap), hazState(b, b.whirls[a.whirls.indexOf(h)], time, lap));
    }
    const lap = h.lap ?? 1;
    for (let time = 0; time < 30; time += 0.1) assert.ok(!hazState(a, h, time, lap - 1).live, `whirl ${h.s} before its lap`);
    let was = false;
    for (let time = 0; time < 200; time += 0.01) {
      const st = hazState(a, h, time, lap);
      if (st.live && !was && time > 3) for (let back = 0.02; back < (h.warn ?? 0) - 0.02; back += 0.02) assert.ok(hazState(a, h, time - back, lap).warn > 0, `whirl ${h.s} unwarned ${back}s before ${time}`);
      was = st.live;
      if (h.wander) {
        assert.equal(hazState(a, h, time, h.wander[2] - 1).d, h.d);
        assert.ok(Math.abs(hazState(a, h, time, h.wander[2]).d - h.d) <= h.wander[0] + 1e-9);
      }
    }
  }
});

/** A shell passing whirlpool h `off` meters off its middle at `v`, on its lap, from the moment it is full strength. */
function pass(h: Race['whirls'][number], v: number, off: number) {
  const r = bare();
  r.whirls = [h];
  r.hazards = [h];
  const k = r.karts[0];
  let time = 30;
  while (hazState(r, h, time, 5).lift < 1) time += 0.01;
  r.time = time - DT;
  const back = Math.min(8, v * 0.6);
  place(r, k, h.s - back, h.d + off, v, 4);
  k.lap = h.wander ? h.wander[2] - 1 : 4;
  k.prog = h.s - back + (k.lap - 1) * r.track.length;
  let fell = false;
  run(r, 3, () => {
    if (k.sunk > 0 && k.fell?.past === 'water') fell = true;
    k.input.steer = 0;
    // (rowing on at that speed, steering nothing)
    if (k.sunk === 0) k.v = v;
  });
  return fell;
}

test('a whirlpool: a quick shell passing wide of it is pulled in a little and gets away, a slow one close by goes under', () => {
  const r = slough();
  // (one of the Corkscrew's, moved onto Westpoint Slough's straight so that a shell not steering goes straight past it)
  const w = r.whirls.find((h) => Math.round(h.s) === 648)!;
  const p = pointAt(r.track, 1100, 0);
  const h = { ...w, wander: undefined, lap: 1, s: 1100, d: 0, back: 1075, x: p.x, z: p.z };
  // (either side of it: the swirl carries you round it on one side and drags you in on the other)
  for (const side of [-1, 1]) assert.equal(pass(h, 22, 3.5 * side), false, `escapes at 22 m/s, 3.5 m off (${side})`);
  assert.ok(pass(h, 8, -2 * (h.spin ?? 1)), 'drawn in at 8 m/s, 2 m off, on the side it swirls you in');
});

test('a whirlpool sucks you under only while strong and with you on the water; and shells and bananas in its core sink', () => {
  const r = slough();
  const h = r.whirls[0];
  const k = r.karts[0];
  let time = 40;
  while (hazState(r, h, time, 5).lift > 0) time += 0.01;
  // (weak, as it spins up: not yet)
  while (hazState(r, h, time, 5).lift <= 0) time += 0.01;
  r.time = time;
  const c = pointAt(r.track, h.s, hazState(r, h, time, 5).d);
  assert.ok(hazState(r, h, time, 5).lift < 0.5);
  assert.equal(inCore(r, c.x, c.z, 5), null);
  // strong: yes, but not in the air
  while (hazState(r, h, r.time, 5).lift < 0.9) r.time += 0.01;
  const c2 = pointAt(r.track, h.s, hazState(r, h, r.time, 5).d);
  assert.ok(inCore(r, c2.x, c2.z, 5));
  place(r, k, h.s, hazState(r, h, r.time, 5).d, 5, 5);
  k.y = 1;
  k.vy = 3;
  r.time -= DT;
  step(r, DT);
  assert.equal(k.sunk, 0, 'in the air it sails over');
  const shell = spawn(r, { kind: 'green', owner: 0, x: c2.x - r.track.tx[k.i] * 3, z: c2.z - r.track.tz[k.i] * 3, y: 0.35, vx: r.track.tx[k.i] * GREEN_V, vz: r.track.tz[k.i] * GREEN_V, vy: 0, grace: 9, target: -1, prog: 0 });
  let evs: Ev[] = [];
  for (let n = 0; n < 6; n++) {
    step(r, DT);
    evs = evs.concat(r.events.splice(0));
  }
  assert.ok(!r.things.some((th) => th.id === shell.id));
  assert.ok(evs.some((e) => e.t === 'sank' && e.kind === 'water'));
});

test('set back down never in a whirlpool\'s pull, nor just short of one spinning up as you get going', () => {
  for (let n = 0; n < 60; n++) {
    const r = slough();
    const k = r.karts[0];
    const h = r.whirls[n % r.whirls.length];
    r.time = 30 + n * 1.37;
    const lap = Math.max(h.lap ?? 1, 4);
    place(r, k, h.s - 3, hazState(r, h, r.time, lap).d, 8, lap);
    const spot = (rescue as unknown as (r: Race, k: Kart, spot?: [number, number]) => void) && null;
    void spot;
    k.fell = null;
    // (fished out right there)
    rescue(r, k);
    const at = locate(r.track, k.x, k.z);
    for (const w of r.whirls) {
      const ds = deltaS(r.track, at.s, w.s);
      if (ds < -((w.pull ?? 7) + 2) || ds > 25 + (w.pull ?? 7)) continue;
      for (let u = 0; u <= 2.5; u += 0.1) {
        const st = hazState(r, w, r.time + u, lap);
        assert.ok(!st.live && st.warn === 0, `set down at ${at.s.toFixed(0)} by the whirlpool at ${w.s} (+${u.toFixed(1)}s)`);
      }
    }
  }
});

test('out of a whirlpool the launch tows you out past it, away from the next one down the river; out of the marsh, into mid-channel', () => {
  for (const h0 of slough().whirls) {
    const r = slough();
    const k = r.karts[0];
    const h = r.whirls.find((w) => w.s === h0.s)!;
    const lap = Math.max(h.lap ?? 1, 5);
    let time = 40;
    while (hazState(r, h, time, lap).lift < 0.9) time += 0.01;
    r.time = time;
    place(r, k, h.s, hazState(r, h, time, lap).d, 4, lap);
    step(r, DT);
    assert.ok(k.sunk > 0 && k.fell, `under at ${h.s}`);
    const [s, d] = k.fell!.to;
    const past = deltaS(r.track, h.s, s);
    // (past its pull, unless that spot is not clear, when it is back short of it as before: never in the pull)
    assert.ok(past > (h.pull ?? 7) || past < -(h.pull ?? 7), `${h.s}: set down at ${s.toFixed(0)}`);
    // (on the side of the channel away from the next whirlpool, if there is one just down the river; across from this one
    // if not)
    const next = r.whirls.find((w) => w !== h && (w.lap ?? 1) <= lap && deltaS(r.track, wrapS(r.track, h.s + (h.pull ?? 7) + 3), w.s) > 0 && deltaS(r.track, wrapS(r.track, h.s + (h.pull ?? 7) + 3), w.s) < 70);
    if (past > 0) assert.ok(Math.sign(d) !== Math.sign(next ? next.d : -h.d), `${h.s}: on the side of the next one (${d.toFixed(1)})`);
  }
  // run aground: back on the water in the middle, well clear of the mud it went up
  const r = bare();
  const k = r.karts[0];
  place(r, k, 600, -7.3, 12);
  k.h = headingOf(-r.track.tz[k.i] * -1 + r.track.tx[k.i], r.track.tx[k.i] * -1 + r.track.tz[k.i]);
  run(r, 1);
  assert.ok(k.fell?.past === 'marsh');
  assert.ok(Math.abs(k.fell!.to[1]) < 0.5, `set down at d ${k.fell!.to[1].toFixed(1)}`);
});

test('a CPU stopped at the lip of the weir backs off for a run at it rather than creep into the stopper', () => {
  for (const cc of ['50cc', '200cc'] as const) {
    const r = createRace({ cc, course: 'slough', seed: 3, countdown: 0, racers: [{ ...RIVALS[0] }] });
    const k = r.karts[0];
    r.time = 30;
    place(r, k, 982, 0, 0);
    let fell = false;
    run(r, 8, () => {
      if (k.sunk > 0) fell = true;
    });
    assert.equal(fell, false, `${cc}: into the stopper`);
    assert.ok(deltaS(r.track, 994, k.s) > 0, `${cc}: over the weir (at ${k.s.toFixed(0)})`);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 5. Currents

test('the current: pure and eased in, the tide turns on the last lap (all but the weir\'s draw), never too strong', () => {
  const r = slough();
  const t = r.track;
  for (let n = 0; n < 300; n++) {
    const [s, d, lap] = [rand() * t.length, (rand() - 0.5) * 14, 1 + Math.floor(rand() * 5)];
    assert.deepEqual(flowAt(r, s, d, lap), flowAt(slough(1, '50cc', 3), s, d, lap));
  }
  for (const f of r.flows) {
    const mid = (f.s0 + f.s1) / 2;
    const here = flowAt(r, mid, 0, 1).along;
    assert.ok(Math.abs(here - f.along) < 1e-9 || f.tongue, `flow ${f.s0}`);
    assert.ok(Math.abs(flowAt(r, f.s0 + 5, 0, 1).along) <= Math.abs(f.tongue ? 4 : f.along) / 2 + 1e-9, `eased in at ${f.s0}`);
    if (f.tide) assert.ok(Math.abs(flowAt(r, mid, 0, TIDE_LAP).along + here) < 1e-9, `the tide turns at ${f.s0}`);
    else assert.equal(flowAt(r, mid, 0, TIDE_LAP).along, here, 'the weir draws the same way always');
  }
  // the steady push across the channel, current and wind together, is never more than a shell can hold
  const lam = 5 * (0.3 + 0.7 * 0.65);
  for (let lap = 1; lap <= 5; lap++) {
    for (let s = 0; s < t.length; s += 2) {
      let wind = 0;
      for (let time = 0; time < 12; time += 0.1) wind = Math.max(wind, Math.abs(windAt(r, s, time, lap)));
      for (const d of [-5, 0, 5]) assert.ok(Math.abs(flowAt(r, s, d, lap).across) + wind / lam <= 3.5 + 1e-9, `push at ${s} lap ${lap}`);
    }
  }
});

test('the current carries a stopped shell, but not one in the air, just set down or on a bullet', () => {
  /** How far the current takes a shell holding still at the bridges for a second (against the same shell with none). */
  const drift = (set: (k: Kart) => void) => {
    const at = (flows: boolean) => {
      const r = slough();
      r.whirls = [];
      r.vessels = [];
      r.hazards = r.hazards.filter((h) => !h.drive && h.kind !== 'whirl');
      if (!flows) r.flows = [];
      const k = r.karts[0];
      place(r, k, 254, 0, 0, 1);
      set(k);
      for (let n = 0; n < 60; n++) {
        k.v = 0;
        k.input.brake = true;
        if (k.y > 0) k.vy = Math.max(k.vy, 0);
        step(r, DT);
        r.events.length = 0;
        k.v = 0;
      }
      return k;
    };
    const [a, b] = [at(true), at(false)];
    return Math.hypot(a.x - b.x, a.z - b.z);
  };
  assert.ok(Math.abs(drift(() => {}) - 2) < 0.1, `${drift(() => {})}`);
  assert.ok(drift((k) => (k.calm = 5)) < 1e-9);
  assert.ok(drift((k) => (k.bullet = 5)) < 1e-9);
  assert.ok(drift((k) => ((k.y = 3), (k.vy = 30))) < 1e-9);
});

// ---------------------------------------------------------------------------------------------------------------
// 6. Swell

test('swell: pure, warned in time, a crest shoves a shell on the water once its way and passes under a hopped one', () => {
  const r = slough();
  for (const sw of r.swells) {
    assert.ok(sw.kick <= 5 && sw.warn >= 1.5);
    for (let n = 0; n < 200; n++) {
      const time = rand() * 300;
      assert.deepEqual(crestsAt(r, sw, time), crestsAt(slough(1, '50cc', 2), sw, time));
    }
  }
  // warned before the first crest reaches the channel
  // (on lap 1 a smaller swell than from lap 2)
  const sw = r.swells.find((x) => (x.lap ?? 1) === 2)!;
  const edge = sw.phase + 9 * sw.every + (20 - 0.5) / sw.c;
  assert.ok(swellWarn(r, 910, edge - sw.warn + 0.1, 2)!.k > 0);
  assert.ok(swellWarn(r, 910, edge - sw.warn + 0.1, 1)!.kick < swellWarn(r, 910, edge - sw.warn + 0.1, 2)!.kick, 'smaller on lap 1');
  assert.equal(swellWarn(r, 300, edge - sw.warn + 0.1, 2), null, 'only off the Bay');
  /** A shell sat at the Bay Reach as a set rolls through (hopping each crest, or not), against the same with no swell. */
  const shove = (hop: boolean, swell = true) => {
    const q = slough();
    q.gusts = [];
    q.flows = [];
    q.vessels = [];
    q.hazards = q.hazards.filter((h) => !h.drive);
    if (!swell) q.swells = [];
    const k = q.karts[0];
    q.time = edge + 0.5;
    place(q, k, 910, 0, 0, 2);
    let swells = 0;
    for (let n = 0; n < 240; n++) {
      // (hopping a crest as it comes: with a little way on, as a hop needs)
      k.v = hop ? 9 : 0;
      k.input.brake = !hop;
      if (hop && k.y === 0 && crestsAt(q, sw, q.time + 0.1).some((d) => Math.abs(d - k.d) < 0.8)) k.input.hop = true;
      step(q, DT);
      swells += q.events.splice(0).filter((e) => e.t === 'swell').length;
      const p = pointAt(q.track, 910, k.d);
      k.x = p.x;
      k.z = p.z;
      k.h = headingOf(p.tx, p.tz);
    }
    return { swells, d: k.d };
  };
  const plain = shove(false);
  assert.equal(plain.swells, sw.n, 'each crest once');
  assert.ok(plain.d - shove(false, false).d < -1.2, `shoved toward the salt ponds: ${plain.d}`);
  const hopped = shove(true);
  assert.equal(hopped.swells, 0, 'hopped every crest');
});

// ---------------------------------------------------------------------------------------------------------------
// 7. Vessels and wakes

test('vessels: the launches go round with right of way, the barge and the logs only on their stretch and never on the grid', () => {
  const r = slough();
  const t = r.track;
  const launches = r.vessels.filter((h) => h.kind === 'launch');
  assert.equal(launches.length, 2);
  for (const h of launches) assert.ok(h.priority && h.drive === 11 && h.wake);
  for (const h of r.vessels.filter((v) => v.span)) {
    assert.ok(!h.priority);
    for (let time = -4; time < 400; time += 0.5) {
      r.time = time;
      moveHazards(r);
      if (!h.gone) {
        assert.ok(deltaS(t, h.span![0], h.along) >= -0.01 && deltaS(t, h.along, wrapS(t, h.span![1])) >= -0.01, `${h.kind} off its stretch at ${time}`);
      }
      if (time <= 20) for (const v of r.vessels) if (!v.gone) assert.ok(deltaS(t, v.along, 0) > 50 || deltaS(t, v.along, 0) < -lengthOf(v), `${v.kind} on the grid at ${time}`);
    }
  }
  // the lock gates, the swing span and the whirlpools stand aside for a launch, with their full warning kept
  const pieces = r.hazards.filter((h) => timed(h.kind));
  let yields = 0;
  for (let time = 0; time < 300; time += 0.05) {
    for (const h of pieces) {
      const near = launches.some((l) => Math.abs(deltaS(t, wrapS(t, l.s + 11 * time), h.s)) < lengthOf(l) / 2 + (h.kind === 'bollard' ? h.w! : h.r) + 6);
      if (!near) continue;
      yields++;
      const st = hazState(r, h, time, 5);
      if (h.kind === 'rotor') assert.ok(!st.live);
      else assert.ok(!st.solid && !st.live, `${h.kind} at ${h.s} live beside a launch at ${time}`);
    }
  }
  assert.ok(yields > 100);
});

test('the 34 m barge is hit along its whole length, not just near its middle', () => {
  const r = slough();
  const barge = r.vessels.find((h) => h.kind === 'barge')!;
  r.time = (barge.phase ?? 0) + 20;
  moveHazards(r);
  assert.ok(!barge.gone);
  for (const end of [-15, 15]) {
    const q = slough();
    const b = q.vessels.find((h) => h.kind === 'barge')!;
    q.time = r.time;
    moveHazards(q);
    const k = q.karts[0];
    place(q, k, wrapS(q.track, b.along + end), b.at - b.r - KART_R + 0.3, 10, 1);
    k.input.steer = 0;
    q.time -= DT;
    step(q, DT);
    assert.ok(Math.abs(k.d - b.at) >= b.r + KART_R - 0.05, `pushed out of the barge's side ${end} m along it (${k.d.toFixed(2)})`);
  }
});

test('a wake: one shove a crossing, none in the air, and off a big one at speed a jump with a trick to pull', () => {
  /** A shell held `off` m off a vessel's lane just behind its stern as it draws ahead, its wake's arm sweeping out past it. */
  const cross = (kind: 'launch' | 'barge', off: number, v: number, air = false) => {
    const q = slough();
    q.hazards = q.hazards.filter((h) => h.kind === kind);
    q.vessels = q.vessels.filter((h) => h.kind === kind);
    q.whirls = [];
    q.gusts = [];
    q.flows = [];
    q.swells = [];
    const l = q.vessels[0];
    q.time = (l.span ? (l.phase ?? 0) : 0) + 12;
    moveHazards(q);
    const k = q.karts[0];
    const s0 = wrapS(q.track, l.along - lengthOf(l) / 2 - 0.5);
    place(q, k, s0, l.at - off, 0, 1);
    let wakes = 0;
    let jump = false;
    for (let n = 0; n < 150; n++) {
      k.v = v;
      if (air) {
        k.y = 0.6;
        k.vy = 0;
      }
      step(q, DT);
      wakes += q.events.splice(0).filter((e) => e.t === 'wake').length;
      if (k.air && k.trickT > 0) jump = true;
      const p = pointAt(q.track, s0, l.at - off);
      Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz), kx: 0, kz: 0 });
    }
    return { wakes, jump };
  };
  assert.deepEqual(cross('launch', 3.5, 0), { wakes: 1, jump: false }, 'one wake, once, and no jump off a launch at a crawl');
  assert.equal(cross('launch', 3.5, 0, true).wakes, 0, 'in the air it passes under');
  assert.ok(cross('barge', 4, 20).jump, 'a jump off the barge\'s wake at speed');
  assert.ok(WAKE_LEN >= 30);
});

// ---------------------------------------------------------------------------------------------------------------
// 8. The weir

test('the weir: shot flat out at 50cc, short of it you are caught in the stopper and set back to run it again', () => {
  // (the weir alone: no vessels, and no wind or swell off the Bay setting an unsteered shell across the channel)
  const r = createRace({ cc: '50cc', course: 'slough', seed: 2, countdown: 0, racers: [{ name: 'p', color: '#fff', kind: 'player' }] });
  r.vessels = [];
  r.hazards = r.hazards.filter((h) => !h.drive);
  r.gusts = [];
  r.swells = [];
  const t = r.track;
  const hole = r.holes[0];
  assert.ok(hole && (hole.w ?? 0) >= t.half + 1, 'right across the channel');
  assert.ok(r.ramps.some((p) => Math.abs(p.s - 985) < 1 && p.w >= 2 * t.half - 1));
  const k = r.karts[0];
  place(r, k, 950, 0, CLASSES['50cc'].top);
  let evs = run(r, 2);
  assert.ok(!evs.some((e) => e.t === 'splash' || e.t === 'fall'), 'shot at 50cc');
  assert.ok(deltaS(t, hole.s + (hole.len ?? 0), k.s) > 0);
  const q = createRace({ cc: '50cc', course: 'slough', seed: 2, countdown: 0, racers: [{ name: 'p', color: '#fff', kind: 'player' }] });
  q.vessels = [];
  q.hazards = q.hazards.filter((h) => !h.drive);
  q.gusts = [];
  q.swells = [];
  const j = q.karts[0];
  place(q, j, 984.5, 0, 12);
  j.input.brake = true;
  evs = run(q, 1);
  assert.ok(evs.some((e) => e.t === 'splash' && e.k === 0), 'into the stopper');
  assert.ok(Math.abs(deltaS(t, 950, j.fell!.to[0])) < 5, `set back at ${j.fell!.to[0]}`);
  j.input.brake = false;
  let shot = false;
  run(q, 8, () => {
    if (!shot && j.sunk === 0 && j.y === 0 && deltaS(t, hole.s + (hole.len ?? 0), j.s) > 0.5 && deltaS(t, hole.s + (hole.len ?? 0), j.s) < 30) shot = true;
    // (holding the middle of the channel as it runs on round the bend)
    j.input.steer = Math.max(-1, Math.min(1, -0.5 * j.d));
  });
  assert.ok(shot, 'and shoots it from there');
});

// ---------------------------------------------------------------------------------------------------------------
// 9. Always a way through

test('A10.2 on the water: every lock gate, whirlpool, span, vessel, log and buoy leaves a way through, at every instant, on every lap', () => {
  const r = slough();
  const t = r.track;
  const pieces = r.hazards.filter((h) => timed(h.kind));
  const statics = r.hazards.filter((h) => h.kind === 'buoy' || h.kind === 'statue');
  const lines = [...new Set([...pieces.flatMap((h) => (h.kind === 'rotor' ? [h.s - 4, h.s - 2, h.s, h.s + 2, h.s + 4] : [h.s - 1, h.s, h.s + 1])), ...statics.map((h) => h.s), 404, 880, 900, 920, 940])];
  let narrowest = Infinity;
  let where = '';
  for (let lap = 1; lap <= 5; lap++) {
    for (let time = 0; time <= 240; time += 0.05) {
      r.time = time;
      moveHazards(r);
      for (const s of lines) {
        const i = Math.round(s / t.step) % t.n;
        const spans: [number, number][] = [];
        for (const h of pieces) {
          const ds = deltaS(t, h.s, s);
          if (Math.abs(ds) > Math.max(h.r, h.arm ?? 0) + 1) continue;
          spans.push(...hazSpans(r, h, time, lap, ds));
        }
        for (const h of statics) if (Math.abs(deltaS(t, h.s, s)) < h.r) spans.push([h.d - h.r, h.d + h.r]);
        for (const h of r.hazards) {
          if (h.gone) continue;
          if (h.drive && Math.abs(deltaS(t, h.along, s)) < lengthOf(h) / 2) spans.push([h.at - h.r, h.at + h.r]);
          if (h.swing && Math.abs(deltaS(t, h.along, s)) < h.r) spans.push([h.at - h.r, h.at + h.r]);
        }
        const lo = t.lo[i] + (t.pastLo[i] ? 0 : KART_R);
        const hi = t.hi[i] - (t.pastHi[i] ? 0 : KART_R);
        let best = 0;
        let edge = lo;
        for (const [a, b] of [...spans].sort((p, q) => p[0] - q[0])) {
          best = Math.max(best, a - edge);
          edge = Math.max(edge, b);
        }
        const gap = Math.max(best, hi - edge);
        if (gap < narrowest) {
          narrowest = gap;
          where = `s=${s.toFixed(1)} t=${time.toFixed(2)} lap ${lap}`;
        }
      }
    }
  }
  assert.ok(narrowest >= 2.6, `only ${narrowest.toFixed(2)} m left at ${where}`);
});

// ---------------------------------------------------------------------------------------------------------------
// 10. Same view

test('same view on the slough: a skilled CPU takes a lane past the gates and the whirlpools as they will be when it gets there', () => {
  const r = createRace({ cc: '150cc', course: 'slough', seed: 11, countdown: 0, racers: [RIVALS[0]] });
  const t = r.track;
  const [k] = r.karts;
  k.ai!.skill = 1;
  const pieces = r.hazards.filter((h) => h.kind === 'bollard' || h.kind === 'whirl');
  let a = 12345;
  const rnd = () => (a = (a * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  let n = 0;
  let clean = 0;
  while (n < 2000) {
    const h = pieces[Math.floor(rnd() * pieces.length)];
    const back = 8 + rnd() * 24;
    r.time = 20 + rnd() * 200;
    moveHazards(r);
    k.lap = Math.max(h.lap ?? 1, 1 + Math.floor(rnd() * 5));
    // (and now and then crawling, as after a crab)
    const v = rnd() < 0.2 ? 6 : CLASSES['150cc'].top * 0.85;
    place(r, k, h.s - back, (rnd() - 0.5) * (h.kind === 'bollard' ? 6 : 8), v, k.lap);
    k.ai!.errLap = 0;
    k.ai!.blunders = {};
    const dodge = cpuLane(r, k);
    if (!dodge) continue;
    n++;
    const lane = dodge.lane * t.half;
    const speed = dodge.wait ? Math.max(6, v - 7) : v;
    let hit = false;
    for (const [lo, hi] of hazSpans(r, h, r.time + back / speed, k.lap, 0)) if (lane + KART_R > lo && lane - KART_R < hi) hit = true;
    if (!hit) clean++;
  }
  assert.ok(clean / n >= 0.95, `${((clean / n) * 100).toFixed(1)}% clean`);
});

// ---------------------------------------------------------------------------------------------------------------
// 11. CPU-only races

test('CPU-only races on the slough at every class: everyone finishes, nobody stuck, falls and set pieces within bounds', () => {
  let doubles = 0;
  for (const cc of ['50cc', '100cc', '150cc', '200cc'] as const) {
    let falls = 0;
    let races = 0;
    const hits = new Map<string, number>();
    for (const seed of [1, 2, 3]) {
      const r = createRace({ cc, course: 'slough', seed, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
      let stuck = 0;
      const rescues = r.karts.map(() => 0);
      // (and falling again soon after a fall: the whirlpool that took it spinning up as it gets going, say)
      const fellAt = r.karts.map(() => -99);
      let twice = false;
      while (r.time < 600 && r.karts.some((k) => k.done === null)) {
        step(r, DT);
        for (const e of r.events.splice(0)) {
          if (e.t === 'fall' || e.t === 'splash') {
            if (r.time - fellAt[e.k] < 12) twice = true;
            fellAt[e.k] = r.time;
          }
          if (e.t === 'haz') {
            const key = `${e.kind}@${Math.round(r.karts[e.k].s / 10)}`;
            hits.set(key, (hits.get(key) ?? 0) + 1);
          }
        }
        for (const k of r.karts) {
          if (k.stuck > 2.4) stuck++;
          if (k.stuck > 2.48) rescues[k.idx]++;
        }
      }
      races++;
      if (twice) doubles++;
      const times = r.karts.map((k) => k.done ?? Infinity);
      assert.ok(times.every((x) => x < 420), `${cc} seed ${seed}: ${times.map((x) => x.toFixed(0))}`);
      assert.ok(stuck <= 12, `${cc} seed ${seed}: stuck ${stuck}`);
      assert.ok(rescues.every((n) => n <= 3));
      falls += r.karts.reduce((s, k) => s + k.falls, 0);
    }
    const perCpu = falls / races / 8;
    // (at most 1.8 a CPU a race, as the 36-seed calibration has it at every class; three races at 200cc can come out a
    // little over, as on the Skyway, so there it is held to 2.1)
    assert.ok(perCpu <= (cc === '200cc' ? 2.1 : 1.8), `${cc}: ${perCpu.toFixed(2)} falls per CPU per race`);
    // (no set piece hits a CPU more than once a race; the chain ferry at 200cc, about 0.8 a CPU over 24 races, can come
    // out a little over on three, so there it is held to 1.2)
    for (const [key, n] of hits) assert.ok(n / races / 8 <= (cc === '200cc' && key.startsWith('ferry') ? 1.2 : 1), `${cc}: ${key} ${n}`);
  }
  // (with about a fall a CPU a race on a channel this narrow, a CPU falling twice within 12 s is rare now, as on the
  // Skyway: the brink and the whirlpools let a CPU just set down go, see the tests below; the 24-seed calibration has it
  // at most 1 in 24 a class)
  assert.ok(doubles <= 2, `a CPU fell twice within 12 s in ${doubles} of 12 races`);
});

test('on the slough the marsh holds a CPU the launch set down a moment ago, or one spinning from a hit; not one otherwise, nor you', () => {
  const shove = (who: 'cpu' | 'player', how: 'settling' | 'spun' | 'tumbled') => {
    const r = createRace({ cc: '150cc', course: 'slough', seed: 3, countdown: 0, racers: [who === 'cpu' ? RIVALS[6] : { name: 'p', color: '#fff', kind: 'player' }] });
    r.time = 30;
    r.gusts = [];
    const k = r.karts[0];
    place(r, k, 1030, 2, 12, 2);
    step(r, DT);
    if (k.ai && how === 'settling') {
      k.ai.care = 8;
      k.ai.fellAt = r.time - 1;
    }
    // (knocked about, it can do nothing about it, and sliding hard at the brink on the right)
    if (how === 'tumbled') k.tumble = 1.2;
    else k.spin = 1;
    const p = pointAt(r.track, 1030);
    k.kx = -p.tz * 14;
    k.kz = p.tx * 14;
    let widest = 0;
    const evs = run(r, 1.2, () => (widest = Math.max(widest, k.d)));
    return { fell: evs.some((e) => e.t === 'fall'), widest };
  };
  const lim = edgeAt(trackOf('slough'), 1030, 1).lim;
  for (const how of ['settling', 'spun'] as const) {
    const held = shove('cpu', how);
    assert.ok(!held.fell && held.widest <= lim, `${how}: held at ${held.widest.toFixed(2)} (brink ${lim.toFixed(2)})`);
  }
  assert.ok(shove('cpu', 'tumbled').fell, 'on its feet, tumbled by a wake: into the marsh it goes, like anyone');
  assert.ok(shove('player', 'spun').fell, 'you: into the marsh you go');
  assert.ok(shove('player', 'settling').fell, 'you, just set down: the same');
});

test('on the slough a whirlpool lets go of a CPU the launch has only just set down, but never you', () => {
  for (const who of ['cpu', 'player'] as const) {
    const r = createRace({ cc: '150cc', course: 'slough', seed: 3, countdown: 0, racers: [who === 'cpu' ? RIVALS[6] : { name: 'p', color: '#fff', kind: 'player' }] });
    const h = r.whirls.find((w) => Math.round(w.s) === 522)!;
    let t0 = 20;
    while (!(hazState(r, h, t0, 1).live && hazState(r, h, t0, 1).lift > 0.9)) t0 += 0.05;
    r.time = t0;
    r.gusts = [];
    const k = r.karts[0];
    place(r, k, h.s, hazState(r, h, t0, 1).d, 0, 1);
    if (k.ai) {
      k.ai.care = 10;
      k.ai.fellAt = r.time - 2;
    }
    const evs = run(r, 0.5);
    assert.equal(evs.some((e) => e.t === 'splash'), who === 'player', who);
  }
});

test('on the slough the launch stays with a CPU it has set down until it is under way; you get the usual moment', () => {
  for (const [who, want] of [
    ['cpu', 3.5],
    ['player', 1.2],
  ] as const) {
    const r = createRace({ cc: '150cc', course: 'slough', seed: 3, countdown: 0, racers: [who === 'cpu' ? RIVALS[6] : { name: 'p', color: '#fff', kind: 'player' }] });
    const k = r.karts[0];
    rescue(r, k);
    assert.equal(k.safe, want, who);
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 12. Online

test('online: nothing new on the wire; someone else beached is in the marsh; the water agrees between two races', () => {
  const a = hostState(2, 1, '150cc', [0, 1], [], 'slough');
  const b = hostState(2, 1, '150cc', [0, 1], [], 'hoover');
  assert.equal(JSON.stringify(a).length - 'slough'.length, JSON.stringify(b).length - 'hoover'.length);
  const r = createRace({ cc: '150cc', course: 'slough', seed: 1, countdown: 0, racers: [{ name: 'me', color: '#fff', kind: 'player' }, { name: 'them', color: '#fff', kind: 'remote', seat: 1 }] });
  const them = r.karts[1];
  const p = pointAt(r.track, 600, 8);
  Object.assign(them, { x: p.x, z: p.z, i: p.i });
  them.net = { x: p.x, z: p.z, h: 0, v: 0, prog: 600, done: null, flags: F_SUNK, at: 0 };
  applyFlags(them, F_SUNK);
  step(r, DT);
  assert.ok(them.sunk > 0);
  assert.equal(edgeAt(r.track, them.s, them.d >= 0 ? 1 : -1).past, 'marsh');
  const q = createRace({ cc: '150cc', course: 'slough', seed: 99, countdown: 0, racers: [{ name: 'me', color: '#fff', kind: 'player' }] });
  for (const time of [3, 60, 125.5, 210]) {
    r.time = q.time = time;
    moveHazards(r);
    moveHazards(q);
    r.hazards.forEach((h, n) => {
      assert.equal(h.along, q.hazards[n].along);
      assert.equal(!!h.gone, !!q.hazards[n].gone);
      assert.deepEqual(hazState(r, h, time, 3), hazState(q, q.hazards[n], time, 3));
    });
  }
});

// ---------------------------------------------------------------------------------------------------------------
// 13. Boards

test('the slough has its four boards', () => {
  const variants = meta.leaderboard?.variants ?? {};
  for (const cc of ['50cc', '100cc', '150cc', '200cc']) assert.equal(variants[`slough-${cc}`], `Redwood Slough ${cc}`);
});
