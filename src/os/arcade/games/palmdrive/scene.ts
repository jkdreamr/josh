// three.js view of a Palm Drive race: the circuit, the hazards on it, karts, items and effects (each course's own
// scenery is in scenery.ts). It reads a Race every frame and never changes it.
import type { T } from './gl';
import { createGL, disposeTree, type GL } from './gl';
import { BALL_FLIGHT, BALL_ROLL, BALL_WARN, BUS_LEN, CURB, awake, ballSince, deltaS, dropAt, edgeAt, edgeRuns, gridSpot, headingOf, inTrench, locate, pointAt, wrapAngle, wrapS, type Past, type Track } from './track';
import { LOOKS, SCENERY, bikeKit, bunkerTexture, canvas, cowMaterials, golfBag, golferKit, greenTexture, makeBike, makeBus, makeCart, makeCow, makeGolfer, makePin, makePlanter, makeStatue, noise, scatter, swingAt, texture, waterTexture } from './scenery';
import { COUNTDOWN, FALL_CARRY, FALL_SINK, HAMMER, RAMP_H, RAMP_LEN, TURBO_AT, hazState, hazardV, hurt, turboLevel, type Ev, type Hat, type HazPhase, type Kart, type LiveHazard, type Race, type ThingKind } from './logic';

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
  /** The bullet the kart rides inside while a Bullet item flies it. */
  bullet: T.Group;
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

/**
 * A strip along the track from s0 to s1 between lateral offsets a(s) and b(s), at height y. Its texture runs one unit
 * every vLen meters along it and once across it, or (world) is laid in world space every vLen meters so neighbouring
 * strips join up.
 */
