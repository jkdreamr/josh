// The map: a Stanford campus floating over the void. Team islands with a red tile forge pavilion, palms and golden
// poppies; diamond islands on the corners; the Main Quad in the middle with arcades, emerald generators and Hoover
// Tower. Generated from the mode alone (no randomness that is not seeded), so only edits ever travel online.
import {
  AIR,
  BED_FOOT,
  BED_HEAD,
  COBBLE,
  CREAM,
  CREAM_WINDOW,
  DIAMOND_BLOCK,
  DIRT,
  EMERALD_BLOCK,
  FORGE,
  GLASS,
  GOLD_BLOCK,
  GRASS,
  IRON_BLOCK,
  LAMP,
  LEAVES,
  PALM_LOG,
  POPPY,
  ROOF,
  SANDBRICK,
  SANDSTONE,
  STONE,
  SX,
  TALLGRASS,
  TEAMS,
  TILE_FLOOR,
  WATER,
} from './blocks.ts';
import { World } from './world.ts';

export type Mode = 'solo' | 'doubles';
export const MODES: readonly Mode[] = ['solo', 'doubles'];
export const teamsFor = (mode: Mode) => (mode === 'solo' ? 8 : 4);
export const perTeam = (mode: Mode) => (mode === 'solo' ? 1 : 2);

/** Island top surface; players stand at TOP + 1. */
export const TOP = 30;
export const MID_TOP = 31;
export const BUILD_MAX = 56;
export const VOID_Y = -6;
export const CENTER = SX / 2;

export type Vec3 = [number, number, number];
export type Box = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };

export type TeamSite = {
  team: number;
  /** Where players appear, standing position (block center). */
  spawn: Vec3;
  /** Facing at spawn (toward the middle), as Body.yaw. */
  yaw: number;
  /** Where iron and gold appear. */
  forge: Vec3;
  bedFoot: Vec3;
  bedHead: Vec3;
  /** LADDER_DIRS index the bed points (foot to head). */
  bedDir: number;
  shop: Vec3;
  upgrades: Vec3;
  /** The island's footprint, for the heal pool and traps. */
  base: Box;
  /** Center of the island and its forward direction. */
  cx: number;
  cz: number;
  fx: number;
  fz: number;
};

export type GenSite = { kind: 'diamond' | 'emerald'; x: number; y: number; z: number };

export type MapInfo = {
  mode: Mode;
  teams: TeamSite[];
  gens: GenSite[];
  /** No blocks may be placed inside these (spawns, forges, shops, generators). */
  noBuild: Box[];
};

