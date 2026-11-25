// Path finding for the bots: a 2 m grid over the arena marking where a body fits and can walk (no cliffs, deep water,
// walls, crates, trunks or rocks), searched with A* and smoothed into a few straight legs.
//
// Above the ground the grid is not enough: an upper floor over a ground floor shares its cells, and one must never make
// the other look blocked. So the ground keeps its grid (one node a cell, at the ground's height, exactly as before) and
// everything over it gets nodes of its own: the floors, mezzanines, roofs and platforms (the world's decks) a node
// wherever a cell's middle lies on one (or the deck's middle, for a small one), the flights of stairs and the ladders a
// chain of nodes from foot to head. Those nodes are joined to their neighbors on the same level, along their chains,
// and the chains' ends to the ground cells or the deck nodes they lead to, each join checked by walking it. A* and the
// distance fields run over the ground cells and these nodes alike, and a body is placed on the node at its own height
// (one on an upper floor is on that floor's node, not the ground cell under it). Straight walks over the levels are
// checked by stepping the body's support along them (see physLine). On a map with nothing above the ground, all of this
// is empty and the grid works as it always did.
import { LADDER_OFF } from './climb.ts';
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

/** What an upper node is: on a deck (a floor, roof or platform), on a flight of stairs, or on a ladder. */
export const UP_DECK = 1;
export const UP_STAIR = 2;
export const UP_LADDER = 3;

export type Nav = {
  w: World;
  n: number;
  /** Half the side covered (the world's arena). */
  a: number;
  /** Nodes in all: the ground cells (n * n) first, then those above the ground. */
  N: number;
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
  /** Per ground cell, a bit for each of its eight neighbors (in NB's order) that a wall stands between: round the
   * buildings of a map with floors over the ground (a royale's, which stand off the grid's lines), so no path goes in
   * through a wall. */
  cut: Uint8Array;
  /** The nodes above the ground (index minus n * n): where each is and what (UP_DECK, UP_STAIR or UP_LADDER). */
  ux: Float32Array;
  uz: Float32Array;
  uk: Uint8Array;
  /** Edges that touch a node above the ground, by node: eStart[c]..eStart[c + 1] index eTo and eCost. */
  eStart: Int32Array;
  eTo: Int32Array;
  eCost: Float32Array;
  /** The nodes above the ground by the ground cell they lie in: cStart[c]..cStart[c + 1] index cNodes. */
  cStart: Int32Array;
  cNodes: Int32Array;
  /** Points (x, z, rounded) of the stair and ladder nodes, and which they are: a bot walks straight at those. */
  marks: Map<number, number>;
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
const markKey = (x: number, z: number) => Math.round(x * 50) * 1e6 + Math.round(z * 50);

function build(w: World): Nav {
  const A = w.arena;
  const n = Math.round((2 * A) / NAV_CELL);
  const center = (i: number) => centerOf(A, i);
  const t = w.terrain;
  const G = n * n;
  const gh = new Float32Array(G);
  const gok = new Uint8Array(G);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = center(i);
      const z = center(j);
      const g = floorAt(t, x, z);
      gh[j * n + i] = g;
      const deep = t.hasWater && !t.ice && heightAt(t, x, z) < t.water - 1;
      // a floor above the ground (a building's) is level whatever the slope under it
      const onFloor = groundAt(w, x, z, g + 3) > g + 0.3;
      gok[j * n + i] = !deep && !blockedAt(w, x, z, g, 0.7) && (onFloor || standable(w, x, z)) ? 1 : 0;
    }
  // a 2 m grid misses most doorways: carve a line of cells through each one, on the door's own axis
  const door = new Int32Array(G).fill(-1);
  const pts: number[] = [];
  const D = w.doors;
  for (let k = 0; k < D.length; k += 4) {
    for (const s of [-1.6, -0.8, 0, 0.8, 1.6]) {
      const x = D[k] + D[k + 2] * s;
      const z = D[k + 1] + D[k + 3] * s;
      if (Math.abs(x) >= A || Math.abs(z) >= A) continue;
      const c = cellOf(A, n, z) * n + cellOf(A, n, x);
      if (door[c] >= 0) continue;
      gok[c] = 1;
      gh[c] = floorAt(w.terrain, x, z);
      door[c] = pts.length / 2;
      pts.push(x, z);
    }
  }
  const cut = cutWalls(w, A, n, gh, gok, door, pts);
  const up = buildUpper(w, A, n, gh, gok);
  const N = G + up.U;
  const h = new Float32Array(N);
  const ok = new Uint8Array(N);
  h.set(gh);
  ok.set(gok);
  for (let u = 0; u < up.U; u++) {
    h[G + u] = up.uh[u];
    ok[G + u] = 1;
  }
  return {
    w,
    n,
    a: A,
    N,
    door,
    doorPts: new Float32Array(pts),
    cut,
    h,
    ok,
    g: new Float32Array(N),
    from: new Int32Array(N),
    seen: new Uint32Array(N),
    shut: new Uint32Array(N),
    search: 0,
    heap: new Int32Array(N * 8 + up.eTo.length),
    hf: new Float32Array(N * 8 + up.eTo.length),
    ux: up.ux,
    uz: up.uz,
    uk: up.uk,
    eStart: up.eStart,
    eTo: up.eTo,
    eCost: up.eCost,
    cStart: up.cStart,
    cNodes: up.cNodes,
    marks: up.marks,
  };
}

