// Path finding for the bots: a 2 m grid over the arena marking where a body fits and can walk (no cliffs, deep water,
// walls, crates, trunks or rocks), searched with A* and smoothed into a few straight legs.
import { clamp } from './noise.ts';
import { blockedAt } from './physics.ts';
import { floorAt, heightAt } from './terrain.ts';
import { ARENA, type World } from './world.ts';

export const NAV_CELL = 2;
/** The most the ground may rise or fall between neighboring cells. */
const CLIMB = 1.5;

export type Nav = {
  n: number;
  h: Float32Array;
  ok: Uint8Array;
  g: Float32Array;
  from: Int32Array;
  seen: Uint32Array;
  shut: Uint32Array;
  search: number;
  heap: Int32Array;
  hf: Float32Array;
};

const navs = new WeakMap<World, Nav>();

export function navOf(w: World): Nav {
  let nav = navs.get(w);
  if (!nav) {
    nav = build(w);
    navs.set(w, nav);
  }
  return nav;
}

const center = (i: number) => -ARENA + (i + 0.5) * NAV_CELL;
export const navCell = (n: number, x: number) => clamp(Math.floor((x + ARENA) / NAV_CELL), 0, n - 1);

function build(w: World): Nav {
  const n = Math.round((2 * ARENA) / NAV_CELL);
  const t = w.terrain;
  const h = new Float32Array(n * n);
  const ok = new Uint8Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = center(i);
      const z = center(j);
      const g = floorAt(t, x, z);
      h[j * n + i] = g;
      const deep = t.hasWater && !t.ice && heightAt(t, x, z) < t.water - 1;
      ok[j * n + i] = !deep && !blockedAt(w, x, z, g, 0.7) ? 1 : 0;
    }
  return { n, h, ok, g: new Float32Array(n * n), from: new Int32Array(n * n), seen: new Uint32Array(n * n), shut: new Uint32Array(n * n), search: 0, heap: new Int32Array(n * n * 8), hf: new Float32Array(n * n * 8) };
}

/** Nearest walkable cell to a point, searching a few cells out. */
function nearestOk(nav: Nav, x: number, z: number) {
  const n = nav.n;
  const ci = navCell(n, x);
  const cj = navCell(n, z);
  for (let r = 0; r <= 4; r++)
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i >= 0 && j >= 0 && i < n && j < n && nav.ok[j * n + i]) return j * n + i;
      }
  return -1;
}

const NB: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Can a body walk straight from cell a to cell b (all cells under the line walkable, no cliff between)? */
function walkLine(nav: Nav, ax: number, az: number, bx: number, bz: number) {
  const n = nav.n;
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / (NAV_CELL * 0.5));
  let prev = nav.h[navCell(n, az) * n + navCell(n, ax)];
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    const c = navCell(n, az + (bz - az) * k) * n + navCell(n, ax + (bx - ax) * k);
    if (!nav.ok[c]) return false;
    if (Math.abs(nav.h[c] - prev) > CLIMB * 0.75) return false;
    prev = nav.h[c];
  }
  return true;
}

/**
 * Waypoints (flat x, z pairs, the start left out) for walking from (sx, sz) to (gx, gz), or null when there is no
 * way. Long searches give up after `budget` cells.
 */
export function findPath(w: World, sx: number, sz: number, gx: number, gz: number, budget = 20000): number[] | null {
  const nav = navOf(w);
  const n = nav.n;
  const start = nearestOk(nav, sx, sz);
  const goal = nearestOk(nav, gx, gz);
  if (start < 0 || goal < 0) return null;
  if (start === goal) return [gx, gz];
  const id = (nav.search = (nav.search + 1) >>> 0 || 1);
  const gi = goal % n;
  const gj = (goal - gi) / n;
  const heur = (c: number) => {
    const i = c % n;
    const j = (c - i) / n;
    const dx = Math.abs(i - gi);
    const dz = Math.abs(j - gj);
    return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * NAV_CELL;
  };
  // binary heap of (cell, f)
  const heap = nav.heap;
  const hf = nav.hf;
  let size = 0;
  const push = (c: number, f: number) => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      heap[k] = heap[p];
      hf[k] = hf[p];
      k = p;
    }
    heap[k] = c;
    hf[k] = f;
  };
  const pop = () => {
    const top = heap[0];
    const lc = heap[--size];
    const lf = hf[size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= lf) break;
      heap[k] = heap[c];
      hf[k] = hf[c];
      k = c;
    }
    heap[k] = lc;
    hf[k] = lf;
    return top;
  };
  nav.seen[start] = id;
  nav.g[start] = 0;
  nav.from[start] = -1;
  push(start, heur(start));
  let found = false;
  let expanded = 0;
  while (size > 0) {
    const c = pop();
    if (nav.shut[c] === id) continue;
    nav.shut[c] = id;
    if (c === goal) {
      found = true;
      break;
    }
    if (++expanded > budget) break;
    const ci = c % n;
    const cj = (c - ci) / n;
    const hc = nav.h[c];
    for (const [di, dj, cost] of NB) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const nc = j * n + i;
      if (!nav.ok[nc] || nav.shut[nc] === id) continue;
      if (di !== 0 && dj !== 0 && (!nav.ok[cj * n + i] || !nav.ok[j * n + ci])) continue;
      const rise = Math.abs(nav.h[nc] - hc);
      if (rise > CLIMB * cost) continue;
      const gNew = nav.g[c] + cost * NAV_CELL + rise * 1.5;
      if (nav.seen[nc] === id && gNew >= nav.g[nc]) continue;
      nav.seen[nc] = id;
      nav.g[nc] = gNew;
      nav.from[nc] = c;
      push(nc, gNew + heur(nc));
    }
    if (size >= heap.length - 8) break;
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = goal; c >= 0; c = nav.from[c]) cells.push(c);
  cells.reverse();
  // string pulling: from each point, jump to the farthest cell still in a straight walkable line
  const pts: number[] = [];
  let ax = sx;
  let az = sz;
  let k = 0;
  while (k < cells.length - 1) {
    let best = k + 1;
    for (let m = cells.length - 1; m > k + 1; m--) {
      const c = cells[m];
      const ci = c % n;
      if (walkLine(nav, ax, az, center(ci), center((c - ci) / n))) {
        best = m;
        break;
      }
    }
    const c = cells[best];
    const ci = c % n;
    ax = center(ci);
    az = center((c - ci) / n);
    pts.push(ax, az);
    k = best;
  }
  // end on the exact goal when it is walkable, else on the middle of the nearest walkable cell
  if (nav.ok[navCell(n, gz) * n + navCell(n, gx)]) {
    pts[pts.length - 2] = gx;
    pts[pts.length - 1] = gz;
  }
  return pts;
}

