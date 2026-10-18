// Computer golfers: a walking-distance field to the cup plus a sampled putt search with human-sized error.
import type { Hole } from './holes';
import { type Ball, R, WALL_R, closestOnSeg, inside, pondK, segments, simulate, strike } from './physics.ts';

export type Level = 'easy' | 'normal' | 'hard';
export const LEVELS: Level[] = ['easy', 'normal', 'hard'];

const CELL = 0.15;
type Field = { x0: number; z0: number; nx: number; nz: number; d: Float32Array };
const fields = new WeakMap<Hole, Field>();

function clear(h: Hole, x: number, z: number) {
  if (!inside(h.outline, x, z)) return false;
  for (const s of segments(h)) {
    const c = closestOnSeg(s, x, z);
    if (Math.hypot(x - c.x, z - c.z) < WALL_R * 0.9) return false;
  }
  for (const p of h.posts) if (Math.hypot(x - p.x, z - p.z) < p.r + R * 0.9) return false;
  if (h.ponds.length && pondK(h, x, z) < 1.05) return false;
  return true;
}

export function field(h: Hole): Field {
  const hit = fields.get(h);
  if (hit) return hit;
  let x0 = Infinity;
  let z0 = Infinity;
  let x1 = -Infinity;
  let z1 = -Infinity;
  for (const v of h.outline) {
    x0 = Math.min(x0, v.x);
    z0 = Math.min(z0, v.z);
    x1 = Math.max(x1, v.x);
    z1 = Math.max(z1, v.z);
  }
  const nx = Math.ceil((x1 - x0) / CELL) + 1;
  const nz = Math.ceil((z1 - z0) / CELL) + 1;
  const d = new Float32Array(nx * nz).fill(Infinity);
  const ok = new Uint8Array(nx * nz);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) ok[j * nx + i] = clear(h, x0 + i * CELL, z0 + j * CELL) ? 1 : 0;
  const ci = Math.round((h.cup.x - x0) / CELL);
  const cj = Math.round((h.cup.z - z0) / CELL);
  const start = cj * nx + ci;
  d[start] = 0;
  // Small grids, so a simple bucketless Dijkstra over a sorted frontier is fine.
  const open: number[] = [start];
  const N = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
  while (open.length) {
    let bi = 0;
    for (let k = 1; k < open.length; k++) if (d[open[k]] < d[open[bi]]) bi = k;
    const c = open[bi];
    open[bi] = open[open.length - 1];
    open.pop();
    const i = c % nx;
    const j = (c - i) / nx;
    for (const [di, dj, w] of N) {
      const a = i + di;
      const b = j + dj;
      if (a < 0 || b < 0 || a >= nx || b >= nz) continue;
      const n = b * nx + a;
      if (!ok[n]) continue;
      const v = d[c] + w * CELL;
      if (v < d[n]) {
        if (d[n] === Infinity) open.push(n);
        d[n] = v;
      }
    }
  }
  const f = { x0, z0, nx, nz, d };
  fields.set(h, f);
  return f;
}

export function distTo(h: Hole, x: number, z: number) {
  const f = field(h);
  const i = Math.round((x - f.x0) / CELL);
  const j = Math.round((z - f.z0) / CELL);
  let best = Infinity;
  for (let r = 0; r <= 3 && best === Infinity; r++)
    for (let b = j - r; b <= j + r; b++)
      for (let a = i - r; a <= i + r; a++) {
        if (a < 0 || b < 0 || a >= f.nx || b >= f.nz) continue;
        const v = f.d[b * f.nx + a];
        if (v < Infinity) best = Math.min(best, v + Math.hypot((a - i) * CELL, (b - j) * CELL));
      }
  return best === Infinity ? 50 : best;
}

export type Plan = { angle: number; power: number };

export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const NOISE: Record<Level, { a: number; p: number; pick: number }> = {
  easy: { a: 0.21, p: 0.48, pick: 4 },
  normal: { a: 0.13, p: 0.3, pick: 3 },
  hard: { a: 0.09, p: 0.2, pick: 2 },
};

function score(h: Hole, from: Ball, end: Ball) {
  if (end.state === 'holed') return -100;
  if (end.state === 'water') return 50 + distTo(h, from.x, from.z);
  return distTo(h, end.x, end.z);
}

// A generator so the search can be spread across frames. `t` is the hole tick the putt will be struck on.
export function* planner(h: Hole, ball: Ball, t: number, level: Level, seed: number): Generator<void, Plan, void> {
  const rand = rng(seed);
  const base = Math.atan2(h.cup.z - ball.z, h.cup.x - ball.x);
  const tried: { s: number; a: number; p: number }[] = [];
  // People putt at the hole and lag it close; banks and blasts are a last resort.
  const human = (a: number, p: number) => {
    const dev = Math.abs(Math.atan2(Math.sin(a - base), Math.cos(a - base)));
    return dev * 1.2 + p * 0.6;
  };
  const A = 56;
  const powers = [0.06, 0.1, 0.15, 0.22, 0.3, 0.38, 0.47, 0.57, 0.68, 0.8, 0.92, 1];
  for (let i = 0; i < A; i++) {
    const a = base + ((i / A) * 2 - 1) * Math.PI;
    for (const p of powers) tried.push({ s: score(h, ball, simulate(h, strike(ball, a, p, t))) + human(a, p), a, p });
    yield;
  }
  tried.sort((x, y) => x.s - y.s);
  // Refine around the best few, then pick with skill-dependent slop.
  const top = tried.slice(0, 4);
  for (const c of top) {
    for (let k = 0; k < 10; k++) {
      const a = c.a + (rand() - 0.5) * 0.08;
      const p = Math.min(1, Math.max(0.04, c.p + (rand() - 0.5) * 0.06));
      tried.push({ s: score(h, ball, simulate(h, strike(ball, a, p, t))) + human(a, p), a, p });
    }
    yield;
  }
  tried.sort((x, y) => x.s - y.s);
  const n = NOISE[level];
  const pick = tried[Math.min(tried.length - 1, Math.floor(rand() * n.pick))];
  const gauss = () => (rand() + rand() + rand() - 1.5) / 0.5;
  // Near-full putts are easy to max out by hand, so they wobble less.
  const slop = pick.p > 0.88 ? 0.25 : 1;
  return { angle: pick.a + gauss() * n.a, power: Math.min(1, Math.max(0.04, pick.p * (1 + gauss() * n.p * slop))) };
}

export function planNow(h: Hole, ball: Ball, t: number, level: Level, seed: number): Plan {
  const g = planner(h, ball, t, level, seed);
  for (;;) {
    const r = g.next();
    if (r.done) return r.value;
  }
}
