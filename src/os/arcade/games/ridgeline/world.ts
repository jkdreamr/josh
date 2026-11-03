// Everything on a map besides the ground: the attacker and defender spawns, the two sites (three spread far apart in a
// royale world, where they only seed towns), towns of walk-in buildings, cover, trees, rocks and dirt roads. A breach
// arena is built from its map's plan (breach.ts): lanes, places and the land sculpted round them. Also bakes the light
// the renderer reads (terrain shadows, ambient occlusion and the shadows of far trees and buildings) and paints the
// minimap. Pure data, so it runs in a worker and under node.
import { MAPS, type MapDef, type MapId, type Style, type TreeKind } from './maps.ts';
import { Noise2, clamp, lerp, mulberry32, smoothstep, type Rng } from './noise.ts';
import { CELL, T_HALF, T_RES, T_SIZE, flattenRect, floorAt, generateTerrain, heightAt, meanHeight, normalAt, type Terrain } from './terrain.ts';
import { PLANS, STRUCT_SIZE, draftPlaces, openAt, restoreBanks, sculpt, toPlan, toWorld, type Item, type P as BP, type Plan } from './breach.ts';

/** Half the side of the square everyone plays in (breach and deathmatch). The ground you can walk on is less: the
 * lanes and places of the map's plan, bounded by banks, hills and the sea well inside this. */
export const ARENA = 125;
/** The middle of a royale's land, where its spawns and first sites are laid out. */
const CORE = 100;
/** The same for a royale: nearly all of the shaped land. */
export const ROYALE_ARENA = 330;
/** Breach: how far from a site's center the charge can be planted. */
export const SITE_R = 9;
/** Where a team waits out the buy phase. */
export const SPAWN_R = 15;

export type Surface = 'stone' | 'wood' | 'metal' | 'dirt' | 'sand' | 'snow' | 'leaf' | 'water';
export type Part = 'wall' | 'trim' | 'roof' | 'floor' | 'wood' | 'metal' | 'sandbag' | 'concrete' | 'hesco';

/** A drawn box (and a collider unless solid is false). */
export type Piece = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number; part: Part; color: number; solid: boolean };
/** A pitched roof over a rectangle: a triangular prism, ridge along x or z. Drawn only. */
export type Gable = { x0: number; z0: number; x1: number; z1: number; y: number; h: number; alongX: boolean; color: number; wall: number };
export type Rect3 = { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
export type Box = Rect3 & { s: Surface };
export type Trunk = { x: number; z: number; r: number; y0: number; y1: number };
export type RockCol = { x: number; y: number; z: number; r: number };
export type Tree = { kind: TreeKind; x: number; y: number; z: number; s: number; rot: number; tint: number };
export type Rock = { x: number; y: number; z: number; s: number; rot: number; v: number; flat: number };
export type Site = { id: number; name: string; town: string; x: number; y: number; z: number };
export type Slot = { x: number; z: number; yaw: number };
export type Vehicle = { x: number; y: number; z: number; rot: number; kind: number };
/** A placed model; cover also carries its box (across, up, along) for a plain stand-in if the model is missing. */
export type Placed = { key: ModelKey; x: number; y: number; z: number; yaw: number; size?: [number, number, number] };
export type ModelKey =
  | 'barricade'
  | 'jersey'
  | 'pile'
  | 'wire'
  | 'dumpsters'
  | 'fence-base'
  | 'fence-half'
  | 'fence-wood'
  | 'fence-wheel'
  | 'jerry'
  | 'gas'
  | 'propane'
  | 'helmet'
  | 'shield'
  | 'cup'
  | 'pan'
  | 'ammo-crate'
  | 'tyre'
  | 'barrel'
  | 'generator'
  | 'toolbox'
  | 'stump'
  | 'stump2'
  | 'log';
/** A team's start: spawns[0] is where the attackers start, spawns[1] the defenders. */
export type Spawn = { x: number; y: number; z: number; yaw: number; slots: Slot[] };
export type Town = { name: string; x: number; z: number; site: number };
/** Uniform grid over the terrain: start[c]..start[c+1] index items, which encode kind * KIND + index. */
export type Grid = { n: number; size: number; start: Int32Array; items: Int32Array };
export type Minimap = { size: number; span: number; data: Uint8ClampedArray };

export type World = {
  id: MapId;
  def: MapDef;
  terrain: Terrain;
  /** Unit vector toward the sun. */
  sun: [number, number, number];
  pieces: Piece[];
  gables: Gable[];
  interiors: Rect3[];
  boxes: Box[];
  trunks: Trunk[];
  rocks: RockCol[];
  trees: Tree[];
  rockList: Rock[];
  grid: Grid;
  sites: Site[];
  spawns: [Spawn, Spawn];
  dmSpawns: Slot[];
  towns: Town[];
  /** Road polylines as flat x, z pairs. */
  roads: number[][];
  /** Trucks parked as cover: position, quarter turns and which (0 armored rescue truck, 1 Ural, 2 BTR). */
  vehicles: Vehicle[];
  /** Real models standing in the world (cover drawn by a model, and clutter): which, where, facing. */
  models: Placed[];
  /** RGBA per terrain vertex: sun visibility, ambient occlusion, far object shadow, bare ground. */
  light: Uint8Array;
  minimap: Minimap;
  /** Half the side of the playable square. */
  arena: number;
  /** 1 on terrain vertices of the ground you can walk across (see walkRegion). */
  region: Uint8Array;
  /** Where loot can lie: x, y, z per spot (building floors first, then by cover). */
  loot: Float32Array;
  /** Doorways: center x, z and the wall's normal x, z per door, so the bots' paths can go through them. */
  doors: Float32Array;
};

export const KIND = 1 << 22;
export const K_BOX = 0;
export const K_TRUNK = 1;
export const K_ROCK = 2;

/** Yaw that faces along (dx, dz); forward is (-sin yaw, -cos yaw), as for a three.js camera. */
export const yawTo = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export function sunDir(def: MapDef): [number, number, number] {
  const az = (def.sun.az * Math.PI) / 180;
  const el = (def.sun.el * Math.PI) / 180;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)];
}

type Ctx = {
  def: MapDef;
  t: Terrain;
  rng: Rng;
  n: Noise2;
  pieces: Piece[];
  gables: Gable[];
  interiors: Rect3[];
  /** Footprints taken by buildings, props, pads (with their margins), for spacing and keeping trees out. */
  taken: { x0: number; z0: number; x1: number; z1: number }[];
  pads: { x: number; z: number; hx: number; hz: number; y: number }[];
  roadSegs: number[];
  roads: number[][];
  /** Buildings, for the baked shadows: footprint plus top. */
  blocks: Rect3[];
  vehicles: Vehicle[];
  models: Placed[];
  /** Colliders with no drawn box of their own (the trucks and model cover). */
  colliders: Box[];
  /** Its own random stream for clutter, so the layout doesn't depend on it. */
  deco: Rng;
  arena: number;
  /** Loot spots, x, y, z each. */
  loot: number[];
  doors: number[];
  /** Rocks a place puts down (rubble, a heap of gravel), added to the rest. */
  extraRocks: Rock[];
};

const STYLE_WALLS: Record<Style, number[]> = {
  farm: [0xe6dfcf, 0xd8ccb4, 0xa95543, 0xcfc6b2],
  adobe: [0xc99a6b, 0xd6ae80, 0xb98a5c, 0xceaa84],
  cabin: [0x5c4030, 0x6b4a33, 0x4f3a2c, 0x75553b],
  tropic: [0xe9a39c, 0x9fd3d6, 0xf2d98a, 0xf2eee2],
};
const STYLE_ROOFS: Record<Style, number[]> = {
  farm: [0x55595f, 0x7a3b2c, 0x4a4e52],
  adobe: [0xb68a5e],
  cabin: [0xe6edf3, 0xdfe7ee],
  tropic: [0xb5532e, 0x9a4a2a, 0x7d6b4a],
};
const CONTAINER_COLORS = [0x9b3b2b, 0x2f5d8a, 0x3d7a4a, 0xc07a2a, 0x6d6d6d, 0x7a2f4a];

const pick = <T>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length) % a.length];

function overlaps(c: Ctx, x0: number, z0: number, x1: number, z1: number) {
  for (const r of c.taken) if (x0 < r.x1 && x1 > r.x0 && z0 < r.z1 && z1 > r.z0) return true;
  return false;
}

/** Anything solid standing within `d` of (x, z)? */
function solidNear(c: Ctx, x: number, z: number, d: number) {
  const near = (b: { x0: number; z0: number; x1: number; z1: number }) => Math.hypot(Math.max(b.x0 - x, 0, x - b.x1), Math.max(b.z0 - z, 0, z - b.z1)) < d;
  for (const p of c.pieces) if (p.solid && p.y1 - p.y0 > 0.8 && near(p)) return true;
  for (const b of c.colliders) if (near(b)) return true;
  return false;
}

function roadDist(c: Ctx, x: number, z: number) {
  const s = c.roadSegs;
  let best = Infinity;
  for (let i = 0; i < s.length; i += 4) {
    const vx = s[i + 2] - s[i];
    const vz = s[i + 3] - s[i + 1];
    const l2 = vx * vx + vz * vz || 1;
    const k = clamp(((x - s[i]) * vx + (z - s[i + 1]) * vz) / l2, 0, 1);
    const d = Math.hypot(x - s[i] - vx * k, z - s[i + 1] - vz * k);
    if (d < best) best = d;
  }
  return best;
}

/** Local box (building space, rotated by rot quarter turns about cx, cz) to a world piece. */
class Frame {
  private c: Ctx;
  cx: number;
  cz: number;
  rot: number;
  constructor(c: Ctx, cx: number, cz: number, rot: number) {
    this.c = c;
    this.cx = cx;
    this.cz = cz;
    this.rot = rot;
  }
  xz(lx: number, lz: number): [number, number] {
    switch (this.rot & 3) {
      case 0:
        return [this.cx + lx, this.cz + lz];
      case 1:
        return [this.cx - lz, this.cz + lx];
      case 2:
        return [this.cx - lx, this.cz - lz];
      default:
        return [this.cx + lz, this.cz - lx];
    }
  }
  rect(lx0: number, lz0: number, lx1: number, lz1: number) {
    const [ax, az] = this.xz(lx0, lz0);
    const [bx, bz] = this.xz(lx1, lz1);
    return { x0: Math.min(ax, bx), z0: Math.min(az, bz), x1: Math.max(ax, bx), z1: Math.max(az, bz) };
  }
  box(lx0: number, y0: number, lz0: number, lx1: number, y1: number, lz1: number, part: Part, color: number, solid = true) {
    if (lx1 - lx0 < 0.01 || lz1 - lz0 < 0.01 || y1 - y0 < 0.01) return;
    const r = this.rect(lx0, lz0, lx1, lz1);
    this.c.pieces.push({ x0: r.x0, y0, z0: r.z0, x1: r.x1, y1, z1: r.z1, part, color, solid });
  }
  /** Notes a doorway at a local point with its wall's local normal. */
  door(lx: number, lz: number, nlx: number, nlz: number) {
    const [x, z] = this.xz(lx, lz);
    const [ax, az] = this.xz(lx + nlx, lz + nlz);
    this.c.doors.push(x, z, ax - x, az - z);
  }
  gable(lx0: number, lz0: number, lx1: number, lz1: number, y: number, h: number, alongLocalX: boolean, color: number, wall: number) {
    const r = this.rect(lx0, lz0, lx1, lz1);
    this.c.gables.push({ ...r, y, h, alongX: (this.rot & 1) === 0 ? alongLocalX : !alongLocalX, color, wall });
  }
}

type Opening = { c: number; w: number; b: number; t: number };

/** A wall along local x (from xa to xb, between z0 and z1) from y0 to y1 with door and window holes. */
/** Frames round a wall's openings, standing a little proud of both faces: jambs and a lintel, and a sill under a window. */
function trims(f: Frame, alongX: boolean, holes: Opening[], t0: number, t1: number, y0: number, color: number) {
  if (color < 0) return;
  const box = (a0: number, ya: number, a1: number, yb: number, out: number) =>
    alongX ? f.box(a0, ya, t0 - out, a1, yb, t1 + out, 'trim', color, false) : f.box(t0 - out, ya, a0, t1 + out, yb, a1, 'trim', color, false);
  for (const o of holes) {
    const a = o.c - o.w / 2;
    const b = o.c + o.w / 2;
    const door = o.b <= y0 + 0.05;
    const bottom = door ? o.b : o.b - 0.02;
    box(a - 0.08, bottom, a, o.t, 0.035);
    box(b, bottom, b + 0.08, o.t, 0.035);
    box(a - 0.1, o.t, b + 0.1, o.t + 0.11, 0.045);
    if (!door) box(a - 0.12, o.b - 0.08, b + 0.12, o.b, 0.07);
  }
}

function wallX(f: Frame, xa: number, xb: number, z0: number, z1: number, y0: number, y1: number, holes: Opening[], part: Part, color: number, trim = -1) {
  trims(f, true, holes, z0, z1, y0, trim);
  let cur = xa;
  for (const o of [...holes].sort((a, b) => a.c - b.c)) {
    const a = o.c - o.w / 2;
    const b = o.c + o.w / 2;
    if (o.b <= y0 + 0.05) f.door(o.c, (z0 + z1) / 2, 0, 1);
    if (a > cur) f.box(cur, y0, z0, a, y1, z1, part, color);
    if (o.b > y0) f.box(a, y0, z0, b, o.b, z1, part, color);
    if (o.t < y1) f.box(a, o.t, z0, b, y1, z1, part, color);
    cur = b;
  }
  if (cur < xb) f.box(cur, y0, z0, xb, y1, z1, part, color);
}

/** The same along local z, between x0 and x1. */
function wallZ(f: Frame, za: number, zb: number, x0: number, x1: number, y0: number, y1: number, holes: Opening[], part: Part, color: number, trim = -1) {
  trims(f, false, holes, x0, x1, y0, trim);
  let cur = za;
  for (const o of [...holes].sort((a, b) => a.c - b.c)) {
    const a = o.c - o.w / 2;
    const b = o.c + o.w / 2;
    if (o.b <= y0 + 0.05) f.door((x0 + x1) / 2, o.c, 1, 0);
    if (a > cur) f.box(x0, y0, cur, x1, y1, a, part, color);
    if (o.b > y0) f.box(x0, y0, a, x1, o.b, b, part, color);
    if (o.t < y1) f.box(x0, o.t, a, x1, y1, b, part, color);
    cur = b;
  }
  if (cur < zb) f.box(x0, y0, cur, x1, y1, zb, part, color);
}

type Kind = 'house' | 'barn' | 'shed' | 'ruin';
const SIZES: Record<Kind, [number, number, number, number]> = {
  house: [8, 11, 7, 9],
  barn: [11, 13, 15, 19],
  shed: [3.6, 4.6, 4.2, 5.4],
  ruin: [7, 10, 6, 9],
};

