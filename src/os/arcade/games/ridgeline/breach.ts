// The breach arenas, each drawn as a plan in its own frame: u runs from the attack's spawn toward the defense's, v
// across. A plan gives the lanes (corridors to walk, which also lay the dirt roads), the open ground of the places on
// them (the two sites, the middle, the spawns and a few smaller spots) and what each place is: a farm, a village
// square, a quarry, a walled compound, a pump station, a radio station, a lumber yard, a harbor and so on. Drafting a
// place lays out its buildings, walls, cover and structures round its open ground, clear of the lanes. Then the land
// is sculpted round all of it: whatever is not a lane or a place rises in steep banks into wooded hills, ridges and
// mesas (or falls away into the sea), which keeps the lanes apart, hides one from the next and bounds the map. Pure
// data and deterministic, so every machine in an online match builds the same arena.
import type { MapDef, MapId } from './maps.ts';
import { Noise2, clamp, lerp, mulberry32, smoothstep, type Rng } from './noise.ts';
import { CELL, T_HALF, T_RES, type Terrain } from './terrain.ts';
import type { ModelKey, Part, PropKind } from './world.ts';

/** A point in a plan's own frame: u toward the defense, v across. */
export type P = [number, number];
/** A corridor to walk: a polyline and its half width. */
export type Lane = { pts: P[]; w: number };
/** Open ground round a place: a square (half side r) or a disc, sunk by `dip` meters at its middle, or lying `wet`
 * meters under the water line (ice to walk on, or shallows to wade). */
export type Plaza = { at: P; r: number; round?: boolean; dip?: number; wet?: number; shore?: number };
export type PlaceKind = 'farm' | 'square' | 'quarry' | 'compound' | 'pumps' | 'gate' | 'station' | 'lumber' | 'pond' | 'dock' | 'wreck' | 'hamlet' | 'ruins';
/** A place on a plaza (by index): what it is and its name on the map. */
export type Place = { kind: PlaceKind; plaza: number; name: string; site: number };
export type Cover = PropKind | 'logs';

export type Plan = {
  /** Quarter turns from the plan's frame to the world's, and whether v is mirrored first. */
  turn: number;
  flip: boolean;
  atk: P;
  def: P;
  sites: [P, P];
  mid: P;
  lanes: Lane[];
  plazas: Plaza[];
  places: Place[];
  /** The open ground: its height, how much of the land's own rise and fall it keeps, and a tilt per meter along u, v. */
  ground: { level: number; k: number; tilt: P };
  /** The ground off the lanes: its rise right next to them (lo to hi, by noise), how far the bank runs, how much more
   * it rises far from any lane (the hills round the map), and steps of this height (mesas), if any. */
  banks: { lo: number; hi: number; ramp: number; edge: number; tiers?: number };
  /** Coast: between u0 and u1, past v (on the plan's negative v side), the ground runs down into the sea. */
  sea?: { v: number; u0: number; u1: number };
  /** Cover dropped along the lanes. */
  cover: Cover[];
  /** Trees on the hills, 0 to 1. */
  woods: number;
};

const SPAWN_PLAZA = 32;

