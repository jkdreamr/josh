// three.js view of a climb: the tower and its six circles, the souls, the chain, the lava and the weather. It reads
// a Game every frame and never changes it.
import type { Dress, Frame, Geo, Mats } from './decor';
import { DRESSERS } from './decor/index';
import { geometryOf, hexToRgb, mixHex, scatter, sector, shade, tri, vary, type RGB, type Three } from './dress';
import type { T } from './gl';
import { clamp, createGL, damp, disposeTree, lerp, type GL } from './gl';
import { CHAIN_L, DIR, LAVA_Y, R_CORE, R_FLOOR, R_MAX, TOP, ZONES, pose, zoneIndex, type Level, type Palette, type Platform, type ZoneId } from './level';
import { crumbleState, liveOf, renderAlpha, renderTime, windAt, type CrumbleState, type Ev, type Game, type Soul } from './logic';

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
// the palette at a height (the geometry and colour helpers live in dress.ts)

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

/** A deterministic 0..1 from two integers, for brick bonds and plate patterns. */
function hash2(i: number, j: number) {
  let h = (Math.imul(i | 0, 374761393) + Math.imul(j | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The core wall's colouring per circle: called per block of the brick bond with the height, the angle, the course
 * row, the block column and that block's hash, and returns a colour or null for the default masonry. Circle work
 * can fill in its own entry (hot seams in the pit, plates in the forge, ice layers in the frost, flutes above 98 m).
 */
export type WallFn = (y: number, a: number, row: number, col: number, h: number, core: RGB) => RGB | null;
export const WALLS: Partial<Record<ZoneId, WallFn>> = {
  pit: (y, _a, _row, _col, h, core) => (y < 8 && h > 0.9 ? [core[0] * 0.4 + 1 * 0.6, core[1] * 0.4 + 0.42 * 0.6, core[2] * 0.4 + 0.16 * 0.6] : null),
};
/** The default masonry: brick bond blocks on palette.core, with a darker mortar course every fifth row. */
function wallColor(zone: ZoneId, y: number, a: number, row: number, col: number, core: RGB): RGB {
  const h = hash2(row, col);
  const own = WALLS[zone]?.(y, a, row, col, h, core);
  if (own) return own;
  const k = (0.78 + h * 0.42) * (row % 5 === 0 ? 0.7 : 1);
  return [core[0] * k, core[1] * k, core[2] * k];
}

type ParticleKind = 'ember' | 'ash' | 'spark' | 'snow' | 'mote' | 'stardust';
type Particles = {
  mesh: T.InstancedMesh;
  pos: Float32Array;
  vel: Float32Array;
  life: Float32Array;
  /** The life each particle was born with, for the fade in. */
  life0: Float32Array;
  /** Per particle size factor. */
  sz: Float32Array;
  n: number;
  /** Which circle this weather belongs to. */
  zone: number;
  size: number;
  kind: ParticleKind;
  /** Per instance colours picked at spawn, when the kind has a ramp. */
  ramp: T.Color[] | null;
  rampW: number[] | null;
};

type Puff = {
  life: number;
  /** Seconds the puff lives for. */
  dur: number;
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  size: number;
  /** Size at the end as a multiple of the start. */
  grow: number;
  grav: number;
  drag: number;
  r: number;
  g: number;
  b: number;
};
type PuffOpts = { grav?: number; drag?: number; dur?: number; grow?: number };
type Ring = { life: number; dur: number; x: number; y: number; z: number; from: number; to: number; r: number; g: number; b: number };

type SoulView = {
  root: T.Group;
  body: T.Group;
  cloak: T.Mesh;
  head: T.Mesh;
  eyes: T.Mesh[];
  eyeMat: T.MeshBasicMaterial;
  /** This soul's own materials, faded when it is a rival (mats.chain and mats.darkIron are shared). */
  cloakMat: T.MeshLambertMaterial;
  darkMat: T.MeshLambertMaterial;
  skinMat: T.MeshLambertMaterial;
  arms: [T.Group, T.Group];
  legs: [T.Group, T.Group];
  shackle: T.Object3D;
  lantern: T.Mesh;
  lanternMat: T.MeshBasicMaterial;
  halo: T.Mesh;
  haloMat: T.MeshBasicMaterial;
  /** The contact shadow and the two discs of lantern light on the ground under the soul. */
  shadow: T.Mesh;
  shadowMat: T.MeshBasicMaterial;
  poolIn: T.Mesh;
  poolOut: T.Mesh;
  poolMat: T.MeshBasicMaterial;
  poolOutMat: T.MeshBasicMaterial;
  color: T.Color;
  stride: number;
  lean: number;
  flail: number;
  burnScale: number;
  /** A visual offset that eases away after a mantle, so the step up onto a ledge does not pop. */
  ox: number;
  oy: number;
  oz: number;
  /** 0 for a soul on the viewer's team, 1 for a rival drawn as a shade. */
  ghost: number;
  /** Time since the last puff of ice spray while sliding. */
  slideT: number;
  /** Where the soul was drawn last frame, for the lantern's swing. */
  pvx: number;
  pvz: number;
  pspeed: number;
  lanternA: number;
  lanternV: number;
  idleFor: number;
  headGroup: T.Group;
  lanternGroup: T.Group;
  flame: T.Mesh;
  feet: [T.Mesh, T.Mesh];
  /** Which way the chain pulls at this soul's ankle (world space), set by syncRopes, zero when slack. */
  pullX: number;
  pullY: number;
  pullZ: number;
  hangTilt: number;
  /** The time the soul burned, for the burn beat, or -1. */
  burnAt: number;
  lanternFree: boolean;
  lanternVy: number;
};

/** A verlet rope between two shackles. `held` is set every frame its pair still exists. */
type Rope = { points: Float32Array; prev: Float32Array; n: number; held: boolean; i: number; j: number; twang: number; amp: number; flash: number };

type Beacon = { p: Platform; orb: T.Mesh; orbMat: T.MeshBasicMaterial; ring: T.Mesh; ringMat: T.MeshBasicMaterial; lit: boolean; flare: number };
type Moving = { p: Platform; mesh: T.Object3D; parts?: T.Object3D[] };
type Crumbly = { p: Platform; mesh: T.Mesh; mat: T.MeshLambertMaterial; debris: { mesh: T.Mesh; vx: number; vy: number; vz: number; rx: number; rz: number; life: number }[]; gone: boolean };
type Spring = { p: Platform; pad: T.Mesh; coil: T.Mesh; squash: number };

/** A radial falloff drawn once on a small canvas: white at the centre to black at the rim (alphaMap reads green). */
function softDisc(THREE: Three) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, '#ffffff');
    grad.addColorStop(0.35, '#bfbfbf');
    grad.addColorStop(0.7, '#383838');
    grad.addColorStop(1, '#000000');
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, size, size);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);
  }
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

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
  const geo: Geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    ball: new THREE.SphereGeometry(1, 10, 8),
    cone: new THREE.ConeGeometry(1, 1, 8),
    rod: new THREE.CylinderGeometry(1, 1, 1, 8),
    ring: new THREE.TorusGeometry(1, 0.08, 6, 24),
    link: new THREE.TorusGeometry(0.1, 0.035, 5, 8),
    disc: new THREE.CircleGeometry(1, 32),
    plane: new THREE.PlaneGeometry(1, 1),
    soft: softDisc(THREE),
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
  const mats: Mats = {
    iron: flat('#2b2e36'),
    darkIron: flat('#1b1d23'),
    bone: flat('#d9cfb8'),
    wood: flat('#5a3b26'),
    ice: flat('#d8f1ff', { transparent: true, opacity: 0.86 }),
    gold: flat('#d6a93c'),
    stoneGrey: flat('#6d6a72'),
    debris: flat('#3e3c3b'),
    flame: basic('#ffa24a'),
    flameCore: basic('#fff1c2'),
    ghost: basic('#9df0b2', { transparent: true, opacity: 0.75 }),
    glass: [basic('#d33b3b'), basic('#2f5fd8'), basic('#e2b437'), basic('#3fae6a'), basic('#8a3fd1')],
    vent: basic('#ff8a2a'),
    cloud: flat('#cfd6ff', { transparent: true, opacity: 0.55 }),
    // the far stars are outside the fog, or they would never show
    star: basic('#ffffff', { fog: false, transparent: true }),
    chain: flat('#3a3d46'),
    // the vertex coloured stone of the core and the merged static mesh
    stone: new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }),
  };
  disposables.push(mats.stone);

  // -------------------------------------------------------------------------------------------------------------
  // the tower core, the shaft around it and the sky

  // masonry: a non indexed cylinder so every quad takes one colour, bumped only inward so no vertex passes R_CORE
  const coreTop = TOP + 9;
  const CORE_SEGS = 48;
  const CORE_ROWS = 96;
  const coreH = coreTop + 30;
  const coreGeo = new THREE.CylinderGeometry(R_CORE, R_CORE, coreH, CORE_SEGS, CORE_ROWS, true).toNonIndexed();
  coreGeo.translate(0, coreH / 2 - 30, 0);
  {
    const pos = coreGeo.getAttribute('position') as T.BufferAttribute;
    const col = new Float32Array(pos.count * 3);
    const rowH = coreH / CORE_ROWS;
    const coreOf: RGB[] = [];
    for (let i = 0; i < pos.count; i += 6) {
      // the quad this triangle pair makes: its column round the core and its course row
      let ym = 0;
      let xm = 0;
      let zm = 0;
      for (let j = 0; j < 6; j++) {
        ym += pos.getY(i + j) / 6;
        xm += pos.getX(i + j) / 6;
        zm += pos.getZ(i + j) / 6;
      }
      const a = Math.atan2(zm, xm);
      const colIdx = Math.floor(((a + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2) * CORE_SEGS + 0.5) % CORE_SEGS;
      const row = Math.floor((ym + 30) / 1.6);
      const block = Math.floor((colIdx + (row % 2)) / 2);
      const zi = zoneIndex(ym);
      const core = coreOf[zi] ?? (coreOf[zi] = hexToRgb(ZONES[zi].palette.core));
      const c = wallColor(ZONES[zi].id, ym, a, row, block, core);
      for (let j = 0; j < 6; j++) {
        const k = i + j;
        const x = pos.getX(k);
        const y = pos.getY(k);
        const z = pos.getZ(k);
        const r = Math.hypot(x, z) || 1;
        // the jitter is a function of the vertex's grid corner, so shared corners stay welded
        const ci = Math.round((((Math.atan2(z, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI * 2)) * CORE_SEGS) % CORE_SEGS;
        const ri = Math.round((y + 30) / rowH);
        const nb = hash2(ci, ri);
        const bump = 1 - nb * 0.04;
        pos.setXYZ(k, (x / r) * R_CORE * bump, y + (hash2(ri, ci) - 0.5) * 0.3, (z / r) * R_CORE * bump);
        col[k * 3] = c[0];
        col[k * 3 + 1] = c[1];
        col[k * 3 + 2] = c[2];
      }
    }
    pos.needsUpdate = true;
    coreGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    coreGeo.computeVertexNormals();
  }
  const core = new THREE.Mesh(coreGeo, mats.stone);
  scene.add(core);

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
  // the pillar ends in frame: three stacked drums on top of the core instead of a spire lost in the fog
  {
    const cap = hexToRgb(ZONES[5].palette.core);
    const top = shade(hexToRgb(ZONES[5].palette.stone[0]), 0.9);
    let y = coreTop;
    for (const [r, h] of [
      [3.1, 1.2],
      [2.4, 1.0],
      [1.6, 0.8],
    ]) {
      sector(statics, 0, Math.PI * 2, 0.01, r, y, y + h, top, cap, { inner: false, segs: 32 });
      y += h;
    }
  }
  const movers: Moving[] = [];
  const crumblies: Crumbly[] = [];
  const springs: Spring[] = [];
  const beacons: Beacon[] = [];
  const decor = new THREE.Group();
  scene.add(decor);

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
      const mesh = new THREE.Mesh(geometryOf(THREE, t), mats.stone.clone());
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
      const slab = new THREE.Mesh(geometryOf(THREE, t), mats.stone.clone());
      disposables.push(slab.geometry, slab.material as T.Material);
      const group = new THREE.Group();
      group.add(slab);
      for (const side of [-1, 1]) {
        const rod = new THREE.Mesh(geo.rod, mats.iron);
        // hung from the inner edge, against the core, so nothing stands in the walkway
        const ra = side * p.span * 0.7;
        const rr = p.r0 + 0.14;
        rod.position.set(Math.cos(ra) * rr, 1.1, Math.sin(ra) * rr);
        rod.scale.set(0.05, 2.2, 0.05);
        group.add(rod);
      }
      scene.add(group);
      const railGeo = new THREE.TorusGeometry(p.r0 + 0.14, 0.07, 6, 32, p.span * 2 + p.amp * 2 + 0.3);
      disposables.push(railGeo);
      const rail = new THREE.Mesh(railGeo, mats.iron);
      rail.rotation.x = Math.PI / 2;
      rail.rotation.z = -(p.a - p.span - p.amp - 0.15);
      rail.position.y = p.y + 2.2;
      scene.add(rail);
      for (const side of [-1, 1]) {
        const post = new THREE.Mesh(geo.rod, mats.iron);
        const pa = p.a + side * (p.span + p.amp + 0.12);
        post.position.set(Math.cos(pa) * (p.r0 + 0.14), p.y + 1.1, Math.sin(pa) * (p.r0 + 0.14));
        post.scale.set(0.08, 2.3, 0.08);
        decor.add(post);
      }
      movers.push({ p, mesh: group });
      continue;
    }
    if (p.kind === 'crumble') {
      const t = tri();
      const cracked = shade(light, 0.85);
      sector(t, p.a - p.span, p.a + p.span, p.r0, p.r1, y0, p.y, cracked, shade(dark, 0.85));
      const mat = mats.stone.clone();
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

  // -------------------------------------------------------------------------------------------------------------
  // dressing each circle: one module per circle under decor/, each with its own group, rng and per frame hooks

  const hooks: ((f: Frame) => void)[] = [];
  /** The core wall's surface radius: the masonry never passes R_CORE, so decor sits just proud of it. */
  const coreR = (_y: number) => R_CORE + 0.03;
  const onCore = (a: number, y: number, out = 0) => {
    const r = coreR(y) + out;
    return new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r);
  };
  const track = <X extends T.BufferGeometry | T.Material>(x: X): X => {
    disposables.push(x);
    return x;
  };
  ZONES.forEach((zone, zi) => {
    const group = new THREE.Group();
    scene.add(group);
    const dress: Dress = {
      THREE,
      level,
      zone,
      zi,
      palette: zone.palette,
      platforms: level.platforms.filter((p) => p.zone === zi && p.kind !== 'floor'),
      rng: scatter(101 + zi),
      lite,
      statics,
      group,
      geo,
      mats,
      flat,
      basic,
      track,
      coreR,
      onCore,
      animate: (fn) => {
        hooks.push(fn);
      },
    };
    DRESSERS[zone.id](dress);
  });
  // the static mesh last, so the modules' additions are in it
  const staticMesh = new THREE.Mesh(geometryOf(THREE, statics), mats.stone);
  scene.add(staticMesh);

  // -------------------------------------------------------------------------------------------------------------
  // weather: one instanced mesh per kind, recycled around the camera

  const particleSets: Particles[] = [];
  const makeParticles = (kind: ParticleKind, zone: number, n: number, color: string, size: number, opts: { boxy?: boolean; opacity?: number; ramp?: string[]; rampW?: number[] } = {}) => {
    const opacity = opts.opacity ?? 1;
    const mat = basic(color, { transparent: opacity < 1, opacity, depthWrite: opacity >= 1 });
    const mesh = new THREE.InstancedMesh(opts.boxy ? geo.box : geo.ball, mat, n);
    mesh.frustumCulled = false;
    mesh.count = 0;
    scene.add(mesh);
    const set: Particles = {
      mesh,
      pos: new Float32Array(n * 3),
      vel: new Float32Array(n * 3),
      life: new Float32Array(n),
      life0: new Float32Array(n),
      sz: new Float32Array(n),
      n,
      zone,
      size,
      kind,
      ramp: opts.ramp ? opts.ramp.map((c) => new THREE.Color(c)) : null,
      rampW: opts.rampW ?? null,
    };
    for (let i = 0; i < n; i++) set.life[i] = -1;
    // the instance colour buffer exists from the start, so the per frame loop never allocates it
    if (set.ramp) {
      for (let i = 0; i < n; i++) mesh.setColorAt(i, set.ramp[0]);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    particleSets.push(set);
  };
  const scaleP = lite ? 0.55 : 1;
  makeParticles('ember', 0, lite ? 90 : 160, '#ffffff', 0.022, { ramp: ['#ff5a1a', '#ff9a3a', '#ffd27a'] });
  makeParticles('ash', 1, Math.round(120 * scaleP), '#b4b7bf', 0.035, { boxy: true, opacity: 0.5 });
  makeParticles('spark', 2, Math.round(70 * scaleP), '#ffd27a', 0.028);
  makeParticles('snow', 3, Math.round(200 * scaleP), '#eaf6ff', 0.02, { opacity: 0.85 });
  makeParticles('mote', 4, Math.round(110 * scaleP), '#ffffff', 0.03, { opacity: 0.55, ramp: ['#fff1d6', '#ffe2a8', '#ffd27a', '#d33b3b', '#2f5fd8', '#e2b437', '#3fae6a'], rampW: [0.25, 0.25, 0.25, 0.0625, 0.0625, 0.0625, 0.0625] });
  makeParticles('stardust', 5, Math.round(140 * scaleP), '#eef2ff', 0.026, { opacity: 0.9 });

  // dust and sparks that burst from events: they fade by taking the fog's colour, not by alpha
  const PUFFS = 96;
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false });
  const puffMesh = new THREE.InstancedMesh(geo.ball, puffMat, PUFFS);
  disposables.push(puffMat);
  puffMesh.frustumCulled = false;
  puffMesh.count = 0;
  scene.add(puffMesh);
  const puffs: Puff[] = [];
  const burst = (x: number, y: number, z: number, n: number, color: [number, number, number], speed: number, size: number, up = 1, o: PuffOpts = {}) => {
    const grav = o.grav ?? 0;
    const drag = o.drag ?? 3;
    const dur = o.dur ?? 0.7;
    const grow = o.grow ?? 2.4;
    for (let i = 0; i < n; i++) {
      if (puffs.length >= PUFFS) puffs.shift();
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      puffs.push({ life: 1, dur, x, y, z, vx: Math.cos(a) * s, vy: up * s * (0.4 + Math.random() * 0.8), vz: Math.sin(a) * s, size: size * (0.6 + Math.random() * 0.8), grow, grav, drag, r: color[0], g: color[1], b: color[2] });
    }
  };
  /** Sparks: fast, heavy, short lived and shrinking. */
  const SPARK: PuffOpts = { grav: 9, drag: 0.5, dur: 0.45, grow: 0.2 };
  // impact rings on the ground
  const RINGS = 12;
  const ringMat = basic('#ffffff', { transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const ringMesh = new THREE.InstancedMesh(geo.ring, ringMat, RINGS);
  ringMesh.frustumCulled = false;
  ringMesh.count = 0;
  scene.add(ringMesh);
  const rings: Ring[] = [];
  const ringAt = (x: number, y: number, z: number, to: number, color: [number, number, number], dur = 0.35, from = 0.3) => {
    if (rings.length >= RINGS) rings.shift();
    rings.push({ life: 1, dur, x, y, z, from, to, r: color[0], g: color[1], b: color[2] });
  };
  /** The dust a surface gives off in a circle: ash in the catacombs, stone dust elsewhere. */
  const DUST_STONE: [number, number, number] = [0.45, 0.44, 0.42];
  const DUST_ASH: [number, number, number] = [0.58, 0.58, 0.56];
  const DUST_ICE: [number, number, number] = [0.85, 0.95, 1];
  const SPARK_C: [number, number, number] = [1, 0.8, 0.4];
  const dustOf = (y: number) => (zoneIndex(y) === 1 ? DUST_ASH : DUST_STONE);
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
    // transparent from the start, so fading a rival into a shade never switches materials
    const cloakMat = flat(c.getHex(), { transparent: true });
    const darkMat = flat(c.clone().multiplyScalar(0.55).getHex(), { transparent: true });
    const skin = flat('#f1e4d2', { transparent: true });
    const cloak = new THREE.Mesh(geo.cone, cloakMat);
    cloak.position.y = 0.42;
    cloak.scale.set(0.34, 0.84, 0.34);
    // the head, hood and eyes turn together, so the soul can look about
    const headGroup = new THREE.Group();
    headGroup.position.set(0.02, 0.98, 0);
    const head = new THREE.Mesh(geo.ball, skin);
    head.scale.setScalar(0.2);
    const hood = new THREE.Mesh(geo.ball, cloakMat);
    hood.position.set(-0.07, 0.04, 0);
    hood.scale.set(0.24, 0.26, 0.26);
    const eyeMat = basic('#fff1b8');
    const eyes = [-1, 1].map((side) => {
      const e = new THREE.Mesh(geo.ball, eyeMat);
      e.position.set(0.17, 0.02, side * 0.07);
      e.scale.setScalar(0.035);
      return e;
    });
    headGroup.add(head, hood, ...eyes);
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
    const feet: T.Mesh[] = [];
    const legs = [-1, 1].map((side) => {
      const g = new THREE.Group();
      g.position.set(0, 0.3, side * 0.1);
      const leg = new THREE.Mesh(geo.box, darkMat);
      leg.position.y = -0.14;
      leg.scale.set(0.1, 0.3, 0.1);
      const foot = new THREE.Mesh(geo.box, darkMat);
      foot.position.set(0.03, -0.285, 0);
      foot.scale.set(0.14, 0.05, 0.09);
      feet.push(foot);
      g.add(leg, foot);
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
    // a caged lantern swinging from the right hand: a rod, two crossed rings, a glowing ball and a flame
    const lanternGroup = new THREE.Group();
    lanternGroup.position.set(0.08, -0.42, 0);
    const lanternMat = basic(c.clone().lerp(new THREE.Color('#ffd9a0'), 0.6).getHex());
    const rod = new THREE.Mesh(geo.rod, mats.darkIron);
    rod.position.y = -0.08;
    rod.scale.set(0.012, 0.16, 0.012);
    const lantern = new THREE.Mesh(geo.ball, lanternMat);
    lantern.position.y = -0.2;
    lantern.scale.setScalar(0.055);
    const cageA = new THREE.Mesh(geo.ring, mats.darkIron);
    cageA.position.y = -0.2;
    cageA.scale.setScalar(0.09);
    const cageB = new THREE.Mesh(geo.ring, mats.darkIron);
    cageB.position.y = -0.2;
    cageB.rotation.y = Math.PI / 2;
    cageB.scale.setScalar(0.09);
    const flame = new THREE.Mesh(geo.cone, mats.flameCore);
    flame.position.y = -0.17;
    flame.scale.set(0.03, 0.08, 0.03);
    lanternGroup.add(rod, lantern, cageA, cageB, flame);
    arms[1].add(lanternGroup);
    body.add(cloak, headGroup);
    // a halo over the soul being steered
    const haloMat = basic('#ffffff', { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const halo = new THREE.Mesh(geo.ring, haloMat);
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 1.45;
    halo.scale.setScalar(0.28);
    root.add(halo);
    // on the ground: a contact shadow and two discs of warm lantern light, soft edged by the pair
    const shadowMat = basic('#120806', { transparent: true, opacity: 0.42, depthWrite: false, alphaMap: geo.soft });
    const shadow = new THREE.Mesh(geo.disc, shadowMat);
    shadow.rotation.x = -Math.PI / 2;
    const poolMat = basic('#ffb46a', { transparent: true, opacity: 0.3, depthWrite: false, alphaMap: geo.soft });
    const poolOutMat = basic('#ffb46a', { transparent: true, opacity: 0.10, depthWrite: false, alphaMap: geo.soft });
    const poolIn = new THREE.Mesh(geo.disc, poolMat);
    poolIn.rotation.x = -Math.PI / 2;
    const poolOut = new THREE.Mesh(geo.disc, poolOutMat);
    poolOut.rotation.x = -Math.PI / 2;
    scene.add(shadow, poolIn, poolOut, root);
    return {
      root,
      body,
      cloak,
      head,
      eyes,
      eyeMat,
      cloakMat,
      darkMat,
      skinMat: skin,
      arms,
      legs,
      shackle,
      lantern,
      lanternMat,
      halo,
      haloMat,
      shadow,
      shadowMat,
      poolIn,
      poolOut,
      poolMat,
      poolOutMat,
      color: c,
      stride: 0,
      lean: 0,
      flail: 0,
      burnScale: 1,
      ghost: 0,
      ox: 0,
      oy: 0,
      oz: 0,
      slideT: 0,
      pvx: 0,
      pvz: 0,
      pspeed: 0,
      lanternA: 0,
      lanternV: 0,
      idleFor: 0,
      headGroup,
      lanternGroup,
      flame,
      feet: feet as [T.Mesh, T.Mesh],
      pullX: 0,
      pullY: 0,
      pullZ: 0,
      hangTilt: 0,
      burnAt: -1,
      lanternFree: false,
      lanternVy: 0,
    };
  };

  // the chain: interlocking links at a fixed pitch along a verlet rope between two shackles
  const ROPE_N = 24;
  const PITCH = 0.19;
  const LINKS_PER = Math.ceil(CHAIN_L / PITCH) + 1;
  /** One rope per pair of neighbours on a chain, keyed `${team}:${k}`. */
  const ropes = new Map<string, Rope>();
  const LINKS_MAX = 3 * LINKS_PER;
  const linkMesh = new THREE.InstancedMesh(geo.link, mats.chain, LINKS_MAX);
  linkMesh.frustumCulled = false;
  linkMesh.count = 0;
  scene.add(linkMesh);
  const white = new THREE.Color('#ffffff');
  const chainHot = new THREE.Color(3.4, 1.5, 0.5);
  for (let i = 0; i < LINKS_MAX; i++) linkMesh.setColorAt(i, white);
  if (linkMesh.instanceColor) linkMesh.instanceColor.needsUpdate = true;
  /** The chain's iron per circle: lighter where the core is dark, bluer in the frost. */
  const CHAIN_BY_ZONE = ['#3a3d46', '#575a62', '#3a3d46', '#6b7886', '#3d3e52', '#3a3d46'].map((h) => new THREE.Color(h));
  const chainFlash = new THREE.Color('#9ea4b3');
  /** The lantern pool's colour per circle: the glow warmed, and paled in the bright circles. */
  const POOL_BY_ZONE = ZONES.map((z, i) => {
    const c = new THREE.Color(mixHex(z.palette.glow, '#ffb46a', 0.5));
    if (i === 3 || i === 5) c.lerp(white, 0.5);
    return c;
  });

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
  const eyeWarm = new THREE.Color('#fff1b8');
  const eyeCool = new THREE.Color('#cfd6ff');
  /** The camera: its orbit (a, r, y), its target, and the ground height it holds its vertical to. */
  const cam = { a: 0, r: 0, y: 0, tx: 0, ty: 0, tz: 0, gy: 0, dist: 9.5, shake: 0, thump: 0, roll: 0, init: false, fallDip: 0 };
  let pal = paletteAt(0);
  let won = false;
  let winAt = -1;
  let winTeam = -1;
  let winWave = 0;
  let burnFlashAt = -1;
  let camZone = 0;
  /** How far between the last two substeps this frame falls, and the sim time to pose movers at. */
  let al = 1;
  let rtime = 0;
  const poseQ = { a: 0, y: 0, va: 0, vy: 0 };

  const groundUnder = (g: Game, x: number, y: number, z: number): number => {
    let best = -Infinity;
    const a = Math.atan2(z, x);
    const r = Math.hypot(x, z);
    for (const p of g.level.platforms) {
      if (p.y - p.amp > y + 0.1) continue;
      const q = pose(p, rtime, poseQ);
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

  /** The chain neighbour nearest to a soul that is still climbing, or null. */
  const nearestNeighbour = (g: Game, s: Soul): Soul | null => {
    const chain = g.chains[s.team];
    if (!chain) return null;
    const k = chain.indexOf(s.idx);
    let best: Soul | null = null;
    let bd = Infinity;
    for (const j of [k - 1, k + 1]) {
      if (j < 0 || j >= chain.length) continue;
      const o = g.souls[chain[j]];
      if (!o || o.burned >= 0) continue;
      const d = Math.hypot(o.x - s.x, o.z - s.z);
      if (d < bd) {
        bd = d;
        best = o;
      }
    }
    return best;
  };

  function syncSoul(g: Game, s: Soul, sv: SoulView, dt: number, clock: number, lead: boolean, rival: boolean, idx: number) {
    const burned = s.burned >= 0;
    if (!burned) sv.burnAt = -1;
    else if (sv.burnAt < 0) sv.burnAt = clock;
    const burnT = burned ? clock - sv.burnAt : 0;
    // drawn between the last two substeps
    const ix = lerp(s.rx, s.x, al);
    const iy = lerp(s.ry, s.y, al);
    const iz = lerp(s.rz, s.z, al);
    // a rival fades toward a shade: translucent, cool eyed, with a dimmer lantern
    sv.ghost = damp(sv.ghost, rival ? 1 : 0, 6, dt);
    const ghost = sv.ghost > 0.01 ? sv.ghost : 0;
    const fade = 1 - 0.42 * ghost;
    sv.cloakMat.opacity = fade;
    sv.darkMat.opacity = fade;
    sv.skinMat.opacity = fade;
    // the burn beat: the soul scorches over 0.6 s, sinks for 1.1 s, then is gone
    const scorch = burned ? clamp(burnT / 0.6, 0, 1) : 0;
    sv.cloakMat.color.copy(sv.color).lerp(color.set('#1a0c08'), scorch);
    sv.darkMat.color.copy(sv.color).multiplyScalar(0.55).lerp(color, scorch);
    sv.skinMat.color.set('#f1e4d2').lerp(color, scorch);
    sv.eyeMat.color.copy(eyeWarm).lerp(eyeCool, ghost);
    if (burned) sv.eyeMat.color.lerp(color.set('#ff6a1a'), clamp(burnT / 0.3, 0, 1)).multiplyScalar(clamp(1.1 - burnT, 0, 1));
    sv.burnScale = damp(sv.burnScale, burned && burnT > 1.1 ? 0 : 1, 10, dt);
    sv.root.visible = sv.burnScale > 0.02;
    const speed = Math.hypot(s.vx, s.vz);
    const ease = Math.exp(-13 * dt);
    sv.ox *= ease;
    sv.oy *= ease;
    sv.oz *= ease;
    // the win beat: the winners hop on the spot for four seconds
    const winner = winAt >= 0 && s.team === winTeam && !burned;
    const winT = winner ? clock - winAt : 99;
    const hop = winT < 4 ? 0.25 * Math.max(0, Math.sin(((winT % 0.7) / 0.7) * Math.PI)) : 0;
    const sink = burned ? -1.0 * Math.pow(clamp(burnT / 1.1, 0, 1), 1.5) : 0;
    sv.root.position.set(ix + sv.ox, iy + sv.oy + hop + sink, iz + sv.oz);
    sv.root.rotation.y = -s.face;
    // forward speed, for the lantern's swing
    const fwd = s.vx * Math.cos(s.face) + s.vz * Math.sin(s.face);
    const accel = dt > 0 ? clamp((fwd - sv.pspeed) / dt, -40, 40) : 0;
    sv.pspeed = fwd;
    // squash on landing, stretch in the air, a hip bob in the run
    const run = clamp(speed / 3, 0, 1);
    const sq = s.grounded ? 1 - s.squash * 0.28 + Math.abs(Math.sin(sv.stride * 2)) * 0.03 * run : 1 + clamp(Math.abs(s.vy) * 0.012, 0, 0.14);
    const idle = s.grounded && speed < 0.5 && !s.hanging;
    sv.idleFor = idle ? sv.idleFor + dt : 0;
    const breathe = idle ? 1 + Math.sin(clock * 2.2 + idx) * 0.015 : 1;
    const pinch = burned ? lerp(1, 0.7, clamp((burnT - 0.8) / 0.3, 0, 1)) : 1;
    const xz = (1 / Math.sqrt(sq)) * sv.burnScale * pinch;
    sv.body.scale.set(xz, sq * breathe * sv.burnScale, xz);
    sv.body.position.y = s.grounded ? Math.abs(Math.sin(sv.stride * 2)) * 0.045 * run : 0;
    const wander = sv.idleFor > 2 ? Math.sin(clock * 0.6 + idx) * 0.03 : 0;
    sv.body.rotation.y = Math.sin(sv.stride) * 0.06 * clamp(speed / 4, 0, 1) + wander;
    // a partner braces when its neighbour hangs from the chain
    const nb = nearestNeighbour(g, s);
    const braced = s.grounded && !!nb && nb.hanging;
    if (!braced) sv.stride += dt * (s.grounded ? speed * 1.9 : 1.5);
    const swing = s.grounded && !braced ? Math.sin(sv.stride) * clamp(speed / 4, 0, 1) * 0.8 : 0;
    // the chain's pull at the ankle, in body space (the body faces +x)
    const cf = Math.cos(s.face);
    const sf = Math.sin(s.face);
    const pullLx = sv.pullX * cf + sv.pullZ * sf;
    const pullLz = -sv.pullX * sf + sv.pullZ * cf;
    const hanging = s.hanging && !s.grounded;
    sv.hangTilt = damp(sv.hangTilt, hanging ? 1 : 0, hanging ? 5 : 8, dt);
    const sway = Math.sin(clock * 2 + idx) * 0.1 * clamp(1 - speed / 6, 0, 1) * sv.hangTilt;
    // legs: run, tuck in the air, dangle when hanging, with the forward knee lifted
    const tuck = !s.grounded ? (hanging ? 0.15 : s.vy > 0 ? -0.5 : 0.35) : 0;
    const dangle = sv.hangTilt;
    sv.legs[0].rotation.z = lerp(swing + tuck, -0.3, dangle);
    sv.legs[1].rotation.z = lerp(-swing + tuck * 0.6, 0.5 + 0.15 * Math.sin(clock * 2.3 + idx), dangle);
    const lift0 = s.grounded ? 1 - 0.25 * Math.max(0, Math.sin(sv.stride)) * run : 1;
    const lift1 = s.grounded ? 1 - 0.25 * Math.max(0, -Math.sin(sv.stride)) * run : 1;
    sv.legs[0].scale.y = lift0;
    sv.legs[1].scale.y = lift1;
    // arms: counter swing, up in the air, toward the chain when hanging, flailing in a long fall, waving at the win
    sv.flail = damp(sv.flail, (!s.grounded && s.vy < -9) || (burned && burnT < 0.8) ? 1 : 0, 6, dt);
    let reach = hanging ? 2.3 : !s.grounded ? (s.vy > 0 ? 2.2 : 1.4) : 0;
    if (burned) reach = 2.8;
    const f = sv.flail * Math.sin(clock * 24 + idx) * 0.6;
    const wave = winT < 4 ? Math.sin(clock * 6) * 0.5 : 0;
    const armA = winT < 4 ? 2.6 + wave : braced ? -0.4 : -swing * 0.9 + reach + f + 0.3 * dangle;
    const armB = winT < 4 ? 2.6 - wave : braced ? -0.4 : swing * 0.9 + reach * (hanging ? 1 : 0.6) - f - 0.3 * dangle;
    sv.arms[0].rotation.z = damp(sv.arms[0].rotation.z, armA, 10, dt);
    sv.arms[1].rotation.z = damp(sv.arms[1].rotation.z, armB, 10, dt);
    sv.arms[0].rotation.x = hanging ? Math.sin(clock * 3 + idx) * 0.1 : 0;
    // lean into the run, tilt toward the rope when hanging, lean against the pull when bracing
    sv.lean = damp(sv.lean, s.grounded && !braced ? clamp(speed / 6, 0, 1) * 0.18 : 0, 8, dt);
    const tiltZ = -clamp(pullLx * 0.85, -0.85, 0.85) * sv.hangTilt + sway;
    const tiltX = clamp(pullLz * 0.85, -0.85, 0.85) * sv.hangTilt;
    const brace = braced ? clamp(pullLx, -1, 1) * 0.22 : 0;
    sv.body.rotation.z = damp(sv.body.rotation.z, -sv.lean + tiltZ + brace, 8, dt);
    sv.body.rotation.x = damp(sv.body.rotation.x, tiltX, 8, dt);
    // the head: looks at the nearest partner when idle or hanging, up and down with a jump, about when bored
    let yaw = 0;
    if (nb && (idle || hanging)) {
      const dx = nb.x - ix;
      const dz = nb.z - iz;
      const lx = dx * cf + dz * sf;
      const lz = -dx * sf + dz * cf;
      yaw = clamp(Math.atan2(-lz, lx), -0.75, 0.75);
    } else if (sv.idleFor > 2) yaw = Math.sin(clock * 0.45 + idx * 2.1) * 0.3;
    sv.headGroup.rotation.y = damp(sv.headGroup.rotation.y, yaw, 6, dt);
    const pitch = !s.grounded && !hanging ? clamp(s.vy * 0.035, -0.35, 0.3) : winT < 4 ? 0.3 : 0;
    sv.headGroup.rotation.z = damp(sv.headGroup.rotation.z, pitch, 6, dt);
    // the cloak balloons in a fall, pulls in on the way up, overshoots on landing and flutters in the run
    let bell = s.vy < 0 ? 1 + 0.3 * clamp(-s.vy / 12, 0, 1) : 1 - 0.1 * clamp(s.vy / 10, 0, 1);
    if (s.grounded) bell = 1 + 0.35 * s.squash + Math.sin(sv.stride * 2) * 0.02 * clamp(speed / 6, 0, 1);
    sv.cloak.scale.set(0.34 * bell, 0.84, 0.34 * bell);
    // eyes blink now and then
    const blink = Math.sin(clock * 1.7 + idx * 1.3) > 0.985;
    for (const e of sv.eyes) e.scale.set(0.035, blink ? 0.006 : 0.035, 0.035);
    // the lantern swings as a pendulum from the hand, and its flame flickers; at the burn it is let go
    if (burned && !sv.lanternFree) {
      sv.lanternFree = true;
      sv.lanternVy = 4;
    }
    if (!burned && sv.lanternFree) {
      sv.lanternFree = false;
      sv.lanternGroup.position.set(0.08, -0.42, 0);
      sv.lanternA = 0;
      sv.lanternV = 0;
    }
    if (sv.lanternFree) {
      sv.lanternVy -= 12 * dt;
      sv.lanternGroup.position.y += sv.lanternVy * dt;
    } else {
      sv.lanternV += (-accel * 0.03 - sv.lanternA * 28 - sv.lanternV * 5) * dt;
      sv.lanternA = clamp(sv.lanternA + sv.lanternV * dt, -0.9, 0.9);
    }
    sv.lanternGroup.rotation.z = sv.lanternA + (!s.grounded ? clamp(-s.vy * 0.02, -0.3, 0.3) : 0);
    const flick = 0.8 + 0.3 * Math.abs(Math.sin(clock * 17 + idx * 3)) + 0.1 * Math.sin(clock * 41 + idx);
    sv.flame.scale.set(0.03, 0.08 * flick, 0.03);
    sv.lanternMat.color.copy(sv.color).lerp(color.set('#ffd9a0'), 0.6 + Math.sin(clock * 5 + idx) * 0.08).multiplyScalar(1 - 0.45 * ghost);
    // the halo for the steered soul, only when more than one soul here is a person's (never on a rival)
    let humans = 0;
    for (const x of g.souls) if (x.kind === 'local' && x.driver === 'human') humans++;
    const steered = (lead && !rival && humans > 1) || winT < 4;
    sv.haloMat.opacity = damp(sv.haloMat.opacity, steered ? 0.75 : 0, 8, dt);
    sv.halo.rotation.x = Math.PI / 2 + 0.14 * Math.sin(clock * 1.3 + idx);
    sv.halo.rotation.z = 0.14 * Math.sin(clock * 0.9);
    sv.halo.position.y = 1.45 + 0.03 * Math.sin(clock * 2);
    sv.halo.scale.setScalar(0.28);
    // on the ground under the soul: a contact shadow and the lantern's warm pool
    const gy = groundUnder(g, ix, iy, iz);
    const shown = sv.root.visible && Number.isFinite(gy) && gy > g.lava;
    sv.shadow.visible = shown;
    sv.poolIn.visible = shown;
    sv.poolOut.visible = shown;
    if (shown) {
      const h = clamp(iy - gy, 0, 9);
      const k = sv.burnScale * (1 - 0.6 * ghost);
      sv.shadow.position.set(ix, gy + 0.015, iz);
      sv.shadow.scale.setScalar(0.38 * clamp(1 - h / 7, 0.35, 1));
      sv.shadowMat.opacity = 0.45 * clamp(1 - h / 9, 0.3, 1) * k;
      const zi = zoneIndex(iy);
      const pale = zi === 3 || zi === 5;
      sv.poolMat.color.lerp(POOL_BY_ZONE[zi], 1 - Math.exp(-3 * dt));
      sv.poolOutMat.color.copy(sv.poolMat.color);
      const flicker = 0.03 * Math.sin(clock * 13 + idx);
      sv.poolIn.position.set(ix, gy + 0.02, iz);
      sv.poolOut.position.set(ix, gy + 0.025, iz);
      sv.poolIn.scale.setScalar(0.45 + h * 0.06);
      sv.poolOut.scale.setScalar(0.85 + h * 0.06);
      sv.poolMat.opacity = Math.min(pale ? 0.24 : 1, 0.36 + flicker) * k;
      sv.poolOutMat.opacity = Math.min(pale ? 0.2 : 1, 0.14 + flicker * 0.5) * k;
    }
    // spray behind a soul sliding on ice
    const sliding = s.grounded && s.surface === 'ice' && speed > 2.5 && s.input.side === 0 && s.input.fwd === 0;
    sv.slideT = sliding ? sv.slideT + dt : 0;
    if (sv.slideT > 0.08) {
      sv.slideT = 0;
      burst(ix - (s.vx / speed) * 0.2, iy + 0.03, iz - (s.vz / speed) * 0.2, 1, DUST_ICE, 0.6, 0.04, 0.3, { dur: 0.5 });
    }
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
    const minD = seg * 0.6;
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 0; i < n - 1; i++) {
        const i3 = i * 3;
        const j3 = i3 + 3;
        const dx = p[j3] - p[i3];
        const dy = p[j3 + 1] - p[i3 + 1];
        const dz = p[j3 + 2] - p[i3 + 2];
        const d = Math.hypot(dx, dy, dz) || 1e-6;
        // links never stretch, and slack piles up rather than folding onto itself
        if (d <= seg && d >= minD) continue;
        const k = (d - (d > seg ? seg : minD)) / d;
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
      // keep the rope out of the core and off the tops of ledges it hangs over, and let it lie still there
      for (let i = 1; i < n - 1; i++) {
        const i3 = i * 3;
        const r = Math.hypot(p[i3], p[i3 + 2]);
        if (r < R_CORE + 0.12) {
          const k = (R_CORE + 0.12) / r;
          p[i3] *= k;
          p[i3 + 2] *= k;
        }
        const gy = groundUnder(g, p[i3], p[i3 + 1] + 0.3, p[i3 + 2]);
        if (Number.isFinite(gy) && p[i3 + 1] < gy + 0.1 && p[i3 + 1] > gy - 0.5) {
          p[i3 + 1] = gy + 0.1;
          q[i3] += (p[i3] - q[i3]) * 0.6;
          q[i3 + 1] += (p[i3 + 1] - q[i3 + 1]) * 0.6;
          q[i3 + 2] += (p[i3 + 2] - q[i3 + 2]) * 0.6;
        }
      }
    }
  }

  /** Lays links along a rope at a fixed pitch, interlocking by turns, and returns the next free instance slot. */
  function layLinks(rope: Rope, start: number, lava: number, dt: number): number {
    const p = rope.points;
    const n = rope.n;
    let count = start;
    // the chord, for the twang's sideways offset
    const cx = p[(n - 1) * 3] - p[0];
    const cy = p[(n - 1) * 3 + 1] - p[1];
    const cz = p[(n - 1) * 3 + 2] - p[2];
    v3b.set(cx, cy, cz);
    const chord = v3b.length() || 1;
    v3b.divideScalar(chord);
    // a sideways unit vector: the chord crossed with up, or with x when the chord is vertical
    v3c.set(0, 1, 0);
    if (Math.abs(v3b.y) > 0.95) v3c.set(1, 0, 0);
    v3c.cross(v3b).normalize();
    rope.twang = Math.max(0, rope.twang - dt * 3.2);
    rope.flash = Math.max(0, rope.flash - dt);
    const tw = rope.twang;
    let seg = 0;
    let along = 0;
    let sx = p[0];
    let sy = p[1];
    let sz = p[2];
    let ex = p[3];
    let ey = p[4];
    let ez = p[5];
    let segLen = Math.hypot(ex - sx, ey - sy, ez - sz);
    let total = 0;
    for (let i = 0; i < n - 1; i++) total += Math.hypot(p[i * 3 + 3] - p[i * 3], p[i * 3 + 4] - p[i * 3 + 1], p[i * 3 + 5] - p[i * 3 + 2]);
    for (let k = 0; k < LINKS_PER && count < LINKS_MAX; k++) {
      const want = k * PITCH;
      if (want > total) break;
      while (along + segLen < want && seg < n - 2) {
        along += segLen;
        seg++;
        sx = ex;
        sy = ey;
        sz = ez;
        ex = p[seg * 3 + 3];
        ey = p[seg * 3 + 4];
        ez = p[seg * 3 + 5];
        segLen = Math.hypot(ex - sx, ey - sy, ez - sz);
      }
      const t = segLen > 1e-6 ? clamp((want - along) / segLen, 0, 1) : 0;
      v3.set(ex - sx, ey - sy, ez - sz);
      const len = v3.length() || 1e-6;
      v3.divideScalar(len);
      q4.setFromUnitVectors(X, v3);
      q4b.setFromAxisAngle(v3, (k % 2) * Math.PI * 0.5);
      q4.premultiply(q4b);
      const u = total > 0 ? want / total : 0;
      const off = tw > 0 ? Math.sin(u * Math.PI) * Math.sin(tw * 14) * rope.amp * tw : 0;
      dummy.position.set(lerp(sx, ex, t) + v3c.x * off, lerp(sy, ey, t) + v3c.y * off, lerp(sz, ez, t) + v3c.z * off);
      dummy.quaternion.copy(q4);
      dummy.scale.set(1.35, 1, 1);
      dummy.updateMatrix();
      linkMesh.setMatrixAt(count, dummy.matrix);
      // links over the lava glow hot
      const heat = clamp(1 - (dummy.position.y - lava) / 1.5, 0, 1);
      color.copy(white).lerp(chainHot, heat);
      if (rope.flash > 0) color.lerp(chainFlash, rope.flash / 0.15);
      linkMesh.setColorAt(count, color);
      count++;
    }
    return count;
  }

  function syncRopes(g: Game, dt: number) {
    let count = 0;
    for (const rope of ropes.values()) rope.held = false;
    for (const sv of soulViews) {
      sv.pullX = 0;
      sv.pullY = 0;
      sv.pullZ = 0;
    }
    // chain by chain: the ropes of a race never cross from one team to the other
    for (let team = 0; team < g.chains.length; team++) {
      const live = liveOf(g, team);
      for (let k = 0; k + 1 < live.length; k++) {
        const a = soulViews[live[k]];
        const b = soulViews[live[k + 1]];
        if (!a || !b) continue;
        const key = `${team}:${k}`;
        let rope = ropes.get(key);
        a.shackle.getWorldPosition(v3);
        b.shackle.getWorldPosition(v3b);
        if (!rope || rope.i !== live[k] || rope.j !== live[k + 1]) {
          rope = { points: new Float32Array(ROPE_N * 3), prev: new Float32Array(ROPE_N * 3), n: ROPE_N, held: true, i: live[k], j: live[k + 1], twang: 0, amp: 0, flash: 0 };
          for (let i = 0; i < ROPE_N; i++) {
            const t = i / (ROPE_N - 1);
            rope.points[i * 3] = lerp(v3.x, v3b.x, t);
            rope.points[i * 3 + 1] = lerp(v3.y, v3b.y, t);
            rope.points[i * 3 + 2] = lerp(v3.z, v3b.z, t);
          }
          rope.prev.set(rope.points);
          ropes.set(key, rope);
        }
        rope.held = true;
        stepRope(rope, v3.x, v3.y, v3.z, v3b.x, v3b.y, v3b.z, dt, g);
        // which way the chain leaves each ankle, for the hanging pose
        const p = rope.points;
        const tail = (n: number) => n * 3;
        a.pullX = p[tail(2)] - p[0];
        a.pullY = p[tail(2) + 1] - p[1];
        a.pullZ = p[tail(2) + 2] - p[2];
        b.pullX = p[tail(ROPE_N - 3)] - p[tail(ROPE_N - 1)];
        b.pullY = p[tail(ROPE_N - 3) + 1] - p[tail(ROPE_N - 1) + 1];
        b.pullZ = p[tail(ROPE_N - 3) + 2] - p[tail(ROPE_N - 1) + 2];
        for (const sv of [a, b]) {
          const l = Math.hypot(sv.pullX, sv.pullY, sv.pullZ) || 1;
          sv.pullX /= l;
          sv.pullY /= l;
          sv.pullZ /= l;
        }
        count = layLinks(rope, count, g.lava, dt);
      }
    }
    // drop the ropes whose pair is gone (a soul burned, or the game changed)
    for (const [key, rope] of ropes) if (!rope.held) ropes.delete(key);
    linkMesh.count = count;
    linkMesh.instanceMatrix.needsUpdate = true;
    if (linkMesh.instanceColor) linkMesh.instanceColor.needsUpdate = true;
  }

  function syncParticles(g: Game, dt: number, clock: number) {
    const cy = cam.ty;
    const ca = cam.a;
    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    const rMax = Math.min(R_CORE + 8, cam.r - 3);
    for (const set of particleSets) {
      const z = ZONES[set.zone];
      // this circle's own weather, or a neighbour's only while the camera is at the shared door
      const door = set.zone > camZone ? z.from : z.to;
      const near = set.zone === camZone || (Math.abs(set.zone - camZone) === 1 && Math.abs(cy - door) < 4);
      let count = 0;
      const k = set.kind;
      // a few spawns per frame, so a circle's weather fills in rather than popping in as one cluster
      let budget = Math.max(2, Math.ceil(set.n / 30));
      for (let i = 0; i < set.n; i++) {
        const i3 = i * 3;
        if (set.life[i] < 0) {
          if (!near || budget <= 0) continue;
          budget--;
          // spawn around the camera, inside this circle's band and never on the lens
          const y = cy + (Math.random() - 0.5) * 24;
          if (y < z.from - 1 || y > z.to + 1) continue;
          const a = ca + (Math.random() - 0.5) * 1.6;
          const r = R_CORE + 0.8 + Math.random() * Math.max(0.5, rMax - R_CORE - 0.8);
          const x = Math.cos(a) * r;
          const zz = Math.sin(a) * r;
          if (Math.hypot(x - camX, y - camY, zz - camZ) < 3.5) continue;
          set.pos[i3] = x;
          set.pos[i3 + 1] = y;
          set.pos[i3 + 2] = zz;
          const life = 2 + Math.random() * 5;
          set.life[i] = life;
          set.life0[i] = life;
          set.sz[i] = k === 'ember' ? 0.7 + Math.random() * 0.7 : k === 'snow' ? 1 + Math.random() * 2 : 0.8 + Math.random() * 0.4;
          set.vel[i3] = (Math.random() - 0.5) * 0.4;
          set.vel[i3 + 1] = k === 'ember' ? 0.8 + Math.random() : k === 'spark' ? -2 - Math.random() * 3 : k === 'ash' ? -0.22 : k === 'snow' ? -0.45 - Math.random() * 0.45 : k === 'mote' ? 0.05 : 0.02;
          set.vel[i3 + 2] = (Math.random() - 0.5) * 0.4;
          if (k === 'snow') {
            // snow circles the core
            const drift = (0.25 + Math.random() * 0.35) * DIR;
            set.vel[i3] += -Math.sin(a) * drift;
            set.vel[i3 + 2] += Math.cos(a) * drift;
          }
          if (set.ramp) {
            let pick = 0;
            if (set.rampW) {
              let roll = Math.random();
              for (let w = 0; w < set.rampW.length; w++) {
                roll -= set.rampW[w];
                if (roll <= 0) {
                  pick = w;
                  break;
                }
              }
            } else pick = Math.floor(Math.random() * set.ramp.length);
            set.mesh.setColorAt(i, set.ramp[pick]);
          }
        }
        set.life[i] -= dt;
        const w = k === 'snow' ? Math.sin(clock * 1.3 + i) * 0.25 : k === 'ember' ? Math.sin(clock * 2 + i) * 0.4 : k === 'ash' ? Math.sin(clock * 0.8 + i) * 0.22 : 0;
        set.pos[i3] += (set.vel[i3] + w) * dt;
        set.pos[i3 + 1] += set.vel[i3 + 1] * dt;
        set.pos[i3 + 2] += (set.vel[i3 + 2] + w * 0.5) * dt;
        if (k === 'spark') set.vel[i3 + 1] -= 6 * dt;
        const py = set.pos[i3 + 1];
        if (py < g.lava || py < z.from - 2 || py > z.to + 2 || Math.abs(py - cy) > 30) set.life[i] = -1;
        if (set.life[i] < 0) continue;
        dummy.position.set(set.pos[i3], py, set.pos[i3 + 2]);
        const fade = clamp(set.life[i], 0, 1) * clamp((set.life0[i] - set.life[i]) / 0.6, 0, 1);
        const dist = Math.hypot(set.pos[i3] - camX, py - camY, set.pos[i3 + 2] - camZ);
        // nothing within arm's reach of the lens, and a long fade in past it, so no flake ever reads as a blob
        if (dist < 2) set.life[i] = -1;
        let sc = set.size * set.sz[i] * (0.6 + fade * 0.6) * clamp((dist - 2) / 5, 0, 1);
        if (set.life[i] < 0) continue;
        if (k === 'spark') sc *= 1 + Math.random() * 0.6;
        else if (k === 'ember') sc *= 0.85 + 0.15 * Math.sin(clock * 9 + i);
        else if (k === 'stardust') sc *= 0.75 + 0.25 * Math.sin(clock * 4 + i * 1.7);
        if (k === 'ash') {
          dummy.scale.set(sc, sc * 0.25, sc * 0.7);
          dummy.rotation.set(clock * 0.5 + i, clock * 0.35, 0);
        } else {
          dummy.scale.setScalar(sc);
          dummy.rotation.set(0, 0, 0);
        }
        dummy.updateMatrix();
        set.mesh.setMatrixAt(count++, dummy.matrix);
      }
      set.mesh.count = count;
      set.mesh.instanceMatrix.needsUpdate = true;
      if (set.ramp && set.mesh.instanceColor) set.mesh.instanceColor.needsUpdate = true;
    }
    // bursts: dust that drifts and grows, sparks that fall and shrink, all fading into the fog's colour
    let pc = 0;
    for (let i = puffs.length - 1; i >= 0; i--) {
      const p = puffs[i];
      p.life -= dt / p.dur;
      if (p.life <= 0) {
        puffs.splice(i, 1);
        continue;
      }
      p.vy -= p.grav * dt;
      const drag = Math.exp(-p.drag * dt);
      p.vx *= drag;
      p.vy *= drag;
      p.vz *= drag;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      dummy.position.set(p.x, p.y, p.z);
      dummy.scale.setScalar(p.size * lerp(1, p.grow, 1 - p.life));
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      puffMesh.setMatrixAt(pc, dummy.matrix);
      puffMesh.setColorAt(pc, color.setRGB(p.r, p.g, p.b).lerp(fog.color, 1 - p.life));
      pc++;
    }
    puffMesh.count = pc;
    puffMesh.instanceMatrix.needsUpdate = true;
    if (puffMesh.instanceColor) puffMesh.instanceColor.needsUpdate = true;
    // impact rings
    let rc = 0;
    for (let i = rings.length - 1; i >= 0; i--) {
      const r = rings[i];
      r.life -= dt / r.dur;
      if (r.life <= 0) {
        rings.splice(i, 1);
        continue;
      }
      dummy.position.set(r.x, r.y, r.z);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.scale.setScalar(lerp(r.from, r.to, 1 - r.life));
      dummy.updateMatrix();
      ringMesh.setMatrixAt(rc, dummy.matrix);
      ringMesh.setColorAt(rc, color.setRGB(r.r, r.g, r.b).lerp(fog.color, 1 - r.life));
      rc++;
    }
    ringMesh.count = rc;
    ringMesh.instanceMatrix.needsUpdate = true;
    if (ringMesh.instanceColor) ringMesh.instanceColor.needsUpdate = true;
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
      const q = pose(m.p, rtime, poseQ);
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
      b.orbMat.color.set(lit ? glow : b.p.zone === 5 ? '#6f7aa8' : '#555a66');
      const pulse = lit ? 1 + Math.sin(clock * 4) * 0.12 : 1;
      b.orb.scale.setScalar((b.p.kind === 'goal' ? 0.3 : 0.22) * pulse + b.flare * 0.3);
      b.flare = Math.max(0, b.flare - dt * 1.2);
      // a lit beacon keeps a faint ring once its flare has gone
      b.ringMat.opacity = lit ? Math.max(0.18, b.flare * 0.8) : 0;
      b.ringMat.color.set(glow);
      b.ring.scale.setScalar(b.flare > 0 ? 0.5 + (1 - b.flare) * 4 : 0.9);
    }
    clouds.rotation.y += dt * 0.004;
    // the lava
    const lv = g.lava;
    lava.position.y = lv;
    lavaGlow.position.y = lv + 0.12;
    const heat = 0.5 + Math.sin(clock * 1.7) * 0.25 + Math.sin(clock * 4.3) * 0.15;
    // a burn flashes the lava bright for a moment
    const flash = burnFlashAt >= 0 ? clamp(1 - (clock - burnFlashAt) / 0.15, 0, 1) : 0;
    const surge = burnFlashAt >= 0 ? clamp(1 - (clock - burnFlashAt) / 0.5, 0, 1) : 0;
    (lava.material as T.MeshBasicMaterial).color.set('#ff4a12').lerp(color.set('#ffb13a'), heat * 0.5).lerp(color.set('#ffd27a'), flash);
    (lavaGlow.material as T.MeshBasicMaterial).opacity = 0.25 + heat * 0.2 + surge * 0.25;
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
    // the circles' own animation: flames, ghosts, gears, shards, the bell
    const frame: Frame = { g, dt, clock, camY: cam.ty, camA: cam.a, lava: g.lava, won };
    for (const fn of hooks) fn(frame);
  }

  function syncCamera(g: Game, focus: number[], dt: number, clock: number, split: boolean) {
    const main = g.souls[focus[0]] ?? g.souls[0];
    if (!main) return;
    const mx = lerp(main.rx, main.x, al);
    const my = lerp(main.ry, main.y, al);
    const mz = lerp(main.rz, main.z, al);
    // the vertical is locked to the ground: it follows the lead soul while it stands, and holds through a hop
    const grounded = main.grounded || main.hanging;
    if (!cam.init) cam.gy = my;
    else if (grounded) cam.gy = damp(cam.gy, my, 7, dt);
    else if (my - cam.gy > 2.2) cam.gy = damp(cam.gy, my - 2.2, 5, dt);
    else if (my < cam.gy - 1.2) cam.gy = damp(cam.gy, my + 1.2, 9, dt);
    // the target: mostly the lead soul, a little toward the others, a little ahead of where it is going
    let ox = 0;
    let oy = 0;
    let oz = 0;
    let on = 0;
    const celebrating = winAt >= 0 && clock - winAt < 4;
    const others = celebrating ? (g.chains[winTeam] ?? []) : focus.slice(1);
    for (const i of others) {
      const s = g.souls[i];
      if (!s || s.burned >= 0 || i === focus[0]) continue;
      ox += lerp(s.rx, s.x, al);
      oy += lerp(s.ry, s.y, al);
      oz += lerp(s.rz, s.z, al);
      on++;
    }
    const share = on ? (split || celebrating ? 0.5 : 0.22) : 0;
    let tx = mx;
    let ty = cam.gy;
    let tz = mz;
    if (on) {
      tx = lerp(mx, ox / on, share);
      ty = lerp(cam.gy, oy / on, share);
      tz = lerp(mz, oz / on, share);
    }
    const speed = Math.hypot(main.vx, main.vz);
    const look = clamp(speed * 0.14, 0, 1.1);
    if (speed > 0.1 && !celebrating) {
      tx += (main.vx / speed) * look;
      tz += (main.vz / speed) * look;
    }
    ty += 1.0 + (celebrating ? 1.2 : 0);
    const k = cam.init ? 1 - Math.exp(-7 * dt) : 1;
    cam.tx = lerp(cam.tx, tx, k);
    cam.ty = lerp(cam.ty, ty, k);
    cam.tz = lerp(cam.tz, tz, k);
    // the camera stands outside the target's angle, further back when the souls spread out or someone is falling
    const ta = Math.atan2(cam.tz, cam.tx);
    const tr = Math.hypot(cam.tx, cam.tz);
    let da = ta - cam.a;
    da = Math.atan2(Math.sin(da), Math.cos(da));
    const turn = cam.init ? da * (1 - Math.exp(-6 * dt)) : da;
    cam.a += turn + (celebrating ? 0.35 * dt : 0);
    let spread = 0;
    for (const i of focus) {
      const s = g.souls[i];
      if (s) spread = Math.max(spread, Math.hypot(s.x - main.x, s.y - main.y, s.z - main.z));
    }
    const falling = main.vy < -8 ? 1 : 0;
    cam.fallDip = damp(cam.fallDip, falling, 3, dt);
    const tight = clamp(1 - (spread - 2) / 2, 0, 1);
    const wantDist = (celebrating ? 11.5 : lerp(9.2, 8.4, tight) + clamp(spread - 2, 0, 4) * 0.5) + cam.fallDip * 2.4;
    cam.dist = cam.init ? damp(cam.dist, wantDist, 3, dt) : wantDist;
    cam.r = cam.init ? damp(cam.r, tr + cam.dist, 6, dt) : tr + cam.dist;
    const height = cam.ty + lerp(3.9, 3.3, tight) - cam.fallDip * 1.4;
    cam.y = cam.init ? damp(cam.y, height, 7, dt) : height;
    // a thump on a hard landing, a hint of roll into a turn, and a shake that is a waveform rather than noise
    cam.thump = Math.max(0, cam.thump - dt * 2.4);
    const thumpY = -0.22 * cam.thump * Math.sin(cam.thump * 11);
    cam.shake = Math.max(0, cam.shake - dt * 1.6);
    const sh = cam.shake * cam.shake * 0.35;
    const shX = sh * (0.6 * Math.sin(clock * 37) + 0.4 * Math.sin(clock * 53 + 1.7));
    const shY = sh * (0.6 * Math.sin(clock * 37 + 2.1) + 0.4 * Math.sin(clock * 53 + 3.9));
    const shZ = sh * (0.6 * Math.sin(clock * 37 + 4.2) + 0.4 * Math.sin(clock * 53 + 0.8));
    const wantRoll = cam.init && dt > 0 ? clamp(-turn / dt, -1, 1) * 0.025 : 0;
    cam.roll = cam.init ? damp(cam.roll, wantRoll, 6, dt) : 0;
    cam.init = true;
    camera.position.set(Math.cos(cam.a) * cam.r + shX, cam.y + thumpY + shY, Math.sin(cam.a) * cam.r + shZ);
    camera.up.set(0, 1, 0);
    camera.lookAt(cam.tx, cam.ty + 0.5 - cam.fallDip * 1.2, cam.tz);
    camera.rotateZ(cam.roll);
  }

  function syncPalette(g: Game, dt: number, clock: number) {
    pal = paletteAt(cam.ty);
    camZone = pal.zone;
    const p = pal.palette;
    const k = 1 - Math.exp(-3 * dt);
    color.set(p.fog);
    fog.color.lerp(color, k);
    fog.near = lerp(fog.near, p.fogNear, k);
    fog.far = lerp(fog.far, p.fogFar, k);
    hemi.color.lerp(color.set(p.hemi[0]), k);
    hemi.groundColor.lerp(color.set(p.hemi[1]), k);
    sun.color.lerp(color.set(p.sun), k);
    // the glow from below: the lava's near the bottom, back as it climbs, and the furnaces' in the forge
    const above = Math.max(0, cam.ty - g.lava);
    const heat = camZone === 2 ? 0.55 + 0.06 * Math.sin(clock * 3.1) + 0.03 * Math.sin(clock * 7.7) : 0;
    let want = Math.max(clamp(0.9 - above / 30, 0, 0.9), heat);
    if (cam.ty > 70 && g.lava <= cam.ty - 40) want = 0;
    ember.intensity = lerp(ember.intensity, want, k);
    ember.color.lerp(color.set(heat > 0 ? '#ff7a2a' : '#ff6a2a'), k);
    ember.position.set(camera.position.x, g.lava - 5, camera.position.z);
    ember.target.position.set(cam.tx, cam.ty, cam.tz);
    // the chain's iron takes the circle's light
    mats.chain.color.lerp(CHAIN_BY_ZONE[camZone], k);
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
      al = renderAlpha(g);
      rtime = renderTime(g);
      // events arrive without the clock: they mark their beats with a sentinel the frame stamps
      if (winAt === -2) winAt = clock;
      if (burnFlashAt === -3) burnFlashAt = clock;
      const myTeam = g.souls[focus[0]]?.team ?? 0;
      g.souls.forEach((s, i) => syncSoul(g, s, soulViews[i], dt, clock, focus[0] === i && !split, s.team !== myTeam, i));
      syncRopes(g, dt);
      syncCamera(g, focus, dt, clock, split);
      syncPalette(g, dt, clock);
      syncLedges(g, dt, clock);
      syncParticles(g, dt, clock);
      if (g.won !== null) won = true;
      // the win beat: rings and confetti in three waves over the winning team
      if (winAt >= 0 && winWave < 3 && clock - winAt >= winWave * 0.4) {
        const team = g.chains[winTeam] ?? [];
        for (const i of team) {
          const s = g.souls[i];
          if (!s || s.burned >= 0) continue;
          const sv = soulViews[i];
          const c: [number, number, number] = sv ? [sv.color.r, sv.color.g, sv.color.b] : [1, 0.9, 0.6];
          burst(s.x, s.y + 1.4, s.z, Math.max(4, Math.floor(14 / Math.max(1, team.length))), c, 3, 0.07, 1.2, { grav: 3, drag: 1, dur: 1.4, grow: 0.8 });
          if (winWave < 2) ringAt(s.x, s.y + 0.03, s.z, 6, hexToRgb(ZONES[zoneIndex(s.y)].palette.glow), 1.2, 0.5);
        }
        winWave++;
      }
    },
    react(e, g) {
      const soulAt = (i: number) => g.souls[i];
      if (e.t === 'land') {
        const s = soulAt(e.i);
        if (e.surface === 'metal') {
          burst(s.x, s.y + 0.05, s.z, e.hard ? 8 : 6, SPARK_C, e.hard ? 2.4 : 1.6, 0.05, 0.6, SPARK);
        } else if (e.surface === 'ice') {
          burst(s.x, s.y + 0.05, s.z, 9, DUST_ICE, 1.7, 0.04, 0.25);
        } else {
          const ash = zoneIndex(s.y) === 1;
          burst(s.x, s.y + 0.05, s.z, Math.round((e.hard ? 10 : 5) * (ash ? 1.5 : 1)), dustOf(s.y), 1.2, 0.12, 0.35);
        }
        ringAt(s.x, s.y + 0.03, s.z, e.hard ? 2.0 : 1.4, e.surface === 'ice' ? DUST_ICE : dustOf(s.y));
        if (e.hard) {
          cam.shake = Math.max(cam.shake, 0.5);
          cam.thump = Math.max(cam.thump, 1);
        }
      } else if (e.t === 'step') {
        const s = soulAt(e.i);
        if (e.surface === 'metal') burst(s.x, s.y + 0.03, s.z, 2, SPARK_C, 1.2, 0.035, 0.5, SPARK);
        else if (e.surface === 'ice') burst(s.x, s.y + 0.03, s.z, 2, DUST_ICE, 0.6, 0.035, 0.3, { dur: 0.5 });
      } else if (e.t === 'mantle') {
        const s = soulAt(e.i);
        const sv = soulViews[e.i];
        if (sv) {
          // start the model where it was and let it ease up onto the ledge
          sv.ox = sv.root.position.x - s.x;
          sv.oy = sv.root.position.y - s.y;
          sv.oz = sv.root.position.z - s.z;
        }
        burst(s.x, s.y + 0.05, s.z, zoneIndex(s.y) === 1 ? 6 : 4, dustOf(s.y), 0.8, 0.1, 0.35);
      } else if (e.t === 'taut') {
        if (e.speed > 2) {
          // the chain twangs: a sideways ripple, a flash of light along the iron and sparks off the links
          for (const rope of ropes.values()) {
            if ((rope.i === e.i && rope.j === e.j) || (rope.i === e.j && rope.j === e.i)) {
              rope.twang = 1;
              rope.amp = Math.min(0.35, e.speed / 25);
              rope.flash = 0.15;
              const p = rope.points;
              for (const t of [0.3, 0.5, 0.7]) {
                const k = Math.round(t * (rope.n - 1)) * 3;
                burst(p[k], p[k + 1], p[k + 2], 2, SPARK_C, 1.8, 0.04, 0.3, SPARK);
              }
            }
          }
          if (e.speed > 3) cam.shake = Math.max(cam.shake, Math.min(0.6, e.speed / 20));
        }
      } else if (e.t === 'yank') {
        cam.shake = Math.max(cam.shake, Math.min(0.8, 0.3 + e.speed / 20));
        cam.thump = Math.max(cam.thump, 0.6);
      } else if (e.t === 'crumble' && e.phase === 'fall') {
        const c = crumblies.find((x) => x.p.id === e.id);
        if (c) {
          for (let i = 0; i < 6; i++) {
            const mesh = new THREE.Mesh(geo.box, mats.debris);
            const a = c.p.a + (Math.random() - 0.5) * c.p.span * 2;
            const r = c.p.r0 + Math.random() * (c.p.r1 - c.p.r0);
            mesh.position.set(Math.cos(a) * r, c.p.y - 0.2, Math.sin(a) * r);
            mesh.scale.set(0.2 + Math.random() * 0.3, 0.15 + Math.random() * 0.2, 0.2 + Math.random() * 0.3);
            scene.add(mesh);
            c.debris.push({ mesh, vx: (Math.random() - 0.5) * 1.5, vy: -1 - Math.random() * 2, vz: (Math.random() - 0.5) * 1.5, rx: (Math.random() - 0.5) * 6, rz: (Math.random() - 0.5) * 6, life: 2.2 });
          }
          burst(Math.cos(c.p.a) * ((c.p.r0 + c.p.r1) / 2), c.p.y - 0.2, Math.sin(c.p.a) * ((c.p.r0 + c.p.r1) / 2), 8, dustOf(c.p.y), 1.2, 0.12, -0.4, { dur: 1 });
        }
      } else if (e.t === 'spring') {
        const s = soulAt(e.i);
        const sp = springs.find((x) => x.p.id === s.ground) ?? springs.reduce<Spring | null>((best, x) => (!best || Math.hypot(Math.cos(x.p.a) * ((x.p.r0 + x.p.r1) / 2) - s.x, x.p.y - s.y, Math.sin(x.p.a) * ((x.p.r0 + x.p.r1) / 2) - s.z) < 3 ? x : best), null);
        if (sp) sp.squash = 1;
        burst(s.x, s.y, s.z, 7, SPARK_C, 1.8, 0.05, 0.5, SPARK);
      } else if (e.t === 'checkpoint') {
        const s = soulAt(e.i);
        const glow = hexToRgb(ZONES[zoneIndex(s.y)].palette.glow);
        burst(s.x, s.y + 1, s.z, 14, glow, 2.5, 0.07, 1, { grav: 2, drag: 1.5, dur: 1.2, grow: 0.6 });
      } else if (e.t === 'burn') {
        const s = soulAt(e.i);
        const sv = soulViews[e.i];
        if (sv) sv.burnAt = -2;
        // embers up in waves, smoke that spreads, and a ring of steam on the lava
        for (let w = 0; w < 4; w++) burst(s.x, s.y + 0.3 + w * 0.3, s.z, 5, w % 2 ? [1, 0.82, 0.48] : [1, 0.48, 0.16], 1.2 + w * 0.5, 0.06, 2 + w * 0.5, { grav: -1, drag: 1.2, dur: 1 + w * 0.2, grow: 0.3 });
        burst(s.x, s.y + 0.6, s.z, 10, [0.16, 0.1, 0.08], 1, 0.12, 0.8, { grav: -0.5, drag: 1.5, dur: 1.6, grow: 3 });
        ringAt(s.x, g.lava + 0.05, s.z, 3, [1, 1, 1], 0.6, 0.4);
        burnFlashAt = -3;
        cam.shake = Math.max(cam.shake, 0.6);
        cam.thump = Math.max(cam.thump, 1.2);
        cam.fallDip = Math.max(cam.fallDip, 1);
      } else if (e.t === 'win') {
        winAt = -2;
        winTeam = e.team;
        winWave = 0;
        won = true;
      } else if (e.t === 'respawn') {
        // the camera snaps to the beacon under the fade instead of flying through the core
        cam.init = false;
        cam.shake = 0;
        cam.thump = 0;
        cam.fallDip = 0;
        for (const i of g.chains[e.team] ?? []) {
          const s = soulAt(i);
          const sv = soulViews[i];
          if (sv) {
            sv.ox = 0;
            sv.oy = 0;
            sv.oz = 0;
          }
          burst(s.x, s.y + 0.5, s.z, 8, [0.8, 0.9, 1], 1.5, 0.08, 1, { grav: -0.5, drag: 1.5, dur: 1, grow: 0.5 });
        }
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
