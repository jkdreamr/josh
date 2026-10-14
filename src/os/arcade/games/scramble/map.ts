// The island, the bus route and the storm for one Scramble match, all built from a seed, plus the geometry the
// simulation uses to collide and shoot. Pure, so it can be tested.
//
// Every client builds the same island from the host's seed, so placement uses only the seeded generator, + - * /
// and sqrt (exact in every engine). Trig only ever sets how something looks, never where it is.
import { rng32, rollLoot, type LootDef, type Rng } from './items.ts';

/** Land spans -HALF..HALF on x and z; water lies beyond. */
export const HALF = 100;
/** The sandy band along the shore. */
export const BEACH = 7;
/** Fighters stop this far inside the shore. */
export const EDGE = HALF - 0.8;
export const WALL_T = 0.5;
export const WALL_H = 3.2;
export const DOOR = 2.8;
export const TREE_R = 0.7;
export const BUSH_R = 1.6;
export const CRATE_HALF = 0.7;
export const CHEST_HW = 0.65;
export const CHEST_HD = 0.42;
const CELL = 8;
const COLS = Math.ceil((2 * HALF) / CELL);

export type Circle = { x: number; z: number; r: number };
export type Box = { x: number; z: number; hw: number; hd: number };
export type Rock = Circle & { look: number };
export type Building = { x: number; z: number; w: number; d: number; walls: Box[]; look: number };
export type LootSpawn = { id: number; def: LootDef; x: number; z: number };
/** Crates break open when shot or smacked; chests open with the interact key. Both spill loot. */
export type Container = { id: number; kind: 'crate' | 'chest'; x: number; z: number; face: 1 | -1; loot: LootSpawn[]; solid: number };
/** Something that stops eggs and bullets. `ref` is the tree, rock, building or container it belongs to. */
export type Solid = { shape: 'circle'; x: number; z: number; r: number; what: 'tree' | 'rock'; ref: number } | { shape: 'box'; x: number; z: number; hw: number; hd: number; what: 'wall' | 'crate' | 'chest'; ref: number };

/** The bus's route; `on` and `off` are when it is over land, the only time anyone can jump. */
export type Bus = { x0: number; z0: number; x1: number; z1: number; len: number; dur: number; on: number; off: number };
export type StormCircle = { x: number; z: number; r: number };
export type Storm = { circles: StormCircle[]; starts: number[]; ends: number[] };

export type GameMap = {
  seed: number;
  trees: Circle[];
  rocks: Rock[];
  bushes: Circle[];
  buildings: Building[];
  containers: Container[];
  floor: LootSpawn[];
  solids: Solid[];
  /** Solid indices per grid cell. */
  grid: number[][];
  bus: Bus;
  storm: Storm;
  /** Scratch for de-duplicating grid queries. */
  stamp: Uint32Array;
  mark: number;
};

export const BUS_Y = 46;
export const BUS_SPEED = 21;
export const STORM_R0 = 150;
/** Each phase: the wait before the storm moves, how long it takes to close, the new radius, and its bite per second. */
export const STORM_PHASES = [
  { wait: 52, shrink: 30, r: 72, dps: 1 },
  { wait: 28, shrink: 24, r: 40, dps: 2 },
  { wait: 24, shrink: 20, r: 20, dps: 5 },
  { wait: 18, shrink: 15, r: 9, dps: 8 },
  { wait: 14, shrink: 14, r: 3, dps: 12 },
  { wait: 10, shrink: 14, r: 0, dps: 20 },
] as const;

const COUNTS = { buildings: 7, trees: 120, rocks: 30, bushes: 42, crates: 26, chests: 4, spots: 24 };
const FLOOR_BASE = 10_000;
const CONTAINER_BASE = 100_000;
/** Loot ids for spawns and containers stay below this; fighters number their own drops above it. */
export const DROP_BASE = 1_000_000;
const SPREAD = [
  [0, 0],
  [0.9, 0.55],
  [-0.9, 0.55],
  [0, -1],
] as const;

const r1 = (n: number) => Math.round(n * 10) / 10;

