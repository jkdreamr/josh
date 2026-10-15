// Pure geometry and colour helpers for dressing the tower: flat shaded vertex coloured triangles that scene.ts and
// the circle modules push into one merged mesh, and the seeded noise that keeps the dressing the same every visit.
import { clamp, lerp } from './gl';

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

export function quad(out: Tri, a: number[], b: number[], c: number[], d: number[], color: RGB, shade = 1) {
  // a b c d counter clockwise seen from outside; normal from the first three
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  for (const p of [a, b, c, a, c, d]) {
    out.pos.push(p[0], p[1], p[2]);
    out.nor.push(nx, ny, nz);
    out.col.push(color[0] * shade, color[1] * shade, color[2] * shade);
  }
}

/**
 * A ledge: a sector of a ring between two radii and two heights, with flat shaded faces. Built in world space around
 * the tower axis, or around angle 0 when `local` (for ledges that move).
 */
export function sector(out: Tri, a0: number, a1: number, r0: number, r1: number, y0: number, y1: number, top: RGB, side: RGB, opts: { inner?: boolean; segs?: number; local?: boolean } = {}) {
  const segs = opts.segs ?? Math.max(2, Math.ceil(((a1 - a0) * r1) / 0.7));
  const P = (a: number, r: number, y: number) => [Math.cos(a) * r, y, Math.sin(a) * r];
  for (let i = 0; i < segs; i++) {
    const s0 = a0 + ((a1 - a0) * i) / segs;
    const s1 = a0 + ((a1 - a0) * (i + 1)) / segs;
    // top and bottom
    quad(out, P(s0, r0, y1), P(s0, r1, y1), P(s1, r1, y1), P(s1, r0, y1), top, 1);
    quad(out, P(s0, r0, y0), P(s1, r0, y0), P(s1, r1, y0), P(s0, r1, y0), side, 0.5);
    // outer and inner
    quad(out, P(s0, r1, y0), P(s1, r1, y0), P(s1, r1, y1), P(s0, r1, y1), side, 0.9);
    if (opts.inner !== false) quad(out, P(s0, r0, y0), P(s0, r0, y1), P(s1, r0, y1), P(s1, r0, y0), side, 0.75);
  }
  // the two ends
  quad(out, P(a0, r0, y0), P(a0, r0, y1), P(a0, r1, y1), P(a0, r1, y0), side, 0.8);
  quad(out, P(a1, r0, y0), P(a1, r1, y0), P(a1, r1, y1), P(a1, r0, y1), side, 0.8);
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
