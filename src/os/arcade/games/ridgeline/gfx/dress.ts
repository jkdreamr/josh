// The finer detail of the buildings and the military dressing, all of it our own design built from primitives and
// dressed in the photographed finishes (Poly Haven, CC0). Buildings get casements and glass (whole, broken or gone),
// shutters, doors standing open, steps, canopies, fascias, barge boards, ridge caps, gutters and downpipes, chimneys,
// spouts through adobe parapets, ceiling joists and a few pieces of furniture in each room. The dressing: shipping
// containers with corrugated walls and doors, wrecked cars, watchtowers, tents, pallet stacks, the poles of camo nets and
// the pickets of razor wire. All of that is baked into the merged meshes of the buildings (one draw call a finish, see
// props.ts), so it costs triangles and no draw calls. What is small and many is drawn instanced and only near you: every
// sandbag of every sandbag wall and emplacement, and the coils of razor wire. The camo nets are one mesh of their own.
// The furniture and the street props against the outside walls are real models (Poly Haven) where those loaded: they
// are only put down here, and drawn by furnish.ts; the furniture's boxes stand in for them otherwise.
import { mulberry32 } from '../noise.ts';
import { floorAt, heightAt } from '../terrain.ts';
import { BAGARC, LOOKOUT, STREET, TOWER, type Bld, type Dress, type Ladder, type Opening, type Part, type World } from '../world.ts';
import { DOUBLE, canvas, lin, patch, roundBox, type Shared, type T, type Three } from './common.ts';
import type { PropKey, Props } from './furnish.ts';

/** Where detail goes: a box (middle, half sizes, turned by yaw about y, then pitch about its x, then roll about its z)
 * or a geometry built in its own space and placed by a matrix, each in a finish and a color. */
export type Add = {
  /** Whether what comes casts a shadow (the furniture and the joists inside a house need not). */
  shade: boolean;
  box(part: Part, color: number, x: number, y: number, z: number, hx: number, hy: number, hz: number, yaw?: number, pitch?: number, roll?: number): void;
  geo(part: Part, color: number, g: T.BufferGeometry, m: T.Matrix4): void;
  /** The real furniture and street props, where their file loaded (see furnish.ts). */
  props?: Props;
};

/** A stable hash of a few numbers, 0 to 1. */
function hash(a: number, b: number, c = 0) {
  const s = Math.sin(a * 12.9898 + b * 78.233 + c * 37.719) * 43758.5453;
  return s - Math.floor(s);
}

/** Boxes in a local frame: middle (x, z), turned by yaw, local x across and z along, as for the world's Frames. */
class Local {
  add: Add;
  x: number;
  z: number;
  yaw: number;
  private c: number;
  private s: number;
  constructor(add: Add, x: number, z: number, yaw: number) {
    this.add = add;
    this.x = x;
    this.z = z;
    this.yaw = yaw;
    this.c = Math.cos(yaw);
    this.s = Math.sin(yaw);
  }
  xz(lx: number, lz: number): [number, number] {
    return [this.x + lx * this.c + lz * this.s, this.z - lx * this.s + lz * this.c];
  }
  /** A box by its corners in the frame. */
  box(part: Part, color: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    this.at(part, color, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0) / 2, Math.abs(y1 - y0) / 2, Math.abs(z1 - z0) / 2);
  }
  /** A box by its middle and half sizes, turned further inside the frame. */
  at(part: Part, color: number, lx: number, ly: number, lz: number, hx: number, hy: number, hz: number, yaw = 0, pitch = 0, roll = 0) {
    if (hx < 0.002 || hy < 0.002 || hz < 0.002) return;
    const [x, z] = this.xz(lx, lz);
    this.add.box(part, color, x, ly, z, hx, hy, hz, this.yaw + yaw, pitch, roll);
  }
  /** Whether a real prop loaded. */
  has(k: PropKey) {
    return !!this.add.props?.has(k);
  }
  /** A real prop standing in the frame at (lx, lz) on height y, its front turned to yaw in the frame, tipped by pitch
   * and roll. */
  prop(k: PropKey, lx: number, lz: number, y: number, yaw: number, inside = true, pitch = 0, roll = 0) {
    const [x, z] = this.xz(lx, lz);
    this.add.props?.put(k, x, y, z, this.yaw + yaw, inside, pitch, roll);
  }
  /** A beam from one point to another (in the frame), w wide and h deep. */
  beam(part: Part, color: number, a: [number, number, number], b: [number, number, number], w: number, h: number) {
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const dz = b[2] - a[2];
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    // along its own z: yaw to the run's heading, then pitch to its climb
    const yaw = Math.atan2(dx, dz);
    const pitch = -Math.atan2(dy, Math.hypot(dx, dz));
    this.at(part, color, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2, w / 2, h / 2, len / 2, yaw, pitch);
  }
}

const yawOf = (rot: number) => (-rot * Math.PI) / 2;

// ---------------------------------------------------------------------------------------------------------------
// buildings

const SHUTTERS: Record<string, number[]> = { farm: [0x3f5a44, 0x4a5868, 0x6a3a30], cabin: [0x4a3424, 0x3a4a34], tropic: [0x2f7a7a, 0x3a6a9a, 0x8a5a3a], adobe: [0x5a3a22] };
const DOORS: Record<string, number[]> = { farm: [0x6a4a30, 0x5a6a5a, 0x7a2e26], cabin: [0x4a3424], tropic: [0x3a7a8a, 0x8a4a2a], adobe: [0x5a3a22, 0x3a5a6a] };
const GLASS = 0x9fb6c0;

/** The detail of one window or door in a wall: its frame of the wall (alongX, the wall's middle across it and which
 * way is out) and the hole. */
function opening(L: Local, b: Bld, alongX: boolean, mid: number, out: number, inner: boolean, o: Opening, level: number) {
  const base = b.y - 0.4;
  const door = o.b <= base + 0.05;
  const h = hash(L.x + o.c, L.z + mid, o.b);
  const a0 = o.c - o.w / 2;
  const a1 = o.c + o.w / 2;
  // in the frame of the wall: u along it, v across (out positive), y up
  const P = (u: number, v: number): [number, number] => (alongX ? [u, mid + v * out] : [mid + v * out, u]);
  const box = (part: Part, color: number, u0: number, y0: number, v0: number, u1: number, y1: number, v1: number) => {
    const [x0, z0] = P(u0, v0);
    const [x1, z1] = P(u1, v1);
    L.box(part, color, x0, y0, z0, x1, y1, z1);
  };
  const style = b.style;
  if (!door) {
    // a casement in the middle of the wall: frame, mullion and transom, and the glass whole, broken or gone
    const fc = b.trim;
    const t = 0.03;
    box('trim', fc, a0, o.b, -t, a1, o.b + 0.06, t);
    box('trim', fc, a0, o.t - 0.06, -t, a1, o.t, t);
    box('trim', fc, a0, o.b, -t, a0 + 0.06, o.t, t);
    box('trim', fc, a1 - 0.06, o.b, -t, a1, o.t, t);
    const split = o.w > 1 && b.kind !== 'barn';
    if (split) box('trim', fc, o.c - 0.025, o.b, -t, o.c + 0.025, o.t, t);
    const ty = o.b + (o.t - o.b) * 0.68;
    if (level > 0) box('trim', fc, a0, ty - 0.025, -t, a1, ty + 0.025, t);
    const lights: [number, number][] = split ? [[a0 + 0.06, o.c - 0.025], [o.c + 0.025, a1 - 0.06]] : [[a0 + 0.06, a1 - 0.06]];
    const fate = h < 0.32 ? 0 : h < 0.7 ? 1 : 2;
    for (const [u0, u1] of lights) {
      const y0 = o.b + 0.06;
      const y1 = o.t - 0.06;
      if (fate === 0) box('glass', GLASS, u0, y0, -0.004, u1, y1, 0.004);
      else if (fate === 1) {
        // what is left of a broken pane: jagged shards along the frame
        const r = mulberry32(Math.floor(h * 1e6) + Math.round(u0 * 100));
        const n = 3 + Math.floor(r() * 3);
        for (let k = 0; k < n; k++) {
          const side = Math.floor(r() * 4);
          const s0 = r();
          const len = 0.12 + r() * 0.3;
          const hw = 0.04 + r() * 0.1;
          const pts: [number, number][] =
            side === 0
              ? [[u0 + s0 * (u1 - u0 - 0.1), y0], [u0 + s0 * (u1 - u0 - 0.1) + hw * 2, y0], [u0 + s0 * (u1 - u0 - 0.1) + hw, y0 + len]]
              : side === 1
                ? [[u0 + s0 * (u1 - u0 - 0.1), y1], [u0 + s0 * (u1 - u0 - 0.1) + hw * 2, y1], [u0 + s0 * (u1 - u0 - 0.1) + hw, y1 - len]]
                : side === 2
                  ? [[u0, y0 + s0 * (y1 - y0 - 0.1)], [u0, y0 + s0 * (y1 - y0 - 0.1) + hw * 2], [u0 + len, y0 + s0 * (y1 - y0 - 0.1) + hw]]
                  : [[u1, y0 + s0 * (y1 - y0 - 0.1)], [u1, y0 + s0 * (y1 - y0 - 0.1) + hw * 2], [u1 - len, y0 + s0 * (y1 - y0 - 0.1) + hw]];
          shard(L, P, pts);
        }
      }
    }
    if (inner || b.kind === 'barn') return;
    // shutters swung open flat against the outside, now and then one hanging loose; bars over some adobe windows
    if (style === 'adobe') {
      if (h > 0.55) for (let k = 1; k < 4; k++) box('metal', 0x2a2826, a0 + (o.w * k) / 4 - 0.015, o.b, 0.16, a0 + (o.w * k) / 4 + 0.015, o.t, 0.19);
      return;
    }
    if (h > 0.62 || level === 0) return;
    const sc = SHUTTERS[style][Math.floor(hash(L.x, L.z, 3) * SHUTTERS[style].length)];
    const lw = o.w / 2;
    const v0 = 0.17;
    for (const side of [-1, 1]) {
      const loose = hash(o.c, side, L.x) < 0.15;
      const hinge = side < 0 ? a0 - 0.08 : a1 + 0.08;
      const u0 = side < 0 ? hinge - lw : hinge;
      const u1 = side < 0 ? hinge : hinge + lw;
      if (loose) {
        // hanging from one hinge, swung part way out from the wall
        const [hx, hz] = P(hinge, v0 + 0.02);
        const yaw = (alongX ? 0 : Math.PI / 2) + (side * out * (alongX ? 1 : -1) * 0.6);
        const um = side * lw * 0.5;
        const ca = Math.cos(L.yaw + yaw);
        const sa = Math.sin(L.yaw + yaw);
        const wx = L.xz(hx, hz);
        L.add.box('wood', sc, wx[0] + um * ca, (o.b + o.t) / 2 - 0.06, wx[1] - um * sa, lw / 2, (o.t - o.b) / 2, 0.018, L.yaw + yaw, 0, side * 0.12);
        continue;
      }
      box('wood', sc, u0, o.b - 0.02, v0, u1, o.t + 0.02, v0 + 0.035);
      // louvers (on the highest setting)
      if (level > 1) for (let y = o.b + 0.12; y < o.t - 0.06; y += 0.2) box('wood', sc, u0 + 0.04, y, v0 + 0.035, u1 - 0.04, y + 0.06, v0 + 0.05);
    }
    return;
  }
  // a door standing open into the room (or a pair of sliding doors run aside, on a barn), a step outside
  const floor = b.y + 0.12;
  const dc = DOORS[style][Math.floor(hash(L.x, L.z, 7) * DOORS[style].length)];
  if (o.w >= 3) {
    const lw = o.w / 2 + 0.1;
    const bc = b.wall;
    for (const side of [-1, 1]) {
      const u0 = side < 0 ? a0 - lw + 0.25 : a1 - 0.25;
      const u1 = u0 + lw;
      box('wood', bc, u0, b.y - 0.05, 0.14, u1, o.t - 0.02, 0.2);
      // its ledges, and its edges framed
      for (const y of [b.y + 0.4, (b.y + o.t) / 2, o.t - 0.35]) box('wood', mul(bc, 0.85), u0, y - 0.08, 0.2, u1, y + 0.08, 0.24);
      for (const u of [u0, u1 - 0.14]) box('wood', mul(bc, 0.85), u, b.y - 0.05, 0.2, u + 0.14, o.t - 0.02, 0.24);
    }
    box('metal', 0x3a3a3a, a0 - o.w / 2 - 0.4, o.t + 0.02, 0.14, a1 + o.w / 2 + 0.4, o.t + 0.12, 0.26);
    return;
  }
  const fate = h < 0.82 ? 0 : 1;
  if (fate === 0 && level > 0) {
    // the leaf, hinged at one jamb and swung in square to the wall
    const hingeLeft = h < 0.41;
    const hu = hingeLeft ? a0 + 0.03 : a1 - 0.03;
    const lw = o.w - 0.08;
    const top = o.t - 0.03;
    const vIn = inner ? -0.08 : -(Math.abs((b.walls[0]?.t1 ?? 0) - (b.walls[0]?.t0 ?? 0.25)) / 2) - 0.02;
    const v0 = vIn - lw;
    const v1 = vIn;
    box('wood', dc, hu - 0.025, floor, v0, hu + 0.025, top, v1);
    // panels and a handle
    for (const [p0, p1] of [
      [floor + 0.15, floor + 0.9],
      [floor + 1.05, top - 0.15],
    ])
      for (const s of [-1, 1]) box('wood', dc, hu + s * 0.025, p0, v0 + 0.12, hu + s * 0.035, p1, v1 - 0.12);
    box('metal', 0xb0a890, hu - 0.06, floor + 0.95, v0 + 0.06, hu + 0.06, floor + 1.0, v0 + 0.1);
  }
  if (!inner) {
    box('concrete', 0x9a958c, a0 - 0.2, b.y - 0.35, 0.13, a1 + 0.2, b.y + 0.08, 0.6);
    // a canopy over the door on two brackets, on houses
    if (b.kind === 'house' && !b.flat && level > 0) {
      const y = o.t + 0.18;
      for (const u of [a0 - 0.15, a1 + 0.15]) box('trim', b.trim, u - 0.04, y - 0.35, 0.13, u + 0.04, y, 0.7);
      const [cx, cz] = P(o.c, 0.45);
      L.at('roof', b.roof, cx, y + 0.1, cz, alongX ? o.w / 2 + 0.35 : 0.42, 0.04, alongX ? 0.42 : o.w / 2 + 0.35, 0, alongX ? out * 0.3 : 0, alongX ? 0 : -out * 0.3);
    }
  }
}

