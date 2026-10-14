// three.js view of a climb: the tower and its six circles, the souls, the chain, the lava and the weather. It reads
// a Game every frame and never changes it.
import type { T } from './gl';
import { clamp, createGL, damp, disposeTree, lerp, type GL } from './gl';
import { CHAIN_L, LAVA_Y, R_CORE, R_FLOOR, R_MAX, TOP, ZONES, pose, zoneIndex, type Level, type Palette, type Platform } from './level';
import { crumbleState, windAt, type CrumbleState, type Ev, type Game, type Soul } from './logic';

type Three = typeof import('three');

export type View = {
  gl: GL;
  camera: T.PerspectiveCamera;
  /** The palette the camera is looking at right now, blended across circle boundaries. */
  palette: Palette;
  zone: number;
  resize(w: number, h: number): void;
  /** Moves everything to match the game and points the camera at the souls in `focus` (the first leads, or they share it when `split`). */
  frame(g: Game, focus: number[], dt: number, clock: number, split?: boolean): void;
  /** One-off effects for game events: dust, sparks, debris, camera shake. */
  react(e: Ev, g: Game): void;
  /** Screen position (CSS pixels) of a world point, or null when behind the camera. */
  project(x: number, y: number, z: number, w: number, h: number): { x: number; y: number } | null;
  /** Where a soul's name tag goes: above its head. */
  tagOf(idx: number, w: number, h: number): { x: number; y: number } | null;
  render(): void;
  dispose(): void;
};

// ---------------------------------------------------------------------------------------------------------------
// little helpers

