// A session on the circuit: a time trial (flying laps against the clock and your ghost) or a race from a standing
// start behind five red lights. Owns every car on track, steps their physics, settles contact between them, the
// slipstream, DRS detection, lap and sector timing, track limits and the running order. Pure, runs under node.
import { buildLine, createDriver, drive, type Driver, type Line, type Rival } from './ai.ts';
import { createCar, gearFor, stepCar, type Assists, type Car, type Input } from './car.ts';
import { circuit, deltaS, gridSlot, locate, pointAt, wrapS, type Circuit } from './track.ts';

export type Mode = 'trial' | 'race';
export type Kind = 'player' | 'ai' | 'remote';

export type Entry = {
  name: string;
  /** Team index (livery). */
  team: number;
  kind: Kind;
  /** Room seat online (-1 offline). */
  seat: number;
  /** Local player number for split screen (0 or 1), -1 for others. */
  pad: number;
  /** AI pace, 0.85 to 1. */
  pace?: number;
};

export type Lap = { time: number; valid: boolean; sectors: number[] };

export type Runner = {
  idx: number;
  entry: Entry;
  car: Car;
  driver: Driver | null;
  assists: Assists;
  /** Laps completed. */
  lap: number;
  /** Race distance covered (laps * length + s), for the running order. */
  dist: number;
  lapStart: number;
  /** Sector splits of the lap in progress (cumulative seconds from the lap start). */
  splits: number[];
  laps: Lap[];
  best: Lap | null;
  bestSectors: number[];
  lapValid: boolean;
  offNow: boolean;
  warnings: number;
  /** Time penalty in seconds. */
  penalty: number;
  /** Race time when the car crossed the line for the last time (s), null while racing. */
  fin: number | null;
  /** DRS armed for the next zone, and allowed right now. */
  drsArmed: boolean;
  drsOk: boolean;
  /** Time at every 10 m of the lap in progress, for the live delta. */
  trace: Float32Array;
  /** Remote cars: the latest packet and when it arrived. */
  net: NetCar | null;
  netAt: number;
  /** Bests are only counted for laps started properly (not the out lap of a time trial). */
  flying: boolean;
  /** A car out of the race (left the room). */
  out: boolean;
};

/** A car as the network sees it. */
export type NetCar = {
  x: number;
  y: number;
  yaw: number;
  vx: number;
  vy: number;
  r: number;
  steer: number;
  rpm: number;
  gear: number;
  brake: number;
  drs: boolean;
  lap: number;
  dist: number;
  /** Finish time in ms, -1 still racing. */
  fin: number;
  best: number;
};

export type RaceEvent =
  | { t: 'lap'; idx: number; lap: Lap; best: boolean; overall: boolean }
  | { t: 'sector'; idx: number; sector: number; time: number; best: boolean; overall: boolean }
  | { t: 'limits'; idx: number; warnings: number; penalty: boolean; invalid: boolean }
  | { t: 'contact'; idx: number; other: number; speed: number }
  | { t: 'wall'; idx: number; speed: number }
  | { t: 'light'; n: number }
  | { t: 'go' }
  | { t: 'finish'; idx: number; place: number }
  | { t: 'drs'; idx: number; open: boolean };

export type Race = {
  c: Circuit;
  line: Line;
  mode: Mode;
  laps: number;
  /** Seconds since lights out (negative before the start). */
  time: number;
  /** Lights lit, 0 to 5; they all go out at time 0. */
  lights: number;
  /** When the lights sequence began (negative seconds). */
  lightsFrom: number;
  runners: Runner[];
  events: RaceEvent[];
  /** Fastest lap of the session: runner and time. */
  fastest: { idx: number; time: number } | null;
  bestSectors: number[];
  /** Running order (runner indices). */
  order: number[];
  /** First car home (race time), for the cool-down. */
  leaderFin: number | null;
};

export const TRACE_STEP = 10;
const SECTOR_COUNT = 3;