/** Builds one building's pieces in place. y is the floor level. */
function addBuilding(c: Ctx, kind: Kind, cx: number, cz: number, w: number, d: number, rot: number, y: number) {
  const r = c.rng;
  const style = c.def.style;
  const f = new Frame(c, cx, cz, rot);
  const T = 0.25;
  const hw = w / 2;
  const hd = d / 2;
  const base = y - 0.4;
  const floorTop = y + 0.12;
  const H = kind === 'barn' ? 5.4 : kind === 'shed' ? 2.7 : 3.2;
  const top = y + H;
  const wallColor = pick(r, STYLE_WALLS[style]);
  const roofColor = pick(r, STYLE_ROOFS[style]);
  const wallPart: Part = style === 'cabin' || (kind === 'barn' && style !== 'adobe') ? 'wood' : kind === 'barn' ? 'metal' : 'wall';
  const barnColor = style === 'farm' ? 0x8e2f24 : style === 'cabin' ? 0x5a4130 : style === 'tropic' ? 0x8a6a4a : 0x9a8f80;
  const wc = kind === 'barn' ? barnColor : wallColor;
  const trim = style === 'cabin' ? 0x3a2a1e : style === 'adobe' ? 0x6b4a2e : 0xd8d2c4;

  f.box(-hw, base, -hd, hw, floorTop, hd, 'floor', style === 'adobe' ? 0xa08466 : 0x8a6a4a);
  // a plinth round the foot of the walls, a hand proud of them, so the house sits on the ground instead of in it
  // (a ring under the walls only, so the floor inside stays the floor)
  if (kind !== 'ruin') {
    const pc = style === 'adobe' ? 0x8a7458 : 0x8d8a84;
    const pt = y + 0.13;
    const o = 0.06;
    f.box(-hw - o, base, -hd - o, hw + o, pt, -hd + T, 'concrete', pc, false);
    f.box(-hw - o, base, hd - T, hw + o, pt, hd + o, 'concrete', pc, false);
    f.box(-hw - o, base, -hd + T, -hw + T, pt, hd - T, 'concrete', pc, false);
    f.box(hw - T, base, -hd + T, hw + o, pt, hd - T, 'concrete', pc, false);
  }
  const door = (cpos: number, wide = 1.3, tall = 2.3): Opening => ({ c: cpos, w: wide, b: base, t: y + tall });
  const win = (cpos: number, wide = 1.3): Opening => ({ c: cpos, w: wide, b: y + 1, t: y + 2.15 });
  const ruin = kind === 'ruin';
  const wallTop = (seg: number) => (ruin ? y + 0.6 + r() * (H - 0.6) * (seg % 3 === 0 ? 0.4 : 1) : top);

  if (kind === 'barn') {
    const bd: Opening = { c: 0, w: 3.8, b: base, t: y + 4 };
    wallX(f, -hw, hw, -hd, -hd + T, base, top, [bd], wallPart, wc, trim);
    wallX(f, -hw, hw, hd - T, hd, base, top, [{ ...bd }], wallPart, wc, trim);
    const hi: Opening[] = [-hd * 0.5, 0, hd * 0.5].map((z) => ({ c: z, w: 1.6, b: y + 2.6, t: y + 3.6 }));
    wallZ(f, -hd + T, hd - T, -hw, -hw + T, base, top, [...hi, door(hd * 0.25, 1.4)], wallPart, wc);
    wallZ(f, -hd + T, hd - T, hw - T, hw, base, top, hi, wallPart, wc);
  } else {
    const w0 = r() < 0.5;
    const frontHoles = kind === 'shed' ? [door(0, 1.2, 2.1)] : [door(w0 ? -hw * 0.35 : hw * 0.35), win(w0 ? hw * 0.4 : -hw * 0.4)];
    const backHoles = kind === 'shed' ? [] : r() < 0.5 ? [win(-hw * 0.4), win(hw * 0.4)] : [door(hw * 0.3), win(-hw * 0.4)];
    const sideA = kind === 'shed' ? [win(0, 0.9)] : [win(-hd * 0.35), win(hd * 0.35)];
    const sideB = kind === 'shed' ? [] : r() < 0.5 ? [win(0)] : [door(-hd * 0.3), win(hd * 0.35)];
    if (ruin) {
      // broken walls: each stretch its own height, some gone entirely
      const parts: [number, number][] = [
        [-hw, -hw * 0.3],
        [-hw * 0.3, hw * 0.3],
        [hw * 0.3, hw],
      ];
      parts.forEach(([a, b], i) => r() > 0.2 && f.box(a, base, -hd, b, wallTop(i), -hd + T, 'wall', wc));
      parts.forEach(([a, b], i) => r() > 0.25 && f.box(a, base, hd - T, b, wallTop(i + 1), hd, 'wall', wc));
      const zp: [number, number][] = [
        [-hd + T, 0],
        [0, hd - T],
      ];
      zp.forEach(([a, b], i) => r() > 0.25 && f.box(-hw, base, a, -hw + T, wallTop(i + 2), b, 'wall', wc));
      zp.forEach(([a, b], i) => r() > 0.3 && f.box(hw - T, base, a, hw, wallTop(i), b, 'wall', wc));
    } else {
      wallX(f, -hw, hw, -hd, -hd + T, base, top, frontHoles, wallPart, wc, ruin ? -1 : trim);
      wallX(f, -hw, hw, hd - T, hd, base, top, backHoles, wallPart, wc, ruin ? -1 : trim);
      wallZ(f, -hd + T, hd - T, -hw, -hw + T, base, top, sideA, wallPart, wc, ruin ? -1 : trim);
      wallZ(f, -hd + T, hd - T, hw - T, hw, base, top, sideB, wallPart, wc, ruin ? -1 : trim);
      // sills under the windows
      for (const o of frontHoles) if (o.b > y) f.box(o.c - o.w / 2 - 0.05, o.b - 0.08, -hd - 0.08, o.c + o.w / 2 + 0.05, o.b, -hd + 0.05, 'trim', trim, false);
      for (const o of backHoles) if (o.b > y) f.box(o.c - o.w / 2 - 0.05, o.b - 0.08, hd - 0.05, o.c + o.w / 2 + 0.05, o.b, hd + 0.08, 'trim', trim, false);
      if (kind === 'house' && w >= 9) {
        const px = hw * 0.1;
        const dz = (r() - 0.5) * d * 0.4;
        wallZ(f, -hd + T, hd - T, px - 0.08, px + 0.08, base, top, [door(dz, 1.1)], wallPart === 'wood' ? 'wood' : 'wall', style === 'cabin' ? wc : 0xe2dccd);
      }
    }
  }
  if (!ruin) {
    const flat = style === 'adobe' || (style === 'tropic' && r() < 0.3);
    const ov = flat ? 0.15 : 0.35;
    f.box(-hw - ov, top, -hd - ov, hw + ov, top + 0.22, hd + ov, flat ? 'wall' : 'trim', flat ? wc : trim);
    if (flat) {
      // parapet and beam ends
      const pt = top + 0.22;
      const ph = pt + 0.55;
      f.box(-hw - ov, pt, -hd - ov, hw + ov, ph, -hd - ov + 0.2, 'wall', wc);
      f.box(-hw - ov, pt, hd + ov - 0.2, hw + ov, ph, hd + ov, 'wall', wc);
      f.box(-hw - ov, pt, -hd - ov + 0.2, -hw - ov + 0.2, ph, hd + ov - 0.2, 'wall', wc);
      f.box(hw + ov - 0.2, pt, -hd - ov + 0.2, hw + ov, ph, hd + ov - 0.2, 'wall', wc);
      if (style === 'adobe')
        for (let x = -hw + 0.8; x < hw - 0.4; x += 1.4) f.box(x - 0.1, top - 0.35, -hd - 0.5, x + 0.1, top - 0.15, -hd, 'trim', trim, false);
    } else {
      const alongX = w >= d;
      const ro = 0.5;
      f.gable(-hw - ro, -hd - ro, hw + ro, hd + ro, top + 0.22, kind === 'barn' ? 2.8 : kind === 'shed' ? 1.1 : 1.9, alongX, roofColor, wc);
    }
  }
  const rr = f.rect(-hw, -hd, hw, hd);
  // loot on the floor, more in the bigger buildings
  const spots = Math.min(7, 2 + Math.floor((w * d) / 16));
  for (let k = 0; k < spots; k++) {
    const [lx, lz] = f.xz((c.deco() - 0.5) * (w - 1.8), (c.deco() - 0.5) * (d - 1.8));
    c.loot.push(lx, floorTop + 0.02, lz);
  }
  if (!ruin) {
    c.interiors.push({ x0: rr.x0 + T, y0: y - 0.5, z0: rr.z0 + T, x1: rr.x1 - T, y1: top, z1: rr.z1 - T });
    c.blocks.push({ x0: rr.x0, y0: y, z0: rr.z0, x1: rr.x1, y1: top + (style === 'adobe' ? 0.8 : 1.2), z1: rr.z1 });
  } else c.blocks.push({ x0: rr.x0, y0: y, z0: rr.z0, x1: rr.x1, y1: y + H * 0.6, z1: rr.z1 });
  // inside cover for the big ones
  if (kind === 'barn') {
    for (let k = 0; k < 3; k++) {
      const lx = (r() - 0.5) * (w - 4);
      const lz = (r() - 0.5) * (d - 6);
      crates(c, f, lx, lz, floorTop);
    }
  }
}

/** The crates' boxes: their side and color (the renderer draws a stack of real crates in each box of this kind). */
export const CRATE_SIZE = 1.1;
export const CRATE_COLOR = 0x9a7a4e;

function crates(c: Ctx, f: Frame, lx: number, lz: number, y: number) {
  const r = c.rng;
  const s = CRATE_SIZE;
  const col = CRATE_COLOR;
  f.box(lx - s / 2, y, lz - s / 2, lx + s / 2, y + s, lz + s / 2, 'wood', col);
  if (r() < 0.7) f.box(lx + s / 2 + 0.05, y, lz - s / 2, lx + s * 1.5 + 0.05, y + s, lz + s / 2, 'wood', col);
  if (r() < 0.5) f.box(lx - s / 2 + 0.2, y + s, lz - s / 2 + 0.1, lx + s / 2 + 0.2, y + s * 2, lz + s / 2 + 0.1, 'wood', col);
}

/** Tries to put a building of some kind near (x, z); returns true when placed. */
function tryBuilding(c: Ctx, kind: Kind, x: number, z: number, bound: number) {
  const r = c.rng;
  const [w0, w1, d0, d1] = SIZES[kind];
  const w = lerp(w0, w1, r());
  const d = lerp(d0, d1, r());
  const rot = Math.floor(r() * 4);
  const hx = (rot & 1 ? d : w) / 2;
  const hz = (rot & 1 ? w : d) / 2;
  const gap = 3.5;
  if (Math.abs(x) + hx > bound || Math.abs(z) + hz > bound) return false;
  if (overlaps(c, x - hx - gap, z - hz - gap, x + hx + gap, z + hz + gap)) return false;
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
    [0, 0],
  ])
    if (roadDist(c, x + a * hx, z + b * hz) < 3.5) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (let a = -1; a <= 1; a += 0.5)
    for (let b = -1; b <= 1; b += 0.5) {
      const h = heightAt(c.t, x + a * hx, z + b * hz);
      lo = Math.min(lo, h);
      hi = Math.max(hi, h);
    }
  if (hi - lo > 4 || lo < c.t.water + 0.8) return false;
  const y = meanHeight(c.t, x, z, hx, hz);
  flattenRect(c.t, x, z, hx + 0.6, hz + 0.6, y, 6);
  c.pads.push({ x, z, hx: hx + 0.6, hz: hz + 0.6, y });
  c.taken.push({ x0: x - hx - 2, z0: z - hz - 2, x1: x + hx + 2, z1: z + hz + 2 });
  addBuilding(c, kind, x, z, w, d, rot, y);
  return true;
}

export type PropKind = 'container' | 'crates' | 'sandbags' | 'barrier' | 'truck' | 'hesco' | 'pile' | 'wire' | 'dumpsters' | 'fence';

/** Footprint (across, along) of each kind of cover. */
const PROP_SIZE: Record<Exclude<PropKind, 'hesco'>, [number, number]> = {
  container: [6.06, 2.44],
  crates: [2.4, 1.2],
  sandbags: [3.2, 0.8],
  truck: [2.5, 6.5],
  barrier: [2.4, 0.72],
  pile: [2.44, 2.34],
  wire: [5.16, 1.4],
  dumpsters: [5.55, 2.6],
  fence: [3, 0.54],
};
/** Cover drawn by a real model: its collider height and surface. */
const MODEL_COVER: Partial<Record<PropKind, { h: number; s: Surface }>> = {
  barrier: { h: 1.05, s: 'stone' },
  pile: { h: 1.95, s: 'wood' },
  wire: { h: 1.45, s: 'wood' },
  dumpsters: { h: 1.35, s: 'metal' },
  fence: { h: 2.3, s: 'stone' },
};
const CLUTTER: ModelKey[] = ['jerry', 'gas', 'propane', 'helmet', 'shield', 'jerry', 'propane', 'cup', 'pan', 'tyre', 'ammo-crate', 'barrel', 'toolbox', 'generator', 'ammo-crate'];
/** Clutter big enough to stop you and a bullet: half the side of its collider (square, inside its turned outline) and its height. */
const CLUTTER_SOLID: Partial<Record<ModelKey, [number, number]>> = { barrel: [0.3, 0.92], generator: [0.27, 0.56] };
const FENCES: ModelKey[] = ['fence-base', 'fence-half', 'fence-wood', 'fence-wheel'];

/** A piece of clutter on the ground at local (lx, lz) of a frame, facing a random way. */
function clutter(c: Ctx, f: Frame, lx: number, lz: number, key?: ModelKey, y?: number) {
  const [x, z] = f.xz(lx, lz);
  const k = key ?? CLUTTER[Math.floor(c.deco() * CLUTTER.length)];
  const at = y ?? heightAt(c.t, x, z);
  c.models.push({ key: k, x, y: at, z, yaw: c.deco() * Math.PI * 2 });
  const solid = CLUTTER_SOLID[k];
  if (solid) c.colliders.push({ x0: x - solid[0], y0: at, z0: z - solid[0], x1: x + solid[0], y1: at + solid[1], z1: z + solid[0], s: 'metal' });
}

/** A screen across a road: quarter turns, baskets long, and two high (over head height). */
type Screen = { turn: number; units: number };
/** Placing cover by hand: its quarter turns, which model (a fence's), baskets long (HESCO), and whether to skip the
 * checks for room round it and for the roads (cover in a line along a wall stands close by design). */
type PropOpt = { rot?: number; key?: ModelKey; units?: number; force?: boolean };

