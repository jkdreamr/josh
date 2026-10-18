// Deterministic putting physics. Fixed 120 Hz steps; everything depends only on inputs and the hole tick.
import type { Hole, Mover, V } from './holes';

export const R = 0.14;
// A real cup is 4.25 in across for a 1.68 in ball, about 2.5 times the ball's radius.
export const CUP_R = 0.34;
export const STEP = 1 / 120;
export const MAX_TICKS = 120 * 25;
const ROLL = 1.05;
const DRAG = 0.18;
const GR = (9.8 * 5) / 7;
const REST_V = 0.06;
export const WALL_R = R + 0.07;
const ARM_R = R + 0.09;
const E = 0.72;
const WALL_T = 0.92;

export type Ball = {
  x: number;
  z: number;
  vx: number;
  vz: number;
  t: number;
  state: 'roll' | 'rest' | 'holed' | 'water';
  lip: boolean;
  loop: { s: number; vs: number } | null;
  safe: V;
};

export const restBall = (x: number, z: number, t = 0): Ball => ({ x, z, vx: 0, vz: 0, t, state: 'rest', lip: false, loop: null, safe: { x, z } });

// Power maps to how far the putt rolls on a flat green, so a short drag is a short putt.
export const DMAX = 16.5;
export const MIN_ROLL = 0.5;
const CUP_SLOW = 3.5;
const CUP_FAST = 5;

export const shotDistance = (power: number) => (power > 0 ? Math.max(MIN_ROLL, Math.min(1, power) * DMAX) : 0);

// Flat roll from speed v under dv/dt = -(ROLL + DRAG v).
export const rollDistance = (v: number) => (v - (ROLL / DRAG) * Math.log(1 + (DRAG * v) / ROLL)) / DRAG;

export function shotSpeed(power: number) {
  const d = shotDistance(power);
  if (!d) return 0;
  let lo = 0;
  let hi = 16;
  for (let i = 0; i < 40; i++) {
    const v = (lo + hi) / 2;
    if (rollDistance(v) < d) lo = v;
    else hi = v;
  }
  return (lo + hi) / 2;
}

const smooth = (a: number, b: number, v: number) => {
  const k = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return k * k * (3 - 2 * k);
};

export function pondK(h: Hole, x: number, z: number) {
  let best = Infinity;
  for (const p of h.ponds) best = Math.min(best, Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz));
  return best;
}

export function height(h: Hole, x: number, z: number) {
  let y = 0;
  for (const g of h.ground) {
    if (g.k === 'tilt') y += g.gx * x + g.gz * z;
    else if (g.k === 'hill') {
      const d = Math.hypot(x - g.x, z - g.z);
      if (d < g.r) y += g.h * (0.5 + 0.5 * Math.cos((Math.PI * d) / g.r));
    } else {
      const u = g.axis === 'x' ? x : z;
      const l = g.axis === 'x' ? z : x;
      if (l >= g.l0 - 0.3 && l <= g.l1 + 0.3) y += g.h0 + (g.h1 - g.h0) * smooth(0, 1, (u - g.u0) / (g.u1 - g.u0));
    }
  }
  for (const p of h.ponds) {
    const k = Math.hypot((x - p.x) / p.rx, (z - p.z) / p.rz);
    y -= p.depth * (1 - smooth(0.82, 1.18, k));
  }
  const dc = Math.hypot(x - h.cup.x, z - h.cup.z);
  if (dc < 0.55) y -= 0.025 * (1 - dc / 0.55) ** 2;
  return y;
}

export function grad(h: Hole, x: number, z: number) {
  const e = 0.02;
  return {
    gx: (height(h, x + e, z) - height(h, x - e, z)) / (2 * e),
    gz: (height(h, x, z + e) - height(h, x, z - e)) / (2 * e),
  };
}

