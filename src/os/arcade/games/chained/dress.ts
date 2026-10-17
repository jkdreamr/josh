// Pure geometry and colour helpers for dressing the tower: flat shaded vertex coloured triangles that scene.ts and
// the circle modules push into one merged mesh, and the seeded noise that keeps the dressing the same every visit.
import { clamp, lerp } from './gl.ts';
import type { Palette, Platform } from './level.ts';

/** The three module, passed in at runtime so nothing here imports it (type only, erased at build). */
export type Three = typeof import('three');
export type RGB = [number, number, number];

/** Deterministic scatter, so the tower is dressed the same every visit. */
export function scatter(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

export const hexToRgb = (hex: string): RGB => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
export const mixHex = (a: string, b: string, t: number) => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], t) * 255));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};
export const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
export const vary = (c: RGB, rng: () => number, amount = 0.08): RGB => {
  const k = 1 + (rng() - 0.5) * amount * 2;
  return [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)];
};

/** Flat shaded, vertex coloured triangles waiting to become one BufferGeometry. */
export type Tri = { pos: number[]; nor: number[]; col: number[] };
export const tri = (): Tri => ({ pos: [], nor: [], col: [] });

/** One colour for a face, or one per corner (a b c d) so corners can be shaded apart. */
export type Tint = RGB | [RGB, RGB, RGB, RGB];
const TAU = Math.PI * 2;
const cornerTint = (color: Tint, i: number): RGB => (typeof color[0] === 'number' ? (color as RGB) : (color as [RGB, RGB, RGB, RGB])[i]);

/** The unit normal of a face from its first three corners. */
const normalOf = (a: number[], b: number[], c: number[]): RGB => {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  return [nx / l, ny / l, nz / l];
};

export function quad(out: Tri, a: number[], b: number[], c: number[], d: number[], color: Tint, shade = 1) {
  // a b c d counter clockwise seen from outside; each triangle takes its own normal, the same one when the quad is
  // flat, so a roughened corner still shades true
  const n1 = normalOf(a, b, c);
  const n2 = normalOf(a, c, d);
  const ca = cornerTint(color, 0);
  const cb = cornerTint(color, 1);
  const cc = cornerTint(color, 2);
  const cd = cornerTint(color, 3);
  const corners: [number[], RGB, RGB][] = [
    [a, ca, n1],
    [b, cb, n1],
    [c, cc, n1],
    [a, ca, n2],
    [c, cc, n2],
    [d, cd, n2],
  ];
  for (const [p, col, n] of corners) {
    out.pos.push(p[0], p[1], p[2]);
    out.nor.push(n[0], n[1], n[2]);
    out.col.push(col[0] * shade, col[1] * shade, col[2] * shade);
  }
}

/** One triangle, a b c counter clockwise seen from outside. */
function triFace(out: Tri, a: number[], b: number[], c: number[], color: RGB, shade = 1) {
  const [nx, ny, nz] = normalOf(a, b, c);
  for (const p of [a, b, c]) {
    out.pos.push(p[0], p[1], p[2]);
    out.nor.push(nx, ny, nz);
    out.col.push(color[0] * shade, color[1] * shade, color[2] * shade);
  }
}

/** A quad whose winding is flipped when needed so its normal agrees with `dir`. */
function facing(out: Tri, a: number[], b: number[], c: number[], d: number[], dir: number[], color: RGB, shade = 1) {
  const n = normalOf(a, b, c);
  if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0) quad(out, a, d, c, b, color, shade);
  else quad(out, a, b, c, d, color, shade);
}

export type SectorOpts = {
  /** build the inner face (against the core it is hidden) */
  inner?: boolean;
  segs?: number;
  /** build around angle 0 instead of the tower axis, for ledges that move */
  local?: boolean;
  /** a seeded 0..1 source: jitters the outer radius per segment (up to 0.14 m) and the top corners (up to 0.03 m) */
  rough?: () => number;
  /** the ends and the outer face lean inward toward the bottom by this many metres */
  undercut?: number;
  /** the top plane tilts by these slopes, radial then tangential, in metres per metre */
  skew?: [number, number];
  /** a raised band along the outer rim at the top, in the top colour times k */
  lip?: { w: number; h: number; k: number };
  /** colour per top segment */
  topOf?: (i: number, segs: number) => RGB;
  /** the bottom face colour, default the side colour times 0.55 */
  bottomBand?: RGB;
  /** darkens the two inner top corners by this factor */
  cornerShade?: number;
};