/** Small deterministic hash noise. */
function hash(x: number, z: number, s = 0) {
  let h = Math.imul(x * 374761393 + z * 668265263 + s * 1442695041, 1274126177) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Where each team's island goes: two per side of a square for eight teams, one per side for four. */
export function islandLayout(mode: Mode): { cx: number; cz: number; fx: number; fz: number }[] {
  const C = CENTER;
  if (mode === 'doubles') {
    const D = 50;
    return [
      { cx: C, cz: C - D, fx: 0, fz: 1 },
      { cx: C + D, cz: C, fx: -1, fz: 0 },
      { cx: C, cz: C + D, fx: 0, fz: -1 },
      { cx: C - D, cz: C, fx: 1, fz: 0 },
    ];
  }
  const D = 56;
  const L = 22;
  return [
    { cx: C - L, cz: C - D, fx: 0, fz: 1 },
    { cx: C + L, cz: C - D, fx: 0, fz: 1 },
    { cx: C + D, cz: C - L, fx: -1, fz: 0 },
    { cx: C + D, cz: C + L, fx: -1, fz: 0 },
    { cx: C + L, cz: C + D, fx: 0, fz: -1 },
    { cx: C - L, cz: C + D, fx: 0, fz: -1 },
    { cx: C - D, cz: C + L, fx: 1, fz: 0 },
    { cx: C - D, cz: C - L, fx: 1, fz: 0 },
  ];
}

/** Ladder direction index for a forward step. */
const dirOf = (fx: number, fz: number) => (fx === 1 ? 0 : fx === -1 ? 1 : fz === 1 ? 2 : 3);
/** Body.yaw that faces (fx, fz): forward is (-sin, -cos). */
export const yawOf = (fx: number, fz: number) => Math.atan2(-fx, -fz);

/** Builds the map into a fresh world. */
export function generate(mode: Mode): { world: World; info: MapInfo } {
  const world = new World();
  world.generating = true;
  const set = (x: number, y: number, z: number, id: number) => world.set(x, y, z, id);
  const info: MapInfo = { mode, teams: [], gens: [], noBuild: [] };
  const n = teamsFor(mode);
  const layout = islandLayout(mode);

  for (let t = 0; t < n; t++) {
    const L = layout[t];
    // island frame: v forward (toward the middle), u to the right
    const rx = -L.fz;
    const rz = L.fx;
    const at = (u: number, v: number): [number, number] => [L.cx + u * rx + v * L.fx, L.cz + u * rz + v * L.fz];
    const put = (u: number, y: number, v: number, id: number) => {
      const [x, z] = at(u, v);
      set(x, y, z, id);
    };
    const U = 7;
    const V0 = -11;
    const V1 = 9;
    // the floating island: a rounded slab that tapers into the void
    for (let u = -U - 1; u <= U + 1; u++)
      for (let v = V0 - 1; v <= V1 + 1; v++) {
        const [x, z] = at(u, v);
        const eu = Math.max(0, Math.abs(u) - U);
        const ev = v < V0 ? V0 - v : v > V1 ? v - V1 : 0;
        const corner = Math.abs(u) >= U && (v <= V0 || v >= V1);
        if (eu + ev > 0 || corner) continue;
        const du = Math.abs(u) / (U + 0.5);
        const dv = Math.abs(v - (V0 + V1) / 2) / ((V1 - V0) / 2 + 0.5);
        const r = Math.max(du, dv);
        const depth = Math.max(1, Math.round((1 - r * r) * 7 + hash(x, z, t) * 2.5));
        for (let d = 0; d <= depth; d++) set(x, TOP - d, z, d === 0 ? GRASS : d < 3 ? DIRT : hash(x, z + d, 7) < 0.25 ? COBBLE : STONE);
      }
    // sandstone walk from the forge to the front edge and a plaza around spawn
    for (let v = V0 + 1; v <= V1; v++) for (let u = -1; u <= 1; u++) put(u, TOP, v, (v + u) % 2 === 0 ? SANDSTONE : TILE_FLOOR);
    for (let u = -3; u <= 3; u++) for (let v = -5; v <= -1; v++) if (Math.abs(u) > 1) put(u, TOP, v, (u + v) % 2 === 0 ? SANDSTONE : TILE_FLOOR);
    // the forge under a red tile pavilion, Main Quad style
    for (let u = -1; u <= 1; u++) for (let v = -9; v <= -7; v++) put(u, TOP, v, u === 0 && v === -8 ? IRON_BLOCK : FORGE);
    for (const u of [-2, 2])
      for (const v of [-10, -6]) for (let y = TOP + 1; y <= TOP + 3; y++) put(u, y, v, SANDBRICK);
    for (let u = -3; u <= 3; u++) for (let v = -11; v <= -5; v++) put(u, TOP + 4, v, Math.abs(u) === 3 || v === -11 || v === -5 ? ROOF : SANDBRICK);
    for (let u = -2; u <= 2; u++) for (let v = -10; v <= -6; v++) put(u, TOP + 5, v, ROOF);
    for (let u = -1; u <= 1; u++) for (let v = -9; v <= -7; v++) put(u, TOP + 6, v, ROOF);
    put(0, TOP + 7, -8, ROOF);
    // lamps by the shops
    for (const u of [-4, 4]) {
      put(u, TOP + 1, -6, FORGE);
      put(u, TOP + 2, -6, LAMP);
    }
    // a palm in a back corner and one at the front
    palm(world, ...at(-6, -9), TOP + 1, 7, t * 3 + 1);
    palm(world, ...at(6, 7), TOP + 1, 7, t * 3 + 2);
    // poppies and grass tufts
    for (let u = -U; u <= U; u++)
      for (let v = V0; v <= V1; v++) {
        if (Math.abs(u) <= 3 && v > -12 && v < 0) continue;
        if (Math.abs(u) <= 1) continue;
        if (Math.abs(u) <= 2 && v >= 2 && v <= 7) continue;
        const [x, z] = at(u, v);
        if (world.get(x, TOP, z) !== GRASS || world.get(x, TOP + 1, z) !== AIR) continue;
        const h = hash(x, z, 99);
        if (h < 0.07) set(x, TOP + 1, z, POPPY);
        else if (h < 0.2) set(x, TOP + 1, z, TALLGRASS);
      }
    // the bed, pointing at the middle
    const [fx0, fz0] = at(0, 4);
    const [hx0, hz0] = at(0, 5);
    set(fx0, TOP + 1, fz0, BED_FOOT + t);
    set(hx0, TOP + 1, hz0, BED_HEAD + t);
    world.bedDir[t] = dirOf(L.fx, L.fz);
    const [sx, sz] = at(0, -3);
    const [gx, gz] = at(0, -8);
    const [px, pz] = at(-4, -2);
    const [ux, uz] = at(4, -2);
    const site: TeamSite = {
      team: t,
      spawn: [sx + 0.5, TOP + 1, sz + 0.5],
      yaw: yawOf(L.fx, L.fz),
      forge: [gx + 0.5, TOP + 1, gz + 0.5],
      bedFoot: [fx0, TOP + 1, fz0],
      bedHead: [hx0, TOP + 1, hz0],
      bedDir: dirOf(L.fx, L.fz),
      shop: [px + 0.5, TOP + 1, pz + 0.5],
      upgrades: [ux + 0.5, TOP + 1, uz + 0.5],
      base: boxAround(at, -U - 1, V0 - 1, U + 1, V1 + 1, TOP - 8, TOP + 20),
      cx: L.cx,
      cz: L.cz,
      fx: L.fx,
      fz: L.fz,
    };
    info.teams.push(site);
    info.noBuild.push(boxAround(at, -1, -4, 1, -2, TOP + 1, TOP + 3));
    info.noBuild.push(boxAround(at, -2, -10, 2, -6, TOP + 1, TOP + 3));
    info.noBuild.push(boxAround(at, -5, -3, -3, -1, TOP + 1, TOP + 3));
    info.noBuild.push(boxAround(at, 3, -3, 5, -1, TOP + 1, TOP + 3));
  }

  // diamond islands on the corners
  const dd = mode === 'solo' ? 40 : 36;
  const corners: [number, number][] = [
    [CENTER - dd, CENTER - dd],
    [CENTER + dd, CENTER - dd],
    [CENTER + dd, CENTER + dd],
    [CENTER - dd, CENTER + dd],
  ];
  corners.forEach(([cx, cz], i) => {
    blob(world, cx, cz, 4.6, TOP, 6, 30 + i);
    for (let x = cx - 1; x <= cx + 1; x++) for (let z = cz - 1; z <= cz + 1; z++) set(x, TOP, z, SANDSTONE);
    set(cx, TOP, cz, DIAMOND_BLOCK);
    // the corner toward the void gets a palm
    const ox = cx < CENTER ? -3 : 3;
    const oz = cz < CENTER ? -3 : 3;
    palm(world, cx + ox, cz + oz, TOP + 1, 6, 40 + i);
    info.gens.push({ kind: 'diamond', x: cx + 0.5, y: TOP + 1, z: cz + 0.5 });
    info.noBuild.push({ x0: cx - 1, y0: TOP + 1, z0: cz - 1, x1: cx + 2, y1: TOP + 3, z1: cz + 2 });
  });

  mid(world, info);
  world.generating = false;
  world.computeTops();
  world.markAllDirty();
  world.edits.clear();
  return { world, info };
}

/** A box in world space from island-frame corners. */
function boxAround(at: (u: number, v: number) => [number, number], u0: number, v0: number, u1: number, v1: number, y0: number, y1: number): Box {
  const [ax, az] = at(u0, v0);
  const [bx, bz] = at(u1, v1);
  return { x0: Math.min(ax, bx), y0, z0: Math.min(az, bz), x1: Math.max(ax, bx) + 1, y1: y1 + 1, z1: Math.max(az, bz) + 1 };
}

/** A round floating island of radius r with its top at y. */
function blob(world: World, cx: number, cz: number, r: number, top: number, depth: number, seed: number) {
  const R = Math.ceil(r);
  for (let x = cx - R; x <= cx + R; x++)
    for (let z = cz - R; z <= cz + R; z++) {
      const d = Math.hypot(x - cx, z - cz) / r;
      if (d > 1) continue;
      const dep = Math.max(1, Math.round((1 - d * d) * depth + hash(x, z, seed) * 2));
      for (let k = 0; k <= dep; k++) world.set(x, top - k, z, k === 0 ? GRASS : k < 3 ? DIRT : STONE);
    }
}

/** A palm: a tall, slightly leaning trunk and a crown of long drooping fronds. */
function palm(world: World, x: number, z: number, y: number, h: number, seed: number) {
  const lean = hash(x, z, seed) < 0.5 ? 1 : -1;
  const leanX = hash(z, x, seed) < 0.5;
  let tx = x;
  let tz = z;
  for (let k = 0; k < h; k++) {
    if (k === h - 3) {
      if (leanX) tx += lean;
      else tz += lean;
    }
    world.set(tx, y + k, tz, PALM_LOG);
  }
  const ty = y + h;
  world.set(tx, ty, tz, LEAVES);
  // four long fronds that arc down, and four short ones between them
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    world.set(tx + dx, ty, tz + dz, LEAVES);
    world.set(tx + dx * 2, ty, tz + dz * 2, LEAVES);
    world.set(tx + dx * 3, ty - 1, tz + dz * 3, LEAVES);
    world.set(tx + dx * 4, ty - 2, tz + dz * 4, LEAVES);
  }
  for (const [dx, dz] of [
    [1, 1],
    [-1, 1],
    [1, -1],
    [-1, -1],
  ]) {
    world.set(tx + dx, ty - 1, tz + dz, LEAVES);
    world.set(tx + dx * 2, ty - 2, tz + dz * 2, LEAVES);
  }
}

