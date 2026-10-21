// Pure rules for Hoops: ball flight with spin, rim, backboard and net contact, shot spots, timed rounds. No DOM, no three.js.
// World units are meters. The rim centre sits at x = hoop.x, z = 0; the court runs toward +z.
export type V3 = { x: number; y: number; z: number };
export type Hoop = { x: number; y: number; z: number; r: number };
export type Ball = {
  id: number;
  p: V3;
  v: V3;
  /** angular velocity, rad/s */
  w: V3;
  live: boolean;
  rim: boolean;
  board: boolean;
  scored: boolean;
  missed: boolean;
  t: number;
  bounces: number;
  /** time since it went in, for clearing it out of the way */
  sinceScore: number;
  three: boolean;
  fire: boolean;
};
export type Spot = { d: number; a: number };
export type RoundSpec = { spots: Spot[]; target: number; sway: number; speed: number };
export type Aim = { yaw: number; power: number };

export const G = 9.81;
export const BALL_R = 0.12;
export const RIM_R = 0.245;
export const RIM_TUBE = 0.012;
export const RIM_Y = 3.05;
export const HOOP_Z = 0;
export const BOARD_OFF = 0.375;
export const BOARD_W = 1.8;
export const BOARD_T = 0.03;
export const BOARD_BOTTOM = 2.9;
export const BOARD_TOP = 3.95;
export const NET_H = 0.42;
export const NET_BOTTOM_R = 0.17;
export const THREE_D = 6.75;
export const RELEASE_Y = 2.05;
export const HAND_Y = 1.7;
export const RANGE_MIN = 2;
export const RANGE_MAX = 8.5;
export const ROUND_SECONDS = 45;
export const SHOT_GAP = 0.5;
export const MAX_LIVE = 3;
export const BREAK = 1.8;
export const MOVE = 0.45;
export const BACKSPIN = 13;

const BALL_E = 0.78;
const RIM_E = 0.52;
const BOARD_E = 0.6;
const BALL_BALL_E = 0.7;
const SUBSTEP = 1 / 240;
/** hollow sphere: I = k m R^2 */
const K_INERTIA = 2 / 3;

const ROUNDS: RoundSpec[] = [
  { spots: [{ d: 3.2, a: 0 }, { d: 3.4, a: -35 }, { d: 3.4, a: 35 }], target: 6, sway: 0, speed: 0 },
  { spots: [{ d: 4.6, a: 0 }, { d: 4.3, a: -50 }, { d: 4.3, a: 50 }, { d: 4.6, a: -22 }, { d: 4.6, a: 22 }], target: 7, sway: 0, speed: 0 },
  { spots: [{ d: 5.6, a: 0 }, { d: 5.3, a: -25 }, { d: 5.3, a: 25 }, { d: 5, a: -60 }, { d: 5, a: 60 }], target: 7, sway: 0.55, speed: 0.6 },
  { spots: [{ d: THREE_D, a: 0 }, { d: THREE_D, a: -40 }, { d: THREE_D, a: 40 }, { d: 6.6, a: -72 }, { d: 6.6, a: 72 }], target: 7, sway: 0.75, speed: 0.72 },
];
const LATE: Spot[] = [{ d: 5.4, a: -30 }, { d: THREE_D, a: 0 }, { d: 5.4, a: 30 }, { d: 7.2, a: -20 }, { d: 6.6, a: 70 }, { d: 7.2, a: 20 }, { d: 6.6, a: -70 }];

export function roundSpec(round: number): RoundSpec {
  if (round <= ROUNDS.length) return ROUNDS[Math.max(1, round) - 1];
  const n = round - ROUNDS.length;
  return { spots: LATE, target: Math.min(12, 7 + n), sway: Math.min(1.4, 0.75 + n * 0.15), speed: Math.min(1.6, 0.72 + n * 0.12) };
}
export const targetFor = (round: number) => roundSpec(round).target;
export const hoopX = (round: number, t: number) => {
  const s = roundSpec(round);
  return s.sway ? Math.sin(t * s.speed) * s.sway : 0;
};
export const isThree = (s: Spot) => s.d >= THREE_D - 0.2;

/** Floor point of a spot: d meters from the rim centre, a degrees off the middle of the lane. */
export function spotPos(s: Spot): V3 {
  const a = (s.a * Math.PI) / 180;
  return { x: Math.sin(a) * s.d, y: 0, z: HOOP_Z + Math.cos(a) * s.d };
}
/** Where the ball leaves the hands: above the spot, a little toward the hoop. */
export function releasePos(s: Spot): V3 {
  const f = spotPos(s);
  const k = (s.d - 0.3) / s.d;
  return { x: f.x * k, y: RELEASE_Y, z: HOOP_Z + (f.z - HOOP_Z) * k };
}
export const handPos = (s: Spot): V3 => ({ ...releasePos(s), y: HAND_Y });

