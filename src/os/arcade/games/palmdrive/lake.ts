// Lake Lagunita's own scenery beyond its water (scenery.ts lays the water and places everything): reed beds of
// cattails and rushes along the shore, swaying; lily pads with their notches and pink flowers; sailing dinghies in
// cardinal and white, heeled over and bobbing; mallards; and the boathouse on its peninsula with its dock and kayaks.
import type { T } from './gl';
import { boatHull, modelKit, type ModelKit } from './model';
import { scatter } from './scenery';

type Three = typeof import('three');
type Spot = { x: number; z: number };

/** One clump of reeds: rushes fanning out, cattails standing among them with their brown heads. */
function reedClump(THREE: Three, seed: number) {
  const r = scatter(seed);
  const pos: number[] = [];
  const col: number[] = [];
  const base = [0.14, 0.2, 0.08];
  const tip = [0.55, 0.62, 0.3];
  for (let i = 0; i < 22; i++) {
    const a = r() * Math.PI * 2;
    const h = 1.1 + r() * 1.2;
    const lean = 0.05 + r() * 0.22;
    const w = 0.025 + r() * 0.02;
    const ox = Math.cos(a) * 0.35 * r();
    const oz = Math.sin(a) * 0.35 * r();
    const tx = ox + Math.cos(a) * lean * h;
    const tz = oz + Math.sin(a) * lean * h;
    pos.push(ox - Math.sin(a) * w, 0, oz + Math.cos(a) * w, ox + Math.sin(a) * w, 0, oz - Math.cos(a) * w, tx, h, tz);
    const k = 0.85 + r() * 0.3;
    col.push(...base, ...base, ...tip.map((c) => c * k));
  }
  for (let i = 0; i < 6; i++) {
    const a = r() * Math.PI * 2;
    const x = Math.cos(a) * 0.25 * r();
    const z = Math.sin(a) * 0.25 * r();
    const h = 1.6 + r() * 0.7;
    pos.push(x - 0.02, 0, z, x + 0.02, 0, z, x, h, z);
    col.push(...base, ...base, 0.4, 0.45, 0.22);
    const [y0, y1, ww] = [h * 0.7, h * 0.88, 0.06];
    for (const q of [0, Math.PI / 3, (2 * Math.PI) / 3]) {
      const dx = Math.cos(q) * ww;
      const dz = Math.sin(q) * ww;
      pos.push(x - dx, y0, z - dz, x + dx, y0, z + dz, x + dx, y1, z + dz, x - dx, y0, z - dz, x + dx, y1, z + dz, x - dx, y1, z - dz);
      for (let v = 0; v < 6; v++) col.push(0.3, 0.17, 0.08);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  const nrm = g.getAttribute('normal');
  for (let k = 0; k < nrm.count; k++) {
    const ny = Math.abs(nrm.getY(k)) + 0.8;
    const l = Math.hypot(nrm.getX(k), ny, nrm.getZ(k));
    nrm.setXYZ(k, nrm.getX(k) / l, ny / l, nrm.getZ(k) / l);
  }
  return g;
}

const sway = { value: 0 };

/** Reed beds at the spots (each a clump, sized s), swaying. */
export function reedBeds(THREE: Three, scene: T.Scene, dummy: T.Object3D, spots: (Spot & { s: number })[]) {
  if (!spots.length) return;
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uSway = sway;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uSway;').replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>
       vec3 ip = instanceMatrix[3].xyz;
       float ph = ip.x * 0.19 + ip.z * 0.23;
       float hh = position.y * position.y;
       transformed.x += (sin(uSway * 1.3 + ph) * 0.05 + sin(uSway * 2.9 + ph * 1.7) * 0.02) * hh;
       transformed.z += cos(uSway * 1.1 + ph) * 0.03 * hh;`,
    );
  };
  mat.customProgramCacheKey = () => 'pd-lake-reeds';
  const kinds = [reedClump(THREE, 3), reedClump(THREE, 8)];
  const r = scatter(12);
  kinds.forEach((g, v) => {
    const list = spots.filter((_, i) => i % 2 === v);
    if (!list.length) return;
    const m = new THREE.InstancedMesh(g, mat, list.length);
    list.forEach((p, i) => {
      dummy.position.set(p.x, -0.05, p.z);
      dummy.rotation.set(0, r() * Math.PI * 2, 0);
      dummy.scale.set(p.s, p.s * (0.85 + r() * 0.3), p.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.computeBoundingSphere();
    m.userData.noCast = true;
    scene.add(m);
  });
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(1);
}

/** Lily pads (notched, two greens) and their pink flowers. */
export function lilyPads(THREE: Three, scene: T.Scene, dummy: T.Object3D, pads: (Spot & { s: number })[], flowers: Spot[]) {
  const r = scatter(5);
  if (pads.length) {
    const g = new THREE.CircleGeometry(1, 14, 0.3, Math.PI * 2 - 0.6);
    g.rotateX(-Math.PI / 2);
    const col: number[] = [];
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k++) {
      const d = Math.hypot(p.getX(k), p.getZ(k));
      col.push(0.22 + d * 0.12, 0.42 + d * 0.1, 0.16);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const m = new THREE.InstancedMesh(g, new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), pads.length);
    pads.forEach((q, i) => {
      dummy.position.set(q.x, 0.012, q.z);
      dummy.rotation.set(0, r() * Math.PI * 2, 0);
      dummy.scale.setScalar(q.s);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.userData.flat = true;
    scene.add(m);
  }
  if (flowers.length) {
    const mk = modelKit(THREE);
    for (const f of flowers) {
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2;
        mk.cone(k % 2 ? 0xf6a8c8 : 0xf8c4d8, f.x + Math.cos(a) * 0.08, 0.1, f.z + Math.sin(a) * 0.08, 0.06, 0.2, 0.03, Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5);
      }
      mk.ball(0xf2c230, f.x, 0.1, f.z, 0.05, 0.04, 0.05);
    }
    scene.add(mk.build(new THREE.MeshLambertMaterial({ vertexColors: true }), new THREE.MeshBasicMaterial({ vertexColors: true })));
  }
  dummy.rotation.set(0, 0, 0);
  dummy.scale.setScalar(1);
}

/** A sailing dinghy: white hull with a cardinal stripe, mast and boom, the main and jib (cardinal or white), a sailor. */
function dinghy(THREE: Three, mk: ModelKit, cardinal: boolean) {
  mk.geo(boatHull(THREE, 4.2, 1.6, 0.55, true), 0xf4f1ea, 0, -0.15, 0);
  mk.box(0x8c1515, 0, 0.2, 0, 1.62, 0.08, 3.4);
  mk.cyl(0xd8d8d8, 0, 3.2, 0.5, 0.05, 6, 0.05);
  mk.cyl(0xd8d8d8, 0, 0.95, -0.6, 0.04, 2.2, 0.04, Math.PI / 2, 0, 0);
  const sail = new THREE.BufferGeometry();
  // (the main from the boom up the mast; the jib forward of the mast to the bow)
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0.95, 0.45, 0, 6.0, 0.45, 0, 0.95, -1.65, 0, 1.0, 0.6, 0, 4.9, 0.55, 0, 0.6, 2.0], 3));
  sail.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
  sail.computeVertexNormals();
  mk.geo(sail, cardinal ? 0xb1282a : 0xfafafa);
  // (the sailor hiking out on the high side)
  mk.box(0xf2c230, 0.75, 0.55, -0.9, 0.35, 0.5, 0.3, 0, 0, -0.5);
  mk.ball(0xe8bf98, 0.95, 0.85, -0.9, 0.13, 0.15, 0.13);
}

/** A mallard drake: grey-brown body, green head, white collar, yellow bill, a curl of tail. */
function mallard(mk: ModelKit, x: number, z: number, ry: number) {
  mk.place(x, 0, z, ry);
  mk.ball(0x9a8a74, 0, 0.1, 0, 0.17, 0.11, 0.27);
  mk.ball(0x5a4636, 0, 0.13, 0.14, 0.15, 0.1, 0.12);
  mk.ball(0x2a2a30, 0, 0.14, -0.24, 0.08, 0.07, 0.09);
  mk.box(0xf4f4ee, 0, 0.21, 0.2, 0.09, 0.03, 0.06);
  mk.ball(0x1f6a3a, 0, 0.29, 0.24, 0.08, 0.085, 0.09);
  mk.box(0xf2c230, 0, 0.27, 0.34, 0.05, 0.025, 0.08);
}

/**
 * The boathouse on its peninsula, facing along `ry`: board-and-batten walls stained brown, a green gable roof, a bay
 * door open on racks of kayaks, a deck along its front with kayaks drawn up, and the flagpole flying cardinal.
 */
export function boathouse(THREE: Three, mk: ModelKit, x: number, z: number, ry: number) {
  void scatter;
  mk.place(x, 0, z, ry);
  const wood = 0x7a5236;
  mk.box(0x6a6058, 0, 0.3, 0, 9, 0.6, 7);
  mk.box(wood, 0, 2.7, 0, 8.4, 4.4, 6.4);
  for (let k = -4; k <= 4; k++) for (const sz of [-1, 1]) mk.box(0x5e3e28, k, 2.7, sz * 3.22, 0.08, 4.4, 0.06);
  for (let k = -3; k <= 3; k++) for (const sx of [-1, 1]) mk.box(0x5e3e28, sx * 4.22, 2.7, k * 0.9, 0.06, 4.4, 0.08);
  // (the roof: a green gable, eaves out over the walls, its ridge)
  const roof = new THREE.BufferGeometry();
  const w = 5.2;
  const d = 4.2;
  const h = 2.2;
  roof.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, -d, -w, 0, d, 0, h, d, -w, 0, -d, 0, h, d, 0, h, -d, w, 0, d, w, 0, -d, 0, h, -d, w, 0, d, 0, h, -d, 0, h, d, -w + 0.9, 0.45, d - 0.1, w - 0.9, 0.45, d - 0.1, 0, h, d - 0.1, w - 0.9, 0.45, -d + 0.1, -w + 0.9, 0.45, -d + 0.1, 0, h, -d + 0.1], 3));
  roof.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(36).fill(0), 2));
  roof.computeVertexNormals();
  mk.geo(roof, 0x2f5d3a, 0, 4.9, 0);
  mk.box(0x23472c, 0, 7.12, 0, 0.3, 0.2, 8.6);
  // (the bay door on the water side, open on its racks of kayaks, and windows either side)
  mk.box(0x1e1a16, 4.23, 2.0, 0, 0.06, 3.2, 3.4);
  for (let j = 0; j < 3; j++) for (const sd of [-1, 1]) mk.ball([0xf2c230, 0xd8261e, 0x2f6fb5][(j + (sd > 0 ? 1 : 0)) % 3], 3.9, 1.0 + j * 0.9, sd * 0.8, 0.18, 0.1, 1.5);
  for (const sz of [-2.6, 2.6]) {
    mk.box(0xe8e4d4, 4.24, 2.6, sz, 0.06, 1.3, 1.1);
    mk.box(0x2c3a44, 4.26, 2.6, sz, 0.06, 1.1, 0.9);
  }
  // (a deck along the front on its posts, its rail, and two kayaks drawn up on it)
  mk.box(0x9a7a58, 5.3, 0.45, 0, 1.8, 0.16, 8.4);
  for (const zz of [-4, -1.3, 1.3, 4]) mk.cyl(0x4a3a2c, 6.1, 0.2, zz, 0.1, 0.6, 0.1);
  for (const zz of [-4.1, 4.1]) mk.box(0xe8e2d4, 6.15, 0.95, zz * 0.5, 0.06, 0.06, 4);
  mk.ball(0xf2c230, 5.2, 0.62, -2.2, 0.28, 0.14, 2.0);
  mk.ball(0xd8261e, 5.2, 0.62, 2.2, 0.28, 0.14, 2.0);
  // (the flagpole, and the flag)
  mk.cyl(0xe8e8e8, -5.5, 4.5, 3.6, 0.07, 9, 0.07);
  mk.box(0x8c1515, -5.5, 8.4, 4.5, 0.03, 1.1, 1.8);
  mk.place();
}

export type LakeLife = { tick: (clock: number) => void };

/** The dinghies and the ducks out on the water at the spots, bobbing (a group each, rocked by the tick). */
export function lakeLife(THREE: Three, scene: T.Scene, boats: Spot[], ducks: Spot[], rand: () => number): LakeLife {
  const vc = new THREE.MeshLambertMaterial({ vertexColors: true });
  const vcLit = new THREE.MeshBasicMaterial({ vertexColors: true });
  const fleet: { g: T.Group; ph: number; heel: number; ry: number; x: number; z: number }[] = [];
  boats.forEach((b, i) => {
    const mk = modelKit(THREE);
    dinghy(THREE, mk, i % 2 === 1);
    const g = mk.build(vc, vcLit);
    const ry = rand() * Math.PI * 2;
    g.position.set(b.x, 0, b.z);
    g.rotation.y = ry;
    scene.add(g);
    fleet.push({ g, ph: rand() * 6, heel: 0.12 + rand() * 0.12, ry, x: b.x, z: b.z });
  });
  const flock = modelKit(THREE);
  for (const d of ducks) {
    // (a little family: a drake, a hen and a duckling or two behind)
    const ry = rand() * Math.PI * 2;
    mallard(flock, d.x, d.z, ry);
    flock.place(d.x - Math.sin(ry) * 0.8 + 0.3, 0, d.z - Math.cos(ry) * 0.8, ry);
    flock.ball(0x8a6a4a, 0, 0.1, 0, 0.15, 0.1, 0.24);
    flock.ball(0x7a5a3a, 0, 0.25, 0.2, 0.075, 0.08, 0.085);
    flock.box(0xd8902a, 0, 0.24, 0.29, 0.045, 0.02, 0.07);
  }
  flock.place();
  const ducksMesh = flock.count() ? flock.build(vc, vcLit) : null;
  if (ducksMesh) scene.add(ducksMesh);
  return {
    tick(clock) {
      for (const b of fleet) {
        b.g.rotation.set(Math.sin(clock * 0.9 + b.ph) * 0.03, b.ry + Math.sin(clock * 0.2 + b.ph) * 0.05, b.heel + Math.sin(clock * 1.1 + b.ph) * 0.04, 'YXZ');
        b.g.position.set(b.x + Math.sin(clock * 0.05 + b.ph) * 4, Math.sin(clock * 1.3 + b.ph) * 0.06, b.z + Math.cos(clock * 0.04 + b.ph) * 4);
      }
      if (ducksMesh) ducksMesh.position.y = Math.sin(clock * 1.7) * 0.02;
    },
  };
}
