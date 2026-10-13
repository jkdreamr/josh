// three.js view of a Palm Drive race: the circuit, campus scenery, karts, items and effects.
// It reads a Race every frame and never changes it.
import type { T } from './gl';
import { createGL, disposeTree, type GL } from './gl';
import type { CourseId } from './courses';
import { CURB, EDGE, LANDMARKS, ROAD_HALF, gridSpot, headingOf, locate, pointAt, type Track } from './track';
import { COUNTDOWN, RAMP_H, RAMP_LEN, TURBO_AT, turboLevel, type Ev, type Hat, type Kart, type Race, type ThingKind } from './logic';

type Three = typeof import('three');

export type View = {
  gl: GL;
  camera: T.PerspectiveCamera;
  resize(w: number, h: number): void;
  /** Moves everything to match the race and points the chase camera at kart `me` (or behind it). */
  frame(r: Race, me: number, dt: number, clock: number, lookBack?: boolean): void;
  /** One-off effects for race events: puffs, blasts, camera shake. */
  react(e: Ev, r: Race, me: number): void;
  /** Screen position (CSS pixels) of a world point, or null when behind the camera. */
  project(x: number, y: number, z: number, w: number, h: number): { x: number; y: number } | null;
  render(): void;
  dispose(): void;
};

type KartView = {
  root: T.Group;
  body: T.Group;
  paint: T.MeshLambertMaterial;
  color: number;
  steer: T.Group[];
  spinners: T.Group[];
  flames: T.Group;
  sparks: T.Mesh[];
  sparkMat: T.MeshBasicMaterial;
  shadow: T.Mesh;
  /** The banana or shell held out behind, filled in once the item models exist. */
  trail: T.Group;
  stars: T.Group;
  wind: T.Group;
  hat: T.Group;
  hatName: Hat;
  /** Swaps the hat when a kart's look changes (an online racer's garage arrives after the race is built). */
  wear: (hat: Hat) => void;
  roll: number;
  spinA: number;
  flipA: number;
  trickA: number;
  driftYaw: number;
  wheelA: number;
  smoke: number;
};

type KartGeo = { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; ring: T.TorusGeometry; cone: T.ConeGeometry; plane: T.PlaneGeometry };
type KartMats = { dark: T.Material; skin: T.Material; white: T.Material; shadow: T.Material; star: T.Material; wind: T.Material; stone: T.Material; tile: T.Material; gold: T.Material; red: T.Material; green: T.Material };

/** Each racer's headgear: a cardinal cap for you, a tree for Tree, a little Hoover Tower for Hoover... */
function makeHat(THREE: Three, geo: KartGeo, m: KartMats, hat: Hat, paint: T.Material) {
  const g = new THREE.Group();
  g.position.set(0, 1.58, -0.26);
  const add = (geom: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const o = new THREE.Mesh(geom, mat);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    g.add(o);
    return o;
  };
  if (hat === 'cap') {
    add(geo.ball, paint, 0, -0.04, 0, 0.36, 0.2, 0.36);
    add(geo.box, paint, 0, -0.08, 0.3, 0.42, 0.04, 0.32);
    add(geo.box, m.white, 0, 0.0, 0.33, 0.12, 0.12, 0.02).rotation.x = -0.3;
  } else if (hat === 'tree') {
    add(geo.cone, m.green, 0, 0.18, 0, 0.36, 0.4, 0.36);
    add(geo.cone, m.green, 0, 0.42, 0, 0.27, 0.36, 0.27);
    add(geo.cone, m.green, 0, 0.62, 0, 0.18, 0.3, 0.18);
  } else if (hat === 'top') {
    add(geo.wheel, m.dark, 0, -0.02, 0, 0.42, 0.04, 0.42);
    add(geo.wheel, m.dark, 0, 0.22, 0, 0.24, 0.46, 0.24);
    add(geo.wheel, paint, 0, 0.06, 0, 0.25, 0.08, 0.25);
  } else if (hat === 'bow') {
    for (const side of [-1, 1]) add(geo.ball, paint, side * 0.17, 0.02, 0.05, 0.16, 0.12, 0.07).rotation.z = side * 0.4;
    add(geo.ball, m.white, 0, 0.02, 0.06, 0.07, 0.07, 0.07);
  } else if (hat === 'tower') {
    add(geo.box, m.stone, 0, 0.18, 0, 0.18, 0.42, 0.18);
    add(geo.box, m.dark, 0, 0.34, 0, 0.2, 0.08, 0.2);
    add(geo.ball, m.tile, 0, 0.42, 0, 0.12, 0.12, 0.12);
  } else if (hat === 'axe') {
    add(geo.box, m.red, 0, 0.22, -0.05, 0.05, 0.5, 0.05);
    add(geo.box, m.white, 0.1, 0.4, -0.05, 0.2, 0.16, 0.03);
  } else if (hat === 'dish') {
    add(geo.box, m.white, 0, 0.1, 0, 0.04, 0.24, 0.04);
    const bowl = add(geo.ball, m.white, 0, 0.26, 0.04, 0.24, 0.08, 0.24);
    bowl.rotation.x = -0.6;
  } else if (hat === 'claw') {
    for (const side of [-1, 1]) add(geo.cone, m.red, side * 0.2, 0.12, 0, 0.08, 0.36, 0.08).rotation.z = -side * 0.5;
  }
  return g;
}

/** Deterministic scatter for scenery, so campus looks the same every visit. */
function scatter(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
}

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  draw(c.getContext('2d')!);
  return c;
}

function texture(THREE: Three, c: HTMLCanvasElement, repeat?: [number, number]) {
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  if (repeat) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeat[0], repeat[1]);
  }
  return tex;
}

const noise = (g: CanvasRenderingContext2D, w: number, h: number, n: number, alpha: number, light = true) => {
  for (let i = 0; i < n; i++) {
    g.fillStyle = `rgba(${light ? '255,255,255' : '0,0,0'},${Math.random() * alpha})`;
    g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
  }
};

/**
 * A strip along the track between lateral offsets a and b (meters, positive to the right), from s0 to s1.
 * The v texture coordinate runs one unit every vLen meters.
 */
function ribbon(THREE: Three, t: Track, a: number, b: number, y: number, vLen: number, s0 = 0, s1 = t.length) {
  const count = Math.max(1, Math.round((s1 - s0) / t.step));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= count; k++) {
    const s = s0 + ((s1 - s0) * k) / count;
    const p = pointAt(t, s);
    const nx = -p.tz;
    const nz = p.tx;
    pos.push(p.x + nx * a, y, p.z + nz * a, p.x + nx * b, y, p.z + nz * b);
    uv.push(0, (s - s0) / vLen, 1, (s - s0) / vLen);
    if (k < count) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A vertical strip at lateral offset d, from the ground to height h. */
function fence(THREE: Three, t: Track, d: number, h: number, vLen: number) {
  const count = t.n;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= count; k++) {
    const p = pointAt(t, (t.length * k) / count, d);
    pos.push(p.x, 0, p.z, p.x, h, p.z);
    const v = (t.length * k) / count / vLen;
    uv.push(v, 0, v, 1);
    if (k < count) idx.push(2 * k, 2 * k + 2, 2 * k + 1, 2 * k + 1, 2 * k + 2, 2 * k + 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function frondGeometry(THREE: Three) {
  // seven drooping blades radiating from the crown
  const pos: number[] = [];
  const blades = 7;
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2 + 0.3;
    const dx = Math.cos(a);
    const dz = Math.sin(a);
    const len = 2.8;
    const tip = [dx * len, -1, dz * len];
    const mid = [dx * len * 0.5, 0.25, dz * len * 0.5];
    const w = 0.45;
    const px = -dz * w;
    const pz = dx * w;
    pos.push(0, 0, 0, mid[0] + px, mid[1], mid[2] + pz, mid[0] - px, mid[1], mid[2] - pz);
    pos.push(mid[0] + px, mid[1], mid[2] + pz, tip[0], tip[1], tip[2], mid[0] - px, mid[1], mid[2] - pz);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/** Memorial Church with its gold mosaic, framed by the Main Quad arcades. The facade faces south. */
function makeChurch(THREE: Three, box: T.BoxGeometry) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xd9b98a });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a });
  const gold = new THREE.MeshLambertMaterial({ color: 0xe6c36a, emissive: 0x3a2a00 });
  const shadow = new THREE.MeshLambertMaterial({ color: 0x5a3f2e });
  const mesh = (geo: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, ry = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    m.rotation.y = ry;
    g.add(m);
    return m;
  };
  const roof = new THREE.CylinderGeometry(0, 1, 1, 4, 1);
  // long arcade wings either side, with their row of arches
  for (const side of [-1, 1]) {
    mesh(box, stone, side * 30, 4, 8, 34, 8, 10);
    mesh(roof, tile, side * 30, 9.2, 8, 27, 2.6, 9, Math.PI / 4);
    for (let a = 0; a < 7; a++) mesh(box, shadow, side * (16 + a * 4.4), 2.6, 2.9, 2.6, 4, 0.3);
  }
  mesh(box, stone, 0, 8, 14, 22, 16, 30);
  mesh(roof, tile, 0, 19.5, 14, 17, 7, 24, Math.PI / 4);
  mesh(box, stone, 0, 9.5, -2, 26, 19, 3);
  mesh(roof, stone, 0, 22, -2, 19, 6, 2.2, Math.PI / 4);
  mesh(box, gold, 0, 13.5, -3.7, 18, 7.5, 0.4);
  for (const x of [-6, 0, 6]) mesh(box, shadow, x, 4, -3.7, 3.4, 6.5, 0.4);
  mesh(new THREE.CylinderGeometry(6, 6, 6, 8), stone, 0, 26, 22);
  mesh(new THREE.SphereGeometry(6, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2), tile, 0, 29, 22);
  return g;
}