/** Launch velocity from p0 that passes through target on the way down after peaking peakAbove meters above the higher end. */
export function launchVelocity(p0: V3, target: V3, peakAbove = 1.6): V3 {
  const peak = Math.max(target.y, p0.y) + peakAbove;
  const vy = Math.sqrt(2 * G * (peak - p0.y));
  const disc = Math.max(0, vy * vy - 2 * G * (target.y - p0.y));
  const t = (vy + Math.sqrt(disc)) / G;
  return { x: (target.x - p0.x) / t, y: vy, z: (target.z - p0.z) / t };
}

export const rangeOf = (power: number) => RANGE_MIN + Math.min(1, Math.max(0, power)) * (RANGE_MAX - RANGE_MIN);
export const powerFor = (range: number) => (range - RANGE_MIN) / (RANGE_MAX - RANGE_MIN);
const peakFor = (range: number) => Math.min(2.3, 0.9 + range * 0.17);

/** The point at rim height an aim is thrown at, from a spot whose straight line points at the hoop's resting place. */
export function aimTarget(s: Spot, aim: Aim): V3 {
  const p0 = releasePos(s);
  const base = Math.atan2(-p0.x, HOOP_Z - p0.z);
  const yaw = base + aim.yaw;
  const r = rangeOf(aim.power);
  return { x: p0.x + Math.sin(yaw) * r, y: RIM_Y, z: p0.z + Math.cos(yaw) * r };
}

export function shotVelocity(s: Spot, aim: Aim) {
  const p0 = releasePos(s);
  const target = aimTarget(s, aim);
  const v = launchVelocity(p0, target, peakFor(rangeOf(aim.power)));
  // backspin: around the horizontal axis perpendicular to the flight
  const hl = Math.hypot(v.x, v.z) || 1;
  const w = { x: (-v.z / hl) * BACKSPIN, y: 0, z: (v.x / hl) * BACKSPIN };
  return { p0, v, w };
}

/** A drag in screen pixels to an aim: up for power (full at `full` px), sideways to turn. */
export function aimFromDrag(dx: number, dy: number, full: number): Aim {
  return { power: Math.min(1, Math.max(0, -dy / full)), yaw: Math.min(0.6, Math.max(-0.6, (dx / full) * 0.6)) };
}

let ids = 0;
export function makeBall(s?: Spot): Ball {
  const p = s ? handPos(s) : { x: 0, y: HAND_Y, z: 4 };
  return { id: ++ids, p, v: { x: 0, y: 0, z: 0 }, w: { x: 0, y: 0, z: 0 }, live: false, rim: false, board: false, scored: false, missed: false, t: 0, bounces: 0, sinceScore: 0, three: false, fire: false };
}

export function launch(s: Spot, aim: Aim): Ball {
  const b = makeBall(s);
  const { p0, v, w } = shotVelocity(s, aim);
  b.p = p0;
  b.v = v;
  b.w = w;
  b.live = true;
  b.three = isThree(s);
  return b;
}

export type Contact = { rim?: number; board?: number; floor?: number; net?: boolean; score?: 'swish' | 'make'; dead?: boolean };

const dot = (a: V3, b: V3) => a.x * b.x + a.y * b.y + a.z * b.z;
const cross = (a: V3, b: V3): V3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });

/** Impulse against a fixed surface with normal n (unit, pointing at the ball centre): bounce plus friction that trades spin and slide. */
function bounce(b: Ball, n: V3, e: number, mu: number) {
  const vn = dot(b.v, n);
  if (vn >= 0) return 0;
  const jn = -(1 + e) * vn;
  const rc = { x: -n.x * BALL_R, y: -n.y * BALL_R, z: -n.z * BALL_R };
  const wr = cross(b.w, rc);
  const u = { x: b.v.x + wr.x, y: b.v.y + wr.y, z: b.v.z + wr.z };
  const un = dot(u, n);
  const ut = { x: u.x - un * n.x, y: u.y - un * n.y, z: u.z - un * n.z };
  const sl = Math.hypot(ut.x, ut.y, ut.z);
  const jt = sl > 1e-9 ? Math.min(sl / (1 + 1 / K_INERTIA), mu * jn) / sl : 0;
  const J = { x: jn * n.x - jt * ut.x, y: jn * n.y - jt * ut.y, z: jn * n.z - jt * ut.z };
  b.v.x += J.x;
  b.v.y += J.y;
  b.v.z += J.z;
  const dw = cross(rc, J);
  const inv = 1 / (K_INERTIA * BALL_R * BALL_R);
  b.w.x += dw.x * inv;
  b.w.y += dw.y * inv;
  b.w.z += dw.z * inv;
  return -vn;
}

