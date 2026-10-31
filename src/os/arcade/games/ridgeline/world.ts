// Everything on a map besides the ground: the two spawns, the three uplinks, towns of walk-in buildings, cover,
// trees, rocks and dirt roads. Also bakes the light the renderer reads (terrain shadows, ambient occlusion and the
// shadows of far trees and buildings) and paints the minimap. Pure data, so it runs in a worker and under node.
import { MAPS, type MapDef, type MapId, type Style, type TreeKind } from './maps.ts';
import { Noise2, clamp, lerp, mulberry32, smoothstep, type Rng } from './noise.ts';
import { CELL, T_HALF, T_RES, T_SIZE, flattenRect, generateTerrain, heightAt, meanHeight, normalAt, type Terrain } from './terrain.ts';

/** Half the side of the square everyone plays in (uplink and deathmatch). */
export const ARENA = 160;
const ARENA_CLASSIC = ARENA;
/** The same for a royale: nearly all of the shaped land. */
export const ROYALE_ARENA = 330;
/** Uplink capture radius. */
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
export type ModelKey = 'barricade' | 'pile' | 'wire' | 'dumpsters' | 'fence-base' | 'fence-half' | 'fence-wood' | 'fence-wheel' | 'jerry' | 'gas' | 'propane' | 'helmet' | 'shield' | 'cup' | 'pan';
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
function wallX(f: Frame, xa: number, xb: number, z0: number, z1: number, y0: number, y1: number, holes: Opening[], part: Part, color: number) {
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
function wallZ(f: Frame, za: number, zb: number, x0: number, x1: number, y0: number, y1: number, holes: Opening[], part: Part, color: number) {
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
  const door = (cpos: number, wide = 1.3, tall = 2.3): Opening => ({ c: cpos, w: wide, b: base, t: y + tall });
  const win = (cpos: number, wide = 1.3): Opening => ({ c: cpos, w: wide, b: y + 1, t: y + 2.15 });
  const ruin = kind === 'ruin';
  const wallTop = (seg: number) => (ruin ? y + 0.6 + r() * (H - 0.6) * (seg % 3 === 0 ? 0.4 : 1) : top);

  if (kind === 'barn') {
    const bd: Opening = { c: 0, w: 3.8, b: base, t: y + 4 };
    wallX(f, -hw, hw, -hd, -hd + T, base, top, [bd], wallPart, wc);
    wallX(f, -hw, hw, hd - T, hd, base, top, [{ ...bd }], wallPart, wc);
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
      wallX(f, -hw, hw, -hd, -hd + T, base, top, frontHoles, wallPart, wc);
      wallX(f, -hw, hw, hd - T, hd, base, top, backHoles, wallPart, wc);
      wallZ(f, -hd + T, hd - T, -hw, -hw + T, base, top, sideA, wallPart, wc);
      wallZ(f, -hd + T, hd - T, hw - T, hw, base, top, sideB, wallPart, wc);
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

function crates(c: Ctx, f: Frame, lx: number, lz: number, y: number) {
  const r = c.rng;
  const s = 1.1;
  const col = 0x9a7a4e;
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

type PropKind = 'container' | 'crates' | 'sandbags' | 'barrier' | 'truck' | 'hesco' | 'pile' | 'wire' | 'dumpsters' | 'fence';

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
const CLUTTER: ModelKey[] = ['jerry', 'gas', 'propane', 'helmet', 'shield', 'jerry', 'propane', 'cup', 'pan'];
const FENCES: ModelKey[] = ['fence-base', 'fence-half', 'fence-wood', 'fence-wheel'];

/** A piece of clutter on the ground at local (lx, lz) of a frame, facing a random way. */
function clutter(c: Ctx, f: Frame, lx: number, lz: number, key?: ModelKey, y?: number) {
  const [x, z] = f.xz(lx, lz);
  c.models.push({ key: key ?? CLUTTER[Math.floor(c.deco() * CLUTTER.length)], x, y: y ?? heightAt(c.t, x, z), z, yaw: c.deco() * Math.PI * 2 });
}

function tryProp(c: Ctx, kind: PropKind, x: number, z: number, bound: number) {
  const r = c.rng;
  const rot = Math.floor(r() * 4);
  const units = kind === 'hesco' ? 3 + Math.floor(r() * 3) : 1;
  const [w, d] = kind === 'hesco' ? [units * 1.06, 1.06] : PROP_SIZE[kind];
  const hx = (rot & 1 ? d : w) / 2;
  const hz = (rot & 1 ? w : d) / 2;
  if (Math.abs(x) + hx > bound || Math.abs(z) + hz > bound) return false;
  if (overlaps(c, x - hx - 1.5, z - hz - 1.5, x + hx + 1.5, z + hz + 1.5)) return false;
  if (roadDist(c, x, z) < 2.5 + Math.max(hx, hz)) return false;
  let lo = Infinity;
  let hi = -Infinity;
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ]) {
    const h = heightAt(c.t, x + a * hx, z + b * hz);
    lo = Math.min(lo, h);
    hi = Math.max(hi, h);
  }
  if (hi - lo > (kind === 'container' ? 2.2 : kind === 'truck' ? 1.4 : MODEL_COVER[kind] ? 0.7 : 1.2) || lo < c.t.water + 0.3) return false;
  const f = new Frame(c, x, z, rot);
  let y = lo - 0.15;
  if (kind === 'container') {
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
    }
    c.blocks.push({ x0: x - hx, y0: y, z0: z - hz, x1: x + hx, y1: hi + 1.35, z1: z + hz });
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
    const key: ModelKey = kind === 'fence' ? FENCES[Math.floor(c.deco() * FENCES.length)] : kind === 'barrier' ? 'barricade' : (kind as 'pile' | 'wire' | 'dumpsters');
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
 * without climbing a cliff or swimming deep water, 0 elsewhere. Spawns, uplinks and respawns only go on it.
 */
export function walkRegion(t: Terrain, arena = ARENA): Uint8Array {
  const lab = new Int32Array(T_RES * T_RES).fill(-1);
  const lo = Math.floor((T_HALF - arena) / CELL);
  const hi = Math.ceil((T_HALF + arena) / CELL);
  const ok = (k: number) => t.ice || t.h[k] > t.water - 1.1;
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
          if (lab[nk] >= 0 || !ok(nk) || Math.abs(t.h[nk] - t.h[k]) > 1.5) continue;
          lab[nk] = id;
          queue[tail++] = nk;
        }
      }
      sizes.push(tail);
    }
  let main = 0;
  sizes.forEach((n, i) => n > sizes[main] && (main = i));
  const out = new Uint8Array(T_RES * T_RES);
  for (let k = 0; k < out.length; k++) out[k] = lab[k] === main && sizes.length > 0 ? 1 : 0;
  return out;
}