/** Hoover Tower: a tall sandstone shaft, the open belfry and the red dome. */
function makeHoover(THREE: Three, box: T.BoxGeometry) {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0xe0c49a });
  const dark = new THREE.MeshLambertMaterial({ color: 0x4a3a2c });
  const tile = new THREE.MeshLambertMaterial({ color: 0xb4553a });
  const add = (geo: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const o = new THREE.Mesh(geo, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    g.add(o);
  };
  add(box, stone, 0, 6, 0, 16, 12, 16);
  add(box, stone, 0, 26, 0, 10, 40, 10);
  for (const [x, z, sx, sz] of [[0, 5.05, 7, 0.2], [0, -5.05, 7, 0.2], [5.05, 0, 0.2, 7], [-5.05, 0, 0.2, 7]]) add(box, dark, x, 48, z, sx, 6, sz);
  add(box, stone, 0, 51.5, 0, 10.6, 1.2, 10.6);
  add(new THREE.SphereGeometry(1, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2), tile, 0, 52, 0, 4.6, 5.5, 4.6);
  add(box, stone, 0, 58.5, 0, 1.2, 2.5, 1.2);
  return g;
}

/** A sandstone campus building with a red tile hip roof. */
function makeHall(THREE: Three, box: T.BoxGeometry, roof: T.BufferGeometry, mats: { stone: T.Material; tile: T.Material; dark: T.Material }, w: number, d: number, h: number) {
  const g = new THREE.Group();
  const body = new THREE.Mesh(box, mats.stone);
  body.scale.set(w, h, d);
  body.position.y = h / 2;
  const top = new THREE.Mesh(roof, mats.tile);
  top.scale.set(w * 0.72, 4, d * 0.72);
  top.rotation.y = Math.PI / 4;
  top.position.y = h + 2;
  g.add(body, top);
  for (let x = -w / 2 + 3; x <= w / 2 - 3; x += 4) {
    for (const side of [-1, 1]) {
      const win = new THREE.Mesh(box, mats.dark);
      win.scale.set(1.6, h * 0.4, 0.2);
      win.position.set(x, h * 0.5, (side * d) / 2);
      g.add(win);
    }
  }
  return g;
}

