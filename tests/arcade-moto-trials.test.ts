import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS, LEVEL_IDS, getLevel, propsFor, worldOf } from '../src/os/arcade/games/moto-trials/levels.ts';
import { BRUSH, FLIP_MIN, SETTLE_BOTH, autoInput, currentMs, flipsIn, newRun, nextStarMs, startRun, stepRun, trackAir } from '../src/os/arcade/games/moto-trials/logic.ts';
import { buildWorld, newBike, segActive, step, type Seg } from '../src/os/arcade/games/moto-trials/physics.ts';
import { parseProgress, tourLeft, tourTotal, unlocked } from '../src/os/arcade/games/moto-trials/progress.ts';
import { meta } from '../src/os/arcade/games/moto-trials/meta.ts';

const DT = 1 / 60;
const flat: Seg[] = [{ ax: -50, ay: 0, bx: 200, by: 0, nx: 0, ny: 1, len: 250 }];

function flatWorld(extra: Partial<Parameters<typeof buildWorld>[0]> extends never ? object : object = {}) {
  void extra;
  return buildWorld(flat, [], [], -14);
}

/** Run the physics only (no countdown) for `secs` of sim time. */
function ride(world: ReturnType<typeof buildWorld>, bike: ReturnType<typeof newBike>, input: { gas: number; brake: number; lean: number }, secs: number) {
  const hits = { head: false, saw: false, fell: false };
  for (let i = 0; i < Math.round(secs / DT); i++) {
    const h = step(bike, world, input, DT);
    hits.head ||= h.head;
    hits.saw ||= h.saw;
    hits.fell ||= h.fell;
  }
  return hits;
}

/** Drive a run through countdown then autopilot to the finish. */
function autopilotRun(levelId: string, maxSecs = 140) {
  const run = newRun(getLevel(levelId));
  while (run.phase !== 'done' && run.t < maxSecs) stepRun(run, autoInput(run), DT);
  return run;
}

test('level data is sane and matches the meta variants', () => {
  assert.ok(LEVELS.length >= 8);
  const ids = new Set(LEVEL_IDS);
  for (const lv of LEVELS) {
    assert.ok(ids.has(lv.id));
    for (const s of lv.segs) {
      for (const v of [s.ax, s.ay, s.bx, s.by, s.nx, s.ny]) assert.ok(Number.isFinite(v), `${lv.id} has a bad coord`);
    }
    let last = lv.start.x;
    for (const cp of lv.checkpoints) {
      assert.ok(cp > last && cp < lv.finishX, `${lv.id} checkpoint out of order`);
      last = cp;
    }
    assert.ok(lv.stars[0] < lv.stars[1] && lv.stars[1] < lv.stars[2], `${lv.id} stars must increase`);
    for (const s of lv.segs) assert.ok(s.ay > lv.killY && s.by > lv.killY, `${lv.id} terrain under killY`);
    assert.ok(lv.checkpoints.length >= 1 && lv.checkpoints.length <= 4);
  }
});

test('a dropped bike settles upright and stays put', () => {
  const w = flatWorld();
  const b = newBike(0, 1.4);
  const hits = ride(w, b, { gas: 0, brake: 0, lean: 0 }, 5);
  assert.ok(!hits.head && !hits.saw && !hits.fell);
  assert.ok(Math.abs(b.a) < 0.2, `settled at ${b.a} rad`);
  assert.ok(Math.abs(b.v.x) < 0.2 && Math.abs(b.v.y) < 0.2);
});

test('gas on flat accelerates to top speed without flipping', () => {
  const w = flatWorld();
  const b = newBike(0, 1.4);
  const hits = ride(w, b, { gas: 1, brake: 0, lean: 0 }, 5);
  assert.ok(!hits.head && !hits.fell);
  assert.ok(b.v.x > 8, `only reached ${b.v.x} m/s`);
  assert.ok(Math.abs(b.a) < 0.7, `tipped to ${b.a} rad`);
});

