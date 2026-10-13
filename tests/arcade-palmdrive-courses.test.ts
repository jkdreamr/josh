import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, DIFFICULTY, isCourse, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { CCS, CLASSES, KART_R, RIVALS, createRace, hazardD, soloRace, step } from '../src/os/arcade/games/palmdrive/logic.ts';
import { meta } from '../src/os/arcade/games/palmdrive/meta.ts';
import { configOf, hostState, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';
import { BUS_LEN, EDGE, ROAD_HALF, deltaS, gridSpot, locate, pointAt, solid, type Track } from '../src/os/arcade/games/palmdrive/track.ts';

/** The widest stretch of road left clear between things standing across it, given as [from, to] lateral spans. */
function widest(t: Track, spans: [number, number][]) {
  let best = 0;
  let edge = -t.half;
  for (const [a, b] of [...spans].sort((p, q) => p[0] - q[0])) {
    best = Math.max(best, a - edge);
    edge = Math.max(edge, b);
  }
  return Math.max(best, t.half - edge);
}

test('the course list and its ids agree', () => {
  assert.deepEqual(Object.keys(COURSES).sort(), [...COURSE_IDS].sort());
  for (const id of COURSE_IDS) {
    assert.equal(COURSES[id].id, id);
    assert.ok(isCourse(id));
    assert.ok(COURSES[id].name && COURSES[id].blurb && COURSES[id].sky.startsWith('linear-gradient('));
    assert.ok(DIFFICULTY[COURSES[id].difficulty - 1], `${id} has a difficulty`);
  }
  // Palm Drive keeps its road, others can be wider or narrower
  assert.deepEqual([trackOf('palm').half, trackOf('palm').edge], [ROAD_HALF, EDGE]);
  for (const id of COURSE_IDS) {
    const t = trackOf(id);
    assert.ok(t.half >= 5.5 && t.half <= 11 && t.edge - t.half >= 3.5, `${id} road ${t.half}/${t.edge}`);
  }
  for (const junk of ['', 'moon', null, 3]) assert.equal(isCourse(junk), false);
});

for (const id of COURSE_IDS) {
  test(`${id}: a closed loop of sensible length that never runs into itself or bends too tight`, () => {
    const t = trackOf(id);
    assert.equal(trackOf(id), t, 'built once');
    assert.ok(t.length > 600 && t.length < 1400, `length ${t.length}`);
    // stretches far apart along the lap stay clear of each other's walls
    let closest = Infinity;
    for (let i = 0; i < t.n; i++) {
      for (let j = i + 1; j < t.n; j++) {
        if (Math.min(j - i, t.n - (j - i)) * t.step < 70) continue;
        closest = Math.min(closest, Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]));
      }
    }
    assert.ok(closest > 2 * t.edge + 4, `closest stretches ${closest}`);
    // any tighter and the inside wall would fold over itself
    let tightest = Infinity;
    for (let i = 0; i < t.n; i++) tightest = Math.min(tightest, 1 / Math.max(1e-9, Math.abs(t.curv[i])));
    assert.ok(tightest > 18, `tightest bend ${tightest}`);
    // index 0 is the start line
    const start = COURSES[id].start;
    const sp = { x: -start[0] * 0.8, z: start[1] * 0.8 };
    assert.ok(Math.hypot(t.x[0] - sp.x, t.z[0] - sp.z) < 3);
  });

  test(`${id}: item boxes, coins, dash panels and ramps all sit on the road, and the boosts on straights`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    assert.ok(lay.boxes.length >= 12 && lay.boxes.length % 4 === 0, `${lay.boxes.length} boxes`);
    assert.ok(lay.coins.length >= 25);
    assert.ok(lay.dashes.length >= 2 && lay.ramps.length >= 1);
    for (const p of [...lay.boxes, ...lay.coins, ...lay.dashes]) assert.ok(Math.abs(p.d) <= t.half - 1.5, `${id} pickup at s=${p.s} d=${p.d}`);
    for (const ramp of lay.ramps) assert.ok(Math.abs(ramp.d) + ramp.w / 2 <= t.half + 0.5, `${id} ramp at s=${ramp.s}`);
    const curv = (s: number) => Math.abs(t.curv[Math.floor(s / t.step) % t.n]);
    for (const p of [...lay.dashes, ...lay.ramps]) {
      for (const ds of [-6, 0, 6]) assert.ok(curv(p.s + ds) < 0.03, `${id} boost at s=${p.s} on a bend (${curv(p.s + ds)})`);
    }
    // nothing on top of the start line or another pickup row's coins piled into the walls
    for (const c of lay.coins) {
      const p = pointAt(t, c.s, c.d);
      assert.ok(Math.abs(locate(t, p.x, p.z).d) < t.half, `${id} coin at s=${c.s} is on the road`);
    }
  });

  test(`${id}: mud, oil, bales, boulders, planters, cows and bikes sit on the road, clear of the start, and always leave a way past`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    for (const h of lay.hazards) {
      const where = `${id} ${h.kind} at s=${h.s}`;
      assert.ok(h.r > 0, where);
      // (a bus waits here for the green light)
      assert.ok(h.s > 40 && h.s < t.length - 30, `${where} is clear of the start`);
      assert.ok(Math.abs(h.d) + (h.swing ?? 0) <= t.half, `${where} stays on the road`);
      // buses drive the whole lap, so where they start says nothing about the boxes and boosts (see below)
      if (!solid(h.kind) || h.drive) continue;
      // a gap at least two karts wide beside anything solid, and none of them in front of an item box row
      const room = Math.max(t.half - (h.d + h.r), h.d - h.r + t.half);
      if (!h.swing) assert.ok(room >= 4.5, `${where} leaves ${room} m`);
      for (const b of lay.boxes) assert.ok(Math.abs(deltaS(t, h.s, b.s)) > 10, `${where} is in front of the boxes at s=${b.s}`);
      for (const o of lay.hazards) if (o !== h && solid(o.kind) && !h.swing && !o.swing && !o.drive) assert.ok(Math.abs(deltaS(t, h.s, o.s)) > 8 || Math.abs(h.d - o.d) > 2 * h.r + 5, `${where} crowds another`);
    }
    // nothing solid right where a dash panel or a ramp sends you
    for (const p of [...lay.dashes, ...lay.ramps]) {
      for (const h of lay.hazards) if (solid(h.kind) && !h.drive) assert.ok(deltaS(t, p.s, h.s) < 0 || deltaS(t, p.s, h.s) > 30, `${id} ${h.kind} at s=${h.s} right after a boost at s=${p.s}`);
    }
    // and no coins, boxes or dash panels leading you into something solid in the same lane
    for (const p of [...lay.coins, ...lay.boxes, ...lay.dashes]) {
      for (const h of lay.hazards) {
        if (!solid(h.kind) || h.swing || h.drive) continue;
        const ahead = deltaS(t, p.s, h.s);
        assert.ok(ahead <= 0 || ahead > 15 || Math.abs(p.d - h.d) > h.r + 1.6, `${id} pickup at s=${p.s} d=${p.d} leads into the ${h.kind} at s=${h.s}`);
      }
    }
    // anything crossing the road never shuts the way past, wherever it has got to, and never runs into anything else
    // solid that stays put (buses have their own test below)
    for (const h of lay.hazards) {
      if (!h.swing || !solid(h.kind)) continue;
      const where = `${id} ${h.kind} at s=${h.s}`;
      const near = lay.hazards.filter((o) => o !== h && solid(o.kind) && !o.drive && Math.abs(deltaS(t, h.s, o.s)) < h.r + o.r + 8);
      for (let k = 0; k < 48; k++) {
        const time = (k / 48) * ((Math.PI * 2) / (h.speed ?? 0.5));
        const spans = [h, ...near].map((o) => [hazardD(o, time) - o.r, hazardD(o, time) + o.r]).sort((a, b) => a[0] - b[0]);
        let gap = 0;
        let reached = -t.half;
        for (const [lo, hi] of spans) {
          gap = Math.max(gap, lo - reached);
          reached = Math.max(reached, hi);
        }
        gap = Math.max(gap, t.half - reached);
        assert.ok(gap >= 4.5, `${where} leaves ${gap} m at t=${time}`);
        for (const o of near) {
          if (Math.abs(deltaS(t, h.s, o.s)) < h.r + o.r + 1) assert.ok(Math.abs(hazardD(h, time) - hazardD(o, time)) > h.r + o.r, `${where} runs into the ${o.kind}`);
        }
      }
    }
  });

  test(`${id}: buses keep to a lane on the road, slower than the karts, and leave a way past wherever they are`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    for (const b of lay.hazards.filter((h) => h.drive)) {
      const where = `${id} bus from s=${b.s}`;
      assert.equal(b.kind, 'bus', where);
      assert.ok(b.drive! > 0 && b.drive! < CLASSES['50cc'].top * 0.6, `${where} drives at ${b.drive} m/s`);
      assert.ok(Math.abs(b.d) + b.r <= t.half - 0.5, `${where} keeps to a lane on the road`);
      const bus: [number, number] = [b.d - b.r, b.d + b.r];
      assert.ok(widest(t, [bus]) >= 4.5, `${where} leaves room to pass`);
      for (const o of lay.hazards) {
        // a bus drives through puddles, and cows and cyclists get out of its way
        if (o === b || o.kind === 'mud' || o.swing) continue;
        if (o.drive) {
          // two buses on the same timetable never meet; any others have room to pass between them
          if (o.drive === b.drive) assert.ok(Math.abs(deltaS(t, b.s, o.s)) > BUS_LEN + 20, `${where} sits on the bus from s=${o.s}`);
          else assert.ok(widest(t, [bus, [o.d - o.r, o.d + o.r]]) >= 4.5, `${where} and the bus from s=${o.s} block the road`);
          continue;
        }
        // as it drives past an oil slick or anything solid there is still a gap a kart fits through
        const gap = widest(t, [bus, [o.d - o.r, o.d + o.r]]);
        assert.ok(gap >= 2 * KART_R + 1, `${where} passing the ${o.kind} at s=${o.s} leaves ${gap.toFixed(1)} m`);
      }
    }
  });

  test(`${id}: the grid lines up on the road behind the start line`, () => {
    const t = trackOf(id);
    for (let slot = 0; slot < 8; slot++) {
      const g = gridSpot(t, slot);
      const at = locate(t, g.x, g.z);
      assert.ok(Math.abs(at.d) < t.half - 1, `slot ${slot} d=${at.d}`);
      assert.ok(at.s > t.length - 40, `slot ${slot} is behind the line (s=${at.s})`);
    }
  });

  test(`${id}: a full field of CPU drivers races five laps at 150cc and 200cc inside the walls`, () => {
    for (const cc of ['150cc', '200cc'] as const) {
      const r = createRace({ cc, course: id, seed: 21, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
      assert.equal(r.course, id);
      assert.equal(r.track, trackOf(id));
      let widest = 0;
      let rescues = 0;
      while (r.time < 600 && r.karts.some((k) => k.done === null)) {
        step(r, 1 / 60);
        r.events.length = 0;
        for (const k of r.karts) {
          widest = Math.max(widest, Math.abs(k.d));
          if (k.stuck > 2) rescues++;
        }
      }
      assert.ok(r.karts.every((k) => k.done !== null), `${id} ${cc}: everyone finished by ${r.time}`);
      assert.ok(widest <= r.track.edge, `${id} ${cc}: a kart got ${widest} from the line`);
      assert.equal(rescues, 0, `${id} ${cc}: nobody got stuck`);
      const fastest = Math.min(...r.karts.map((k) => k.done!));
      assert.ok(fastest > meta.leaderboard!.min! / 1000, `${id} ${cc}: ${fastest}s beats the board's floor`);
    }
  });
}

test('solo races and online state carry the course; old packets mean Palm Drive', () => {
  assert.equal(soloRace('100cc', 3).course, 'palm');
  const lake = soloRace('100cc', 3, undefined, 'lake');
  assert.equal(lake.course, 'lake');
  assert.equal(lake.track, trackOf('lake'));
  const S = parsePacket(JSON.parse(JSON.stringify(hostState(2, 1, '150cc', [0], [], 'lake'))));
  assert.ok(S && S.k === 'S' && S.course === 'lake');
  const cfg = parsePacket(JSON.parse(JSON.stringify(configOf(2, '200cc', 'lake'))));
  assert.deepEqual(cfg, { k: 'cfg', round: 2, cc: '200cc', course: 'lake' });
  const old = parsePacket({ t: 'pk', r: 2, k: 'cfg', cc: '50cc' });
  assert.ok(old && old.k === 'cfg' && old.course === 'palm');
  const oldS = parsePacket({ t: 'pk', r: 2, k: 'S', go: 1, cc: '50cc', ro: [0], cars: [] });
  assert.ok(oldS && oldS.k === 'S' && oldS.course === 'palm');
});

test('every course has a leaderboard at every class', () => {
  const variants = meta.leaderboard?.variants ?? {};
  for (const id of COURSE_IDS) for (const cc of CCS) assert.ok(variants[`${id}-${cc}`]?.includes(COURSES[id].name), `${id}-${cc}`);
  assert.equal(Object.keys(variants).length, COURSE_IDS.length * CCS.length);
});
