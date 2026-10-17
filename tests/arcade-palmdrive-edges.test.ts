import assert from 'node:assert/strict';
import { test } from 'node:test';
import { COURSES, COURSE_IDS, TIER, tierOf, trackOf } from '../src/os/arcade/games/palmdrive/courses.ts';
import { DROP_WINDOW, FALL_CARRY, FALL_SINK, KART_R, RIVALS, createRace, rescue, spawn, step, type Ev, type Kart, type Race } from '../src/os/arcade/games/palmdrive/logic.ts';
import { meta } from '../src/os/arcade/games/palmdrive/meta.ts';
import { F_SUNK, applyFlags, flagsOf } from '../src/os/arcade/games/palmdrive/net.ts';
import { deltaS, dropAt, edgeAt, edgeRuns, headingOf, inTrench, locate, openRuns, pointAt, solid, timed, wallRuns, wrapAngle, type Track } from '../src/os/arcade/games/palmdrive/track.ts';

const DT = 1 / 60;

/** A race at Hoover Nights (or another course), past the lights, with n hand-driven karts. */
function race(n = 1, course: 'hoover' | 'golf' | 'palm' = 'hoover', cc: '50cc' | '100cc' | '150cc' | '200cc' = '150cc'): Race {
  return createRace({ cc, course, seed: 5, countdown: 0, racers: Array.from({ length: n }, (_, i) => ({ name: `p${i}`, color: '#e53935', kind: 'player' as const })) });
}

