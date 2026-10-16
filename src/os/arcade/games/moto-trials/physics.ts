// Bike physics for Moto Trials. Pure and deterministic: no DOM, no randomness, fixed substeps.
//
// The bike is a rigid chassis plus two wheels. Each wheel is a point mass tied to a chassis anchor
// by a damped spring (soft along the chassis down axis, very stiff sideways, which is the fork and
// swingarm). Wheels collide with one-sided terrain segments: only the front face of a segment is
// solid, so the bike can pass under arcs and pop out through the bottom of a loop once it is off.
//
// Wheel spin is a real state: gas drives the rear wheel's spin toward a top speed and the contact
// friction turns slip into forward force, so traction, wheelies off the line and landing spin-up all
// come out of the same rule. Brake damps both wheels hard and creeps backwards if held at a stop.

export type Vec = { x: number; y: number };

/** One-sided terrain segment from (ax,ay) to (bx,by); nx,ny is the unit normal left of a->b. */
export type Seg = {
  ax: number;
  ay: number;
  bx: number;
  by: number;
  nx: number;
  ny: number;
  len: number;
  /** Loop gate: 'in' climbs the far side, 'out' descends the near side (see levels.ts). */
  gate?: { loop: number; half: 'in' | 'out' };
  /** Drawing hint ('wood' | 'metal'); physics treats them all the same. */
  kind?: string;
};

/** A spinning blade; touching it with any part of the bike is a crash. */
export type Saw = { x: number; y: number; r: number };

export type LoopGate = {
  cx: number;
  cy: number;
  r: number;
  /** Right edge of the circle, used to know when the bike has cleared the loop. */
  right: number;
  phase: 'approach' | 'over' | 'leaving';
};

export type PhysWorld = {
  segs: Seg[];
  saws: Saw[];
  loops: LoopGate[];
  killY: number;
  /** Segment index by 4 m column for cheap queries. */
  grid: Map<number, number[]>;
};

export type Wheel = {
  p: Vec;
  v: Vec;
  /** Wheel spin in rad/s. Negative spins the bike forward (rolling +x). */
  spin: number;
  /** Visual rotation, integrates spin; draw reads this. */
  rot: number;
  /** Touched terrain this step. */
  on: boolean;
};

export type Bike = {
  p: Vec;
  v: Vec;
  a: number;
  w: number;
  fw: Wheel;
  rw: Wheel;
  crashed: boolean;
};

export type Input = { gas: number; brake: number; lean: number };
/** lean > 0 leans forward (right key), lean < 0 leans back (left key). */

export type StepHits = {
  /** Head touched a segment face. */
  head: boolean;
  /** Any part touched a saw. */
  saw: boolean;
  /** Chassis fell below killY. */
  fell: boolean;
};

// Tuning -----------------------------------------------------------------------------------------------------------

export const WHEEL_R = 0.34;
export const WHEELBASE = 1.25;
/** Anchor points on the chassis where the forks hang. */
const ANCHOR_F = { x: WHEELBASE / 2, y: -0.02 };
const ANCHOR_R = { x: -WHEELBASE / 2, y: -0.02 };
/** Rest distance from anchor to wheel center. */
const SUS_LEN = 0.4;
/** Rider head, local to the chassis. */
export const HEAD = { x: 0.14, y: 0.66 };
export const HEAD_R = 0.2;

const MASS = 58;
const INERTIA = 6.5;
const WHEEL_M = 6;
const WHEEL_I = WHEEL_M * WHEEL_R * WHEEL_R;
const G = 11;
const SUB = 1 / 240;

const K_SUS = 11000;
const C_SUS = 560;
const K_LAT = 26000;
const C_LAT = 400;

export const TOP_SPEED = 14.5;
const MOTOR_ACC = 340;
const BRAKE_DAMP = 14;
const ROLL_DAMP = 0.35;
const REST = 0.12;
const MU = 1.05;

/** Lean torque (N*m), stronger and freer in the air so a flip takes about a second of held lean. */
const T_LEAN_GROUND = 95;
const T_LEAN_AIR = 80;
const DAMP_W_GROUND = 4.5;
const DAMP_W_AIR = 1.5;