export const netRadius = (y: number) => RIM_R - 0.012 + (NET_BOTTOM_R - RIM_R + 0.012) * Math.min(1, Math.max(0, (RIM_Y - y) / NET_H));

/** One physics step, split into substeps so rim contact never tunnels on slow frames. */
export function stepBall(b: Ball, hoop: Hoop, dt: number): Contact {
  const out: Contact = {};
  if (!b.live) return out;
  const n = Math.max(1, Math.ceil(dt / SUBSTEP - 1e-9));
  const h = dt / n;
  for (let i = 0; i < n && b.live; i++) substep(b, hoop, h, out);
  return out;
}

function substep(b: Ball, hoop: Hoop, dt: number, out: Contact) {
  const prevY = b.p.y;
  b.t += dt;
  if (b.scored) b.sinceScore += dt;
  b.v.y -= G * dt;
  b.p.x += b.v.x * dt;
  b.p.y += b.v.y * dt;
  b.p.z += b.v.z * dt;

  // backboard: a thin box; the nearest point covers the face, the edges and the corners
  const bx = Math.min(hoop.x + BOARD_W / 2, Math.max(hoop.x - BOARD_W / 2, b.p.x));
  const by = Math.min(BOARD_TOP, Math.max(BOARD_BOTTOM, b.p.y));
  const face = hoop.z - BOARD_OFF;
  const bz = Math.min(face, Math.max(face - BOARD_T, b.p.z));
  let nx = b.p.x - bx;
  let ny = b.p.y - by;
  let nz = b.p.z - bz;
  let d = Math.hypot(nx, ny, nz);
  if (d < BALL_R) {
    if (d < 1e-6) {
      nx = 0;
      ny = 0;
      nz = 1;
      d = 0;
    } else {
      nx /= d;
      ny /= d;
      nz /= d;
    }
    const push = BALL_R - d;
    b.p.x += nx * push;
    b.p.y += ny * push;
    b.p.z += nz * push;
    const s = bounce(b, { x: nx, y: ny, z: nz }, BOARD_E, 0.25);
    if (s > 0.2) {
      b.board = true;
      out.board = Math.max(out.board ?? 0, s);
    }
  }

  // rim: a torus lying flat at hoop.y
  const dx = b.p.x - hoop.x;
  const dz = b.p.z - hoop.z;
  const dh = Math.hypot(dx, dz) || 1e-6;
  const cx = hoop.x + (dx / dh) * hoop.r;
  const cz = hoop.z + (dz / dh) * hoop.r;
  nx = b.p.x - cx;
  ny = b.p.y - hoop.y;
  nz = b.p.z - cz;
  d = Math.hypot(nx, ny, nz);
  if (d < BALL_R + RIM_TUBE) {
    const inv = 1 / (d || 1e-6);
    const un = { x: nx * inv, y: ny * inv, z: nz * inv };
    const push = BALL_R + RIM_TUBE - d;
    b.p.x += un.x * push;
    b.p.y += un.y * push;
    b.p.z += un.z * push;
    const s = bounce(b, un, RIM_E, 0.3);
    if (s > 0.15) out.rim = Math.max(out.rim ?? 0, s);
    b.rim = true;
  }

  // through the ring, moving down
  if (!b.scored && !b.missed && prevY > hoop.y && b.p.y <= hoop.y && b.v.y < 0 && Math.hypot(b.p.x - hoop.x, b.p.z - hoop.z) < hoop.r) {
    b.scored = true;
    out.score = b.rim || b.board ? 'make' : 'swish';
  }

  // the net: once in, it slows the ball and keeps it in the middle
  if (b.scored && b.p.y < hoop.y && b.p.y > hoop.y - NET_H - BALL_R) {
    const ax = b.p.x - hoop.x;
    const az = b.p.z - hoop.z;
    const r = Math.hypot(ax, az);
    const lim = Math.max(0.02, netRadius(b.p.y) - BALL_R * 0.55);
    if (r > lim) {
      const k = lim / r;
      b.p.x = hoop.x + ax * k;
      b.p.z = hoop.z + az * k;
      const vr = (b.v.x * ax + b.v.z * az) / r;
      if (vr > 0) {
        b.v.x -= (vr * 1.3 * ax) / r;
        b.v.z -= (vr * 1.3 * az) / r;
      }
    }
    const drag = Math.exp(-5 * dt);
    b.v.x *= drag;
    b.v.z *= drag;
    b.v.y *= Math.exp(-2.2 * dt);
    b.w.x *= drag;
    b.w.z *= drag;
    out.net = true;
  }

  // floor
  if (b.p.y - BALL_R < 0) {
    b.p.y = BALL_R;
    const s = bounce(b, { x: 0, y: 1, z: 0 }, BALL_E, 0.45);
    if (s > 0.6) {
      b.bounces++;
      out.floor = Math.max(out.floor ?? 0, s);
    } else {
      b.v.y = Math.max(0, b.v.y);
      const roll = Math.exp(-0.9 * dt);
      b.v.x *= roll;
      b.v.z *= roll;
    }
  }
  const speed = Math.hypot(b.v.x, b.v.y, b.v.z);
  if (b.t > 6 || (b.scored && b.sinceScore > 1.6) || (b.bounces >= 2 && b.t > 2.4) || (b.p.y < BALL_R + 0.01 && speed < 0.4) || Math.abs(b.p.x) > 11 || b.p.z < -4.5 || b.p.z > 15) {
    b.live = false;
    out.dead = true;
  }
}