/**
 * A ledge: a sector of a ring between two radii and two heights, with flat shaded faces. Built in world space around
 * the tower axis, or around angle 0 when `local` (for ledges that move). The inner radius is always exact; the
 * options rough up the outer rim, lean the sides, tilt the top or add a lip, never the walkable band.
 */
export function sector(out: Tri, a0: number, a1: number, r0: number, r1: number, y0: number, y1: number, top: RGB, side: RGB, opts: SectorOpts = {}) {
  const segs = opts.segs ?? Math.max(2, Math.ceil(((a1 - a0) * r1) / 0.7));
  const full = a1 - a0 >= TAU - 1e-6;
  const rough = opts.rough;
  const under = opts.undercut ?? 0;
  const skew = opts.skew;
  const lip = opts.lip;
  const bottom = opts.bottomBand;
  const aMid = (a0 + a1) / 2;
  const rMid = (r0 + r1) / 2;
  // the bottom's end angles pulled in by the undercut, measured along the arc
  const ua = full ? 0 : under / rMid;
  // per boundary: the top angle, the bottom angle, the outer radius and the top heights at the inner and outer corner
  const sT: number[] = [];
  const sB: number[] = [];
  const rO: number[] = [];
  const yI: number[] = [];
  const yO: number[] = [];
  for (let j = 0; j <= segs; j++) {
    const t = j / segs;
    const wrap = full && j === segs;
    const s = a0 + (a1 - a0) * t;
    sT.push(s);
    sB.push(a0 + ua + (a1 - a0 - 2 * ua) * t);
    if (wrap) {
      // the last boundary of a full ring is the first again, so the rim closes
      rO.push(rO[0]);
      yI.push(yI[0]);
      yO.push(yO[0]);
      continue;
    }
    // the rim never crosses the inner radius, so a rough band thinner than the jitter stays a band
    const ro = rough ? Math.max(r0 + 0.02, r1 + (rough() - 0.5) * 0.28) : r1;
    rO.push(ro);
    let yi = y1;
    let yo = y1;
    if (rough) {
      yi += (rough() - 0.5) * 0.06;
      yo += (rough() - 0.5) * 0.06;
    }
    if (skew) {
      const tang = (s - aMid) * rMid;
      yi += skew[0] * (r0 - rMid) + skew[1] * tang;
      yo += skew[0] * (ro - rMid) + skew[1] * tang;
    }
    yI.push(yi);
    yO.push(yo);
  }
  const P = (a: number, r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
  // the corners are listed clockwise seen from outside (the angle grows toward +z), so each face is handed to quad
  // reversed to wind counter clockwise and face out
  const face = (a: number[], b: number[], c: number[], d: number[], color: Tint, k: number) => quad(out, a, d, c, b, color, k);
  // the top height at a boundary and radius, interpolated between the inner and outer corner
  const yAt = (j: number, r: number) => lerp(yI[j], yO[j], (r - r0) / Math.max(1e-6, rO[j] - r0));
  // where the walkable top ends: at the lip's inner edge when there is one
  const rTop = (j: number) => (lip ? rO[j] - lip.w : rO[j]);
  const lipTop: RGB | undefined = lip ? shade(top, lip.k) : undefined;
  for (let i = 0; i < segs; i++) {
    const j0 = i;
    const j1 = i + 1;
    const topC = opts.topOf ? opts.topOf(i, segs) : top;
    // top: the two inner corners of the whole slab may be darkened
    let tint: Tint = topC;
    if (opts.cornerShade !== undefined && !full && (i === 0 || i === segs - 1)) {
      // face hands quad its corners as a, d, c, b, so the tuple runs inner start, inner end, outer end, outer start
      const dark = shade(topC, opts.cornerShade);
      tint = [i === 0 ? dark : topC, i === segs - 1 ? dark : topC, topC, topC];
    }
    face(P(sT[j0], r0, yI[j0]), P(sT[j0], rTop(j0), yAt(j0, rTop(j0))), P(sT[j1], rTop(j1), yAt(j1, rTop(j1))), P(sT[j1], r0, yI[j1]), tint, 1);
    // bottom
    if (bottom) face(P(sB[j0], r0, y0), P(sB[j1], r0, y0), P(sB[j1], rO[j1] - under, y0), P(sB[j0], rO[j0] - under, y0), bottom, 1);
    else face(P(sB[j0], r0, y0), P(sB[j1], r0, y0), P(sB[j1], rO[j1] - under, y0), P(sB[j0], rO[j0] - under, y0), side, 0.55);
    // outer, up to the lip's top when there is one
    const yo0 = lip ? yO[j0] + lip.h : yO[j0];
    const yo1 = lip ? yO[j1] + lip.h : yO[j1];
    face(P(sB[j0], rO[j0] - under, y0), P(sB[j1], rO[j1] - under, y0), P(sT[j1], rO[j1], yo1), P(sT[j0], rO[j0], yo0), side, 0.9);
    if (opts.inner !== false) face(P(sB[j0], r0, y0), P(sT[j0], r0, yI[j0]), P(sT[j1], r0, yI[j1]), P(sB[j1], r0, y0), side, 0.75);
    if (lip && lipTop) {
      // the lip: its top and the small face looking back across the ledge
      const ri0 = rTop(j0);
      const ri1 = rTop(j1);
      face(P(sT[j0], ri0, yAt(j0, ri0) + lip.h), P(sT[j0], rO[j0], yo0), P(sT[j1], rO[j1], yo1), P(sT[j1], ri1, yAt(j1, ri1) + lip.h), lipTop, 1);
      face(P(sT[j0], ri0, yAt(j0, ri0)), P(sT[j1], ri1, yAt(j1, ri1)), P(sT[j1], ri1, yAt(j1, ri1) + lip.h), P(sT[j0], ri0, yAt(j0, ri0) + lip.h), lipTop, 0.8);
    }
  }
  if (full) return;
  // the two ends: the start looks back along the arc, the end looks ahead
  const last = segs;
  face(P(sB[0], r0, y0), P(sB[0], rO[0] - under, y0), P(sT[0], rO[0], yO[0]), P(sT[0], r0, yI[0]), side, 0.8);
  face(P(sB[last], r0, y0), P(sT[last], r0, yI[last]), P(sT[last], rO[last], yO[last]), P(sB[last], rO[last] - under, y0), side, 0.8);
  if (lip && lipTop) {
    const ri0 = rTop(0);
    const ri1 = rTop(last);
    face(P(sT[0], ri0, yAt(0, ri0)), P(sT[0], rO[0], yO[0]), P(sT[0], rO[0], yO[0] + lip.h), P(sT[0], ri0, yAt(0, ri0) + lip.h), lipTop, 0.8);
    face(P(sT[last], ri1, yAt(last, ri1)), P(sT[last], ri1, yAt(last, ri1) + lip.h), P(sT[last], rO[last], yO[last] + lip.h), P(sT[last], rO[last], yO[last]), lipTop, 0.8);
  }
}

/**
 * An axis aligned box of half sizes sx sy sz centred at (cx, cy, cz), turned by yaw about y: six faces with outward
 * normals, the top colour on top, the side colour elsewhere and the bottom a little darker.
 */
export function box(out: Tri, cx: number, cy: number, cz: number, sx: number, sy: number, sz: number, yaw: number, top: RGB, side: RGB) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // a corner: local x and z turned about y, then moved to the centre
  const P = (x: number, y: number, z: number) => [cx + x * c + z * s, cy + y, cz - x * s + z * c];
  quad(out, P(-sx, sy, -sz), P(-sx, sy, sz), P(sx, sy, sz), P(sx, sy, -sz), top, 1);
  quad(out, P(-sx, -sy, -sz), P(sx, -sy, -sz), P(sx, -sy, sz), P(-sx, -sy, sz), side, 0.7);
  quad(out, P(sx, -sy, sz), P(sx, -sy, -sz), P(sx, sy, -sz), P(sx, sy, sz), side, 1);
  quad(out, P(-sx, -sy, -sz), P(-sx, -sy, sz), P(-sx, sy, sz), P(-sx, sy, -sz), side, 1);
  quad(out, P(-sx, -sy, sz), P(sx, -sy, sz), P(sx, sy, sz), P(-sx, sy, sz), side, 1);
  quad(out, P(sx, -sy, -sz), P(-sx, -sy, -sz), P(-sx, sy, -sz), P(sx, sy, -sz), side, 1);
}

