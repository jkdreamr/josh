// The circuit: a closed centerline built from straights and arcs, smoothed so every corner eases in and out,
// then sampled every couple of meters with everything the physics, the AI and the scene need to know about it.
// Coordinates are meters on a flat plane (x east, y north). Pure module, runs under node for the tests.

export type Surface = 'asphalt' | 'kerb' | 'grass' | 'gravel' | 'runoff';
/** A piece of the layout: a straight, or an arc turning right (turn > 0) or left (turn < 0) by `turn` degrees. */
export type Piece = { name?: string; len: number } | { name?: string; turn: number; r: number };

export type Circuit = {
  id: string;
  name: string;
  /** Total length in meters. */
  length: number;
  /** Number of samples; sample i sits at s = i * ds. */
  n: number;
  ds: number;
  /** Centerline positions, unit tangents, signed curvature (1/m, positive turning right). */
  px: Float64Array;
  py: Float64Array;
  tx: Float64Array;
  ty: Float64Array;
  k: Float64Array;
  /** Half width of the asphalt (white line to white line). */
  hw: Float64Array;
  /** Kerb width past the white line on the left / right (0 for none). */
  kerbL: Float64Array;
  kerbR: Float64Array;
  /** Run-off past the kerb on each side. */
  runL: Uint8Array;
  runR: Uint8Array;
  /** Distance from the centerline to the barrier on each side. */
  wallL: Float64Array;
  wallR: Float64Array;
  /** Named spans of the layout (corners, straights) as [s0, s1]. */
  marks: Record<string, [number, number]>;
  /** Sector boundaries (s where sectors 2 and 3 begin). */
  sectors: [number, number];
  /** DRS zones: detection point and activation span. */
  drs: { detect: number; from: number; to: number }[];
  /** Corner names for the HUD, with the s of their apex. */
  corners: { name: string; s: number }[];
};

export const RUNOFFS: Surface[] = ['grass', 'gravel', 'runoff'];
const RUN_GRASS = 0;
const RUN_GRAVEL = 1;
const RUN_TARMAC = 2;

const deg = Math.PI / 180;

/**
 * Autodromo Nazionale Monza, run clockwise. Corner radii and straight lengths follow the real circuit closely
 * (5.79 km, the long main straight, Rettifilo, Curva Grande, Roggia, both Lesmos, Serraglio, Ascari, the back
 * straight and the Parabolica). Two straights marked `solve` have their lengths solved so the loop closes exactly.
 */
export const MONZA: Piece[] = [
  { name: 'start', len: 600 },
  { name: 'rettifilo', turn: 80, r: 24 },
  { name: 'rettifilo', len: 16 },
  { name: 'rettifilo', turn: -76, r: 26 },
  { len: 150 },
  { name: 'grande', turn: 104, r: 330 },
  { len: 520 },
  { name: 'roggia', turn: -52, r: 40 },
  { name: 'roggia', len: 12 },
  { name: 'roggia', turn: 52, r: 44 },
  { len: 300 },
  { name: 'lesmo1', turn: 64, r: 100 },
  { len: 150 },
  { name: 'lesmo2', turn: 50, r: 84 },
  { name: 'serraglio', len: 390 },
  { name: 'kink', turn: -8, r: 700 },
  { name: 'serraglio2', len: 330 },
  { name: 'ascari', turn: -36, r: 120 },
  { name: 'ascari', turn: 66, r: 92 },
  { name: 'ascari', turn: -40, r: 150 },
  { name: 'back', len: 1000 },
  { name: 'parabolica', turn: 38, r: 86 },
  { name: 'parabolica', turn: 62, r: 135 },
  { name: 'parabolica', turn: 56, r: 300 },
  { name: 'main', len: 810 },
];
/** Indices of the two straights whose lengths close the loop: the back straight and the run to the Roggia. */
const SOLVE = [20, 6];

type Raw = { x: number[]; y: number[]; h: number[]; k: number[]; marks: Record<string, [number, number]>; length: number };