/** Places a piece of cover if it fits; a screen stands on a road, and `roadside` cover may stand at a road's edge. */
function tryProp(c: Ctx, kind: PropKind, x: number, z: number, bound: number, screen?: Screen, roadside = false, opt?: PropOpt) {
  const r = c.rng;
  const roll = Math.floor(r() * 4);
  const rot = screen ? screen.turn : (opt?.rot ?? roll);
  const roll2 = kind === 'hesco' ? 3 + Math.floor(r() * 3) : 1;
  const units = screen ? screen.units : kind === 'hesco' && opt?.units ? opt.units : roll2;
  const [w, d] = kind === 'hesco' ? [units * 1.06, 1.06] : PROP_SIZE[kind];
  const hx = (rot & 1 ? d : w) / 2;
  const hz = (rot & 1 ? w : d) / 2;
  if (Math.abs(x) + hx > bound || Math.abs(z) + hz > bound) return false;
  if (!opt?.force && overlaps(c, x - hx - 1.5, z - hz - 1.5, x + hx + 1.5, z + hz + 1.5)) return false;
  if (!screen && !opt?.force && roadDist(c, x, z) < (roadside ? 3.4 + Math.max(hx, hz) * 0.3 : 2.5 + Math.max(hx, hz))) return false;
  let lo = Infinity;
  let hi = -Infinity;
  // (on ice the frozen surface is the ground: cover may stand out on a frozen lake, but not in open water)
  let iced = false;
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const h = floorAt(c.t, x + a * hx, z + b * hz);
    if (c.t.ice && heightAt(c.t, x + a * hx, z + b * hz) < c.t.water) iced = true;
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  if (hi - lo > (kind === 'container' ? 2.2 : kind === 'truck' ? 1.4 : MODEL_COVER[kind] ? 0.7 : screen ? 2.4 : 1.2) || (!c.t.ice && lo < c.t.water + 0.3)) return false;
  if (iced && (kind === 'truck' || hi - lo > 0.3)) return false;
  const f = new Frame(c, x, z, rot);
  let y = lo - 0.15;
  if (kind === 'container' && iced) y = lo;
  else if (kind === 'container') {
    y = meanHeight(c.t, x, z, hx, hz);
    flattenRect(c.t, x, z, hx + 0.4, hz + 0.4, y, 3);
    c.pads.push({ x, z, hx: hx + 0.4, hz: hz + 0.4, y });
    f.box(-w / 2, y - 0.2, -d / 2, w / 2, y + 2.59, d / 2, 'metal', pick(r, CONTAINER_COLORS));
    if (r() < 0.25) f.box(-w / 2, y + 2.59, -d / 2, w / 2, y + 2.59 + 2.79, d / 2, 'metal', pick(r, CONTAINER_COLORS));
    c.blocks.push({ x0: x - hx, y0: y, z0: z - hz, x1: x + hx, y1: y + 2.6, z1: z + hz });
  } else if (kind === 'truck') {
    // parked on a leveled pad; the body is drawn by the renderer, the hull collides as one box
    y = meanHeight(c.t, x, z, hx, hz);
    flattenRect(c.t, x, z, hx + 0.6, hz + 0.6, y, 4);
    c.pads.push({ x, z, hx: hx + 0.6, hz: hz + 0.6, y });
    const rr = f.rect(-1.2, -3.2, 1.2, 3.12);
    c.colliders.push({ x0: rr.x0, y0: y + 0.2, z0: rr.z0, x1: rr.x1, y1: y + 2.84, z1: rr.z1, s: 'metal' });
    c.vehicles.push({ x, y, z, rot, kind: c.vehicles.length % 3 });
    c.blocks.push({ x0: rr.x0, y0: y, z0: rr.z0, x1: rr.x1, y1: y + 2.9, z1: rr.z1 });
    // fuel cans by the side
    if (c.deco() < 0.7) clutter(c, f, 1.75, (c.deco() - 0.5) * 3, 'jerry');
  } else if (kind === 'hesco') {
    // a wall of wire mesh baskets filled with earth
    const col = c.def.style === 'cabin' ? 0xb9b4a6 : c.def.style === 'adobe' ? 0xbca47e : 0xa89c7c;
    for (let k = 0; k < units; k++) {
      const lx = -w / 2 + 0.53 + k * 1.06;
      f.box(lx - 0.52, y, -0.52, lx + 0.52, hi + 1.35, 0.52, 'hesco', col);
      if (screen) f.box(lx - 0.52, hi + 1.35, -0.52, lx + 0.52, hi + 2.7, 0.52, 'hesco', col);
    }
    c.blocks.push({ x0: x - hx, y0: y, z0: z - hz, x1: x + hx, y1: hi + (screen ? 2.7 : 1.35), z1: z + hz });
  } else if (kind === 'crates') {
    crates(c, f, -0.6, 0, y + 0.15);
    if (c.deco() < 0.35) clutter(c, f, -0.6, 0, c.deco() < 0.5 ? 'cup' : 'helmet', y + 1.25);
  } else if (MODEL_COVER[kind]) {
    // cover drawn by a model: a collider box, a block for the baked shadows, and the model on the ground
    const mc = MODEL_COVER[kind]!;
    y = lo - 0.05;
    const rr = f.rect(-w / 2, -d / 2, w / 2, d / 2);
    c.colliders.push({ x0: rr.x0, y0: y, z0: rr.z0, x1: rr.x1, y1: y + mc.h, z1: rr.z1, s: mc.s });
    c.blocks.push({ x0: rr.x0, y0: y, z0: rr.z0, x1: rr.x1, y1: y + mc.h, z1: rr.z1 });
    const key: ModelKey = opt?.key ?? (kind === 'fence' ? FENCES[Math.floor(c.deco() * FENCES.length)] : kind === 'barrier' ? (c.deco() < 0.5 ? 'jersey' : 'barricade') : (kind as 'pile' | 'wire' | 'dumpsters'));
    c.models.push({ key, x, y, z, yaw: (-rot * Math.PI) / 2, size: [w, mc.h, d] });
  } else if (kind === 'sandbags') {
    const col = c.def.style === 'cabin' ? 0xcfcfc6 : 0xb3a07a;
    f.box(-w / 2, y, -d / 2, w / 2, hi + 0.95, d / 2, 'sandbag', col);
    if (r() < 0.5) f.box(w / 2 - 0.8, y, d / 2, w / 2, hi + 0.95, d / 2 + 1.8, 'sandbag', col);
  }
  // loot by the cover, on the side away from its middle
  if (kind !== 'truck' && c.deco() < 0.5) {
    const [lx, lz] = f.xz((c.deco() - 0.5) * (w - 0.8), (c.deco() < 0.5 ? -1 : 1) * (d / 2 + 0.7));
    c.loot.push(lx, heightAt(c.t, lx, lz) + 0.02, lz);
  }
  // odds and ends left behind cover
  if ((kind === 'sandbags' || kind === 'hesco' || kind === 'pile' || kind === 'container') && c.deco() < 0.45) {
    const n = 1 + Math.floor(c.deco() * 2);
    for (let k = 0; k < n; k++) clutter(c, f, (c.deco() - 0.5) * (w - 0.6), (c.deco() < 0.5 ? -1 : 1) * (d / 2 + 0.45 + c.deco() * 0.3));
  }
  c.taken.push({ x0: x - hx - 0.5, z0: z - hz - 0.5, x1: x + hx + 0.5, z1: z + hz + 0.5 });
  return true;
}

/**
 * The walkable ground inside the arena that hangs together: 1 on vertices of the biggest region you can walk across
 * without climbing a cliff or swimming deep water (or of the one round `from`, when given, which also keeps off ground
 * too steep to stand on), 0 elsewhere. Spawns, sites and respawns only go on it.
 */
export function walkRegion(t: Terrain, arena = ARENA, from?: { x: number; z: number }): Uint8Array {
  const lab = new Int32Array(T_RES * T_RES).fill(-1);
  const lo = Math.floor((T_HALF - arena) / CELL);
  const hi = Math.ceil((T_HALF + arena) / CELL);
  const ok = (k: number) => t.ice || t.h[k] > t.water - 1.1;
  // (round a breach's lanes, also no ground steeper than a body can stand on, so no bank taken slantwise joins in)
  const nrm = { x: 0, y: 1, z: 0 };
  const standable = (k: number) => normalAt(t, (k % T_RES) * CELL - T_HALF, Math.floor(k / T_RES) * CELL - T_HALF, nrm).y >= 0.62;
  const sizes: number[] = [];
  const queue = new Int32Array(T_RES * T_RES);
  for (let j = lo; j <= hi; j++)
    for (let i = lo; i <= hi; i++) {
      const k0 = j * T_RES + i;
      if (lab[k0] >= 0 || !ok(k0)) continue;
      const id = sizes.length;
      let head = 0;
      let tail = 0;
      queue[tail++] = k0;
      lab[k0] = id;
      while (head < tail) {
        const k = queue[head++];
        const ci = k % T_RES;
        const cj = (k - ci) / T_RES;
        for (const [di, dj] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < lo || nj < lo || ni > hi || nj > hi) continue;
          const nk = nj * T_RES + ni;
          if (lab[nk] >= 0 || !ok(nk) || Math.abs(t.h[nk] - t.h[k]) > 1.5 || (from && !standable(nk))) continue;
          lab[nk] = id;
          queue[tail++] = nk;
        }
      }
      sizes.push(tail);
    }
  let main = 0;
  sizes.forEach((n, i) => n > sizes[main] && (main = i));
  if (from) {
    const k = Math.round((from.z + T_HALF) / CELL) * T_RES + Math.round((from.x + T_HALF) / CELL);
    if (lab[k] >= 0) main = lab[k];
  }
  const out = new Uint8Array(T_RES * T_RES);
  for (let k = 0; k < out.length; k++) out[k] = lab[k] === main && sizes.length > 0 ? 1 : 0;
  return out;
}

/** Grades a road (a flat x, z polyline) so it can be walked end to end: wherever the land climbs or falls more than
 * `rise` meters per meter, the road cuts into the slope or runs on a bank instead, with steep sides. Across a pad (a
 * spawn or a site) it stays at the pad's height, so the pad and the road meet level. */
function gradeRoad(t: Terrain, pts: number[], pads: Ctx['pads'], graded: Uint8Array, rise = 0.4, half = 5, side = 7) {
  const xs: number[] = [];
  const zs: number[] = [];
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const n = Math.max(1, Math.ceil(Math.hypot(pts[i + 2] - pts[i], pts[i + 3] - pts[i + 1])));
    for (let k = 0; k < n; k++) {
      xs.push(lerp(pts[i], pts[i + 2], k / n));
      zs.push(lerp(pts[i + 1], pts[i + 3], k / n));
    }
  }
  xs.push(pts[pts.length - 2]);
  zs.push(pts[pts.length - 1]);
  const N = xs.length;
  const h = xs.map((x, k) => heightAt(t, x, zs[k]));
  const at = [0];
  for (let k = 1; k < N; k++) at.push(at[k - 1] + Math.hypot(xs[k] - xs[k - 1], zs[k] - zs[k - 1]));
  // fixed heights: the two ends, and every mark on a pad (at the pad's height)
  const fixed: number[] = [];
  const fixedY: number[] = [];
  for (let k = 0; k < N; k++) {
    const pad = pads.find((p) => Math.abs(xs[k] - p.x) <= p.hx + 0.5 && Math.abs(zs[k] - p.z) <= p.hz + 0.5);
    if (pad || k === 0 || k === N - 1) {
      fixed.push(k);
      fixedY.push(pad ? pad.y : h[k]);
    }
  }
  // between fixed marks: the profile nearest the land that never climbs faster than `rise` and meets both ends (a
  // straight grade when even that is too steep)
  const prof = h.slice();
  for (let f = 0; f < fixed.length; f++) prof[fixed[f]] = fixedY[f];
  for (let f = 0; f + 1 < fixed.length; f++) {
    const k0 = fixed[f];
    const k1 = fixed[f + 1];
    if (k1 - k0 < 2) continue;
    const y0 = fixedY[f];
    const y1 = fixedY[f + 1];
    const L = at[k1] - at[k0];
    if (Math.abs(y1 - y0) > rise * L) {
      for (let k = k0 + 1; k < k1; k++) prof[k] = lerp(y0, y1, (at[k] - at[k0]) / L);
      continue;
    }
    for (let k = k0 + 1; k < k1; k++) {
      const s0 = at[k] - at[k0];
      const s1 = at[k1] - at[k];
      const step = at[k] - at[k - 1];
      const lo = Math.max(y0 - rise * s0, y1 - rise * s1, prof[k - 1] - rise * step);
      const hi = Math.min(y0 + rise * s0, y1 + rise * s1, prof[k - 1] + rise * step);
      prof[k] = clamp(h[k], lo, Math.max(lo, hi));
    }
  }
  let x0 = Infinity;
  let x1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (let k = 0; k < N; k++)
    if (Math.abs(prof[k] - h[k]) > 0.05) {
      x0 = Math.min(x0, xs[k]);
      x1 = Math.max(x1, xs[k]);
      z0 = Math.min(z0, zs[k]);
      z1 = Math.max(z1, zs[k]);
    }
  if (x0 > x1) return;
  const pad = half + side;
  const i0 = Math.max(0, Math.floor((x0 - pad + T_HALF) / CELL));
  const i1 = Math.min(T_RES - 1, Math.ceil((x1 + pad + T_HALF) / CELL));
  const j0 = Math.max(0, Math.floor((z0 - pad + T_HALF) / CELL));
  const j1 = Math.min(T_RES - 1, Math.ceil((z1 + pad + T_HALF) / CELL));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const px = -T_HALF + i * CELL;
      const pz = -T_HALF + j * CELL;
      // the nearest meter mark on the road (fine enough at 1 m apart)
      let best = 0;
      let bd = Infinity;
      for (let k = 0; k < N; k++) {
        const d = (xs[k] - px) * (xs[k] - px) + (zs[k] - pz) * (zs[k] - pz);
        if (d < bd) {
          bd = d;
          best = k;
        }
      }
      const w = 1 - smoothstep(half, pad, Math.sqrt(bd));
      if (w <= 0 || Math.abs(prof[best] - h[best]) < 0.05) continue;
      const k = j * T_RES + i;
      t.h[k] = lerp(t.h[k], prof[best], w);
      graded[k] = 1;
    }
}

/** Two cuts close together can leave a knife edge of rock standing between them: round such slivers off (any point
 * near a cut standing well above the points around it), so no thin spike sticks up between two lanes. */