export const PLANS: Record<MapId, Plan> = {
  // farmland: a farmyard (A) and a village square (B) either side of an old quarry, joined by sunken lanes between
  // wooded hills
  vale: {
    turn: 1,
    flip: false,
    atk: [-86, 0],
    def: [56, 2],
    sites: [
      [13, -42],
      [15, 44],
    ],
    mid: [-20, 2],
    lanes: [
      { pts: [[-86, 0], [-62, -36], [-30, -64], [4, -64], [13, -42]], w: 7 },
      { pts: [[-86, 0], [-56, 2], [-20, 2], [10, 6], [36, 4], [56, 2]], w: 7 },
      { pts: [[-20, 2], [-2, -12], [2, -32], [13, -42]], w: 5 },
      { pts: [[-20, 2], [-2, 14], [4, 34], [15, 44]], w: 5 },
      { pts: [[-86, 0], [-60, 38], [-30, 64], [4, 66], [15, 44]], w: 7 },
      { pts: [[56, 2], [50, -22], [13, -42]], w: 7 },
      { pts: [[56, 2], [50, 24], [15, 44]], w: 7 },
      { pts: [[-44, -52], [-40, -24], [-40, 2]], w: 4.5 },
    ],
    plazas: [
      { at: [13, -42], r: 22 },
      { at: [15, 44], r: 21 },
      { at: [-20, 2], r: 20, round: true, dip: 4.5 },
      { at: [-30, 64], r: 13, round: true },
      { at: [-40, -26], r: 10, round: true },
    ],
    places: [
      { kind: 'farm', plaza: 0, name: 'Hollow Farm', site: 0 },
      { kind: 'square', plaza: 1, name: 'Millbrook', site: 1 },
      { kind: 'quarry', plaza: 2, name: 'Old Quarry', site: -1 },
      { kind: 'hamlet', plaza: 3, name: 'Pine Rest', site: -1 },
      { kind: 'ruins', plaza: 4, name: 'Cobb Mill', site: -1 },
    ],
    ground: { level: 9, k: 0.5, tilt: [0.015, 0] },
    banks: { lo: 6, hi: 10, ramp: 4, edge: 16 },
    cover: ['crates', 'pile', 'fence', 'sandbags', 'wire', 'barrier', 'hesco', 'pile'],
    woods: 1,
  },
  // canyon country: a walled adobe town (A) deep on the defense's side, a pump station (B) out on an open wash, and a
  // gate into the middle; the lanes are canyons between mesas
  mesa: {
    turn: 0,
    flip: true,
    atk: [-86, 10],
    def: [70, 10],
    sites: [
      [26, -46],
      [8, 64],
    ],
    mid: [-22, 8],
    lanes: [
      { pts: [[-86, 10], [-62, -26], [-30, -46], [0, -56], [26, -46]], w: 6 },
      { pts: [[-86, 10], [-58, 10], [-22, 8], [12, 4], [40, 8], [70, 10]], w: 6 },
      { pts: [[12, 4], [18, -28], [26, -46]], w: 5 },
      { pts: [[-86, 10], [-60, 40], [-28, 66], [8, 64]], w: 9 },
      { pts: [[-22, 8], [-8, 34], [8, 64]], w: 5 },
      { pts: [[-30, -46], [-26, -14], [-22, 8]], w: 4.5 },
      { pts: [[70, 10], [50, -22], [26, -46]], w: 7 },
      { pts: [[70, 10], [44, 40], [8, 64]], w: 7 },
    ],
    plazas: [
      { at: [26, -46], r: 27 },
      { at: [8, 64], r: 23 },
      { at: [-22, 8], r: 14, round: true },
      { at: [-28, 66], r: 13, round: true },
      { at: [40, 8], r: 11, round: true },
    ],
    places: [
      { kind: 'compound', plaza: 0, name: 'Copper Town', site: 0 },
      { kind: 'pumps', plaza: 1, name: 'Pump Station', site: 1 },
      { kind: 'gate', plaza: 2, name: 'Red Gate', site: -1 },
      { kind: 'hamlet', plaza: 3, name: 'Sunken Ranch', site: -1 },
      { kind: 'ruins', plaza: 4, name: 'Rattler', site: -1 },
    ],
    ground: { level: 8, k: 0.3, tilt: [0, 0] },
    banks: { lo: 9, hi: 16, ramp: 3, edge: 22, tiers: 7 },
    cover: ['barrier', 'hesco', 'pile', 'dumpsters', 'crates', 'sandbags', 'wire', 'barrier'],
    woods: 0.12,
  },
  // snowbound: a radio station (A) and a lumber yard (B), with a frozen pond in the middle where the lanes meet, and a
  // narrow forest trail and a ravine round the sides
  frost: {
    turn: 3,
    flip: false,
    atk: [-86, 0],
    def: [70, -4],
    sites: [
      [14, -46],
      [22, 44],
    ],
    mid: [-14, -4],
    lanes: [
      { pts: [[-86, 0], [-64, -30], [-48, -62], [-16, -74], [14, -46]], w: 5 },
      { pts: [[-86, 0], [-52, 0], [-14, -4], [18, -2], [46, -2], [70, -4]], w: 6 },
      { pts: [[-14, -4], [2, -20], [4, -36], [14, -46]], w: 5 },
      { pts: [[-86, 0], [-62, 34], [-30, 58], [0, 64], [22, 44]], w: 5 },
      { pts: [[-14, -4], [2, 16], [6, 34], [22, 44]], w: 4.5 },
      { pts: [[-30, 58], [-34, 26], [-14, -4]], w: 4.5 },
      { pts: [[70, -4], [56, -28], [14, -46]], w: 6 },
      { pts: [[70, -4], [58, 24], [22, 44]], w: 6 },
    ],
    plazas: [
      { at: [14, -46], r: 21 },
      { at: [22, 44], r: 21 },
      { at: [-14, -4], r: 24, round: true, wet: 1.6 },
      { at: [-48, -62], r: 12, round: true },
      { at: [-30, 58], r: 13, round: true },
    ],
    places: [
      { kind: 'station', plaza: 0, name: 'Ridge Station', site: 0 },
      { kind: 'lumber', plaza: 1, name: 'Lumber Yard', site: 1 },
      { kind: 'pond', plaza: 2, name: 'Ice Camp', site: -1 },
      { kind: 'ruins', plaza: 3, name: 'Summit Post', site: -1 },
      { kind: 'hamlet', plaza: 4, name: 'Elk Hollow', site: -1 },
    ],
    ground: { level: 7.5, k: 0.45, tilt: [0.01, 0] },
    banks: { lo: 6, hi: 11, ramp: 3.5, edge: 24 },
    cover: ['sandbags', 'logs', 'hesco', 'crates', 'logs', 'barrier', 'pile', 'wire'],
    woods: 1,
  },
  // islands: a harbor on the coast (A) with piers out into the bay, a village (B) up in the palms, and a wreck in a
  // lagoon in the middle that you wade through
  isles: {
    turn: 2,
    flip: false,
    atk: [-86, -6],
    def: [56, 4],
    sites: [
      [15, -40],
      [11, 44],
    ],
    mid: [-16, 4],
    lanes: [
      { pts: [[-86, -6], [-64, -40], [-34, -64], [0, -66], [15, -40]], w: 6 },
      { pts: [[-86, -6], [-54, 0], [-16, 4], [12, 6], [36, 5], [56, 4]], w: 5.5 },
      { pts: [[12, 6], [10, -18], [15, -40]], w: 4.5 },
      { pts: [[-86, -6], [-62, 32], [-36, 58], [-4, 60], [11, 44]], w: 5 },
      { pts: [[-16, 4], [0, 18], [2, 36], [11, 44]], w: 4.5 },
      { pts: [[-34, -64], [-30, -30], [-16, 4]], w: 4.5 },
      { pts: [[56, 4], [50, -16], [15, -40]], w: 5.5 },
      { pts: [[56, 4], [48, 26], [11, 44]], w: 5.5 },
    ],
    plazas: [
      { at: [15, -40], r: 23 },
      { at: [11, 44], r: 21 },
      // (a wide lagoon with a narrow beach round it, so the wreck lies out in the water)
      { at: [-16, 4], r: 22, round: true, wet: 0.55, shore: 9 },
      { at: [-36, 58], r: 13, round: true },
      { at: [-31, -32], r: 10, round: true },
    ],
    places: [
      { kind: 'dock', plaza: 0, name: 'Harbor', site: 0 },
      { kind: 'square', plaza: 1, name: 'Coral Village', site: 1 },
      { kind: 'wreck', plaza: 2, name: 'Shipwreck', site: -1 },
      { kind: 'hamlet', plaza: 3, name: 'Mango Hill', site: -1 },
      { kind: 'ruins', plaza: 4, name: 'Turtle Cove', site: -1 },
    ],
    ground: { level: 2.8, k: 0.25, tilt: [0, 0.035] },
    banks: { lo: 7, hi: 10, ramp: 4, edge: 14 },
    sea: { v: -80, u0: -108, u1: 108 },
    cover: ['crates', 'pile', 'barrier', 'dumpsters', 'sandbags', 'fence', 'hesco', 'crates'],
    woods: 0.8,
  },
};

