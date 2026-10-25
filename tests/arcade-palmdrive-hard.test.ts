import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, TIER, tierOf, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { BOULDER, GREEN_V, KART_R, RIVALS, boulderAt, createRace, hazSpans, hazState, moveHazards, spawn, step, type Ev, type Kart, type LiveHazard, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { meta } from '../src/os/arcade/games/palmdrive/meta.ts';
import { CURB, awake, cycleAt, deltaS, dropAt, headingOf, locate, pointAt, solid, timed, type Track } from '../src/os/arcade/games/palmdrive/track.ts';

// The Hard tier's own set pieces: the Dish's drops, boulders and lap-3 cow, and the Main Quad's bollard rows and
// sprinkler (see the build plan's section D). Everything else about the Hard courses is in the shared tests.

const DT = 1 / 60;

function race(course: 'dish' | 'quad', n = 1, seed = 5, cc: '50cc' | '100cc' | '150cc' | '200cc' = '150cc'): Race {
  return createRace({ cc, course, seed, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz), v, i: at.i, s: at.s, d: at.d, prog: s + (k.lap - 1) * r.track.length });
}

function run(r: Race, seconds: number): Ev[] {
  const all: Ev[] = [];
  for (let n = Math.round(seconds / DT); n > 0; n--) {
    step(r, DT);
    all.push(...r.events.splice(0));
  }
  return all;
}

const boulders = (r: Race) => r.hazards.filter((h) => h.kind === 'boulder');

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

function openShare(t: Track) {
  let n = 0;
  for (let i = 0; i < t.n; i++) if (dropAt(t, i, -1) || dropAt(t, i, 1)) n++;
  return n / t.n;
}

test('the Hard courses are the Dish and the Main Quad, on tier 3: harder than Medium and easier than Expert', () => {
  const hard = COURSE_IDS.filter((id) => COURSES[id].difficulty === 3);
  assert.deepEqual(hard, ['dish', 'quad']);
  for (const id of hard) {
    const tier = tierOf(id);
    assert.ok(tier.harsh > TIER[2].harsh && tier.harsh < TIER[4].harsh, `${id} harsh`);
    assert.ok(tier.fallT > TIER[2].fallT && tier.fallT < TIER[4].fallT, `${id} fall time`);
    assert.ok(tier.fallCoins > TIER[2].fallCoins && tier.fallCoins < TIER[4].fallCoins, `${id} fall coins`);
    assert.ok(tier.pace < TIER[4].pace, `${id} pace`);
  }
});

test('the Dish drops away round the outside of both hairpins and the ridge sweeper, about a sixth of the lap', () => {
  const t = trackOf('dish');
  const share = openShare(t);
  assert.ok(share > 0.15 && share < 0.2, `${(share * 100).toFixed(1)}% open`);
  for (const [s0, s1, side] of COURSES.dish.edges!) {
    // always on the outside of the bend it is in, and well clear of the start line
    let turn = 0;
    for (let s = s0; s <= s1; s += t.step) turn += t.curv[Math.floor(s / t.step) % t.n];
    assert.equal(Math.sign(turn), -side, `the drop at ${s0}-${s1} is on the outside`);
    assert.ok(s0 > 60 && s1 < t.length - 60);
  }
  // the brink half a kart further out than Expert's, with nothing open on the start straight or past the boulder chutes
  assert.ok(tierOf('dish').brink > TIER[4].brink);
  for (const h of boulders(createRace({ cc: '150cc', course: 'dish', racers: [] }))) {
    const i = Math.round(h.s / t.step) % t.n;
    assert.ok(!dropAt(t, i, -1) && !dropAt(t, i, 1), `walls both sides at the chute at ${h.s}`);
  }
});

test('boulders roll across the Dish down three chutes off the uphill side, on the race clock: the same on every screen', () => {
  const a = race('dish', 1, 1);
  const b = race('dish', 1, 77);
  const bs = boulders(a);
  assert.deepEqual(
    bs.map((h) => Math.round(h.s)),
    [260, 450, 1135],
  );
  // one after another, a third of a cycle apart
  assert.deepEqual(
    bs.map((h) => h.phase),
    [0, 2.3, 4.6],
  );
  for (const h of bs) assert.ok(timed(h.kind) && solid(h.kind) && Math.abs(h.cross!) > a.track.edge + 2);
  for (let n = 0; n < bs.length; n++) {
    for (const time of [0, 1.1, 3.3, 47.9, 133.3]) {
      for (const lap of [1, 3, 5]) {
        assert.deepEqual(hazState(a, bs[n], time, lap), hazState(b, boulders(b)[n], time, lap));
        assert.deepEqual(hazSpans(a, bs[n], time, lap, 0.5), hazSpans(b, boulders(b)[n], time, lap, 0.5));
      }
    }
  }
  // its cycle: dust and rumble up the chute first, then right across the road from the uphill side and away
  const h = bs[0];
  const at = (c: number) => boulderAt(a, h, 70 + c);
  assert.ok(cycleAt(h, 70) < 1e-9);
  assert.ok(at(0.6).warn > 0.4 && !at(0.6).rolling && at(0.6).d === h.cross);
  assert.ok(!hazState(a, h, 70.6, 1).live, 'not on the road while it warns');
  const mid = BOULDER.warn + Math.abs(h.cross!) / BOULDER.speed;
  assert.ok(at(mid).rolling && Math.abs(at(mid).d) < 0.01, 'in the middle of the road');
  assert.ok(hazState(a, h, 70 + mid, 1).live && hazState(a, h, 70 + mid, 1).solid);
  assert.ok(Math.sign(at(mid + 0.5).d) === -Math.sign(h.cross!), 'rolling away from the uphill side');
  assert.ok(!at(6.5).rolling && !hazState(a, h, 76.5, 1).live, 'gone down the hill before the next');
  // and the road is never shut: a boulder leaves most of it clear wherever it is
  for (const bo of bs) {
    for (let time = 0; time < 7; time += 0.02) {
      const i = Math.round(bo.s / a.track.step) % a.track.n;
      const gap = widest(a.track.lo[i] + KART_R, a.track.hi[i] - KART_R, hazSpans(a, bo, time, 1));
      assert.ok(gap >= 4, `only ${gap.toFixed(2)} m clear at ${bo.s} t=${time.toFixed(2)}`);
    }
  }
});