function makeBuilding(rng: Rng, x: number, z: number, w: number, d: number): Building {
  const walls: Box[] = [];
  const t = WALL_T / 2;
  // two of the four sides get a door
  const first = Math.floor(rng() * 4);
  const second = (first + 1 + Math.floor(rng() * 3)) % 4;
  for (let side = 0; side < 4; side++) {
    const alongX = side < 2;
    const len = alongX ? w + WALL_T : d - WALL_T;
    const cx = alongX ? x : side === 2 ? x - w / 2 : x + w / 2;
    const cz = alongX ? (side === 0 ? z - d / 2 : z + d / 2) : z;
    const door = side === first || side === second;
    const pieces: [number, number][] = [];
    if (!door) pieces.push([-len / 2, len / 2]);
    else {
      const room = (alongX ? w : d) / 2 - 2.4;
      const u = Math.round((rng() * 2 - 1) * room * 2) / 2;
      pieces.push([-len / 2, u - DOOR / 2], [u + DOOR / 2, len / 2]);
    }
    for (const [a, b] of pieces) {
      if (b - a < 0.3) continue;
      const mid = (a + b) / 2;
      const half = (b - a) / 2;
      walls.push(alongX ? { x: cx + mid, z: cz, hw: half, hd: t } : { x: cx, z: cz + mid, hw: t, hd: half });
    }
  }
  return { x, z, w, d, walls, look: Math.floor(rng() * 4) };
}

/** The building whose floor (inside the walls) holds a point, or -1. */
export function buildingAt(map: GameMap, x: number, z: number) {
  for (let i = 0; i < map.buildings.length; i++) {
    const b = map.buildings[i];
    if (Math.abs(x - b.x) < b.w / 2 - WALL_T / 2 && Math.abs(z - b.z) < b.d / 2 - WALL_T / 2) return i;
  }
  return -1;
}

/** The bush hiding a point, or -1. */
export function bushAt(map: GameMap, x: number, z: number) {
  for (let i = 0; i < map.bushes.length; i++) {
    const b = map.bushes[i];
    const dx = x - b.x;
    const dz = z - b.z;
    if (dx * dx + dz * dz < b.r * b.r * 0.72) return i;
  }
  return -1;
}

function planBus(rng: Rng): Bus {
  // across the island from one side to the opposite one, passing near the middle
  const u = (rng() * 2 - 1) * 70;
  const off = (rng() * 2 - 1) * 30;
  const far = HALF + 18;
  const side = Math.floor(rng() * 4);
  let x0: number, z0: number, x1: number, z1: number;
  if (side === 0) [x0, z0, x1, z1] = [u, -far, -u + off, far];
  else if (side === 1) [x0, z0, x1, z1] = [u, far, -u + off, -far];
  else if (side === 2) [x0, z0, x1, z1] = [-far, u, far, -u + off];
  else [x0, z0, x1, z1] = [far, u, -far, -u + off];
  const len = Math.sqrt((x1 - x0) * (x1 - x0) + (z1 - z0) * (z1 - z0));
  const dx = (x1 - x0) / len;
  const dz = (z1 - z0) / len;
  // over land a couple of meters in from the shore, found from both ends of the route
  const land = EDGE - 2;
  const enter = rayBox(x0, z0, dx, dz, len, 0, 0, land, land);
  const leave = rayBox(x1, z1, -dx, -dz, len, 0, 0, land, land);
  return { x0, z0, x1, z1, len, dur: len / BUS_SPEED, on: enter / BUS_SPEED, off: (len - leave) / BUS_SPEED };
}