/** A thin sliver of glass in a wall's plane, from three points (u along the wall, y up). */
function shard(L: Local, P: (u: number, v: number) => [number, number], pts: [number, number][]) {
  // as three thin boxes would be heavy: a flat triangle both ways, as a tiny box fan
  const [a, b2, c] = pts;
  const cu = (a[0] + b2[0] + c[0]) / 3;
  const cy = (a[1] + b2[1] + c[1]) / 3;
  const w = Math.hypot(b2[0] - a[0], b2[1] - a[1]) * 0.35;
  const hgt = Math.hypot(c[0] - (a[0] + b2[0]) / 2, c[1] - (a[1] + b2[1]) / 2) * 0.5;
  const ang = Math.atan2(c[1] - (a[1] + b2[1]) / 2, c[0] - (a[0] + b2[0]) / 2) - Math.PI / 2;
  const [x, z] = P(cu, 0);
  const alongX = Math.abs(P(1, 0)[0] - P(0, 0)[0]) > 0.5;
  L.at('glass', GLASS, x, cy, z, alongX ? w : 0.004, hgt, alongX ? 0.004 : w, 0, alongX ? 0 : ang, alongX ? ang : 0);
}

/** One building's detail: its openings, the door canopy and step, the gutters, the chimney, the spouts of a flat roof,
 * the ceiling joists and the furniture. */
function building(add: Add, b: Bld, level: number, loot: Float32Array) {
  const L = new Local(add, b.x, b.z, yawOf(b.rot));
  const hw = b.w / 2;
  const hd = b.d / 2;
  const T = 0.25;
  const top = b.y + b.H;
  for (const wall of b.walls) {
    const mid = (wall.t0 + wall.t1) / 2;
    const out = mid < 0 ? -1 : 1;
    for (const o of wall.holes) opening(L, b, wall.alongX, mid, out, wall.inner, o, level);
  }
  if (b.kind === 'ruin') return;
  // spouts through an adobe parapet, a water tank on some flat roofs (not on one you can climb to: it would stand in
  // the way without a collider)
  if (b.flat) {
    const pt = top + 0.22;
    for (let x = -hw + 1.2; x < hw - 0.8; x += 2.6) for (const s of [-1, 1]) L.box('wood', 0x6b4a2e, x - 0.09, pt, s * (hd + 0.1), x + 0.09, pt + 0.14, s * (hd + 0.75));
    if (level > 0 && !b.up?.roof && hash(b.x, b.z, 11) < 0.5) tank(L, hw * 0.4, pt, -hd * 0.3);
  }
  // ceiling joists under the roof slab, and the furniture (indoors, casting no shadow)
  L.add.shade = false;
  if (level > 0 && b.kind !== 'barn') {
    const span = b.w >= b.d;
    const n = Math.floor((span ? b.w : b.d) / 1.3);
    for (let k = 1; k < n; k++) {
      const s = -(span ? hw : hd) + (k * (span ? b.w : b.d)) / n;
      if (span) L.box('wood', 0x5a4632, s - 0.06, top - 0.2, -hd + T, s + 0.06, top, hd - T);
      else L.box('wood', 0x5a4632, -hw + T, top - 0.2, s - 0.06, hw - T, top, s + 0.06);
    }
  }
  if (level > 0) {
    // a storey at a time (a house's upper floors are its bedrooms; a warehouse's mezzanine stays bare)
    const up = b.up;
    const ground = up?.lv.length ? { ...b, walls: b.walls.filter((w) => !w.lv) } : b;
    furniture(L, ground, loot, level);
    if (up && b.kind === 'house') up.lv.forEach((y, k) => furniture(L, { ...b, y: y - 0.12, walls: b.walls.filter((w) => w.lv === k + 1) }, loot, level, 1));
  }
  L.add.shade = true;
}

/** A water tank on a stand. */
function tank(L: Local, lx: number, y: number, lz: number) {
  for (const a of [-0.4, 0.4]) for (const c of [-0.4, 0.4]) L.box('metal', 0x5a5a56, lx + a - 0.03, y, lz + c - 0.03, lx + a + 0.03, y + 0.6, lz + c + 0.03);
  L.box('metal', 0x8a8a84, lx - 0.48, y + 0.6, lz - 0.48, lx + 0.48, y + 0.66, lz + 0.48);
  L.box('metal', 0x9aa2a4, lx - 0.42, y + 0.66, lz - 0.42, lx + 0.42, y + 1.6, lz + 0.42);
}

// furniture: against the walls of a room, clear of the doors, of the tall windows and of the loot on the floor. A piece
// is drawn with the real models where props.glb loaded (see furnish.ts), and with a few boxes otherwise
/** A piece: its footprint along and across the wall it stands on, its height, and whether it is tall (kept from under a
 * window). `side` says which wall: -1 the low one, +1 the high one (of local z when `along`, of local x otherwise), and
 * its front faces away from it. `real` draws it with the real models, false when they didn't load. */
type Piece = { w: number; d: number; h: number; tall: boolean; draw: Draw; real?: (...a: Parameters<Draw>) => boolean };
type Draw = (L: Local, x: number, y: number, z: number, along: boolean, side: number, level: number) => void;

const WOOD = 0x7a5a3a;
const DARK = 0x4a3a2a;

function legs(L: Local, x: number, y: number, z: number, hx: number, hz: number, h: number, c: number, along: boolean) {
  const [ax, az] = along ? [hx, hz] : [hz, hx];
  for (const a of [-1, 1]) for (const b of [-1, 1]) L.box('wood', c, x + a * (ax - 0.03) - 0.025, y, z + b * (az - 0.03) - 0.025, x + a * (ax - 0.03) + 0.025, y + h, z + b * (az - 0.03) + 0.025);
}
/** A box of furniture by its middle, half sizes along and across the wall it stands on, and its bottom and top. */
function fbox(L: Local, part: Part, c: number, x: number, z: number, ha: number, hc: number, y0: number, y1: number, along: boolean) {
  const [hx, hz] = along ? [ha, hc] : [hc, ha];
  L.box(part, c, x - hx, y0, z - hz, x + hx, y1, z + hz);
}
/** The yaw in the frame that turns a model's front (+z) away from the wall a piece stands against. */
const face = (along: boolean, side: number) => (along ? (side < 0 ? 0 : Math.PI) : side < 0 ? Math.PI / 2 : -Math.PI / 2);
/** The point `d` out from (x, z) toward the room (away from the piece's wall) and `a` along the wall. */
const outOf = (x: number, z: number, along: boolean, side: number, d: number, a = 0): [number, number] => (along ? [x + a, z - side * d] : [x - side * d, z + a]);

/** A real model standing at a piece's middle, facing the room. */
const model =
  (k: PropKey, turn = 0): Piece['real'] =>
  (L, x, y, z, along, side) => {
    if (!L.has(k)) return false;
    L.prop(k, x, z, y, face(along, side) + turn * (hash(x, z, 9) - 0.5));
    return true;
  };
/** A few cans (or a paint tin) standing on a top at height y, somewhere along it. */
function cans(L: Local, x: number, y: number, z: number, along: boolean, side: number, spread: number) {
  const h = hash(z + y, x, 4);
  const k: PropKey = h < 0.6 ? 'cans' : 'tin';
  if (!L.has(k)) return;
  L.prop(k, ...outOf(x, z, along, side, 0.05, (h - 0.5) * spread), y, h * 40);
}

/** The workbench's top, legs and shelf. */
function benchBody(L: Local, x: number, y: number, z: number, along: boolean) {
  fbox(L, 'wood', WOOD, x, z, 0.9, 0.35, y + 0.84, y + 0.9, along);
  legs(L, x, y, z, 0.9, 0.35, 0.84, WOOD, along);
  fbox(L, 'wood', DARK, x, z, 0.86, 0.32, y + 0.22, y + 0.25, along);
}

