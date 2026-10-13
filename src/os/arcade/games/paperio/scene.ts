// The three.js view. The whole board is one plane: its shader reads the grid texture (owner, previous owner, reveal
// time, trail) and draws graph paper, raised paper territories with a darker edge and a soft shadow, lighter trails
// and the arena wall, with smooth anti-aliased edges from bilinear coverage. Heads are little cubes wearing their
// skin. The texture is only re-uploaded where the grid changed (dirty rows).
import type * as T from 'three';
import { drawSkin } from './art.ts';
import { PALETTE, colorOf, shade, sideOf, skinOf, trailOf } from './skins.ts';
import { HEAD, MAX_PLAYERS, takeDirty, type Ev, type Player, type World } from './world.ts';

type Three = typeof import('three');

// three.js constants, by value (the shared three chunk only re-exports classes)
const NEAREST = 1003;

export type Cam = {
  /** Look-at point in cell coordinates. */
  x: number;
  y: number;
  /** Visible width of ground at the look-at point, in cells. */
  width: number;
  /** Viewport in CSS pixels. */
  vx: number;
  vy: number;
  vw: number;
  vh: number;
  shakeX: number;
  shakeY: number;
};

export type HeadPose = { x: number; y: number; h: number; alive: boolean; out: boolean };

export type View = {
  canvas: HTMLCanvasElement;
  resize(w: number, h: number, dpr: number): void;
  /** Uploads grid changes. Call once per frame after the world moved, with the frame's events. */
  sync(w: World, events: readonly Ev[]): void;
  /** Places a head (cell coordinates). */
  head(p: Player, pose: HeadPose, dt: number): void;
  /** Effects for events (bursts, rings). */
  react(w: World, e: Ev): void;
  render(cams: Cam[], dt: number): void;
  /** Cell coordinates on the board to CSS pixels inside cam's viewport (null when behind the camera). */
  project(cam: Cam, x: number, y: number, lift: number): { x: number; y: number } | null;
  /** CSS pixels (relative to the canvas) to cell coordinates on the board, through cam. */
  unproject(cam: Cam, sx: number, sy: number): { x: number; y: number } | null;
  dispose(): void;
};

const PITCH = (62 * Math.PI) / 180;
const FOV = 34;