function planStorm(rng: Rng): Storm {
  const circles: StormCircle[] = [{ x: 0, z: 0, r: STORM_R0 }];
  const starts: number[] = [];
  const ends: number[] = [];
  let t = 0;
  for (const phase of STORM_PHASES) {
    const prev = circles[circles.length - 1];
    const room = Math.max(0, prev.r - phase.r);
    // the land a circle of this size may sit on, so the last circles are never out at sea
    const limit = HALF - BEACH - Math.max(phase.r * 0.6, 4);
    let next = { x: Math.max(-limit, Math.min(limit, prev.x)), z: Math.max(-limit, Math.min(limit, prev.z)), r: phase.r };
    for (let i = 0; i < 40; i++) {
      // rounded first, so the circle that's stored is the one that was checked
      const x = r1(prev.x + (rng() * 2 - 1) * room);
      const z = r1(prev.z + (rng() * 2 - 1) * room);
      if ((x - prev.x) * (x - prev.x) + (z - prev.z) * (z - prev.z) > room * room || Math.abs(x) > limit || Math.abs(z) > limit) continue;
      next = { x, z, r: phase.r };
      break;
    }
    circles.push(next);
    t += phase.wait;
    starts.push(t);
    t += phase.shrink;
    ends.push(t);
  }
  return { circles, starts, ends };
}

/** When the last circle has closed. */
export const stormEnd = (s: Storm) => s.ends[s.ends.length - 1];

export type StormNow = {
  x: number;
  z: number;
  r: number;
  /** Where the storm is headed next (the same circle once it has fully closed). */
  next: StormCircle;
  shrinking: boolean;
  /** Seconds until the storm starts moving, or until it stops when shrinking. */
  timer: number;
  /** Health per second outside the circle. */
  dps: number;
  /** 0 before the first shrink, then the phase being closed or waited out. */
  phase: number;
};

export function stormAt(s: Storm, time: number): StormNow {
  const n = s.starts.length;
  for (let i = 0; i < n; i++) {
    const a = s.circles[i];
    const b = s.circles[i + 1];
    const dps = STORM_PHASES[i].dps;
    if (time < s.starts[i]) return { x: a.x, z: a.z, r: a.r, next: b, shrinking: false, timer: s.starts[i] - time, dps: i === 0 ? 0 : STORM_PHASES[i - 1].dps, phase: i };
    if (time < s.ends[i]) {
      const f = (time - s.starts[i]) / (s.ends[i] - s.starts[i]);
      return { x: a.x + (b.x - a.x) * f, z: a.z + (b.z - a.z) * f, r: a.r + (b.r - a.r) * f, next: b, shrinking: true, timer: s.ends[i] - time, dps, phase: i + 1 };
    }
  }
  const last = s.circles[n];
  return { x: last.x, z: last.z, r: last.r, next: last, shrinking: false, timer: 0, dps: STORM_PHASES[n - 1].dps, phase: n };
}

/** Where the bus is at a match time (it waits at the start during the countdown). */
export function busAt(bus: Bus, time: number) {
  const f = Math.max(0, Math.min(1, time / bus.dur));
  return { x: bus.x0 + (bus.x1 - bus.x0) * f, z: bus.z0 + (bus.z1 - bus.z0) * f };
}

const cellOf = (v: number) => Math.max(0, Math.min(COLS - 1, Math.floor((v + HALF) / CELL)));

function index(map: GameMap) {
  map.grid = Array.from({ length: COLS * COLS }, () => []);
  map.solids.forEach((s, i) => {
    // a little margin, so a ray grazing a cell corner still meets everything near it
    const rx = (s.shape === 'circle' ? s.r : s.hw) + 0.5;
    const rz = (s.shape === 'circle' ? s.r : s.hd) + 0.5;
    for (let cz = cellOf(s.z - rz); cz <= cellOf(s.z + rz); cz++) for (let cx = cellOf(s.x - rx); cx <= cellOf(s.x + rx); cx++) map.grid[cx + cz * COLS].push(i);
  });
  map.stamp = new Uint32Array(map.solids.length);
  map.mark = 0;
}