function makeKart(THREE: Three, geo: KartGeo, color: string, hat: Hat, shared: KartMats): KartView {
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  const paint = new THREE.MeshLambertMaterial({ color });
  const add = (parent: T.Object3D, g: T.BufferGeometry, m: T.Material, x: number, y: number, z: number, sx = 1, sy = 1, sz = 1) => {
    const o = new THREE.Mesh(g, m);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    parent.add(o);
    return o;
  };
  const { dark, skin, white } = shared;
  add(body, geo.box, paint, 0, 0.34, 0.05, 1.3, 0.22, 2.6);
  add(body, geo.box, paint, 0, 0.42, 1.45, 0.95, 0.22, 0.7);
  add(body, geo.box, dark, 0, 0.32, 1.86, 1.45, 0.16, 0.18);
  for (const sx of [-1, 1]) add(body, geo.box, paint, sx * 0.66, 0.46, -0.1, 0.2, 0.3, 1.5);
  add(body, geo.box, dark, 0, 0.78, -0.62, 0.78, 0.72, 0.16);
  add(body, geo.box, paint, 0, 0.8, -0.28, 0.6, 0.56, 0.5);
  add(body, geo.ball, skin, 0, 1.24, -0.2, 0.28, 0.28, 0.28);
  add(body, geo.ball, white, 0, 1.3, -0.26, 0.34, 0.32, 0.34);
  add(body, geo.box, paint, 0, 1.36, -0.26, 0.1, 0.36, 0.7);
  add(body, geo.ring, dark, 0, 1.0, 0.3, 0.24, 0.24, 0.24).rotation.x = -0.9;
  const steer: T.Group[] = [];
  const spinners: T.Group[] = [];
  for (const [x, y, z, r, w, front] of [[-0.8, 0.28, 0.95, 0.28, 0.3, 1], [0.8, 0.28, 0.95, 0.28, 0.3, 1], [-0.84, 0.36, -0.82, 0.36, 0.42, 0], [0.84, 0.36, -0.82, 0.36, 0.42, 0]]) {
    const pivot = new THREE.Group();
    pivot.position.set(x, y, z);
    const spin = new THREE.Group();
    pivot.add(spin);
    add(spin, geo.wheel, dark, 0, 0, 0, r, w, r).rotation.z = Math.PI / 2;
    add(spin, geo.box, white, Math.sign(x) * (w / 2 + 0.01), 0, 0, 0.02, r * 1.3, 0.12);
    body.add(pivot);
    spinners.push(spin);
    if (front) steer.push(pivot);
  }
  for (const sx of [-1, 1]) add(body, geo.wheel, dark, sx * 0.3, 0.45, -1.32, 0.09, 0.3, 0.09).rotation.x = Math.PI / 2;
  const flames = new THREE.Group();
  const fire = new THREE.MeshBasicMaterial({ color: 0xffa31a, transparent: true, opacity: 0.9, depthWrite: false });
  for (const sx of [-1, 1]) add(flames, geo.cone, fire, sx * 0.3, 0.45, -1.85, 0.16, 0.8, 0.16).rotation.x = -Math.PI / 2;
  flames.visible = false;
  body.add(flames);
  const sparkMat = new THREE.MeshBasicMaterial({ color: 0x4fc3ff, transparent: true, opacity: 0.95, depthWrite: false });
  const sparks = [-1, 1].map((sx) => {
    const m = add(body, geo.ball, sparkMat, sx * 0.85, 0.18, -1.05, 0.22, 0.22, 0.22);
    m.visible = false;
    return m;
  });
  const hatGroup = new THREE.Group();
  hatGroup.add(makeHat(THREE, geo, shared, hat, paint));
  body.add(hatGroup);
  const trail = new THREE.Group();
  trail.position.set(0, 0.05, -1.95);
  body.add(trail);
  // dizzy stars over the driver's head after a hit
  const stars = new THREE.Group();
  stars.position.set(0, 1.95, -0.25);
  for (let i = 0; i < 3; i++) {
    const st = add(stars, geo.box, shared.star, Math.cos((i / 3) * Math.PI * 2) * 0.45, 0, Math.sin((i / 3) * Math.PI * 2) * 0.45, 0.16, 0.16, 0.05);
    st.rotation.z = Math.PI / 4;
  }
  stars.visible = false;
  body.add(stars);
  // wind lines streaming past while you ride someone's slipstream
  const wind = new THREE.Group();
  for (const [x, y] of [[-1.05, 0.5], [1.05, 0.5], [-0.6, 1.5], [0.6, 1.5]]) add(wind, geo.box, shared.wind, x, y, 0.2, 0.035, 0.035, 2.6);
  wind.visible = false;
  body.add(wind);
  body.scale.setScalar(0.85);
  const shadow = new THREE.Mesh(geo.plane, shared.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(2.2, 3.2, 1);
  shadow.position.y = 0.11;
  root.add(shadow);
  const view: KartView = {
    root, body, paint, color: new THREE.Color(color).getHex(), steer, spinners, flames, sparks, sparkMat, shadow, trail, stars, wind,
    hat: hatGroup,
    hatName: hat,
    wear(next) {
      if (next === view.hatName) return;
      view.hatName = next;
      for (const child of [...hatGroup.children]) hatGroup.remove(child);
      hatGroup.add(makeHat(THREE, geo, shared, next, paint));
    },
    roll: 0, spinA: 0, flipA: 0, trickA: 0, driftYaw: 0, wheelA: 0, smoke: 0,
  };
  return view;
}

const SPARK = [0, 0x4fc3ff, 0xff9d2e, 0xd36bff];
const damp = (a: number, b: number, k: number, dt: number) => a + (b - a) * (1 - Math.exp(-k * dt));
const dampAngle = (a: number, b: number, k: number, dt: number) => {
  let d = b - a;
  d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
  return a + d * (1 - Math.exp(-k * dt));
};

/** Each course's colors: light, grass, curbs, walls and the banner over the start. */
type Look = {
  fog: [number, number, number];
  sky: number;
  ground: number;
  sun: [number, number];
  field: string;
  lawn: string;
  curb: [string, string];
  wall: string;
  band: string;
  banner: string;
};
const LOOKS: Record<CourseId, Look> = {
  palm: { fog: [0xf3d6b4, 140, 720], sky: 0xfff3df, ground: 0x6e8a4a, sun: [0xffe4bd, 1.5], field: '#c4b468', lawn: '#6fa94e', curb: ['#f4f1ea', '#d23a2e'], wall: '#e6cfa6', band: '#8c1515', banner: 'PALM DRIVE' },
  lake: { fog: [0xeeb08e, 120, 640], sky: 0xffd8c2, ground: 0x5d6b4a, sun: [0xffb07a, 1.4], field: '#b8a862', lawn: '#79a85a', curb: ['#f4f1ea', '#2f6fb5'], wall: '#b98b5e', band: '#2f6fb5', banner: 'LAKE LAGUNITA' },
};

/** What a course's scenery builder gets: the scene, the track and shared helpers. */
type Scenery = {
  THREE: Three;
  scene: T.Scene;
  t: Track;
  r: Race;
  geo: { box: T.BoxGeometry; wheel: T.CylinderGeometry; ball: T.SphereGeometry; ring: T.TorusGeometry; cone: T.ConeGeometry; plane: T.PlaneGeometry; roof: T.CylinderGeometry };
  mats: { stone: T.MeshLambertMaterial; tile: T.MeshLambertMaterial; dark: T.MeshLambertMaterial };
  rand: () => number;
  /** True when (x, z) is at least `margin` outside the walls of every stretch of road. */
  clear: (x: number, z: number, margin: number) => boolean;
  dummy: T.Object3D;
};

/** Palm Drive: palms down the drive and round the Oval, the Arboretum, Memorial Church, Hoover Tower, the Dish. */
function campus(c: Scenery) {
  const { THREE, scene, t, r, geo, mats, rand, clear, dummy } = c;
  // palms: down both sides of Palm Drive and around the Oval
  const palms: { x: number; z: number; hgt: number }[] = [];
  const [pd0, pd1] = r.lay.palmDrive ?? [0, 0];
  const pdLen = (pd1 - pd0 + t.length) % t.length;
  for (let a = 0; a < pdLen; a += 11) {
    for (const side of [-1, 1]) {
      const p = pointAt(t, pd0 + a, side * (EDGE + 2.6));
      if (clear(p.x, p.z, 1.5)) palms.push({ x: p.x, z: p.z, hgt: 9 + rand() * 3 });
    }
  }
  const oval = LANDMARKS.oval;
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 9) {
    const x = oval.x + Math.cos(a) * (oval.rx + 3);
    const z = oval.z + Math.sin(a) * (oval.rz + 3);
    if (clear(x, z, 1.5)) palms.push({ x, z, hgt: 8 + rand() * 3 });
  }
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.24, 0.38, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), palms.length);
  const crowns = new THREE.InstancedMesh(frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), palms.length);
  palms.forEach((p, i) => {
    dummy.position.set(p.x, p.hgt / 2, p.z);
    dummy.scale.set(1, p.hgt, 1);
    dummy.rotation.set(0, 0, 0);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    dummy.position.set(p.x, p.hgt + 0.2, p.z);
    dummy.scale.set(1.1, 1.1, 1.1);
    dummy.rotation.set(0, i * 1.3, 0);
    dummy.updateMatrix();
    crowns.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trunks, crowns);

  // oaks and eucalyptus in the Arboretum, east of Palm Drive
  const oaks: { x: number; z: number; r: number }[] = [];
  for (let n = 0; oaks.length < 110 && n < 2000; n++) {
    const x = -20 - rand() * 170;
    const z = -260 + rand() * 300;
    const near = [LANDMARKS.cantor, LANDMARKS.hoover].some((b) => Math.hypot(b.x - x, b.z - z) < 24);
    if (!near && clear(x, z, 3.5)) oaks.push({ x, z, r: 2.2 + rand() * 2.2 });
  }
  for (let n = 0; oaks.length < 170 && n < 3000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 150 + rand() * 260;
    const x = -20 + Math.cos(a) * dist;
    const z = Math.sin(a) * dist;
    if (clear(x, z, 4) && Math.hypot(x - LANDMARKS.church.x, z - LANDMARKS.church.z) > 60) oaks.push({ x, z, r: 2.5 + rand() * 3 });
  }
  const oakTrunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.45, 1, 6), new THREE.MeshLambertMaterial({ color: 0x6b4f37 }), oaks.length);
  const oakTop = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color: 0x4f7d3a, flatShading: true }), oaks.length);
  oaks.forEach((o, i) => {
    dummy.rotation.set(0, i, 0);
    dummy.position.set(o.x, o.r * 0.6, o.z);
    dummy.scale.set(1, o.r * 1.2, 1);
    dummy.updateMatrix();
    oakTrunk.setMatrixAt(i, dummy.matrix);
    dummy.position.set(o.x, o.r * 1.5, o.z);
    dummy.scale.set(o.r * 1.15, o.r * 0.9, o.r * 1.15);
    dummy.updateMatrix();
    oakTop.setMatrixAt(i, dummy.matrix);
  });
  scene.add(oakTrunk, oakTop);

  // landmarks
  const church = makeChurch(THREE, geo.box);
  church.position.set(LANDMARKS.church.x, 0, LANDMARKS.church.z);
  church.scale.setScalar(1.25);
  scene.add(church);
  const hoover = makeHoover(THREE, geo.box);
  hoover.position.set(LANDMARKS.hoover.x, 0, LANDMARKS.hoover.z);
  scene.add(hoover);
  const cantor = makeHall(THREE, geo.box, geo.roof, mats, 30, 16, 11);
  cantor.position.set(LANDMARKS.cantor.x, 0, LANDMARKS.cantor.z);
  cantor.rotation.y = Math.PI / 2;
  scene.add(cantor);
  for (const [x, z, w, d, h, ry] of [
    [70, 150, 26, 14, 10, 0.2],
    [-70, 175, 30, 14, 12, -0.1],
    [60, 60, 24, 12, 9, Math.PI / 2],
    [-120, 215, 26, 16, 12, 0.3],
    [95, 230, 28, 14, 12, -0.2],
    [-150, -60, 22, 12, 9, 1.2],
  ]) {
    if (!clear(x, z, Math.max(w, d) / 2 + 2)) continue;
    const hall = makeHall(THREE, geo.box, geo.roof, mats, w, d, h);
    hall.position.set(x, 0, z);
    hall.rotation.y = ry;
    scene.add(hall);
  }

  // the Oval lawn with its big red S
  {
    const lawn = new THREE.Mesh(new THREE.CircleGeometry(1, 48), new THREE.MeshLambertMaterial({ color: 0x8fca62 }));
    lawn.rotation.x = -Math.PI / 2;
    lawn.scale.set(oval.rx, oval.rz, 1);
    lawn.position.set(oval.x, 0.03, oval.z);
    scene.add(lawn);
    const letter = texture(
      THREE,
      canvas(256, 256, (g) => {
        g.fillStyle = '#8c1515';
        g.font = 'bold 230px Georgia, serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('S', 128, 140);
      }),
    );
    const s = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ map: letter, transparent: true, depthWrite: false }));
    s.rotation.x = -Math.PI / 2;
    // read the right way round from the Palm Drive end: canvas top toward the church
    s.rotation.z = Math.PI;
    s.scale.set(24, 24, 1);
    s.position.set(oval.x, 0.05, oval.z);
    scene.add(s);
  }

  // golden foothills all round, and the Dish up on one of them
  const hillMat = new THREE.MeshLambertMaterial({ color: 0xc8b06a, flatShading: true });
  const hillGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
    const dist = 560 + rand() * 160;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(-20 + Math.cos(a) * dist, -4, Math.sin(a) * dist);
    hill.scale.set(110 + rand() * 90, 40 + rand() * 70, 110 + rand() * 90);
    scene.add(hill);
  }
  {
    const dish = new THREE.Group();
    const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f0, side: THREE.DoubleSide });
    const bowl = new THREE.Mesh(new THREE.SphereGeometry(14, 18, 8, 0, Math.PI * 2, 0, 0.9), white);
    bowl.rotation.x = -2.2;
    bowl.position.y = 26;
    const stand = new THREE.Mesh(geo.box, white);
    stand.scale.set(4, 22, 4);
    stand.position.y = 11;
    dish.add(bowl, stand);
    dish.position.set(LANDMARKS.dish.x, 20, LANDMARKS.dish.z);
    scene.add(dish);
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(LANDMARKS.dish.x, -6, LANDMARKS.dish.z);
    hill.scale.set(120, 30, 120);
    scene.add(hill);
  }
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(30, 32), new THREE.MeshBasicMaterial({ color: 0xfff0c8, fog: false }));
  sunDisc.position.set(320, 230, -900);
  sunDisc.lookAt(0, 0, 0);
  scene.add(sunDisc);
}

/** Whether (x, z) is inside the loop the centerline makes. */
function insideLoop(t: Track, x: number, z: number) {
  let inside = false;
  for (let i = 0, j = t.n - 1; i < t.n; j = i++) {
    const zi = t.z[i];
    const zj = t.z[j];
    if (zi > z !== zj > z && x < ((t.x[j] - t.x[i]) * (z - zi)) / (zj - zi) + t.x[i]) inside = !inside;
  }
  return inside;
}

/** Instanced meshes from a list of transforms. */
function instances(THREE: Three, scene: T.Scene, dummy: T.Object3D, geo: T.BufferGeometry, mat: T.Material, items: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry?: number; rx?: number }[]) {
  if (!items.length) return;
  const mesh = new THREE.InstancedMesh(geo, mat, items.length);
  items.forEach((it, i) => {
    dummy.position.set(it.x, it.y, it.z);
    dummy.scale.set(it.sx, it.sy, it.sz);
    dummy.rotation.set(it.rx ?? 0, it.ry ?? 0, 0);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  });
  dummy.rotation.set(0, 0, 0);
  scene.add(mesh);
}