const onRegion = (region: Uint8Array, x: number, z: number) => region[Math.round((z + T_HALF) / CELL) * T_RES + Math.round((x + T_HALF) / CELL)] === 1;

/** Best spot near (x, z) for a pad: dry, flat, reachable and inside the arena. `along` limits the search to one axis. */
function findSpot(t: Terrain, region: Uint8Array, x: number, z: number, radius: number, along?: [number, number], arena = ARENA) {
  let best = { x, z, score: Infinity };
  for (let a = -radius; a <= radius; a += 4)
    for (let b = -radius; b <= radius; b += 4) {
      if (along && Math.abs(a * along[0] + b * along[1]) > 6) continue;
      const px = x + a;
      const pz = z + b;
      if (Math.abs(px) > arena - 20 || Math.abs(pz) > arena - 20) continue;
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

/** Builds a map: the uplink arena, or with `royale` the whole land, with many more towns, cover and loot. */
export function buildWorld(id: MapId, royale = false): World {
  const def = MAPS[id];
  const t = generateTerrain(def);
  const ARENA = royale ? ROYALE_ARENA : ARENA_CLASSIC;
  const c: Ctx = { def, t, rng: mulberry32(def.seed * 7 + 3), n: new Noise2(def.seed + 99), pieces: [], gables: [], interiors: [], taken: [], pads: [], roadSegs: [], roads: [], blocks: [], vehicles: [], models: [], colliders: [], deco: mulberry32(def.seed * 13 + 5), arena: ARENA, loot: [], doors: [] };
  const r = c.rng;

  // the axis between the spawns
  const th = r() * Math.PI * 2;
  const ux = Math.cos(th);
  const uz = Math.sin(th);
  const vx = -uz;
  const vz = ux;
  const region = walkRegion(t, ARENA);
  const spawnAt = [-1, 1].map((sgn) => findSpot(t, region, sgn * 120 * ux, sgn * 120 * uz, 24));
  const siteAt = [-1, 0, 1].map((k) => findSpot(t, region, k * 82 * vx, k * 82 * vz, 24, [ux, uz]));

  const spawns = spawnAt.map((p, team) => {
    const y = meanHeight(t, p.x, p.z, 12, 12);
    flattenRect(t, p.x, p.z, 12, 12, y, 9);
    c.pads.push({ x: p.x, z: p.z, hx: 12, hz: 12, y });
    c.taken.push({ x0: p.x - 15, z0: p.z - 15, x1: p.x + 15, z1: p.z + 15 });
    const fx = team === 0 ? ux : -ux;
    const fz = team === 0 ? uz : -uz;
    const yaw = yawTo(fx, fz);
    const slots: Slot[] = [-6, -3, 0, 3, 6].map((o, k) => ({ x: p.x + vx * o - fx * (k % 2) * 2.5, z: p.z + vz * o - fz * (k % 2) * 2.5, yaw }));
    return { x: p.x, y, z: p.z, yaw, slots };
  }) as [Spawn, Spawn];

  const sites: Site[] = siteAt.map((p, k) => {
    const y = meanHeight(t, p.x, p.z, 8, 8);
    flattenRect(t, p.x, p.z, 9, 9, y, 8);
    c.pads.push({ x: p.x, z: p.z, hx: 9, hz: 9, y });
    c.taken.push({ x0: p.x - 13, z0: p.z - 13, x1: p.x + 13, z1: p.z + 13 });
    return { id: k, name: 'ABC'[k], town: def.pois[k], x: p.x, y, z: p.z };
  });

  // roads: each spawn to each uplink, and the uplinks to each other
  for (const s of spawns) for (const site of sites) roadLine(c, s.x, s.z, site.x, site.z);
  roadLine(c, sites[0].x, sites[0].z, sites[1].x, sites[1].z);
  roadLine(c, sites[1].x, sites[1].z, sites[2].x, sites[2].z);

  // the uplink masts: a waist high concrete block to hide behind and an antenna
  for (const s of sites) {
    const f = new Frame(c, s.x, s.z, 0);
    f.box(-0.9, s.y - 0.3, -0.9, 0.9, s.y + 1.15, 0.9, 'concrete', 0x8f8d88);
    f.box(-0.12, s.y + 1.15, -0.12, 0.12, s.y + 6.5, 0.12, 'metal', 0x6a6e72);
    f.box(-0.7, s.y + 5.2, -0.06, 0.7, s.y + 5.32, 0.06, 'metal', 0x6a6e72, false);
    f.box(-0.06, s.y + 4.4, -0.6, 0.06, s.y + 4.52, 0.6, 'metal', 0x6a6e72, false);
  }

  // towns: one around each uplink, two more out on the flanks, and a few beyond the arena for the view
  const towns: Town[] = sites.map((s) => ({ name: s.town, x: s.x, z: s.z, site: s.id }));
  for (const sgn of [-1, 1]) {
    const p = findSpot(t, region, sgn * 135 * vx, sgn * 135 * vz, 18, [ux, uz]);
    towns.push({ name: def.pois[sgn < 0 ? 3 : 4], x: p.x, z: p.z, site: -1 });
  }
  if (royale) {
    // a royale spreads towns over the whole land, each joined by a road to the nearest one already there
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
  }
  const kinds: Kind[] = ['house', 'house', 'house', 'shed', 'ruin', 'barn'];
  for (const town of towns) {
    const want = town.site >= 0 ? 6 : town.site === -2 ? 7 : 4;
    let placed = 0;
    for (let tries = 0; tries < 120 && placed < want; tries++) {
      const a = r() * Math.PI * 2;
      const d = (town.site >= 0 ? 17 : 6) + r() * 32;
      if (tryBuilding(c, kinds[Math.floor(r() * kinds.length)], town.x + Math.cos(a) * d, town.z + Math.sin(a) * d, ARENA - 4)) placed++;
    }
  }
  for (let k = 0; k < 3; k++) {
    const a = r() * Math.PI * 2;
    const d = ARENA_CLASSIC + 50 + r() * 120;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (heightAt(t, x, z) < t.water + 2) continue;
    towns.push({ name: def.pois[5 + k] ?? 'Outpost', x, z, site: -1 });
    let placed = 0;
    for (let tries = 0; tries < 60 && placed < 5; tries++) {
      const b = r() * Math.PI * 2;
      const e = 6 + r() * 30;
      if (tryBuilding(c, kinds[Math.floor(r() * kinds.length)], x + Math.cos(b) * e, z + Math.sin(b) * e, T_HALF - 40)) placed++;
    }
  }
  // lone buildings out in the open
  for (let k = 0, placed = 0; k < (royale ? 400 : 80) && placed < (royale ? 30 : 7); k++)
    if (tryBuilding(c, r() < 0.5 ? 'ruin' : 'shed', (r() * 2 - 1) * (ARENA - 15), (r() * 2 - 1) * (ARENA - 15), ARENA - 4)) placed++;

  // cover: around the uplinks, at the spawns and across the lanes
  const propKinds: PropKind[] = ['container', 'crates', 'sandbags', 'hesco', 'barrier', 'pile', 'hesco', 'wire', 'dumpsters', 'fence', 'barrier', 'pile'];
  // an armored truck by each spawn and one at the middle uplink, then HESCO walls round every uplink
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
  if (royale)
    for (let k = 0, placed = 0; k < 400 && placed < 6; k++) {
      const a = r() * Math.PI * 2;
      const d = 60 + r() * 250;
      if (tryProp(c, 'truck', Math.cos(a) * d, Math.sin(a) * d, ARENA - 4)) placed++;
    }
  for (let k = 0, placed = 0; k < (royale ? 1600 : 400) && placed < (royale ? 120 : 34); k++)
    if (tryProp(c, propKinds[Math.floor(r() * propKinds.length)], (r() * 2 - 1) * (ARENA - 8), (r() * 2 - 1) * (ARENA - 8), ARENA - 3)) placed++;

  // later pads blend into earlier ones at their edges: put every pad back exactly
  for (const p of c.pads) flattenRect(t, p.x, p.z, p.hx, p.hz, p.y, 0.01);
  for (const s of spawns) s.y = heightAt(t, s.x, s.z);
  for (const s of sites) s.y = heightAt(t, s.x, s.z);

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
      const inArena = Math.abs(x) < ARENA + 10 && Math.abs(z) < ARENA + 10;
      let p = 0.03 + dens * 0.62;
      if (inArena) p *= 0.65;
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

  const grid = buildGrid(boxes, trunks, rocks);

  // deathmatch spawns: dry, flat, outdoors and spread out
  const dmSpawns: Slot[] = [];
  for (let k = 0; k < 900 && dmSpawns.length < 28; k++) {
    const x = (r() * 2 - 1) * (ARENA - 14);
    const z = (r() * 2 - 1) * (ARENA - 14);
    if (heightAt(t, x, z) < water + 0.6 || normalAt(t, x, z).y < 0.9 || !onRegion(region, x, z)) continue;
    if (c.interiors.some((q) => x > q.x0 - 2 && x < q.x1 + 2 && z > q.z0 - 2 && z < q.z1 + 2)) continue;
    if (boxes.some((b) => x > b.x0 - 1.5 && x < b.x1 + 1.5 && z > b.z0 - 1.5 && z < b.z1 + 1.5)) continue;
    if (trunks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 1.5)) continue;
    if (rocks.some((q) => Math.hypot(q.x - x, q.z - z) < q.r + 1.5)) continue;
    if (dmSpawns.some((q) => Math.hypot(q.x - x, q.z - z) < 30)) continue;
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
    arena: ARENA,
    region,
    loot: new Float32Array(c.loot),
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