/** Deterministic scatter, so the tower is dressed the same every visit. */
function scatter(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

const hexToRgb = (hex: string): [number, number, number] => {
  const n = parseInt(hex.slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
};
const mixHex = (a: string, b: string, t: number) => {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  const c = ca.map((v, i) => Math.round(lerp(v, cb[i], t) * 255));
  return `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
};

/** The palette at a height: each circle's own, blended over the three metres either side of a door. */
export function paletteAt(y: number): { palette: Palette; zone: number; blend: number } {
  const zi = zoneIndex(y);
  const z = ZONES[zi];
  const BAND = 3;
  let other = -1;
  let t = 0;
  if (zi > 0 && y < z.from + BAND) {
    other = zi - 1;
    t = (z.from + BAND - y) / (BAND * 2);
  } else if (zi < ZONES.length - 1 && y > z.to - BAND) {
    other = zi + 1;
    t = (y - (z.to - BAND)) / (BAND * 2);
  }
  if (other < 0 || t <= 0) return { palette: z.palette, zone: zi, blend: 0 };
  const p = z.palette;
  const q = ZONES[other].palette;
  const mix = (a: string, b: string) => mixHex(a, b, t);
  return {
    zone: zi,
    blend: t,
    palette: {
      sky: [mix(p.sky[0], q.sky[0]), mix(p.sky[1], q.sky[1]), mix(p.sky[2], q.sky[2])],
      fog: mix(p.fog, q.fog),
      fogNear: lerp(p.fogNear, q.fogNear, t),
      fogFar: lerp(p.fogFar, q.fogFar, t),
      hemi: [mix(p.hemi[0], q.hemi[0]), mix(p.hemi[1], q.hemi[1])],
      sun: mix(p.sun, q.sun),
      stone: [mix(p.stone[0], q.stone[0]), mix(p.stone[1], q.stone[1])],
      core: mix(p.core, q.core),
      glow: mix(p.glow, q.glow),
      ink: mix(p.ink, q.ink),
    },
  };
}

type Tri = { pos: number[]; nor: number[]; col: number[] };
const tri = (): Tri => ({ pos: [], nor: [], col: [] });

function quad(out: Tri, a: number[], b: number[], c: number[], d: number[], color: [number, number, number], shade = 1) {
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
function sector(out: Tri, a0: number, a1: number, r0: number, r1: number, y0: number, y1: number, top: [number, number, number], side: [number, number, number], opts: { inner?: boolean; segs?: number; local?: boolean } = {}) {
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

function geometryOf(THREE: Three, t: Tri) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
  return geo;
}

const shade = (c: [number, number, number], k: number): [number, number, number] => [c[0] * k, c[1] * k, c[2] * k];
const vary = (c: [number, number, number], rng: () => number, amount = 0.08): [number, number, number] => {
  const k = 1 + (rng() - 0.5) * amount * 2;
  return [clamp(c[0] * k, 0, 1), clamp(c[1] * k, 0, 1), clamp(c[2] * k, 0, 1)];
};

type Particles = {
  mesh: T.InstancedMesh;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  n: number;
  /** Which circle this weather belongs to (-1 for everywhere). */
  zone: number;
  size: number;
  kind: 'ember' | 'ash' | 'spark' | 'snow' | 'mote' | 'stardust';
};

type Puff = { life: number; x: number; y: number; z: number; vx: number; vy: number; vz: number; size: number; r: number; g: number; b: number };

type SoulView = {
  root: T.Group;
  body: T.Group;
  cloak: T.Mesh;
  head: T.Mesh;
  eyes: T.Mesh[];
  eyeMat: T.MeshBasicMaterial;
  arms: [T.Group, T.Group];
  legs: [T.Group, T.Group];
  shackle: T.Object3D;
  lantern: T.Mesh;
  lanternMat: T.MeshBasicMaterial;
  halo: T.Mesh;
  haloMat: T.MeshBasicMaterial;
  glow: T.Mesh;
  glowMat: T.MeshBasicMaterial;
  color: T.Color;
  stride: number;
  lean: number;
  flail: number;
  burnScale: number;
};

type Rope = { points: Float32Array; prev: Float32Array; n: number };

type Beacon = { p: Platform; orb: T.Mesh; orbMat: T.MeshBasicMaterial; ring: T.Mesh; ringMat: T.MeshBasicMaterial; lit: boolean; flare: number };
type Moving = { p: Platform; mesh: T.Object3D; parts?: T.Object3D[] };
type Crumbly = { p: Platform; mesh: T.Mesh; mat: T.MeshLambertMaterial; debris: { mesh: T.Mesh; vx: number; vy: number; vz: number; rx: number; rz: number; life: number }[]; gone: boolean };
type Spring = { p: Platform; pad: T.Mesh; coil: T.Mesh; squash: number };

/** Builds the view. lite trims particles and detail for phones. */
export function buildView(THREE: Three, host: HTMLElement, level: Level, opts: { lite?: boolean } = {}): View | null {
  const lite = !!opts.lite;
  const gl = createGL(THREE, host, { alpha: true, maxDpr: lite ? 1.5 : 2 });
  if (!gl) return null;
  const scene = new THREE.Scene();
  const fog = new THREE.Fog(ZONES[0].palette.fog, ZONES[0].palette.fogNear, ZONES[0].palette.fogFar);
  scene.fog = fog;
  const camera = new THREE.PerspectiveCamera(56, 1, 0.1, 420);
  scene.add(camera);

  const hemi = new THREE.HemisphereLight(ZONES[0].palette.hemi[0], ZONES[0].palette.hemi[1], 1.1);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(ZONES[0].palette.sun, 1.25);
  sun.position.set(0.6, 1, 0.5);
  camera.add(sun);
  sun.target.position.set(0, -0.2, -1);
  camera.add(sun.target);
  // the lava lights everything from below in the pit, less and less higher up
  const ember = new THREE.DirectionalLight(0xff6a2a, 0.55);
  ember.position.set(0, -1, 0);
  scene.add(ember);
  ember.target.position.set(0, 0, 0);
  scene.add(ember.target);

  const rng = scatter(99);
  const disposables: { dispose(): void }[] = [];
  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    ball: new THREE.SphereGeometry(1, 10, 8),
    cone: new THREE.ConeGeometry(1, 1, 8),
    rod: new THREE.CylinderGeometry(1, 1, 1, 8),
    ring: new THREE.TorusGeometry(1, 0.08, 6, 24),
    link: new THREE.TorusGeometry(0.11, 0.03, 6, 10),
    disc: new THREE.CircleGeometry(1, 32),
    plane: new THREE.PlaneGeometry(1, 1),
  };
  for (const g of Object.values(geo)) disposables.push(g);
  const flat = (color: number | string, extra: Partial<T.MeshLambertMaterialParameters> = {}) => {
    const m = new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
    disposables.push(m);
    return m;
  };
  const basic = (color: number | string, extra: Partial<T.MeshBasicMaterialParameters> = {}) => {
    const m = new THREE.MeshBasicMaterial({ color, ...extra });
    disposables.push(m);
    return m;
  };
  const mats = {
    iron: flat('#2b2e36'),
    darkIron: flat('#1b1d23'),
    bone: flat('#d9cfb8'),
    wood: flat('#5a3b26'),
    ice: flat('#d8f1ff', { transparent: true, opacity: 0.86 }),
    gold: flat('#d6a93c'),
    stoneGrey: flat('#6d6a72'),
    flame: basic('#ffa24a'),
    flameCore: basic('#fff1c2'),
    ghost: basic('#9df0b2', { transparent: true, opacity: 0.75 }),
    glass: [basic('#d33b3b'), basic('#2f5fd8'), basic('#e2b437'), basic('#3fae6a'), basic('#8a3fd1')],
    vent: basic('#ff8a2a'),
    cloud: flat('#cfd6ff', { transparent: true, opacity: 0.55 }),
    star: basic('#ffffff'),
    chain: flat('#3a3d46'),
  };

  // -------------------------------------------------------------------------------------------------------------
  // the tower core, the shaft around it and the sky

  const coreTop = TOP + 26;
  const coreGeo = new THREE.CylinderGeometry(R_CORE * 1.02, R_CORE * 1.12, coreTop + 30, 40, 36, true);
  coreGeo.translate(0, (coreTop + 30) / 2 - 30, 0);
  {
    const pos = coreGeo.getAttribute('position') as T.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const noise = scatter(7);
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const bump = 1 + (noise() - 0.5) * 0.09;
      pos.setXYZ(i, (x / r) * r * bump, y + (noise() - 0.5) * 0.4, (z / r) * r * bump);
      const { palette } = paletteAt(y);
      const c = hexToRgb(palette.core);
      const k = 0.82 + noise() * 0.36;
      col[i * 3] = c[0] * k;
      col[i * 3 + 1] = c[1] * k;
      col[i * 3 + 2] = c[2] * k;
    }
    pos.needsUpdate = true;
    coreGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    coreGeo.computeVertexNormals();
  }
  const coreMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  disposables.push(coreMat);
  const core = new THREE.Mesh(coreGeo, coreMat);
  scene.add(core);
  // a spire at the very top
  const spire = new THREE.Mesh(geo.cone, flat(ZONES[5].palette.core));
  spire.position.set(0, coreTop + 6, 0);
  spire.scale.set(R_CORE * 1.05, 12, R_CORE * 1.05);
  scene.add(spire);

  // the shaft: a vast wall far out that opens to the sky above the cathedral
  const shaftH = 102 + 24;
  const shaftGeo = new THREE.CylinderGeometry(58, 64, shaftH, 36, 30, true);
  shaftGeo.translate(0, shaftH / 2 - 24, 0);
  {
    const pos = shaftGeo.getAttribute('position') as T.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const noise = scatter(11);
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const { palette } = paletteAt(y);
      const c = hexToRgb(palette.core);
      const k = 0.5 + noise() * 0.3;
      col[i * 3] = c[0] * k;
      col[i * 3 + 1] = c[1] * k;
      col[i * 3 + 2] = c[2] * k;
      const x = pos.getX(i);
      const z = pos.getZ(i);
      const r = Math.hypot(x, z);
      const bump = 1 + (noise() - 0.5) * 0.12;
      pos.setXYZ(i, (x / r) * r * bump, y, (z / r) * r * bump);
    }
    pos.needsUpdate = true;
    shaftGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    shaftGeo.computeVertexNormals();
  }
  const shaftMat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true });
  disposables.push(shaftMat);
  const shaft = new THREE.Mesh(shaftGeo, shaftMat);
  scene.add(shaft);

  // stars on a far sphere, only seen once the shaft opens
  const STARS = lite ? 180 : 360;
  const stars = new THREE.InstancedMesh(geo.ball, mats.star, STARS);
  stars.frustumCulled = false;
  {
    const d = new THREE.Object3D();
    const sr = scatter(21);
    for (let i = 0; i < STARS; i++) {
      const u = sr() * Math.PI * 2;
      const v = Math.acos(1 - sr() * 0.92);
      const R = 190;
      d.position.set(Math.sin(v) * Math.cos(u) * R, 80 + Math.cos(v) * R * 0.9, Math.sin(v) * Math.sin(u) * R);
      const s = 0.25 + sr() * 0.55;
      d.scale.setScalar(s);
      d.updateMatrix();
      stars.setMatrixAt(i, d.matrix);
    }
    stars.instanceMatrix.needsUpdate = true;
  }
  scene.add(stars);
  // clouds drifting round the top
  const clouds = new THREE.Group();
  {
    const cr = scatter(33);
    for (let i = 0; i < (lite ? 6 : 11); i++) {
      const puff = new THREE.Group();
      const a = cr() * Math.PI * 2;
      const r = 26 + cr() * 30;
      puff.position.set(Math.cos(a) * r, 96 + cr() * 30, Math.sin(a) * r);
      for (let j = 0; j < 4; j++) {
        const m = new THREE.Mesh(geo.ball, mats.cloud);
        m.position.set((cr() - 0.5) * 10, (cr() - 0.5) * 2, (cr() - 0.5) * 6);
        m.scale.set(4 + cr() * 5, 1.4 + cr() * 1.2, 3 + cr() * 3);
        puff.add(m);
      }
      clouds.add(puff);
    }
  }
  scene.add(clouds);

  // -------------------------------------------------------------------------------------------------------------
  // the lava

  const lava = new THREE.Mesh(geo.disc, basic('#ff5a1a'));
  lava.rotation.x = -Math.PI / 2;
  lava.scale.setScalar(R_MAX + 60);
  lava.position.y = LAVA_Y;
  scene.add(lava);
  const lavaGlow = new THREE.Mesh(new THREE.RingGeometry(R_FLOOR + 0.2, R_MAX + 60, 48), basic('#ffb347', { transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
  disposables.push(lavaGlow.geometry);
  lavaGlow.rotation.x = -Math.PI / 2;
  lavaGlow.position.y = LAVA_Y + 0.12;
  scene.add(lavaGlow);
  const BUBBLES = lite ? 14 : 26;
  const bubbles = new THREE.InstancedMesh(geo.ball, basic('#ff8a3a'), BUBBLES);
  bubbles.frustumCulled = false;
  const bubbleAt = new Float32Array(BUBBLES * 3);
  const bubbleT = new Float32Array(BUBBLES);
  {
    const br = scatter(44);
    for (let i = 0; i < BUBBLES; i++) {
      const a = br() * Math.PI * 2;
      const r = R_FLOOR + 1 + br() * 14;
      bubbleAt[i * 3] = Math.cos(a) * r;
      bubbleAt[i * 3 + 2] = Math.sin(a) * r;
      bubbleT[i] = br() * 3;
    }
  }
  scene.add(bubbles);

  // -------------------------------------------------------------------------------------------------------------
  // the ledges

  const statics = tri();
  const movers: Moving[] = [];
  const crumblies: Crumbly[] = [];
  const springs: Spring[] = [];
  const beacons: Beacon[] = [];
  const decor = new THREE.Group();
  scene.add(decor);
  const icicles: { x: number; y: number; z: number; s: number }[] = [];
  const candles: T.Mesh[] = [];
  const flames: { mesh: T.Mesh; seed: number }[] = [];
  const ghosts: { mesh: T.Mesh; x: number; y: number; z: number; seed: number }[] = [];
  const gears: T.Group[] = [];
  const shards: { mesh: T.Mesh; a: number; r: number; y: number; seed: number }[] = [];

  const stoneOf = (p: Platform): [[number, number, number], [number, number, number]] => {
    const pal = ZONES[p.zone].palette;
    const light = hexToRgb(pal.stone[0]);
    const dark = hexToRgb(pal.stone[1]);
    return [vary(light, rng, 0.06), vary(dark, rng, 0.06)];
  };

  for (const p of level.platforms) {
    const [light, dark] = stoneOf(p);
    const y0 = p.y - p.h;
    if (p.kind === 'floor') {
      // the floor of the pit: a wide ring of dark basalt with a lighter walkway
      const base = hexToRgb(ZONES[0].palette.stone[1]);
      sector(statics, 0, Math.PI * 2, R_CORE, R_FLOOR, y0, p.y, shade(base, 0.9), shade(base, 0.6), { inner: false, segs: 64 });
      sector(statics, 0, Math.PI * 2, R_CORE, R_CORE + 2.4, p.y, p.y + 0.06, shade(hexToRgb(ZONES[0].palette.stone[0]), 0.9), shade(base, 0.6), { inner: false, segs: 64 });
      continue;
    }
    if (p.kind === 'lift') {
      // an iron plate on a piston
      const t = tri();
      const iron = hexToRgb('#3a3d46');
      sector(t, -p.span, p.span, p.r0, p.r1, -p.h * 0.6, 0, shade(iron, 1.1), iron, { local: true });
      const mesh = new THREE.Mesh(geometryOf(THREE, t), coreMat.clone());
      disposables.push(mesh.geometry, mesh.material as T.Material);
      (mesh.material as T.MeshLambertMaterial).vertexColors = true;
      const rim = new THREE.Mesh(geo.box, mats.gold);
      rim.position.set((p.r0 + p.r1) / 2, 0.02, 0);
      rim.scale.set(p.r1 - p.r0 - 0.3, 0.04, 0.12);
      const piston = new THREE.Mesh(geo.rod, mats.darkIron);
      piston.scale.set(0.35, 1, 0.35);
      const group = new THREE.Group();
      group.add(mesh, rim, piston);
      scene.add(group);
      movers.push({ p, mesh: group, parts: [piston] });
      continue;
    }
    if (p.kind === 'swing') {
      // a stone slab hung on rods from an iron rail above
      const t = tri();
      sector(t, -p.span, p.span, p.r0, p.r1, -p.h, 0, light, dark, { local: true });
      const slab = new THREE.Mesh(geometryOf(THREE, t), coreMat.clone());
      disposables.push(slab.geometry, slab.material as T.Material);
      const group = new THREE.Group();
      group.add(slab);
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(geo.rod, mats.iron);
        const ra = side * p.span * 0.7;
        const rr = (p.r0 + p.r1) / 2;
        rod.position.set(Math.cos(ra) * rr, 1.6, Math.sin(ra) * rr);
        rod.scale.set(0.05, 3.2, 0.05);
        group.add(rod);
      }
      scene.add(group);
      const railGeo = new THREE.TorusGeometry((p.r0 + p.r1) / 2, 0.07, 6, 32, p.span * 2 + p.amp * 2 + 0.3);
      disposables.push(railGeo);
      const rail = new THREE.Mesh(railGeo, mats.iron);
      rail.rotation.x = Math.PI / 2;
      rail.rotation.z = -(p.a - p.span - p.amp - 0.15);
      rail.position.y = p.y + 3.2;
      scene.add(rail);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(geo.rod, mats.iron);
        const pa = p.a + side * (p.span + p.amp + 0.12);
        post.position.set(Math.cos(pa) * ((p.r0 + p.r1) / 2), p.y + 1.6, Math.sin(pa) * ((p.r0 + p.r1) / 2));
        post.scale.set(0.08, 3.4, 0.08);
        decor.add(post);
      }
      movers.push({ p, mesh: group });
      continue;
    }
    if (p.kind === 'crumble') {
      const t = tri();
      const cracked = shade(light, 0.85);
      sector(t, p.a - p.span, p.a + p.span, p.r0, p.r1, y0, p.y, cracked, shade(dark, 0.85));
      const mat = coreMat.clone();
      mat.transparent = true;
      disposables.push(mat);
      const mesh = new THREE.Mesh(geometryOf(THREE, t), mat);
      disposables.push(mesh.geometry);
      scene.add(mesh);
      // cracks: a few dark slivers on top
      for (let i = 0; i < 3; i++) {
        const crack = new THREE.Mesh(geo.box, mats.darkIron);
        const ca = p.a + (rng() - 0.5) * p.span * 1.6;
        const cr = p.r0 + 0.4 + rng() * (p.r1 - p.r0 - 0.8);
        crack.position.set(Math.cos(ca) * cr, p.y + 0.01, Math.sin(ca) * cr);
        crack.rotation.y = rng() * Math.PI;
        crack.scale.set(0.5 + rng() * 0.6, 0.02, 0.05);
        mesh.add(crack);
        crack.position.sub(mesh.position);
      }
      crumblies.push({ p, mesh, mat, debris: [], gone: false });
      continue;
    }
    // everything else is part of one static mesh
    if (p.kind === 'ice') {
      const ice = hexToRgb('#bfe6f8');
      sector(statics, p.a - p.span, p.a + p.span, p.r0, p.r1, y0, p.y, vary(ice, rng, 0.05), shade(hexToRgb('#7fb6d3'), 0.9));
      // icicles underneath
      for (let i = 0; i < 2 + Math.floor(rng() * 3); i++) {
        const ia = p.a + (rng() - 0.5) * p.span * 1.8;
        icicles.push({ x: Math.cos(ia) * (p.r1 - 0.15), y: y0, z: Math.sin(ia) * (p.r1 - 0.15), s: 0.4 + rng() * 0.9 });
      }
    } else if (p.kind === 'goal') {
      const pale = hexToRgb('#cfd6ee');
      sector(statics, p.a - p.span, p.a + p.span, p.r0, p.r1, y0, p.y, pale, shade(hexToRgb('#7c86ad'), 0.9));
      sector(statics, p.a - p.span * 0.9, p.a + p.span * 0.9, p.r0 + 0.5, p.r1 - 0.5, p.y, p.y + 0.08, shade(pale, 1.08), shade(pale, 0.8));
    } else sector(statics, p.a - p.span, p.a + p.span, p.r0, p.r1, y0, p.y, light, dark);

    if (p.kind === 'spring') {
      const pad = new THREE.Mesh(geo.rod, mats.gold);
      const pa = p.a;
      const pr = (p.r0 + p.r1) / 2;
      pad.position.set(Math.cos(pa) * pr, p.y + 0.42, Math.sin(pa) * pr);
      pad.scale.set(0.7, 0.08, 0.7);
      const coil = new THREE.Mesh(geo.rod, mats.iron);
      coil.position.set(Math.cos(pa) * pr, p.y + 0.2, Math.sin(pa) * pr);
      coil.scale.set(0.35, 0.4, 0.35);
      scene.add(pad, coil);
      springs.push({ p, pad, coil, squash: 0 });
    }
    if (p.kind === 'checkpoint' || p.kind === 'goal') {
      // a beacon: a pole with an orb, lit once the team passes
      const pole = new THREE.Mesh(geo.rod, mats.iron);
      const ba = p.a;
      const br = p.r0 + 0.55;
      pole.position.set(Math.cos(ba) * br, p.y + 1.1, Math.sin(ba) * br);
      pole.scale.set(0.07, 2.2, 0.07);
      const orbMat = basic('#555a66');
      const orb = new THREE.Mesh(geo.ball, orbMat);
      orb.position.set(Math.cos(ba) * br, p.y + 2.35, Math.sin(ba) * br);
      orb.scale.setScalar(0.22);
      const ringMat = basic('#ffffff', { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
      const ring = new THREE.Mesh(geo.ring, ringMat);
      ring.position.copy(orb.position);
      ring.rotation.x = Math.PI / 2;
      ring.scale.setScalar(0.5);
      decor.add(pole, orb, ring);
      beacons.push({ p, orb, orbMat, ring, ringMat, lit: false, flare: 0 });
    }
  }
  const staticMesh = new THREE.Mesh(geometryOf(THREE, statics), coreMat);
  scene.add(staticMesh);

  // the gate at the top: an arch over the way out, and a bell under it
  const goal = level.goal;
  {
    const archGeo = new THREE.TorusGeometry(2.4, 0.22, 8, 24, Math.PI);
    disposables.push(archGeo);
    const arch = new THREE.Mesh(archGeo, flat('#cfd6ee'));
    const ga = goal.a;
    const gr = goal.r0 + 2.3;
    arch.position.set(Math.cos(ga) * gr, goal.y + 0.2, Math.sin(ga) * gr);
    arch.rotation.y = -ga + Math.PI / 2;
    decor.add(arch);
    for (const side of [-1, 1]) {
      const col = new THREE.Mesh(geo.rod, flat('#b9c2e3'));
      const ca = ga + (side * 2.4) / gr;
      col.position.set(Math.cos(ca) * gr, goal.y + 1.2, Math.sin(ca) * gr);
      col.scale.set(0.24, 2.4, 0.24);
      decor.add(col);
    }
  }
  const bell = new THREE.Group();
  {
    const cup = new THREE.Mesh(geo.cone, mats.gold);
    cup.scale.set(0.55, 0.8, 0.55);
    cup.position.y = -0.5;
    const lip = new THREE.Mesh(geo.ring, mats.gold);
    lip.rotation.x = Math.PI / 2;
    lip.scale.setScalar(0.5);
    lip.position.y = -0.88;
    bell.add(cup, lip);
    const ga = goal.a;
    const gr = goal.r0 + 2.3;
    bell.position.set(Math.cos(ga) * gr, goal.y + 2.5, Math.sin(ga) * gr);
    decor.add(bell);
  }

  // -------------------------------------------------------------------------------------------------------------
  // dressing each circle

  const onCore = (a: number, y: number, out = 0) => new THREE.Vector3(Math.cos(a) * (R_CORE + out), y, Math.sin(a) * (R_CORE + out));
  const addTorch = (a: number, y: number) => {
    const bracket = new THREE.Mesh(geo.box, mats.iron);
    bracket.position.copy(onCore(a, y, 0.3));
    bracket.rotation.y = -a;
    bracket.scale.set(0.5, 0.08, 0.08);
    const stick = new THREE.Mesh(geo.rod, mats.wood);
    stick.position.copy(onCore(a, y + 0.22, 0.5));
    stick.scale.set(0.05, 0.5, 0.05);
    const flame = new THREE.Mesh(geo.cone, mats.flame);
    flame.position.copy(onCore(a, y + 0.62, 0.5));
    flame.scale.set(0.16, 0.42, 0.16);
    const coreF = new THREE.Mesh(geo.cone, mats.flameCore);
    coreF.position.copy(onCore(a, y + 0.56, 0.5));
    coreF.scale.set(0.08, 0.22, 0.08);
    decor.add(bracket, stick, flame, coreF);
    flames.push({ mesh: flame, seed: rng() * 10 });
  };
  const chainsDecor: T.InstancedMesh[] = [];
  const addHangingChain = (a: number, y: number, len: number, out = 0.4) => {
    const n = Math.max(2, Math.round(len / 0.2));
    const im = new THREE.InstancedMesh(geo.link, mats.chain, n);
    const d = new THREE.Object3D();
    for (let i = 0; i < n; i++) {
      d.position.copy(onCore(a, y - i * 0.2, out));
      d.rotation.set(0, -a + (i % 2) * Math.PI * 0.5, 0);
      d.updateMatrix();
      im.setMatrixAt(i, d.matrix);
    }
    im.instanceMatrix.needsUpdate = true;
    decor.add(im);
    chainsDecor.push(im);
  };
  // circle by circle, round the core
  for (const p of level.platforms) {
    if (p.kind === 'floor') continue;
    const z = ZONES[p.zone].id;
    const r = rng();
    if (z === 'pit') {
      if (r < 0.45) addTorch(p.a + (rng() - 0.5) * p.span, p.y + 1.6);
      if (r > 0.7) addHangingChain(p.a + p.span * 0.9, p.y + 3 + rng() * 2, 1.5 + rng() * 3);
      if (rng() < 0.25) {
        // a skull or two on the ledge
        const skull = new THREE.Mesh(geo.ball, mats.bone);
        const sa = p.a + (rng() - 0.5) * p.span * 1.4;
        const sr = p.r0 + 0.5 + rng() * 0.8;
        skull.position.set(Math.cos(sa) * sr, p.y + 0.14, Math.sin(sa) * sr);
        skull.scale.set(0.16, 0.14, 0.17);
        decor.add(skull);
      }
    } else if (z === 'catacombs') {
      if (r < 0.5) {
        // a niche with a skull in it
        const niche = new THREE.Mesh(geo.box, mats.darkIron);
        const na = p.a + (rng() - 0.5) * p.span;
        niche.position.copy(onCore(na, p.y + 1.4, 0.05));
        niche.rotation.y = -na;
        niche.scale.set(0.12, 0.6, 0.5);
        const skull = new THREE.Mesh(geo.ball, mats.bone);
        skull.position.copy(onCore(na, p.y + 1.3, 0.2));
        skull.scale.set(0.16, 0.15, 0.17);
        decor.add(niche, skull);
      }
      if (r > 0.6) {
        const ghost = new THREE.Mesh(geo.ball, mats.ghost);
        const gaz = p.a + (rng() - 0.5) * p.span * 2;
        const gr = p.r1 + 0.8 + rng() * 1.5;
        ghost.scale.setScalar(0.14);
        decor.add(ghost);
        ghosts.push({ mesh: ghost, x: Math.cos(gaz) * gr, y: p.y + 1.2 + rng() * 2, z: Math.sin(gaz) * gr, seed: rng() * 10 });
      }
    } else if (z === 'forge') {
      if (r < 0.35) {
        // a girder out from the core above the ledge
        const girder = new THREE.Mesh(geo.box, mats.iron);
        const ga = p.a + (rng() - 0.5) * p.span;
        const gl2 = 2.5 + rng() * 2;
        const mid = onCore(ga, p.y + 3.2 + rng(), gl2 / 2);
        girder.position.copy(mid);
        girder.rotation.y = -ga;
        girder.scale.set(gl2, 0.18, 0.18);
        decor.add(girder);
      } else if (r < 0.6) {
        const gear = new THREE.Group();
        const ring = new THREE.Mesh(geo.ring, mats.iron);
        ring.scale.setScalar(0.6);
        gear.add(ring);
        for (let i = 0; i < 4; i++) {
          const spoke = new THREE.Mesh(geo.box, mats.iron);
          spoke.rotation.z = (i * Math.PI) / 4;
          spoke.scale.set(1.3, 0.1, 0.08);
          gear.add(spoke);
        }
        const ga = p.a + (rng() - 0.5) * p.span;
        gear.position.copy(onCore(ga, p.y + 2 + rng() * 1.5, 0.12));
        gear.rotation.y = -ga + Math.PI / 2;
        decor.add(gear);
        gears.push(gear);
      } else if (r < 0.8) {
        const vent = new THREE.Mesh(geo.plane, mats.vent);
        const va = p.a + (rng() - 0.5) * p.span;
        vent.position.copy(onCore(va, p.y + 0.9 + rng(), 0.08));
        vent.rotation.y = -va + Math.PI / 2;
        vent.scale.set(0.5, 0.18, 1);
        decor.add(vent);
      }
    } else if (z === 'frost') {
      if (r < 0.4) {
        // a crystal on the core
        const crystal = new THREE.Mesh(geo.cone, mats.ice);
        const ca = p.a + (rng() - 0.5) * p.span * 1.5;
        crystal.position.copy(onCore(ca, p.y + 1 + rng() * 2, 0.25));
        crystal.rotation.z = Math.PI / 2 + (rng() - 0.5) * 0.8;
        crystal.rotation.y = -ca;
        crystal.scale.set(0.18, 0.7 + rng() * 0.6, 0.18);
        decor.add(crystal);
      }
    } else if (z === 'cathedral') {
      if (r < 0.5) {
        // a window of coloured glass in the core
        const pane = new THREE.Mesh(geo.plane, mats.glass[Math.floor(rng() * mats.glass.length)]);
        const wa = p.a + (rng() - 0.5) * p.span;
        pane.position.copy(onCore(wa, p.y + 2.2 + rng() * 1.5, 0.07));
        pane.rotation.y = -wa + Math.PI / 2;
        pane.scale.set(0.5, 1.4, 1);
        const top = new THREE.Mesh(geo.disc, pane.material);
        top.position.copy(onCore(wa, p.y + 2.9 + (pane.position.y - p.y - 2.2), 0.07));
        top.rotation.y = -wa + Math.PI / 2;
        top.scale.setScalar(0.25);
        decor.add(pane, top);
      } else if (r < 0.8) {
        const candle = new THREE.Mesh(geo.rod, mats.bone);
        const ca = p.a + (rng() - 0.5) * p.span * 1.6;
        const cr = p.r0 + 0.4 + rng() * 0.5;
        candle.position.set(Math.cos(ca) * cr, p.y + 0.14, Math.sin(ca) * cr);
        candle.scale.set(0.05, 0.28, 0.05);
        const flame = new THREE.Mesh(geo.cone, mats.flame);
        flame.position.set(Math.cos(ca) * cr, p.y + 0.36, Math.sin(ca) * cr);
        flame.scale.set(0.05, 0.12, 0.05);
        decor.add(candle, flame);
        candles.push(candle);
        flames.push({ mesh: flame, seed: rng() * 10 });
      }
      if (rng() < 0.3) {
        // an arch and a column against the core
        const archGeo = new THREE.TorusGeometry(0.9, 0.1, 6, 16, Math.PI);
        disposables.push(archGeo);
        const arch = new THREE.Mesh(archGeo, mats.stoneGrey);
        const aa = p.a + (rng() - 0.5) * p.span;
        arch.position.copy(onCore(aa, p.y + 2.4, 0.12));
        arch.rotation.y = -aa + Math.PI / 2;
        decor.add(arch);
        for (const side of [-1, 1]) {
          const col = new THREE.Mesh(geo.rod, mats.stoneGrey);
          col.position.copy(onCore(aa + (side * 0.9) / R_CORE, p.y + 1.2, 0.12));
          col.scale.set(0.1, 2.4, 0.1);
          decor.add(col);
        }
      }
    } else if (z === 'stars') {
      if (r < 0.6) {
        const shard = new THREE.Mesh(geo.box, flat(ZONES[5].palette.stone[1]));
        const sa = p.a + (rng() - 0.5) * 1.2;
        const sr = p.r1 + 2 + rng() * 5;
        shard.scale.set(0.4 + rng() * 0.8, 0.3 + rng() * 0.4, 0.4 + rng() * 0.8);
        shard.rotation.set(rng(), rng(), rng());
        decor.add(shard);
        shards.push({ mesh: shard, a: sa, r: sr, y: p.y + (rng() - 0.5) * 4, seed: rng() * 10 });
      }
    }
  }
  // icicles as one instanced mesh
  const icicleMesh = new THREE.InstancedMesh(geo.cone, mats.ice, Math.max(1, icicles.length));
  {
    const d = new THREE.Object3D();
    icicles.forEach((ic, i) => {
      d.position.set(ic.x, ic.y - ic.s / 2, ic.z);
      d.rotation.set(Math.PI, 0, 0);
      d.scale.set(0.08 + ic.s * 0.06, ic.s, 0.08 + ic.s * 0.06);
      d.updateMatrix();
      icicleMesh.setMatrixAt(i, d.matrix);
    });
    icicleMesh.count = icicles.length;
    icicleMesh.instanceMatrix.needsUpdate = true;
    decor.add(icicleMesh);
  }

  // -------------------------------------------------------------------------------------------------------------
  // weather: one instanced mesh per kind, recycled around the camera

  const particleSets: Particles[] = [];
  const makeParticles = (kind: Particles['kind'], zone: number, n: number, color: string, size: number, boxy = false) => {
    const mat = basic(color, { transparent: kind === 'ash' || kind === 'mote' || kind === 'stardust', opacity: 0.8 });
    const mesh = new THREE.InstancedMesh(boxy ? geo.box : geo.ball, mat, n);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    const set: Particles = { mesh, pos: new Float32Array(n * 3), vel: new Float32Array(n * 3), life: new Float32Array(n), n, zone, size, kind };
    for (let i = 0; i < n; i++) set.life[i] = -1;
    particleSets.push(set);
  };
  const scaleP = lite ? 0.55 : 1;
  makeParticles('ember', 0, Math.round(110 * scaleP), '#ff8a3a', 0.04);
  makeParticles('ash', 1, Math.round(80 * scaleP), '#9a9ca6', 0.06, true);
  makeParticles('spark', 2, Math.round(70 * scaleP), '#ffd27a', 0.035);
  makeParticles('snow', 3, Math.round(150 * scaleP), '#eaf6ff', 0.05);
  makeParticles('mote', 4, Math.round(60 * scaleP), '#ffe2a8', 0.045);
  makeParticles('stardust', 5, Math.round(90 * scaleP), '#dfe6ff', 0.04);

  // dust and sparks that burst from events
  const PUFFS = 48;
  const puffMesh = new THREE.InstancedMesh(geo.ball, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8 }), PUFFS);
  disposables.push(puffMesh.material as T.Material);
  puffMesh.frustumCulled = false;
  puffMesh.count = 0;
  scene.add(puffMesh);
  const puffs: Puff[] = [];
  const burst = (x: number, y: number, z: number, n: number, color: [number, number, number], speed: number, size: number, up = 1) => {
    for (let i = 0; i < n; i++) {
      if (puffs.length >= PUFFS) puffs.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      puffs.push({ life: 1, x, y, z, vx: Math.cos(a) * s, vy: up * s * (0.4 + Math.random() * 0.8), vz: Math.sin(a) * s, size: size * (0.6 + Math.random() * 0.8), r: color[0], g: color[1], b: color[2] });
    }
  };
  // wind streaks for the gusts at the top
  const STREAKS = 26;
  const streakMesh = new THREE.InstancedMesh(geo.box, basic('#dfe6ff', { transparent: true, opacity: 0.35 }), STREAKS);
  streakMesh.frustumCulled = false;
  streakMesh.count = 0;
  scene.add(streakMesh);
  const streakA = new Float32Array(STREAKS);
  const streakY = new Float32Array(STREAKS);
  const streakR = new Float32Array(STREAKS);
  for (let i = 0; i < STREAKS; i++) {
    streakA[i] = Math.random() * Math.PI * 2;
    streakY[i] = Math.random() * 30;
    streakR[i] = R_CORE + 1 + Math.random() * 9;
  }

  // -------------------------------------------------------------------------------------------------------------
  // the souls and the chain

  const soulViews: SoulView[] = [];
  const makeSoul = (color: string): SoulView => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const c = new THREE.Color(color);
    const cloakMat = flat(c.getHex());
    const darkMat = flat(c.clone().multiplyScalar(0.55).getHex());
    const skin = flat('#f1e4d2');
    const cloak = new THREE.Mesh(geo.cone, cloakMat);
    cloak.position.y = 0.42;
    cloak.scale.set(0.34, 0.84, 0.34);
    const head = new THREE.Mesh(geo.ball, skin);
    head.position.set(0.02, 0.98, 0);
    head.scale.setScalar(0.2);
    const hood = new THREE.Mesh(geo.ball, cloakMat);
    hood.position.set(-0.05, 1.02, 0);
    hood.scale.set(0.24, 0.26, 0.26);
    const eyeMat = basic('#fff1b8');
    const eyes = [-1, 1].map((side) => {
      const e = new THREE.Mesh(geo.ball, eyeMat);
      e.position.set(0.19, 1.0, side * 0.07);
      e.scale.setScalar(0.035);
      return e;
    });
    const arms = [-1, 1].map((side) => {
      const g = new THREE.Group();
      g.position.set(0.02, 0.84, side * 0.22);
      const arm = new THREE.Mesh(geo.box, darkMat);
      arm.position.y = -0.2;
      arm.scale.set(0.09, 0.4, 0.09);
      const hand = new THREE.Mesh(geo.ball, skin);
      hand.position.y = -0.42;
      hand.scale.setScalar(0.06);
      g.add(arm, hand);
      body.add(g);
      return g;
    }) as [T.Group, T.Group];
    const legs = [-1, 1].map((side) => {
      const g = new THREE.Group();
      g.position.set(0, 0.3, side * 0.1);
      const leg = new THREE.Mesh(geo.box, darkMat);
      leg.position.y = -0.14;
      leg.scale.set(0.1, 0.3, 0.1);
      g.add(leg);
      body.add(g);
      return g;
    }) as [T.Group, T.Group];
    // the shackle on the left ankle, where the chain starts
    const shackleMesh = new THREE.Mesh(geo.ring, mats.chain);
    shackleMesh.position.y = -0.24;
    shackleMesh.rotation.x = Math.PI / 2;
    shackleMesh.scale.setScalar(0.11);
    legs[0].add(shackleMesh);
    const shackle = new THREE.Object3D();
    shackle.position.set(0.1, -0.24, 0);
    legs[0].add(shackle);
    // a lantern in the right hand
    const lanternMat = basic(c.clone().lerp(new THREE.Color('#ffd9a0'), 0.6).getHex());
    const lantern = new THREE.Mesh(geo.ball, lanternMat);
    lantern.position.set(0.08, -0.5, 0);
    lantern.scale.setScalar(0.07);
    const cage = new THREE.Mesh(geo.ring, mats.darkIron);
    cage.position.copy(lantern.position);
    cage.scale.setScalar(0.09);
    arms[1].add(lantern, cage);
    body.add(cloak, head, hood, ...eyes);
    // a halo over the soul being steered, and a pool of lantern light on the ground
    const haloMat = basic('#ffffff', { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(geo.ring, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.45;
    halo.scale.setScalar(0.28);
    root.add(halo);
    const glowMat = basic(lanternMat.color.getHex(), { transparent: true, opacity: 0.25, depthWrite: false });
    const glow = new THREE.Mesh(geo.disc, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.scale.setScalar(0.9);
    scene.add(glow);
    scene.add(root);
    return { root, body, cloak, head, eyes, eyeMat, arms, legs, shackle, lantern, lanternMat, halo, haloMat, glow, glowMat, color: c, stride: 0, lean: 0, flail: 0, burnScale: 1 };
  };

  const ROPE_N = 16;
  const ropes: Rope[] = [];
  const LINKS_MAX = 3 * (ROPE_N - 1);
  const linkMesh = new THREE.InstancedMesh(geo.link, mats.chain, LINKS_MAX);
  linkMesh.frustumCulled = false;
  linkMesh.count = 0;
  scene.add(linkMesh);

  // -------------------------------------------------------------------------------------------------------------
  // state

  const v3 = new THREE.Vector3();
  const v3b = new THREE.Vector3();
  const v3c = new THREE.Vector3();
  const q4 = new THREE.Quaternion();
  const q4b = new THREE.Quaternion();
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const X = new THREE.Vector3(1, 0, 0);
  const cam = { a: 0, r: 0, y: 0, tx: 0, ty: 0, tz: 0, dist: 9.5, shake: 0, init: false, fallDip: 0 };
  let pal = paletteAt(0);
  let bellSwing = 0;
  let won = false;
  let camZone = 0;

  const groundUnder = (g: Game, x: number, y: number, z: number): number => {
    let best = -Infinity;
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    for (const p of g.level.platforms) {
      if (p.y - p.amp > y + 0.1) continue;
      const q = pose(p, g.time);
      if (q.y > y + 0.1 || q.y < best) continue;
      if (r < p.r0 || r > p.r1) continue;
      if (p.kind !== 'floor') {
        let da = a - q.a;
        da = Math.atan2(Math.sin(da), Math.cos(da));
        if (Math.abs(da) > p.span) continue;
      }
      best = q.y;
    }
    return best;
  };

  function syncSoul(g: Game, s: Soul, sv: SoulView, dt: number, clock: number, lead: boolean, idx: number) {
    const burned = s.burned >= 0;
    sv.burnScale = damp(sv.burnScale, burned ? 0 : 1, 10, dt);
    sv.root.visible = sv.burnScale > 0.02;
    sv.glow.visible = sv.root.visible;
    const speed = Math.hypot(s.vx, s.vz);
    sv.root.position.set(s.x, s.y, s.z);
    sv.root.rotation.y = -s.face;
    // squash on landing, stretch in the air
    const sq = s.grounded ? 1 - s.squash * 0.28 + Math.abs(Math.sin(sv.stride * 2)) * 0.03 * Math.min(1, speed / 3) : 1 + clamp(Math.abs(s.vy) * 0.012, 0, 0.14);
    const breathe = s.grounded && speed < 0.5 ? 1 + Math.sin(clock * 2.2 + idx) * 0.015 : 1;
    sv.body.scale.set((1 / Math.sqrt(sq)) * sv.burnScale, sq * breathe * sv.burnScale, (1 / Math.sqrt(sq)) * sv.burnScale);
    sv.stride += dt * (s.grounded ? speed * 1.9 : 1.5);
    const swing = s.grounded ? Math.sin(sv.stride) * clamp(speed / 4, 0, 1) * 0.8 : 0;
    // legs: run, tuck in the air, dangle when hanging
    const tuck = !s.grounded ? (s.hanging ? 0.15 : s.vy > 0 ? -0.5 : 0.35) : 0;
    sv.legs[0].rotation.z = swing + tuck;
    sv.legs[1].rotation.z = -swing + tuck * 0.6;
    // arms: counter swing, up in the air, reaching for the chain when hanging, flailing in a long fall
    sv.flail = damp(sv.flail, !s.grounded && s.vy < -9 ? 1 : 0, 6, dt);
    const reach = s.hanging ? 2.6 : !s.grounded ? (s.vy > 0 ? 2.2 : 1.4) : 0;
    const f = sv.flail * Math.sin(clock * 24 + idx) * 0.6;
    sv.arms[0].rotation.z = damp(sv.arms[0].rotation.z, -swing * 0.9 + reach + f, 10, dt);
    sv.arms[1].rotation.z = damp(sv.arms[1].rotation.z, swing * 0.9 + reach * (s.hanging ? 1 : 0.6) - f, 10, dt);
    sv.arms[0].rotation.x = s.hanging ? Math.sin(clock * 3 + idx) * 0.1 : 0;
    // lean into the run
    sv.lean = damp(sv.lean, s.grounded ? clamp(speed / 6, 0, 1) * 0.18 : 0, 8, dt);
    sv.body.rotation.z = -sv.lean;
    // eyes flicker a little when burned out, blink now and then
    const blink = Math.sin(clock * 1.7 + idx * 1.3) > 0.985;
    for (const e of sv.eyes) e.scale.set(0.035, blink ? 0.006 : 0.035, 0.035);
    // the lantern breathes
    sv.lanternMat.color.copy(sv.color).lerp(color.set('#ffd9a0'), 0.6 + Math.sin(clock * 5 + idx) * 0.08);
    // the halo for the steered soul
    sv.haloMat.opacity = damp(sv.haloMat.opacity, lead && g.souls.filter((x) => x.kind === 'local').length > 1 ? 0.75 : 0, 8, dt);
    sv.halo.rotation.z += dt * 0.8;
    sv.halo.scale.setScalar(0.28 + Math.sin(clock * 3) * 0.02);
    // the pool of light under the soul
    const gy = groundUnder(g, s.x, s.y, s.z);
    if (Number.isFinite(gy) && gy > g.lava) {
      sv.glow.visible = sv.root.visible;
      sv.glow.position.set(s.x, gy + 0.02, s.z);
      const h = clamp(s.y - gy, 0, 6);
      sv.glow.scale.setScalar(0.9 + h * 0.12);
      sv.glowMat.opacity = (0.28 - h * 0.035) * sv.burnScale;
    } else sv.glow.visible = false;
  }

  function stepRope(rope: Rope, ax: number, ay: number, az: number, bx: number, by: number, bz: number, dt: number, g: Game) {
    const n = rope.n;
    const p = rope.points;
    const q = rope.prev;
    const seg = CHAIN_L / (n - 1);
    const d2 = Math.min(dt, 1 / 30);
    for (let i = 1; i < n - 1; i++) {
      const i3 = i * 3;
      const vx = (p[i3] - q[i3]) * 0.985;
      const vy = (p[i3 + 1] - q[i3 + 1]) * 0.985;
      const vz = (p[i3 + 2] - q[i3 + 2]) * 0.985;
      q[i3] = p[i3];
      q[i3 + 1] = p[i3 + 1];
      q[i3 + 2] = p[i3 + 2];
      p[i3] += vx;
      p[i3 + 1] += vy - 12 * d2 * d2;
      p[i3 + 2] += vz;
    }
    p[0] = ax;
    p[1] = ay;
    p[2] = az;
    p[(n - 1) * 3] = bx;
    p[(n - 1) * 3 + 1] = by;
    p[(n - 1) * 3 + 2] = bz;
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < n - 1; i++) {
        const i3 = i * 3;
        const j3 = i3 + 3;
        const dx = p[j3] - p[i3];
        const dy = p[j3 + 1] - p[i3 + 1];
        const dz = p[j3 + 2] - p[i3 + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        if (d <= seg) continue;
        const k = (d - seg) / d;
        const wi = i === 0 ? 0 : 0.5;
        const wj = i + 1 === n - 1 ? 0 : 0.5;
        const sum = wi + wj || 1;
        p[i3] += dx * k * (wi / sum);
        p[i3 + 1] += dy * k * (wi / sum);
        p[i3 + 2] += dz * k * (wi / sum);
        p[j3] -= dx * k * (wj / sum);
        p[j3 + 1] -= dy * k * (wj / sum);
        p[j3 + 2] -= dz * k * (wj / sum);
      }
      // keep the rope out of the core and off the tops of ledges it hangs over
      for (let i = 1; i < n - 1; i++) {
        const i3 = i * 3;
        const r = Math.hypot(p[i3], p[i3 + 2]);
        if (r < R_CORE + 0.12) {
          const k = (R_CORE + 0.12) / r;
          p[i3] *= k;
          p[i3 + 2] *= k;
        }
        const gy = groundUnder(g, p[i3], p[i3 + 1] + 0.3, p[i3 + 2]);
        if (Number.isFinite(gy) && p[i3 + 1] < gy + 0.07 && p[i3 + 1] > gy - 0.5) p[i3 + 1] = gy + 0.07;
      }
    }
  }

  function syncRopes(g: Game, dt: number) {
    const live = g.chain.filter((i) => g.souls[i].burned < 0);
    let count = 0;
    for (let k = 0; k + 1 < live.length; k++) {
      const a = soulViews[live[k]];
      const b = soulViews[live[k + 1]];
      if (!a || !b) continue;
      let rope = ropes[k];
      a.shackle.getWorldPosition(v3);
      b.shackle.getWorldPosition(v3b);
      if (!rope) {
        rope = { points: new Float32Array(ROPE_N * 3), prev: new Float32Array(ROPE_N * 3), n: ROPE_N };
        for (let i = 0; i < ROPE_N; i++) {
          const t = i / (ROPE_N - 1);
          rope.points[i * 3] = lerp(v3.x, v3b.x, t);
          rope.points[i * 3 + 1] = lerp(v3.y, v3b.y, t);
          rope.points[i * 3 + 2] = lerp(v3.z, v3b.z, t);
        }
        rope.prev.set(rope.points);
        ropes[k] = rope;
      }
      stepRope(rope, v3.x, v3.y, v3.z, v3b.x, v3b.y, v3b.z, dt, g);
      for (let i = 0; i < ROPE_N - 1; i++) {
        const i3 = i * 3;
        v3c.set(rope.points[i3 + 3] - rope.points[i3], rope.points[i3 + 4] - rope.points[i3 + 1], rope.points[i3 + 5] - rope.points[i3 + 2]);
        const len = v3c.length() || 1e-6;
        v3c.divideScalar(len);
        q4.setFromUnitVectors(X, v3c);
        q4b.setFromAxisAngle(v3c, (i % 2) * Math.PI * 0.5);
        q4.premultiply(q4b);
        dummy.position.set((rope.points[i3] + rope.points[i3 + 3]) / 2, (rope.points[i3 + 1] + rope.points[i3 + 4]) / 2, (rope.points[i3 + 2] + rope.points[i3 + 5]) / 2);
        dummy.quaternion.copy(q4);
        dummy.scale.set(Math.min(1.6, len / 0.22), 1, 1);
        dummy.updateMatrix();
        linkMesh.setMatrixAt(count++, dummy.matrix);
      }
    }
    ropes.length = Math.max(0, live.length - 1);
    linkMesh.count = count;
    linkMesh.instanceMatrix.needsUpdate = true;
  }

  function syncParticles(g: Game, dt: number, clock: number) {
    const cy = cam.ty;
    const ca = cam.a;
    for (const set of particleSets) {
      const near = Math.abs(set.zone - camZone) <= 1 && Math.abs(ZONES[set.zone].from + 10 - cy) < 34;
      let count = 0;
      for (let i = 0; i < set.n; i++) {
        const i3 = i * 3;
        if (set.life[i] < 0) {
          if (!near) continue;
          // spawn around the camera, in this circle's band of heights
          const a = ca + (Math.random() - 0.5) * 1.6;
          const r = R_CORE + 0.5 + Math.random() * 12;
          set.pos[i3] = Math.cos(a) * r;
          set.pos[i3 + 2] = Math.sin(a) * r;
          const lo = ZONES[set.zone].from - 4;
          const hi = ZONES[set.zone].to + 4;
          set.pos[i3 + 1] = clamp(cy + (Math.random() - 0.5) * 24, lo, hi);
          set.life[i] = 2 + Math.random() * 5;
          const k = set.kind;
          set.vel[i3] = (Math.random() - 0.5) * 0.4;
          set.vel[i3 + 1] = k === 'ember' ? 0.8 + Math.random() : k === 'spark' ? -2 - Math.random() * 3 : k === 'ash' ? -0.35 : k === 'snow' ? -0.7 - Math.random() * 0.4 : k === 'mote' ? 0.05 : 0.02;
          set.vel[i3 + 2] = (Math.random() - 0.5) * 0.4;
        }
        set.life[i] -= dt;
        const w = set.kind === 'snow' ? Math.sin(clock * 1.3 + i) * 0.5 : set.kind === 'ember' ? Math.sin(clock * 2 + i) * 0.4 : 0;
        set.pos[i3] += (set.vel[i3] + w) * dt;
        set.pos[i3 + 1] += set.vel[i3 + 1] * dt;
        set.pos[i3 + 2] += (set.vel[i3 + 2] + w * 0.5) * dt;
        if (set.kind === 'spark') set.vel[i3 + 1] -= 6 * dt;
        if (set.pos[i3 + 1] < g.lava || Math.abs(set.pos[i3 + 1] - cy) > 30) set.life[i] = -1;
        if (set.life[i] < 0) continue;
        dummy.position.set(set.pos[i3], set.pos[i3 + 1], set.pos[i3 + 2]);
        const fade = clamp(set.life[i], 0, 1);
        dummy.scale.setScalar(set.size * (0.6 + fade * 0.6) * (set.kind === 'spark' ? 1 + Math.random() * 0.6 : 1));
        if (set.kind === 'ash') dummy.rotation.set(clock + i, clock * 0.7, 0);
        else dummy.rotation.set(0, 0, 0);
        dummy.updateMatrix();
        set.mesh.setMatrixAt(count++, dummy.matrix);
      }
      set.mesh.count = count;
      set.mesh.instanceMatrix.needsUpdate = true;
    }
    // bursts
    let pc = 0;
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life -= dt * 1.6;
      if (p.life <= 0) {
        puffs.splice(i, 1);
        continue;
      }
      p.vy -= 4 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.size * (0.5 + (1 - p.life) * 0.9));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      puffMesh.setMatrixAt(pc, dummy.matrix);
      puffMesh.setColorAt(pc, color.setRGB(p.r, p.g, p.b));
      pc++;
    }
    puffMesh.count = pc;
    puffMesh.instanceMatrix.needsUpdate = true;
    if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;
    // wind
    const wind = windAt(g.time);
    const windy = cy > 94 && wind.phase !== 'calm';
    let sc = 0;
    if (windy) {
      const strength = wind.phase === 'gust' ? 1 : wind.strength * 0.5;
      for (let i = 0; i < STREAKS; i++) {
        streakA[i] += wind.dir * -1 * (8 + i * 0.3) * strength * dt / streakR[i];
        const a = streakA[i];
        const y = 96 + ((streakY[i] + clock * 0.3) % 30);
        dummy.position.set(Math.cos(a) * streakR[i], y, Math.sin(a) * streakR[i]);
        dummy.rotation.set(0, -a, 0);
        dummy.scale.set(0.06, 0.03, 1.6 + strength * 2);
        dummy.updateMatrix();
        streakMesh.setMatrixAt(sc++, dummy.matrix);
      }
    }
    streakMesh.count = sc;
    streakMesh.instanceMatrix.needsUpdate = true;
  }

  function syncLedges(g: Game, dt: number, clock: number) {
    const cs: CrumbleState = { phase: 'none', t: 0, drop: 0 };
    for (const m of movers) {
      const q = pose(m.p, g.time);
      m.mesh.rotation.y = -q.a;
      m.mesh.position.y = q.y;
      if (m.parts) {
        // the piston reaches from the plate down to its lowest point and a bit
        const piston = m.parts[0];
        const reach = q.y - (m.p.y - m.p.amp) + 1.2;
        piston.position.set((m.p.r0 + m.p.r1) / 2, -reach / 2 - m.p.h * 0.6, 0);
        piston.scale.y = reach;
      }
    }
    for (const c of crumblies) {
      crumbleState(g, c.p.id, cs);
      if (cs.phase === 'none') {
        c.mesh.visible = true;
        c.mesh.position.set(0, 0, 0);
        c.mesh.rotation.set(0, 0, 0);
        c.mat.opacity = 1;
        if (c.gone) {
          c.gone = false;
          c.mat.opacity = 0;
        }
        c.mat.opacity = Math.min(1, c.mat.opacity + dt * 2);
      } else if (cs.phase === 'warn') {
        const k = cs.t * 40;
        c.mesh.position.set(Math.sin(k) * 0.03, Math.sin(k * 1.3) * 0.02, Math.cos(k * 0.9) * 0.03);
        c.mesh.visible = true;
      } else if (cs.phase === 'fall') {
        c.mesh.visible = true;
        c.mesh.position.set(0, -cs.drop, 0);
        c.mesh.rotation.z = (cs.t - 0.55) * 0.25;
        c.mat.opacity = clamp(1 - (cs.t - 0.55) / 1.4, 0, 1);
      } else {
        c.mesh.visible = false;
        c.gone = true;
      }
      for (let i = c.debris.length - 1; i >= 0; i--) {
        const d = c.debris[i];
        d.vy -= 14 * dt;
        d.mesh.position.x += d.vx * dt;
        d.mesh.position.y += d.vy * dt;
        d.mesh.position.z += d.vz * dt;
        d.mesh.rotation.x += d.rx * dt;
        d.mesh.rotation.z += d.rz * dt;
        d.life -= dt;
        if (d.life <= 0) {
          scene.remove(d.mesh);
          c.debris.splice(i, 1);
        }
      }
    }
    for (const sp of springs) {
      sp.squash = Math.max(0, sp.squash - dt * 3);
      const k = 1 - Math.sin(Math.min(1, sp.squash) * Math.PI) * 0.55;
      sp.coil.scale.y = 0.4 * k;
      sp.coil.position.y = sp.p.y + 0.2 * k;
      sp.pad.position.y = sp.p.y + 0.42 * k;
    }
    for (const b of beacons) {
      const lit = g.lit[b.p.cp] || (b.p.kind === 'goal' && won);
      const glow = ZONES[b.p.zone].palette.glow;
      if (lit && !b.lit) {
        b.lit = true;
        b.flare = 1;
      }
      b.orbMat.color.set(lit ? glow : '#555a66');
      const pulse = lit ? 1 + Math.sin(clock * 4) * 0.12 : 1;
      b.orb.scale.setScalar(0.22 * pulse + b.flare * 0.3);
      b.flare = Math.max(0, b.flare - dt * 1.2);
      b.ringMat.opacity = b.flare * 0.8;
      b.ringMat.color.set(glow);
      b.ring.scale.setScalar(0.5 + (1 - b.flare) * 4);
    }
    for (const f of flames) {
      const k = 1 + Math.sin(clock * 11 + f.seed) * 0.18 + Math.sin(clock * 23 + f.seed * 2) * 0.1;
      f.mesh.scale.y = (f.mesh.scale.x > 0.1 ? 0.42 : 0.12) * k;
      f.mesh.rotation.z = Math.sin(clock * 7 + f.seed) * 0.12;
    }
    for (const gh of ghosts) {
      gh.mesh.position.set(gh.x + Math.sin(clock * 0.7 + gh.seed) * 0.6, gh.y + Math.sin(clock * 1.1 + gh.seed) * 0.4, gh.z + Math.cos(clock * 0.5 + gh.seed) * 0.6);
      (gh.mesh.material as T.MeshBasicMaterial).opacity = 0.45 + Math.sin(clock * 2 + gh.seed) * 0.25;
    }
    for (const gear of gears) gear.rotation.z += dt * 0.6;
    for (const sh of shards) {
      const a = sh.a + clock * 0.03;
      sh.mesh.position.set(Math.cos(a) * sh.r, sh.y + Math.sin(clock * 0.5 + sh.seed) * 0.4, Math.sin(a) * sh.r);
      sh.mesh.rotation.y += dt * 0.2;
    }
    clouds.rotation.y += dt * 0.004;
    // the lava
    const lv = g.lava;
    lava.position.y = lv;
    lavaGlow.position.y = lv + 0.12;
    const heat = 0.5 + Math.sin(clock * 1.7) * 0.25 + Math.sin(clock * 4.3) * 0.15;
    (lava.material as T.MeshBasicMaterial).color.set('#ff4a12').lerp(color.set('#ffb13a'), heat * 0.5);
    (lavaGlow.material as T.MeshBasicMaterial).opacity = 0.25 + heat * 0.2;
    let bc = 0;
    for (let i = 0; i < BUBBLES; i++) {
      bubbleT[i] += dt;
      const t = bubbleT[i] % 3;
      const s = t < 2 ? 0.15 + t * 0.2 : 0;
      if (s <= 0) continue;
      dummy.position.set(bubbleAt[i * 3], lv + 0.1 + t * 0.15, bubbleAt[i * 3 + 2]);
      dummy.scale.setScalar(s);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      bubbles.setMatrixAt(bc++, dummy.matrix);
    }
    bubbles.count = bc;
    bubbles.instanceMatrix.needsUpdate = true;
    // the bell swings once the climb is won
    if (bellSwing > 0) {
      bellSwing = Math.max(0, bellSwing - dt * 0.25);
      bell.rotation.z = Math.sin(clock * 6) * 0.5 * bellSwing;
    }
  }

  function syncCamera(g: Game, focus: number[], dt: number, split: boolean) {
    const main = g.souls[focus[0]] ?? g.souls[0];
    if (!main) return;
    // the target: mostly the lead soul, a little toward the others, a little ahead of where it is going
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let on = 0;
    for (const i of focus.slice(1)) {
      const s = g.souls[i];
      if (!s || s.burned >= 0) continue;
      ox += s.x;
      oy += s.y;
      oz += s.z;
      on++;
    }
    const share = on ? (split ? 0.5 : 0.22) : 0;
    let tx = main.x;
    let ty = main.y;
    let tz = main.z;
    if (on) {
      tx = lerp(main.x, ox / on, share);
      ty = lerp(main.y, oy / on, share);
      tz = lerp(main.z, oz / on, share);
    }
    const speed = Math.hypot(main.vx, main.vz);
    const look = clamp(speed * 0.14, 0, 1.1);
    if (speed > 0.1) {
      tx += (main.vx / speed) * look;
      tz += (main.vz / speed) * look;
    }
    ty += 1.0 + clamp(main.vy * 0.06, -0.9, 0.7);
    const k = cam.init ? 1 - Math.exp(-7 * dt) : 1;
    cam.tx = lerp(cam.tx, tx, k);
    cam.ty = lerp(cam.ty, ty, k);
    cam.tz = lerp(cam.tz, tz, k);
    // the camera stands outside the target's angle, further back when the souls spread out or someone is falling
    const ta = Math.atan2(cam.tz, cam.tx);
    const tr = Math.hypot(cam.tx, cam.tz);
    let da = ta - cam.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    cam.a = cam.init ? cam.a + da * (1 - Math.exp(-6 * dt)) : ta;
    let spread = 0;
    for (const i of focus) {
      const s = g.souls[i];
      if (s) spread = Math.max(spread, Math.hypot(s.x - main.x, s.y - main.y, s.z - main.z));
    }
    const falling = main.vy < -8 ? 1 : 0;
    cam.fallDip = damp(cam.fallDip, falling, 3, dt);
    const wantDist = 9.2 + clamp(spread - 2, 0, 4) * 0.5 + cam.fallDip * 2.4;
    cam.dist = cam.init ? damp(cam.dist, wantDist, 3, dt) : wantDist;
    cam.r = cam.init ? damp(cam.r, tr + cam.dist, 6, dt) : tr + cam.dist;
    const height = cam.ty + 3.9 - cam.fallDip * 1.4;
    cam.y = cam.init ? damp(cam.y, height, 7, dt) : height;
    cam.init = true;
    cam.shake = Math.max(0, cam.shake - dt * 1.6);
    const sh = cam.shake * cam.shake * 0.35;
    camera.position.set(Math.cos(cam.a) * cam.r + (Math.random() - 0.5) * sh, cam.y + (Math.random() - 0.5) * sh, Math.sin(cam.a) * cam.r + (Math.random() - 0.5) * sh);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.tx, cam.ty + 0.5 - cam.fallDip * 1.2, cam.tz);
  }

  function syncPalette(g: Game, dt: number) {
    pal = paletteAt(cam.ty);
    camZone = pal.zone;
    const p = pal.palette;
    color.set(p.fog);
    fog.color.lerp(color, 1 - Math.exp(-3 * dt));
    fog.near = lerp(fog.near, p.fogNear, 1 - Math.exp(-3 * dt));
    fog.far = lerp(fog.far, p.fogFar, 1 - Math.exp(-3 * dt));
    hemi.color.lerp(color.set(p.hemi[0]), 1 - Math.exp(-3 * dt));
    hemi.groundColor.lerp(color.set(p.hemi[1]), 1 - Math.exp(-3 * dt));
    sun.color.lerp(color.set(p.sun), 1 - Math.exp(-3 * dt));
    // the glow from below fades with height, and comes back as the lava climbs
    const above = Math.max(0, cam.ty - g.lava);
    ember.intensity = lerp(ember.intensity, clamp(0.9 - above / 30, 0.05, 0.9), 1 - Math.exp(-3 * dt));
    ember.position.set(camera.position.x, g.lava - 5, camera.position.z);
    ember.target.position.set(cam.tx, cam.ty, cam.tz);
    // the shaft and the stars: inside the shaft the stars are hidden by the walls anyway
    stars.visible = cam.ty > 55;
    clouds.visible = cam.ty > 70;
  }

  const view: View = {
    gl,
    camera,
    get palette() {
      return pal.palette;
    },
    get zone() {
      return pal.zone;
    },
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.fov = camera.aspect < 0.7 ? 74 : camera.aspect < 1.1 ? 64 : 56;
      camera.updateProjectionMatrix();
    },
    frame(g, focus, dt, clock, split = false) {
      while (soulViews.length < g.souls.length) soulViews.push(makeSoul(g.souls[soulViews.length].color));
      g.souls.forEach((s, i) => syncSoul(g, s, soulViews[i], dt, clock, focus[0] === i && !split, i));
      syncRopes(g, dt);
      syncCamera(g, focus, dt, split);
      syncPalette(g, dt);
      syncLedges(g, dt, clock);
      syncParticles(g, dt, clock);
      if (g.won !== null && !won) {
        won = true;
        bellSwing = 1;
      }
    },
    react(e, g) {
      const soulAt = (i: number) => g.souls[i];
      if (e.t === 'land') {
        const s = soulAt(e.i);
        burst(s.x, s.y + 0.05, s.z, e.hard ? 10 : 5, e.surface === 'ice' ? [0.85, 0.95, 1] : [0.6, 0.55, 0.5], e.hard ? 1.6 : 0.9, 0.09, 0.6);
        if (e.hard) cam.shake = Math.max(cam.shake, 0.7);
      } else if (e.t === 'mantle') {
        const s = soulAt(e.i);
        burst(s.x, s.y + 0.05, s.z, 4, [0.6, 0.55, 0.5], 0.8, 0.08, 0.6);
      } else if (e.t === 'taut') {
        if (e.speed > 3) {
          const a = soulAt(e.i);
          const b = soulAt(e.j);
          burst((a.x + b.x) / 2, (a.y + b.y) / 2 + 0.3, (a.z + b.z) / 2, 5, [1, 0.85, 0.5], 2.2, 0.05, 0.3);
          cam.shake = Math.max(cam.shake, Math.min(0.6, e.speed / 20));
        }
      } else if (e.t === 'yank') cam.shake = Math.max(cam.shake, Math.min(0.8, 0.3 + e.speed / 20));
      else if (e.t === 'crumble' && e.phase === 'fall') {
        const c = crumblies.find((x) => x.p.id === e.id);
        if (c) {
          for (let i = 0; i < 6; i++) {
            const mesh = new THREE.Mesh(geo.box, coreMat);
            const a = c.p.a + (Math.random() - 0.5) * c.p.span * 2;
            const r = c.p.r0 + Math.random() * (c.p.r1 - c.p.r0);
            mesh.position.set(Math.cos(a) * r, c.p.y - 0.2, Math.sin(a) * r);
            mesh.scale.set(0.2 + Math.random() * 0.3, 0.15 + Math.random() * 0.2, 0.2 + Math.random() * 0.3);
            scene.add(mesh);
            c.debris.push({ mesh, vx: (Math.random() - 0.5) * 1.5, vy: -1 - Math.random() * 2, vz: (Math.random() - 0.5) * 1.5, rx: (Math.random() - 0.5) * 6, rz: (Math.random() - 0.5) * 6, life: 2.2 });
          }
          burst(Math.cos(c.p.a) * ((c.p.r0 + c.p.r1) / 2), c.p.y - 0.2, Math.sin(c.p.a) * ((c.p.r0 + c.p.r1) / 2), 8, [0.5, 0.48, 0.45], 1.2, 0.12, -0.4);
        }
      } else if (e.t === 'spring') {
        const s = soulAt(e.i);
        const sp = springs.find((x) => x.p.id === s.ground) ?? springs.reduce<Spring | null>((best, x) => (!best || Math.hypot(Math.cos(x.p.a) * ((x.p.r0 + x.p.r1) / 2) - s.x, x.p.y - s.y, Math.sin(x.p.a) * ((x.p.r0 + x.p.r1) / 2) - s.z) < 3 ? x : best), null);
        if (sp) sp.squash = 1;
        burst(s.x, s.y, s.z, 6, [1, 0.8, 0.3], 1.5, 0.07, 0.5);
      } else if (e.t === 'checkpoint') {
        const s = soulAt(e.i);
        const glow = hexToRgb(ZONES[zoneIndex(s.y)].palette.glow);
        burst(s.x, s.y + 1, s.z, 14, glow, 2.5, 0.07, 1);
      } else if (e.t === 'burn') {
        const s = soulAt(e.i);
        burst(s.x, s.y + 0.3, s.z, 16, [0.25, 0.22, 0.2], 2.2, 0.1, 1.2);
        burst(s.x, s.y, s.z, 10, [1, 0.5, 0.15], 3, 0.12, 1.5);
        cam.shake = Math.max(cam.shake, 0.9);
      } else if (e.t === 'win') {
        const s = g.souls[0];
        for (let i = 0; i < 3; i++) burst(s.x, s.y + 1.5 + i, s.z, 14, [1, 0.9, 0.6], 3, 0.08, 1.4);
        won = true;
        bellSwing = 1;
      } else if (e.t === 'respawn') {
        for (const s of g.souls) burst(s.x, s.y + 0.5, s.z, 8, [0.8, 0.9, 1], 1.5, 0.08, 1);
      }
    },
    project(x, y, z, w, h) {
      v3.set(x, y, z).project(camera);
      if (v3.z > 1) return null;
      return { x: ((v3.x + 1) / 2) * w, y: ((1 - v3.y) / 2) * h };
    },
    tagOf(idx, w, h) {
      const sv = soulViews[idx];
      if (!sv || !sv.root.visible) return null;
      return view.project(sv.root.position.x, sv.root.position.y + 1.75, sv.root.position.z, w, h);
    },
    render() {
      if (gl.lost()) return;
      gl.renderer.render(scene, camera);
    },
    dispose() {
      for (const c of crumblies) for (const d of c.debris) scene.remove(d.mesh);
      disposeTree(scene);
      for (const d of disposables) d.dispose();
      sun.dispose();
      hemi.dispose();
      ember.dispose();
      gl.dispose();
    },
  };
  return view;
}
