// Small helpers for building models out of many simple parts as one mesh (Redwood Slough's shells, boats and
// buildings): fewer draw calls, the same look.
import type { T } from './gl';

type Three = typeof import('three');

/** A geometry made of several, each placed by its own matrix (and given a vertex color when `color` is set). */
export function merge(THREE: Three, parts: { g: T.BufferGeometry; m: T.Matrix4; color?: [number, number, number] }[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const uvs: number[] = [];
  const withUv = parts.every((p) => p.g.getAttribute('uv'));
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const part of parts) {
    const g = part.g.index ? part.g.toNonIndexed() : part.g;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const uv = g.getAttribute('uv');
    nm.copy(part.m).invert().transpose();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k).applyMatrix4(part.m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, k).transformDirection(nm);
      nrm.push(v.x, v.y, v.z);
      if (part.color) col.push(...part.color);
      if (withUv) uvs.push(uv.getX(k), uv.getY(k));
    }
    if (g !== part.g) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  if (col.length) out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  if (withUv) out.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return out;
}

type RGB = [number, number, number];
/**
 * Builds a model out of boxes, cylinders, balls and cones (and any geometry), each placed in the model's own frame and
 * colored: all of them one mesh, and its lights another.
 */
export function modelKit(THREE: Three) {
  const prims = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), ball: new THREE.SphereGeometry(1, 10, 8), cone: new THREE.ConeGeometry(1, 1, 10) };
  const parts: { g: T.BufferGeometry; m: T.Matrix4; color: RGB }[] = [];
  const lights: { g: T.BufferGeometry; m: T.Matrix4; color: RGB }[] = [];
  const rgb = (hex: number): RGB => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
  };
  /** Where what is added next goes (set by place: a spot in the world, turned), or null for the model's own frame. */
  let base: T.Matrix4 | null = null;
  const M = (x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
    return base ? base.clone().multiply(m) : m;
  };
  const put = (kind: keyof typeof prims) => (hex: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
    parts.push({ g: prims[kind], m: M(x, y, z, sx, sy, sz, rx, ry, rz), color: rgb(hex) });
  };
  return {
    THREE,
    /** Adds what comes next at (x, y, z) turned by ry (or, with no arguments, in the model's own frame again). */
    place(x?: number, y = 0, z = 0, ry = 0) {
      base = x === undefined ? null : new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, ry, 0)), new THREE.Vector3(1, 1, 1));
    },
    box: put('box'),
    cyl: put('cyl'),
    ball: put('ball'),
    cone: put('cone'),
    geo: (g: T.BufferGeometry, hex: number, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) => {
      parts.push({ g, m: M(x, y, z, sx, sy, sz, rx, ry, rz), color: rgb(hex) });
    },
    /** A running light (or a lamp): a small bright ball. */
    light: (hex: number, x: number, y: number, z: number, r = 0.12) => {
      lights.push({ g: prims.ball, m: M(x, y, z, r, r, r), color: rgb(hex) });
    },
    /** A lit panel (a window aglow, a lamp's lens): a box that shines. */
    glow: (hex: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
      lights.push({ g: prims.box, m: M(x, y, z, sx, sy, sz, rx, ry, rz), color: rgb(hex) });
    },
    /** How many parts so far (to tell whether there are any). */
    count: () => parts.length,
    build(mat: T.Material, litMat: T.Material) {
      const g = new THREE.Group();
      g.add(new THREE.Mesh(merge(THREE, parts), mat));
      if (lights.length) g.add(new THREE.Mesh(merge(THREE, lights), litMat));
      for (const p of Object.values(prims)) p.dispose();
      return g;
    },
  };
}
export type ModelKit = ReturnType<typeof modelKit>;


/**
 * A boat's hull: flat-bottomed and flared, fine at the bow (where its forefoot rises), square at the transom, from
 * -len/2 to +len/2 along z, `beam` wide and `depth` deep; closed over the top when decked.
 */
export function boatHull(THREE: Three, len: number, beam: number, depth: number, decked: boolean) {
  const N = 18;
  const pos: number[] = [];
  const idx: number[] = [];
  const sec = (z: number) => {
    const u = (z + len / 2) / len;
    const w = (beam / 2) * (u < 0.62 ? 1 - 0.08 * (1 - u / 0.62) : Math.sqrt(Math.max(0, 1 - ((u - 0.62) / 0.38) ** 2)));
    const keel = u < 0.7 ? 0 : depth * 0.85 * ((u - 0.7) / 0.3) ** 1.6;
    const top = depth * (1 + 0.12 * Math.max(0, u - 0.6));
    // (gunwale, chine, bottom, keel, and back up the other side)
    return [[-w, top], [-w * 0.96, depth * 0.3 + keel * 0.6], [-w * 0.55, keel + 0.02], [0, keel], [w * 0.55, keel + 0.02], [w * 0.96, depth * 0.3 + keel * 0.6], [w, top]];
  };
  const P = 7;
  for (let i = 0; i <= N; i++) {
    const z = -len / 2 + (len * i) / N;
    for (const [x, y] of sec(z)) pos.push(x, y, z);
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < P - 1; j++) {
      const a = i * P + j;
      idx.push(a, a + P, a + 1, a + 1, a + P, a + P + 1);
    }
  }
  // the transom: a fan from the middle of the stern section
  const c0 = pos.length / 3;
  pos.push(0, depth * 0.5, -len / 2);
  for (let j = 0; j < P - 1; j++) idx.push(c0, j + 1, j);
  idx.push(c0, 0, P - 1);
  if (decked) {
    // (a deck across the top, a little crowned)
    const d0 = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const z = -len / 2 + (len * i) / N;
      const q = sec(z);
      pos.push(q[0][0], q[0][1], z, 0, q[0][1] + 0.06, z, q[6][0], q[6][1], z);
    }
    for (let i = 0; i < N; i++) {
      const a = d0 + i * 3;
      idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3, a + 1, a + 2, a + 4, a + 2, a + 5, a + 4);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A person standing: legs, a jacket, arms, a head and a cap; facing +z, their feet at (x, y, z). */
export function person(mk: ModelKit, x: number, y: number, z: number, coat: number, cap: number) {
  for (const sd of [-1, 1]) mk.cyl(0x2b3340, x + sd * 0.11, y + 0.42, z, 0.08, 0.84, 0.08);
  mk.box(coat, x, y + 1.12, z, 0.46, 0.6, 0.28);
  for (const sd of [-1, 1]) mk.cyl(coat, x + sd * 0.29, y + 1.1, z + 0.05, 0.065, 0.55, 0.065, 0.2, 0, sd * 0.12);
  mk.ball(0xe8bf98, x, y + 1.58, z, 0.14, 0.16, 0.14);
  mk.ball(cap, x, y + 1.66, z, 0.15, 0.08, 0.15);
  mk.box(cap, x, y + 1.64, z + 0.14, 0.2, 0.025, 0.14);
}