let shared: { c: Circuit; line: Line } | null = null;
/** The circuit and its racing line, built once. */
export function world() {
  if (!shared) {
    const c = circuit();
    shared = { c, line: buildLine(c) };
  }
  return shared;
}

export type RaceOptions = {
  mode: Mode;
  laps: number;
  entries: Entry[];
  assists: Assists[];
  /** Seconds before the lights sequence starts (race), or 0. */
  lead?: number;
  /** Hold time between the fifth light and lights out (random 0.2 to 3 s at a real start). */
  hold?: number;
};

function makeRunner(r: Pick<Race, 'c' | 'line'>, idx: number, entry: Entry, assists: Assists, car: Car): Runner {
  return {
    idx,
    entry,
    car,
    driver: entry.kind === 'ai' ? createDriver(r.line, entry.pace ?? 0.95, idx) : null,
    assists,
    lap: 0,
    dist: 0,
    lapStart: 0,
    splits: [],
    laps: [],
    best: null,
    bestSectors: [],
    lapValid: true,
    offNow: false,
    warnings: 0,
    penalty: 0,
    fin: null,
    drsArmed: false,
    drsOk: false,
    trace: new Float32Array(Math.ceil(r.c.length / TRACE_STEP) + 1).fill(-1),
    net: null,
    netAt: 0,
    flying: false,
    out: false,
  };
}

export function createRace(o: RaceOptions): Race {
  const { c, line } = world();
  const base = { c, line };
  const runners: Runner[] = [];
  if (o.mode === 'trial') {
    // a flying start: rolling down the main straight toward the line at speed, tyres warm
    o.entries.forEach((e, k) => {
      const s = c.length - 380 - k * 60;
      const i = Math.round(wrapS(c, s) / c.ds) % c.n;
      const p = pointAt(c, s, line.off[i] + (k ? -2.5 : 0));
      const car = createCar(c, p.x, p.y, p.heading, 72, 92);
      car.gear = gearFor(72);
      const rn = makeRunner(base, k, e, o.assists[k] ?? o.assists[0], car);
      rn.dist = s - c.length;
      runners.push(rn);
    });
  } else {
    o.entries.forEach((e, k) => {
      const g = gridSlot(c, k);
      const car = createCar(c, g.x, g.y, g.heading, 0, 72);
      car.gear = 1;
      const rn = makeRunner(base, k, e, o.assists[k] ?? o.assists[0], car);
      rn.dist = g.s - c.length;
      rn.flying = true;
      runners.push(rn);
    });
  }
  const hold = o.hold ?? 0.2 + Math.random() * 2.6;
  const lead = o.lead ?? 2;
  const race: Race = {
    c,
    line,
    mode: o.mode,
    laps: o.laps,
    time: o.mode === 'race' ? -(lead + 5 + hold) : 0,
    lights: 0,
    lightsFrom: -(5 + hold),
    runners,
    events: [],
    fastest: null,
    bestSectors: [],
    order: runners.map((_, k) => k),
    leaderFin: null,
  };
  return race;
}

const inZone = (s: number, from: number, to: number) => (from < to ? s > from && s < to : s > from || s < to);

/** The idle input for a car parked on the grid or one that has finished and is cruising. */
const NONE: Input = { steer: 0, throttle: 0, brake: 0 };

/**
 * Advances the session by dt. `inputs` holds the input for each runner the caller drives (players); AI runners drive
 * themselves, remote runners follow their packets.
 */