/** Marks the walls between neighboring ground cells round the buildings (see Nav.cut), on a map with floors over the
 * ground: a neighbor whose middle (or doorway point) is not a clear step from this one's. */
function cutWalls(w: World, A: number, n: number, gh: Float32Array, gok: Uint8Array, door: Int32Array, pts: number[]) {
  const cut = new Uint8Array(n * n);
  const px = (c: number) => (door[c] >= 0 ? pts[door[c] * 2] : centerOf(A, c % n));
  const pz = (c: number) => (door[c] >= 0 ? pts[door[c] * 2 + 1] : centerOf(A, (c - (c % n)) / n));
  const done = new Uint8Array(n * n);
  if (!w.decks.length) return cut;
  for (const b of w.bld) {
    const r = Math.max(b.w, b.d) / 2 + 3;
    const i0 = cellOf(A, n, b.x - r);
    const i1 = cellOf(A, n, b.x + r);
    const j0 = cellOf(A, n, b.z - r);
    const j1 = cellOf(A, n, b.z + r);
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const c = j * n + i;
        if (!gok[c] || done[c]) continue;
        done[c] = 1;
        for (let q = 0; q < 8; q++) {
          const ii = i + NB[q][0];
          const jj = j + NB[q][1];
          if (ii < 0 || jj < 0 || ii >= n || jj >= n) continue;
          const nc = jj * n + ii;
          if (!gok[nc]) continue;
          const ax = px(c);
          const az = pz(c);
          const bx = px(nc);
          const bz = pz(nc);
          const y = Math.max(gh[c], gh[nc]);
          let hit = false;
          for (const k of [0.2, 0.4, 0.6, 0.8]) if (blockedAt(w, ax + (bx - ax) * k, az + (bz - az) * k, y, 0.1)) hit = true;
          if (hit) cut[c] |= 1 << q;
        }
      }
  }
  return cut;
}

/** Walks a body from (ax, az), on whatever it stands on near height ay, straight to (bx, bz) by stepping its support
 * along (as physics would carry it: up steps, along floors): false at a drop, a step too high or anything in the way,
 * and (given by) unless it ends up at about that height (the floor wanted, not the one under or over it). */
function physLine(w: World, ax: number, az: number, ay: number, bx: number, bz: number, by = NaN) {
  const d = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(1, Math.ceil(d / 0.25));
  let y = groundAt(w, ax, az, ay + 0.05);
  if (ay - y > 0.7) return false;
  for (let s = 1; s <= steps; s++) {
    const k = s / steps;
    const x = ax + (bx - ax) * k;
    const z = az + (bz - az) * k;
    const g = groundAt(w, x, z, y);
    if (y - g > 0.7) return false;
    y = g;
    if (blockedAt(w, x, z, y, 0.3)) return false;
  }
  return !(Math.abs(y - by) > 0.6);
}