test('upside down, hazards and the void all crash', () => {
  // inverted drop: the head reaches the ground first
  const w = flatWorld();
  const b = newBike(0, 1.3);
  b.a = Math.PI;
  const hits = ride(w, b, { gas: 0, brake: 0, lean: 0 }, 1.5);
  assert.ok(hits.head, 'landing on the helmet should crash');

  // saw contact crashes
  const w2 = buildWorld(flat, [{ x: 0, y: 0.9, r: 0.9 }], [], -14);
  const b2 = newBike(0, 1.4);
  const hits2 = ride(w2, b2, { gas: 0, brake: 0, lean: 0 }, 0.5);
  assert.ok(hits2.saw);

  // falling below killY crashes
  const w3 = buildWorld([{ ax: -50, ay: 0, bx: -10, by: 0, nx: 0, ny: 1, len: 40 }], [], [], -6);
  const b3 = newBike(-30, 1.4);
  const hits3 = ride(w3, b3, { gas: 1, brake: 0, lean: 0 }, 4);
  assert.ok(hits3.fell);
});

// A launch pad: flat run-up, a 24 degree ramp lip, then ground 8 m lower, so a fast bike
// gets about a second and a half of clean air.
function launchWorld() {
  const mk = (ax: number, ay: number, bx: number, by: number): Seg => {
    const len = Math.hypot(bx - ax, by - ay);
    return { ax, ay, bx, by, nx: -(by - ay) / len, ny: (bx - ax) / len, len };
  };
  const segs = [mk(-60, 0, 30, 0), mk(30, 0, 35.5, 2.2), mk(45, -8, 320, -8)];
  return buildWorld(segs, [], [], -30);
}

test('holding a lean in the air rotates the bike', () => {
  const w = launchWorld();
  const b = newBike(0, 1.4);
  let airRot = 0;
  let lastA = 0;
  let inAir = false;
  for (let i = 0; i < 60 * 6; i++) {
    const air = !b.fw.on && !b.rw.on;
    const input = air ? { gas: 0, brake: 0, lean: -1 } : { gas: 1, brake: 0, lean: 0 };
    const a0 = b.a;
    step(b, w, input, DT);
    if (air) {
      if (!inAir) {
        inAir = true;
        lastA = a0;
      }
      airRot += Math.abs(Math.atan2(Math.sin(b.a - lastA), Math.cos(b.a - lastA)));
      lastA = b.a;
    }
  }
  assert.ok(airRot > Math.PI * 2 * 0.8, `only rotated ${airRot} rad in the air`);
});

test('a landed backflip earns a 1000 ms bonus', () => {
  const mk = (ax: number, ay: number, bx: number, by: number): Seg => {
    const len = Math.hypot(bx - ax, by - ay);
    return { ax, ay, bx, by, nx: -(by - ay) / len, ny: (bx - ax) / len, len };
  };
  const level = {
    id: 't',
    name: 'Test',
    theme: {} as never,
    segs: [mk(-60, 0, 30, 0), mk(30, 0, 35.5, 2.2), mk(45, -8, 320, -8)],
    saws: [],
    loops: [],
    killY: -30,
    start: { x: 4, y: 1.5 },
    checkpoints: [],
    finishX: 300,
    stars: [1, 2, 3] as [number, number, number],
    props: [],
  };
  const run = newRun(level);
  while (run.phase === 'count') stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
  // lean back hard through the jump, then level out to land
  for (let i = 0; i < 60 * 30 && run.phase === 'run' && run.bonusMs === 0; i++) {
    const b = run.bike;
    const air = !b.fw.on && !b.rw.on;
    const input = air ? { gas: 0, brake: 0, lean: run.air.accum > -5.6 ? -1 : 1 } : { gas: 1, brake: 0, lean: 0 };
    stepRun(run, input, DT);
  }
  assert.ok(run.bonusMs >= 1000, `no flip bonus, phase ${run.phase}, accum ${run.air.accum.toFixed(1)}`);
  assert.ok(run.phase !== 'crash', 'crashed instead of landing');
});