export function stepRace(r: Race, dt: number, inputs: Map<number, Input>) {
  const { c } = r;
  const before = r.time;
  r.time += dt;

  // the lights: one more every second, then all out after the hold
  if (r.mode === 'race' && before < 0) {
    const lit = r.time < 0 ? Math.max(0, Math.min(5, Math.floor(r.time - r.lightsFrom) + 1)) : 0;
    const lights = r.time >= r.lightsFrom ? lit : 0;
    if (lights !== r.lights && lights > 0) r.events.push({ t: 'light', n: lights });
    r.lights = lights;
    if (r.time >= 0) {
      r.lights = 0;
      r.events.push({ t: 'go' });
    }
  }
  const started = r.mode === 'trial' || r.time >= 0;

  // slipstream: how deep each car sits in the wake of the car ahead
  for (const a of r.runners) {
    if (a.entry.kind === 'remote' || a.out) continue;
    let tow = 0;
    for (const b of r.runners) {
      if (b === a || b.out) continue;
      const gap = deltaS(c, a.car.s, b.car.s);
      if (gap <= 2 || gap > 45) continue;
      const across = Math.abs(a.car.d - b.car.d);
      if (across > 2.5) continue;
      tow = Math.max(tow, (1 - gap / 45) * (1 - across / 2.5));
    }
    a.car.tow = tow;
  }

  const rivals = (self: Runner): Rival[] => r.runners.filter((x) => x !== self && !x.out).map((x) => ({ s: x.car.s, d: x.car.d, v: x.car.vx }));

  for (const rn of r.runners) {
    if (rn.out) continue;
    const car = rn.car;
    if (rn.entry.kind === 'remote') {
      followNet(r, rn, dt);
      continue;
    }
    let input = inputs.get(rn.idx) ?? NONE;
    // finished cars (and players in the cool-down lap) are brought home by the AI at a gentle pace
    if (rn.driver && (rn.entry.kind === 'ai' || rn.fin !== null)) input = drive(rn.driver, car, c, r.line, rivals(rn), dt);
    else if (rn.fin !== null) {
      rn.driver = createDriver(r.line, 0.8, rn.idx);
      input = drive(rn.driver, car, c, r.line, rivals(rn), dt);
    }
    if (!started) {
      // on the grid: the engine revs with the throttle but the car is held until the lights go out. Computer drivers
      // idle, then hold steady revs for the start once the last couple of seconds before lights out come
      const thr = rn.entry.kind === 'ai' ? (r.time > -2.5 ? 0.5 : 0) : input.throttle;
      car.throttle = thr;
      car.rpm += (4000 + thr * 7500 - car.rpm) * Math.min(1, dt * 6);
      continue;
    }
    const drsNow = rn.drsArmed && r.c.drs.some((z) => inZone(car.s, z.from, z.to));
    rn.drsOk = drsNow;
    const wasOpen = car.drs;
    const prevS = car.s;
    stepCar(car, input, dt, c, rn.assists, drsNow);
    if (car.drs !== wasOpen) r.events.push({ t: 'drs', idx: rn.idx, open: car.drs });
    if (car.impact > 2) r.events.push({ t: 'wall', idx: rn.idx, speed: car.impact });
    progress(r, rn, prevS, before);
  }

  if (started) contacts(r);
  r.order = runningOrder(r);
}