/** The Main Quad: a paved oval with arcades on four sides, emerald generators, a fountain and Hoover Tower. */
function mid(world: World, info: MapInfo) {
  const C = CENTER;
  const T = MID_TOP;
  const set = (x: number, y: number, z: number, id: number) => world.set(x, y, z, id);
  const RX = 17;
  const RZ = 15;
  for (let x = C - RX; x <= C + RX; x++)
    for (let z = C - RX; z <= C + RX; z++) {
      const d = Math.hypot((x - C + 0.5) / (RX + 0.3), (z - C + 0.5) / (RZ + 0.3));
      const d2 = Math.hypot((x - C + 0.5) / (RZ + 0.3), (z - C + 0.5) / (RX + 0.3));
      const dd = Math.min(d, d2);
      if (dd > 1) continue;
      const dep = Math.max(2, Math.round((1 - dd * dd) * 11 + hash(x, z, 77) * 3));
      for (let k = 0; k <= dep; k++) set(x, T - k, z, k === 0 ? GRASS : k < 3 ? DIRT : hash(x, z + k, 5) < 0.2 ? COBBLE : STONE);
      // the quad paving: sandstone tiles inside a ring, grass in the corners
      const px = Math.abs(x - C);
      const pz = Math.abs(z - C);
      if (Math.max(px, pz) <= 11 || (px <= 2 && pz <= 15) || (pz <= 2 && px <= 15)) set(x, T, z, (x + z) % 2 === 0 ? SANDSTONE : TILE_FLOOR);
    }
  // arcades on the four sides of the quad: pillars, a beam and a red tile roof, open to walk through
  for (let side = 0; side < 4; side++) {
    const fx = [0, 1, 0, -1][side];
    const fz = [1, 0, -1, 0][side];
    const rx = -fz;
    const rz = fx;
    const at = (u: number, v: number): [number, number] => [C + u * rx + v * fx, C + u * rz + v * fz];
    const R = 11;
    for (let u = -9; u <= 9; u++) {
      if (Math.abs(u) <= 2) continue;
      const pillar = Math.abs(u) % 3 === 0;
      for (let y = T + 1; y <= T + 3; y++) {
        if (pillar) {
          const [x, z] = at(u, R);
          set(x, y, z, SANDBRICK);
        }
      }
      for (let v = R - 1; v <= R + 1; v++) {
        const [x, z] = at(u, v);
        set(x, T + 4, z, v === R ? SANDBRICK : ROOF);
      }
      const [x, z] = at(u, R);
      set(x, T + 5, z, ROOF);
    }
    // a gate arch over the entrance path
    for (const u of [-3, 3]) for (let y = T + 1; y <= T + 5; y++) {
      const [x, z] = at(u, R);
      set(x, y, z, SANDBRICK);
    }
    for (let u = -3; u <= 3; u++) {
      const [x, z] = at(u, R);
      set(x, T + 6, z, ROOF);
      if (Math.abs(u) === 2) set(x, T + 5, z, SANDBRICK);
    }
    const [lx, lz] = at(0, R);
    set(lx, T + 7, lz, ROOF);
  }
  // emerald generators around the tower
  for (const [dx, dz] of [
    [-6, -6],
    [6, -6],
    [6, 6],
    [-6, 6],
  ]) {
    const x = C + dx;
    const z = C + dz;
    for (let ox = -1; ox <= 1; ox++) for (let oz = -1; oz <= 1; oz++) set(x + ox, T, z + oz, SANDBRICK);
    set(x, T, z, EMERALD_BLOCK);
    info.gens.push({ kind: 'emerald', x: x + 0.5, y: T + 1, z: z + 0.5 });
    info.noBuild.push({ x0: x - 1, y0: T + 1, z0: z - 1, x1: x + 2, y1: T + 3, z1: z + 2 });
  }
  // a little fountain (the Claw) between two arcades
  for (let x = C + 8; x <= C + 10; x++)
    for (let z = C - 1; z <= C + 1; z++) {
      const edge = x === C + 8 || x === C + 10 || z === C - 1 || z === C + 1;
      if (edge) set(x, T + 1, z, SANDBRICK);
      else set(x, T, z, WATER);
    }
  // Hoover Tower: a cream shaft with windows, an open belfry, and a red tile dome
  const H0 = T + 1;
  for (let y = H0; y <= H0 + 21; y++)
    for (let x = C - 2; x <= C + 2; x++)
      for (let z = C - 2; z <= C + 2; z++) {
        const edge = x === C - 2 || x === C + 2 || z === C - 2 || z === C + 2;
        if (!edge) continue;
        const corner = (x === C - 2 || x === C + 2) && (z === C - 2 || z === C + 2);
        const mid = x === C || z === C;
        let id = CREAM;
        if (!corner && mid && y > H0 + 2 && y % 4 === 1) id = CREAM_WINDOW;
        if (y >= H0 + 16 && y <= H0 + 18 && !corner) id = AIR;
        if (y === H0 + 16 && !corner && !mid) id = CREAM;
        set(x, y, z, id);
      }
  // a ledge under the belfry and a cornice above it
  for (let x = C - 3; x <= C + 3; x++)
    for (let z = C - 3; z <= C + 3; z++) {
      if (Math.max(Math.abs(x - C), Math.abs(z - C)) !== 3) continue;
      set(x, H0 + 15, z, SANDBRICK);
      set(x, H0 + 19, z, SANDBRICK);
    }
  for (let x = C - 1; x <= C + 1; x++) for (let z = C - 1; z <= C + 1; z++) set(x, H0 + 15, z, SANDBRICK);
  set(C, H0 + 16, C, GOLD_BLOCK);
  // the dome
  for (let x = C - 2; x <= C + 2; x++) for (let z = C - 2; z <= C + 2; z++) set(x, H0 + 20, z, ROOF);
  for (let x = C - 2; x <= C + 2; x++)
    for (let z = C - 2; z <= C + 2; z++) {
      const corner = Math.abs(x - C) === 2 && Math.abs(z - C) === 2;
      if (!corner) set(x, H0 + 21, z, ROOF);
    }
  for (let x = C - 1; x <= C + 1; x++) for (let z = C - 1; z <= C + 1; z++) set(x, H0 + 22, z, ROOF);
  set(C, H0 + 23, C, ROOF);
  set(C, H0 + 24, C, GOLD_BLOCK);
  // glass doors at the foot of the tower
  for (const [x, z] of [
    [C, C - 2],
    [C, C + 2],
    [C - 2, C],
    [C + 2, C],
  ]) {
    set(x, H0, z, GLASS);
    set(x, H0 + 1, z, GLASS);
  }
  // palms on the quad corners
  palm(world, C - 13, C - 13, T + 1, 8, 51);
  palm(world, C + 13, C - 13, T + 1, 7, 52);
  palm(world, C + 13, C + 13, T + 1, 8, 53);
  palm(world, C - 13, C + 13, T + 1, 7, 54);
  info.noBuild.push({ x0: C - 3, y0: T + 1, z0: C - 3, x1: C + 4, y1: T + 26, z1: C + 4 });
}

export const inBox = (b: Box, x: number, y: number, z: number) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1 && z >= b.z0 && z < b.z1;

/** Team colors as numbers for three.js. */
export const teamHex = (t: number) => parseInt(TEAMS[t].color.slice(1), 16);
export const teamCount = TEAMS.length;