test('a timed lean-back on the big level-2 jump lands a flip', () => {
  // a human play pattern: autopilot to the long jump, then hold lean back
  // from takeoff until the rotation is nearly done, release, and ride on
  const run = newRun(getLevel('level-2'));
  while (run.phase === 'count') stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
  for (let i = 0; i < 60 * 90 && run.phase === 'run' && run.flips === 0; i++) {
    const b = run.bike;
    const air = !b.fw.on && !b.rw.on;
    let input = autoInput(run);
    // only commit to a flip on the big jump; small hops stay autopiloted
    if (air && b.p.x > 145 && Math.abs(run.air.accum) < (330 * Math.PI) / 180) input = { gas: 1, brake: 0, lean: -1 };
    stepRun(run, input, DT);
  }
  assert.ok(run.flips >= 1, `never landed a flip (crashes ${run.crashes})`);
  assert.equal(run.crashes, 0, 'crashed on the way to the flip');
  assert.ok(run.bonusMs >= 1000);
});

test('checkpoints save progress and crashes respawn there', () => {
  const lv = getLevel('level-1');
  const run = newRun(lv);
  while (run.phase === 'count') stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
  // ride until the first checkpoint is taken
  for (let i = 0; i < 60 * 30 && run.cp < 1; i++) stepRun(run, autoInput(run), DT);
  assert.ok(run.cp >= 1, 'never reached a checkpoint');
  const sx = run.spawn.x;
  // force a crash: drop the bike upside down right where it is
  run.bike.a = Math.PI;
  run.bike.v.x = 0;
  for (let i = 0; i < 60 * 5 && run.phase === 'run'; i++) stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
  assert.equal(run.phase, 'crash');
  for (let i = 0; i < 60 * 2 && run.phase === 'crash'; i++) stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
  assert.equal(run.phase, 'run');
  assert.ok(Math.abs(run.bike.p.x - sx) < 2, `respawned at ${run.bike.p.x}, expected ${sx}`);
});

test('a loop completes: in gate, over the top, out the bottom, gate resets', () => {
  const lv = getLevel('level-3');
  const run = newRun(lv);
  while (run.phase === 'count') stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
  const loop = run.world.loops[0];
  assert.ok(loop, 'level-3 has a loop');
  const loopX = loop.cx;
  let wentOver = false;
  for (let i = 0; i < 60 * 40 && run.phase === 'run'; i++) {
    stepRun(run, { gas: 1, brake: 0, lean: 0 }, DT);
    const b = run.bike;
    if (b.p.y > loop.cy && Math.abs(b.p.x - loopX) < loop.r) wentOver = true;
    if (b.p.x > loop.right + 2) break;
  }
  assert.ok(wentOver, 'bike never got above the loop centre');
  assert.ok(run.bike.p.x > loop.right + 2, 'bike never exited the loop');
  assert.equal(loop.phase, 'approach');
  assert.equal(run.phase, 'run');
});

test('the autopilot finishes every level', () => {
  const rows: string[] = [];
  let allOk = true;
  for (const lv of LEVELS) {
    const run = autopilotRun(lv.id);
    const ok = run.phase === 'done';
    if (!ok) allOk = false;
    const ms = run.finalMs || Math.round(run.elapsed * 1000);
    rows.push(`${lv.id} ${lv.name}: ${(ms / 1000).toFixed(2)}s, ${run.crashes} crash(es), ${run.flips} flip(s)${ok ? '' : ' DNF'}`);
    if (ok) {
      assert.ok(run.crashes <= 2, `${lv.id}: ${run.crashes} crashes`);
      // gold should be reachable but earned: autopilot is an average rider
      assert.ok(lv.stars[0] <= ms, `${lv.id}: gold ${lv.stars[0]} beyond autopilot ${ms}`);
      assert.ok(lv.stars[0] >= ms * 0.5, `${lv.id}: gold ${lv.stars[0]} trivial vs autopilot ${ms}`);
    }
  }
  console.log('\n' + rows.join('\n'));
  assert.ok(allOk, 'autopilot did not finish every level');
});