/** Equal balls knocking into each other. */
export function collideBalls(a: Ball, b: Ball) {
  const nx = b.p.x - a.p.x;
  const ny = b.p.y - a.p.y;
  const nz = b.p.z - a.p.z;
  const d = Math.hypot(nx, ny, nz);
  if (d >= BALL_R * 2 || d < 1e-6) return false;
  const ux = nx / d;
  const uy = ny / d;
  const uz = nz / d;
  const push = (BALL_R * 2 - d) / 2;
  a.p.x -= ux * push;
  a.p.y -= uy * push;
  a.p.z -= uz * push;
  b.p.x += ux * push;
  b.p.y += uy * push;
  b.p.z += uz * push;
  const rel = (a.v.x - b.v.x) * ux + (a.v.y - b.v.y) * uy + (a.v.z - b.v.z) * uz;
  if (rel <= 0) return false;
  const j = ((1 + BALL_BALL_E) * rel) / 2;
  a.v.x -= j * ux;
  a.v.y -= j * uy;
  a.v.z -= j * uz;
  b.v.x += j * ux;
  b.v.y += j * uy;
  b.v.z += j * uz;
  return true;
}

/** Simulates one shot against a still hoop and says how it ends. */
export function simulate(s: Spot, aim: Aim, hoopAt = 0): 'swish' | 'make' | 'miss' {
  const hoop = { x: hoopAt, y: RIM_Y, z: HOOP_Z, r: RIM_R };
  const b = launch(s, aim);
  for (let i = 0; i < 240 * 6 && b.live; i++) {
    const c = stepBall(b, hoop, SUBSTEP);
    if (c.score) return c.score;
    if (b.p.y < RIM_Y - 1 && b.v.y < 0) break;
  }
  return 'miss';
}

export type Window = { best: number; lo: number; hi: number; swishLo: number; swishHi: number };

/** The power band that goes in from a spot when aimed straight (and the narrower band that swishes). */
export function makeWindow(s: Spot): Window {
  const p0 = releasePos(s);
  const best = powerFor(Math.hypot(p0.x, p0.z - HOOP_Z));
  const step = 0.002;
  const edge = (dir: 1 | -1, ok: (r: string) => boolean) => {
    let p = best;
    for (let i = 0; i < 80; i++) {
      const q = p + dir * step;
      if (q < 0 || q > 1 || !ok(simulate(s, { yaw: 0, power: q }))) break;
      p = q;
    }
    return p;
  };
  const any = (r: string) => r !== 'miss';
  const clean = (r: string) => r === 'swish';
  return { best, lo: edge(-1, any), hi: edge(1, any), swishLo: edge(-1, clean), swishHi: edge(1, clean) };
}

export type Game = {
  round: number;
  timeLeft: number;
  makes: number;
  totalMakes: number;
  score: number;
  attempts: number;
  t: number;
  hoop: Hoop;
  balls: Ball[];
  cooldown: number;
  /** seconds the court is still between rounds (clock stopped) */
  pause: number;
  /** seconds left of the walk to a new spot */
  moving: number;
  spot: number;
  streak: number;
  bestStreak: number;
  fire: boolean;
  over: boolean;
};