function roundRidges(t: Terrain, graded: Uint8Array) {
  const near = new Uint8Array(T_RES * T_RES);
  for (let j = 3; j < T_RES - 3; j++)
    for (let i = 3; i < T_RES - 3; i++) {
      if (!graded[j * T_RES + i]) continue;
      for (let b = -3; b <= 3; b++) for (let a = -3; a <= 3; a++) near[(j + b) * T_RES + i + a] = 1;
    }
  for (let pass = 0; pass < 6; pass++)
    for (let j = 1; j < T_RES - 1; j++)
      for (let i = 1; i < T_RES - 1; i++) {
        const k = j * T_RES + i;
        if (!near[k]) continue;
        const h = t.h;
        // standing above both sides along either axis (a ridge), or above all four (a spike)
        const ex = Math.min(h[k] - h[k - 1], h[k] - h[k + 1]);
        const ez = Math.min(h[k] - h[k - T_RES], h[k] - h[k + T_RES]);
        if (Math.max(ex, ez) > 1.6) h[k] = Math.max(h[k] - Math.max(ex, ez) * 0.6, (h[k - 1] + h[k + 1] + h[k - T_RES] + h[k + T_RES]) / 4);
      }
}

/** A square of concrete walls, 3 m tall, round a spawn, open where its roads leave; each opening has a screen wall a
 * few meters out, so you step out round a corner and nobody looks straight in (or out across the map). */
function spawnYard(c: Ctx, x: number, z: number, half = 17, seg = 2) {
  const t = c.t;
  const wall = (x0: number, z0: number, x1: number, z1: number) => {
    const lo = Math.min(heightAt(t, x0, z0), heightAt(t, x1, z1), heightAt(t, (x0 + x1) / 2, (z0 + z1) / 2));
    const hi = Math.max(heightAt(t, x0, z0), heightAt(t, x1, z1), heightAt(t, (x0 + x1) / 2, (z0 + z1) / 2));
    if (hi < t.water + 0.2 && !t.ice) return;
    const y0 = Math.max(lo, t.ice ? t.water : -Infinity) - 0.8;
    const y1 = Math.max(hi, t.ice ? t.water : -Infinity) + 3;
    c.pieces.push({ x0, y0, z0, x1, y1, z1, part: 'concrete', color: 0x9a978f, solid: true });
    c.blocks.push({ x0, y0, z0, x1, y1, z1 });
    c.taken.push({ x0: x0 - 1, z0: z0 - 1, x1: x1 + 1, z1: z1 + 1 });
  };
  for (let side = 0; side < 4; side++) {
    // along x (sides 0, 1) or along z (sides 2, 3), at -half or +half
    const alongX = side < 2;
    const off = side % 2 === 0 ? -half : half;
    let gap0 = Infinity;
    const close = (u: number) => {
      // an opening from gap0 to u: a screen wall 4.5 m out, 2 m wider than it on each end
      if (gap0 === Infinity) return;
      const a = gap0 - 2;
      const b = u + 2;
      const o = off + Math.sign(off) * 4.5;
      if (alongX) wall(x + a, z + o - 0.35, x + b, z + o + 0.35);
      else wall(x + o - 0.35, z + a, x + o + 0.35, z + b);
      gap0 = Infinity;
    };
    for (let u = -half; u < half; u += seg) {
      const ax = alongX ? x + u : x + off;
      const az = alongX ? z + off : z + u;
      const bx = alongX ? ax + seg : ax;
      const bz = alongX ? az : az + seg;
      if (roadDist(c, (ax + bx) / 2, (az + bz) / 2) < 3.6) {
        if (gap0 === Infinity) gap0 = u;
        continue;
      }
      close(u);
      if (alongX) wall(ax, az - 0.35, bx, az + 0.35);
      else wall(ax - 0.35, az, ax + 0.35, bz);
    }
    close(half);
  }
}

const onRegion = (region: Uint8Array, x: number, z: number) => region[Math.round((z + T_HALF) / CELL) * T_RES + Math.round((x + T_HALF) / CELL)] === 1;

/** Best spot near (x, z) for a pad: dry, flat, reachable and inside the arena. `along` limits the search to one axis. */
function findSpot(t: Terrain, region: Uint8Array, x: number, z: number, radius: number, along?: [number, number], arena = CORE) {
  let best = { x, z, score: Infinity };
  for (let a = -radius; a <= radius; a += 4)
    for (let b = -radius; b <= radius; b += 4) {
      if (along && Math.abs(a * along[0] + b * along[1]) > 6) continue;
      const px = x + a;
      const pz = z + b;
      if (Math.abs(px) > arena - 20 || Math.abs(pz) > arena - 20) continue;
      // off the main walkable land: out
      if (!onRegion(region, px, pz)) continue;
      let lo = Infinity;
      let hi = -Infinity;
      for (let u = -10; u <= 10; u += 5)
        for (let v = -10; v <= 10; v += 5) {
          const h = heightAt(t, px + u, pz + v);
          lo = Math.min(lo, h);
          hi = Math.max(hi, h);
        }
      const wet = Math.max(0, t.water + 1.2 - lo) * 8;
      const score = hi - lo + wet + Math.hypot(a, b) * 0.04;
      if (score < best.score) best = { x: px, z: pz, score };
    }
  return best;
}

function roadLine(c: Ctx, ax: number, az: number, bx: number, bz: number) {
  const pts: number[] = [];
  const len = Math.hypot(bx - ax, bz - az);
  const steps = Math.max(2, Math.ceil(len / 10));
  const px = -(bz - az) / len;
  const pz = (bx - ax) / len;
  const k = c.rng() * 100;
  for (let i = 0; i <= steps; i++) {
    const s = i / steps;
    const wob = Math.sin(s * Math.PI) * c.n.fbm(s * 2.5 + k, k, 2) * len * 0.12;
    pts.push(lerp(ax, bx, s) + px * wob, lerp(az, bz, s) + pz * wob);
  }
  for (let i = 0; i + 3 < pts.length; i += 2) c.roadSegs.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
  c.roads.push(pts);
}

const TREE_COLLIDE: Partial<Record<TreeKind, [number, number]>> = {
  oak: [0.32, 3.4],
  pine: [0.26, 4.5],
  birch: [0.17, 4],
  snowpine: [0.28, 4.5],
  palm: [0.2, 5],
  cactus: [0.36, 2.6],
  deadtree: [0.18, 3.2],
};

/** Rough crown sizes (radius, center height) for baked shadows. */
const CROWN: Record<TreeKind, [number, number]> = {
  oak: [3, 5.5],
  pine: [2, 6.5],
  birch: [1.8, 6],
  snowpine: [2.3, 6],
  palm: [2.6, 6.8],
  cactus: [0.5, 1.6],
  deadtree: [1.6, 4],
  shrub: [1, 0.6],
};
export const crownOf = (k: TreeKind) => CROWN[k];

function buildGrid(boxes: Box[], trunks: Trunk[], rocks: RockCol[]): Grid {
  const size = 8;
  const n = Math.ceil(T_SIZE / size);
  const lists: number[][] = Array.from({ length: n * n }, () => []);
  const add = (x0: number, z0: number, x1: number, z1: number, id: number) => {
    const i0 = clamp(Math.floor((x0 + T_HALF) / size), 0, n - 1);
    const i1 = clamp(Math.floor((x1 + T_HALF) / size), 0, n - 1);
    const j0 = clamp(Math.floor((z0 + T_HALF) / size), 0, n - 1);
    const j1 = clamp(Math.floor((z1 + T_HALF) / size), 0, n - 1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lists[j * n + i].push(id);
  };
  boxes.forEach((b, i) => add(b.x0, b.z0, b.x1, b.z1, K_BOX * KIND + i));
  trunks.forEach((t, i) => add(t.x - t.r, t.z - t.r, t.x + t.r, t.z + t.r, K_TRUNK * KIND + i));
  rocks.forEach((r, i) => add(r.x - r.r, r.z - r.r, r.x + r.r, r.z + r.r, K_ROCK * KIND + i));
  const start = new Int32Array(n * n + 1);
  let total = 0;
  for (let c = 0; c < n * n; c++) {
    start[c] = total;
    total += lists[c].length;
  }
  start[n * n] = total;
  const items = new Int32Array(total);
  for (let c = 0; c < n * n; c++) items.set(lists[c], start[c]);
  return { n, size, start, items };
}

const SURFACE: Record<Part, Surface> = { wall: 'stone', trim: 'stone', roof: 'stone', floor: 'wood', wood: 'wood', metal: 'metal', sandbag: 'dirt', concrete: 'stone', hesco: 'dirt' };

/** Loot spots minus any that ended up inside something solid (a crate in a barn, a truck, a tree trunk). */
function clearSpots(spots: number[], boxes: Box[], trunks: Trunk[]) {
  const out: number[] = [];
  for (let i = 0; i < spots.length; i += 3) {
    const x = spots[i];
    const y = spots[i + 1];
    const z = spots[i + 2];
    const inBox = boxes.some((b) => x > b.x0 - 0.25 && x < b.x1 + 0.25 && z > b.z0 - 0.25 && z < b.z1 + 0.25 && b.y0 < y + 0.6 && b.y1 > y + 0.05);
    const inTrunk = trunks.some((t) => Math.hypot(t.x - x, t.z - z) < t.r + 0.3);
    if (!inBox && !inTrunk) out.push(x, y, z);
  }
  return out;
}

/** The spawn pads, each team's five slots across it, facing along u (the attack) or back (the defense). */
function makeSpawns(c: Ctx, at: { x: number; z: number }[], ux: number, uz: number, vx: number, vz: number, pad = 12) {
  const t = c.t;
  return at.map((p, team) => {
    const y = meanHeight(t, p.x, p.z, 12, 12);
    flattenRect(t, p.x, p.z, pad, pad, y, pad === 12 ? 9 : 5);
    c.pads.push({ x: p.x, z: p.z, hx: pad, hz: pad, y });
    c.taken.push({ x0: p.x - 15, z0: p.z - 15, x1: p.x + 15, z1: p.z + 15 });
    const fx = team === 0 ? ux : -ux;
    const fz = team === 0 ? uz : -uz;
    const yaw = yawTo(fx, fz);
    const slots: Slot[] = [-6, -3, 0, 3, 6].map((o, k) => ({ x: p.x + vx * o - fx * (k % 2) * 2.5, z: p.z + vz * o - fz * (k % 2) * 2.5, yaw }));
    return { x: p.x, y, z: p.z, yaw, slots };
  }) as [Spawn, Spawn];
}

function makeSites(c: Ctx, at: { x: number; z: number }[], names: string[]) {
  const t = c.t;
  return at.map((p, k): Site => {
    const y = meanHeight(t, p.x, p.z, 8, 8);
    flattenRect(t, p.x, p.z, 9, 9, y, 8);
    c.pads.push({ x: p.x, z: p.z, hx: 9, hz: 9, y });
    c.taken.push({ x0: p.x - 13, z0: p.z - 13, x1: p.x + 13, z1: p.z + 13 });
    return { id: k, name: 'ABC'[k], town: names[k], x: p.x, y, z: p.z };
  });
}

/** The site masts: a waist high concrete block to hide behind and an antenna. */
function siteMasts(c: Ctx, sites: Site[]) {
  for (const s of sites) {
    const f = new Frame(c, s.x, s.z, 0);
    f.box(-0.9, s.y - 0.3, -0.9, 0.9, s.y + 1.15, 0.9, 'concrete', 0x8f8d88);
    f.box(-0.12, s.y + 1.15, -0.12, 0.12, s.y + 6.5, 0.12, 'metal', 0x6a6e72);
    f.box(-0.7, s.y + 5.2, -0.06, 0.7, s.y + 5.32, 0.06, 'metal', 0x6a6e72, false);
    f.box(-0.06, s.y + 4.4, -0.6, 0.06, s.y + 4.52, 0.6, 'metal', 0x6a6e72, false);
  }
}

const KINDS: Kind[] = ['house', 'house', 'house', 'shed', 'ruin', 'barn'];

/** A few towns out past the playing ground, only for the view. */
function vistaTowns(c: Ctx, towns: Town[], from: number) {
  const { t, def } = c;
  const r = c.rng;
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2;
    const d = from + 50 + r() * 120;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (heightAt(t, x, z) < t.water + 2) continue;
    towns.push({ name: def.pois[5 + k] ?? 'Outpost', x, z, site: -1 });
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < 5; tries++) {
      const b = r() * Math.PI * 2;
      const e = 6 + r() * 30;
      if (tryBuilding(c, KINDS[Math.floor(r() * KINDS.length)], x + Math.cos(b) * e, z + Math.sin(b) * e, T_HALF - 40)) placed++;
    }
  }
}

/** A royale's layout over the whole land: two spawns and three sites spread far apart (in a royale they only seed
 * towns), towns all over joined by roads, and cover strewn everywhere. */
