// Run state machine for Moto Trials: countdown, timer, flips, checkpoints, crashes, finish.
// Pure: tests drive it under node. Drawing reads the same state.
import { groundAt, newBike, step, wrapAngle, type Bike, type Input, type PhysWorld } from './physics.ts';
import { worldOf, type Level } from './levels.ts';

export const COUNTDOWN = 3;
export const RESPAWN_DELAY = 0.9;
export const FINISH_PAUSE = 1.2;
export const FLIP_BONUS_MS = 1000;

/** Flip tracking from takeoff until the bike has settled on its wheels. */
export type Air = {
  /** A jump is being tracked (both wheels left the ground and it has not settled yet). */
  on: boolean;
  /** Seconds with both wheels off the ground during this jump. */
  time: number;
  /** Net chassis rotation since takeoff in radians, positive is nose up (a backflip). */
  accum: number;
  /** Seconds the current wheel contact has lasted, any wheel. */
  touch: number;
  /** Seconds both wheels have been down together. */
  both: number;
};

/** A jump ends once both wheels have been down this long, so the pivot onto the second wheel counts. */
export const SETTLE_BOTH = 0.1;
/** Or once one wheel has rolled this long (a wheelie or stoppie away from the landing). */
export const SETTLE_ONE = 0.3;
/** Shorter wheel touches are brushes: the jump keeps going. */
export const BRUSH = 0.08;
/** Net rotation that earns a flip, so a slightly short but landed flip still counts. */
export const FLIP_MIN = (300 * Math.PI) / 180;

const noAir = (): Air => ({ on: false, time: 0, accum: 0, touch: 0, both: 0 });

/** Whole flips in a net rotation: one at FLIP_MIN, two at FLIP_MIN + 360 degrees and so on. */
export function flipsIn(accum: number): number {
  const a = Math.abs(accum);
  return a < FLIP_MIN ? 0 : 1 + Math.floor((a - FLIP_MIN) / (Math.PI * 2));
}

export type Toast = { id: number; text: string; t: number };
export type Particle = { x: number; y: number; vx: number; vy: number; t: number; life: number; kind: 'dust' | 'puff' | 'debris' | 'confetti'; c?: string };

export type Run = {
  level: Level;
  world: PhysWorld;
  bike: Bike;
  /** 'wait': online guest holding for the host. 'count': 3-2-1. 'run': clock is live.
   *  'crash': rider down, respawn in RESPAWN_DELAY. 'done': crossed the line, card soon. */
  phase: 'wait' | 'count' | 'run' | 'crash' | 'done';
  /** Seconds since the run mounted (drives countdown and crash timing). */
  t: number;
  countT: number;
  goT: number;
  /** Seconds since Go, frozen once done. */
  elapsed: number;
  bonusMs: number;
  flips: number;
  crashes: number;
  /** Index into level.checkpoints of the NEXT checkpoint; passed ones are below it. */
  cp: number;
  spawn: { x: number; y: number; a: number };
  crashT: number;
  crashKind: 'head' | 'saw' | 'fell' | null;
  finishT: number;
  finalMs: number;
  /** Jump bookkeeping for flip detection: see trackAir. */
  air: Air;
  /** Recent events for the HUD, newest last. */
  toasts: Toast[];
  fx: Particle[];
  /** Shake amount 0..1 for the camera. */
  shake: number;
  /** Set when crossing the finish; the UI calls gameOver after FINISH_PAUSE. */
  overPending: boolean;
  nextToastId: number;
};

export function newRun(level: Level, wait = false): Run {
  const world = worldOf(level);
  const spawn = { x: level.start.x, y: level.start.y, a: 0 };
  return {
    level,
    world,
    bike: newBike(spawn.x, spawn.y),
    phase: wait ? 'wait' : 'count',
    t: 0,
    countT: COUNTDOWN,
    goT: 0,
    elapsed: 0,
    bonusMs: 0,
    flips: 0,
    crashes: 0,
    cp: 0,
    spawn,
    crashT: 0,
    crashKind: null,
    finishT: 0,
    finalMs: 0,
    air: noAir(),
    toasts: [],
    fx: [],
    shake: 0,
    overPending: false,
    nextToastId: 1,
  };
}

export function toast(run: Run, text: string) {
  run.toasts.push({ id: run.nextToastId++, text, t: run.t });
  if (run.toasts.length > 4) run.toasts.shift();
}

// accum > 0 is nose up (counterclockwise with the bike facing right): a backflip
const namesB = ['', 'Backflip', 'Double Backflip', 'Triple Backflip'];
const namesF = ['', 'Frontflip', 'Double Frontflip', 'Triple Frontflip'];