/** Lap counting, sector splits, delta trace, DRS detection and track limits after a car moved from prevS. */
function progress(r: Race, rn: Runner, prevS: number, before: number) {
  const { c } = r;
  const car = rn.car;
  const ds = deltaS(c, prevS, car.s);
  rn.dist += ds;
  const lapTime = r.time - rn.lapStart;

  // crossing the line forwards (interpolated inside the step for exact times)
  if (prevS > c.length - 80 && car.s < 80 && ds > 0) {
    const f = (c.length - prevS) / Math.max(1e-6, ds);
    const at = before + (r.time - before) * f;
    crossLine(r, rn, at);
  }
  if (rn.flying) {
    const bucket = Math.floor(car.s / TRACE_STEP);
    if (bucket >= 0 && bucket < rn.trace.length && rn.trace[bucket] < 0) rn.trace[bucket] = lapTime;
    // sector splits
    for (let k = 0; k < SECTOR_COUNT - 1; k++) {
      const at = c.sectors[k];
      if (rn.splits.length === k && prevS < at && car.s >= at && ds > 0 && ds < 50) {
        rn.splits.push(lapTime);
        const sector = k === 0 ? lapTime : lapTime - rn.splits[k - 1];
        const best = rn.lapValid && (rn.bestSectors[k] === undefined || sector < rn.bestSectors[k]);
        const overall = best && (r.bestSectors[k] === undefined || sector < r.bestSectors[k]);
        if (best) rn.bestSectors[k] = sector;
        if (overall) r.bestSectors[k] = sector;
        r.events.push({ t: 'sector', idx: rn.idx, sector: k, time: sector, best, overall });
      }
    }
  }

  // DRS: within a second of the car ahead at the detection point arms the next zone (any time in a time trial)
  for (const z of c.drs) {
    if (prevS < z.detect && car.s >= z.detect && ds > 0 && ds < 50) {
      if (r.mode === 'trial') rn.drsArmed = true;
      else {
        const ahead = r.runners
          .filter((x) => x !== rn && !x.out && x.dist > rn.dist)
          .reduce((m, x) => Math.min(m, x.dist - rn.dist), Infinity);
        rn.drsArmed = rn.lap >= 2 && ahead / Math.max(10, car.vx) < 1;
      }
    }
    if (prevS < z.to && car.s >= z.to && ds > 0 && ds < 50) rn.drsArmed = false;
  }

  // track limits: all four wheels past the white line
  if (car.offTrack && !rn.offNow && Math.abs(car.vx) > 8) {
    rn.warnings++;
    let penalty = false;
    if (r.mode === 'race' && rn.warnings > 3) {
      rn.penalty += 5;
      penalty = true;
    }
    const invalid = rn.lapValid;
    rn.lapValid = false;
    r.events.push({ t: 'limits', idx: rn.idx, warnings: rn.warnings, penalty, invalid });
  }
  rn.offNow = car.offTrack;
}

function crossLine(r: Race, rn: Runner, at: number) {
  // the grid sits behind the line, so a race's first crossing is just the start of lap 1 (timed from lights out)
  if (r.mode === 'race' && rn.dist < r.c.length / 2) return;
  const time = at - rn.lapStart;
  if (rn.flying && rn.fin === null) {
    const s1 = rn.splits[0] ?? NaN;
    const s2 = rn.splits[1] ?? NaN;
    const sectors = [s1, s2 - s1, time - s2];
    const lap: Lap = { time, valid: rn.lapValid && rn.splits.length === SECTOR_COUNT - 1, sectors };
    rn.laps.push(lap);
    const best = lap.valid && (!rn.best || time < rn.best.time);
    if (best) rn.best = lap;
    const overall = best && (!r.fastest || time < r.fastest.time);
    if (overall) r.fastest = { idx: rn.idx, time };
    if (lap.valid) {
      const sector = sectors[2];
      const sb = rn.bestSectors[2] === undefined || sector < rn.bestSectors[2];
      const so = sb && (r.bestSectors[2] === undefined || sector < r.bestSectors[2]);
      if (sb) rn.bestSectors[2] = sector;
      if (so) r.bestSectors[2] = sector;
      r.events.push({ t: 'sector', idx: rn.idx, sector: 2, time: sector, best: sb, overall: so });
    }
    r.events.push({ t: 'lap', idx: rn.idx, lap, best, overall });
  }
  rn.lap++;
  rn.lapStart = at;
  rn.splits = [];
  rn.lapValid = true;
  rn.flying = true;
  rn.trace.fill(-1);
  rn.car.ersDeployed = 0;
  rn.car.ersHarvested = 0;
  if (r.mode === 'race' && rn.fin === null && rn.lap >= r.laps) {
    rn.fin = at + rn.penalty;
    if (r.leaderFin === null) r.leaderFin = at;
    const place = r.runners.filter((x) => x.fin !== null).length;
    r.events.push({ t: 'finish', idx: rn.idx, place });
  }
}