/** Is a point on walkable nav ground? */
export function walkable(w: World, x: number, z: number) {
  const nav = navOf(w);
  return nav.ok[navCell(nav.n, z) * nav.n + navCell(nav.n, x)] === 1;
}

/** Distance (meters of walking) from every cell to one point, by Dijkstra over the same grid. Unreachable is Infinity. */
export type Field = Float32Array;
const fields = new WeakMap<World, Map<string, Field>>();

export function fieldTo(w: World, key: string, x: number, z: number): Field {
  let byKey = fields.get(w);
  if (!byKey) fields.set(w, (byKey = new Map()));
  const got = byKey.get(key);
  if (got) return got;
  const nav = navOf(w);
  const n = nav.n;
  const dist = new Float32Array(n * n).fill(Infinity);
  const goal = nearestOk(nav, x, z);
  byKey.set(key, dist);
  if (goal < 0) return dist;
  const heap = nav.heap;
  const hf = nav.hf;
  let size = 0;
  const push = (c: number, f: number) => {
    let k = size++;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (hf[p] <= f) break;
      heap[k] = heap[p];
      hf[k] = hf[p];
      k = p;
    }
    heap[k] = c;
    hf[k] = f;
  };
  const pop = () => {
    const top = heap[0];
    const lc = heap[--size];
    const lf = hf[size];
    let k = 0;
    for (;;) {
      let c = 2 * k + 1;
      if (c >= size) break;
      if (c + 1 < size && hf[c + 1] < hf[c]) c++;
      if (hf[c] >= lf) break;
      heap[k] = heap[c];
      hf[k] = hf[c];
      k = c;
    }
    heap[k] = lc;
    hf[k] = lf;
    return top;
  };
  dist[goal] = 0;
  push(goal, 0);
  while (size > 0 && size < heap.length - 8) {
    const f = hf[0];
    const c = pop();
    if (f > dist[c]) continue;
    const ci = c % n;
    const cj = (c - ci) / n;
    for (const [di, dj, cost] of NB) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const nc = j * n + i;
      if (!nav.ok[nc]) continue;
      if (di !== 0 && dj !== 0 && (!nav.ok[cj * n + i] || !nav.ok[j * n + ci])) continue;
      const rise = Math.abs(nav.h[nc] - nav.h[c]);
      if (rise > CLIMB * cost) continue;
      const d = dist[c] + cost * NAV_CELL + rise * 1.5;
      if (d < dist[nc]) {
        dist[nc] = d;
        push(nc, d);
      }
    }
  }
  return dist;
}

/** Walking distance left to a field's point from (x, z), or Infinity. */
export function fieldDist(w: World, f: Field, x: number, z: number) {
  const nav = navOf(w);
  const c = nearestOk(nav, x, z);
  return c < 0 ? Infinity : f[c];
}

/**
 * The next point to walk to down a field: follows the steepest descent several cells ahead, then keeps the farthest
 * of those points that is still a straight walk away. Null when (x, z) cannot reach the field's point.
 */
export function fieldStep(w: World, f: Field, x: number, z: number, look = 8): [number, number] | null {
  const nav = navOf(w);
  const n = nav.n;
  let c = nearestOk(nav, x, z);
  if (c < 0 || !Number.isFinite(f[c])) return null;
  const chain: number[] = [];
  for (let s = 0; s < look; s++) {
    const ci = c % n;
    const cj = (c - ci) / n;
    let best = c;
    for (const [di, dj] of NB) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const nc = j * n + i;
      if (f[nc] < f[best]) best = nc;
    }
    if (best === c) break;
    c = best;
    chain.push(c);
  }
  if (!chain.length) return null;
  for (let k = chain.length - 1; k > 0; k--) {
    const cc = chain[k];
    const ci = cc % n;
    const px = center(ci);
    const pz = center((cc - ci) / n);
    if (walkLine(nav, x, z, px, pz)) return [px, pz];
  }
  const ci = chain[0] % n;
  return [center(ci), center((chain[0] - ci) / n)];
}
