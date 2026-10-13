// three.js view of a Scramble match: the island, the eggs, the bus, the storm, loot, walls, bullets and effects.
// It reads a Match every frame and never changes it. Only classes kit/three-lib.ts exports are used.
import type { T } from './gl';
import { createGL, damp, disposeTree, type GL } from './gl';
import { BEACH, BUSH_R, BUS_Y, CHEST_HD, CHEST_HW, CRATE_HALF, HALF, WALL_H, busAt } from './map';
import { CRATE_HP, F_BANDAGE, F_RELOAD, F_SHIELDING, WALL_HALF, WALL_HP, WALL_THICK, concealed, held, type Ev, type Fighter, type LootItem, type Match } from './logic';
import { RARITY_COLORS, WEAPONS, type LootDef, type WeaponId } from './items';

type Three = typeof import('three');

export type FrameOpts = {
  /** Draw the aim line from this egg's gun (the player's own egg). */
  aimLine: boolean;
  /** Pull the camera back over the whole island (before the match, behind the Start card). */
  overview: boolean;
};

export type View = {
  gl: GL;
  camera: T.PerspectiveCamera;
  resize(w: number, h: number): void;
  /** Moves everything to match the match and points the camera at egg `focus`. */
  frame(m: Match, focus: number, dt: number, clock: number, opts: FrameOpts): void;
  /** One-off effects: puffs, chips, blasts, flashes, camera shake. */
  react(e: Ev, m: Match, focus: number): void;
  /** Screen position (CSS pixels) of a world point, or null when it is off camera. */
  project(x: number, y: number, z: number): { x: number; y: number } | null;
  /** The world point under a screen position (CSS pixels), on the plane at height y. */
  ground(sx: number, sy: number, y?: number): { x: number; z: number } | null;
  render(): void;
  dispose(): void;
};

const GROUND_VIEW = 14;
const DROP_VIEW = 34;
const BUS_VIEW = 62;
const OVERVIEW = 95;
const TILT = (58 * Math.PI) / 180;
const FOV = 42;
/** three's GreaterDepth constant, by value: three-lib.ts exports classes, not constants. */
const GREATER_DEPTH = 6 as T.DepthModes;

const AMMO_COLORS = { light: 0xf2c94c, heavy: 0x6fcf97, shells: 0xeb5757, rockets: 0xbb6bd9 } as const;
const ROOF_COLORS = [0xb5523b, 0x4f6d8f, 0x6f8b4e, 0x8b5e83];
const WALL_COLORS = [0xf1e6d2, 0xd9c7a8, 0xe8dccb, 0xcfd6dc];

function canvas(w: number, h: number, draw: (g: CanvasRenderingContext2D) => void) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g);
  return c;
}

/** Deterministic noise for textures, so the island looks the same every visit. */
function scatter(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (Math.imul(a, 1664525) + 1013904223) >>> 0;
    return a / 4294967296;
  };
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

function grassTexture(THREE: Three) {
  const rnd = scatter(11);
  return texture(
    THREE,
    canvas(256, 256, (g) => {
      g.fillStyle = '#6dab4f';
      g.fillRect(0, 0, 256, 256);
      for (let i = 0; i < 2600; i++) {
        const light = rnd() > 0.5;
        g.fillStyle = light ? `rgba(160, 210, 110, ${0.15 + rnd() * 0.25})` : `rgba(40, 90, 30, ${0.12 + rnd() * 0.22})`;
        g.fillRect(rnd() * 256, rnd() * 256, 2 + rnd() * 2, 4 + rnd() * 5);
      }
      for (let i = 0; i < 40; i++) {
        g.fillStyle = `rgba(250, 240, 160, ${0.5 + rnd() * 0.4})`;
        g.beginPath();
        g.arc(rnd() * 256, rnd() * 256, 1.4, 0, Math.PI * 2);
        g.fill();
      }
    }),
    [26, 26],
  );
}

function sandTexture(THREE: Three) {
  const rnd = scatter(5);
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#e9d7a6';
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 900; i++) {
        g.fillStyle = rnd() > 0.5 ? 'rgba(255,255,255,0.25)' : 'rgba(150,120,70,0.18)';
        g.fillRect(rnd() * 128, rnd() * 128, 1.5, 1.5);
      }
    }),
    [30, 30],
  );
}

function planksTexture(THREE: Three, base: string, line: string, repeat: [number, number]) {
  const rnd = scatter(7);
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = base;
      g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16) {
        g.fillStyle = line;
        g.fillRect(0, y, 128, 2);
        const off = rnd() * 128;
        g.fillRect(off, y, 2, 16);
        for (let i = 0; i < 18; i++) {
          g.fillStyle = `rgba(0,0,0,${rnd() * 0.08})`;
          g.fillRect(rnd() * 128, y + 3 + rnd() * 11, 6 + rnd() * 18, 1);
        }
      }
    }),
    repeat,
  );
}

function crateTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#b07a3f';
      g.fillRect(0, 0, 128, 128);
      g.strokeStyle = '#7a4f22';
      g.lineWidth = 10;
      g.strokeRect(5, 5, 118, 118);
      g.beginPath();
      g.moveTo(10, 10);
      g.lineTo(118, 118);
      g.moveTo(118, 10);
      g.lineTo(10, 118);
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,0.12)';
      for (let y = 18; y < 120; y += 22) g.fillRect(12, y, 104, 2);
    }),
  );
}

function blobTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
      grad.addColorStop(0, 'rgba(0,0,0,0.55)');
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
    }),
  );
}