function strip(THREE: Three, t: Track, s0: number, s1: number, a: (s: number) => number, b: (s: number) => number, y: number, vLen: number, world = false) {
  const count = Math.max(1, Math.round((s1 - s0) / (t.step / 2)));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= count; k++) {
    const s = s0 + ((s1 - s0) * k) / count;
    const p = pointAt(t, s);
    const nx = -p.tz;
    const nz = p.tx;
    // (left to right, so it faces up whichever side of the road it is on)
    const [da, db] = [Math.min(a(s), b(s)), Math.max(a(s), b(s))];
    const [ax, az, bx, bz] = [p.x + nx * da, p.z + nz * da, p.x + nx * db, p.z + nz * db];
    pos.push(ax, y, az, bx, y, bz);
    if (world) uv.push(ax / vLen, az / vLen, bx / vLen, bz / vLen);
    else uv.push(0, (s - s0) / vLen, 1, (s - s0) / vLen);
    if (k < count) idx.push(2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 1, 2 * k + 3, 2 * k + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** How far out (past the brink) water or a pit shows at each sample on each side: up to BEYOND, short of other road. */
const BEYOND = 9;
function beyondOf(t: Track) {
  const reach = (side: number) => {
    const out = new Float32Array(t.n);
    for (let i = 0; i < t.n; i++) {
      if (!dropAt(t, i, side)) continue;
      const lim = side > 0 ? t.hi[i] : -t.lo[i];
      // on the inside of a bend, short of where the strips would fold over each other
      const c = t.curv[i] * side;
      let far = lim + BEYOND;
      if (c > 0.005) far = Math.min(far, 0.92 / c);
      // and never closer to another stretch of road than to this one
      const nx = -t.tz[i] * side;
      const nz = t.tx[i] * side;
      let d = lim + 0.5;
      for (; d < far; d += 0.5) {
        const x = t.x[i] + nx * d;
        const z = t.z[i] + nz * d;
        let near = Infinity;
        for (let j = 0; j < t.n; j++) {
          const gap = Math.abs(i - j);
          if (Math.min(gap, t.n - gap) * t.step < 25) continue;
          near = Math.min(near, (t.x[j] - x) ** 2 + (t.z[j] - z) ** 2);
        }
        if (Math.sqrt(near) < d + 0.3) break;
      }
      out[i] = Math.max(lim + 0.5, Math.min(far, d));
    }
    return out;
  };
  return { lo: reach(-1), hi: reach(1) };
}

/** A vertical strip at lateral offset d, from the ground to height h, from s0 to s1 (all the way round by default). */
function fence(THREE: Three, t: Track, d: number, h: number, vLen: number, s0 = 0, s1 = t.length) {
  const count = Math.max(1, Math.round(((s1 - s0) / t.length) * t.n));
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let k = 0; k <= count; k++) {
    const s = s0 + ((s1 - s0) * k) / count;
    const p = pointAt(t, s, d);
    pos.push(p.x, 0, p.z, p.x, h, p.z);
    const v = s / vLen;
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
  // a big black bullet with white eyes and fins, hidden until a Bullet item
  const bullet = new THREE.Group();
  const shellMat = new THREE.MeshLambertMaterial({ color: 0x1f1f26 });
  const barrel = new THREE.Mesh(geo.wheel, shellMat);
  barrel.rotation.x = Math.PI / 2;
  barrel.scale.set(1.25, 3, 1.25);
  barrel.position.set(0, 1, -0.2);
  const nose = new THREE.Mesh(geo.ball, shellMat);
  nose.scale.set(1.25, 1.25, 1.1);
  nose.position.set(0, 1, 1.3);
  bullet.add(barrel, nose);
  for (const side of [-1, 1]) {
    const eye = new THREE.Mesh(geo.ball, shared.white);
    eye.scale.set(0.28, 0.4, 0.2);
    eye.position.set(side * 0.45, 1.45, 2.05);
    const fin = new THREE.Mesh(geo.box, shellMat);
    fin.scale.set(0.12, 0.9, 0.9);
    fin.position.set(side * 1.3, 1, -1.4);
    bullet.add(eye, fin);
  }
  bullet.visible = false;
  root.add(bullet);
  body.scale.setScalar(0.85);
  const shadow = new THREE.Mesh(geo.plane, shared.shadow);
  shadow.rotation.x = -Math.PI / 2;
  shadow.scale.set(2.2, 3.2, 1);
  shadow.position.y = 0.11;
  root.add(shadow);
  const view: KartView = {
    root, body, paint, color: new THREE.Color(color).getHex(), steer, spinners, flames, sparks, sparkMat, shadow, trail, stars, wind, bullet,
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

  const dummy = new THREE.Object3D();
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
  scene.add(new THREE.Mesh(ribbon(THREE, t, t.half, t.edge + 0.4, 0.02, 8), lawnMat));
  scene.add(new THREE.Mesh(ribbon(THREE, t, -t.edge - 0.4, -t.half, 0.02, 8), lawnMat));

  // the road, curbs, walls and the start
  const asphalt = texture(
    THREE,
    canvas(256, 256, (g) => {
      g.fillStyle = look.road;
      g.fillRect(0, 0, 256, 256);
      if (look.joints) {
        // paving stones in courses across the road, each course set half a stone over from the last
        const rows = 10;
        for (let row = 0; row < rows; row++) {
          const y = (row * 256) / rows;
          for (let col = -1; col < 8; col++) {
            const x = col * 32 + (row % 2) * 16;
            g.fillStyle = `rgba(${row % 3 ? '255,255,255' : '0,0,0'},${0.03 + ((row * 7 + col * 3) % 5) * 0.012})`;
            g.fillRect(x, y, 32, 256 / rows);
            g.fillStyle = look.joints;
            g.fillRect(x, y, 2, 256 / rows);
          }
          g.fillRect(0, y, 256, 2);
        }
      }
      noise(g, 256, 256, 2200, 0.07);
      noise(g, 256, 256, 1200, 0.12, false);
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, 0, 6, 256);
      g.fillRect(250, 0, 6, 256);
    }),
  );
  asphalt.wrapS = asphalt.wrapT = THREE.RepeatWrapping;
  const roadLen = t.length / Math.round(t.length / 12);
  scene.add(new THREE.Mesh(ribbon(THREE, t, -t.half, t.half, 0.04, roadLen), new THREE.MeshLambertMaterial({ map: asphalt })));
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
  // after dark the curbs glow a little, so the edge of the road always reads
  const curbMat = new THREE.MeshLambertMaterial({ map: curbTex, ...(look.night ? { emissive: 0xffffff, emissiveMap: curbTex, emissiveIntensity: 0.35 } : {}) });
  scene.add(new THREE.Mesh(ribbon(THREE, t, t.half, t.half + CURB, 0.07, curbLen), curbMat));
  scene.add(new THREE.Mesh(ribbon(THREE, t, -t.half - CURB, -t.half, 0.07, curbLen), curbMat));
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
  const capMat = look.night ? new THREE.MeshBasicMaterial({ color: look.band }) : new THREE.MeshLambertMaterial({ color: look.band });
  // walls only where the road has them, each run ending in a striped post with a reflector where the road drops away;
  // there the edge has a striped lip with amber studs blinking along it, and past it water or a pit (see below)
  const runs = edgeRuns(t);
  const beyond = beyondOf(t);
  const limit = (side: number) => (s: number) => side * edgeAt(t, s, side).lim;
  const reachAt = (side: number) => (s: number) => {
    const w = wrapS(t, s) / t.step;
    const i = Math.floor(w) % t.n;
    const arr = side > 0 ? beyond.hi : beyond.lo;
    return side * Math.max(arr[i], arr[(i + 1) % t.n] || arr[i]);
  };
  const stripe = (a: string, b: string, n: number) =>
    texture(
      THREE,
      canvas(64, 64, (g) => {
        g.fillStyle = a;
        g.fillRect(0, 0, 64, 64);
        g.fillStyle = b;
        for (let k = -n; k < n * 2; k++) {
          g.beginPath();
          g.moveTo((k * 64) / n, 0);
          g.lineTo((k * 64) / n + 32 / n, 0);
          g.lineTo((k * 64) / n + 32 / n + 64, 64);
          g.lineTo((k * 64) / n + 64, 64);
          g.closePath();
          g.fill();
        }
      }),
    );
  const postTex = texture(
    THREE,
    canvas(16, 64, (g) => {
      for (let k = 0; k < 8; k++) {
        g.fillStyle = k % 2 ? '#f4f4f4' : '#d2261e';
        g.fillRect(0, k * 8, 16, 8);
      }
    }),
  );
  const postMat = look.night ? new THREE.MeshBasicMaterial({ map: postTex }) : new THREE.MeshLambertMaterial({ map: postTex });
  const reflectorMat = new THREE.MeshBasicMaterial({ color: 0xffb300 });
  const posts: { x: number; z: number; ry: number }[] = [];
  const open = runs.filter((run) => run[3] !== 'wall');
  for (const [side, s0, s1, past] of runs) {
    if (past !== 'wall') continue;
    scene.add(new THREE.Mesh(fence(THREE, t, side * t.edge, 1.25, 3, s0, s1), wallMat));
    scene.add(new THREE.Mesh(ribbon(THREE, t, side * t.edge - 0.3, side * t.edge + 0.3, 1.25, 4, s0, s1), capMat));
    if (s1 - s0 >= t.length - 0.01) continue;
    for (const s of [s0, s1]) {
      const p = pointAt(t, s, side * t.edge);
      posts.push({ x: p.x, z: p.z, ry: headingOf(p.tx, p.tz) });
    }
  }
  if (posts.length) {
    const post = new THREE.InstancedMesh(geo.box, postMat, posts.length);
    const cap = new THREE.InstancedMesh(geo.box, reflectorMat, posts.length);
    posts.forEach((p, k) => {
      dummy.position.set(p.x, 0.95, p.z);
      dummy.rotation.set(0, p.ry, 0);
      dummy.scale.set(0.55, 1.9, 0.55);
      dummy.updateMatrix();
      post.setMatrixAt(k, dummy.matrix);
      dummy.position.y = 2.0;
      dummy.scale.set(0.42, 0.22, 0.42);
      dummy.updateMatrix();
      cap.setMatrixAt(k, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    scene.add(post, cap);
  }
  // the lip: yellow and black, lit, from just inside the brink to just past it; on the golf course red stakes instead
  // (a lateral water hazard), and the pond itself shows the water
  const lipMat = new THREE.MeshBasicMaterial({ map: stripe('#ffcf1f', '#141414', 2) });
  (lipMat.map as T.Texture).wrapT = THREE.RepeatWrapping;
  const studs: { x: number; z: number }[] = [];
  const stakes: { x: number; z: number }[] = [];
  const pitTex = texture(
    THREE,
    canvas(64, 8, (g) => {
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, '#6a4426');
      grad.addColorStop(0.12, '#3a2414');
      grad.addColorStop(0.4, '#0d0806');
      grad.addColorStop(1, '#030202');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 8);
    }),
  );
  const pitMat = new THREE.MeshBasicMaterial({ map: pitTex });
  const pondTex = look.edge === 'stakes' ? null : waterTexture(THREE, true);
  const pondMat = pondTex ? new THREE.MeshBasicMaterial({ map: pondTex, color: 0x9fe6f0 }) : null;
  const copingMat = new THREE.MeshLambertMaterial({ color: 0xcdb48a, ...(look.night ? { emissive: 0x2a2214 } : {}) });
  const netting: { x: number; z: number; ry: number; len: number }[] = [];
  for (const [side, s0, s1, past] of open) {
    const lim = limit(side);
    const far = reachAt(side);
    if (look.edge === 'stakes') {
      for (let s = s0 + 2; s < s1; s += 6) {
        const p = pointAt(t, s, side * (edgeAt(t, s, side).lim + 0.35));
        stakes.push({ x: p.x, z: p.z });
      }
      continue;
    }
    scene.add(new THREE.Mesh(strip(THREE, t, s0, s1, (s) => lim(s) - side * 0.6, (s) => lim(s) + side * 0.4, 0.075, 2), lipMat));
    for (let s = s0 + 2.5; s < s1; s += 5) {
      const p = pointAt(t, s, side * (edgeAt(t, s, side).lim + 0.15));
      studs.push({ x: p.x, z: p.z });
    }
    // past the lip: lit water (its ripples laid in world space, so a fountain basin in it joins up), or a dark pit
    // lit near the lip, with orange netting on its far side
    if (past === 'water' && pondMat) {
      scene.add(new THREE.Mesh(strip(THREE, t, s0, s1, (s) => lim(s) + side * 0.4, far, 0.03, 12, true), pondMat));
      // a pool out in the open (not a basin tucked inside a hairpin) has a stone coping along its far bank
      let open = true;
      for (let s = s0; s <= s1 && open; s += t.step) open = Math.abs(far(s) - lim(s)) > BEYOND - 0.5;
      if (open) scene.add(new THREE.Mesh(strip(THREE, t, s0, s1, far, (s) => far(s) + side * 0.7, 0.14, 4), copingMat));
    } else if (past !== 'water') {
      const g = strip(THREE, t, s0, s1, (s) => lim(s) + side * 0.4, far, 0.031, 4);
      scene.add(new THREE.Mesh(g, pitMat));
      for (let s = s0 + 2; s < s1 - 2; s += 4) {
        const a = pointAt(t, s, far(s) - side * 0.3);
        const b = pointAt(t, s + 4, far(s + 4) - side * 0.3);
        netting.push({ x: (a.x + b.x) / 2, z: (a.z + b.z) / 2, ry: Math.atan2(b.x - a.x, b.z - a.z), len: Math.hypot(b.x - a.x, b.z - a.z) });
      }
    }
  }
  const studMat = new THREE.MeshBasicMaterial({ color: 0xffa000 });
  if (studs.length) {
    const m = new THREE.InstancedMesh(geo.box, studMat, studs.length);
    studs.forEach((p, k) => {
      dummy.position.set(p.x, 0.12, p.z);
      dummy.scale.set(0.3, 0.12, 0.3);
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
    });
    scene.add(m);
  }
  if (stakes.length) {
    const m = new THREE.InstancedMesh(geo.box, new THREE.MeshLambertMaterial({ color: 0xd8312a }), stakes.length);
    stakes.forEach((p, k) => {
      dummy.position.set(p.x, 0.45, p.z);
      dummy.scale.set(0.12, 0.9, 0.12);
      dummy.updateMatrix();
      m.setMatrixAt(k, dummy.matrix);
    });
    scene.add(m);
  }
  if (netting.length) {
    // orange posts and netting along the far side of a pit, with a red lamp on every other post
    const netTex = texture(
      THREE,
      canvas(32, 32, (g) => {
        g.strokeStyle = 'rgba(255,120,20,0.9)';
        g.lineWidth = 2;
        for (let k = -32; k < 64; k += 8) {
          g.beginPath();
          g.moveTo(k, 0);
          g.lineTo(k + 32, 32);
          g.moveTo(k + 32, 0);
          g.lineTo(k, 32);
          g.stroke();
        }
      }),
    );
    const net = new THREE.InstancedMesh(geo.plane, new THREE.MeshBasicMaterial({ map: netTex, transparent: true, side: THREE.DoubleSide, depthWrite: false }), netting.length);
    const pole = new THREE.InstancedMesh(geo.box, new THREE.MeshLambertMaterial({ color: 0xff7a1a, emissive: 0x3a1600 }), netting.length);
    const lamps = netting.filter((_, k) => k % 2 === 0);
    const lamp = new THREE.InstancedMesh(geo.ball, new THREE.MeshBasicMaterial({ color: 0xff2a1a }), Math.max(1, lamps.length));
    netting.forEach((n, k) => {
      dummy.position.set(n.x, 0.6, n.z);
      dummy.rotation.set(0, n.ry + Math.PI / 2, 0);
      dummy.scale.set(n.len, 1.1, 1);
      dummy.updateMatrix();
      net.setMatrixAt(k, dummy.matrix);
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(n.x + Math.sin(n.ry) * n.len * 0.5, 0.65, n.z + Math.cos(n.ry) * n.len * 0.5);
      dummy.scale.set(0.1, 1.3, 0.1);
      dummy.updateMatrix();
      pole.setMatrixAt(k, dummy.matrix);
    });
    lamps.forEach((n, k) => {
      dummy.position.set(n.x + Math.sin(n.ry) * n.len * 0.5, 1.4, n.z + Math.cos(n.ry) * n.len * 0.5);
      dummy.scale.setScalar(0.13);
      dummy.updateMatrix();
      lamp.setMatrixAt(k, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
    scene.add(net, pole, lamp);
  }
  // a chevron board on the post where each open run starts, pointing back in toward the road
  const startBoards: { s: number; side: number }[] = look.edge === 'stakes' ? [] : open.map(([side, s0]) => ({ s: s0, side }));
  const checker = texture(
    THREE,
    canvas(128, 32, (g) => {
      for (let i = 0; i < 16; i++) for (let j = 0; j < 4; j++) {
        g.fillStyle = (i + j) % 2 ? '#111' : '#fafafa';
        g.fillRect(i * 8, j * 8, 8, 8);
      }
    }),
  );
  scene.add(new THREE.Mesh(ribbon(THREE, t, -t.half, t.half, 0.09, 2.4, t.length - 1.2, t.length + 1.2), new THREE.MeshBasicMaterial({ map: checker })));
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
      m.position.set(side * (t.edge + 0.6), 3.6, 0);
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
    const face = look.night ? new THREE.MeshBasicMaterial({ map: banner }) : new THREE.MeshLambertMaterial({ map: banner });
    const beam = new THREE.Mesh(geo.box, [post, post, post, post, face, face]);
    beam.scale.set(t.edge * 2 + 1.8, 1.6, 0.5);
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
  // reflective, so they still show up at night
  const chevronMat = look.night ? new THREE.MeshBasicMaterial({ map: chevron, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ map: chevron, side: THREE.DoubleSide });
  for (let s = 0; s < t.length; s += 9) {
    const i = Math.floor(s / t.step) % t.n;
    const c = t.curv[i];
    if (Math.abs(c) < 0.03) continue;
    // (where the outside of the bend drops away, across the water or the pit on its far bank)
    const out = -Math.sign(c);
    const open = dropAt(t, i, out);
    if (open && look.edge === 'stakes') continue;
    const p = pointAt(t, s, open ? out * ((out > 0 ? beyond.hi : beyond.lo)[i] + 0.6) : out * (t.edge - 0.4));
    const sign = new THREE.Mesh(geo.plane, chevronMat);
    sign.scale.set(1.6, 1.6, 1);
    sign.position.set(p.x, 1.9, p.z);
    // face the karts coming at it; the arrow points the way the road turns
    sign.rotation.y = headingOf(p.tx, p.tz) + Math.PI;
    if (c < 0) sign.scale.x = -1.6;
    scene.add(sign);
  }
  for (const { s, side } of startBoards) {
    const p = pointAt(t, s, side * t.edge);
    const sign = new THREE.Mesh(geo.plane, chevronMat);
    sign.scale.set(1.5, 1.5, 1);
    sign.position.set(p.x, 2.7, p.z);
    sign.rotation.y = headingOf(p.tx, p.tz) + Math.PI;
    // the arrow points back in, away from the drop
    if (side > 0) sign.scale.x = -1.5;
    scene.add(sign);
  }

  // the course's own scenery
  const rand = scatter(7);
  const clear = (x: number, z: number, margin: number) => {
    const at = locate(t, x, z);
    const side = at.d >= 0 ? 1 : -1;
    const i = Math.round(at.s / t.step) % t.n;
    const out = dropAt(t, i, side) ? Math.max(t.edge, (side > 0 ? beyond.hi : beyond.lo)[i]) : t.edge;
    return Math.abs(at.d) > out + margin;
  };
  const sceneryTick = SCENERY[r.course]({ THREE, scene, t, r, geo, mats, rand, clear, dummy }) || null;

  // what the course leaves on the road: mud and oil lie flat, bales, boulders and planters stand in the way, cows
  // and cyclists cross it and buses drive their rounds
  const puddle = (inner: string, rim: string, sheen: boolean) =>
    texture(
      THREE,
      canvas(128, 128, (g) => {
        // a lumpy blob of overlapping circles, darker where it is deepest
        const blobs = scatter(inner.length * 31);
        for (let i = 0; i < 9; i++) {
          const a = (i / 9) * Math.PI * 2;
          const x = 64 + Math.cos(a) * 26 * blobs();
          const y = 64 + Math.sin(a) * 26 * blobs();
          const rad = 30 + blobs() * 12;
          const grad = g.createRadialGradient(x, y, rad * 0.3, x, y, rad);
          grad.addColorStop(0, inner);
          grad.addColorStop(0.8, rim);
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(x, y, rad, 0, Math.PI * 2);
          g.fill();
        }
        if (sheen) {
          // a rainbow film on the oil
          for (const [i, c] of ['#ff5a8a', '#ffd84d', '#5ad8a6', '#5a8aff'].entries()) {
            g.strokeStyle = c;
            g.globalAlpha = 0.35;
            g.lineWidth = 3;
            g.beginPath();
            g.ellipse(58, 60, 30 - i * 5, 18 - i * 3, 0.5, 0, Math.PI * 2);
            g.stroke();
          }
          g.globalAlpha = 1;
        } else {
          // wet glints on the mud
          g.fillStyle = 'rgba(255,245,225,0.35)';
          for (let i = 0; i < 8; i++) {
            g.beginPath();
            g.ellipse(36 + blobs() * 56, 36 + blobs() * 56, 4 + blobs() * 7, 1.5 + blobs() * 2.5, blobs() * 3, 0, Math.PI * 2);
            g.fill();
          }
        }
      }),
    );
  const mudMat = new THREE.MeshLambertMaterial({ map: puddle('rgba(46,28,14,1)', 'rgba(70,44,22,0.95)', false), transparent: true, depthWrite: false });
  const oilTex = puddle('rgba(12,12,18,0.97)', 'rgba(30,30,40,0.85)', true);
  // after dark its rainbow sheen shines, so a slick still stands out on the road
  const oilMat = new THREE.MeshLambertMaterial({ map: oilTex, transparent: true, depthWrite: false, ...(look.night ? { emissive: 0xffffff, emissiveMap: oilTex, emissiveIntensity: 0.9 } : {}) });
  const strawTex = texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#e2bd57';
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 70; i++) {
        g.strokeStyle = i % 3 ? 'rgba(150,110,30,0.45)' : 'rgba(255,240,170,0.6)';
        g.lineWidth = 1;
        g.beginPath();
        const y = Math.random() * 64;
        g.moveTo(0, y);
        g.lineTo(64, y + (Math.random() - 0.5) * 6);
        g.stroke();
      }
    }),
  );
  const strawMat = new THREE.MeshLambertMaterial({ map: strawTex });
  const baleGeo = new THREE.CylinderGeometry(1, 1, 1, 16);
  const cowMats = cowMaterials(THREE);
  const rockGeo = new THREE.SphereGeometry(1, 7, 5);
  const rockMat = new THREE.MeshLambertMaterial({ color: 0x8d8780, flatShading: true });
  type CowView = { g: T.Group; legs: T.Mesh[]; head: T.Group; h: number };
  const cows: { view: CowView; i: number }[] = [];
  let kit: ReturnType<typeof bikeKit> | null = null;
  type BikeView = { g: T.Group; wheels: T.Group[]; pedal: (a: number) => void; h: number; crank: number };
  const bikes: { view: BikeView; i: number }[] = [];
  const buses: { g: T.Group; wheels: T.Mesh[]; i: number }[] = [];
  // out on the golf course: carts, golfers, flagsticks and golf balls (with the golfers who hit them, at their tees)
  let golfKit: ReturnType<typeof golferKit> | null = null;
  const carts: { g: T.Group; wheels: T.Mesh[]; i: number; h: number; roll: number }[] = [];
  const golfers: { g: T.Group; legs: T.Group[]; arms: T.Group[]; i: number; h: number }[] = [];
  const pins: T.Group[] = [];
  type BallView = { i: number; ball: T.Mesh; streak: T.Mesh; shadow: T.Mesh; shade: T.MeshBasicMaterial; mark: T.Sprite; swing: (a: number) => void; tee: T.Vector3; land: T.Vector3; ux: number; uz: number; high: number; roll: number };
  const balls: BallView[] = [];
  let sandMat: T.Material | null = null;
  let greenMat: T.Material | null = null;
  const ballGeo = new THREE.SphereGeometry(0.45, 12, 8);
  const streakGeo = new THREE.CylinderGeometry(0.2, 0.02, 1, 8, 1, true);
  const ballShade = texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(0,0,0,0.95)');
      grad.addColorStop(0.6, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
  // the warning over where a ball is about to land
  const warnMat = new THREE.SpriteMaterial({
    map: texture(
      THREE,
      canvas(64, 64, (g) => {
        g.fillStyle = '#ffd23a';
        g.strokeStyle = '#c62828';
        g.lineWidth = 6;
        g.beginPath();
        g.arc(32, 32, 27, 0, Math.PI * 2);
        g.fill();
        g.stroke();
        g.fillStyle = '#c62828';
        g.font = 'bold 42px Inter, Arial, sans-serif';
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.fillText('!', 32, 35);
      }),
    ),
    depthWrite: false,
  });
  const ballMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const streakMat = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7, depthWrite: false });
  /**
   * A trench right across the road: the hole black and deep, striped along its edges, and steel plates over the rest of
   * the road either side of it.
   */
  const trench = (h: (typeof r.hazards)[number]) => {
    const len = h.len ?? 0;
    const w = h.w ?? h.r;
    const s0 = h.s;
    const s1 = h.s + len;
    const plate = edgeAt(t, s0 + len / 2, 1).lim;
    const hole = texture(
      THREE,
      canvas(8, 64, (g) => {
        const grad = g.createLinearGradient(0, 0, 0, 64);
        grad.addColorStop(0, '#3a2a1c');
        grad.addColorStop(0.15, '#0b0806');
        grad.addColorStop(0.85, '#0b0806');
        grad.addColorStop(1, '#3a2a1c');
        g.fillStyle = grad;
        g.fillRect(0, 0, 8, 64);
      }),
    );
    scene.add(new THREE.Mesh(strip(THREE, t, s0, s1, () => h.d - w, () => h.d + w, 0.072, len), new THREE.MeshBasicMaterial({ map: hole })));
    const steel = texture(
      THREE,
      canvas(32, 32, (g) => {
        g.fillStyle = '#7d8189';
        g.fillRect(0, 0, 32, 32);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        for (let y = 0; y < 32; y += 8) for (let x = (y / 8) % 2 ? 4 : 0; x < 32; x += 8) g.fillRect(x, y, 4, 1.5);
        noise(g, 32, 32, 60, 0.08);
      }),
      [4, 3],
    );
    const plateMat = new THREE.MeshLambertMaterial({ map: steel, ...(look.night ? { emissive: 0x23252a } : {}) });
    for (const side of [-1, 1]) scene.add(new THREE.Mesh(strip(THREE, t, s0 - 0.6, s1 + 0.6, () => h.d + side * w, () => side * plate, 0.074, 4), plateMat));
    // hazard stripes along the near and far edges of the hole
    const edges = new THREE.MeshBasicMaterial({ map: stripe('#ffcf1f', '#141414', 4) });
    for (const at of [s0 - 0.4, s1]) scene.add(new THREE.Mesh(strip(THREE, t, at, at + 0.4, () => h.d - w, () => h.d + w, 0.076, 0.4), edges));
  };
  // the set pieces (see HazardKind and hazState in logic.ts): pile-driver rigs straddling the road, bollard banks under
  // a signal gantry, wrecking balls on tower cranes, sprinklers on their planters and the wet road. They are drawn from
  // hazState for the lap this screen's kart is on, the state it collides with; before their lap they stand by asleep
  // (the hammer parked high and dark, the bollards flush with green lamps, the sprinkler capped), so the first lap
  // shows where they are.
  const rigMat = new THREE.MeshLambertMaterial({ color: 0xf2b705, emissive: 0x3a2a00 });
  const steelMat = new THREE.MeshLambertMaterial({ color: 0x3a3d46, emissive: 0x0b0c10 });
  const ironMat = new THREE.MeshLambertMaterial({ color: 0x2a2c31, emissive: 0x08090c });
  const chevronTex = stripe('#ffcf1f', '#141414', 3);
  const headMat = new THREE.MeshLambertMaterial({ map: chevronTex, ...(look.night ? { emissive: 0xffffff, emissiveMap: chevronTex, emissiveIntensity: 0.3 } : {}) });
  const lampRed = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const footMat = new THREE.MeshBasicMaterial({ color: 0xd8312a, transparent: true, opacity: 0.8, depthWrite: false });
  const shadowTex = (kartShared.shadow as T.MeshBasicMaterial).map!;
  const signOf = (text: string, bg: string, fg: string) =>
    new THREE.MeshBasicMaterial({
      map: texture(
        THREE,
        canvas(256, 64, (g) => {
          g.fillStyle = bg;
          g.fillRect(0, 0, 256, 64);
          g.fillStyle = fg;
          g.font = 'bold 30px Inter, Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.fillText(text, 128, 34);
        }),
      ),
      side: THREE.DoubleSide,
    });
  const rigSign = signOf('PILE DRIVER', '#f2b705', '#141414');
  const lockSign = signOf('LOCKDOWN', '#8c1515', '#ffffff');
  const part = (parent: T.Object3D, mat: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number, geom: T.BufferGeometry = geo.box) => {
    const m = new THREE.Mesh(geom, mat);
    m.position.set(x, y, z);
    m.scale.set(sx, sy, sz);
    parent.add(m);
    return m;
  };
  // (a group at a point of the road, turned to face along it: local z runs along the road and local -x is to the right,
  // so something d to the right sits at local x = -d)
  const groupAt = (s: number, d = 0) => {
    const c = pointAt(t, s, d);
    const g = new THREE.Group();
    g.position.set(c.x, 0, c.z);
    g.rotation.y = headingOf(c.tx, c.tz);
    scene.add(g);
    return g;
  };
  type HammerView = { i: number; head: T.Mesh; ram: T.Mesh; shade: T.Mesh; shadeMat: T.MeshBasicMaterial; beacon: T.Mesh; lift: number; phase: HazPhase };
  const hammers: HammerView[] = [];
  const buildHammer = (h: LiveHazard, i: number) => {
    const g = groupAt(h.s);
    // the A-frame: legs just outside the wall (or just past the lip where the road drops away), a beam across the top
    const legs = [-1, 1].map((side) => side * (edgeAt(t, h.s, side).lim + 0.6));
    for (const d of legs) {
      part(g, rigMat, -d, 4.2, 0, 0.55, 8.4, 0.55);
      part(g, rigMat, -d, 0.15, 0, 1.4, 0.3, 1.4);
    }
    part(g, rigMat, -(legs[0] + legs[1]) / 2, 8.4, 0, legs[1] - legs[0] + 0.6, 0.6, 0.6);
    const sign = part(g, rigSign, -(legs[0] + legs[1]) / 2, 9.2, 0, 4.2, 1.05, 1, geo.plane);
    sign.rotation.y = Math.PI;
    const ram = part(g, steelMat, -h.d, 5, 0, 0.6, 1, 0.6);
    const head = new THREE.Mesh(geo.box, [headMat, headMat, rigMat, ironMat, headMat, headMat]);
    head.scale.set(h.r * 1.9, 1.4, h.r * 1.9);
    head.position.set(-h.d, 0.7, 0);
    g.add(head);
    const shadeMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false, opacity: 0.4 });
    const shade = part(g, shadeMat, -h.d, 0.085, 0, h.r * 2.6, h.r * 2.6, 1, geo.plane);
    shade.rotation.x = -Math.PI / 2;
    shade.renderOrder = 2;
    // the footprint painted on the road, always: exactly what the head covers
    const foot = new THREE.Mesh(new THREE.RingGeometry(h.r - 0.28, h.r, 28), footMat);
    foot.rotation.x = -Math.PI / 2;
    foot.position.set(-h.d, 0.082, 0);
    foot.renderOrder = 2;
    g.add(foot);
    const beacon = part(g, lampRed, -h.d, 8.95, 0, 0.5, 0.5, 0.5);
    hammers.push({ i, head, ram, shade, shadeMat, beacon, lift: 1, phase: 'off' });
  };
  // bollard banks: three posts each, instanced, under a gantry with a lamp per bank; one gantry and one stripe per row
  const bankPosts: { x: number; z: number; ry: number }[] = [];
  const lamps: { x: number; z: number; ry: number }[] = [];
  const banks: { i: number; post: number; lamp: number }[] = [];
  const rowsBuilt = new Set<number>();
  const buildBank = (h: LiveHazard, i: number) => {
    const w = h.w ?? 0;
    const post = bankPosts.length;
    for (const k of [-1, 0, 1]) {
      const p = pointAt(t, h.s, h.d + (k * w) / 3);
      bankPosts.push({ x: p.x, z: p.z, ry: headingOf(p.tx, p.tz) });
    }
    const lp = pointAt(t, h.s, h.d);
    lamps.push({ x: lp.x, z: lp.z, ry: headingOf(lp.tx, lp.tz) });
    banks.push({ i, post, lamp: lamps.length - 1 });
    const row = Math.round(h.s);
    if (rowsBuilt.has(row)) return;
    rowsBuilt.add(row);
    const g = groupAt(h.s);
    for (const side of [-1, 1]) part(g, rigMat, -side * (t.edge + 0.6), 2.6, 0, 0.45, 5.2, 0.45);
    part(g, rigMat, 0, 5.2, 0, t.edge * 2 + 1.8, 0.5, 0.5);
    const sign = part(g, lockSign, 0, 6.05, 0, 4.4, 1.1, 1, geo.plane);
    sign.rotation.y = Math.PI;
    // the line across the road where they come up
    scene.add(new THREE.Mesh(strip(THREE, t, h.s - 0.55, h.s + 0.55, () => -t.edge, () => t.edge, 0.078, 1.1), new THREE.MeshBasicMaterial({ map: stripe('#ffcf1f', '#141414', 6) })));
  };
  type WreckerView = { i: number; g: T.Group; cable: T.Mesh; ball: T.Group; light: T.Mesh; lift: number };
  const wreckers: WreckerView[] = [];
  const buildWrecker = (h: LiveHazard, i: number) => {
    const g = groupAt(h.s);
    // a tower crane on the left verge, its jib out over the road past the pivot the ball hangs from
    const mastD = -(t.edge + 2.6);
    const tip = h.d + 4.5;
    part(g, rigMat, -mastD, 6.5, 0, 1.2, 13, 1.2);
    part(g, rigMat, -(mastD + tip) / 2, 10.5, 0, tip - mastD + 0.6, 0.7, 0.7);
    part(g, rigMat, -(mastD - 2.4), 10.5, 0, 3.6, 0.7, 0.7);
    part(g, steelMat, -(mastD - 3.4), 9.7, 0, 1.6, 1.3, 1.6);
    part(g, rigMat, -mastD, 11.6, 0, 1.6, 1.6, 1.6);
    part(g, steelMat, -h.d, 9.9, 0, 0.9, 0.6, 0.9);
    const cable = part(g, kartShared.dark, -h.d, 5, 0, 0.09, 1, 0.09);
    const ball = new THREE.Group();
    const iron = new THREE.Mesh(geo.ball, ironMat);
    iron.scale.setScalar(h.r);
    const band = new THREE.Mesh(new THREE.TorusGeometry(h.r * 0.99, 0.08, 6, 28), new THREE.MeshBasicMaterial({ color: 0xfff3c8 }));
    band.rotation.x = Math.PI / 2;
    ball.add(iron, band);
    g.add(ball);
    const light = part(g, lampRed, -tip, 11.1, 0, 0.4, 0.4, 0.4, geo.ball);
    wreckers.push({ i, g, cable, ball, light, lift: 0 });
  };
  const jetMat = new THREE.MeshBasicMaterial({ color: 0xbfe8ff, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
  const jetGeo = new THREE.CylinderGeometry(0.5, 0.1, 1, 8, 1, true);
  jetGeo.rotateX(Math.PI / 2);
  jetGeo.translate(0, 0, 0.5);
  const sprayMat = new THREE.SpriteMaterial({ map: texture(THREE, canvas(64, 64, (g) => { const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31); grad.addColorStop(0, 'rgba(220,245,255,0.7)'); grad.addColorStop(1, 'rgba(200,240,255,0)'); g.fillStyle = grad; g.fillRect(0, 0, 64, 64); })), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  const sheenMat = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, transparent: true, opacity: 0.1, depthWrite: false });
  type RotorView = { i: number; arm: T.Group; jet: T.Mesh; spray: T.Sprite; sheen: T.Mesh; cap: T.Mesh; on: number };
  const rotors: RotorView[] = [];
  const buildRotor = (h: LiveHazard, i: number) => {
    const g = groupAt(h.s, h.d);
    const arm = h.arm ?? 5;
    part(g, mats.stone, 0, 0.17, 0, h.r * 1.9, 0.34, h.r * 1.9, geo.wheel);
    part(g, steelMat, 0, 0.7, 0, h.r, 0.75, h.r, geo.wheel);
    const cap = part(g, ironMat, 0, 1.12, 0, h.r * 0.7, 0.14, h.r * 0.7, geo.wheel);
    const armG = new THREE.Group();
    armG.position.y = 1.02;
    const jet = new THREE.Mesh(jetGeo, jetMat);
    jet.scale.set(1, 1, arm);
    const spray = new THREE.Sprite(sprayMat);
    spray.scale.set(3, 2.2, 1);
    spray.position.set(0, 0.2, arm);
    armG.add(jet, spray);
    g.add(armG);
    const sheen = new THREE.Mesh(new THREE.RingGeometry(h.r + 0.6, arm + 0.7, 36), sheenMat);
    sheen.rotation.x = -Math.PI / 2;
    sheen.position.y = 0.06;
    sheen.renderOrder = 1;
    g.add(sheen);
    rotors.push({ i, arm: armG, jet, spray, sheen, cap, on: 0 });
  };
  const wetTex = texture(
    THREE,
    canvas(128, 128, (g) => {
      // a glossy dark sheet with the lamps streaked across it
      const blobs = scatter(41);
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2;
        const x = 64 + Math.cos(a) * 24 * blobs();
        const y = 64 + Math.sin(a) * 24 * blobs();
        const rad = 34 + blobs() * 14;
        const grad = g.createRadialGradient(x, y, rad * 0.2, x, y, rad);
        grad.addColorStop(0, 'rgba(14,18,30,0.75)');
        grad.addColorStop(0.8, 'rgba(20,24,38,0.55)');
        grad.addColorStop(1, 'rgba(0,0,0,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, rad, 0, Math.PI * 2);
        g.fill();
      }
      for (let n = 0; n < 9; n++) {
        g.fillStyle = `rgba(255,232,180,${0.12 + blobs() * 0.16})`;
        g.beginPath();
        g.ellipse(30 + blobs() * 68, 30 + blobs() * 68, 2 + blobs() * 3, 9 + blobs() * 14, 0.1, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  const wetMat = new THREE.MeshBasicMaterial({ map: wetTex, transparent: true, depthWrite: false });
  const mistMat = new THREE.SpriteMaterial({ map: sprayMat.map, transparent: true, opacity: 0.28, depthWrite: false });
  type WetView = { i: number; decal: T.Mesh; mist: T.Sprite };
  const wets: WetView[] = [];
  const buildWet = (h: LiveHazard, i: number) => {
    const decal = new THREE.Mesh(geo.plane, wetMat);
    decal.rotation.set(-Math.PI / 2, 0, rand() * Math.PI * 2);
    decal.scale.set(h.r * 2.2, h.r * 2.2, 1);
    decal.position.set(h.x, 0.058 + i * 0.0004, h.z);
    decal.renderOrder = 1;
    const mist = new THREE.Sprite(mistMat);
    mist.scale.set(h.r * 2.2, 2.6, 1);
    mist.position.set(h.x, 0.9, h.z);
    scene.add(decal, mist);
    wets.push({ i, decal, mist });
  };
  r.hazards.forEach((h, i) => {
    if (h.kind === 'hammer') return buildHammer(h, i);
    if (h.kind === 'bollard') return buildBank(h, i);
    if (h.kind === 'wrecker') return buildWrecker(h, i);
    if (h.kind === 'rotor') return buildRotor(h, i);
    if (h.kind === 'wet') return buildWet(h, i);
    if (h.kind === 'sand') {
      // a bunker: raked sand with a soft edge
      sandMat ??= new THREE.MeshLambertMaterial({ map: bunkerTexture(THREE, 9), transparent: true, depthWrite: false });
      const m = new THREE.Mesh(geo.plane, sandMat);
      m.rotation.set(-Math.PI / 2, 0, rand() * Math.PI * 2);
      m.scale.set(h.r * 2.3, h.r * 2.3, 1);
      m.position.set(h.x, 0.056 + i * 0.0004, h.z);
      m.renderOrder = 2;
      scene.add(m);
      return;
    }
    if (h.kind === 'water') return;
    if (h.kind === 'statue') {
      // a bronze on its plinth, spotlit from above
      const g = makeStatue(THREE, geo, h.r);
      g.position.set(h.x, 0, h.z);
      g.rotation.y = headingOf(h.tx, h.tz) + Math.PI;
      scene.add(g);
      return;
    }
    if (h.kind === 'trench') {
      trench(h);
      return;
    }
    if (h.kind === 'pin') {
      // the road runs across a green here: the green itself, the cup and the flagstick in it
      greenMat ??= new THREE.MeshLambertMaterial({ map: greenTexture(THREE), transparent: true, depthWrite: false });
      const g = new THREE.Mesh(geo.plane, greenMat);
      g.rotation.set(-Math.PI / 2, 0, rand() * Math.PI * 2);
      g.scale.set(24, 22, 1);
      g.position.set(h.x, 0.05, h.z);
      g.renderOrder = 1;
      scene.add(g);
      const cup = new THREE.Mesh(new THREE.RingGeometry(0.18, 0.42, 20), new THREE.MeshBasicMaterial({ color: 0xffffff }));
      cup.rotation.x = -Math.PI / 2;
      cup.position.set(h.x, 0.062, h.z);
      scene.add(cup);
      const hole = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), new THREE.MeshBasicMaterial({ color: 0x1a1a1a }));
      hole.rotation.x = -Math.PI / 2;
      hole.position.set(h.x, 0.063, h.z);
      scene.add(hole);
      const pin = makePin(THREE, geo, h.s > r.track.length * 0.8 ? 18 : 9);
      pin.g.position.set(h.x, 0, h.z);
      scene.add(pin.g);
      pins.push(pin.flag);
      return;
    }
    if (h.kind === 'golfer') {
      golfKit ??= golferKit(THREE);
      const v = makeGolfer(THREE, geo, golfKit, rand, 'walk');
      v.g.scale.setScalar(1.15);
      v.g.position.set(h.x, 0, h.z);
      scene.add(v.g);
      const at = pointAt(t, h.along, h.at);
      golfers.push({ g: v.g, legs: v.legs, arms: v.arms, i, h: headingOf(-at.tz * h.walk, at.tx * h.walk) });
      return;
    }
    if (h.kind === 'cart') {
      golfKit ??= golferKit(THREE);
      const v = makeCart(THREE, geo, golfKit, rand);
      v.g.position.set(h.x, 0, h.z);
      scene.add(v.g);
      const at = pointAt(t, h.along, h.at);
      carts.push({ ...v, i, h: h.drive ? headingOf(h.tx, h.tz) : headingOf(-at.tz * h.walk, at.tx * h.walk), roll: 0 });
      return;
    }
    if (h.kind === 'ball') {
      golfKit ??= golferKit(THREE);
      const tp = pointAt(t, h.s + (h.tee?.[0] ?? -20), h.tee?.[1] ?? 30);
      const tee = new THREE.Vector3(tp.x, 0.3, tp.z);
      const land = new THREE.Vector3(h.x, 0.45, h.z);
      const dist = Math.hypot(land.x - tee.x, land.z - tee.z);
      const ux = (land.x - tee.x) / dist;
      const uz = (land.z - tee.z) / dist;
      // the tee: a box of mown grass, its markers, the golfer side-on to the shot and the bag stood beside
      const box = new THREE.Mesh(geo.plane, new THREE.MeshLambertMaterial({ color: 0x7cc255 }));
      box.rotation.set(-Math.PI / 2, 0, -Math.atan2(uz, ux));
      box.scale.set(5, 4, 1);
      box.position.set(tee.x, 0.035, tee.z);
      scene.add(box);
      for (const side of [-1, 1]) {
        const marker = new THREE.Mesh(geo.ball, kartShared.red);
        marker.scale.setScalar(0.16);
        marker.position.set(tee.x - uz * side * 2 + ux * 1.2, 0.15, tee.z + ux * side * 2 + uz * 1.2);
        scene.add(marker);
      }
      const golfer = makeGolfer(THREE, geo, golfKit, rand, 'swing');
      const ry = Math.atan2(-uz, ux);
      golfer.g.rotation.y = ry;
      golfer.g.position.set(tee.x - Math.sin(ry) * 0.85, 0, tee.z - Math.cos(ry) * 0.85);
      golfer.g.scale.setScalar(1.1);
      scene.add(golfer.g);
      const bag = golfBag(THREE, geo, golfKit, golfKit.bags[i % golfKit.bags.length]);
      bag.position.set(tee.x - Math.sin(ry) * 2 - ux * 1.2, 0, tee.z - Math.cos(ry) * 2 - uz * 1.2);
      bag.rotation.z = 0.15;
      scene.add(bag);
      const ball = new THREE.Mesh(ballGeo, ballMat);
      ball.visible = false;
      const streak = new THREE.Mesh(streakGeo, streakMat);
      streak.visible = false;
      const shade = new THREE.MeshBasicMaterial({ map: ballShade, transparent: true, depthWrite: false, opacity: 0 });
      const shadow = new THREE.Mesh(geo.plane, shade);
      shadow.rotation.x = -Math.PI / 2;
      shadow.position.set(h.x, 0.1, h.z);
      shadow.renderOrder = 3;
      shadow.visible = false;
      const mark = new THREE.Sprite(warnMat);
      mark.scale.set(1.3, 1.3, 1);
      mark.position.set(h.x, 2.6, h.z);
      mark.visible = false;
      scene.add(ball, streak, shadow, mark);
      // it bounces on the way it was going and rolls to a stop at the foot of the wall at the latest
      let reach = 0;
      while (reach < 16 && Math.abs(locate(t, land.x + ux * (reach + 0.5), land.z + uz * (reach + 0.5)).d) < t.edge - 0.7) reach += 0.5;
      balls.push({ i, ball, streak, shadow, shade, mark, swing: golfer.swing, tee, land, ux, uz, high: 13 + dist * 0.15, roll: Math.min(1, reach / 15.5) });
      return;
    }
    if (h.kind === 'mud' || h.kind === 'oil') {
      const m = new THREE.Mesh(geo.plane, h.kind === 'mud' ? mudMat : oilMat);
      m.rotation.set(-Math.PI / 2, 0, rand() * Math.PI * 2);
      m.scale.set(h.r * 2.3, h.r * 2.3, 1);
      m.position.set(h.x, 0.055 + i * 0.0004, h.z);
      m.renderOrder = 1;
      scene.add(m);
    } else if (h.kind === 'hay') {
      // a round bale on its side, rolled along the road
      const bale = new THREE.Mesh(baleGeo, strawMat);
      const at = pointAt(t, h.s, h.d);
      bale.rotation.set(0, headingOf(at.tx, at.tz), Math.PI / 2, 'YXZ');
      bale.scale.set(h.r, 1.5, h.r);
      bale.position.set(h.x, h.r, h.z);
      scene.add(bale);
    } else if (h.kind === 'rock') {
      // a boulder down off the hillside
      const rock = new THREE.Mesh(rockGeo, rockMat);
      rock.scale.set(h.r * 1.1, h.r * 0.9, h.r * 1.05);
      rock.rotation.set(rand() * 0.6, rand() * Math.PI * 2, rand() * 0.4);
      rock.position.set(h.x, h.r * 0.55, h.z);
      scene.add(rock);
    } else if (h.kind === 'planter') {
      const planter = makePlanter(THREE, geo, h.r, rand);
      planter.position.set(h.x, 0, h.z);
      planter.rotation.y = rand() * Math.PI * 2;
      scene.add(planter);
    } else if (h.kind === 'bike') {
      // a cyclist on the way to class, a little bigger than life so it reads at speed
      kit ??= bikeKit(THREE);
      const { g, wheels, pedal } = makeBike(THREE, geo, kit, rand);
      const at = pointAt(t, h.along, h.at);
      const face = headingOf(-at.tz * h.walk, at.tx * h.walk);
      g.scale.setScalar(1.15);
      g.position.set(h.x, 0, h.z);
      g.rotation.set(0, face, 0, 'YXZ');
      scene.add(g);
      bikes.push({ view: { g, wheels, pedal, h: face, crank: 0 }, i });
    } else if (h.kind === 'bus') {
      const bus = makeBus(THREE, geo, BUS_LEN, h.r);
      bus.g.position.set(h.x, 0, h.z);
      bus.g.rotation.y = headingOf(h.tx, h.tz);
      scene.add(bus.g);
      buses.push({ ...bus, i });
    } else {
      const { g, legs, head } = makeCow(THREE, geo, cowMats);
      g.position.set(h.x, 0, h.z);
      scene.add(g);
      const at = pointAt(t, h.along, h.at);
      cows.push({ view: { g, legs, head, h: headingOf(-at.tz * h.walk, at.tx * h.walk) }, i });
    }
  });

  // the bollards' posts, their lit caps and the gantry lamps, one instanced mesh each, coloured per bank
  const whiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const postMesh = bankPosts.length ? new THREE.InstancedMesh(geo.wheel, steelMat, bankPosts.length) : null;
  const capMesh = bankPosts.length ? new THREE.InstancedMesh(geo.wheel, whiteMat, bankPosts.length) : null;
  const lampMesh = lamps.length ? new THREE.InstancedMesh(geo.box, whiteMat, lamps.length) : null;
  if (postMesh && capMesh && lampMesh) {
    scene.add(postMesh, capMesh, lampMesh);
    lamps.forEach((l, k) => {
      dummy.position.set(l.x, 4.65, l.z);
      dummy.rotation.set(0, l.ry, 0);
      dummy.scale.set(0.8, 0.6, 0.4);
      dummy.updateMatrix();
      lampMesh.setMatrixAt(k, dummy.matrix);
    });
    dummy.rotation.set(0, 0, 0);
  }
  const lampColor = { off: new THREE.Color(0x27e36a), warn: new THREE.Color(0xffb300), on: new THREE.Color(0xff2a1a), dim: new THREE.Color(0x163a22) };
  // ponds: still blue water up against the shoulder (tiled in world space, so ponds that overlap join up), a low
  // stone lip all round the edge, and the water gently moving
  const ponds = r.hazards.filter((h) => h.kind === 'water');
  const waterTex = ponds.length ? waterTexture(THREE) : null;
  if (waterTex) {
    waterTex.repeat.set(1, 1);
    const waterMat = new THREE.MeshPhongMaterial({ color: 0xffffff, map: waterTex, shininess: 90, specular: 0x6688aa });
    ponds.forEach((p, k) => {
      const disc = new THREE.CircleGeometry(p.r, Math.max(48, Math.round(p.r * 3)));
      disc.rotateX(-Math.PI / 2);
      const pos = disc.getAttribute('position');
      const uv = disc.getAttribute('uv');
      for (let j = 0; j < pos.count; j++) uv.setXY(j, (pos.getX(j) + p.x) / 14, (pos.getZ(j) + p.z) / 14);
      const m = new THREE.Mesh(disc, waterMat);
      m.position.set(p.x, 0.045 + k * 0.002, p.z);
      scene.add(m);
    });
    const stones: { x: number; z: number; ry: number; s: number }[] = [];
    for (const p of ponds) {
      const n = Math.ceil((Math.PI * 2 * p.r) / 0.6);
      for (let j = 0; j < n; j++) {
        const a = (j / n) * Math.PI * 2;
        const x = p.x + Math.cos(a) * p.r;
        const z = p.z + Math.sin(a) * p.r;
        if (ponds.some((o) => o !== p && Math.hypot(o.x - x, o.z - z) < o.r - 0.05)) continue;
        if (Math.abs(locate(t, x, z).d) < t.half + CURB + 0.3) continue;
        stones.push({ x, z, ry: a + Math.PI / 2, s: 0.85 + rand() * 0.3 });
      }
    }
    const lip = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 6, 3), new THREE.MeshLambertMaterial({ color: 0xcfc5ad, flatShading: true }), Math.max(1, stones.length));
    stones.forEach((st, j) => {
      dummy.position.set(st.x, 0.05, st.z);
      dummy.rotation.set(0, st.ry, 0);
      dummy.scale.set(0.36 * st.s, 0.15 * st.s, 0.24);
      dummy.updateMatrix();
      lip.setMatrixAt(j, dummy.matrix);
    });
    lip.count = stones.length;
    dummy.rotation.set(0, 0, 0);
    scene.add(lip);
  }

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
  // the night crew's crane hooks that fish karts out (on the golf course, a giant ball retriever), three of them
  const rigs = Array.from({ length: 3 }, () => {
    const g = new THREE.Group();
    const yellow = new THREE.MeshLambertMaterial({ color: 0xffc21a, emissive: 0x4a3200 });
    const cable = new THREE.Mesh(geo.box, kartShared.dark);
    const parts: T.Mesh[] = [];
    if (look.rescue === 'retriever') {
      // a long telescoping pole with a cup on the end
      const cup = new THREE.Mesh(geo.ring, new THREE.MeshLambertMaterial({ color: 0xd8d8de }));
      cup.rotation.x = Math.PI / 2;
      cup.scale.setScalar(0.9);
      parts.push(cup);
      cable.material = new THREE.MeshLambertMaterial({ color: 0xc9ccd4 });
    } else {
      // a yellow hook block and its hook
      const block = new THREE.Mesh(geo.box, yellow);
      block.scale.set(0.7, 0.9, 0.5);
      block.position.y = 0.9;
      const hook = new THREE.Mesh(new THREE.TorusGeometry(0.32, 0.09, 6, 12, Math.PI * 1.4), yellow);
      hook.rotation.z = Math.PI * 0.8;
      hook.position.y = 0.2;
      const tip = new THREE.Mesh(geo.box, kartShared.dark);
      tip.scale.set(0.12, 0.3, 0.12);
      tip.position.y = 0.55;
      parts.push(block, hook, tip);
    }
    g.add(...parts);
    g.visible = false;
    cable.visible = false;
    scene.add(g, cable);
    return { g, cable };
  });
  /** Where each kart is drawn this frame if it has fallen off the road (null: on the road). */
  const poses: (Pose | null)[] = r.karts.map(() => null);
  /** Where the camera stopped as your kart went over the edge. */
  let frozen: { x: number; y: number; z: number } | null = null;

  // items on the road, pooled by kind
  const thingMats = {
    banana: new THREE.MeshLambertMaterial({ color: 0xffd640 }),
    green: new THREE.MeshLambertMaterial({ color: 0x2fae4e }),
    red: new THREE.MeshLambertMaterial({ color: 0xd8312a }),
    blue: new THREE.MeshLambertMaterial({ color: 0x2f6fe4, emissive: 0x0a1e55 }),
    rim: new THREE.MeshLambertMaterial({ color: 0xffffff }),
    tip: new THREE.MeshLambertMaterial({ color: 0x5b3b1c }),
    bomb: new THREE.MeshLambertMaterial({ color: 0x24242c }),
    fuse: new THREE.MeshBasicMaterial({ color: 0xffb02e }),
  };
  const half = new THREE.SphereGeometry(0.5, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  const bananaGeo = new THREE.TorusGeometry(0.42, 0.15, 6, 12, Math.PI * 1.15);
  const buildThing = (kind: ThingKind) => {
    const g = new THREE.Group();
    if (kind === 'bomb') {
      // a round black bomb with a lit fuse and a wind-up key
      const ball = new THREE.Mesh(geo.ball, thingMats.bomb);
      ball.scale.setScalar(0.6);
      ball.position.y = 0.6;
      const cap = new THREE.Mesh(geo.wheel, thingMats.rim);
      cap.scale.set(0.18, 0.12, 0.18);
      cap.position.y = 1.2;
      const spark = new THREE.Mesh(geo.ball, thingMats.fuse);
      spark.scale.setScalar(0.14);
      spark.position.y = 1.36;
      spark.name = 'spark';
      const key = new THREE.Mesh(geo.ring, thingMats.rim);
      key.scale.setScalar(0.2);
      key.position.set(0, 0.6, -0.68);
      g.add(ball, cap, spark, key);
      return g;
    }
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
    bomb: Array.from({ length: 6 }, () => makeThing('bomb')),
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

  // words over people's heads (FORE!, BEEP BEEP!), each texture made once
  const words = new Map<string, T.Texture>();
  const pops: { s: T.Sprite; age: number }[] = [];
  const UP = new THREE.Vector3(0, 1, 0);
  const scratchV = new THREE.Vector3();
  const say = (text: string, x: number, y: number, z: number, color = '#ffffff') => {
    let tex = words.get(text);
    if (!tex) {
      tex = texture(
        THREE,
        canvas(256, 64, (g) => {
          g.font = 'bold 40px Inter, Arial, sans-serif';
          g.textAlign = 'center';
          g.textBaseline = 'middle';
          g.lineWidth = 8;
          g.strokeStyle = 'rgba(20,20,30,0.85)';
          g.strokeText(text, 128, 34);
          g.fillStyle = color;
          g.fillText(text, 128, 34);
        }),
      );
      words.set(text, tex);
    }
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    sprite.scale.set(4.4, 1.1, 1);
    sprite.position.set(x, y, z);
    scene.add(sprite);
    pops.push({ s: sprite, age: 0 });
  };

  // small particles: drift smoke, dust, sparks, box shards, coins; meshes are reused and shrink away
  type Particle = { m: T.Mesh; vx: number; vy: number; vz: number; life: number; max: number; size: number; grav: number; grow: boolean };
  const coinGeo = new THREE.CylinderGeometry(0.32, 0.32, 0.08, 12);
  const partMat = {
    smoke: new THREE.MeshBasicMaterial({ color: 0xe8e4dc, transparent: true, opacity: 0.55, depthWrite: false }),
    dust: new THREE.MeshBasicMaterial({ color: 0xc9b07a, transparent: true, opacity: 0.6, depthWrite: false }),
    mud: new THREE.MeshBasicMaterial({ color: 0x5a3f24 }),
    sand: new THREE.MeshBasicMaterial({ color: 0xe6d6a6 }),
    spray: new THREE.MeshBasicMaterial({ color: 0xbfe2ff, transparent: true, opacity: 0.85, depthWrite: false }),
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
  /** How far the camera has pulled back to see past a bullet or a mega kart. */
  let pull = 0;
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
      // what has joined in yet goes by the lap this screen's kart is on
      const lapNow = race.karts[me]?.lap ?? 1;
      // cows walk across the road and turn round at the far side
      for (const { view: cv, i } of cows) {
        const h = race.hazards[i];
        if (!h) continue;
        const at = pointAt(race.track, h.along, h.at);
        const face = headingOf(-at.tz * h.walk, at.tx * h.walk);
        cv.h = dampAngle(cv.h, face, 3, dt);
        cv.g.position.set(h.x, 0, h.z);
        cv.g.rotation.y = cv.h;
        const pace = Math.abs(Math.cos(race.time * (h.speed ?? 0.5) + (h.phase ?? 0)));
        cv.legs.forEach((leg, n) => (leg.rotation.x = Math.sin(clock * 7 + (n % 3 ? 0 : Math.PI)) * 0.45 * pace));
        cv.head.rotation.x = 0.15 + Math.sin(clock * 1.3 + i) * 0.12;
      }
      // cyclists pedal across, leaning round as they turn back at the far side
      for (const { view: bv, i } of bikes) {
        const h = race.hazards[i];
        if (!h) continue;
        const at = pointAt(race.track, h.along, h.at);
        const face = headingOf(-at.tz * h.walk, at.tx * h.walk);
        const was = bv.h;
        bv.h = dampAngle(bv.h, face, 5, dt);
        const turn = dt > 0 ? wrapAngle(bv.h - was) / dt : 0;
        bv.g.position.set(h.x, 0, h.z);
        bv.g.rotation.set(0, bv.h, Math.max(-0.4, Math.min(0.4, -turn * 0.12)));
        const pace = Math.abs(Math.cos(race.time * (h.speed ?? 0.5) + (h.phase ?? 0)));
        bv.crank += dt * (2 + 9 * pace);
        bv.pedal(bv.crank);
        for (const w of bv.wheels) w.rotation.x = bv.crank * 2.4;
      }
      // buses drive on round the lap, facing the way the road runs
      for (const b of buses) {
        const h = race.hazards[b.i];
        if (!h) continue;
        b.g.position.set(h.x, 0, h.z);
        b.g.rotation.y = headingOf(h.tx, h.tz);
        const roll = ((h.drive ?? 0) * Math.max(0, race.time)) / 0.52;
        for (const w of b.wheels) w.rotation.x = roll;
      }
      // golf carts: on their rounds facing down the road, or across on a cart path, turning round at the far side
      for (const cv of carts) {
        const h = race.hazards[cv.i];
        if (!h) continue;
        let speed: number;
        if (h.drive) {
          cv.h = headingOf(h.tx, h.tz);
          speed = race.time > 0 ? h.drive : 0;
        } else {
          const at = pointAt(race.track, h.along, h.at);
          cv.h = dampAngle(cv.h, headingOf(-at.tz * h.walk, at.tx * h.walk), 4, dt);
          speed = Math.abs(hazardV(h, race.time));
        }
        cv.g.position.set(h.x, 0, h.z);
        cv.g.rotation.y = cv.h;
        cv.roll += (speed * dt) / 0.28;
        for (const w of cv.wheels) w.rotation.x = cv.roll;
      }
      // golfers walking across with their bags
      for (const gv of golfers) {
        const h = race.hazards[gv.i];
        if (!h) continue;
        if (!awake(h, lapNow)) {
          // a gallery waiting its turn: stood watching from behind the wall until its lap comes round
          const side = pointAt(race.track, h.along, -(race.track.edge + 1.4));
          gv.h = headingOf(-side.tz, side.tx);
          gv.g.position.set(side.x, 0, side.z);
          gv.g.rotation.y = gv.h;
          gv.legs.forEach((leg) => (leg.rotation.x = 0));
          gv.arms.forEach((arm) => (arm.rotation.x = 0));
          continue;
        }
        const at = pointAt(race.track, h.along, h.at);
        gv.h = dampAngle(gv.h, headingOf(-at.tz * h.walk, at.tx * h.walk), 3, dt);
        gv.g.position.set(h.x, 0, h.z);
        gv.g.rotation.y = gv.h;
        const pace = Math.abs(Math.cos(race.time * (h.speed ?? 0.5) + (h.phase ?? 0)));
        const stride = Math.sin(clock * 7.5 + gv.i) * 0.55 * pace;
        gv.legs.forEach((leg, n) => (leg.rotation.x = n ? stride : -stride));
        gv.arms.forEach((arm, n) => (arm.rotation.x = (n ? -stride : stride) * 0.7));
      }
      // golf balls: hit from the tee, in the air with their shadow growing on the road under them and the warning up,
      // then down, bouncing on and rolling away
      for (const b of balls) {
        const h = race.hazards[b.i];
        if (!h) continue;
        if (!awake(h, lapNow)) {
          // a tee that hasn't started hitting onto the road yet: the golfer stands addressing the ball
          b.swing(0);
          b.ball.visible = b.streak.visible = b.shadow.visible = b.mark.visible = false;
          continue;
        }
        const every = h.every ?? 5;
        const since = ballSince(h, race.time);
        const until = every - since;
        const strike = BALL_FLIGHT - until;
        b.swing(swingAt(strike > -1.2 ? strike : BALL_FLIGHT + since));
        const where = (back: number) => {
          // the ball's position `back` seconds ago
          const u2 = until + back;
          if (u2 <= BALL_FLIGHT && u2 >= 0) {
            const u = 1 - u2 / BALL_FLIGHT;
            return [b.tee.x + (b.land.x - b.tee.x) * u, b.tee.y * (1 - u) + b.land.y * u + b.high * 4 * u * (1 - u), b.tee.z + (b.land.z - b.tee.z) * u] as const;
          }
          const w = since - back;
          let along: number;
          let y: number;
          if (w < 0.5) {
            along = 6 * (w / 0.5);
            y = 1.8 * 4 * (w / 0.5) * (1 - w / 0.5);
          } else if (w < 0.85) {
            const q = (w - 0.5) / 0.35;
            along = 6 + 3.5 * q;
            y = 0.6 * 4 * q * (1 - q);
          } else {
            const q = Math.min(1, (w - 0.85) / (BALL_ROLL - 0.85));
            along = 9.5 + 6 * (1 - (1 - q) * (1 - q));
            y = 0;
          }
          return [b.land.x + b.ux * along * b.roll, b.land.y + y, b.land.z + b.uz * along * b.roll] as const;
        };
        const flying = until <= BALL_FLIGHT;
        b.ball.visible = flying || since < BALL_ROLL;
        if (b.ball.visible) {
          const [x, y, z] = where(0);
          b.ball.position.set(x, y, z);
          b.ball.rotation.x += dt * 9;
          // a short white streak behind it while it flies
          b.streak.visible = flying || since < 0.5;
          if (b.streak.visible) {
            const [px, py, pz] = where(0.06);
            const dir = scratchV.set(x - px, y - py, z - pz);
            const len = Math.min(2, dir.length() * 1.2);
            if (len > 0.05) {
              dir.normalize();
              b.streak.scale.set(1, len, 1);
              b.streak.position.set(x - dir.x * len * 0.5, y - dir.y * len * 0.5, z - dir.z * len * 0.5);
              b.streak.quaternion.setFromUnitVectors(UP, dir);
            } else b.streak.visible = false;
          }
        } else b.streak.visible = false;
        // the shadow grows and darkens as it comes down, and fades just after
        const warn = until < BALL_WARN ? 1 - until / BALL_WARN : since < 0.25 ? 1 - since / 0.25 : -1;
        b.shadow.visible = warn >= 0;
        b.mark.visible = until < BALL_WARN;
        if (warn >= 0) {
          const size = (until < BALL_WARN ? 1.1 + 2.1 * warn : 3.2) * (h.r + 1.05);
          b.shadow.scale.set(size, size, 1);
          b.shade.opacity = until < BALL_WARN ? 0.35 + 0.55 * warn : 0.9 * warn;
        }
        if (b.mark.visible) {
          const pulse = 1.5 + Math.sin(clock * 14) * 0.15;
          b.mark.scale.set(pulse, pulse, 1);
          b.mark.position.y = 3.4 + Math.sin(clock * 5) * 0.15;
        }
      }
      // the set pieces, as hazState has them for this screen's lap
      const meK = race.karts[me];
      for (const hv of hammers) {
        const h = race.hazards[hv.i];
        const st = hazState(race, h, race.time, lapNow);
        // (the head falls and sits as the state says; hauled up for a bus, or parked asleep, it eases)
        hv.lift = st.phase === 'idle' || st.phase === 'off' ? damp(hv.lift, 1, 6, dt) : st.lift;
        if (hv.phase === 'slam' && st.phase === 'down') {
          // the blow: dust round the foot of the head, and the ground shakes nearby
          burst(geo.ball, [partMat.dust], h.x, 0.3, h.z, 14, 6, 0.4, 0.7, 12);
          if (meK && Math.hypot(meK.x - h.x, meK.z - h.z) < 25) shake = Math.max(shake, 0.3);
        }
        hv.phase = st.phase;
        const y = 0.7 + hv.lift * HAMMER.drop + (st.warn > 0 ? Math.sin(clock * 40) * 0.05 * st.warn : 0);
        hv.head.position.y = y;
        hv.ram.scale.y = Math.max(0.1, 8.1 - (y + 0.7));
        hv.ram.position.y = (8.1 + y + 0.7) / 2;
        const sz = h.r * (1.4 + 1.2 * (1 - hv.lift));
        hv.shade.scale.set(sz, sz, 1);
        hv.shadeMat.opacity = st.phase === 'off' ? 0.15 : 0.25 + 0.5 * (1 - hv.lift) + 0.25 * st.warn;
        hv.beacon.visible = st.warn > 0 && Math.floor(clock * 8) % 2 === 0;
      }
      if (postMesh && capMesh && lampMesh) {
        for (const b of banks) {
          const h = race.hazards[b.i];
          const st = hazState(race, h, race.time, lapNow);
          const lift = st.lift;
          for (let k = 0; k < 3; k++) {
            const p = bankPosts[b.post + k];
            dummy.position.set(p.x, -0.52 + lift * 1.04, p.z);
            dummy.rotation.set(0, p.ry, 0);
            dummy.scale.set(0.22, 1.04, 0.22);
            dummy.updateMatrix();
            postMesh.setMatrixAt(b.post + k, dummy.matrix);
            dummy.position.y = lift * 1.04 + 0.03;
            dummy.scale.set(0.28, 0.1, 0.28);
            dummy.updateMatrix();
            capMesh.setMatrixAt(b.post + k, dummy.matrix);
          }
          // green down, amber flashing before it rises, red up; dark before its lap
          const c = st.phase === 'off' ? lampColor.dim : st.solid ? lampColor.on : st.warn > 0 && Math.floor(clock * 8) % 2 === 0 ? lampColor.warn : st.warn > 0 ? lampColor.dim : lampColor.off;
          lampMesh.setColorAt(b.lamp, c);
          for (let k = 0; k < 3; k++) capMesh.setColorAt(b.post + k, c);
        }
        dummy.rotation.set(0, 0, 0);
        postMesh.instanceMatrix.needsUpdate = true;
        capMesh.instanceMatrix.needsUpdate = true;
        if (lampMesh.instanceColor) lampMesh.instanceColor.needsUpdate = true;
        if (capMesh.instanceColor) capMesh.instanceColor.needsUpdate = true;
      }
      for (const wv of wreckers) {
        const h = race.hazards[wv.i];
        const st = hazState(race, h, race.time, lapNow);
        wv.lift = damp(wv.lift, st.lift, 4, dt);
        const swing = st.d - h.d;
        const y = 9.5 - Math.sqrt(Math.max(0, 8.2 * 8.2 - swing * swing)) + wv.lift * 4;
        wv.ball.position.set(-st.d, y, 0);
        const dx = -(st.d - h.d);
        const dy = y - 9.5;
        const len = Math.hypot(dx, dy) || 0.01;
        wv.cable.scale.set(0.09, len, 0.09);
        wv.cable.position.set(-(st.d + h.d) / 2, (y + 9.5) / 2, 0);
        wv.cable.quaternion.setFromUnitVectors(UP, scratchV.set(dx / len, dy / len, 0));
        wv.ball.rotation.z = Math.atan2(dx, -dy) * 0.3;
        wv.light.visible = Math.floor(clock * 1.5) % 2 === 0;
      }
      for (const rv of rotors) {
        const h = race.hazards[rv.i];
        const st = hazState(race, h, race.time, lapNow);
        rv.arm.rotation.y = -st.ang;
        rv.on = damp(rv.on, st.live ? 1 : 0, 5, dt);
        rv.arm.visible = rv.on > 0.03;
        rv.jet.scale.set(0.5 + 0.5 * rv.on, 0.5 + 0.5 * rv.on, (h.arm ?? 5) * rv.on);
        rv.spray.position.z = (h.arm ?? 5) * rv.on;
        rv.spray.scale.set(3 * rv.on, 2.2 * rv.on, 1);
        rv.sheen.visible = rv.on > 0.03;
        rv.cap.visible = st.phase === 'off';
      }
      for (const w of wets) {
        const h = race.hazards[w.i];
        const on = hazState(race, h, race.time, lapNow).live;
        w.decal.visible = on;
        w.mist.visible = on;
        if (on) (w.mist.material as T.SpriteMaterial).opacity = 0.2 + Math.sin(clock * 1.3 + w.i) * 0.06;
      }
      pins.forEach((f, n) => {
        f.rotation.y = Math.sin(clock * 2.3 + n * 2) * 0.4;
        f.scale.x = 0.9 + Math.sin(clock * 6 + n) * 0.1;
      });
      if (waterTex) waterTex.offset.set((clock * 0.01) % 1, (clock * 0.006) % 1);
      sceneryTick?.(race, clock, dt);
      // things people shout, floating up and fading
      for (let n = pops.length - 1; n >= 0; n--) {
        const pop = pops[n];
        pop.age += dt;
        pop.s.position.y += dt * 1.4;
        (pop.s.material as T.SpriteMaterial).opacity = Math.max(0, 1 - Math.max(0, pop.age - 0.5) / 0.6);
        if (pop.age > 1.1) {
          scene.remove(pop.s);
          (pop.s.material as T.Material).dispose();
          pops.splice(n, 1);
        }
      }
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
        if (th.kind === 'banana' || th.kind === 'bomb') g.rotation.y = th.id;
        else g.rotation.y = clock * (th.kind === 'blue' ? 4 : 14);
        // a bomb's fuse fizzes, faster as it runs down
        if (th.kind === 'bomb') {
          const spark = g.getObjectByName('spark');
          if (spark) spark.visible = (clock * (th.life < 1.2 ? 16 : 7)) % 1 > 0.35;
        }
      }
      for (const [id, g] of used) {
        if (live.has(id)) continue;
        g.visible = false;
        used.delete(id);
      }

      // karts, with drift smoke and dust kicked up off the grass
      let rig = 0;
      race.karts.forEach((k, i) => {
        const v = karts[i];
        const pose = k.sunk > 0 ? fallPose(race, k, clock) : null;
        poses[i] = pose;
        syncKart(v, k, dt, clock, pose);
        v.smoke -= dt;
        if (pose) {
          // the hook (or the retriever) on its way down for it, carrying it back and letting go
          const set = rigs[rig];
          if (set && pose.hook !== null) {
            rig++;
            set.g.visible = set.cable.visible = true;
            set.g.position.set(pose.x, pose.hook, pose.z);
            set.g.rotation.y = pose.h;
            if (look.rescue === 'retriever') {
              // reaching in from the bank, from off the side of the road
              const sd = k.d >= 0 ? 1 : -1;
              const bank = pointAt(race.track, k.s, sd * (race.track.edge + 7));
              const dx = pose.x - bank.x;
              const dz = pose.z - bank.z;
              const dy = pose.hook - 0.8;
              const len = Math.hypot(dx, dy, dz);
              set.cable.scale.set(0.12, len, 0.12);
              set.cable.position.set((pose.x + bank.x) / 2, (pose.hook + 0.8) / 2, (pose.z + bank.z) / 2);
              set.cable.quaternion.setFromUnitVectors(UP, scratchV.set(dx / len, dy / len, dz / len));
            } else {
              const top = 42;
              set.cable.quaternion.identity();
              set.cable.scale.set(0.06, top - pose.hook, 0.06);
              set.cable.position.set(pose.x, (top + pose.hook) / 2 + 1, pose.z);
            }
          }
          // bubbles while it is under the water, dust coming up out of a pit
          if (pose.y < -0.5 && Math.random() < dt * 14) emit(geo.ball, k.fell?.past === 'water' || !k.fell ? partMat.white : partMat.dust, pose.x + (Math.random() - 0.5) * 1.6, 0.08, pose.z + (Math.random() - 0.5) * 1.6, 0, 0.6, 0, 0.5, 0.14, -3);
          return;
        }
        if (v.smoke > 0 || k.y > 0.2 || Math.abs(k.v) < 6) return;
        const dusty = k.offroad && k.boost <= 0;
        if (k.mud) {
          // mud (or sand, out of a bunker) flies up off the back wheels
          v.smoke = 0.04;
          for (const side of [-1, 1]) emit(geo.ball, k.sand ? partMat.sand : partMat.mud, k.x - Math.sin(k.h) * 1.2 - Math.cos(k.h) * side * 0.75, 0.3, k.z - Math.cos(k.h) * 1.2 + Math.sin(k.h) * side * 0.75, (Math.random() - 0.5) * 3 - Math.sin(k.h) * 3, 3 + Math.random() * 3, (Math.random() - 0.5) * 3 - Math.cos(k.h) * 3, 0.5, 0.16, 14);
          return;
        }
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
      for (let n = rig; n < rigs.length; n++) rigs[n].g.visible = rigs[n].cable.visible = false;
      // the studs along the lip blink, and the water moves
      studMat.color.setHex(Math.floor(clock * 2) % 2 ? 0x5a3200 : 0xffa000);
      if (pondTex) pondTex.offset.set((clock * 0.02) % 1, (clock * 0.013) % 1);
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
      // (off the road, the camera follows the kart as the crane carries it; it stops where it is as the kart goes over)
      const pose = poses[me] ?? null;
      const focusX = pose ? pose.x : k.x;
      const focusZ = pose ? pose.z : k.z;
      const focusY = pose ? Math.max(0, pose.y) : k.y;
      const sinking = pose !== null && k.sunk > 0 && 1 - k.sunk / race.tier.fallT < FALL_SINK;
      camYaw = camYaw === null ? k.h : dampAngle(camYaw, pose ? pose.h : k.h, k.spin > 0 || k.tumble > 0 || pose ? 2 : 6, dt);
      let swing = 0;
      if (race.time < -0.8) {
        const u = Math.min(1, Math.max(0, (race.time + COUNTDOWN + 0.4) / (COUNTDOWN - 0.4)));
        swing = (1 - u * u * (3 - 2 * u)) * Math.PI * 0.85;
      }
      shake = Math.max(0, shake - dt * 1.5);
      const flip = lookBack && swing === 0 ? Math.PI : 0;
      const yaw = camYaw + swing + flip;
      pull = damp(pull, k.bullet > 0 ? 1 : k.mega > 0 ? 0.6 : 0, 3, dt);
      const dist = back + swing * 2.2 + pull * 2.5;
      const jx = (Math.random() - 0.5) * shake;
      const jy = (Math.random() - 0.5) * shake;
      let cx = focusX - Math.sin(yaw) * dist;
      let cz = focusZ - Math.cos(yaw) * dist;
      // never out past a wall: up against one facing across the road (after a spin, say) the camera would be out among
      // the scenery behind it, so it comes in toward the kart until it is over the wall, and up a little to look down
      // over the kart rather than into the back of it. Where the road drops away there is nothing to hide behind.
      let lift = 0;
      if (swing === 0 && !pose) {
        const road = race.track;
        const at = locate(road, cx, cz, k.i);
        const side = at.d >= 0 ? 1 : -1;
        if (Math.abs(at.d) > road.edge && edgeAt(road, at.s, side).past === 'wall' && Math.abs(at.d - k.d) > 0.01 && Math.abs(deltaS(road, k.s, at.s)) < 15) {
          const f = Math.min(1, Math.max(0, (side * road.edge - k.d) / (at.d - k.d)));
          cx = k.x + (cx - k.x) * f;
          cz = k.z + (cz - k.z) * f;
          lift = (1 - f) * 1.6;
        }
      }
      let cy = 2.75 + swing * 0.8 + pull * 1.6 + lift + focusY * 0.25;
      if (pose) cy = Math.max(1.5, cy + (pose.y > 0 ? pose.y * 0.6 : 0));
      if (sinking) {
        frozen ??= { x: camera.position.x, y: camera.position.y, z: camera.position.z };
        camera.position.set(frozen.x + jx, frozen.y + jy, frozen.z);
      } else {
        frozen = null;
        camera.position.set(cx + jx, cy + jy, cz);
      }
      camera.lookAt(focusX + Math.sin(camYaw + flip) * 4, 1.15 + (pose ? Math.max(-0.5, pose.y) * 0.6 : k.y * 0.3), focusZ + Math.cos(camYaw + flip) * 4);
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
      } else if (e.t === 'blast') {
        // the horn's shockwave
        effect(e.x, 1.2, e.z, 9, true);
        const k = race.karts[me];
        if (k && Math.hypot(k.x - e.x, k.z - e.z) < 20) shake = Math.max(shake, 0.6);
      } else if (e.t === 'inked') {
        const k = race.karts[e.k];
        if (k) burst(geo.ball, [partMat.smoke], k.x, 1.4, k.z, 6, 2, 0.4, 0.6, 0);
      } else if (e.t === 'splash') {
        // into the pond: a big splash of spray
        const k = race.karts[e.k];
        if (!k) return;
        burst(geo.ball, [partMat.spray, partMat.white], k.x, 0.3, k.z, 28, 8, 0.32, 0.9, 16);
        effect(k.x, 0.4, k.z, 2.6, false);
        if (e.k === me) shake = Math.max(shake, 0.5);
      } else if (e.t === 'fall') {
        // down into the pit: a cloud of dust, and a jolt
        const k = race.karts[e.k];
        if (!k) return;
        burst(geo.ball, [partMat.dust], k.x, 0.3, k.z, 22, 6, 0.4, 0.9, 10);
        if (e.k === me) shake = Math.max(shake, 0.7);
      } else if (e.t === 'sank') {
        burst(geo.ball, [e.kind === 'water' ? partMat.spray : partMat.dust], e.x, 0.2, e.z, 8, 4, 0.2, 0.5, 14);
      } else if (e.t === 'set') {
        const k = race.karts[e.k];
        if (k) effect(k.x, 0.5, k.z, 1.4, false);
      } else if (e.t === 'sand') {
        const k = race.karts[e.k];
        if (k) burst(geo.ball, [partMat.sand], k.x, 0.3, k.z, 12, 4.5, 0.32, 0.6, 10);
      } else if (e.t === 'plink') {
        const k = race.karts[e.k];
        if (!k) return;
        burst(geo.box, [partMat.white, partMat.star], k.x, 1.8, k.z, 10, 4, 0.16, 0.5, 6);
        say('PLINK!', k.x, 3.2, k.z, '#ffe14d');
      } else if (e.t === 'haz') {
        // caught by a set piece: sparks off the steel (spray off the jet), and a jolt if it was you
        const k = race.karts[e.k];
        if (!k) return;
        if (e.kind === 'rotor') burst(geo.ball, [partMat.spray, partMat.white], k.x, 0.8, k.z, 14, 5, 0.25, 0.6, 10);
        else burst(geo.box, [partMat.white, partMat.star], k.x, 0.9, k.z, 12, 6, 0.16, 0.5);
        if (e.k === me) shake = Math.max(shake, e.kind === 'rotor' ? 0.35 : 0.7);
      } else if (e.t === 'toot' || e.t === 'fore') {
        const k = race.karts[e.k];
        if (k) say(e.t === 'toot' ? 'BEEP BEEP!' : 'FORE!', k.x, 3.4, k.z, e.t === 'fore' ? '#ff8a3d' : '#ffffff');
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
      for (const m of [partMat.smoke, partMat.dust, partMat.mud, partMat.sand, partMat.spray, partMat.white, ...partMat.spark, ...partMat.rainbow]) m.dispose();
      for (const tex of words.values()) tex.dispose();
      for (const g of [ballGeo, streakGeo]) g.dispose();
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

/**
 * Where a kart that has fallen off the road is drawn while the crane fishes it out (see FALL_SINK and FALL_CARRY): it
 * slides on over the edge and sinks out of sight (into the water, or down the pit), the hook comes down for it, carries
 * it back over the road swinging and sets it down facing the right way. hook: how high the hook is (null: not out).
 * Someone else's kart online is just under, with the hook over it.
 */
type Pose = { x: number; z: number; y: number; h: number; hook: number | null };
function fallPose(r: Race, k: Kart, clock: number): Pose {
  const t = r.track;
  const T = r.tier.fallT;
  const u = 1 - Math.min(1, k.sunk / T);
  const fell = k.fell;
  const at = locate(t, k.x, k.z, k.i);
  const past: Past = fell?.past ?? (r.holes.some((h) => inTrench(t, h, at.s, at.d)) ? 'pit' : edgeAt(t, at.s, at.d >= 0 ? 1 : -1).past);
  const depth = past === 'water' ? 1.4 : 3;
  if (!fell) return { x: k.x, z: k.z, y: -depth, h: k.h, hook: 1 + Math.sin(clock * 2) * 0.5 };
  const ease = (q: number) => q * q * (3 - 2 * q);
  // sliding on over the edge as it drops, slowing to a stop (not far, down a trench)
  const slide = (q: number) => Math.min(fell.hole ? 1.2 : 6, fell.v * FALL_SINK * T * (q - (q * q) / 2));
  const s1 = slide(1);
  const sx = k.x + Math.sin(k.h) * s1;
  const sz = k.z + Math.cos(k.h) * s1;
  const to = pointAt(t, fell.to[0], fell.to[1]);
  const th = headingOf(to.tx, to.tz);
  if (u < FALL_SINK) {
    const q = u / FALL_SINK;
    const d = slide(q);
    // the hook comes down for it as it goes under
    const hook = q > 0.4 ? -depth + 1.9 + 14 * (1 - ease((q - 0.4) / 0.6)) : null;
    return { x: k.x + Math.sin(k.h) * d, z: k.z + Math.cos(k.h) * d, y: -depth * q * q, h: k.h, hook };
  }
  if (u < FALL_SINK + FALL_CARRY) {
    const e = ease((u - FALL_SINK) / FALL_CARRY);
    const y = -depth + (depth + 1.2) * e + 2.4 * Math.sin(Math.PI * e);
    return { x: sx + (to.x - sx) * e, z: sz + (to.z - sz) * e, y, h: k.h + wrapAngle(th - k.h) * e, hook: y + 1.9 };
  }
  // set down, and the hook lets go and goes back up
  const q = (u - FALL_SINK - FALL_CARRY) / (1 - FALL_SINK - FALL_CARRY);
  const y = 1.2 * (1 - q) * (1 - q);
  return { x: to.x, z: to.z, y, h: th, hook: y + 1.9 + Math.max(0, q - 0.4) * 22 };
}

const scratch = { color: 0 };
function syncKart(v: KartView, k: Kart, dt: number, clock: number, pose: Pose | null) {
  if (k.hat !== v.hatName) v.wear(k.hat);
  // a moment's grace after a hit or being set back on the road: the kart blinks
  v.root.visible = !(k.safe > 0 && !hurt(k) && Math.floor(clock * 15) % 2 === 1);
  scratch.color = parseInt(k.color.slice(1), 16);
  if (scratch.color !== v.color) v.color = scratch.color;
  v.root.position.set(pose ? pose.x : k.x, 0, pose ? pose.z : k.z);
  v.root.rotation.y = pose ? pose.h : k.h;
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
  // off the road: sinking out of sight, then swinging a little on the crane's hook as it is carried back
  v.shadow.visible = !pose;
  v.body.position.y = pose ? pose.y : k.y;
  const sway = pose && pose.hook !== null ? Math.sin(clock * 5) * 0.12 : 0;
  v.body.rotation.set(-v.flipA + sway, v.driftYaw + v.spinA + v.trickA, v.roll + wobble + sway * 0.6);
  const size = k.shrink > 0 ? 0.62 : k.mega > 0 ? 1.5 : 1;
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
  const held = k.item === 'bananas' ? 'banana' : k.item === 'greens' ? 'green' : k.item;
  for (const g of v.trail.children) g.visible = k.trail && g.name === held;
  // inside a bullet the kart itself is hidden
  v.bullet.visible = k.bullet > 0;
  v.body.visible = k.bullet <= 0;
  if (k.bullet > 0) v.bullet.position.y = k.y;
  const dizzy = k.spin > 0 || k.tumble > 0 || k.squash > 0;
  v.stars.visible = dizzy;
  if (dizzy) v.stars.rotation.y = clock * 7;
  v.wind.visible = k.draft > 0.3 && Math.random() > 0.2;
}