/** Lays the pieces end to end at 1 m steps and returns the curvature along the way. */
function curvatureOf(pieces: Piece[]) {
  const k: number[] = [];
  const marks: Record<string, [number, number]> = {};
  for (const p of pieces) {
    const s0 = k.length;
    if ('len' in p) for (let i = 0; i < Math.round(p.len); i++) k.push(0);
    else {
      const len = Math.round(Math.abs(p.turn) * deg * p.r);
      // every arc keeps its exact total turn even after rounding its length to whole meters
      const kk = (p.turn * deg) / len;
      for (let i = 0; i < len; i++) k.push(kk);
    }
    if (p.name) {
      const m = marks[p.name];
      marks[p.name] = m ? [m[0], k.length] : [s0, k.length];
    }
  }
  return { k, marks };
}

/** Circular moving average, which keeps the total turn (so a smoothed loop still closes its heading). */
function smoothLoop(a: number[], half: number) {
  const n = a.length;
  const out = new Array<number>(n);
  let sum = 0;
  for (let j = -half; j <= half; j++) sum += a[((j % n) + n) % n];
  for (let i = 0; i < n; i++) {
    out[i] = sum / (2 * half + 1);
    sum += a[(i + half + 1) % n] - a[(((i - half) % n) + n) % n];
  }
  return out;
}

function integrate(k: number[], h0: number): Raw {
  const n = k.length;
  const x = [0];
  const y = [0];
  const h = [h0];
  for (let i = 0; i < n; i++) {
    // midpoint rule on heading: right turns (positive curvature) turn clockwise
    const hm = h[i] - k[i] * 0.5;
    x.push(x[i] + Math.cos(hm));
    y.push(y[i] + Math.sin(hm));
    h.push(h[i] - k[i]);
  }
  return { x, y, h, k, marks: {}, length: n };
}

/** Builds the 1 m centerline, solving the two `solve` straights so the end meets the start. */
function layout(pieces: Piece[], solve: number[], h0: number, smoothing: number): Raw {
  const ps = pieces.map((p) => ({ ...p }));
  let raw: Raw | null = null;
  for (let iter = 0; iter < 6; iter++) {
    const { k, marks } = curvatureOf(ps);
    const ks = smoothLoop(k, smoothing);
    raw = integrate(ks, h0);
    raw.marks = marks;
    const n = raw.length;
    const ex = raw.x[n] - raw.x[0];
    const ey = raw.y[n] - raw.y[0];
    if (Math.hypot(ex, ey) < 0.75) break;
    // lengthening a straight moves the end along that straight's heading, so two of them form a 2x2 system
    const dirs = solve.map((idx) => {
      const { k: k2 } = curvatureOf(ps.slice(0, idx));
      const turned = k2.reduce((a, b) => a + b, 0);
      return [Math.cos(h0 - turned), Math.sin(h0 - turned)];
    });
    const [[ax, ay], [bx, by]] = dirs;
    const det = ax * by - ay * bx;
    const la = (-ex * by + ey * bx) / det;
    const lb = (-ax * ey + ay * ex) / det;
    (ps[solve[0]] as { len: number }).len += la;
    (ps[solve[1]] as { len: number }).len += lb;
  }
  // straights are laid in whole meters, so spread the last fraction of a meter of mismatch around the lap
  const r = raw!;
  const n = r.length;
  const ex = r.x[n] - r.x[0];
  const ey = r.y[n] - r.y[0];
  for (let i = 0; i <= n; i++) {
    r.x[i] -= (ex * i) / n;
    r.y[i] -= (ey * i) / n;
  }
  return r;
}

const mod = (a: number, n: number) => ((a % n) + n) % n;

export type CircuitOptions = { id: string; name: string; pieces: Piece[]; solve: number[]; heading?: number; halfWidth?: number; sample?: number };