/** An egg: a sphere squeezed into an egg shape, standing on y = 0 and 1.6 tall. */
function eggGeometry(THREE: Three) {
  const g = new THREE.SphereGeometry(1, 24, 18);
  const pos = g.attributes.position as T.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    const y = pos.getY(i);
    const z = pos.getZ(i);
    const k = 0.6 * (1 - 0.13 * y);
    pos.setXYZ(i, x * k, (y + 1) * 0.8, z * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A ring on the ground whose inner and outer edges move freely (the storm's tint and the next circle). */
function freeRing(THREE: Three, segments: number) {
  const g = new THREE.BufferGeometry();
  const pos = new Float32Array((segments + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < segments; i++) {
    const a = i * 2;
    idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  }
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  const cos = Array.from({ length: segments + 1 }, (_, i) => Math.cos((i / segments) * Math.PI * 2));
  const sin = Array.from({ length: segments + 1 }, (_, i) => Math.sin((i / segments) * Math.PI * 2));
  return {
    geometry: g,
    set(inner: number, outer: number) {
      for (let i = 0; i <= segments; i++) {
        pos[i * 6] = cos[i] * inner;
        pos[i * 6 + 1] = 0;
        pos[i * 6 + 2] = sin[i] * inner;
        pos[i * 6 + 3] = cos[i] * outer;
        pos[i * 6 + 4] = 0;
        pos[i * 6 + 5] = sin[i] * outer;
      }
      (g.attributes.position as T.BufferAttribute).needsUpdate = true;
      g.computeBoundingSphere();
    },
  };
}

type Particle = { mesh: T.Mesh; vx: number; vy: number; vz: number; life: number; max: number; spin: number; grav: number; size: number };

type EggView = {
  root: T.Group;
  body: T.Group;
  skin: T.MeshLambertMaterial;
  hand: T.Group;
  guns: Map<WeaponId | 'spatula', { group: T.Group; stripe: T.Mesh | null }>;
  shadow: T.Mesh;
  glider: T.Group;
  heal: T.Group;
  ring: T.Mesh;
  ghost: T.Mesh;
  walk: number;
  swing: number;
  recoil: number;
  lean: number;
};

type LootView = { group: T.Group; model: T.Object3D; spin: number };

export function buildView(THREE: Three, host: HTMLElement, m: Match): View | null {
  const gl = createGL(THREE, host);
  if (!gl) return null;
  const map = m.map;
  const scene = new THREE.Scene();
  const water = 0x3aa6d4;
  scene.background = new THREE.Color(water);
  scene.fog = new THREE.Fog(water, 160, 520);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 900);
  scene.add(new THREE.HemisphereLight(0xfff6e4, 0x5f7f45, 1.1));
  const sun = new THREE.DirectionalLight(0xfff0d6, 1.35);
  sun.position.set(-40, 90, 30);
  scene.add(sun);
  let width = 1;
  let height = 1;

  // shared stuff, disposed at the end
  const textures: T.Texture[] = [];
  const keep = <X extends T.Texture>(t: X) => {
    textures.push(t);
    return t;
  };
  const geos: T.BufferGeometry[] = [];
  const geo = <X extends T.BufferGeometry>(g: X) => {
    geos.push(g);
    return g;
  };
  const mats: T.Material[] = [];
  const mat = <X extends T.Material>(x: X) => {
    mats.push(x);
    return x;
  };
  const lambert = (color: number, extra: Partial<T.MeshLambertMaterialParameters> = {}) => mat(new THREE.MeshLambertMaterial({ color, ...extra }));
  const basic = (color: number, extra: Partial<T.MeshBasicMaterialParameters> = {}) => mat(new THREE.MeshBasicMaterial({ color, ...extra }));

  const G = {
    box: geo(new THREE.BoxGeometry(1, 1, 1)),
    ball: geo(new THREE.SphereGeometry(1, 12, 9)),
    lowBall: geo(new THREE.SphereGeometry(1, 7, 5)),
    rock: geo(new THREE.SphereGeometry(1, 6, 4)),
    cyl: geo(new THREE.CylinderGeometry(1, 1, 1, 12)),
    cone: geo(new THREE.ConeGeometry(1, 1, 12, 1, true)),
    egg: geo(eggGeometry(THREE)),
    cap: geo(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
    band: geo(new THREE.TorusGeometry(1, 0.12, 6, 24)),
    disc: geo(new THREE.CircleGeometry(1, 24)),
    plane: geo(new THREE.PlaneGeometry(1, 1)),
    ring: geo(new THREE.RingGeometry(0.72, 1, 28)),
  };
  const blob = keep(blobTexture(THREE));
  const M = {
    shadow: basic(0x000000, { map: blob, transparent: true, depthWrite: false }),
    dark: lambert(0x2b2d33),
    metal: lambert(0x5b616b),
    wood: lambert(0x8a5a2b),
    cream: lambert(0xfff3df),
    white: lambert(0xffffff),
    black: basic(0x15161a),
    red: lambert(0xe53935),
    green: basic(0x3fd17a),
    blue: basic(0x4aa8ff, { transparent: true, opacity: 0.55, depthWrite: false }),
    gold: lambert(0xffc83d, { emissive: 0x6a4a00 }),
    tracer: basic(0xfff1a8),
    rocket: lambert(0xfffaf0),
    flash: basic(0xffe27a, { transparent: true, opacity: 0.9, depthWrite: false }),
    aim: basic(0xffffff, { transparent: true, opacity: 0.32, depthWrite: false }),
    // your egg's outline wherever something stands in front of it (a roof, a tree): a slightly bigger egg drawn only
    // where the depth buffer already holds something nearer
    ghost: basic(0xffffff, { transparent: true, opacity: 0.38, depthWrite: false, depthFunc: GREATER_DEPTH }),
    launcher: lambert(0x5a7a3a),
    potion: lambert(0x3f8cff, { emissive: 0x0b2a66 }),
    yolk: lambert(0xffc93c, { emissive: 0x4a3000 }),
    eggWhite: lambert(0xfffbf2),
    spatula: lambert(0xd8dde3),
  };
  const rarity = RARITY_COLORS.map((c) => lambert(parseInt(c.slice(1), 16), { emissive: parseInt(c.slice(1), 16), emissiveIntensity: 0.25 }));
  const rarityGlow = RARITY_COLORS.map((c) => basic(parseInt(c.slice(1), 16), { transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
  const ammoMat = Object.fromEntries(Object.entries(AMMO_COLORS).map(([k, c]) => [k, lambert(c)])) as Record<keyof typeof AMMO_COLORS, T.MeshLambertMaterial>;
  const ammoGlow = Object.fromEntries(Object.entries(AMMO_COLORS).map(([k, c]) => [k, basic(c, { transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })])) as Record<keyof typeof AMMO_COLORS, T.MeshBasicMaterial>;

  const add = (parent: T.Object3D, g: T.BufferGeometry, material: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const o = new THREE.Mesh(g, material);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    parent.add(o);
    return o;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The island.

  const sea = new THREE.Mesh(geo(new THREE.PlaneGeometry(1800, 1800)), lambert(water));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.7;
  scene.add(sea);
  const shore = new THREE.Mesh(geo(new THREE.PlaneGeometry(2 * HALF + 14, 2 * HALF + 14)), basic(0x8fd3ee, { transparent: true, opacity: 0.6, depthWrite: false }));
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = -0.62;
  scene.add(shore);
  const block = new THREE.Mesh(geo(new THREE.BoxGeometry(2 * HALF, 1.3, 2 * HALF)), lambert(0xe9d7a6, { map: keep(sandTexture(THREE)) }));
  block.position.y = -0.65;
  scene.add(block);
  const grass = new THREE.Mesh(geo(new THREE.PlaneGeometry(2 * (HALF - BEACH), 2 * (HALF - BEACH))), lambert(0xffffff, { map: keep(grassTexture(THREE)) }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.005;
  scene.add(grass);

  // buildings: a plank floor, walls with doorways, and a roof that lifts away while you're inside
  const floorTex = keep(planksTexture(THREE, '#c9935a', '#9c6b3a', [1, 1]));
  const wallMats = WALL_COLORS.map((c) => lambert(c));
  const roofs: { mesh: T.Mesh; mat: T.MeshLambertMaterial; fade: number }[] = [];
  map.buildings.forEach((b) => {
    const tex = floorTex.clone();
    keep(tex);
    tex.repeat.set(b.w / 4, b.d / 4);
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.needsUpdate = true;
    const floor = new THREE.Mesh(G.plane, lambert(0xffffff, { map: tex }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(b.x, 0.02, b.z);
    floor.scale.set(b.w, b.d, 1);
    scene.add(floor);
    for (const w of b.walls) {
      const wall = new THREE.Mesh(G.box, wallMats[b.look % wallMats.length]);
      wall.position.set(w.x, WALL_H / 2, w.z);
      wall.scale.set(w.hw * 2, WALL_H, w.hd * 2);
      scene.add(wall);
    }
    const roofMat = lambert(ROOF_COLORS[b.look % ROOF_COLORS.length], { transparent: true, opacity: 1 });
    const roof = new THREE.Mesh(G.box, roofMat);
    roof.position.set(b.x, WALL_H + 0.25, b.z);
    roof.scale.set(b.w + 0.9, 0.5, b.d + 0.9);
    scene.add(roof);
    const ridge = new THREE.Mesh(G.box, roofMat);
    ridge.position.set(0, 0.9, 0);
    ridge.scale.set(1 / (b.w + 0.9) * (b.w * 0.7), 1, 1 / (b.d + 0.9) * (b.d * 0.5));
    roof.add(ridge);
    roofs.push({ mesh: roof, mat: roofMat, fade: 1 });
  });

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const shade = (rnd: () => number, base: number, spread: number) => color.setHex(base).offsetHSL((rnd() - 0.5) * spread * 0.2, 0, (rnd() - 0.5) * spread * 0.2);

  // trees: a trunk and two round crowns each
  const treeRnd = scatter(3);
  const trunks = new THREE.InstancedMesh(geo(new THREE.CylinderGeometry(0.32, 0.48, 1, 7)), lambert(0x8a6240), Math.max(1, map.trees.length));
  const crowns = new THREE.InstancedMesh(G.lowBall, lambert(0xffffff, { flatShading: true }), Math.max(1, map.trees.length * 2));
  map.trees.forEach((t, i) => {
    dummy.position.set(t.x, 1.6, t.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 3.2, 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    const big = 1.7 + treeRnd() * 0.5;
    dummy.position.set(t.x, 3.7, t.z);
    dummy.rotation.set(0, treeRnd() * 6, 0);
    dummy.scale.set(big, big * 0.9, big);
    dummy.updateMatrix();
    crowns.setMatrixAt(i * 2, dummy.matrix);
    crowns.setColorAt(i * 2, shade(treeRnd, 0x3f8f3a, 1));
    dummy.position.set(t.x + (treeRnd() - 0.5) * 0.6, 4.9, t.z + (treeRnd() - 0.5) * 0.6);
    dummy.scale.set(big * 0.68, big * 0.62, big * 0.68);
    dummy.updateMatrix();
    crowns.setMatrixAt(i * 2 + 1, dummy.matrix);
    crowns.setColorAt(i * 2 + 1, shade(treeRnd, 0x56a648, 1));
  });
  scene.add(trunks, crowns);

  const rocks = new THREE.InstancedMesh(G.rock, lambert(0xffffff, { flatShading: true }), Math.max(1, map.rocks.length));
  map.rocks.forEach((r, i) => {
    const rnd = scatter(r.look + 1);
    dummy.position.set(r.x, r.r * 0.35, r.z);
    dummy.rotation.set(rnd() * 0.4, rnd() * 6, rnd() * 0.4);
    dummy.scale.set(r.r * 1.05, r.r * 0.8, r.r * 1.05);
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rocks.setColorAt(i, shade(rnd, 0x9aa0a6, 0.6));
  });
  scene.add(rocks);

  const bushRnd = scatter(9);
  const bushes = new THREE.InstancedMesh(geo(new THREE.SphereGeometry(1, 9, 7)), lambert(0xffffff, { flatShading: true }), Math.max(1, map.bushes.length));
  map.bushes.forEach((b, i) => {
    dummy.position.set(b.x, 0.95, b.z);
    dummy.rotation.set(0, bushRnd() * 6, 0);
    dummy.scale.set(BUSH_R, 1.35, BUSH_R);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    bushes.setColorAt(i, shade(bushRnd, 0x4c9b3c, 0.8));
  });
  scene.add(bushes);

  // crates break; chests open
  const crateList = map.containers.filter((c) => c.kind === 'crate');
  const chestList = map.containers.filter((c) => c.kind === 'chest');
  const crates = new THREE.InstancedMesh(G.box, lambert(0xffffff, { map: keep(crateTexture(THREE)) }), Math.max(1, crateList.length));
  const crateShake = new Map<number, number>();
  const chestBase = new THREE.InstancedMesh(G.box, lambert(0xffffff), Math.max(1, chestList.length));
  const chestLid = new THREE.InstancedMesh(G.box, lambert(0xffffff), Math.max(1, chestList.length));
  const chestGlowMat = basic(0xffd75e, { transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const chestGlow = new THREE.InstancedMesh(G.ring, chestGlowMat, Math.max(1, chestList.length));
  scene.add(crates, chestBase, chestLid, chestGlow);
  const chestState = chestList.map(() => -1);
  const placeChests = (force: boolean) => {
    chestList.forEach((c, i) => {
      const open = m.opened[c.id] ? 1 : 0;
      if (!force && chestState[i] === open) return;
      chestState[i] = open;
      dummy.rotation.set(0, 0, 0);
      dummy.position.set(c.x, 0.32, c.z);
      dummy.scale.set(CHEST_HW * 2, 0.64, CHEST_HD * 2);
      dummy.updateMatrix();
      chestBase.setMatrixAt(i, dummy.matrix);
      chestBase.setColorAt(i, color.setHex(open ? 0x8a6a2a : 0xd99a2b));
      if (open) {
        dummy.position.set(c.x, 0.85, c.z - c.face * CHEST_HD * 0.95);
        dummy.rotation.set(c.face * -1.2, 0, 0);
      } else dummy.position.set(c.x, 0.78, c.z);
      dummy.scale.set(CHEST_HW * 2.06, 0.3, CHEST_HD * 2.06);
      dummy.updateMatrix();
      chestLid.setMatrixAt(i, dummy.matrix);
      chestLid.setColorAt(i, color.setHex(open ? 0x7a5a22 : 0xffc83d));
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.position.set(c.x, 0.04, c.z);
      dummy.scale.setScalar(open ? 0 : 1.5);
      dummy.updateMatrix();
      chestGlow.setMatrixAt(i, dummy.matrix);
    });
    chestBase.instanceMatrix.needsUpdate = true;
    chestLid.instanceMatrix.needsUpdate = true;
    chestGlow.instanceMatrix.needsUpdate = true;
    if (chestBase.instanceColor) chestBase.instanceColor.needsUpdate = true;
    if (chestLid.instanceColor) chestLid.instanceColor.needsUpdate = true;
  };
  placeChests(true);
  const placeCrates = (clock: number) => {
    crateList.forEach((c, i) => {
      const gone = m.opened[c.id];
      const shake = crateShake.get(c.id) ?? -9;
      const jiggle = clock - shake < 0.18 ? Math.sin((clock - shake) * 80) * 0.06 : 0;
      dummy.rotation.set(0, jiggle, 0);
      dummy.position.set(c.x, CRATE_HALF, c.z);
      dummy.scale.setScalar(gone ? 0 : CRATE_HALF * 2);
      dummy.updateMatrix();
      crates.setMatrixAt(i, dummy.matrix);
      const hp = Math.max(0, m.crateHp[c.id] / CRATE_HP);
      crates.setColorAt(i, color.setRGB(0.55 + hp * 0.45, 0.5 + hp * 0.5, 0.45 + hp * 0.55));
    });
    crates.instanceMatrix.needsUpdate = true;
    if (crates.instanceColor) crates.instanceColor.needsUpdate = true;
  };
  placeCrates(0);

  // ---------------------------------------------------------------------------------------------------------------
  // The storm: a purple wall, a tint over everything outside it, and a white ring where it is headed.

  const stormWall = new THREE.Mesh(geo(new THREE.CylinderGeometry(1, 1, 90, 120, 1, true)), basic(0x8a4dff, { transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
  stormWall.position.y = 44;
  stormWall.renderOrder = 3;
  scene.add(stormWall);
  const tint = freeRing(THREE, 120);
  geos.push(tint.geometry);
  const stormTint = new THREE.Mesh(tint.geometry, basic(0x7a3cf0, { transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }));
  stormTint.position.y = 0.12;
  stormTint.renderOrder = 2;
  scene.add(stormTint);
  const nextRing = freeRing(THREE, 120);
  geos.push(nextRing.geometry);
  const nextMesh = new THREE.Mesh(nextRing.geometry, basic(0xffffff, { transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
  nextMesh.position.y = 0.14;
  nextMesh.renderOrder = 2;
  scene.add(nextMesh);
  let lastStorm = { x: NaN, z: NaN, r: NaN, nx: NaN, nz: NaN, nr: NaN };

  // ---------------------------------------------------------------------------------------------------------------
  // The battle bus: a bus under a balloon.

  const bus = new THREE.Group();
  add(bus, G.box, lambert(0x2f7de1), 0, 0, 0, 3, 2.4, 8);
  add(bus, G.box, lambert(0xf5f7fa), 0, 1.25, 0, 3.05, 0.25, 8.05);
  for (const side of [-1, 1]) for (let k = -3; k <= 3; k += 1.5) add(bus, G.box, M.dark, side * 1.52, 0.35, k, 0.06, 0.8, 1.1);
  for (const [x, z] of [
    [-1.1, -2.6],
    [1.1, -2.6],
    [-1.1, 2.6],
    [1.1, 2.6],
  ])
    add(bus, G.cyl, M.dark, x, -1.25, z, 0.55, 0.4, 0.55).rotation.z = Math.PI / 2;
  add(bus, G.ball, lambert(0x8a4dff), 0, 9, 0, 4.2, 4.8, 4.2);
  for (const [x, z] of [
    [-1.3, -3.6],
    [1.3, -3.6],
    [-1.3, 3.6],
    [1.3, 3.6],
  ]) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 1.3, z), new THREE.Vector3(x * 0.6, 5.2, z * 0.25)]);
    geos.push(g);
    bus.add(new THREE.Line(g, mat(new THREE.LineBasicMaterial({ color: 0x333333 }))));
  }
  scene.add(bus);

  // ---------------------------------------------------------------------------------------------------------------
  // Guns: a few boxes each, with a stripe in the rarity's color.

  const gunGeo = {
    stock: G.box,
    barrel: G.cyl,
  };
  function gunModel(w: WeaponId | 'spatula'): { group: T.Group; stripe: T.Mesh | null } {
    const g = new THREE.Group();
    if (w === 'spatula') {
      add(g, G.box, M.wood, 0, 0, 0.1, 0.06, 0.06, 0.6);
      add(g, G.box, M.spatula, 0, 0, 0.55, 0.32, 0.03, 0.34);
      return { group: g, stripe: null };
    }
    let stripe: T.Mesh;
    switch (w) {
      case 'pistol':
        add(g, gunGeo.stock, M.dark, 0, 0, 0.12, 0.12, 0.14, 0.42);
        add(g, gunGeo.stock, M.dark, 0, -0.14, 0, 0.1, 0.22, 0.12);
        stripe = add(g, gunGeo.stock, rarity[0], 0, 0.08, 0.12, 0.13, 0.03, 0.34);
        break;
      case 'smg':
        add(g, gunGeo.stock, M.dark, 0, 0, 0.18, 0.14, 0.17, 0.62);
        add(g, gunGeo.stock, M.metal, 0, -0.18, 0.2, 0.08, 0.26, 0.1);
        add(g, gunGeo.stock, M.dark, 0, -0.12, -0.06, 0.1, 0.2, 0.1);
        stripe = add(g, gunGeo.stock, rarity[0], 0, 0.1, 0.18, 0.15, 0.03, 0.5);
        break;
      case 'rifle':
        add(g, gunGeo.stock, M.dark, 0, 0, 0.3, 0.12, 0.16, 1.05);
        add(g, gunGeo.stock, M.metal, 0, -0.17, 0.3, 0.08, 0.24, 0.12);
        add(g, gunGeo.stock, M.dark, 0, 0.14, 0.2, 0.06, 0.1, 0.3);
        stripe = add(g, gunGeo.stock, rarity[0], 0, 0.09, 0.45, 0.13, 0.03, 0.5);
        break;
      case 'shotgun':
        add(g, gunGeo.stock, M.wood, 0, -0.02, 0, 0.13, 0.16, 0.45);
        add(g, gunGeo.barrel, M.dark, 0, 0.03, 0.48, 0.07, 0.75, 0.07).rotation.x = Math.PI / 2;
        stripe = add(g, gunGeo.stock, rarity[0], 0, -0.06, 0.4, 0.12, 0.08, 0.28);
        break;
      case 'sniper':
        add(g, gunGeo.stock, M.dark, 0, 0, 0.2, 0.11, 0.14, 0.75);
        add(g, gunGeo.barrel, M.metal, 0, 0.02, 0.85, 0.035, 0.7, 0.035).rotation.x = Math.PI / 2;
        add(g, gunGeo.barrel, M.dark, 0, 0.16, 0.25, 0.06, 0.38, 0.06).rotation.x = Math.PI / 2;
        stripe = add(g, gunGeo.stock, rarity[0], 0, 0.08, 0.05, 0.12, 0.03, 0.3);
        break;
      case 'launcher':
        add(g, gunGeo.barrel, M.launcher, 0, 0.05, 0.3, 0.17, 1.1, 0.17).rotation.x = Math.PI / 2;
        add(g, gunGeo.stock, M.dark, 0, -0.16, 0.2, 0.08, 0.24, 0.12);
        stripe = add(g, gunGeo.barrel, rarity[0], 0, 0.05, 0.75, 0.18, 0.12, 0.18);
        stripe.rotation.x = Math.PI / 2;
        break;
    }
    return { group: g, stripe };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Eggs.

  const eggs: EggView[] = m.fighters.map((f) => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const skin = lambert(0xfff3df, { emissive: 0x000000 });
    add(body, G.egg, skin, 0, 0, 0, 1, 1, 1);
    const hat = lambert(parseInt(f.color.slice(1), 16));
    add(body, G.cap, hat, 0, 1.08, 0, 0.5, 0.52, 0.5);
    add(body, G.band, hat, 0, 1.1, 0, 0.47, 0.47, 0.47).rotation.x = Math.PI / 2;
    add(body, G.ball, hat, 0, 1.64, 0, 0.11, 0.11, 0.11);
    for (const side of [-1, 1]) add(body, G.ball, M.black, side * 0.17, 1.0, 0.53, 0.065, 0.085, 0.05);
    for (const side of [-1, 1]) add(body, G.ball, M.cream, side * 0.4, 0.72, 0.42, 0.11, 0.11, 0.11);
    const hand = new THREE.Group();
    hand.position.set(0.24, 0.78, 0.48);
    body.add(hand);
    const shadow = new THREE.Mesh(G.disc, M.shadow);
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.setScalar(0.85);
    root.add(shadow);
    // a little glider for the drop
    const glider = new THREE.Group();
    add(glider, G.cone, lambert(parseInt(f.color.slice(1), 16), { side: THREE.DoubleSide }), 0, 2.9, 0, 1.9, 0.9, 1.9);
    add(glider, G.ball, M.white, 0, 3.35, 0, 0.22, 0.22, 0.22);
    for (const [x, z] of [
      [-1.5, 0],
      [1.5, 0],
      [0, 1.5],
      [0, -1.5],
    ]) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x * 1.2, 2.5, z * 1.2), new THREE.Vector3(x * 0.15, 1.3, z * 0.15)]);
      geos.push(g);
      glider.add(new THREE.Line(g, mat(new THREE.LineBasicMaterial({ color: 0x444444 }))));
    }
    root.add(glider);
    // a cross over the head while bandaging, a blue ring while drinking shield
    const heal = new THREE.Group();
    heal.position.y = 2.15;
    add(heal, G.box, M.green, 0, 0, 0, 0.42, 0.12, 0.12);
    add(heal, G.box, M.green, 0, 0, 0, 0.12, 0.42, 0.12);
    root.add(heal);
    const ring = add(root, G.band, M.blue, 0, 0.9, 0, 0.9, 0.9, 0.9);
    ring.rotation.x = Math.PI / 2;
    const ghost = new THREE.Mesh(G.egg, M.ghost);
    ghost.scale.setScalar(1.05);
    ghost.position.y = -0.04;
    ghost.renderOrder = 20;
    body.add(ghost);
    scene.add(root);
    return { root, body, skin, hand, guns: new Map(), shadow, glider, heal, ring, ghost, walk: 0, swing: 0, recoil: 0, lean: 0 };
  });

  // the aim line from your gun, and where you'll land while gliding
  const aimLine = new THREE.Mesh(G.plane, M.aim);
  aimLine.rotation.x = -Math.PI / 2;
  scene.add(aimLine);
  const landMark = new THREE.Mesh(G.ring, basic(0xffffff, { transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide }));
  landMark.rotation.x = -Math.PI / 2;
  landMark.position.y = 0.1;
  scene.add(landMark);

  // ---------------------------------------------------------------------------------------------------------------
  // Loot on the ground.

  const lootViews = new Map<number, LootView>();
  function lootModel(def: LootDef): T.Object3D {
    const g = new THREE.Group();
    switch (def.kind) {
      case 'gun': {
        const gun = gunModel(def.w);
        if (gun.stripe) gun.stripe.material = rarity[def.r] ?? rarity[0];
        gun.group.scale.setScalar(1.25);
        gun.group.rotation.set(0, 0, Math.PI / 2.4);
        g.add(gun.group);
        break;
      }
      case 'ammo':
        add(g, G.box, ammoMat[def.a], 0, 0, 0, 0.5, 0.32, 0.36);
        add(g, G.box, M.dark, 0, 0.17, 0, 0.52, 0.04, 0.38);
        break;
      case 'bandage':
        add(g, G.box, M.white, 0, 0, 0, 0.5, 0.18, 0.36);
        add(g, G.box, M.red, 0, 0.1, 0, 0.3, 0.02, 0.09);
        add(g, G.box, M.red, 0, 0.1, 0, 0.09, 0.02, 0.3);
        break;
      case 'shield':
        add(g, G.cyl, M.potion, 0, 0, 0, 0.18, 0.42, 0.18);
        add(g, G.cyl, M.white, 0, 0.27, 0, 0.08, 0.14, 0.08);
        break;
      case 'wood':
        for (let i = 0; i < 3; i++) add(g, G.box, M.wood, 0, i * 0.13 - 0.1, (i - 1) * 0.06, 0.7, 0.11, 0.2).rotation.y = i * 0.4;
        break;
    }
    return g;
  }
  function lootView(l: LootItem): LootView {
    const group = new THREE.Group();
    group.position.set(l.x, 0, l.z);
    const glowMat = l.def.kind === 'gun' ? rarityGlow[l.def.r] ?? rarityGlow[0] : l.def.kind === 'ammo' ? ammoGlow[l.def.a] : l.def.kind === 'shield' ? rarityGlow[2] : l.def.kind === 'bandage' ? rarityGlow[1] : rarityGlow[0];
    const glow = new THREE.Mesh(G.ring, glowMat);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    glow.scale.setScalar(l.def.kind === 'gun' ? 0.75 : 0.5);
    group.add(glow);
    const model = lootModel(l.def);
    model.position.y = 0.45;
    group.add(model);
    scene.add(group);
    return { group, model, spin: (l.id % 17) * 0.37 };
  }

  // built walls
  const wallGeo = geo(new THREE.BoxGeometry(WALL_HALF * 2, 3, WALL_THICK * 2 + 0.12));
  const wallTex = keep(planksTexture(THREE, '#c58b4c', '#8c5a2c', [2, 1.5]));
  const wallMat = [lambert(0xffffff, { map: wallTex }), lambert(0xd8b49a, { map: wallTex }), lambert(0xb08070, { map: wallTex })];
  const wallViews = new Map<number, { mesh: T.Mesh; born: number }>();

  // bullets and rockets
  const tracers: T.Mesh[] = [];
  const tracerGeo = geo(new THREE.BoxGeometry(0.08, 0.08, 1));
  const rockets: T.Mesh[] = [];

  // effects: pooled bits that fly and fade, flashes, yolk puddles
  const parts: Particle[] = [];
  const partMat = {
    shell: M.eggWhite,
    wood: lambert(0xa0703a),
    leaf: lambert(0x4c9b3c),
    stone: lambert(0x9aa0a6),
    dust: basic(0xe8dcc0, { transparent: true, opacity: 0.6, depthWrite: false }),
    fire: basic(0xffa53a),
    spark: basic(0xfff1a8),
    smoke: basic(0x777777, { transparent: true, opacity: 0.55, depthWrite: false }),
    yolk: M.yolk,
    purple: basic(0xb48cff),
  };
  for (let i = 0; i < 260; i++) {
    const mesh = new THREE.Mesh(G.box, partMat.dust);
    mesh.visible = false;
    scene.add(mesh);
    parts.push({ mesh, vx: 0, vy: 0, vz: 0, life: 0, max: 1, spin: 0, grav: 0, size: 0.1 });
  }
  let partAt = 0;
  const burst = (x: number, y: number, z: number, n: number, speed: number, size: number, life: number, material: T.Material[], grav = 14) => {
    for (let i = 0; i < n; i++) {
      const p = parts[partAt];
      partAt = (partAt + 1) % parts.length;
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      p.vx = Math.cos(a) * s;
      p.vz = Math.sin(a) * s;
      p.vy = speed * (0.4 + Math.random() * 0.9);
      p.life = life * (0.6 + Math.random() * 0.6);
      p.max = p.life;
      p.spin = (Math.random() - 0.5) * 18;
      p.grav = grav;
      p.size = size * (0.6 + Math.random() * 0.8);
      p.mesh.material = material[i % material.length];
      p.mesh.position.set(x, y, z);
      p.mesh.scale.setScalar(p.size);
      p.mesh.visible = true;
    }
  };
  const flashes: { mesh: T.Mesh; life: number; max: number; grow: number }[] = [];
  const flashMat = M.flash;
  const boomMat = basic(0xff8a2a, { transparent: true, opacity: 0.85, depthWrite: false });
  for (let i = 0; i < 24; i++) {
    const mesh = new THREE.Mesh(G.ball, flashMat);
    mesh.visible = false;
    scene.add(mesh);
    flashes.push({ mesh, life: 0, max: 1, grow: 0 });
  }
  let flashAt = 0;
  const flash = (x: number, y: number, z: number, size: number, life: number, grow: number, material: T.Material) => {
    const f = flashes[flashAt];
    flashAt = (flashAt + 1) % flashes.length;
    f.mesh.material = material;
    f.mesh.position.set(x, y, z);
    f.mesh.scale.setScalar(size);
    f.mesh.visible = true;
    f.life = life;
    f.max = life;
    f.grow = grow;
  };
  const puddles = new THREE.Group();
  scene.add(puddles);

  let shake = 0;
  let now = 0;
  const fog = scene.fog as T.Fog;
  const cam = { x: 0, z: 0, view: OVERVIEW, ready: false };
  const vec = new THREE.Vector3();
  const vec2 = new THREE.Vector3();

  function syncEgg(v: EggView, f: Fighter, dt: number, clock: number, focus: boolean, hidden: boolean) {
    const shown = f.phase !== 'out' && f.phase !== 'bus' && !hidden;
    v.root.visible = shown;
    if (!shown) return;
    v.root.position.set(f.x, f.y, f.z);
    v.body.rotation.y = f.aim;
    const speed = Math.hypot(f.vx, f.vz);
    if (f.phase === 'ground' && speed > 0.4) v.walk += dt * speed * 2.2;
    const bob = f.phase === 'ground' ? Math.abs(Math.sin(v.walk)) * 0.08 : 0;
    v.lean = damp(v.lean, f.phase === 'ground' ? Math.min(0.18, speed * 0.025) : 0, 8, dt);
    v.body.position.y = bob;
    // lean the way it walks, whichever way it faces
    const mx = speed > 0.1 ? f.vx / speed : 0;
    const mz = speed > 0.1 ? f.vz / speed : 0;
    const fx = Math.sin(f.aim);
    const fz = Math.cos(f.aim);
    v.body.rotation.x = (mx * fx + mz * fz) * v.lean;
    v.body.rotation.z = -(mx * fz - mz * fx) * v.lean;
    v.glider.visible = f.phase === 'drop';
    v.shadow.visible = f.phase === 'ground' || f.y < 25;
    v.shadow.position.y = 0.03 - f.y;
    v.shadow.scale.setScalar(0.85 * (1 + f.y * 0.02));
    // what it holds
    const h = held(f);
    const key = h.w ?? 'spatula';
    for (const [k, g] of v.guns) g.group.visible = k === key && f.phase === 'ground';
    let gun = v.guns.get(key);
    if (!gun && f.phase === 'ground') {
      gun = gunModel(key);
      v.hand.add(gun.group);
      v.guns.set(key, gun);
    }
    if (gun?.stripe) gun.stripe.material = rarity[h.r] ?? rarity[0];
    v.recoil = Math.max(0, v.recoil - dt * 6);
    v.swing = Math.max(0, v.swing - dt * 5);
    v.hand.position.z = 0.48 - v.recoil * 0.18;
    v.hand.rotation.y = key === 'spatula' ? -Math.sin(v.swing * Math.PI) * 1.6 : 0;
    v.hand.rotation.x = key === 'spatula' ? -0.4 : (f.kind === 'remote' ? f.show.flags & F_RELOAD : f.reloadT > 0) ? 0.7 : 0;
    // flash red when hit; the shield and bandage show while in use
    const hit = f.hitT > 0;
    v.skin.emissive.setHex(hit ? 0xff3b30 : 0x000000);
    v.skin.emissiveIntensity = hit ? 0.55 : 0;
    const using = f.kind === 'remote' ? (f.show.flags & F_BANDAGE ? 'bandage' : f.show.flags & F_SHIELDING ? 'shield' : null) : f.using;
    v.heal.visible = using === 'bandage';
    if (v.heal.visible) v.heal.rotation.y = clock * 4;
    v.ring.visible = using === 'shield';
    if (v.ring.visible) {
      v.ring.position.y = 0.4 + ((clock * 1.4) % 1) * 1.3;
      v.ring.scale.setScalar(0.85 - ((clock * 1.4) % 1) * 0.25);
    }
    v.ghost.visible = focus && f.phase === 'ground';
  }

  const view: View = {
    gl,
    camera,
    resize(w, h) {
      width = Math.max(1, w);
      height = Math.max(1, h);
      gl.renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    },
    frame(m, focusId, dt, clock, opts) {
      now = clock;
      const focus = m.fighters[focusId];
      // where to look and how much to show
      let tx = 0;
      let tz = 0;
      let want = OVERVIEW;
      if (!opts.overview && focus) {
        // something high up shows nearer the top of the screen than the ground under it, so look past it a little
        if (focus.phase === 'bus') {
          const p = busAt(map.bus, m.time);
          tx = p.x;
          tz = p.z + BUS_Y / Math.tan(TILT);
          want = BUS_VIEW;
        } else {
          tx = focus.x;
          tz = focus.z + focus.y / Math.tan(TILT);
          const h = held(focus);
          want = focus.phase === 'drop' ? DROP_VIEW + (focus.y / BUS_Y) * 20 : GROUND_VIEW + (h.w ? WEAPONS[h.w].zoom : 0);
        }
      }
      if (!cam.ready) {
        cam.x = tx;
        cam.z = tz;
        cam.view = want;
        cam.ready = true;
      }
      cam.x = damp(cam.x, tx, 9, dt);
      cam.z = damp(cam.z, tz, 9, dt);
      cam.view = damp(cam.view, want, 2.2, dt);
      const aspect = width / height;
      const t = Math.tan(((FOV / 2) * Math.PI) / 180);
      const dist = aspect >= 1 ? cam.view / t : cam.view / (aspect * t);
      shake = Math.max(0, shake - dt * 2.5);
      const jx = (Math.random() - 0.5) * shake;
      const jz = (Math.random() - 0.5) * shake;
      camera.position.set(cam.x + jx, Math.sin(TILT) * dist, cam.z + Math.cos(TILT) * dist + jz);
      camera.lookAt(cam.x + jx, 0, cam.z + jz);
      // haze only far past what's in frame
      fog.near = dist + 80;
      fog.far = dist + 520;

      // the bus flies its route and away
      const busT = m.time;
      bus.visible = busT < map.bus.dur + 6;
      if (bus.visible) {
        const dx = (map.bus.x1 - map.bus.x0) / map.bus.len;
        const dz = (map.bus.z1 - map.bus.z0) / map.bus.len;
        const along = Math.max(0, busT) * (map.bus.len / map.bus.dur);
        bus.position.set(map.bus.x0 + dx * along, BUS_Y + 1.2 + Math.sin(clock * 1.3) * 0.3, map.bus.z0 + dz * along);
        bus.rotation.y = Math.atan2(dx, dz);
      }

      // roofs lift off the building you're in
      const inside = focus && focus.phase === 'ground' ? focus.inside : -1;
      roofs.forEach((r, i) => {
        r.fade = damp(r.fade, i === inside ? 0.08 : 1, 10, dt);
        r.mat.opacity = r.fade;
        r.mat.depthWrite = r.fade > 0.98;
        r.mesh.visible = r.fade > 0.03;
      });

      // the storm
      const s = m.storm;
      const nx = s.next.x;
      const nz = s.next.z;
      if (s.x !== lastStorm.x || s.z !== lastStorm.z || s.r !== lastStorm.r || nx !== lastStorm.nx || nz !== lastStorm.nz || s.next.r !== lastStorm.nr) {
        lastStorm = { x: s.x, z: s.z, r: s.r, nx, nz, nr: s.next.r };
        // the first circle takes in the whole island; the storm shows once it reaches land
        const onLand = s.r < HALF * Math.SQRT2;
        stormWall.visible = s.r > 0.05 && onLand;
        stormWall.position.set(s.x, 44, s.z);
        stormWall.scale.set(Math.max(0.05, s.r), 1, Math.max(0.05, s.r));
        stormTint.position.set(s.x, 0.12, s.z);
        tint.set(Math.max(0, s.r), 700);
        stormTint.visible = onLand;
        const showNext = s.next.r < s.r - 0.5 || s.shrinking;
        nextMesh.visible = showNext && s.next.r > 0.3;
        nextMesh.position.set(nx, 0.14, nz);
        nextRing.set(Math.max(0, s.next.r - 0.22), s.next.r + 0.22);
      }

      placeChests(false);
      placeCrates(clock);
      chestGlowMat.opacity = 0.35 + Math.sin(clock * 4) * 0.2;

      // eggs
      m.fighters.forEach((f, i) => {
        const v = eggs[i];
        if (!v) return;
        const isFocus = i === focusId;
        syncEgg(v, f, dt, clock, isFocus, !isFocus && concealed(m, f, focus));
      });

      // aim line and landing marker
      const me = focus && opts.aimLine ? focus : null;
      const hm = me ? held(me) : null;
      aimLine.visible = !!me && me.phase === 'ground' && !!hm?.w;
      if (aimLine.visible && me && hm?.w) {
        const len = Math.min(WEAPONS[hm.w].range, 26);
        const fx = Math.sin(me.aim);
        const fz = Math.cos(me.aim);
        aimLine.position.set(me.x + fx * (0.9 + len / 2), 0.95, me.z + fz * (0.9 + len / 2));
        aimLine.rotation.set(-Math.PI / 2, 0, me.aim);
        aimLine.scale.set(0.05, len, 1);
      }
      landMark.visible = !!focus && focus.phase === 'drop';
      if (landMark.visible && focus) {
        landMark.position.set(focus.x, 0.1, focus.z);
        landMark.scale.setScalar(1.2 + Math.sin(clock * 6) * 0.15);
      }

      // loot near the camera, once it's close enough to make out (from the sky it's specks)
      const reach = cam.view < 30 ? cam.view + 12 : -1;
      for (const [id, lv] of lootViews) {
        if (!m.loot.has(id)) {
          scene.remove(lv.group);
          lootViews.delete(id);
        }
      }
      for (const l of m.loot.values()) {
        const near = Math.abs(l.x - cam.x) < reach * 1.6 && Math.abs(l.z - cam.z) < reach * 1.6;
        let lv = lootViews.get(l.id);
        if (!near) {
          if (lv) lv.group.visible = false;
          continue;
        }
        if (!lv) {
          lv = lootView(l);
          lootViews.set(l.id, lv);
        }
        lv.group.visible = true;
        lv.model.rotation.y = clock * 1.2 + lv.spin;
        lv.model.position.y = 0.45 + Math.sin(clock * 2.4 + lv.spin) * 0.07;
      }

      // walls
      for (const [id, wv] of wallViews) {
        if (!m.walls.has(id)) {
          scene.remove(wv.mesh);
          wallViews.delete(id);
          burst(wv.mesh.position.x, 1.2, wv.mesh.position.z, 14, 5, 0.18, 0.7, [partMat.wood]);
        }
      }
      for (const w of m.walls.values()) {
        let wv = wallViews.get(w.id);
        if (!wv) {
          const mesh = new THREE.Mesh(wallGeo, wallMat[0]);
          mesh.position.set(w.x, 1.5, w.z);
          mesh.rotation.y = w.a;
          scene.add(mesh);
          wv = { mesh, born: clock };
          wallViews.set(w.id, wv);
        }
        const grow = Math.min(1, (clock - wv.born) / 0.15);
        wv.mesh.scale.y = 0.15 + grow * 0.85;
        wv.mesh.position.y = 1.5 * wv.mesh.scale.y;
        wv.mesh.material = wallMat[w.hp > WALL_HP * 0.66 ? 0 : w.hp > WALL_HP * 0.33 ? 1 : 2];
      }

      // bullets
      let ti = 0;
      let ri = 0;
      for (const b of m.bullets) {
        if (b.w === 'launcher') {
          let r = rockets[ri];
          if (!r) {
            r = new THREE.Mesh(G.egg, M.rocket);
            scene.add(r);
            rockets.push(r);
          }
          ri++;
          r.visible = true;
          r.position.set(b.x, 0.9, b.z);
          // the egg's long axis (+y) laid along the flight
          r.rotation.set(Math.PI / 2, Math.atan2(b.dx, b.dz), 0, 'YXZ');
          r.scale.setScalar(0.3);
          if (Math.random() < 0.6) burst(b.x - b.dx * 0.4, 0.85, b.z - b.dz * 0.4, 1, 0.6, 0.18, 0.5, [partMat.smoke], -1);
          continue;
        }
        if (b.traveled < 0.6) continue;
        let tr = tracers[ti];
        if (!tr) {
          tr = new THREE.Mesh(tracerGeo, M.tracer);
          scene.add(tr);
          tracers.push(tr);
        }
        ti++;
        const len = Math.min(2.4, b.traveled - 0.5);
        tr.visible = true;
        tr.position.set(b.x - (b.dx * len) / 2, 1.0, b.z - (b.dz * len) / 2);
        tr.rotation.set(0, Math.atan2(b.dx, b.dz), 0);
        tr.scale.set(1, 1, len);
      }
      for (let i = ti; i < tracers.length; i++) tracers[i].visible = false;
      for (let i = ri; i < rockets.length; i++) rockets[i].visible = false;

      // effects
      for (const p of parts) {
        if (!p.mesh.visible) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.mesh.visible = false;
          continue;
        }
        p.vy -= p.grav * dt;
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y = Math.max(0.05, p.mesh.position.y + p.vy * dt);
        p.mesh.position.z += p.vz * dt;
        p.mesh.rotation.x += p.spin * dt;
        p.mesh.rotation.z += p.spin * 0.7 * dt;
        p.mesh.scale.setScalar(p.size * Math.min(1, (p.life / p.max) * 2));
      }
      for (const f of flashes) {
        if (!f.mesh.visible) continue;
        f.life -= dt;
        if (f.life <= 0) {
          f.mesh.visible = false;
          continue;
        }
        f.mesh.scale.multiplyScalar(1 + f.grow * dt);
      }
    },
    react(e, m, focus) {
      const near = (x: number, z: number) => Math.abs(x - cam.x) < cam.view * 2.5 && Math.abs(z - cam.z) < cam.view * 2.5;
      switch (e.t) {
        case 'shot': {
          const v = eggs[e.f];
          const f = m.fighters[e.f];
          if (v) v.recoil = 1;
          if (f && near(f.x, f.z) && e.w !== 'launcher') flash(f.x + Math.sin(e.a) * 1.2, 0.95, f.z + Math.cos(e.a) * 1.2, e.w === 'shotgun' ? 0.32 : 0.2, 0.05, 0, flashMat);
          if (e.f === focus) shake = Math.max(shake, e.w === 'sniper' || e.w === 'shotgun' || e.w === 'launcher' ? 0.35 : 0.08);
          break;
        }
        case 'swing': {
          const v = eggs[e.f];
          if (v) v.swing = 1;
          break;
        }
        case 'thud':
          if (!near(e.x, e.z)) break;
          if (e.what === 'egg') burst(e.x, 1, e.z, 4, 3, 0.09, 0.35, [partMat.shell]);
          else if (e.what === 'tree') burst(e.x, 1, e.z, 4, 3, 0.1, 0.4, [partMat.wood, partMat.leaf]);
          else if (e.what === 'rock') burst(e.x, 1, e.z, 4, 3, 0.09, 0.35, [partMat.stone, partMat.dust]);
          else burst(e.x, 1, e.z, 4, 3, 0.1, 0.35, [partMat.wood, partMat.dust]);
          break;
        case 'hit':
          if (near(e.x, e.z)) burst(e.x, 1, e.z, 5, 3.5, 0.1, 0.4, e.shield ? [partMat.purple, partMat.shell] : [partMat.shell, partMat.yolk]);
          break;
        case 'hurt':
          if (e.f === focus) shake = Math.max(shake, e.storm ? 0.12 : 0.35);
          break;
        case 'smash':
          if (!near(e.x, e.z)) break;
          burst(e.x, 1, e.z, 4, 3, 0.12, 0.4, [partMat.wood]);
          if (e.kind === 'crate') crateShake.set(e.id, now);
          break;
        case 'harvest':
          burst(e.x, 1.4, e.z, 6, 3, 0.13, 0.45, [partMat.wood, partMat.leaf]);
          break;
        case 'boom':
          flash(e.x, 1, e.z, 1.2, 0.35, 9, boomMat);
          burst(e.x, 1, e.z, 22, 9, 0.28, 0.9, [partMat.fire, partMat.spark, partMat.smoke]);
          {
            const f = m.fighters[focus];
            if (f && Math.hypot(f.x - e.x, f.z - e.z) < 25) shake = Math.max(shake, 1.1);
          }
          break;
        case 'opened': {
          const c = map.containers[e.c];
          if (c && near(c.x, c.z)) burst(c.x, 1, c.z, c.kind === 'crate' ? 18 : 12, c.kind === 'crate' ? 6 : 4, 0.2, 0.8, c.kind === 'crate' ? [partMat.wood] : [partMat.spark, M.gold]);
          break;
        }
        case 'wall':
          if (near(e.wall.x, e.wall.z)) burst(e.wall.x, 0.3, e.wall.z, 6, 2, 0.16, 0.4, [partMat.dust]);
          break;
        case 'land': {
          const f = m.fighters[e.f];
          if (f && near(f.x, f.z)) burst(f.x, 0.2, f.z, 10, 3, 0.25, 0.5, [partMat.dust], 2);
          break;
        }
        case 'out': {
          const f = m.fighters[e.f];
          if (!f) break;
          // the egg cracks: shell flies, a yolk stays behind
          burst(f.x, 1, f.z, 26, 6, 0.2, 1, [partMat.shell, partMat.shell, partMat.yolk]);
          const yolk = new THREE.Group();
          yolk.position.set(f.x, 0.04, f.z);
          const white = new THREE.Mesh(G.disc, M.eggWhite);
          white.rotation.x = -Math.PI / 2;
          white.scale.set(1.25, 1, 1);
          yolk.add(white);
          const middle = new THREE.Mesh(G.disc, M.yolk);
          middle.rotation.x = -Math.PI / 2;
          middle.position.y = 0.03;
          middle.scale.setScalar(0.5);
          yolk.add(middle);
          for (let i = 0; i < 4; i++) {
            const piece = add(yolk, G.box, M.eggWhite, Math.cos(i * 1.7) * 1.3, 0.1, Math.sin(i * 1.7) * 1.3, 0.35, 0.08, 0.25);
            piece.rotation.set(0.3, i, 0.2);
          }
          puddles.add(yolk);
          if (e.f === focus) shake = 1;
          break;
        }
        case 'took':
        case 'used':
          break;
      }
    },
    project(x, y, z) {
      vec.set(x, y, z).project(camera);
      if (vec.z > 1 || vec.z < -1) return null;
      return { x: ((vec.x + 1) / 2) * width, y: ((1 - vec.y) / 2) * height };
    },
    ground(sx, sy, y = 1) {
      vec.set((sx / width) * 2 - 1, -(sy / height) * 2 + 1, 0.5).unproject(camera);
      vec2.copy(vec).sub(camera.position);
      if (Math.abs(vec2.y) < 1e-6) return null;
      const t = (y - camera.position.y) / vec2.y;
      if (t <= 0) return null;
      return { x: camera.position.x + vec2.x * t, z: camera.position.z + vec2.z * t };
    },
    render() {
      if (!gl.lost()) gl.renderer.render(scene, camera);
    },
    dispose() {
      for (const lv of lootViews.values()) scene.remove(lv.group);
      lootViews.clear();
      disposeTree(scene);
      for (const g of geos) g.dispose();
      for (const x of mats) x.dispose();
      for (const t of textures) t.dispose();
      trunks.dispose();
      crowns.dispose();
      rocks.dispose();
      bushes.dispose();
      crates.dispose();
      chestBase.dispose();
      chestLid.dispose();
      chestGlow.dispose();
      gl.dispose();
    },
  };
  return view;
}
