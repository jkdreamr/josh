// Pure rules for Hoops: ball flight, rim and backboard contact, scoring, timed rounds. No DOM, no three.js.
export type V3 = { x: number; y: number; z: number };
export type Hoop = { x: number; y: number; z: number; r: number };
export type Ball = { p: V3; v: V3; live: boolean; rim: boolean; board: boolean; scored: boolean; t: number; bounces: number; spin: number };

export const G = 9.81;
export const RIM_R = 0.26;
export const RIM_TUBE = 0.02;
export const BALL_R = 0.115;
export const RIM_Y = 3.05;
export const HOOP_Z = -5.6;
export const BOARD_OFF = 0.375;
export const BOARD_W = 1.8;
export const BOARD_BOTTOM = 2.9;
export const BOARD_TOP = 3.95;
export const START: V3 = { x: 0, y: 1.55, z: 0 };
export const PEAK_ABOVE_RIM = 1.8;
export const ROUND_SECONDS = 60;
export const RESPAWN = 0.45;
export const MAX_FLIGHT = 5;

export type Aim = { lateral: number; depth: number };

export const targetFor = (round: number) => 3 + round;
export const hoopSway = (round: number) => (round < 2 ? 0 : Math.min(1.5, 0.7 + round * 0.25));
export const hoopSpeed = (round: number) => 0.55 + round * 0.18;
export const hoopX = (round: number, t: number) => Math.sin(t * hoopSpeed(round)) * hoopSway(round);

export function makeBall(): Ball {
  return { p: { ...START }, v: { x: 0, y: 0, z: 0 }, live: false, rim: false, board: false, scored: false, t: 0, bounces: 0, spin: 0 };
}

/** Launch velocity from p0 that passes through target on the way down after peaking peakAbove meters above the rim. */
export function launchVelocity(p0: V3, target: V3, peakAbove = PEAK_ABOVE_RIM): V3 {
  const peak = Math.max(target.y, p0.y) + peakAbove;
  const vy = Math.sqrt(2 * G * (peak - p0.y));
  const disc = Math.max(0, vy * vy - 2 * G * (target.y - p0.y));
  const t = (vy + Math.sqrt(disc)) / G;
  return { x: (target.x - p0.x) / t, y: vy, z: (target.z - p0.z) / t };
}

/** Drag gesture to aim: swipe length sets depth (1 = perfect), sideways drift pushes left or right. */
export function aimFromDrag(dx: number, dy: number, w: number, h: number): Aim {
  const power = Math.min(1.7, Math.max(0, -dy / (h * 0.42)));
  const lateral = Math.min(1.6, Math.max(-1.6, (dx / Math.min(w, h)) * 1.6));
  return { lateral, depth: (power - 1) * 1.4 };
}

export function shoot(ball: Ball, hoop: Hoop, aim: Aim) {
  const target = { x: hoop.x + aim.lateral, y: hoop.y, z: hoop.z - aim.depth };
  ball.p = { ...START };
  ball.v = launchVelocity(ball.p, target);
  ball.live = true;
  ball.rim = false;
  ball.board = false;
  ball.scored = false;
  ball.t = 0;
  ball.bounces = 0;
  ball.spin = 0;
}

export type Contact = { rim?: boolean; board?: boolean; floor?: boolean; score?: 'swish' | 'make'; dead?: boolean };

const SUBSTEP = 1 / 240;
const ASSIST = 30;

/** One physics step, internally split into substeps so rim contact never tunnels on slow frames. */
export function stepBall(b: Ball, hoop: Hoop, dt: number): Contact {
  const out: Contact = {};
  if (!b.live) return out;
  const n = Math.max(1, Math.ceil(dt / SUBSTEP));
  const h = dt / n;
  for (let i = 0; i < n && b.live; i++) {
    const c = substep(b, hoop, h);
    if (c.rim) out.rim = true;
    if (c.board) out.board = true;
    if (c.floor) out.floor = true;
    if (c.score) out.score = c.score;
    if (c.dead) out.dead = true;
  }
  return out;
}