export function buildCircuit(o: CircuitOptions): Circuit {
  const raw = layout(o.pieces, o.solve, o.heading ?? Math.PI / 2, 14);
  const L = raw.length;
  const n = Math.round(L / (o.sample ?? 2));
  const ds = L / n;
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const k = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const s = i * ds;
    const j = Math.floor(s);
    const f = s - j;
    px[i] = raw.x[j] + (raw.x[j + 1] - raw.x[j]) * f;
    py[i] = raw.y[j] + (raw.y[j + 1] - raw.y[j]) * f;
    const h = raw.h[j] + (raw.h[j + 1] - raw.h[j]) * f;
    tx[i] = Math.cos(h);
    ty[i] = Math.sin(h);
    k[i] = raw.k[mod(j, L)];
  }

  const hw = new Float64Array(n).fill(o.halfWidth ?? 6.5);
  // kerbs line both sides of every real corner, starting a little before it and running out past the exit
  const kerbL = new Float64Array(n);
  const kerbR = new Float64Array(n);
  const reach = Math.round(30 / ds);
  for (let i = 0; i < n; i++) {
    if (Math.abs(k[i]) < 1 / 260) continue;
    for (let j = -reach; j <= reach * 1.4; j++) {
      const q = mod(i + j, n);
      kerbL[q] = 1.6;
      kerbR[q] = 1.6;
    }
  }

  // run-off: gravel on the outside of fast and medium corners, tarmac at the chicanes, grass everywhere else
  const runL = new Uint8Array(n);
  const runR = new Uint8Array(n);
  const wantL = new Float64Array(n);
  const wantR = new Float64Array(n);
  const win = Math.round(90 / ds);
  for (let i = 0; i < n; i++) {
    let maxRight = 0;
    let maxLeft = 0;
    for (let j = -win; j <= win * 1.5; j++) {
      const kk = k[mod(i + j, n)];
      if (kk > maxRight) maxRight = kk;
      if (-kk > maxLeft) maxLeft = -kk;
    }
    // the outside of a right hander is on the left
    runL[i] = maxRight > 1 / 40 ? RUN_TARMAC : maxRight > 1 / 400 ? RUN_GRAVEL : RUN_GRASS;
    runR[i] = maxLeft > 1 / 40 ? RUN_TARMAC : maxLeft > 1 / 400 ? RUN_GRAVEL : RUN_GRASS;
    wantL[i] = maxRight > 1 / 400 ? 26 + Math.min(16, maxRight * 900) : 13;
    wantR[i] = maxLeft > 1 / 400 ? 26 + Math.min(16, maxLeft * 900) : 13;
  }

  // walls sit at the wanted distance unless another part of the circuit is closer
  const grid = new Map<string, number[]>();
  const cell = 40;
  const key = (x: number, y: number) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  for (let i = 0; i < n; i++) {
    const kk = key(px[i], py[i]);
    let arr = grid.get(kk);
    if (!arr) grid.set(kk, (arr = []));
    arr.push(i);
  }
  const clearance = (i: number, x: number, y: number) => {
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    let best = Infinity;
    for (let gx = cx - 1; gx <= cx + 1; gx++)
      for (let gy = cy - 1; gy <= cy + 1; gy++)
        for (const j of grid.get(`${gx},${gy}`) ?? []) {
          const gap = Math.abs(mod(j - i + n / 2, n) - n / 2) * ds;
          if (gap < 70) continue;
          best = Math.min(best, Math.hypot(px[j] - x, py[j] - y) - hw[j]);
        }
    return best;
  };
  const wallL = new Float64Array(n);
  const wallR = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    // left normal is (-ty, tx)
    const nx = -ty[i];
    const ny = tx[i];
    for (const [want, out, sign] of [
      [wantL[i], wallL, 1],
      [wantR[i], wallR, -1],
    ] as const) {
      const min = hw[i] + (sign > 0 ? kerbL[i] : kerbR[i]) + 3.5;
      let d = min;
      while (d < hw[i] + want && clearance(i, px[i] + nx * sign * (d + 1), py[i] + ny * sign * (d + 1)) > 9) d += 1;
      out[i] = d;
    }
  }
  // ease the walls so they never jump: limit how fast the distance changes along the track
  for (const w of [wallL, wallR])
    for (let pass = 0; pass < 2; pass++)
      for (let i = 0; i < 2 * n; i++) {
        const a = mod(pass ? -i : i, n);
        const b = mod(pass ? -i - 1 : i + 1, n);
        w[b] = Math.min(w[b], w[a] + ds * 0.35);
      }

  // a sample's s maps onto the 1 m layout one to one, so marks carry over directly
  const marks = raw.marks;
  const at = (name: string, f = 0.5) => {
    const m = marks[name];
    return m ? m[0] + (m[1] - m[0]) * f : 0;
  };
  const corners = [
    { name: 'Variante del Rettifilo', s: at('rettifilo') },
    { name: 'Curva Biassono', s: at('grande') },
    { name: 'Variante della Roggia', s: at('roggia') },
    { name: 'Curva di Lesmo 1', s: at('lesmo1') },
    { name: 'Curva di Lesmo 2', s: at('lesmo2') },
    { name: 'Curva del Serraglio', s: at('kink') },
    { name: 'Variante Ascari', s: at('ascari') },
    { name: 'Curva Alboreto', s: at('parabolica') },
  ];
  return {
    id: o.id,
    name: o.name,
    length: L,
    n,
    ds,
    px,
    py,
    tx,
    ty,
    k,
    hw,
    kerbL,
    kerbR,
    runL,
    runR,
    wallL,
    wallR,
    marks,
    sectors: [at('roggia', 0) - 60, at('ascari', 1) + 40],
    drs: [
      { detect: at('parabolica', 0) - 30, from: at('main', 0.15), to: at('rettifilo', 0) - 120 },
      { detect: at('lesmo2', 1) + 40, from: at('ascari', 1) + 120, to: at('parabolica', 0) - 110 },
    ],
    corners,
  };
}

