// The three.js side of Void Run: tunnel tiles, the runner and the other racers, the sky, particles and the camera.
import type { T } from './gl';
import { createGL, damp, disposeTree, type GL } from './gl';
import {
  APOTHEM,
  BOOST_TIME,
  CRUMBLE_DELAY,
  MAX_SPEED,
  MIN_SPEED,
  ROW_L,
  STRAFE,
  ZONES,
  boostMaskAt,
  crumbAt,
  hasBit,
  halfOf,
  maskAt,
  perimOf,
  rowOf,
  tileWOf,
  turnOf,
  zoneIndexAt,
  type Events,
  type State,
  type Zone,
} from './logic';

type Three = typeof import('three');

const ADD = 2 as T.Blending;
const STAR_VERT = `
attribute vec3 tint;
uniform float size;
varying vec3 vTint;
void main() {
  vTint = tint;
  gl_PointSize = size;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const STAR_FRAG = `
varying vec3 vTint;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float a = smoothstep(0.5, 0.15, length(d));
  gl_FragColor = vec4(vTint, a);
}`;

export type Theme = { tile: number; edge: number; crumb: number; fog: number; sky: number; light: number; planet: number };
export const THEMES: readonly Theme[] = [
  { tile: 0x7d86ff, edge: 0x9fa6ff, crumb: 0x6b4fa0, fog: 0x0a0b26, sky: 0x5a4cff, light: 0xb7b4ff, planet: 0xff9a6a },
  { tile: 0x3fd6bd, edge: 0x7cffe6, crumb: 0x2d6e84, fog: 0x031a1f, sky: 0x12b5b0, light: 0xa8fff0, planet: 0xff7aa8 },
  { tile: 0xff8547, edge: 0xffb36b, crumb: 0x8f3b2a, fog: 0x1d0807, sky: 0xff5a2e, light: 0xffc49a, planet: 0x8fc4ff },
  { tile: 0xa9c2ff, edge: 0xe2ecff, crumb: 0x5b6d9c, fog: 0x081223, sky: 0x5c8cff, light: 0xe0eaff, planet: 0xffd27a },
  { tile: 0x5a4fd8, edge: 0xff5ad6, crumb: 0x5a2c60, fog: 0x020208, sky: 0x40129a, light: 0xff8de6, planet: 0x6cf0ff },
  { tile: 0xffc94a, edge: 0xfff0a6, crumb: 0x9a5a1e, fog: 0x1b0e02, sky: 0xff8a1e, light: 0xffe7a8, planet: 0xc78bff },
];
export const SEAT_COLORS = [0xff6b5a, 0x4fd2ff, 0xffd34a, 0x8cff6a] as const;

const MAX_PERIM = 24;
const ROWS_VIS = 64;
const ROWS_BACK = 3;
const STREAKS = 56;
const SPARKS = 140;
const DEBRIS = 24;
const STARS = 1400;

type Pose = { phase: number; air: number; fall: number; land: number; lean: number; t: number };

export type Runner = {
  root: T.Group;
  body: T.Group;
  hipL: T.Group;
  hipR: T.Group;
  kneeL: T.Group;
  kneeR: T.Group;
  armL: T.Group;
  armR: T.Group;
  elbowL: T.Group;
  elbowR: T.Group;
  jet: T.Mesh;
  pose: Pose;
};

export type GhostView = { seat: number; dist: number; u: number; h: number; falling: boolean; finished: boolean; vu: number; color: number };
type Ghost = { runner: Runner; roll: number; seen: number };
type Spark = { p: T.Vector3; v: T.Vector3; life: number; max: number; size: number; color: T.Color; g: number };
type Debris = { p: T.Vector3; v: T.Vector3; r: number; spin: number; life: number; roll: number; w: number; color: T.Color };

export type World = {
  THREE: Three;
  gl: GL;
  scene: T.Scene;
  camera: T.PerspectiveCamera;
  tiles: T.InstancedMesh;
  tileMat: T.MeshStandardMaterial;
  decals: T.InstancedMesh;
  decalTex: T.Texture;
  debris: T.InstancedMesh;
  debrisList: Debris[];
  sparks: T.InstancedMesh;
  sparkList: Spark[];
  streaks: T.InstancedMesh;
  streakPos: Float32Array;
  stars: T.Points;
  sky: T.Mesh;
  skyMat: T.MeshBasicMaterial;
  planet: T.Group;
  planetMat: T.MeshStandardMaterial;
  rings: T.Mesh[];
  ringGeo: Map<number, T.TorusGeometry>;
  cells: T.Group[];
  hemi: T.HemisphereLight;
  key: T.DirectionalLight;
  glow: T.DirectionalLight;
  you: Runner;
  ghosts: Map<number, Ghost>;
  labels: Map<number, { x: number; y: number; on: boolean }>;
  // eased theme
  col: { tile: T.Color; edge: T.Color; crumb: T.Color; fog: T.Color; sky: T.Color; light: T.Color; planet: T.Color };
  dark: number;
  // camera
  roll: number;
  rollV: number;
  anchor: T.Vector3;
  fov: number;
  shake: number;
  time: number;
  // scratch
  m: T.Matrix4;
  q: T.Quaternion;
  e: T.Euler;
  v: T.Vector3;
  v2: T.Vector3;
  sc: T.Vector3;
  c: T.Color;
  zero: T.Matrix4;
  w: number;
  h: number;
};

/** World position of a point `h` above side `side`, `x` across it, `dist` down the tunnel. */
export function place(out: T.Vector3, z: Zone, side: number, x: number, h: number, dist: number) {
  const r = side * turnOf(z);
  const s = Math.sin(r);
  const c = Math.cos(r);
  const a = APOTHEM - h;
  return out.set(a * s + c * x, -a * c + s * x, -dist);
}
/** Lateral position as meters around the perimeter, continuous across corners. */
export const uOf = (z: Zone, side: number, x: number) => side * 2 * halfOf(z) + x;
export function fromU(z: Zone, u: number): [number, number] {
  const w = 2 * halfOf(z);
  const side = Math.round(u / w);
  return [side, u - side * w];
}

function canvasTex(THREE: Three, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const c = cv.getContext('2d')!;
  draw(c);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function tileTextures(THREE: Three) {
  const S = 128;
  const map = canvasTex(THREE, S, S, (c) => {
    c.fillStyle = '#c9cbe0';
    c.fillRect(0, 0, S, S);
    const g = c.createLinearGradient(0, 0, S, S);
    g.addColorStop(0, '#f4f5ff');
    g.addColorStop(1, '#b4b7d4');
    c.fillStyle = g;
    c.fillRect(8, 8, S - 16, S - 16);
    c.strokeStyle = 'rgba(40,44,80,0.35)';
    c.lineWidth = 2;
    c.strokeRect(22, 22, S - 44, S - 44);
    c.fillStyle = 'rgba(40,44,80,0.25)';
    for (const [x, y] of [[16, 16], [S - 16, 16], [16, S - 16], [S - 16, S - 16]]) {
      c.beginPath();
      c.arc(x, y, 3, 0, Math.PI * 2);
      c.fill();
    }
  });
  const glow = canvasTex(THREE, S, S, (c) => {
    c.fillStyle = '#000';
    c.fillRect(0, 0, S, S);
    c.strokeStyle = '#fff';
    c.lineWidth = 5;
    c.strokeRect(3, 3, S - 6, S - 6);
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.lineWidth = 2;
    c.strokeRect(22, 22, S - 44, S - 44);
  });
  return { map, glow };
}

function skyTexture(THREE: Three) {
  return canvasTex(THREE, 1024, 512, (c) => {
    const g = c.createLinearGradient(0, 0, 0, 512);
    g.addColorStop(0, '#05060d');
    g.addColorStop(0.5, '#141a33');
    g.addColorStop(1, '#05060d');
    c.fillStyle = g;
    c.fillRect(0, 0, 1024, 512);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    c.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 70; i++) {
      const x = rnd() * 1024;
      const y = 120 + rnd() * 280;
      const r = 40 + rnd() * 160;
      const n = c.createRadialGradient(x, y, 0, x, y, r);
      const a = 0.05 + rnd() * 0.08;
      n.addColorStop(0, `rgba(255,255,255,${a})`);
      n.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = n;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
  });
}

function planetTexture(THREE: Three) {
  return canvasTex(THREE, 256, 128, (c) => {
    for (let y = 0; y < 128; y++) {
      const v = 0.72 + 0.28 * Math.sin(y * 0.21) * Math.sin(y * 0.047 + 1);
      const k = Math.floor(255 * v);
      c.fillStyle = `rgb(${k},${k},${k})`;
      c.fillRect(0, y, 256, 1);
    }
  });
}

function glowTexture(THREE: Three) {
  return canvasTex(THREE, 64, 64, (c) => {
    const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.45)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
  });
}

function chevronTexture(THREE: Three) {
  const t = canvasTex(THREE, 64, 128, (c) => {
    c.clearRect(0, 0, 64, 128);
    c.strokeStyle = '#fff';
    c.lineWidth = 9;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    for (const y of [24, 88]) {
      c.beginPath();
      c.moveTo(12, y + 26);
      c.lineTo(32, y);
      c.lineTo(52, y + 26);
      c.stroke();
    }
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

/** A little round-headed spacesuit runner. Faces -z, feet at the origin, about 1 m tall. */
export function makeRunner(THREE: Three, accent: number, suit = 0xf2f3fa): Runner {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const suitMat = new THREE.MeshStandardMaterial({ color: suit, roughness: 0.42, metalness: 0.08 });
  const trimMat = new THREE.MeshStandardMaterial({ color: accent, roughness: 0.5, emissive: accent, emissiveIntensity: 0.25 });
  const glowMat = new THREE.MeshBasicMaterial({ color: accent, toneMapped: false });
  const visorMat = new THREE.MeshStandardMaterial({ color: 0x141826, roughness: 0.12, metalness: 0.7 });
  // a capsule from a tube and two caps (the shared three.js chunk has no CapsuleGeometry)
  const capsule = (r: number, l: number, m: T.Material) => {
    const body = new THREE.Mesh(new THREE.CylinderGeometry(r, r, l, 10, 1, true), m);
    for (const y of [l / 2, -l / 2]) {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(r, 10, 6), m);
      cap.position.y = y;
      body.add(cap);
    }
    return body;
  };

  const torso = capsule(0.16, 0.2, suitMat);
  torso.position.y = 0.66;
  body.add(torso);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.165, 0.165, 0.05, 18), trimMat);
  belt.position.y = 0.55;
  body.add(belt);
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.05, 0.02), glowMat);
  chest.position.set(0, 0.72, -0.16);
  body.add(chest);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.26, 0.12), trimMat);
  pack.position.set(0, 0.7, 0.17);
  body.add(pack);
  const jet = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 10, 1, true), new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.85, blending: ADD, depthWrite: false, toneMapped: false }));
  jet.rotation.x = Math.PI;
  jet.position.set(0, 0.48, 0.2);
  body.add(jet);

  const head = new THREE.Group();
  head.position.y = 0.98;
  body.add(head);
  head.add(new THREE.Mesh(new THREE.SphereGeometry(0.2, 22, 16), suitMat));
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.206, 22, 12, Math.PI * 0.18, Math.PI * 0.64, Math.PI * 0.28, Math.PI * 0.4), visorMat);
  visor.rotation.y = Math.PI;
  head.add(visor);
  for (const sx of [-0.06, 0.06]) {
    const eye = capsule(0.022, 0.03, glowMat);
    eye.position.set(sx, 0.01, -0.2);
    head.add(eye);
  }
  const stalk = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.16, 6), trimMat);
  stalk.position.set(0.08, 0.24, 0.02);
  stalk.rotation.z = -0.3;
  head.add(stalk);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.035, 10, 8), glowMat);
  bulb.position.set(0.105, 0.32, 0.02);
  head.add(bulb);

  const limb = (parent: T.Object3D, x: number, y: number, r: number, l: number, mat: T.Material) => {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, 0);
    const m = capsule(r, l, mat);
    m.position.y = -(l / 2 + r * 0.6);
    pivot.add(m);
    parent.add(pivot);
    return pivot;
  };
  const armL = limb(body, -0.21, 0.8, 0.05, 0.13, suitMat);
  const armR = limb(body, 0.21, 0.8, 0.05, 0.13, suitMat);
  const elbowL = limb(armL, 0, -0.2, 0.045, 0.11, suitMat);
  const elbowR = limb(armR, 0, -0.2, 0.045, 0.11, suitMat);
  for (const e of [elbowL, elbowR]) {
    const hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 10, 8), trimMat);
    hand.position.y = -0.2;
    e.add(hand);
  }
  const hipL = limb(body, -0.09, 0.48, 0.065, 0.12, suitMat);
  const hipR = limb(body, 0.09, 0.48, 0.065, 0.12, suitMat);
  const kneeL = limb(hipL, 0, -0.22, 0.058, 0.12, suitMat);
  const kneeR = limb(hipR, 0, -0.22, 0.058, 0.12, suitMat);
  for (const k of [kneeL, kneeR]) {
    const boot = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.08, 0.2), trimMat);
    boot.position.set(0, -0.22, -0.03);
    k.add(boot);
  }
  return { root, body, hipL, hipR, kneeL, kneeR, armL, armR, elbowL, elbowR, jet, pose: { phase: 0, air: 0, fall: 0, land: 0, lean: 0, t: 0 } };
}

const mix = (a: number, b: number, t: number) => a + (b - a) * t;

/** Run cycle, tucked jump, flailing fall and a squash on landing, all blended. */
export function animateRunner(r: Runner, dt: number, o: { speed: number; grounded: boolean; vy: number; falling: boolean; vx: number; landed: boolean }) {
  const p = r.pose;
  p.t += dt;
  p.phase += dt * Math.PI * 2 * (1.7 + o.speed * 0.17);
  p.air = damp(p.air, o.grounded ? 0 : 1, o.grounded ? 22 : 10, dt);
  p.fall = damp(p.fall, o.falling ? 1 : 0, 6, dt);
  p.lean = damp(p.lean, o.vx / STRAFE, 10, dt);
  if (o.landed) p.land = 1;
  p.land = Math.max(0, p.land - dt * 5);
  const s = Math.sin(p.phase);
  const c = Math.cos(p.phase);
  const a = p.air;
  const rise = Math.max(-1, Math.min(1, o.vy / 6));
  r.hipL.rotation.x = mix(s * 0.95, 0.9 + rise * 0.2, a);
  r.hipR.rotation.x = mix(-s * 0.95, -0.25, a);
  r.kneeL.rotation.x = mix(-(0.2 + 1.2 * Math.max(0, c)), -1.25, a);
  r.kneeR.rotation.x = mix(-(0.2 + 1.2 * Math.max(0, -c)), -0.7, a);
  const flail = Math.sin(p.t * 18) * 0.7;
  r.armL.rotation.x = mix(mix(-s * 0.85, 0.5, a), 2.6 + flail, p.fall);
  r.armR.rotation.x = mix(mix(s * 0.85, 0.5, a), 2.6 - flail, p.fall);
  r.armL.rotation.z = mix(-0.12, -0.75, Math.max(a, p.fall));
  r.armR.rotation.z = mix(0.12, 0.75, Math.max(a, p.fall));
  r.elbowL.rotation.x = r.elbowR.rotation.x = mix(1.1, 0.4, a);
  r.body.position.y = (1 - a) * Math.abs(s) * 0.05 - p.land * 0.08;
  r.body.rotation.x = mix(-0.2, -0.05 - rise * 0.15, a) + p.fall * 0.4;
  r.body.rotation.z = -p.lean * 0.22;
  const k = p.land * p.land;
  r.root.scale.set(1 + 0.16 * k, 1 - 0.2 * k, 1 + 0.16 * k);
  r.jet.visible = a > 0.3;
  r.jet.scale.set(1, 0.6 + 0.5 * Math.random() + rise, 1);
}

export function buildWorld(THREE: Three, host: HTMLElement, accent = 0xff8a3d): World | null {
  const gl = createGL(THREE, host, { maxDpr: 1.75 });
  if (!gl) return null;
  gl.renderer.outputColorSpace = THREE.SRGBColorSpace;
  gl.renderer.toneMapping = THREE.ACESFilmicToneMapping;
  gl.renderer.toneMappingExposure = 1.1;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(THEMES[0].fog, 16, 118);
  const camera = new THREE.PerspectiveCamera(64, 1, 0.1, 1200);

  const hemi = new THREE.HemisphereLight(0xb7b4ff, 0x10102a, 1.1);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.6);
  scene.add(key, key.target);
  const glow = new THREE.DirectionalLight(0xb7b4ff, 1.2);
  scene.add(glow, glow.target);

  const { map, glow: glowMap } = tileTextures(THREE);
  const tileMat = new THREE.MeshStandardMaterial({ map, emissiveMap: glowMap, emissive: 0xffffff, emissiveIntensity: 1.1, roughness: 0.38, metalness: 0.25 });
  const tiles = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.24, 1), tileMat, ROWS_VIS * MAX_PERIM);
  tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  tiles.frustumCulled = false;
  scene.add(tiles);

  const decalTex = chevronTexture(THREE);
  const decals = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: decalTex, color: 0x9ffcff, transparent: true, blending: ADD, depthWrite: false, toneMapped: false }),
    ROWS_VIS * 3,
  );
  decals.frustumCulled = false;
  scene.add(decals);

  const debris = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.24, 1), tileMat, DEBRIS);
  debris.frustumCulled = false;
  scene.add(debris);

  const glowTex = glowTexture(THREE);
  const sparks = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ map: glowTex, transparent: true, blending: ADD, depthWrite: false, toneMapped: false }),
    SPARKS,
  );
  sparks.frustumCulled = false;
  scene.add(sparks);

  const streaks = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.03, 0.03, 1),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.5, blending: ADD, depthWrite: false, fog: false }),
    STREAKS,
  );
  streaks.frustumCulled = false;
  scene.add(streaks);
  const streakPos = new Float32Array(STREAKS * 3);
  for (let i = 0; i < STREAKS; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 4 + Math.random() * 9;
    streakPos.set([Math.cos(a) * r, Math.sin(a) * r, -Math.random() * 120], i * 3);
  }

  const starGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(STARS * 3);
  const col = new Float32Array(STARS * 3);
  for (let i = 0; i < STARS; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = 420;
    const k = Math.sqrt(1 - u * u);
    pos.set([Math.cos(a) * k * r, u * r, Math.sin(a) * k * r], i * 3);
    const tint = 0.6 + Math.random() * 0.4;
    const warm = Math.random();
    col.set([tint, tint * (0.85 + 0.15 * warm), tint * (0.75 + 0.25 * (1 - warm))], i * 3);
  }
  starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  starGeo.setAttribute('tint', new THREE.BufferAttribute(col, 3));
  const stars = new THREE.Points(starGeo, new THREE.ShaderMaterial({ vertexShader: STAR_VERT, fragmentShader: STAR_FRAG, uniforms: { size: { value: 1.7 * Math.min(2, window.devicePixelRatio || 1) } }, transparent: true, depthWrite: false }));
  stars.renderOrder = -1;
  scene.add(stars);

  const skyMat = new THREE.MeshBasicMaterial({ map: skyTexture(THREE), side: THREE.BackSide, fog: false, depthWrite: false, color: THEMES[0].sky });
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMat);
  sky.renderOrder = -2;
  scene.add(sky);

  const planet = new THREE.Group();
  const planetMat = new THREE.MeshStandardMaterial({ map: planetTexture(THREE), color: THEMES[0].planet, roughness: 0.9, fog: false });
  const ball = new THREE.Mesh(new THREE.SphereGeometry(42, 40, 24), planetMat);
  planet.add(ball);
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(56, 82, 64),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.22, side: THREE.DoubleSide, fog: false, depthWrite: false }),
  );
  ring.rotation.x = Math.PI * 0.42;
  ring.rotation.y = 0.25;
  planet.add(ring);
  const moon = new THREE.Mesh(new THREE.SphereGeometry(9, 24, 16), new THREE.MeshStandardMaterial({ color: 0xb9bccc, roughness: 1, fog: false }));
  moon.position.set(120, 40, -60);
  planet.add(moon);
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffffff, transparent: true, opacity: 0.28, blending: ADD, depthWrite: false, fog: false }));
  halo.scale.set(150, 150, 1);
  planet.add(halo);
  scene.add(planet);

  const rings: T.Mesh[] = [];
  for (let i = 0; i < 3; i++) {
    const m = new THREE.Mesh(undefined, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.9, blending: ADD, depthWrite: false, toneMapped: false }));
    m.visible = false;
    scene.add(m);
    rings.push(m);
  }

  const cells: T.Group[] = [];
  for (let i = 0; i < 3; i++) {
    const g = new THREE.Group();
    const gem = new THREE.Mesh(new THREE.IcosahedronGeometry(0.2, 0), new THREE.MeshStandardMaterial({ color: 0xfff1a8, emissive: 0xffc93a, emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.3 }));
    g.add(gem);
    const h = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0xffd166, transparent: true, blending: ADD, depthWrite: false }));
    h.scale.set(1.1, 1.1, 1);
    g.add(h);
    g.visible = false;
    scene.add(g);
    cells.push(g);
  }

  const you = makeRunner(THREE, accent);
  scene.add(you.root);

  const t0 = THEMES[0];
  const w: World = {
    THREE,
    gl,
    scene,
    camera,
    tiles,
    tileMat,
    decals,
    decalTex,
    debris,
    debrisList: [],
    sparks,
    sparkList: [],
    streaks,
    streakPos,
    stars,
    sky,
    skyMat,
    planet,
    planetMat,
    rings,
    ringGeo: new Map(),
    cells,
    hemi,
    key,
    glow,
    you,
    ghosts: new Map(),
    labels: new Map(),
    col: {
      tile: new THREE.Color(t0.tile),
      edge: new THREE.Color(t0.edge),
      crumb: new THREE.Color(t0.crumb),
      fog: new THREE.Color(t0.fog),
      sky: new THREE.Color(t0.sky),
      light: new THREE.Color(t0.light),
      planet: new THREE.Color(t0.planet),
    },
    dark: 0,
    roll: 0,
    rollV: 0,
    anchor: new THREE.Vector3(0, -APOTHEM, 0),
    fov: 64,
    shake: 0,
    time: 0,
    m: new THREE.Matrix4(),
    q: new THREE.Quaternion(),
    e: new THREE.Euler(),
    v: new THREE.Vector3(),
    v2: new THREE.Vector3(),
    sc: new THREE.Vector3(),
    c: new THREE.Color(),
    zero: new THREE.Matrix4().makeScale(0, 0, 0),
    w: 1,
    h: 1,
  };
  return w;
}

export function resizeWorld(w: World, width: number, height: number) {
  if (width <= 0 || height <= 0) return;
  w.w = width;
  w.h = height;
  w.gl.renderer.setSize(width, height, false);
  w.camera.aspect = width / height;
  // short wide strips get a lower, wider view so the tunnel ahead still reads
  w.camera.updateProjectionMatrix();
}

function ringGeometry(w: World, sides: number) {
  let g = w.ringGeo.get(sides);
  if (!g) {
    const R = APOTHEM / Math.cos(Math.PI / sides);
    g = new w.THREE.TorusGeometry(R + 0.08, 0.06, 6, sides);
    g.rotateZ(-Math.PI / 2 + Math.PI / sides);
    w.ringGeo.set(sides, g);
  }
  return g;
}

function spark(w: World, p: T.Vector3, v: T.Vector3, color: number | T.Color, life: number, size: number, g = 0) {
  let sp = w.sparkList.find((s) => s.life <= 0);
  if (!sp) {
    if (w.sparkList.length >= SPARKS) return;
    sp = { p: new w.THREE.Vector3(), v: new w.THREE.Vector3(), life: 0, max: 1, size: 1, color: new w.THREE.Color(), g: 0 };
    w.sparkList.push(sp);
  }
  sp.p.copy(p);
  sp.v.copy(v);
  sp.life = sp.max = life;
  sp.size = size;
  sp.g = g;
  if (typeof color === 'number') sp.color.setHex(color);
  else sp.color.copy(color);
}

/** Bursts at the feet: n sparks spread along the floor, pushed up off it. */
function burst(w: World, z: Zone, side: number, x: number, h: number, dist: number, n: number, color: number | T.Color, speed: number, up: number, size = 0.18) {
  const r = side * turnOf(z);
  const nx = -Math.sin(r);
  const ny = Math.cos(r);
  const tx = Math.cos(r);
  const ty = Math.sin(r);
  place(w.v2, z, side, x, h, dist);
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const s = speed * (0.4 + Math.random() * 0.6);
    const lat = Math.cos(a) * s;
    const fwd = Math.sin(a) * s;
    const u = up * (0.5 + Math.random());
    w.v.set(tx * lat + nx * u, ty * lat + ny * u, fwd);
    spark(w, w.v2, w.v, color, 0.35 + Math.random() * 0.35, size * (0.6 + Math.random() * 0.8));
  }
}

function ghostFor(w: World, seat: number, color: number) {
  let g = w.ghosts.get(seat);
  if (!g) {
    g = { runner: makeRunner(w.THREE, color, 0xdfe4f2), roll: 0, seen: 0 };
    w.scene.add(g.runner.root);
    w.ghosts.set(seat, g);
  }
  return g;
}

export function syncWorld(w: World, s: State, dt: number, ev: Events, ghosts: readonly GhostView[]) {
  const THREE = w.THREE;
  w.time += dt;
  const z = ZONES[s.zi];
  const theme = THEMES[s.zi];
  const k = 1 - Math.exp(-2.2 * dt);
  w.col.tile.lerp(w.c.setHex(theme.tile), k);
  w.col.edge.lerp(w.c.setHex(theme.edge), k);
  w.col.crumb.lerp(w.c.setHex(theme.crumb), k);
  w.col.fog.lerp(w.c.setHex(theme.fog), k);
  w.col.sky.lerp(w.c.setHex(theme.sky), k);
  w.col.light.lerp(w.c.setHex(theme.light), k);
  w.col.planet.lerp(w.c.setHex(theme.planet), k);
  w.dark = damp(w.dark, z.dark ? 1 : 0, 2, dt);
  const fog = w.scene.fog as T.Fog;
  fog.color.copy(w.col.fog);
  fog.near = 16 - 9 * w.dark;
  fog.far = 118 - 66 * w.dark;
  w.tileMat.emissive.copy(w.col.edge);
  w.tileMat.emissiveIntensity = 1.1 + 0.5 * w.dark;
  w.skyMat.color.copy(w.col.sky).multiplyScalar(1 - 0.6 * w.dark);
  w.planetMat.color.copy(w.col.planet);
  w.hemi.color.copy(w.col.light);
  w.hemi.intensity = 1.1 - 0.75 * w.dark;
  w.glow.color.copy(w.col.light);
  w.glow.intensity = 0.9 + 1.4 * w.dark;
  w.key.intensity = 1.6 - 1.1 * w.dark;

  // you
  const r = s.side * turnOf(z);
  const blink = s.blink > 0 && Math.floor(s.blink * 12) % 2 === 0;
  place(w.v, z, s.side, s.x, s.h, s.dist);
  w.you.root.position.copy(w.v);
  w.you.root.rotation.set(0, 0, r);
  w.you.root.visible = !blink && !s.dead;
  animateRunner(w.you, s.hold > 0 ? 0 : dt, { speed: s.hold > 0 ? 0 : s.speed, grounded: s.grounded, vy: s.vy, falling: s.falling, vx: s.vx, landed: ev.landed });
  place(w.v2, z, s.side, s.x, s.h + 1.1, s.dist - 0.4);
  w.glow.position.copy(w.v2);
  w.glow.target.position.copy(w.you.root.position);

  if (ev.jumped) burst(w, z, s.side, s.x, 0.05, s.dist, 8, w.col.edge, 2.2, 0.8);
  if (ev.landed) {
    burst(w, z, s.side, s.x, 0.05, s.dist, 12, w.col.edge, 3, 0.6);
    w.shake = Math.max(w.shake, 0.08);
  }
  if (ev.boosted) burst(w, z, s.side, s.x, 0.1, s.dist, 18, 0x9ffcff, 4, 1.2, 0.22);
  if (ev.cell) burst(w, z, s.side, s.x, s.h + 0.5, s.dist, 26, 0xffd166, 4, 2, 0.24);
  if (ev.respawned) burst(w, z, s.side, s.x, 0.4, s.dist, 24, 0xffffff, 3, 2);
  if (ev.finished) for (let i = 0; i < 3; i++) burst(w, z, s.side, s.x, 1, s.dist - 2, 16, SEAT_COLORS[i], 6, 4, 0.22);
  if (!s.grounded && !s.falling && Math.random() < 0.7) {
    place(w.v2, z, s.side, s.x, s.h + 0.45, s.dist - 0.25);
    w.v.set(0, 0, s.speed * 0.6);
    spark(w, w.v2, w.v, 0xff8a3d, 0.25, 0.16);
  }
  if (s.boost > 0 && s.grounded) {
    place(w.v2, z, s.side, s.x + (Math.random() - 0.5) * 0.4, 0.1, s.dist - 0.3);
    w.v.set(0, 0, s.speed * 0.5);
    spark(w, w.v2, w.v, 0x9ffcff, 0.3, 0.2 * (s.boost / BOOST_TIME) + 0.08);
  }
  for (const d of ev.dropped) {
    const dz = ZONES[zoneIndexAt(s.track, d.row)];
    let deb = w.debrisList.find((x) => x.life <= 0);
    if (!deb && w.debrisList.length < DEBRIS) {
      deb = { p: new THREE.Vector3(), v: new THREE.Vector3(), r: 0, spin: 0, life: 0, roll: 0, w: 1, color: new THREE.Color() };
      w.debrisList.push(deb);
    }
    if (!deb) continue;
    const side = Math.floor(d.tile / dz.cols);
    const x = -halfOf(dz) + ((d.tile % dz.cols) + 0.5) * tileWOf(dz);
    place(deb.p, dz, side, x, -0.12, (d.row + 0.5) * ROW_L);
    const rr = side * turnOf(dz);
    deb.v.set(Math.sin(rr) * 3, -Math.cos(rr) * 3, 0);
    deb.roll = rr;
    deb.r = 0;
    deb.spin = (Math.random() - 0.5) * 6;
    deb.life = 1.2;
    deb.w = tileWOf(dz);
    deb.color.copy(w.col.crumb);
  }

  // tunnel
  const row0 = rowOf(s.dist);
  const m = w.m;
  const pal = w.c;
  let di = 0;
  for (let i = -ROWS_BACK; i < ROWS_VIS - ROWS_BACK; i++) {
    const row = row0 + i;
    const slot = ((row % ROWS_VIS) + ROWS_VIS) % ROWS_VIS;
    const zi = zoneIndexAt(s.track, row);
    const rz = ZONES[zi];
    const mask = row < 0 ? 0 : maskAt(s, row);
    const crumb = crumbAt(s, row);
    const boost = boostMaskAt(s, row);
    const P = perimOf(rz);
    const tw = tileWOf(rz);
    const half = halfOf(rz);
    const dist = (row + 0.5) * ROW_L;
    for (let t = 0; t < MAX_PERIM; t++) {
      const idx = slot * MAX_PERIM + t;
      if (t >= P || !hasBit(mask, rz, t)) {
        w.tiles.setMatrixAt(idx, w.zero);
        continue;
      }
      const side = Math.floor(t / rz.cols);
      const x = -half + ((t % rz.cols) + 0.5) * tw;
      let h = -0.12;
      const crumbly = hasBit(crumb, rz, t);
      if (crumbly) {
        const c = s.cracks.find((cr) => cr.row === row && cr.tile === t);
        if (c) h -= (1 - c.t / CRUMBLE_DELAY) * 0.12 + Math.sin(w.time * 70 + t) * 0.03;
        pal.copy(w.col.crumb);
        if (c) pal.lerp(w.c.setHex(0xff5a3c), 0.6 * (1 - c.t / CRUMBLE_DELAY));
      } else {
        pal.copy(w.col.tile);
        const v = (row + t) & 1 ? 0.88 : 1;
        pal.multiplyScalar(v);
      }
      place(w.v, rz, side, x, h, dist);
      w.q.setFromEuler(w.e.set(0, 0, side * turnOf(rz)));
      w.sc.set(tw * 0.96, 1, ROW_L * 0.96);
      m.compose(w.v, w.q, w.sc);
      w.tiles.setMatrixAt(idx, m);
      w.tiles.setColorAt(idx, pal);
      if (hasBit(boost, rz, t) && di < w.decals.count) {
        place(w.v, rz, side, x, 0.015, dist);
        w.sc.set(tw * 0.7, 1, ROW_L * 0.8);
        m.compose(w.v, w.q, w.sc);
        w.decals.setMatrixAt(di++, m);
      }
    }
  }
  for (let i = di; i < w.decals.count; i++) w.decals.setMatrixAt(i, w.zero);
  w.decals.instanceMatrix.needsUpdate = true;
  w.decalTex.offset.y = (w.time * 2.2) % 1;
  w.tiles.instanceMatrix.needsUpdate = true;
  if (w.tiles.instanceColor) w.tiles.instanceColor.needsUpdate = true;

  // gates at zone changes and the finish
  const gates: { row: number; color: number; zi: number }[] = [];
  const zr = s.track.zoneRows;
  if (Number.isFinite(zr)) {
    const next = (Math.floor(row0 / zr) + 1) * zr;
    if (next - row0 < ROWS_VIS && next < s.track.finish) gates.push({ row: next, color: THEMES[zoneIndexAt(s.track, next)].edge, zi: zoneIndexAt(s.track, next) });
  }
  if (Number.isFinite(s.track.finish)) for (let i = 0; i < 2; i++) gates.push({ row: s.track.finish + i * 2, color: i ? 0xffd166 : 0xffffff, zi: zoneIndexAt(s.track, s.track.finish) });
  w.rings.forEach((ring, i) => {
    const g = gates[i];
    ring.visible = !!g && g.row - row0 < ROWS_VIS && g.row >= row0 - 2;
    if (!g || !ring.visible) return;
    ring.geometry = ringGeometry(w, ZONES[g.zi].sides);
    ring.position.set(0, 0, -g.row * ROW_L);
    const pulse = 1 + Math.sin(w.time * 5 + i) * 0.02;
    ring.scale.set(pulse, pulse, 1);
    (ring.material as T.MeshBasicMaterial).color.setHex(g.color);
  });

  // cells
  w.cells.forEach((g, i) => {
    const c = s.cells[i];
    g.visible = !!c && !c.got && c.row - row0 < ROWS_VIS && c.row >= row0 - 1;
    if (!c || !g.visible) return;
    const cz = ZONES[zoneIndexAt(s.track, c.row)];
    const side = Math.floor(c.tile / cz.cols);
    place(g.position, cz, side, -halfOf(cz) + ((c.tile % cz.cols) + 0.5) * tileWOf(cz), c.h + 0.35 + Math.sin(w.time * 3 + i) * 0.06, (c.row + 0.5) * ROW_L);
    g.children[0].rotation.y = w.time * 2.4;
    g.rotation.z = side * turnOf(cz);
  });

  // other runners
  const live = new Set<number>();
  for (const gv of ghosts) {
    live.add(gv.seat);
    const g = ghostFor(w, gv.seat, gv.color);
    const gz = ZONES[zoneIndexAt(s.track, rowOf(gv.dist))];
    const [side, x] = fromU(gz, gv.u);
    const roll = side * turnOf(gz);
    g.roll = damp(g.roll, roll, 14, dt);
    if (Math.abs(g.roll - roll) > Math.PI) g.roll = roll;
    w.v.set(0, 0, 0);
    place(g.runner.root.position, gz, side, x, gv.h, gv.dist);
    g.runner.root.rotation.set(0, 0, roll);
    g.runner.root.visible = !(gv.falling && gv.h < -2.5);
    animateRunner(g.runner, dt, { speed: gv.finished ? 0 : s.speed, grounded: gv.h <= 0.02 && !gv.falling, vy: 0, falling: gv.falling, vx: gv.vu, landed: false });
    place(w.v, gz, side, x, gv.h + 1.45, gv.dist);
    w.v.project(w.camera);
    const ahead = gv.dist - s.dist;
    w.labels.set(gv.seat, { x: (w.v.x * 0.5 + 0.5) * w.w, y: (-w.v.y * 0.5 + 0.5) * w.h, on: w.v.z < 1 && ahead > -6 && ahead < 140 && g.runner.root.visible });
  }
  for (const [seat, g] of w.ghosts)
    if (!live.has(seat)) {
      w.scene.remove(g.runner.root);
      disposeTree(g.runner.root);
      w.ghosts.delete(seat);
      w.labels.delete(seat);
    }

  // particles
  let si = 0;
  for (const sp of w.sparkList) {
    if (sp.life <= 0) continue;
    sp.life -= dt;
    if (sp.life <= 0) continue;
    sp.p.addScaledVector(sp.v, dt);
    sp.v.multiplyScalar(Math.exp(-3 * dt));
    const a = sp.life / sp.max;
    const size = sp.size * (0.4 + a);
    w.sc.set(size, size, size);
    m.compose(sp.p, w.camera.quaternion, w.sc);
    w.sparks.setMatrixAt(si, m);
    w.sparks.setColorAt(si, pal.copy(sp.color).multiplyScalar(a));
    si++;
  }
  for (let i = si; i < SPARKS; i++) w.sparks.setMatrixAt(i, w.zero);
  w.sparks.instanceMatrix.needsUpdate = true;
  if (w.sparks.instanceColor) w.sparks.instanceColor.needsUpdate = true;
  let bi = 0;
  for (const d of w.debrisList) {
    if (d.life <= 0) continue;
    d.life -= dt;
    d.p.addScaledVector(d.v, dt);
    d.v.multiplyScalar(1 + dt * 1.5);
    d.r += d.spin * dt;
    w.q.setFromEuler(w.e.set(d.r * 0.6, 0, d.roll + d.r));
    const a = Math.max(0, d.life / 1.2);
    w.sc.set(d.w * 0.96 * a, a, ROW_L * 0.96 * a);
    m.compose(d.p, w.q, w.sc);
    w.debris.setMatrixAt(bi, m);
    w.debris.setColorAt(bi, d.color);
    bi++;
  }
  for (let i = bi; i < DEBRIS; i++) w.debris.setMatrixAt(i, w.zero);
  w.debris.instanceMatrix.needsUpdate = true;
  if (w.debris.instanceColor) w.debris.instanceColor.needsUpdate = true;

  // camera: a spring on the roll so walls swing round smoothly, and a damped anchor behind you
  const target = r;
  w.rollV += ((target - w.roll) * 110 - w.rollV * 21) * dt;
  w.roll += w.rollV * dt;
  if (Math.abs(target - w.roll) > Math.PI * 2) w.roll = target;
  const up = w.v2.set(-Math.sin(w.roll), Math.cos(w.roll), 0);
  place(w.v, z, s.side, s.x, Math.max(-1.5, s.h * 0.45), s.dist);
  w.v.multiplyScalar(0.8).setZ(-s.dist);
  if (s.hold > 0 && s.time === 0) w.anchor.copy(w.v);
  w.anchor.x = damp(w.anchor.x, w.v.x, 10, dt);
  w.anchor.y = damp(w.anchor.y, w.v.y, 10, dt);
  w.anchor.z = w.v.z;
  w.shake = Math.max(0, w.shake - dt * 0.5);
  const aspect = w.w / w.h;
  const back = aspect > 2.4 ? 3.2 : 3.9;
  const lift = aspect > 2.4 ? 1.35 : 1.7;
  const cam = w.camera;
  cam.position.copy(w.anchor).addScaledVector(up, lift).setZ(w.anchor.z + back);
  if (w.shake > 0) cam.position.addScaledVector(up, (Math.random() - 0.5) * w.shake);
  cam.up.copy(up);
  w.v.copy(w.anchor).addScaledVector(up, 0.55).setZ(w.anchor.z - 7);
  cam.lookAt(w.v);
  const fov = 62 + ((s.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED)) * 10 + (s.boost > 0 ? 6 : 0) + (aspect > 2.4 ? -8 : 0);
  w.fov = damp(w.fov, fov, 4, dt);
  if (Math.abs(cam.fov - w.fov) > 0.05) {
    cam.fov = w.fov;
    cam.updateProjectionMatrix();
  }
  w.key.position.copy(cam.position).addScaledVector(up, 4).setZ(cam.position.z + 2);
  w.key.target.position.copy(w.anchor);

  // space around the tube
  w.sky.position.copy(cam.position);
  w.stars.position.copy(cam.position);
  w.stars.rotation.z = w.roll * 0.15;
  w.planet.position.set(cam.position.x - 150, cam.position.y + 70, cam.position.z - 380);
  w.planet.rotation.y += dt * 0.02;
  const sv = s.speed * (s.boost > 0 ? 1.6 : 1);
  for (let i = 0; i < STREAKS; i++) {
    let zz = w.streakPos[i * 3 + 2] + sv * dt * 1.5;
    if (zz > 6) zz -= 126;
    w.streakPos[i * 3 + 2] = zz;
    w.v.set(w.streakPos[i * 3], w.streakPos[i * 3 + 1], -s.dist + zz);
    w.sc.set(1, 1, 1.2 + sv * 0.25);
    m.compose(w.v, w.q.identity(), w.sc);
    w.streaks.setMatrixAt(i, m);
  }
  w.streaks.instanceMatrix.needsUpdate = true;
  (w.streaks.material as T.MeshBasicMaterial).color.copy(w.col.edge);
}

export function renderWorld(w: World) {
  if (w.gl.lost()) return;
  w.gl.renderer.render(w.scene, w.camera);
}

export function disposeWorld(w: World) {
  disposeTree(w.scene);
  for (const g of w.ringGeo.values()) g.dispose();
  w.gl.dispose();
}
