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

/**
 * What lies past the edge of the road on one side: a wall, or a drop (water, a pit, out of bounds on the golf course, or
 * on the Cardinal Skyway the open sky, ninety meters above campus). Run a kart's middle over the brink of a drop and you
 * fall in, and the crane (or the drone) fishes you out.
 */
export type Past = 'wall' | 'water' | 'pit' | 'ob' | 'void' | 'marsh';
/** The codes the track stores them by (pastLo, pastHi). (On Redwood Slough the channel's banks are marsh and mudflat.) */
export const PASTS: readonly Past[] = ['wall', 'water', 'pit', 'ob', 'void', 'marsh'];
/**
 * A stretch of a course's edge, from s0 to s1, on one side (-1 left, 1 right) or both (0): what lies past it, and where.
 * For a drop `at` is the brink the kart's middle may not cross (by default a little past the edge of the road, see
 * Tier.brink); for a wall, where the wall stands (by default the course's wall line).
 */
export type EdgeSpan = [s0: number, s1: number, side: -1 | 0 | 1, past: Past, at?: number];
/** In the water: how far over the edge of a pond the kart's middle has to go (golf: the water's edge is the brink plus this). */
export const WET = 0.6;
/** Half a kart's width, more or less: how close its middle can come to a wall. */
export const KART_R = 1.05;

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
  /**
   * The edge on each side at every sample, as signed lateral offsets (lo left, negative; hi right), and what lies past
   * it (codes into PASTS): the walls by default, a brink where the road drops away.
   */
  lo: Float32Array;
  hi: Float32Array;
  pastLo: Uint8Array;
  pastHi: Uint8Array;
  /**
   * How much grip the road has at every sample on each lap (1 to 5), on a course with slick stretches (see
   * Course.surfaces): 1 is ordinary road. Undefined on every other course.
   */
  grips?: Float32Array[];
  /** On the water (Course.vehicle): the channel is open water right out to its banks and walls (see roadEdge). */
  boat?: boolean;
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
  return { n, step, length: n * step, x, z, tx, tz, curv, half, edge, lo: new Float32Array(n).fill(-edge), hi: new Float32Array(n).fill(edge), pastLo: new Uint8Array(n), pastHi: new Uint8Array(n) };
}

/** The edge on one side (1 right, -1 left) at s: how far out it is (a positive distance) and what lies past it. */
export function edgeAt(t: Track, s: number, side: number): { lim: number; past: Past } {
  const w = wrapS(t, s) / t.step;
  const i = Math.floor(w) % t.n;
  const j = (i + 1) % t.n;
  const u = w - Math.floor(w);
  const a = side > 0 ? t.hi[i] : -t.lo[i];
  const b = side > 0 ? t.hi[j] : -t.lo[j];
  const pa = (side > 0 ? t.pastHi : t.pastLo)[i];
  const pb = (side > 0 ? t.pastHi : t.pastLo)[j];
  // (where a wall gives way to water or a drop the limit is the nearer sample's, not a blend of the two: a blend stands
  // the wall further in for half a sample before the water, where before there was none)
  const near = u < 0.5 ? i : j;
  return { lim: pa === pb ? a + (b - a) * u : near === i ? a : b, past: PASTS[(side > 0 ? t.pastHi : t.pastLo)[near]] };
}

/**
 * Where the road itself ends on one side (1 right, -1 left) at s, as a positive distance from the centerline: its half
 * width, except where it narrows over the sky (a brink closer in than the road's edge, see Course.edges), where the
 * glass stops just short of the brink. The renderer, the minimap and the pickups go by this rather than t.half.
 */
export function roadEdge(t: Track, s: number, side: number) {
  const e = edgeAt(t, s, side);
  // (on the water the channel runs out to just short of the brink of the marsh, and to a little short of a wall's foot
  // where one narrows it, as through the lock)
  if (t.boat) return e.past === 'wall' ? Math.min(t.half, e.lim - KART_R + 0.3) : e.lim - 0.4;
  return e.past === 'void' ? Math.min(t.half, e.lim - 0.4) : t.half;
}

