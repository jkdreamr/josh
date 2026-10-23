// three.js view of a Wacky Walk round: the course, the jelly bean grads, confetti and the chase camera.
// It reads course and body data every frame and never changes them. Only classes kit/three-lib.ts exports are used.
import type { T } from './gl';
import { createGL, damp, disposeTree, type GL } from './gl';
import type { BodyState, Collider, Course, Decor, Look, Pose } from './types.ts';
import { groundBelow, rayCast } from './physics.ts';

type Three = typeof import('three');

export type BodyView = { x: number; y: number; z: number; vx: number; vy: number; vz: number; yaw: number; state: BodyState; squash: number };
export type PlayerLook = { id: number; color: number };
export type CamState = { yaw: number; pitch: number; dist: number };

export type View = {
  gl: GL;
  resize(w: number, h: number): void;
  setCourse(course: Course): void;
  setPlayers(players: PlayerLook[]): void;
  /** Moves everything for course time t and points the camera at body `focus` (null: a slow fly-by of the course). */
  frame(course: Course, t: number, bodies: readonly (BodyView | null)[], focus: number | null, cam: CamState, dt: number): void;
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  confetti(x: number, y: number, z: number, count?: number): void;
  splash(x: number, y: number, z: number): void;
  render(): void;
  dispose(): void;
};

const MAX_PLAYERS = 20;
const CONFETTI = 360;
const DROPS = 120;
const CARDINAL = 0x9b1c1f;
const CAMERA_ORBITS = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];

const LOOK_COLORS: Record<Look, number> = {
  grass: 0x8fd18a, path: 0xf2dfb8, sand: 0xe8c99a, stone: 0xd9cbb5, roof: 0xd9654b, wood: 0xc08a5a, tube: 0xfffaf0,
  bar: 0xc0302f, bumper: 0xff8fa3, water: 0x7fd3e6, wet: 0x9fd8ea, hex: 0xeacb98, gold: 0xffc93c, coconut: 0x8a5a36,
  frond: 0x5fbf5a, pad: 0xffb84a, start: 0x7fd6c4, finish: 0xffe27a, hidden: 0xffffff,
};

/** A part to bake into a merged, vertex colored mesh. */
type Part = { g: T.BufferGeometry; m: T.Matrix4; c: number };
type Aabb = { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number };
type DecorBounds = { box: Aabb; parts: { box: Aabb; inverse: T.Matrix4 }[] };

function rayBox(from: T.Vector3, to: T.Vector3, box: Aabb): number {
  let near = 0;
  let far = 1;
  const dx = to.x - from.x;
  if (Math.abs(dx) < 1e-8) {
    if (from.x < box.minX || from.x > box.maxX) return 1;
  } else {
    let a = (box.minX - from.x) / dx;
    let b = (box.maxX - from.x) / dx;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return 1;
  }
  const dy = to.y - from.y;
  if (Math.abs(dy) < 1e-8) {
    if (from.y < box.minY || from.y > box.maxY) return 1;
  } else {
    let a = (box.minY - from.y) / dy;
    let b = (box.maxY - from.y) / dy;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return 1;
  }
  const dz = to.z - from.z;
  if (Math.abs(dz) < 1e-8) {
    if (from.z < box.minZ || from.z > box.maxZ) return 1;
  } else {
    let a = (box.minZ - from.z) / dz;
    let b = (box.maxZ - from.z) / dz;
    if (a > b) {
      const swap = a;
      a = b;
      b = swap;
    }
    near = Math.max(near, a);
    far = Math.min(far, b);
    if (near > far) return 1;
  }
  return near <= 1 && far >= 0 ? near : 1;
}

