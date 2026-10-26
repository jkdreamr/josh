import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { MOWER, RIVALS, TREE, createRace, hazSpans, hazState, hazardS, mowerRun, mowerSkips, rescue, rightOfWay, step, type Ev, type Kart, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { deltaS, dropAt, drives, edgeAt, edgeRuns, headingOf, lengthOf, locate, pointAt, solid, timed } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

/** A race round the golf course, past the lights, with n hand-driven karts. */
function golf(n = 1, seed = 5, cc: '50cc' | '100cc' | '150cc' | '200cc' = '100cc'): Race {
  return createRace({ cc, course: 'golf', seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0, turn = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz) + turn, v, i: at.i, s: at.s, d: at.d, prog: s + (k.lap - 1) * r.track.length });
}

function run(r: Race, seconds: number): Ev[] {
  const all: Ev[] = [];
  for (let n = Math.round(seconds / DT); n > 0; n--) {
    step(r, DT);
    all.push(...r.events.splice(0));
  }
  return all;
}

const geese = (r: Race) => r.hazards.filter((h) => h.kind === 'tether');
const mower = (r: Race) => r.hazards.find((h) => h.kind === 'mower')!;
const carts = (r: Race) => r.hazards.filter((h) => drives(h));

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

test('golf: out of bounds on the outside of the bends, the walls along about half the lap, the drops all water or OB', () => {
  const t = trackOf('golf');
  const ob = (COURSES.golf.edges ?? []).filter(([, , , past]) => past === 'ob');
  assert.deepEqual(
    ob.map(([s0, s1, side]) => [s0, s1, side]),
    [
      [330, 390, -1],
      [612, 700, -1],
      [738, 828, 1],
    ],
  );
  for (const [s0, s1, side] of ob) {
    // the tightest bend in each span turns away from the out of bounds (it is on the outside)
    let tight = 0;
    for (let s = s0; s <= s1; s += t.step) {
      const c = t.curv[Math.floor(s / t.step) % t.n];
      if (Math.abs(c) > Math.abs(tight)) tight = c;
    }
    assert.ok(Math.abs(tight) > 1 / 40, `${s0}-${s1} has a real bend in it`);
    // (curv > 0 is a right-hander, whose outside is on the left)
    assert.equal(Math.sign(tight), -side, `${s0}-${s1} is on the outside of its bend`);
    // its brink half a meter or more past the edge of the road (round the esses' 25 m right-hander a strip of rough
    // further), and white stakes the scene can stand there, inside the wall line
    for (let s = s0 + 1; s < s1 - 1; s += t.step) {
      const e = edgeAt(t, s, side);
      // (running on into the island green's pond)
      if (e.past === 'water') continue;
      assert.equal(e.past, 'ob');
      assert.ok(e.lim >= t.half + 0.6 - 1e-6 && e.lim <= (s0 === 330 ? t.edge - 0.5 : t.half + 1), `brink ${e.lim} at s=${s}`);
    }
  }
  // walled on both sides along 45-55% of the lap
  let both = 0;
  for (let i = 0; i < t.n; i++) if (!dropAt(t, i, -1) && !dropAt(t, i, 1)) both++;
  const share = both / t.n;
  assert.ok(share >= 0.45 && share <= 0.55, `walled both sides along ${(share * 100).toFixed(1)}%`);
  for (const [, , , past] of edgeRuns(t)) assert.ok(past === 'wall' || past === 'water' || past === 'ob', past);
});

test('golf: the geese and the gang mower are where the plan puts them, clear of the boxes and the boosts', () => {
  const t = trackOf('golf');
  const lay = COURSES.golf.layout(t);
  const gs = lay.hazards.filter((h) => h.kind === 'tether');
  assert.deepEqual(
    gs.map((h) => [Math.round(h.s), h.d, h.aim, h.every, h.phase, h.rush, h.look]),
    [
      [470, -8.4, -2, 3.4, 0, [4, 2.6], 'goose'],
      [566, -8.4, -2, 3.4, 1.7, [4, 2.6], 'goose'],
    ],
  );
  for (const g of gs) {
    // the post on the bank by the water, off the road; where it lunges to on it
    assert.ok(Math.abs(g.d) > t.half && Math.abs(g.aim ?? 0) + g.r < t.half);
    assert.equal(edgeAt(t, g.s, -1).past, 'water');
  }
  const m = lay.hazards.find((h) => h.kind === 'mower')!;
  assert.ok(m && Math.round(m.s) === 302 && m.d === 0 && m.r === 2.2 && m.speed === 5 && m.cross === 16);
  assert.equal(lengthOf(m), 12);
  // its first crossing at the end of the first lap or so, and well clear of the box row before it
  assert.ok((m.phase ?? 0) >= 38 && (m.phase ?? 0) <= 46, `first crossing at ${m.phase}`);
  for (const b of lay.boxes) assert.ok(Math.abs(deltaS(t, b.s, m.s)) >= 15, `boxes at ${b.s}`);
  // walled both sides where it crosses (it drives out through openings drawn in them)
  assert.equal(edgeAt(t, m.s, -1).past, 'wall');
  assert.equal(edgeAt(t, m.s, 1).past, 'wall');
  assert.ok(timed('tether') && timed('mower') && solid('tether') && solid('mower'));
  // and the lap banner says when the geese get angry
  assert.equal(COURSES.golf.laps?.[4], 'The geese get angry');
});