/** A plan's point in the world. */
export function toWorld(plan: Plan, u: number, v: number): P {
  const w = plan.flip ? -v : v;
  switch (plan.turn & 3) {
    case 0:
      return [u, w];
    case 1:
      return [-w, u];
    case 2:
      return [-u, -w];
    default:
      return [w, -u];
  }
}
/** And back. */
export function toPlan(plan: Plan, x: number, z: number): P {
  let u: number;
  let w: number;
  switch (plan.turn & 3) {
    case 0:
      [u, w] = [x, z];
      break;
    case 1:
      [u, w] = [z, -x];
      break;
    case 2:
      [u, w] = [-x, -z];
      break;
    default:
      [u, w] = [-z, x];
  }
  return [u, plan.flip ? -w : w];
}

// ---------------------------------------------------------------------------------------------------------------
// drafting the places

export type BKind = 'house' | 'barn' | 'shed' | 'ruin';
export type Struct = 'silo' | 'tank' | 'mast' | 'crane' | 'pier' | 'boat' | 'logs' | 'well' | 'stall' | 'gate' | 'crusher' | 'wreck' | 'hut' | 'pipes' | 'rubble';
/** Footprints of the structures: across and along their facing (a pier and a pipe run take their length from s). */
export const STRUCT_SIZE: Record<Struct, P> = {
  silo: [4, 4],
  tank: [6.4, 6.4],
  mast: [2.2, 2.2],
  crane: [11, 3],
  pier: [4, 1],
  boat: [3, 8],
  logs: [6, 2.4],
  well: [2.2, 2.2],
  stall: [3.4, 2.2],
  gate: [13, 4],
  crusher: [7, 7],
  wreck: [6, 18],
  hut: [2.8, 2.8],
  pipes: [1, 1.2],
  rubble: [5, 5],
};

/** Something a place puts down, in the plan's frame; `face` is the way its front looks. */
export type Item =
  | { t: 'bld'; kind: BKind; at: P; w: number; d: number; face: P }
  | { t: 'wall'; a: P; b: P; h: number; part: Part; color: number }
  | { t: 'prop'; kind: PropKind; at: P; face: P; key?: ModelKey; units?: number }
  | { t: 'deco'; key: ModelKey; at: P }
  | { t: 'struct'; what: Struct; at: P; face: P; s: number; tall?: number };

/** A plan rectangle. */
type Rect = { u0: number; v0: number; u1: number; v1: number };

/** Half sizes along u and v of something `w` across and `d` along its facing. */
const halfOf = (w: number, d: number, face: P): P => (Math.abs(face[0]) > 0.5 ? [d / 2, w / 2] : [w / 2, d / 2]);
export function itemRect(it: Item): Rect {
  if (it.t === 'wall') return { u0: Math.min(it.a[0], it.b[0]) - 0.25, v0: Math.min(it.a[1], it.b[1]) - 0.25, u1: Math.max(it.a[0], it.b[0]) + 0.25, v1: Math.max(it.a[1], it.b[1]) + 0.25 };
  let hu = 0.5;
  let hv = 0.5;
  let cu = it.at[0];
  let cv = it.at[1];
  if (it.t === 'bld') [hu, hv] = halfOf(it.w, it.d, it.face);
  else if (it.t === 'struct') {
    const [w, d] = STRUCT_SIZE[it.what];
    const along = it.what === 'pier' ? it.s : d;
    const across = it.what === 'pipes' ? it.s : w;
    [hu, hv] = halfOf(across, along, it.face);
    // a pier runs out from its foot
    if (it.what === 'pier') {
      cu += (it.face[0] * it.s) / 2;
      cv += (it.face[1] * it.s) / 2;
    }
  } else if (it.t === 'prop') [hu, hv] = [1.5, 1.5];
  return { u0: cu - hu, v0: cv - hv, u1: cu + hu, v1: cv + hv };
}

function segDist(px: number, pz: number, ax: number, az: number, bx: number, bz: number) {
  const vx = bx - ax;
  const vz = bz - az;
  const l2 = vx * vx + vz * vz || 1;
  const k = clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1);
  return Math.hypot(px - ax - vx * k, pz - az - vz * k);
}

/** How far a plan point is outside every lane's corridor (negative inside one). */
export function laneGap(plan: Plan, u: number, v: number) {
  let best = Infinity;
  for (const l of plan.lanes)
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const [a, b] = [l.pts[i], l.pts[i + 1]];
      best = Math.min(best, segDist(u, v, a[0], a[1], b[0], b[1]) - l.w);
    }
  return best;
}

/** The smallest lane gap over a rectangle (its corners, edge middles and middle). */
function rectGap(plan: Plan, r: Rect) {
  let best = Infinity;
  for (const a of [0, 0.5, 1]) for (const b of [0, 0.5, 1]) best = Math.min(best, laneGap(plan, lerp(r.u0, r.u1, a), lerp(r.v0, r.v1, b)));
  return best;
}
const hit = (a: Rect, b: Rect, gap: number) => a.u0 - gap < b.u1 && a.u1 + gap > b.u0 && a.v0 - gap < b.v1 && a.v1 + gap > b.v0;

const STYLE_WALL: Record<string, { part: Part; color: number }> = {
  farm: { part: 'wall', color: 0xb8b0a0 },
  adobe: { part: 'wall', color: 0xc8996a },
  cabin: { part: 'wood', color: 0x6b4a33 },
  tropic: { part: 'wall', color: 0xe8e0cc },
};

/** Lays out one place: its buildings round the edge of its plaza, walls or fences between them (open where a lane
 * runs through), and what stands inside. */
