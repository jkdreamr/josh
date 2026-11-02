// The royale's vehicles: an open four seat jeep (tub, hood, windshield frame, roll bar, seats, spare wheel) and a
// motorbike, low poly and built from primitives. Each kind is three instanced meshes (the painted panels, everything
// else, the wheels), so all of them cost a handful of draw calls; every frame each car's instance follows its body,
// its wheels roll and the front ones steer. A wreck is drawn burnt black.
import { CARS, type Car, type CarKind } from '../cars.ts';
import type { Match } from '../match.ts';
import { patch, roundBox, type Shared, type T, type Three } from './common.ts';
import { merged } from './royale.ts';

type Parts = [T.BufferGeometry, number][];

/** Adds a shape to a part list, turned and moved into place. */
function put(parts: Parts, g: T.BufferGeometry, c: number, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
  if (rz) g.rotateZ(rz);
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  g.translate(x, y, z);
  parts.push([g, c]);
}

const WHITE = 0xffffff;
const STEEL = 0x2a2c2e;
const BLACK = 0x161616;
const SEAT = 0x3a3128;
const GLASS = 0x1d2a33;
const LAMP = 0xf2ecd2;

/** The jeep, nose toward -z, wheels on y = 0: [paint, trim]. */
function jeepParts(THREE: Three): [Parts, Parts] {
  const paint: Parts = [];
  const trim: Parts = [];
  const box = (p: Parts, c: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, round = 0.18) => put(p, round > 0 ? roundBox(THREE, w, h, d, round, 2) : new THREE.BoxGeometry(w, h, d), c, x, y, z, rx);
  // the tub and the hood, with the fenders over the wheels
  box(paint, WHITE, 1.86, 0.56, 3.9, 0, 0.78, 0.15);
  box(paint, WHITE, 1.7, 0.26, 1.3, 0, 1.1, -1.38);
  for (const s of [-1, 1]) {
    box(paint, WHITE, 0.32, 0.12, 1.08, s * 0.98, 1.06, -1.32, 0, 0.3);
    box(paint, WHITE, 0.32, 0.12, 1.08, s * 0.98, 1.06, 1.38, 0, 0.3);
    // the tub's sides rise a little at the back
    box(paint, WHITE, 0.1, 0.24, 1.7, s * 0.88, 1.16, 1.12, 0, 0.3);
  }
  box(paint, WHITE, 1.76, 0.24, 0.1, 0, 1.16, 2.02, 0, 0.3);
  // grille and bumpers, the underside
  box(trim, STEEL, 1.5, 0.32, 0.06, 0, 0.9, -2.05, 0, 0);
  for (let k = -3; k <= 3; k++) box(trim, BLACK, 0.06, 0.26, 0.04, k * 0.18, 0.9, -2.09, 0, 0);
  box(trim, STEEL, 2.02, 0.2, 0.2, 0, 0.56, -2.16, 0, 0.25);
  box(trim, STEEL, 2.02, 0.2, 0.2, 0, 0.56, 2.18, 0, 0.25);
  box(trim, BLACK, 1.5, 0.22, 3.4, 0, 0.45, 0.1, 0, 0);
  for (const s of [-1, 1]) {
    // headlights and tail lights
    const lamp = new THREE.CylinderGeometry(0.11, 0.11, 0.06, 12);
    put(trim, lamp, LAMP, s * 0.62, 0.98, -2.07, Math.PI / 2);
    box(trim, 0x8a1810, 0.16, 0.1, 0.04, s * 0.72, 1.12, 2.08, 0, 0);
  }
  // the windshield: a frame and its glass, tipped back a little
  const lean = -0.18;
  for (const s of [-1, 1]) box(trim, STEEL, 0.06, 0.62, 0.06, s * 0.82, 1.5, -0.76, lean, 0);
  box(trim, STEEL, 1.7, 0.06, 0.06, 0, 1.8, -0.7, 0, 0);
  box(trim, GLASS, 1.58, 0.52, 0.03, 0, 1.5, -0.76, lean, 0);
  // the roll bar over the back seats
  for (const s of [-1, 1]) box(trim, STEEL, 0.07, 0.86, 0.07, s * 0.82, 1.48, 0.55, 0, 0);
  box(trim, STEEL, 1.72, 0.07, 0.07, 0, 1.9, 0.55, 0, 0);
  for (const s of [-1, 1]) box(trim, STEEL, 0.06, 0.06, 1.4, s * 0.82, 1.9, 1.2, 0, 0);
  // seats: cushions and backs, front and back
  for (const [x, z] of [
    [-0.45, -0.15],
    [0.45, -0.15],
    [-0.45, 0.95],
    [0.45, 0.95],
  ]) {
    box(trim, SEAT, 0.56, 0.14, 0.52, x, 0.98, z - 0.02);
    box(trim, SEAT, 0.56, 0.6, 0.13, x, 1.3, z + 0.28, 0.12);
  }
  // the steering wheel on its column
  const wheel = new THREE.TorusGeometry(0.17, 0.025, 6, 16);
  put(trim, wheel, BLACK, -0.45, 1.34, -0.55, -0.95);
  put(trim, new THREE.CylinderGeometry(0.025, 0.025, 0.5, 6), BLACK, -0.45, 1.18, -0.75, 0.62);
  // the spare wheel on the tailgate
  put(trim, new THREE.CylinderGeometry(0.36, 0.36, 0.24, 16), BLACK, 0, 1.12, 2.2, Math.PI / 2);
  return [paint, trim];
}

