import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, DIFFICULTY, isCourse, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { CCS, CLASSES, KART_R, RIVALS, WET, createRace, hazardD, soloRace, step } from '../src/os/arcade/games/palmdrive/logic.ts';
import { meta } from '../src/os/arcade/games/palmdrive/meta.ts';
import { configOf, hostState, parsePacket } from '../src/os/arcade/games/palmdrive/net.ts';
import { BALL_FLIGHT, BALL_ROLL, BALL_WINDOW, EDGE, ROAD_HALF, ballSince, deltaS, dropAt, gridSpot, lengthOf, locate, openRuns, pointAt, roadEdge, shoreOf, solid, timed, wrapS, type Hazard, type Track } from '../src/os/arcade/games/palmdrive/track.ts';

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
    // (the walls at least a kart's width and a half past the edge of the road; on Insane the road can be narrower)
    assert.ok(t.half >= (COURSES[id].difficulty === 5 ? 4.5 : 5.5) && t.half <= 11 && t.edge - t.half >= 2.5, `${id} road ${t.half}/${t.edge}`);
  }
  for (const junk of ['', 'moon', null, 3]) assert.equal(isCourse(junk), false);
});

for (const id of COURSE_IDS) {
  test(`${id}: a closed loop of sensible length that never runs into itself or bends too tight`, () => {
    const t = trackOf(id);
    assert.equal(trackOf(id), t, 'built once');
    assert.ok(t.length > 600 && t.length < 1400, `length ${t.length}`);
    // stretches far apart along the lap stay clear of each other: each one's edge toward the other (its wall, or the
    // brink where it drops away), and 4 m between them
    const limit = (i: number, side: number) => (side > 0 ? t.hi[i] : -t.lo[i]);
    const toward = (i: number, j: number) => ((t.x[j] - t.x[i]) * -t.tz[i] + (t.z[j] - t.z[i]) * t.tx[i] >= 0 ? 1 : -1);
    let short = Infinity;
    for (let i = 0; i < t.n; i++) {
      for (let j = i + 1; j < t.n; j++) {
        if (Math.min(j - i, t.n - (j - i)) * t.step < 70) continue;
        const gap = Math.hypot(t.x[i] - t.x[j], t.z[i] - t.z[j]) - limit(i, toward(i, j)) - limit(j, toward(j, i)) - 4;
        short = Math.min(short, gap);
      }
    }
    assert.ok(short > 0, `${id}: two stretches come within ${(short + 4).toFixed(1)} m of each other's edges`);
    // any tighter and the edge on the inside would fold over itself (with room to spare for the drop's lip)
    for (let i = 0; i < t.n; i++) {
      const radius = 1 / Math.max(1e-9, Math.abs(t.curv[i]));
      assert.ok(radius > limit(i, Math.sign(t.curv[i]) || 1) + 3, `${id}: a ${radius.toFixed(1)} m bend at s=${(i * t.step).toFixed(0)}`);
    }
    // a bend tighter than a hairpin's 18 m only where the course is Expert (or Insane), the walls everywhere else
    let tightest = Infinity;
    for (let i = 0; i < t.n; i++) tightest = Math.min(tightest, 1 / Math.max(1e-9, Math.abs(t.curv[i])));
    assert.ok(tightest > (COURSES[id].difficulty === 5 ? 11 : COURSES[id].difficulty === 4 ? 12 : 18), `tightest bend ${tightest}`);
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
    // (coins can be bait out on the curb where the road drops away, within reach of a kart still on the road)
    const bait = (p: { s: number; d: number }) => lay.coins.includes(p) && dropAt(t, Math.round(p.s / t.step), Math.sign(p.d));
    // (on Insane, within a meter of the edge of the road where it is, narrows and all)
    const insane = COURSES[id].difficulty === 5;
    for (const p of [...lay.boxes, ...lay.coins, ...lay.dashes]) assert.ok(Math.abs(p.d) <= (insane ? roadEdge(t, p.s, Math.sign(p.d) || 1) - (bait(p) ? 0.5 : 1) : t.half - (bait(p) ? 0.5 : 1.5)), `${id} pickup at s=${p.s} d=${p.d}`);
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

  test(`${id}: mud, sand, oil, bales, boulders, planters, flagsticks, cows, bikes, golfers and carts sit on the road, clear of the start, and always leave a way past`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    for (const h of lay.hazards) {
      const where = `${id} ${h.kind} at s=${h.s}`;
      assert.ok(h.r > 0, where);
      // (a bus or a cart waits here for the green light)
      assert.ok(h.s > 40 && h.s < t.length - 30, `${where} is clear of the start`);
      // (a pond lies off beside the road: see below; a bank of bollards runs wall to wall by design, and the set pieces
      // leave a way through by the clock: see the timed tests)
      if (h.kind !== 'water' && h.kind !== 'bollard') assert.ok(Math.abs(h.d) + (h.swing ?? 0) <= t.half, `${where} stays on the road`);
      // buses drive the whole lap, so where they start says nothing about the boxes and boosts (see below)
      if (!solid(h.kind) || h.drive) continue;
      // a gap at least two karts wide beside anything solid, and none of them in front of an item box row (the set
      // pieces leave a way through by the clock instead, on a course built round them: see the timed tests)
      const room = Math.max(t.half - (h.d + h.r), h.d - h.r + t.half);
      if (!h.swing && h.kind !== 'bollard' && !(timed(h.kind) && COURSES[id].difficulty === 5)) assert.ok(room >= 4.5, `${where} leaves ${room} m`);
      for (const b of lay.boxes) assert.ok(Math.abs(deltaS(t, h.s, b.s)) > 10, `${where} is in front of the boxes at s=${b.s}`);
      for (const o of lay.hazards) if (o !== h && solid(o.kind) && !h.swing && !o.swing && !o.drive && h.kind !== 'bollard' && o.kind !== 'bollard') assert.ok(Math.abs(deltaS(t, h.s, o.s)) > 8 || Math.abs(h.d - o.d) > 2 * h.r + 5, `${where} crowds another`);
    }
    // nothing solid right where a dash panel or a ramp sends you
    for (const p of [...lay.dashes, ...lay.ramps]) {
      for (const h of lay.hazards) if (solid(h.kind) && !h.drive) assert.ok(deltaS(t, p.s, h.s) < 0 || deltaS(t, p.s, h.s) > 30, `${id} ${h.kind} at s=${h.s} right after a boost at s=${p.s}`);
    }
    // and no coins, boxes or dash panels leading you into something solid in the same lane (the set pieces included:
    // a bank is as wide as it is)
    for (const p of [...lay.coins, ...lay.boxes, ...lay.dashes]) {
      for (const h of lay.hazards) {
        if (!solid(h.kind) || h.swing || h.drive) continue;
        const ahead = deltaS(t, p.s, h.s);
        const wide = h.kind === 'bollard' ? (h.w ?? 0) / 2 : h.r;
        assert.ok(ahead <= 0 || ahead > 15 || Math.abs(p.d - h.d) > wide + 1.6, `${id} pickup at s=${p.s} d=${p.d} leads into the ${h.kind} at s=${h.s}`);
      }
    }
    // anything crossing the road never shuts the way past, wherever it has got to, and never runs into anything else
    // solid (buses and carts driving their rounds have their own test below; golfers crossing together keep in step)
    const together = (a: Hazard, b: Hazard) => a.swing === b.swing && a.speed === b.speed && a.phase === b.phase && a.d === b.d;
    for (const h of lay.hazards) {
      // (on Insane the swinging set pieces leave their way past by the clock: see the timed tests)
      if (!h.swing || !solid(h.kind) || (timed(h.kind) && COURSES[id].difficulty === 5)) continue;
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
          if (Math.abs(deltaS(t, h.s, o.s)) < h.r + o.r + 1 && !together(h, o)) assert.ok(Math.abs(hazardD(h, time) - hazardD(o, time)) > h.r + o.r, `${where} runs into the ${o.kind}`);
        }
      }
    }
  });

  test(`${id}: buses and carts keep to a lane on the road, slower than the karts, and leave a way past wherever they are`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    // (on the water: the coach's launches, a tug and its barge, and logs drifting with the current, the barge and the logs
    // only on their stretch of the course)
    const onSpan = (b: Hazard, s: number) => !b.span || (deltaS(t, b.span[0], s) >= 0 && deltaS(t, s, b.span[1]) >= 0);
    for (const b of lay.hazards.filter((h) => h.drive)) {
      const where = `${id} ${b.kind} from s=${b.s}`;
      assert.ok(b.kind === 'bus' || b.kind === 'cart' || b.kind === 'launch' || b.kind === 'barge' || b.kind === 'log', where);
      assert.ok(!b.swing, `${where} keeps to its lane`);
      if (b.kind === 'log') assert.ok(b.drive! > 0 && b.drive! <= 2, `${where} drifts at ${b.drive} m/s`);
      else assert.ok(b.drive! > 0 && b.drive! < CLASSES['50cc'].top * 0.6, `${where} drives at ${b.drive} m/s`);
      assert.ok(Math.abs(b.d) + b.r <= t.half - 0.5, `${where} keeps to a lane on the road`);
      const bus: [number, number] = [b.d - b.r, b.d + b.r];
      assert.ok(widest(t, [bus]) >= 4.5, `${where} leaves room to pass`);
      for (const o of lay.hazards) {
        // a bus or a cart drives through puddles and bunkers, cows, cyclists and golfers get out of its way, golf
        // balls come and go (the CPU drivers and the ball tests see to those), and the set pieces stand aside for it
        // (right of way: see the timed tests)
        if (o === b || o.kind === 'mud' || o.kind === 'sand' || o.kind === 'water' || o.kind === 'ball' || o.kind === 'wet' || o.swing || timed(o.kind)) continue;
        // (a vessel on a stretch of the course only passes what is on it, and rides the weir: a gap right across the road)
        if (!onSpan(b, o.s) || (o.kind === 'trench' && (o.w ?? o.r) >= t.half + 1)) continue;
        if (o.drive) {
          // two on the same timetable never meet; any others have room to pass between them (vessels on the same stretch
          // keep to their timetables: see the river tests)
          if (o.drive === b.drive && !o.span && !b.span) assert.ok(Math.abs(deltaS(t, b.s, o.s)) > Math.max(lengthOf(b), lengthOf(o)) + 20, `${where} sits on the ${o.kind} from s=${o.s}`);
          else assert.ok(widest(t, [bus, [o.d - o.r, o.d + o.r]]) >= 4.5, `${where} and the ${o.kind} from s=${o.s} block the road`);
          continue;
        }
        // as it drives past an oil slick or anything solid there is still a gap a kart fits through
        const gap = widest(t, [bus, [o.d - o.r, o.d + o.r]]);
        assert.ok(gap >= 2 * KART_R + 1, `${where} passing the ${o.kind} at s=${o.s} leaves ${gap.toFixed(1)} m`);
      }
      // anyone or anything crossing the road is over on the far side whenever it comes by (never driven through); the
      // wrecking ball is hauled up for it instead
      for (const o of lay.hazards) {
        if (!o.swing || !solid(o.kind) || timed(o.kind) || !onSpan(b, o.s)) continue;
        for (let lap = 0; lap < 6; lap++) {
          const when = (((o.s - b.s + t.length) % t.length) + lap * t.length) / b.drive!;
          for (const dt of [-0.6, 0, 0.6]) {
            const d = hazardD(o, when + dt);
            assert.ok(Math.abs(d - b.d) > o.r + b.r + 0.5, `${where} drives through the ${o.kind} at s=${o.s} (d=${d.toFixed(1)}) on lap ${lap}`);
          }
        }
      }
    }
  });

  test(`${id}: ponds come right up to the curb but never onto the road, and the wall opens up only where one does`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    const ponds = lay.hazards.filter((h) => h.kind === 'water');
    const shore = shoreOf(t, lay.hazards);
    if (!ponds.length) {
      assert.equal(shore, null, `${id} has no water`);
      // walls all the way round but where the course itself says the road drops away
      if (!COURSES[id].edges) assert.deepEqual(openRuns(t), [], `${id} has its walls all the way round`);
      return;
    }
    assert.ok(shore);
    for (let i = 0; i < t.n; i++) {
      // never onto the road: a kart whose middle is up to half a meter past the edge of the road is dry
      for (const w of [shore.left[i], shore.right[i]]) assert.ok(w - WET > t.half + 0.5, `${id} water ${w.toFixed(2)} m from the line at s=${i * t.step}`);
    }
    for (const h of ponds) {
      const where = `${id} pond at s=${h.s}`;
      // off beside the road, past the wall line
      const c = pointAt(t, h.s, h.d);
      assert.ok(Math.abs(locate(t, c.x, c.z).d) > t.edge + 2, `${where} is off the road`);
      // and somewhere a kart running wide (its middle as far out as the wall lets it) gets wet: a good stretch of it
      let wet = 0;
      for (let i = 0; i < t.n; i++) {
        const p = pointAt(t, i * t.step, Math.sign(h.d) * (t.edge - KART_R));
        if (Math.hypot(p.x - c.x, p.z - c.z) < h.r + WET) wet += t.step;
      }
      assert.ok(wet >= 12, `${where} can be driven into along ${wet} m`);
    }
    // the wall is left out where the water comes inside it, and only there
    const gaps = openRuns(t);
    assert.ok(gaps.length > 0 && gaps.every(([, , , past]) => past === 'water'));
    // and wherever it is left out, the water comes right up to the curb somewhere: run a wheel over and you are in
    for (const [side, from, to] of gaps) {
      let closest = Infinity;
      for (let s = from; deltaS(t, s, to) > 0; s += t.step) closest = Math.min(closest, (side < 0 ? shore.left : shore.right)[Math.floor(wrapS(t, s) / t.step) % t.n]);
      assert.ok(Math.abs(closest - (t.half + 1.2)) <= 0.2, `${id} water comes within ${closest.toFixed(2)} m of the line between s=${from} and ${to}`);
    }
    for (let i = 0; i < t.n; i++) {
      for (const side of [-1, 1]) {
        const w = side < 0 ? shore.left[i] : shore.right[i];
        const open = dropAt(t, i, side);
        // (where the water is inside where a wall would hold a kart anyway; a little past that the wall stands as ever)
        if (w - WET < t.edge - KART_R) assert.ok(open, `${id} wall stands in the water at s=${i * t.step}`);
        else assert.ok(!open, `${id} wall missing at s=${i * t.step} with the water held off by it anyway`);
        if (open) assert.ok(w < t.edge + 3, `${id} wall missing at s=${i * t.step} with the water ${w.toFixed(1)} m out`);
        // and you are in once your middle is WET short of the water
        if (open) assert.ok(Math.abs((side > 0 ? t.hi[i] : -t.lo[i]) - (w - WET)) < 1e-4, `${id} brink at s=${i * t.step}`);
      }
    }
  });

  test(`${id}: golf balls land on the road, never on a pickup or anything that stays put, and nothing leads you under one`, () => {
    const t = trackOf(id);
    const lay = COURSES[id].layout(t);
    const balls = lay.hazards.filter((h) => h.kind === 'ball');
    const reach = (b: Hazard) => b.r + KART_R + 1;
    for (const b of balls) {
      const where = `${id} ball at s=${b.s}`;
      assert.ok(Math.abs(b.d) + b.r <= t.half - 1, `${where} lands on the road`);
      // one ball in the air at a time from each tee: up, down and away before the next
      assert.ok(b.every! >= BALL_FLIGHT + BALL_ROLL, `${where} every ${b.every}`);
      // hit from a tee well off the road
      assert.ok(b.tee, `${where} has a tee`);
      const tee = pointAt(t, b.s + b.tee![0], b.tee![1]);
      assert.ok(Math.abs(locate(t, tee.x, tee.z).d) > t.edge + 4, `${where} is hit from off the road`);
      // pickups never sit under it or lead straight into it
      for (const p of [...lay.coins, ...lay.boxes, ...lay.dashes, ...lay.ramps]) {
        const ahead = deltaS(t, p.s, b.s);
        if (ahead > -reach(b) && ahead < 15) assert.ok(Math.abs(p.d - b.d) > reach(b) + ('w' in p ? p.w / 2 : 0), `${where} lands on (or just past) the pickup at s=${p.s} d=${p.d}`);
      }
      // and it never lands on anything solid that stays put
      for (const o of lay.hazards) {
        if (!solid(o.kind) || o.swing || o.drive) continue;
        const a = pointAt(t, b.s, b.d);
        const q = pointAt(t, o.s, o.d);
        assert.ok(Math.hypot(a.x - q.x, a.z - q.z) > b.r + o.r + 2, `${where} lands on the ${o.kind} at s=${o.s}`);
      }
      // balls landing close together come down at different moments, so there is always a clear way through
      for (const o of balls) {
        if (o === b || Math.abs(deltaS(t, b.s, o.s)) > 20 || o.every !== b.every) continue;
        const apart = Math.abs(ballSince(b, 0) - ballSince(o, 0));
        assert.ok(Math.min(apart, b.every! - apart) > 4 * BALL_WINDOW, `${where} and the ball at s=${o.s} land together`);
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
  for (const id of COURSE_IDS) for (const cc of CCS) assert.ok(variants[`${COURSES[id].board ?? id}-${cc}`]?.includes(COURSES[id].name), `${id}-${cc}`);
  assert.equal(Object.keys(variants).length, COURSE_IDS.length * CCS.length);
});