const PIECES: Record<string, Piece> = {
  bed: {
    w: 2.0,
    d: 0.95,
    h: 0.6,
    tall: false,
    draw(L, x, y, z, along, flip) {
      fbox(L, 'wood', DARK, x, z, 1.0, 0.47, y + 0.18, y + 0.32, along);
      legs(L, x, y, z, 1.0, 0.47, 0.18, DARK, along);
      const e = flip;
      const hx = along ? x + e * 0.97 : x;
      const hz = along ? z : z + e * 0.97;
      fbox(L, 'wood', DARK, hx, hz, 0.04, 0.47, y, y + 0.85, !along);
      fbox(L, 'canvas', 0xd8d2c0, x, z, 0.96, 0.44, y + 0.32, y + 0.5, along);
      const px = along ? x + e * 0.75 : x;
      const pz = along ? z : z + e * 0.75;
      fbox(L, 'canvas', 0xe8e4d8, px, pz, 0.17, 0.3, y + 0.5, y + 0.6, along);
      const bx = along ? x - e * 0.25 : x;
      const bz = along ? z : z - e * 0.25;
      fbox(L, 'canvas', 0x6a5a3a, bx, bz, 0.72, 0.47, y + 0.48, y + 0.54, along);
    },
    // the iron bedstead; a mattress on its springs in most, a pillow at its head (the frame's -x end) and a blanket
    real(L, x, y, z, along, side) {
      if (!L.has('bed')) return false;
      const yaw = face(along, side);
      L.prop('bed', x, z, y, yaw);
      const h = hash(x, z, 5);
      if (h < 0.7) {
        fbox(L, 'canvas', 0xcfc8b4, x, z, 0.9, 0.4, y + 0.49, y + 0.63, along);
        const hx = -Math.cos(yaw) * 0.7;
        const hz = Math.sin(yaw) * 0.7;
        fbox(L, 'canvas', 0xe2ddd0, x + hx, z + hz, 0.17, 0.28, y + 0.63, y + 0.71, along);
        if (h < 0.45) fbox(L, 'canvas', 0x5a4c34, x - hx * 0.3, z - hz * 0.3, 0.6, 0.41, y + 0.62, y + 0.67, along);
      }
      return true;
    },
  },
  table: {
    w: 1.6,
    d: 0.95,
    h: 0.78,
    tall: false,
    draw(L, x, y, z, along, side) {
      fbox(L, 'wood', WOOD, x, z, 0.7, 0.4, y + 0.72, y + 0.77, along);
      legs(L, x, y, z, 0.7, 0.4, 0.72, WOOD, along);
      // two chairs on the room's side, one knocked over
      for (const s of [-0.35, 0.35]) {
        const [cx, cz] = outOf(x, z, along, side, 0.62, s);
        if (s > 0 && hash(x, z) < 0.4) {
          fbox(L, 'wood', WOOD, cx, cz, 0.2, 0.21, y, y + 0.05, along);
          continue;
        }
        fbox(L, 'wood', WOOD, cx, cz, 0.2, 0.2, y + 0.43, y + 0.47, along);
        legs(L, cx, y, cz, 0.2, 0.2, 0.43, WOOD, along);
        const [bx, bz] = outOf(cx, cz, along, side, 0.18);
        fbox(L, 'wood', WOOD, bx, bz, 0.2, 0.02, y + 0.47, y + 0.92, along);
      }
    },
    // the table in its cloth, two chairs pulled up to it on the room's side (one knocked over now and then), a few cans
    real(L, x, y, z, along, side, level) {
      if (!L.has('table')) return false;
      const yaw = face(along, side);
      L.prop('table', x, z, y, yaw);
      if (L.has('chair'))
        for (const s of [-0.4, 0.4]) {
          const j = hash(x + s, z, 3);
          if (s > 0 && hash(x, z) < 0.4) L.prop('chair', ...outOf(x, z, along, side, 1.05, s + 0.2), y + 0.24, yaw + Math.PI + 0.6 + j, true, 0, Math.PI / 2);
          else L.prop('chair', ...outOf(x, z, along, side, 0.7 + j * 0.12, s), y, yaw + Math.PI + (j - 0.5) * 0.5);
        }
      if (level > 1) cans(L, x, y + 0.71, z, along, side, 0.9);
      return true;
    },
  },
  cabinet: {
    w: 1.0,
    d: 0.5,
    h: 1.9,
    tall: true,
    draw(L, x, y, z, along, side) {
      fbox(L, 'wood', DARK, x, z, 0.5, 0.25, y, y + 1.9, along);
      for (const s of [-0.25, 0.25]) {
        const [hx, hz] = outOf(x, z, along, side, 0.255, s);
        fbox(L, 'wood', WOOD, hx, hz, 0.23, 0.006, y + 0.1, y + 1.8, along);
      }
    },
    real: model('cabinet'),
  },
  shelf: {
    w: 1.2,
    d: 0.5,
    h: 1.8,
    tall: true,
    draw(L, x, y, z, along, side, level) {
      for (const s of [-0.58, 0.58]) {
        const sx = along ? x + s : x;
        const sz = along ? z : z + s;
        fbox(L, 'wood', WOOD, sx, sz, 0.02, 0.19, y, y + 1.8, along);
      }
      const [bx, bz] = outOf(x, z, along, side, -0.17);
      fbox(L, 'wood', DARK, bx, bz, 0.58, 0.01, y, y + 1.8, along);
      const r = mulberry32(Math.floor(hash(x, z) * 1e6));
      for (let k = 0; k < 5; k++) {
        const sy = y + 0.08 + k * 0.42;
        fbox(L, 'wood', WOOD, x, z, 0.57, 0.18, sy - 0.02, sy, along);
        if (k === 4 || level < 2) continue;
        // jars, tins and boxes
        for (let i = 0; i < 3; i++) {
          if (r() < 0.35) continue;
          const o = -0.4 + i * 0.4 + (r() - 0.5) * 0.1;
          const ox = along ? x + o : x;
          const oz = along ? z : z + o;
          const hgt = 0.12 + r() * 0.16;
          fbox(L, r() < 0.5 ? 'canvas' : 'metal', [0xb8a070, 0x8a4a3a, 0x5a6a7a, 0xd0c8b0][Math.floor(r() * 4)], ox, oz, 0.08 + r() * 0.05, 0.08, sy, sy + hgt, along);
        }
      }
    },
    // (and at the highest detail a few cans and tins on its boards)
    real(L, x, y, z, along, side, level) {
      if (!L.has('shelf')) return false;
      L.prop('shelf', x, z, y, face(along, side));
      if (level > 1) for (const b of [0.34, 0.84, 1.45]) if (hash(x, b, z) < 0.6) cans(L, x, y + b, z, along, side, 0.8);
      return true;
    },
  },
  stove: {
    w: 0.65,
    d: 0.6,
    h: 0.9,
    // (its flue runs up past a window's height)
    tall: true,
    draw(L, x, y, z, along, side) {
      fbox(L, 'rust', 0x3a3836, x, z, 0.32, 0.3, y, y + 0.86, along);
      fbox(L, 'rust', 0x2a2826, x, z, 0.34, 0.31, y + 0.86, y + 0.9, along);
      const [dx, dz] = outOf(x, z, along, side, 0.305);
      fbox(L, 'rust', 0x5a5852, dx, dz, 0.22, 0.008, y + 0.2, y + 0.6, along);
      const [px, pz] = outOf(x, z, along, side, -0.12, 0.15);
      L.box('metal', 0x2a2826, px - 0.06, y + 0.9, pz - 0.06, px + 0.06, y + 2.3, pz + 0.06);
    },
    // a stove made of an oil drum, and its flue
    real(L, x, y, z, along, side) {
      if (!L.has('stove')) return false;
      L.prop('stove', x, z, y, face(along, side) + hash(x, z, 2) * 6);
      const [px, pz] = outOf(x, z, along, side, -0.1);
      L.box('metal', 0x2a2826, px - 0.06, y + 0.85, pz - 0.06, px + 0.06, y + 2.3, pz + 0.06);
      return true;
    },
  },
  bench: {
    w: 1.8,
    d: 0.7,
    h: 0.9,
    tall: false,
    draw(L, x, y, z, along) {
      benchBody(L, x, y, z, along);
      fbox(L, 'metal', 0x4a5a6a, x - 0.4, z, 0.12, 0.1, y + 0.9, y + 1.02, along);
      fbox(L, 'canvas', 0x7a2a22, x + 0.3, z, 0.22, 0.14, y + 0.9, y + 1.08, along);
    },
    // a vice at one end of the bench, and a tin on it
    real(L, x, y, z, along, side) {
      if (!L.has('vice')) return false;
      benchBody(L, x, y, z, along);
      const e = hash(x, z, 6) < 0.5 ? -1 : 1;
      L.prop('vice', ...outOf(x, z, along, side, 0.16, e * 0.6), y + 0.9, face(along, side));
      cans(L, x, y + 0.9, z, along, side, 0.6);
      return true;
    },
  },
  bales: {
    w: 2.2,
    d: 1.0,
    h: 1.0,
    tall: false,
    draw(L, x, y, z, along) {
      for (const s of [-0.55, 0.55])
        for (const k of [0, 1]) {
          if (k === 1 && s > 0 && hash(x, z) < 0.5) continue;
          const bx = along ? x + s : x;
          const bz = along ? z : z + s;
          fbox(L, 'canvas', 0xc8b070, bx, bz, 0.52, 0.47, y + k * 0.48, y + k * 0.48 + 0.46, along);
        }
    },
  },
  sofa: {
    w: 2.0,
    d: 0.65,
    h: 1.02,
    tall: false,
    draw(L, x, y, z, along, side) {
      fbox(L, 'wood', DARK, x, z, 0.98, 0.3, y + 0.1, y + 0.42, along);
      legs(L, x, y, z, 0.98, 0.3, 0.1, DARK, along);
      fbox(L, 'canvas', 0x5a6a7a, x, z, 0.92, 0.27, y + 0.42, y + 0.52, along);
      const [bx, bz] = outOf(x, z, along, side, -0.27);
      fbox(L, 'wood', DARK, bx, bz, 0.98, 0.04, y + 0.42, y + 0.95, along);
      for (const s of [-0.95, 0.95]) {
        const [ax, az] = outOf(x, z, along, side, 0, s);
        fbox(L, 'wood', DARK, ax, az, 0.04, 0.3, y + 0.42, y + 0.68, along);
      }
    },
    real: model('sofa'),
  },
  sideboard: {
    w: 1.1,
    d: 0.56,
    h: 1.06,
    tall: false,
    draw(L, x, y, z, along, side) {
      fbox(L, 'wood', 0xb8b0a0, x, z, 0.54, 0.27, y, y + 1.0, along);
      fbox(L, 'wood', DARK, x, z, 0.56, 0.28, y + 1.0, y + 1.04, along);
      for (const s of [-0.26, 0.26]) {
        const [dx, dz] = outOf(x, z, along, side, 0.275, s);
        fbox(L, 'wood', 0xa8a090, dx, dz, 0.24, 0.006, y + 0.12, y + 0.7, along);
      }
    },
    real(L, x, y, z, along, side, level) {
      if (!L.has('sideboard')) return false;
      L.prop('sideboard', x, z, y, face(along, side));
      if (level > 1) cans(L, x, y + 1.06, z, along, side, 0.7);
      return true;
    },
  },
  nightstand: {
    w: 0.45,
    d: 0.45,
    h: 0.6,
    tall: false,
    draw(L, x, y, z, along) {
      fbox(L, 'wood', DARK, x, z, 0.2, 0.2, y, y + 0.55, along);
      fbox(L, 'wood', WOOD, x, z, 0.22, 0.22, y + 0.55, y + 0.58, along);
    },
    real: model('nightstand'),
  },
  stool: {
    w: 0.42,
    d: 0.42,
    h: 0.58,
    tall: false,
    draw(L, x, y, z, along) {
      fbox(L, 'wood', WOOD, x, z, 0.17, 0.17, y + 0.53, y + 0.57, along);
      legs(L, x, y, z, 0.16, 0.16, 0.53, WOOD, along);
    },
    real: model('stool', 2),
  },
  rack: {
    w: 0.95,
    d: 0.62,
    h: 1.9,
    tall: true,
    draw(L, x, y, z, along) {
      const [ax, az] = along ? [0.44, 0.28] : [0.28, 0.44];
      for (const a of [-1, 1]) for (const b of [-1, 1]) L.box('metal', 0x5a5a54, x + a * ax - 0.02, y, z + b * az - 0.02, x + a * ax + 0.02, y + 1.9, z + b * az + 0.02);
      for (let k = 0; k < 4; k++) fbox(L, 'metal', 0x6a6a62, x, z, 0.46, 0.29, y + 0.15 + k * 0.55, y + 0.17 + k * 0.55, along);
    },
    real(L, x, y, z, along, side, level) {
      if (!L.has('rack')) return false;
      L.prop('rack', x, z, y, face(along, side));
      if (level > 1) for (const b of [0.43, 0.92, 1.41]) if (hash(x, b, z) < 0.5) cans(L, x, y + b, z, along, side, 0.6);
      return true;
    },
  },
  // (only where the real ones loaded: nothing stands in for them)
  ladder: { w: 1.0, d: 0.55, h: 1.33, tall: false, draw() {}, real: model('ladder') },
  cask: { w: 0.8, d: 0.8, h: 0.87, tall: false, draw() {}, real: model('cask', 3) },
};