/** Remote cars glide along their last known velocity and ease toward each new packet. */
function followNet(r: Race, rn: Runner, dt: number) {
  const n = rn.net;
  const car = rn.car;
  if (!n) return;
  const age = Math.min(0.5, r.time - rn.netAt);
  const cos = Math.cos(n.yaw + n.r * age);
  const sin = Math.sin(n.yaw + n.r * age);
  const px = n.x + (Math.cos(n.yaw) * n.vx - Math.sin(n.yaw) * n.vy) * age;
  const py = n.y + (Math.sin(n.yaw) * n.vx + Math.cos(n.yaw) * n.vy) * age;
  const k = Math.min(1, dt * 10);
  car.x += (px - car.x) * k;
  car.y += (py - car.y) * k;
  const dyaw = Math.atan2(sin, cos) - car.yaw;
  car.yaw += Math.atan2(Math.sin(dyaw), Math.cos(dyaw)) * k;
  car.vx = n.vx;
  car.vy = n.vy;
  car.r = n.r;
  car.steer = n.steer;
  car.rpm = n.rpm;
  car.gear = n.gear;
  car.brake = n.brake;
  car.drs = n.drs;
  for (const w of car.wheels) w.w = n.vx / 0.36;
  const loc = locate(r.c, car.x, car.y, car.i);
  car.i = loc.i;
  car.s = loc.s;
  car.d = loc.d;
  rn.lap = n.lap;
  rn.dist = n.dist;
  rn.fin = n.fin >= 0 ? n.fin / 1000 : null;
}

/** Cars are three discs along their length; overlapping discs push the cars apart and trade momentum. */
const DISCS = [1.9, 0, -1.9];
const DISC_R = 1.0;
function contacts(r: Race) {
  const rs = r.runners.filter((x) => !x.out);
  for (let a = 0; a < rs.length; a++) {
    for (let b = a + 1; b < rs.length; b++) {
      const A = rs[a];
      const B = rs[b];
      const ca = A.car;
      const cb = B.car;
      const dx0 = cb.x - ca.x;
      const dy0 = cb.y - ca.y;
      if (dx0 * dx0 + dy0 * dy0 > 36) continue;
      const aRemote = A.entry.kind === 'remote';
      const bRemote = B.entry.kind === 'remote';
      if (aRemote && bRemote) continue;
      for (const oa of DISCS) {
        for (const ob of DISCS) {
          const ax = ca.x + Math.cos(ca.yaw) * oa;
          const ay = ca.y + Math.sin(ca.yaw) * oa;
          const bx = cb.x + Math.cos(cb.yaw) * ob;
          const by = cb.y + Math.sin(cb.yaw) * ob;
          const dx = bx - ax;
          const dy = by - ay;
          const dist = Math.hypot(dx, dy);
          if (dist >= DISC_R * 2 || dist < 1e-4) continue;
          const nx = dx / dist;
          const ny = dy / dist;
          const push = DISC_R * 2 - dist;
          // a remote car is authoritative over itself, so only the local one moves
          const wa = aRemote ? 0 : bRemote ? 1 : 0.5;
          const wb = 1 - wa;
          ca.x -= nx * push * wa;
          ca.y -= ny * push * wa;
          cb.x += nx * push * wb;
          cb.y += ny * push * wb;
          // relative velocity along the normal (world frame)
          const va = worldVel(ca);
          const vb = worldVel(cb);
          const rel = (vb.x - va.x) * nx + (vb.y - va.y) * ny;
          if (rel < 0) {
            const j = -rel * 0.6;
            if (!aRemote) setWorldVel(ca, va.x - nx * j * (bRemote ? 1 : 0.5), va.y - ny * j * (bRemote ? 1 : 0.5), -oa * j * 0.02);
            if (!bRemote) setWorldVel(cb, vb.x + nx * j * (aRemote ? 1 : 0.5), vb.y + ny * j * (aRemote ? 1 : 0.5), ob * j * 0.02);
            if (-rel > 1.5) r.events.push({ t: 'contact', idx: A.idx, other: B.idx, speed: -rel });
          }
        }
      }
    }
  }
}

