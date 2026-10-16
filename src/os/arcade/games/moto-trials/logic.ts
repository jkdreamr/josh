// Run state machine for Moto Trials: countdown, timer, flips, checkpoints, crashes, finish.
// Pure: tests drive it under node. Drawing reads the same state.
import { groundAt, newBike, step, wrapAngle, type Bike, type Input, type PhysWorld } from './physics.ts';
import { worldOf, type Level } from './levels.ts';

export const COUNTDOWN = 3;
export const RESPAWN_DELAY = 0.9;
export const FINISH_PAUSE = 1.2;
export const FLIP_BONUS_MS = 1000;

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
  /** Air time bookkeeping for flip detection. */
  air: { time: number; accum: number; was: number };
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
    air: { time: 0, accum: 0, was: 0 },
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

const names = ['', 'Backflip', 'Double Backflip', 'Triple Backflip'];
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
  run.air = { time: 0, accum: 0, was: run.bike.a };
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
  const wasAir = !b.fw.on && !b.rw.on;
  const a0 = b.a;
  const hits = step(b, run.world, input, dt);
  const isAir = !b.fw.on && !b.rw.on;
  const da = wrapAngle(b.a - a0);

  if (isAir) {
    run.air.time += dt;
    run.air.accum += da;
  } else if (run.air.time > 0) {
    // just landed (or barely hopped); score flips for real airtime only
    if (run.air.time > 0.12 && !hits.head && !hits.saw) {
      const flips = Math.floor((Math.abs(run.air.accum) + Math.PI / 6) / (Math.PI * 2));
      if (flips > 0) {
        const list = run.air.accum < 0 ? names : namesF;
        toast(run, `${list[Math.min(3, flips)]} -${flips}s`);
        run.bonusMs += flips * FLIP_BONUS_MS;
        run.flips += flips;
      }
      for (let i = 0; i < 6; i++)
        run.fx.push({ x: b.p.x + (i - 3) * 0.3, y: b.p.y - 0.6, vx: (i - 3) * 0.8, vy: 1 + (i % 2), t: run.t, life: 0.45, kind: 'puff' });
    }
    run.air = { time: 0, accum: 0, was: b.a };
  } else {
    run.air = { time: 0, accum: 0, was: b.a };
  }
  void wasAir;

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
// Autopilot: a deterministic rider used by the tests and by nothing in the game itself.

/** Look at the terrain ahead and produce a reasonable input. */
export function autoInput(run: Run): Input {
  if (run.phase !== 'run') return { gas: 0, brake: 0, lean: 0 };
  const b = run.bike;
  const w = run.world;
  const grounded = b.fw.on || b.rw.on;
  const spd = Math.hypot(b.v.x, b.v.y);

  // terrain slope under the bike and a bit ahead
  const slopeAt = (x: number) => {
    const g0 = groundAt(w, x - 0.6);
    const g1 = groundAt(w, x + 0.6);
    if (g0 === null || g1 === null) return 0;
    return Math.atan2(g1 - g0, 1.2);
  };

  let target: number;
  let gas = 1;
  let brake = 0;
  if (grounded) {
    target = slopeAt(b.p.x + Math.min(3, spd * 0.4));
  } else {
    // in the air: aim the chassis at the slope where we will land
    let tx = b.p.x + b.v.x * 0.8;
    let vy = b.v.y;
    let px = b.p.x;
    let py = b.p.y;
    // march the ballistic arc forward until it meets the ground
    for (let i = 0; i < 30; i++) {
      const dt = 0.1;
      px += b.v.x * dt;
      py += vy * dt;
      vy -= 11 * dt;
      const g = groundAt(w, px);
      if (g !== null && py <= g + 0.9) {
        tx = px;
        break;
      }
      tx = px;
    }
    const g0 = groundAt(w, tx - 0.8);
    const g1 = groundAt(w, tx + 0.8);
    target = g0 !== null && g1 !== null ? Math.atan2(g1 - g0, 1.6) : 0;
    // falling far with no ground under us: stay level and hope
    if (g0 === null && g1 === null) target = 0;
  }

  const err = wrapAngle(target - b.a);
  // lean >0 pitches forward (clockwise); err >0 means we need counterclockwise
  const lean = Math.max(-1, Math.min(1, (-(err * 6 - b.w * 1.1)) / 10));
  // ease off when the ground falls away into a gap just ahead and we are already fast
  if (grounded && spd > 11) {
    const gNear = groundAt(w, b.p.x + 2);
    const gFar = groundAt(w, b.p.x + 6);
    if (gNear !== null && gFar === null) {
      gas = 0.4;
      brake = 0;
    }
  }
  return { gas, brake, lean };
}