function build(THREE: Three, host: HTMLElement, touch: boolean): View | null {
  const gl = createGL(THREE, host, { maxDpr: 1.25 });
  if (!gl) return null;
  const { renderer } = gl;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 420);
  const hemi = new THREE.HemisphereLight(0xfff6e8, 0x7aa38a, 1.9);
  const sun = new THREE.DirectionalLight(0xffeccc, 1.6);
  sun.position.set(-30, 60, -20);
  scene.add(hemi, sun);

  // shared unit geometries (non indexed, so they bake straight into merged meshes)
  const own: T.BufferGeometry[] = [];
  const keepG = <G extends T.BufferGeometry>(g: G) => {
    own.push(g);
    return g;
  };
  const unit = {
    box: keepG(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()),
    cyl: keepG(new THREE.CylinderGeometry(1, 1, 1, 14, 1).toNonIndexed()),
    cyl6: keepG(new THREE.CylinderGeometry(1, 1, 1, 6, 1).toNonIndexed()),
    cyl8: keepG(new THREE.CylinderGeometry(1, 1, 1, 8, 1).toNonIndexed()),
    cone: keepG(new THREE.ConeGeometry(1, 1, 8, 1).toNonIndexed()),
    cone4: keepG(new THREE.ConeGeometry(1, 1, 4, 1).toNonIndexed()),
    prism: keepG(new THREE.CylinderGeometry(1, 1, 1, 3, 1).toNonIndexed()),
    sphere: keepG(new THREE.SphereGeometry(1, 12, 8).toNonIndexed()),
    ico: keepG(new THREE.IcosahedronGeometry(1, 0)),
    half: keepG(new THREE.TorusGeometry(1, 0.16, 5, 10, Math.PI).toNonIndexed()),
  };
  const lambert = (color: number, extra: T.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const bakedMat = lambert(0xffffff, { vertexColors: true });
  const mats: T.Material[] = [bakedMat];
  const mat = <M extends T.Material>(m: M) => {
    mats.push(m);
    return m;
  };

  const tmpQ = new THREE.Quaternion();
  const tmpE = new THREE.Euler();
  const tmpV = new THREE.Vector3();
  const tmpS = new THREE.Vector3();
  const tmpC = new THREE.Color();
  const scratchMtx = new THREE.Matrix4();
  const setMtx = (out: T.Matrix4, x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
    out.compose(tmpV.set(x, y, z), tmpQ.setFromEuler(tmpE.set(pitch, yaw, roll, 'YXZ')), tmpS.set(sx, sy, sz));
  const mtx = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
    setMtx(new THREE.Matrix4(), x, y, z, sx, sy, sz, yaw, pitch, roll);

  function bake(parts: Part[]): T.BufferGeometry {
    let n = 0;
    for (const p of parts) n += p.g.attributes.position.count;
    const pos = new Float32Array(n * 3);
    const nor = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    let o = 0;
    for (const p of parts) {
      const ps = p.g.attributes.position;
      const ns = p.g.attributes.normal;
      tmpC.setHex(p.c);
      for (let i = 0; i < ps.count; i++) {
        tmpV.fromBufferAttribute(ps, i).applyMatrix4(p.m);
        pos[o * 3] = tmpV.x;
        pos[o * 3 + 1] = tmpV.y;
        pos[o * 3 + 2] = tmpV.z;
        tmpV.fromBufferAttribute(ns, i).transformDirection(p.m);
        nor[o * 3] = tmpV.x;
        nor[o * 3 + 1] = tmpV.y;
        nor[o * 3 + 2] = tmpV.z;
        col[o * 3] = tmpC.r;
        col[o * 3 + 1] = tmpC.g;
        col[o * 3 + 2] = tmpC.b;
        o++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere();
    return g;
  }

  // ---------------------------------------------------------------- sky and water
  const skyGeo = keepG(new THREE.SphereGeometry(380, 16, 10));
  const skyColors = new Float32Array(skyGeo.attributes.position.count * 3);
  skyGeo.setAttribute('color', new THREE.BufferAttribute(skyColors, 3));
  const sky = new THREE.Mesh(skyGeo, mat(new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false })));
  sky.renderOrder = -1;
  scene.add(sky);
  scene.fog = new THREE.Fog(0xffffff, 90, 330);
  const waterMat = mat(lambert(0x8fdcec, { transparent: true, opacity: 0.92 }));
  const water = new THREE.Mesh(keepG(new THREE.PlaneGeometry(900, 900, 1, 1)), waterMat);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  const shoreMat = mat(lambert(0x9bd48f));
  const shore = new THREE.Mesh(keepG(new THREE.RingGeometry(1, 3.2, 48, 1)), shoreMat);
  shore.rotation.x = -Math.PI / 2;
  scene.add(shore);

  // ---------------------------------------------------------------- course
  const courseRoot = new THREE.Group();
  scene.add(courseRoot);
  let courseOwned: T.BufferGeometry[] = [];
  let moving: { c: Collider; mesh: T.Object3D }[] = [];
  const decorBounds: DecorBounds[] = [];
  const decorRayFrom = new THREE.Vector3();
  const decorRayTo = new THREE.Vector3();
  let tiles: { mesh: T.InstancedMesh; list: Collider[]; base: number[] } | null = null;
  let jets: { z: Course['zones'][number]; mesh: T.Mesh }[] = [];
  let crown: T.Group | null = null;
  let pads: T.Mesh[] = [];
  let waterY = -6;
  let center = { x: 0, z: 0, r: 80 };

  const shapeParts = (c: Collider, m: T.Matrix4, color: number, out: Part[]) => {
    const s = c.shape;
    if (s.kind === 'box') {
      out.push({ g: unit.box, m: m.clone().multiply(mtx(0, 0, 0, s.hx * 2, s.hy * 2, s.hz * 2)), c: color });
      // a lighter lip on walkable tops reads as a floor edge
      if ((c.look === 'grass' || c.look === 'path' || c.look === 'start' || c.look === 'finish' || c.look === 'wet') && s.hy < 3) {
        tmpC.setHex(color).offsetHSL(0, -0.02, 0.06);
        out.push({ g: unit.box, m: m.clone().multiply(mtx(0, s.hy + 0.02, 0, s.hx * 2 - 0.02, 0.04, s.hz * 2 - 0.02)), c: tmpC.getHex() });
      }
    } else if (s.kind === 'cyl') {
      const g = c.look === 'hex' ? unit.cyl6 : unit.cyl;
      out.push({ g, m: m.clone().multiply(mtx(0, 0, 0, s.r, s.hy * 2, s.r)), c: color });
      if (c.look === 'tube') {
        // a cardinal ribbon round the middle and darker paper ends
        out.push({ g: unit.cyl, m: m.clone().multiply(mtx(0, 0, 0, s.r * 1.04, Math.min(0.5, s.hy * 0.12), s.r * 1.04)), c: CARDINAL });
        for (const e of [-1, 1]) out.push({ g: unit.cyl, m: m.clone().multiply(mtx(0, e * s.hy, 0, s.r * 0.86, 0.04, s.r * 0.86)), c: 0xe9dcc0 });
      }
      if (c.look === 'bar') out.push({ g: unit.cyl, m: m.clone().multiply(mtx(0, 0, 0, s.r * 1.05, s.hy * 0.3, s.r * 1.05)), c: 0xffffff });
    } else {
      out.push({ g: unit.sphere, m: m.clone().multiply(mtx(0, 0, 0, s.r, s.r, s.r)), c: color });
      if (c.look === 'coconut') for (let i = 0; i < 3; i++) out.push({ g: unit.sphere, m: m.clone().multiply(mtx(Math.cos(i * 2.1) * s.r * 0.35, s.r * 0.85, Math.sin(i * 2.1) * s.r * 0.35, s.r * 0.12, s.r * 0.12, s.r * 0.12)), c: 0x3b2516 });
    }
  };
  const poseMatrix = (p: Pose, out: T.Matrix4) => {
    const m = p.m;
    out.set(m[0], m[1], m[2], p.x, m[3], m[4], m[5], p.y, m[6], m[7], m[8], p.z, 0, 0, 0, 1);
    return out;
  };

  function decorParts(d: Decor, out: Part[]) {
    const base = mtx(d.x, d.y, d.z, d.s, d.s, d.s, d.yaw);
    const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) => base.clone().multiply(mtx(x, y, z, sx, sy, sz, yaw, pitch, roll));
    const sand = d.color ?? LOOK_COLORS.sand;
    switch (d.kind) {
      case 'palm': {
        let x = 0;
        let y = 0;
        const lean = ((d.x * 7 + d.z * 13) % 5) * 0.03 - 0.06;
        for (let i = 0; i < 6; i++) {
          out.push({ g: unit.cyl8, m: at(x, y + 0.6, 0, 0.24 - i * 0.02, 1.25, 0.24 - i * 0.02, 0, 0, lean), c: i % 2 ? 0xb48455 : 0xa47447 });
          x -= Math.sin(lean) * 1.2;
          y += 1.2;
        }
        for (let i = 0; i < 7; i++) {
          const a = (i / 7) * Math.PI * 2;
          out.push({ g: unit.cone4, m: at(x + Math.cos(a) * 1.3, y + 0.1, Math.sin(a) * 1.3, 0.45, 2.8, 0.12, -a, 0, Math.PI / 2 + 0.35).multiply(mtx(0, 0, 0, 1, 1, 1)), c: i % 2 ? 0x5cbf5f : 0x48a852 });
        }
        for (let i = 0; i < 3; i++) out.push({ g: unit.sphere, m: at(x + Math.cos(i * 2) * 0.3, y - 0.25, Math.sin(i * 2) * 0.3, 0.2, 0.2, 0.2), c: 0x7a4f2c });
        break;
      }
      case 'arch': {
        for (const e of [-1, 1]) out.push({ g: unit.box, m: at(e * 2.4, 2, 0, 1, 4, 1.2), c: sand });
        out.push({ g: unit.half, m: at(0, 4, 0, 2.4, 2.4, 3.2), c: sand });
        out.push({ g: unit.box, m: at(0, 6.6, 0, 6, 1, 1.4), c: sand });
        out.push({ g: unit.prism, m: at(0, 7.5, 0, 0.9, 6.4, 0.9, 0, 0, Math.PI / 2).multiply(mtx(0, 0, 0, 1, 1, 1.0)), c: LOOK_COLORS.roof });
        break;
      }
      case 'arcade': {
        out.push({ g: unit.box, m: at(0, 2.6, -1.6, 17, 5.2, 2), c: sand });
        for (let i = -2; i <= 2; i++) {
          out.push({ g: unit.box, m: at(i * 3.4 - 1.7 + 1.7, 1.5, 0.2, 0.7, 3, 0.7), c: sand });
          if (i < 2) out.push({ g: unit.half, m: at(i * 3.4 + 1.7, 3, 0.2, 1.4, 1.2, 2.4), c: sand });
        }
        out.push({ g: unit.box, m: at(0, 4.6, 0.2, 14.6, 1, 1), c: sand });
        out.push({ g: unit.prism, m: at(0, 5.7, -0.7, 1.6, 17.6, 2.2, 0, 0, Math.PI / 2), c: LOOK_COLORS.roof });
        break;
      }
      case 'roof': {
        out.push({ g: unit.box, m: at(0, 2.5, 0, 10, 5, 7), c: sand });
        for (let i = -1; i <= 1; i++) out.push({ g: unit.box, m: at(i * 3, 2.8, 3.52, 1.1, 1.6, 0.1), c: 0x6d8fb0 });
        out.push({ g: unit.prism, m: at(0, 6, 0, 2.2, 10.8, 4.4, 0, 0, Math.PI / 2), c: LOOK_COLORS.roof });
        break;
      }
      case 'tower': {
        out.push({ g: unit.box, m: at(0, 14, 0, 6, 28, 6), c: sand });
        out.push({ g: unit.box, m: at(0, 29, 0, 7, 2, 7), c: 0xf1d9b0 });
        for (let i = 0; i < 4; i++) {
          const a = (i * Math.PI) / 2;
          for (const e of [-1, 1]) out.push({ g: unit.box, m: at(Math.sin(a) * 3.1 + Math.cos(a) * e * 1.2, 32, Math.cos(a) * 3.1 - Math.sin(a) * e * 1.2, 0.6, 4, 0.6, a), c: sand });
        }
        out.push({ g: unit.box, m: at(0, 32, 0, 5, 4, 5), c: 0x6f5b4a });
        out.push({ g: unit.box, m: at(0, 34.4, 0, 6.6, 0.8, 6.6), c: 0xf1d9b0 });
        out.push({ g: unit.sphere, m: at(0, 35, 0, 2.9, 3.4, 2.9), c: LOOK_COLORS.roof });
        out.push({ g: unit.cyl8, m: at(0, 39, 0, 0.12, 2, 0.12), c: 0xffd35c });
        for (let i = 0; i < 6; i++) out.push({ g: unit.box, m: at(0, 4 + i * 4, 3.02, 0.9, 1.6, 0.1), c: 0x6d8fb0 });
        break;
      }
      case 'fountain': {
        out.push({ g: unit.cyl, m: at(0, 0.35, 0, 4.2, 0.7, 4.2), c: sand });
        out.push({ g: unit.cyl, m: at(0, 0.6, 0, 3.7, 0.5, 3.7), c: 0x7fd3e6 });
        out.push({ g: unit.cyl8, m: at(0, 1.6, 0, 0.5, 2.4, 0.5), c: sand });
        out.push({ g: unit.cyl, m: at(0, 2.8, 0, 1.5, 0.3, 1.5), c: sand });
        for (let i = 0; i < 5; i++) out.push({ g: unit.cone, m: at(Math.cos(i * 1.26) * 0.8, 3.4, Math.sin(i * 1.26) * 0.8, 0.18, 1.2, 0.18, 0, Math.sin(i * 1.26) * 0.5, -Math.cos(i * 1.26) * 0.5), c: 0xb7ecf5 });
        break;
      }
      case 'tree': {
        out.push({ g: unit.cyl8, m: at(0, 1.2, 0, 0.3, 2.4, 0.3), c: 0x8d6040 });
        out.push({ g: unit.ico, m: at(0, 3.4, 0, 2, 1.8, 2), c: d.color ?? 0x5fae5c });
        out.push({ g: unit.ico, m: at(0.6, 4.4, 0.3, 1.3, 1.2, 1.3), c: 0x74c26b });
        break;
      }
      case 'lamp':
        out.push({ g: unit.cyl8, m: at(0, 1.6, 0, 0.08, 3.2, 0.08), c: 0x3b3b46 });
        out.push({ g: unit.sphere, m: at(0, 3.35, 0, 0.3, 0.3, 0.3), c: 0xfff4c8 });
        break;
      case 'flag':
        out.push({ g: unit.cyl8, m: at(0, 2.5, 0, 0.07, 5, 0.07), c: 0xeeeeee });
        out.push({ g: unit.box, m: at(0.8, 4.4, 0, 1.6, 1, 0.05), c: d.color ?? CARDINAL });
        break;
      case 'bush':
        out.push({ g: unit.ico, m: at(0, 0.5, 0, 1, 0.75, 1), c: d.color ?? 0x63b35d });
        break;
      case 'hedge':
        out.push({ g: unit.box, m: at(0, 0.6, 0, 4, 1.2, 1), c: d.color ?? 0x5aa857 });
        break;
      case 'banner':
        for (const e of [-1, 1]) out.push({ g: unit.cyl8, m: at(e * 3, 2.5, 0, 0.1, 5, 0.1), c: 0xeeeeee });
        out.push({ g: unit.box, m: at(0, 4, 0, 6, 1.4, 0.06), c: d.color ?? CARDINAL });
        out.push({ g: unit.box, m: at(0, 4, 0.04, 5.4, 0.2, 0.04), c: 0xffffff });
        break;
      case 'stands': {
        for (let i = 0; i < 4; i++) out.push({ g: unit.box, m: at(0, 0.5 + i * 0.8, -i * 1.2, 14, 1 + i * 1.6, 1.2), c: i % 2 ? 0xf3e6cf : 0xe9d6b6 });
        // a little crowd of beans
        for (let i = 0; i < 4; i++) for (let j = 0; j < 9; j++) {
          const hue = (i * 9 + j) * 0.137;
          out.push({ g: unit.sphere, m: at(-6 + j * 1.5 + (i % 2) * 0.5, 1.6 + i * 1.6, -i * 1.2, 0.3, 0.5, 0.3), c: tmpC.setHSL(hue % 1, 0.6, 0.65).getHex() });
        }
        break;
      }
    }
  }

  function clearCourse() {
    for (const child of [...courseRoot.children]) courseRoot.remove(child);
    for (const g of courseOwned) g.dispose();
    for (const p of pads) (p.material as T.Material).dispose();
    courseOwned = [];
    moving = [];
    decorBounds.length = 0;
    tiles = null;
    jets = [];
    crown = null;
    pads = [];
  }

  const movingMats = new Map<string, T.Material>();
  const lookMat = (look: Look, tint?: number) => {
    const key = `${look}:${tint ?? ''}`;
    let m = movingMats.get(key);
    if (!m) movingMats.set(key, (m = mat(lambert(0xffffff, { vertexColors: true }))));
    return m;
  };

  function setCourse(course: Course) {
    clearCourse();
    const pal = course.palette;
    const pos = skyGeo.attributes.position;
    const top = new THREE.Color(pal.skyTop);
    const bottom = new THREE.Color(pal.skyBottom);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.max(0, Math.min(1, pos.getY(i) / 380 + 0.15));
      tmpC.copy(bottom).lerp(top, Math.pow(k, 0.7));
      skyColors.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    }
    skyGeo.attributes.color.needsUpdate = true;
    (scene.fog as T.Fog).color.setHex(pal.fog);
    shoreMat.color.setHex(pal.ground);

    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    const statics: Part[] = [];
    const tileList: Collider[] = [];
    const m4 = new THREE.Matrix4();
    for (const c of course.colliders) {
      if (c.look === 'hidden') continue;
      const p = c.pose;
      minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
      const color = c.tint ?? LOOK_COLORS[c.look];
      if (c.tile) {
        tileList.push(c);
        continue;
      }
      if (!c.at) {
        shapeParts(c, poseMatrix(c.pose, m4), color, statics);
        continue;
      }
      const parts: Part[] = [];
      shapeParts(c, new THREE.Matrix4(), color, parts);
      const g = bake(parts);
      courseOwned.push(g);
      let material = lookMat(c.look, c.tint);
      if (c.look === 'pad') {
        material = lambert(0xffffff, { vertexColors: true, emissive: 0x553300 });
        pads.push(null as unknown as T.Mesh);
      }
      const mesh = new THREE.Mesh(g, material);
      if (c.look === 'pad') pads[pads.length - 1] = mesh;
      mesh.matrixAutoUpdate = false;
      courseRoot.add(mesh);
      moving.push({ c, mesh });
    }
    const solidDecor = new Set<Decor['kind']>(['tower', 'arcade', 'roof', 'stands', 'arch', 'fountain']);
    for (const d of course.decor) {
      const first = statics.length;
      decorParts(d, statics);
      if (!solidDecor.has(d.kind)) continue;
      const bounds: DecorBounds = {
        box: {
          minX: Infinity, minY: Infinity, minZ: Infinity,
          maxX: -Infinity, maxY: -Infinity, maxZ: -Infinity,
        },
        parts: [],
      };
      for (let i = first; i < statics.length; i++) {
        const part = statics[i];
        if (!part.g.boundingBox) part.g.computeBoundingBox();
        const box = part.g.boundingBox;
        if (!box) continue;
        const partBox: Aabb = {
          minX: box.min.x,
          minY: box.min.y,
          minZ: box.min.z,
          maxX: box.max.x,
          maxY: box.max.y,
          maxZ: box.max.z,
        };
        bounds.parts.push({ box: partBox, inverse: part.m.clone().invert() });
        for (let corner = 0; corner < 8; corner++) {
          tmpV.set(
            corner & 1 ? box.max.x : box.min.x,
            corner & 2 ? box.max.y : box.min.y,
            corner & 4 ? box.max.z : box.min.z,
          ).applyMatrix4(part.m);
          bounds.box.minX = Math.min(bounds.box.minX, tmpV.x);
          bounds.box.minY = Math.min(bounds.box.minY, tmpV.y);
          bounds.box.minZ = Math.min(bounds.box.minZ, tmpV.z);
          bounds.box.maxX = Math.max(bounds.box.maxX, tmpV.x);
          bounds.box.maxY = Math.max(bounds.box.maxY, tmpV.y);
          bounds.box.maxZ = Math.max(bounds.box.maxZ, tmpV.z);
        }
      }
      if (Number.isFinite(bounds.box.minX)) decorBounds.push(bounds);
    }
    // little grass islands under scenery standing over the lagoon
    for (const d of course.decor) {
      if (d.kind === 'tower' && d.y > 10) continue;
      statics.push({ g: unit.cyl, m: mtx(d.x, d.y - 0.6, d.z, d.kind === 'arcade' || d.kind === 'stands' ? 10 : d.kind === 'roof' ? 8 : d.kind === 'tower' ? 6 : 3, 1.2, d.kind === 'arcade' || d.kind === 'stands' ? 10 : d.kind === 'roof' ? 8 : d.kind === 'tower' ? 6 : 3), c: pal.ground });
      statics.push({ g: unit.cyl, m: mtx(d.x, d.y - 4, d.z, d.kind === 'arcade' || d.kind === 'stands' ? 9.5 : d.kind === 'roof' ? 7.5 : d.kind === 'tower' ? 5.5 : 2.6, 6.8, d.kind === 'arcade' || d.kind === 'stands' ? 9.5 : d.kind === 'roof' ? 7.5 : d.kind === 'tower' ? 5.5 : 2.6), c: 0xd8b98e });
    }
    // sandstone undersides beneath the play floors, so the stage reads as raised over the water
    for (const c of course.colliders) {
      if (c.at || c.tile || c.look === 'hidden' || c.shape.kind !== 'box') continue;
      if (!(c.look === 'grass' || c.look === 'path' || c.look === 'start' || c.look === 'finish' || c.look === 'wet')) continue;
      if (c.pose.m[4] < 0.97) continue;
      const s = c.shape;
      const bottom = c.pose.y - s.hy;
      const depth = bottom - (course.killY + 4);
      if (depth < 1 || s.hx > 40) continue;
      statics.push({ g: unit.box, m: mtx(c.pose.x, bottom - Math.min(depth, 3) / 2, c.pose.z, s.hx * 2 * 0.96, Math.min(depth, 3), s.hz * 2 * 0.96, Math.atan2(c.pose.m[2], c.pose.m[0]) * -1), c: 0xd9b98c });
    }
    if (statics.length) {
      const g = bake(statics);
      courseOwned.push(g);
      courseRoot.add(new THREE.Mesh(g, bakedMat));
    }
    if (tileList.length) {
      const g = keepCourse(new THREE.CylinderGeometry(1, 1, 1, 6, 1));
      const im = new THREE.InstancedMesh(g, mat(lambert(0xffffff)), tileList.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const base: number[] = [];
      const layerColors = [0xf0cf9c, 0xf2b8a0, 0xbfd8f0, 0xd4c4f0];
      tileList.forEach((c, i) => {
        const b = layerColors[(c.tile?.layer ?? 0) % layerColors.length];
        tmpC.setHex(b).offsetHSL(0, 0, ((i * 37) % 7) * 0.008 - 0.02);
        base.push(tmpC.getHex());
        im.setColorAt(i, tmpC);
      });
      courseRoot.add(im);
      tiles = { mesh: im, list: tileList, base };
    }
    for (const z of course.zones) {
      if (z.kind === 'jet') {
        const mesh = new THREE.Mesh(unit.cyl8, mat(lambert(0xbff0fa, { transparent: true, opacity: 0.7 })));
        courseRoot.add(mesh);
        jets.push({ z, mesh });
      }
      if (z.kind === 'crown') {
        crown = new THREE.Group();
        const gold = mat(lambert(0xffc93c, { emissive: 0x664400 }));
        const ring = new THREE.Mesh(unit.cyl, gold);
        ring.scale.set(0.7, 0.45, 0.7);
        crown.add(ring);
        for (let i = 0; i < 5; i++) {
          const spike = new THREE.Mesh(unit.cone, gold);
          const a = (i / 5) * Math.PI * 2;
          spike.position.set(Math.cos(a) * 0.55, 0.45, Math.sin(a) * 0.55);
          spike.scale.set(0.16, 0.5, 0.16);
          crown.add(spike);
        }
        const scroll = new THREE.Mesh(unit.cyl, mat(lambert(0xfffaf0)));
        scroll.rotation.z = Math.PI / 2;
        scroll.scale.set(0.2, 1.6, 0.2);
        scroll.position.y = -0.55;
        crown.add(scroll);
        crown.position.set(z.x, z.y, z.z);
        courseRoot.add(crown);
      }
      if (z.kind === 'finish') {
        const parts: Part[] = [];
        for (let i = 0; i < 2; i++) parts.push({ g: unit.box, m: mtx(z.x + (i ? 1 : -1) * (z.hx + 0.4), z.y + 2.5, z.z, 0.8, 5, 0.8), c: 0xffffff });
        parts.push({ g: unit.box, m: mtx(z.x, z.y + 5.2, z.z, z.hx * 2 + 1.6, 1.2, 0.9), c: CARDINAL });
        for (let i = 0; i < 12; i++) parts.push({ g: unit.box, m: mtx(z.x - z.hx + (i + 0.5) * (z.hx * 2 / 12), z.y + 5.2, z.z + 0.47, z.hx * 2 / 12 - 0.06, 0.5, 0.04), c: i % 2 ? 0xffffff : 0xffc93c });
        const g = bake(parts);
        courseOwned.push(g);
        courseRoot.add(new THREE.Mesh(g, bakedMat));
      }
    }
    center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, r: Math.max(maxX - minX, maxZ - minZ) / 2 + 30 };
    waterY = course.killY + 5;
    water.position.set(center.x, waterY, center.z);
    shore.position.set(center.x, 0.2, center.z);
    shore.scale.set(center.r + 25, center.r + 25, 1);
    scene.fog = new THREE.Fog(pal.fog, center.r * 0.9 + 60, center.r * 2.4 + 200);
  }
  function keepCourse<G extends T.BufferGeometry>(g: G) {
    courseOwned.push(g);
    return g;
  }

  // ---------------------------------------------------------------- players
  const beanGeo = keepG(new THREE.SphereGeometry(1, 14, 10));
  const parts = {
    bean: new THREE.InstancedMesh(beanGeo, mat(lambert(0xffffff)), MAX_PLAYERS),
    gown: new THREE.InstancedMesh(keepG(new THREE.CylinderGeometry(0.38, 0.5, 0.64, 10, 1, true)), mat(lambert(CARDINAL, { side: THREE.DoubleSide })), MAX_PLAYERS),
    collar: new THREE.InstancedMesh(keepG(new THREE.TorusGeometry(0.4, 0.07, 5, 12)), mat(lambert(0xfff3e0)), MAX_PLAYERS),
    board: new THREE.InstancedMesh(keepG(new THREE.BoxGeometry(0.78, 0.06, 0.78)), mat(lambert(0x22222b)), MAX_PLAYERS),
    skull: new THREE.InstancedMesh(keepG(new THREE.CylinderGeometry(0.31, 0.34, 0.18, 10)), mat(lambert(0x22222b)), MAX_PLAYERS),
    tassel: new THREE.InstancedMesh(keepG(new THREE.BoxGeometry(0.06, 0.34, 0.06)), mat(lambert(0xffffff)), MAX_PLAYERS),
    eye: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, 8, 6)), mat(lambert(0xffffff)), MAX_PLAYERS * 2),
    pupil: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, 6, 5)), mat(new THREE.MeshBasicMaterial({ color: 0x1b1b22 })), MAX_PLAYERS * 2),
    shadow: new THREE.InstancedMesh(keepG(new THREE.CircleGeometry(0.55, 16)), mat(new THREE.MeshBasicMaterial({ color: 0x1a2a2a, transparent: true, opacity: 0.22, depthWrite: false })), MAX_PLAYERS),
  };
  for (const p of Object.values(parts)) {
    p.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    p.frustumCulled = false;
    p.count = 0;
    scene.add(p);
  }
  let looks: PlayerLook[] = [];
  const anim = Array.from({ length: MAX_PLAYERS }, () => ({ pitch: 0, roll: 0, lift: 0, bob: 0, swing: 0, spin: 0 }));
  const white = new THREE.Color(0xffffff);
  function setPlayers(list: PlayerLook[]) {
    looks = list.slice(0, MAX_PLAYERS);
    looks.forEach((l, i) => {
      tmpC.setHex(l.color);
      parts.bean.setColorAt(i, tmpC);
      parts.tassel.setColorAt(i, tmpC);
    });
    for (let i = 0; i < MAX_PLAYERS * 2; i++) parts.eye.setColorAt(i, white);
    if (parts.bean.instanceColor) parts.bean.instanceColor.needsUpdate = true;
    if (parts.tassel.instanceColor) parts.tassel.instanceColor.needsUpdate = true;
  }

  const bodyM = new THREE.Matrix4();
  const partM = new THREE.Matrix4();
  const local = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
    setMtx(new THREE.Matrix4(), x, y, z, sx, sy, sz, yaw, pitch, roll);
  const L = {
    bean: local(0, 0.72, 0, 0.46, 0.72, 0.44),
    gown: local(0, 0.32, 0, 1, 1, 1),
    collar: local(0, 0.66, 0.02, 1.0, 1.0, 0.9, 0, Math.PI / 2),
    board: local(0, 1.47, 0, 1, 1, 1, Math.PI / 4, -0.12),
    skull: local(0, 1.38, 0, 1, 1, 1, 0, -0.12),
    eyeL: local(-0.15, 1.08, 0.36, 0.1, 0.12, 0.08),
    eyeR: local(0.15, 1.08, 0.36, 0.1, 0.12, 0.08),
    pupL: local(-0.15, 1.08, 0.43, 0.05, 0.06, 0.04),
    pupR: local(0.15, 1.08, 0.43, 0.05, 0.06, 0.04),
  };
  let clock = 0;
  function placePlayers(course: Course, bodies: readonly (BodyView | null)[], dt: number) {
    let n = 0;
    for (let i = 0; i < looks.length; i++) {
      const id = looks[i].id;
      const b = bodies[id];
      if (!b) continue;
      const a = anim[i];
      const speed = Math.hypot(b.vx, b.vz);
      const lying = b.state === 'dive' || b.state === 'flop';
      a.pitch = damp(a.pitch, lying ? Math.PI / 2 * 0.92 : b.state === 'stun' ? Math.PI / 2 * 0.7 : Math.min(0.25, speed * 0.02), lying ? 18 : 10, dt);
      a.spin = b.state === 'stun' ? a.spin + dt * 9 : damp(a.spin, 0, 8, dt);
      a.lift = damp(a.lift, lying || b.state === 'stun' ? 0.4 : 0, 14, dt);
      a.bob += dt * speed * 2.2;
      const ground = b.state === 'run' && speed > 0.5;
      a.roll = damp(a.roll, ground ? Math.sin(a.bob) * 0.12 : 0, 12, dt);
      a.swing = damp(a.swing, Math.max(-1, Math.min(1, -b.vy * 0.06 + speed * 0.05)), 6, dt);
      const s = b.squash + (ground ? Math.abs(Math.sin(a.bob)) * 0.06 : 0);
      const sy = 1 - s;
      const sxz = 1 + s * 0.55;
      bodyM.compose(tmpV.set(b.x, b.y, b.z), tmpQ.setFromEuler(tmpE.set(0, b.yaw, 0, 'YXZ')), tmpS.set(1, 1, 1));
      bodyM.multiply(setMtx(scratchMtx, 0, a.lift, 0, 1, 1, 1, 0, a.pitch, a.roll + Math.sin(a.spin) * 0.6))
        .multiply(setMtx(scratchMtx, 0, 0, 0, sxz, sy, sxz));
      parts.bean.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.bean));
      parts.gown.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.gown));
      parts.collar.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.collar));
      parts.board.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.board));
      parts.skull.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.skull));
      parts.tassel.setMatrixAt(n, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, 0.36, 1.32, 0.08, 1, 1, 1, 0, -a.swing * 0.8, 0.15)));
      const blink = Math.sin(clock * 1.3 + i * 2.1) > 0.985 ? 0.15 : 1;
      parts.eye.setMatrixAt(n * 2, partM.multiplyMatrices(bodyM, L.eyeL).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.eye.setMatrixAt(n * 2 + 1, partM.multiplyMatrices(bodyM, L.eyeR).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.pupil.setMatrixAt(n * 2, partM.multiplyMatrices(bodyM, L.pupL).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.pupil.setMatrixAt(n * 2 + 1, partM.multiplyMatrices(bodyM, L.pupR).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      if (parts.bean.instanceColor) {
        tmpC.setHex(looks[i].color);
        parts.bean.setColorAt(n, tmpC);
        parts.tassel.setColorAt(n, tmpC);
      }
      const gy = groundBelow(course, b.x, b.y + 0.3, b.z, 12);
      if (gy !== null) {
        const h = Math.max(0, b.y - gy);
        const k = Math.max(0.25, 1 - h * 0.12);
        parts.shadow.setMatrixAt(n, setMtx(scratchMtx, b.x, gy + 0.04, b.z, k, k, k, 0, -Math.PI / 2));
      } else parts.shadow.setMatrixAt(n, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
      n++;
    }
    for (const p of Object.values(parts)) {
      p.count = p === parts.eye || p === parts.pupil ? n * 2 : n;
      p.instanceMatrix.needsUpdate = true;
    }
    if (parts.bean.instanceColor) parts.bean.instanceColor.needsUpdate = true;
    if (parts.tassel.instanceColor) parts.tassel.instanceColor.needsUpdate = true;
  }
  const playerParts = Object.values(parts);

  // ---------------------------------------------------------------- confetti and splashes
  const confettiMesh = new THREE.InstancedMesh(keepG(new THREE.PlaneGeometry(0.16, 0.26)), mat(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), CONFETTI);
  confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confettiMesh.frustumCulled = false;
  scene.add(confettiMesh);
  const bits = Array.from({ length: CONFETTI }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, r: 0, vr: 0, life: 0 }));
  const confettiColors = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xb388ff, 0xff8fab, 0xffffff, CARDINAL];
  for (let i = 0; i < CONFETTI; i++) confettiMesh.setColorAt(i, tmpC.setHex(confettiColors[i % confettiColors.length]));
  for (let i = 0; i < CONFETTI; i++) confettiMesh.setMatrixAt(i, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
  confettiMesh.instanceMatrix.needsUpdate = true;
  let nextBit = 0;
  const dropMesh = new THREE.InstancedMesh(keepG(new THREE.IcosahedronGeometry(0.16, 0)), mat(lambert(0xd6f6ff)), DROPS);
  dropMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  dropMesh.frustumCulled = false;
  scene.add(dropMesh);
  const drops = Array.from({ length: DROPS }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, life: 0 }));
  for (let i = 0; i < DROPS; i++) dropMesh.setMatrixAt(i, setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
  dropMesh.instanceMatrix.needsUpdate = true;
  let nextDrop = 0;

  function confetti(x: number, y: number, z: number, count = 80) {
    for (let i = 0; i < count; i++) {
      const b = bits[nextBit];
      nextBit = (nextBit + 1) % CONFETTI;
      const a = Math.random() * Math.PI * 2;
      const s = 2 + Math.random() * 5;
      Object.assign(b, { x, y, z, vx: Math.cos(a) * s, vy: 5 + Math.random() * 7, vz: Math.sin(a) * s, r: Math.random() * 6, vr: (Math.random() - 0.5) * 14, life: 2.5 + Math.random() * 1.5 });
    }
  }
  function splash(x: number, y: number, z: number) {
    for (let i = 0; i < 18; i++) {
      const d = drops[nextDrop];
      nextDrop = (nextDrop + 1) % DROPS;
      const a = Math.random() * Math.PI * 2;
      Object.assign(d, { x, y, z, vx: Math.cos(a) * 2.5, vy: 4 + Math.random() * 4, vz: Math.sin(a) * 2.5, life: 1.1 });
    }
  }
  function stepParticles(dt: number) {
    let confettiChanged = false;
    for (let i = 0; i < CONFETTI; i++) {
      const b = bits[i];
      if (b.life <= 0) continue;
      b.life -= dt;
      b.vy -= 7 * dt;
      b.vx *= 1 - dt * 1.4;
      b.vz *= 1 - dt * 1.4;
      b.vy = Math.max(b.vy, -2.2);
      b.x += b.vx * dt; b.y += b.vy * dt; b.z += b.vz * dt;
      b.r += b.vr * dt;
      confettiMesh.setMatrixAt(i, b.life > 0
        ? setMtx(scratchMtx, b.x, b.y, b.z, 1, 1, 1, b.r, b.r * 0.7, b.r * 1.3)
        : setMtx(scratchMtx, 0, -999, 0, 0, 0, 0));
      confettiChanged = true;
    }
    if (confettiChanged) confettiMesh.instanceMatrix.needsUpdate = true;
    let dropsChanged = false;
    for (let i = 0; i < DROPS; i++) {
      const d = drops[i];
      if (d.life <= 0) continue;
      d.life -= dt;
      d.vy -= 18 * dt;
      d.x += d.vx * dt; d.y += d.vy * dt; d.z += d.vz * dt;
      const active = d.life > 0;
      const k = active ? Math.min(1, d.life * 2) : 0;
      dropMesh.setMatrixAt(i, setMtx(scratchMtx, d.x, active ? d.y : -999, d.z, k, k, k));
      dropsChanged = true;
    }
    if (dropsChanged) dropMesh.instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- frame
  const camPos = new THREE.Vector3(0, 10, -20);
  const camLook = new THREE.Vector3();
  let camReady = false;
  const want = new THREE.Vector3();
  const look = new THREE.Vector3();
  let fly = 0;
  const frameMtx = new THREE.Matrix4();
  const cameraTry = new THREE.Vector3();
  function cameraClearance(course: Course, from: T.Vector3, to: T.Vector3): number {
    let fraction = rayCast(course, from, to, true);
    for (const bounds of decorBounds) {
      if (rayBox(from, to, bounds.box) >= fraction) continue;
      for (const part of bounds.parts) {
        decorRayFrom.copy(from).applyMatrix4(part.inverse);
        if (
          decorRayFrom.x >= part.box.minX && decorRayFrom.x <= part.box.maxX &&
          decorRayFrom.y >= part.box.minY && decorRayFrom.y <= part.box.maxY &&
          decorRayFrom.z >= part.box.minZ && decorRayFrom.z <= part.box.maxZ
        ) continue;
        decorRayTo.copy(to).applyMatrix4(part.inverse);
        fraction = Math.min(fraction, rayBox(decorRayFrom, decorRayTo, part.box));
      }
    }
    return fraction;
  }
  function frame(course: Course, t: number, bodies: readonly (BodyView | null)[], focus: number | null, cam: CamState, dt: number) {
    clock += dt;
    const m4 = frameMtx;
    for (const { c, mesh } of moving) {
      mesh.visible = c.on;
      if (c.on) poseMatrix(c.pose, mesh.matrix);
      mesh.matrixWorldNeedsUpdate = true;
    }
    for (const p of pads) (p.material as T.MeshLambertMaterial).emissive.setRGB(0.3 + Math.sin(clock * 6) * 0.15, 0.18, 0);
    if (tiles) {
      const { mesh, list, base } = tiles;
      let colors = false;
      list.forEach((c, i) => {
        const s = c.shape as { r: number; hy: number };
        if (!c.on) {
          mesh.setMatrixAt(i, m4.makeScale(0, 0, 0));
          return;
        }
        const cracking = c.tile?.touchedAt != null && (c.tile.fallAt == null || t < c.tile.fallAt);
        const shake = cracking ? Math.sin(clock * 50 + i) * 0.04 : 0;
        poseMatrix(c.pose, m4).multiply(setMtx(scratchMtx, shake, 0, -shake, s.r * 1.02, s.hy * 2, s.r * 1.02));
        mesh.setMatrixAt(i, m4);
        const wantC = c.tile?.touchedAt != null ? 0xff8a65 : base[i];
        mesh.getColorAt(i, tmpC);
        if (tmpC.getHex() !== wantC) {
          tmpC.setHex(wantC);
          mesh.setColorAt(i, tmpC);
          colors = true;
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const { z, mesh } of jets) {
      const on = z.on?.(t) ?? true;
      const h = z.hy * 2;
      mesh.visible = on;
      if (on) {
        const p = z.push ?? { x: 0, y: 0, z: 0 };
        const sideways = Math.abs(p.x) + Math.abs(p.z) > Math.abs(p.y);
        if (sideways) {
          const yaw = Math.atan2(p.x, p.z);
          const len = Math.max(z.hx, z.hz) * 2;
          mesh.position.set(z.x, z.y - z.hy + 0.9, z.z);
          mesh.rotation.set(Math.PI / 2, 0, 0);
          mesh.rotation.y = yaw;
          mesh.rotation.order = 'YXZ';
          mesh.scale.set(0.5 + Math.sin(clock * 30) * 0.05, len, 0.5);
        } else {
          mesh.position.set(z.x, z.y, z.z);
          mesh.rotation.set(0, 0, 0);
          mesh.scale.set(Math.min(z.hx, z.hz) * 0.8, h, Math.min(z.hx, z.hz) * 0.8);
        }
      }
    }
    if (crown) {
      crown.rotation.y = clock * 1.4;
      crown.position.y = (course.zones.find((z) => z.kind === 'crown')?.y ?? 0) + 0.8 + Math.sin(clock * 2) * 0.15;
    }
    water.position.y = waterY + Math.sin(clock * 0.8) * 0.05;
    placePlayers(course, bodies, dt);
    stepParticles(dt);

    const target = focus !== null ? bodies[focus] : null;
    if (target) {
      const cp = Math.cos(cam.pitch);
      look.set(target.x, target.y + 1.6, target.z);
      want.set(look.x - Math.sin(cam.yaw) * cp * cam.dist, look.y + Math.sin(cam.pitch) * cam.dist, look.z - Math.cos(cam.yaw) * cp * cam.dist);
      let f = cameraClearance(course, look, want);
      if (f < 0.85) {
        for (const offset of CAMERA_ORBITS) {
          const yaw = cam.yaw + offset;
          cameraTry.set(
            look.x - Math.sin(yaw) * cp * cam.dist,
            look.y + Math.sin(cam.pitch) * cam.dist,
            look.z - Math.cos(yaw) * cp * cam.dist,
          );
          const candidate = cameraClearance(course, look, cameraTry);
          if (candidate > f) {
            f = candidate;
            want.copy(cameraTry);
          }
          if (f >= 0.98) break;
        }
      }
      if (f < 1) want.lerpVectors(look, want, Math.max(0.04, f - 0.08));
      const ground = groundBelow(course, want.x, want.y, want.z);
      if (ground !== null && want.y < ground + 0.5) want.y = ground + 0.5;
      if (!camReady) {
        camPos.copy(want);
        camLook.copy(look);
        camReady = true;
      } else if (cameraClearance(course, look, camPos) < 0.98) {
        camPos.copy(want);
      } else {
        camPos.x = damp(camPos.x, want.x, 9, dt);
        camPos.y = damp(camPos.y, want.y, 7, dt);
        camPos.z = damp(camPos.z, want.z, 9, dt);
      }
      if (f < 1) camPos.lerp(want, 0.5);
      camLook.x = damp(camLook.x, look.x, 14, dt);
      camLook.y = damp(camLook.y, look.y, 10, dt);
      camLook.z = damp(camLook.z, look.z, 14, dt);
    } else {
      fly += dt * 0.12;
      const r = Math.min(70, center.r * 0.7);
      camPos.set(center.x + Math.sin(fly) * r, 26 + center.r * 0.12, center.z + Math.cos(fly) * r);
      camLook.set(center.x, 0, center.z);
      camReady = false;
    }
    camera.position.copy(camPos);
    camera.lookAt(camLook);
    sky.position.copy(camPos);
  }

  let w = 1;
  let h = 1;
  const v = new THREE.Vector3();
  const view: View = {
    gl,
    resize(nw, nh) {
      w = Math.max(1, nw);
      h = Math.max(1, nh);
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = w / h < 0.8 ? 72 : 60;
      camera.updateProjectionMatrix();
    },
    setCourse,
    setPlayers,
    frame,
    project(x, y, z) {
      v.set(x, y, z).project(camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) return null;
      return { x: (v.x * 0.5 + 0.5) * w, y: (-v.y * 0.5 + 0.5) * h };
    },
    confetti,
    splash,
    render() {
      if (gl.lost()) return;
      renderer.render(scene, camera);
    },
    dispose() {
      clearCourse();
      disposeTree(scene);
      for (const g of own) g.dispose();
      for (const m of mats) m.dispose();
      gl.dispose();
    },
  };
  return view;
}

export function createScene(THREE: Three, host: HTMLElement, touch: boolean): View | null {
  return build(THREE, host, touch);
}