export function geometryOf(THREE: Three, t: Tri) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  return geo;
}

/**
 * A corbel under a ledge: a block at angle a spanning r0..r1, w wide along the arc at its top (at height y) and
 * tapering to an edge h below, with outward normals.
 */
export function wedge(out: Tri, a: number, r0: number, r1: number, y: number, w: number, h: number, colour: RGB) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  // a point from its radius, its offset along the tangent and its height
  const P = (r: number, t: number, yy: number) => [c * r - s * t, yy, s * r + c * t];
  const hw = w / 2;
  quad(out, P(r0, -hw, y), P(r0, hw, y), P(r1, hw, y), P(r1, -hw, y), colour, 1);
  quad(out, P(r1, hw, y), P(r0, hw, y), P(r0, 0, y - h), P(r1, 0, y - h), colour, 0.85);
  quad(out, P(r0, -hw, y), P(r1, -hw, y), P(r1, 0, y - h), P(r0, 0, y - h), colour, 0.7);
  triFace(out, P(r1, -hw, y), P(r1, hw, y), P(r1, 0, y - h), colour, 0.9);
  triFace(out, P(r0, hw, y), P(r0, -hw, y), P(r0, 0, y - h), colour, 0.75);
}

/**
 * An extruded polygon: pts are [x, z] corners counter clockwise seen from above (convex, fanned from the first), the
 * top at y1 in the top colour, the bottom at y0 in the side colour times 0.55 and the walls in the side colour.
 */