function royaleLayout(c: Ctx) {
  const { t, def } = c;
  const r = c.rng;
  const ARENA = c.arena;
  const region = walkRegion(t, ARENA);
  const th0 = r() * Math.PI * 2;
  const ux = Math.cos(th0);
  const uz = Math.sin(th0);
  const vx = -uz;
  const vz = ux;
  const spawnAt = [-1, 1].map((sgn) => findSpot(t, region, sgn * 120 * ux, sgn * 120 * uz, 24));
  const siteAt = [-1, 0, 1].map((k) => findSpot(t, region, k * 82 * vx, k * 82 * vz, 24, [ux, uz]));
  const spawns = makeSpawns(c, spawnAt, ux, uz, vx, vz);
  const sites = makeSites(c, siteAt, def.pois);

  // roads: each spawn to each site, and the sites to each other
  for (const s of spawns) for (const site of sites) roadLine(c, s.x, s.z, site.x, site.z);
  roadLine(c, sites[0].x, sites[0].z, sites[1].x, sites[1].z);
  roadLine(c, sites[1].x, sites[1].z, sites[2].x, sites[2].z);
  siteMasts(c, sites);

  // towns: one around each site, two out on the flanks, and towns over the whole land, each joined by a road to the
  // nearest one already there
  const towns: Town[] = sites.map((s) => ({ name: s.town, x: s.x, z: s.z, site: s.id }));
  for (const sgn of [-1, 1]) {
    const p = findSpot(t, region, sgn * 135 * vx, sgn * 135 * vz, 18, [ux, uz]);
    towns.push({ name: def.pois[sgn < 0 ? 3 : 4], x: p.x, z: p.z, site: -1 });
  }
  const names = ['Brook', 'Mill', 'Quarry', 'Pines', 'Harbor', 'Crossing', 'Depot', 'Farm', 'Outlook', 'Station'];
  for (let k = 0, made = 0; k < 160 && made < 9; k++) {
    const a = r() * Math.PI * 2;
    const d = 130 + r() * 170;
    const p = findSpot(t, region, Math.cos(a) * d, Math.sin(a) * d, 26, undefined, ARENA);
    if (!Number.isFinite(p.score) || towns.some((q) => Math.hypot(q.x - p.x, q.z - p.z) < 85)) continue;
    let near = towns[0];
    for (const q of towns) if (Math.hypot(q.x - p.x, q.z - p.z) < Math.hypot(near.x - p.x, near.z - p.z)) near = q;
    roadLine(c, near.x, near.z, p.x, p.z);
    towns.push({ name: `${def.pois[k % def.pois.length]} ${names[made % names.length]}`, x: p.x, z: p.z, site: -2 });
    made++;
  }
  for (const town of towns) {
    const want = town.site >= 0 ? 6 : town.site === -2 ? 7 : 4;
    let placed = 0;
    for (let tries = 0; tries < 120 && placed < want; tries++) {
      const a = r() * Math.PI * 2;
      const d = (town.site >= 0 ? 17 : 6) + r() * 32;
      if (tryBuilding(c, KINDS[Math.floor(r() * KINDS.length)], town.x + Math.cos(a) * d, town.z + Math.sin(a) * d, ARENA - 4)) placed++;
    }
  }
  vistaTowns(c, towns, CORE);
  // lone buildings out in the open
  for (let k = 0, placed = 0; k < 400 && placed < 30; k++)
    if (tryBuilding(c, r() < 0.5 ? 'ruin' : 'shed', (r() * 2 - 1) * (ARENA - 15), (r() * 2 - 1) * (ARENA - 15), ARENA - 4)) placed++;

  // cover: an armored truck by each spawn and one by the middle site, HESCO walls and more round every site, containers
  // at the spawns, trucks and cover all over
  const propKinds: PropKind[] = ['container', 'crates', 'sandbags', 'hesco', 'barrier', 'pile', 'hesco', 'wire', 'dumpsters', 'fence', 'barrier', 'pile'];
  for (const s of spawns)
    for (let k = 0, placed = 0; k < 60 && placed < 1; k++) {
      const a = r() * Math.PI * 2;
      if (tryProp(c, 'truck', s.x + Math.cos(a) * 20, s.z + Math.sin(a) * 20, ARENA - 4)) placed++;
    }
  for (let k = 0, placed = 0; k < 60 && placed < 1; k++) {
    const a = r() * Math.PI * 2;
    if (tryProp(c, 'truck', sites[1].x + Math.cos(a) * 16, sites[1].z + Math.sin(a) * 16, ARENA - 4)) placed++;
  }
  for (const s of sites)
    for (let k = 0, placed = 0; k < 40 && placed < 2; k++) {
      const a = r() * Math.PI * 2;
      if (tryProp(c, 'hesco', s.x + Math.cos(a) * (12 + r() * 6), s.z + Math.sin(a) * (12 + r() * 6), ARENA - 3)) placed++;
    }
  for (const s of sites)
    for (let k = 0, placed = 0; k < 60 && placed < 5; k++) {
      const a = r() * Math.PI * 2;
      const d = 11 + r() * 16;
      if (tryProp(c, propKinds[Math.floor(r() * propKinds.length)], s.x + Math.cos(a) * d, s.z + Math.sin(a) * d, ARENA - 3)) placed++;
    }
  for (const s of spawns)
    for (let k = 0, placed = 0; k < 40 && placed < 2; k++) {
      const a = r() * Math.PI * 2;
      if (tryProp(c, 'container', s.x + Math.cos(a) * 19, s.z + Math.sin(a) * 19, ARENA - 3)) placed++;
    }
  for (let k = 0, placed = 0; k < 400 && placed < 6; k++) {
    const a = r() * Math.PI * 2;
    const d = 60 + r() * 250;
    if (tryProp(c, 'truck', Math.cos(a) * d, Math.sin(a) * d, ARENA - 4)) placed++;
  }
  for (let k = 0, placed = 0; k < 1600 && placed < 120; k++)
    if (tryProp(c, propKinds[Math.floor(r() * propKinds.length)], (r() * 2 - 1) * (ARENA - 8), (r() * 2 - 1) * (ARENA - 8), ARENA - 3)) placed++;

  // later pads blend into earlier ones at their edges: put every pad back exactly
  for (const p of c.pads) flattenRect(t, p.x, p.z, p.hx, p.hz, p.y, 0.01);
  for (const s of spawns) s.y = heightAt(t, s.x, s.z);
  for (const s of sites) s.y = heightAt(t, s.x, s.z);
  return { region, spawns, sites, towns, shape: null };
}

/** A plan's quarter turn for something whose front looks along a world direction. */
const rotFacing = (fx: number, fz: number) => (Math.abs(fz) >= Math.abs(fx) ? (fz < 0 ? 0 : 2) : fx > 0 ? 1 : 3);

/**
 * A breach arena, built from its map's plan (see breach.ts): the places drafted, the land sculpted round them, the
 * spawns and sites on their pads, the lanes laid as roads and graded, then the places built, cover along the lanes and
 * round the sites, and the banks put back wherever building wore them down.
 */
function breachLayout(c: Ctx) {
  const { t, def } = c;
  const ARENA = c.arena;
  const plan = PLANS[def.id];
  const W = (p: BP) => toWorld(plan, p[0], p[1]);
  const xz = (p: BP) => {
    const [x, z] = W(p);
    return { x, z };
  };
  const items = draftPlaces(plan, def);
  const shape = sculpt(t, def, plan, items, ARENA);
  const [ux, uz] = W([1, 0]);
  const [vx, vz] = W([0, 1]);
  // (the yard and the screens at its gates on level ground: on a slope they leave pockets to get caught in)
  const spawns = makeSpawns(c, [xz(plan.atk), xz(plan.def)], ux, uz, vx, vz, 22);
  const siteName = (k: number) => plan.places.find((p) => p.site === k)?.name ?? def.pois[k];
  const sites = makeSites(c, plan.sites.map(xz), [siteName(0), siteName(1)]);

  // the lanes, as roads a meter or so apart, graded so each can be walked end to end
  for (const l of plan.lanes) {
    const pts: number[] = [];
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const [ax, az] = W(l.pts[i]);
      const [bx, bz] = W(l.pts[i + 1]);
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 6));
      for (let k = 0; k < n; k++) pts.push(lerp(ax, bx, k / n), lerp(az, bz, k / n));
    }
    const [ex, ez] = W(l.pts[l.pts.length - 1]);
    pts.push(ex, ez);
    for (let i = 0; i + 3 < pts.length; i += 2) c.roadSegs.push(pts[i], pts[i + 1], pts[i + 2], pts[i + 3]);
    c.roads.push(pts);
  }
  const graded = new Uint8Array(T_RES * T_RES);
  for (const pts of c.roads) gradeRoad(t, pts, c.pads, graded);
  roundRidges(t, graded);
  // each spawn is a walled yard you leave by its lanes, so nobody sees into it from across the map
  for (const sp of spawns) spawnYard(c, sp.x, sp.z);
  siteMasts(c, sites);

  // the places
  for (const it of items) placeItem(c, plan, it);

  // cover along the lanes, a piece every so often at alternate edges, away from the places (which have their own)
  const q = mulberry32(def.seed * 53 + 7);
  const inPlace = (x: number, z: number) => {
    const [u, v] = toPlan(plan, x, z);
    if (Math.hypot(u - plan.atk[0], v - plan.atk[1]) < 30 || Math.hypot(u - plan.def[0], v - plan.def[1]) < 30) return true;
    return plan.plazas.some((p) => (p.round ? Math.hypot(u - p.at[0], v - p.at[1]) : Math.max(Math.abs(u - p.at[0]), Math.abs(v - p.at[1]))) < p.r + 3);
  };
  plan.lanes.forEach((l, li) => {
    const pts = c.roads[li];
    let side = li % 2 ? 1 : -1;
    let next = 8 + q() * 8;
    let along = 0;
    for (let i = 0; i + 3 < pts.length; i += 2) {
      const sx = pts[i + 2] - pts[i];
      const sz = pts[i + 3] - pts[i + 1];
      const len = Math.hypot(sx, sz);
      while (len > 0 && next < along + len) {
        const k = (next - along) / len;
        const x = pts[i] + sx * k;
        const z = pts[i + 1] + sz * k;
        next += 10 + q() * 6;
        if (inPlace(x, z)) continue;
        const nx = -sz / len;
        const nz = sx / len;
        // (well in from the banks: a gap too narrow to walk between a crate and a bank only traps people; on a
        // narrow lane that leaves no room, and the lane goes without)
        const off = Math.max(1.8, l.w - 3.8) * side;
        side = -side;
        const kind = pick(q, plan.cover);
        const px = x + nx * off;
        const pz = z + nz * off;
        const [fu, fv] = toPlan(plan, sx / len, sz / len);
        if (kind === 'logs') placeItem(c, plan, { t: 'struct', what: 'logs', at: toPlan(plan, px, pz), face: Math.abs(fu) > Math.abs(fv) ? [0, 1] : [1, 0], s: 1 });
        else tryProp(c, kind, px, pz, ARENA - 3, undefined, true, { rot: Math.abs(sx) > Math.abs(sz) ? 0 : 1, units: 3 });
      }
      along += len;
    }
  });

  // round each site, cover to hold it from and to fight over it: a few on the site itself, clear of the mast, and a
  // few further out (from its own random stream)
  const keep = [c.rng, c.deco];
  c.rng = mulberry32(def.seed * 31 + 17);
  c.deco = mulberry32(def.seed * 37 + 1);
  const qr = c.rng;
  const near: PropKind[] = ['crates', 'sandbags', 'hesco', 'barrier', 'pile', 'crates', 'hesco'];
  const pads = c.taken.filter((p) => sites.some((s) => p.x0 === s.x - 13 && p.z0 === s.z - 13));
  c.taken = c.taken.filter((p) => !pads.includes(p));
  for (const s of sites)
    for (const [lo, span, want] of [
      [5, 6, 3],
      [13, 7, 3],
    ])
      for (let k = 0, placed = 0; k < 40 && placed < want; k++) {
        const a = qr() * Math.PI * 2;
        const d = lo + qr() * span;
        const x = s.x + Math.cos(a) * d;
        const z = s.z + Math.sin(a) * d;
        if (!solidNear(c, x, z, 4.5) && tryProp(c, near[Math.floor(qr() * near.length)], x, z, ARENA - 3, undefined, true)) placed++;
      }
  c.taken.push(...pads);
  // and wherever the open ground still lies bare (nothing standing within 8 m), a piece of cover, so a fight turns on
  // angles and not on who spots whom first across an open yard
  const fill: PropKind[] = ['crates', 'sandbags', 'hesco', 'barrier', 'pile', 'crates', 'sandbags', 'container'];
  for (let gx = -ARENA + 8; gx <= ARENA - 8; gx += 11)
    for (let gz = -ARENA + 8; gz <= ARENA - 8; gz += 11) {
      const x = gx + (qr() - 0.5) * 6;
      const z = gz + (qr() - 0.5) * 6;
      if (openAt(shape, x, z) > 0 || solidNear(c, x, z, 8)) continue;
      // (and not hard by a bank, where it would leave a gap too narrow to walk)
      if ([[4, 0], [-4, 0], [0, 4], [0, -4]].some(([a, b]) => normalAt(t, x + a, z + b).y < 0.85)) continue;
      if (spawns.some((sp) => Math.hypot(sp.x - x, sp.z - z) < 24) || sites.some((st) => Math.hypot(st.x - x, st.z - z) < 4)) continue;
      for (let k = 0; k < 4; k++) if (tryProp(c, fill[Math.floor(qr() * fill.length)], x + (qr() - 0.5) * 4, z + (qr() - 0.5) * 4, ARENA - 3, undefined, true)) break;
    }
  // an armored truck and two containers by each spawn
  for (const s of spawns) {
    for (let k = 0, placed = 0; k < 60 && placed < 1; k++) {
      const a = qr() * Math.PI * 2;
      if (tryProp(c, 'truck', s.x + Math.cos(a) * 20, s.z + Math.sin(a) * 20, ARENA - 4)) placed++;
    }
    for (let k = 0, placed = 0; k < 40 && placed < 2; k++) {
      const a = qr() * Math.PI * 2;
      if (tryProp(c, 'container', s.x + Math.cos(a) * 19, s.z + Math.sin(a) * 19, ARENA - 3)) placed++;
    }
  }
  [c.rng, c.deco] = keep;

  // towns past the arena for the view
  const towns: Town[] = sites.map((s) => ({ name: s.town, x: s.x, z: s.z, site: s.id }));
  for (const p of plan.places) if (p.site < 0) towns.push({ name: p.name, ...xz(plan.plazas[p.plaza].at), site: -1 });
  vistaTowns(c, towns, ARENA);

  // later pads blend into earlier ones at their edges: put every pad back exactly, and the banks round the lanes
  for (const p of c.pads) flattenRect(t, p.x, p.z, p.hx, p.hz, p.y, 0.01);
  restoreBanks(t, shape);
  for (const s of spawns) s.y = heightAt(t, s.x, s.z);
  for (const s of sites) s.y = heightAt(t, s.x, s.z);
  return { region: walkRegion(t, ARENA, sites[0]), spawns, sites, towns, shape };
}

/** The nearest line of cell centers of the bots' 2 m path grid (see nav.ts) to a coordinate. */
const onNavLine = (c: Ctx, v: number) => Math.round((v + c.arena - 1) / 2) * 2 - (c.arena - 1);

