// The island, the bus route and the storm for one Scramble match, all built from a seed, plus the geometry the
// simulation uses to collide and shoot. Pure, so it can be tested.
//
// Every client builds the same island from the host's seed, so placement uses only the seeded generator, + - * /
// and sqrt (exact in every engine). Trig only ever sets how something looks, never where it is.
import { rng32, rollLoot, type LootDef, type LootTier, type Rng } from './items.ts';

/** Land spans -HALF..HALF on x and z; water lies beyond. */
export const HALF = 160;
/** The sandy band along the shore. */
export const BEACH = 8;
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
export const BARREL_R = 0.55;
export const SUPPLY_HALF = 0.85;
/** Seconds a supply drop takes to float down before it lands. */
export const SUPPLY_FALL = 12;
/** Wading through a pond slows an egg to this share of its pace. */
export const POND_SLOW = 0.62;
const CELL = 8;
const COLS = Math.ceil((2 * HALF) / CELL);

export type Circle = { x: number; z: number; r: number };
export type Box = { x: number; z: number; hw: number; hd: number };
export type Rock = Circle & { look: number };
/**
 * Houses, farmhouses, sheds, warehouses, shipping containers, ruins and the Golden Coop. Walls stop eggs and bullets;
 * a roof hides what's inside from anyone outside (ruins have none). `h` is how tall the walls are drawn.
 */
export type BuildingKind = 'house' | 'farm' | 'shed' | 'warehouse' | 'container' | 'ruin' | 'coop';
export type Building = { kind: BuildingKind; x: number; z: number; w: number; d: number; walls: Box[]; look: number; roof: boolean; h: number };
export type LootSpawn = { id: number; def: LootDef; x: number; z: number };
/**
 * Crates and barrels break when shot or smacked (a barrel blows up); chests and supply drops open with the interact
 * key. A supply drop floats down from the sky and lands at match time `at`. `gold` marks the Golden Coop's chest.
 */
export type Container = { id: number; kind: 'crate' | 'chest' | 'barrel' | 'supply'; x: number; z: number; face: 1 | -1; loot: LootSpawn[]; solid: number; gold: boolean; at: number };
/** Something that stops eggs and bullets. `ref` is the tree, rock, building or container it belongs to. */
export type Solid = { shape: 'circle'; x: number; z: number; r: number; what: 'tree' | 'rock' | 'barrel'; ref: number } | { shape: 'box'; x: number; z: number; hw: number; hd: number; what: 'wall' | 'crate' | 'chest'; ref: number };

/** The bus's route; `on` and `off` are when it is over land, the only time anyone can jump. */
export type Bus = { x0: number; z0: number; x1: number; z1: number; len: number; dur: number; on: number; off: number };
export type StormCircle = { x: number; z: number; r: number };
export type Storm = { circles: StormCircle[]; starts: number[]; ends: number[] };