/** The motorbike, nose toward -z: [paint, trim]. */
function bikeParts(THREE: Three): [Parts, Parts] {
  const paint: Parts = [];
  const trim: Parts = [];
  const box = (p: Parts, c: number, w: number, h: number, d: number, x: number, y: number, z: number, rx = 0, round = 0.25) => put(p, round > 0 ? roundBox(THREE, w, h, d, round, 2) : new THREE.BoxGeometry(w, h, d), c, x, y, z, rx);
  const rod = (p: Parts, c: number, r: number, ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const len = Math.hypot(bx - ax, by - ay, bz - az);
    const g = new THREE.CylinderGeometry(r, r, len, 6);
    // along y, then turned onto the line from a to b
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(bx - ax, by - ay, bz - az).normalize());
    g.applyQuaternion(q);
    g.translate((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
    p.push([g, c]);
  };
  // tank, side panels, fenders
  box(paint, WHITE, 0.34, 0.24, 0.58, 0, 0.98, -0.24, 0.12);
  for (const s of [-1, 1]) box(paint, WHITE, 0.04, 0.2, 0.36, s * 0.15, 0.78, 0.34, 0, 0.3);
  box(paint, WHITE, 0.16, 0.05, 0.62, 0, 0.72, -0.76, 0.35, 0.3);
  box(paint, WHITE, 0.18, 0.05, 0.6, 0, 0.78, 0.82, -0.3, 0.3);
  // frame, engine, exhaust, the seat
  rod(trim, STEEL, 0.035, 0, 1.0, -0.52, 0, 0.42, 0.05);
  rod(trim, STEEL, 0.035, 0, 0.42, 0.05, 0, 0.33, 0.72);
  rod(trim, STEEL, 0.03, 0, 0.88, 0.2, 0, 0.36, 0.72);
  box(trim, STEEL, 0.3, 0.34, 0.42, 0, 0.55, -0.02, 0, 0.2);
  rod(trim, 0x6a6a66, 0.045, 0.17, 0.45, 0.05, 0.17, 0.58, 0.9);
  box(trim, BLACK, 0.28, 0.1, 0.7, 0, 1.0, 0.34, -0.06, 0.4);
  // forks, handlebar and its grips, the headlight
  for (const s of [-1, 1]) rod(trim, 0x9a9a96, 0.025, s * 0.08, 1.12, -0.56, s * 0.08, 0.33, -0.72);
  rod(trim, BLACK, 0.02, -0.36, 1.2, -0.5, 0.36, 1.2, -0.5);
  put(trim, new THREE.CylinderGeometry(0.08, 0.09, 0.08, 12), LAMP, 0, 1.06, -0.66, Math.PI / 2);
  return [paint, trim];
}

/** One wheel, its axle along x: tyre, rim and hub. */
function wheelGeometry(THREE: Three, r: number, width: number) {
  const parts: Parts = [];
  put(parts, new THREE.CylinderGeometry(r, r, width, 18), BLACK, 0, 0, 0, 0, 0, Math.PI / 2);
  put(parts, new THREE.CylinderGeometry(r * 0.58, r * 0.58, width + 0.02, 14), 0x8c8a84, 0, 0, 0, 0, 0, Math.PI / 2);
  put(parts, new THREE.CylinderGeometry(r * 0.2, r * 0.2, width + 0.05, 8), 0x3a3a3a, 0, 0, 0, 0, 0, Math.PI / 2);
  // tread blocks round the tyre, so the roll shows
  for (let k = 0; k < 10; k++) {
    const a = (k / 10) * Math.PI * 2;
    put(parts, new THREE.BoxGeometry(width * 0.96, 0.05, 0.07), 0x0e0e0e, 0, Math.cos(a) * r, Math.sin(a) * r, a);
  }
  return merged(THREE, parts);
}

/** The most of each kind drawn (a royale parks about sixteen in all). */
const MAX = 24;
/** Paint colors, picked per car by its id. */
const PAINT = [0x4b5a3a, 0xa48b62, 0x6e2a22, 0x2f4458, 0xc9c4b6, 0x3b3b38];

export type CarsView = { group: T.Group; update(m: Match): void; dispose(): void };

export function carsView(THREE: Three, shared: Shared, shadows: boolean): CarsView {
  const group = new THREE.Group();
  const disposables: { dispose(): void }[] = [];
  const keep = <X extends { dispose(): void }>(x: X) => (disposables.push(x), x);
  const paintMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.25 }));
  patch(paintMat, shared, { key: 'dz-car-paint' });
  const trimMat = keep(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.3 }));
  patch(trimMat, shared, { key: 'dz-car-trim' });
  type KindMeshes = { paint: T.InstancedMesh; trim: T.InstancedMesh; wheels: T.InstancedMesh };
  const kinds = new Map<CarKind, KindMeshes>();
  const mesh = (geo: T.BufferGeometry, mat: T.Material, n: number) => {
    const im = new THREE.InstancedMesh(keep(geo), mat, n);
    im.count = 0;
    im.setColorAt(0, new THREE.Color(1, 1, 1));
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.frustumCulled = false;
    group.add(im);
    disposables.push(im);
    return im;
  };
  // (built up front, so the view's warm up compiles their shaders before play)
  for (const kind of ['jeep', 'bike'] as CarKind[]) {
    const S = CARS[kind];
    const [p, t] = kind === 'jeep' ? jeepParts(THREE) : bikeParts(THREE);
    kinds.set(kind, { paint: mesh(merged(THREE, p), paintMat, MAX), trim: mesh(merged(THREE, t), trimMat, MAX), wheels: mesh(wheelGeometry(THREE, S.wheel, kind === 'jeep' ? 0.32 : 0.13), trimMat, MAX * (S.track > 0 ? 4 : 2)) });
  }

  const m4 = new THREE.Matrix4();
  const w4 = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const one = new THREE.Vector3(1, 1, 1);
  const col = new THREE.Color();
  const burnt = new THREE.Color(0.035, 0.032, 0.03);
  /** A wheel's place on its car: x, y, z, and whether it steers. */
  const WHEELS: Record<CarKind, [number, number, number, boolean][]> = {
    jeep: [
      [-0.86, CARS.jeep.wheel, -1.35, true],
      [0.86, CARS.jeep.wheel, -1.35, true],
      [-0.86, CARS.jeep.wheel, 1.35, false],
      [0.86, CARS.jeep.wheel, 1.35, false],
    ],
    bike: [
      [0, CARS.bike.wheel, -0.725, true],
      [0, CARS.bike.wheel, 0.725, false],
    ],
  };
  const place = (k: KindMeshes, c: Car) => {
    const S = CARS[c.kind];
    const i = k.paint.count;
    if (i >= MAX) return;
    pos.set(c.x, c.y, c.z);
    q.setFromEuler(e.set(c.pitch, c.yaw, c.roll, 'YXZ'));
    m4.compose(pos, q, one);
    k.paint.setMatrixAt(i, m4);
    k.trim.setMatrixAt(i, m4);
    k.paint.setColorAt(i, c.alive ? col.setHex(PAINT[(c.id * 7 + 3) % PAINT.length]) : burnt);
    k.trim.setColorAt(i, c.alive ? col.setRGB(1, 1, 1) : burnt);
    k.paint.count++;
    k.trim.count++;
    for (const [x, y, z, steers] of WHEELS[c.kind]) {
      // turned for the steering, then rolled
      q.setFromEuler(e.set(-c.spin, steers ? -c.steer * S.steer * 0.8 : 0, 0, 'YXZ'));
      w4.compose(pos.set(x, y, z), q, one);
      w4.premultiply(m4);
      const j = k.wheels.count++;
      k.wheels.setMatrixAt(j, w4);
      k.wheels.setColorAt(j, c.alive ? col.setRGB(1, 1, 1) : burnt);
    }
  };

  return {
    group,
    update(m) {
      group.visible = m.cars.length > 0;
      if (!m.cars.length) return;
      for (const k of kinds.values()) k.paint.count = k.trim.count = k.wheels.count = 0;
      for (const c of m.cars) {
        const k = kinds.get(c.kind);
        if (k) place(k, c);
      }
      for (const k of kinds.values())
        for (const im of [k.paint, k.trim, k.wheels]) {
          im.instanceMatrix.needsUpdate = true;
          if (im.instanceColor) im.instanceColor.needsUpdate = true;
        }
    },
    dispose() {
      for (const d of disposables) d.dispose();
      group.clear();
    },
  };
}