/** Builds one drafted thing of a breach plan in the world. */
function placeItem(c: Ctx, plan: Plan, it: Item) {
  const t = c.t;
  if (it.t === 'wall') {
    // in stretches of six meters or less, each from its own lowest ground to `h` over its highest
    let [ax, az] = toWorld(plan, it.a[0], it.a[1]);
    let [bx, bz] = toWorld(plan, it.b[0], it.b[1]);
    // (on a line of the bots' path grid, which a thin wall lying between two of its points would slip through)
    if (Math.abs(ax - bx) < Math.abs(az - bz)) ax = bx = onNavLine(c, ax);
    else az = bz = onNavLine(c, az);
    const len = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(len / 6));
    for (let k = 0; k < n; k++) {
      const x0 = lerp(ax, bx, k / n);
      const z0 = lerp(az, bz, k / n);
      const x1 = lerp(ax, bx, (k + 1) / n);
      const z1 = lerp(az, bz, (k + 1) / n);
      let lo = Infinity;
      let hi = -Infinity;
      for (let s = 0; s <= 1; s += 0.25) {
        const g = floorAt(t, lerp(x0, x1, s), lerp(z0, z1, s));
        lo = Math.min(lo, g);
        hi = Math.max(hi, g);
      }
      const p = { x0: Math.min(x0, x1) - 0.25, z0: Math.min(z0, z1) - 0.25, x1: Math.max(x0, x1) + 0.25, z1: Math.max(z0, z1) + 0.25 };
      c.pieces.push({ ...p, y0: lo - 0.6, y1: hi + it.h, part: it.part, color: it.color, solid: true });
      // a coping along the top
      if (it.h > 2) c.pieces.push({ x0: p.x0 - 0.08, z0: p.z0 - 0.08, x1: p.x1 + 0.08, z1: p.z1 + 0.08, y0: hi + it.h, y1: hi + it.h + 0.14, part: 'trim', color: 0x8a7458, solid: false });
      c.blocks.push({ ...p, y0: lo, y1: hi + it.h });
      c.taken.push({ x0: p.x0 - 1.5, z0: p.z0 - 1.5, x1: p.x1 + 1.5, z1: p.z1 + 1.5 });
    }
    return;
  }
  const [x, z] = toWorld(plan, it.at[0], it.at[1]);
  if (it.t === 'deco') {
    // (where nothing else stands: clutter that stops you must not close a gap)
    if (solidNear(c, x, z, 1.4)) return;
    const y = floorAt(t, x, z);
    c.models.push({ key: it.key, x, y, z, yaw: c.deco() * Math.PI * 2 });
    const solid = CLUTTER_SOLID[it.key];
    if (solid) c.colliders.push({ x0: x - solid[0], y0: y, z0: z - solid[0], x1: x + solid[0], y1: y + solid[1], z1: z + solid[0], s: 'metal' });
    return;
  }
  const [fx, fz] = toWorld(plan, it.face[0], it.face[1]);
  if (it.t === 'prop') {
    // (cover along a line stands with its long side along the line, given by its face)
    const rot = Math.abs(fx) > Math.abs(fz) ? 0 : 1;
    const line = it.kind === 'fence';
    tryProp(c, it.kind, line && rot ? onNavLine(c, x) : x, line && !rot ? onNavLine(c, z) : z, c.arena - 3, undefined, true, { rot, key: it.key, force: line || it.kind === 'hesco', units: it.units ?? 4 });
    return;
  }
  const rot = rotFacing(fx, fz);
  if (it.t === 'bld') {
    // whole meters, its outer walls on lines of the bots' path grid (so no thin wall slips between its points), and
    // in through the doors
    const bw = Math.max(4, Math.round(it.w / 2) * 2);
    const bd = Math.max(4, Math.round(it.d / 2) * 2);
    const hx = (rot & 1 ? bd : bw) / 2;
    const hz = (rot & 1 ? bw : bd) / 2;
    const bx = onNavLine(c, x - hx) + hx;
    const bz = onNavLine(c, z - hz) + hz;
    let y = meanHeight(t, bx, bz, hx, hz);
    if (t.ice) y = Math.max(y, t.water);
    flattenRect(t, bx, bz, hx + 0.6, hz + 0.6, y, 6);
    c.pads.push({ x: bx, z: bz, hx: hx + 0.6, hz: hz + 0.6, y });
    c.taken.push({ x0: bx - hx - 2, z0: bz - hz - 2, x1: bx + hx + 2, z1: bz + hz + 2 });
    addBuilding(c, it.kind, bx, bz, bw, bd, rot, y);
    return;
  }
  structure(c, it, x, z, rot);
}

/** A structure of a breach place (see STRUCT_SIZE for their footprints): local x across, the front toward -z. */
function structure(c: Ctx, it: Extract<Item, { t: 'struct' }>, x: number, z: number, rot: number) {
  const t = c.t;
  const r = c.deco;
  const f = new Frame(c, x, z, rot);
  const [w, d] = STRUCT_SIZE[it.what];
  const style = c.def.style;
  const pad = (hw: number, hd: number, margin = 3) => {
    const rr = f.rect(-hw, -hd, hw, hd);
    const cx = (rr.x0 + rr.x1) / 2;
    const cz = (rr.z0 + rr.z1) / 2;
    const ex = (rr.x1 - rr.x0) / 2;
    const ez = (rr.z1 - rr.z0) / 2;
    const y = Math.max(meanHeight(t, cx, cz, ex, ez), t.ice ? t.water : -Infinity);
    flattenRect(t, cx, cz, ex + 0.4, ez + 0.4, y, margin);
    c.pads.push({ x: cx, z: cz, hx: ex + 0.4, hz: ez + 0.4, y });
    return y;
  };
  const block = (hw: number, hd: number, y0: number, y1: number) => {
    const rr = f.rect(-hw, -hd, hw, hd);
    c.blocks.push({ ...rr, y0, y1 });
    c.taken.push({ x0: rr.x0 - 1, z0: rr.z0 - 1, x1: rr.x1 + 1, z1: rr.z1 + 1 });
  };
  const steel = style === 'adobe' ? 0xc9c2b4 : style === 'tropic' ? 0xd7d2c4 : 0xb5babf;
  switch (it.what) {
    case 'silo': {
      const H = it.tall ?? 11;
      const y = pad(2, 2);
      f.box(-1.8, y - 0.4, -1.8, 1.8, y + H, 1.8, 'metal', 0xb9bdc0);
      for (let h = 2.4; h < H; h += 2.6) f.box(-1.86, y + h, -1.86, 1.86, y + h + 0.16, 1.86, 'metal', 0x8d9296, false);
      f.box(-1.4, y + H, -1.4, 1.4, y + H + 0.7, 1.4, 'metal', 0x9aa0a4);
      f.box(-0.7, y + H + 0.7, -0.7, 0.7, y + H + 1.2, 0.7, 'metal', 0x9aa0a4);
      // a ladder up the front
      f.box(-0.3, y, -1.95, -0.24, y + H, -1.85, 'metal', 0x6a6e72, false);
      f.box(0.24, y, -1.95, 0.3, y + H, -1.85, 'metal', 0x6a6e72, false);
      block(1.8, 1.8, y, y + H + 1);
      break;
    }
    case 'tank': {
      const H = it.tall ?? 6;
      const y = pad(3.2, 3.2);
      f.box(-3.2, y - 0.3, -3.2, 3.2, y + 0.3, 3.2, 'concrete', 0x9a978f);
      f.box(-2.9, y + 0.3, -2.9, 2.9, y + H, 2.9, 'metal', steel);
      f.box(-2.96, y + H * 0.5, -2.96, 2.96, y + H * 0.5 + 0.14, 2.96, 'metal', 0x8d9296, false);
      f.box(-2.3, y + H, -2.3, 2.3, y + H + 0.5, 2.3, 'metal', steel);
      f.box(-0.3, y + 0.3, -3.05, 0.3, y + H, -2.9, 'metal', 0x6a6e72, false);
      block(3, 3, y, y + H + 0.5);
      break;
    }
    case 'mast': {
      const H = it.tall ?? 20;
      const y = pad(1.1, 1.1, 2);
      f.box(-0.9, y - 0.4, -0.9, 0.9, y + 0.9, 0.9, 'concrete', 0x8f8d88);
      // a lattice tower: four legs closing in as it rises, a brace every few meters, a dish and a light on top
      for (let h = 0.9; h < H; h += 3) {
        const s0 = 0.75 - (h / H) * 0.5;
        const top = Math.min(H, h + 3);
        for (const [a, b] of [
          [-1, -1],
          [1, -1],
          [-1, 1],
          [1, 1],
        ])
          f.box(a * s0 - 0.06, y + h, b * s0 - 0.06, a * s0 + 0.06, y + top, b * s0 + 0.06, 'metal', 0xb04030, false);
        f.box(-s0, y + top - 0.12, -s0, s0, y + top, s0, 'metal', 0xd8d4cc, false);
      }
      f.box(-0.5, y + H - 3, -0.75, 0.5, y + H - 2, -0.35, 'metal', 0xe8e8e4, false);
      f.box(-0.08, y + H, -0.08, 0.08, y + H + 1.6, 0.08, 'metal', 0x6a6e72, false);
      block(0.9, 0.9, y, y + H);
      break;
    }
    case 'crane': {
      const y = pad(5.5, 1.5, 2);
      const yc = 0xd8a428;
      for (const s of [-4.5, 4.5]) f.box(s - 0.5, y - 0.3, -0.5, s + 0.5, y + 13, 0.5, 'metal', yc);
      f.box(-5.5, y + 13, -0.7, 5.5, y + 14.2, 0.7, 'metal', yc);
      // the jib out over the water, a cab, the cable and the hook
      f.box(-0.5, y + 13.3, -16, 0.5, y + 14, -0.7, 'metal', yc, false);
      f.box(-0.5, y + 13.3, 0.7, 0.5, y + 14, 5, 'metal', yc, false);
      f.box(-1, y + 10.6, 0.6, 1, y + 13, 2.6, 'metal', 0x4a4e52, false);
      f.box(-0.4, y + 9.8, 3.2, 0.4, y + 13.3, 4.6, 'concrete', 0x8a8780, false);
      f.box(-0.03, y + 5, -12.05, 0.03, y + 13.3, -11.95, 'metal', 0x3a3a3a, false);
      f.box(-0.3, y + 4.4, -12.3, 0.3, y + 5, -11.7, 'metal', 0x6a6e72, false);
      block(5.5, 0.7, y, y + 14);
      break;
    }
    case 'pier': {
      // a deck out over the water on posts, from its foot at the quay
      const y = Math.max(t.water, 0) + 1.25;
      const L = it.s;
      f.box(-2, y - 0.3, -L, 2, y, 0, 'floor', 0x8a6a4a);
      for (let s = 3; s < L; s += 4)
        for (const a of [-1.8, 1.8]) {
          const g = heightAt(t, ...f.xz(a, -s)) - 0.5;
          f.box(a - 0.18, Math.min(g, y - 2), -s - 0.18, a + 0.18, y + (s % 8 < 4 ? 0.5 : -0.3), -s + 0.18, 'wood', 0x5f4a36);
        }
      c.blocks.push({ ...f.rect(-2, -L, 2, 0), y0: y - 0.3, y1: y });
      break;
    }
    case 'boat': {
      const y = Math.max(t.water, 0);
      const hull = pick(r, [0x2f5d8a, 0x9b3b2b, 0xe0dccc, 0x3d7a4a]);
      f.box(-1.4, y - 0.7, -3.6, 1.4, y + 0.9, 4, 'wood', hull);
      f.box(-0.9, y - 0.5, -4.8, 0.9, y + 1, -3.6, 'wood', hull);
      f.box(-0.4, y - 0.3, -5.4, 0.4, y + 1.05, -4.8, 'wood', hull);
      f.box(-1.45, y + 0.9, -3.6, 1.45, y + 1.05, 4, 'trim', 0xd8d2c4, false);
      f.box(-1, y + 0.9, 0.6, 1, y + 2.4, 3.2, 'wall', 0xf2eee2);
      f.box(-1.1, y + 2.4, 0.5, 1.1, y + 2.55, 3.3, 'trim', 0x7a5638, false);
      f.box(-0.06, y + 2.55, 1.8, 0.06, y + 6, 1.92, 'metal', 0xb5babf, false);
      block(1.4, 4, y, y + 2.5);
      break;
    }
    case 'logs': {
      const y = floorAt(t, x, z) - 0.15;
      const bark = 0x6e4e34;
      const cut = 0xc9a878;
      f.box(-3, y, -1.15, 3, y + 1.05, -0.05, 'wood', bark);
      f.box(-3, y, 0.05, 3, y + 1.05, 1.15, 'wood', bark);
      f.box(-2.7, y + 1.05, -0.55, 2.7, y + 2, 0.55, 'wood', bark);
      for (const s of [-1, 1]) {
        f.box(s * 3 - 0.02, y + 0.05, -1.1, s * 3 + 0.02, y + 1, -0.1, 'trim', cut, false);
        f.box(s * 3 - 0.02, y + 0.05, 0.1, s * 3 + 0.02, y + 1, 1.1, 'trim', cut, false);
        f.box(s * 2.7 - 0.02, y + 1.1, -0.5, s * 2.7 + 0.02, y + 1.95, 0.5, 'trim', cut, false);
      }
      block(3, 1.15, y, y + 2);
      break;
    }
    case 'well': {
      const y = floorAt(t, x, z);
      const stone = style === 'adobe' ? 0xb0875e : 0x9a948a;
      f.box(-1, y - 0.4, -1, 1, y + 0.85, -0.7, 'wall', stone);
      f.box(-1, y - 0.4, 0.7, 1, y + 0.85, 1, 'wall', stone);
      f.box(-1, y - 0.4, -0.7, -0.7, y + 0.85, 0.7, 'wall', stone);
      f.box(0.7, y - 0.4, -0.7, 1, y + 0.85, 0.7, 'wall', stone);
      f.box(-0.7, y - 0.4, -0.7, 0.7, y + 0.3, 0.7, 'concrete', 0x3a4448, false);
      for (const s of [-0.85, 0.85]) f.box(s - 0.08, y + 0.85, -0.08, s + 0.08, y + 2.3, 0.08, 'wood', 0x5f4a36, false);
      f.box(-1.2, y + 2.3, -0.7, 1.2, y + 2.45, 0.7, 'wood', 0x7a5638, false);
      block(1, 1, y, y + 0.85);
      break;
    }
    case 'stall': {
      const y = floorAt(t, x, z);
      const cloth = pick(r, [0xb5532e, 0x2f6d8a, 0xd8b04a, 0x6d8a3d, 0xe9a39c]);
      f.box(-1.6, y - 0.1, -1, 1.6, y + 1, -0.4, 'wood', 0x8a6a4a);
      for (const [a, b] of [
        [-1.6, -1],
        [1.6, -1],
        [-1.6, 1],
        [1.6, 1],
      ])
        f.box(a - 0.05, y, b - 0.05, a + 0.05, y + 2.35, b + 0.05, 'wood', 0x5f4a36, false);
      f.box(-1.75, y + 2.3, -1.15, 1.75, y + 2.42, 1.15, 'wall', cloth, false);
      for (let k = 0; k < 3; k++) f.box(-1.3 + k * 0.9, y + 1, -0.9, -0.8 + k * 0.9, y + 1.25 + r() * 0.15, -0.5, 'wall', pick(r, [0xc04a2a, 0xd8b04a, 0x6d8a3d]), false);
      if (r() < 0.6) crates(c, f, 0.6, 0.6, y);
      block(1.6, 1, y, y + 1);
      break;
    }
    case 'gate': {
      // two towers and an arch over the way through, and walls out from them into the banks either side
      const y = floorAt(t, x, z);
      const col = 0xc8996a;
      const trim = 0x6b4a2e;
      for (const s of [-1, 1]) {
        f.box(s * 2.5, y - 0.6, -2, s * 6.5, y + 7.5, 2, 'wall', col);
        for (const a of [2.7, 4.1, 5.5]) f.box(s * a, y + 7.5, -2, s * (a + 0.8), y + 8.2, -1.5, 'wall', col, false);
        f.box(s * 4.2 - 0.5, y + 4.6, -2.05, s * 4.2 + 0.5, y + 5.6, -1.98, 'trim', 0x2a2420, false);
        let gx = s * 6.5;
        while (Math.abs(gx) < it.s / 2) {
          const nx = gx + s * Math.min(4, it.s / 2 - Math.abs(gx));
          const [px, pz] = f.xz((gx + nx) / 2, 0);
          const g = heightAt(t, px, pz);
          f.box(Math.min(gx, nx), Math.min(g, y) - 1, -0.45, Math.max(gx, nx), Math.max(g, y) + 4.2, 0.45, 'wall', col);
          gx = nx;
        }
      }
      f.box(-2.5, y + 4.6, -1.7, 2.5, y + 6.2, 1.7, 'wall', col);
      f.box(-2.6, y + 6.2, -1.8, 2.6, y + 6.4, 1.8, 'trim', trim, false);
      for (let a = -2.3; a < 2.3; a += 0.9) f.box(a, y + 4.4, -1.75, a + 0.18, y + 4.6, 1.75, 'trim', trim, false);
      block(6.5, 2, y, y + 7.5);
      break;
    }
    case 'crusher': {
      const y = pad(3.3, 3.3);
      f.box(-3.2, y - 0.4, -3.2, 3.2, y + 1.2, 3.2, 'concrete', 0x8f8d88);
      f.box(-2.2, y + 1.2, -2.2, 2.2, y + 5.6, 2.2, 'metal', 0x8a5a3a);
      f.box(-3, y + 5.6, -3, 3, y + 6.8, 3, 'metal', 0x7a4a2e, false);
      // a chute down one side onto a heap of gravel
      f.box(2.2, y + 2.6, -0.6, 3.4, y + 3, 0.6, 'metal', 0x6a6e72, false);
      for (const s of [-2.6, 2.6]) for (const u of [-2.6, 2.6]) f.box(s - 0.12, y + 1.2, u - 0.12, s + 0.12, y + 5.6, u + 0.12, 'metal', 0x5a5e62, false);
      c.extraRocks.push({ x: f.xz(4.6, 0)[0], y: y - 0.6, z: f.xz(4.6, 0)[1], s: 1.6, rot: r() * 6, v: 0, flat: 0.5 });
      block(3.2, 3.2, y, y + 6.8);
      break;
    }
    case 'wreck': {
      // an old hull run aground along local z, bow toward -z, broken open on one side, part of its deck still on
      const y = heightAt(t, x, z) - 0.4;
      const hull = 0x5d4c3c;
      const H = 3.2;
      f.box(-3, y, -8, -2.6, y + H, -1.5, 'wood', hull);
      f.box(-3, y, 3, -2.6, y + H * 0.8, 8, 'wood', hull);
      f.box(-3, y, -1.5, -2.6, y + 1.1, 3, 'wood', hull);
      f.box(2.6, y, -8, 3, y + H, 8, 'wood', hull);
      f.box(-2.3, y, -9.2, -1.9, y + H + 0.3, -8, 'wood', hull);
      f.box(1.9, y, -9.2, 2.3, y + H + 0.3, -8, 'wood', hull);
      f.box(-1.9, y, -9.8, 1.9, y + H + 0.4, -9.2, 'wood', hull);
      f.box(-3, y, 8, 3, y + H, 8.4, 'wood', hull);
      f.box(-3, y + 2.7, 3.5, 3, y + 3, 8, 'floor', 0x6b5a48);
      f.box(-2, y + 3, 5, 2, y + 5.2, 8, 'wood', 0x7a6a58, false);
      for (let s = -6; s < 3; s += 2.2) f.box(-2.9, y + H - 0.2, s, 2.9, y + H, s + 0.25, 'wood', hull, false);
      f.box(-0.12, y + 3, -3.12, 0.12, y + 10, -2.88, 'wood', 0x4a3c30, false);
      f.box(-2.4, y + 8, -3.08, 2.4, y + 8.15, -2.92, 'wood', 0x4a3c30, false);
      block(3, 9.8, y, y + H);
      break;
    }
    case 'hut': {
      const y = floorAt(t, x, z);
      const col = pick(r, [0x9b3b2b, 0x2f5d8a, 0x3d7a4a, 0xc07a2a]);
      f.box(-1.2, y - 0.2, -1.2, 1.2, y + 2.1, 1.2, 'wood', col);
      f.box(-0.45, y, -1.24, 0.45, y + 1.8, -1.2, 'trim', 0x3a2a1e, false);
      f.gable(-1.45, -1.45, 1.45, 1.45, y + 2.1, 0.9, true, 0xe6edf3, col);
      block(1.2, 1.2, y, y + 2.9);
      break;
    }
    case 'pipes': {
      const L = it.s / 2;
      let lo = Infinity;
      for (let s = -L; s <= L; s += 1.5) lo = Math.min(lo, floorAt(t, ...f.xz(s, 0)));
      const y = lo;
      f.box(-L, y + 0.35, -0.35, L, y + 1.05, 0.35, 'metal', 0x8a8f94);
      for (let s = -L + 1; s < L; s += 3) f.box(s - 0.2, y - 0.3, -0.5, s + 0.2, y + 0.35, 0.5, 'concrete', 0x8f8d88);
      f.box(L - 0.6, y + 1.05, -0.08, L - 0.5, y + 1.6, 0.08, 'metal', 0x6a6e72, false);
      f.box(L - 0.9, y + 1.55, -0.3, L - 0.2, y + 1.65, 0.3, 'metal', 0xb04030, false);
      block(L, 0.35, y, y + 1.05);
      break;
    }
    case 'rubble': {
      for (let k = 0; k < 5; k++) {
        const [px, pz] = f.xz((r() - 0.5) * w * 0.8, (r() - 0.5) * d * 0.8);
        const s = 0.6 + r() * 1.1;
        c.extraRocks.push({ x: px, y: heightAt(t, px, pz) - s * 0.3, z: pz, s, rot: r() * 6, v: Math.floor(r() * 3), flat: 0.5 + r() * 0.3 });
      }
      for (let k = 0; k < 3; k++) {
        const lx = (r() - 0.5) * w * 0.7;
        const lz = (r() - 0.5) * d * 0.7;
        const g = heightAt(t, ...f.xz(lx, lz));
        f.box(lx - 0.6, g - 0.3, lz - 0.4, lx + 0.6, g + 0.5 + r() * 0.5, lz + 0.4, 'concrete', 0x9a978f);
      }
      c.taken.push(f.rect(-w / 2, -d / 2, w / 2, d / 2));
      break;
    }
  }
}

