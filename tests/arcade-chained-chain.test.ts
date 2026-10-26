import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CHAIN_L, DIR, EDGE_TOL, buildLevel, pose, type Level, type Platform } from '../src/os/arcade/games/chained/level.ts';
import { CHAIN_STEP, SUB, burn, createGame, flagsOf, step, type Game, type Input, type Soul } from '../src/os/arcade/games/chained/logic.ts';

const idle: Input = { side: 0, fwd: 0, jump: false, hold: false };
const spec = (seat: number) => ({ seat, name: `p${seat}`, color: '#fff', kind: 'local' as const });

/** A game past the countdown with n local souls. */
function game(n: number, level: Level): Game {
  return createGame({ mode: 'normal', souls: Array.from({ length: n }, (_, i) => spec(i)), countdown: 0, level });
}

/** Puts a soul on a ledge at arc offset `off` metres from its centre (positive is onwards up the climb) and radius r, standing still. */
function put(g: Game, s: Soul, p: Platform, off: number, r: number) {
  const q = pose(p, g.time);
  const a = q.a + DIR * (off / r);
  s.x = Math.cos(a) * r;
  s.z = Math.sin(a) * r;
  s.y = q.y;
  s.vx = s.vy = s.vz = 0;
  s.grounded = true;
  s.ground = p.id;
  s.coyote = 0;
  s.air = 0;
  s.fallFrom = s.y;
  s.burned = -1;
}

/** Lets go of a soul in the air at the same spot, dy below the ledge top. */
function drop(s: Soul, dy: number) {
  s.y -= dy;
  s.grounded = false;
  s.ground = -1;
}

/** Steps substep by substep with every soul idle, calling watch after each one. */
function run(g: Game, seconds: number, watch?: (t: number) => void) {
  const n = Math.round(seconds / SUB);
  for (let i = 0; i < n; i++) {
    for (const s of g.souls) s.input = idle;
    step(g, SUB);
    watch?.((i + 1) * SUB);
  }
}

/** The most a soul moved in one substep beyond what its own speed accounts for: the chain's share. */
function chainMover(s: Soul) {
  let px = s.x;
  let py = s.y;
  let pz = s.z;
  let most = 0;
  return () => {
    const moved = Math.hypot(s.x - px, s.y - py, s.z - pz) - Math.hypot(s.vx, s.vy, s.vz) * SUB;
    most = Math.max(most, moved);
    px = s.x;
    py = s.y;
    pz = s.z;
    return most;
  };
}

const lv = buildLevel();
// a beacon with nothing in the drop beneath it, so hanging souls hang free
const beacon = lv.checkpoints.find((p) => p.cp === 3)!;

test('a soul that jumps 3 m in one substep (a late packet) does not fling its hanging partner', () => {
  const g = game(2, lv);
  const [a, b] = g.souls;
  put(g, a, beacon, 0, 4.5);
  put(g, b, beacon, 0, beacon.r1 + 0.6);
  drop(b, 5);
  run(g, 1);
  assert.ok(a.grounded && b.hanging, 'b hangs off a');
  const r = Math.hypot(a.x, a.z);
  const ang = Math.atan2(a.z, a.x) + DIR * (3 / r);
  a.x = Math.cos(ang) * r;
  a.z = Math.sin(ang) * r;
  const most = chainMover(b);
  let fastest = 0;
  let step = 0;
  run(g, 1, () => {
    fastest = Math.max(fastest, Math.hypot(b.vx, b.vy, b.vz));
    step = Math.max(step, most());
  });
  assert.ok(fastest < 2, `the slack is taken up by position, not by speed (fastest ${fastest.toFixed(2)} m/s)`);
  assert.ok(step <= CHAIN_STEP + 0.01, `and never more than CHAIN_STEP in one substep (${step.toFixed(3)} m)`);
  assert.ok(a.grounded && a.ground === beacon.id, 'a stayed on its ledge');
  assert.ok(b.hanging && !b.grounded, 'b still hangs');
  const d = Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
  assert.ok(d <= CHAIN_L + 0.05, `the chain is ${d.toFixed(2)} long`);
});