export function buildWorld(segs: Seg[], saws: Saw[], loops: LoopGate[], killY: number): PhysWorld {
  const grid = new Map<number, number[]>();
  segs.forEach((s, i) => {
    const a = Math.floor(Math.min(s.ax, s.bx) / 4) - 1;
    const b = Math.floor(Math.max(s.ax, s.bx) / 4) + 1;
    for (let g = a; g <= b; g++) {
      const list = grid.get(g);
      if (list) list.push(i);
      else grid.set(g, [i]);
    }
  });
  return { segs, saws, loops, killY, grid };
}

/** Segment ids that could touch a circle at x with radius pad. */
function segsNear(world: PhysWorld, x: number, pad: number): number[] {
  const a = Math.floor((x - pad) / 4);
  const b = Math.floor((x + pad) / 4);
  const out: number[] = [];
  for (let g = a; g <= b; g++) {
    const list = world.grid.get(g);
    if (list) for (const i of list) out.push(i);
  }
  return out;
}

const gateOn = (loop: LoopGate | undefined, half: 'in' | 'out') =>
  !loop || loop.phase === 'over' || (loop.phase === 'approach' && half === 'in') || (loop.phase === 'leaving' && half === 'out');

export function segActive(world: PhysWorld, s: Seg): boolean {
  return !s.gate || gateOn(world.loops[s.gate.loop], s.gate.half);
}

export function newBike(x: number, y: number): Bike {
  return {
    p: { x, y },
    v: { x: 0, y: 0 },
    a: 0,
    w: 0,
    fw: { p: { x: x + ANCHOR_F.x, y: y + ANCHOR_F.y - SUS_LEN }, v: { x: 0, y: 0 }, spin: 0, rot: 0, on: false },
    rw: { p: { x: x + ANCHOR_R.x, y: y + ANCHOR_R.y - SUS_LEN }, v: { x: 0, y: 0 }, spin: 0, rot: 0, on: false },
    crashed: false,
  };
}

export const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Updates loop gates from the bike position. Call once per frame, not per substep. */
export function updateLoops(world: PhysWorld, bike: Bike) {
  for (const l of world.loops) {
    const dx = bike.p.x - l.cx;
    const dy = bike.p.y - l.cy;
    const inside = dx * dx + dy * dy < (l.r + 1.6) * (l.r + 1.6);
    switch (l.phase) {
      case 'approach':
        // crossed above the centre while inside the ring: now committed, both halves solid
        if (inside && dy > 0) l.phase = 'over';
        break;
      case 'over':
        // back at the bottom still moving forward: drop the entry arc so we can ride out
        if (dy < -(l.r - 1.4) && bike.v.x > 1) l.phase = 'leaving';
        else if (dx < -(l.r + 1)) l.phase = 'approach';
        break;
      case 'leaving':
        if (bike.p.x > l.right + 1) l.phase = 'approach';
        else if (dx < -(l.r + 1)) l.phase = 'approach';
        break;
    }
  }
}

function localDelta(bike: Bike, wp: Vec, anchor: Vec) {
  const c = Math.cos(bike.a);
  const s = Math.sin(bike.a);
  // anchor in world space
  const ax = bike.p.x + anchor.x * c - anchor.y * s;
  const ay = bike.p.y + anchor.x * s + anchor.y * c;
  const dx = wp.x - ax;
  const dy = wp.y - ay;
  return { lx: dx * c + dy * s, ly: -dx * s + dy * c, ax, ay };
}