/** Builds a map: the breach arena, or with `royale` the whole land, with many more towns, cover and loot. */
export function buildWorld(id: MapId, royale = false): World {
  const def = MAPS[id];
  const t = generateTerrain(def);
  const arena = royale ? ROYALE_ARENA : ARENA;
  const c: Ctx = { def, t, rng: mulberry32(def.seed * 7 + 3), n: new Noise2(def.seed + 99), pieces: [], gables: [], interiors: [], taken: [], pads: [], roadSegs: [], roads: [], blocks: [], vehicles: [], models: [], colliders: [], deco: mulberry32(def.seed * 13 + 5), arena, loot: [], doors: [], extraRocks: [] };
  const r = c.rng;
  const { region, spawns, sites, towns, shape } = royale ? royaleLayout(c) : breachLayout(c);

  const boxes: Box[] = c.pieces.filter((p) => p.solid).map((p) => ({ x0: p.x0, y0: p.y0, z0: p.z0, x1: p.x1, y1: p.y1, z1: p.z1, s: p.part === 'wall' && def.style === 'cabin' ? 'wood' : SURFACE[p.part] }));
  boxes.push(...c.colliders);

  // trees and rocks, kept off roads, pads and buildings
  const trees: Tree[] = [];
  const trunks: Trunk[] = [];
  const nf = new Noise2(def.seed + 7);
  const free = (x: number, z: number, pad: number) => !overlaps(c, x - pad, z - pad, x + pad, z + pad) && roadDist(c, x, z) > 3 + pad;
  const water = t.water;
  const step = 6;
  for (let gz = -T_HALF + step; gz < T_HALF - step; gz += step)
    for (let gx = -T_HALF + step; gx < T_HALF - step; gx += step) {
      const x = gx + (r() - 0.5) * step * 0.9;
      const z = gz + (r() - 0.5) * step * 0.9;
      const f = nf.fbm(x / 170, z / 170, 3) * 0.5 + 0.5;
      const th0 = 1 - def.forest;
      const dens = smoothstep(th0 - 0.08, th0 + 0.16, f);
      const inArena = Math.abs(x) < arena + 10 && Math.abs(z) < arena + 10;
      let p = 0.03 + dens * 0.62;
      if (inArena) p *= 0.65;
      // breach: woods on the hills between the lanes, only now and then a tree on the open ground
      if (shape && inArena) p = openAt(shape, x, z) > 2.5 ? (0.12 + 0.6 * f) * PLANS[id].woods : 0.025;
      if (r() > p) continue;
      const y = heightAt(t, x, z);
      const up = y - water;
      const nrm = normalAt(t, x, z);
      if (nrm.y < 0.8) continue;
      const rules = def.trees.filter((q) => (q.minUp === undefined || up > q.minUp) && (q.nearWater === undefined || (t.hasWater && up > 0.4 && up < q.nearWater)));
      if (!rules.length) continue;
      let roll = r() * rules.reduce((s, q) => s + q.weight, 0);
      let kind = rules[0].kind;
      for (const q of rules) {
        roll -= q.weight;
        if (roll <= 0) {
          kind = q.kind;
          break;
        }
      }
      if (!free(x, z, kind === 'shrub' ? 0.8 : 2)) continue;
      const s = 0.8 + r() * 0.5;
      trees.push({ kind, x, y, z, s, rot: r() * Math.PI * 2, tint: r() });
      const col = TREE_COLLIDE[kind];
      if (col) trunks.push({ x, z, r: col[0] * s, y0: y - 0.5, y1: y + col[1] * s });
    }

  // stumps and fallen logs among the trees round the fight, on their own random stream so nothing else moves
  const lr = mulberry32(def.seed * 41 + 7);
  const reach = c.arena + 20;
  for (const tr of trees) {
    if (tr.kind === 'shrub' || tr.kind === 'palm' || tr.kind === 'cactus' || Math.abs(tr.x) > reach || Math.abs(tr.z) > reach || lr() > 0.06) continue;
    const a = lr() * Math.PI * 2;
    const d = 2.6 + lr() * 1.6;
    const x = tr.x + Math.sin(a) * d;
    const z = tr.z + Math.cos(a) * d;
    const key: ModelKey = lr() < 0.45 ? 'log' : lr() < 0.5 ? 'stump' : 'stump2';
    const pad = key === 'log' ? 2.1 : 1;
    const y = heightAt(t, x, z);
    if (y < water + 0.3 || normalAt(t, x, z).y < 0.9 || !free(x, z, pad) || trunks.some((k) => Math.abs(k.x - x) < pad && Math.abs(k.z - z) < pad)) continue;
    c.models.push({ key, x, y: y - 0.04, z, yaw: lr() * Math.PI * 2 });
  }

  const rockList: Rock[] = [];
  const rocks: RockCol[] = [];
  const rstep = 13;
  for (let gz = -T_HALF + rstep; gz < T_HALF - rstep; gz += rstep)
    for (let gx = -T_HALF + rstep; gx < T_HALF - rstep; gx += rstep) {
      const x = gx + (r() - 0.5) * rstep;
      const z = gz + (r() - 0.5) * rstep;
      const nrm = normalAt(t, x, z);
      const slope = 1 - nrm.y;
      const p = def.rocks * (0.06 + slope * 0.9);
      if (r() > p) continue;
      const y0 = heightAt(t, x, z);
      if (y0 < water - 0.5 && !t.ice) continue;
      const big = r() < 0.3;
      const s = big ? 1.4 + r() * 1.4 : 0.4 + r() * 0.8;
      if (!free(x, z, s + 0.5)) continue;
      const flat = 0.55 + r() * 0.35;
      const y = y0 - s * 0.25;
      rockList.push({ x, y, z, s, rot: r() * Math.PI * 2, v: Math.floor(r() * 3), flat });
      // the collider's top matches the drawn rock's top (the drawn rock is squashed by `flat`)
      if (s > 0.55) rocks.push({ x, y: y + s * flat - s * 0.95 * 0.92, z, r: s * 0.95 });
    }

  // breach: boulders along the foot of the banks
  if (shape) {
    const q = mulberry32(def.seed * 61 + 9);
    for (let gz = -arena; gz < arena; gz += 5)
      for (let gx = -arena; gx < arena; gx += 5) {
        const x = gx + (q() - 0.5) * 4;
        const z = gz + (q() - 0.5) * 4;
        const o = openAt(shape, x, z);
        if (o < 0.8 || o > 4 || q() > 0.12 + def.rocks * 0.18) continue;
        const s = 0.6 + q() * 1.2;
        if (!free(x, z, s * 0.6)) continue;
        c.extraRocks.push({ x, y: heightAt(t, x, z) - s * 0.25, z, s, rot: q() * Math.PI * 2, v: Math.floor(q() * 3), flat: 0.55 + q() * 0.35 });
      }
  }
  for (const rk of c.extraRocks) {
    rockList.push(rk);
    if (rk.s > 0.55) rocks.push({ x: rk.x, y: rk.y + rk.s * rk.flat - rk.s * 0.95 * 0.92, z: rk.z, r: rk.s * 0.95 });
  }
  const grid = buildGrid(boxes, trunks, rocks);

  // deathmatch spawns: dry, flat, outdoors and spread out
  const dmSpawns: Slot[] = [];
  for (let k = 0; k < (royale ? 900 : 3000) && dmSpawns.length < 28; k++) {
    const x = (r() * 2 - 1) * (arena - 14);
    const z = (r() * 2 - 1) * (arena - 14);
    if (heightAt(t, x, z) < water + (royale || t.ice ? 0.6 : 1.6) || normalAt(t, x, z).y < 0.9 || !onRegion(region, x, z)) continue;
    if (c.interiors.some((q) => x > q.x0 - 2 && x < q.x1 + 2 && z > q.z0 - 2 && z < q.z1 + 2)) continue;
    if (boxes.some((b) => x > b.x0 - 1.5 && x < b.x1 + 1.5 && z > b.z0 - 1.5 && z < b.z1 + 1.5)) continue;
    if (trunks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 1.5)) continue;
    if (rocks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 1.5)) continue;
    if (dmSpawns.some((q) => Math.hypot(q.x - x, q.z - z) < (royale ? 30 : 25))) continue;
    dmSpawns.push({ x, z, yaw: yawTo(-x, -z) });
  }

  const sun = sunDir(def);
  const world: World = {
    id,
    def,
    terrain: t,
    sun,
    pieces: c.pieces,
    gables: c.gables,
    interiors: c.interiors,
    boxes,
    trunks,
    rocks,
    trees,
    rockList,
    grid,
    sites,
    spawns,
    dmSpawns,
    towns,
    roads: c.roads,
    vehicles: c.vehicles,
    models: c.models,
    light: new Uint8Array(0),
    minimap: { size: 0, span: 0, data: new Uint8ClampedArray(0) },
    arena: arena,
    region,
    loot: new Float32Array(clearSpots(c.loot, boxes, trunks)),
    doors: new Float32Array(c.doors),
  };
  world.light = bakeLight(world, c.blocks);
  world.minimap = paintMinimap(world);
  return world;
}

// ---------------------------------------------------------------------------------------------------------------
// baking