/** The nodes above the ground: on the decks, up the flights and the ladders, and how they join (see the top). */
function buildUpper(w: World, A: number, n: number, gh: Float32Array, gok: Uint8Array) {
  const G = n * n;
  const ux: number[] = [];
  const uz: number[] = [];
  const uh: number[] = [];
  const uk: number[] = [];
  const edges: number[] = [];
  const marks = new Map<number, number>();
  const inside = (x: number, z: number) => Math.abs(x) < A - 1 && Math.abs(z) < A - 1;
  const add = (x: number, z: number, y: number, kind: number) => {
    ux.push(x);
    uz.push(z);
    uh.push(y);
    uk.push(kind);
    if (kind !== UP_DECK) marks.set(markKey(Math.fround(x), Math.fround(z)), kind);
    return G + ux.length - 1;
  };
  const join = (a: number, b: number, cost: number) => edges.push(a, b, cost, b, a, cost);
  // decks: a node at each cell's middle on one (dropping those on a thing standing there or by a wall), or at the
  // middle of a deck too small for any
  const deckNodes: number[] = [];
  const seen = new Set<string>();
  for (const d of w.decks) {
    let any = false;
    const tryAt = (x: number, z: number) => {
      if (!inside(x, z)) return;
      const key = `${Math.round(x * 4)},${Math.round(z * 4)},${Math.round(d.y * 4)}`;
      if (seen.has(key)) {
        any = true;
        return;
      }
      if (Math.abs(groundAt(w, x, z, d.y + 0.05) - d.y) > 0.1 || blockedAt(w, x, z, d.y, 0.45)) return;
      seen.add(key);
      deckNodes.push(add(x, z, d.y, UP_DECK));
      any = true;
    };
    const wx = d.x1 - d.x0;
    const wz = d.z1 - d.z0;
    if (Math.min(wx, wz) < 2.4) {
      // a narrow one (a landing, a strip beside a stairwell): along its middle
      const along = wx >= wz;
      const len = along ? wx : wz;
      const k = Math.max(1, Math.round(len / 1.6));
      for (let s = 0; s < k; s++) {
        const u = (s + 0.5) / k;
        tryAt(along ? d.x0 + wx * u : (d.x0 + d.x1) / 2, along ? (d.z0 + d.z1) / 2 : d.z0 + wz * u);
      }
    } else
      for (let i = Math.ceil((d.x0 + A) / NAV_CELL - 0.5); centerOf(A, i) < d.x1; i++)
        for (let j = Math.ceil((d.z0 + A) / NAV_CELL - 0.5); centerOf(A, j) < d.z1; j++) {
          const x = centerOf(A, i);
          const z = centerOf(A, j);
          if (x > d.x0 + 0.1 && z > d.z0 + 0.1) tryAt(x, z);
        }
    if (!any) tryAt((d.x0 + d.x1) / 2, (d.z0 + d.z1) / 2);
  }
  const U0 = () => ux.length;
  // (deck nodes by cell, to find neighbors)
  const byCell = new Map<number, number[]>();
  const cellKey = (x: number, z: number) => cellOf(A, n, z) * n + cellOf(A, n, x);
  for (const u of deckNodes) {
    const k = cellKey(ux[u - G], uz[u - G]);
    const l = byCell.get(k);
    if (l) l.push(u);
    else byCell.set(k, [u]);
  }
  const near = (x: number, z: number, r: number) => {
    const out: number[] = [];
    const ci = cellOf(A, n, x);
    const cj = cellOf(A, n, z);
    const k = Math.ceil(r / NAV_CELL);
    for (let dj = -k; dj <= k; dj++)
      for (let di = -k; di <= k; di++) {
        const l = byCell.get((cj + dj) * n + ci + di);
        if (l) for (const u of l) if (Math.hypot(ux[u - G] - x, uz[u - G] - z) <= r) out.push(u);
      }
    return out;
  };
  for (const u of deckNodes) {
    const x = ux[u - G];
    const z = uz[u - G];
    const y = uh[u - G];
    for (const v of near(x, z, 2.9)) {
      if (v <= u || Math.abs(uh[v - G] - y) > 0.3) continue;
      const d = Math.hypot(ux[v - G] - x, uz[v - G] - z);
      if (physLine(w, x, z, y, ux[v - G], uz[v - G], uh[v - G])) join(u, v, d);
    }
  }
  /** Joins a chain's end at (x, z, y) to what it stands among: the deck nodes on its level near it, or (on the ground)
   * the walkable ground cells near it, each a straight walk from there. */
  const tie = (end: number, x: number, z: number, y: number) => {
    let tied = 0;
    if (y > floorAt(w.terrain, x, z) + 0.6) {
      for (const v of near(x, z, 3.2).sort((p, q) => Math.hypot(ux[p - G] - x, uz[p - G] - z) - Math.hypot(ux[q - G] - x, uz[q - G] - z)))
        if (tied < 4 && Math.abs(uh[v - G] - y) < 0.35 && physLine(w, x, z, y, ux[v - G], uz[v - G], uh[v - G])) {
          join(end, v, Math.hypot(ux[v - G] - x, uz[v - G] - z));
          tied++;
        }
      return tied;
    }
    const ci = cellOf(A, n, x);
    const cj = cellOf(A, n, z);
    const cand: [number, number][] = [];
    for (let dj = -2; dj <= 2; dj++)
      for (let di = -2; di <= 2; di++) {
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || !gok[j * n + i]) continue;
        const d = Math.hypot(centerOf(A, i) - x, centerOf(A, j) - z);
        if (d < 2.9) cand.push([j * n + i, d]);
      }
    cand.sort((p, q) => p[1] - q[1]);
    for (const [c, d] of cand) {
      if (tied >= 4) break;
      const i = c % n;
      if (!physLine(w, x, z, y, centerOf(A, i), centerOf(A, (c - i) / n), gh[c])) continue;
      join(end, c, d + Math.abs(gh[c] - y));
      tied++;
    }
    return tied;
  };
  // flights: a chain up the middle of the stairs, about a meter a node, each node on the step under it
  for (const f of w.flights) {
    const len = Math.hypot(f.bx - f.ax, f.bz - f.az);
    const k = Math.max(2, Math.ceil(len / 1.1));
    let prev = -1;
    let px = 0;
    let pz = 0;
    let py = 0;
    for (let s = 0; s <= k; s++) {
      const x = f.ax + ((f.bx - f.ax) * s) / k;
      const z = f.az + ((f.bz - f.az) * s) / k;
      const guess = f.ay + (f.by - f.ay) * clamp((s / k) * len / Math.max(0.1, len - 0.9) - 0.45 / Math.max(0.1, len - 0.9), 0, 1);
      const y = s === 0 ? f.ay : s === k ? f.by : groundAt(w, x, z, guess + 0.3);
      const u = add(x, z, y, UP_STAIR);
      if (prev >= 0) join(prev, u, Math.hypot(x - px, y - py, z - pz));
      prev = u;
      px = x;
      pz = z;
      py = y;
      if (s === 0) tie(u, x, z, y);
    }
    tie(prev, px, pz, py);
  }
  // ladders: a chain up its face, its points just inside the face (a bot walks straight at it and so into the ladder);
  // the foot joined to the ground cells by it, the top to the deck nodes it climbs to
  for (const l of w.ladders) {
    const x = l.x - l.nx * 0.5;
    const z = l.z - l.nz * 0.5;
    const rise = l.y1 - l.y0;
    const k = Math.max(1, Math.ceil(rise / 2.5));
    let prev = -1;
    let foot = -1;
    for (let s = 0; s <= k; s++) {
      const y = l.y0 + (rise * s) / k;
      const u = add(x, z, y, UP_LADDER);
      if (prev >= 0) join(prev, u, ((rise / k) * 2) + 1);
      else foot = u;
      prev = u;
    }
    const sx = l.x + l.nx * LADDER_OFF;
    const sz = l.z + l.nz * LADDER_OFF;
    tie(foot, sx, sz, l.y0);
    tie(prev, l.x - l.nx * 0.78, l.z - l.nz * 0.78, l.y1);
  }
  // into compressed rows by node, and the nodes by the cell they lie in
  const U = U0();
  const N = G + U;
  const eStart = new Int32Array(N + 1);
  for (let e = 0; e < edges.length; e += 3) eStart[edges[e] + 1]++;
  for (let c = 0; c < N; c++) eStart[c + 1] += eStart[c];
  const fill = eStart.slice(0, N);
  const eTo = new Int32Array(edges.length / 3);
  const eCost = new Float32Array(edges.length / 3);
  for (let e = 0; e < edges.length; e += 3) {
    const k = fill[edges[e]]++;
    eTo[k] = edges[e + 1];
    eCost[k] = edges[e + 2];
  }
  const cStart = new Int32Array(U ? G + 1 : 1);
  const cNodes = new Int32Array(U);
  if (U) {
    const cells = ux.map((x, u) => cellKey(x, uz[u]));
    for (const c of cells) cStart[c + 1]++;
    for (let c = 0; c < G; c++) cStart[c + 1] += cStart[c];
    const at = cStart.slice(0, G);
    cells.forEach((c, u) => (cNodes[at[c]++] = G + u));
  }
  return { U, ux: new Float32Array(ux), uz: new Float32Array(uz), uh: new Float32Array(uh), uk: new Uint8Array(uk), eStart, eTo, eCost, cStart, cNodes, marks };
}