test('golf: the geese and the mower are pure functions of the race clock (and the lap), the same on every screen and at every class', () => {
  const a = golf(1, 1, '50cc');
  const b = golf(1, 77, '200cc');
  for (let i = 0; i < a.hazards.length; i++) {
    const h = a.hazards[i];
    if (h.kind !== 'tether' && h.kind !== 'mower') continue;
    for (let time = 0; time < 240; time += 0.37) {
      for (let lap = 1; lap <= 5; lap++) {
        assert.deepEqual(hazState(a, h, time, lap), hazState(b, b.hazards[i], time, lap), `${h.kind} at ${h.s} t=${time} lap ${lap}`);
        for (const ds of [0, 1.5, -2]) assert.deepEqual(hazSpans(a, h, time, lap, ds), hazSpans(b, b.hazards[i], time, lap, ds));
      }
    }
  }
  // stepping a race changes nothing about them
  const c = golf();
  const before = c.hazards.filter((h) => timed(h.kind)).map((h) => hazState(c, h, 80, 2));
  run(c, 1);
  assert.deepEqual(
    c.hazards.filter((h) => timed(h.kind)).map((h) => hazState(c, h, 80, 2)),
    before,
  );
});

test('golf: a way through the geese and the mower at every instant on every lap, with the carts driving', () => {
  const r = golf();
  const t = r.track;
  const pieces = r.hazards.filter((h) => h.kind === 'tether' || h.kind === 'mower');
  const vans = carts(r);
  const lines = pieces.flatMap((h) => [h.s - h.r * 0.7, h.s, h.s + h.r * 0.7]);
  let narrowest = Infinity;
  let where = '';
  for (let lap = 1; lap <= 5; lap++) {
    for (let time = 0; time <= 240; time += 0.02) {
      for (const s of lines) {
        const i = Math.round(s / t.step) % t.n;
        const spans: [number, number][] = [];
        for (const h of pieces) {
          const ds = deltaS(t, h.s, s);
          if (Math.abs(ds) > h.r + 1) continue;
          spans.push(...hazSpans(r, h, time, lap, ds));
        }
        for (const v of vans) if (Math.abs(deltaS(t, hazardS(t, v, time), s)) < lengthOf(v) / 2) spans.push([v.d - v.r, v.d + v.r]);
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

test('golf: the mower beeps 2.5 s before it reaches the road, crosses back and forth, and never meets a cart', () => {
  const r = golf();
  const t = r.track;
  const m = mower(r);
  const every = m.every!;
  let crossings = 0;
  for (let n = 0; n < 30; n++) {
    const c0 = m.phase! + n * every;
    const run0 = mowerRun(r, m, n);
    // (none is sat out: they are timed between the carts)
    assert.equal(mowerSkips(r, m, c0, run0), false, `crossing ${n} sat out`);
    crossings++;
    assert.equal(run0.dir, n % 2 === 0 ? 1 : -1);
    // it waits where the last one left it
    assert.ok(Math.abs(run0.at(0) - mowerRun(r, m, n - 1).at(mowerRun(r, m, n - 1).pass)) < 1e-9);
    // the beeping, then across
    for (let u = run0.enter - MOWER.warn + 0.02; u < run0.enter; u += 0.05) {
      const st = hazState(r, m, c0 + u, 1);
      assert.ok(st.warn > 0 && !st.live, `beeping ${(run0.enter - u).toFixed(2)} s before crossing ${n}`);
    }
    let blocked = 0;
    for (let u = run0.enter + 0.01; u < run0.leave; u += 0.02) {
      const st = hazState(r, m, c0 + u, 1);
      assert.ok(st.live && st.solid);
      // with the road between the walls: shut (less than a kart and a margin) for a moment at most
      if (widest(-t.edge, t.edge, hazSpans(r, m, c0 + u, 1)) < 2.6 + 2) blocked += 0.02;
      // no cart within reach of the crossing while it is out
      for (const v of carts(r)) assert.ok(Math.abs(deltaS(t, hazardS(t, v, c0 + u), m.s)) > MOWER.clear, `a cart at the crossing ${n}`);
    }
    assert.ok(blocked <= 2, `the road as good as shut for ${blocked.toFixed(2)} s`);
  }
  assert.equal(crossings, 30);
  // before the first it waits by the road, quiet
  for (let time = 0; time < m.phase! - MOWER.warn - 1.3; time += 0.25) {
    const st = hazState(r, m, time, 3);
    assert.ok(!st.live && st.warn === 0, `t=${time}`);
  }
});

test('golf: the geese sit tight while a cart goes by, and lunge every 3.4 s, every 2.6 s from lap 4 (each kart on its own lap)', () => {
  const r = golf();
  const t = r.track;
  for (const g of geese(r)) {
    let yields = 0;
    for (let time = 0; time < 300; time += 0.05) {
      if (!rightOfWay(r, g, time)) continue;
      yields++;
      for (let lap = 1; lap <= 5; lap++) assert.ok(!hazState(r, g, time, lap).live, `goose at ${g.s} lunging with a cart beside it at t=${time}`);
    }
    assert.ok(yields > 0, 'a cart goes by');
    const lunges = (lap: number) => {
      let n = 0;
      let was = false;
      for (let time = 0; time < 120; time += 0.02) {
        const live = hazState(r, g, time, lap).live;
        if (live && !was) n++;
        was = live;
      }
      return n;
    };
    const calm = lunges(1);
    const angry = lunges(4);
    assert.equal(lunges(3), calm);
    assert.equal(lunges(5), angry);
    assert.ok(calm >= 28 && calm <= 35, `${calm} lunges in two minutes`);
    assert.ok(angry >= 38 && angry <= 46, `${angry} lunges in two minutes from lap 4`);
    // a lunge is always shown first: a crouch of its whole length
    // (from a little after the green light: one is already crouching as the lights go out)
    let crouch = 0;
    for (let time = 3; time < 120; time += 0.01) {
      const st = hazState(r, g, time, 1);
      if (st.warn > 0 && !st.live) crouch += 0.01;
      else if (st.live && crouch > 0) {
        assert.ok(crouch >= TREE.crouch - TREE.out - 0.03, `crouched ${crouch.toFixed(2)} s`);
        crouch = 0;
      } else if (!st.live) crouch = 0;
    }
    // it rests by its post, off the inside line, and lunges right out to its mark
    let far = 0;
    for (let time = 0; time < 30; time += 0.01) far = Math.max(far, Math.abs(hazState(r, g, time, 1).d - g.d));
    assert.ok(Math.abs(far - Math.abs((g.aim ?? 0) - g.d)) < 0.05);
    assert.ok(Math.abs(hazState(r, g, 0.1, 1).d) > t.half);
  }
});

test('golf: a lunging goose bowls you over and a sat one is a bump; the mower spins you out, harder still tumbles you; a star ploughs through both', () => {
  // into a goose as it lunges
  const r = golf();
  const k = r.karts[0];
  const g = geese(r)[0];
  // (find a moment it is right out at its mark)
  let at = 20;
  while (hazState(r, g, at, 1).lift < 0.99) at += 0.01;
  r.time = at;
  place(r, k, g.s - 1.5, g.aim, 10);
  let evs = run(r, 0.25);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'tether'), 'bowled over');
  assert.ok(k.tumble > 0);
  // sat by its post it is a bump, nothing more
  const s = golf();
  const q = s.karts[0];
  const g2 = geese(s)[0];
  let calm = 20;
  while (hazState(s, g2, calm, 1).warn > 0 || hazState(s, g2, calm, 1).live || hazState(s, g2, calm + 0.6, 1).warn > 0) calm += 0.05;
  s.time = calm;
  const rest = hazState(s, g2, calm, 1).d;
  place(s, q, g2.s - 2.4, rest, 8);
  evs = run(s, 0.4);
  assert.ok(!evs.some((e) => e.t === 'haz'), 'not knocked over');
  assert.ok(q.spin === 0 && q.tumble === 0);
  assert.ok(deltaS(s.track, q.s, g2.s) > 0 || Math.abs(locate(s.track, q.x, q.z).d - rest) > g2.r, 'it does not drive through it');
  // the mower, head on in the middle of the road
  const u = golf(1, 5, '150cc');
  const p = u.karts[0];
  const m = mower(u);
  const run0 = mowerRun(u, m, 0);
  u.time = m.phase! + run0.pass / 2;
  place(u, p, m.s - m.r - 3, 0, 14);
  evs = run(u, 0.4);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'mower'), 'into the mower');
  assert.ok(p.spin > 0 || p.tumble > 0);
  assert.ok(deltaS(u.track, p.s, m.s) > m.r, 'and stopped short of it');
  // a star ploughs straight through
  const w = golf(1, 5, '150cc');
  const z = w.karts[0];
  w.time = m.phase! + run0.pass / 2;
  place(w, z, m.s - m.r - 3, 0, 14);
  z.star = 3;
  evs = run(w, 0.5);
  assert.ok(!evs.some((e) => e.t === 'haz'));
  assert.ok(deltaS(w.track, m.s, z.s) > 0, 'through it');
});

test('golf: out of bounds is a fall like the water, with its own call; the retriever sets you back down on the road', () => {
  const r = golf();
  const k = r.karts[0];
  k.coins = 5;
  // off the outside of the right-hander in the bunker esses
  place(r, k, 344, -5.5, 16, 0.6);
  const evs = run(r, 0.5);
  const fall = evs.find((e) => e.t === 'fall' && e.k === k.idx);
  assert.ok(fall && fall.t === 'fall' && fall.kind === 'ob', 'out of bounds');
  assert.equal(k.fell?.past, 'ob');
  assert.equal(k.coins, 5 - r.tier.fallCoins);
  while (k.sunk > 0 && r.time < 6) run(r, DT);
  const at = locate(r.track, k.x, k.z);
  assert.ok(Math.abs(at.d) <= edgeAt(r.track, at.s, Math.sign(at.d) || 1).lim - 3 + 1e-6, `set down at d=${at.d.toFixed(2)}`);
});

test('golf: never set back down on the mower crossing while it beeps or is across', () => {
  const r = golf();
  const k = r.karts[0];
  const m = mower(r);
  const run0 = mowerRun(r, m, 0);
  for (const u of [run0.enter - 2, run0.enter - 0.5, run0.enter + 1, run0.leave - 1]) {
    r.time = m.phase! + u;
    place(r, k, m.s + 1, 0, 0);
    rescue(r, k);
    const at = locate(r.track, k.x, k.z);
    const ds = deltaS(r.track, at.s, m.s);
    assert.ok(ds < -(m.r + 1) || ds > 14, `set down ${ds.toFixed(1)} m short of the crossing at ${u.toFixed(1)} s`);
  }
});

test('CPU-only races round the golf course at every class: everyone finishes, nobody gets stuck, few go out of bounds, and the geese and the mower catch some', () => {
  let falls = 0;
  let caught = 0;
  let races = 0;
  const spreads: number[] = [];
  for (const cc of ['50cc', '100cc', '150cc', '200cc'] as const) {
    for (const seed of [3, 4]) {
      const r = createRace({ cc, course: 'golf', seed, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
      const at: number[][] = r.karts.map(() => []);
      let stuck = 0;
      while (r.time < 600 && r.karts.some((k) => k.done === null)) {
        step(r, DT);
        for (const k of r.karts) if (k.stuck > 2) stuck++;
        for (const e of r.events.splice(0)) {
          if (e.t === 'fall' || e.t === 'splash') at[e.k].push(r.time);
          if (e.t === 'haz' && (e.kind === 'tether' || e.kind === 'mower')) caught++;
        }
      }
      const where = `${cc} seed ${seed}`;
      assert.ok(r.karts.every((k) => k.done !== null), `${where}: everyone finished`);
      assert.equal(stuck, 0, `${where}: nobody stuck`);
      for (const ts of at) {
        assert.ok(ts.length <= 2, `${where}: a CPU fell ${ts.length} times`);
        for (let n = 1; n < ts.length; n++) assert.ok(ts[n] - ts[n - 1] >= 12, `${where}: fell twice in ${(ts[n] - ts[n - 1]).toFixed(1)} s`);
        falls += ts.length;
      }
      races++;
      const times = r.karts.map((k) => k.done!).sort((a, b) => a - b);
      spreads.push(times[7] - times[0]);
      assert.ok(times[7] - times[0] < 45, `${where}: the field ${(times[7] - times[0]).toFixed(1)} s apart`);
    }
  }
  assert.ok(falls / races / 8 <= 0.5, `${(falls / races / 8).toFixed(2)} falls per CPU per race`);
  // (the last CPU home usually within 25 s of the first)
  assert.ok(spreads.reduce((a, b) => a + b, 0) / spreads.length <= 25, `the field ${spreads.map((x) => x.toFixed(0)).join(', ')} s apart`);
  // they look human: the geese and the mower get one now and then, never most of them
  assert.ok(caught / races / 8 <= 1, `${(caught / races / 8).toFixed(2)} goose and mower hits per CPU per race`);
  assert.ok(caught > 0, 'the geese and the mower catch someone');
});
