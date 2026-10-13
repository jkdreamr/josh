// Circuits: a closed spline through control points, sampled every couple of meters. Pure, no three.js. The other
// courses live in courses.ts; this file has the geometry and the original Palm Drive circuit.
//
// One lap of Palm Drive runs north up Palm Drive toward Memorial Church, sweeps around the Oval, turns south past
// Hoover Tower into the Arboretum esses and comes back onto Palm Drive through a hairpin.
//
// World axes: +y is up and +z is north. Seen from above with north up, +x points WEST (three.js is right handed),
// so the map points below are written as [east, north] like a normal map and flipped once in fromMap().
// Headings follow the karts: forward = (sin h, cos h), so h = 0 faces north and turning right lowers h.
// The right-hand normal of a direction (tx, tz) is (-tz, tx); a positive lateral offset `d` is right of the line.

/** Palm Drive's road: half its width, and where the walls stand. Other courses can be wider or narrower. */
export const ROAD_HALF = 8;
export const CURB = 1.1;
/** Walls stand this far either side of the centerline; the grass between the curb and the wall is slow. */
export const EDGE = 13;
const STEP = 2;
const SCALE = 0.8;

export type P2 = { x: number; z: number };
export const fromMap = (east: number, north: number): P2 => ({ x: -east * SCALE, z: north * SCALE });

/** Control points in driving order, [east, north] in map meters before scaling. */
export const ROUTE: [number, number][] = [
  [0, -230],
  [0, -110],
  [0, 10],
  [-25, 55],
  [-42, 115],
  [-25, 175],
  [15, 198],
  [55, 180],
  [68, 120],
  [60, 60],
  [85, 10],
  [130, -20],
  [140, -80],
  [115, -130],
  [130, -185],
  [110, -240],
  [75, -275],
  [35, -285],
  [8, -265],
];
export const START: [number, number] = [0, -120];

/** Landmarks in world coordinates (see the scene for what stands there). */
export const LANDMARKS = {
  church: fromMap(0, 240),
  oval: { ...fromMap(12, 118), rx: 22, rz: 40 },
  hoover: fromMap(118, 150),
  cantor: fromMap(48, -112),
  dish: { x: 230, z: -390 },
};

export type Track = {
  n: number;
  step: number;
  length: number;
  x: Float32Array;
  z: Float32Array;
  tx: Float32Array;
  tz: Float32Array;
  /** Signed curvature in radians per meter, positive for a right-hand bend. */
  curv: Float32Array;
  /** Half the road's width, and how far either side of the centerline the walls stand. */
  half: number;
  edge: number;
};

export type Spot = { i: number; s: number; d: number; x: number; z: number; tx: number; tz: number };

export const headingOf = (tx: number, tz: number) => Math.atan2(tx, tz);
export const wrapAngle = (a: number) => a - Math.round(a / (Math.PI * 2)) * Math.PI * 2;

/** Centripetal Catmull-Rom point between p1 and p2 at u in [0, 1]. */
function catmull(p0: P2, p1: P2, p2: P2, p3: P2, u: number): P2 {
  const knot = (a: P2, b: P2) => Math.max(1e-6, Math.sqrt(Math.hypot(b.x - a.x, b.z - a.z)));
  const t1 = knot(p0, p1);
  const t2 = t1 + knot(p1, p2);
  const t3 = t2 + knot(p2, p3);
  const t = t1 + (t2 - t1) * u;
  const mix = (a: P2, b: P2, ta: number, tb: number): P2 => {
    const w = (t - ta) / (tb - ta);
    return { x: a.x + (b.x - a.x) * w, z: a.z + (b.z - a.z) * w };
  };
  const a1 = mix(p0, p1, 0, t1);
  const a2 = mix(p1, p2, t1, t2);
  const a3 = mix(p2, p3, t2, t3);
  const b1 = mix(a1, a2, 0, t2);
  const b2 = mix(a2, a3, t1, t3);
  return mix(b1, b2, t1, t2);
}