/** How much grip the road has at s for a kart on lap `lap` (1 everywhere on a course with no slick stretches). */
export const gripAt = (t: Track, s: number, lap: number) => (t.grips ? t.grips[Math.min(5, Math.max(1, lap)) - 1][Math.floor(wrapS(t, s) / t.step) % t.n] : 1);

/** Whether the road drops away on that side (1 right, -1 left) at sample i. */
export const dropAt = (t: Track, i: number, side: number) => (side > 0 ? t.pastHi : t.pastLo)[((i % t.n) + t.n) % t.n] !== 0;

/**
 * The runs of the edge with the same thing past them, on each side: [side (-1 left, 1 right), from, to, what]. A run
 * never splits over the start line (`to` can be past the end of the lap); a side that is all one thing is one run from 0
 * to the length of the lap.
 */
export function edgeRuns(t: Track): [number, number, number, Past][] {
  const runs: [number, number, number, Past][] = [];
  for (const side of [-1, 1]) {
    const past = side < 0 ? t.pastLo : t.pastHi;
    const at = (i: number) => past[((i % t.n) + t.n) % t.n];
    // start where the edge changes, so no run is split over the start line
    let i0 = 0;
    while (i0 < t.n && at(i0) === at(i0 + t.n - 1)) i0++;
    if (i0 === t.n) {
      runs.push([side, 0, t.length, PASTS[at(0)]]);
      continue;
    }
    let from = i0;
    for (let k = 1; k <= t.n; k++) {
      const i = i0 + k;
      if (at(i) === at(i - 1)) continue;
      // (each run reaches halfway to the next sample, where the edge changes)
      runs.push([side, (from - 0.5) * t.step, (i - 0.5) * t.step, PASTS[at(i - 1)]]);
      from = i;
    }
  }
  return runs;
}
/** The stretches of edge with a wall: [side, from, to]. */
export const wallRuns = (t: Track) => edgeRuns(t).filter((run) => run[3] === 'wall').map(([side, from, to]): [number, number, number] => [side, from, to]);
/** The stretches where the road drops away: [side, from, to, what]. */
export const openRuns = (t: Track) => edgeRuns(t).filter((run) => run[3] !== 'wall');

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
 *
 * A statue stands solid in the road. A trench is a hole right across it, `len` long from s and `w` either side of d,
 * with steel plates over the rest of the road (see Course in courses.ts): drop into it and you are put back at `back`.
 *
 * Some only join in later in the race: a hazard with a `lap` is there for a kart from that lap of its own on (each
 * kart's own lap, so every screen agrees about every kart); until then it is drawn standing by, out of the way.
 *
 * The set pieces run on the race clock too (see hazState in logic.ts), so every screen agrees about them without a
 * word going over the network. A hammer is a pile driver that slams down on the spot every `every` seconds (first at
 * race time `phase`) and sits on the ground `on` seconds: solid while it is down, flattening whoever is under it as it
 * comes down. A bollard is a bank of security bollards `w` wide across the road at d that rises every `every` seconds
 * for `on` seconds, with an amber warning `warn` seconds before: solid while up. A rotor is a lawn sprinkler, a solid
 * hub of radius r with a jet `arm` meters long turning at `spin` radians a second from angle `a0` (0 along the road,
 * +pi/2 to the right): the jet spins you. A wrecker is a wrecking ball swinging across the road like a cow walks
 * (swing, speed, phase): it tumbles you and throws you aside. Wet is a patch of wet road: no grip.
 *
 * A panel is a pane of the glass road that blinks out on the clock, a timed hole: `len` long from s and `w` either side
 * of d, open (nothing under you, and you fall) for `on` seconds every `every`, flickering `warn` seconds before; fall
 * through and you are put back at `back`. A geyser is a grate in the road that blows a column of flame up for `on`
 * seconds every `every`, glowing `warn` seconds before: it spins you. `look` is how the scene dresses a set piece on a
 * course of its own (a pile driver as a carillon bell, say); nothing else reads it.
 *
 * On the water (Redwood Slough): a whirl is a whirlpool that spins up on the clock like a panel opens, `on` seconds every
 * `every` with `warn` seconds of foam turning first, pulling a kart within `pull` of its middle toward it (`power` meters a
 * second squared at the middle) and round it (`spin`: +1 one way, -1 the other), and sucking one under within `core` of
 * it; its r is how close the CPUs keep (the core and a margin), and from a lap `wander` [swing, speed, from lap] it drifts
 * across the channel. A launch (the coach's), a barge (a tug and its barge) and a log drive in their lanes like a bus,
 * a span vessel only on its stretch `span` of the course, once every `every` seconds from race time `phase` (gone the rest
 * of the time); a vessel with a `wake` leaves one behind it, and one with `priority` has right of way through the set
 * pieces as a bus does. A ferry crosses the channel on its chain like a golf cart on its path, and a buoy stands solid.
 *
 * Traffic (Hoover Nights): a car or a van drives a stretch of the course `span` like a vessel, oncoming with a negative
 * drive, pulling out of a side street at its start and turning off into one at its end (`bay`: where across the road the
 * side streets meet it, past the wall); a shuttle is an articulated Marguerite crossing the road at s, `len` long (across the road) and 2r
 * wide (along it), at `speed` meters a second across (+ to the right), starting `cross` past the middle of the road, once
 * every `every` seconds from race time `phase`; it sits out any crossing a bus doing its rounds would meet. A tether is
 * the Stanford Tree on a bungee from its post at d: every `every` seconds (from `phase`) it crouches, lunges out to `aim`
 * and springs back; it tumbles you while it lunges and is solid sat by its post. `tau` marks traffic that keeps time with
 * the class (see createRace): it runs faster at 200cc and slower at 50cc, as the karts do.
 */
export type HazardKind = 'mud' | 'oil' | 'hay' | 'rock' | 'planter' | 'cow' | 'bike' | 'bus' | 'cart' | 'golfer' | 'ball' | 'sand' | 'water' | 'pin' | 'statue' | 'trench' | 'hammer' | 'bollard' | 'wrecker' | 'rotor' | 'wet' | 'panel' | 'geyser' | 'whirl' | 'launch' | 'barge' | 'log' | 'ferry' | 'buoy' | 'car' | 'van' | 'shuttle' | 'tether';
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
  lap?: number;
  /** A trench across the road: `len` meters long from s, `w` either side of d, and the s you are put back at (`back`). */
  len?: number;
  /** A trench: meters either side of d. A bollard bank: how wide it is across the road. */
  w?: number;
  back?: number;
  /** A set piece's timing: seconds live each cycle, and the warning before it (see HazardKind). */
  on?: number;
  warn?: number;
  /** A rotor's jet: its length, how fast it turns (radians a second, negative the other way) and where it points at t=0. */
  arm?: number;
  spin?: number;
  a0?: number;
  look?: string;
  /** A whirlpool (see HazardKind): how far its pull reaches, its core, how hard it pulls, and [swing, speed, from lap]. */
  pull?: number;
  core?: number;
  power?: number;
  wander?: [number, number, number];
  /** A vessel that drives only from s0 to s1 (s1 past the end of the lap for one over the line), once every `every` s. */
  span?: [number, number];
  /** How big a wake a vessel leaves (0 to 1), and whether the set pieces stand aside for it. */
  wake?: number;
  priority?: boolean;
  /** Traffic (see HazardKind): a shuttle's start past the middle of the road; where a car's side streets meet the road (d). */
  cross?: number;
  bay?: number;
  /** The Tree's lunge: where across the road it springs out to. */
  aim?: number;
  /** Traffic that keeps time with the class (see createRace). */
  tau?: boolean;
};
/** How big each kind is unless a course says otherwise (a bollard's r is the bank's thickness along the road). */
export const HAZARD_R: Record<HazardKind, number> = { mud: 3.4, oil: 2.3, hay: 1.25, rock: 1.4, planter: 1.6, cow: 1.5, bike: 1, bus: 1.3, cart: 0.8, golfer: 0.8, ball: 0.55, sand: 2.8, water: 20, pin: 0.5, statue: 1.4, trench: 2, hammer: 1.7, bollard: 0.35, wrecker: 1.3, rotor: 0.6, wet: 5, panel: 2.7, geyser: 1.1, whirl: 2.6, launch: 1.1, barge: 3, log: 0.35, ferry: 2.2, buoy: 0.3, car: 0.95, van: 1.15, shuttle: 1.4, tether: 1.2 };
/** A bus is this long, nose to tail, and so is a golf cart. */
export const BUS_LEN = 9.6;
export const CART_LEN = 3.1;
/** And on the water a coach's launch, a tug with its barge, and a drifting log. */
export const VESSEL_LEN = { launch: 6.5, barge: 34, log: 5 };
/** And on campus a car, a delivery van, and the articulated Marguerite that crosses the road (nose to tail, across it). */
export const TRAFFIC_LEN = { car: 4.4, van: 6.2, shuttle: 18 };
/** Something that drives laps of the course in its own lane (or a stretch of it), collided with as a box. */
export const drives = (h: Hazard) => (h.kind === 'bus' || h.kind === 'cart' || h.kind === 'launch' || h.kind === 'barge' || h.kind === 'log' || h.kind === 'car' || h.kind === 'van') && !!h.drive;
/** How long a bus, a driving cart, a vessel or a car is. */
export const lengthOf = (h: Hazard) => (h.kind === 'bus' ? BUS_LEN : h.kind === 'launch' || h.kind === 'barge' || h.kind === 'log' ? VESSEL_LEN[h.kind] : h.kind === 'car' || h.kind === 'van' || h.kind === 'shuttle' ? TRAFFIC_LEN[h.kind] : CART_LEN);
/** A car or a van on the road (oncoming traffic and the like, see HazardKind). */
export const traffic = (kind: HazardKind) => kind === 'car' || kind === 'van';
/** Whether a hazard is there yet for a kart on lap `lap` (see `lap` above). */
export const awake = (h: Hazard, lap: number) => !h.lap || lap >= h.lap;
/** Things you bounce off (or that spin you out when you run into them); the rest you drive through or over. */
export const solid = (kind: HazardKind) => kind !== 'mud' && kind !== 'oil' && kind !== 'sand' && kind !== 'water' && kind !== 'ball' && kind !== 'trench' && kind !== 'wet' && kind !== 'panel' && kind !== 'geyser' && kind !== 'whirl';
/** The set pieces that come and go on the race clock: solid or in the way only some of the time (see hazState). */
export const timed = (kind: HazardKind) => kind === 'hammer' || kind === 'bollard' || kind === 'wrecker' || kind === 'rotor' || kind === 'panel' || kind === 'geyser' || kind === 'whirl' || kind === 'shuttle' || kind === 'tether';
/**
 * How far into its cycle (0 up to `every`) a timed hazard is at race time `time`: the cycle is `every` seconds long
 * and the first starts at `phase` (golf balls land on that beat, a hammer slams on it, a bank rises on it).
 */
export const cycleAt = (h: Hazard, time: number, every = h.every ?? 1) => (((time - (h.phase ?? 0)) % every) + every) % every;
/** Whether a kart's middle at (s, d) is over a trench (a hole across the road). */
export const inTrench = (t: Track, h: Hazard, s: number, d: number) => {
  const ds = deltaS(t, h.s, s);
  return ds >= 0 && ds <= (h.len ?? 0) && Math.abs(d - h.d) < (h.w ?? h.r);
};

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

export type Layout = {
  boxes: { s: number; d: number }[];
  coins: { s: number; d: number }[];
  /** Dash panels; a kicker (`kick`, meters a second across the road, + to the right) also shoves you toward its side. */
  dashes: { s: number; d: number; kick?: number }[];
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