export function generateMap(seed: number): GameMap {
  const rng = rng32(seed);
  const map: GameMap = { seed, trees: [], rocks: [], bushes: [], buildings: [], containers: [], floor: [], solids: [], grid: [], bus: planBus(rng), storm: planStorm(rng), stamp: new Uint32Array(0), mark: 0 };

  for (let tries = 0; map.buildings.length < COUNTS.buildings && tries < 600; tries++) {
    const w = 12 + 2 * Math.floor(rng() * 3);
    const d = 10 + 2 * Math.floor(rng() * 2);
    const x = Math.round((rng() * 2 - 1) * (HALF - BEACH - w / 2 - 6));
    const z = Math.round((rng() * 2 - 1) * (HALF - BEACH - d / 2 - 6));
    if (map.buildings.some((b) => Math.abs(b.x - x) < (b.w + w) / 2 + 12 && Math.abs(b.z - z) < (b.d + d) / 2 + 12)) continue;
    map.buildings.push(makeBuilding(rng, x, z, w, d));
  }

  // everything outdoors keeps its distance from buildings and from each other
  const taken: Circle[] = [];
  const nearBuilding = (x: number, z: number, margin: number) => map.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + margin && Math.abs(z - b.z) < b.d / 2 + margin);
  const free = (x: number, z: number, r: number) => taken.every((c) => (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) >= (c.r + r) * (c.r + r));
  const scatter = (count: number, r: number, margin: number, put: (x: number, z: number) => void) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = r1((rng() * 2 - 1) * (HALF - BEACH - 2));
      const z = r1((rng() * 2 - 1) * (HALF - BEACH - 2));
      if (nearBuilding(x, z, margin) || !free(x, z, r)) continue;
      taken.push({ x, z, r });
      put(x, z);
      placed++;
    }
  };

  const floorItems = (x: number, z: number, defs: LootDef[], base: number): LootSpawn[] => defs.slice(0, SPREAD.length).map((def, j) => ({ id: base + j, def, x: r1(x + SPREAD[j][0]), z: r1(z + SPREAD[j][1]) }));
  // ids step four per item already placed, so no two spots can share one however many items each holds
  const addSpot = (x: number, z: number) => {
    const defs = rollLoot(rng, 'floor');
    map.floor.push(...floorItems(x, z, defs, FLOOR_BASE + map.floor.length * 4));
  };
  const addContainer = (kind: 'crate' | 'chest', x: number, z: number, face: 1 | -1) => {
    const id = map.containers.length;
    const defs = rollLoot(rng, kind);
    const loot = defs.slice(0, SPREAD.length).map((def, j) =>
      kind === 'chest'
        ? { id: CONTAINER_BASE + id * 8 + j, def, x: r1(x + (j - (defs.length - 1) / 2) * 0.9), z: r1(z + face * 1.3) }
        : { id: CONTAINER_BASE + id * 8 + j, def, x: r1(x + SPREAD[j][0]), z: r1(z + SPREAD[j][1]) },
    );
    map.containers.push({ id, kind, x, z, face, loot, solid: -1 });
  };

  for (const b of map.buildings) {
    const quads = [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ] as const;
    const chestAt = Math.floor(rng() * 4);
    quads.forEach(([qx, qz], i) => {
      const x = b.x + (qx * b.w) / 4;
      const z = b.z + (qz * b.d) / 4;
      if (i === chestAt) addContainer('chest', x, z, qz > 0 ? -1 : 1);
      else addSpot(x, z);
    });
  }
  scatter(COUNTS.trees, 2.6, 3, (x, z) => map.trees.push({ x, z, r: TREE_R }));
  scatter(COUNTS.rocks, 2.6, 3, (x, z) => map.rocks.push({ x, z, r: r1(1 + rng()), look: Math.floor(rng() * 1000) }));
  scatter(COUNTS.bushes, 2, 2, (x, z) => map.bushes.push({ x, z, r: BUSH_R }));
  scatter(COUNTS.crates, 2, 3, (x, z) => addContainer('crate', x, z, 1));
  scatter(COUNTS.chests, 2.2, 3, (x, z) => addContainer('chest', x, z, rng() < 0.5 ? 1 : -1));
  scatter(COUNTS.spots, 1.6, 2, (x, z) => addSpot(x, z));

  map.buildings.forEach((b, i) => {
    for (const w of b.walls) map.solids.push({ shape: 'box', ...w, what: 'wall', ref: i });
  });
  map.trees.forEach((t, i) => map.solids.push({ shape: 'circle', x: t.x, z: t.z, r: t.r, what: 'tree', ref: i }));
  map.rocks.forEach((r, i) => map.solids.push({ shape: 'circle', x: r.x, z: r.z, r: r.r, what: 'rock', ref: i }));
  for (const c of map.containers) {
    c.solid = map.solids.length;
    map.solids.push(c.kind === 'crate' ? { shape: 'box', x: c.x, z: c.z, hw: CRATE_HALF, hd: CRATE_HALF, what: 'crate', ref: c.id } : { shape: 'box', x: c.x, z: c.z, hw: CHEST_HW, hd: CHEST_HD, what: 'chest', ref: c.id });
  }
  index(map);
  return map;
}