export function prism(out: Tri, pts: number[][], y0: number, y1: number, top: RGB, side: RGB) {
  const n = pts.length;
  if (n < 3) return;
  const at = (p: number[], y: number) => [p[0], y, p[1]];
  for (let i = 1; i < n - 1; i++) {
    triFace(out, at(pts[0], y1), at(pts[i], y1), at(pts[i + 1], y1), top, 1);
    triFace(out, at(pts[0], y0), at(pts[i + 1], y0), at(pts[i], y0), side, 0.55);
  }
  for (let i = 0; i < n; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % n];
    quad(out, at(p, y0), at(q, y0), at(q, y1), at(p, y1), side, 1);
  }
}

/**
 * A pointed arch standing in the vertical plane turned by yaw about y, its feet on the line through (cx, cy, cz):
 * two circular arcs of width w meeting h above the feet, with a square section of the given side. Outward normals.
 */
export function arch(out: Tri, cx: number, cy: number, cz: number, yaw: number, w: number, h: number, section: number, segs: number, colour: RGB) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  // in plane u (across the arch), up, and the plane normal n
  const P = (u: number, y: number, nn: number) => [cx + u * c + nn * s, cy + y, cz - u * s + nn * c];
  const N = [s, 0, c];
  const hs = section / 2;
  // each arc is centred on the far side of the axis so the two meet in a point
  const R = (w * w * 0.25 + h * h) / w;
  const d = R - w / 2;
  const apex = Math.atan2(h, d);
  for (const sideSign of [-1, 1]) {
    // the arc centre, and the angle running from the foot to the apex
    const cu = -sideSign * d;
    const from = sideSign < 0 ? Math.PI : 0;
    const to = sideSign < 0 ? Math.PI - apex : apex;
    let prev: { q: number[]; e: number[] } | null = null;
    for (let k = 0; k <= segs; k++) {
      const th = from + ((to - from) * k) / segs;
      const e = [Math.cos(th), Math.sin(th)];
      const q = [cu + e[0] * R, e[1] * R];
      if (prev) {
        const p0 = prev.q;
        const e0 = prev.e;
        const E0 = [e0[0] * c, e0[1], -e0[0] * s];
        const corner = (pt: number[], ee: number[], re: number, rn: number) => P(pt[0] + ee[0] * re * hs, pt[1] + ee[1] * re * hs, rn * hs);
        // the outer (extrados), the inner (intrados), the front and the back
        facing(out, corner(p0, e0, 1, -1), corner(p0, e0, 1, 1), corner(q, e, 1, 1), corner(q, e, 1, -1), E0, colour, 1);
        facing(out, corner(p0, e0, -1, -1), corner(p0, e0, -1, 1), corner(q, e, -1, 1), corner(q, e, -1, -1), [-E0[0], -E0[1], -E0[2]], colour, 0.7);
        facing(out, corner(p0, e0, -1, 1), corner(p0, e0, 1, 1), corner(q, e, 1, 1), corner(q, e, -1, 1), N, colour, 0.85);
        facing(out, corner(p0, e0, -1, -1), corner(p0, e0, 1, -1), corner(q, e, 1, -1), corner(q, e, -1, -1), [-N[0], -N[1], -N[2]], colour, 0.85);
      } else {
        // the foot's underside
        const foot = (re: number, rn: number) => P(q[0] + e[0] * re * hs, q[1] + e[1] * re * hs, rn * hs);
        facing(out, foot(-1, -1), foot(1, -1), foot(1, 1), foot(-1, 1), [0, -1, 0], colour, 0.55);
      }
      prev = { q, e };
    }
  }
}