class Draft {
  items: Item[] = [];
  rects: Rect[] = [];
  plan: Plan;
  pz: Plaza;
  r: Rng;
  keep: Rect[];
  constructor(plan: Plan, pz: Plaza, r: Rng, keep: Rect[]) {
    this.plan = plan;
    this.pz = pz;
    this.r = r;
    this.keep = keep;
  }
  get cu() {
    return this.pz.at[0];
  }
  get cv() {
    return this.pz.at[1];
  }
  /** Can a footprint go here: clear of the lanes by `gap` (0 lets it touch a corridor), of what is already down, of
   * the site pads and the spawns? */
  fits(r: Rect, gap = 1.2, room = 2.5) {
    if (rectGap(this.plan, r) < gap) return false;
    for (const q of this.rects) if (hit(r, q, room)) return false;
    for (const q of this.keep) if (hit(r, q, 0)) return false;
    return true;
  }
  add(it: Item) {
    this.items.push(it);
    if (it.t !== 'deco' && it.t !== 'prop') this.rects.push(itemRect(it));
  }
  /** A building straddling the plaza's edge at a side point, its front to the middle. */
  edgeBuilding(kind: BKind, w: number, d: number, side: number, s: number, inset: number, R = this.pz.r) {
    const [nu, nv] = SIDES[side];
    const along: P = [Math.abs(nv), Math.abs(nu)];
    // (an inset of 0 stands it just inside the edge, its back to the wall)
    const off = inset ? R + d / 2 - inset : R - d / 2 - 0.6;
    const at: P = [this.cu - nu * off + along[0] * s, this.cv - nv * off + along[1] * s];
    const it: Item = { t: 'bld', kind, at, w, d, face: [nu, nv] };
    if (!this.fits(itemRect(it))) return false;
    this.add(it);
    return true;
  }
  struct(what: Struct, du: number, dv: number, face: P, s = 1, gap = 1, tall?: number) {
    const it: Item = { t: 'struct', what, at: [this.cu + du, this.cv + dv], face, s, tall };
    if (!this.fits(itemRect(it), gap, 1.5)) return false;
    this.add(it);
    return true;
  }
  prop(kind: PropKind, du: number, dv: number, face: P = [0, 1], key?: ModelKey) {
    const at: P = [this.cu + du, this.cv + dv];
    if (laneGap(this.plan, at[0], at[1]) < -1.5) return false;
    for (const q of this.rects) if (at[0] > q.u0 - 2 && at[0] < q.u1 + 2 && at[1] > q.v0 - 2 && at[1] < q.v1 + 2) return false;
    this.items.push({ t: 'prop', kind, at, face, key });
    return true;
  }
  deco(key: ModelKey, du: number, dv: number) {
    this.items.push({ t: 'deco', key, at: [this.cu + du, this.cv + dv] });
  }
  /** Buildings round the edge (of the plaza, or of a square `R` from its middle), each on the side and at the spot
   * (from a few tried) where it fits first. */
  ring(list: [BKind, number, number][], inset = 1.5, R = this.pz.r, sides = [0, 1, 2, 3]) {
    const r = this.r;
    const start = Math.floor(r() * 4);
    let k = 0;
    for (const [kind, w, d] of list) {
      let done = false;
      for (let n = 0; n < 4 && !done; n++) {
        const side = (start + k + n) % 4;
        if (!sides.includes(side)) continue;
        const reach = R - w / 2 - 1;
        for (const f of [0, 0.55, -0.55, 0.85, -0.85, 0.3, -0.3]) {
          if (this.edgeBuilding(kind, w, d, side, f * reach + (r() - 0.5) * 2, inset, R)) {
            done = true;
            break;
          }
        }
      }
      k++;
    }
  }
  /** Walls (or a line of cover) along the plaza's sides where nothing else stands and no lane runs through. */
  edges(make: (a: P, b: P, side: number) => void, step = 2, R = this.pz.r) {
    for (let side = 0; side < 4; side++) {
      const [nu, nv] = SIDES[side];
      const along: P = [Math.abs(nv), Math.abs(nu)];
      const at = (s: number): P => [this.cu - nu * R + along[0] * s, this.cv - nv * R + along[1] * s];
      let run: number | null = null;
      const close = (s: number) => {
        if (run !== null && s - run >= 2) make(at(run), at(s), side);
        run = null;
      };
      for (let s = -R; s < R; s += step) {
        const [mu, mv] = at(s + step / 2);
        // (well short of a building: a wall ending a hand from one leaves a slit nobody fits through, and buildings
        // move up to a meter when they are set on the bots' path grid)
        const blocked = laneGap(this.plan, mu, mv) < 1 || this.rects.some((q) => mu > q.u0 - 3 && mu < q.u1 + 3 && mv > q.v0 - 3 && mv < q.v1 + 3);
        if (blocked) close(s);
        else if (run === null) run = s;
      }
      close(R);
    }
  }
  wallRun(a: P, b: P, h: number, part: Part, color: number) {
    this.items.push({ t: 'wall', a, b, h, part, color });
    this.rects.push(itemRect(this.items[this.items.length - 1]));
  }
  /** Cover (fences, a hedge of crates) along a run, a piece every `every` meters. */
  coverRun(a: P, b: P, kind: PropKind, every: number, key?: ModelKey) {
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.floor(len / every);
    const du = (b[0] - a[0]) / (len || 1);
    const dv = (b[1] - a[1]) / (len || 1);
    for (let i = 0; i < n; i++) {
      const s = (i + 0.5) * (len / n);
      this.items.push({ t: 'prop', kind, at: [a[0] + du * s, a[1] + dv * s], face: [du, dv], key });
    }
  }
  /** Spots inside the plaza, by angle and distance from the middle, to try things at. */
  spots(n: number, r0: number, r1: number): P[] {
    const out: P[] = [];
    const a0 = this.r() * Math.PI * 2;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (this.r() - 0.5) * 0.4;
      const d = lerp(r0, r1, this.r());
      out.push([Math.cos(a) * d, Math.sin(a) * d]);
    }
    return out;
  }
  /** Tries a struct at the spots until `want` are down. */
  some(what: Struct, want: number, r0: number, r1: number, s = 1, tall?: number) {
    let got = 0;
    for (const [du, dv] of this.spots(40, r0, r1)) {
      if (got >= want) break;
      const face: P = this.r() < 0.5 ? [Math.sign(du) || 1, 0] : [0, Math.sign(dv) || 1];
      // (inside a plaza, a lane's corridor need not stay clear its whole width: the ground round it is open too)
      if (this.struct(what, du, dv, face, s, -2, tall)) got++;
    }
    return got;
  }
  someProps(kinds: PropKind[], want: number, r0: number, r1: number, key?: ModelKey) {
    let got = 0;
    for (const [du, dv] of this.spots(30, r0, r1)) {
      if (got >= want) break;
      const face: P = this.r() < 0.5 ? [1, 0] : [0, 1];
      if (this.prop(kinds[Math.floor(this.r() * kinds.length)], du, dv, face, key)) got++;
    }
  }
}