/** Oaks scattered where there is room. */
function oaks(c: Scenery, spots: { x: number; z: number; r: number }[]) {
  const { THREE, scene, dummy } = c;
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.3, 0.45, 1, 6), new THREE.MeshLambertMaterial({ color: 0x6b4f37 }), spots.map((o, i) => ({ x: o.x, y: o.r * 0.6, z: o.z, sx: 1, sy: o.r * 1.2, sz: 1, ry: i })));
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 7, 5), new THREE.MeshLambertMaterial({ color: 0x4f7d3a, flatShading: true }), spots.map((o, i) => ({ x: o.x, y: o.r * 1.5, z: o.z, sx: o.r * 1.15, sy: o.r * 0.9, sz: o.r * 1.15, ry: i })));
}

/** Golden foothills in a ring at `dist` around (cx, cz), with the Dish on one of them. */
function foothills(c: Scenery, cx: number, cz: number, dish: { x: number; z: number }) {
  const { THREE, scene, geo, rand } = c;
  const hillMat = new THREE.MeshLambertMaterial({ color: 0xc8b06a, flatShading: true });
  const hillGeo = new THREE.SphereGeometry(1, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2);
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 14) {
    const dist = 560 + rand() * 160;
    const hill = new THREE.Mesh(hillGeo, hillMat);
    hill.position.set(cx + Math.cos(a) * dist, -4, cz + Math.sin(a) * dist);
    hill.scale.set(110 + rand() * 90, 40 + rand() * 70, 110 + rand() * 90);
    scene.add(hill);
  }
  const white = new THREE.MeshLambertMaterial({ color: 0xf2f2f0, side: THREE.DoubleSide });
  const d = new THREE.Group();
  const bowl = new THREE.Mesh(new THREE.SphereGeometry(14, 18, 8, 0, Math.PI * 2, 0, 0.9), white);
  bowl.rotation.x = -2.2;
  bowl.position.y = 26;
  const stand = new THREE.Mesh(geo.box, white);
  stand.scale.set(4, 22, 4);
  stand.position.y = 11;
  d.add(bowl, stand);
  d.position.set(dish.x, 20, dish.z);
  scene.add(d);
  const hill = new THREE.Mesh(hillGeo, hillMat);
  hill.position.set(dish.x, -6, dish.z);
  hill.scale.set(120, 30, 120);
  scene.add(hill);
}

/**
 * Lake Lagunita: water fills the loop, reeds and lily pads line the shore, sailboats and ducks are out on the water,
 * the boathouse stands on its peninsula inside the hairpin, oaks and foothills all round, and the sun is going down.
 */
function lake(c: Scenery) {
  const { THREE, scene, t, geo, mats, rand, clear, dummy } = c;
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let cx = 0;
  let cz = 0;
  for (let i = 0; i < t.n; i++) {
    minX = Math.min(minX, t.x[i]);
    maxX = Math.max(maxX, t.x[i]);
    minZ = Math.min(minZ, t.z[i]);
    maxZ = Math.max(maxZ, t.z[i]);
    cx += t.x[i] / t.n;
    cz += t.z[i] / t.n;
  }
  // The water is many small tiles rather than a few huge triangles (see the ground), each kept if its middle is
  // inside the loop; the walls and lawn along the shore hide the ragged edge.
  const CELL = 6;
  const pos: number[] = [];
  const uv: number[] = [];
  for (let x = minX; x < maxX; x += CELL) {
    for (let z = minZ; z < maxZ; z += CELL) {
      if (!insideLoop(t, x + CELL / 2, z + CELL / 2)) continue;
      // wound so the tiles face up (+y)
      const q = [x, z, x, z + CELL, x + CELL, z + CELL, x, z, x + CELL, z + CELL, x + CELL, z];
      for (let k = 0; k < q.length; k += 2) {
        pos.push(q[k], -0.01, q[k + 1]);
        uv.push(q[k] / 20, q[k + 1] / 20);
      }
    }
  }
  const waterGeo = new THREE.BufferGeometry();
  waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  waterGeo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  waterGeo.computeVertexNormals();
  const ripples = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#4a7db0';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = 'rgba(255,225,200,0.22)';
      g.lineWidth = 2;
      for (let k = 0; k < 16; k++) {
        const x = Math.random() * 128;
        const y = Math.random() * 128;
        g.beginPath();
        g.moveTo(x, y);
        g.quadraticCurveTo(x + 9, y - 3, x + 18, y);
        g.stroke();
      }
    }),
  );
  ripples.wrapS = ripples.wrapT = THREE.RepeatWrapping;
  scene.add(new THREE.Mesh(waterGeo, new THREE.MeshLambertMaterial({ map: ripples })));

  // reeds and cattails in clumps along the shore, and lily pads just off it
  const reeds: Parameters<typeof instances>[5] = [];
  const tops: Parameters<typeof instances>[5] = [];
  const pads: Parameters<typeof instances>[5] = [];
  const flowers: Parameters<typeof instances>[5] = [];
  for (let s = 0; s < t.length; s += 3.5) {
    if (rand() < 0.45) continue;
    const p = pointAt(t, s, -(EDGE + 1.2 + rand() * 3));
    if (!clear(p.x, p.z, 0.8) || !insideLoop(t, p.x, p.z)) continue;
    for (let k = 0; k < 3 + Math.floor(rand() * 4); k++) {
      const x = p.x + (rand() - 0.5) * 2.2;
      const z = p.z + (rand() - 0.5) * 2.2;
      const h = 1.3 + rand() * 1.4;
      reeds.push({ x, y: h / 2, z, sx: 0.09, sy: h, sz: 0.09, rx: (rand() - 0.5) * 0.25 });
      if (rand() < 0.4) tops.push({ x, y: h * 0.92, z, sx: 0.12, sy: 0.4, sz: 0.12 });
    }
    if (rand() < 0.35) {
      const q = pointAt(t, s, -(EDGE + 5 + rand() * 9));
      if (clear(q.x, q.z, 1) && insideLoop(t, q.x, q.z)) {
        const size = 0.7 + rand() * 0.6;
        pads.push({ x: q.x, y: 0.01, z: q.z, sx: size, sy: size, sz: size, rx: -Math.PI / 2 });
        if (rand() < 0.3) flowers.push({ x: q.x + 0.2, y: 0.12, z: q.z, sx: 0.22, sy: 0.16, sz: 0.22 });
      }
    }
  }
  instances(THREE, scene, dummy, new THREE.ConeGeometry(1, 1, 4), new THREE.MeshLambertMaterial({ color: 0x5f7f3a }), reeds);
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(1, 1, 1, 6), new THREE.MeshLambertMaterial({ color: 0x5a3b22 }), tops);
  instances(THREE, scene, dummy, new THREE.CircleGeometry(1, 10), new THREE.MeshLambertMaterial({ color: 0x4f8f3f, side: THREE.DoubleSide }), pads);
  instances(THREE, scene, dummy, new THREE.SphereGeometry(1, 8, 6), new THREE.MeshLambertMaterial({ color: 0xf6a8c8 }), flowers);

  // somewhere out on the open water, well clear of the road
  const onWater = (margin: number) => {
    for (let n = 0; n < 400; n++) {
      const x = minX + rand() * (maxX - minX);
      const z = minZ + rand() * (maxZ - minZ);
      if (insideLoop(t, x, z) && clear(x, z, margin)) return { x, z };
    }
    return null;
  };
  // sailboats with cardinal and white sails
  const sail = new THREE.BufferGeometry();
  sail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 1, 0, 0, 0, 1], 3));
  sail.computeVertexNormals();
  const hullMat = new THREE.MeshLambertMaterial({ color: 0xf4f1ea });
  const mastMat = new THREE.MeshLambertMaterial({ color: 0x3e3128 });
  const sailMats = [new THREE.MeshLambertMaterial({ color: 0xfafafa, side: THREE.DoubleSide }), new THREE.MeshLambertMaterial({ color: 0xb1282a, side: THREE.DoubleSide })];
  for (let b = 0; b < 6; b++) {
    const at = onWater(10);
    if (!at) break;
    const boat = new THREE.Group();
    const hull = new THREE.Mesh(geo.box, hullMat);
    hull.scale.set(1.4, 0.7, 3.6);
    hull.position.y = 0.3;
    const mast = new THREE.Mesh(geo.box, mastMat);
    mast.scale.set(0.12, 5.2, 0.12);
    mast.position.set(0, 3, 0.4);
    const sl = new THREE.Mesh(sail, sailMats[b % 2]);
    sl.scale.set(1, 4.6, -2.6);
    sl.position.set(0.05, 0.9, 0.35);
    boat.add(hull, mast, sl);
    boat.position.set(at.x, 0, at.z);
    boat.rotation.y = rand() * Math.PI * 2;
    scene.add(boat);
  }
  // mallards paddling about
  const duck = { body: new THREE.MeshLambertMaterial({ color: 0x8a6a4a }), head: new THREE.MeshLambertMaterial({ color: 0x2f7d4a }), beak: new THREE.MeshLambertMaterial({ color: 0xf2a531 }) };
  for (let n = 0; n < 12; n++) {
    const at = onWater(3);
    if (!at) break;
    const d = new THREE.Group();
    const body = new THREE.Mesh(geo.ball, duck.body);
    body.scale.set(0.32, 0.22, 0.48);
    body.position.y = 0.12;
    const head = new THREE.Mesh(geo.ball, duck.head);
    head.scale.setScalar(0.17);
    head.position.set(0, 0.38, 0.36);
    const beak = new THREE.Mesh(geo.cone, duck.beak);
    beak.scale.set(0.06, 0.16, 0.06);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.36, 0.55);
    d.add(body, head, beak);
    d.position.set(at.x, 0, at.z);
    d.rotation.y = rand() * Math.PI * 2;
    scene.add(d);
  }

  // the boathouse at the middle of the hairpin, on the peninsula it wraps around
  let apex = 0;
  for (let i = 0; i < t.n; i++) if (t.curv[i] > t.curv[apex]) apex = i;
  const mid = pointAt(t, apex * t.step, 1 / t.curv[apex]);
  if (clear(mid.x, mid.z, 3)) {
    const wood = new THREE.MeshLambertMaterial({ color: 0x9c6b43 });
    const roofMat = new THREE.MeshLambertMaterial({ color: 0x2f5d3a });
    const house = makeHall(THREE, geo.box, geo.roof, { stone: wood, tile: roofMat, dark: mats.dark }, 8, 6, 4.5);
    house.position.set(mid.x, 0, mid.z);
    house.rotation.y = headingOf(mid.tx, mid.tz);
    scene.add(house);
    const pole = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0xdddddd }));
    pole.scale.set(0.15, 9, 0.15);
    pole.position.set(mid.x + 5, 4.5, mid.z);
    const flag = new THREE.Mesh(geo.box, new THREE.MeshLambertMaterial({ color: 0x8c1515 }));
    flag.scale.set(0.05, 1.2, 2);
    flag.position.set(mid.x + 5, 8.2, mid.z + 1);
    scene.add(pole, flag);
  }

  // oaks all round outside the loop, and a row of palms behind the dam
  const spots: { x: number; z: number; r: number }[] = [];
  for (let n = 0; spots.length < 170 && n < 4000; n++) {
    const a = rand() * Math.PI * 2;
    const dist = 40 + rand() * 420;
    const x = cx + Math.cos(a) * ((maxX - minX) / 2 + dist);
    const z = cz + Math.sin(a) * ((maxZ - minZ) / 2 + dist);
    if (!insideLoop(t, x, z) && clear(x, z, 4)) spots.push({ x, z, r: 2.4 + rand() * 2.8 });
  }
  oaks(c, spots);
  const palms: { x: number; z: number; hgt: number }[] = [];
  for (let s = 0; s < 120; s += 12) {
    const p = pointAt(t, s - 40, EDGE + 3);
    if (clear(p.x, p.z, 1.5)) palms.push({ x: p.x, z: p.z, hgt: 9 + rand() * 3 });
  }
  instances(THREE, scene, dummy, new THREE.CylinderGeometry(0.24, 0.38, 1, 7), new THREE.MeshLambertMaterial({ color: 0x9c7b58 }), palms.map((p) => ({ x: p.x, y: p.hgt / 2, z: p.z, sx: 1, sy: p.hgt, sz: 1 })));
  instances(THREE, scene, dummy, frondGeometry(THREE), new THREE.MeshLambertMaterial({ color: 0x3f8a4c, side: THREE.DoubleSide }), palms.map((p, i) => ({ x: p.x, y: p.hgt + 0.2, z: p.z, sx: 1.1, sy: 1.1, sz: 1.1, ry: i * 1.3 })));

  // foothills and the Dish, Hoover Tower off across campus, and the sun going down in the west (+x)
  foothills(c, cx, cz, { x: cx + 160, z: cz - 420 });
  const hoover = makeHoover(THREE, geo.box);
  hoover.position.set(cx - 260, 0, cz + 330);
  hoover.scale.setScalar(1.4);
  scene.add(hoover);
  const sunDisc = new THREE.Mesh(new THREE.CircleGeometry(46, 40), new THREE.MeshBasicMaterial({ color: 0xffa45c, fog: false }));
  sunDisc.position.set(cx + 820, 70, cz + 120);
  sunDisc.lookAt(cx, 0, cz);
  const glow = new THREE.Mesh(new THREE.RingGeometry(46, 96, 40), new THREE.MeshBasicMaterial({ color: 0xffc58a, transparent: true, opacity: 0.35, fog: false, depthWrite: false }));
  glow.position.copy(sunDisc.position);
  glow.lookAt(cx, 0, cz);
  scene.add(sunDisc, glow);
}

