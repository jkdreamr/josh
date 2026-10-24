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
const CARDINAL = 0x9b1c1f;
const CAMERA_ORBITS = [Math.PI / 4, -Math.PI / 4, Math.PI / 2, -Math.PI / 2, Math.PI];

const LOOK_COLORS: Record<Look, number> = {
  grass: 0x8fd18a, path: 0xf2dfb8, sand: 0xe8c99a, stone: 0xd9cbb5, roof: 0xd9654b, wood: 0xc08a5a, tube: 0xfffaf0,
  bar: 0xc0302f, bumper: 0xff8fa3, water: 0x7fd3e6, wet: 0x9fd8ea, hex: 0xeacb98, gold: 0xffc93c, coconut: 0x8a5a36,
  frond: 0x5fbf5a, pad: 0xffb84a, start: 0x7fd6c4, finish: 0xffe27a, hidden: 0xffffff,
};

type Surface = 'plain' | 'grass' | 'sandstone' | 'roof' | 'paper' | 'stripe' | 'pad' | 'coconut';

/** A part to bake into a merged, vertex colored mesh. */
type Part = { g: T.BufferGeometry; m: T.Matrix4; c: number; surface?: Surface };
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
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(60, 1, 0.1, 420);
  const hemi = new THREE.HemisphereLight(0xcfe8ff, 0x8fbf7a, 1.2);
  const sun = new THREE.DirectionalLight(0xffe2b7, 2.2);
  const rim = new THREE.DirectionalLight(0xb9d9ff, 0.4);
  sun.position.set(-44, 62, -38);
  rim.position.set(36, 24, 44);
  scene.add(hemi, sun, rim);
  const CONFETTI = touch ? 220 : 360;
  const DROPS = touch ? 72 : 120;

  // shared unit geometries (non indexed, so they bake straight into merged meshes)
  const own: T.BufferGeometry[] = [];
  const keepG = <G extends T.BufferGeometry>(g: G) => {
    own.push(g);
    return g;
  };
  const unit = {
    box: keepG(new THREE.BoxGeometry(1, 1, 1).toNonIndexed()),
    cyl: keepG(new THREE.CylinderGeometry(1, 1, 1, touch ? 10 : 18, 1).toNonIndexed()),
    cyl6: keepG(new THREE.CylinderGeometry(1, 1, 1, 6, 1).toNonIndexed()),
    cyl8: keepG(new THREE.CylinderGeometry(1, 1, 1, touch ? 7 : 10, 1).toNonIndexed()),
    cone: keepG(new THREE.ConeGeometry(1, 1, touch ? 6 : 10, 1).toNonIndexed()),
    cone4: keepG(new THREE.ConeGeometry(1, 1, 4, 1).toNonIndexed()),
    prism: keepG(new THREE.CylinderGeometry(1, 1, 1, 3, 1).toNonIndexed()),
    sphere: keepG(new THREE.SphereGeometry(1, touch ? 9 : 16, touch ? 6 : 12).toNonIndexed()),
    ico: keepG(new THREE.IcosahedronGeometry(1, 0)),
    half: keepG(new THREE.TorusGeometry(1, 0.16, 5, 10, Math.PI).toNonIndexed()),
    leaf: keepG((() => {
      const g = new THREE.BufferGeometry();
      const positions: number[] = [];
      const segments = 8;
      const edge = (i: number, side: number) => {
        const t = i / segments;
        return [t * 2.7, -t * t * 0.95 + Math.sin(t * Math.PI) * 0.23 * side, 0];
      };
      const push = (v: number[]) => positions.push(v[0], v[1], v[2]);
      for (let i = 0; i < segments; i++) {
        const left = edge(i, 1), right = edge(i, -1);
        const nextLeft = edge(i + 1, 1), nextRight = edge(i + 1, -1);
        push(left); push(right); push(nextLeft);
        push(right); push(nextRight); push(nextLeft);
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
      g.computeVertexNormals();
      return g;
    })()),
    flag: keepG((() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 0.52, -0.82, 0], 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 0.52, 0], 2));
      g.computeVertexNormals();
      return g;
    })()),
  };
  const lambert = (color: number, extra: T.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: false, ...extra });
  const mats: T.Material[] = [];
  const mat = <M extends T.Material>(m: M) => {
    mats.push(m);
    return m;
  };
  const textures: T.CanvasTexture[] = [];
  const makeTexture = (paint: (ctx: CanvasRenderingContext2D, size: number) => void) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D context unavailable');
    paint(ctx, canvas.width);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
    textures.push(texture);
    return texture;
  };
  const grassTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#70b75d';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#86c76e' : '#79bd63';
      ctx.fillRect(i * 32, 0, 32, size);
    }
    for (let i = 0; i < 620; i++) {
      const x = (i * 73) % size;
      const y = (i * 151) % size;
      ctx.fillStyle = i % 2 ? 'rgba(35,87,43,.10)' : 'rgba(235,255,207,.12)';
      ctx.fillRect(x, y, 1 + (i % 3), 1 + (i % 2));
    }
  });
  const sandstoneTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#ddc79f';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 8; row++) {
      const y = row * 32;
      const offset = row % 2 ? -32 : 0;
      for (let col = -1; col < 5; col++) {
        const x = col * 64 + offset;
        ctx.fillStyle = (row + col) % 3 ? '#f4e3c0' : '#e8d3ac';
        ctx.fillRect(x + 2, y + 2, 60, 28);
        ctx.fillStyle = 'rgba(128,94,61,.18)';
        ctx.fillRect(x + 2, y + 27, 60, 3);
      }
      ctx.fillStyle = '#b99f78';
      ctx.fillRect(0, y, size, 2);
    }
    for (let i = 0; i < 380; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(110,79,48,.08)' : 'rgba(255,250,224,.18)';
      ctx.fillRect((i * 41) % size, (i * 97) % size, 1 + (i % 2), 1 + (i % 3));
    }
  });
  const roofTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#a74739';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 8; row++) {
      for (let col = -1; col < 9; col++) {
        const x = col * 32 + (row % 2) * 16;
        const y = row * 32;
        ctx.fillStyle = row % 2 ? '#c85b43' : '#b94d3b';
        ctx.beginPath();
        ctx.roundRect(x + 1, y + 1, 30, 29, [8, 8, 2, 2]);
        ctx.fill();
        ctx.strokeStyle = 'rgba(91,42,38,.55)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(x + 2, y + 27);
        ctx.lineTo(x + 30, y + 27);
        ctx.stroke();
        ctx.strokeStyle = 'rgba(255,185,129,.22)';
        ctx.beginPath();
        ctx.moveTo(x + 5, y + 4);
        ctx.lineTo(x + 26, y + 4);
        ctx.stroke();
      }
    }
  });
  const paperTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#fff3d8';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 900; i++) {
      ctx.fillStyle = i % 2 ? 'rgba(117,81,48,.08)' : 'rgba(255,255,255,.35)';
      ctx.fillRect((i * 47) % size, (i * 113) % size, 1, 1);
    }
  });
  const stripeTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#fff7ec';
    ctx.fillRect(0, 0, size, size);
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(Math.PI / 4);
    for (let x = -size; x < size; x += 48) {
      ctx.fillStyle = Math.floor(x / 48) % 2 ? '#b52631' : '#f4f0e8';
      ctx.fillRect(x, -size, 24, size * 2);
    }
    ctx.restore();
  });
  const padTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#78cbb9';
    ctx.fillRect(0, 0, size, size);
    const colors = ['#ffd46f', '#fa9ca5', '#98d6f1', '#f9efd4'];
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.rotate(-Math.PI / 5);
    for (let i = -6; i < 7; i++) {
      ctx.fillStyle = colors[(i + 12) % colors.length];
      ctx.fillRect(i * 48, -size, 25, size * 2);
    }
    ctx.restore();
  });
  const coconutTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#764828';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 880; i++) {
      const x = (i * 67) % size;
      const y = (i * 137) % size;
      ctx.strokeStyle = i % 3 ? 'rgba(42,23,12,.75)' : 'rgba(211,158,92,.65)';
      ctx.lineWidth = i % 4 === 0 ? 2 : 1;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + (i % 7) - 3, y + 3 + (i % 6));
      ctx.stroke();
    }
  });
  const waterTex = makeTexture((ctx, size) => {
    ctx.fillStyle = '#a7e2eb';
    ctx.fillRect(0, 0, size, size);
    for (let row = 0; row < 8; row++) {
      const y = row * 34 + 8;
      for (let col = 0; col < 5; col++) {
        const x = col * 62 + (row % 2) * 27;
        ctx.strokeStyle = 'rgba(255,255,255,.72)';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x, y, 18 + (col % 3) * 6, 4, -0.15, 0.15, Math.PI * 0.92);
        ctx.stroke();
      }
    }
    ctx.strokeStyle = 'rgba(61,170,194,.25)';
    ctx.lineWidth = 2;
    for (let row = 0; row < 5; row++) {
      ctx.beginPath();
      ctx.moveTo(0, row * 58 + 30);
      ctx.bezierCurveTo(80, row * 58 + 8, 170, row * 58 + 55, size, row * 58 + 26);
      ctx.stroke();
    }
  });
  const shadowTex = makeTexture((ctx, size) => {
    const gradient = ctx.createRadialGradient(size / 2, size / 2, size * 0.08, size / 2, size / 2, size * 0.5);
    gradient.addColorStop(0, 'rgba(25,34,38,.38)');
    gradient.addColorStop(0.35, 'rgba(25,34,38,.24)');
    gradient.addColorStop(0.72, 'rgba(25,34,38,.08)');
    gradient.addColorStop(1, 'rgba(25,34,38,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, size, size);
  });
  const crackTex = makeTexture((ctx, size) => {
    ctx.clearRect(0, 0, size, size);
    ctx.strokeStyle = 'rgba(86,50,38,.92)';
    ctx.lineWidth = 4;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.12;
      const x = size / 2 + Math.cos(a) * size * 0.45;
      const y = size / 2 + Math.sin(a) * size * 0.45;
      ctx.beginPath();
      ctx.moveTo(size / 2, size / 2);
      ctx.lineTo(size / 2 + Math.cos(a + 0.08) * size * 0.22, size / 2 + Math.sin(a + 0.08) * size * 0.22);
      ctx.lineTo(x, y);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(size / 2 + Math.cos(a + 0.08) * size * 0.22, size / 2 + Math.sin(a + 0.08) * size * 0.22);
      ctx.lineTo(size / 2 + Math.cos(a + 0.25) * size * 0.31, size / 2 + Math.sin(a + 0.25) * size * 0.31);
      ctx.stroke();
    }
  });
  const surfaceMaps: Partial<Record<Surface, T.CanvasTexture>> = {
    grass: grassTex, sandstone: sandstoneTex, roof: roofTex, paper: paperTex, stripe: stripeTex, pad: padTex, coconut: coconutTex,
  };
  const surfaceForLook = (look: Look): Surface => {
    if (look === 'grass') return 'grass';
    if (look === 'path' || look === 'sand' || look === 'stone' || look === 'start' || look === 'finish' || look === 'wet' || look === 'hex' || look === 'gold') return 'sandstone';
    if (look === 'roof') return 'roof';
    if (look === 'tube') return 'paper';
    if (look === 'bar') return 'stripe';
    if (look === 'pad') return 'pad';
    if (look === 'coconut') return 'coconut';
    return 'plain';
  };
  const bakedMats = new Map<Surface, T.Material>();
  const bakedMat = (surface: Surface) => {
    let material = bakedMats.get(surface);
    if (!material) {
      material = mat(new THREE.MeshStandardMaterial({
        color: 0xffffff, ...(surfaceMaps[surface] ? { map: surfaceMaps[surface] } : {}), vertexColors: true, roughness: surface === 'stripe' || surface === 'pad' ? 0.4 : 0.88,
        side: THREE.DoubleSide,
      }));
      bakedMats.set(surface, material);
    }
    return material;
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
    const uv = new Float32Array(n * 2);
    let o = 0;
    for (const p of parts) {
      const ps = p.g.attributes.position;
      const ns = p.g.attributes.normal;
      const surface = p.surface ?? 'plain';
      tmpC.setHex(surface === 'grass' || surface === 'stripe' || surface === 'pad' ? 0xffffff : p.c);
      const scale = surface === 'grass' ? 0.24 : surface === 'sandstone' ? 0.5 : surface === 'roof' ? 0.42 :
        surface === 'paper' ? 0.6 : surface === 'stripe' || surface === 'pad' ? 0.32 : surface === 'coconut' ? 0.8 : 1;
      for (let i = 0; i < ps.count; i++) {
        tmpV.fromBufferAttribute(ps, i).applyMatrix4(p.m);
        pos[o * 3] = tmpV.x;
        pos[o * 3 + 1] = tmpV.y;
        pos[o * 3 + 2] = tmpV.z;
        tmpV.fromBufferAttribute(ns, i).transformDirection(p.m);
        nor[o * 3] = tmpV.x;
        nor[o * 3 + 1] = tmpV.y;
        nor[o * 3 + 2] = tmpV.z;
        const shade = tmpV.y > 0.55 ? 1.12 : tmpV.y < -0.55 ? 0.68 : 0.88;
        col[o * 3] = Math.min(1, tmpC.r * shade);
        col[o * 3 + 1] = Math.min(1, tmpC.g * shade);
        col[o * 3 + 2] = Math.min(1, tmpC.b * shade);
        if (Math.abs(tmpV.y) > 0.65) {
          uv[o * 2] = pos[o * 3] * scale;
          uv[o * 2 + 1] = pos[o * 3 + 2] * scale;
        } else if (Math.abs(tmpV.x) > Math.abs(tmpV.z)) {
          uv[o * 2] = pos[o * 3 + 2] * scale;
          uv[o * 2 + 1] = pos[o * 3 + 1] * scale;
        } else {
          uv[o * 2] = pos[o * 3] * scale;
          uv[o * 2 + 1] = pos[o * 3 + 1] * scale;
        }
        o++;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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
  waterTex.repeat.set(72, 72);
  const waterMat = mat(new THREE.MeshStandardMaterial({
    color: 0xffffff, map: waterTex, transparent: true, opacity: 0.82, roughness: 0.24, metalness: 0.03, depthWrite: false,
  }));
  const water = new THREE.Mesh(keepG(new THREE.PlaneGeometry(900, 900, 1, 1)), waterMat);
  water.rotation.x = -Math.PI / 2;
  scene.add(water);
  const shoreMat = mat(new THREE.MeshStandardMaterial({ color: 0xffffff, map: grassTex, roughness: 1 }));
  const shore = new THREE.Mesh(keepG(new THREE.RingGeometry(1, 3.2, 48, 1)), shoreMat);
  shore.rotation.x = -Math.PI / 2;
  scene.add(shore);
  const hillCount = touch ? 12 : 20;
  const hillGeo = keepG(new THREE.SphereGeometry(1, touch ? 9 : 14, touch ? 6 : 10));
  const hillMesh = new THREE.InstancedMesh(hillGeo, mat(new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true })), hillCount);
  hillMesh.frustumCulled = false;
  scene.add(hillMesh);
  const hillColors = [0x91c584, 0x80b978, 0xa4ce91, 0x77ad70];
  for (let i = 0; i < hillCount; i++) hillMesh.setColorAt(i, tmpC.setHex(hillColors[i % hillColors.length]));
  if (hillMesh.instanceColor) hillMesh.instanceColor.needsUpdate = true;
  const cloudGroups = touch ? 10 : 18;
  const cloudPuffs = Array.from({ length: cloudGroups * 4 }, (_, i) => {
    const puff = i % 4;
    return {
      phase: Math.floor(i / 4) * 2.399,
      x: (puff % 2 ? 1 : -1) * (1.1 + puff * 0.08),
      y: puff === 3 ? 0.18 : 0,
      z: puff < 2 ? -0.2 : 0.4,
      scale: puff === 3 ? 1.35 : 1 + puff * 0.08,
    };
  });
  const cloudMesh = new THREE.InstancedMesh(unit.sphere, mat(new THREE.MeshBasicMaterial({ color: 0xffffff })), cloudPuffs.length);
  cloudMesh.frustumCulled = false;
  scene.add(cloudMesh);
  for (let i = 0; i < cloudPuffs.length; i++) cloudMesh.setColorAt(i, tmpC.setHex(i % 4 === 3 ? 0xf4f9ff : 0xffffff));
  if (cloudMesh.instanceColor) cloudMesh.instanceColor.needsUpdate = true;
  const tileShape = new THREE.Shape();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a), y = Math.sin(a);
    if (i === 0) tileShape.moveTo(x, y);
    else tileShape.lineTo(x, y);
  }
  tileShape.closePath();
  const tileGeo = keepG(new THREE.ExtrudeGeometry(tileShape, {
    depth: 1, bevelEnabled: true, bevelThickness: 0.065, bevelSize: 0.055, bevelSegments: 1, curveSegments: 1,
  }));
  tileGeo.translate(0, 0, -0.5);
  tileGeo.rotateX(-Math.PI / 2);
  const tileTopMat = mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.62 }));
  const tileSideMat = mat(new THREE.MeshStandardMaterial({ color: 0x9b766b, vertexColors: true, roughness: 0.82 }));
  const crackGeo = keepG(new THREE.CircleGeometry(1, 6));
  crackGeo.rotateX(-Math.PI / 2);
  const crackMat = mat(new THREE.MeshBasicMaterial({
    color: 0xffffff, map: crackTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1,
  }));
  const crowdGeo = keepG(new THREE.CapsuleGeometry(0.18, 0.28, touch ? 2 : 3, touch ? 7 : 10));
  const crowdMat = mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42 }));
  const flagMat = mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, side: THREE.DoubleSide, roughness: 0.6 }));
  const poleMat = mat(new THREE.MeshStandardMaterial({ color: 0xf7f0e4, roughness: 0.7 }));
  const foamGeo = keepG(new THREE.TorusGeometry(1, 0.12, touch ? 4 : 6, touch ? 12 : 18));
  const foamMat = mat(new THREE.MeshStandardMaterial({ color: 0xf3ffff, transparent: true, opacity: 0.78, roughness: 0.35, depthWrite: false }));

  // ---------------------------------------------------------------- course
  const courseRoot = new THREE.Group();
  scene.add(courseRoot);
  let courseOwned: T.BufferGeometry[] = [];
  let moving: { c: Collider; mesh: T.Object3D }[] = [];
  const decorBounds: DecorBounds[] = [];
  const decorRayFrom = new THREE.Vector3();
  const decorRayTo = new THREE.Vector3();
  let tiles: { mesh: T.InstancedMesh; cracks: T.InstancedMesh; list: Collider[]; base: number[] } | null = null;
  let jets: { z: Course['zones'][number]; mesh: T.Mesh; foam: T.Mesh }[] = [];
  let crown: T.Group | null = null;
  let pads: T.Mesh[] = [];
  let crowdMesh: T.InstancedMesh | null = null;
  let crowdPeople: { x: number; y: number; z: number; phase: number; color: number; scale: number }[] = [];
  let buntingMesh: T.InstancedMesh | null = null;
  let buntingPoles: T.InstancedMesh | null = null;
  let bunting: { x: number; y: number; z: number; yaw: number; phase: number; color: number }[] = [];
  let waterY = -6;
  let center = { x: 0, z: 0, r: 80 };

  const shapeParts = (c: Collider, m: T.Matrix4, color: number, out: Part[]) => {
    const first = out.length;
    const s = c.shape;
    if (s.kind === 'box') {
      out.push({ g: unit.box, m: m.clone().multiply(mtx(0, 0, 0, s.hx * 2, s.hy * 2, s.hz * 2)), c: color });
      if (c.look === 'tube' && s.hx > s.hz * 2) {
        out.push({ g: unit.box, m: m.clone().multiply(mtx(0, 0, 0, s.hx * 0.42, s.hy * 1.04, s.hz * 1.04)), c: CARDINAL });
        for (const side of [-1, 1]) {
          out.push({ g: unit.sphere, m: m.clone().multiply(mtx(side * s.hx * 0.88, 0, 0, s.hz * 0.62, s.hy * 0.62, s.hz * 0.62)), c: 0xe6d5b9 });
        }
      }
      if (c.look === 'bar') {
        out.push({ g: unit.sphere, m: m.clone().multiply(mtx(0, 0, 0, s.hz * 1.45, s.hy * 1.5, s.hz * 1.45)), c: 0xf8f2e8 });
      }
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
    const surface = surfaceForLook(c.look);
    for (let i = first; i < out.length; i++) out[i].surface = surface;
  };
  const poseMatrix = (p: Pose, out: T.Matrix4) => {
    const m = p.m;
    out.set(m[0], m[1], m[2], p.x, m[3], m[4], m[5], p.y, m[6], m[7], m[8], p.z, 0, 0, 0, 1);
    return out;
  };

  function decorParts(d: Decor, out: Part[]) {
    const first = out.length;
    const base = mtx(d.x, d.y, d.z, d.s, d.s, d.s, d.yaw);
    const at = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) => base.clone().multiply(mtx(x, y, z, sx, sy, sz, yaw, pitch, roll));
    const sand = d.color ?? LOOK_COLORS.sand;
    switch (d.kind) {
      case 'palm': {
        let x = 0;
        let y = 0;
        const lean = ((d.x * 7 + d.z * 13) % 5) * 0.03 - 0.06;
        for (let i = 0; i < 7; i++) {
          const bend = lean + i * 0.022;
          out.push({ g: unit.cyl8, m: at(x, y + 0.52, 0, 0.24 - i * 0.014, 1.08, 0.24 - i * 0.014, 0, 0, bend), c: i % 2 ? 0xb48455 : 0xa47447 });
          x -= Math.sin(bend) * 0.95;
          y += 1.05;
        }
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * Math.PI * 2;
          out.push({ g: unit.leaf, m: at(x, y, 0, 1, 1, 1, -a), c: i % 2 ? 0x5cbf5f : 0x48a852 });
        }
        for (let i = 0; i < 3; i++) out.push({ g: unit.sphere, m: at(x + Math.cos(i * 2) * 0.3, y - 0.25, Math.sin(i * 2) * 0.3, 0.22, 0.22, 0.22), c: 0x7a4f2c });
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
        out.push({ g: unit.sphere, m: at(-0.65, 3.3, 0, 1.55, 1.45, 1.5), c: d.color ?? 0x5fae5c });
        out.push({ g: unit.sphere, m: at(0.7, 3.45, 0.1, 1.45, 1.55, 1.45), c: 0x68b862 });
        out.push({ g: unit.sphere, m: at(0.05, 4.35, -0.1, 1.25, 1.32, 1.25), c: 0x7bc96d });
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
        out.push({ g: unit.sphere, m: at(0, 0.5, 0, 1, 0.75, 1), c: d.color ?? 0x63b35d });
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
        break;
      }
    }
    const stoneDecor = d.kind === 'arch' || d.kind === 'arcade' || d.kind === 'roof' || d.kind === 'tower' || d.kind === 'fountain' || d.kind === 'stands';
    for (let i = first; i < out.length; i++) {
      if (out[i].c === LOOK_COLORS.roof) out[i].surface = 'roof';
      else out[i].surface = stoneDecor ? 'sandstone' : 'plain';
    }
  }

  function clearCourse() {
    for (const child of [...courseRoot.children]) courseRoot.remove(child);
    for (const g of courseOwned) g.dispose();
    courseOwned = [];
    moving = [];
    decorBounds.length = 0;
    tiles = null;
    jets = [];
    crown = null;
    pads = [];
    crowdMesh = null;
    crowdPeople = [];
    buntingMesh = null;
    buntingPoles = null;
    bunting = [];
  }

  const movingMats = new Map<string, T.Material>();
  const lookMat = (look: Look) => {
    const key = surfaceForLook(look);
    let m = movingMats.get(key);
    if (!m) {
      m = mat(new THREE.MeshStandardMaterial({
        color: 0xffffff, map: surfaceMaps[key], vertexColors: true, roughness: key === 'pad' || key === 'stripe' ? 0.4 : 0.78,
        emissive: key === 'pad' ? 0x553300 : 0x000000, side: THREE.DoubleSide,
      }));
      movingMats.set(key, m);
    }
    return m;
  };

  function setCourse(course: Course) {
    clearCourse();
    const pal = course.palette;
    const pos = skyGeo.attributes.position;
    const top = new THREE.Color(0x6fb6ff);
    const horizon = new THREE.Color(0xffe6c7);
    for (let i = 0; i < pos.count; i++) {
      const k = Math.max(0, Math.min(1, (pos.getY(i) + 12) / 370));
      const smooth = k * k * (3 - 2 * k);
      tmpC.copy(horizon).lerp(top, smooth);
      skyColors.set([tmpC.r, tmpC.g, tmpC.b], i * 3);
    }
    skyGeo.attributes.color.needsUpdate = true;
    (scene.fog as T.Fog).color.setHex(pal.fog);
    shoreMat.color.setHex(0xffffff);

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
      const material = lookMat(c.look);
      if (c.look === 'pad') {
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
      if (d.kind === 'stands') {
        for (let row = 0; row < 4; row++) for (let col = 0; col < 9; col += touch ? 2 : 1) {
          const lx = -6 + col * 1.5 + (row % 2) * 0.5;
          const lz = -row * 1.2;
          const hue = ((row * 9 + col) * 0.137) % 1;
          tmpC.setHSL(hue, 0.68, 0.58);
          crowdPeople.push({
            x: d.x + (Math.cos(d.yaw) * lx + Math.sin(d.yaw) * lz) * d.s,
            y: d.y + (1.6 + row * 1.6) * d.s,
            z: d.z + (-Math.sin(d.yaw) * lx + Math.cos(d.yaw) * lz) * d.s,
            phase: row * 1.7 + col * 0.83, color: tmpC.getHex(), scale: d.s,
          });
        }
      }
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
      statics.push({ g: unit.cyl, m: mtx(d.x, d.y - 0.6, d.z, d.kind === 'arcade' || d.kind === 'stands' ? 10 : d.kind === 'roof' ? 8 : d.kind === 'tower' ? 6 : 3, 1.2, d.kind === 'arcade' || d.kind === 'stands' ? 10 : d.kind === 'roof' ? 8 : d.kind === 'tower' ? 6 : 3), c: pal.ground, surface: 'grass' });
      statics.push({ g: unit.cyl, m: mtx(d.x, d.y - 4, d.z, d.kind === 'arcade' || d.kind === 'stands' ? 9.5 : d.kind === 'roof' ? 7.5 : d.kind === 'tower' ? 5.5 : 2.6, 6.8, d.kind === 'arcade' || d.kind === 'stands' ? 9.5 : d.kind === 'roof' ? 7.5 : d.kind === 'tower' ? 5.5 : 2.6), c: 0xd8b98e, surface: 'sandstone' });
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
      statics.push({ g: unit.box, m: mtx(c.pose.x, bottom - Math.min(depth, 3) / 2, c.pose.z, s.hx * 2 * 0.96, Math.min(depth, 3), s.hz * 2 * 0.96, Math.atan2(c.pose.m[2], c.pose.m[0]) * -1), c: 0xd9b98c, surface: 'sandstone' });
    }
    if (statics.length) {
      const groups = new Map<Surface, Part[]>();
      for (const part of statics) {
        const surface = part.surface ?? 'plain';
        let group = groups.get(surface);
        if (!group) groups.set(surface, (group = []));
        group.push(part);
      }
      for (const [surface, parts] of groups) {
        const g = bake(parts);
        courseOwned.push(g);
        courseRoot.add(new THREE.Mesh(g, bakedMat(surface)));
      }
    }
    if (tileList.length) {
      const im = new THREE.InstancedMesh(tileGeo, [tileTopMat, tileSideMat], tileList.length);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      const crackMesh = new THREE.InstancedMesh(crackGeo, crackMat, tileList.length);
      crackMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crackMesh.frustumCulled = false;
      const base: number[] = [];
      const layerColors = [0xf0cf9c, 0xf2b8a0, 0xbfd8f0, 0xd4c4f0];
      tileList.forEach((c, i) => {
        const b = layerColors[(c.tile?.layer ?? 0) % layerColors.length];
        tmpC.setHex(b).offsetHSL(0, 0, ((i * 37) % 7) * 0.008 - 0.02);
        base.push(tmpC.getHex());
        im.setColorAt(i, tmpC);
      });
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      courseRoot.add(im, crackMesh);
      tiles = { mesh: im, cracks: crackMesh, list: tileList, base };
    }
    for (const z of course.zones) {
      if (z.kind === 'jet') {
        const mesh = new THREE.Mesh(unit.cyl8, mat(new THREE.MeshStandardMaterial({
          color: 0xd6f7fb, transparent: true, opacity: 0.58, roughness: 0.18, depthWrite: false,
        })));
        const foam = new THREE.Mesh(foamGeo, foamMat);
        foam.rotation.x = Math.PI / 2;
        courseRoot.add(mesh, foam);
        jets.push({ z, mesh, foam });
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
        for (const side of [-1, 1]) {
          parts.push({ g: unit.cyl, m: mtx(z.x + side * (z.hx + 1.3), z.y + 0.85, z.z - 0.3, 0.28, 1.2, 0.28, 0, 0, -side * 0.58), c: 0x526779 });
          parts.push({ g: unit.cyl, m: mtx(z.x + side * (z.hx + 1.6), z.y + 1.37, z.z - 0.3, 0.32, 0.12, 0.32, 0, 0, -side * 0.58), c: 0xffd166 });
        }
        const g = bake(parts);
        courseOwned.push(g);
        courseRoot.add(new THREE.Mesh(g, bakedMat('plain')));
      }
    }
    center = { x: (minX + maxX) / 2, z: (minZ + maxZ) / 2, r: Math.max(maxX - minX, maxZ - minZ) / 2 + 30 };
    for (let i = 0; i < hillCount; i++) {
      const a = (i / hillCount) * Math.PI * 2;
      const radius = center.r + 52 + (i % 3) * 9;
      const sx = 13 + (i % 4) * 4;
      setMtx(scratchMtx, center.x + Math.cos(a) * radius, 1.2 + (i % 3) * 0.5, center.z + Math.sin(a) * radius, sx, 8 + (i % 3) * 2, 11 + (i % 4) * 2, -a);
      hillMesh.setMatrixAt(i, scratchMtx);
    }
    hillMesh.instanceMatrix.needsUpdate = true;
    if (crowdPeople.length) {
      crowdMesh = new THREE.InstancedMesh(crowdGeo, crowdMat, crowdPeople.length);
      crowdMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      crowdPeople.forEach((person, i) => {
        crowdMesh!.setColorAt(i, tmpC.setHex(person.color));
        setMtx(scratchMtx, person.x, person.y, person.z, person.scale * 0.62, person.scale * 0.76, person.scale * 0.62);
        crowdMesh!.setMatrixAt(i, scratchMtx);
      });
      if (crowdMesh.instanceColor) crowdMesh.instanceColor.needsUpdate = true;
      courseRoot.add(crowdMesh);
    }
    const flagColors = [0xb12e3e, 0xffcf58, 0x56b99c, 0x7a9dd9, 0xf0eef0];
    if (course.path.length > 0) {
      for (let i = 0; i < course.path.length; i += 2) {
        const point = course.path[i];
        const before = course.path[Math.max(0, i - 1)];
        const after = course.path[Math.min(course.path.length - 1, i + 1)];
        const dx = after.x - before.x, dz = after.z - before.z;
        const length = Math.hypot(dx, dz) || 1;
        const nx = dz / length, nz = -dx / length;
        for (const side of [-1, 1]) bunting.push({
          x: point.x + nx * side * 9.6, y: point.y + 3.3, z: point.z + nz * side * 9.6,
          yaw: Math.atan2(-nx * side, nz * side), phase: i * 0.9 + side, color: flagColors[(i + (side > 0 ? 1 : 0)) % flagColors.length],
        });
      }
    }
    if (bunting.length) {
      buntingMesh = new THREE.InstancedMesh(unit.flag, flagMat, bunting.length);
      buntingPoles = new THREE.InstancedMesh(unit.cyl8, poleMat, bunting.length);
      buntingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      buntingPoles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      bunting.forEach((flag, i) => {
        buntingMesh!.setColorAt(i, tmpC.setHex(flag.color));
        setMtx(scratchMtx, flag.x, flag.y, flag.z, 0.95, 1.35, 0.05, flag.yaw);
        buntingMesh!.setMatrixAt(i, scratchMtx);
        setMtx(scratchMtx, flag.x, flag.y - 1.55, flag.z, 0.035, 1.7, 0.035);
        buntingPoles!.setMatrixAt(i, scratchMtx);
      });
      if (buntingMesh.instanceColor) buntingMesh.instanceColor.needsUpdate = true;
      courseRoot.add(buntingPoles, buntingMesh);
    }
    waterY = course.killY + 5;
    water.position.set(center.x, waterY, center.z);
    shore.position.set(center.x, 0.2, center.z);
    shore.scale.set(center.r + 25, center.r + 25, 1);
    scene.fog = new THREE.Fog(pal.fog, center.r * 0.9 + 60, center.r * 2.4 + 200);
  }
  // ---------------------------------------------------------------- players
  const beanGeo = keepG(new THREE.CapsuleGeometry(0.34, 0.48, touch ? 3 : 5, touch ? 12 : 20));
  const gownProfile = [
    new THREE.Vector2(0, 0), new THREE.Vector2(0.48, 0.03), new THREE.Vector2(0.55, 0.14),
    new THREE.Vector2(0.42, 0.34), new THREE.Vector2(0.3, 0.68), new THREE.Vector2(0.26, 0.86), new THREE.Vector2(0, 0.88),
  ];
  const gownGeo = keepG(new THREE.LatheGeometry(gownProfile, touch ? 12 : 18));
  const beanMat = mat(new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.35, clearcoat: 0.62, clearcoatRoughness: 0.24 }));
  const robeMat = mat(new THREE.MeshStandardMaterial({ color: CARDINAL, roughness: 0.72, side: THREE.DoubleSide }));
  const parts = {
    bean: new THREE.InstancedMesh(beanGeo, beanMat, MAX_PLAYERS),
    gown: new THREE.InstancedMesh(gownGeo, robeMat, MAX_PLAYERS),
    collar: new THREE.InstancedMesh(keepG(new THREE.TorusGeometry(0.34, 0.055, touch ? 5 : 8, touch ? 12 : 18)), mat(new THREE.MeshStandardMaterial({ color: 0xfff3e0, roughness: 0.55 })), MAX_PLAYERS),
    board: new THREE.InstancedMesh(keepG(new THREE.BoxGeometry(0.82, 0.065, 0.82)), mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.48 })), MAX_PLAYERS),
    skull: new THREE.InstancedMesh(keepG(new THREE.CylinderGeometry(0.29, 0.34, 0.16, touch ? 9 : 14)), mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.55 })), MAX_PLAYERS),
    tassel: new THREE.InstancedMesh(keepG(new THREE.CapsuleGeometry(0.035, 0.28, 2, touch ? 6 : 9)), mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.45 })), MAX_PLAYERS),
    arm: new THREE.InstancedMesh(keepG(new THREE.CapsuleGeometry(0.09, 0.28, 3, touch ? 7 : 10)), mat(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.42 })), MAX_PLAYERS * 2),
    foot: new THREE.InstancedMesh(keepG(new THREE.CapsuleGeometry(0.11, 0.18, 2, touch ? 7 : 10)), mat(new THREE.MeshStandardMaterial({ color: 0x513d43, roughness: 0.62 })), MAX_PLAYERS * 2),
    eye: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, touch ? 8 : 12, touch ? 6 : 9)), mat(new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.24 })), MAX_PLAYERS * 2),
    pupil: new THREE.InstancedMesh(keepG(new THREE.SphereGeometry(1, touch ? 6 : 9, touch ? 5 : 7)), mat(new THREE.MeshBasicMaterial({ color: 0x1b1b22 })), MAX_PLAYERS * 2),
    smile: new THREE.InstancedMesh(keepG(new THREE.TorusGeometry(0.085, 0.016, 4, touch ? 9 : 14, Math.PI)), mat(new THREE.MeshBasicMaterial({ color: 0x542c36 })), MAX_PLAYERS),
    shadow: new THREE.InstancedMesh(keepG(new THREE.CircleGeometry(0.72, touch ? 12 : 18)), mat(new THREE.MeshBasicMaterial({ color: 0xffffff, map: shadowTex, transparent: true, opacity: 1, depthWrite: false })), MAX_PLAYERS),
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
      parts.board.setColorAt(i, tmpC);
      parts.skull.setColorAt(i, tmpC);
      parts.arm.setColorAt(i * 2, tmpC);
      parts.arm.setColorAt(i * 2 + 1, tmpC);
    });
    for (let i = 0; i < MAX_PLAYERS * 2; i++) {
      parts.eye.setColorAt(i, white);
      parts.pupil.setColorAt(i, white);
    }
    if (parts.bean.instanceColor) parts.bean.instanceColor.needsUpdate = true;
    if (parts.tassel.instanceColor) parts.tassel.instanceColor.needsUpdate = true;
    if (parts.board.instanceColor) parts.board.instanceColor.needsUpdate = true;
    if (parts.skull.instanceColor) parts.skull.instanceColor.needsUpdate = true;
    if (parts.arm.instanceColor) parts.arm.instanceColor.needsUpdate = true;
  }

  const bodyM = new THREE.Matrix4();
  const partM = new THREE.Matrix4();
  const local = (x: number, y: number, z: number, sx: number, sy: number, sz: number, yaw = 0, pitch = 0, roll = 0) =>
    setMtx(new THREE.Matrix4(), x, y, z, sx, sy, sz, yaw, pitch, roll);
  const L = {
    bean: local(0, 0.86, 0, 1, 1.06, 1),
    gown: local(0, 0.08, 0, 1, 1, 1),
    collar: local(0, 0.77, 0.03, 0.88, 0.88, 0.88, 0, Math.PI / 2),
    board: local(0, 1.52, 0, 1, 1, 1, Math.PI / 4, -0.12),
    skull: local(0, 1.43, 0, 1, 1, 1, 0, -0.12),
    eyeL: local(-0.15, 1.11, 0.31, 0.12, 0.145, 0.085),
    eyeR: local(0.15, 1.11, 0.31, 0.12, 0.145, 0.085),
    pupL: local(-0.15, 1.105, 0.385, 0.057, 0.075, 0.045),
    pupR: local(0.15, 1.105, 0.385, 0.057, 0.075, 0.045),
    smile: local(0, 0.93, 0.37, 1, 1, 1, 0, 0, Math.PI),
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
      a.spin = b.state === 'stun' || b.state === 'flop' ? a.spin + dt * (b.state === 'stun' ? 9 : 7) : damp(a.spin, 0, 8, dt);
      a.lift = damp(a.lift, lying || b.state === 'stun' ? 0.4 : 0, 14, dt);
      a.bob += dt * speed * 2.2;
      const ground = b.state === 'run' && speed > 0.5;
      let turn = Math.atan2(b.vx, b.vz) - b.yaw;
      if (turn > Math.PI) turn -= Math.PI * 2;
      if (turn < -Math.PI) turn += Math.PI * 2;
      a.roll = damp(a.roll, ground ? Math.sin(a.bob) * 0.1 + Math.max(-0.8, Math.min(0.8, turn)) * 0.18 : 0, 12, dt);
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
      const armsUp = b.state === 'air' || b.state === 'dive';
      const armAngle = lying || b.state === 'stun' ? Math.sin(a.spin * 2.2) * 1.05 : armsUp ? 0.85 : Math.sin(a.bob) * 0.48;
      const footKick = lying || b.state === 'stun' ? Math.sin(a.spin * 2.7) * 0.6 : 0;
      for (let side = 0; side < 2; side++) {
        const sign = side === 0 ? -1 : 1;
        const armRoll = -sign * (armAngle + Math.sin(a.spin + side) * (lying ? 0.35 : 0));
        parts.arm.setMatrixAt(n * 2 + side, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, sign * 0.4, 0.75, 0.01, 0.92, 1, 0.92, 0, 0, armRoll)));
        const phase = a.bob + side * Math.PI;
        const footPitch = Math.PI / 2 + (ground ? Math.sin(phase) * 0.48 : armsUp ? 0.28 : footKick);
        parts.foot.setMatrixAt(n * 2 + side, partM.multiplyMatrices(bodyM, setMtx(scratchMtx, sign * 0.22, 0.1, 0.34, 0.92, 0.72, 0.92, 0, footPitch)));
      }
      const blink = Math.sin(clock * 1.3 + i * 2.1) > 0.985 ? 0.15 : 1;
      parts.eye.setMatrixAt(n * 2, partM.multiplyMatrices(bodyM, L.eyeL).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.eye.setMatrixAt(n * 2 + 1, partM.multiplyMatrices(bodyM, L.eyeR).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.pupil.setMatrixAt(n * 2, partM.multiplyMatrices(bodyM, L.pupL).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.pupil.setMatrixAt(n * 2 + 1, partM.multiplyMatrices(bodyM, L.pupR).multiply(setMtx(scratchMtx, 0, 0, 0, 1, blink, 1)));
      parts.smile.setMatrixAt(n, partM.multiplyMatrices(bodyM, L.smile));
      if (parts.bean.instanceColor) {
        tmpC.setHex(looks[i].color);
        parts.bean.setColorAt(n, tmpC);
        parts.tassel.setColorAt(n, tmpC);
        parts.board.setColorAt(n, tmpC);
        parts.skull.setColorAt(n, tmpC);
        parts.arm.setColorAt(n * 2, tmpC);
        parts.arm.setColorAt(n * 2 + 1, tmpC);
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
      p.count = p === parts.eye || p === parts.pupil || p === parts.arm || p === parts.foot ? n * 2 : n;
      p.instanceMatrix.needsUpdate = true;
    }
    if (parts.bean.instanceColor) parts.bean.instanceColor.needsUpdate = true;
    if (parts.tassel.instanceColor) parts.tassel.instanceColor.needsUpdate = true;
    if (parts.board.instanceColor) parts.board.instanceColor.needsUpdate = true;
    if (parts.skull.instanceColor) parts.skull.instanceColor.needsUpdate = true;
    if (parts.arm.instanceColor) parts.arm.instanceColor.needsUpdate = true;
  }
  // ---------------------------------------------------------------- confetti and splashes
  const confettiMesh = new THREE.InstancedMesh(keepG(new THREE.PlaneGeometry(0.16, 0.26)), mat(new THREE.MeshBasicMaterial({ side: THREE.DoubleSide })), CONFETTI);
  confettiMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  confettiMesh.frustumCulled = false;
  scene.add(confettiMesh);
  const bits = Array.from({ length: CONFETTI }, () => ({ x: 0, y: -999, z: 0, vx: 0, vy: 0, vz: 0, r: 0, vr: 0, life: 0 }));
  const confettiColors = [0xff6b6b, 0xffd166, 0x06d6a0, 0x4cc9f0, 0xb388ff, 0xff8fab, 0xffffff, CARDINAL];
  for (let i = 0; i < CONFETTI; i++) confettiMesh.setColorAt(i, tmpC.setHex(confettiColors[i % confettiColors.length]));
  if (confettiMesh.instanceColor) confettiMesh.instanceColor.needsUpdate = true;
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
    for (let i = 0; i < cloudPuffs.length; i++) {
      const puff = cloudPuffs[i];
      const group = Math.floor(i / 4);
      const a = puff.phase + clock * 0.009;
      const radius = center.r + 92 + (group % 4) * 9;
      setMtx(scratchMtx, center.x + Math.cos(a) * radius + puff.x * 2, 37 + (group % 3) * 4 + puff.y * 5,
        center.z + Math.sin(a) * radius + puff.z * 2, puff.scale * 4.6, puff.scale * 1.9, puff.scale * 2.5);
      cloudMesh.setMatrixAt(i, scratchMtx);
    }
    cloudMesh.instanceMatrix.needsUpdate = true;
    for (const { c, mesh } of moving) {
      mesh.visible = c.on;
      if (c.on) poseMatrix(c.pose, mesh.matrix);
      mesh.matrixWorldNeedsUpdate = true;
    }
    for (const p of pads) (p.material as T.MeshStandardMaterial).emissive.setRGB(0.3 + Math.sin(clock * 6) * 0.15, 0.18, 0);
    if (crowdMesh) {
      for (let i = 0; i < crowdPeople.length; i++) {
        const person = crowdPeople[i];
        const bounce = Math.sin(clock * 2.4 + person.phase) * 0.08;
        setMtx(scratchMtx, person.x, person.y + bounce, person.z, person.scale * 0.62, person.scale * (0.76 + bounce * 0.18), person.scale * 0.62);
        crowdMesh.setMatrixAt(i, scratchMtx);
      }
      crowdMesh.instanceMatrix.needsUpdate = true;
    }
    if (buntingMesh) {
      for (let i = 0; i < bunting.length; i++) {
        const flag = bunting[i];
        const wave = Math.sin(clock * 3.2 + flag.phase) * 0.16;
        setMtx(scratchMtx, flag.x + Math.sin(clock * 2.5 + flag.phase) * 0.06, flag.y, flag.z,
          0.95, 1.35, 0.05, flag.yaw + wave, 0, wave * 0.3);
        buntingMesh.setMatrixAt(i, scratchMtx);
      }
      buntingMesh.instanceMatrix.needsUpdate = true;
    }
    if (tiles) {
      const { mesh, cracks, list, base } = tiles;
      let colors = false;
      list.forEach((c, i) => {
        const s = c.shape as { r: number; hy: number };
        if (!c.on) {
          mesh.setMatrixAt(i, m4.makeScale(0, 0, 0));
          cracks.setMatrixAt(i, m4.makeScale(0, 0, 0));
          return;
        }
        const cracking = c.tile?.touchedAt != null && (c.tile.fallAt == null || t < c.tile.fallAt);
        const shake = cracking ? Math.sin(clock * 50 + i) * 0.04 : 0;
        poseMatrix(c.pose, m4).multiply(setMtx(scratchMtx, shake, 0, -shake, s.r * 1.02, s.hy * 2, s.r * 1.02));
        mesh.setMatrixAt(i, m4);
        if (cracking) {
          poseMatrix(c.pose, m4).multiply(setMtx(scratchMtx, shake, s.hy + 0.025, -shake, s.r * 0.88, 1, s.r * 0.88));
          cracks.setMatrixAt(i, m4);
        } else cracks.setMatrixAt(i, m4.makeScale(0, 0, 0));
        const wantC = c.tile?.touchedAt != null ? 0xff8a65 : base[i];
        mesh.getColorAt(i, tmpC);
        if (tmpC.getHex() !== wantC) {
          tmpC.setHex(wantC);
          mesh.setColorAt(i, tmpC);
          colors = true;
        }
      });
      mesh.instanceMatrix.needsUpdate = true;
      cracks.instanceMatrix.needsUpdate = true;
      if (colors && mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const { z, mesh, foam } of jets) {
      const on = z.on?.(t) ?? true;
      const h = z.hy * 2;
      mesh.visible = on;
      foam.visible = on;
      if (on) {
        const p = z.push ?? { x: 0, y: 0, z: 0 };
        const sideways = Math.abs(p.x) + Math.abs(p.z) > Math.abs(p.y);
        foam.position.set(z.x, z.y - z.hy + 0.08, z.z);
        const foamSize = Math.min(z.hx, z.hz) * (0.76 + Math.sin(clock * 8) * 0.05);
        foam.scale.set(foamSize, foamSize, foamSize);
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
    waterTex.offset.x = clock * 0.006;
    waterTex.offset.y = clock * 0.0025;
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
      for (const texture of textures) texture.dispose();
      gl.dispose();
    },
  };
  return view;
}

export function createScene(THREE: Three, host: HTMLElement, touch: boolean): View | null {
  return build(THREE, host, touch);
}