/** The four sides of a square plaza by their inward normal: -v side, +v side, -u side, +u side. */
const SIDES: P[] = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
];

type Drafter = (d: Draft, def: MapDef) => void;
const pick = <T>(r: Rng, a: readonly T[]) => a[Math.floor(r() * a.length) % a.length];
const CLUTTER: ModelKey[] = ['jerry', 'gas', 'propane', 'cup', 'pan', 'tyre', 'toolbox', 'ammo-crate', 'barrel'];

const DRAFT: Record<PlaceKind, Drafter> = {
  // a farmyard: a big barn, the farmhouse and sheds round the yard, two silos, wooden fences, hay and a truck
  farm(d) {
    const r = d.r;
    d.ring([
      ['barn', 12, 17],
      ['house', 10, 8.5],
      ['shed', 4.4, 5.2],
      ['shed', 4.2, 5],
    ]);
    d.some('silo', 2, 13, 19, 1, 11);
    d.edges((a, b) => d.coverRun(a, b, 'fence', 6.1, 'fence-wood'));
    d.someProps(['pile', 'crates', 'pile'], 4, 11, 19);
    d.some('stall', 1, 12, 18);
    d.someProps(['truck'], 1, 13, 19);
    for (let i = 0; i < 4; i++) d.deco(pick(r, CLUTTER), (r() - 0.5) * 30, (r() - 0.5) * 30);
  },
  // a village square: houses all round facing in, low stone walls between them, a well and market stalls
  square(d, def) {
    const r = d.r;
    const big = def.style === 'tropic' ? 9 : 10;
    d.ring([
      ['house', big, 8],
      ['house', big + 1, 8.5],
      ['house', big - 1, 8],
      ['house', big, 7.5],
      ['shed', 4.4, 5],
      ['house', big - 1, 8],
    ]);
    const s = STYLE_WALL[def.style];
    d.edges((a, b) => d.wallRun(a, b, 1.15, s.part, s.color));
    d.some('well', 1, 11, 14);
    d.some('stall', 3, 11, 18);
    d.someProps(['crates', 'barrier', 'crates'], 3, 12, 19);
    for (let i = 0; i < 3; i++) d.deco(pick(r, CLUTTER), (r() - 0.5) * 28, (r() - 0.5) * 28);
  },
  // an old quarry: a pit with a stone crusher and its conveyor, rubble, a site hut, a truck and spoil heaps
  quarry(d) {
    d.some('crusher', 1, 8, 16);
    d.some('rubble', 3, 8, 17);
    d.some('logs', 1, 10, 17);
    d.ring([
      ['shed', 4.4, 5.2],
      ['ruin', 8, 7],
    ]);
    d.someProps(['container', 'pile', 'truck'], 3, 9, 17);
    for (let i = 0; i < 4; i++) d.deco(pick(d.r, ['tyre', 'generator', 'toolbox', 'barrel'] as ModelKey[]), (d.r() - 0.5) * 26, (d.r() - 0.5) * 26);
  },
  // a walled adobe town: a courtyard ringed by a high wall, open where the lanes come in, houses inside it along the
  // wall, a well and a market; a street runs round outside the wall
  compound(d, def) {
    const r = d.r;
    const inner = d.pz.r - 6;
    const s = STYLE_WALL[def.style];
    d.ring(
      [
        ['house', 9, 7.5],
        ['house', 10, 8],
        ['house', 8.5, 7],
        ['shed', 4.4, 5],
      ],
      0,
      inner,
    );
    d.edges((a, b) => d.wallRun(a, b, 3.3, s.part, s.color), 2, inner);
    d.some('well', 1, 9, 12);
    d.some('stall', 2, 10, 14);
    d.someProps(['crates', 'barrier', 'dumpsters'], 3, 10, 14);
    // out on the street round it, a few more
    d.someProps(['pile', 'barrier', 'crates'], 3, inner + 3, d.pz.r - 1);
    for (let i = 0; i < 3; i++) d.deco(pick(r, CLUTTER), (r() - 0.5) * 24, (r() - 0.5) * 24);
  },
  // a pump station: storage tanks, pipe runs, the pump house and sheds, containers and a fence round it
  pumps(d) {
    d.ring([
      ['house', 9, 8],
      ['shed', 4.4, 5.2],
      ['shed', 4.4, 5],
    ]);
    d.some('tank', 2, 12, 18, 1, 6.5);
    d.some('pipes', 2, 10, 16, 9);
    d.edges((a, b) => d.coverRun(a, b, 'fence', 6.1, 'fence-base'));
    d.someProps(['container', 'truck', 'dumpsters', 'hesco', 'container'], 4, 11, 19);
    for (let i = 0; i < 5; i++) d.deco(pick(d.r, ['barrel', 'barrel', 'generator', 'gas', 'tyre'] as ModelKey[]), (d.r() - 0.5) * 30, (d.r() - 0.5) * 30);
  },
  // the gate: two towers and an arch over the way in from the attack's side, ruins and a market past it
  gate(d) {
    const [a, b] = [d.plan.lanes[1].pts[1], d.plan.lanes[1].pts[2]];
    // halfway along the middle lane between the attack's turn and the middle
    const gu = lerp(a[0], b[0], 0.55) - d.cu;
    const gv = lerp(a[1], b[1], 0.55) - d.cv;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const face: P = Math.abs(b[0] - a[0]) > Math.abs(b[1] - a[1]) ? [Math.sign(b[0] - a[0]), 0] : [0, Math.sign(b[1] - a[1])];
    if (len > 0) d.struct('gate', gu, gv, face, d.plan.lanes[1].w * 2 + 14, -10);
    d.ring([
      ['ruin', 8, 7],
      ['house', 8.5, 7.5],
    ]);
    d.some('stall', 2, 6, 11);
    d.someProps(['crates', 'barrier'], 2, 6, 11);
  },
  // a radio station: a tall mast, a fuel tank, cabins and huts, containers, an armored truck, sandbags and HESCO round
  station(d) {
    d.ring([
      ['house', 9, 7.5],
      ['shed', 4.4, 5],
      ['house', 8, 7],
      ['shed', 4.2, 5],
    ]);
    d.some('mast', 1, 12, 16, 1, 22);
    d.some('tank', 1, 12, 18, 1, 4.5);
    d.edges((a, b) => d.coverRun(a, b, 'hesco', 8));
    d.someProps(['container', 'sandbags', 'truck', 'container', 'sandbags'], 4, 11, 19);
    for (let i = 0; i < 5; i++) d.deco(pick(d.r, ['generator', 'ammo-crate', 'barrel', 'jerry', 'toolbox'] as ModelKey[]), (d.r() - 0.5) * 30, (d.r() - 0.5) * 30);
  },
  // a lumber yard: the sawmill (a barn), sheds, stacks of logs, a truck and wooden fences
  lumber(d) {
    d.ring([
      ['barn', 12, 16],
      ['shed', 4.4, 5],
      ['house', 9, 7.5],
    ]);
    d.some('logs', 5, 11, 19, 1);
    d.edges((a, b) => d.coverRun(a, b, 'fence', 6.1, 'fence-wood'));
    d.someProps(['truck', 'pile', 'crates'], 3, 11, 19);
    for (let i = 0; i < 4; i++) d.deco(pick(d.r, ['log', 'stump', 'stump2', 'toolbox', 'jerry'] as ModelKey[]), (d.r() - 0.5) * 30, (d.r() - 0.5) * 30);
  },
  // a frozen pond: fishing huts out on the ice, sheds on the shore
  pond(d) {
    d.some('hut', 5, 6, 18);
    d.someProps(['crates', 'sandbags', 'pile'], 3, 5, 15);
    d.ring([
      ['shed', 4.4, 5],
      ['shed', 4.2, 5],
    ], 3);
  },
  // the harbor: a warehouse and offices on the quay, container stacks, a crane at the water, piers out into the bay
  // with boats tied up
  dock(d) {
    const R = d.pz.r;
    d.ring(
      [
        ['barn', 12, 15],
        ['house', 9, 7.5],
        ['shed', 4.4, 5],
        ['house', 8, 7],
      ],
      1.5,
      R,
      [1, 2, 3],
    );
    // the sea is on the plan's negative v side
    for (const du of [-11, 9]) d.struct('pier', du, -R + 2, [0, -1], 36, -40);
    d.struct('boat', -16, -R - 26, [0, -1], 1, -40);
    d.struct('boat', 14.5, -R - 30, [0, -1], 1, -40);
    d.struct('crane', -1, -R + 4, [0, -1], 1, 0);
    d.someProps(['container', 'container', 'crates', 'pile'], 5, 10, 19);
    d.edges((a, b, side) => side !== 0 && d.coverRun(a, b, 'fence', 6.1, 'fence-half'));
    for (let i = 0; i < 6; i++) d.deco(pick(d.r, ['jerry', 'barrel', 'propane', 'barrel', 'tyre', 'ammo-crate'] as ModelKey[]), (d.r() - 0.5) * 30, (d.r() - 0.5) * 30);
  },
  // a wreck in the lagoon: an old hull run aground, flotsam round it
  wreck(d) {
    // out in the water near the middle if it fits clear of the ways through, else nearer the edge
    if (!d.some('wreck', 1, 3, 9)) d.some('wreck', 1, 8, 18);
    d.someProps(['crates', 'pile', 'crates'], 4, 6, 17);
    d.ring([['ruin', 7, 6]], 2);
  },
  // a hamlet: a house and a shed on a bend, fences, a stack of something
  hamlet(d, def) {
    d.ring(
      [
        ['house', 9, 7.5],
        ['shed', 4.2, 5],
        ['shed', 4, 4.6],
      ],
      2,
    );
    d.someProps(['crates', 'pile', 'sandbags'], 2, 5, 10);
    if (def.style === 'cabin') d.some('logs', 1, 6, 10);
  },
  // ruins: what is left of two buildings, rubble and sandbags
  ruins(d) {
    d.ring([
      ['ruin', 8, 7],
      ['ruin', 7, 6],
    ], 2);
    d.some('rubble', 1, 5, 9);
    d.someProps(['sandbags', 'barrier', 'pile'], 2, 4, 9);
  },
};