function spawnAt(world: PhysWorld, x: number) {
  const g = groundAt(world, x);
  return { x, y: (g ?? 0) + 1.15, a: 0 };
}

export function startRun(run: Run) {
  if (run.phase === 'wait') {
    run.phase = 'count';
    run.countT = COUNTDOWN;
  }
}

function crash(run: Run, kind: 'head' | 'saw' | 'fell') {
  if (run.phase !== 'run') return;
  run.phase = 'crash';
  run.crashes++;
  run.crashT = 0;
  run.crashKind = kind;
  run.shake = 1;
  run.air = noAir();
  const b = run.bike;
  // fling a few debris bits and the rider's helmet from where it happened
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    run.fx.push({
      x: b.p.x,
      y: b.p.y + 0.3,
      vx: Math.cos(a) * (2 + (i % 3)),
      vy: Math.sin(a) * (2 + (i % 4)) + 3,
      t: run.t,
      life: 0.9,
      kind: 'debris',
    });
  }
  toast(run, 'Crash');
}

/**
 * Flip detection. Rotation counts from the moment both wheels leave the ground until the bike has settled:
 * both wheels down for SETTLE_BOTH, or one wheel rolling for SETTLE_ONE. Touches shorter than BRUSH (a wheel
 * clipping a lip or a crest) never end the jump, and the pivot from the first wheel onto the second still
 * counts. A crash on the way down resets this in crash(), so only a ride away is credited.
 */
export function trackAir(run: Run, da: number, dt: number) {
  const b = run.bike;
  const air = run.air;
  const fw = b.fw.on;
  const rw = b.rw.on;
  if (!fw && !rw) {
    if (!air.on) {
      air.on = true;
      air.time = 0;
      air.accum = 0;
    }
    air.time += dt;
    air.accum += da;
    air.touch = 0;
    air.both = 0;
    return;
  }
  if (!air.on) return;
  air.accum += da;
  air.touch += dt;
  air.both = fw && rw ? air.both + dt : 0;
  if (air.touch < BRUSH) return;
  if (air.both < SETTLE_BOTH && air.touch < SETTLE_ONE) return;
  // settled on the wheels; score flips for real airtime only
  if (air.time > 0.12) {
    const flips = flipsIn(air.accum);
    if (flips > 0) {
      const list = air.accum > 0 ? namesB : namesF;
      toast(run, `${list[Math.min(3, flips)]} -${flips}s`);
      run.bonusMs += flips * FLIP_BONUS_MS;
      run.flips += flips;
    }
    for (let i = 0; i < 6; i++)
      run.fx.push({ x: b.p.x + (i - 3) * 0.3, y: b.p.y - 0.6, vx: (i - 3) * 0.8, vy: 1 + (i % 2), t: run.t, life: 0.45, kind: 'puff' });
  }
  run.air = noAir();
}

export function currentMs(run: Run): number {
  return Math.max(0, Math.round(run.elapsed * 1000) - run.bonusMs);
}

