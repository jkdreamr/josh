// The 3D world: the circuit and its surroundings built from the track data, the cars, effects (skid marks, tyre
// smoke, glowing brakes), lighting with soft sun shadows and sky reflections, and the cameras. One renderer draws
// one or two viewports (split screen).
import type * as T from 'three';
import { WHEEL_R, createCar as createCarView, createKit, merge, type CarKit, type CarView } from './model.ts';
import type { Race } from './race.ts';
import { TEAMS } from './teams.ts';
import { pointAt, type Circuit } from './track.ts';

type Three = typeof import('three');

export type CamMode = 'chase' | 'tcam' | 'cockpit' | 'nose';
export const CAM_MODES: CamMode[] = ['chase', 'tcam', 'cockpit', 'nose'];

export type ViewSpec = { runner: number; cam: CamMode; back: boolean; x: number; y: number; w: number; h: number };

export type World3D = {
  renderer: T.WebGLRenderer;
  canvas: HTMLCanvasElement;
  lost: () => boolean;
  /** Creates the car models for a race's runners (replacing any previous ones). */
  setRace: (race: Race) => void;
  frame: (race: Race, dt: number, views: ViewSpec[], ghost: GhostPose | null) => void;
  render: (views: ViewSpec[]) => void;
  resize: (w: number, h: number) => void;
  dispose: () => void;
};

export type GhostPose = { x: number; y: number; yaw: number } | null;

const mod = (a: number, n: number) => ((a % n) + n) % n;

// ---------------------------------------------------------------------------------------------------------------
// Procedural textures

function canvas(w: number, h: number) {
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  return { cv, g: cv.getContext('2d')! };
}

/** Value noise on a canvas-sized grid, tileable. */
function noiseField(size: number, cells: number, seed: number) {
  let s = seed;
  const rnd = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
  const grid = new Float32Array(cells * cells).map(() => rnd());
  const out = new Float32Array(size * size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const gx = (x / size) * cells;
      const gy = (y / size) * cells;
      const x0 = Math.floor(gx);
      const y0 = Math.floor(gy);
      const fx = gx - x0;
      const fy = gy - y0;
      const sx = fx * fx * (3 - 2 * fx);
      const sy = fy * fy * (3 - 2 * fy);
      const at = (i: number, j: number) => grid[mod(j, cells) * cells + mod(i, cells)];
      const a = at(x0, y0) + (at(x0 + 1, y0) - at(x0, y0)) * sx;
      const b = at(x0, y0 + 1) + (at(x0 + 1, y0 + 1) - at(x0, y0 + 1)) * sx;
      out[y * size + x] = a + (b - a) * sy;
    }
  return out;
}