const up = (nav: Nav) => nav.N > nav.n * nav.n;
/** Where a node is. */
const nodeX = (nav: Nav, c: number) => (c >= nav.n * nav.n ? nav.ux[c - nav.n * nav.n] : centerOf(nav.a, c % nav.n));
const nodeZ = (nav: Nav, c: number) => (c >= nav.n * nav.n ? nav.uz[c - nav.n * nav.n] : centerOf(nav.a, (c - (c % nav.n)) / nav.n));

/** Calls fn for each node above the ground lying in the cells within k of (x, z). */
function upNear(nav: Nav, x: number, z: number, k: number, fn: (u: number) => void) {
  if (!up(nav)) return;
  const n = nav.n;
  const ci = cellOf(nav.a, n, x);
  const cj = cellOf(nav.a, n, z);
  for (let j = Math.max(0, cj - k); j <= Math.min(n - 1, cj + k); j++)
    for (let i = Math.max(0, ci - k); i <= Math.min(n - 1, ci + k); i++) {
      const c = j * n + i;
      for (let q = nav.cStart[c]; q < nav.cStart[c + 1]; q++) fn(nav.cNodes[q]);
    }
}

/** Is a node above the ground near (x, z)? */
function upAround(nav: Nav, x: number, z: number) {
  let any = false;
  upNear(nav, x, z, 1, () => (any = true));
  return any;
}