/** Advance the whole run by dt (clamped by the caller). */
export function stepRun(run: Run, input: Input, dt: number) {
  run.t += dt;
  const b = run.bike;

  if (run.phase === 'wait') return;
  if (run.phase === 'count') {
    run.countT -= dt;
    // settle the bike during the countdown so the start is clean
    step(b, run.world, { gas: 0, brake: 0, lean: 0 }, dt);
    if (run.countT <= 0) {
      run.phase = 'run';
      run.goT = run.t;
      toast(run, 'Go');
    }
    return;
  }
  if (run.phase === 'done') {
    run.finishT += dt;
    run.fx = run.fx.filter((p) => run.t - p.t < p.life);
    if (run.finishT >= FINISH_PAUSE && !run.overPending) run.overPending = true;
    return;
  }

  if (run.phase === 'crash') {
    run.crashT += dt;
    run.elapsed = run.t - run.goT;
    run.shake = Math.max(0, run.shake - dt * 1.4);
    // tumble the bike away so the crash reads
    step(b, run.world, { gas: 0, brake: 0, lean: 0 }, dt);
    run.fx = run.fx.filter((p) => run.t - p.t < p.life);
    for (const p of run.fx) {
      p.vy -= 14 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    if (run.crashT >= RESPAWN_DELAY) {
      const s = spawnAt(run.world, run.spawn.x);
      run.bike = newBike(s.x, s.y);
      run.bike.a = run.spawn.a;
      run.phase = 'run';
      toast(run, 'Back on');
    }
    return;
  }

  // running
  run.elapsed = run.t - run.goT;
  const a0 = b.a;
  const hits = step(b, run.world, input, dt);
  if (!hits.head && !hits.saw && !hits.fell) trackAir(run, wrapAngle(b.a - a0), dt);

  if (hits.head || hits.saw || hits.fell) {
    crash(run, hits.saw ? 'saw' : hits.fell ? 'fell' : 'head');
    return;
  }

  // checkpoints
  while (run.cp < run.level.checkpoints.length && b.p.x > run.level.checkpoints[run.cp]) {
    run.spawn.x = run.level.checkpoints[run.cp];
    run.cp++;
    toast(run, 'Checkpoint');
  }

  // dust off the rear wheel under power
  if (input.gas > 0 && b.rw.on && Math.random() < dt * 22) {
    run.fx.push({ x: b.rw.p.x - 0.2, y: b.rw.p.y - 0.2, vx: -b.v.x * 0.15 - 1.5, vy: 1 + Math.random() * 1.5, t: run.t, life: 0.5, kind: 'dust' });
  }
  run.fx = run.fx.filter((p) => run.t - p.t < p.life);
  for (const p of run.fx) {
    p.vy -= 14 * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
  }
  run.shake = Math.max(0, run.shake - dt * 1.4);

  // finish line
  if (b.p.x >= run.level.finishX) {
    run.phase = 'done';
    run.finishT = 0;
    run.finalMs = Math.max(1000, Math.round(run.elapsed * 1000) - run.bonusMs);
    for (let i = 0; i < 24; i++) {
      run.fx.push({
        x: run.level.finishX + (Math.random() - 0.5) * 3,
        y: b.p.y + 1 + Math.random() * 2,
        vx: (Math.random() - 0.5) * 6,
        vy: 2 + Math.random() * 5,
        t: run.t,
        life: 1.2,
        kind: 'confetti',
        c: ['#ff6a2b', '#ffd23f', '#7ddf8a', '#5ab0ff'][i % 4],
      });
    }
  }
}

/** Stars earned for a final time: 3 gold, 2 silver, 1 bronze, 0 below. */
export function starsFor(level: Level, ms: number): number {
  if (ms <= level.stars[0]) return 3;
  if (ms <= level.stars[1]) return 2;
  if (ms <= level.stars[2]) return 1;
  return 0;
}

/** The time to beat for the next star up, or null when all three are earned.
 *  stars[] is [gold, silver, bronze] so earning `stars` stars chases stars[2 - stars]. */
export function nextStarMs(level: Level, stars: number): number | null {
  return stars >= 3 ? null : level.stars[2 - stars];
}

// ------------------------------------------------------------------------------------------------------------------
// Autopilot: a deterministic rider used by the tests and by nothing in the game itself. A lean controller aims the
// chassis at the ground ahead; a small planner picks throttle (on the ground) or lean (in the air) by trying a few
// options in a copy of the run and keeping the one that rides furthest without crashing.

export type PilotOpts = { flips?: boolean };

/** The lean controller alone: full gas, chassis aimed at the slope ahead or at the landing spot. */
export function steerInput(run: Run): Input {
  if (run.phase !== 'run') return { gas: 0, brake: 0, lean: 0 };
  const b = run.bike;
  const w = run.world;
  const grounded = b.fw.on || b.rw.on;
  const spd = Math.hypot(b.v.x, b.v.y);
  const slope = (x: number, d: number) => {
    const g0 = groundAt(w, x - d);
    const g1 = groundAt(w, x + d);
    return g0 === null || g1 === null ? null : Math.atan2(g1 - g0, 2 * d);
  };
  // groundAt means nothing inside a loop: ride it straight
  if (w.loops.some((l) => Math.hypot(b.p.x - l.cx, b.p.y - l.cy) < l.r + 1.5)) return { gas: 1, brake: 0, lean: 0 };
  let target: number;
  if (grounded) {
    target = slope(b.p.x + Math.min(2, spd * 0.15), 0.6) ?? 0;
  } else {
    // march the ballistic arc forward until it meets the ground, aim at the slope there
    let px = b.p.x;
    let py = b.p.y;
    let vy = b.v.y;
    let tx = px;
    for (let i = 0; i < 40; i++) {
      px += b.v.x * 0.05;
      py += vy * 0.05;
      vy -= 11 * 0.05;
      tx = px;
      const g = groundAt(w, px);
      if (g !== null && py <= g + 0.9) break;
    }
    target = slope(tx, 0.8) ?? 0;
  }
  const err = wrapAngle(target - b.a);
  // lean > 0 pitches forward (clockwise); err > 0 means the nose must come up
  const k = grounded ? 3 : 6;
  const lean = Math.max(-1, Math.min(1, -(err * k - b.w * (grounded ? 0.6 : 1.1)) / 10 * (grounded ? 2 : 1)));
  return { gas: 1, brake: 0, lean: grounded && Math.abs(err) < 0.25 ? 0 : lean };
}

type Plan = { input: Input; until: number; flip: number };
const plans = new WeakMap<Run, Plan>();
const PLAN_EVERY = 0.25;
const HORIZON = 2.6;
const D2R = Math.PI / 180;

function copyRun(run: Run): Run {
  const b = run.bike;
  const wh = (x: typeof b.fw) => ({ p: { ...x.p }, v: { ...x.v }, spin: x.spin, rot: x.rot, on: x.on, n: { ...x.n } });
  return {
    ...run,
    world: { ...run.world, loops: run.world.loops.map((l) => ({ ...l })) },
    bike: { p: { ...b.p }, v: { ...b.v }, a: b.a, w: b.w, fw: wh(b.fw), rw: wh(b.rw), crashed: b.crashed },
    air: { ...run.air },
    spawn: { ...run.spawn },
    toasts: [],
    fx: [],
  };
}

/** Follow `first` for `hold` seconds (flip: lean until that much rotation), then the controller. */
function rollout(run: Run, first: Input, hold: number, flip: number, flips: boolean): number {
  const r = copyRun(run);
  const f0 = r.flips;
  // distance ridden, not x gained: a loop runs backwards in x for a while
  let dist = 0;
  let t = 0;
  while (t < HORIZON) {
    let input = steerInput(r);
    const air = !r.bike.fw.on && !r.bike.rw.on;
    if (flip) {
      if (air && r.air.on && Math.abs(r.air.accum) < flip) input = { gas: 1, brake: 0, lean: first.lean };
    } else if (t < hold) input = first;
    stepRun(r, input, 1 / 60);
    t += 1 / 60;
    dist += Math.hypot(r.bike.v.x, r.bike.v.y) / 60;
    if (r.phase === 'crash') return -1000 + t * 100;
    if (r.phase === 'done') return 1000 - t;
  }
  return dist + (flips ? (r.flips - f0) * 25 : 0);
}

/** Look at the terrain ahead and produce a reasonable input. */
export function autoInput(run: Run, opts: PilotOpts = {}): Input {
  if (run.phase !== 'run') {
    plans.delete(run);
    return { gas: 0, brake: 0, lean: 0 };
  }
  const b = run.bike;
  const air = !b.fw.on && !b.rw.on;
  let plan = plans.get(run);
  if (plan && plan.flip) {
    // keep a committed flip going while it still lands; bail out to the controller once it would not
    const going = air && run.air.on && Math.abs(run.air.accum) < plan.flip;
    if (going && run.t < plan.until) return plan.input;
    if (going && rollout(run, plan.input, 0, plan.flip, true) >= 0) {
      plan.until = run.t + PLAN_EVERY / 2;
      return plan.input;
    }
    plans.delete(run);
    plan = undefined;
  }
  if (plan && run.t < plan.until) return plan.flip ? steerInput(run) : plan.input;
  const options: { input: Input; hold: number; flip: number }[] = [];
  const steer = steerInput(run);
  if (air) {
    for (const lean of [-1, -0.5, 0.5, 1]) options.push({ input: { gas: 1, brake: 0, lean }, hold: 0.3, flip: 0 });
    if (opts.flips && run.air.on)
      for (const n of [1, 2]) for (const lean of [-1, 1]) options.push({ input: { gas: 1, brake: 0, lean }, hold: 0, flip: (n * 360 - 50) * D2R });
  } else {
    for (const [gas, brake] of [[0.6, 0], [0, 0], [0, 1]]) for (const hold of [0.3, 0.8]) options.push({ input: { gas, brake, lean: 0 }, hold, flip: 0 });
  }
  let best = { input: steer, hold: PLAN_EVERY, flip: 0 };
  let bestScore = rollout(run, steer, 0, 0, !!opts.flips);
  // full gas and the controller win unless something else clearly does better
  for (const o of options) {
    const sc = rollout(run, o.input, o.hold, o.flip, !!opts.flips);
    if (sc > bestScore + (bestScore < 0 ? 0 : 1.5)) {
      bestScore = sc;
      best = o;
    }
  }
  plans.set(run, { input: best.input, until: run.t + Math.min(PLAN_EVERY, best.hold || PLAN_EVERY), flip: best.flip });
  if (best.flip) return best.input;
  return best.input === steer ? steer : { ...best.input, lean: best.input.lean || steer.lean };
}