function place(r: Race, k: Kart, s: number, d = 0, v = 0, turn = 0) {
  const p = pointAt(r.track, s, d);
  const at = locate(r.track, p.x, p.z);
  Object.assign(k, { x: p.x, z: p.z, h: headingOf(p.tx, p.tz) + turn, v, i: at.i, s: at.s, d: at.d, prog: s });
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

/** Share of the lap where a side (or both) drops away. */
function openShare(t: Track) {
  let one = 0;
  let both = 0;
  for (let i = 0; i < t.n; i++) {
    const l = dropAt(t, i, -1);
    const h = dropAt(t, i, 1);
    if (l || h) one++;
    if (l && h) both++;
  }
  return { one: one / t.n, both: both / t.n };
}

for (const id of COURSE_IDS) {
  test(`${id}: the edges lie inside the lap, well clear of the start line, with brinks and walls far enough out`, () => {
    const t = trackOf(id);
    const c = COURSES[id];
    for (const [s0, s1, side, past, at] of c.edges ?? []) {
      const where = `${id} ${past} ${s0}-${s1}`;
      assert.ok(s0 >= 0 && s1 > s0 && s1 <= t.length, `${where} lies inside the lap`);
      assert.ok([-1, 0, 1].includes(side), where);
      if (past !== 'wall') assert.ok(s0 >= 60 && s1 <= t.length - 60, `${where} is within 60 m of the start line`);
      if (at !== undefined) assert.ok(past === 'wall' ? at >= t.half + 1.5 : at >= t.half + 0.5, where);
    }
    const lay = c.layout(t);
    const plates = (s: number) => lay.hazards.some((h) => h.kind === 'trench' && deltaS(t, h.s, s) > -t.step && deltaS(t, h.s, s) < (h.len ?? 0) + t.step);
    for (let i = 0; i < t.n; i++) {
      const s = i * t.step;
      for (const side of [-1, 1]) {
        const lim = side > 0 ? t.hi[i] : -t.lo[i];
        if (dropAt(t, i, side)) {
          // the start straight is walled for 60 m either side of the line
          assert.ok(s >= 60 && s <= t.length - 60, `${id} drops away ${s.toFixed(0)} m from the start line`);
          // over a trench, its plates; anywhere else at least half a meter past the edge of the road
          if (plates(s)) assert.ok(Math.abs(lim - (t.half - 0.4)) < 1e-6, `${id} plates at s=${s}`);
          else assert.ok(lim >= t.half + 0.5 - 1e-6, `${id} brink ${lim.toFixed(2)} at s=${s}`);
        } else assert.ok(lim >= t.half + 1.5 - 1e-6, `${id} wall ${lim.toFixed(2)} at s=${s}`);
      }
    }
    // the runs of wall and drop cover each side of the lap once
    for (const side of [-1, 1]) {
      const len = edgeRuns(t)
        .filter(([sd]) => sd === side)
        .reduce((sum, [, a, b]) => sum + b - a, 0);
      assert.ok(Math.abs(len - t.length) < 1e-6, `${id} side ${side} runs cover ${len}`);
    }
  });
}

test('Hoover Nights drops away along four tenths of the lap, both sides along the causeway, and never on the start straight or K', () => {
  const t = trackOf('hoover');
  const share = openShare(t);
  assert.ok(share.one > 0.36 && share.one < 0.46, `open on one side or both: ${share.one.toFixed(3)}`);
  assert.ok(share.both > 0.05 && share.both < 0.08, `open on both: ${share.both.toFixed(3)}`);
  // the drops are where the plan has them: the fountain, the Dig, the trench, the pool, the Claw and the ditch
  const runs = openRuns(t).map(([side, a, b, past]) => [side, Math.round(a), Math.round(b), past]);
  assert.deepEqual(runs, [
    [-1, 127, 181, 'water'],
    [-1, 331, 405, 'pit'],
    [-1, 581, 633, 'water'],
    [1, 201, 431, 'pit'],
    [1, 431, 489, 'water'],
    [1, 895, 973, 'pit'],
  ]);
  // K, the straight past Memorial Church, is walled on both sides
  for (let s = 762; s <= 890; s += t.step) assert.ok(!dropAt(t, Math.round(s / t.step), -1) && !dropAt(t, Math.round(s / t.step), 1), `K open at ${s}`);
  // and Expert's brink is a little past the edge of the road: half the kart is over the drop when its middle goes
  assert.equal(TIER[4].brink, 0.6);
  assert.ok(Math.abs(edgeAt(t, 150, -1).lim - (t.half + 0.6)) < 1e-6);
  assert.ok(TIER[3].brink >= 1);
});

test('the hairpins on Hoover Nights are real hairpins: a kart has to brake or drift for three of them', () => {
  const t = trackOf('hoover');
  const radius = (s0: number, s1: number) => {
    let tight = Infinity;
    for (let s = s0; s <= s1; s += t.step) tight = Math.min(tight, 1 / Math.max(1e-9, Math.abs(t.curv[Math.floor(s / t.step) % t.n])));
    return tight;
  };
  assert.ok(Math.abs(t.length - 1133.5) < 1, `length ${t.length}`);
  for (const [s0, s1, lo, hi] of [[130, 176, 12.5, 14.5], [262, 314, 13.5, 15], [584, 628, 12, 13.5]]) {
    const r = radius(s0, s1);
    assert.ok(r > lo && r < hi, `hairpin at ${s0}: ${r.toFixed(1)} m`);
    // flat out at 150cc a kart turns 1.5 rad/s or so: these need a brake or a drift
    assert.ok(27.5 / r > 1.55, `hairpin at ${s0} is flat out`);
  }
});

test('the trench: a ramp lip just before it, a kart at 13.5 m/s clears it, and a fall puts you back with a run-up', () => {
  const r = race();
  const t = r.track;
  assert.equal(r.holes.length, 1);
  const h = r.holes[0];
  const w = h.w ?? h.r;
  const ramp = r.ramps.find((p) => Math.abs(deltaS(t, p.s, h.s)) < 3);
  assert.ok(ramp, 'a ramp');
  const before = deltaS(t, ramp.s, h.s);
  assert.ok(before >= 0 && before <= 1.5, `lip ${before} m before the hole`);
  assert.ok(Math.abs(ramp.d - h.d) + w <= ramp.w / 2, 'the ramp is as wide as the hole');
  // the plates either side, out to the brink
  for (let s = h.s; s <= h.s + (h.len ?? 0); s += 1) {
    assert.ok(Math.abs(edgeAt(t, s, 1).lim - (t.half - 0.4)) < 0.01 && dropAt(t, Math.round(s / t.step), 1) && dropAt(t, Math.round(s / t.step), -1));
  }
  // a kart going 13.5 m/s up the ramp sails over
  const k = r.karts[0];
  place(r, k, ramp.s - 5, ramp.d, 13.5);
  let landed = false;
  const evs = run(r, 1.3, () => {
    if (k.y === 0 && deltaS(t, h.s + (h.len ?? 0), k.s) > 0) landed = true;
    if (!landed && k.y === 0) k.v = Math.min(k.v, 13.5);
  });
  assert.ok(!evs.some((e) => e.t === 'fall'), 'no fall');
  assert.ok(landed && k.sunk === 0, 'landed past it');
  // one going too slowly drops in, and is put back on the run-up with room to get going: 14 m or more, clear of
  // anything solid
  const s2 = race();
  const q = s2.karts[0];
  place(s2, q, h.s - 0.6, 0, 5);
  const fell = run(s2, 0.6);
  assert.ok(fell.some((e) => e.t === 'fall' && e.k === q.idx && e.kind === 'pit'), 'down the trench');
  assert.ok(q.fell && q.fell.hole);
  const [s, d] = q.fell.to;
  assert.ok(deltaS(t, s, ramp.s) >= 14, `put back ${deltaS(t, s, ramp.s).toFixed(1)} m before the lip`);
  assert.equal(s, h.back);
  for (const o of s2.hazards) if (solid(o.kind) && !o.drive && !o.swing) assert.ok(deltaS(t, s - 2, o.s) < 0 || deltaS(t, s - 2, o.s) > 16, `${o.kind} at ${o.s}`);
  assert.ok(Math.abs(d) <= t.half - 1.5);
  // running off the side of the causeway on the run-up puts you back where you went off (never carried forward)
  const s3 = race();
  const u = s3.karts[0];
  place(s3, u, h.back - 5, -6, 20, 0.5);
  run(s3, 0.4);
  assert.ok(u.sunk > 0 && u.fell);
  assert.ok(Math.abs(deltaS(t, u.fell.to[0], h.back - 5)) < 2.5, `carried to ${u.fell.to[0]}`);
  // from the run-up before that, back to the start of it
  const s4 = race();
  const w2 = s4.karts[0];
  place(s4, w2, h.s - 8, -6, 20, 0.5);
  run(s4, 0.4);
  assert.ok(w2.sunk > 0 && w2.fell);
  assert.ok(Math.abs(deltaS(t, w2.fell.to[0], h.back)) < 1e-6, `to ${w2.fell.to[0]}`);
  // and once past the hole, you are set down past it: never sent back to jump it again
  const s5 = race();
  const v = s5.karts[0];
  place(s5, v, h.s + (h.len ?? 0) + 1.5, -6.5, 20, 0.5);
  run(s5, 0.4);
  assert.ok(v.sunk > 0 && v.fell);
  assert.ok(deltaS(t, h.s + (h.len ?? 0), v.fell.to[0]) >= -0.5, `sent back to ${v.fell.to[0]}`);
});

test('over the brink with the wheels on the road you fall in; the crane sets you back down where you went off', () => {
  const r = race();
  const k = r.karts[0];
  k.coins = 7;
  k.item = 'mushroom';
  k.uses = 1;
  // off the left side of the causeway, angled across it
  place(r, k, 350, -5, 18, 0.5);
  const evs = run(r, 0.3);
  const fall = evs.find((e) => e.t === 'fall' && e.k === k.idx);
  assert.ok(fall && fall.t === 'fall' && fall.kind === 'pit', 'into the pit');
  assert.ok(k.sunk > 0 && k.v === 0 && k.falls === 1);
  assert.equal(k.coins, 7 - r.tier.fallCoins);
  assert.equal(k.item, 'mushroom', 'the item is kept');
  assert.ok(k.fell);
  const went = locate(r.track, k.x, k.z);
  assert.ok(Math.abs(went.d) > r.track.half + 0.5, `went over at d=${went.d.toFixed(2)}`);
  // the crane takes fallT, a share sinking out of sight, a share carrying the kart back and the rest setting it down
  assert.ok(FALL_SINK > 0.2 && FALL_SINK + FALL_CARRY < 0.85);
  assert.equal(r.tier.fallT, 1.7);
  const to = k.fell.to;
  const out: Ev[] = [];
  while (k.sunk > 0 && r.time < 5) out.push(...run(r, DT));
  assert.ok(out.some((e) => e.t === 'set' && e.k === k.idx));
  const at = locate(r.track, k.x, k.z);
  assert.ok(Math.abs(at.s - to[0]) < 0.5 && Math.abs(at.d - to[1]) < 0.1, 'where the crane said');
  assert.ok(Math.abs(deltaS(r.track, went.s, at.s)) < 10, `back near where it went off (${went.s.toFixed(0)} -> ${at.s.toFixed(0)})`);
  // well clear of the brink, facing down the road, with a moment's grace
  assert.ok(Math.abs(at.d) <= edgeAt(r.track, at.s, Math.sign(at.d) || 1).lim - 3 + 1e-6, `set down at d=${at.d.toFixed(2)}`);
  assert.ok(Math.abs(wrapAngle(k.h - headingOf(at.tx, at.tz))) < 0.05);
  assert.ok(k.safe > 0 && k.v === 0);
});

test('into the water at the fountain it is a splash; the same drop start works after a fall into a pit', () => {
  const r = race();
  const k = r.karts[0];
  // cutting the first hairpin's apex into Tanner Fountain
  place(r, k, 150, -5.5, 16, 0.9);
  const evs = run(r, 0.4);
  assert.ok(evs.some((e) => e.t === 'splash' && e.k === k.idx), 'a splash');
  assert.equal(k.fell?.past, 'water');
  for (const when of ['in time', 'never'] as const) {
    const s = race();
    const q = s.karts[0];
    place(s, q, 350, -5, 18, 0.5);
    run(s, 0.3);
    assert.ok(q.sunk > 0, when);
    while (q.sunk > DROP_WINDOW * 0.5) run(s, DT);
    if (when === 'in time') q.input.hop = true;
    const after = run(s, 0.6);
    assert.equal(after.some((e) => e.t === 'turbo' && e.k === q.idx), when === 'in time', when);
  }
});

test('nothing holds you on: a hop sails over the brink and you fall where you land, a star does not save you, a bullet does', () => {
  // in the air over the drop: no fall until the wheels come down
  const r = race();
  const k = r.karts[0];
  place(r, k, 345, -6.2, 14, 0.6);
  k.y = 0.9;
  k.vy = 4;
  const air = run(r, 4 * DT);
  assert.ok(!air.some((e) => e.t === 'fall'), 'not in the air');
  run(r, 0.6);
  assert.ok(k.sunk > 0, 'in once it came down');
  // a star does not keep you on the road
  const s = race();
  const q = s.karts[0];
  q.star = 3;
  place(s, q, 350, -5, 18, 0.5);
  run(s, 0.3);
  assert.ok(q.sunk > 0, 'a star falls too');
  // a bullet rides its rails over anything
  const b = race();
  const u = b.karts[0];
  u.bullet = 3;
  place(b, u, 350, -6.3, 30, 0.3);
  const ev = run(b, 0.5);
  assert.ok(!ev.some((e) => e.t === 'fall'), 'a bullet stays up');
  assert.ok(Math.abs(u.d) < 6.6);
});

test('walls still stand where there is no drop: you slide along them', () => {
  const r = race();
  const k = r.karts[0];
  place(r, k, 800, 7.5, 20, -0.4);
  const evs = run(r, 0.5);
  assert.ok(!evs.some((e) => e.t === 'fall'));
  assert.ok(Math.abs(k.d) <= r.track.edge - KART_R + 0.01);
  assert.equal(wallRuns(r.track).length, 5);
  // and no stub of wall anywhere: a short run between two drops reads as a gap in the lip
  for (const [, a, b] of wallRuns(r.track)) assert.ok(b - a >= 20, `wall run ${a}-${b}`);
  // the ditch stands further out through L itself, so a late brake into the bend is not a fall
  assert.ok(Math.abs(edgeAt(r.track, 912, 1).lim - 7.2) < 1e-6);
  assert.ok(Math.abs(edgeAt(r.track, 950, 1).lim - (r.track.half + 0.6)) < 1e-6);
});

test('shells and bananas over the edge sink; green shells still bounce off the walls; blue shells fly on', () => {
  const r = race();
  const t = r.track;
  const p = pointAt(t, 360, -4);
  const fwd = { fx: -p.tz, fz: p.tx };
  // a green shell fired off the left side of the causeway
  spawn(r, { kind: 'green', owner: 0, x: p.x, z: p.z, y: 0.35, vx: -fwd.fx * 40, vz: -fwd.fz * 40, vy: 0, grace: 0, target: -1, prog: 0 });
  // a banana dropped just past the brink
  const b = pointAt(t, 370, -7);
  spawn(r, { kind: 'banana', owner: 0, x: b.x, z: b.z, y: 0, vx: 0, vz: 0, vy: 0, grace: 0, target: -1, prog: 0 });
  r.karts[0].x += 300;
  const evs = run(r, 0.3);
  assert.equal(evs.filter((e) => e.t === 'sank').length, 2, 'both sank');
  assert.equal(r.things.length, 0);
  // into the wall beside the start straight a green shell bounces
  const s = race();
  const w = pointAt(s.track, 20, 5);
  const g = spawn(s, { kind: 'green', owner: 0, x: w.x, z: w.z, y: 0.35, vx: -w.tz * 40, vz: w.tx * 40, vy: 0, grace: 0, target: -1, prog: 0 });
  s.karts[0].x += 300;
  const ev2 = run(s, 0.3);
  assert.ok(!ev2.some((e) => e.t === 'sank'));
  assert.ok(g.bounces > 0 && s.things.includes(g), 'bounced');
});

test('online, a kart off the road is shown under, waiting for the crane', () => {
  const r = race(2);
  const [a, b] = r.karts;
  place(r, a, 350, -5, 18, 0.5);
  run(r, 0.3);
  assert.ok(a.sunk > 0);
  const f = flagsOf(a);
  assert.ok(f & F_SUNK);
  applyFlags(b, f);
  assert.ok(b.sunk > 0);
});

test('a CPU fished out of a drop keeps well clear of the edge for a while, but a shove still sends it in like anyone', () => {
  const r = createRace({ cc: '150cc', course: 'hoover', seed: 5, countdown: 0, racers: [RIVALS[6]] });
  const [k] = r.karts;
  // over the brink on the left of the causeway
  place(r, k, 350, -6.8, 18, 0.3);
  run(r, DT);
  assert.ok(k.sunk > 0 && k.ai!.care > 0, 'in');
  while (k.sunk > 0) run(r, DT);
  // left to itself along the causeway it keeps a wide berth from the brink while it is still shaken
  let nearest = 0;
  run(r, 3, () => (nearest = Math.min(nearest, k.d)));
  assert.ok(k.ai!.care > 0);
  assert.ok(nearest > -(r.track.half + 0.6 - KART_R - 1.2), `too close to the brink at d=${nearest.toFixed(2)}`);
  // but slammed straight at it nothing holds it on: the same shove that sends anyone else in sends it in
  place(r, k, 360, -4, 18);
  k.y = 0;
  k.vy = 0;
  const p = pointAt(r.track, 360);
  k.kx = p.tz * 20;
  k.kz = -p.tx * 20;
  assert.ok(run(r, 0.6).some((e) => e.t === 'fall'), 'in, like anyone');
  // and so it does anyone else
  const s = race();
  const [q] = s.karts;
  place(s, q, 360, -4, 18);
  q.kx = p.tz * 20;
  q.kz = -p.tx * 20;
  assert.ok(run(s, 0.6).some((e) => e.t === 'fall'), 'in without it');
});

test('the golf course\'s ponds are drops like any other: the edge is the water\'s', () => {
  const t = trackOf('golf');
  const lay = COURSES.golf.layout(t);
  assert.ok(lay.hazards.some((h) => h.kind === 'water'));
  const water = openRuns(t);
  assert.ok(water.length >= 2 && water.every(([, , , past]) => past === 'water'));
  assert.equal(tierOf('golf').brink, 0.6);
});

test('Hoover Nights has its own leaderboards, the old ones left as they were', () => {
  assert.equal(COURSES.hoover.board, 'hoover2');
  const variants = meta.leaderboard?.variants ?? {};
  for (const cc of ['50cc', '100cc', '150cc', '200cc']) {
    assert.equal(variants[`hoover2-${cc}`], `Hoover Nights ${cc}`);
    assert.equal(variants[`hoover-${cc}`], undefined);
  }
});

test('rescue() on its own still puts a stuck kart back where it is', () => {
  const r = race();
  const k = r.karts[0];
  place(r, k, 820, 2, 0);
  rescue(r, k);
  const at = locate(r.track, k.x, k.z);
  assert.ok(Math.abs(at.s - 820) < 4.5 && Math.abs(at.d) <= r.track.half - 1.5);
  assert.ok(!inTrench(r.track, r.holes[0], at.s, at.d));
});

test('CPU-only races at Hoover Nights at every class: everyone finishes, nobody gets stuck, and the CPUs mostly stay on the road', () => {
  let falls = 0;
  let caught = 0;
  let races = 0;
  for (const cc of ['50cc', '100cc', '150cc', '200cc'] as const) {
    for (const seed of [3, 4, 5]) {
      const r = createRace({ cc, course: 'hoover', seed, racers: [...RIVALS, { ...RIVALS[3], name: 'extra' }] });
      const at: number[][] = r.karts.map(() => []);
      const hits: Record<string, number> = {};
      let stuck = 0;
      while (r.time < 600 && r.karts.some((k) => k.done === null)) {
        step(r, DT);
        for (const k of r.karts) if (k.stuck > 2) stuck++;
        for (const e of r.events.splice(0)) {
          if (e.t === 'fall' || e.t === 'splash') at[e.k].push(r.time);
          // (the set pieces catch them now and then by design: those are counted apart, below)
          if (e.t === 'haz') caught++;
          if (e.t === 'hit' && e.by === -1) {
            const k = r.karts[e.k];
            const h = r.hazards.find((o) => !o.swing && !o.drive && !timed(o.kind) && o.kind !== 'wet' && Math.hypot(o.x - k.x, o.z - k.z) < o.r + 3);
            if (h) hits[`${h.kind}@${h.s}`] = (hits[`${h.kind}@${h.s}`] ?? 0) + 1;
          }
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
      // (a slick on the esses, between the cyclists, gets clipped a few times a race by the whole field)
      for (const [h, n] of Object.entries(hits)) assert.ok(n <= 4, `${where}: the ${h} was hit ${n} times`);
      const laps = r.karts.flatMap((k) => k.laps.slice(1));
      const med = [...laps].sort((a, b) => a - b)[Math.floor(laps.length / 2)];
      // (a kart the set pieces slow gets caught by the next one too: a lap now and then runs well over the median)
      for (const lap of laps) assert.ok(lap > 0.7 * med && lap < 1.5 * med, `${where}: a lap of ${lap.toFixed(1)} s against ${med.toFixed(1)}`);
      assert.ok(Math.min(...r.karts.map((k) => k.done!)) > meta.leaderboard!.min! / 1000, where);
    }
  }
  assert.ok(falls / races / 8 <= 0.5, `${(falls / races / 8).toFixed(2)} falls per CPU per race`);
  // the set pieces catch each of them a time or two a race: they look human, and they still get round
  assert.ok(caught / races / 8 >= 0.3 && caught / races / 8 <= 3, `${(caught / races / 8).toFixed(2)} set-piece hits per CPU per race`);
});