const VERT = /* glsl */ `
uniform vec2 uOrigin;
varying vec2 vCell;
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vCell = wp.xz - uOrigin;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uGrid;
uniform sampler2D uCoarse;
uniform vec3 uTop[17];
uniform vec3 uSide[17];
uniform vec3 uTrail[17];
uniform float uN;
uniform float uR;
uniform float uNow;
varying vec2 vCell;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

vec4 texel(ivec2 c) {
  int n = int(uN);
  if (c.x < 0 || c.y < 0 || c.x >= n || c.y >= n) return vec4(0.0);
  return floor(texelFetch(uGrid, c, 0) * 255.0 + 0.5);
}

// The owner a texel shows right now: the new one once its reveal time has passed, else the old one.
float shown(vec4 t, out float pop) {
  float dt = mod(uNow - t.b + 256.0, 256.0);
  if (dt < 192.0) {
    pop = t.r > 0.5 ? max(0.0, 1.0 - dt / 20.0) : 0.0;
    return t.r;
  }
  pop = 0.0;
  return t.g;
}

// Cubic B-spline weights for the four taps around fraction t.
vec4 bspline(float t) {
  float t2 = t * t;
  float t3 = t2 * t;
  return vec4((1.0 - 3.0 * t + 3.0 * t2 - t3) / 6.0, (3.0 * t3 - 6.0 * t2 + 4.0) / 6.0, (-3.0 * t3 + 3.0 * t2 + 3.0 * t + 1.0) / 6.0, t3 / 6.0);
}

void main() {
  vec2 q = vCell;
  vec2 fw2 = fwidth(q);
  float fw = max(fw2.x, fw2.y);
  // anti-aliasing width in coverage units: coverage changes about one unit per cell across an edge
  float e = clamp(fw * 0.55, 0.015, 0.45);
  float d = length(q - vec2(uN * 0.5));
  vec3 outside = vec3(0.835, 0.765, 0.627);
  if (d > uR + 8.0) {
    float stripe = step(0.5, fract((q.x + q.y) / 14.0));
    vec3 o = outside * (0.97 + 0.03 * stripe);
    o *= 1.0 - 0.18 * smoothstep(uR + 8.0, uR + 120.0, d);
    gl_FragColor = vec4(o, 1.0);
    return;
  }
  // graph paper
  vec3 col = vec3(0.957, 0.933, 0.886);
  vec2 g4 = abs(fract(q / 8.0 + 0.5) - 0.5) * 8.0;
  vec2 g20 = abs(fract(q / 40.0 + 0.5) - 0.5) * 40.0;
  float minor = 1.0 - smoothstep(0.08, 0.08 + fw * 1.1, min(g4.x, g4.y));
  float major = 1.0 - smoothstep(0.14, 0.14 + fw * 1.1, min(g20.x, g20.y));
  vec3 ink = vec3(0.80, 0.745, 0.655);
  col = mix(col, ink, max(minor * 0.32, major * 0.62) * clamp(1.8 - fw * 2.5, 0.0, 1.0));
  col *= 0.988 + 0.024 * hash(floor(q * 1.5));

  // Most of the board is plain paper or the middle of someone's land: an 8 x 8 cell summary says so up front.
  ivec2 cc = ivec2(floor(q / 8.0));
  float coarse = cc.x < 0 || cc.y < 0 || float(cc.x) * 8.0 >= uN || float(cc.y) * 8.0 >= uN ? 0.0 : floor(texelFetch(uCoarse, cc, 0).r * 255.0 + 0.5);
  if (coarse < 254.5) {
    if (coarse > 0.5) {
      vec3 flat_ = uTop[int(coarse)] * (0.978 + 0.03 * hash(floor(q * 2.0) + 7.0));
      col = flat_;
    }
    float edge0 = smoothstep(uR - e * 2.0, uR + e * 2.0, d);
    col = mix(col, outside, edge0);
    float rope0 = 1.0 - smoothstep(1.4, 1.4 + fw * 1.5, abs(d - uR - 1.2));
    col = mix(col, vec3(0.549, 0.082, 0.082), rope0);
    col *= 1.0 - 0.06 * smoothstep(uR - 12.0, uR, d) * (1.0 - edge0);
    gl_FragColor = vec4(col, 1.0);
    return;
  }

  // A 4 x 6 block of texels around q: rows 2-5 reconstruct the land at q, rows 0-3 the land two cells north
  // (its southern edge hangs down as the darker side of the paper).
  vec2 f = q - 0.5;
  vec2 fl = floor(f);
  vec2 t = f - fl;
  ivec2 c0 = ivec2(fl) - ivec2(1, 3);
  vec4 wx = bspline(t.x);
  vec4 wy = bspline(t.y);
  // the two leading owners near q (from the central texels), for edges between two territories
  float pc0; float pc1; float pc2; float pc3;
  float o5 = shown(texel(c0 + ivec2(1, 3)), pc0);
  float o6 = shown(texel(c0 + ivec2(2, 3)), pc1);
  float o9 = shown(texel(c0 + ivec2(1, 4)), pc2);
  float o10 = shown(texel(c0 + ivec2(2, 4)), pc3);
  float b0 = (1.0 - t.x) * (1.0 - t.y);
  float b1 = t.x * (1.0 - t.y);
  float b2 = (1.0 - t.x) * t.y;
  float b3 = t.x * t.y;
  float A = o5; float wa = o5 > 0.5 ? b0 : -1.0;
  if (o6 > 0.5 && b1 > wa) { A = o6; wa = b1; }
  if (o9 > 0.5 && b2 > wa) { A = o9; wa = b2; }
  if (o10 > 0.5 && b3 > wa) { A = o10; wa = b3; }
  float B = A;
  if (o5 > 0.5 && o5 != A) B = o5;
  if (o6 > 0.5 && o6 != A) B = o6;
  if (o9 > 0.5 && o9 != A) B = o9;
  if (o10 > 0.5 && o10 != A) B = o10;

  float cov = 0.0;   // any land at q
  float covA = 0.0;  // owner A at q
  float covB = 0.0;  // owner B at q
  float scov = 0.0;  // any land two cells north
  float sA = 0.0;    // dominant owner two cells north
  float sw = -1.0;
  float pop = 0.0;
  float tcov = 0.0;  // trail at q
  float tid = 0.0;
  float tw = -1.0;
  for (int j = 0; j < 6; j++) {
    for (int i = 0; i < 4; i++) {
      vec4 tx = texel(c0 + ivec2(i, j));
      float pp;
      float o = shown(tx, pp);
      float xw = wx[i];
      if (j >= 2) {
        float w = xw * wy[j - 2];
        if (o > 0.5) {
          cov += w;
          pop += pp * w;
        }
        if (o == A) covA += w;
        if (o == B) covB += w;
        if (tx.a > 0.5) {
          tcov += w;
          if (w > tw) { tw = w; tid = tx.a; }
        }
      }
      if (j <= 3) {
        float w = xw * wy[j];
        if (o > 0.5) {
          scov += w;
          if (w > sw) { sw = w; sA = o; }
        }
      }
    }
  }

  // soft shadow just below the paper's edge
  col *= 1.0 - 0.2 * smoothstep(0.0, 0.5, scov) * (1.0 - smoothstep(0.5 - e, 0.5 + e, scov));
  // the darker edge of the paper, hanging below the land's southern side
  float sideA = smoothstep(0.5 - e, 0.5 + e, scov);
  col = mix(col, uSide[int(sA)], sideA);
  // the land itself
  float topA = smoothstep(0.5 - e, 0.5 + e, cov);
  vec3 top = mix(uTop[int(B)], uTop[int(A)], smoothstep(-e, e, covA - covB));
  top *= 0.978 + 0.03 * hash(floor(q * 2.0) + 7.0);
  // light catches the northern lip of the paper
  top = mix(top, min(top * 1.12 + 0.03, vec3(1.0)), (1.0 - smoothstep(0.35, 0.65, scov)) * 0.7);
  top = mix(top, vec3(1.0), min(1.0, pop) * 0.45);
  col = mix(col, top, topA);
  // trails
  float trA = smoothstep(0.5 - e, 0.5 + e, tcov * 1.15);
  col = mix(col, uTrail[int(tid)], trA * 0.9);
  // the arena wall: a cardinal rope and sandstone beyond
  float edge = smoothstep(uR - e * 2.0, uR + e * 2.0, d);
  col = mix(col, outside, edge);
  float rope = 1.0 - smoothstep(1.4, 1.4 + fw * 1.5, abs(d - uR - 1.2));
  col = mix(col, vec3(0.549, 0.082, 0.082), rope);
  col *= 1.0 - 0.06 * smoothstep(uR - 12.0, uR, d) * (1.0 - edge);
  gl_FragColor = vec4(col, 1.0);
}
`;