function fbm(size: number, seed: number, octaves = 4, base = 4) {
  const out = new Float32Array(size * size);
  let amp = 0.5;
  let total = 0;
  for (let o = 0; o < octaves; o++) {
    const f = noiseField(size, base << o, seed + o * 101);
    for (let i = 0; i < out.length; i++) out[i] += f[i] * amp;
    total += amp;
    amp *= 0.5;
  }
  for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

type Tex = { map: T.Texture; normal?: T.Texture; rough?: T.Texture };

function asphaltTex(THREE: Three, size: number): Tex {
  const h = fbm(size, 7, 4, 8);
  const grit = new Float32Array(size * size).map(() => Math.random());
  const { cv, g } = canvas(size, size);
  const img = g.createImageData(size, size);
  const heights = new Float32Array(size * size);
  for (let i = 0; i < size * size; i++) {
    const stone = grit[i] > 0.86 ? (grit[i] - 0.86) * 3 : 0;
    const v = 52 + (h[i] - 0.5) * 18 + stone * 40 - (grit[i] < 0.1 ? 10 : 0);
    heights[i] = stone + h[i] * 0.4;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v + 1;
    img.data[i * 4 + 2] = v + 4;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map, normal: normalFrom(THREE, heights, size, 2.2) };
}

function normalFrom(THREE: Three, h: Float32Array, size: number, strength: number) {
  const { cv, g } = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const at = (i: number, j: number) => h[mod(j, size) * size + mod(i, size)];
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      img.data[i] = (-dx / l) * 127 + 128;
      img.data[i + 1] = (-dy / l) * 127 + 128;
      img.data[i + 2] = (1 / l) * 127 + 128;
      img.data[i + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(cv);
}

function grassTex(THREE: Three, size: number): Tex {
  const h = fbm(size, 3, 5, 4);
  const fine = new Float32Array(size * size).map(() => Math.random());
  const { cv, g } = canvas(size, size);
  const img = g.createImageData(size, size);
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // mowing stripes: two shades across the tile
      const stripe = x < size / 2 ? 1 : 0.88;
      const n = h[i] * 0.5 + 0.75;
      const f = 0.9 + fine[i] * 0.2;
      img.data[i * 4] = 62 * n * f * stripe;
      img.data[i * 4 + 1] = 104 * n * f * stripe;
      img.data[i * 4 + 2] = 38 * n * f * stripe;
      img.data[i * 4 + 3] = 255;
    }
  g.putImageData(img, 0, 0);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function gravelTex(THREE: Three, size: number): Tex {
  const { cv, g } = canvas(size, size);
  g.fillStyle = '#b8a888';
  g.fillRect(0, 0, size, size);
  for (let i = 0; i < size * size * 0.6; i++) {
    const l = 120 + Math.random() * 100;
    g.fillStyle = `rgb(${l},${l * 0.92},${l * 0.78})`;
    g.fillRect(Math.random() * size, Math.random() * size, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function kerbTex(THREE: Three): Tex {
  const { cv, g } = canvas(64, 128);
  g.fillStyle = '#d81e1e';
  g.fillRect(0, 0, 64, 64);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 64, 64, 64);
  // painted edge grooves
  g.fillStyle = 'rgba(0,0,0,0.18)';
  for (let x = 6; x < 64; x += 14) g.fillRect(x, 0, 2, 128);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function wallTex(THREE: Three): Tex {
  const { cv, g } = canvas(1024, 64);
  const ads = [
    ['#0b2a5c', '#ffffff', 'GRAND PRIX'],
    ['#e10600', '#ffffff', 'MONZA'],
    ['#101418', '#f5c400', 'TEMPO'],
    ['#f2f2f2', '#c8102e', 'AUTODROMO'],
    ['#0b5c4c', '#cedc00', 'VELOCE'],
    ['#ff8000', '#101010', 'CORSA'],
    ['#1a2c6b', '#9cb6ff', 'PARCO'],
    ['#2b2b2b', '#52e252', 'BRIANZA'],
  ];
  const w = 1024 / ads.length;
  ads.forEach(([bg, fg, text], k) => {
    g.fillStyle = bg;
    g.fillRect(k * w, 0, w, 64);
    g.fillStyle = fg;
    g.font = 'bold 34px Arial, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, k * w + w / 2, 34, w - 10);
  });
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 4;
  return { map };
}

function fenceTex(THREE: Three): Tex {
  const { cv, g } = canvas(64, 64);
  g.clearRect(0, 0, 64, 64);
  g.strokeStyle = 'rgba(200,205,210,0.9)';
  g.lineWidth = 1.5;
  for (let k = -64; k < 128; k += 8) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + 64, 64);
    g.moveTo(k + 64, 0);
    g.lineTo(k, 64);
    g.stroke();
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function tyreWallTex(THREE: Three): Tex {
  const { cv, g } = canvas(128, 64);
  g.fillStyle = '#121214';
  g.fillRect(0, 0, 128, 64);
  for (let row = 0; row < 3; row++)
    for (let k = 0; k < 6; k++) {
      const x = k * 22 + (row % 2) * 11 + 6;
      const y = row * 21 + 11;
      g.fillStyle = '#1d1e21';
      g.beginPath();
      g.arc(x, y, 10, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#0a0a0b';
      g.beginPath();
      g.arc(x, y, 4, 0, Math.PI * 2);
      g.fill();
    }
  g.fillStyle = '#d81e1e';
  g.fillRect(0, 26, 128, 6);
  g.fillStyle = '#f2f2f2';
  g.fillRect(0, 32, 128, 6);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function crowdTex(THREE: Three): Tex {
  const { cv, g } = canvas(256, 128);
  g.fillStyle = '#2a2d33';
  g.fillRect(0, 0, 256, 128);
  const colors = ['#c8102e', '#e8e8e8', '#ffd200', '#1e7dd8', '#ff8000', '#d81e1e', '#2b2b2b', '#e10600', '#f2b8a0', '#5b3a29'];
  for (let i = 0; i < 2600; i++) {
    g.fillStyle = colors[Math.floor(Math.random() * colors.length)];
    const x = Math.random() * 256;
    const y = Math.floor(Math.random() * 8) * 16 + 4 + Math.random() * 7;
    g.fillRect(x, y, 2, 3);
  }
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function boardTex(THREE: Three, label: string): Tex {
  const { cv, g } = canvas(64, 96);
  g.fillStyle = '#f4f4f4';
  g.fillRect(0, 0, 64, 96);
  g.fillStyle = '#111';
  g.font = 'bold 30px Arial, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.fillText(label, 32, 48);
  g.strokeStyle = '#111';
  g.lineWidth = 4;
  g.strokeRect(3, 3, 58, 90);
  const map = new THREE.CanvasTexture(cv);
  map.colorSpace = THREE.SRGBColorSpace;
  return { map };
}

function blobTex(THREE: Three) {
  const { cv, g } = canvas(64, 128);
  const grad = g.createRadialGradient(32, 64, 4, 32, 64, 60);
  grad.addColorStop(0, 'rgba(0,0,0,0.75)');
  grad.addColorStop(0.6, 'rgba(0,0,0,0.35)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 128);
  return new THREE.CanvasTexture(cv);
}

function puffTex(THREE: Three) {
  const { cv, g } = canvas(64, 64);
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(cv);
}

// ---------------------------------------------------------------------------------------------------------------
// Track geometry

type Ribbon = { pos: number[]; uv: number[]; idx: number[] };

/**
 * A strip along the track between two lateral offsets (positive left), only where `on(i)` holds. The texture's v runs
 * along the track (`vScale` meters per repeat) and u across it (`uScale` meters per repeat, or 0 for 0..1 across).
 */
function ribbon(c: Circuit, left: (i: number) => number, right: (i: number) => number, y: number | ((i: number, side: 0 | 1) => number), opts: { on?: (i: number) => boolean; vScale?: number; uScale?: number } = {}): Ribbon {
  const out: Ribbon = { pos: [], uv: [], idx: [] };
  const { on, vScale = 10, uScale = 0 } = opts;
  const yAt = typeof y === 'number' ? () => y : y;
  let prev = -1;
  for (let k = 0; k <= c.n; k++) {
    const i = k % c.n;
    if (on && !on(i)) {
      prev = -1;
      continue;
    }
    const nx = -c.ty[i];
    const ny = c.tx[i];
    const l = left(i);
    const r = right(i);
    const v = (k * c.ds) / vScale;
    const base = out.pos.length / 3;
    // three.js: x east, y up, z = -north
    out.pos.push(c.px[i] + nx * l, yAt(i, 0), -(c.py[i] + ny * l));
    out.pos.push(c.px[i] + nx * r, yAt(i, 1), -(c.py[i] + ny * r));
    out.uv.push(uScale ? l / uScale : 0, v, uScale ? r / uScale : 1, v);
    if (prev >= 0) out.idx.push(prev, prev + 1, base, prev + 1, base + 1, base);
    prev = base;
  }
  return out;
}

/** A vertical strip along the track at a lateral offset, from y0 to y1 (walls, fences, tyre barriers). */
function wallStrip(c: Circuit, at: (i: number) => number, y0: number, y1: number, opts: { on?: (i: number) => boolean; uScale?: number } = {}): Ribbon {
  const out: Ribbon = { pos: [], uv: [], idx: [] };
  const { on, uScale = 10 } = opts;
  let prev = -1;
  let u = 0;
  let px = 0;
  let pz = 0;
  for (let k = 0; k <= c.n; k++) {
    const i = k % c.n;
    if (on && !on(i)) {
      prev = -1;
      continue;
    }
    const d = at(i);
    const x = c.px[i] - c.ty[i] * d;
    const z = -(c.py[i] + c.tx[i] * d);
    if (prev >= 0) u += Math.hypot(x - px, z - pz) / uScale;
    px = x;
    pz = z;
    const base = out.pos.length / 3;
    out.pos.push(x, y0, z, x, y1, z);
    out.uv.push(u, 0, u, 1);
    if (prev >= 0) out.idx.push(prev, base, prev + 1, prev + 1, base, base + 1);
    prev = base;
  }
  return out;
}

function geo(THREE: Three, rb: Ribbon) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(rb.pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(rb.uv, 2));
  g.setIndex(rb.idx);
  g.computeVertexNormals();
  return g;
}

// ---------------------------------------------------------------------------------------------------------------
// Sky

const SKY_VERT = `
varying vec3 vDir;
void main() {
  vDir = normalize(position);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p.xyww;
}`;
const SKY_FRAG = `
uniform vec3 sunDir;
varying vec3 vDir;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0; float a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 top = vec3(0.12, 0.32, 0.72);
  vec3 hor = vec3(0.62, 0.74, 0.86);
  vec3 col = mix(hor, top, pow(clamp(h, 0.0, 1.0), 0.45));
  if (h < 0.0) col = mix(hor, vec3(0.34, 0.4, 0.33), clamp(-h * 6.0, 0.0, 1.0));
  float sd = max(dot(d, sunDir), 0.0);
  col += vec3(1.0, 0.9, 0.7) * pow(sd, 6.0) * 0.28 + vec3(1.0, 0.95, 0.85) * pow(sd, 1200.0) * 30.0;
  if (h > 0.0) {
    vec2 uv = d.xz / (h + 0.12) * 1.4;
    float n = fbm(uv * 1.7 + vec2(3.0, 7.0));
    float cl = smoothstep(0.52, 0.8, n) * smoothstep(0.0, 0.18, h);
    vec3 cloud = mix(vec3(0.78, 0.8, 0.84), vec3(1.0, 0.98, 0.95), smoothstep(0.5, 0.9, n) * 0.6 + sd * 0.4);
    col = mix(col, cloud, cl * 0.9);
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ---------------------------------------------------------------------------------------------------------------

export function createWorld(THREE: Three, host: HTMLElement, race: Race, opts: { lite: boolean }): World3D | null {
  const lite = opts.lite;
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: !lite, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, lite ? 1.25 : 1.75));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = !lite;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.autoClear = false;
  const canvasEl = renderer.domElement;
  canvasEl.style.display = 'block';
  canvasEl.style.width = '100%';
  canvasEl.style.height = '100%';
  canvasEl.style.touchAction = 'none';
  host.appendChild(canvasEl);
  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
  };
  canvasEl.addEventListener('webglcontextlost', onLost);
  canvasEl.addEventListener('webglcontextrestored', onRestored);

  const c = race.c;
  const scene = new THREE.Scene();
  const disposables: { dispose: () => void }[] = [];
  const keep = <D extends { dispose: () => void }>(d: D) => {
    disposables.push(d);
    return d;
  };
  const sunDir = new THREE.Vector3(-0.45, 0.62, 0.38).normalize();
  scene.fog = new THREE.Fog(0xa8bccd, 600, lite ? 2200 : 3200);

  // sky dome and image based lighting from it
  const skyMat = keep(
    new THREE.ShaderMaterial({ vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, uniforms: { sunDir: { value: sunDir } }, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  const skyGeo = keep(new THREE.SphereGeometry(1000, 32, 16));
  const sky = new THREE.Mesh(skyGeo, skyMat);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(skyGeo, skyMat);
  envScene.add(envSky);
  const env = pmrem.fromScene(envScene, 0.02);
  scene.environment = env.texture;
  scene.environmentIntensity = 0.75;
  pmrem.dispose();

  const hemi = new THREE.HemisphereLight(0xcfe2ff, 0x4f5a3a, 0.55);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 3.1);
  sun.castShadow = !lite;
  sun.shadow.mapSize.set(2048, 2048);
  const sc = sun.shadow.camera;
  sc.left = -70;
  sc.right = 70;
  sc.top = 70;
  sc.bottom = -70;
  sc.near = 10;
  sc.far = 600;
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const rep = (t: T.Texture, n = 1) => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = aniso;
    if (n !== 1) t.repeat.set(n, n);
    return keep(t);
  };

  // ground
  const grass = grassTex(THREE, lite ? 256 : 512);
  rep(grass.map);
  grass.map.repeat.set(4000 / 24, 4000 / 24);
  // subdivided so no triangle is huge (big clipped triangles lose depth precision), and pushed back in depth so the
  // track surfaces always win over it
  const groundGeo = keep(new THREE.PlaneGeometry(8000, 8000, 80, 80));
  groundGeo.rotateX(-Math.PI / 2);
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < c.n; i++) {
    cx += c.px[i] / c.n;
    cz -= c.py[i] / c.n;
  }
  const ground = new THREE.Mesh(groundGeo, keep(new THREE.MeshStandardMaterial({ map: grass.map, roughness: 0.95, metalness: 0, polygonOffset: true, polygonOffsetFactor: 2, polygonOffsetUnits: 4 })));
  ground.position.set(cx, 0, cz);
  ground.receiveShadow = !lite;
  scene.add(ground);

  // asphalt
  const asphalt = asphaltTex(THREE, lite ? 256 : 512);
  rep(asphalt.map);
  if (asphalt.normal) rep(asphalt.normal);
  const roadMat = keep(
    new THREE.MeshStandardMaterial({ map: asphalt.map, normalMap: asphalt.normal ?? null, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.82, metalness: 0, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }),
  );
  const road = new THREE.Mesh(keep(geo(THREE, ribbon(c, (i) => c.hw[i], (i) => -c.hw[i], 0.02, { vScale: 6, uScale: 6 }))), roadMat);
  road.receiveShadow = !lite;
  scene.add(road);

  // rubber laid down on the racing line, darker in the braking zones
  const line = race.line;
  const rubberMat = keep(new THREE.MeshBasicMaterial({ color: 0x0c0c0e, transparent: true, opacity: 0.32, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
  const rubberGeo = keep(geo(THREE, ribbon(c, (i) => line.off[i] + 1.0, (i) => line.off[i] - 1.0, 0.021)));
  // fade the rubber out at its edges with vertex alpha through a second, wider and fainter strip
  const rubber = new THREE.Mesh(rubberGeo, rubberMat);
  scene.add(rubber);
  const rubber2 = new THREE.Mesh(keep(geo(THREE, ribbon(c, (i) => line.off[i] + 1.9, (i) => line.off[i] - 1.9, 0.0205))), keep(new THREE.MeshBasicMaterial({ color: 0x0c0c0e, transparent: true, opacity: 0.14, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 })));
  scene.add(rubber2);

  // white lines at the track edges, and the start line
  const paint = keep(new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
  const lineL = ribbon(c, (i) => c.hw[i], (i) => c.hw[i] - 0.22, 0.023);
  const lineR = ribbon(c, (i) => -c.hw[i] + 0.22, (i) => -c.hw[i], 0.023);
  scene.add(new THREE.Mesh(keep(geo(THREE, joinRibbons([lineL, lineR]))), paint));
  {
    const p = pointAt(c, 0);
    const g = keep(new THREE.PlaneGeometry(0.5, c.hw[0] * 2));
    g.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(g, paint);
    m.position.set(p.x, 0.024, -p.y);
    m.rotation.y = p.heading;
    scene.add(m);
    // grid boxes
    for (let k = 0; k < 20; k++) {
      const s = -14 - k * 8;
      const d = k % 2 === 0 ? 2.6 : -2.6;
      const q = pointAt(c, s + 2.8, d);
      const bar = keep(new THREE.PlaneGeometry(0.2, 2.2));
      bar.rotateX(-Math.PI / 2);
      const bm = new THREE.Mesh(bar, paint);
      bm.position.set(q.x, 0.024, -q.y);
      bm.rotation.y = q.heading;
      scene.add(bm);
    }
  }

  // kerbs: red and white, a touch raised
  const kerb = kerbTex(THREE);
  rep(kerb.map);
  const kerbMat = keep(new THREE.MeshStandardMaterial({ map: kerb.map, roughness: 0.55, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const kerbs = joinRibbons([
    ribbon(c, (i) => c.hw[i] + c.kerbL[i], (i) => c.hw[i], (_i, side) => (side === 0 ? 0.03 : 0.06), { on: (i) => c.kerbL[i] > 0, vScale: 2 }),
    ribbon(c, (i) => -c.hw[i], (i) => -c.hw[i] - c.kerbR[i], (_i, side) => (side === 0 ? 0.06 : 0.03), { on: (i) => c.kerbR[i] > 0, vScale: 2 }),
  ]);
  const kerbMesh = new THREE.Mesh(keep(geo(THREE, kerbs)), kerbMat);
  kerbMesh.receiveShadow = !lite;
  scene.add(kerbMesh);

  // run-off: gravel traps and tarmac run-off areas
  const gravel = gravelTex(THREE, 256);
  rep(gravel.map);
  const gravelMat = keep(new THREE.MeshStandardMaterial({ map: gravel.map, roughness: 1, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  // tarmac run-off is painted, so from the cockpit it never reads as racing surface
  const runoffMat = keep(new THREE.MeshStandardMaterial({ map: asphalt.map, color: 0x7fb08c, roughness: 0.9, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
  const pitMatLane = keep(new THREE.MeshStandardMaterial({ map: asphalt.map, color: 0xc4c4c4, roughness: 0.85 }));
  const kerbOut = (i: number, side: number) => c.hw[i] + (side > 0 ? c.kerbL[i] : c.kerbR[i]);
  const gravelR = joinRibbons([
    ribbon(c, (i) => c.wallL[i] - 0.5, (i) => kerbOut(i, 1) + 3, 0.012, { on: (i) => c.runL[i] === 1 && c.wallL[i] - 0.5 > kerbOut(i, 1) + 3, vScale: 8, uScale: 8 }),
    ribbon(c, (i) => -kerbOut(i, -1) - 3, (i) => -c.wallR[i] + 0.5, 0.012, { on: (i) => c.runR[i] === 1 && c.wallR[i] - 0.5 > kerbOut(i, -1) + 3, vScale: 8, uScale: 8 }),
    ribbon(c, (i) => c.wallL[i] - 0.5, (i) => kerbOut(i, 1) + 14, 0.012, { on: (i) => c.runL[i] === 2 && c.wallL[i] - 0.5 > kerbOut(i, 1) + 14, vScale: 8, uScale: 8 }),
    ribbon(c, (i) => -kerbOut(i, -1) - 14, (i) => -c.wallR[i] + 0.5, 0.012, { on: (i) => c.runR[i] === 2 && c.wallR[i] - 0.5 > kerbOut(i, -1) + 14, vScale: 8, uScale: 8 }),
  ]);
  scene.add(new THREE.Mesh(keep(geo(THREE, gravelR)), gravelMat));
  const tarmac = joinRibbons([
    ribbon(c, (i) => Math.min(c.wallL[i] - 0.5, kerbOut(i, 1) + 14), (i) => kerbOut(i, 1), 0.014, { on: (i) => c.runL[i] === 2, vScale: 6, uScale: 6 }),
    ribbon(c, (i) => -kerbOut(i, -1), (i) => -Math.min(c.wallR[i] - 0.5, kerbOut(i, -1) + 14), 0.014, { on: (i) => c.runR[i] === 2, vScale: 6, uScale: 6 }),
  ]);
  const tarmacMesh = new THREE.Mesh(keep(geo(THREE, tarmac)), runoffMat);
  tarmacMesh.receiveShadow = !lite;
  scene.add(tarmacMesh);

  // barriers: concrete walls with advertising, catch fencing on top, tyre walls on the outside of corners
  const wall = wallTex(THREE);
  rep(wall.map);
  const wallMat = keep(new THREE.MeshStandardMaterial({ map: wall.map, roughness: 0.7, side: THREE.DoubleSide }));
  const walls = joinRibbons([wallStrip(c, (i) => c.wallL[i], 0, 1.05, { uScale: 40 }), wallStrip(c, (i) => -c.wallR[i], 0, 1.05, { uScale: 40 })]);
  const wallMesh = new THREE.Mesh(keep(geo(THREE, walls)), wallMat);
  wallMesh.receiveShadow = !lite;
  wallMesh.castShadow = !lite;
  scene.add(wallMesh);
  const capMat = keep(new THREE.MeshStandardMaterial({ color: 0xd8d8d4, roughness: 0.8 }));
  const caps = joinRibbons([
    ribbon(c, (i) => c.wallL[i] + 0.25, (i) => c.wallL[i], 1.05),
    ribbon(c, (i) => -c.wallR[i], (i) => -c.wallR[i] - 0.25, 1.05),
    wallStrip(c, (i) => c.wallL[i] + 0.25, 0, 1.05, { uScale: 40 }),
    wallStrip(c, (i) => -c.wallR[i] - 0.25, 0, 1.05, { uScale: 40 }),
  ]);
  scene.add(new THREE.Mesh(keep(geo(THREE, caps)), capMat));
  const fence = fenceTex(THREE);
  rep(fence.map);
  const fenceMat = keep(new THREE.MeshStandardMaterial({ map: fence.map, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide, roughness: 0.6, metalness: 0.5, depthWrite: true }));
  const fences = joinRibbons([wallStrip(c, (i) => c.wallL[i] + 0.12, 1.05, 4.2, { uScale: 1.2 }), wallStrip(c, (i) => -c.wallR[i] - 0.12, 1.05, 4.2, { uScale: 1.2 })]);
  for (let k = 1; k < fences.uv.length; k += 2) fences.uv[k] *= 2.6;
  scene.add(new THREE.Mesh(keep(geo(THREE, fences)), fenceMat));
  const tyres = tyreWallTex(THREE);
  rep(tyres.map);
  const tyreWallMat = keep(new THREE.MeshStandardMaterial({ map: tyres.map, roughness: 0.95, side: THREE.DoubleSide }));
  const tw = joinRibbons([
    wallStrip(c, (i) => c.wallL[i] - 0.9, 0, 0.9, { on: (i) => c.runL[i] === 1, uScale: 2.8 }),
    wallStrip(c, (i) => -c.wallR[i] + 0.9, 0, 0.9, { on: (i) => c.runR[i] === 1, uScale: 2.8 }),
    ribbon(c, (i) => c.wallL[i], (i) => c.wallL[i] - 0.9, 0.9, { on: (i) => c.runL[i] === 1 }),
    ribbon(c, (i) => -c.wallR[i] + 0.9, (i) => -c.wallR[i], 0.9, { on: (i) => c.runR[i] === 1 }),
  ]);
  const tyreWall = new THREE.Mesh(keep(geo(THREE, tw)), tyreWallMat);
  tyreWall.castShadow = !lite;
  scene.add(tyreWall);
  // fence posts every 6 m
  {
    const postGeo = keep(new THREE.CylinderGeometry(0.05, 0.05, 4.2, 5));
    postGeo.translate(0, 2.1, 0);
    const posts: [number, number][] = [];
    for (let i = 0; i < c.n; i += 3) {
      posts.push([i, c.wallL[i] + 0.15], [i, -c.wallR[i] - 0.15]);
    }
    const inst = new THREE.InstancedMesh(postGeo, keep(new THREE.MeshStandardMaterial({ color: 0x8a9096, roughness: 0.5, metalness: 0.7 })), posts.length);
    const m = new THREE.Matrix4();
    posts.forEach(([i, d], k) => {
      m.makeTranslation(c.px[i] - c.ty[i] * d, 0, -(c.py[i] + c.tx[i] * d));
      inst.setMatrixAt(k, m);
    });
    scene.add(inst);
  }

  // the forest of the royal park, kept back from the circuit
  const occupied = buildOccupancy(c);
  {
    const trunkGeo = keep(new THREE.CylinderGeometry(0.25, 0.4, 6, 6));
    trunkGeo.translate(0, 3, 0);
    const crownParts: T.BufferGeometry[] = [];
    const crownColors: T.Color[] = [];
    for (const [x, y, z, r, shade] of [
      [0, 8.6, 0, 3.4, 0.8],
      [1.9, 7.4, 1.0, 2.6, 0.7],
      [-1.7, 7.8, -1.2, 2.8, 0.72],
      [0.6, 11.0, -0.5, 2.6, 1],
      [-0.8, 10.2, 1.4, 2.3, 0.95],
      [1.2, 9.6, -1.8, 2.2, 0.9],
    ] as const) {
      const g = new THREE.IcosahedronGeometry(r, 0);
      g.translate(x, y, z);
      crownParts.push(g);
      crownColors.push(new THREE.Color(shade, shade, shade));
    }
    const crownGeo = keep(merge(THREE, crownParts, crownColors));
    const count = lite ? 1200 : 3600;
    const crowns = new THREE.InstancedMesh(crownGeo, keep(new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.95, flatShading: true })), count);
    const trunks = new THREE.InstancedMesh(trunkGeo, keep(new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 })), count);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const col = new THREE.Color();
    let placed = 0;
    let tries = 0;
    let rs = 12345;
    const rnd = () => {
      rs = (rs * 1664525 + 1013904223) >>> 0;
      return rs / 4294967296;
    };
    while (placed < count && tries < count * 20) {
      tries++;
      const x = occupied.minX - 500 + rnd() * (occupied.maxX - occupied.minX + 1000);
      const y = occupied.minY - 500 + rnd() * (occupied.maxY - occupied.minY + 1000);
      if (occupied.near(x, y, 9)) continue;
      const s = 0.8 + rnd() * 0.7;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rnd() * Math.PI * 2);
      m.compose(new THREE.Vector3(x, 0, -y), q, new THREE.Vector3(s, s * (0.85 + rnd() * 0.4), s));
      crowns.setMatrixAt(placed, m);
      trunks.setMatrixAt(placed, m);
      col.setHSL(0.22 + rnd() * 0.1, 0.32 + rnd() * 0.18, 0.13 + rnd() * 0.08);
      crowns.setColorAt(placed, col);
      placed++;
    }
    crowns.count = trunks.count = placed;
    scene.add(crowns, trunks);
  }

  // grandstands with a crowd along the main straight and at the big corners
  const crowd = crowdTex(THREE);
  rep(crowd.map);
  const standMat = keep(new THREE.MeshStandardMaterial({ map: crowd.map, roughness: 0.9 }));
  const steelMat = keep(new THREE.MeshStandardMaterial({ color: 0xb8bec4, roughness: 0.5, metalness: 0.6 }));
  const standGeo: T.BufferGeometry[] = [];
  const roofGeo: T.BufferGeometry[] = [];
  const stand = (s0: number, s1: number, side: 1 | -1, rows: number, roof: boolean) => {
    for (let s = s0; s < s1; s += 12) {
      const mid = s + 6;
      const i = mod(Math.round(mid / c.ds), c.n);
      const wallD = side > 0 ? c.wallL[i] : c.wallR[i];
      if (occupied.nearOther(i, wallD + 4, side, 8)) continue;
      const p = pointAt(c, mid, side * (wallD + 3));
      for (let r = 0; r < rows; r++) {
        const g = new THREE.BoxGeometry(12.4, 0.9 * (r + 1), 1.4);
        g.translate(0, 0.45 * (r + 1), side * -(r * 1.4 + 0.7));
        g.rotateY(p.heading);
        g.translate(p.x, 0, -p.y);
        standGeo.push(g);
      }
      if (roof) {
        const g = new THREE.BoxGeometry(12.4, 0.3, rows * 1.4 + 2);
        g.translate(0, rows * 0.9 + 3, side * -(rows * 0.7));
        g.rotateY(p.heading);
        g.translate(p.x, 0, -p.y);
        roofGeo.push(g);
      }
    }
  };
  const mk = c.marks;
  stand(mk.main[0] + 150, c.length - 20, 1, 14, true);
  stand(10, 420, 1, 14, true);
  stand(mk.rettifilo[0] - 200, mk.rettifilo[1] + 60, -1, 10, false);
  stand(mk.rettifilo[0] - 80, mk.rettifilo[1] + 40, 1, 8, false);
  stand(mk.roggia[0] - 140, mk.roggia[1] + 30, 1, 8, false);
  stand(mk.lesmo1[0] - 60, mk.lesmo1[1] + 40, 1, 8, false);
  stand(mk.ascari[0] - 50, mk.ascari[1], -1, 9, false);
  stand(mk.parabolica[0] - 80, mk.parabolica[1], 1, 12, false);
  stand(mk.parabolica[1] - 60, mk.parabolica[1] + 260, 1, 12, false);
  if (standGeo.length) {
    const m = new THREE.Mesh(keep(merge(THREE, standGeo)), standMat);
    m.castShadow = m.receiveShadow = !lite;
    scene.add(m);
  }
  if (roofGeo.length) scene.add(new THREE.Mesh(keep(merge(THREE, roofGeo)), steelMat));

  // pit lane and garages on the right of the main straight
  {
    const pitFrom = mk.main[0] + 260;
    const pitTo = c.length + 300;
    const parts: T.BufferGeometry[] = [];
    const lane: T.BufferGeometry[] = [];
    const glass: T.BufferGeometry[] = [];
    for (let s = pitFrom; s < pitTo; s += 10) {
      const i = mod(Math.round(s / c.ds), c.n);
      const d = -(c.wallR[i] + 1);
      const p = pointAt(c, s + 5, d);
      const laneG = new THREE.PlaneGeometry(10.2, 13);
      laneG.rotateX(-Math.PI / 2);
      laneG.translate(0, 0.015, 6.5);
      laneG.rotateY(p.heading);
      laneG.translate(p.x, 0, -p.y);
      lane.push(laneG);
      const g = new THREE.BoxGeometry(10.2, 9, 16);
      g.translate(0, 4.5, 13 + 8);
      g.rotateY(p.heading);
      g.translate(p.x, 0, -p.y);
      parts.push(g);
      const w = new THREE.BoxGeometry(9.6, 2.4, 0.2);
      w.translate(0, 6.8, 13 - 0.05);
      w.rotateY(p.heading);
      w.translate(p.x, 0, -p.y);
      glass.push(w);
    }
    const pitMat = keep(new THREE.MeshStandardMaterial({ color: 0xe9ebee, roughness: 0.6 }));
    const b = new THREE.Mesh(keep(merge(THREE, parts)), pitMat);
    b.castShadow = b.receiveShadow = !lite;
    scene.add(b);
    scene.add(new THREE.Mesh(keep(merge(THREE, lane)), pitMatLane));
    scene.add(new THREE.Mesh(keep(merge(THREE, glass)), keep(new THREE.MeshStandardMaterial({ color: 0x1b2633, roughness: 0.1, metalness: 0.9 }))));
  }

  // start gantry with five pairs of red lights
  const lightMats: T.MeshStandardMaterial[] = [];
  {
    const p = pointAt(c, 8);
    const g = new THREE.Group();
    g.position.set(p.x, 0, -p.y);
    g.rotation.y = p.heading;
    const width = c.wallL[0] + c.wallR[0] + 1;
    const beam = new THREE.Mesh(keep(new THREE.BoxGeometry(0.6, 0.8, width)), steelMat);
    beam.position.set(0, 7, (c.wallR[0] - c.wallL[0]) / 2);
    g.add(beam);
    for (const z of [-c.wallL[0] - 0.4, c.wallR[0] + 0.4]) {
      const post = new THREE.Mesh(keep(new THREE.BoxGeometry(0.5, 7.4, 0.5)), steelMat);
      post.position.set(0, 3.7, z);
      g.add(post);
    }
    const housing = new THREE.Mesh(keep(new THREE.BoxGeometry(0.5, 1.4, 3.6)), keep(new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 0.5 })));
    housing.position.set(-0.3, 6.1, 0);
    g.add(housing);
    const lampGeo = keep(new THREE.CircleGeometry(0.17, 16));
    lampGeo.rotateY(-Math.PI / 2);
    for (let k = 0; k < 5; k++) {
      const mat = keep(new THREE.MeshStandardMaterial({ color: 0x220303, emissive: 0xff0a0a, emissiveIntensity: 0, roughness: 0.3 }));
      lightMats.push(mat);
      for (const y of [6.4, 5.85]) {
        const lamp = new THREE.Mesh(lampGeo, mat);
        lamp.position.set(-0.56, y, (k - 2) * 0.68);
        g.add(lamp);
      }
    }
    scene.add(g);
  }

  // footbridges with advertising across the track
  for (const s of [mk.main[0] + 420, mk.serraglio[0] + 120, mk.back[0] + 380]) {
    const i = mod(Math.round(s / c.ds), c.n);
    const p = pointAt(c, s);
    const width = c.wallL[i] + c.wallR[i] + 8;
    const g = new THREE.Group();
    g.position.set(p.x, 0, -p.y);
    g.rotation.y = p.heading;
    const deck = new THREE.Mesh(keep(new THREE.BoxGeometry(3, 2.2, width)), wallMat);
    deck.position.set(0, 8.2, (c.wallR[i] - c.wallL[i]) / 2);
    deck.castShadow = !lite;
    g.add(deck);
    for (const z of [-c.wallL[i] - 3, c.wallR[i] + 3]) {
      const tower = new THREE.Mesh(keep(new THREE.BoxGeometry(3, 9.3, 3)), capMat);
      tower.position.set(0, 4.65, z);
      tower.castShadow = !lite;
      g.add(tower);
    }
    scene.add(g);
  }

  // braking boards before the big stops, on the outside of the corner
  {
    const boards = [boardTex(THREE, '150'), boardTex(THREE, '100'), boardTex(THREE, '50')];
    const mats = boards.map((b) => keep(new THREE.MeshStandardMaterial({ map: keep(b.map), roughness: 0.6 })));
    const boardGeo = keep(new THREE.BoxGeometry(0.08, 1.5, 1.0));
    boardGeo.translate(0, 1.2, 0);
    for (const name of ['rettifilo', 'roggia', 'lesmo1', 'ascari', 'parabolica']) {
      const s0 = mk[name][0];
      // the corner's first turn tells which side is outside
      const i0 = mod(Math.round((s0 + 10) / c.ds), c.n);
      const side = c.k[i0] > 0 ? 1 : -1;
      [150, 100, 50].forEach((ahead, k) => {
        const s = s0 - ahead;
        const i = mod(Math.round(s / c.ds), c.n);
        const d = side * (c.hw[i] + 4);
        const p = pointAt(c, s, d);
        const b = new THREE.Mesh(boardGeo, mats[k]);
        b.position.set(p.x, 0, -p.y);
        b.rotation.y = p.heading;
        scene.add(b);
      });
    }
  }

  // a distant ring of hills and treeline so the horizon never shows the edge of the ground
  {
    const g = keep(new THREE.CylinderGeometry(3600, 3600, 160, 64, 1, true));
    const { cv, g: x } = canvas(512, 64);
    const grad = x.createLinearGradient(0, 0, 0, 64);
    grad.addColorStop(0, 'rgba(70,96,70,0)');
    grad.addColorStop(0.35, 'rgba(58,82,60,0.9)');
    grad.addColorStop(1, 'rgba(48,64,46,1)');
    x.fillStyle = grad;
    for (let k = 0; k < 512; k += 4) {
      const hgt = 10 + Math.sin(k * 0.05) * 6 + Math.random() * 6;
      x.fillRect(k, 64 - hgt * 2.6, 4, hgt * 2.6);
    }
    const tex = keep(new THREE.CanvasTexture(cv));
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.wrapS = THREE.RepeatWrapping;
    tex.repeat.set(10, 1);
    const ring = new THREE.Mesh(g, keep(new THREE.MeshBasicMaterial({ map: tex, transparent: true, side: THREE.BackSide, fog: true, depthWrite: false })));
    ring.position.set(cx, 70, cz);
    scene.add(ring);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Cars and effects

  const kit: CarKit = createKit(THREE);
  const blob = keep(blobTex(THREE));
  const blobGeo = keep(new THREE.PlaneGeometry(5.8, 2.4));
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = keep(new THREE.MeshBasicMaterial({ map: blob, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
  type CarSlot = { view: CarView; blob: T.Mesh; brakeHeat: number; flap: number; marks: (T.Vector3 | null)[]; spinA: number[] };
  let cars: CarSlot[] = [];
  const carGroup = new THREE.Group();
  scene.add(carGroup);

  // ghost: a translucent car on your best lap
  const ghostView = createCarView(THREE, kit, TEAMS[1], { shadows: false, lite: true });
  const ghostly = (mat: T.Material) => {
    const g = keep(mat.clone());
    g.transparent = true;
    g.opacity = 0.3;
    g.depthWrite = false;
    return g;
  };
  ghostView.root.traverse((o) => {
    const m = o as T.Mesh;
    if (!m.isMesh) return;
    m.material = Array.isArray(m.material) ? m.material.map(ghostly) : ghostly(m.material);
    m.castShadow = false;
  });
  ghostView.root.visible = false;
  scene.add(ghostView.root);

  // skid marks: a ring buffer of quads laid where tyres slide
  const MARKS = lite ? 1500 : 5000;
  const markPos = new Float32Array(MARKS * 4 * 3);
  const markAlpha = new Float32Array(MARKS * 4);
  const markIdx = new Uint32Array(MARKS * 6);
  for (let k = 0; k < MARKS; k++) markIdx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4 + 1, k * 4 + 3, k * 4 + 2], k * 6);
  const markGeo = keep(new THREE.BufferGeometry());
  markGeo.setAttribute('position', new THREE.BufferAttribute(markPos, 3).setUsage(THREE.DynamicDrawUsage));
  markGeo.setAttribute('alpha', new THREE.BufferAttribute(markAlpha, 1).setUsage(THREE.DynamicDrawUsage));
  markGeo.setIndex(new THREE.BufferAttribute(markIdx, 1));
  const markMat = keep(
    new THREE.ShaderMaterial({
      vertexShader: 'attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: 'varying float vA; void main(){ gl_FragColor = vec4(0.02,0.02,0.025, vA); }',
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -3,
      polygonOffsetUnits: -3,
    }),
  );
  const markMesh = new THREE.Mesh(markGeo, markMat);
  markMesh.frustumCulled = false;
  scene.add(markMesh);
  let markHead = 0;
  const addMark = (a: T.Vector3, b: T.Vector3, nx: number, nz: number, w: number, alpha: number) => {
    const k = markHead;
    markHead = (markHead + 1) % MARKS;
    const o = k * 12;
    markPos.set([a.x + nx * w, 0.026, a.z + nz * w, a.x - nx * w, 0.026, a.z - nz * w, b.x + nx * w, 0.026, b.z + nz * w, b.x - nx * w, 0.026, b.z - nz * w], o);
    markAlpha.set([alpha, alpha, alpha, alpha], k * 4);
    marksDirty = true;
  };
  let marksDirty = false;

  // tyre smoke and dust: soft points that grow and fade
  const PUFFS = lite ? 240 : 700;
  const puffPos = new Float32Array(PUFFS * 3);
  const puffVel = new Float32Array(PUFFS * 3);
  const puffLife = new Float32Array(PUFFS);
  const puffSize = new Float32Array(PUFFS);
  const puffCol = new Float32Array(PUFFS * 3);
  const puffA = new Float32Array(PUFFS);
  const puffGeo = keep(new THREE.BufferGeometry());
  puffGeo.setAttribute('position', new THREE.BufferAttribute(puffPos, 3).setUsage(THREE.DynamicDrawUsage));
  puffGeo.setAttribute('size', new THREE.BufferAttribute(puffSize, 1).setUsage(THREE.DynamicDrawUsage));
  puffGeo.setAttribute('color', new THREE.BufferAttribute(puffCol, 3).setUsage(THREE.DynamicDrawUsage));
  puffGeo.setAttribute('alpha', new THREE.BufferAttribute(puffA, 1).setUsage(THREE.DynamicDrawUsage));
  const puffTexture = keep(puffTex(THREE));
  const puffMat = keep(
    new THREE.ShaderMaterial({
      uniforms: { map: { value: puffTexture }, scale: { value: 400 } },
      vertexShader:
        'attribute float size; attribute float alpha; attribute vec3 color; varying float vA; varying vec3 vC; uniform float scale; void main(){ vA = alpha; vC = color; vec4 mv = modelViewMatrix * vec4(position,1.0); gl_PointSize = size * scale / -mv.z; gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'uniform sampler2D map; varying float vA; varying vec3 vC; void main(){ vec4 t = texture2D(map, gl_PointCoord); gl_FragColor = vec4(vC, t.a * vA); }',
      transparent: true,
      depthWrite: false,
    }),
  );
  const puffs = new THREE.Points(puffGeo, puffMat);
  puffs.frustumCulled = false;
  scene.add(puffs);
  let puffHead = 0;
  const spawnPuff = (x: number, z: number, vx: number, vz: number, size: number, r: number, g: number, b: number, life: number) => {
    const k = puffHead;
    puffHead = (puffHead + 1) % PUFFS;
    puffPos.set([x, 0.4, z], k * 3);
    puffVel.set([vx, 0.6 + Math.random() * 0.8, vz], k * 3);
    puffLife[k] = life;
    puffSize[k] = size;
    puffCol.set([r, g, b], k * 3);
    puffA[k] = 0;
  };

  const setRace = (r: Race) => {
    for (const s of cars) {
      carGroup.remove(s.view.root, s.blob);
      s.view.dispose();
    }
    cars = r.runners.map((rn) => {
      const view = createCarView(THREE, kit, TEAMS[rn.entry.team % TEAMS.length], { shadows: !lite, lite: lite && rn.entry.kind === 'ai' });
      const b = new THREE.Mesh(blobGeo, blobMat);
      carGroup.add(view.root, b);
      return { view, blob: b, brakeHeat: 0, flap: 0, marks: [null, null, null, null], spinA: [0, 0, 0, 0] };
    });
  };
  setRace(race);

  // cameras, one per viewport, each with its own smoothing state
  type Cam = { cam: T.PerspectiveCamera; pos: T.Vector3; look: T.Vector3; yaw: number; init: boolean; shake: number };
  const cams: Cam[] = [0, 1].map(() => ({ cam: new THREE.PerspectiveCamera(60, 1, 0.08, 4000), pos: new THREE.Vector3(), look: new THREE.Vector3(), yaw: 0, init: false, shake: 0 }));
  let size = { w: 1, h: 1 };

  const tmpA = new THREE.Vector3();
  const tmpB = new THREE.Vector3();
  let clock = 0;

  const frame = (r: Race, dt: number, views: ViewSpec[], ghost: GhostPose | null) => {
    clock += dt;
    // start lights
    for (let k = 0; k < 5; k++) lightMats[k].emissiveIntensity = r.lights > k ? 6 : 0;

    for (let k = 0; k < r.runners.length && k < cars.length; k++) {
      const rn = r.runners[k];
      const slot = cars[k];
      const v = slot.view;
      const car = rn.car;
      v.root.visible = slot.blob.visible = !rn.out;
      if (rn.out) continue;
      v.root.position.set(car.x, 0, -car.y);
      v.root.rotation.y = car.yaw;
      slot.blob.position.set(car.x, 0.03, -car.y);
      slot.blob.rotation.y = car.yaw;
      // body on its springs: dive, squat, roll, and squashed down by downforce at speed
      v.body.rotation.z = Math.max(-0.03, Math.min(0.03, car.ax * 0.0011));
      v.body.rotation.x = Math.max(-0.03, Math.min(0.03, car.ay * 0.0009));
      v.body.position.y = -Math.min(0.025, car.vx * car.vx * 0.0000028) + (car.bump > 0.5 ? (Math.random() - 0.5) * 0.012 : 0);
      for (let w = 0; w < 4; w++) {
        slot.spinA[w] -= car.wheels[w].w * dt;
        v.spin[w].rotation.z = slot.spinA[w];
      }
      v.steer[0].rotation.y = v.steer[1].rotation.y = -car.steer;
      v.wheel.rotation.x = car.steer * 2.6;
      // DRS flap opens flat
      slot.flap += ((car.drs ? 0.05 : 0.5) - slot.flap) * Math.min(1, dt * 14);
      v.flap.rotation.z = slot.flap;
      // brakes heat with braking power and cool in the airflow
      slot.brakeHeat += (car.brake * Math.max(0, car.vx) * 0.04 - slot.brakeHeat * (0.6 + car.vx * 0.004)) * dt;
      slot.brakeHeat = Math.max(0, slot.brakeHeat);
      v.discs.emissiveIntensity = Math.min(3, Math.max(0, slot.brakeHeat - 0.6) * 1.6);
      // the rain light flashes while the car is harvesting
      v.rain.emissiveIntensity = car.brake > 0.05 && car.vx > 10 ? (Math.floor(clock * 8) % 2 ? 4 : 0) : 0.4;

      // skid marks and smoke from sliding tyres; dust off the track
      const near = views.some((vw) => {
        const me = r.runners[vw.runner]?.car;
        return me && (me.x - car.x) ** 2 + (me.y - car.y) ** 2 < 300 * 300;
      });
      for (let w = 0; w < 4; w++) {
        const wh = car.wheels[w];
        const onRoad = wh.surface === 'asphalt' || wh.surface === 'kerb' || wh.surface === 'runoff';
        tmpA.set(wh.x, 0, -wh.y);
        const sliding = onRoad && wh.slide > 3.5 && wh.load > 300;
        if (sliding && near) {
          const last = slot.marks[w];
          if (last && last.distanceToSquared(tmpA) > 0.36) {
            const dx = tmpA.x - last.x;
            const dz = tmpA.z - last.z;
            const l = Math.hypot(dx, dz) || 1;
            if (l < 3) addMark(last, tmpA, -dz / l, dx / l, w < 2 ? 0.15 : 0.2, Math.min(0.55, (wh.slide - 3.5) * 0.05 + 0.15));
            last.copy(tmpA);
          } else if (!last) slot.marks[w] = tmpA.clone();
          if (wh.slide > 8 && Math.random() < dt * 30) {
            const gray = 0.82 + Math.random() * 0.1;
            spawnPuff(tmpA.x, tmpA.z, (Math.random() - 0.5) * 1.5, (Math.random() - 0.5) * 1.5, 1.2 + Math.random(), gray, gray, gray, 2.2);
          }
        } else slot.marks[w] = null;
        if (!onRoad && near && Math.abs(car.vx) > 8 && Math.random() < dt * (wh.surface === 'gravel' ? 40 : 14)) {
          const dust = wh.surface === 'gravel' ? [0.72, 0.64, 0.5] : [0.42, 0.36, 0.26];
          spawnPuff(tmpA.x, tmpA.z, -Math.cos(car.yaw) * car.vx * 0.15, Math.sin(car.yaw) * car.vx * 0.15, 1.6, dust[0], dust[1], dust[2], 1.6);
        }
      }
    }
    if (marksDirty) {
      (markGeo.getAttribute('position') as T.BufferAttribute).needsUpdate = true;
      (markGeo.getAttribute('alpha') as T.BufferAttribute).needsUpdate = true;
      marksDirty = false;
    }
    for (let k = 0; k < PUFFS; k++) {
      if (puffLife[k] <= 0) {
        puffA[k] = 0;
        continue;
      }
      puffLife[k] -= dt;
      puffPos[k * 3] += puffVel[k * 3] * dt;
      puffPos[k * 3 + 1] += puffVel[k * 3 + 1] * dt;
      puffPos[k * 3 + 2] += puffVel[k * 3 + 2] * dt;
      puffVel[k * 3] *= 1 - dt * 0.8;
      puffVel[k * 3 + 2] *= 1 - dt * 0.8;
      puffSize[k] += dt * 2.6;
      puffA[k] = Math.min(0.5, puffLife[k] * 0.3);
    }
    for (const name of ['position', 'size', 'alpha', 'color']) (puffGeo.getAttribute(name) as T.BufferAttribute).needsUpdate = true;

    // ghost car
    if (ghost) {
      ghostView.root.visible = true;
      ghostView.root.position.set(ghost.x, 0, -ghost.y);
      ghostView.root.rotation.y = ghost.yaw;
    } else ghostView.root.visible = false;

    // cameras
    views.forEach((vw, k) => updateCam(cams[k], r, vw, dt));
    // the sun's shadow box follows the first view's car
    const focus = r.runners[views[0]?.runner ?? 0]?.car;
    if (focus) {
      const fx = focus.x + Math.cos(focus.yaw) * 30;
      const fz = -(focus.y + Math.sin(focus.yaw) * 30);
      sun.target.position.set(fx, 0, fz);
      sun.position.set(fx + sunDir.x * 300, sunDir.y * 300, fz + sunDir.z * 300);
    }
  };

  const updateCam = (cm: Cam, r: Race, vw: ViewSpec, dt: number) => {
    const rn = r.runners[vw.runner];
    if (!rn) return;
    const car = rn.car;
    const slot = cars[vw.runner];
    const cos = Math.cos(car.yaw);
    const sin = Math.sin(car.yaw);
    // world: forward is (cos, -sin) in x/z, right is (sin, cos)
    const fx = cos;
    const fz = -sin;
    const speed = Math.abs(car.vx);
    const cam = cm.cam;
    if (slot) slot.view.helmet.visible = vw.cam !== 'cockpit';
    cm.shake += (car.bump * Math.min(1, speed / 30) - cm.shake) * Math.min(1, dt * 10);
    const shake = cm.shake * (vw.cam === 'chase' ? 0.025 : 0.012);
    const jx = (Math.random() - 0.5) * shake;
    const jy = (Math.random() - 0.5) * shake;
    const back = vw.back ? -1 : 1;
    if (vw.cam === 'chase') {
      // trails behind on a spring, swinging wide through corners a little
      if (!cm.init) cm.yaw = car.yaw;
      let dyaw = car.yaw - cm.yaw;
      dyaw = Math.atan2(Math.sin(dyaw), Math.cos(dyaw));
      cm.yaw += dyaw * Math.min(1, dt * 7);
      const dist = 6.4 + Math.min(1.2, speed * 0.01);
      const bx = Math.cos(cm.yaw);
      const bz = -Math.sin(cm.yaw);
      tmpA.set(car.x - bx * dist * back, 1.85 + Math.min(0.4, speed * 0.003), -car.y - bz * dist * back);
      if (!cm.init) cm.pos.copy(tmpA);
      cm.pos.lerp(tmpA, Math.min(1, dt * 12));
      tmpB.set(car.x + bx * 3 * back, 0.85, -car.y + bz * 3 * back);
      cm.look.copy(tmpB);
      cam.position.set(cm.pos.x + jx, cm.pos.y + jy, cm.pos.z);
      cam.up.set(0, 1, 0);
      cam.lookAt(cm.look);
      cam.fov = 58 + Math.min(10, speed * 0.1);
    } else {
      const local =
        vw.cam === 'tcam' ? [-0.52, 1.13, 0] : vw.cam === 'cockpit' ? [0.2, 0.86, 0] : /* nose */ [2.35, 0.42, 0];
      const pitch = slot ? slot.view.body.rotation.z : 0;
      const roll = slot ? slot.view.body.rotation.x : 0;
      // body local (x fwd, y up, z right) to world
      const wx = car.x + cos * local[0] + sin * local[2];
      const wz = -car.y - sin * local[0] + cos * local[2];
      cam.position.set(wx + jx, local[1] + jy + (slot ? slot.view.body.position.y : 0), wz);
      cam.up.set(0, 1, 0);
      cam.lookAt(wx + fx * 20 * back, local[1] - 0.25 + pitch * 20 + (vw.cam === 'cockpit' ? 0.1 : 0), wz + fz * 20 * back);
      cam.rotateZ(vw.back ? roll : -roll);
      cam.fov = vw.cam === 'cockpit' ? 72 : vw.cam === 'nose' ? 70 : 66;
      cam.fov += Math.min(6, speed * 0.06);
    }
    cm.init = true;
    cam.aspect = vw.w / Math.max(1, vw.h);
    cam.near = vw.cam === 'chase' ? 0.3 : 0.05;
    cam.updateProjectionMatrix();
    sky.position.copy(cam.position);
  };

  const render = (views: ViewSpec[]) => {
    if (lost) return;
    renderer.setScissorTest(true);
    renderer.setClearColor(0x000000, 1);
    const H = size.h;
    views.forEach((vw, k) => {
      const cam = cams[k].cam;
      sky.position.copy(cam.position);
      renderer.setViewport(vw.x, H - vw.y - vw.h, vw.w, vw.h);
      renderer.setScissor(vw.x, H - vw.y - vw.h, vw.w, vw.h);
      renderer.clear();
      renderer.render(scene, cam);
    });
    renderer.setScissorTest(false);
  };

  return {
    renderer,
    canvas: canvasEl,
    lost: () => lost,
    setRace,
    frame,
    render,
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      size = { w, h };
      renderer.setSize(w, h, false);
      puffMat.uniforms.scale.value = h * 0.9;
    },
    dispose() {
      for (const s of cars) s.view.dispose();
      ghostView.dispose();
      kit.dispose();
      for (const d of disposables) d.dispose();
      env.dispose();
      sun.dispose();
      hemi.dispose();
      scene.traverse((o) => {
        const m = o as T.Mesh;
        if (m.isMesh && m.geometry) m.geometry.dispose();
      });
      canvasEl.removeEventListener('webglcontextlost', onLost);
      canvasEl.removeEventListener('webglcontextrestored', onRestored);
      renderer.dispose();
      renderer.forceContextLoss();
      canvasEl.remove();
    },
  };
}

function joinRibbons(list: Ribbon[]): Ribbon {
  const out: Ribbon = { pos: [], uv: [], idx: [] };
  for (const r of list) {
    const base = out.pos.length / 3;
    for (const v of r.pos) out.pos.push(v);
    for (const v of r.uv) out.uv.push(v);
    for (const i of r.idx) out.idx.push(i + base);
  }
  return out;
}

/** A coarse grid of where the circuit and its run-off are, for keeping trees and stands off it. */
function buildOccupancy(c: Circuit) {
  const cell = 12;
  const map = new Map<string, number[]>();
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < c.n; i++) {
    minX = Math.min(minX, c.px[i]);
    maxX = Math.max(maxX, c.px[i]);
    minY = Math.min(minY, c.py[i]);
    maxY = Math.max(maxY, c.py[i]);
    const k = `${Math.floor(c.px[i] / cell)},${Math.floor(c.py[i] / cell)}`;
    let a = map.get(k);
    if (!a) map.set(k, (a = []));
    a.push(i);
  }
  const reach = 6;
  /** True when (x, y) is within `pad` meters of anything up to the walls, or the pits. */
  const near = (x: number, y: number, pad: number) => {
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let i = -reach; i <= reach; i++)
      for (let j = -reach; j <= reach; j++)
        for (const s of map.get(`${gx + i},${gy + j}`) ?? []) {
          const dx = x - c.px[s];
          const dy = y - c.py[s];
          const d = Math.hypot(dx, dy);
          const side = -dx * c.ty[s] + dy * c.tx[s];
          let lim = (side > 0 ? c.wallL[s] : c.wallR[s] + (s * c.ds > c.marks.main[0] + 200 || s * c.ds < 420 ? 34 : 0)) + pad;
          lim = Math.max(lim, 20);
          if (d < lim) return true;
        }
    return false;
  };
  /** True when a spot at offset d on side `side` of sample i is close to a different part of the circuit. */
  const nearOther = (i: number, d: number, side: number, pad: number) => {
    const x = c.px[i] - c.ty[i] * d * side;
    const y = c.py[i] + c.tx[i] * d * side;
    const gx = Math.floor(x / cell);
    const gy = Math.floor(y / cell);
    for (let a = -4; a <= 4; a++)
      for (let b = -4; b <= 4; b++)
        for (const s of map.get(`${gx + a},${gy + b}`) ?? []) {
          const gap = Math.abs(mod(s - i + c.n / 2, c.n) - c.n / 2);
          if (gap < 40) continue;
          if (Math.hypot(x - c.px[s], y - c.py[s]) < Math.max(c.wallL[s], c.wallR[s]) + pad) return true;
        }
    return false;
  };
  return { near, nearOther, minX, maxX, minY, maxY };
}

export { WHEEL_R };
