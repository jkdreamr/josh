// The racing line and the computer drivers. The line is a minimum curvature path inside the track limits, its speed
// profile comes from the car's grip and power (corner speeds, then a braking pass backwards and an acceleration pass
// forwards), and each AI drives the same physics as the player through steering, throttle and brake only.
import { G, RHO, SPEC, type Car, type Input } from './car.ts';
import { deltaS, wrapS, type Circuit } from './track.ts';

export type Line = {
  /** Lateral offset of the line from the centerline at each sample (positive left). */
  off: Float64Array;
  x: Float64Array;
  y: Float64Array;
  /** Curvature of the line (1/m, positive right). */
  k: Float64Array;
  /** Target speed at each sample, m/s. */
  v: Float64Array;
  /** True where the speed profile is braking. */
  braking: Uint8Array;
};

const mod = (a: number, n: number) => ((a % n) + n) % n;

/** Grip the speed profile assumes: a little under what the tyres give, so a clean driver can always match it. */
const MU_LINE = 1.55;
const DOWN = (RHO * SPEC.ClA) / (2 * SPEC.mass);

/** Lateral grip available at speed v (m/s^2). */
const latGrip = (v: number, mu: number) => mu * (G + DOWN * v * v);

export function buildLine(c: Circuit, opts: { margin?: number; mu?: number } = {}): Line {
  const n = c.n;
  const margin = opts.margin ?? 1.3;
  const mu = opts.mu ?? MU_LINE;
  const off = new Float64Array(n);
  const nx = (i: number) => -c.ty[i];
  const ny = (i: number) => c.tx[i];
  // relax toward the midpoint of neighbors at shrinking spans: a cheap minimum curvature path
  for (const span of [48, 32, 20, 12, 8, 5, 3, 2, 1]) {
    for (let it = 0; it < 60; it++) {
      for (let i = 0; i < n; i++) {
        const a = mod(i - span, n);
        const b = mod(i + span, n);
        const mx = (c.px[a] + nx(a) * off[a] + c.px[b] + nx(b) * off[b]) / 2;
        const my = (c.py[a] + ny(a) * off[a] + c.py[b] + ny(b) * off[b]) / 2;
        const want = (mx - c.px[i]) * nx(i) + (my - c.py[i]) * ny(i);
        const lim = c.hw[i] - margin;
        off[i] = Math.max(-lim, Math.min(lim, off[i] + (want - off[i]) * 0.9));
      }
    }
  }
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = c.px[i] + nx(i) * off[i];
    y[i] = c.py[i] + ny(i) * off[i];
  }
  // curvature from three points a few samples apart, then lightly smoothed
  const raw = new Float64Array(n);
  const q = 3;
  for (let i = 0; i < n; i++) {
    const a = mod(i - q, n);
    const b = mod(i + q, n);
    const ax = x[i] - x[a];
    const ay = y[i] - y[a];
    const bx = x[b] - x[i];
    const by = y[b] - y[i];
    const cross = ax * by - ay * bx;
    const la = Math.hypot(ax, ay);
    const lb = Math.hypot(bx, by);
    const lc = Math.hypot(x[b] - x[a], y[b] - y[a]);
    // positive curvature turns right (clockwise), so flip the cross product's sign
    raw[i] = (-2 * cross) / Math.max(1e-6, la * lb * lc);
  }
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = 0;
    for (let j = -2; j <= 2; j++) s += raw[mod(i + j, n)];
    k[i] = s / 5;
  }

  const line: Line = { off, x, y, k, v: new Float64Array(n), braking: new Uint8Array(n) };
  speedProfile(line, mu, line.v, line.braking);
  return line;
}

/**
 * Fills v with the fastest speeds along the line at grip mu: the corner limit at each point, then a braking pass
 * backwards and a power pass forwards around the loop (twice, so the wrap is settled).
 */