export function buildTrack(route: [number, number][] = ROUTE, start: [number, number] = START, half = ROAD_HALF, edge = EDGE): Track {
  const pts = route.map(([e, n]) => fromMap(e, n));
  const dense: P2[] = [];
  const m = pts.length;
  for (let k = 0; k < m; k++) {
    const p0 = pts[(k - 1 + m) % m];
    const p1 = pts[k];
    const p2 = pts[(k + 1) % m];
    const p3 = pts[(k + 2) % m];
    for (let j = 0; j < 80; j++) dense.push(catmull(p0, p1, p2, p3, j / 80));
  }
  const cum = [0];
  for (let i = 1; i <= dense.length; i++) {
    const a = dense[i - 1];
    const b = dense[i % dense.length];
    cum.push(cum[i - 1] + Math.hypot(b.x - a.x, b.z - a.z));
  }
  const total = cum[dense.length];
  const n = Math.round(total / STEP);
  const step = total / n;
  const rx = new Float32Array(n);
  const rz = new Float32Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const s = i * step;
    while (cum[j + 1] < s) j++;
    const a = dense[j];
    const b = dense[(j + 1) % dense.length];
    const w = (s - cum[j]) / Math.max(1e-9, cum[j + 1] - cum[j]);
    rx[i] = a.x + (b.x - a.x) * w;
    rz[i] = a.z + (b.z - a.z) * w;
  }
  // index 0 sits on the start line
  const sp = fromMap(start[0], start[1]);
  let first = 0;
  let best = Infinity;
  for (let i = 0; i < n; i++) {
    const dd = (rx[i] - sp.x) ** 2 + (rz[i] - sp.z) ** 2;
    if (dd < best) {
      best = dd;
      first = i;
    }
  }
  const x = new Float32Array(n);
  const z = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = rx[(i + first) % n];
    z[i] = rz[(i + first) % n];
  }
  const tx = new Float32Array(n);
  const tz = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    const dx = x[b] - x[a];
    const dz = z[b] - z[a];
    const len = Math.hypot(dx, dz) || 1;
    tx[i] = dx / len;
    tz[i] = dz / len;
  }
  const curv = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = (i - 1 + n) % n;
    const b = (i + 1) % n;
    curv[i] = -wrapAngle(headingOf(tx[b], tz[b]) - headingOf(tx[a], tz[a])) / (2 * step);
  }
  return { n, step, length: n * step, x, z, tx, tz, curv, half, edge };
}

export const wrapS = (t: Track, s: number) => ((s % t.length) + t.length) % t.length;
/** Shortest signed distance along the loop from s0 to s1. */
export function deltaS(t: Track, s0: number, s1: number) {
  let d = s1 - s0;
  if (d > t.length / 2) d -= t.length;
  if (d < -t.length / 2) d += t.length;
  return d;
}

/** The point at distance s along the centerline, moved d to its right. */
export function pointAt(t: Track, s: number, d = 0): Spot {
  const w = wrapS(t, s) / t.step;
  const i = Math.floor(w) % t.n;
  const k = (i + 1) % t.n;
  const u = w - Math.floor(w);
  let tx = t.tx[i] + (t.tx[k] - t.tx[i]) * u;
  let tz = t.tz[i] + (t.tz[k] - t.tz[i]) * u;
  const len = Math.hypot(tx, tz) || 1;
  tx /= len;
  tz /= len;
  const cx = t.x[i] + (t.x[k] - t.x[i]) * u;
  const cz = t.z[i] + (t.z[k] - t.z[i]) * u;
  return { i, s: wrapS(t, s), d, x: cx - tz * d, z: cz + tx * d, tx, tz };
}

/**
 * Where (x, z) is relative to the track: nearest centerline distance s, lateral offset d (positive to the right)
 * and the direction there. With a hint (the last index) it only searches nearby, which also keeps a kart on its
 * own stretch of road; without one it searches the whole loop.
 */