const ROOMS: Record<string, string[][]> = {
  house: [
    ['table', 'stove', 'sideboard', 'shelf', 'stool'],
    ['bed', 'nightstand', 'cabinet', 'sofa'],
  ],
  shed: [['bench', 'rack', 'stool']],
  barn: [['bales', 'bench', 'bales', 'ladder', 'cask']],
};

function furniture(L: Local, b: Bld, loot: Float32Array, level: number, set = 0) {
  const sets = ROOMS[b.kind];
  if (!sets) return;
  const T = 0.25;
  const hw = b.w / 2;
  const hd = b.d / 2;
  const floor = b.y + 0.12;
  // rooms: split by the inside wall, if there is one
  const inner = b.walls.find((w) => w.inner);
  const rooms: [number, number, number, number][] = inner ? [[-hw + T, -hd + T, inner.t0, hd - T], [inner.t1, -hd + T, hw - T, hd - T]] : [[-hw + T, -hd + T, hw - T, hd - T]];
  // openings on each wall, in the frame (the doors with room for the leaf to swing)
  const holes: { alongX: boolean; at: number; a0: number; a1: number; door: boolean; low: number }[] = [];
  for (const wall of b.walls)
    for (const o of wall.holes) {
      const door = o.b <= b.y - 0.35;
      holes.push({ alongX: wall.alongX, at: (wall.t0 + wall.t1) / 2, a0: o.c - o.w / 2 - (door ? 1.3 : 0.15), a1: o.c + o.w / 2 + (door ? 1.3 : 0.15), door, low: o.b });
    }
  // the loot spots in the building, in its frame
  const spots: [number, number][] = [];
  const c = Math.cos(-L.yaw);
  const s = Math.sin(-L.yaw);
  for (let i = 0; i < loot.length; i += 3) {
    const dx = loot[i] - b.x;
    const dz = loot[i + 2] - b.z;
    if (Math.abs(dx) > hw + hd || Math.abs(dz) > hw + hd) continue;
    spots.push([dx * c + dz * s, -dx * s + dz * c]);
  }
  const taken: [number, number, number, number][] = [];
  // (clear of the stairs and the stairwells)
  const keep = b.up?.keep ?? [];
  for (let i = 0; i + 3 < keep.length; i += 4) taken.push([keep[i], keep[i + 1], keep[i + 2], keep[i + 3]]);
  rooms.forEach((room, ri) => {
    const list = sets[Math.min(ri + set, sets.length - 1)];
    const [x0, z0, x1, z1] = room;
    for (const name of list) {
      const p = PIECES[name];
      let done = false;
      // the room's corners and the middles of its walls, from a start of its own
      const tries: [number, number, boolean, number][] = [];
      for (const along of [true, false]) {
        const [hx, hz] = along ? [p.w / 2, p.d / 2] : [p.d / 2, p.w / 2];
        for (const fx of [0, 1, 0.5])
          for (const fz of [0, 1, 0.5]) {
            if (fx === 0.5 && fz === 0.5) continue;
            // against a wall: across it touching, along it at a corner or the middle
            if (along && fz === 0.5) continue;
            if (!along && fx === 0.5) continue;
            const x = fx === 0 ? x0 + hx + 0.02 : fx === 1 ? x1 - hx - 0.02 : (x0 + x1) / 2;
            const z = fz === 0 ? z0 + hz + 0.02 : fz === 1 ? z1 - hz - 0.02 : (z0 + z1) / 2;
            tries.push([x, z, along, along ? (fz === 0 ? -1 : 1) : fx === 0 ? -1 : 1]);
          }
      }
      const start = Math.floor(hash(b.x + ri, b.z, name.length) * tries.length);
      for (let k = 0; k < tries.length && !done; k++) {
        const [x, z, along, side] = tries[(start + k) % tries.length];
        const [hx, hz] = along ? [p.w / 2, p.d / 2] : [p.d / 2, p.w / 2];
        if (x - hx < x0 - 0.01 || x + hx > x1 + 0.01 || z - hz < z0 - 0.01 || z + hz > z1 + 0.01) continue;
        // clear of doors (and their leaves), of tall windows, of the loot, of what is down already
        const clash = holes.some((o) => {
          if (!o.door && (!p.tall || o.low > floor + p.h)) return false;
          const near = o.alongX ? Math.abs(o.at - z) < hz + 0.45 : Math.abs(o.at - x) < hx + 0.45;
          const over = o.alongX ? x + hx > o.a0 && x - hx < o.a1 : z + hz > o.a0 && z - hz < o.a1;
          return near && over;
        });
        if (clash) continue;
        if (spots.some(([sx, sz]) => Math.abs(sx - x) < hx + 0.35 && Math.abs(sz - z) < hz + 0.35)) continue;
        if (taken.some(([a, bb, cc, d]) => x + hx > a && x - hx < cc && z + hz > bb && z - hz < d)) continue;
        taken.push([x - hx - 0.1, z - hz - 0.1, x + hx + 0.1, z + hz + 0.1]);
        if (!p.real?.(L, x, floor, z, along, side, level)) p.draw(L, x, floor, z, along, side, level);
        done = true;
      }
    }
  });
}

/** The roof's trim on a pitched roof: underside, fascia and barge boards, ridge cap, gutters and downpipes, and a
 * chimney on a house. */