test('gate filtering hides the far half of a loop', () => {
  const lv = getLevel('level-3');
  const w = worldOf(lv);
  const inSeg = lv.segs.find((s) => s.gate?.half === 'in')!;
  const outSeg = lv.segs.find((s) => s.gate?.half === 'out')!;
  w.loops[0].phase = 'approach';
  assert.ok(segActive(w, inSeg));
  assert.ok(!segActive(w, outSeg));
  w.loops[0].phase = 'over';
  assert.ok(segActive(w, inSeg) && segActive(w, outSeg));
  w.loops[0].phase = 'leaving';
  assert.ok(!segActive(w, inSeg) && segActive(w, outSeg));
});

test('progress parses safely and unlocks in order', () => {
  assert.deepEqual(parseProgress(null), { best: {}, stars: {} });
  assert.deepEqual(parseProgress('not json{'), { best: {}, stars: {} });
  assert.deepEqual(parseProgress('42'), { best: {}, stars: {} });
  // junk values and unknown ids are dropped
  const p = parseProgress(
    JSON.stringify({
      best: { 'level-1': 21000, 'level-9': 'fast', nope: 1, 'level-2': NaN, 'level-3': -4 },
      stars: { 'level-1': 2.7, 'level-2': 9 },
    }),
  );
  assert.equal(p.best['level-1'], 21000);
  assert.ok(!('level-2' in p.best) && !('level-3' in p.best) && !('nope' in p.best));
  assert.equal(p.stars['level-1'], 2);
  assert.ok(!('level-2' in p.stars));

  // unlock chain: level-1 open, level-N needs a best on N-1
  const none = parseProgress(null);
  assert.ok(unlocked(none, 'level-1'));
  assert.ok(!unlocked(none, 'level-2'));
  assert.ok(!unlocked(none, 'level-10'));
  const one = parseProgress(JSON.stringify({ best: { 'level-1': 25000 }, stars: {} }));
  assert.ok(unlocked(one, 'level-2'));
  assert.ok(!unlocked(one, 'level-3'));

  // tour total needs every level
  assert.equal(tourTotal(one), null);
  assert.equal(tourLeft(one), 9);
  const full = parseProgress(JSON.stringify({ best: Object.fromEntries(LEVEL_IDS.map((id) => [id, 20000])), stars: {} }));
  assert.equal(tourTotal(full), 200000);
  assert.equal(tourLeft(full), 0);
  assert.ok(unlocked(full, 'level-10'));
});

test('nextStarMs chases silver then gold then nothing', () => {
  const lv = getLevel('level-1');
  assert.equal(nextStarMs(lv, 0), lv.stars[2], 'no stars -> chase bronze');
  assert.equal(nextStarMs(lv, 1), lv.stars[1], '1 star -> chase silver');
  assert.equal(nextStarMs(lv, 2), lv.stars[0], '2 stars -> chase gold');
  assert.equal(nextStarMs(lv, 3), null);
});

test('the tour leaderboard floor is unreachable by a single race', () => {
  const goldSum = LEVELS.reduce((a, l) => a + l.stars[0], 0);
  const maxBronze = Math.max(...LEVELS.map((l) => l.stars[2]));
  const min = meta.leaderboard!.min;
  assert.ok(min < goldSum * 0.85, `min ${min} vs 0.85x gold sum ${goldSum * 0.85}`);
  assert.ok(min > maxBronze * 2, `min ${min} not above 2x max bronze ${maxBronze * 2}`);
});

const D2R = Math.PI / 180;

/** A flat test level, its run already past the countdown. */
function flatRun() {
  const level = {
    id: 't',
    name: 'Test',
    theme: {} as never,
    segs: flat,
    saws: [],
    loops: [],
    killY: -14,
    start: { x: 0, y: 1.4 },
    checkpoints: [],
    finishX: 190,
    stars: [1, 2, 3] as [number, number, number],
    props: [],
  };
  const run = newRun(level);
  while (run.phase === 'count') stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
  return run;
}