/**
 * Nearest walkable node to a point, searching a few cells out. Of the cells equally near, one reached without passing
 * through a wall or a box (a cell just across a thin wall is near, but not where you are). Given a height y well over
 * the ground there (an upper floor, a roof, the stairs, a ladder), the node above the ground nearest that height.
 */
function nearestOk(nav: Nav, x: number, z: number, y = NaN) {
  if (up(nav) && y > floorAt(nav.w.terrain, x, z) + 1) {
    let best = -1;
    let bestS = Infinity;
    let reach = -1;
    let reachS = Infinity;
    const G = nav.n * nav.n;
    upNear(nav, x, z, 2, (u) => {
      const h = nav.h[u];
      if (h > y + 0.8 || h < y - 1.7) return;
      const s = Math.hypot(nav.ux[u - G] - x, nav.uz[u - G] - z) + Math.abs(h - y) * 1.5;
      if (s < bestS) {
        bestS = s;
        best = u;
      }
      if (s < reachS && physLine(nav.w, x, z, y, nav.ux[u - G], nav.uz[u - G], h)) {
        reachS = s;
        reach = u;
      }
    });
    if (reach >= 0) return reach;
    if (best >= 0) return best;
  }
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

/** Can a body walk straight from a to b over the ground grid (all cells under the line walkable, no cliff between, and
 * nothing solid on the line itself: the 2 m grid alone can miss the end of a thin wall)? */
function groundLine(nav: Nav, ax: number, az: number, bx: number, bz: number) {
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

/**
 * Can a body walk straight from a to b? On the ground, over the grid (as it always was); from a height well over the
 * ground (ay), or to or from a node above it (`upper`), by stepping its support along (physLine). Near the stairs and
 * floors above the ground, a walk the grid refuses (onto the first steps, say) may still be one physLine allows.
 */
function walkLine(nav: Nav, ax: number, az: number, bx: number, bz: number, ay = NaN, upper = false, by = NaN) {
  if (!up(nav)) return groundLine(nav, ax, az, bx, bz);
  const ground = nav.h[cellOf(nav.a, nav.n, az) * nav.n + cellOf(nav.a, nav.n, ax)];
  const y = Number.isFinite(ay) ? ay : ground;
  if (upper || y > floorAt(nav.w.terrain, ax, az) + 0.9) return physLine(nav.w, ax, az, y, bx, bz, by);
  if (groundLine(nav, ax, az, bx, bz) && !(by > floorAt(nav.w.terrain, bx, bz) + 0.9)) return true;
  return (upAround(nav, bx, bz) || upAround(nav, ax, az)) && physLine(nav.w, ax, az, y, bx, bz, by);
}

/** Can a body walk straight from (ax, az) to (bx, bz)? Given its height (ay), from wherever it stands at that height. */
export function canWalk(w: World, ax: number, az: number, bx: number, bz: number, ay = NaN) {
  return walkLine(navOf(w), ax, az, bx, bz, ay);
}

/** What a waypoint is: 2 a point on a flight of stairs, 3 on a ladder (a bot walks straight at those), else 0. */
export function navMark(w: World, x: number, z: number) {
  const nav = navOf(w);
  return nav.marks.size ? (nav.marks.get(markKey(Math.fround(x), Math.fround(z))) ?? 0) : 0;
}

/**
 * Waypoints (flat x, z pairs, the start left out) for walking from (sx, sz) to (gx, gz), or null when there is no
 * way. Long searches give up after `budget` cells. sy and gy (when given) are the heights of the start and the goal, for
 * a start or a goal up on a floor over the ground; `ys` (when given, on a map with floors over the ground) gets the
 * height of each waypoint.
 */
export function findPath(w: World, sx: number, sz: number, gx: number, gz: number, budget = 20000, sy = NaN, gy = NaN, ys?: number[]): number[] | null {
  const nav = navOf(w);
  const n = nav.n;
  const G = n * n;
  const start = nearestOk(nav, sx, sz, sy);
  const goal = nearestOk(nav, gx, gz, gy);
  if (ys) ys.length = 0;
  if (start < 0 || goal < 0) return null;
  if (start === goal) {
    if (ys && up(nav)) ys.push(nav.h[goal]);
    return [gx, gz];
  }
  const id = (nav.search = (nav.search + 1) >>> 0 || 1);
  const gi = goal % n;
  const gj = (goal - gi) / n;
  const gxm = nodeX(nav, goal);
  const gzm = nodeZ(nav, goal);
  const heur = (c: number) => {
    if (c < G && goal < G) {
      const i = c % n;
      const j = (c - i) / n;
      const dx = Math.abs(i - gi);
      const dz = Math.abs(j - gj);
      return (Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz)) * NAV_CELL;
    }
    const dx = Math.abs(nodeX(nav, c) - gxm);
    const dz = Math.abs(nodeZ(nav, c) - gzm);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
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
  const visit = (nc: number, gNew: number, c: number) => {
    if (nav.seen[nc] === id && gNew >= nav.g[nc]) return;
    nav.seen[nc] = id;
    nav.g[nc] = gNew;
    nav.from[nc] = c;
    push(nc, gNew + heur(nc));
  };
  while (size > 0) {
    const c = pop();
    if (nav.shut[c] === id) continue;
    nav.shut[c] = id;
    if (c === goal) {
      found = true;
      break;
    }
    if (++expanded > budget) break;
    const gc = nav.g[c];
    if (c < G) {
      const ci = c % n;
      const cj = (c - ci) / n;
      const hc = nav.h[c];
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
        if ((nav.cut[c] >> q) & 1) continue;
        const cost = NB_COST[q];
        const rise = Math.abs(nav.h[nc] - hc);
        if (rise > CLIMB * cost) continue;
        visit(nc, gc + cost * NAV_CELL + rise * 1.5, c);
      }
    }
    for (let e = nav.eStart[c]; e < nav.eStart[c + 1]; e++) {
      const nc = nav.eTo[e];
      if (nav.shut[nc] !== id) visit(nc, gc + nav.eCost[e], c);
    }
    if (size >= heap.length - 8) break;
  }
  if (!found) return null;
  const cells: number[] = [];
  for (let c = goal; c >= 0; c = nav.from[c]) cells.push(c);
  cells.reverse();
  // string pulling: from each point, jump to the farthest cell still in a straight walkable line (never past a doorway
  // or a ladder's rung: those are walked through one by one)
  const pts: number[] = [];
  let ax = sx;
  let az = sz;
  let ay = sy;
  let aUp = start >= G;
  let k = 0;
  const at = (c: number): [number, number] => {
    if (c >= G) return [nav.ux[c - G], nav.uz[c - G]];
    const d = nav.door[c];
    if (d >= 0) return [nav.doorPts[d * 2], nav.doorPts[d * 2 + 1]];
    const ci = c % n;
    return [centerOf(nav.a, ci), centerOf(nav.a, (c - ci) / n)];
  };
  const hard = (c: number) => (c >= G ? nav.uk[c - G] === UP_LADDER : nav.door[c] >= 0);
  while (k < cells.length - 1) {
    let best = k + 1;
    let limit = cells.length - 1;
    for (let q = k + 1; q < cells.length; q++)
      if (hard(cells[q])) {
        limit = q;
        break;
      }
    for (let m = limit; m > k + 1; m--) {
      const [px, pz] = at(cells[m]);
      if (walkLine(nav, ax, az, px, pz, ay, aUp || cells[m] >= G, nav.h[cells[m]])) {
        best = m;
        break;
      }
    }
    [ax, az] = at(cells[best]);
    ay = nav.h[cells[best]];
    aUp = cells[best] >= G;
    pts.push(ax, az);
    if (ys && up(nav)) ys.push(ay);
    k = best;
  }
  // end on the exact goal when it is walkable, else on the middle of the nearest walkable cell
  if (goal < G ? nav.ok[cellOf(nav.a, n, gz) * n + cellOf(nav.a, n, gx)] : Math.hypot(gx - nav.ux[goal - G], gz - nav.uz[goal - G]) < NAV_CELL) {
    pts[pts.length - 2] = gx;
    pts[pts.length - 1] = gz;
  }
  // standing off to one side of its cell (by the end of a wall, say), the first leg may not be a straight walk from
  // where the body really is: step to the middle of the cell first
  if (pts.length >= 2 && !walkLine(nav, sx, sz, pts[0], pts[1], sy, start >= G || cells[1] >= G, ys?.length ? ys[0] : NaN)) {
    const [cx, cz] = at(cells[0]);
    if (Math.hypot(cx - sx, cz - sz) > 0.3) {
      pts.unshift(cx, cz);
      if (ys && up(nav)) ys.unshift(nav.h[cells[0]]);
    }
  }
  return pts;
}

/** Is a point on walkable nav ground? */
export function walkable(w: World, x: number, z: number) {
  const nav = navOf(w);
  return nav.ok[cellOf(nav.a, nav.n, z) * nav.n + cellOf(nav.a, nav.n, x)] === 1;
}

/** Distance (meters of walking) from every node to one point, by Dijkstra over the same graph. Unreachable is Infinity. */
export type Field = Float32Array;
const fields = new WeakMap<World, Map<string, Field>>();

export function fieldTo(w: World, key: string, x: number, z: number): Field {
  let byKey = fields.get(w);
  if (!byKey) fields.set(w, (byKey = new Map()));
  const got = byKey.get(key);
  if (got) return got;
  const nav = navOf(w);
  const n = nav.n;
  const G = n * n;
  const dist = new Float32Array(nav.N).fill(Infinity);
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
    if (c < G) {
      const ci = c % n;
      const cj = (c - ci) / n;
      const cut = nav.cut[c];
      for (let q = 0; q < 8; q++) {
        const [di, dj, cost] = NB[q];
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || (cut >> q) & 1) continue;
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
    for (let e = nav.eStart[c]; e < nav.eStart[c + 1]; e++) {
      const nc = nav.eTo[e];
      const d = dist[c] + nav.eCost[e];
      if (d < dist[nc]) {
        dist[nc] = d;
        push(nc, d);
      }
    }
  }
  return dist;
}

/** Walking distance left to a field's point from (x, z) (at height y, when given), or Infinity. */
export function fieldDist(w: World, f: Field, x: number, z: number, y = NaN) {
  const nav = navOf(w);
  const c = nearestOk(nav, x, z, y);
  return c < 0 ? Infinity : f[c];
}

/**
 * The next point to walk to down a field: follows the steepest descent several cells ahead, then keeps the farthest
 * of those points that is still a straight walk away. Null when (x, z) cannot reach the field's point. y is the
 * walker's height, when it may be up on a floor over the ground.
 */
export function fieldStep(w: World, f: Field, x: number, z: number, look = 8, y = NaN): [number, number] | null {
  const nav = navOf(w);
  const n = nav.n;
  const G = n * n;
  let c = nearestOk(nav, x, z, y);
  if (c < 0 || !Number.isFinite(f[c])) return null;
  const start = c;
  const chain: number[] = [];
  for (let s = 0; s < look; s++) {
    let best = c;
    if (c < G) {
      const ci = c % n;
      const cj = (c - ci) / n;
      for (let q = 0; q < 8; q++) {
        const [di, dj] = NB[q];
        const i = ci + di;
        const j = cj + dj;
        if (i < 0 || j < 0 || i >= n || j >= n || (nav.cut[c] >> q) & 1) continue;
        // the same corner rule as the field itself: no cutting diagonally past a blocked cell
        if (di !== 0 && dj !== 0 && (!nav.ok[cj * n + i] || !nav.ok[j * n + ci])) continue;
        const nc = j * n + i;
        if (f[nc] < f[best]) best = nc;
      }
    }
    for (let e = nav.eStart[c]; e < nav.eStart[c + 1]; e++) if (f[nav.eTo[e]] < f[best]) best = nav.eTo[e];
    if (best === c) break;
    c = best;
    chain.push(c);
    // (a ladder's rungs are climbed one by one)
    if (c >= G && nav.uk[c - G] === UP_LADDER) break;
  }
  if (!chain.length) return null;
  for (let k = chain.length - 1; k >= 0; k--) {
    const cc = chain[k];
    const px = nodeX(nav, cc);
    const pz = nodeZ(nav, cc);
    if (walkLine(nav, x, z, px, pz, y, start >= G || cc >= G, nav.h[cc]) || (cc >= G && nav.uk[cc - G] === UP_LADDER && k === 0)) return [px, pz];
  }
  // nothing ahead is a straight walk from here (tucked into a corner): first to the middle of the cell it stands in
  const sx = nodeX(nav, start);
  const sz = nodeZ(nav, start);
  if (Math.hypot(sx - x, sz - z) > 0.4) return [sx, sz];
  return [nodeX(nav, chain[0]), nodeZ(nav, chain[0])];
}