/** A full ring of stone: sector around the whole tower with that many segments and an inner face. */
export function ringBand(out: Tri, r0: number, r1: number, y0: number, y1: number, top: RGB, side: RGB, segs: number) {
  sector(out, 0, TAU, r0, r1, y0, y1, top, side, { inner: true, segs });
}

export type Tones = { top: RGB; side: RGB; dark: RGB; lip: RGB; bottom: RGB };
const BASES: Record<'ice' | 'iron' | 'bone', [string, string]> = {
  ice: ['#cfe9f7', '#7fb3cc'],
  iron: ['#4a4e58', '#2b2e36'],
  bone: ['#e2d8c2', '#a89c82'],
};
const clampRgb = (c: RGB): RGB => [clamp(c[0], 0, 1), clamp(c[1], 0, 1), clamp(c[2], 0, 1)];
/** The shared shading of a material family: stone from the palette, the others fixed bases tinted a little by it. */
export function tones(palette: Palette, kind: 'stone' | 'ice' | 'iron' | 'bone'): Tones {
  const light = kind === 'stone' ? palette.stone[0] : mixHex(BASES[kind][0], palette.stone[0], 0.15);
  const darkHex = kind === 'stone' ? palette.stone[1] : mixHex(BASES[kind][1], palette.stone[1], 0.15);
  const top = hexToRgb(light);
  const side = hexToRgb(darkHex);
  return { top, side, dark: shade(side, 0.6), lip: clampRgb(shade(top, 1.12)), bottom: shade(side, 0.55) };
}

/** A deterministic 0..1 from two integers, for brick and plate patterns. */
export function hash(i: number, j: number) {
  let h = Math.imul(i | 0, 0x27d4eb2d) ^ Math.imul((j | 0) + 0x9e3779b9, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** A random spot on a ledge top, kept off the edges. */
export function onLedge(p: Platform, rng: () => number, opts: { rIn?: number; rOut?: number; spanK?: number } = {}) {
  const rIn = opts.rIn ?? 0.35;
  const rOut = opts.rOut ?? 0.35;
  const spanK = opts.spanK ?? 0.8;
  const a = p.a + (rng() * 2 - 1) * p.span * spanK;
  const lo = p.r0 + rIn;
  const hi = p.r1 - rOut;
  const r = hi > lo ? lo + rng() * (hi - lo) : (p.r0 + p.r1) / 2;
  return { x: Math.cos(a) * r, y: p.y, z: Math.sin(a) * r, a, r };
}

/** Unit vectors at an angle: out away from the axis, tan along the growing angle, up. */
export function tangentFrame(a: number): { out: [number, number, number]; tan: [number, number, number]; up: [0, 1, 0] } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { out: [c, 0, s], tan: [-s, 0, c], up: [0, 1, 0] };
}