test('flip counting: whole flips from FLIP_MIN, in 360 degree steps', () => {
  assert.equal(flipsIn(290 * D2R), 0);
  assert.equal(flipsIn(FLIP_MIN), 1);
  assert.equal(flipsIn(-310 * D2R), 1);
  assert.equal(flipsIn(650 * D2R), 1);
  assert.equal(flipsIn(670 * D2R), 2);
});

test('a front wheel brush mid-air does not restart the flip count', () => {
  const run = flatRun();
  const b = run.bike;
  const set = (fw: boolean, rw: boolean) => {
    b.fw.on = fw;
    b.rw.on = rw;
  };
  // 0.5 s of air turning 200 degrees, a 0.05 s front wheel brush, 0.4 s more air for 130 degrees, then both down
  for (let i = 0; i < 30; i++) (set(false, false), trackAir(run, (200 / 30) * D2R, DT));
  for (let i = 0; i < 3; i++) (set(true, false), trackAir(run, 0, DT));
  assert.ok(3 * DT < BRUSH);
  for (let i = 0; i < 24; i++) (set(false, false), trackAir(run, (130 / 24) * D2R, DT));
  for (let i = 0; i < Math.ceil(SETTLE_BOTH / DT) + 2; i++) (set(true, true), trackAir(run, 0, DT));
  assert.equal(run.flips, 1, `accum ${(run.air.accum / D2R).toFixed(0)}`);
  assert.equal(run.bonusMs, 1000);
  assert.ok(run.toasts.some((t) => t.text.startsWith('Frontflip') || t.text.startsWith('Backflip')));
});

test('a 315 degree backflip that lands on the front wheel and pivots onto the rear counts', () => {
  const run = flatRun();
  const b = run.bike;
  // seeded jump: 0.9 s of air already rotated 315 degrees nose up, so the nose is still 45 degrees down,
  // the front wheel just above the ground, falling, no spin left
  const a = (315 - 360) * D2R;
  const c = Math.cos(a);
  const s = Math.sin(a);
  const place = (lx: number, ly: number) => ({ x: b.p.x + lx * c - ly * s, y: b.p.y + lx * s + ly * c });
  b.p.y = 1.15;
  b.a = a;
  b.w = 0;
  b.v = { x: 4, y: -2 };
  b.fw.p = place(0.625, -0.42);
  b.rw.p = place(-0.625, -0.42);
  for (const wh of [b.fw, b.rw]) {
    wh.v = { ...b.v };
    wh.on = false;
  }
  const lift = Math.min(b.fw.p.y, b.rw.p.y) - 0.34 - 0.02;
  for (const p of [b.p, b.fw.p, b.rw.p]) p.y -= lift;
  run.air = { on: true, time: 0.9, accum: 315 * D2R, touch: 0, both: 0 };
  let firstTouch: number | null = null;
  let firstWheel = '';
  for (let i = 0; i < 120 && run.phase === 'run' && run.air.on; i++) {
    stepRun(run, { gas: 0, brake: 0, lean: 0 }, DT);
    if (firstTouch === null && (b.fw.on || b.rw.on)) {
      firstTouch = run.air.accum;
      firstWheel = b.fw.on ? 'front' : 'rear';
    }
  }
  assert.equal(firstWheel, 'front');
  // the old rule scored at first touch and needed 330 degrees: this jump got nothing
  assert.ok(firstTouch !== null && firstTouch < 330 * D2R, `first touch at ${(firstTouch! / D2R).toFixed(0)}`);
  assert.equal(run.phase, 'run', 'crashed on the pivot');
  assert.equal(run.flips, 1);
  assert.ok(run.toasts.some((t) => t.text.startsWith('Backflip')), run.toasts.map((t) => t.text).join());
});

/** Hold gas only, no lean, no brake, for up to `secs` of race time. */
function gasOnly(levelId: string, secs = 60) {
  const run = newRun(getLevel(levelId));
  while (run.phase !== 'done' && run.t < secs) stepRun(run, { gas: 1, brake: 0, lean: 0 }, DT);
  return run;
}