test('the rope bending over a rim as a partner lands hauls the hanger up by position, not with a kick', () => {
  const g = game(2, lv);
  const [a, b] = g.souls;
  // a is about to land near the core, b hangs under the slab further out: straight the chain is slack, over the rim it is not
  put(g, a, beacon, -2.3, 3.6);
  a.y += 0.05;
  a.vy = -1;
  a.grounded = false;
  a.ground = -1;
  put(g, b, beacon, 1.5, 5.5);
  drop(b, 4);
  const top = pose(beacon, g.time).y;
  const y0 = b.y;
  assert.ok(Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) < CHAIN_L, 'slack in a straight line');
  let fastestUp = -Infinity;
  let highest = -Infinity;
  run(g, 1, () => {
    fastestUp = Math.max(fastestUp, b.vy);
    highest = Math.max(highest, b.y);
  });
  assert.ok(a.grounded && a.ground === beacon.id, 'a landed on the beacon');
  assert.ok(fastestUp < 1, `b was never kicked upward (${fastestUp.toFixed(2)} m/s)`);
  assert.ok(highest < top, `b never flew over the ledge (highest ${highest.toFixed(2)} against the top at ${top.toFixed(2)})`);
  assert.ok(b.y > y0 + 1.5 && b.hanging, `b was hauled up toward the rim (rose ${(b.y - y0).toFixed(2)} m)`);
});

test('two souls hanging still off one standing soul slide it off the rim, and it does not climb straight back', () => {
  const g = game(3, lv);
  const [a, b, c] = g.souls;
  put(g, a, beacon, 0, beacon.r1 - 1);
  // the chain just taut at rest: no fall, no bounce, nothing to throw the stander
  put(g, b, beacon, 0, beacon.r1 + 0.3);
  drop(b, Math.sqrt(CHAIN_L ** 2 - 1.3 ** 2) - 0.05);
  put(g, c, beacon, 0, beacon.r1 + 0.3);
  c.y = b.y - CHAIN_L + 0.05;
  c.grounded = false;
  c.ground = -1;
  let off = -1;
  let fastest = 0;
  let mantled = false;
  run(g, 2, (t) => {
    if (t < 0.3) fastest = Math.max(fastest, Math.abs(b.vy), Math.abs(c.vy));
    if (off < 0 && !a.grounded) off = t;
    if (off >= 0 && t < off + 0.4 && a.grounded) mantled = true;
  });
  assert.ok(fastest < 3, `the hangers were not thrown about (${fastest.toFixed(2)} m/s)`);
  assert.ok(off > 0 && off < 1.5, `the stander slid off within a second or so (${off.toFixed(2)} s)`);
  assert.ok(!mantled, 'and did not pull itself back onto the rim with its partners below it');
  assert.ok(!g.events.some((e) => e.t === 'mantle' && e.i === a.idx), 'no mantle for the stander');
  assert.ok(Math.hypot(a.x, a.z) > beacon.r1 + EDGE_TOL, 'it is beyond the rim');
});

test('a burned soul lets go of the chain: no longer hanging, taut or mid mantle', () => {
  const g = game(2, lv);
  const [a, b] = g.souls;
  put(g, a, beacon, 0, 4.5);
  put(g, b, beacon, 0, beacon.r1 + 0.6);
  drop(b, 3);
  run(g, 1);
  assert.ok(b.hanging && b.taut, 'b hangs taut');
  burn(g, b);
  step(g, SUB);
  assert.ok(!b.hanging && !b.taut && b.glide === null, 'the burn cleared the chain state');
  assert.equal(flagsOf(b), 4, 'burned only, for the wire');
  assert.ok(!a.taut && !a.hanging, 'and a is free');

  const g2 = game(2, lv);
  const c = g2.souls[0];
  c.glide = { x0: c.x, y0: c.y, z0: c.z, x1: c.x, y1: c.y + 1, z1: c.z, t: 0, dur: 0.16, p: beacon.id, grab: false };
  c.grounded = false;
  c.ground = -1;
  burn(g2, c);
  assert.equal(c.glide, null, 'a mantle in progress is dropped too');
});