function substep(b: Ball, hoop: Hoop, dt: number): Contact {
  const out: Contact = {};
  const prevY = b.p.y;
  b.t += dt;
  b.v.y -= G * dt;
  b.p.x += b.v.x * dt;
  b.p.y += b.v.y * dt;
  b.p.z += b.v.z * dt;
  b.spin += Math.hypot(b.v.x, b.v.z) * dt / BALL_R;

  // a soft pull toward the centre just above the rim, so near misses rattle in instead of bricking
  if (b.v.y < 0 && b.p.y > hoop.y && b.p.y < hoop.y + 0.6) {
    const ax = b.p.x - hoop.x;
    const az = b.p.z - hoop.z;
    if (Math.hypot(ax, az) < hoop.r + BALL_R) {
      b.v.x -= ax * ASSIST * dt;
      b.v.z -= az * ASSIST * dt;
    }
  }

  // backboard: a wall just behind the rim
  const boardZ = hoop.z - BOARD_OFF;
  if (b.p.z - BALL_R < boardZ && b.v.z < 0 && Math.abs(b.p.x - hoop.x) < BOARD_W / 2 + BALL_R && b.p.y > BOARD_BOTTOM - BALL_R && b.p.y < BOARD_TOP + BALL_R) {
    b.p.z = boardZ + BALL_R;
    b.v.z = -b.v.z * 0.62;
    b.v.x *= 0.92;
    b.v.y *= 0.9;
    b.board = true;
    out.board = true;
  }

  // rim: a ring in the plane y = hoop.y
  const dx = b.p.x - hoop.x;
  const dz = b.p.z - hoop.z;
  const d = Math.hypot(dx, dz) || 1e-6;
  const cx = hoop.x + (dx / d) * hoop.r;
  const cz = hoop.z + (dz / d) * hoop.r;
  const nx = b.p.x - cx;
  const ny = b.p.y - hoop.y;
  const nz = b.p.z - cz;
  const dist = Math.hypot(nx, ny, nz);
  if (dist < BALL_R + RIM_TUBE) {
    const inv = 1 / (dist || 1e-6);
    const ux = nx * inv;
    const uy = ny * inv;
    const uz = nz * inv;
    const vn = b.v.x * ux + b.v.y * uy + b.v.z * uz;
    if (vn < 0) {
      const e = 0.42;
      b.v.x -= (1 + e) * vn * ux;
      b.v.y -= (1 + e) * vn * uy;
      b.v.z -= (1 + e) * vn * uz;
      b.v.x *= 0.96;
      b.v.z *= 0.96;
    }
    const push = BALL_R + RIM_TUBE - dist + 1e-4;
    b.p.x += ux * push;
    b.p.y += uy * push;
    b.p.z += uz * push;
    b.rim = true;
    out.rim = true;
  }

  // through the hoop, moving down
  if (!b.scored && prevY > hoop.y && b.p.y <= hoop.y && b.v.y < 0 && Math.hypot(b.p.x - hoop.x, b.p.z - hoop.z) < hoop.r - BALL_R * 0.35) {
    b.scored = true;
    out.score = b.rim || b.board ? 'make' : 'swish';
  }

  // floor
  if (b.p.y - BALL_R < 0) {
    b.p.y = BALL_R;
    if (b.v.y < 0) {
      b.v.y = -b.v.y * 0.5;
      b.v.x *= 0.8;
      b.v.z *= 0.8;
      b.bounces++;
      out.floor = true;
    }
  }
  if (b.bounces >= 3 || b.t > MAX_FLIGHT || b.p.z < hoop.z - 4 || Math.abs(b.p.x) > 12 || b.p.z > 4) {
    b.live = false;
    out.dead = true;
  }
  return out;
}

export type Game = {
  round: number;
  timeLeft: number;
  makes: number;
  score: number;
  attempts: number;
  t: number;
  hoop: Hoop;
  ball: Ball;
  respawn: number;
  over: boolean;
  advanced: boolean;
};

export function create(): Game {
  return { round: 1, timeLeft: ROUND_SECONDS, makes: 0, score: 0, attempts: 0, t: 0, hoop: { x: 0, y: RIM_Y, z: HOOP_Z, r: RIM_R }, ball: makeBall(), respawn: 0, over: false, advanced: false };
}

export const canShoot = (g: Game) => !g.over && !g.ball.live && g.respawn <= 0;

export function fire(g: Game, aim: Aim) {
  if (!canShoot(g)) return false;
  shoot(g.ball, g.hoop, aim);
  g.attempts++;
  return true;
}

export type Tick = Contact & { roundUp?: boolean; over?: boolean; points?: number };

/** dt drives physics (clamped by the loop); clockDt is real elapsed time so the round clock stays honest on slow frames. */
export function stepGame(g: Game, dt: number, clockDt = dt): Tick {
  if (g.over) return {};
  g.t += dt;
  g.timeLeft -= clockDt;
  g.hoop.x = hoopX(g.round, g.t);
  const out: Tick = stepBall(g.ball, g.hoop, dt);
  if (out.score) {
    out.points = out.score === 'swish' ? 3 : 2;
    g.score += out.points;
    g.makes++;
  }
  if (out.dead) g.respawn = RESPAWN;
  else if (g.respawn > 0) g.respawn -= dt;
  if (g.timeLeft <= 0 && !g.ball.live) {
    if (g.makes >= targetFor(g.round)) {
      g.round++;
      g.makes = 0;
      g.timeLeft = ROUND_SECONDS;
      g.advanced = true;
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