/** The military dressing each kind of place gets once the map is built (world.ts lays it out from a random stream of
 * its own, only where nothing stands yet, so the layout above never moves): what, and how many of each. */
export const PLACE_DRESS: Record<PlaceKind, [PropKind, number][]> = {
  farm: [
    ['pallets', 2],
    ['drums', 1],
    ['carwreck', 1],
  ],
  square: [
    ['carwreck', 1],
    ['pallets', 1],
    ['brokenwall', 1],
  ],
  quarry: [
    ['pallets', 2],
    ['drums', 1],
    ['carwreck', 1],
  ],
  compound: [
    ['bagarc', 1],
    ['drums', 1],
    ['carwreck', 1],
  ],
  pumps: [
    ['drums', 2],
    ['pallets', 1],
    ['razor', 1],
  ],
  gate: [
    ['bagarc', 1],
    ['razor', 1],
  ],
  station: [
    ['tower', 1],
    ['bagarc', 1],
    ['razor', 2],
    ['tent', 1],
    ['net', 1],
  ],
  lumber: [
    ['pallets', 2],
    ['drums', 1],
  ],
  pond: [
    ['tent', 2],
    ['drums', 1],
    ['net', 1],
  ],
  dock: [
    ['pallets', 2],
    ['drums', 2],
    ['carwreck', 1],
  ],
  wreck: [['drums', 1]],
  hamlet: [
    ['carwreck', 1],
    ['pallets', 1],
  ],
  ruins: [
    ['brokenwall', 2],
    ['bagarc', 1],
  ],
};

