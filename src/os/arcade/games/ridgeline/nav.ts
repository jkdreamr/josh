// Path finding for the bots: a 2 m grid over the arena marking where a body fits and can walk (no cliffs, deep water,
// walls, crates, trunks or rocks), searched with A* and smoothed into a few straight legs.
import { clamp } from './noise.ts';
import { blockedAt, groundAt } from './physics.ts';
import { floorAt, heightAt, normalAt } from './terrain.ts';
import type { World } from './world.ts';

export const NAV_CELL = 2;
/** The most the ground may rise or fall between neighboring cells. */
const CLIMB = 1.5;
/** Ground steeper than this (the normal's up part) is out: the body slides off at 0.62, and a bot steering step by step
 * will not head up a rise steeper than about 0.85 m a meter (0.76), so nothing in between gets planned through. */
const STEEP = 0.77;
const nrm = { x: 0, y: 1, z: 0 };
/** Can a body stand on the bare ground around (x, z)? (Ice is flat whatever lies under it.) */
function standable(w: World, x: number, z: number) {
  const t = w.terrain;
  for (const [ox, oz] of [
    [0, 0],
    [0.7, 0],
    [-0.7, 0],
    [0, 0.7],
    [0, -0.7],
  ]) {
    if (t.ice && heightAt(t, x + ox, z + oz) < t.water) continue;
    if (normalAt(t, x + ox, z + oz, nrm).y < STEEP) return false;
  }
  return true;
}

export type Nav = {
  w: World;
  n: number;
  /** Half the side covered (the world's arena). */
  a: number;
  h: Float32Array;
  ok: Uint8Array;
  g: Float32Array;
  from: Int32Array;
  seen: Uint32Array;
  shut: Uint32Array;
  search: number;
  heap: Int32Array;
  hf: Float32Array;
  /** Cells carved through doorways, and the exact point on the door's axis to walk through for each (x, z pairs). */
  door: Int32Array;
  doorPts: Float32Array;
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

const centerOf = (a: number, i: number) => -a + (i + 0.5) * NAV_CELL;
const cellOf = (a: number, n: number, x: number) => clamp(Math.floor((x + a) / NAV_CELL), 0, n - 1);

function build(w: World): Nav {
  const A = w.arena;
  const n = Math.round((2 * A) / NAV_CELL);
  const center = (i: number) => centerOf(A, i);
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
      // a floor above the ground (a building's) is level whatever the slope under it
      const onFloor = groundAt(w, x, z, g + 3) > g + 0.3;
      ok[j * n + i] = !deep && !blockedAt(w, x, z, g, 0.7) && (onFloor || standable(w, x, z)) ? 1 : 0;
    }
  // a 2 m grid misses most doorways: carve a line of cells through each one, on the door's own axis
  const door = new Int32Array(n * n).fill(-1);
  const pts: number[] = [];
  const D = w.doors;
  for (let k = 0; k < D.length; k += 4) {
    for (const t of [-1.6, -0.8, 0, 0.8, 1.6]) {
      const x = D[k] + D[k + 2] * t;
      const z = D[k + 1] + D[k + 3] * t;
      if (Math.abs(x) >= A || Math.abs(z) >= A) continue;
      const c = cellOf(A, n, z) * n + cellOf(A, n, x);
      if (door[c] >= 0) continue;
      ok[c] = 1;
      h[c] = floorAt(w.terrain, x, z);
      door[c] = pts.length / 2;
      pts.push(x, z);
    }
  }
  return { w, n, a: A, door, doorPts: new Float32Array(pts), h, ok, g: new Float32Array(n * n), from: new Int32Array(n * n), seen: new Uint32Array(n * n), shut: new Uint32Array(n * n), search: 0, heap: new Int32Array(n * n * 8), hf: new Float32Array(n * n * 8) };
}

/** Nearest walkable cell to a point, searching a few cells out. Of the cells equally near, one reached without
 * passing through a wall or a box (a cell just across a thin wall is near, but not where you are). */
function nearestOk(nav: Nav, x: number, z: number) {
  const n = nav.n;
  const ci = cellOf(nav.a, n, x);
  const cj = cellOf(nav.a, n, z);
  // (off the walkable ground, on a slope too steep to stand on say, the way out is down it: the lowest cell near)
  for (let r = 0; r <= 4; r++) {
    let first = -1;
    let low = -1;
    for (let dj = -r; dj <= r; dj++)
      for (let di = -r; di <= r; di++) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || !nav.ok[j * n + i]) continue;
        const c = j * n + i;
        if (r === 0) return c;
        if (reachable(nav, x, z, centerOf(nav.a, i), centerOf(nav.a, j), nav.h[c]) && (low < 0 || nav.h[c] < nav.h[low])) low = c;
        if (first < 0) first = c;
      }
    if (low >= 0) return low;
    if (first >= 0) return first;
  }
  return -1;
}