export function speedProfile(line: Line, mu: number, v: Float64Array = new Float64Array(line.k.length), braking?: Uint8Array) {
  const { x, y, k } = line;
  const n = k.length;
  const vmax = 100;
  for (let i = 0; i < n; i++) {
    const kk = Math.abs(k[i]);
    const den = kk - mu * DOWN;
    v[i] = den <= 0 ? vmax : Math.min(vmax, Math.sqrt((mu * G) / den));
  }
  const seg = (i: number) => Math.hypot(x[mod(i + 1, n)] - x[i], y[mod(i + 1, n)] - y[i]);
  for (let lap = 0; lap < 2; lap++) {
    for (let j = 2 * n; j > 0; j--) {
      const i = mod(j, n);
      const p = mod(j - 1, n);
      const vi = v[i];
      // what's left of the grip after cornering, plus drag, slows the car
      const lat = vi * vi * Math.abs(k[p]);
      const tot = latGrip(vi, mu * 0.98);
      const lon = Math.sqrt(Math.max(0, tot * tot - lat * lat));
      const drag = (0.5 * RHO * SPEC.CdA * vi * vi) / SPEC.mass;
      const brakeCap = Math.min(lon, brakeLimit(vi)) + drag;
      const reach = Math.sqrt(vi * vi + 2 * brakeCap * seg(p));
      if (reach < v[p]) {
        v[p] = reach;
        if (braking) braking[p] = 1;
      }
    }
    for (let j = 0; j < 2 * n; j++) {
      const i = mod(j, n);
      const nx2 = mod(j + 1, n);
      const vi = v[i];
      const lat = vi * vi * Math.abs(k[i]);
      const tot = latGrip(vi, mu);
      const lon = Math.sqrt(Math.max(0, tot * tot - lat * lat));
      const acc = Math.min(lon, powerAccel(vi));
      const reach = Math.sqrt(vi * vi + 2 * acc * seg(i));
      if (reach < v[nx2]) {
        v[nx2] = reach;
        if (braking) braking[nx2] = 0;
      }
    }
  }
  return v;
}

/** Deceleration the brakes themselves can produce (the pedal limit), m/s^2. */
const brakeLimit = (_v: number) => (SPEC.brakeTorque / SPEC.radius) / SPEC.mass;

/** Forward acceleration the power unit allows at speed v (with ERS), net of drag and rolling resistance. */
export function powerAccel(v: number) {
  const power = 610_000 * SPEC.efficiency;
  const drag = 0.5 * RHO * SPEC.CdA * v * v;
  return Math.max(0, (power / Math.max(v, 8) - drag) / SPEC.mass - SPEC.roll * G);
}

/** Lap time the speed profile adds up to, in seconds (a sanity check and the AI's pace reference). */
export function profileTime(line: Line) {
  let t = 0;
  const n = line.v.length;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ds = Math.hypot(line.x[j] - line.x[i], line.y[j] - line.y[i]);
    t += ds / ((line.v[i] + line.v[j]) / 2);
  }
  return t;
}

export type Driver = {
  /** 0.9 slow to 1 on the limit: the share of the line's grip this driver dares to use. */
  pace: number;
  /** This driver's own target speeds along the line. */
  v: Float64Array;
  /** Steering integrator and smoothing state. */
  steerI: number;
  /** Where on the track the driver wants to be relative to the racing line (overtaking, defending). */
  side: number;
  sideTarget: number;
  /** Seconds left committed to the current side. */
  sideHold: number;
  /** Small per-driver noise so the field spreads out. */
  wobble: number;
  seed: number;
};

export function createDriver(line: Line, pace: number, seed: number): Driver {
  const v = pace >= 1 ? line.v : speedProfile(line, MU_LINE * pace);
  return { pace, v, steerI: 0, side: 0, sideTarget: 0, sideHold: 0, wobble: 0, seed };
}

/** Another car the AI should know about: where it is along the lap and across the track, and its speed. */
export type Rival = { s: number; d: number; v: number };