/** Drafts every place of a plan, in order. `keep` are rectangles nothing may cover (the spawns, the site pads). */
export function draftPlaces(plan: Plan, def: MapDef): Item[] {
  const keep: Rect[] = [];
  for (const s of [plan.atk, plan.def]) keep.push({ u0: s[0] - SPAWN_PLAZA, v0: s[1] - SPAWN_PLAZA, u1: s[0] + SPAWN_PLAZA, v1: s[1] + SPAWN_PLAZA });
  for (const s of plan.sites) keep.push({ u0: s[0] - 10.5, v0: s[1] - 10.5, u1: s[0] + 10.5, v1: s[1] + 10.5 });
  const items: Item[] = [];
  const rects: Rect[] = [];
  plan.places.forEach((pl, i) => {
    const d = new Draft(plan, plan.plazas[pl.plaza], mulberry32(def.seed * 41 + i * 977 + 13), keep);
    d.rects = rects.slice();
    DRAFT[pl.kind](d, def);
    items.push(...d.items);
    rects.splice(0, rects.length, ...d.rects);
  });
  return items;
}

// ---------------------------------------------------------------------------------------------------------------
// the land

/** Open ground, in world meters: lane corridors, discs and boxes. */
type Shape = { seg: [number, number, number, number, number] } | { disc: [number, number, number] } | { box: [number, number, number, number] };

function shapesOf(plan: Plan, items: Item[]): Shape[] {
  const out: Shape[] = [];
  const W = (p: P) => toWorld(plan, p[0], p[1]);
  for (const l of plan.lanes)
    for (let i = 0; i + 1 < l.pts.length; i++) {
      const [ax, az] = W(l.pts[i]);
      const [bx, bz] = W(l.pts[i + 1]);
      out.push({ seg: [ax, az, bx, bz, l.w] });
    }
  const box = (u0: number, v0: number, u1: number, v1: number) => {
    const [ax, az] = W([u0, v0]);
    const [bx, bz] = W([u1, v1]);
    out.push({ box: [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)] });
  };
  for (const p of [plan.atk, plan.def]) {
    const [x, z] = W(p);
    out.push({ disc: [x, z, SPAWN_PLAZA] });
  }
  for (const pz of plan.plazas) {
    if (pz.round) {
      const [x, z] = W(pz.at);
      out.push({ disc: [x, z, pz.r] });
    } else box(pz.at[0] - pz.r - 1.5, pz.at[1] - pz.r - 1.5, pz.at[0] + pz.r + 1.5, pz.at[1] + pz.r + 1.5);
  }
  for (const it of items) {
    if (it.t === 'prop' || it.t === 'deco') continue;
    const r = itemRect(it);
    const m = it.t === 'wall' ? 1.2 : 3;
    box(r.u0 - m, r.v0 - m, r.u1 + m, r.v1 + m);
  }
  if (plan.sea) {
    // a bay with rounded ends: a straight shore in the middle, curving out to sea toward either end
    const { u0, u1, v } = plan.sea;
    const R = 40;
    box(u0 + R, -400, u1 - R, v + 2);
    box(u0, -400, u1, v + 2 - R);
    for (const u of [u0 + R, u1 - R]) {
      const [x, z] = W([u, v + 2 - R]);
      out.push({ disc: [x, z, R] });
    }
  }
  return out;
}

function shapeDist(s: Shape, x: number, z: number) {
  if ('seg' in s) return segDist(x, z, s.seg[0], s.seg[1], s.seg[2], s.seg[3]) - s.seg[4];
  if ('disc' in s) return Math.hypot(x - s.disc[0], z - s.disc[1]) - s.disc[2];
  const [x0, z0, x1, z1] = s.box;
  return Math.hypot(Math.max(x0 - x, 0, x - x1), Math.max(z0 - z, 0, z - z1));
}

/** What sculpting leaves behind: for each terrain vertex near the arena, how far it lies from open ground (0 on it),
 * and the sculpted height of the banks, which flattening pads and grading roads must not wear down. */
export type Sculpt = { open: Float32Array; bank: Float32Array };

/**
 * Shapes the land round a plan: the open ground at the plan's height (keeping some of the land's own rise and fall),
 * plazas sunk or under water as asked, a coast falling into the sea, and everything else rising in banks too steep to
 * climb. Far out it blends back into the land as it was.
 */