function roofTrim(add: Add, w: World, level: number) {
  for (const g of w.gables) {
    const { x0, z0, x1, z1, y, h } = g;
    const wx = x1 - x0;
    const wz = z1 - z0;
    if (Math.min(wx, wz) < 2.5) continue;
    // in a frame with the ridge along local z
    const yaw = g.alongX ? Math.PI / 2 : 0;
    const L = new Local(add, (x0 + x1) / 2, (z0 + z1) / 2, yaw);
    const half = (g.alongX ? wz : wx) / 2;
    const len = (g.alongX ? wx : wz) / 2;
    const slope = Math.atan2(h, half);
    const run = Math.hypot(half, h);
    const fc = 0x4a3a2c;
    // the underside of both slopes, and their thickness at the eaves
    for (const s of [-1, 1]) {
      L.at('trim', 0x6a5a48, (s * half) / 2, y + h / 2 - 0.05, 0, run / 2, 0.012, len, 0, 0, -s * slope);
      // fascia along the eave, and a gutter on it
      L.at('trim', fc, s * (half + 0.02), y - 0.06, 0, 0.025, 0.1, len, 0, 0, 0);
      if (level > 0) {
        L.at('metal', 0x8a8e90, s * (half + 0.1), y - 0.1, 0, 0.065, 0.05, len);
        // a downpipe at one end of each eave, down the corner of the wall to the ground
        const ez = s * (len - 0.75);
        const px = s * (half - 0.32);
        const [gx, gz] = L.xz(px, ez);
        const g0 = floorAt(w.terrain, gx, gz) + 0.1;
        L.at('metal', 0x8a8e90, s * (half - 0.1), y - 0.14, ez, 0.12, 0.035, 0.035);
        L.at('metal', 0x8a8e90, px, (y - 0.14 + g0) / 2, ez, 0.035, (y - 0.14 - g0) / 2, 0.035);
      }
    }
    // barge boards up the gable ends, and the ridge cap
    for (const e of [-1, 1])
      for (const s of [-1, 1]) L.at('trim', fc, (s * half) / 2, y + h / 2 + 0.02, e * (len + 0.01), run / 2 + 0.03, 0.1, 0.025, 0, 0, -s * slope);
    L.at('roof', g.color, 0, y + h + 0.03, 0, 0.12, 0.06, len + 0.02);
    // the chimney, on a house roof: through one slope, a little off the ridge, toward one end
    const small = Math.min(wx, wz) < 6.5;
    const house = !small && Math.max(wx, wz) < 13;
    if (house && hash(g.x0, g.z0) < 0.75) {
      const side = hash(g.z0, g.x0) < 0.5 ? -1 : 1;
      const cz = side * len * 0.5;
      const cx = -side * 0.9;
      const base = y + h - (0.9 / half) * h - 0.3;
      const tc = 0x8a5446;
      L.at('wall', tc, cx, (base + y + h + 0.75) / 2, cz, 0.32, (y + h + 0.75 - base) / 2, 0.32);
      L.at('concrete', 0x8a8780, cx, y + h + 0.8, cz, 0.38, 0.05, 0.38);
      L.at('metal', 0x3a3836, cx, y + h + 0.98, cz, 0.08, 0.13, 0.08);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// the dressing

/** A shipping container, 6.06 by 2.44 m and `h` tall, along local x, on y = 0: corrugated side walls, corner posts,
 * rails and castings, a corrugated blind end and a pair of doors with their locking bars at the other. */
function container(three: Three, add: Add, L: Local, y: number, h: number, color: number, v: number) {
  const W = 6.06 / 2;
  const D = 2.44 / 2;
  const post = 0.16;
  const rail = 0.16;
  const dark = mul(color, 0.82);
  // the corrugations of the long sides: a trapezoid wave, 0.28 m a pitch, one strip of faces each side
  const side = corrugated(three, W - post, h - 2 * rail);
  for (const s of [-1, 1]) {
    const [sx, sz] = L.xz(0, s * (D - 0.005));
    add.geo('rust', color, side, new three.Matrix4().makeRotationY(L.yaw + (s < 0 ? Math.PI : 0)).setPosition(sx, y + rail, sz));
    // (and behind it a dark lining, so the inside never shows past the corrugations)
    L.at('rust', mul(color, 0.5), 0, y + h / 2, s * (D - 0.05), W - post, h / 2 - rail, 0.006);
    // top and bottom side rails
    L.at('rust', dark, 0, y + h - rail / 2, s * (D - 0.04), W, rail / 2, 0.04);
    L.at('rust', dark, 0, y + rail / 2, s * (D - 0.04), W, rail / 2, 0.04);
  }
  // the roof, in shallow ridges
  for (let k = 0; k < 10; k++) L.at('rust', mul(color, 1.04), -W + post + (k + 0.5) * ((2 * (W - post)) / 10), y + h - 0.02 + (k % 2) * 0.012, 0, (W - post) / 10, 0.02, D - 0.03);
  // corner posts, end rails, corner castings
  for (const a of [-1, 1]) {
    for (const b of [-1, 1]) {
      L.at('rust', dark, a * (W - post / 2), y + h / 2, b * (D - post / 2), post / 2, h / 2, post / 2);
      for (const yy of [y + 0.08, y + h - 0.08]) L.at('metal', 0x3a3a38, a * (W - 0.09), yy, b * (D - 0.09), 0.1, 0.09, 0.1);
    }
    L.at('rust', dark, a * (W - 0.06), y + h - 0.12, 0, 0.06, 0.12, D);
    L.at('rust', dark, a * (W - 0.06), y + 0.15, 0, 0.06, 0.15, D);
  }
  // the blind end, corrugated up and down
  const door = v < 0.5 ? -1 : 1;
  for (let k = 0; k < 7; k++) {
    const z = -D + post + (k + 0.5) * ((2 * (D - post)) / 7);
    L.at('rust', color, -door * (W - 0.03 - (k % 2) * 0.03), y + h / 2, z, 0.012, h / 2 - 0.25, (D - post) / 7);
  }
  // the doors: two leaves, each with two locking bars, cam keepers and hinges
  const dx = door * (W - 0.02);
  for (const s of [-1, 1]) {
    L.at('rust', color, dx, y + h / 2, (s * (D - post)) / 2, 0.02, h / 2 - 0.27, (D - post) / 2 - 0.01);
    for (let k = 0; k < 4; k++) L.at('rust', color, dx + door * 0.022, y + 0.45 + k * ((h - 0.9) / 3), (s * (D - post)) / 2, 0.006, 0.05, (D - post) / 2 - 0.05);
    for (const f of [0.28, 0.72]) {
      const z = s * (D - post) * f;
      L.at('metal', 0x5a5a56, dx + door * 0.05, y + h / 2, z, 0.02, h / 2 - 0.22, 0.02);
      L.at('metal', 0x3a3a38, dx + door * 0.07, y + 1.3, z + s * 0.08, 0.02, 0.03, 0.1);
    }
    for (const hy of [0.5, h / 2, h - 0.5]) L.at('metal', 0x3a3a38, dx + door * 0.03, y + hy, s * (D - post - 0.03), 0.03, 0.06, 0.04);
  }
}

/** A corrugated sheet, 2 hw long along x and h high from y = 0, facing +z: the trapezoid wave of a container's side
 * (0.28 m a pitch, 3.6 cm deep), one face per flat and slope. Built once a size. */
function corrugated(three: Three, hw: number, h: number) {
  const key = `${hw.toFixed(3)}:${h.toFixed(3)}`;
  const got = SHEETS.get(key);
  if (got) return got;
  const n = Math.round((2 * hw) / 0.278);
  const pitch = (2 * hw) / n;
  // the profile across one pitch: out flat, slope in, in flat, slope out
  const prof: [number, number][] = [];
  for (let k = 0; k < n; k++) {
    const x = -hw + k * pitch;
    prof.push([x, 0], [x + pitch * 0.38, 0], [x + pitch * 0.5, -0.036], [x + pitch * 0.88, -0.036]);
  }
  prof.push([hw, 0]);
  const pos: number[] = [];
  for (let i = 0; i + 1 < prof.length; i++) {
    const [x0, z0] = prof[i];
    const [x1, z1] = prof[i + 1];
    pos.push(x0, 0, z0, x1, 0, z1, x1, h, z1, x0, 0, z0, x1, h, z1, x0, h, z0);
  }
  const g = new three.BufferGeometry();
  g.setAttribute('position', new three.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  SHEETS.set(key, g);
  return g;
}
const SHEETS = new Map<string, T.BufferGeometry>();

const mul = (hex: number, k: number) => {
  const r = Math.min(255, Math.round(((hex >> 16) & 255) * k));
  const g = Math.min(255, Math.round(((hex >> 8) & 255) * k));
  const b = Math.min(255, Math.round((hex & 255) * k));
  return (r << 16) | (g << 8) | b;
};

/** A car's shapes, built once a kind: the body from its side profile (wheel arches cut out, edges rounded), and the
 * sides of its cabin with the window openings in them. In the car's frame: x across, z along (nose toward -z), y up
 * from its sills. */
function carShapes(three: Three, hatch: boolean) {
  const key = hatch ? 'hatch' : 'sedan';
  const got = CARS.get(key);
  if (got) return got;
  // the side profile (z along, y up), round the nose, over the hood, the cabin's foot, the trunk, and back underneath
  const s = new three.Shape();
  const prof: [number, number][] = hatch
    ? [
        [-2.0, 0.12],
        [-2.07, 0.34],
        [-1.98, 0.56],
        [-1.85, 0.62],
        [-0.9, 0.72],
        [1.92, 0.74],
        [2.0, 0.5],
        [1.98, 0.12],
      ]
    : [
        [-2.2, 0.12],
        [-2.26, 0.34],
        [-2.16, 0.56],
        [-2.02, 0.62],
        [-0.95, 0.74],
        [1.3, 0.76],
        [2.16, 0.7],
        [2.24, 0.46],
        [2.2, 0.12],
      ];
  prof.forEach(([z, y], i) => (i === 0 ? s.moveTo(z, y) : s.lineTo(z, y)));
  // the underside, with an arch over each wheel
  const wz = hatch ? 1.28 : 1.38;
  s.lineTo(wz + 0.42, 0.12);
  s.absarc(wz, 0.14, 0.42, 0, Math.PI, false);
  s.lineTo(-wz + 0.42, 0.12);
  s.absarc(-wz, 0.14, 0.42, 0, Math.PI, false);
  s.closePath();
  const body = new three.ExtrudeGeometry(s, { depth: 1.66, bevelEnabled: true, bevelThickness: 0.05, bevelSize: 0.05, bevelSegments: 2, curveSegments: 6 });
  body.rotateY(-Math.PI / 2);
  body.translate(0.83, 0, 0);
  // the cabin's sides: its outline, the windows cut out
  const c = new three.Shape();
  const top = 1.2;
  const out: [number, number][] = hatch
    ? [
        [-0.9, 0.7],
        [-0.25, top],
        [1.62, top],
        [1.92, 0.72],
      ]
    : [
        [-0.95, 0.72],
        [-0.25, top],
        [0.72, top + 0.01],
        [1.3, 0.74],
      ];
  out.forEach(([z, y], i) => (i === 0 ? c.moveTo(z, y) : c.lineTo(z, y)));
  c.closePath();
  const win = (pts: [number, number][]) => {
    const h = new three.Path();
    pts.forEach(([z, y], i) => (i === 0 ? h.moveTo(z, y) : h.lineTo(z, y)));
    h.closePath();
    c.holes.push(h);
  };
  win([
    [-0.72, 0.8],
    [-0.22, top - 0.07],
    [0.18, top - 0.07],
    [0.18, 0.8],
  ]);
  win(
    hatch
      ? [
          [0.3, 0.8],
          [0.3, top - 0.07],
          [1.55, top - 0.07],
          [1.78, 0.8],
        ]
      : [
          [0.3, 0.8],
          [0.3, top - 0.07],
          [0.68, top - 0.06],
          [1.1, 0.8],
        ],
  );
  const side = new three.ExtrudeGeometry(c, { depth: 0.05, bevelEnabled: false, curveSegments: 2 });
  side.rotateY(-Math.PI / 2);
  const res = { body, side, hatch, wz, roof: hatch ? [-0.25, 1.62] : [-0.25, 0.72], top };
  CARS.set(key, res);
  return res;
}
const CARS = new Map<string, { body: T.BufferGeometry; side: T.BufferGeometry; hatch: boolean; wz: number; roof: number[]; top: number }>();

/** A wrecked car, nose toward local -z, sat low on its rims: a sedan or a hatchback, burnt black or rusted out, its
 * glass gone but for a few shards, a door hanging open now and then, the seats burnt to their frames. */
function carWreck(three: Three, add: Add, L: Local, y: number, paint: number, v: number) {
  const burnt = v < 0.5;
  const hatch = hash(v, 3) < 0.4;
  const k = carShapes(three, hatch);
  const body = burnt ? mul(0x3a3029, 1 + hash(v, 5) * 0.3) : mul(paint, 0.75);
  const char = 0x241e1a;
  // (sunk a little on its flat tyres and rims, and leaning)
  const y0 = y + 0.12;
  const m = new three.Matrix4().makeRotationFromEuler(new three.Euler((hash(v, 9) - 0.5) * 0.04, L.yaw, (hash(v, 11) - 0.5) * 0.05, 'YXZ')).setPosition(L.x, y0, L.z);
  add.geo('rust', body, k.body, m);
  for (const s of [-1, 1]) add.geo('rust', body, k.side, m.clone().multiply(new three.Matrix4().makeTranslation(s * 0.78 + (s < 0 ? 0.05 : 0), 0, 0)));
  const Lc = { at: (part: Part, c: number, x: number, yy: number, z: number, hx: number, hy: number, hz: number, pitch = 0) => add.geo(part, c, unitBox(three), m.clone().multiply(new three.Matrix4().compose(new three.Vector3(x, yy, z), new three.Quaternion().setFromEuler(new three.Euler(pitch, 0, 0)), new three.Vector3(hx * 2, hy * 2, hz * 2)))) };
  // the roof, the bumpers, dark holes where the lamps were
  Lc.at('rust', body, 0, k.top + 0.02, (k.roof[0] + k.roof[1]) / 2, 0.8, 0.03, (k.roof[1] - k.roof[0]) / 2 + 0.04, 0.01);
  const nose = hatch ? -2.05 : -2.25;
  const tail = hatch ? 2.02 : 2.26;
  Lc.at('rust', mul(body, 0.7), 0, 0.26, nose - 0.04, 0.92, 0.09, 0.07);
  Lc.at('rust', mul(body, 0.7), 0, 0.26, tail + 0.04, 0.92, 0.09, 0.07);
  for (const s of [-1, 1]) {
    Lc.at('rust', 0x15120f, s * 0.6, 0.48, nose + 0.06, 0.18, 0.06, 0.04);
    Lc.at('rust', 0x15120f, s * 0.65, 0.55, tail - 0.05, 0.14, 0.06, 0.04);
  }
  // inside: the seats' frames, the dashboard
  Lc.at('rust', char, 0, 0.66, -0.62, 0.78, 0.07, 0.2);
  for (const z of [-0.05, 0.85]) {
    if (hatch && z > 0.5) continue;
    Lc.at('rust', char, 0, 0.42, z, 0.66, 0.05, 0.3);
    Lc.at('rust', char, 0, 0.72, z + 0.3, 0.66, 0.28, 0.05, -0.15);
  }
  // a door hanging open on the right, now and then
  if (hash(v, 7) < 0.4) Lc.at('rust', body, 1.25, 0.5, -0.45, 0.03, 0.3, 0.52);
  // the wheels: bare rims, or burnt tyres, sunk into the ground
  for (const s of [-1, 1]) for (const z of [-k.wz, k.wz]) for (let q = 0; q < 4; q++) Lc.at('rust', burnt ? 0x4a3a30 : 0x2a2624, s * 0.74, 0.14, z, 0.1, 0.3, 0.125, (q * Math.PI) / 4);
  // a shard of the windscreen
  Lc.at('glass', GLASS, -0.4, 0.84, -0.85, 0.16, 0.08, 0.004, -0.5);
}

let UNIT: T.BufferGeometry | null = null;
/** A unit box, made once. */
function unitBox(three: Three) {
  return (UNIT ??= new three.BoxGeometry(1, 1, 1));
}

/** A watchtower: see world.ts TOWER for its shape (the colliders). Wood, or steel for the desert. */
function tower(L: Local, y: number, steel: boolean, level: number) {
  const { h: PH, side: S, rise, run, steps } = TOWER;
  const d = 8.2;
  const pz0 = -d / 2;
  const pz1 = pz0 + S;
  const hs = S / 2;
  const top = y + PH;
  const part: Part = steel ? 'metal' : 'wood';
  const post = steel ? 0x5a5e52 : 0x6a5038;
  const board = steel ? 0x6a6e60 : 0x8a6a48;
  const g0 = y - 0.4;
  // legs, a ring of beams half way, braces crossing on three sides
  for (const lx of [-hs + 0.11, hs - 0.11]) for (const lz of [pz0 + 0.11, pz1 - 0.11]) L.at(part, post, lx, (g0 + top) / 2, lz, 0.11, (top - g0) / 2, 0.11);
  const mid = y + PH * 0.48;
  for (const s of [-1, 1]) {
    L.at(part, post, 0, mid, s < 0 ? pz0 + 0.11 : pz1 - 0.11, hs, 0.07, 0.06);
    L.at(part, post, s * (hs - 0.11), mid, (pz0 + pz1) / 2, 0.06, 0.07, hs);
  }
  if (level > 0)
    for (const [y0, y1] of [
      [y + 0.2, mid],
      [mid, top - 0.25],
    ]) {
      // front
      L.beam(part, post, [-hs + 0.11, y0, pz0 + 0.05], [hs - 0.11, y1, pz0 + 0.05], 0.08, 0.06);
      L.beam(part, post, [hs - 0.11, y0, pz0 + 0.05], [-hs + 0.11, y1, pz0 + 0.05], 0.08, 0.06);
      for (const s of [-1, 1]) {
        L.beam(part, post, [s * (hs - 0.05), y0, pz0 + 0.11], [s * (hs - 0.05), y1, pz1 - 0.11], 0.06, 0.08);
        L.beam(part, post, [s * (hs - 0.05), y0, pz1 - 0.11], [s * (hs - 0.05), y1, pz0 + 0.11], 0.06, 0.08);
      }
    }
  // the platform: joists and a deck of planks
  for (let k = 0; k < 9; k++) L.at(part, mul(board, 0.94 + hash(k, y) * 0.12), 0, top - 0.04, pz0 + 0.17 + k * ((S - 0.34) / 8), hs, 0.04, 0.155);
  L.at(part, post, 0, top - 0.14, pz0 + S / 2, hs, 0.06, S / 2 - 0.02);
  // the parapet: posts and three boards a side, leaving the gap over the stair
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    L.at(part, post, a * (hs - 0.06), top + 1.2, b < 0 ? pz0 + 0.06 : pz1 - 0.06, 0.06, 1.2, 0.06);
  for (let k = 0; k < 3; k++) {
    const yb = top + 0.18 + k * 0.33;
    L.at(part, board, 0, yb, pz0 + 0.04, hs, 0.13, 0.03);
    for (const s of [-1, 1]) L.at(part, board, s * (hs - 0.04), yb, (pz0 + pz1) / 2, 0.03, 0.13, hs - 0.06);
    for (const s of [-1, 1]) L.at(part, board, s * (hs + 0.5) / 2, yb, pz1 - 0.04, (hs - 0.5) / 2, 0.13, 0.03);
  }
  // a roof of sheet iron on the posts, falling to the back
  L.at('metal', steel ? 0x7a7e72 : 0x8a8478, 0, top + 2.41, (pz0 + pz1) / 2, hs + 0.3, 0.025, S / 2 + 0.35, 0, -0.06);
  // the stair: two strings, treads, a handrail
  const zs = pz1;
  const ze = pz1 + steps * run;
  for (const s of [-1, 1]) {
    L.beam(part, post, [s * 0.47, top - 0.05, zs], [s * 0.47, y - 0.05, ze], 0.06, 0.22);
    if (level > 0) {
      L.beam(part, post, [s * 0.5, top + 0.95, zs], [s * 0.5, y + 0.95, ze - 0.1], 0.05, 0.05);
      L.at(part, post, s * 0.5, y + 0.45, ze - 0.1, 0.03, 0.5, 0.03);
    }
  }
  for (let k = 0; k < steps; k++) L.at(part, board, 0, top - (k + 1) * rise - 0.03, zs + (k + 0.5) * run, 0.45, 0.03, run / 2 - 0.02);
}

/** A steel ladder up a wall (see world.ts Ladder): two rails standing off the face on brackets, rungs a foot apart, and
 * the rails carried on over the top and bent back over the edge to hold on by. */
function ladder(add: Add, l: Ladder) {
  const L = new Local(add, l.x, l.z, Math.atan2(l.nx, l.nz));
  const steel = 0x7e8482;
  const hw = l.hw;
  const y0 = l.y0 - 0.05;
  const top = l.y1 + 1.05;
  for (const s of [-1, 1]) {
    L.at('metal', steel, s * hw, (y0 + top) / 2, 0.2, 0.025, (top - y0) / 2, 0.03);
    L.at('metal', steel, s * hw, top - 0.03, -0.12, 0.025, 0.03, 0.35);
    for (let y = y0 + 1.2; y < l.y1; y += 2.4) L.at('metal', 0x5a5e5c, s * hw, y, 0.09, 0.02, 0.03, 0.09);
  }
  for (let y = y0 + 0.3; y < l.y1 + 0.02; y += 0.3) L.at('metal', steel, 0, y, 0.2, hw, 0.016, 0.016);
}

/** A lookout tower (see world.ts tryLookout for its colliders): four legs braced on every side, a deck of planks, a
 * parapet of boards open at the ladder, and a roof of sheet iron on corner posts, or a water tank on a ring of steel. */
function lookout(L: Local, lo: number, top: number, steel: boolean, tank: boolean, level: number) {
  const hs = LOOKOUT.side / 2;
  const part: Part = steel ? 'metal' : 'wood';
  const post = steel ? 0x5a5e52 : 0x6a5038;
  const board = steel ? 0x6a6e60 : 0x8a6a48;
  const g0 = lo - 0.3;
  for (const a of [-1, 1]) for (const b of [-1, 1]) L.at(part, post, a * (hs - 0.125), (g0 + top - 0.25) / 2, b * (hs - 0.125), 0.125, (top - 0.25 - g0) / 2, 0.125);
  // a ring of beams every couple of meters, and braces crossing between them
  const rings = Math.max(2, Math.round((top - lo) / 2.4));
  for (let k = 1; k < rings; k++) {
    const y = lo + ((top - lo) * k) / rings;
    for (const s of [-1, 1]) {
      L.at(part, post, 0, y, s * (hs - 0.1), hs - 0.1, 0.06, 0.05);
      L.at(part, post, s * (hs - 0.1), y, 0, 0.05, 0.06, hs - 0.1);
    }
  }
  if (level > 0)
    for (let k = 0; k < rings; k++) {
      const ya = lo + 0.2 + ((top - 0.45 - lo) * k) / rings;
      const yb = lo + 0.2 + ((top - 0.45 - lo) * (k + 1)) / rings;
      for (const s of [-1, 1]) {
        L.beam(part, post, [-hs + 0.12, ya, s * (hs - 0.06)], [hs - 0.12, yb, s * (hs - 0.06)], 0.07, 0.05);
        L.beam(part, post, [s * (hs - 0.06), ya, -hs + 0.12], [s * (hs - 0.06), yb, hs - 0.12], 0.05, 0.07);
      }
    }
  // the deck: joists and planks
  for (let k = 0; k < 9; k++) L.at(part, mul(board, 0.94 + hash(k, top) * 0.12), 0, top - 0.04, -hs + 0.18 + k * ((2 * hs - 0.36) / 8), hs, 0.04, 0.17);
  L.at(part, post, 0, top - 0.16, 0, hs, 0.09, hs - 0.02);
  // the parapet: corner posts and three boards a side, the front open over the ladder
  for (const a of [-1, 1]) for (const b of [-1, 1]) L.at(part, post, a * (hs - 0.05), top + 1.2, b * (hs - 0.05), 0.05, 1.2, 0.05);
  for (let k = 0; k < 3; k++) {
    const yb = top + 0.2 + k * 0.33;
    L.at(part, board, 0, yb, hs - 0.04, hs, 0.13, 0.03);
    for (const s of [-1, 1]) L.at(part, board, s * (hs - 0.04), yb, 0, 0.03, 0.13, hs - 0.06);
    for (const s of [-1, 1]) L.at(part, board, (s * (hs + 0.55)) / 2, yb, -hs + 0.04, (hs - 0.55) / 2, 0.13, 0.03);
  }
  const roof = top + LOOKOUT.roof;
  L.at('metal', steel ? 0x7a7e72 : 0x8a8478, 0, roof + 0.06, 0, hs + 0.3, 0.06, hs + 0.3, 0, 0.05);
  if (!tank) return;
  // a water tank on the roof: a drum of riveted steel bands with a conical cap
  const c = 0x7a8680;
  const n = level > 1 ? 16 : 10;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    L.at('metal', mul(c, 0.92 + hash(k, roof) * 0.12), Math.sin(a) * 1.18, roof + 1.5, Math.cos(a) * 1.18, (1.25 * Math.PI) / n + 0.02, 1.38, 0.04, a);
  }
  for (const y of [roof + 0.4, roof + 1.5, roof + 2.6]) L.at('metal', mul(c, 0.8), 0, y, 0, 1.24, 0.04, 1.24, Math.PI / 4);
  L.at('metal', mul(c, 1.05), 0, roof + 2.95, 0, 1.0, 0.08, 1.0, Math.PI / 8);
}

/** A ridge tent, 4.2 by 6 m: walls 1.7 high leaning out a little, a ridge at 3 m sagging between its poles, the door
 * flap tied up at the front, guy ropes and stakes. */
function tent(add: Add, three: Three, w: World, L: Local, y: number, color: number) {
  const g = new three.BufferGeometry();
  const pos: number[] = [];
  const col: number[] = [];
  const hw = 2.1;
  const hl = 3;
  const wall = 1.7;
  const ridge = 3.0;
  const N = 6;
  const quad = (a: number[], b: number[], c: number[], d: number[], k: number) => {
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    for (let i = 0; i < 6; i++) col.push(k, k, k);
  };
  for (let i = 0; i < N; i++) {
    const z0 = -hl + (i * 2 * hl) / N;
    const z1 = -hl + ((i + 1) * 2 * hl) / N;
    // the canvas sags between the poles at the ends and the middle
    const sag = (z: number) => 0.12 * Math.sin((((z + hl) / (2 * hl)) * 2) * Math.PI) ** 2;
    for (const s of [-1, 1]) {
      const e0 = [s * hw, y + wall - sag(z0) * 0.5, z0];
      const e1 = [s * hw, y + wall - sag(z1) * 0.5, z1];
      const r0 = [0, y + ridge - sag(z0), z0];
      const r1 = [0, y + ridge - sag(z1), z1];
      if (s < 0) quad(e0, e1, r1, r0, 1);
      else quad(r0, r1, e1, e0, 1);
      const b0 = [s * (hw + 0.12), y - 0.3, z0];
      const b1 = [s * (hw + 0.12), y - 0.3, z1];
      if (s < 0) quad(b0, b1, e1, e0, 0.86);
      else quad(e0, e1, b1, b0, 0.86);
    }
  }
  // the ends: a wall and a gable each, the front with its door
  for (const e of [-1, 1]) {
    const z = e * hl;
    const pts = [
      [-hw - 0.12, y - 0.3],
      [hw + 0.12, y - 0.3],
      [hw, y + wall],
      [0, y + ridge],
      [-hw, y + wall],
    ];
    for (const [a, b, c] of [
      [0, 1, 2],
      [0, 2, 4],
      [4, 2, 3],
    ]) {
      const p = [pts[a], pts[b], pts[c]].map(([x, yy]) => [x, yy, z]);
      if (e > 0) pos.push(...p[0], ...p[1], ...p[2]);
      else pos.push(...p[0], ...p[2], ...p[1]);
      for (let i = 0; i < 3; i++) col.push(0.92, 0.92, 0.92);
    }
  }
  g.setAttribute('position', new three.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new three.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const m = new three.Matrix4().makeRotationY(L.yaw).setPosition(L.x, 0, L.z);
  add.geo('canvas', color, g, m);
  g.dispose();
  // the door: a dark opening behind the tied up flap
  L.at('canvas', 0x1e1c16, 0, y + 0.85, -hl - 0.01, 0.55, 0.95, 0.006);
  L.at('canvas', mul(color, 0.9), 0, y + 1.84, -hl - 0.06, 0.6, 0.07, 0.07);
  // the ridge pole's ends and the uprights at the ends, guy ropes out to stakes
  L.at('wood', 0x5a4a38, 0, y + ridge + 0.02, 0, 0.04, 0.04, hl + 0.15);
  for (const z of [-hl - 0.06, hl + 0.06]) L.at('wood', 0x5a4a38, 0, y + ridge / 2, z, 0.035, ridge / 2, 0.035);
  for (const s of [-1, 1])
    for (let k = 0; k < 4; k++) {
      const z = -hl + 0.6 + k * ((2 * hl - 1.2) / 3);
      const [sx, sz] = L.xz(s * (hw + 1.4), z);
      const gy = heightAt(w.terrain, sx, sz);
      L.beam('canvas', 0xb8b098, [s * hw, y + wall - 0.05, z], [s * (hw + 1.4), gy + 0.05, z], 0.012, 0.012);
      L.at('wood', 0x5a4a38, s * (hw + 1.4), gy + 0.1, z, 0.02, 0.14, 0.02);
    }
}

/** A stack of pallets: 1.2 by 0.8 m, five top boards, three runners underneath and stringer blocks between. */
function pallets(L: Local, lx: number, y: number, n: number, v: number) {
  const c0 = v < 0.5 ? 0xb89a70 : 0x8f8672;
  for (let k = 0; k < n; k++) {
    const py = y + k * 0.144;
    const j = hash(lx, k, v);
    const Lp = new Local(L.add, ...L.xz(lx + (j - 0.5) * 0.05, (hash(k, lx) - 0.5) * 0.04), L.yaw + (j - 0.5) * 0.06);
    const c = mul(c0, 0.9 + hash(k, v) * 0.2);
    for (let b = 0; b < 5; b++) Lp.at('wood', c, -0.6 + 0.07 + b * 0.265, py + 0.133, 0, 0.0725, 0.011, 0.4);
    // (a runner and the blocks on it as one beam: in a stack only its sides show)
    for (const z of [-0.33, 0, 0.33]) Lp.at('wood', mul(c, 0.86), 0, py + 0.061, z, 0.6, 0.061, 0.05);
  }
}

/** The posts of a camo net, and the pickets of a razor wire coil. */
function netPoles(L: Local, y: number, h: number) {
  for (const [a, b] of [
    [-1, -1],
    [1, -1],
    [-1, 1],
    [1, 1],
  ])
    L.at('wood', 0x5a4a38, a * 2.9, y + h / 2 - 0.2, b * 2.9, 0.05, h / 2 + 0.2, 0.05);
}
function pickets(L: Local, y: number) {
  for (const x of [-2.2, 0, 2.2]) {
    L.at('metal', 0x4a4a42, x, y + 0.5, -0.38, 0.018, 0.55, 0.018);
    L.at('metal', 0x4a4a42, x, y + 0.5, 0.38, 0.018, 0.55, 0.018);
  }
}

/** The core of a sandbag emplacement, seen from afar (the bags themselves are drawn near): its arc in short boxes. */
function arcCore(L: Local, y: number, h: number, color: number) {
  const { r: R, t: T, a: A, cz } = BAGARC;
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = lerp(-A, A, (k + 0.5) / n);
    const seg = (2 * A * R) / n;
    L.at('sandbag', color, Math.sin(a) * R, (y - 0.3 + y + h - 0.04) / 2, cz - Math.cos(a) * R, seg / 2 + 0.02, (h + 0.26) / 2, T - 0.05, -a);
  }
}

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/** A street prop against a building's outside wall (see world.ts streetProps), its front out from the wall: the real
 * model, or where that didn't load, for those that collide, boxes where the collider stands. */
function street(L: Local, d: Dress) {
  const k = d.k as keyof typeof STREET;
  // (the round ones, and the small ones, turned a little or anyhow; the old rim leans on the wall)
  const turn = k === 'bins' || k === 'cask' ? 0.3 : k === 'bucket' || k === 'wcan' ? 2 : 0;
  if (L.has(k)) {
    L.prop(k, 0, k === 'rim' ? -0.05 : 0, d.y, (d.v - 0.5) * turn, false, k === 'rim' ? -0.2 : 0);
    return;
  }
  const [w, dd, h] = STREET[k];
  if (k === 'bench') {
    L.at('wood', 0x5a6a72, 0, d.y + 0.42, 0.04, w / 2, 0.03, dd / 2 - 0.06);
    L.at('wood', 0x5a6a72, 0, d.y + 0.68, -dd / 2 + 0.05, w / 2, 0.2, 0.03);
    for (const s of [-1, 1]) L.at('wood', 0x4a5258, s * (w / 2 - 0.06), d.y + 0.2, 0, 0.04, 0.2, dd / 2 - 0.08);
  } else if (k === 'ubox') L.at('metal', 0x7a8a84, 0, d.y + h / 2, 0, w / 2, h / 2, dd / 2);
  else if (k === 'bins') for (const s of [-1, 1]) L.at('metal', 0x8a8c86, s * w * 0.22, d.y + h / 2, 0, w * 0.2, h / 2, dd / 2 - 0.02);
  else if (k === 'cask') L.at('wood', 0x6a4a30, 0, d.y + h / 2, 0, w / 2 - 0.04, h / 2, dd / 2 - 0.04);
}

/** Every building's detail and every dressed prop, into the merged meshes. */
export function dressStatic(three: Three, add: Add, w: World, level: number) {
  // (on the lowest setting the buildings stay plain: only the props whose boxes stand for them are drawn)
  if (level > 0) {
    for (const b of w.bld) building(add, b, level, w.loot);
    roofTrim(add, w, level);
  }
  // (the ladders on every setting: they show where you can climb)
  for (const l of w.ladders) ladder(add, l);
  for (const d of w.dress) {
    const L = new Local(add, d.x, d.z, yawOf(d.rot));
    switch (d.k) {
      case 'container':
        container(three, add, L, d.y, d.s, d.c, d.v);
        break;
      case 'carwreck':
        carWreck(three, add, L, d.y, d.c, d.v);
        break;
      case 'tower':
        tower(L, d.y, d.c === 1, level);
        break;
      case 'lookout':
        lookout(L, d.y, d.y + d.s, d.c === 1, d.v === 1, level);
        break;
      case 'tent':
        tent(add, three, w, L, d.y, d.c);
        break;
      case 'pallets': {
        const a = d.s % 16;
        const b = Math.floor(d.s / 16);
        pallets(L, -0.65, d.y, a, d.v);
        if (b) pallets(L, 0.65, d.y, b, d.v);
        // and one leaning on the stack now and then
        if (d.v > 0.65) {
          const Lp = new Local(add, ...L.xz(-0.2, -0.62), L.yaw);
          Lp.at('wood', 0xa08a68, 0, d.y + 0.55, 0, 0.6, 0.55, 0.07, 0, -0.25);
        }
        break;
      }
      case 'net':
        netPoles(L, d.y, d.s);
        break;
      case 'razor':
        pickets(L, d.y);
        break;
      case 'bagarc':
        arcCore(L, d.y, d.s, d.c);
        break;
      default:
        street(L, d);
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// drawn near: the bags and the wire

/** One sandbag, about 0.62 by 0.16 by 0.38 m: a rounded slab pinched at its ends, UVs in meters for the burlap. */
function bagGeometry(three: Three, seg: number) {
  const g = roundBox(three, 1, 1, 1, 0.42, seg);
  const p = g.attributes.position as T.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) * 2;
    const y = p.getY(i) * 2;
    const z = p.getZ(i) * 2;
    const ends = Math.pow(Math.abs(x), 4);
    p.setXYZ(i, x * 0.31 * (1 - 0.05 * y * y), y * 0.08 * (1 - 0.45 * ends) * (1 - 0.2 * z * z), z * 0.19 * (1 - 0.28 * ends));
  }
  g.computeVertexNormals();
  const n = g.attributes.normal as T.BufferAttribute;
  const uv = g.attributes.uv as T.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const ax = Math.abs(n.getX(i));
    const ay = Math.abs(n.getY(i));
    const az = Math.abs(n.getZ(i));
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : az >= ax ? [p.getX(i), p.getY(i)] : [p.getZ(i), p.getY(i)];
    uv.setXY(i, u / 0.32, v / 0.32);
  }
  return g;
}

/** A coil of razor wire 5 m long and 0.9 m across, on y = 0 along local x: two crossing helices of thin ribbon. */
function coilGeometry(three: Three, seg: number) {
  const pos: number[] = [];
  const R = 0.44;
  const loops = 24;
  const len = 5;
  for (const ph of [0, Math.PI]) {
    const n = loops * seg;
    let prev: number[] | null = null;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const a = t * loops * Math.PI * 2 + ph;
      // (each loop leans, so the two helices cross like a sprung concertina)
      const x = -len / 2 + t * len + Math.sin(a) * 0.07;
      const y = R + Math.cos(a) * R * 0.98;
      const z = Math.sin(a) * R;
      const cur = [x, y, z];
      if (prev) {
        // a flat ribbon, edge on along the coil
        const ox = 0.012;
        pos.push(prev[0] - ox, prev[1], prev[2], cur[0] - ox, cur[1], cur[2], cur[0] + ox, cur[1], cur[2]);
        pos.push(prev[0] - ox, prev[1], prev[2], cur[0] + ox, cur[1], cur[2], prev[0] + ox, prev[1], prev[2]);
      }
      prev = cur;
    }
  }
  const g = new three.BufferGeometry();
  g.setAttribute('position', new three.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

export type Near = { group: T.Group; near(x: number, z: number): void; shown(): number; dispose(): void };

/**
 * The sandbags (every bag of every wall and emplacement, from the world's sandbag boxes and its emplacements) and the
 * razor wire coils, drawn instanced and only within reach of you, refilled from fixed lists as you move.
 */
export function nearDress(three: Three, w: World, shared: Shared, photos: { burlap?: ImageBitmap; 'burlap-n'?: ImageBitmap } | undefined, level: number, shadows: boolean): Near {
  const group = new three.Group();
  const made: { dispose(): void }[] = [];
  const bagRange = level >= 2 ? 80 : level === 1 ? 55 : 0;
  const wireRange = level >= 2 ? 95 : level === 1 ? 70 : 45;
  // the bags: x, y, z, yaw, length, height, depth, color (r, g, b), tilt
  const bags: number[] = [];
  const put = (x: number, y: number, z: number, yaw: number, l: number, h: number, d: number, c: [number, number, number], tilt: number) => bags.push(x, y, z, yaw, l, h, d, c[0], c[1], c[2], tilt);
  const tone = (c: number, x: number, y: number, z: number): [number, number, number] => {
    const [r, g, b] = lin(c);
    const k = 0.78 + hash(x, y, z) * 0.34;
    const dirt = hash(z, x, y) < 0.2 ? 0.82 : 1;
    return [r * k * dirt, g * k * dirt, b * k];
  };
  if (bagRange > 0) {
    for (const p of w.pieces) {
      if (p.part !== 'sandbag') continue;
      const along = p.x1 - p.x0 >= p.z1 - p.z0;
      const len = along ? p.x1 - p.x0 : p.z1 - p.z0;
      const dep = along ? p.z1 - p.z0 : p.x1 - p.x0;
      const cx = (p.x0 + p.x1) / 2;
      const cz = (p.z0 + p.z1) / 2;
      const g0 = Math.min(heightAt(w.terrain, p.x0, p.z0), heightAt(w.terrain, p.x1, p.z1), heightAt(w.terrain, cx, cz)) - 0.08;
      const y0 = Math.max(p.y0, g0);
      const layers = Math.max(1, Math.round((p.y1 - y0) / 0.16));
      const lh = (p.y1 - y0) / layers;
      const rows = Math.max(1, Math.round(dep / 0.4));
      const rd = dep / rows;
      const per = Math.max(1, Math.round(len / 0.62));
      const bl = len / per;
      for (let k = 0; k < layers; k++) {
        const off = k % 2 ? bl / 2 : 0;
        for (let r = 0; r < rows; r++) {
          const v = -dep / 2 + (r + 0.5) * rd;
          for (let i = -1; i < per; i++) {
            let a0 = -len / 2 + i * bl + off;
            let a1 = a0 + bl;
            a0 = Math.max(a0, -len / 2);
            a1 = Math.min(a1, len / 2);
            if (a1 - a0 < 0.12) continue;
            const u = (a0 + a1) / 2;
            const x = along ? cx + u : cx + v;
            const z = along ? cz + v : cz + u;
            const j = hash(x, z, k);
            put(x, y0 + (k + 0.5) * lh, z, (along ? 0 : Math.PI / 2) + (j - 0.5) * 0.12, (a1 - a0) * 1.04, lh * 1.12, rd * 1.06, tone(p.color, x, k, z), (hash(z, k, x) - 0.5) * 0.06);
          }
        }
      }
    }
    const { r: R, t: Tk, a: A, cz } = BAGARC;
    for (const d of w.dress) {
      if (d.k !== 'bagarc') continue;
      const yaw = yawOf(d.rot);
      const L = new Local(null as unknown as Add, d.x, d.z, yaw);
      const top = d.y + d.s;
      const y0 = d.y - 0.12;
      const layers = Math.max(1, Math.round((top - y0) / 0.16));
      const lh = (top - y0) / layers;
      for (let k = 0; k < layers; k++)
        for (const rr of [R - Tk / 2, R + Tk / 2]) {
          const n = Math.max(3, Math.round((2 * A * rr) / 0.62));
          const off = k % 2 ? 0.5 : 0;
          for (let i = 0; i < n; i++) {
            const a = -A + ((i + off) / n) * 2 * A;
            if (a > A) continue;
            const lx = Math.sin(a) * rr;
            const lz = cz - Math.cos(a) * rr;
            const [x, z] = L.xz(lx, lz);
            put(x, y0 + (k + 0.5) * lh, z, yaw - a, ((2 * A * rr) / n) * 1.05, lh * 1.12, Tk * 1.05, tone(d.c, x, k, z), (hash(x, k) - 0.5) * 0.06);
          }
        }
    }
  }
  const coils: number[] = [];
  for (const d of w.dress) if (d.k === 'razor') coils.push(d.x, d.y - 0.05, d.z, yawOf(d.rot));

  const kinds: { mesh: T.InstancedMesh; src: number[]; stride: number; range: number; set: (mesh: T.InstancedMesh, i: number, src: number[], k: number) => void }[] = [];
  const m4 = new three.Matrix4();
  const q = new three.Quaternion();
  const e = new three.Euler();
  const pos = new three.Vector3();
  const scl = new three.Vector3();
  const col = new three.Color();
  if (bags.length) {
    const geo = bagGeometry(three, level >= 2 ? 3 : 2);
    const tex = (img: ImageBitmap, srgb: boolean) => {
      const t = new three.CanvasTexture(img as unknown as HTMLCanvasElement);
      t.colorSpace = srgb ? three.SRGBColorSpace : ('' as T.ColorSpace);
      t.flipY = false;
      t.wrapS = t.wrapT = three.RepeatWrapping;
      t.anisotropy = 4;
      t.needsUpdate = true;
      return t;
    };
    const real = !!(photos?.burlap && photos['burlap-n']);
    const mat = new three.MeshStandardMaterial({ roughness: 1, metalness: 0, map: real ? tex(photos!.burlap!, true) : null, normalMap: real ? tex(photos!['burlap-n']!, false) : null });
    mat.normalScale.set(0.8, 0.8);
    patch(mat, shared, {
      key: real ? 'dz-bag-photo' : 'dz-bag',
      fragDecl: 'float dzMapRough = 1.0;',
      albedo: real ? `#include <map_fragment>\ndzMapRough = sampledDiffuseColor.a; diffuseColor.a = 1.0;` : '#include <map_fragment>',
      rough: 'float roughnessFactor = clamp(roughness * dzMapRough, 0.4, 1.0);',
    });
    const mesh = new three.InstancedMesh(geo, mat, Math.min(4000, bags.length / 11));
    mesh.count = 0;
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    made.push(geo, mat);
    kinds.push({
      mesh,
      src: bags,
      stride: 11,
      range: bagRange,
      set(mesh, i, s, k) {
        pos.set(s[k], s[k + 1], s[k + 2]);
        q.setFromEuler(e.set(s[k + 10], s[k + 3], 0, 'YXZ'));
        scl.set(s[k + 4] / 0.62, s[k + 5] / 0.16, s[k + 6] / 0.38);
        mesh.setMatrixAt(i, m4.compose(pos, q, scl));
        mesh.setColorAt(i, col.setRGB(s[k + 7], s[k + 8], s[k + 9]));
      },
    });
  }
  if (coils.length) {
    const geo = coilGeometry(three, level >= 1 ? 14 : 8);
    const mat = new three.MeshStandardMaterial({ color: new three.Color(...lin(0x9a9a94)), roughness: 0.42, metalness: 0.75, side: DOUBLE });
    patch(mat, shared, { key: 'dz-wire' });
    const mesh = new three.InstancedMesh(geo, mat, coils.length / 4);
    mesh.count = 0;
    mesh.castShadow = false;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    group.add(mesh);
    made.push(geo, mat);
    kinds.push({
      mesh,
      src: coils,
      stride: 4,
      range: wireRange,
      set(mesh, i, s, k) {
        pos.set(s[k], s[k + 1], s[k + 2]);
        q.setFromAxisAngle(new three.Vector3(0, 1, 0), s[k + 3]);
        mesh.setMatrixAt(i, m4.compose(pos, q, scl.set(1, 1, 1)));
      },
    });
  }
  let lastX = Infinity;
  let lastZ = Infinity;
  return {
    group,
    near(x, z) {
      if (Math.hypot(x - lastX, z - lastZ) < 5) return;
      lastX = x;
      lastZ = z;
      for (const k of kinds) {
        const max = k.mesh.instanceMatrix.count;
        const r2 = k.range * k.range;
        let n = 0;
        for (let i = 0; i < k.src.length && n < max; i += k.stride) {
          const dx = k.src[i] - x;
          const dz = k.src[i + 2] - z;
          if (dx * dx + dz * dz > r2) continue;
          k.set(k.mesh, n++, k.src, i);
        }
        k.mesh.count = n;
        k.mesh.instanceMatrix.needsUpdate = true;
        if (k.mesh.instanceColor) k.mesh.instanceColor.needsUpdate = true;
      }
    },
    shown: () => kinds.reduce((n, k) => n + k.mesh.count, 0),
    dispose() {
      for (const d of made) d.dispose();
    },
  };
}

// ---------------------------------------------------------------------------------------------------------------
// camo nets

/** The garnish of a camo net, painted once: leaf shaped scraps in three colors on a mesh with holes (alpha cut). */
function netTexture(three: Three, base: number) {
  const S = 256;
  const c = canvas(S, S);
  const g = c.getContext('2d')!;
  g.clearRect(0, 0, S, S);
  const r = mulberry32(base);
  const [br, bg, bb] = [(base >> 16) & 255, (base >> 8) & 255, base & 255];
  const shades = [1, 0.72, 1.25, 0.55];
  for (let k = 0; k < 520; k++) {
    const sh = shades[Math.floor(r() * shades.length)];
    g.fillStyle = `rgb(${Math.min(255, br * sh)},${Math.min(255, bg * sh)},${Math.min(255, bb * sh * 0.95)})`;
    const x = r() * S;
    const y = r() * S;
    const a = r() * Math.PI;
    const l = 6 + r() * 14;
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    // a scrap with a notched edge
    g.moveTo(-l, 0);
    g.quadraticCurveTo(-l * 0.3, -l * 0.45, 0, -l * 0.2);
    g.quadraticCurveTo(l * 0.4, -l * 0.5, l, 0);
    g.quadraticCurveTo(l * 0.3, l * 0.5, 0, l * 0.25);
    g.quadraticCurveTo(-l * 0.4, l * 0.4, -l, 0);
    g.fill();
    g.restore();
    // (the same scrap again across each edge, so the texture tiles)
    if (x < 20 || y < 20 || x > S - 20 || y > S - 20) {
      for (const [ox, oy] of [
        [S, 0],
        [-S, 0],
        [0, S],
        [0, -S],
      ]) {
        g.save();
        g.translate(x + ox, y + oy);
        g.rotate(a);
        g.fillRect(-l * 0.6, -l * 0.25, l * 1.2, l * 0.5);
        g.restore();
      }
    }
  }
  // the net's cords
  g.strokeStyle = 'rgba(40,40,34,1)';
  g.lineWidth = 1.2;
  for (let i = 0; i <= 8; i++) {
    g.beginPath();
    g.moveTo((i * S) / 8, 0);
    g.lineTo((i * S) / 8 + S / 8, S);
    g.moveTo(0, (i * S) / 8);
    g.lineTo(S, (i * S) / 8 + S / 8);
    g.stroke();
  }
  const t = new three.CanvasTexture(c);
  t.colorSpace = three.SRGBColorSpace;
  t.wrapS = t.wrapT = three.RepeatWrapping;
  t.anisotropy = 4;
  return t;
}

/** Every camo net: a sheet sagging between its four poles and hanging down at two sides, one mesh for all. */
export function camoNets(three: Three, w: World, shared: Shared, shadows: boolean) {
  const nets = w.dress.filter((d) => d.k === 'net');
  const group = new three.Group();
  if (!nets.length) return group;
  const pos: number[] = [];
  const uv: number[] = [];
  const N = 10;
  for (const d of nets) {
    const L = new Local(null as unknown as Add, d.x, d.z, yawOf(d.rot));
    const top = d.y + d.s;
    const drop = [hash(d.x, 1) < 0.5 ? 1.2 : 0.2, hash(d.x, 2) < 0.5 ? 1.2 : 0.3];
    const at = (i: number, j: number) => {
      const u = i / N;
      const v = j / N;
      const lx = (u - 0.5) * 7.2;
      const lz = (v - 0.5) * 7.2;
      // sags between the poles, hangs down past them at the edges
      let y = top - 0.55 * Math.sin(u * Math.PI) * Math.sin(v * Math.PI) - 0.15 * (Math.sin(u * Math.PI * 2) ** 2 + Math.sin(v * Math.PI * 2) ** 2);
      const ex = Math.max(0, Math.abs(lx) - 2.9);
      const ez = Math.max(0, Math.abs(lz) - 2.9);
      y -= ex * (lx < 0 ? drop[0] : 0.4) * 2.2 + ez * (lz < 0 ? drop[1] : 0.4) * 2.2;
      y += (hash(d.x + i, d.z + j) - 0.5) * 0.12;
      const [x, z] = L.xz(lx, lz);
      return [x, y, z];
    };
    for (let i = 0; i < N; i++)
      for (let j = 0; j < N; j++) {
        const a = at(i, j);
        const b = at(i + 1, j);
        const c = at(i + 1, j + 1);
        const e = at(i, j + 1);
        pos.push(...a, ...b, ...c, ...a, ...c, ...e);
        const U = (i: number) => (i / N) * 4.5;
        uv.push(U(i), U(j), U(i + 1), U(j), U(i + 1), U(j + 1), U(i), U(j), U(i + 1), U(j + 1), U(i), U(j + 1));
      }
  }
  const g = new three.BufferGeometry();
  g.setAttribute('position', new three.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new three.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  g.computeBoundingSphere();
  const mat = new three.MeshStandardMaterial({ map: netTexture(three, nets[0].c), alphaTest: 0.5, side: DOUBLE, roughness: 0.95, metalness: 0 });
  patch(mat, shared, { key: 'dz-net' });
  const mesh = new three.Mesh(g, mat);
  mesh.castShadow = shadows;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  group.add(mesh);
  return group;
}