// -------------------------------------------------------------------------------------------------------------------
// Geometry. Rays take a unit direction and a length and return the distance to the first contact (0 when the start
// is already inside), or Infinity for a miss.

export function rayCircle(ox: number, oz: number, dx: number, dz: number, len: number, cx: number, cz: number, r: number) {
  const fx = ox - cx;
  const fz = oz - cz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return 0;
  const b = fx * dx + fz * dz;
  if (b > 0) return Infinity;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t <= len ? t : Infinity;
}

export function rayBox(ox: number, oz: number, dx: number, dz: number, len: number, bx: number, bz: number, hw: number, hd: number) {
  let lo = 0;
  let hi = len;
  if (Math.abs(dx) < 1e-12) {
    if (ox < bx - hw || ox > bx + hw) return Infinity;
  } else {
    let a = (bx - hw - ox) / dx;
    let b = (bx + hw - ox) / dx;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return Infinity;
  }
  if (Math.abs(dz) < 1e-12) {
    if (oz < bz - hd || oz > bz + hd) return Infinity;
  } else {
    let a = (bz - hd - oz) / dz;
    let b = (bz + hd - oz) / dz;
    if (a > b) [a, b] = [b, a];
    lo = Math.max(lo, a);
    hi = Math.min(hi, b);
    if (lo > hi) return Infinity;
  }
  return lo;
}

/** A box turned so its depth axis points along (sin a, cos a): built walls face the way their builder aimed. */
export type Obb = { x: number; z: number; sa: number; ca: number; hw: number; hd: number };

export function rayObb(ox: number, oz: number, dx: number, dz: number, len: number, o: Obb) {
  // local axes: u along the wall (cos a, -sin a), v through it (sin a, cos a)
  const px = ox - o.x;
  const pz = oz - o.z;
  const u = px * o.ca - pz * o.sa;
  const v = px * o.sa + pz * o.ca;
  const du = dx * o.ca - dz * o.sa;
  const dv = dx * o.sa + dz * o.ca;
  return rayBox(u, v, du, dv, len, 0, 0, o.hw, o.hd);
}

export type Push = { x: number; z: number };

/** How far to move a circle so it no longer overlaps a circle, or null when it doesn't. */
export function pushCircle(x: number, z: number, r: number, cx: number, cz: number, cr: number): Push | null {
  const dx = x - cx;
  const dz = z - cz;
  const d2 = dx * dx + dz * dz;
  const min = r + cr;
  if (d2 >= min * min) return null;
  const d = Math.sqrt(d2);
  if (d < 1e-6) return { x: min, z: 0 };
  const k = (min - d) / d;
  return { x: dx * k, z: dz * k };
}

export function pushBox(x: number, z: number, r: number, bx: number, bz: number, hw: number, hd: number): Push | null {
  const qx = Math.max(bx - hw, Math.min(bx + hw, x));
  const qz = Math.max(bz - hd, Math.min(bz + hd, z));
  const dx = x - qx;
  const dz = z - qz;
  const d2 = dx * dx + dz * dz;
  if (d2 >= r * r) return null;
  if (d2 > 1e-12) {
    const d = Math.sqrt(d2);
    const k = (r - d) / d;
    return { x: dx * k, z: dz * k };
  }
  // the center is inside: out through the nearest face
  const left = x - (bx - hw);
  const right = bx + hw - x;
  const top = z - (bz - hd);
  const bottom = bz + hd - z;
  const m = Math.min(left, right, top, bottom);
  if (m === left) return { x: -(left + r), z: 0 };
  if (m === right) return { x: right + r, z: 0 };
  if (m === top) return { x: 0, z: -(top + r) };
  return { x: 0, z: bottom + r };
}