/** Looks at the line ahead and the cars around, and returns this frame's inputs. */
export function drive(drv: Driver, car: Car, c: Circuit, line: Line, rivals: Rival[], dt: number): Input {
  const n = c.n;
  const v = Math.max(0, car.vx);
  const i = car.i;

  // traffic: pick a side to pass a slower car ahead, and match its speed if there's no room yet
  let limit = Infinity;
  drv.sideHold = Math.max(0, drv.sideHold - dt);
  let blocked = false;
  for (const r of rivals) {
    const gap = deltaS(c, car.s, r.s);
    if (gap <= 0 || gap > 45) continue;
    const across = r.d - (line.off[i] + drv.side);
    if (Math.abs(across) > 2.6) continue;
    blocked = true;
    const closing = v - r.v;
    if (drv.sideHold <= 0 && closing > -2 && gap < 35) {
      // go for the side with more room between the rival and the edge
      const room = (side: number) => c.hw[i] - side * r.d;
      const side = room(1) > room(-1) ? 1 : -1;
      drv.sideTarget = Math.max(-(c.hw[i] - 1.5), Math.min(c.hw[i] - 1.5, r.d + side * 3.4)) - line.off[i];
      drv.sideHold = 2.5;
    }
    // don't drive into the back of it while still lined up
    if (gap < 14 + v * 0.25) limit = Math.min(limit, r.v + (gap - 8) * 0.6);
  }
  if (!blocked && drv.sideHold <= 0) drv.sideTarget = 0;
  drv.side += Math.max(-dt * 2.2, Math.min(dt * 2.2, drv.sideTarget - drv.side));

  // steering: pure pursuit on a point ahead on the (offset) line, with yaw rate damping
  const look = 7 + v * 0.42;
  const ahead = Math.round(look / c.ds);
  const j = mod(i + ahead, n);
  // fade the side offset out where the line is close to an edge
  const lim = c.hw[j] - 1.2;
  const off = Math.max(-lim, Math.min(lim, line.off[j] + drv.side));
  const tx = c.px[j] - c.ty[j] * off;
  const ty = c.py[j] + c.tx[j] * off;
  const dx = tx - car.x;
  const dy = ty - car.y;
  const cos = Math.cos(car.yaw);
  const sin = Math.sin(car.yaw);
  const fwd = dx * cos + dy * sin;
  const left = -dx * sin + dy * cos;
  const dist = Math.max(1, Math.hypot(fwd, left));
  // curvature to reach the target; steering positive right means a left target needs a negative input
  const curv = (2 * left) / (dist * dist);
  const want = Math.atan(curv * SPEC.wheelbase);
  // grip needs a little extra lock beyond the geometric angle, more as lateral load rises
  const slip = Math.sign(want) * Math.min(0.09, Math.abs(curv) * v * v * 0.0006);
  const yawErr = car.r - v * curv;
  let steer = -(want + slip) / SPEC.maxSteer + yawErr * 0.12;
  steer = Math.max(-1, Math.min(1, steer));

  // speed: aim for this driver's profile a little ahead
  const preview = mod(i + Math.round((v * 0.18) / c.ds), n);
  let target = Math.min(drv.v[preview], drv.v[i]);
  // off the line costs grip, so slow a touch when running wide or side by side
  target *= 1 - Math.min(0.08, Math.abs(car.d - line.off[i]) * 0.006);
  target = Math.min(target, limit);
  let throttle = 0;
  let brake = 0;
  const err = target - v;
  if (err > 0) throttle = Math.min(1, 0.35 + err * 0.4);
  else if (err > -1.2) throttle = 0.25;
  else brake = Math.min(1, -err * 0.12);
  // feed the throttle in as the corner opens: the more lateral grip in use, the less throttle the rears can take
  const usage = Math.abs(car.ay) / latGrip(v, MU_LINE);
  throttle = Math.min(throttle, Math.max(0.25, 1.85 - usage * 1.5));
  // a sliding rear or a big slip angle: ease off like a driver catching it
  const rearSlip = Math.max(Math.abs(car.wheels[2].slipY), Math.abs(car.wheels[3].slipY));
  if (rearSlip > SPEC.slipY * 0.85) throttle *= 0.4;
  // stuck facing the wrong way or nearly stopped off line: just get going toward the line
  if (v < 3 && Math.abs(car.d - line.off[i]) > 2) throttle = Math.max(throttle, 0.4);

  return { steer, throttle, brake, drs: true };
}

/** Distance along the lap from one car to another, wrapped to the nearest direction. */
export const gapS = (c: Circuit, from: number, to: number) => deltaS(c, wrapS(c, from), wrapS(c, to));