const SCENERY: Record<CourseId, (c: Scenery) => void> = { palm: campus, lake };

export function buildView(THREE: Three, host: HTMLElement, r: Race): View | null {
  const gl = createGL(THREE, host, { alpha: true });
  if (!gl) return null;
  const t = r.track;
  const look = LOOKS[r.course];
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(...look.fog);
  const camera = new THREE.PerspectiveCamera(68, 1, 0.5, 1600);
  scene.add(new THREE.HemisphereLight(look.sky, look.ground, 1.05));
  const sun = new THREE.DirectionalLight(...look.sun);
  sun.position.set(160, 260, -220);
  scene.add(sun);

  const geo = {
    box: new THREE.BoxGeometry(1, 1, 1),
    wheel: new THREE.CylinderGeometry(1, 1, 1, 14),
    ball: new THREE.SphereGeometry(1, 14, 10),
    ring: new THREE.TorusGeometry(1, 0.25, 6, 14),
    cone: new THREE.ConeGeometry(1, 1, 10),
    plane: new THREE.PlaneGeometry(1, 1),
    roof: new THREE.CylinderGeometry(0, 1, 1, 4, 1),
  };
  const mats = {
    stone: new THREE.MeshLambertMaterial({ color: 0xd9b98a }),
    tile: new THREE.MeshLambertMaterial({ color: 0xb4553a }),
    dark: new THREE.MeshLambertMaterial({ color: 0x3e3128 }),
  };
  const kartShared: KartMats = {
    dark: new THREE.MeshLambertMaterial({ color: 0x1b1c22 }),
    skin: new THREE.MeshLambertMaterial({ color: 0xf2c7a0 }),
    white: new THREE.MeshLambertMaterial({ color: 0xf6f6f8 }),
    star: new THREE.MeshBasicMaterial({ color: 0xffe14d }),
    wind: new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55, depthWrite: false }),
    stone: new THREE.MeshLambertMaterial({ color: 0xe0c49a }),
    tile: new THREE.MeshLambertMaterial({ color: 0xb4553a }),
    gold: new THREE.MeshLambertMaterial({ color: 0xf7c948, emissive: 0x5a3c00 }),
    red: new THREE.MeshLambertMaterial({ color: 0x8c1515 }),
    green: new THREE.MeshLambertMaterial({ color: 0x2f8a3c }),
    shadow: new THREE.MeshBasicMaterial({
      map: texture(
        THREE,
        canvas(64, 64, (g) => {
          const grad = g.createRadialGradient(32, 32, 4, 32, 32, 31);
          grad.addColorStop(0, 'rgba(0,0,0,0.5)');
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad;
          g.fillRect(0, 0, 64, 64);
        }),
      ),
      transparent: true,
      depthWrite: false,
    }),
  };

  // golden summer grass all round, mown green inside the walls
  const field = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = look.field;
      g.fillRect(0, 0, 128, 128);
      noise(g, 128, 128, 900, 0.12, false);
      noise(g, 128, 128, 600, 0.12);
    }),
    [260, 260],
  );
  // Many small cells rather than two giant triangles: clipping a huge triangle near the camera loses enough depth
  // precision for the ground to show through the road.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(2600, 2600, 88, 88), new THREE.MeshLambertMaterial({ map: field }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.05;
  scene.add(ground);
  const lawn = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = look.lawn;
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = 'rgba(255,255,255,0.06)';
      g.fillRect(0, 0, 64, 32);
      noise(g, 64, 64, 300, 0.1, false);
    }),
  );
  lawn.wrapS = lawn.wrapT = THREE.RepeatWrapping;
  const lawnMat = new THREE.MeshLambertMaterial({ map: lawn });
  scene.add(new THREE.Mesh(ribbon(THREE, t, ROAD_HALF, EDGE + 0.4, 0.02, 8), lawnMat));
  scene.add(new THREE.Mesh(ribbon(THREE, t, -EDGE - 0.4, -ROAD_HALF, 0.02, 8), lawnMat));

  // the road, curbs, walls and the start
  const asphalt = texture(
    THREE,
    canvas(256, 256, (g) => {
      g.fillStyle = '#4a4a52';
      g.fillRect(0, 0, 256, 256);
      noise(g, 256, 256, 2200, 0.07);
      noise(g, 256, 256, 1200, 0.12, false);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, 6, 256);
      g.fillRect(250, 0, 6, 256);
    }),
  );
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  const roadLen = t.length / Math.round(t.length / 12);
  scene.add(new THREE.Mesh(ribbon(THREE, t, -ROAD_HALF, ROAD_HALF, 0.04, roadLen), new THREE.MeshLambertMaterial({ map: asphalt })));
  const curbTex = texture(
    THREE,
    canvas(16, 64, (g) => {
      g.fillStyle = look.curb[0];
      g.fillRect(0, 0, 16, 64);
      g.fillStyle = look.curb[1];
      g.fillRect(0, 0, 16, 32);
    }),
  );
  curbTex.wrapT = THREE.RepeatWrapping;
  const curbLen = t.length / Math.round(t.length / 3);
  const curbMat = new THREE.MeshLambertMaterial({ map: curbTex });
  scene.add(new THREE.Mesh(ribbon(THREE, t, ROAD_HALF, ROAD_HALF + CURB, 0.07, curbLen), curbMat));
  scene.add(new THREE.Mesh(ribbon(THREE, t, -ROAD_HALF - CURB, -ROAD_HALF, 0.07, curbLen), curbMat));
  // sandstone walls with a cardinal red band, so the edge of the course always reads
  const wallTex = texture(
    THREE,
    canvas(64, 32, (g) => {
      g.fillStyle = look.wall;
      g.fillRect(0, 0, 64, 32);
      g.fillStyle = 'rgba(120,90,50,0.35)';
      g.fillRect(0, 21, 64, 1);
      g.fillRect(31, 22, 1, 10);
      g.fillRect(0, 11, 64, 1);
      g.fillStyle = look.band;
      g.fillRect(0, 0, 64, 8);
    }),
  );
  wallTex.wrapS = THREE.RepeatWrapping;
  const wallMat = new THREE.MeshLambertMaterial({ map: wallTex, side: THREE.DoubleSide });
  const capMat = new THREE.MeshLambertMaterial({ color: look.band });
  for (const side of [-1, 1]) {
    scene.add(new THREE.Mesh(fence(THREE, t, side * EDGE, 1.25, 3), wallMat));
    scene.add(new THREE.Mesh(ribbon(THREE, t, side * EDGE - 0.3, side * EDGE + 0.3, 1.25, 4), capMat));
  }
  const checker = texture(
    THREE,
    canvas(128, 32, (g) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#fafafa';
        g.fillRect(i * 8, j * 8, 8, 8);
      }
    }),
  );
  scene.add(new THREE.Mesh(ribbon(THREE, t, -ROAD_HALF, ROAD_HALF, 0.09, 2.4, t.length - 1.2, t.length + 1.2), new THREE.MeshBasicMaterial({ map: checker })));
  const lineMat = new THREE.MeshBasicMaterial({ color: 0xf2f2f2 });
  for (let slot = 0; slot < r.karts.length; slot++) {
    const g = gridSpot(t, slot);
    const holder = new THREE.Group();
    holder.position.set(g.x + Math.sin(g.h) * 1.9, 0.08, g.z + Math.cos(g.h) * 1.9);
    holder.rotation.y = g.h;
    const mark = new THREE.Mesh(geo.plane, lineMat);
    mark.rotation.x = -Math.PI / 2;
    mark.scale.set(2.4, 0.25, 1);
    holder.add(mark);
    scene.add(holder);
  }
  // the start gantry with its banner
  {
    const p = pointAt(t, 0);
    const h = headingOf(p.tx, p.tz);
    const gantry = new THREE.Group();
    gantry.position.set(p.x, 0, p.z);
    gantry.rotation.y = h;
    const post = new THREE.MeshLambertMaterial({ color: look.band });
    for (const side of [-1, 1]) {
      const m = new THREE.Mesh(geo.box, post);
      m.scale.set(0.7, 7.2, 0.7);
      m.position.set(side * (EDGE + 0.6), 3.6, 0);
      gantry.add(m);
    }
    const banner = texture(
      THREE,
      canvas(512, 64, (g) => {
        g.fillStyle = look.band;
        g.fillRect(0, 0, 512, 64);
        for (let i = 0; i < 64; i++) {
          g.fillStyle = i % 2 ? '#111' : '#fff';
          g.fillRect(i * 8, 0, 8, 8);
          g.fillStyle = i % 2 ? '#fff' : '#111';
          g.fillRect(i * 8, 56, 8, 8);
        }
        g.fillStyle = '#fff';
        g.font = 'bold 36px Inter, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText(look.banner, 256, 33);
      }),
    );
    const beam = new THREE.Mesh(geo.box, [post, post, post, post, new THREE.MeshLambertMaterial({ map: banner }), new THREE.MeshLambertMaterial({ map: banner })]);
    beam.scale.set(EDGE * 2 + 1.8, 1.6, 0.5);
    beam.position.y = 6.6;
    gantry.add(beam);
    scene.add(gantry);
  }

  // dash panels
  const dashTex = texture(
    THREE,
    canvas(64, 128, (g) => {
      g.fillStyle = '#ff8a1f';
      g.fillRect(0, 0, 64, 128);
      g.fillStyle = '#ffe14d';
      for (let i = 0; i < 2; i++) {
        const y = i * 64;
        g.beginPath();
        g.moveTo(6, y + 10);
        g.lineTo(32, y + 40);
        g.lineTo(58, y + 10);
        g.lineTo(58, y + 26);
        g.lineTo(32, y + 56);
        g.lineTo(6, y + 26);
        g.closePath();
        g.fill();
      }
    }),
    [1, 2],
  );
  const dashMat = new THREE.MeshBasicMaterial({ map: dashTex });
  for (const d of r.dashes) {
    const g = new THREE.Group();
    g.position.set(d.x, 0.09, d.z);
    g.rotation.y = d.h;
    const pad = new THREE.Mesh(geo.plane, dashMat);
    pad.rotation.x = -Math.PI / 2;
    pad.scale.set(2.2, 4.4, 1);
    g.add(pad);
    scene.add(g);
  }

  // jump ramps: a striped wedge rising to the lip
  {
    const wedge = new THREE.BufferGeometry();
    const L = RAMP_LEN;
    const H = RAMP_H;
    // x across (-0.5..0.5, scaled to the ramp width), z along (-L at the foot, 0 at the lip)
    const v = [
      -0.5, 0, -L, 0.5, 0, -L, 0.5, H, 0, -0.5, 0, -L, 0.5, H, 0, -0.5, H, 0,
      -0.5, 0, 0, -0.5, H, 0, 0.5, H, 0, -0.5, 0, 0, 0.5, H, 0, 0.5, 0, 0,
      -0.5, 0, -L, -0.5, H, 0, -0.5, 0, 0, 0.5, 0, -L, 0.5, 0, 0, 0.5, H, 0,
    ];
    const uv = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 0, 0.1, 1, 0.1, 0, 0, 1, 0.1, 1, 0, 0, 0, 1, 0.1, 1, 0, 0, 0, 1, 0, 1, 0.1];
    wedge.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    wedge.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    wedge.computeVertexNormals();
    const rampTex = texture(
      THREE,
      canvas(64, 64, (g) => {
        g.fillStyle = '#8c1515';
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = '#fff3d6';
        for (let i = 0; i < 4; i++) g.fillRect(0, i * 16, 64, 6);
      }),
    );
    const rampMat = new THREE.MeshLambertMaterial({ map: rampTex, side: THREE.DoubleSide });
    for (const ramp of r.ramps) {
      const m = new THREE.Mesh(wedge, rampMat);
      m.position.set(ramp.x, 0.04, ramp.z);
      m.rotation.y = ramp.h;
      m.scale.set(ramp.w, 1, 1);
      scene.add(m);
    }
  }

  // chevron boards on the outside of the tight bends
  const chevron = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#c62828';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#fff';
      g.beginPath();
      g.moveTo(18, 8);
      g.lineTo(46, 32);
      g.lineTo(18, 56);
      g.lineTo(26, 32);
      g.closePath();
      g.fill();
    }),
  );
  const chevronMat = new THREE.MeshLambertMaterial({ map: chevron, side: THREE.DoubleSide });
  for (let s = 0; s < t.length; s += 9) {
    const c = t.curv[Math.floor(s / t.step) % t.n];
    if (Math.abs(c) < 0.03) continue;
    const p = pointAt(t, s, -Math.sign(c) * (EDGE - 0.4));
    const sign = new THREE.Mesh(geo.plane, chevronMat);
    sign.scale.set(1.6, 1.6, 1);
    sign.position.set(p.x, 1.9, p.z);
    // face the karts coming at it; the arrow points the way the road turns
    sign.rotation.y = headingOf(p.tx, p.tz) + Math.PI;
    if (c < 0) sign.scale.x = -1.6;
    scene.add(sign);
  }

  // the course's own scenery
  const rand = scatter(7);
  const clear = (x: number, z: number, margin: number) => Math.abs(locate(t, x, z).d) > EDGE + margin;
  const dummy = new THREE.Object3D();
  SCENERY[r.course]({ THREE, scene, t, r, geo, mats, rand, clear, dummy });


  // item boxes and coins
  const boxTex = texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = 'rgba(255,255,255,0.5)';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#fff';
      g.lineWidth = 12;
      g.strokeRect(6, 6, 116, 116);
      g.font = 'bold 86px Inter, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.lineWidth = 8;
      g.strokeStyle = 'rgba(40,30,60,0.55)';
      g.strokeText('?', 64, 70);
      g.fillStyle = '#fff';
      g.fillText('?', 64, 70);
    }),
  );
  const boxMat = new THREE.MeshBasicMaterial({ map: boxTex, transparent: true, opacity: 0.92 });
  const boxes = r.boxes.map(() => {
    const m = new THREE.Mesh(geo.box, boxMat);
    scene.add(m);
    return m;
  });
  /** Seconds each box has been back, so it pops in instead of appearing. */
  const boxAge = r.boxes.map(() => 1);
  const coins = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.5, 0.5, 0.12, 18), new THREE.MeshLambertMaterial({ color: 0xf7c948, emissive: 0x5a3c00 }), Math.max(1, r.coins.length));
  scene.add(coins);

  // karts
  const karts = r.karts.map((k) => {
    const v = makeKart(THREE, geo, k.color, k.hat, kartShared);
    scene.add(v.root);
    return v;
  });

  // items on the road, pooled by kind
  const thingMats = {
    banana: new THREE.MeshLambertMaterial({ color: 0xffd640 }),
    green: new THREE.MeshLambertMaterial({ color: 0x2fae4e }),
    red: new THREE.MeshLambertMaterial({ color: 0xd8312a }),
    blue: new THREE.MeshLambertMaterial({ color: 0x2f6fe4, emissive: 0x0a1e55 }),
    rim: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    tip: new THREE.MeshLambertMaterial({ color: 0x5b3b1c }),
  };
  const half = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const bananaGeo = new THREE.TorusGeometry(0.42, 0.15, 6, 12, Math.PI * 1.15);
  const buildThing = (kind: ThingKind) => {
    const g = new THREE.Group();
    if (kind === 'banana') {
      const b = new THREE.Mesh(bananaGeo, thingMats.banana);
      b.rotation.set(0, 0, Math.PI * 0.95);
      b.position.y = 0.42;
      g.add(b);
      const tip = new THREE.Mesh(geo.ball, thingMats.tip);
      tip.scale.setScalar(0.08);
      tip.position.set(0.42, 0.42, 0);
      g.add(tip);
    } else {
      const shell = new THREE.Mesh(half, thingMats[kind]);
      shell.scale.set(1, 0.85, 1);
      shell.position.y = 0.12;
      const rim = new THREE.Mesh(geo.wheel, thingMats.rim);
      rim.scale.set(0.52, 0.16, 0.52);
      rim.position.y = 0.1;
      g.add(shell, rim);
      if (kind === 'blue') {
        for (let a = 0; a < 5; a++) {
          const spike = new THREE.Mesh(geo.cone, thingMats.rim);
          spike.scale.set(0.09, 0.3, 0.09);
          spike.position.set(Math.cos((a / 5) * Math.PI * 2) * 0.28, 0.5, Math.sin((a / 5) * Math.PI * 2) * 0.28);
          g.add(spike);
        }
        for (const side of [-1, 1]) {
          const wing = new THREE.Mesh(geo.box, thingMats.rim);
          wing.scale.set(0.9, 0.06, 0.32);
          wing.position.set(side * 0.7, 0.35, 0);
          wing.rotation.z = side * 0.35;
          g.add(wing);
        }
        g.scale.setScalar(1.6);
      }
    }
    return g;
  };
  const makeThing = (kind: ThingKind) => {
    const g = buildThing(kind);
    g.visible = false;
    scene.add(g);
    return g;
  };
  // every kart can hold a banana or a shell out behind it
  const trailKinds = ['banana', 'green', 'red'] as const;
  for (const v of karts) for (const kind of trailKinds) {
    const g = buildThing(kind);
    g.name = kind;
    g.visible = false;
    v.trail.add(g);
  }
  const pools: Record<ThingKind, T.Group[]> = {
    banana: Array.from({ length: 18 }, () => makeThing('banana')),
    green: Array.from({ length: 10 }, () => makeThing('green')),
    red: Array.from({ length: 8 }, () => makeThing('red')),
    blue: Array.from({ length: 2 }, () => makeThing('blue')),
  };
  const used = new Map<number, T.Group>();

  // puffs and blasts
  const puffMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.8, depthWrite: false });
  const blastMat = new THREE.MeshBasicMaterial({ color: 0x7fb2ff, transparent: true, opacity: 0.7, depthWrite: false });
  const fx: { mesh: T.Mesh; age: number; life: number; size: number }[] = [];
  const effect = (x: number, y: number, z: number, size: number, blast: boolean) => {
    const mesh = new THREE.Mesh(geo.ball, (blast ? blastMat : puffMat).clone());
    mesh.position.set(x, y, z);
    scene.add(mesh);
    fx.push({ mesh, age: 0, life: blast ? 0.9 : 0.45, size });
  };

  // small particles: drift smoke, dust, sparks, box shards, coins; meshes are reused and shrink away
  type Particle = { m: T.Mesh; vx: number; vy: number; vz: number; life: number; max: number; size: number; grav: number; grow: boolean };
  const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12);
  const partMat = {
    smoke: new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.55, depthWrite: false }),
    dust: new THREE.MeshBasicMaterial({ color: 0xc9b07a, transparent: true, opacity: 0.6, depthWrite: false }),
    white: new THREE.MeshBasicMaterial({ color: 0xffffff }),
    star: kartShared.star,
    gold: kartShared.gold,
    spark: SPARK.slice(1).map((c) => new THREE.MeshBasicMaterial({ color: c })),
    rainbow: [0xff5a5a, 0xffb347, 0xffe14d, 0x5ad86f, 0x4fb3ff, 0xb57bff].map((c) => new THREE.MeshBasicMaterial({ color: c })),
  };
  const parts: Particle[] = [];
  const spare: T.Mesh[] = [];
  const emit = (geom: T.BufferGeometry, mat: T.Material, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, grav = 0, grow = false) => {
    if (parts.length > 220) return;
    const m = spare.pop() ?? new THREE.Mesh(geom, mat);
    m.geometry = geom;
    m.material = mat;
    m.position.set(x, y, z);
    m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    m.visible = true;
    if (!m.parent) scene.add(m);
    parts.push({ m, vx, vy, vz, life, max: life, size, grav, grow });
  };
  const burst = (geom: T.BufferGeometry, mats: T.Material[], x: number, y: number, z: number, n: number, speed: number, size: number, life = 0.6, grav = 14) => {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.5 + Math.random() * 0.5);
      emit(geom, mats[i % mats.length], x, y, z, Math.cos(a) * sp, speed * (0.4 + Math.random() * 0.6), Math.sin(a) * sp, life * (0.7 + Math.random() * 0.5), size, grav);
    }
  };

  let shake = 0;
  let camYaw: number | null = null;
  let fovBase = 68;
  let back = 6.6;

  const view: View = {
    gl,
    camera,
    resize(w, h) {
      if (w <= 0 || h <= 0) return;
      gl.renderer.setSize(w, h, false);
      camera.aspect = w / h;
      fovBase = camera.aspect < 0.8 ? 84 : camera.aspect < 1.2 ? 74 : 66;
      back = camera.aspect < 0.8 ? 7.6 : 6.6;
      camera.fov = fovBase;
      camera.updateProjectionMatrix();
    },
    frame(race, me, dt, clock, lookBack = false) {
      // item boxes and coins
      race.boxes.forEach((b, i) => {
        const m = boxes[i];
        boxAge[i] = b.t > 0 ? 0 : boxAge[i] + dt;
        m.visible = b.t <= 0;
        m.position.set(b.x, 1.15 + Math.sin(clock * 3 + i) * 0.12, b.z);
        m.rotation.set(0.35, clock * 1.6 + i, 0.2);
        m.scale.setScalar(1.25 * Math.min(1, boxAge[i] / 0.3));
      });
      boxMat.color.setHSL((clock * 0.35) % 1, 0.9, 0.6);
      dashTex.offset.y = (clock * 2) % 1;
      let nc = 0;
      race.coins.forEach((c, i) => {
        if (c.t > 0) return;
        dummy.position.set(c.x, 0.8, c.z);
        dummy.scale.set(1, 1, 1);
        dummy.rotation.set(Math.PI / 2, clock * 3 + i, 0, 'YXZ');
        dummy.updateMatrix();
        coins.setMatrixAt(nc++, dummy.matrix);
      });
      dummy.rotation.order = 'XYZ';
      coins.count = nc;
      coins.instanceMatrix.needsUpdate = true;

      // things
      const live = new Set<number>();
      for (const th of race.things) {
        live.add(th.id);
        let g = used.get(th.id);
        if (!g) {
          g = pools[th.kind].find((x) => !x.visible);
          if (!g) continue;
          g.visible = true;
          used.set(th.id, g);
        }
        g.position.set(th.x, th.y, th.z);
        if (th.kind === 'banana') g.rotation.y = th.id;
        else g.rotation.y = clock * (th.kind === 'blue' ? 4 : 14);
      }
      for (const [id, g] of used) {
        if (live.has(id)) continue;
        g.visible = false;
        used.delete(id);
      }

      // karts, with drift smoke and dust kicked up off the grass
      race.karts.forEach((k, i) => {
        const v = karts[i];
        syncKart(v, k, dt, clock);
        v.smoke -= dt;
        if (v.smoke > 0 || k.y > 0.2 || Math.abs(k.v) < 6) return;
        const dusty = k.offroad && k.boost <= 0;
        if (k.drift === 0 && !dusty) return;
        v.smoke = 0.05;
        const rx = -Math.cos(k.h);
        const rz = Math.sin(k.h);
        const bx = k.x - Math.sin(k.h) * 1.1;
        const bz = k.z - Math.cos(k.h) * 1.1;
        for (const side of [-1, 1]) {
          emit(geo.ball, dusty ? partMat.dust : partMat.smoke, bx + rx * side * 0.75, 0.25, bz + rz * side * 0.75, (Math.random() - 0.5) * 1.5, 1 + Math.random(), (Math.random() - 0.5) * 1.5, 0.5, dusty ? 0.45 : 0.35, 0, true);
        }
      });
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) {
          p.m.visible = false;
          spare.push(p.m);
          parts.splice(i, 1);
          continue;
        }
        p.vy -= p.grav * dt;
        p.m.position.x += p.vx * dt;
        p.m.position.y = Math.max(0.05, p.m.position.y + p.vy * dt);
        p.m.position.z += p.vz * dt;
        p.m.rotation.x += dt * 6;
        const u = p.life / p.max;
        p.m.scale.setScalar(p.size * (p.grow ? 0.6 + (1 - u) * 1.4 : Math.min(1, u * 2.5)));
      }

      // effects
      for (let i = fx.length - 1; i >= 0; i--) {
        const f = fx[i];
        f.age += dt;
        const u = f.age / f.life;
        f.mesh.scale.setScalar(f.size * (0.4 + u));
        (f.mesh.material as T.MeshBasicMaterial).opacity = 0.8 * (1 - u);
        if (u >= 1) {
          scene.remove(f.mesh);
          (f.mesh.material as T.Material).dispose();
          fx.splice(i, 1);
        }
      }

      // chase camera: behind the direction of travel, swinging round from the front during the countdown
      const k = race.karts[me];
      if (!k) return;
      camYaw = camYaw === null ? k.h : dampAngle(camYaw, k.h, k.spin > 0 || k.tumble > 0 ? 2 : 6, dt);
      let swing = 0;
      if (race.time < -0.8) {
        const u = Math.min(1, Math.max(0, (race.time + COUNTDOWN + 0.4) / (COUNTDOWN - 0.4)));
        swing = (1 - u * u * (3 - 2 * u)) * Math.PI * 0.85;
      }
      shake = Math.max(0, shake - dt * 1.5);
      const flip = lookBack && swing === 0 ? Math.PI : 0;
      const yaw = camYaw + swing + flip;
      const dist = back + swing * 2.2;
      const jx = (Math.random() - 0.5) * shake;
      const jy = (Math.random() - 0.5) * shake;
      camera.position.set(k.x - Math.sin(yaw) * dist + jx, 2.75 + swing * 0.8 + k.y * 0.25 + jy, k.z - Math.cos(yaw) * dist);
      camera.lookAt(k.x + Math.sin(camYaw + flip) * 4, 1.15 + k.y * 0.3, k.z + Math.cos(camYaw + flip) * 4);
      const fov = fovBase + (k.boost > 0 ? 9 : 0) + Math.min(5, Math.max(0, k.v - 15) * 0.3);
      if (Math.abs(camera.fov - fov) > 0.05) {
        camera.fov = damp(camera.fov, fov, 4, dt);
        camera.updateProjectionMatrix();
      }
    },
    react(e, race, me) {
      if (e.t === 'gone') effect(e.x, 0.6, e.z, 1.2, false);
      else if (e.t === 'boom') {
        effect(e.x, 1, e.z, 7, true);
        const k = race.karts[me];
        if (k && Math.hypot(k.x - e.x, k.z - e.z) < 30) shake = 1.2;
      } else if (e.t === 'hit') {
        const k = race.karts[e.k];
        if (e.k === me) shake = Math.max(shake, e.how === 'spin' ? 0.35 : 0.8);
        // coins pop out of a kart that gets hit
        if (k) burst(coinGeo, [partMat.gold], k.x, 1.2, k.z, e.how === 'spin' || e.how === 'squash' ? 1 : 3, 5, 1, 0.9, 16);
      } else if (e.t === 'wall') {
        if (e.k === me) shake = Math.max(shake, Math.min(0.5, e.power * 0.04));
        const k = race.karts[e.k];
        if (k) burst(geo.box, [partMat.white, partMat.star], k.x, 0.6, k.z, 5, 4, 0.12, 0.35);
      } else if (e.t === 'bump') {
        if (e.k === me) shake = Math.max(shake, 0.25);
      } else if (e.t === 'slammed') {
        if (e.k === me || e.by === me) shake = Math.max(shake, e.k === me ? 0.6 : 0.3);
        effect(e.x, 0.9, e.z, 1.6, false);
        burst(geo.box, [partMat.white, partMat.star], e.x, 0.9, e.z, 10, 7, 0.16, 0.45);
        const thief = race.karts[e.by];
        if (thief) burst(coinGeo, [partMat.gold], e.x, 1.4, e.z, 1, 3, 1, 0.7, 12);
      } else if (e.t === 'slam') {
        const k = race.karts[e.k];
        if (k) burst(geo.ball, [partMat.dust], k.x, 0.3, k.z, 4, 2, 0.3, 0.4, 0);
      } else if (e.t === 'box') {
        const k = race.karts[e.k];
        if (!k) return;
        let near = race.boxes[0];
        for (const b of race.boxes) if (Math.hypot(b.x - k.x, b.z - k.z) < Math.hypot(near.x - k.x, near.z - k.z)) near = b;
        burst(geo.box, partMat.rainbow, near.x, 1.2, near.z, 12, 6, 0.28, 0.7);
      } else if (e.t === 'coin') {
        const k = race.karts[e.k];
        if (k) burst(geo.box, [partMat.star, partMat.gold], k.x, 1, k.z, 5, 3, 0.1, 0.4, 4);
      } else if (e.t === 'turbo') {
        const k = race.karts[e.k];
        if (k) burst(geo.box, [partMat.spark[Math.max(0, Math.min(2, e.level - 1))]], k.x - Math.sin(k.h) * 1.3, 0.4, k.z - Math.cos(k.h) * 1.3, 8, 4, 0.14, 0.35, 6);
      } else if (e.t === 'trick') {
        const k = race.karts[e.k];
        if (k) burst(geo.box, [partMat.star, partMat.white], k.x, k.y + 1, k.z, 10, 4, 0.16, 0.5, 2);
      } else if (e.t === 'block') {
        effect(e.x, 0.6, e.z, 1.2, false);
        burst(geo.box, [partMat.white], e.x, 0.6, e.z, 6, 4, 0.14, 0.4);
      }
    },
    project(x, y, z, w, h) {
      const v = new THREE.Vector3(x, y, z).project(camera);
      if (v.z > 1) return null;
      return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h };
    },
    render() {
      if (!gl.lost()) gl.renderer.render(scene, camera);
    },
    dispose() {
      for (const f of fx) (f.mesh.material as T.Material).dispose();
      coinGeo.dispose();
      for (const m of [partMat.smoke, partMat.dust, partMat.white, ...partMat.spark, ...partMat.rainbow]) m.dispose();
      // instanced trees, reeds and coins hold their own buffers too
      scene.traverse((o) => {
        if ((o as T.InstancedMesh).isInstancedMesh) (o as T.InstancedMesh).dispose();
      });
      disposeTree(scene);
      for (const g of Object.values(geo)) g.dispose();
      for (const m of Object.values(mats)) m.dispose();
      gl.dispose();
    },
  };
  return view;
}