test('a boulder tumbles a kart in its way and throws it the way it is rolling; shells break on it', () => {
  const r = race('dish');
  const k = r.karts[0];
  const h = boulders(r)[0];
  // rolling through the middle of the road, the kart parked just ahead of it in its path
  const mid = BOULDER.warn + Math.abs(h.cross!) / BOULDER.speed;
  r.time = 70 + mid - 0.4;
  moveHazards(r);
  const dir = -Math.sign(h.cross!);
  place(r, k, h.s, dir * 1.5, 0);
  k.input.brake = true;
  const from = k.d;
  // (soon after: once the kart slows, the boulder rolling on sets it aside along the road as it goes by)
  const evs = run(r, 0.45);
  assert.ok(evs.some((e) => e.t === 'haz' && e.kind === 'boulder'), 'hit');
  assert.ok(evs.some((e) => e.t === 'hit' && e.how === 'tumble'), 'tumbled');
  const now = locate(r.track, k.x, k.z, k.i);
  assert.ok((now.d - from) * dir > 0.5, 'thrown the way it rolls');
  // not there through its warning: a kart in the road at the chute is untouched
  const q = race('dish');
  const b0 = boulders(q)[0];
  q.time = 70.1;
  moveHazards(q);
  place(q, q.karts[0], b0.s, 0, 0);
  q.karts[0].input.brake = true;
  assert.ok(!run(q, 0.5).some((e) => e.t === 'haz'), 'nothing yet');
  // a shell into it breaks
  const s = race('dish');
  const b1 = boulders(s)[1];
  const t1 = 80;
  s.time = t1 - (cycleAt(b1, t1) - (BOULDER.warn + Math.abs(b1.cross!) / BOULDER.speed)) - 0.25;
  moveHazards(s);
  s.karts[0].lap = 5;
  place(s, s.karts[0], b1.s - 60, 4, 0);
  const from2 = pointAt(s.track, b1.s - 8, 0);
  const sh = spawn(s, { kind: 'green', owner: 0, x: from2.x, z: from2.z, y: 0.35, vx: from2.tx * GREEN_V, vz: from2.tz * GREEN_V, vy: 0, grace: 9, target: -1, prog: 0 });
  run(s, 0.3);
  assert.ok(!s.things.some((th) => th.id === sh.id), 'the shell broke on it');
});

test('a fifth cow wanders onto the Dish from lap 3 only, grazing out of the way until then', () => {
  const t = trackOf('dish');
  const cows = COURSES.dish.layout(t).hazards.filter((h) => h.kind === 'cow');
  assert.equal(cows.length, 5);
  const late = cows.filter((h) => h.lap);
  assert.deepEqual(
    late.map((h) => [Math.round(h.s), h.lap, h.swing, h.speed]),
    [[700, 3, 4.2, 0.5]],
  );
  assert.ok(awake(late[0], 3) && !awake(late[0], 2));
  assert.equal(COURSES.dish.laps?.[3] !== undefined, true);
  // on lap 2 a kart drives right through where it would be
  const r = race('dish');
  const k = r.karts[0];
  const cow = r.hazards.find((h) => h.kind === 'cow' && h.lap === 3) as LiveHazard;
  k.lap = 2;
  moveHazards(r);
  place(r, k, cow.along - 4, cow.at, 12);
  assert.ok(!run(r, 0.6).some((e) => e.t === 'moo'), 'no cow on lap 2');
});