/** One collision resolution pass for a wheel. Returns the normal impulse applied. */
function collideWheel(world: PhysWorld, wh: Wheel): void {
  wh.on = false;
  for (const i of segsNear(world, wh.p.x, WHEEL_R + 0.3)) {
    const s = world.segs[i];
    if (!segActive(world, s)) continue;
    const tx = s.bx - s.ax;
    const ty = s.by - s.ay;
    const ux = tx / s.len;
    const uy = ty / s.len;
    const relx = wh.p.x - s.ax;
    const rely = wh.p.y - s.ay;
    const front = relx * s.nx + rely * s.ny;
    if (front <= -0.06) continue; // behind the face: passes through
    const t = Math.max(0, Math.min(s.len, relx * ux + rely * uy));
    const cpx = s.ax + ux * t;
    const cpy = s.ay + uy * t;
    let nx = wh.p.x - cpx;
    let ny = wh.p.y - cpy;
    let d = Math.hypot(nx, ny);
    if (d >= WHEEL_R || d < 1e-9) {
      if (d <= 1e-9 && front > 0 && front < WHEEL_R) {
        nx = s.nx;
        ny = s.ny;
        d = front;
      } else continue;
    } else {
      nx /= d;
      ny /= d;
      // endpoint caps only push on the face side
      if (nx * s.nx + ny * s.ny < 0) continue;
    }
    wh.on = true;
    // position correction
    const pen = WHEEL_R - d;
    wh.p.x += nx * pen;
    wh.p.y += ny * pen;
    // normal impulse with a little restitution
    const vn = wh.v.x * nx + wh.v.y * ny;
    let jn = 0;
    if (vn < 0) {
      jn = -(1 + REST) * vn * WHEEL_M;
      wh.v.x -= nx * vn * (1 + REST);
      wh.v.y -= ny * vn * (1 + REST);
    }
    // friction couples the surface slip to wheel spin; this is what motor torque pushes against.
    // t points along the face in the +x sense: a wheel rolling right spins negative (clockwise).
    const tvx = ny;
    const tvy = -nx;
    const slip = wh.v.x * tvx + wh.v.y * tvy + wh.spin * WHEEL_R;
    const grip = MU * Math.max(jn, WHEEL_M * G * 0.8);
    const jt = Math.max(-grip, Math.min(grip, -slip / (1 / WHEEL_M + (WHEEL_R * WHEEL_R) / WHEEL_I)));
    wh.v.x += tvx * (jt / WHEEL_M);
    wh.v.y += tvy * (jt / WHEEL_M);
    wh.spin += (jt * WHEEL_R) / WHEEL_I;
  }
}

function substep(bike: Bike, world: PhysWorld, input: Input, h: number) {
  // springs between chassis anchors and wheels
  for (const [wh, anchor] of [
    [bike.rw, ANCHOR_R],
    [bike.fw, ANCHOR_F],
  ] as const) {
    const { lx, ly, ax, ay } = localDelta(bike, wh.p, anchor);
    const c = Math.cos(bike.a);
    const s = Math.sin(bike.a);
    // velocity of the wheel relative to the anchor point, in chassis space
    const rx = ax - bike.p.x;
    const ry = ay - bike.p.y;
    const vax = bike.v.x - bike.w * ry;
    const vay = bike.v.y + bike.w * rx;
    const dvx = (wh.v.x - vax) * c + (wh.v.y - vay) * s;
    const dvy = -(wh.v.x - vax) * s + (wh.v.y - vay) * c;
    const flx = -K_LAT * lx - C_LAT * dvx;
    const fly = -K_SUS * (ly + SUS_LEN) - C_SUS * dvy;
    // back to world space
    const fx = flx * c - fly * s;
    const fy = flx * s + fly * c;
    wh.v.x += (fx / WHEEL_M) * h;
    wh.v.y += (fy / WHEEL_M) * h;
    bike.v.x += (-fx / MASS) * h;
    bike.v.y += (-fy / MASS) * h;
    bike.w += ((rx * -fy - ry * -fx) / INERTIA) * h;
  }

  const air = !bike.fw.on && !bike.rw.on;
  // lean: input >0 is forward (clockwise, negative w)
  const tq = -input.lean * (air ? T_LEAN_AIR : T_LEAN_GROUND);
  bike.w += (tq / INERTIA) * h;
  bike.w -= bike.w * (air ? DAMP_W_AIR : DAMP_W_GROUND) * h;

  // drive and brakes on wheel spin
  for (const [wh, rear] of [
    [bike.rw, true],
    [bike.fw, false],
  ] as const) {
    if (input.gas > 0 && rear) {
      const target = -(TOP_SPEED * input.gas) / WHEEL_R;
      const d = Math.max(-MOTOR_ACC * h, Math.min(MOTOR_ACC * h, target - wh.spin));
      wh.spin += d;
    }
    if (input.brake > 0) {
      wh.spin *= Math.max(0, 1 - BRAKE_DAMP * input.brake * h);
      // creep backwards when held at a stop
      const speed = Math.hypot(bike.v.x, bike.v.y);
      if (rear && speed < 0.6 && input.gas <= 0) {
        const target = 2.4 / WHEEL_R;
        wh.spin += Math.max(-14 * h, Math.min(14 * h, target - wh.spin));
      }
    }
    wh.spin *= Math.max(0, 1 - ROLL_DAMP * h);
  }

  // gravity
  bike.v.y -= G * h;
  bike.fw.v.y -= G * h;
  bike.rw.v.y -= G * h;

  // integrate
  bike.p.x += bike.v.x * h;
  bike.p.y += bike.v.y * h;
  bike.a = wrapAngle(bike.a + bike.w * h);
  for (const wh of [bike.fw, bike.rw]) {
    wh.p.x += wh.v.x * h;
    wh.p.y += wh.v.y * h;
    wh.rot += wh.spin * h;
  }

  // contacts (two passes settle stacked wheels)
  collideWheel(world, bike.rw);
  collideWheel(world, bike.fw);
}

