import assert from 'node:assert/strict';
import { test } from 'node:test';
import { LEVELS, LEVEL_IDS, getLevel, worldOf } from '../src/os/arcade/games/moto-trials/levels.ts';
import { autoInput, currentMs, newRun, startRun, stepRun } from '../src/os/arcade/games/moto-trials/logic.ts';
import { buildWorld, newBike, segActive, step, type Seg } from '../src/os/arcade/games/moto-trials/physics.ts';

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
