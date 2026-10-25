// The detail on a kart beyond its painted body (see makeKart in scene.ts), in one mesh per kart: the steel tube frame
// and nerf bars, the bumpers, the engine and its air box, the chain guard, the steering column, the driver's arms in
// their suit, gloves and visor, and the number roundels; and the wheels' rims, which turn with them.
import type { T } from './gl';

type Three = typeof import('three');
type RGB = [number, number, number];

type Kit = { mat: T.MeshLambertMaterial; rim: T.BufferGeometry; prims: { box: T.BoxGeometry; cyl: T.CylinderGeometry; ball: T.SphereGeometry } };
const kits = new WeakMap<object, Kit>();

/** What every kart's detail shares (one material, the rims' geometry), kept with the race's shared kart materials. */
function kitOf(THREE: Three, key: object): Kit {
  let k = kits.get(key);
  if (k) return k;
  const prims = { box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 10), ball: new THREE.SphereGeometry(1, 10, 8) };
  k = { mat: new THREE.MeshLambertMaterial({ vertexColors: true }), rim: rimGeometry(THREE, prims), prims };
  kits.set(key, k);
  return k;
}

function build(THREE: Three, parts: { g: T.BufferGeometry; m: T.Matrix4; c: RGB }[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const part of parts) {
    const g = part.g.index ? part.g.toNonIndexed() : part.g;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    nm.copy(part.m).invert().transpose();
    for (let k = 0; k < p.count; k++) {
      v.fromBufferAttribute(p, k).applyMatrix4(part.m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, k).transformDirection(nm);
      nrm.push(v.x, v.y, v.z);
      col.push(...part.c);
    }
    if (g !== part.g) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

function adder(THREE: Three, prims: Kit['prims'], parts: { g: T.BufferGeometry; m: T.Matrix4; c: RGB }[]) {
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const rgb = (hex: number): RGB => {
    const c = new THREE.Color(hex);
    return [c.r, c.g, c.b];
  };
  const put = (g: T.BufferGeometry) => (hex: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, rx = 0, ry = 0, rz = 0) => {
    parts.push({ g, m: new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q.setFromEuler(e.set(rx, ry, rz)), new THREE.Vector3(sx, sy, sz)), c: rgb(hex) });
  };
  /** A tube from a to b. */
  const tube = (hex: number, a: [number, number, number], b: [number, number, number], r: number) => {
    const d = new THREE.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    const len = d.length();
    const m = new THREE.Matrix4().compose(new THREE.Vector3((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()), new THREE.Vector3(r, len, r));
    parts.push({ g: prims.cyl, m, c: rgb(hex) });
  };
  return { box: put(prims.box), cyl: put(prims.cyl), ball: put(prims.ball), tube };
}

/** A wheel's rim: a silver dish with five spokes and a dark hub nut, facing +x (it is put on the wheel's outer face). */
function rimGeometry(THREE: Three, prims: Kit['prims']) {
  const parts: { g: T.BufferGeometry; m: T.Matrix4; c: RGB }[] = [];
  const a = adder(THREE, prims, parts);
  a.cyl(0xc9ccd2, 0, 0, 0, 0.62, 0.04, 0.62, 0, 0, Math.PI / 2);
  a.cyl(0x2a2c32, 0.01, 0, 0, 0.5, 0.04, 0.5, 0, 0, Math.PI / 2);
  for (let k = 0; k < 5; k++) {
    const ang = (k / 5) * Math.PI * 2;
    a.box(0xd8dbe0, 0.03, Math.cos(ang) * 0.27, Math.sin(ang) * 0.27, 0.04, 0.54, 0.12, ang, 0, 0);
  }
  a.cyl(0x8a8e96, 0.05, 0, 0, 0.16, 0.06, 0.16, 0, 0, Math.PI / 2);
  return build(THREE, parts);
}

const wheels = new WeakMap<object, Map<string, T.BufferGeometry>>();
/**
 * One of a kart's wheels, r in radius and w wide, its rim on the outer face (side: -1 left, 1 right): the tire with its
 * tread and the spoked rim in one mesh, turning with the group it is added to.
 */
export function kartWheel(THREE: Three, key: object, r: number, w: number, side: number) {
  const kit = kitOf(THREE, key);
  let cache = wheels.get(key);
  if (!cache) wheels.set(key, (cache = new Map()));
  const id = `${r},${w},${side}`;
  let geo = cache.get(id);
  if (!geo) {
    const parts: { g: T.BufferGeometry; m: T.Matrix4; c: RGB }[] = [];
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, Math.PI / 2));
    const tire = new THREE.CylinderGeometry(1, 1, 1, 18);
    parts.push({ g: tire, m: new THREE.Matrix4().compose(new THREE.Vector3(), q, new THREE.Vector3(r, w, r)), c: [0.105, 0.11, 0.13] });
    // (the tread: blocks round the crown, a shade lighter)
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * Math.PI * 2;
      parts.push({ g: kit.prims.box, m: new THREE.Matrix4().compose(new THREE.Vector3(0, Math.cos(a) * r, Math.sin(a) * r), new THREE.Quaternion().setFromEuler(new THREE.Euler(a, 0, 0)), new THREE.Vector3(w * 0.8, 0.03, r * 0.18)), c: [0.16, 0.165, 0.18] });
    }
    // (the rim on the outer face, mirrored on the left)
    parts.push({ g: kit.rim, m: new THREE.Matrix4().compose(new THREE.Vector3(side * (w / 2 + 0.01), 0, 0), new THREE.Quaternion(), new THREE.Vector3(side, r, r)), c: [1, 1, 1] });
    geo = buildColored(THREE, parts);
    tire.dispose();
    cache.set(id, geo);
  }
  return new THREE.Mesh(geo, kit.mat);
}