/** Advances the bike by dt seconds. Returns what hit this step (crash checks live in logic.ts). */
export function step(bike: Bike, world: PhysWorld, input: Input, dt: number): StepHits {
  const hits = { head: false, saw: false, fell: false };
  let acc = dt;
  while (acc > 1e-9) {
    const h = Math.min(SUB, acc);
    acc -= h;
    substep(bike, world, input, h);
  }
  updateLoops(world, bike);

  // head against any segment face
  const c = Math.cos(bike.a);
  const s = Math.sin(bike.a);
  const hx = bike.p.x + HEAD.x * c - HEAD.y * s;
  const hy = bike.p.y + HEAD.x * s + HEAD.y * c;
  for (const i of segsNear(world, hx, HEAD_R + 0.2)) {
    const sg = world.segs[i];
    if (!segActive(world, sg)) continue;
    const relx = hx - sg.ax;
    const rely = hy - sg.ay;
    if (relx * sg.nx + rely * sg.ny <= -0.02) continue;
    const ux = (sg.bx - sg.ax) / sg.len;
    const uy = (sg.by - sg.ay) / sg.len;
    const t = Math.max(0, Math.min(sg.len, relx * ux + rely * uy));
    const dx = hx - (sg.ax + ux * t);
    const dy = hy - (sg.ay + uy * t);
    if (dx * dx + dy * dy < HEAD_R * HEAD_R) {
      hits.head = true;
      break;
    }
  }
  // saws touch any of head, chassis or wheels
  for (const saw of world.saws) {
    for (const p of [
      { x: hx, y: hy },
      bike.p,
      bike.fw.p,
      bike.rw.p,
    ]) {
      const dx = p.x - saw.x;
      const dy = p.y - saw.y;
      if (dx * dx + dy * dy < (saw.r + 0.25) * (saw.r + 0.25)) {
        hits.saw = true;
        break;
      }
    }
  }
  if (bike.p.y < world.killY || bike.fw.p.y < world.killY || bike.rw.p.y < world.killY) hits.fell = true;
  return hits;
}

/** Highest terrain face under x, for spawns, autopilot lookahead and the camera floor. */
export function groundAt(world: PhysWorld, x: number): number | null {
  let best: number | null = null;
  for (const i of segsNear(world, x, 0.4)) {
    const s = world.segs[i];
    if (!segActive(world, s)) continue;
    const ux = (s.bx - s.ax) / s.len;
    const uy = (s.by - s.ay) / s.len;
    const t = (x - s.ax) * ux + (0 - s.ay) * uy;
    if (t < -0.05 || t > s.len + 0.05) continue;
    const y = s.ay + uy * Math.max(0, Math.min(s.len, t));
    if (best === null || y > best) best = y;
  }
  return best;
}