export function create(): Game {
  return { round: 1, timeLeft: ROUND_SECONDS, makes: 0, totalMakes: 0, score: 0, attempts: 0, t: 0, hoop: { x: 0, y: RIM_Y, z: HOOP_Z, r: RIM_R }, balls: [], cooldown: 0, pause: 0, moving: 0, spot: 0, streak: 0, bestStreak: 0, fire: false, over: false };
}

export const currentSpot = (g: Game) => {
  const spots = roundSpec(g.round).spots;
  return spots[g.spot % spots.length];
};
export const liveCount = (g: Game) => g.balls.filter((b) => b.live).length;
export const canShoot = (g: Game) => !g.over && g.timeLeft > 0 && g.pause <= 0 && g.moving <= 0 && g.cooldown <= 0 && liveCount(g) < MAX_LIVE;

export function fire(g: Game, aim: Aim): Ball | null {
  if (!canShoot(g)) return null;
  const b = launch(currentSpot(g), aim);
  b.fire = g.fire;
  g.balls.push(b);
  g.attempts++;
  g.cooldown = SHOT_GAP;
  return b;
}

export const pointsFor = (kind: 'swish' | 'make', three: boolean, onFire: boolean) => (2 + (kind === 'swish' ? 1 : 0) + (three ? 1 : 0)) * (onFire ? 2 : 1);

export type Made = { kind: 'swish' | 'make'; points: number; three: boolean; fire: boolean; ball: number };
export type Tick = { rim?: number; board?: number; floor?: number; net?: boolean; made?: Made[]; missed?: number; fireOn?: boolean; fireOff?: boolean; moved?: boolean; roundUp?: boolean; over?: boolean; buzzer?: boolean };

/** dt drives physics (clamped by the loop); clockDt is real elapsed time so the round clock stays honest on slow frames. */
export function stepGame(g: Game, dt: number, clockDt = dt): Tick {
  const out: Tick = {};
  if (g.over) return out;
  g.t += dt;
  g.hoop.x = hoopX(g.round, g.t);
  if (g.pause > 0) {
    g.pause = Math.max(0, g.pause - clockDt);
    return out;
  }
  const before = g.timeLeft;
  g.timeLeft = Math.max(0, g.timeLeft - clockDt);
  if (before > 0 && g.timeLeft <= 0) out.buzzer = true;
  g.cooldown = Math.max(0, g.cooldown - dt);
  g.moving = Math.max(0, g.moving - dt);

  const live = g.balls.filter((b) => b.live);
  for (const b of live) {
    const c = stepBall(b, g.hoop, dt);
    if (c.rim) out.rim = Math.max(out.rim ?? 0, c.rim);
    if (c.board) out.board = Math.max(out.board ?? 0, c.board);
    if (c.floor) out.floor = Math.max(out.floor ?? 0, c.floor);
    if (c.net) out.net = true;
    if (c.score) {
      const points = pointsFor(c.score, b.three, b.fire);
      g.score += points;
      g.makes++;
      g.totalMakes++;
      g.streak++;
      g.bestStreak = Math.max(g.bestStreak, g.streak);
      (out.made ??= []).push({ kind: c.score, points, three: b.three, fire: b.fire, ball: b.id });
      if (g.streak >= 3 && !g.fire) {
        g.fire = true;
        out.fireOn = true;
      }
      g.spot++;
      g.moving = MOVE;
      out.moved = true;
    }
    if (c.dead && !b.scored) {
      b.missed = true;
      out.missed = (out.missed ?? 0) + 1;
      g.streak = 0;
      if (g.fire) {
        g.fire = false;
        out.fireOff = true;
      }
    }
  }
  for (let i = 0; i < live.length; i++) for (let j = i + 1; j < live.length; j++) collideBalls(live[i], live[j]);
  g.balls = g.balls.filter((b) => b.live);

  if (g.timeLeft <= 0 && !g.balls.length) {
    if (g.makes >= targetFor(g.round)) {
      g.round++;
      g.makes = 0;
      g.timeLeft = ROUND_SECONDS;
      g.spot = 0;
      g.pause = BREAK;
      g.moving = MOVE;
      out.roundUp = true;
    } else {
      g.over = true;
      out.over = true;
    }
  }
  return out;
}

export const fmtClock = (s: number) => {
  const n = Math.max(0, Math.ceil(s));
  return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
};