function bakeLight(w: World, blocks: Rect3[]) {
  const t = w.terrain;
  const out = new Uint8Array(T_RES * T_RES * 4);
  const [sx, sy, sz] = w.sun;
  const hl = Math.hypot(sx, sz) || 1;
  const dx = sx / hl;
  const dz = sz / hl;
  const tanEl = sy / hl;
  const el = Math.atan(tanEl);
  const pen = 0.055;
  // sun: the highest horizon toward the sun against the sun's height, softened into a penumbra
  for (let j = 0; j < T_RES; j++)
    for (let i = 0; i < T_RES; i++) {
      const x = -T_HALF + i * CELL;
      const z = -T_HALF + j * CELL;
      const h0 = t.h[j * T_RES + i] + 0.3;
      let maxT = -1;
      // small bumps right next to a point would speckle low sun light: only ground 5 m and more away casts
      for (let d = 5; d < 420; d *= 1.14) {
        const hh = heightAt(t, x + dx * d, z + dz * d);
        const tt = (hh - h0) / d;
        if (tt > maxT) maxT = tt;
        if (h0 + d * (maxT > tanEl ? maxT : tanEl) > t.maxH + 2) break;
      }
      const vis = smoothstep(-pen, pen, el - Math.atan(maxT));
      out[(j * T_RES + i) * 4] = Math.round(vis * 255);
    }
  // soften the sun map a little (a 3x3 blur) so its 2 m texels never show as blobs
  {
    const src = new Uint8Array(T_RES * T_RES);
    for (let k = 0; k < src.length; k++) src[k] = out[k * 4];
    for (let j = 1; j < T_RES - 1; j++)
      for (let i = 1; i < T_RES - 1; i++) {
        let sum = 0;
        for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) sum += src[(j + b) * T_RES + i + a] * (a === 0 && b === 0 ? 4 : a === 0 || b === 0 ? 2 : 1);
        out[(j * T_RES + i) * 4] = Math.round(sum / 16);
      }
  }
  // ambient occlusion at half resolution, eight directions
  const HR = (T_RES - 1) / 2 + 1;
  const ao = new Float32Array(HR * HR);
  const dirs = Array.from({ length: 8 }, (_, k) => [Math.cos((k / 8) * Math.PI * 2), Math.sin((k / 8) * Math.PI * 2)]);
  for (let j = 0; j < HR; j++)
    for (let i = 0; i < HR; i++) {
      const x = -T_HALF + i * CELL * 2;
      const z = -T_HALF + j * CELL * 2;
      const h0 = heightAt(t, x, z) + 0.2;
      let occ = 0;
      for (const [ax, az] of dirs) {
        let m = 0;
        for (let d = 2; d <= 64; d *= 2) {
          const s = (heightAt(t, x + ax * d, z + az * d) - h0) / d;
          if (s > m) m = s;
        }
        occ += m / Math.sqrt(1 + m * m);
      }
      ao[j * HR + i] = 1 - (occ / 8) * 0.9;
    }
  for (let j = 0; j < T_RES; j++)
    for (let i = 0; i < T_RES; i++) {
      const fi = i / 2;
      const fj = j / 2;
      const i0 = Math.min(HR - 2, Math.floor(fi));
      const j0 = Math.min(HR - 2, Math.floor(fj));
      const a = fi - i0;
      const b = fj - j0;
      const v = lerp(lerp(ao[j0 * HR + i0], ao[j0 * HR + i0 + 1], a), lerp(ao[(j0 + 1) * HR + i0], ao[(j0 + 1) * HR + i0 + 1], a), b);
      const k = (j * T_RES + i) * 4;
      out[k + 1] = Math.round(clamp(v, 0, 1) * 255);
      out[k + 2] = 255;
      out[k + 3] = 0;
    }

  const toI = (x: number) => (x + T_HALF) / CELL;
  /** Multiplies a channel inside a box of texels by f(x, z) (1 leaves it). */
  const stamp = (ch: number, x0: number, z0: number, x1: number, z1: number, f: (x: number, z: number) => number) => {
    const i0 = Math.max(0, Math.floor(toI(x0)));
    const i1 = Math.min(T_RES - 1, Math.ceil(toI(x1)));
    const j0 = Math.max(0, Math.floor(toI(z0)));
    const j1 = Math.min(T_RES - 1, Math.ceil(toI(z1)));
    for (let j = j0; j <= j1; j++)
      for (let i = i0; i <= i1; i++) {
        const v = f(-T_HALF + i * CELL, -T_HALF + j * CELL);
        if (v >= 1) continue;
        const k = (j * T_RES + i) * 4 + ch;
        out[k] = Math.round(out[k] * clamp(v, 0, 1));
      }
  };
  const lenK = Math.min(4, 1 / Math.max(0.2, Math.sin(el)));
  // trees: a soft ellipse thrown away from the sun, and a darker patch at the foot
  for (const tr of w.trees) {
    const [cr0, ch0] = CROWN[tr.kind];
    const cr = cr0 * tr.s;
    const off = (ch0 * tr.s) / Math.max(0.15, tanEl);
    const cx = tr.x - dx * Math.min(off, 60);
    const cz = tr.z - dz * Math.min(off, 60);
    const ra = cr * lenK;
    const ext = Math.max(ra, cr) + 1;
    const dark = tr.kind === 'shrub' || tr.kind === 'cactus' || tr.kind === 'deadtree' ? 0.35 : 0.62;
    stamp(2, cx - ext, cz - ext, cx + ext, cz + ext, (x, z) => {
      const px = x - cx;
      const pz = z - cz;
      const along = (px * dx + pz * dz) / ra;
      const perp = (px * -dz + pz * dx) / cr;
      return 1 - dark * (1 - smoothstep(0.55, 1.05, Math.hypot(along, perp)));
    });
    const ar = cr * 1.1;
    stamp(1, tr.x - ar, tr.z - ar, tr.x + ar, tr.z + ar, (x, z) => 1 - 0.28 * (1 - smoothstep(0, ar, Math.hypot(x - tr.x, z - tr.z))));
  }
  // buildings and big props: the footprint swept away from the sun
  for (const b of blocks) {
    const hgt = b.y1 - b.y0;
    const off = Math.min(80, hgt / Math.max(0.15, tanEl));
    const ex0 = Math.min(b.x0, b.x0 - dx * off) - 1;
    const ex1 = Math.max(b.x1, b.x1 - dx * off) + 1;
    const ez0 = Math.min(b.z0, b.z0 - dz * off) - 1;
    const ez1 = Math.max(b.z1, b.z1 - dz * off) + 1;
    stamp(2, ex0, ez0, ex1, ez1, (x, z) => {
      // distance from the point back toward the sun to the footprint, along the sweep
      let best = 99;
      for (let s = 0; s <= 1; s += 0.125) {
        const px = x + dx * off * s;
        const pz = z + dz * off * s;
        const ox = Math.max(b.x0 - px, 0, px - b.x1);
        const oz = Math.max(b.z0 - pz, 0, pz - b.z1);
        best = Math.min(best, Math.hypot(ox, oz));
      }
      return 1 - 0.72 * (1 - smoothstep(0, 1.6, best));
    });
    stamp(1, b.x0 - 2, b.z0 - 2, b.x1 + 2, b.z1 + 2, (x, z) => {
      const ox = Math.max(b.x0 - x, 0, x - b.x1);
      const oz = Math.max(b.z0 - z, 0, z - b.z1);
      const d = Math.hypot(ox, oz);
      return d <= 0 ? 0.55 : 1 - 0.35 * (1 - smoothstep(0, 2, d));
    });
  }
  for (const rk of w.rockList) {
    const rr = rk.s;
    const off = (rr * 0.5) / Math.max(0.15, tanEl);
    const cx = rk.x - dx * off;
    const cz = rk.z - dz * off;
    const ext = rr * lenK + 1;
    stamp(2, cx - ext, cz - ext, cx + ext, cz + ext, (x, z) => {
      const px = x - cx;
      const pz = z - cz;
      const along = (px * dx + pz * dz) / (rr * lenK * 0.8);
      const perp = (px * -dz + pz * dx) / rr;
      return 1 - 0.6 * (1 - smoothstep(0.5, 1, Math.hypot(along, perp)));
    });
  }
  // bare ground: roads and pads
  const setBare = (x: number, z: number, v: number) => {
    const i = Math.round(toI(x));
    const j = Math.round(toI(z));
    if (i < 0 || j < 0 || i >= T_RES || j >= T_RES) return;
    const k = (j * T_RES + i) * 4 + 3;
    out[k] = Math.max(out[k], Math.round(v * 255));
  };
  for (const pts of w.roads)
    for (let p = 0; p + 3 < pts.length; p += 2) {
      const ax = pts[p];
      const az = pts[p + 1];
      const bx = pts[p + 2];
      const bz = pts[p + 3];
      const len = Math.hypot(bx - ax, bz - az);
      for (let s = 0; s <= len; s += CELL * 0.5) {
        const k = s / len;
        const x = lerp(ax, bx, k);
        const z = lerp(az, bz, k);
        for (let a = -3; a <= 3; a++)
          for (let b = -3; b <= 3; b++) {
            const px = x + a * CELL * 0.5;
            const pz = z + b * CELL * 0.5;
            setBare(px, pz, 1 - smoothstep(1.4, 3.2, Math.hypot(px - x, pz - z)));
          }
      }
    }
  for (const s of w.sites)
    for (let a = -12; a <= 12; a += CELL) for (let b = -12; b <= 12; b += CELL) setBare(s.x + a, s.z + b, 1 - smoothstep(7, 12, Math.hypot(a, b)));
  for (const s of w.spawns)
    for (let a = -14; a <= 14; a += CELL) for (let b = -14; b <= 14; b += CELL) setBare(s.x + a, s.z + b, 0.55 * (1 - smoothstep(8, 13, Math.hypot(a, b))));
  for (const q of w.interiors)
    for (let x = q.x0 - 1; x <= q.x1 + 1; x += CELL * 0.5) for (let z = q.z0 - 1; z <= q.z1 + 1; z += CELL * 0.5) setBare(x, z, 1);
  return out;
}

const rgb = (hex: number): [number, number, number] => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
const mix3 = (a: [number, number, number], b: [number, number, number], k: number): [number, number, number] => [lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)];

/** A top-down picture of the arena: ground colors with hill shading, water, roads, trees and roofs. */
function paintMinimap(w: World): Minimap {
  const ARENA = w.arena;
  const breach = w.arena < ROYALE_ARENA;
  const size = 256;
  const span = ARENA + 24;
  const data = new Uint8ClampedArray(size * size * 4);
  const t = w.terrain;
  const g = w.def.ground;
  const nz = new Noise2(w.def.seed + 5);
  const [sx, sy, sz] = w.sun;
  const L = [sx * 0.6 - 0.3, Math.max(sy, 0.35), sz * 0.6 - 0.3];
  const ll = Math.hypot(L[0], L[1], L[2]);
  const nrm = { x: 0, y: 1, z: 0 };
  for (let py = 0; py < size; py++)
    for (let px = 0; px < size; px++) {
      const x = ((px + 0.5) / size) * 2 * span - span;
      const z = ((py + 0.5) / size) * 2 * span - span;
      const h = heightAt(t, x, z);
      normalAt(t, x, z, nrm);
      const slope = 1 - nrm.y;
      let col = mix3(rgb(g.grassA), rgb(g.grassB), clamp(nz.fbm(x / 120, z / 120, 3) + 0.5, 0, 1));
      if (g.sandAmt > 0) col = mix3(col, rgb(g.sand), g.sandAmt * smoothstep(0.1, 0.0, slope) * 0.7);
      if (t.hasWater && h < t.water + g.sandLine) col = mix3(col, rgb(g.sand), 0.85);
      col = mix3(col, rgb(g.rock), smoothstep(g.rockSlope - 0.08, g.rockSlope + 0.08, slope));
      if (g.snowCover > 0) col = mix3(col, rgb(g.snow), g.snowCover * smoothstep(0.45, 0.2, slope));
      const k = (Math.round((z + T_HALF) / CELL) * T_RES + Math.round((x + T_HALF) / CELL)) * 4;
      const bare = w.light[k + 3] / 255;
      col = mix3(col, rgb(g.dirt), bare * 0.7);
      let shade = 0.45 + 0.75 * clamp((nrm.x * L[0] + nrm.y * L[1] + nrm.z * L[2]) / ll, 0, 1);
      shade *= 0.75 + 0.25 * (w.light[k] / 255);
      // breach: the hills and banks off the walkable ground a shade darker, so the lanes read at a glance
      if (breach && !w.region[k / 4]) shade *= 0.68;
      col = [col[0] * shade, col[1] * shade, col[2] * shade];
      if (t.hasWater && h < t.water) {
        const depth = t.water - h;
        col = t.ice ? mix3(rgb(0xd8e6f0), rgb(0xa8c4dc), clamp(depth / 4, 0, 1)) : mix3(rgb(w.def.waterColor.shallow), rgb(w.def.waterColor.deep), clamp(depth / 5, 0, 1));
      }
      const o = (py * size + px) * 4;
      data[o] = col[0];
      data[o + 1] = col[1];
      data[o + 2] = col[2];
      data[o + 3] = 255;
    }
  const toP = (x: number) => ((x + span) / (2 * span)) * size;
  const fill = (x0: number, z0: number, x1: number, z1: number, col: [number, number, number], a = 1) => {
    for (let py = Math.max(0, Math.floor(toP(z0))); py < Math.min(size, Math.ceil(toP(z1))); py++)
      for (let px = Math.max(0, Math.floor(toP(x0))); px < Math.min(size, Math.ceil(toP(x1))); px++) {
        const o = (py * size + px) * 4;
        data[o] = lerp(data[o], col[0], a);
        data[o + 1] = lerp(data[o + 1], col[1], a);
        data[o + 2] = lerp(data[o + 2], col[2], a);
      }
  };
  for (const tr of w.trees) {
    if (Math.abs(tr.x) > span || Math.abs(tr.z) > span || tr.kind === 'shrub') continue;
    const rr = CROWN[tr.kind][0] * tr.s * 0.7;
    fill(tr.x - rr, tr.z - rr, tr.x + rr, tr.z + rr, [24, 40, 22], 0.45);
  }
  for (const p of w.pieces) if (p.solid && p.y1 - p.y0 > 0.5) fill(p.x0, p.z0, p.x1, p.z1, [70, 70, 74], 0.85);
  for (const q of w.interiors) fill(q.x0, q.z0, q.x1, q.z1, [128, 126, 122], 0.9);
  return { size, span, data };
}

const cache = new Map<string, World>();
/** The world for a map, built once per page. Rounds change nothing in it. */
const keyOf = (id: MapId, royale: boolean) => (royale ? `${id}:royale` : id);
export function worldFor(id: MapId, royale = false): World {
  let w = cache.get(keyOf(id, royale));
  if (!w) {
    w = buildWorld(id, royale);
    cache.set(keyOf(id, royale), w);
  }
  return w;
}
export function cacheWorld(w: World) {
  cache.set(keyOf(w.id, w.arena > ARENA), w);
}
export function cachedWorld(id: MapId, royale = false) {
  return cache.get(keyOf(id, royale)) ?? null;
}