export function sculpt(t: Terrain, def: MapDef, plan: Plan, items: Item[], arena: number): Sculpt {
  const shapes = shapesOf(plan, items);
  const n = new Noise2(def.seed + 404);
  const reach = arena + 60;
  const lo = Math.max(1, Math.floor((T_HALF - reach) / CELL));
  const hi = Math.min(T_RES - 2, Math.ceil((T_HALF + reach) / CELL));
  // the land smoothed over about 25 m, from a summed area table
  const R = 12;
  const sat = new Float64Array((T_RES + 1) * (T_RES + 1));
  for (let j = 0; j < T_RES; j++) {
    let row = 0;
    for (let i = 0; i < T_RES; i++) {
      row += t.h[j * T_RES + i];
      sat[(j + 1) * (T_RES + 1) + i + 1] = sat[j * (T_RES + 1) + i + 1] + row;
    }
  }
  const blur = (i: number, j: number) => {
    const i0 = Math.max(0, i - R);
    const i1 = Math.min(T_RES - 1, i + R);
    const j0 = Math.max(0, j - R);
    const j1 = Math.min(T_RES - 1, j + R);
    const S = (a: number, b: number) => sat[b * (T_RES + 1) + a];
    return (S(i1 + 1, j1 + 1) - S(i0, j1 + 1) - S(i1 + 1, j0) + S(i0, j0)) / ((i1 - i0 + 1) * (j1 - j0 + 1));
  };
  let mean = 0;
  let cnt = 0;
  const a0 = Math.floor((T_HALF - arena) / CELL);
  const a1 = Math.ceil((T_HALF + arena) / CELL);
  for (let j = a0; j <= a1; j += 4)
    for (let i = a0; i <= a1; i += 4) {
      mean += t.h[j * T_RES + i];
      cnt++;
    }
  mean /= cnt;
  const open = new Float32Array(T_RES * T_RES).fill(99);
  const bank = new Float32Array(T_RES * T_RES).fill(-1e9);
  const { ground: g, banks: b, sea } = plan;
  const water = t.hasWater ? t.water : -1e9;
  const wetPlazas = plan.plazas.filter((p) => p.wet || p.dip).map((p) => ({ p, at: toWorld(plan, p.at[0], p.at[1]) }));
  const out = new Float32Array(T_RES * T_RES);
  for (let j = lo; j <= hi; j++)
    for (let i = lo; i <= hi; i++) {
      const k = j * T_RES + i;
      const x = -T_HALF + i * CELL;
      const z = -T_HALF + j * CELL;
      const h0 = t.h[k];
      const [lu, lv] = toPlan(plan, x, z);
      const bl = blur(i, j);
      let base = g.level + (bl - mean) * g.k + (h0 - bl) * 0.1 + g.tilt[0] * lu + g.tilt[1] * lv;
      base = Math.max(base, water + 1);
      for (const { p, at } of wetPlazas) {
        const dd = p.round ? Math.hypot(x - at[0], z - at[1]) : Math.max(Math.abs(x - at[0]), Math.abs(z - at[1]));
        if (p.dip) base -= p.dip * (1 - smoothstep(p.r * 0.4, p.r, dd));
        if (p.wet) base = lerp(base, water - p.wet, 1 - smoothstep(p.r - 1 - (p.shore ?? 12), p.r - 1, dd + n.fbm(x / 14, z / 14, 2) * 3));
      }
      if (sea && lu > sea.u0 && lu < sea.u1) {
        // (shoaling toward either end of the coast, where the banks come down to meet it)
        const shore = sea.v + n.fbm(x / 45, z / 45, 2) * 5;
        const ends = Math.max(smoothstep(sea.u0, sea.u0 + 14, lu) * smoothstep(sea.u1, sea.u1 - 14, lu), smoothstep(shore - 14, shore - 28, lv));
        base = lerp(base, water - 5 + n.fbm(x / 30, z / 30, 2) * 1.5, smoothstep(shore, shore - 16, lv) * ends);
      }
      let d = Infinity;
      for (const s of shapes) {
        const q = shapeDist(s, x, z);
        if (q < d) d = q;
      }
      // (the banks' foot wanders a little, outward only, so no edge runs dead straight)
      d = Math.max(0, d - 2.6 * (0.5 + 0.5 * n.fbm(x / 23 + 3, z / 23, 2)));
      open[k] = d;
      let rise = 0;
      if (d > 0) {
        const H = lerp(b.lo, b.hi, clamp(0.5 + 0.7 * n.fbm(x / 60, z / 60, 3), 0, 1));
        // (steepest at its foot, so no part of a bank low enough to jump onto is gentle enough to walk up)
        const e = 1 - clamp(d / b.ramp, 0, 1);
        rise = (1 - e * e) * H + smoothstep(12, 48, d) * b.edge * (0.7 + 0.4 * n.fbm(x / 90 + 7, z / 90, 3));
        // lumpy tops
        rise += n.fbm(x / 11, z / 11, 2) * 1.6 * smoothstep(b.ramp, b.ramp + 6, d);
        if (b.tiers) {
          const s = rise / b.tiers;
          const f = s - Math.floor(s);
          rise = (Math.floor(s) + smoothstep(0.55, 1, f)) * b.tiers;
        }
      }
      let h = base + rise;
      // far out, back to the land as it was
      const far = smoothstep(arena + 8, arena + 55, Math.max(Math.abs(x), Math.abs(z)));
      h = lerp(h, Math.max(h0, base + b.edge * 0.6 * (1 - far)), far);
      out[k] = h;
      if (d > 0) bank[k] = h;
    }
  for (let j = lo; j <= hi; j++)
    for (let i = lo; i <= hi; i++) {
      const k = j * T_RES + i;
      t.h[k] = out[k];
    }
  let minH = Infinity;
  let maxH = -Infinity;
  for (let k = 0; k < t.h.length; k++) {
    if (t.h[k] < minH) minH = t.h[k];
    if (t.h[k] > maxH) maxH = t.h[k];
  }
  t.minH = minH;
  t.maxH = maxH;
  return { open, bank };
}

/** Puts the banks back where pads and roads wore them down (anything a little way off the open ground), so no slope
 * gentle enough to walk up leads out of the lanes. */
export function restoreBanks(t: Terrain, s: Sculpt) {
  for (let k = 0; k < t.h.length; k++) if (s.open[k] >= 1 && s.bank[k] > t.h[k]) t.h[k] = s.bank[k];
}

/** How far a world point lies from the open ground (0 on it). */
export function openAt(s: Sculpt, x: number, z: number) {
  const i = clamp(Math.round((x + T_HALF) / CELL), 0, T_RES - 1);
  const j = clamp(Math.round((z + T_HALF) / CELL), 0, T_RES - 1);
  return s.open[j * T_RES + i];
}