const worldVel = (c: Car) => ({ x: Math.cos(c.yaw) * c.vx - Math.sin(c.yaw) * c.vy, y: Math.sin(c.yaw) * c.vx + Math.cos(c.yaw) * c.vy });
function setWorldVel(c: Car, x: number, y: number, spin: number) {
  c.vx = Math.cos(c.yaw) * x + Math.sin(c.yaw) * y;
  c.vy = -Math.sin(c.yaw) * x + Math.cos(c.yaw) * y;
  c.r += spin;
  for (const w of c.wheels) w.w = w.w * 0.7 + (c.vx / 0.36) * 0.3;
}

/** Finished cars first in finishing order, then everyone else by distance covered. */
export function runningOrder(r: Race): number[] {
  return r.runners
    .filter((x) => !x.out)
    .sort((a, b) => {
      if (r.mode === 'trial') {
        const ta = a.best?.time ?? Infinity;
        const tb = b.best?.time ?? Infinity;
        return ta - tb || a.idx - b.idx;
      }
      if (a.fin !== null || b.fin !== null) {
        if (a.fin === null) return 1;
        if (b.fin === null) return -1;
        return a.fin - b.fin;
      }
      return b.dist - a.dist;
    })
    .map((x) => x.idx);
}

/** Gap from a runner to the one ahead of it in the order (seconds, from distance and speed), or null for the leader. */
export function gapAhead(r: Race, idx: number): number | null {
  const pos = r.order.indexOf(idx);
  if (pos <= 0) return null;
  const me = r.runners[idx];
  const ahead = r.runners[r.order[pos - 1]];
  if (me.fin !== null && ahead.fin !== null) return me.fin - ahead.fin;
  return (ahead.dist - me.dist) / Math.max(20, Math.abs(me.car.vx));
}

/** Gap to the leader in seconds (or laps behind as a negative whole number). */
export function gapLeader(r: Race, idx: number): number | null {
  const lead = r.runners[r.order[0]];
  const me = r.runners[idx];
  if (lead === me) return null;
  if (me.fin !== null && lead.fin !== null) return me.fin - lead.fin;
  const behind = lead.dist - me.dist;
  if (behind > r.c.length) return -Math.floor(behind / r.c.length);
  return behind / Math.max(20, Math.abs(me.car.vx));
}

/** Live delta to a reference lap's trace at the runner's current position (seconds, positive is slower). */
export function liveDelta(r: Race, rn: Runner, ref: Float32Array | null): number | null {
  if (!ref || !rn.flying) return null;
  const pos = rn.car.s / TRACE_STEP;
  const k = Math.floor(pos);
  if (k < 1 || k + 1 >= ref.length || ref[k] < 0 || ref[k + 1] < 0) return null;
  const refT = ref[k] + (ref[k + 1] - ref[k]) * (pos - k);
  return r.time - rn.lapStart - refT;
}

/** Puts a car back on track (centered on the line, pointing the right way, stopped), costing the lap. */
export function resetCar(r: Race, rn: Runner) {
  const { c, line } = r;
  const s = rn.car.s;
  const i = Math.round(s / c.ds) % c.n;
  const p = pointAt(c, s, line.off[i]);
  const fresh = createCar(c, p.x, p.y, p.heading, 0, rn.car.wheels[0].temp);
  fresh.ers = rn.car.ers;
  fresh.ersDeployed = rn.car.ersDeployed;
  fresh.ersHarvested = rn.car.ersHarvested;
  rn.car = fresh;
  if (rn.lapValid) {
    rn.lapValid = false;
    r.events.push({ t: 'limits', idx: rn.idx, warnings: rn.warnings, penalty: false, invalid: true });
  }
}