/** Nothing solid on the short straight way from (x, z) to (cx, cz)? */
function reachable(nav: Nav, x: number, z: number, cx: number, cz: number, y: number) {
  for (const k of [0.25, 0.5, 0.75, 1]) if (blockedAt(nav.w, x + (cx - x) * k, z + (cz - z) * k, y, 0.12)) return false;
  return true;
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

const NB_DI = Int8Array.from(NB.map((v) => v[0]));
const NB_DJ = Int8Array.from(NB.map((v) => v[1]));
const NB_COST = Float32Array.from(NB.map((v) => v[2]));

/** Can a body walk straight from a to b (all cells under the line walkable, no cliff between, and nothing solid on
 * the line itself: the 2 m grid alone can miss the end of a thin wall)? */
function walkLine(nav: Nav, ax: number, az: number, bx: number, bz: number) {
  const n = nav.n;
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.ceil(d / (NAV_CELL * 0.25));
  let prev = nav.h[cellOf(nav.a, n, az) * n + cellOf(nav.a, n, ax)];
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    const x = ax + (bx - ax) * k;
    const z = az + (bz - az) * k;
    const c = cellOf(nav.a, n, z) * n + cellOf(nav.a, n, x);
    if (!nav.ok[c]) return false;
    if (Math.abs(nav.h[c] - prev) > CLIMB * 0.75) return false;
    prev = nav.h[c];
    if (blockedAt(nav.w, x, z, nav.h[c], 0.3)) return false;
  }
  return true;
}

/** Can a body walk straight from (ax, az) to (bx, bz)? */
export function canWalk(w: World, ax: number, az: number, bx: number, bz: number) {
  return walkLine(navOf(w), ax, az, bx, bz);
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
    const gc = nav.g[c];
    const ok = nav.ok;
    for (let q = 0; q < 8; q++) {
      const di = NB_DI[q];
      const dj = NB_DJ[q];
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      const nc = j * n + i;
      if (!ok[nc] || nav.shut[nc] === id) continue;
      if (q >= 4 && (!ok[cj * n + i] || !ok[j * n + ci])) continue;
      const cost = NB_COST[q];
      const rise = Math.abs(nav.h[nc] - hc);
      if (rise > CLIMB * cost) continue;
      const gNew = gc + cost * NAV_CELL + rise * 1.5;
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
  const at = (c: number): [number, number] => {
    const d = nav.door[c];
    if (d >= 0) return [nav.doorPts[d * 2], nav.doorPts[d * 2 + 1]];
    const ci = c % n;
    return [centerOf(nav.a, ci), centerOf(nav.a, (c - ci) / n)];
  };
  while (k < cells.length - 1) {
    let best = k + 1;
    let limit = cells.length - 1;
    for (let q = k + 1; q < cells.length; q++)
      if (nav.door[cells[q]] >= 0) {
        limit = q;
        break;
      }
    for (let m = limit; m > k + 1; m--) {
      const [px, pz] = at(cells[m]);
      if (walkLine(nav, ax, az, px, pz)) {
        best = m;
        break;
      }
    }
    [ax, az] = at(cells[best]);
    pts.push(ax, az);
    k = best;
  }
  // end on the exact goal when it is walkable, else on the middle of the nearest walkable cell
  if (nav.ok[cellOf(nav.a, n, gz) * n + cellOf(nav.a, n, gx)]) {
    pts[pts.length - 2] = gx;
    pts[pts.length - 1] = gz;
  }
  // standing off to one side of its cell (by the end of a wall, say), the first leg may not be a straight walk from
  // where the body really is: step to the middle of the cell first
  if (pts.length >= 2 && !walkLine(nav, sx, sz, pts[0], pts[1])) {
    const [cx, cz] = at(cells[0]);
    if (Math.hypot(cx - sx, cz - sz) > 0.3) pts.unshift(cx, cz);
  }
  return pts;
}

/** Is a point on walkable nav ground? */
export function walkable(w: World, x: number, z: number) {
  const nav = navOf(w);
  return nav.ok[cellOf(nav.a, nav.n, z) * nav.n + cellOf(nav.a, nav.n, x)] === 1;
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
  const start = c;
  const chain: number[] = [];
  for (let s = 0; s < look; s++) {
    const ci = c % n;
    const cj = (c - ci) / n;
    let best = c;
    for (const [di, dj] of NB) {
      const i = ci + di;
      const j = cj + dj;
      if (i < 0 || j < 0 || i >= n || j >= n) continue;
      // the same corner rule as the field itself: no cutting diagonally past a blocked cell
      if (di !== 0 && dj !== 0 && (!nav.ok[cj * n + i] || !nav.ok[j * n + ci])) continue;
      const nc = j * n + i;
      if (f[nc] < f[best]) best = nc;
    }
    if (best === c) break;
    c = best;
    chain.push(c);
  }
  if (!chain.length) return null;
  for (let k = chain.length - 1; k >= 0; k--) {
    const cc = chain[k];
    const ci = cc % n;
    const px = centerOf(nav.a, ci);
    const pz = centerOf(nav.a, (cc - ci) / n);
    if (walkLine(nav, x, z, px, pz)) return [px, pz];
  }
  // nothing ahead is a straight walk from here (tucked into a corner): first to the middle of the cell it stands in
  const si = start % n;
  const sx = centerOf(nav.a, si);
  const sz = centerOf(nav.a, (start - si) / n);
  if (Math.hypot(sx - x, sz - z) > 0.4) return [sx, sz];
  const ci = chain[0] % n;
  return [centerOf(nav.a, ci), centerOf(nav.a, (chain[0] - ci) / n)];
}