export type GameMap = {
  seed: number;
  trees: Circle[];
  rocks: Rock[];
  bushes: Circle[];
  /** Cornfields: walk in and nobody sees you from a distance, like a bush. */
  fields: Box[];
  /** Ponds slow anyone wading through. */
  ponds: Circle[];
  buildings: Building[];
  /** The Golden Coop's building index. */
  coop: number;
  containers: Container[];
  /** Supply drop container ids, in the order they land. */
  drops: number[];
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

export const BUS_Y = 55;
export const BUS_SPEED = 22;
export const STORM_R0 = 235;
/** Each phase: the wait before the storm moves, how long it takes to close, the new radius, and its bite per second. */
export const STORM_PHASES = [
  { wait: 70, shrink: 40, r: 110, dps: 1 },
  { wait: 40, shrink: 32, r: 62, dps: 2 },
  { wait: 32, shrink: 26, r: 32, dps: 4 },
  { wait: 24, shrink: 20, r: 15, dps: 7 },
  { wait: 18, shrink: 16, r: 6, dps: 10 },
  { wait: 12, shrink: 16, r: 0, dps: 16 },
] as const;
/** Seconds before the first three storm phases begin to move that a supply drop lands inside the circle it closes to. */
const DROP_LEAD = [10, 8, 6];

/** The buildings an island has, placed in this order (the biggest first, so they always fit). */
const PLAN: BuildingKind[] = ['coop', 'warehouse', 'warehouse', 'farm', 'farm', 'container', 'container', ...Array<BuildingKind>(9).fill('house'), ...Array<BuildingKind>(7).fill('shed'), ...Array<BuildingKind>(4).fill('ruin')];
const COUNTS = { forests: 6, forestTrees: 16, trees: 150, rocks: 70, bushes: 110, crates: 50, chests: 8, spots: 70, barrels: 14, ponds: 3 };
const FLOOR_BASE = 10_000;
const CONTAINER_BASE = 100_000;
/** Loot ids for spawns and containers stay below this; fighters number their own drops above it. */
export const DROP_BASE = 1_000_000;
const SPREAD = [
  [0, 0],
  [0.9, 0.55],
  [-0.9, 0.55],
  [0, -1],
  [0.9, -1.4],
  [-0.9, -1.4],
] as const;

const r1 = (n: number) => Math.round(n * 10) / 10;

// -------------------------------------------------------------------------------------------------------------------
// Buildings.

/** A doorway or a gap: its center along the wall and its width. */
type Gap = [center: number, width: number];

/** A straight run of wall with gaps in it, centered on (cx, cz) and running along x or along z. */
function wallLine(walls: Box[], alongX: boolean, cx: number, cz: number, len: number, gaps: Gap[]) {
  const t = WALL_T / 2;
  const pieces: [number, number][] = [];
  let at = -len / 2;
  for (const [u, width] of [...gaps].sort((a, b) => a[0] - b[0])) {
    pieces.push([at, u - width / 2]);
    at = Math.max(at, u + width / 2);
  }
  pieces.push([at, len / 2]);
  for (const [a, b] of pieces) {
    if (b - a < 0.3) continue;
    const mid = (a + b) / 2;
    const half = (b - a) / 2;
    walls.push(alongX ? { x: cx + mid, z: cz, hw: half, hd: t } : { x: cx, z: cz + mid, hw: t, hd: half });
  }
}

/** Four walls round a w by d floor. Sides: 0 north (-z), 1 south (+z), 2 west (-x), 3 east (+x). */
function shell(walls: Box[], x: number, z: number, w: number, d: number, gaps: Gap[][]) {
  for (let side = 0; side < 4; side++) {
    const alongX = side < 2;
    const len = alongX ? w + WALL_T : d - WALL_T;
    const cx = alongX ? x : side === 2 ? x - w / 2 : x + w / 2;
    const cz = alongX ? (side === 0 ? z - d / 2 : z + d / 2) : z;
    wallLine(walls, alongX, cx, cz, len, gaps[side] ?? []);
  }
}

/** Where along a wall `span` long a doorway `width` wide goes, at least a meter from either corner. */
function doorAt(rng: Rng, span: number, width: number) {
  const room = span / 2 - width / 2 - 1;
  return Math.round((rng() * 2 - 1) * room * 2) / 2;
}

const sides = (): Gap[][] => [[], [], [], []];

/** The building whose floor (inside the walls, under a roof) holds a point, or -1. */
export function buildingAt(map: GameMap, x: number, z: number) {
  for (let i = 0; i < map.buildings.length; i++) {
    const b = map.buildings[i];
    if (b.roof && Math.abs(x - b.x) < b.w / 2 - WALL_T / 2 && Math.abs(z - b.z) < b.d / 2 - WALL_T / 2) return i;
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

/** The cornfield a point stands in, or -1. */
export function fieldAt(map: GameMap, x: number, z: number) {
  for (let i = 0; i < map.fields.length; i++) {
    const f = map.fields[i];
    if (Math.abs(x - f.x) < f.hw - 0.3 && Math.abs(z - f.z) < f.hd - 0.3) return i;
  }
  return -1;
}

/** Cover that hides an egg standing in it: a bush (its index) or a cornfield (after the bushes), else -1. */
export function coverAt(map: GameMap, x: number, z: number) {
  const b = bushAt(map, x, z);
  if (b >= 0) return b;
  const f = fieldAt(map, x, z);
  return f >= 0 ? map.bushes.length + f : -1;
}

/** The pond a point is in, or -1. */
export function pondAt(map: GameMap, x: number, z: number) {
  for (let i = 0; i < map.ponds.length; i++) {
    const p = map.ponds[i];
    const dx = x - p.x;
    const dz = z - p.z;
    if (dx * dx + dz * dz < p.r * p.r) return i;
  }
  return -1;
}

function planBus(rng: Rng): Bus {
  // across the island from one side to the opposite one, passing near the middle
  const u = (rng() * 2 - 1) * 110;
  const off = (rng() * 2 - 1) * 48;
  const far = HALF + 22;
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
  const map: GameMap = {
    seed,
    trees: [],
    rocks: [],
    bushes: [],
    fields: [],
    ponds: [],
    buildings: [],
    coop: -1,
    containers: [],
    drops: [],
    floor: [],
    solids: [],
    grid: [],
    bus: planBus(rng),
    storm: planStorm(rng),
    stamp: new Uint32Array(0),
    mark: 0,
  };

  // Footprints already taken by buildings, yards and fields; everything keeps its distance from them.
  const lots: Box[] = [];
  const clear = (x: number, z: number, hw: number, hd: number, margin: number) => lots.every((l) => Math.abs(l.x - x) >= l.hw + hw + margin || Math.abs(l.z - z) >= l.hd + hd + margin);
  const nearLot = (x: number, z: number, margin: number) => lots.some((l) => Math.abs(x - l.x) < l.hw + margin && Math.abs(z - l.z) < l.hd + margin);
  const roomFor = (hw: number, hd: number) => {
    const x = Math.round((rng() * 2 - 1) * (HALF - BEACH - hw - 5));
    const z = Math.round((rng() * 2 - 1) * (HALF - BEACH - hd - 5));
    return { x, z };
  };

  const floorItems = (x: number, z: number, defs: LootDef[], base: number): LootSpawn[] => defs.slice(0, SPREAD.length).map((def, j) => ({ id: base + j, def, x: r1(x + SPREAD[j][0]), z: r1(z + SPREAD[j][1]) }));
  // ids step eight per item already placed, so no two spots can share one however many items each holds
  const addSpot = (x: number, z: number, tier: LootTier = 'floor') => {
    const defs = rollLoot(rng, tier);
    map.floor.push(...floorItems(x, z, defs, FLOOR_BASE + map.floor.length * 8));
  };
  const addContainer = (kind: Container['kind'], x: number, z: number, face: 1 | -1, tier: LootTier | null, at = 0) => {
    const id = map.containers.length;
    const defs = tier ? rollLoot(rng, tier) : [];
    const ahead = kind === 'supply' ? 1.7 : 1.3;
    const loot = defs.slice(0, SPREAD.length).map((def, j) =>
      kind === 'crate'
        ? { id: CONTAINER_BASE + id * 8 + j, def, x: r1(x + SPREAD[j][0]), z: r1(z + SPREAD[j][1]) }
        : { id: CONTAINER_BASE + id * 8 + j, def, x: r1(x + (j - (defs.length - 1) / 2) * 0.9), z: r1(z + face * ahead) },
    );
    map.containers.push({ id, kind, x: r1(x), z: r1(z), face, loot, solid: -1, gold: tier === 'gold', at });
    return id;
  };
  const quads = (b: { x: number; z: number; w: number; d: number }) =>
    [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].map(([qx, qz]) => ({ x: b.x + (qx * b.w) / 4, z: b.z + (qz * b.d) / 4, qz }));
  /** Loot in each quarter of a room, one of them a chest facing the middle. */
  const furnish = (b: { x: number; z: number; w: number; d: number }, chest: boolean) => {
    const chestAt = chest ? Math.floor(rng() * 4) : -1;
    quads(b).forEach((q, i) => {
      if (i === chestAt) addContainer('chest', q.x, q.z, q.qz > 0 ? -1 : 1, 'chest');
      else addSpot(q.x, q.z);
    });
  };

  const build = (kind: BuildingKind, x: number, z: number, w: number, d: number, walls: Box[], look: number, h: number) => {
    map.buildings.push({ kind, x, z, w, d, walls, look, roof: kind !== 'ruin', h });
    return map.buildings[map.buildings.length - 1];
  };

  // everything outdoors keeps its distance from buildings and from each other
  const taken: Circle[] = [];
  const free = (x: number, z: number, r: number) => taken.every((c) => (c.x - x) * (c.x - x) + (c.z - z) * (c.z - z) >= (c.r + r) * (c.r + r));

  const barrelsAround = (x: number, z: number, hw: number, hd: number, n: number) => {
    for (let k = 0, tries = 0; k < n && tries < n * 12; tries++) {
      const side = Math.floor(rng() * 4);
      const along = (rng() * 2 - 1) * 0.8;
      const bx = r1(side < 2 ? x + along * hw : x + (side === 2 ? -1 : 1) * (hw + 1.7));
      const bz = r1(side < 2 ? z + (side === 0 ? -1 : 1) * (hd + 1.7) : z + along * hd);
      if (Math.abs(bx) > HALF - BEACH - 2 || Math.abs(bz) > HALF - BEACH - 2 || nearLot(bx, bz, 0.9) || !free(bx, bz, 1.2)) continue;
      taken.push({ x: bx, z: bz, r: 1.2 });
      addContainer('barrel', bx, bz, 1, null);
      k++;
    }
  };

  for (const kind of PLAN) {
    for (let tries = 0; tries < 150; tries++) {
      if (kind === 'house' || kind === 'shed' || kind === 'ruin' || kind === 'coop') {
        const w = kind === 'house' ? 12 + 2 * Math.floor(rng() * 3) : kind === 'shed' ? 6 + Math.floor(rng() * 2) : kind === 'ruin' ? 10 + 2 * Math.floor(rng() * 3) : 16;
        const d = kind === 'house' ? 10 + 2 * Math.floor(rng() * 2) : kind === 'shed' ? 6 : kind === 'ruin' ? 8 + 2 * Math.floor(rng() * 2) : 12;
        const { x, z } = roomFor(w / 2, d / 2);
        if (!clear(x, z, w / 2, d / 2, kind === 'shed' ? 7 : 10)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 });
        const walls: Box[] = [];
        const gaps = sides();
        if (kind === 'house') {
          // two of the four sides get a door
          const first = Math.floor(rng() * 4);
          const second = (first + 1 + Math.floor(rng() * 3)) % 4;
          for (const s of [first, second]) gaps[s].push([doorAt(rng, s < 2 ? w : d, DOOR), DOOR]);
          shell(walls, x, z, w, d, gaps);
          build('house', x, z, w, d, walls, Math.floor(rng() * 4), WALL_H);
          furnish({ x, z, w, d }, true);
        } else if (kind === 'shed') {
          const s = Math.floor(rng() * 4);
          gaps[s].push([Math.round((rng() * 2 - 1) * 2) / 2, DOOR]);
          shell(walls, x, z, w, d, gaps);
          build('shed', x, z, w, d, walls, Math.floor(rng() * 4), 2.8);
          if (rng() < 0.5) addContainer('crate', x, z, 1, 'crate');
          else addSpot(x, z);
        } else if (kind === 'ruin') {
          // broken walls: a gap or two in every side, and no roof
          for (let s = 0; s < 4; s++) {
            const span = s < 2 ? w : d;
            const n = 1 + Math.floor(rng() * 2);
            for (let k = 0; k < n; k++) {
              const width = r1(1.6 + rng() * 2);
              gaps[s].push([r1((rng() * 2 - 1) * (span / 2 - width / 2 - 0.5)), width]);
            }
          }
          shell(walls, x, z, w, d, gaps);
          build('ruin', x, z, w, d, walls, Math.floor(rng() * 4), 2.2);
          addSpot(x, z);
          if (rng() < 0.4) {
            const q = quads({ x, z, w, d })[Math.floor(rng() * 4)];
            addContainer('crate', q.x, q.z, 1, 'crate');
          }
        } else {
          // the Golden Coop: one way in (from the south, so nothing hides the chest behind a wall), a golden chest at
          // the back and good things either side
          gaps[1].push([Math.round((rng() * 2 - 1) * 2 * 2) / 2, DOOR]);
          shell(walls, x, z, w, d, gaps);
          build('coop', x, z, w, d, walls, 0, 3.6);
          map.coop = map.buildings.length - 1;
          addContainer('chest', x, z - (d / 2 - 1.7), 1, 'gold');
          addSpot(x - w / 4, z + 1.5, 'crate');
          addSpot(x + w / 4, z + 1.5, 'crate');
        }
        break;
      }
      if (kind === 'warehouse') {
        const rot = rng() < 0.5;
        const w = rot ? 18 : 28;
        const d = rot ? 28 : 18;
        const { x, z } = roomFor(w / 2, d / 2);
        if (!clear(x, z, w / 2, d / 2, 10)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 });
        const walls: Box[] = [];
        const gaps = sides();
        // wide loading doors at both ends, and a door on one long side
        const wide = 6;
        const [e0, e1] = rot ? [0, 1] : [2, 3];
        const endSpan = rot ? w : d;
        for (const s of [e0, e1]) gaps[s].push([Math.round((rng() * 2 - 1) * (endSpan / 2 - wide / 2 - 1.5) * 2) / 2, wide]);
        const long = rot ? (rng() < 0.5 ? 2 : 3) : rng() < 0.5 ? 0 : 1;
        gaps[long].push([doorAt(rng, rot ? d : w, DOOR), DOOR]);
        shell(walls, x, z, w, d, gaps);
        build('warehouse', x, z, w, d, walls, Math.floor(rng() * 4), 4.4);
        // rows of crates with a lane down the middle, loot between, and a chest in one corner
        for (const a of [-7.5, 0, 7.5])
          for (const b of [-4.6, 4.6]) {
            const cx = rot ? x + b : x + a;
            const cz = rot ? z + a : z + b;
            if (rng() < 0.7) addContainer('crate', cx, cz, 1, 'crate');
            else addSpot(cx, cz);
          }
        addSpot(x, z, 'crate');
        // the chest in a north corner, where the tall south wall can't hide it
        const qx = rng() < 0.5 ? -1 : 1;
        addContainer('chest', x + qx * (w / 2 - 2.2), z - (d / 2 - 1.8), 1, 'chest');
        barrelsAround(x, z, w / 2, d / 2, 2 + Math.floor(rng() * 2));
        break;
      }
      if (kind === 'farm') {
        // a farmhouse of two rooms with a cornfield beside it
        const w = 22;
        const d = 16;
        const { x, z } = roomFor(w / 2 + 17, d / 2);
        const fs = rng() < 0.5 ? -1 : 1;
        const fx = x + fs * (w / 2 + 3 + 7);
        if (!clear(x, z, w / 2, d / 2, 10) || !clear(fx, z, 7, d / 2, 6)) continue;
        lots.push({ x, z, hw: w / 2, hd: d / 2 }, { x: fx, z, hw: 7, hd: d / 2 });
        map.fields.push({ x: fx, z, hw: 7, hd: d / 2 });
        const flip = rng() < 0.5 ? 1 : -1;
        const px = x + flip * (-w / 2 + 9);
        const smallC = x + flip * (-w / 2 + 4.5);
        const bigC = x + flip * 4.5;
        const bigW = 13;
        const walls: Box[] = [];
        const gaps = sides();
        gaps[flip > 0 ? 2 : 3].push([doorAt(rng, d, DOOR), DOOR]);
        gaps[flip > 0 ? 3 : 2].push([doorAt(rng, d, DOOR), DOOR]);
        const lo = bigC - x - bigW / 2 + DOOR / 2 + 1;
        const hi = bigC - x + bigW / 2 - DOOR / 2 - 1;
        gaps[rng() < 0.5 ? 0 : 1].push([Math.round((lo + rng() * (hi - lo)) * 2) / 2, DOOR]);
        shell(walls, x, z, w, d, gaps);
        wallLine(walls, false, px, z, d - WALL_T, [[doorAt(rng, d, DOOR), DOOR]]);
        build('farm', x, z, w, d, walls, Math.floor(rng() * 4), 3.4);
        addSpot(smallC, z - d / 4);
        addSpot(smallC, z + d / 4);
        furnish({ x: bigC, z, w: bigW, d }, true);
        addSpot(r1(fx + (rng() * 2 - 1) * 4), r1(z + (rng() * 2 - 1) * 5));
        break;
      }
      // a yard of shipping containers in two rows, each open at one end
      const along = rng() < 0.5;
      const hw = along ? 13 : 7;
      const hd = along ? 7 : 13;
      const { x, z } = roomFor(hw, hd);
      if (!clear(x, z, hw, hd, 9)) continue;
      lots.push({ x, z, hw, hd });
      const keep: [number, number][] = [];
      for (const a of [-8.5, 0, 8.5]) for (const b of [-3.6, 3.6]) if (rng() >= 0.2) keep.push([a, b]);
      const spots = keep.length >= 3 ? keep : [-8.5, 0, 8.5].flatMap((a) => [-3.6, 3.6].map((b): [number, number] => [a, b]));
      for (const [a, b] of spots) {
        const cx = along ? x + a : x + b;
        const cz = along ? z + b : z + a;
        const w = along ? 6.4 : 2.8;
        const d = along ? 2.8 : 6.4;
        const walls: Box[] = [];
        const gaps = sides();
        const open = along ? (rng() < 0.5 ? 2 : 3) : rng() < 0.5 ? 0 : 1;
        gaps[open].push([0, 20]);
        shell(walls, cx, cz, w, d, gaps);
        build('container', cx, cz, w, d, walls, Math.floor(rng() * 5), 2.7);
        if (rng() < 0.55) addSpot(cx, cz);
      }
      barrelsAround(x, z, hw, hd, 2 + Math.floor(rng() * 2));
      break;
    }
  }

  // ponds, kept clear of buildings and of each other
  for (let k = 0, tries = 0; k < COUNTS.ponds && tries < 200; tries++) {
    const r = 7 + Math.floor(rng() * 6);
    const x = r1((rng() * 2 - 1) * (HALF - BEACH - r - 6));
    const z = r1((rng() * 2 - 1) * (HALF - BEACH - r - 6));
    if (nearLot(x, z, r + 4) || !free(x, z, r + 6)) continue;
    map.ponds.push({ x, z, r });
    taken.push({ x, z, r: r + 1 });
    k++;
  }

  const scatter = (count: number, r: number, margin: number, put: (x: number, z: number) => void, around?: { x: number; z: number; spread: number }) => {
    let placed = 0;
    for (let tries = 0; placed < count && tries < count * 40; tries++) {
      const x = r1(around ? around.x + (rng() + rng() - 1) * around.spread : (rng() * 2 - 1) * (HALF - BEACH - 2));
      const z = r1(around ? around.z + (rng() + rng() - 1) * around.spread : (rng() * 2 - 1) * (HALF - BEACH - 2));
      if (Math.abs(x) > HALF - BEACH - 2 || Math.abs(z) > HALF - BEACH - 2) continue;
      if (nearLot(x, z, margin) || !free(x, z, r)) continue;
      taken.push({ x, z, r });
      put(x, z);
      placed++;
    }
  };

  const tree = (x: number, z: number) => map.trees.push({ x, z, r: TREE_R });
  for (let k = 0; k < COUNTS.forests; k++) {
    const cx = r1((rng() * 2 - 1) * (HALF - BEACH - 20));
    const cz = r1((rng() * 2 - 1) * (HALF - BEACH - 20));
    scatter(COUNTS.forestTrees, 2.3, 3, tree, { x: cx, z: cz, spread: 16 });
  }
  scatter(COUNTS.trees, 2.6, 3, tree);
  // a boulder keeps its whole width (up to 2.2 m) clear of every doorway, not just its middle
  scatter(COUNTS.rocks, 2.6, 5.5, (x, z) => map.rocks.push({ x, z, r: r1(1 + rng() * 1.2), look: Math.floor(rng() * 1000) }));
  scatter(COUNTS.bushes, 2, 2, (x, z) => map.bushes.push({ x, z, r: BUSH_R }));
  scatter(COUNTS.crates, 2, 3, (x, z) => addContainer('crate', x, z, 1, 'crate'));
  scatter(COUNTS.chests, 2.2, 3, (x, z) => addContainer('chest', x, z, rng() < 0.5 ? 1 : -1, 'chest'));
  scatter(COUNTS.barrels, 1.4, 3, (x, z) => addContainer('barrel', x, z, 1, null));
  scatter(COUNTS.spots, 1.6, 2, (x, z) => addSpot(x, z));

  // supply drops: each lands inside the circle the storm is about to close to, a little before it moves
  const storm = map.storm;
  for (let k = 0; k < DROP_LEAD.length; k++) {
    const c = storm.circles[k + 1];
    const at = storm.starts[k] - DROP_LEAD[k];
    let x = r1(Math.max(-(HALF - BEACH - 4), Math.min(HALF - BEACH - 4, c.x)));
    let z = r1(Math.max(-(HALF - BEACH - 4), Math.min(HALF - BEACH - 4, c.z)));
    for (let tries = 0; tries < 80; tries++) {
      const spread = c.r * (0.3 + (tries / 80) * 0.4);
      const tx = r1(c.x + (rng() * 2 - 1) * spread);
      const tz = r1(c.z + (rng() * 2 - 1) * spread);
      if (Math.abs(tx) > HALF - BEACH - 4 || Math.abs(tz) > HALF - BEACH - 4 || nearLot(tx, tz, 2) || !free(tx, tz, 2.4)) continue;
      x = tx;
      z = tz;
      break;
    }
    taken.push({ x, z, r: 2.4 });
    map.drops.push(addContainer('supply', x, z, 1, 'supply', at));
  }

  map.buildings.forEach((b, i) => {
    for (const w of b.walls) map.solids.push({ shape: 'box', ...w, what: 'wall', ref: i });
  });
  map.trees.forEach((t, i) => map.solids.push({ shape: 'circle', x: t.x, z: t.z, r: t.r, what: 'tree', ref: i }));
  map.rocks.forEach((r, i) => map.solids.push({ shape: 'circle', x: r.x, z: r.z, r: r.r, what: 'rock', ref: i }));
  for (const c of map.containers) {
    c.solid = map.solids.length;
    if (c.kind === 'crate') map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: CRATE_HALF, hd: CRATE_HALF, what: 'crate', ref: c.id });
    else if (c.kind === 'barrel') map.solids.push({ shape: 'circle', x: c.x, z: c.z, r: BARREL_R, what: 'barrel', ref: c.id });
    else if (c.kind === 'supply') map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: SUPPLY_HALF, hd: SUPPLY_HALF, what: 'chest', ref: c.id });
    else map.solids.push({ shape: 'box', x: c.x, z: c.z, hw: CHEST_HW, hd: CHEST_HD, what: 'chest', ref: c.id });
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
