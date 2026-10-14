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
 * Things on the road that are part of the course: mud and sand slow you like grass, an oil slick spins you out, and
 * hay bales, boulders, planters, cows, cyclists, buses, golf carts, golfers and flagsticks are solid. Cows, cyclists,
 * golfers and carts on a cart path go back and forth across the road `swing` meters either side of d. A bus (the
 * Marguerite shuttle) or a golf cart can instead drive laps in its lane at d, `drive` meters a second, from s at the
 * green light; its r is half its width.
 *
 * A golf ball lands on the road at (s, d) every `every` seconds, first at race time `phase`, hit from a tee `tee`
 * ([along, across]) from there; its r is the ball's size. Water is a pond: a circle of radius r centered (s, d) off the
 * road, whose edge comes up to the shoulder (see shoreOf).
 */
export type HazardKind = 'mud' | 'oil' | 'hay' | 'rock' | 'planter' | 'cow' | 'bike' | 'bus' | 'cart' | 'golfer' | 'ball' | 'sand' | 'water' | 'pin';
export type Hazard = {
  kind: HazardKind;
  s: number;
  d: number;
  r: number;
  swing?: number;
  speed?: number;
  phase?: number;
  drive?: number;
  every?: number;
  tee?: [number, number];
};
/** How big each kind is unless a course says otherwise. */
export const HAZARD_R: Record<HazardKind, number> = { mud: 3.4, oil: 2.3, hay: 1.25, rock: 1.4, planter: 1.6, cow: 1.5, bike: 1, bus: 1.3, cart: 0.8, golfer: 0.8, ball: 0.55, sand: 2.8, water: 20, pin: 0.5 };
/** A bus is this long, nose to tail, and so is a golf cart. */
export const BUS_LEN = 9.6;
export const CART_LEN = 3.1;
/** Something that drives laps of the course in its own lane, collided with as a box. */
export const drives = (h: Hazard) => (h.kind === 'bus' || h.kind === 'cart') && !!h.drive;
/** How long a bus or a driving cart is. */
export const lengthOf = (h: Hazard) => (h.kind === 'bus' ? BUS_LEN : CART_LEN);
/** Things you bounce off (or that spin you out when you run into them); the rest you drive through or over. */
export const solid = (kind: HazardKind) => kind !== 'mud' && kind !== 'oil' && kind !== 'sand' && kind !== 'water' && kind !== 'ball';

/** A golf ball flies this long from the tee, its shadow shows on the road this long before it lands. */
export const BALL_FLIGHT = 2;
export const BALL_WARN = 1.3;
/** It bonks a kart that is there this close to touchdown, either side, and then bounces on and rolls away. */
export const BALL_WINDOW = 0.15;
export const BALL_ROLL = 1.8;
/** Seconds since a ball last landed at time `time` (always 0 or more, less than `every`). */
export const ballSince = (h: Hazard, time: number) => {
  const every = h.every ?? 5;
  return (((time - (h.phase ?? 0)) % every) + every) % every;
};
/** Seconds from `time` to the nearest touchdown, negative while the ball is still coming down. */
export function ballNear(h: Hazard, time: number) {
  const since = ballSince(h, time);
  const every = h.every ?? 5;
  return since < every / 2 ? since : since - every;
}
/** Whether a ball touches down at the spot at some time between t0 and t1. */
export function ballDue(h: Hazard, t0: number, t1: number) {
  const every = h.every ?? 5;
  const next = t0 + ((every - ballSince(h, t0)) % every);
  return next <= t1;
}

/**
 * How far it is from the centerline to the water on each side, at every point of the track (Infinity where there is
 * no pond). A pond bites into the shoulder past the curb but never onto the road; where it comes inside the wall line
 * there is no wall, just a low stone lip at the water's edge.
 */
export function shoreOf(t: Track, hazards: Hazard[]) {
  const left = new Float32Array(t.n).fill(Infinity);
  const right = new Float32Array(t.n).fill(Infinity);
  const ponds = hazards.filter((h) => h.kind === 'water').map((h) => ({ ...pointAt(t, h.s, h.d), r: h.r }));
  if (!ponds.length) return null;
  for (let i = 0; i < t.n; i++) {
    const nx = -t.tz[i];
    const nz = t.tx[i];
    for (const p of ponds) {
      const ox = t.x[i] - p.x;
      const oz = t.z[i] - p.z;
      const far = ox * ox + oz * oz;
      if (far > (p.r + t.edge + 6) ** 2) continue;
      // where the line across the road meets the pond: d^2 + 2 d (n . o) + |o|^2 - r^2 = 0
      const b = nx * ox + nz * oz;
      const disc = b * b - (far - p.r * p.r);
      if (disc < 0) continue;
      if (far <= p.r * p.r) {
        // the centerline itself is under water
        left[i] = 0;
        right[i] = 0;
        continue;
      }
      const root = Math.sqrt(disc);
      const near = [-b - root, -b + root];
      for (const d of near) {
        if (d > 0) right[i] = Math.min(right[i], d);
        else left[i] = Math.min(left[i], -d);
      }
    }
  }
  return { left, right };
}
export type Shore = NonNullable<ReturnType<typeof shoreOf>>;

/** The stretches of wall left out because a pond comes inside the wall line there: [side (1 right, -1 left), from, to]. */
export function wallGaps(t: Track, shore: Shore | null) {
  const gaps: [number, number, number][] = [];
  if (!shore) return gaps;
  for (const side of [-1, 1]) {
    const w = side < 0 ? shore.left : shore.right;
    const wet = (i: number) => w[((i % t.n) + t.n) % t.n] < t.edge + 0.3;
    // start from a dry spot so a gap is never split over the start line
    let i0 = 0;
    while (i0 < t.n && wet(i0)) i0++;
    if (i0 === t.n) continue;
    let from = -1;
    for (let k = 1; k <= t.n; k++) {
      const i = i0 + k;
      if (wet(i) && from < 0) from = i;
      if (!wet(i) && from >= 0) {
        // a sample more either way, so the wall stops just short of the water
        gaps.push([side, (from - 1) * t.step, i * t.step]);
        from = -1;
      }
    }
  }
  return gaps;
}

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