/** Like build, but a part's color multiplies the colors its geometry carries (the rim's own, say), mirrored parts rewound. */
function buildColored(THREE: Three, parts: { g: T.BufferGeometry; m: T.Matrix4; c: RGB }[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const part of parts) {
    const g = part.g.index ? part.g.toNonIndexed() : part.g;
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const c = g.getAttribute('color');
    nm.copy(part.m).invert().transpose();
    const flip = part.m.determinant() < 0;
    for (let k = 0; k < p.count; k++) {
      const kk = flip ? k - (k % 3) + [0, 2, 1][k % 3] : k;
      v.fromBufferAttribute(p, kk).applyMatrix4(part.m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, kk).transformDirection(nm);
      nrm.push(v.x, v.y, v.z);
      col.push(part.c[0] * (c ? c.getX(kk) : 1), part.c[1] * (c ? c.getY(kk) : 1), part.c[2] * (c ? c.getZ(kk) : 1));
    }
    if (g !== part.g) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** The detail on a kart in `color` (its driver's suit), in the kart's own frame (+z forward). */
export function kartDetail(THREE: Three, key: object, color: string) {
  const kit = kitOf(THREE, key);
  const parts: { g: T.BufferGeometry; m: T.Matrix4; c: RGB }[] = [];
  const a = adder(THREE, kit.prims, parts);
  const suit = new THREE.Color(color).getHex();
  const steel = 0x9aa0a8;
  const dark = 0x22242a;
  // the frame: rails down either side under the body, nerf bars out over the gap between the wheels, bumpers front and
  // back
  for (const sx of [-1, 1]) {
    a.tube(steel, [sx * 0.55, 0.2, 1.7], [sx * 0.55, 0.2, -1.2], 0.035);
    a.tube(steel, [sx * 0.62, 0.26, 0.6], [sx * 0.86, 0.26, 0.45], 0.03);
    a.tube(steel, [sx * 0.86, 0.26, 0.45], [sx * 0.9, 0.26, -0.4], 0.03);
    a.tube(steel, [sx * 0.9, 0.26, -0.4], [sx * 0.62, 0.26, -0.5], 0.03);
    a.tube(steel, [sx * 0.86, 0.26, 0.15], [sx * 0.6, 0.38, 0.1], 0.025);
  }
  a.tube(steel, [-0.95, 0.38, -1.3], [0.95, 0.38, -1.3], 0.04);
  for (const sx of [-1, 1]) a.tube(steel, [sx * 0.95, 0.38, -1.3], [sx * 0.55, 0.22, -1.0], 0.035);
  a.tube(steel, [-0.5, 0.22, -1.48], [0.5, 0.22, -1.48], 0.035);
  for (const sx of [-1, 1]) a.tube(steel, [sx * 0.5, 0.22, -1.48], [sx * 0.55, 0.2, -1.2], 0.03);
  // the engine behind the seat on the right: block, finned head, its air box and the chain guard down to the axle
  a.box(0x6a6e76, -0.42, 0.62, -0.95, 0.3, 0.34, 0.4);
  for (let k = 0; k < 4; k++) a.box(0x8a8e96, -0.42, 0.82 + k * 0.05, -0.95, 0.34, 0.02, 0.44);
  a.cyl(dark, -0.42, 1.0, -0.95, 0.07, 0.1, 0.07);
  a.cyl(0xc8302a, -0.18, 0.72, -1.05, 0.13, 0.26, 0.13, 0, 0, Math.PI / 2);
  a.box(dark, -0.55, 0.45, -1.0, 0.06, 0.26, 0.5);
  // the fuel tank between the driver's knees and the steering column up to the wheel
  a.box(0xe8e8e8, 0, 0.55, 0.55, 0.26, 0.16, 0.32);
  a.tube(dark, [0, 0.5, 1.05], [0, 0.95, 0.38], 0.03);
  // the driver: arms in the suit out to the wheel, gloves on it, legs down into the nose, the visor on the helmet
  for (const sx of [-1, 1]) {
    a.tube(suit, [sx * 0.27, 1.02, -0.22], [sx * 0.24, 0.9, 0.08], 0.075);
    a.tube(suit, [sx * 0.24, 0.9, 0.08], [sx * 0.17, 1.0, 0.3], 0.065);
    a.ball(dark, sx * 0.17, 1.0, 0.32, 0.075, 0.075, 0.075);
    a.tube(suit, [sx * 0.13, 0.62, -0.1], [sx * 0.15, 0.6, 0.85], 0.09);
  }
  a.box(0x1a2a3a, 0, 1.31, 0.05, 0.42, 0.13, 0.1);
  // the number roundels on the side pods and the nose
  for (const sx of [-1, 1]) a.cyl(0xf6f6f2, sx * 0.765, 0.47, -0.1, 0.13, 0.01, 0.13, 0, 0, Math.PI / 2);
  a.cyl(0xf6f6f2, 0, 0.535, 1.5, 0.16, 0.01, 0.16);
  // the rear lights either side of the exhausts
  for (const sx of [-1, 1]) a.box(0xd8261e, sx * 0.62, 0.5, -1.35, 0.14, 0.08, 0.04);
  const mesh = new THREE.Mesh(build(THREE, parts), kit.mat);
  mesh.name = 'detail';
  return mesh;
}

/**
 * Merges a kart's static body parts that share a material into one mesh each (the paint, the dark parts, the skin, the
 * helmet), in the body's frame: the same look and the same materials (so a refinish still applies), a fraction of the
 * draws. Groups and anything in `keep` (the sparks, which blink) are left alone.
 */
export function mergeByMaterial(THREE: Three, body: T.Object3D, keep: Set<T.Object3D>) {
  const byMat = new Map<T.Material, T.Mesh[]>();
  for (const o of body.children) {
    const m = o as T.Mesh;
    if (!m.isMesh || keep.has(o) || o.children.length || Array.isArray(m.material) || o.name === 'detail') continue;
    let list = byMat.get(m.material);
    if (!list) byMat.set(m.material, (list = []));
    list.push(m);
  }
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const [mat, list] of byMat) {
    if (list.length < 2) continue;
    const pos: number[] = [];
    const nrm: number[] = [];
    for (const m of list) {
      m.updateMatrix();
      const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      nm.copy(m.matrix).invert().transpose();
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(m.matrix);
        pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, k).transformDirection(nm);
        nrm.push(v.x, v.y, v.z);
      }
      if (g !== m.geometry) g.dispose();
      m.removeFromParent();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    const merged = new THREE.Mesh(geo, mat);
    merged.userData.kartBody = true;
    body.add(merged);
  }
}