let monza: Circuit | null = null;
/** The circuit, built once on first use. */
export const circuit = () => (monza ??= buildCircuit({ id: 'monza', name: 'Monza', pieces: MONZA, solve: SOLVE }));

export const wrapS = (c: Circuit, s: number) => mod(s, c.length);
/** Signed shortest distance from s0 forward to s1 (negative when s1 is behind). */
export const deltaS = (c: Circuit, s0: number, s1: number) => mod(s1 - s0 + c.length / 2, c.length) - c.length / 2;

export type Spot = { i: number; s: number; d: number };

/**
 * Nearest point on the centerline: sample index, distance along the lap and signed lateral offset (positive left).
 * With a hint (the last index) it searches nearby; without one it scans the whole lap.
 */
export function locate(c: Circuit, x: number, y: number, hint = -1): Spot {
  let best = -1;
  let bestD = Infinity;
  if (hint >= 0) {
    for (let j = -24; j <= 24; j++) {
      const i = mod(hint + j, c.n);
      const d = (c.px[i] - x) ** 2 + (c.py[i] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  if (hint < 0 || bestD > 40 * 40) {
    for (let i = 0; i < c.n; i++) {
      const d = (c.px[i] - x) ** 2 + (c.py[i] - y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
  }
  const i = best;
  const ex = x - c.px[i];
  const ey = y - c.py[i];
  const along = ex * c.tx[i] + ey * c.ty[i];
  const d = -ex * c.ty[i] + ey * c.tx[i];
  return { i, s: wrapS(c, i * c.ds + along), d };
}

/** World position at distance s along the lap and lateral offset d (positive left), with the heading there. */
export function pointAt(c: Circuit, s: number, d = 0) {
  const u = wrapS(c, s) / c.ds;
  const i = Math.floor(u) % c.n;
  const j = (i + 1) % c.n;
  const f = u - Math.floor(u);
  const tx = c.tx[i] + (c.tx[j] - c.tx[i]) * f;
  const ty = c.ty[i] + (c.ty[j] - c.ty[i]) * f;
  const tl = Math.hypot(tx, ty) || 1;
  const x = c.px[i] + (c.px[j] - c.px[i]) * f;
  const y = c.py[i] + (c.py[j] - c.py[i]) * f;
  return { x: x - (ty / tl) * d, y: y + (tx / tl) * d, heading: Math.atan2(ty, tx), i };
}

/** What a wheel at lateral offset d over sample i is rolling on. */
export function surfaceAt(c: Circuit, i: number, d: number): Surface {
  const a = Math.abs(d);
  const hw = c.hw[i];
  if (a <= hw) return 'asphalt';
  const kerb = d > 0 ? c.kerbL[i] : c.kerbR[i];
  if (a <= hw + kerb) return 'kerb';
  const run = d > 0 ? c.runL[i] : c.runR[i];
  // gravel traps start a few meters past the kerb, behind a strip of grass
  if (run === RUN_GRAVEL) return a > hw + kerb + 3 ? 'gravel' : 'grass';
  if (run === RUN_TARMAC) return a > hw + kerb + 14 ? 'gravel' : 'runoff';
  return 'grass';
}

/** Distance from the centerline to the wall on the side of offset d. */
export const wallAt = (c: Circuit, i: number, d: number) => (d >= 0 ? c.wallL[i] : c.wallR[i]);

/** Grid slots: two by two, 8 m apart, staggered across the track behind the start line. */
export function gridSlot(c: Circuit, slot: number) {
  const s = -14 - slot * 8;
  const d = slot % 2 === 0 ? 2.6 : -2.6;
  return { ...pointAt(c, s, d), s: wrapS(c, s), d };
}