test('the Main Quad: bollard rows on two straights from lap 2, wall to wall with each gap on the road, and a sprinkler from lap 3', () => {
  const t = trackOf('quad');
  const lay = COURSES.quad.layout(t);
  for (const s of [22, 290]) {
    const row = lay.hazards.filter((h) => h.kind === 'bollard' && Math.round(h.s) === s).sort((a, b) => a.d - b.d);
    assert.equal(row.length, 4);
    // wall to wall, the middle two the width of Hoover's, the outer two taking in the verge
    assert.ok(Math.abs(row[0].d - (row[0].w ?? 0) / 2 + t.edge) < 1e-9 && Math.abs(row[3].d + (row[3].w ?? 0) / 2 - t.edge) < 1e-9);
    for (let n = 1; n < 4; n++) assert.ok(Math.abs(row[n - 1].d + (row[n - 1].w ?? 0) / 2 - (row[n].d - (row[n].w ?? 0) / 2)) < 1e-9);
    assert.ok(row.every((h) => h.lap === 2 && h.every === 3.2 && h.warn === 0.9));
    // a kart fits square in each bank's lane without leaving the road (the curb is road)
    const road = t.half + CURB * 0.6;
    for (const h of row) {
      const lo = Math.max(-road, h.d - (h.w ?? 0) / 2) + KART_R;
      const hi = Math.min(road, h.d + (h.w ?? 0) / 2) - KART_R;
      assert.ok(hi - lo > 0.5, `room in the bank at ${h.d}`);
    }
    assert.deepEqual([...new Set(row.map((h) => h.phase))].length, 4);
  }
  const rotor = lay.hazards.filter((h) => h.kind === 'rotor');
  assert.equal(rotor.length, 1);
  assert.ok(rotor[0].lap === 3 && rotor[0].arm === 6);
  assert.deepEqual(Object.keys(COURSES.quad.laps ?? {}).map(Number), [2, 3]);
  // not there on lap 1 (the jet's hub stands from the start)
  const r = race('quad');
  for (const h of r.hazards.filter((x) => timed(x.kind))) {
    for (let time = 0; time < 7; time += 0.05) assert.ok(h.kind === 'rotor' ? !hazState(r, h, time, 1).live && !hazState(r, h, time, 2).live : !hazState(r, h, time, 1).solid);
  }
});

test('a way through always exists on the Hard courses: at every set piece, at every instant, on every lap, at least 4 m', () => {
  for (const course of ['dish', 'quad'] as const) {
    const r = race(course);
    const t = r.track;
    const pieces = r.hazards.filter((h) => timed(h.kind));
    const lines = [...new Set(pieces.flatMap((h) => (h.kind === 'rotor' ? [h.s - 4, h.s - 2, h.s, h.s + 2, h.s + 4] : [h.s])))];
    let narrowest = Infinity;
    let where = '';
    for (let lap = 1; lap <= 5; lap += 1) {
      for (let time = 0; time <= 30; time += 0.02) {
        for (const s of lines) {
          const i = Math.round(s / t.step) % t.n;
          const spans: [number, number][] = [];
          for (const h of pieces) {
            const ds = deltaS(t, h.s, s);
            if (Math.abs(ds) > Math.max(h.r, h.arm ?? 0) + 1) continue;
            spans.push(...hazSpans(r, h, time, lap, ds));
          }
          // (as far across as a kart's middle can get)
          const gap = widest(t.lo[i], t.hi[i], spans);
          if (gap < narrowest) {
            narrowest = gap;
            where = `${course} s=${s.toFixed(1)} t=${time.toFixed(2)} lap ${lap}`;
          }
        }
      }
    }
    assert.ok(narrowest >= 4, `only ${narrowest.toFixed(2)} m left at ${where}`);
  }
});

test('CPU-only races on the Hard courses at every class: everyone finishes, nobody gets stuck, and hardly anyone falls', () => {
  for (const course of ['dish', 'quad'] as const) {
    let falls = 0;
    let caught = 0;
    let races = 0;
    for (const cc of ['50cc', '100cc', '150cc', '200cc'] as const) {
      const r = createRace({ cc, course, seed: 3, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
      let stuck = 0;
      const at: number[][] = r.karts.map(() => []);
      while (r.time < 700 && r.karts.some((k) => k.done === null)) {
        step(r, DT);
        for (const k of r.karts) if (k.stuck > 2) stuck++;
        for (const e of r.events.splice(0)) {
          if (e.t === 'fall' || e.t === 'splash') at[e.k].push(r.time);
          if (e.t === 'haz') caught++;
        }
      }
      const where = `${course} ${cc}`;
      assert.ok(r.karts.every((k) => k.done !== null), `${where}: everyone finished`);
      assert.equal(stuck, 0, `${where}: nobody stuck`);
      for (const ts of at) {
        assert.ok(ts.length <= 1, `${where}: a CPU fell ${ts.length} times`);
        falls += ts.length;
      }
      assert.ok(Math.min(...r.karts.map((k) => k.done!)) > meta.leaderboard!.min! / 1000, where);
      races++;
    }
    assert.ok(falls / races / 8 <= 0.3, `${course}: ${(falls / races / 8).toFixed(2)} falls per CPU per race`);
    assert.ok(caught / races / 8 <= 2.5, `${course}: ${(caught / races / 8).toFixed(2)} set-piece hits per CPU per race`);
  }
});