export function locate(t: Track, x: number, z: number, hint = -1): Spot {
  let bi = 0;
  let bd = Infinity;
  const scan = (i: number) => {
    const dd = (t.x[i] - x) ** 2 + (t.z[i] - z) ** 2;
    if (dd < bd) {
      bd = dd;
      bi = i;
    }
  };
  if (hint < 0) for (let i = 0; i < t.n; i++) scan(i);
  else for (let k = -24; k <= 24; k++) scan((hint + k + t.n) % t.n);
  // project onto the segment ahead of or behind the nearest sample
  const next = (bi + 1) % t.n;
  let a = bi;
  let u = ((x - t.x[bi]) * (t.x[next] - t.x[bi]) + (z - t.z[bi]) * (t.z[next] - t.z[bi])) / (t.step * t.step);
  if (u < 0) {
    a = (bi - 1 + t.n) % t.n;
    u = ((x - t.x[a]) * (t.x[bi] - t.x[a]) + (z - t.z[a]) * (t.z[bi] - t.z[a])) / (t.step * t.step);
  }
  u = Math.min(1, Math.max(0, u));
  const on = pointAt(t, a * t.step + u * t.step);
  const d = (x - on.x) * -on.tz + (z - on.z) * on.tx;
  return { i: bi, s: on.s, d, x: on.x, z: on.z, tx: on.tx, tz: on.tz };
}

/** Starting spot for grid slot 0 (pole) to 7: two staggered columns behind the line. */
export function gridSpot(t: Track, slot: number) {
  const row = Math.floor(slot / 2);
  const col = slot % 2;
  const p = pointAt(t, t.length - (7 + row * 6.5 + col * 3), col ? 3.4 : -3.4);
  return { x: p.x, z: p.z, h: headingOf(p.tx, p.tz) };
}

/** Distance along the loop of a map point (where a pickup row or a landmark sits). */
export const sOf = (t: Track, e: number, n: number) => {
  const p = fromMap(e, n);
  return locate(t, p.x, p.z).s;
};

/**
 * Things on the road that are part of the course: mud slows you like grass, an oil slick spins you out, and hay
 * bales and cows are solid. Cows wander back and forth across the road `swing` meters either side of d.
 */
export type HazardKind = 'mud' | 'oil' | 'hay' | 'cow';
export type Hazard = { kind: HazardKind; s: number; d: number; r: number; swing?: number; speed?: number; phase?: number };
/** How big each kind is unless a course says otherwise. */
export const HAZARD_R: Record<HazardKind, number> = { mud: 3.4, oil: 2.3, hay: 1.25, cow: 1.5 };
export const solid = (kind: HazardKind) => kind === 'hay' || kind === 'cow';

export type Layout = {
  boxes: { s: number; d: number }[];
  coins: { s: number; d: number }[];
  dashes: { s: number; d: number }[];
  /** Jump ramps: the lip at s, centered d to the right, w wide. */
  ramps: { s: number; d: number; w: number }[];
  hazards: Hazard[];
  /** Palm Drive itself, from the hairpin exit to the Oval, as [from, to] distances (Palm Drive course only). */
  palmDrive?: [number, number];
};

/** Item box rows, coin lines and dash panels, placed by landmark so the spline can change underneath. */
export function layout(t: Track): Layout {
  const boxes: Layout['boxes'] = [];
  for (const [e, n] of [[0, -20], [40, 192], [134, -48]] as const) {
    const s = sOf(t, e, n);
    for (const d of [-5.4, -1.8, 1.8, 5.4]) boxes.push({ s, d });
  }
  const coins: Layout['coins'] = [];
  const line = (e: number, n: number, d: number, count: number) => {
    const s = sOf(t, e, n);
    for (let k = 0; k < count; k++) coins.push({ s: wrapS(t, s + k * 3.2), d });
  };
  line(0, -170, -4.5, 6);
  line(0, -60, 4.5, 5);
  line(-40, 120, 3, 5);
  line(66, 140, -3, 5);
  line(110, -5, 0, 5);
  line(128, -165, 3.5, 5);
  line(50, -283, -3, 4);
  const dashes = [
    { s: sOf(t, 62, 85), d: -2.6 },
    { s: sOf(t, 0, -205), d: 3 },
  ];
  // a dash panel straight into a jump out of the Oval, and a kicker beside the Palm Drive straight
  const ramps = [
    { s: wrapS(t, dashes[0].s + 11), d: -1.5, w: 11 },
    { s: wrapS(t, sOf(t, 0, -80)), d: 4.6, w: 5.5 },
  ];
  return { boxes, coins, dashes, ramps, hazards: [], palmDrive: [sOf(t, 2, -250), sOf(t, 0, 20)] };
}