export function inside(poly: V[], x: number, z: number) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.z > z !== b.z > z && x < ((b.x - a.x) * (z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

export type Seg = { ax: number; az: number; bx: number; bz: number };
const segCache = new WeakMap<Hole, Seg[]>();
export function segments(h: Hole): Seg[] {
  let s = segCache.get(h);
  if (s) return s;
  s = [];
  const o = h.outline;
  for (let i = 0; i < o.length; i++) {
    const a = o[i];
    const b = o[(i + 1) % o.length];
    s.push({ ax: a.x, az: a.z, bx: b.x, bz: b.z });
  }
  for (const w of h.walls) for (let i = 0; i + 1 < w.length; i++) s.push({ ax: w[i].x, az: w[i].z, bx: w[i + 1].x, bz: w[i + 1].z });
  segCache.set(h, s);
  return s;
}

export function closestOnSeg(s: Seg, x: number, z: number) {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const L = dx * dx + dz * dz || 1;
  const k = Math.min(1, Math.max(0, ((x - s.ax) * dx + (z - s.az) * dz) / L));
  return { x: s.ax + dx * k, z: s.az + dz * k };
}

export function sweepAngle(m: Extract<Mover, { k: 'sweep' }>, t: number) {
  return m.ph + m.w * t * STEP;
}

export function slidePos(m: Extract<Mover, { k: 'slide' }>, t: number) {
  const f = 0.5 - 0.5 * Math.cos((Math.PI * 2 * t * STEP) / m.period + m.ph);
  const df = ((0.5 * Math.PI * 2) / m.period) * Math.sin((Math.PI * 2 * t * STEP) / m.period + m.ph);
  return { x: m.ax + (m.bx - m.ax) * f, z: m.az + (m.bz - m.az) * f, vx: (m.bx - m.ax) * df, vz: (m.bz - m.az) * df };
}

function bounce(b: Ball, nx: number, nz: number, sx = 0, sz = 0, e = E) {
  const rvx = b.vx - sx;
  const rvz = b.vz - sz;
  const vn = rvx * nx + rvz * nz;
  if (vn >= 0) return false;
  const tx = rvx - vn * nx;
  const tz = rvz - vn * nz;
  b.vx = sx + tx * WALL_T - vn * e * nx;
  b.vz = sz + tz * WALL_T - vn * e * nz;
  return true;
}

// Returns a hit strength (0 when no contact) so the renderer can play a click.
function collide(h: Hole, b: Ball): number {
  let hit = 0;
  for (const s of segments(h)) {
    const c = closestOnSeg(s, b.x, b.z);
    const dx = b.x - c.x;
    const dz = b.z - c.z;
    const d = Math.hypot(dx, dz);
    if (d < WALL_R && d > 1e-9) {
      const nx = dx / d;
      const nz = dz / d;
      b.x = c.x + nx * WALL_R;
      b.z = c.z + nz * WALL_R;
      const v = -(b.vx * nx + b.vz * nz);
      if (bounce(b, nx, nz)) hit = Math.max(hit, v);
    }
  }
  for (const p of h.posts) {
    const dx = b.x - p.x;
    const dz = b.z - p.z;
    const d = Math.hypot(dx, dz);
    const rr = p.r + R;
    if (d < rr && d > 1e-9) {
      const nx = dx / d;
      const nz = dz / d;
      b.x = p.x + nx * rr;
      b.z = p.z + nz * rr;
      const v = -(b.vx * nx + b.vz * nz);
      if (bounce(b, nx, nz)) hit = Math.max(hit, v);
    }
  }
  for (const m of h.movers) {
    if (m.k === 'sweep') {
      const a0 = sweepAngle(m, b.t);
      for (let i = 0; i < m.arms; i++) {
        const a = a0 + (i * Math.PI * 2) / m.arms;
        const s = { ax: m.x, az: m.z, bx: m.x + Math.cos(a) * m.len, bz: m.z + Math.sin(a) * m.len };
        const c = closestOnSeg(s, b.x, b.z);
        const dx = b.x - c.x;
        const dz = b.z - c.z;
        const d = Math.hypot(dx, dz);
        if (d < ARM_R && d > 1e-9) {
          const nx = dx / d;
          const nz = dz / d;
          b.x = c.x + nx * ARM_R;
          b.z = c.z + nz * ARM_R;
          const sx = -m.w * (c.z - m.z);
          const sz = m.w * (c.x - m.x);
          const v = -((b.vx - sx) * nx + (b.vz - sz) * nz);
          if (bounce(b, nx, nz, sx, sz, 0.6)) hit = Math.max(hit, v);
        }
      }
    } else {
      const q = slidePos(m, b.t);
      const cx = Math.min(q.x + m.hx, Math.max(q.x - m.hx, b.x));
      const cz = Math.min(q.z + m.hz, Math.max(q.z - m.hz, b.z));
      let dx = b.x - cx;
      let dz = b.z - cz;
      let d = Math.hypot(dx, dz);
      if (d < 1e-9) {
        // Center inside the block: push out along the shortest axis.
        const ox = m.hx - Math.abs(b.x - q.x);
        const oz = m.hz - Math.abs(b.z - q.z);
        if (ox < oz) {
          dx = Math.sign(b.x - q.x) || 1;
          dz = 0;
        } else {
          dz = Math.sign(b.z - q.z) || 1;
          dx = 0;
        }
        d = 1;
        b.x = dx ? q.x + dx * (m.hx + R) : b.x;
        b.z = dz ? q.z + dz * (m.hz + R) : b.z;
        bounce(b, dx, dz, q.vx, q.vz, 0.6);
        hit = Math.max(hit, 1);
      } else if (d < R) {
        const nx = dx / d;
        const nz = dz / d;
        b.x = cx + nx * R;
        b.z = cz + nz * R;
        const v = -((b.vx - q.vx) * nx + (b.vz - q.vz) * nz);
        if (bounce(b, nx, nz, q.vx, q.vz, 0.6)) hit = Math.max(hit, v);
      }
    }
  }
  return hit;
}

function moverZoneNudge(h: Hole, b: Ball): boolean {
  for (const m of h.movers) {
    if (m.k === 'sweep') {
      const dx = b.x - m.x;
      const dz = b.z - m.z;
      const d = Math.hypot(dx, dz) || 1;
      if (d < m.len + ARM_R) {
        b.vx = (dx / d) * 0.9;
        b.vz = (dz / d) * 0.9;
        return true;
      }
    } else {
      const ux = m.bx - m.ax;
      const uz = m.bz - m.az;
      const L = Math.hypot(ux, uz) || 1;
      const cx = (m.ax + m.bx) / 2;
      const cz = (m.az + m.bz) / 2;
      const along = Math.abs(((b.x - cx) * ux + (b.z - cz) * uz) / L);
      const nx = -uz / L;
      const nz = ux / L;
      const across = (b.x - cx) * nx + (b.z - cz) * nz;
      const ha = L / 2 + Math.abs((ux / L) * m.hx) + Math.abs((uz / L) * m.hz) + R;
      const hc = Math.abs(nx * m.hx) + Math.abs(nz * m.hz) + R;
      if (along < ha && Math.abs(across) < hc) {
        const s = across >= 0 ? 1 : -1;
        b.vx = nx * s * 0.9;
        b.vz = nz * s * 0.9;
        return true;
      }
    }
  }
  return false;
}

export type StepEvent = { hit: number; cup: boolean; water: boolean; lip: boolean };

export function step(h: Hole, b: Ball): StepEvent {
  const ev: StepEvent = { hit: 0, cup: false, water: false, lip: false };
  if (b.state !== 'roll') return ev;
  b.t++;
  const L = h.loop;
  if (b.loop && L) {
    const lp = b.loop;
    const th = lp.s / L.r;
    const dir = Math.sign(lp.vs) || 1;
    lp.vs -= (GR * Math.sin(th) + dir * (ROLL + DRAG * Math.abs(lp.vs))) * STEP;
    lp.s += lp.vs * STEP;
    const dx = Math.cos(L.a);
    const dz = Math.sin(L.a);
    const nThe = lp.s / L.r;
    if ((lp.vs * lp.vs) / L.r + GR * Math.cos(nThe) < 0 && nThe > Math.PI / 2 && nThe < (Math.PI * 3) / 2) {
      // Not enough speed: it drops off and rolls back out the entry.
      const back = Math.sqrt(2 * GR * L.r * (1 - Math.cos(nThe))) * 0.55;
      b.loop = null;
      b.x = L.x - dx * 0.02;
      b.z = L.z - dz * 0.02;
      b.vx = -dx * back;
      b.vz = -dz * back;
      ev.hit = 1.2;
    } else if (lp.s <= 0) {
      b.loop = null;
      b.x = L.x - dx * 0.02;
      b.z = L.z - dz * 0.02;
      b.vx = dx * Math.min(0, lp.vs);
      b.vz = dz * Math.min(0, lp.vs);
    } else if (lp.s >= Math.PI * 2 * L.r) {
      b.loop = null;
      b.x = L.x + dx * 0.02;
      b.z = L.z + dz * 0.02;
      b.vx = dx * lp.vs;
      b.vz = dz * lp.vs;
    }
    return ev;
  }
  const g = grad(h, b.x, b.z);
  let sp = Math.hypot(b.vx, b.vz);
  b.vx -= GR * g.gx * STEP;
  b.vz -= GR * g.gz * STEP;
  if (sp > 0) {
    const dec = Math.min(sp, (ROLL + DRAG * sp) * STEP);
    b.vx -= (b.vx / sp) * dec;
    b.vz -= (b.vz / sp) * dec;
  }
  const px = b.x;
  const pz = b.z;
  b.x += b.vx * STEP;
  b.z += b.vz * STEP;
  if (L) {
    const dx = Math.cos(L.a);
    const dz = Math.sin(L.a);
    const u0 = (px - L.x) * dx + (pz - L.z) * dz;
    const u1 = (b.x - L.x) * dx + (b.z - L.z) * dz;
    const l = -(b.x - L.x) * dz + (b.z - L.z) * dx;
    const vf = b.vx * dx + b.vz * dz;
    if (u0 < 0 && u1 >= 0 && Math.abs(l) <= L.w && vf > 0) {
      b.loop = { s: 0.001, vs: vf };
      b.x = L.x + -dz * l;
      b.z = L.z + dx * l;
      return ev;
    }
  }
  ev.hit = collide(h, b);
  if (inside(h.outline, b.x, b.z)) b.safe = { x: b.x, z: b.z };
  else {
    b.x = b.safe.x;
    b.z = b.safe.z;
    b.vx *= -0.3;
    b.vz *= -0.3;
  }
  if (h.ponds.length && pondK(h, b.x, b.z) < 1) {
    b.state = 'water';
    b.vx = b.vz = 0;
    ev.water = true;
    return ev;
  }
  sp = Math.hypot(b.vx, b.vz);
  const dc = Math.hypot(b.x - h.cup.x, b.z - h.cup.z);
  if (dc < CUP_R) {
    // Drops when it arrives slowly, or runs close to the middle at a firm pace; anything quicker rides over and lips out.
    if ((!b.lip && sp < CUP_SLOW) || (dc < CUP_R * 0.5 && sp < CUP_FAST) || sp < 1) {
      b.state = 'holed';
      b.x = h.cup.x;
      b.z = h.cup.z;
      b.vx = b.vz = 0;
      ev.cup = true;
      return ev;
    }
    b.lip = true;
  } else if (b.lip) {
    b.lip = false;
    ev.lip = true;
    const cross = ((b.x - h.cup.x) * b.vz - (b.z - h.cup.z) * b.vx) / (sp * CUP_R || 1);
    const a = Math.max(-0.6, Math.min(0.6, cross * 0.5));
    const c = Math.cos(a);
    const s = Math.sin(a);
    const vx = (b.vx * c - b.vz * s) * 0.82;
    b.vz = (b.vx * s + b.vz * c) * 0.82;
    b.vx = vx;
  }
  if (sp < REST_V) {
    const g2 = grad(h, b.x, b.z);
    if (GR * Math.hypot(g2.gx, g2.gz) < ROLL) {
      if (moverZoneNudge(h, b)) return ev;
      b.vx = b.vz = 0;
      b.state = 'rest';
    }
  }
  return ev;
}

export function strike(b: Ball, angle: number, power: number, t: number): Ball {
  const v = shotSpeed(power);
  return { ...b, safe: { ...b.safe }, loop: null, lip: false, t, state: 'roll', vx: Math.cos(angle) * v, vz: Math.sin(angle) * v };
}

export function simulate(h: Hole, b0: Ball, maxTicks = MAX_TICKS, path?: V[], every = 6): Ball {
  const b: Ball = { ...b0, safe: { ...b0.safe }, loop: b0.loop ? { ...b0.loop } : null };
  const end = b.t + maxTicks;
  let n = 0;
  while (b.state === 'roll' && b.t < end) {
    step(h, b);
    if (path && n++ % every === 0) path.push({ x: b.x, z: b.z });
  }
  if (b.state === 'roll') {
    b.state = 'rest';
    b.loop = null;
    b.x = b.safe.x;
    b.z = b.safe.z;
    b.vx = b.vz = 0;
  }
  return b;
}

// World position of a ball for rendering, including the loop.
export function ballPos(h: Hole, b: Ball) {
  const L = h.loop;
  if (b.loop && L) {
    const th = b.loop.s / L.r;
    const dx = Math.cos(L.a);
    const dz = Math.sin(L.a);
    const u = Math.sin(th) * (L.r - R);
    return { x: b.x + dx * u, y: (L.r - R) * (1 - Math.cos(th)) + R, z: b.z + dz * u };
  }
  const y = b.state === 'holed' ? -0.12 : b.state === 'water' ? height(h, b.x, b.z) - 0.1 : height(h, b.x, b.z) + R;
  return { x: b.x, y, z: b.z };
}