export function pushObb(x: number, z: number, r: number, o: Obb): Push | null {
  const px = x - o.x;
  const pz = z - o.z;
  const u = px * o.ca - pz * o.sa;
  const v = px * o.sa + pz * o.ca;
  const p = pushBox(u, v, r, 0, 0, o.hw, o.hd);
  if (!p) return null;
  // back to world axes
  return { x: p.x * o.ca + p.z * o.sa, z: -p.x * o.sa + p.z * o.ca };
}

/** Visits the grid cells a segment crosses, in order, until `visit` returns true. */
export function walkCells(x0: number, z0: number, x1: number, z1: number, visit: (cell: number) => boolean | void) {
  const fx0 = (x0 + HALF) / CELL;
  const fz0 = (z0 + HALF) / CELL;
  const fx1 = (x1 + HALF) / CELL;
  const fz1 = (z1 + HALF) / CELL;
  let ix = Math.floor(fx0);
  let iz = Math.floor(fz0);
  const ex = Math.floor(fx1);
  const ez = Math.floor(fz1);
  const dx = fx1 - fx0;
  const dz = fz1 - fz0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const sz = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tdx = sx ? Math.abs(1 / dx) : Infinity;
  const tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tmx = sx > 0 ? (ix + 1 - fx0) * tdx : sx < 0 ? (fx0 - ix) * tdx : Infinity;
  let tmz = sz > 0 ? (iz + 1 - fz0) * tdz : sz < 0 ? (fz0 - iz) * tdz : Infinity;
  const steps = Math.abs(ex - ix) + Math.abs(ez - iz);
  for (let i = 0; i <= steps; i++) {
    if (ix >= 0 && iz >= 0 && ix < COLS && iz < COLS && visit(ix + iz * COLS)) return;
    if (tmx < tmz) {
      tmx += tdx;
      ix += sx;
    } else {
      tmz += tdz;
      iz += sz;
    }
  }
}

/** Each solid whose grid cells touch the square around a point, once. */
export function solidsNear(map: GameMap, x: number, z: number, r: number, visit: (i: number, s: Solid) => void) {
  const mark = nextMark(map);
  for (let cz = cellOf(z - r); cz <= cellOf(z + r); cz++)
    for (let cx = cellOf(x - r); cx <= cellOf(x + r); cx++)
      for (const i of map.grid[cx + cz * COLS]) {
        if (map.stamp[i] === mark) continue;
        map.stamp[i] = mark;
        visit(i, map.solids[i]);
      }
}

/** Each solid in the cells along a segment, once, in roughly near-to-far order. */
export function solidsAlong(map: GameMap, x0: number, z0: number, x1: number, z1: number, visit: (i: number, s: Solid) => void) {
  const mark = nextMark(map);
  walkCells(x0, z0, x1, z1, (cell) => {
    for (const i of map.grid[cell]) {
      if (map.stamp[i] === mark) continue;
      map.stamp[i] = mark;
      visit(i, map.solids[i]);
    }
  });
}

function nextMark(map: GameMap) {
  map.mark = (map.mark + 1) >>> 0;
  if (map.mark === 0) {
    map.stamp.fill(0);
    map.mark = 1;
  }
  return map.mark;
}

/** Distance along a ray to a solid. */
export function raySolid(s: Solid, ox: number, oz: number, dx: number, dz: number, len: number) {
  return s.shape === 'circle' ? rayCircle(ox, oz, dx, dz, len, s.x, s.z, s.r) : rayBox(ox, oz, dx, dz, len, s.x, s.z, s.hw, s.hd);
}