const scratch = { color: 0 };
function syncKart(v: KartView, k: Kart, dt: number, clock: number) {
  if (k.hat !== v.hatName) v.wear(k.hat);
  scratch.color = parseInt(k.color.slice(1), 16);
  if (scratch.color !== v.color) v.color = scratch.color;
  v.root.position.set(k.x, 0, k.z);
  v.root.rotation.y = k.h;
  v.driftYaw = damp(v.driftYaw, k.drift * 0.38, 10, dt);
  if (k.spin > 0) v.spinA += dt * 15;
  else v.spinA = v.spinA % (Math.PI * 2) > 0.2 ? v.spinA + dt * 15 : 0;
  if (k.tumble > 0) v.flipA = Math.min(Math.PI * 2, v.flipA + dt * 9);
  else v.flipA = 0;
  // a trick off a ramp: a full spin in the air
  if (k.trick && k.y > 0.05) v.trickA = Math.min(Math.PI * 2, v.trickA + dt * 13);
  else if (k.y <= 0.05) v.trickA = 0;
  v.roll = damp(v.roll, -k.steer * 0.07 - k.drift * 0.06, 8, dt);
  const wobble = k.wobble > 0 ? Math.sin(clock * 34) * 0.18 : 0;
  v.body.position.y = k.y;
  v.body.rotation.set(-v.flipA, v.driftYaw + v.spinA + v.trickA, v.roll + wobble);
  const size = k.shrink > 0 ? 0.62 : 1;
  const flat = k.squash > 0 ? 0.35 : 1;
  v.body.scale.set(0.85 * size * (flat < 1 ? 1.25 : 1), 0.85 * size * flat, 0.85 * size * (flat < 1 ? 1.25 : 1));
  v.shadow.scale.set(2.2 * size, 3.2 * size, 1);
  v.wheelA += (k.v * dt) / 0.32;
  for (const s of v.spinners) s.rotation.x = v.wheelA;
  for (const s of v.steer) s.rotation.y = -k.steer * 0.45;
  if (k.star > 0) v.paint.color.setHSL((clock * 2.2) % 1, 0.9, 0.55);
  else v.paint.color.setHex(v.color);
  v.flames.visible = k.boost > 0 || k.star > 0;
  if (v.flames.visible) v.flames.scale.set(1, 1, 0.8 + Math.random() * 0.5);
  const level = k.drift ? turboLevel(k.charge) : 0;
  const glow = level > 0 || (k.drift !== 0 && k.charge > TURBO_AT[1] * 0.4);
  for (const s of v.sparks) {
    s.visible = glow && Math.random() > 0.15;
    s.scale.setScalar(0.12 + Math.random() * 0.16 + level * 0.04);
  }
  v.sparkMat.color.setHex(level > 0 ? SPARK[level] : 0xfff3c0);
  for (const g of v.trail.children) g.visible = k.trail && g.name === k.item;
  const dizzy = k.spin > 0 || k.tumble > 0 || k.squash > 0;
  v.stars.visible = dizzy;
  if (dizzy) v.stars.rotation.y = clock * 7;
  v.wind.visible = k.draft > 0.3 && Math.random() > 0.2;
}