const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255];

type HeadView = {
  group: T.Group;
  cube: T.Mesh;
  shadow: T.Mesh;
  skinTex: T.CanvasTexture;
  mats: T.Material[];
  color: number;
  skin: number;
  /** Spawn and death animation: 0 hidden, 1 shown. */
  scale: number;
  alive: boolean;
  roll: number;
  lastH: number;
};

type Bit = { x: number; y: number; z: number; vx: number; vy: number; vz: number; rx: number; ry: number; vr: number; life: number; max: number; color: number; size: number };
type Ring = { mesh: T.Mesh; mat: T.MeshBasicMaterial; t: number; max: number; size: number };

export function buildView(THREE: Three, host: HTMLElement, w: World): View | null {
  let renderer: T.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  if (!renderer.capabilities.isWebGL2) {
    renderer.dispose();
    return null;
  }
  const canvas = renderer.domElement;
  canvas.style.display = 'block';
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  canvas.style.touchAction = 'none';
  host.appendChild(canvas);
  let lost = false;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
  };
  const onRestored = () => {
    lost = false;
    gridTex.needsUpdate = true;
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);
  renderer.setClearColor(0xd5c3a0, 1);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 3000);
  scene.add(new THREE.HemisphereLight(0xfffaf0, 0xb9a98a, 1.25));
  const sun = new THREE.DirectionalLight(0xffffff, 1.35);
  sun.position.set(-0.45, 1, -0.75);
  scene.add(sun);

  // ---------------------------------------------------------------------------------------------------------------
  // The board

  const n = w.n;
  const data = new Uint8Array(n * n * 4);
  // A CanvasTexture dressed as a DataTexture: the shared three chunk does not export DataTexture, and this way the
  // renderer uploads raw bytes and honors row update ranges.
  const gridTex = new THREE.CanvasTexture(document.createElement('canvas'), undefined, undefined, undefined, NEAREST as T.MagnificationTextureFilter, NEAREST as T.MinificationTextureFilter);
  Object.assign(gridTex, { isDataTexture: true, image: { data, width: n, height: n }, flipY: false, generateMipmaps: false, unpackAlignment: 4 });
  gridTex.needsUpdate = true;

  // 8 x 8 cell summary: 0 plain paper, 1-16 the middle of one player's land, 255 anything else (edges, trails,
  // animations). Each block looks 4 cells past its edges, as far as the shader's samples reach.
  const m = Math.ceil(n / 8);
  const coarse = new Uint8Array(m * m * 4);
  const coarseTex = new THREE.CanvasTexture(document.createElement('canvas'), undefined, undefined, undefined, NEAREST as T.MagnificationTextureFilter, NEAREST as T.MinificationTextureFilter);
  Object.assign(coarseTex, { isDataTexture: true, image: { data: coarse, width: m, height: m }, flipY: false, generateMipmaps: false, unpackAlignment: 4 });
  coarseTex.needsUpdate = true;

  function summarize(bx0: number, by0: number, bx1: number, by1: number) {
    bx0 = Math.max(0, bx0);
    by0 = Math.max(0, by0);
    bx1 = Math.min(m - 1, bx1);
    by1 = Math.min(m - 1, by1);
    for (let by = by0; by <= by1; by++) {
      let first = -1;
      let last = -1;
      for (let bx = bx0; bx <= bx1; bx++) {
        const x0 = Math.max(0, bx * 8 - 4);
        const x1 = Math.min(n - 1, bx * 8 + 11);
        const y0 = Math.max(0, by * 8 - 4);
        const y1 = Math.min(n - 1, by * 8 + 11);
        let v = -1;
        for (let y = y0; y <= y1 && v !== 255; y++) {
          let i = (y * n + x0) * 4;
          for (let x = x0; x <= x1; x++, i += 4) {
            const o = data[i];
            if (data[i + 3] !== 0 || data[i + 1] !== o) {
              v = 255;
              break;
            }
            if (v < 0) v = o;
            else if (v !== o) {
              v = 255;
              break;
            }
          }
        }
        // blocks that reach outside the grid on the edge of the map are only plain if their inside is
        if (v < 0) v = 0;
        const ci = (by * m + bx) * 4;
        if (coarse[ci] !== v) {
          coarse[ci] = v;
          if (first < 0) first = bx;
          last = bx;
        }
      }
      if (first >= 0) {
        coarseTex.addUpdateRange((by * m + first) * 4, (last - first + 1) * 4);
        coarseTex.needsUpdate = true;
      }
    }
  }

  const top = new Float32Array(17 * 3);
  const sideC = new Float32Array(17 * 3);
  const trailC = new Float32Array(17 * 3);
  const paper = rgb('#f4eee2');
  for (let i = 0; i < 17; i++) {
    const c = i === 0 ? paper : rgb(colorOf(0));
    top.set(c, i * 3);
    sideC.set(c, i * 3);
    trailC.set(c, i * 3);
  }
  const uniforms = {
    uGrid: { value: gridTex },
    uCoarse: { value: coarseTex },
    uTop: { value: top },
    uSide: { value: sideC },
    uTrail: { value: trailC },
    uN: { value: n },
    uR: { value: w.r },
    uNow: { value: 0 },
    uOrigin: { value: new THREE.Vector2(-w.c, -w.c) },
  };
  const boardMat = new THREE.MeshBasicMaterial();
  boardMat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = VERT;
    shader.fragmentShader = FRAG;
  };
  boardMat.customProgramCacheKey = () => 'paperio-board-v1';
  const span = n * 6;
  const boardGeo = new THREE.PlaneGeometry(span, span, 1, 1);
  boardGeo.rotateX(-Math.PI / 2);
  const board = new THREE.Mesh(boardGeo, boardMat);
  board.frustumCulled = false;
  scene.add(board);

  const setColor = (id: number, color: number) => {
    top.set(rgb(colorOf(color)), (id + 1) * 3);
    sideC.set(rgb(sideOf(color)), (id + 1) * 3);
    trailC.set(rgb(trailOf(color)), (id + 1) * 3);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // Heads

  const geo = {
    cube: new THREE.BoxGeometry(HEAD * 0.92, 4.4, HEAD * 0.92),
    shadow: new THREE.PlaneGeometry(1, 1),
    bit: new THREE.BoxGeometry(1, 0.35, 1),
    ring: new THREE.RingGeometry(0.86, 1, 64),
  };
  geo.cube.translate(0, 2.2, 0);
  geo.shadow.rotateX(-Math.PI / 2);
  geo.ring.rotateX(-Math.PI / 2);
  const shadowCanvas = document.createElement('canvas');
  shadowCanvas.width = shadowCanvas.height = 64;
  {
    const g = shadowCanvas.getContext('2d');
    if (g) {
      const grad = g.createRadialGradient(32, 32, 6, 32, 32, 31);
      grad.addColorStop(0, 'rgba(40,24,10,0.42)');
      grad.addColorStop(1, 'rgba(40,24,10,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }
  }
  const shadowTex = new THREE.CanvasTexture(shadowCanvas);
  const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });
  const heads: (HeadView | undefined)[] = [];

  function makeHead(p: Player): HeadView {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d');
    if (g) drawSkin(g, 128, skinOf(p.skin).pattern, p.color);
    const skinTex = new THREE.CanvasTexture(c);
    skinTex.colorSpace = THREE.SRGBColorSpace;
    skinTex.anisotropy = 4;
    const side = new THREE.MeshLambertMaterial({ color: new THREE.Color(shade(colorOf(p.color), -0.12)) });
    const topMat = new THREE.MeshBasicMaterial({ map: skinTex });
    const bottom = new THREE.MeshBasicMaterial({ color: 0x000000 });
    const mats = [side, side, topMat, bottom, side, side];
    const cube = new THREE.Mesh(geo.cube, mats);
    const shadow = new THREE.Mesh(geo.shadow, shadowMat);
    shadow.scale.set(HEAD * 2.1, 1, HEAD * 2.1);
    shadow.position.set(1.8, 0.08, 2.6);
    shadow.renderOrder = 1;
    const group = new THREE.Group();
    group.add(shadow);
    group.add(cube);
    group.visible = false;
    scene.add(group);
    return { group, cube, shadow, skinTex, mats: [side, topMat, bottom], color: p.color, skin: p.skin, scale: 0, alive: false, roll: 0, lastH: p.h };
  }

  function dropHead(i: number) {
    const hv = heads[i];
    if (!hv) return;
    scene.remove(hv.group);
    hv.skinTex.dispose();
    for (const m of hv.mats) m.dispose();
    heads[i] = undefined;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Effects: paper confetti and capture rings

  const MAX_BITS = 320;
  const bitMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  const bitsMesh = new THREE.InstancedMesh(geo.bit, bitMat, MAX_BITS);
  bitsMesh.frustumCulled = false;
  bitsMesh.count = 0;
  scene.add(bitsMesh);
  const bits: Bit[] = [];
  const dummy = new THREE.Object3D();
  const tmpColor = new THREE.Color();
  const palette = PALETTE.map((c) => new THREE.Color(c));
  const white = new THREE.Color(0xffffff);
  const rings: Ring[] = [];
  for (let i = 0; i < 6; i++) {
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0, depthWrite: false });
    const mesh = new THREE.Mesh(geo.ring, mat);
    mesh.visible = false;
    mesh.renderOrder = 2;
    scene.add(mesh);
    rings.push({ mesh, mat, t: 0, max: 1, size: 1 });
  }

  function burst(x: number, y: number, color: number, count: number, power: number) {
    for (let i = 0; i < count; i++) {
      if (bits.length >= MAX_BITS) bits.shift();
      const a = Math.random() * Math.PI * 2;
      const v = (0.4 + Math.random()) * power;
      bits.push({
        x,
        y: 3,
        z: y,
        vx: Math.cos(a) * v,
        vy: 20 + Math.random() * 28,
        vz: Math.sin(a) * v,
        rx: Math.random() * 6,
        ry: Math.random() * 6,
        vr: (Math.random() - 0.5) * 18,
        life: 0,
        max: 0.9 + Math.random() * 0.7,
        color: i % 4 === 0 ? -1 : color,
        size: 1.4 + Math.random() * 2.2,
      });
    }
  }

  function ring(x: number, y: number, color: number, size: number) {
    const r = rings.find((q) => !q.mesh.visible) ?? rings[0];
    r.mesh.visible = true;
    r.mesh.position.set(x - w.c, 0.12, y - w.c);
    r.mat.color.set(color < 0 ? '#ffffff' : shade(colorOf(color), 0.25));
    r.t = 0;
    r.max = 0.55;
    r.size = size;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Grid sync: diffs the dirty rectangle against what the texture shows and times each change's reveal

  let units = 0; // render clock in 1/60 s
  const delay = new Uint8Array(n * n);
  const stampOf = new Uint32Array(n * n);
  let stamp = 1;
  const queue = new Int32Array(n * n);
  const dist = new Uint16Array(n * n);
  const deaths: { id: number; x: number; y: number }[] = [];
  const spawns: { id: number; x: number; y: number }[] = [];
  let janitorRow = 0;

  /** Breadth-first distance from the closed trail through the freshly claimed cells: the fill sweeps outward. */
  function sweep(world: World, id: number, seeds: Int32Array) {
    const v = id + 1;
    const own = world.owner;
    let head = 0;
    let tail = 0;
    stamp++;
    for (let i = 0; i < seeds.length; i++) {
      const k = seeds[i];
      if (own[k] !== v || stampOf[k] === stamp) continue;
      stampOf[k] = stamp;
      dist[k] = 0;
      delay[k] = 0;
      queue[tail++] = k;
    }
    while (head < tail) {
      const k = queue[head++];
      const d = dist[k] + 1;
      for (let i = 0; i < 4; i++) {
        const kk = i === 0 ? k - 1 : i === 1 ? k + 1 : i === 2 ? k - n : k + n;
        if (kk < 0 || kk >= n * n || stampOf[kk] === stamp || own[kk] !== v || data[kk * 4] === v) continue;
        stampOf[kk] = stamp;
        dist[kk] = d;
        delay[kk] = Math.min(56, (d / 4.8) | 0);
        queue[tail++] = kk;
      }
    }
  }

  function sync(world: World, events: readonly Ev[]) {
    deaths.length = 0;
    spawns.length = 0;
    const sweepStamp = stamp + 1;
    let swept = false;
    for (const e of events) {
      if (e.t === 'capture' && e.cells.length) {
        sweep(world, e.id, e.cells);
        swept = true;
      } else if (e.t === 'die') deaths.push({ id: e.id, x: e.x, y: e.y });
      else if (e.t === 'spawn') spawns.push({ id: e.id, x: e.x, y: e.y });
    }
    const lastSweep = swept ? stamp : -1;
    const rect = takeDirty(world);
    const now = units & 255;
    if (rect) {
      const own = world.owner;
      const trail = world.trail;
      for (let y = rect.y0; y <= rect.y1; y++) {
        let first = -1;
        let last = -1;
        for (let x = rect.x0; x <= rect.x1; x++) {
          const k = y * n + x;
          const i = k * 4;
          const o = own[k];
          const t = trail[k];
          let changed = false;
          if (data[i] !== o) {
            const dt = (now - data[i + 2] + 256) & 255;
            data[i + 1] = dt < 192 ? data[i] : data[i + 1];
            data[i] = o;
            let d = 0;
            if (swept && stampOf[k] >= sweepStamp && stampOf[k] <= lastSweep) d = delay[k];
            else if (o === 0 && deaths.length) {
              const dd = deaths.find((q) => q.id + 1 === data[i + 1]);
              if (dd) d = Math.min(60, (Math.hypot(x - dd.x, y - dd.y) / 4.4) | 0);
            } else if (o !== 0 && spawns.length) {
              const s = spawns.find((q) => q.id + 1 === o);
              if (s) d = Math.min(30, (Math.hypot(x - s.x, y - s.y) / 2.2) | 0);
            }
            data[i + 2] = (now + 1 + d) & 255;
            changed = true;
          }
          if (data[i + 3] !== t) {
            data[i + 3] = t;
            changed = true;
          }
          if (changed) {
            if (first < 0) first = x;
            last = x;
          }
        }
        if (first >= 0) gridTex.addUpdateRange((y * n + first) * 4, (last - first + 1) * 4);
      }
      gridTex.needsUpdate = true;
      summarize((rect.x0 - 4) >> 3, (rect.y0 - 4) >> 3, (rect.x1 + 4) >> 3, (rect.y1 + 4) >> 3);
    }
    // janitor: once an animation is long done, the old owner channel catches up so the reveal clock can wrap safely
    const rows = 24;
    for (let r = 0; r < rows; r++) {
      const y = janitorRow;
      janitorRow = (janitorRow + 1) % n;
      let first = -1;
      let last = -1;
      for (let x = 0; x < n; x++) {
        const i = (y * n + x) * 4;
        if (data[i + 1] === data[i]) continue;
        const dt = (now - data[i + 2] + 256) & 255;
        if (dt >= 90 && dt < 192) {
          data[i + 1] = data[i];
          if (first < 0) first = x;
          last = x;
        }
      }
      if (first >= 0) {
        gridTex.addUpdateRange((y * n + first) * 4, (last - first + 1) * 4);
        gridTex.needsUpdate = true;
        summarize((first - 4) >> 3, (y - 4) >> 3, (last + 4) >> 3, (y + 4) >> 3);
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------

  let cssW = 1;
  let cssH = 1;
  const v3 = new THREE.Vector3();
  const v3b = new THREE.Vector3();

  function aim(cam: Cam) {
    const aspect = Math.max(0.1, cam.vw / Math.max(1, cam.vh));
    const tanHalf = Math.tan(((FOV / 2) * Math.PI) / 180);
    // distance so the visible ground width at the target matches cam.width
    const dist = cam.width / (2 * tanHalf * aspect);
    const tx = cam.x - w.c + cam.shakeX;
    const tz = cam.y - w.c + cam.shakeY;
    camera.aspect = aspect;
    camera.position.set(tx, Math.sin(PITCH) * dist, tz + Math.cos(PITCH) * dist);
    camera.lookAt(tx, 0, tz);
    camera.near = Math.max(1, dist * 0.2);
    camera.far = dist * 6 + 200;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
  }

  return {
    canvas,
    resize(width, height, dpr) {
      cssW = Math.max(1, width);
      cssH = Math.max(1, height);
      renderer.setPixelRatio(dpr);
      renderer.setSize(cssW, cssH, false);
    },
    sync,
    head(p, pose, dt) {
      let hv = heads[p.id];
      if (hv && (hv.color !== p.color || hv.skin !== p.skin)) {
        dropHead(p.id);
        hv = undefined;
      }
      if (!hv) {
        hv = makeHead(p);
        heads[p.id] = hv;
        setColor(p.id, p.color);
      }
      if (pose.alive && !hv.alive) hv.scale = 0;
      hv.alive = pose.alive;
      const target = pose.alive ? 1 : 0;
      hv.scale += (target - hv.scale) * Math.min(1, dt * (pose.alive ? 9 : 14));
      if (!pose.alive && hv.scale < 0.02) hv.scale = 0;
      hv.group.visible = hv.scale > 0.01;
      if (!hv.group.visible) return;
      // lean into turns a little
      const turn = Math.atan2(Math.sin(pose.h - hv.lastH), Math.cos(pose.h - hv.lastH));
      hv.lastH = pose.h;
      const lean = dt > 0 ? Math.max(-0.28, Math.min(0.28, (turn / dt) * 0.05)) : 0;
      hv.roll += (lean - hv.roll) * Math.min(1, dt * 10);
      const pop = pose.alive ? 1 + Math.sin(Math.min(1, hv.scale) * Math.PI) * 0.18 : hv.scale;
      hv.group.position.set(pose.x - w.c, 0, pose.y - w.c);
      hv.group.rotation.set(0, -pose.h, 0);
      hv.cube.rotation.set(hv.roll, 0, 0);
      const s = Math.max(0.001, hv.scale * pop);
      hv.cube.scale.set(s, s, s);
      hv.shadow.scale.set(HEAD * 2.1 * s, 1, HEAD * 2.1 * s);
    },
    react(world, e) {
      if (e.t === 'die') {
        const p = world.players[e.id];
        burst(e.x - w.c, e.y - w.c, p ? p.color : 0, 46, 52);
        ring(e.x, e.y, p ? p.color : -1, 32);
      } else if (e.t === 'capture' && e.gained > 0) {
        const p = world.players[e.id];
        ring(e.x, e.y, p ? p.color : -1, Math.min(80, 16 + Math.sqrt(e.gained) * 0.6));
      } else if (e.t === 'spawn') {
        const p = world.players[e.id];
        ring(e.x, e.y, p ? p.color : -1, 36);
      }
    },
    render(cams, dt) {
      units += dt * 60;
      if (units >= 65536) units -= 65536;
      uniforms.uNow.value = units % 256;
      // confetti
      let live = 0;
      for (let i = bits.length - 1; i >= 0; i--) {
        const b = bits[i];
        b.life += dt;
        if (b.life >= b.max) {
          bits.splice(i, 1);
          continue;
        }
        b.vy -= 96 * dt;
        b.x += b.vx * dt;
        b.y = Math.max(0.4, b.y + b.vy * dt);
        b.z += b.vz * dt;
        if (b.y <= 0.4) {
          b.vx *= 0.8;
          b.vz *= 0.8;
          b.vy = Math.abs(b.vy) * 0.3;
        }
        b.rx += b.vr * dt;
        b.ry += b.vr * 0.7 * dt;
      }
      for (const b of bits) {
        if (live >= MAX_BITS) break;
        const fade = 1 - Math.max(0, (b.life - b.max * 0.7) / (b.max * 0.3));
        dummy.position.set(b.x, b.y, b.z);
        dummy.rotation.set(b.rx, b.ry, 0);
        dummy.scale.setScalar(b.size * fade);
        dummy.updateMatrix();
        bitsMesh.setMatrixAt(live, dummy.matrix);
        tmpColor.copy(b.color < 0 ? white : palette[b.color % palette.length]);
        bitsMesh.setColorAt(live, tmpColor);
        live++;
      }
      bitsMesh.count = live;
      bitsMesh.instanceMatrix.needsUpdate = true;
      if (bitsMesh.instanceColor) bitsMesh.instanceColor.needsUpdate = true;
      for (const r of rings) {
        if (!r.mesh.visible) continue;
        r.t += dt;
        const k = r.t / r.max;
        if (k >= 1) {
          r.mesh.visible = false;
          continue;
        }
        const s = r.size * (0.4 + 0.9 * (1 - (1 - k) * (1 - k)));
        r.mesh.scale.set(s, 1, s);
        r.mat.opacity = 0.75 * (1 - k);
      }
      if (lost) return;
      if (cams.length === 1) {
        const c = cams[0];
        renderer.setScissorTest(false);
        renderer.setViewport(0, 0, cssW, cssH);
        aim(c);
        renderer.render(scene, camera);
        return;
      }
      renderer.setScissorTest(true);
      for (const c of cams) {
        const y = cssH - c.vy - c.vh;
        renderer.setViewport(c.vx, y, c.vw, c.vh);
        renderer.setScissor(c.vx, y, c.vw, c.vh);
        aim(c);
        renderer.render(scene, camera);
      }
      renderer.setScissorTest(false);
    },
    project(cam, x, y, lift) {
      aim(cam);
      v3.set(x - w.c, lift, y - w.c).project(camera);
      if (v3.z > 1) return null;
      return { x: cam.vx + ((v3.x + 1) / 2) * cam.vw, y: cam.vy + ((1 - v3.y) / 2) * cam.vh };
    },
    unproject(cam, sx, sy) {
      aim(cam);
      const nx = ((sx - cam.vx) / cam.vw) * 2 - 1;
      const ny = -(((sy - cam.vy) / cam.vh) * 2 - 1);
      v3.set(nx, ny, 0.5).unproject(camera);
      v3b.copy(v3).sub(camera.position);
      if (Math.abs(v3b.y) < 1e-6) return null;
      const t = -camera.position.y / v3b.y;
      if (t < 0) return null;
      return { x: camera.position.x + v3b.x * t + w.c, y: camera.position.z + v3b.z * t + w.c };
    },
    dispose() {
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      for (let i = 0; i < MAX_PLAYERS; i++) dropHead(i);
      for (const r of rings) {
        scene.remove(r.mesh);
        r.mat.dispose();
      }
      scene.remove(bitsMesh);
      bitsMesh.dispose();
      bitMat.dispose();
      scene.remove(board);
      boardMat.dispose();
      gridTex.dispose();
      coarseTex.dispose();
      shadowTex.dispose();
      shadowMat.dispose();
      for (const g of Object.values(geo)) g.dispose();
      boardGeo.dispose();
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}