test('gas only clears the two tutorial levels and crashes or stalls on every level after', () => {
  const rows: string[] = [];
  LEVELS.forEach((lv, i) => {
    const run = gasOnly(lv.id);
    const clean = run.phase === 'done' && run.crashes === 0;
    rows.push(`${lv.id}: ${run.phase}, ${run.crashes} crash(es)`);
    if (i < 2) assert.ok(clean, `${lv.id} should be a gas-only tutorial`);
    else assert.ok(!clean, `${lv.id} finished clean on gas alone`);
  });
  console.log('\n' + rows.join('\n'));
});

test('every level has big kickers, and from level 4 a double flip jump', () => {
  for (const lv of LEVELS) {
    const run = newRun(getLevel(lv.id));
    const airs: number[] = [];
    let air = 0;
    while (run.phase !== 'done' && run.t < 140) {
      stepRun(run, autoInput(run), DT);
      if (run.phase === 'run' && !run.bike.fw.on && !run.bike.rw.on) air += DT;
      else {
        if (air > 0.5) airs.push(air);
        air = 0;
      }
    }
    const i = LEVEL_IDS.indexOf(lv.id);
    assert.ok(airs.filter((a) => a >= 1.2).length >= 2, `${lv.id} airtimes ${airs.map((a) => a.toFixed(2))}`);
    if (i >= 3) assert.ok(airs.some((a) => a >= 1.8), `${lv.id} has no 1.8 s jump: ${airs.map((a) => a.toFixed(2))}`);
  }
});

test('gold needs flips: a clean no-flip ride misses it, a stunt rider mostly makes it', () => {
  let golds = 0;
  for (const lv of LEVELS) {
    const run = newRun(getLevel(lv.id));
    while (run.phase !== 'done' && run.t < 140) stepRun(run, autoInput(run, { flips: true }), DT);
    if (run.phase === 'done' && run.finalMs <= lv.stars[0]) golds++;
  }
  // the clean no-flip side is asserted in 'the autopilot finishes every level' (gold <= its time)
  assert.ok(golds >= 7, `stunt autopilot made gold on only ${golds} levels`);
});

test('props sit at fixed level positions on plain ground', () => {
  for (const lv of LEVELS) {
    assert.deepEqual(propsFor(lv.id, lv.segs, lv.finishX), lv.props, `${lv.id} props are not deterministic`);
    assert.ok(lv.props.length >= 5, `${lv.id} has only ${lv.props.length} props`);
    for (let i = 1; i < lv.props.length; i++) assert.ok(lv.props[i].x > lv.props[i - 1].x);
    for (const p of lv.props) {
      const under = lv.segs.filter((s) => s.kind !== 'loop' && p.x >= Math.min(s.ax, s.bx) && p.x <= Math.max(s.ax, s.bx));
      assert.ok(under.length > 0, `${lv.id} prop at ${p.x} floats over a gap`);
      assert.ok(!under.some((s) => s.kind === 'wood'), `${lv.id} prop at ${p.x} stands on a ramp`);
    }
  }
});

test('a held lean-back on the first level-1 kicker lands and earns a backflip', () => {
  // a player taps or holds Left for part of the air: the landing must soak up leftover spin and settle
  for (const hold of [0.4, 0.6, 1.2]) {
    const run = newRun(getLevel('level-1'));
    let airT = 0;
    while (run.t < 40 && run.phase !== 'done' && run.bike.p.x < 100) {
      const b = run.bike;
      const air = !b.fw.on && !b.rw.on;
      if (air && b.p.x > 40) airT += DT;
      stepRun(run, { gas: 1, brake: 0, lean: air && b.p.x > 40 && airT < hold ? -1 : 0 }, DT);
    }
    assert.equal(run.crashes, 0, `hold ${hold}: crashed`);
    assert.ok(run.flips >= 1, `hold ${hold}: no flip credited (${run.toasts.map((t) => t.text).join()})`);
    assert.ok(run.toasts.some((t) => t.text.includes('Backflip')), `hold ${hold}: ${run.toasts.map((t) => t.text).join()}`);
  }
});
