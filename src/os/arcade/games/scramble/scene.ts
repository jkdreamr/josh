// three.js view of a Scramble match: the island, the eggs, the bus, the storm, loot, walls, bullets, throwables and
// effects. It reads a Match every frame and never changes it. Only classes kit/three-lib.ts exports are used.
import type { T } from './gl';
import { createGL, damp, disposeTree, type GL } from './gl';
import { BARREL_R, BEACH, BRIDGE_HALF, BUSH_R, BUS_Y, CAMP, CHEST_HD, CHEST_HW, CRATE_HALF, FENCE_T, FRIDGE_HD, FRIDGE_HW, HALF, HAY_HD, HAY_HW, LAMP_R, LOG_R, PAD, RIVER_HALF, ROAD_HALF, SUPPLY_FALL, SUPPLY_HALF, TABLE_HD, TABLE_HW, TOILET_R, WALL_T, bridgeAt, busAt, fieldAt, padAt, peekAt, riverDist2, roadAt, type Building, type BuildingKind } from './map';
import { BARREL, CRATE_HP, F_DRINKING, F_HEALING, F_PAN, F_RELOAD, F_SHIELDING, F_SMOOTHIE, F_SPIN, F_TART, HAY_HP, TOILET_HP, WALL_HALF, WALL_HP, WALL_THICK, clearLine, concealed, held, tossAt, viewOf, type Ev, type Fighter, type Held, type LootItem, type Match, type Toss, type Zone } from './logic';
import { MELEE, RARITY_COLORS, THROWS, WEAPONS, isMelee, isThrow, isWeapon, legendary, type LootDef, type UseId } from './items';

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
const BUS_VIEW = 54;
/** The bus is drawn this much bigger than life, so it reads from up high. */
const BUS_SCALE = 1.35;
const OVERVIEW = 150;
/** Loot is drawn while the camera is this close (from higher up it's specks). */
const LOOT_VIEW = 40;
const TILT = (58 * Math.PI) / 180;
const FOV = 42;
const HALF_FOV = ((FOV / 2) * Math.PI) / 180;
/**
 * The ground in frame, per meter the camera stands back: how far it reaches past the point looked at up the screen
 * (north, which the tilt sees farther) and down it, and how wide it gets along the top edge (times the aspect).
 */
const FRAME_N = Math.sin(TILT) / Math.tan(TILT - HALF_FOV) - Math.cos(TILT);
const FRAME_S = Math.cos(TILT) - Math.sin(TILT) / Math.tan(TILT + HALF_FOV);
const FRAME_W = (Math.sin(TILT) * Math.tan(HALF_FOV)) / (Math.sin(TILT) - Math.tan(HALF_FOV) * Math.cos(TILT));
/** three's GreaterDepth constant, by value: three-lib.ts exports classes, not constants. */
const GREATER_DEPTH = 6 as T.DepthModes;

const QUADS = [
  [-1, -1],
  [1, -1],
  [1, 1],
  [-1, 1],
] as const;
const AMMO_COLORS = { light: 0xf2c94c, heavy: 0x6fcf97, shells: 0xeb5757, rockets: 0xbb6bd9 } as const;
const ROOF_COLORS = [0xd0623f, 0x5b84b0, 0x7ea55a, 0xa06b98];
const SHED_ROOFS = [0x6aa69a, 0xa3adb5, 0xc06a40, 0x86a85c];
const WALL_COLORS = [0xf1e6d2, 0xd9c7a8, 0xe8dccb, 0xcfd6dc];
const CONTAINER_COLORS = [0xc0392b, 0x2e86de, 0x27ae60, 0xe67e22, 0x8e44ad];
const WAREHOUSE_COLORS = [0x9aa5b1, 0x8d9aa6, 0xa7b0b8, 0x7f8c97];
/**
 * How each kind dresses its doorways, in colors that stand out from its walls and roof: the door frame, the porch (a
 * loading apron at a warehouse, a stone path through a ruin), the doormat (a warehouse's apron lines), the awning
 * over the door and the board along its front, and the eaves.
 */
const DRESS: Record<BuildingKind, { frame: number; porch: number; mat: number; awning: number; edge: number; trim: number }> = {
  house: { frame: 0x6b4426, porch: 0xb98250, mat: 0xb33c2e, awning: 0xf6eedb, edge: 0xffcf4a, trim: 0xf6eedb },
  farm: { frame: 0xf6f1e4, porch: 0xa8763f, mat: 0x3f6b3a, awning: 0xf6f1e4, edge: 0xffcf4a, trim: 0xf6f1e4 },
  shed: { frame: 0xeadbb5, porch: 0x9a7046, mat: 0x4f7a3a, awning: 0xeadbb5, edge: 0xffcf4a, trim: 0x5a3e24 },
  warehouse: { frame: 0xf2c230, porch: 0xc3c8cc, mat: 0xf2c230, awning: 0xf2b632, edge: 0x2b2d33, trim: 0x59636d },
  container: { frame: 0, porch: 0, mat: 0, awning: 0, edge: 0, trim: 0 },
  ruin: { frame: 0, porch: 0xcfc6b2, mat: 0, awning: 0, edge: 0, trim: 0 },
  coop: { frame: 0xc0392b, porch: 0xd9a441, mat: 0xc0392b, awning: 0xc0392b, edge: 0xffffff, trim: 0xfff1c9 },
  diner: { frame: 0xd64545, porch: 0xc9c3b5, mat: 0x2b2d33, awning: 0xd64545, edge: 0x3fb8af, trim: 0x3fb8af },
  mill: { frame: 0x6b4426, porch: 0xb98250, mat: 0x8a5a2b, awning: 0x7a4a2a, edge: 0xffcf4a, trim: 0xe9e1cf },
};
/** Glow under a pickup, by how good it is (the rarity colors). */
const USE_GLOW: Record<UseId, number> = { bandage: 1, medkit: 2, mini: 2, shield: 3, coffee: 4, smoothie: 3, tart: 4 };
/** How many legendary things on the ground get a gold beam at once (there are rarely more than a handful). */
const BEAMS = 40;
/** A flare climbs this high over this many seconds, then hangs there burning for a few more. */
const FLARE_UP = { y: 15, rise: 2.4, burn: 4 };

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
    [42, 42],
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
    [48, 48],
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

/** Rows of shingles in greys, tinted by the roof's colors; the rows run along u. */
function shingleTexture(THREE: Three) {
  const rnd = scatter(29);
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#7d7d7d';
      g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 16) {
        for (let x = (y / 16) % 2 ? -8 : 0; x < 128; x += 16) {
          const v = 205 + Math.floor(rnd() * 50);
          g.fillStyle = `rgb(${v},${v},${v})`;
          g.fillRect(x + 1, y + 1, 14, 12);
        }
        // the shadow each row casts on the one below
        g.fillStyle = 'rgba(0,0,0,0.22)';
        g.fillRect(0, y + 13, 128, 3);
      }
    }),
    [1, 1],
  );
}

/** Corrugated metal: ribs across u. */
function ribTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(64, 16, (g) => {
      g.fillStyle = '#f2f2f2';
      g.fillRect(0, 0, 64, 16);
      for (let x = 0; x < 64; x += 8) {
        g.fillStyle = '#b4b4b4';
        g.fillRect(x + 5, 0, 2, 16);
        g.fillStyle = '#ffffff';
        g.fillRect(x + 1, 0, 2, 16);
      }
    }),
    [1, 1],
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

function supplyTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#2f7de1';
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#ffd23d';
      g.fillRect(0, 0, 128, 12);
      g.fillRect(0, 116, 128, 12);
      g.fillRect(0, 0, 12, 128);
      g.fillRect(116, 0, 12, 128);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(64, 30);
      g.lineTo(96, 84);
      g.lineTo(32, 84);
      g.closePath();
      g.fill();
      g.fillStyle = '#2f7de1';
      g.fillRect(60, 46, 8, 22);
      g.fillRect(60, 72, 8, 7);
    }),
  );
}

/** Straw: a warm yellow with strands across it. */
function hayTexture(THREE: Three) {
  const rnd = scatter(13);
  return texture(
    THREE,
    canvas(64, 64, (g) => {
      g.fillStyle = '#d9b14a';
      g.fillRect(0, 0, 64, 64);
      for (let i = 0; i < 160; i++) {
        g.strokeStyle = rnd() > 0.5 ? 'rgba(255,240,170,0.5)' : 'rgba(120,80,20,0.35)';
        g.lineWidth = 1;
        const x = rnd() * 64;
        const y = rnd() * 64;
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + (rnd() - 0.5) * 14, y + (rnd() - 0.5) * 6);
        g.stroke();
      }
      // two bands of twine round the bale
      g.fillStyle = 'rgba(110,70,25,0.75)';
      for (const y of [18, 44]) g.fillRect(0, y, 64, 3);
    }),
  );
}

/** Running water: deeper down the middle, paler at the edges, with streaks of light along it (v runs downstream). */
function riverTexture(THREE: Three) {
  const rnd = scatter(41);
  return texture(
    THREE,
    canvas(64, 128, (g) => {
      const grad = g.createLinearGradient(0, 0, 64, 0);
      grad.addColorStop(0, '#8fd8ee');
      grad.addColorStop(0.5, '#2f8fc4');
      grad.addColorStop(1, '#8fd8ee');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 128);
      for (let i = 0; i < 46; i++) {
        g.fillStyle = `rgba(255,255,255,${0.12 + rnd() * 0.28})`;
        g.fillRect(6 + rnd() * 52, rnd() * 128, 1 + rnd() * 1.5, 6 + rnd() * 16);
      }
    }),
    [1, 1],
  );
}

/** Black and white tiles, for the diner's floor. */
function checkTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(64, 64, (g) => {
      for (let y = 0; y < 4; y++)
        for (let x = 0; x < 4; x++) {
          g.fillStyle = (x + y) % 2 ? '#2b2d33' : '#f4f1ea';
          g.fillRect(x * 16, y * 16, 16, 16);
        }
    }),
    [1, 1],
  );
}

/** A diner's sign: a red board with its name in white. */
function signTexture(THREE: Three, text: string) {
  return texture(
    THREE,
    canvas(512, 128, (g) => {
      g.fillStyle = '#d64545';
      g.fillRect(0, 0, 512, 128);
      g.strokeStyle = '#fff6d6';
      g.lineWidth = 8;
      g.strokeRect(10, 10, 492, 108);
      g.fillStyle = '#fff6d6';
      g.font = 'bold 60px sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(text.toUpperCase(), 256, 68, 470);
    }),
  );
}

/**
 * A flat ribbon `half` wide either side of a line on the ground, at height y: u runs across it and v along it, a
 * repeat every `tile` meters.
 */
function ribbon(THREE: Three, pts: { x: number; z: number }[], half: number, y: number, tile: number) {
  const n = pts.length;
  const pos = new Float32Array(n * 6);
  const nor = new Float32Array(n * 6);
  const uv = new Float32Array(n * 4);
  const idx: number[] = [];
  let along = 0;
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    const nx = -(b.z - a.z) / l;
    const nz = (b.x - a.x) / l;
    if (i) along += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    pos.set([pts[i].x + nx * half, y, pts[i].z + nz * half, pts[i].x - nx * half, y, pts[i].z - nz * half], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    uv.set([0, along / tile, 1, along / tile], i * 4);
    if (i) idx.push(i * 2 - 2, i * 2, i * 2 - 1, i * 2 - 1, i * 2, i * 2 + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** A soft round glow, white in the middle and fading out (tinted by the material). */
function glowTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 1, 32, 32, 31);
      grad.addColorStop(0, 'rgba(255,255,255,0.95)');
      grad.addColorStop(0.45, 'rgba(255,255,255,0.45)');
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
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

/** A gable roof `len` long (its ridge along x) and `wide` across, standing on y = 0 and `rise` tall. Flat shaded. */
function gableGeometry(THREE: Three, len: number, wide: number, rise: number) {
  const a = len / 2;
  const b = wide / 2;
  // two slopes and two gable ends, each wound to face out
  const faces = [
    [-a, 0, b, a, 0, b, a, rise, 0],
    [-a, 0, b, a, rise, 0, -a, rise, 0],
    [a, 0, -b, -a, 0, -b, -a, rise, 0],
    [a, 0, -b, -a, rise, 0, a, rise, 0],
    [a, 0, b, a, 0, -b, a, rise, 0],
    [-a, 0, -b, -a, 0, b, -a, rise, 0],
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(faces.flat(), 3));
  g.computeVertexNormals();
  return g;
}

type RoofPart = { g: T.BufferGeometry; c: number };

/**
 * A roof's pieces merged into one geometry with a color per piece, so a whole roof is one draw call and fades as one.
 * Texture coordinates come from where each point sits seen from above, `tile` meters a repeat, u along the ridge.
 */
function mergeRoof(THREE: Three, parts: RoofPart[], tile: number, alongX: boolean) {
  let count = 0;
  for (const p of parts) count += p.g.index ? p.g.index.count : (p.g.attributes.position as T.BufferAttribute).count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const col = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  const c = new THREE.Color();
  let at = 0;
  for (const p of parts) {
    const P = p.g.attributes.position as T.BufferAttribute;
    const N = p.g.attributes.normal as T.BufferAttribute;
    const n = p.g.index ? p.g.index.count : P.count;
    c.setHex(p.c);
    for (let k = 0; k < n; k++) {
      const i = p.g.index ? p.g.index.getX(k) : k;
      const x = P.getX(i);
      const z = P.getZ(i);
      pos.set([x, P.getY(i), z], at * 3);
      nor.set([N.getX(i), N.getY(i), N.getZ(i)], at * 3);
      col.set([c.r, c.g, c.b], at * 3);
      uv[at * 2] = (alongX ? x : z) / tile;
      uv[at * 2 + 1] = (alongX ? z : x) / tile;
      at++;
    }
    p.g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
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

/** A model for something in hand: the group, the stripe in its rarity's color, and a minigun's barrels that spin. */
type HeldModel = { group: T.Group; stripe: T.Mesh | null; spin: T.Object3D | null };

type EggView = {
  root: T.Group;
  body: T.Group;
  skin: T.MeshLambertMaterial;
  hand: T.Group;
  guns: Map<Held, HeldModel>;
  shadow: T.Mesh;
  glider: T.Group;
  heal: T.Group;
  /** The two bars of the cross over the head while healing (gold for a golden egg tart). */
  cross: T.Mesh[];
  ring: T.Mesh;
  ghost: T.Mesh;
  backPan: T.Group;
  /** The party hat, hidden under a helmet. */
  hat: T.Mesh[];
  /** The helmet and vest it wears, rebuilt when the level changes. */
  helmet: T.Group | null;
  helmetLv: number;
  vest: T.Group | null;
  vestLv: number;
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
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 1200);
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
  const instanced: T.InstancedMesh[] = [];
  const lambert = (color: number, extra: Partial<T.MeshLambertMaterialParameters> = {}) => mat(new THREE.MeshLambertMaterial({ color, ...extra }));
  const basic = (color: number, extra: Partial<T.MeshBasicMaterialParameters> = {}) => mat(new THREE.MeshBasicMaterial({ color, ...extra }));
  const many = (g: T.BufferGeometry, material: T.Material, count: number) => {
    const im = new THREE.InstancedMesh(g, material, Math.max(1, count));
    if (count === 0) im.visible = false;
    instanced.push(im);
    return im;
  };

  const G = {
    box: geo(new THREE.BoxGeometry(1, 1, 1)),
    ball: geo(new THREE.SphereGeometry(1, 12, 9)),
    lowBall: geo(new THREE.SphereGeometry(1, 7, 5)),
    rock: geo(new THREE.SphereGeometry(1, 6, 4)),
    cyl: geo(new THREE.CylinderGeometry(1, 1, 1, 12)),
    cone: geo(new THREE.ConeGeometry(1, 1, 12, 1, true)),
    pine: geo(new THREE.ConeGeometry(1, 1, 8)),
    stalk: geo(new THREE.ConeGeometry(0.15, 2.3, 5)),
    egg: geo(eggGeometry(THREE)),
    cap: geo(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2)),
    band: geo(new THREE.TorusGeometry(1, 0.12, 6, 24)),
    wire: geo(new THREE.TorusGeometry(1, 0.06, 4, 16)),
    disc: geo(new THREE.CircleGeometry(1, 24)),
    bigDisc: geo(new THREE.CircleGeometry(1, 48)),
    plane: geo(new THREE.PlaneGeometry(1, 1)),
    ring: geo(new THREE.RingGeometry(0.72, 1, 28)),
    // the curved front of an apron: a strip of a cylinder, open top and bottom, facing +z
    apron: geo(new THREE.CylinderGeometry(1, 1, 1, 10, 1, true, -0.95, 1.9)),
  };
  const blob = keep(blobTexture(THREE));
  const M = {
    shadow: basic(0x000000, { map: blob, transparent: true, depthWrite: false }),
    dark: lambert(0x2b2d33),
    metal: lambert(0x5b616b),
    steel: lambert(0xc9d0d8),
    wood: lambert(0x8a5a2b),
    tan: lambert(0xb89a6a),
    olive: lambert(0x5d6b3a),
    cream: lambert(0xfff3df),
    white: lambert(0xffffff),
    black: basic(0x15161a),
    red: lambert(0xe53935),
    green: basic(0x3fd17a),
    blue: basic(0x4aa8ff, { transparent: true, opacity: 0.55, depthWrite: false }),
    orange: basic(0xff9f43, { transparent: true, opacity: 0.6, depthWrite: false }),
    gold: lambert(0xffc83d, { emissive: 0x6a4a00 }),
    tracer: basic(0xfff1a8),
    bolt: basic(0x8a5a2b),
    rocket: lambert(0xfffaf0),
    flash: basic(0xffe27a, { transparent: true, opacity: 0.9, depthWrite: false }),
    aim: basic(0xffffff, { transparent: true, opacity: 0.32, depthWrite: false }),
    // your egg's outline wherever something stands in front of it (a roof, a tree): a slightly bigger egg drawn only
    // where the depth buffer already holds something nearer
    ghost: basic(0xffffff, { transparent: true, opacity: 0.38, depthWrite: false, depthFunc: GREATER_DEPTH }),
    launcher: lambert(0x5a7a3a),
    potion: lambert(0x3f8cff, { emissive: 0x0b2a66 }),
    mini: lambert(0x6fb6ff, { emissive: 0x0b2a66 }),
    coffee: lambert(0x7a4a2a),
    yolk: lambert(0xffc93c, { emissive: 0x4a3000 }),
    eggWhite: lambert(0xfffbf2),
    spatula: lambert(0xd8dde3),
    pan: lambert(0x23252b),
    grenade: lambert(0x5f8f3a),
    flour: lambert(0xf3eee2),
    sauce: lambert(0xd2321e, { emissive: 0x3a0800 }),
    leaf: lambert(0x3f9a4a),
    flare: lambert(0xff7a2f, { emissive: 0x3a1000 }),
    jam: lambert(0xa3214a, { emissive: 0x2a0010 }),
    impulse: lambert(0x4aa8ff, { emissive: 0x0b2a66 }),
    smoothie: lambert(0xff6fa8, { emissive: 0x3a0a20 }),
    crust: lambert(0xd9952b),
    custard: lambert(0xffd23d, { emissive: 0x5a3a00 }),
    straw: lambert(0x4aa8ff),
    pink: basic(0xff6fa8, { transparent: true, opacity: 0.6, depthWrite: false }),
    glass: lambert(0xd8eef5, { transparent: true, opacity: 0.75 }),
    goldCross: basic(0xffd23d),
  };
  const rarity = RARITY_COLORS.map((c) => lambert(parseInt(c.slice(1), 16), { emissive: parseInt(c.slice(1), 16), emissiveIntensity: 0.25 }));
  // armor in its level's color (uncommon, rare, epic), two-sided for the open curve of an apron
  const armorMat = [0, 1, 2, 3].map((lv) => lambert(parseInt(RARITY_COLORS[Math.min(4, lv + 1)].slice(1), 16), { emissive: parseInt(RARITY_COLORS[Math.min(4, lv + 1)].slice(1), 16), emissiveIntensity: 0.2, side: THREE.DoubleSide }));
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

  const sea = new THREE.Mesh(geo(new THREE.PlaneGeometry(2400, 2400)), lambert(water));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.7;
  scene.add(sea);
  const shore = new THREE.Mesh(geo(new THREE.PlaneGeometry(2 * HALF + 14, 2 * HALF + 14)), basic(0x8fd3ee, { transparent: true, opacity: 0.6, depthWrite: false }));
  shore.rotation.x = -Math.PI / 2;
  shore.position.y = -0.62;
  scene.add(shore);
  const sandTex = keep(sandTexture(THREE));
  const block = new THREE.Mesh(geo(new THREE.BoxGeometry(2 * HALF, 1.3, 2 * HALF)), lambert(0xe9d7a6, { map: sandTex }));
  block.position.y = -0.65;
  scene.add(block);
  const grass = new THREE.Mesh(geo(new THREE.PlaneGeometry(2 * (HALF - BEACH), 2 * (HALF - BEACH))), lambert(0xffffff, { map: keep(grassTexture(THREE)) }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.005;
  scene.add(grass);

  // ponds: a sandy rim, the water, and a few lily pads
  const pondWater = lambert(0x4cb3dc, { transparent: true, opacity: 0.88, emissive: 0x0b3a52 });
  const rimMat = lambert(0xd8c690);
  const padMat = lambert(0x4f9a3c);
  for (const p of map.ponds) {
    const rim = new THREE.Mesh(G.bigDisc, rimMat);
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(p.x, 0.012, p.z);
    rim.scale.setScalar(p.r + 1.1);
    scene.add(rim);
    const pool = new THREE.Mesh(G.bigDisc, pondWater);
    pool.rotation.x = -Math.PI / 2;
    pool.position.set(p.x, 0.03, p.z);
    pool.scale.setScalar(p.r);
    scene.add(pool);
    const rnd = scatter(Math.round(p.x * 31 + p.z * 7) >>> 0);
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const d = p.r * (0.3 + rnd() * 0.55);
      const pad = new THREE.Mesh(G.disc, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(p.x + Math.cos(a) * d, 0.05, p.z + Math.sin(a) * d);
      pad.scale.setScalar(0.45 + rnd() * 0.3);
      scene.add(pad);
    }
  }

  // cornfields: a patch of tilled earth and rows of tall stalks
  const soilMat = lambert(0x8a6a3a);
  const stalkSpots: { x: number; z: number }[] = [];
  const cornRnd = scatter(23);
  for (const f of map.fields) {
    const soil = new THREE.Mesh(G.plane, soilMat);
    soil.rotation.x = -Math.PI / 2;
    soil.position.set(f.x, 0.015, f.z);
    soil.scale.set(f.hw * 2, f.hd * 2, 1);
    scene.add(soil);
    for (let x = f.x - f.hw + 0.5; x <= f.x + f.hw - 0.4; x += 0.9) for (let z = f.z - f.hd + 0.5; z <= f.z + f.hd - 0.4; z += 0.8) stalkSpots.push({ x: x + (cornRnd() - 0.5) * 0.35, z: z + (cornRnd() - 0.5) * 0.3 });
  }
  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  const shade = (rnd: () => number, base: number, spread: number) => color.setHex(base).offsetHSL((rnd() - 0.5) * spread * 0.2, 0, (rnd() - 0.5) * spread * 0.2);
  const stalks = many(G.stalk, lambert(0xffffff, { flatShading: true }), stalkSpots.length);
  stalkSpots.forEach((p, i) => {
    dummy.position.set(p.x, 1.15, p.z);
    dummy.rotation.set((cornRnd() - 0.5) * 0.16, cornRnd() * 6, (cornRnd() - 0.5) * 0.16);
    dummy.scale.set(1, 0.85 + cornRnd() * 0.3, 1);
    dummy.updateMatrix();
    stalks.setMatrixAt(i, dummy.matrix);
    stalks.setColorAt(i, shade(cornRnd, cornRnd() < 0.3 ? 0xc9b245 : 0x7fa83a, 1));
  });
  scene.add(stalks);

  // the river: muddy banks, then the water, its streaks drifting downstream (the line drawn a little smoother than
  // the one the game wades through, which is near enough)
  const riverLine = map.river.length ? [map.river[0]] : [];
  for (let i = 1; i < map.river.length; i++) {
    const a = map.river[i - 1];
    const b = map.river[i];
    riverLine.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  if (map.river.length) riverLine.push(map.river[map.river.length - 1]);
  const riverTex = keep(riverTexture(THREE));
  if (riverLine.length > 1) {
    const banks = new THREE.Mesh(geo(ribbon(THREE, riverLine, RIVER_HALF + 1.3, 0.012, 8)), lambert(0xc9b98a, { side: THREE.DoubleSide }));
    const flow = new THREE.Mesh(geo(ribbon(THREE, riverLine, RIVER_HALF + 0.1, 0.034, 9)), lambert(0xffffff, { map: riverTex, emissive: 0x0b3a52, side: THREE.DoubleSide }));
    scene.add(banks, flow);
  }

  // buildings: a floor, walls, and at every doorway a frame, a porch with a lamp and an awning, so the ways in read
  // from the ground and from the sky. All but the ruins have a roof that lifts away while you're inside and thins
  // while you stand at a door or line up with one, so you can peek in.
  const floorTex = keep(planksTexture(THREE, '#c9935a', '#9c6b3a', [1, 1]));
  const checks = keep(checkTexture(THREE));
  const shingles = keep(shingleTexture(THREE));
  const ribs = keep(ribTexture(THREE));
  const concrete = lambert(0x9aa1a6);
  const dirt = lambert(0xb9ad93);
  // a shipping container is dark inside, so its open end shows from afar
  const hold = lambert(0x3a3e44);
  const wallColor = (b: Building, rnd: () => number) => {
    switch (b.kind) {
      case 'house':
        return color.setHex(WALL_COLORS[b.look % WALL_COLORS.length]);
      case 'farm':
        return color.setHex(0xb5432f);
      case 'shed':
        return color.setHex(0x9c6b3a);
      case 'warehouse':
        return color.setHex(WAREHOUSE_COLORS[b.look % WAREHOUSE_COLORS.length]);
      case 'container':
        return color.setHex(CONTAINER_COLORS[b.look % CONTAINER_COLORS.length]);
      case 'ruin':
        return shade(rnd, 0xa39e93, 0.7);
      case 'coop':
        return color.setHex(0xfff1c9);
      case 'diner':
        return color.setHex(0xeef6f4);
      case 'mill':
        return color.setHex(0xe9e1cf);
    }
  };
  const roofColor = (b: Building) => {
    switch (b.kind) {
      case 'farm':
        return 0x5d7766;
      case 'shed':
        return SHED_ROOFS[b.look % SHED_ROOFS.length];
      case 'warehouse':
        return 0x8a98a5;
      case 'container':
        return CONTAINER_COLORS[b.look % CONTAINER_COLORS.length];
      case 'coop':
        return 0xffc21a;
      case 'diner':
        return 0xd64545;
      case 'mill':
        return 0x7a4a2a;
      default:
        return ROOF_COLORS[b.look % ROOF_COLORS.length];
    }
  };
  const darker = (hex: number, k: number) => color.setHex(hex).multiplyScalar(k).getHex();
  const wallCount = map.buildings.reduce((n, b) => n + b.walls.length, 0);
  const buildingWalls = many(G.box, lambert(0xffffff), wallCount);
  const wallRnd = scatter(17);
  const doorRnd = scatter(31);
  let wi = 0;
  const roofs: { mesh: T.Mesh; mats: T.MeshLambertMaterial[]; fade: number; at: number }[] = [];
  const sails: T.Mesh[] = [];
  // door frames, porches, mats, paving and container doors, all one instanced mesh; lamps another
  const bits: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; c: number }[] = [];
  const lamps: { x: number; y: number; z: number; sx: number; sz: number }[] = [];
  map.buildings.forEach((b, bi) => {
    const floorMat =
      b.kind === 'container'
        ? hold
        : b.kind === 'warehouse'
          ? concrete
          : b.kind === 'ruin'
            ? dirt
            : (() => {
                const tex = keep((b.kind === 'diner' ? checks : floorTex).clone());
                tex.repeat.set(b.w / 4, b.d / 4);
                tex.wrapS = THREE.RepeatWrapping;
                tex.wrapT = THREE.RepeatWrapping;
                tex.needsUpdate = true;
                return lambert(0xffffff, { map: tex });
              })();
    const floor = new THREE.Mesh(G.plane, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(b.x, 0.02, b.z);
    floor.scale.set(b.w, b.d, 1);
    scene.add(floor);
    for (const w of b.walls) {
      dummy.position.set(w.x, b.h / 2, w.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w.hw * 2, b.h, w.hd * 2);
      dummy.updateMatrix();
      buildingWalls.setMatrixAt(wi, dummy.matrix);
      buildingWalls.setColorAt(wi, wallColor(b, wallRnd));
      wi++;
    }

    const s = DRESS[b.kind];
    const paint = b.kind === 'container' ? CONTAINER_COLORS[b.look % CONTAINER_COLORS.length] : 0;
    for (const d of b.doors) {
      // a door's own axes: `o` out through it, `l` along the wall
      const ax = Math.abs(d.oz);
      const az = Math.abs(d.ox);
      const put = (o: number, l: number, y: number, so: number, sl: number, sy: number, c: number) =>
        bits.push({ x: d.x + d.ox * o + ax * l, y, z: d.z + d.oz * o + az * l, sx: d.ox ? so : sl, sy, sz: d.ox ? sl : so, ry: 0, c });
      const half = d.w / 2;
      if (b.kind === 'ruin') {
        // broken walls: a worn stone path through the gap
        put(0, 0, 0.03, WALL_T + 1.4, d.w + 0.2, 0.06, shade(doorRnd, s.porch, 0.5).getHex());
        continue;
      }
      if (b.kind === 'container') {
        // a dark frame round the open end, both doors swung wide, and a dark lining inside
        const frame = darker(paint, 0.45);
        for (const k of [-1, 1]) put(0.1, k * (half + 0.14), b.h / 2, 0.32, 0.32, b.h, frame);
        put(0.1, 0, b.h - 0.18, 0.32, d.w + 0.6, 0.36, frame);
        const long = d.ox ? b.w : b.d;
        const short = d.ox ? b.d : b.w;
        put(-long + WALL_T / 2 + 0.03, 0, b.h / 2, 0.04, short - WALL_T, b.h - 0.06, 0x1d2025);
        for (const k of [-1, 1]) put(-long / 2 + WALL_T / 4, k * (short / 2 - WALL_T / 2 - 0.03), b.h / 2, long - WALL_T / 2, 0.04, b.h - 0.06, 0x1d2025);
        // each door hinged at its corner and swung out past square
        const leaf = half + 0.25;
        for (const k of [-1, 1]) {
          const wx = d.ox * Math.sin(2.3) - ax * k * Math.cos(2.3);
          const wz = d.oz * Math.sin(2.3) - az * k * Math.cos(2.3);
          const hx = d.x + d.ox * (WALL_T / 2) + ax * k * leaf;
          const hz = d.z + d.oz * (WALL_T / 2) + az * k * leaf;
          bits.push({ x: hx + (wx * leaf) / 2, y: b.h / 2, z: hz + (wz * leaf) / 2, sx: leaf - 0.04, sy: b.h - 0.12, sz: 0.07, ry: Math.atan2(-wz, wx), c: darker(paint, 0.8) });
        }
        continue;
      }
      // posts and a lintel in a color that stands out from the walls, a lamp beside the door (on the side toward the
      // middle of the wall), and a step out onto a porch with a mat (a loading apron at a warehouse)
      const t = WALL_T + 0.14;
      for (const k of [-1, 1]) put(0, k * (half + 0.15), b.h / 2, t, 0.3, b.h, s.frame);
      put(0, 0, b.h - 0.25, t, d.w + 0.6, 0.5, s.frame);
      put(0, 0, 0.035, WALL_T + 0.02, d.w, 0.07, s.porch);
      const toward = (b.x - d.x) * ax + (b.z - d.z) * az >= 0 ? 1 : -1;
      const lamp = { o: WALL_T / 2 + 0.08, l: toward * (half + 0.6) };
      lamps.push({ x: d.x + d.ox * lamp.o + ax * lamp.l, y: Math.min(b.h - 0.8, 2.4), z: d.z + d.oz * lamp.o + az * lamp.l, sx: d.ox ? 0.14 : 0.24, sz: d.ox ? 0.24 : 0.14 });
      if (b.kind === 'warehouse') {
        put(WALL_T / 2 + 1.3, 0, 0.04, 2.6, d.w + 1.6, 0.08, s.porch);
        for (const k of [-1, 1]) put(WALL_T / 2 + 1.3, k * (half + 0.5), 0.085, 2.6, 0.2, 0.02, s.mat);
        continue;
      }
      put(WALL_T / 2 + 0.75, 0, 0.06, 1.5, d.w + 1.2, 0.12, s.porch);
      put(WALL_T / 2 + 0.6, 0, 0.13, 0.75, Math.min(d.w * 0.62, 1.9), 0.03, s.mat);
      // a couple of stepping stones lead off the porch
      for (const o of [2.2, 3.05]) put(WALL_T / 2 + o, (doorRnd() - 0.5) * 0.5, 0.03, 0.6, 0.85, 0.06, shade(doorRnd, 0xcbc3ae, 0.5).getHex());
    }

    if (!b.roof) return;
    // the roof: one merged mesh of eaves, a gable (flat on a container), a ridge cap and something over each door
    const parts: RoofPart[] = [];
    const piece = (g: T.BufferGeometry, x: number, y: number, z: number, c: number, turn = 0) => {
      if (turn) g.rotateY(turn);
      g.translate(x, y, z);
      parts.push({ g, c });
    };
    const rc = roofColor(b);
    const alongX = b.w >= b.d;
    const over = b.kind === 'container' ? 0.06 : b.kind === 'warehouse' ? 0.2 : 0.45;
    const W = b.w + 2 * over;
    const D = b.d + 2 * over;
    let top = 0.2;
    if (b.kind === 'container') piece(new THREE.BoxGeometry(W, 0.2, D), 0, 0.1, 0, rc);
    else {
      piece(new THREE.BoxGeometry(W, 0.2, D), 0, 0.1, 0, s.trim);
      const rise = b.kind === 'warehouse' ? 0.9 : b.kind === 'mill' ? 4.6 : Math.min(1.6, (alongX ? D : W) * 0.16);
      if (b.kind === 'mill') {
        // a windmill's cap is a tall pyramid with a knob on top
        piece(new THREE.ConeGeometry(W * Math.SQRT1_2, rise, 4), 0, 0.2 + rise / 2, 0, rc, Math.PI / 4);
        piece(new THREE.SphereGeometry(0.35, 6, 4), 0, 0.3 + rise, 0, s.edge);
      } else {
        piece(gableGeometry(THREE, alongX ? W : D, alongX ? D : W, rise), 0, 0.2, 0, rc, alongX ? 0 : Math.PI / 2);
        piece(new THREE.BoxGeometry(alongX ? W + 0.06 : 0.36, 0.16, alongX ? 0.36 : D + 0.06), 0, 0.2 + rise, 0, darker(rc, 0.62));
      }
      // a long vent along a warehouse's ridge
      if (b.kind === 'warehouse') piece(new THREE.BoxGeometry(alongX ? W * 0.7 : 1.3, 0.36, alongX ? 1.3 : D * 0.7), 0, 0.3 + rise, 0, 0xd5dbe0);
      top = 0.2 + rise;
    }
    for (const d of b.doors) {
      const rx = d.x - b.x;
      const rz = d.z - b.z;
      // turns +x to point out through the door
      const turn = Math.atan2(-d.oz, d.ox);
      if (b.kind === 'container') {
        // a yellow band across the roof at the open end
        piece(new THREE.BoxGeometry(0.55, 0.06, d.w + 0.6), rx - d.ox * 0.3, 0.23, rz - d.oz * 0.3, 0xf2c94c, turn);
      } else if (b.kind === 'warehouse') {
        // a flat canopy, yellow with a dark edge
        piece(new THREE.BoxGeometry(2.6, 0.16, d.w + 1), rx + d.ox * 1.3, -0.4, rz + d.oz * 1.3, s.awning, turn);
        piece(new THREE.BoxGeometry(0.12, 0.26, d.w + 1.04), rx + d.ox * 2.6, -0.4, rz + d.oz * 2.6, s.edge, turn);
      } else {
        // a little gable poking out past the eaves, with a bright board along its front
        piece(gableGeometry(THREE, 2.4, d.w + 1, 0.75), rx + d.ox * 0.9, -0.35, rz + d.oz * 0.9, s.awning, turn);
        piece(new THREE.BoxGeometry(0.1, 0.18, d.w + 1.06), rx + d.ox * 2.1, -0.28, rz + d.oz * 2.1, s.edge, turn);
      }
    }
    const special = b.kind === 'coop';
    const ribbed = b.kind === 'container' || b.kind === 'warehouse' || b.kind === 'shed';
    const roofMat = lambert(0xffffff, { vertexColors: true, map: ribbed ? ribs : shingles, transparent: true, opacity: 1, ...(special ? { emissive: 0x3a2800 } : {}) });
    const roof = new THREE.Mesh(geo(mergeRoof(THREE, parts, 2.4, alongX)), roofMat);
    roof.position.set(b.x, b.h, b.z);
    scene.add(roof);
    const mats = [roofMat];
    if (special) {
      // a golden egg on top, so the Golden Coop stands out from anywhere (it lifts away with the roof)
      const eggMat = lambert(0xffc83d, { emissive: 0x6a4a00, transparent: true, opacity: 1 });
      const egg = new THREE.Mesh(G.egg, eggMat);
      egg.position.set(0, top - 0.3, 0);
      egg.scale.set(1.6, 1.5, 1.6);
      roof.add(egg);
      mats.push(eggMat);
    }
    if (b.kind === 'diner') {
      // the sign along the ridge, readable from the south, and again from the north
      const name = map.places.find((p) => Math.hypot(p.x - b.x, p.z - b.z) < p.r)?.name ?? 'Diner';
      const signMat = lambert(0xffffff, { map: keep(signTexture(THREE, name)), transparent: true, opacity: 1, side: THREE.DoubleSide, emissive: 0x330000 });
      const sign = new THREE.Mesh(G.plane, signMat);
      sign.position.set(0, top + 1.1, 0);
      sign.scale.set(8, 2, 1);
      roof.add(sign);
      mats.push(signMat);
    }
    if (b.kind === 'mill') {
      // four sails on a hub high on the south face, turned to the camera so they always show, turning in the wind
      // (one merged mesh)
      const parts: RoofPart[] = [];
      const hubG = new THREE.CylinderGeometry(0.35, 0.35, 0.5, 10);
      hubG.rotateX(Math.PI / 2);
      parts.push({ g: hubG, c: 0x6b4426 });
      for (let k = 0; k < 4; k++) {
        const spar = new THREE.BoxGeometry(0.16, 5.6, 0.12);
        spar.translate(0, 2.9, 0.1);
        spar.rotateZ((k * Math.PI) / 2);
        const sail = new THREE.BoxGeometry(0.9, 4.2, 0.05);
        sail.translate(0.5, 3.3, 0.12);
        sail.rotateZ((k * Math.PI) / 2);
        parts.push({ g: spar, c: 0x6b4426 }, { g: sail, c: 0xf3eee2 });
      }
      const sailMat = lambert(0xffffff, { vertexColors: true, transparent: true, opacity: 1 });
      const turn = new THREE.Mesh(geo(mergeRoof(THREE, parts, 1, true)), sailMat);
      turn.position.set(0, 1.4, b.d / 2 + over + 0.2);
      roof.add(turn);
      mats.push(sailMat);
      sails.push(turn);
    }
    roofs.push({ mesh: roof, mats, fade: 1, at: bi });
  });
  scene.add(buildingWalls);
  const doorBits = many(G.box, lambert(0xffffff), bits.length);
  bits.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.ry, 0);
    dummy.scale.set(p.sx, p.sy, p.sz);
    dummy.updateMatrix();
    doorBits.setMatrixAt(i, dummy.matrix);
    doorBits.setColorAt(i, color.setHex(p.c));
  });
  const doorLamps = many(G.box, basic(0xffe9a3), lamps.length);
  lamps.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(p.sx, 0.32, p.sz);
    dummy.updateMatrix();
    doorLamps.setMatrixAt(i, dummy.matrix);
  });
  scene.add(doorBits, doorLamps);

  // trees: oaks (a trunk and two round crowns), pines (two cones), birches (a white trunk with dark marks and a pale
  // narrow crown) and fruit trees (one round crown hung with fruit)
  const treeRnd = scatter(3);
  const count = (k: string) => map.trees.filter((t) => t.kind === k).length;
  const trunks = many(geo(new THREE.CylinderGeometry(0.32, 0.48, 1, 7)), lambert(0xffffff), map.trees.length);
  const crowns = many(G.lowBall, lambert(0xffffff, { flatShading: true }), count('oak') * 2 + count('birch') * 2 + count('fruit'));
  const cones = many(G.pine, lambert(0xffffff, { flatShading: true }), count('pine') * 2);
  const marks = many(G.box, lambert(0x2b2d33), count('birch') * 3);
  const FRUIT = 6;
  const fruits = many(geo(new THREE.SphereGeometry(1, 5, 3)), lambert(0xffffff, { emissive: 0x220800 }), count('fruit') * FRUIT);
  const FRUIT_COLORS = [0xe53935, 0xff9f1c, 0xffd23d];
  let ci = 0;
  let pi = 0;
  let mi = 0;
  let fi = 0;
  const crown = (x: number, y: number, z: number, sx: number, sy: number, base: number, spread: number) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, treeRnd() * 6, 0);
    dummy.scale.set(sx, sy, sx);
    dummy.updateMatrix();
    crowns.setMatrixAt(ci, dummy.matrix);
    crowns.setColorAt(ci++, shade(treeRnd, base, spread));
  };
  map.trees.forEach((t, i) => {
    const birch = t.kind === 'birch';
    dummy.position.set(t.x, birch ? 2 : 1.6, t.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(birch ? 0.62 : 1, birch ? 4 : 3.2, birch ? 0.62 : 1);
    dummy.updateMatrix();
    trunks.setMatrixAt(i, dummy.matrix);
    trunks.setColorAt(i, color.setHex(birch ? 0xf1ede2 : 0x8a6240));
    if (t.kind === 'pine') {
      const big = 1.9 + treeRnd() * 0.5;
      dummy.position.set(t.x, 3.6, t.z);
      dummy.rotation.set(0, treeRnd() * 6, 0);
      dummy.scale.set(big, 3.2, big);
      dummy.updateMatrix();
      cones.setMatrixAt(pi, dummy.matrix);
      // a light touch: dark greens go black with much jitter
      cones.setColorAt(pi++, shade(treeRnd, 0x2f7a3e, 0.3));
      dummy.position.set(t.x, 5.3, t.z);
      dummy.scale.set(big * 0.7, 2.6, big * 0.7);
      dummy.updateMatrix();
      cones.setMatrixAt(pi, dummy.matrix);
      cones.setColorAt(pi++, shade(treeRnd, 0x3f8a4a, 0.3));
      return;
    }
    if (birch) {
      for (const y of [1.1, 2.1, 3.1]) {
        dummy.position.set(t.x, y + treeRnd() * 0.3, t.z);
        dummy.rotation.set(0, treeRnd() * 6, 0);
        dummy.scale.set(0.42, 0.07, 0.42);
        dummy.updateMatrix();
        marks.setMatrixAt(mi++, dummy.matrix);
      }
      const big = 1.3 + treeRnd() * 0.3;
      crown(t.x, 4.6, t.z, big, big * 1.25, 0x9cc95a, 0.6);
      crown(t.x + (treeRnd() - 0.5) * 0.5, 5.8, t.z + (treeRnd() - 0.5) * 0.5, big * 0.7, big * 0.85, 0xb3d66a, 0.6);
      return;
    }
    const big = 1.7 + treeRnd() * 0.5;
    if (t.kind === 'fruit') {
      crown(t.x, 3.9, t.z, big, big * 0.85, 0x4ea83f, 0.6);
      const fruit = FRUIT_COLORS[Math.floor(treeRnd() * FRUIT_COLORS.length)];
      // fruit round the crown's lower half, where you'd see it from above and from the side
      for (let k = 0; k < FRUIT; k++) {
        const a = (k / FRUIT) * Math.PI * 2 + treeRnd();
        const y = 3.4 + treeRnd() * 1.1;
        const r = big * Math.sqrt(Math.max(0.15, 1 - ((y - 3.9) / (big * 0.85)) ** 2)) * 0.98;
        dummy.position.set(t.x + Math.sin(a) * r, y, t.z + Math.cos(a) * r);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.setScalar(0.2);
        dummy.updateMatrix();
        fruits.setMatrixAt(fi, dummy.matrix);
        fruits.setColorAt(fi++, color.setHex(fruit));
      }
      return;
    }
    crown(t.x, 3.7, t.z, big, big * 0.9, 0x3f8f3a, 1);
    crown(t.x + (treeRnd() - 0.5) * 0.6, 4.9, t.z + (treeRnd() - 0.5) * 0.6, big * 0.68, big * 0.62, 0x56a648, 1);
  });
  scene.add(trunks, crowns, cones, marks, fruits);


  const rocks = many(G.rock, lambert(0xffffff, { flatShading: true }), map.rocks.length);
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
  const bushes = many(geo(new THREE.SphereGeometry(1, 9, 7)), lambert(0xffffff, { flatShading: true }), map.bushes.length);
  map.bushes.forEach((b, i) => {
    dummy.position.set(b.x, 0.95, b.z);
    dummy.rotation.set(0, bushRnd() * 6, 0);
    dummy.scale.set(BUSH_R, 1.35, BUSH_R);
    dummy.updateMatrix();
    bushes.setMatrixAt(i, dummy.matrix);
    bushes.setColorAt(i, shade(bushRnd, 0x4c9b3c, 0.8));
  });
  scene.add(bushes);

  // crates break; chests open; barrels go up
  const crateList = map.containers.filter((c) => c.kind === 'crate');
  const chestList = map.containers.filter((c) => c.kind === 'chest');
  const barrelList = map.containers.filter((c) => c.kind === 'barrel');
  const crates = many(G.box, lambert(0xffffff, { map: keep(crateTexture(THREE)) }), crateList.length);
  const crateShake = new Map<number, number>();
  const chestBase = many(G.box, lambert(0xffffff), chestList.length);
  const chestLid = many(G.box, lambert(0xffffff), chestList.length);
  const chestGlowMat = basic(0xffd75e, { transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const chestGlow = many(G.ring, chestGlowMat, chestList.length);
  const barrels = many(G.cyl, lambert(0xffffff), barrelList.length);
  const barrelBands = many(G.cyl, lambert(0xf2c94c), barrelList.length * 2);
  scene.add(crates, chestBase, chestLid, chestGlow, barrels, barrelBands);
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
      // the Golden Coop's chest is golden with a white lid
      chestBase.setColorAt(i, color.setHex(open ? 0x8a6a2a : c.gold ? 0xffd23d : 0xd99a2b));
      if (open) {
        dummy.position.set(c.x, 0.85, c.z - c.face * CHEST_HD * 0.95);
        dummy.rotation.set(c.face * -1.2, 0, 0);
      } else dummy.position.set(c.x, 0.78, c.z);
      dummy.scale.set(CHEST_HW * 2.06, 0.3, CHEST_HD * 2.06);
      dummy.updateMatrix();
      chestLid.setMatrixAt(i, dummy.matrix);
      chestLid.setColorAt(i, color.setHex(open ? 0x7a5a22 : c.gold ? 0xfff6dc : 0xffc83d));
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.position.set(c.x, 0.04, c.z);
      dummy.scale.setScalar(open ? 0 : c.gold ? 2.1 : 1.5);
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
    barrelList.forEach((c, i) => {
      const gone = m.opened[c.id];
      const shake = crateShake.get(c.id) ?? -9;
      const jiggle = clock - shake < 0.18 ? Math.sin((clock - shake) * 80) * 0.05 : 0;
      dummy.rotation.set(0, 0, jiggle);
      dummy.position.set(c.x, 0.6, c.z);
      dummy.scale.set(gone ? 0 : BARREL_R, gone ? 0 : 1.2, gone ? 0 : BARREL_R);
      dummy.updateMatrix();
      barrels.setMatrixAt(i, dummy.matrix);
      // redder as it takes damage, so a hurt barrel looks ready to go
      const hp = Math.max(0, m.crateHp[c.id] / BARREL.hp);
      barrels.setColorAt(i, color.setRGB(0.85, 0.2 + hp * 0.12, 0.15 + hp * 0.04));
      for (const [k, y] of [
        [0, 0.3],
        [1, 0.9],
      ] as const) {
        dummy.position.set(c.x, y, c.z);
        dummy.scale.set(gone ? 0 : BARREL_R + 0.03, gone ? 0 : 0.1, gone ? 0 : BARREL_R + 0.03);
        dummy.updateMatrix();
        barrelBands.setMatrixAt(i * 2 + k, dummy.matrix);
      }
    });
    barrels.instanceMatrix.needsUpdate = true;
    barrelBands.instanceMatrix.needsUpdate = true;
    if (barrels.instanceColor) barrels.instanceColor.needsUpdate = true;
  };
  placeCrates(0);

  // supply drops: a blue crate under a balloon that floats down, with a beam of light from where it will land
  const supplyMat = lambert(0xffffff, { map: keep(supplyTexture(THREE)) });
  const supplyOpen = lambert(0x50607a);
  const beamMat = basic(0x7fc4ff, { transparent: true, opacity: 0.22, depthWrite: false });
  const supplies = [...map.drops, ...map.flares].map((id) => {
    const c = map.containers[id];
    const group = new THREE.Group();
    const box = add(group, G.box, supplyMat, 0, SUPPLY_HALF, 0, SUPPLY_HALF * 2, SUPPLY_HALF * 2, SUPPLY_HALF * 2);
    const balloon = new THREE.Group();
    add(balloon, G.ball, lambert(0xff5a5a), 0, 6, 0, 1.7, 2, 1.7);
    add(balloon, G.ball, M.white, 0, 6, 0, 1.72, 0.35, 1.72);
    for (const [x, z] of [
      [-0.8, -0.8],
      [0.8, -0.8],
      [-0.8, 0.8],
      [0.8, 0.8],
    ]) {
      const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, SUPPLY_HALF * 2, z), new THREE.Vector3(x * 0.4, 4.3, z * 0.4)]);
      geos.push(g);
      balloon.add(new THREE.Line(g, mat(new THREE.LineBasicMaterial({ color: 0x333333 }))));
    }
    group.add(balloon);
    const glow = new THREE.Mesh(G.ring, basic(0x7fc4ff, { transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.05;
    glow.scale.setScalar(2.3);
    group.add(glow);
    group.position.set(c.x, 0, c.z);
    group.visible = false;
    scene.add(group);
    const beam = new THREE.Mesh(G.cyl, beamMat);
    beam.position.set(c.x, 40, c.z);
    beam.scale.set(0.7, 80, 0.7);
    beam.visible = false;
    scene.add(beam);
    return { c, group, box, balloon, glow, beam };
  });

  // ---------------------------------------------------------------------------------------------------------------
  // Around the buildings: dirt roads with lamp posts along them, fences round the farms, parked cars and trucks,
  // mailboxes and picnic tables. All instanced: one draw call a kind.

  const put = (im: T.InstancedMesh, i: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry = 0, c?: T.Color) => {
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, ry, 0);
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    if (c) im.setColorAt(i, c);
  };

  // fallen logs (bark, with pale cut ends) and stumps
  const bark = lambert(0x6e4a2c);
  const cut = lambert(0xd9b77e);
  const logGeo = geo(new THREE.CylinderGeometry(1, 1, 1, 8));
  const logBodies = many(logGeo, bark, map.logs.length + map.stumps.length);
  const logEnds = many(logGeo, cut, map.logs.length * 2 + map.stumps.length);
  map.logs.forEach((l, i) => {
    const len = (l.alongX ? l.hw : l.hd) * 2;
    dummy.position.set(l.x, LOG_R, l.z);
    dummy.rotation.set(l.alongX ? 0 : Math.PI / 2, 0, l.alongX ? Math.PI / 2 : 0);
    dummy.scale.set(LOG_R, len, LOG_R);
    dummy.updateMatrix();
    logBodies.setMatrixAt(i, dummy.matrix);
    for (const k of [-1, 1]) {
      dummy.position.set(l.x + (l.alongX ? (k * len) / 2 : 0), LOG_R, l.z + (l.alongX ? 0 : (k * len) / 2));
      dummy.scale.set(LOG_R * 0.85, 0.03, LOG_R * 0.85);
      dummy.updateMatrix();
      logEnds.setMatrixAt(i * 2 + (k > 0 ? 1 : 0), dummy.matrix);
    }
  });
  map.stumps.forEach((t, i) => {
    const h = 0.4 + (i % 3) * 0.08;
    put(logBodies, map.logs.length + i, t.x, h / 2, t.z, t.r, h, t.r);
    put(logEnds, map.logs.length * 2 + i, t.x, h + 0.01, t.z, t.r * 0.85, 0.03, t.r * 0.85);
  });
  scene.add(logBodies, logEnds);

  // bridges: a deck of planks across the water, a rail down each side on posts, and piles where it meets the banks
  type Part = { x: number; y: number; z: number; sx: number; sy: number; sz: number; c: number; b?: number };
  const planks: Part[] = [];
  const railings: Part[] = [];
  const piles: Part[] = [];
  const plankRnd = scatter(43);
  for (const br of map.bridges) {
    const len = 2 * (br.alongX ? br.hw : br.hd);
    // a point `u` along the deck and `v` across it
    const at = (u: number, v: number) => (br.alongX ? { x: br.x + u, z: br.z + v } : { x: br.x + v, z: br.z + u });
    const size = (along: number, across: number) => (br.alongX ? { sx: along, sz: across } : { sx: across, sz: along });
    for (let u = -len / 2 + 0.25; u < len / 2; u += 0.5) planks.push({ ...at(u, (plankRnd() - 0.5) * 0.06), y: 0.05, ...size(0.46, BRIDGE_HALF * 2 - 0.05), sy: 0.08, c: shade(plankRnd, 0xa57846, 0.5).getHex() });
    for (const v of [-1, 1]) {
      const side = v * (BRIDGE_HALF - FENCE_T / 2);
      for (const y of [0.55, 0.98]) railings.push({ ...at(0, side), y, ...size(len, 0.12), sy: 0.09, c: 0x8a5a2b });
      for (let u = -len / 2 + 0.1; u <= len / 2; u += len / Math.ceil(len / 2)) railings.push({ ...at(Math.min(u, len / 2 - 0.1), side), y: 0.52, ...size(0.16, 0.16), sy: 1.05, c: 0x6b4426 });
      for (const u of [-1, 1]) piles.push({ ...at(u * (len / 2 - 1.9), v * (BRIDGE_HALF - 0.3)), y: -0.25, sx: 0.2, sy: 0.7, sz: 0.2, c: 0x5a3e24 });
    }
  }
  const instance = (g: T.BufferGeometry, list: Part[]) => {
    const im = many(g, lambert(0xffffff), list.length);
    list.forEach((p, i) => put(im, i, p.x, p.y, p.z, p.sx, p.sy, p.sz, 0, color.setHex(p.c)));
    scene.add(im);
    return im;
  };
  instance(G.box, planks);
  instance(G.box, railings);
  instance(G.cyl, piles);

  // furniture, all of it three instanced meshes: boxes, round things and lumpy things (flour sacks)
  const boxes: Part[] = [];
  const rounds: Part[] = [];
  const lumps: Part[] = [];
  const RUGS = [0xb33c2e, 0x2f6fb0, 0x6a8f3a, 0xc08a2e];
  const BLANKETS = [0x5b84b0, 0xd0623f, 0x7ea55a, 0xa06b98];
  const CABINETS = [0xf4f1ea, 0x9fc5c0, 0xe8dccb, 0xc9935a];
  const BOOKS = [0xc0392b, 0x2e86de, 0x27ae60, 0xf2c94c, 0x8e44ad, 0xe67e22];
  const furnRnd = scatter(47);
  for (const f of map.furniture) {
    const b = map.buildings[f.b];
    const from = [boxes.length, rounds.length, lumps.length];
    // the way to the wall it stands against (`face`), and across that
    const wx = f.face === 2 ? -1 : f.face === 3 ? 1 : 0;
    const wz = f.face === 0 ? -1 : f.face === 1 ? 1 : 0;
    const deep = 2 * (wx ? f.hw : f.hd);
    const wide = 2 * (wx ? f.hd : f.hw);
    /** A box `u` toward the wall from the middle, `along` deep (toward the wall) and `across` wide. */
    const part = (list: Part[], u: number, y: number, along: number, sy: number, across: number, c: number) =>
      list.push({ x: f.x + wx * u, y, z: f.z + wz * u, sx: wx ? along : across, sy, sz: wx ? across : along, c });
    switch (f.kind) {
      case 'rug':
        boxes.push({ x: f.x, y: 0.03, z: f.z, sx: f.hw * 2, sy: 0.02, sz: f.hd * 2, c: RUGS[f.look % 4] });
        boxes.push({ x: f.x, y: 0.042, z: f.z, sx: f.hw * 2 - 0.36, sy: 0.006, sz: f.hd * 2 - 0.36, c: color.setHex(RUGS[f.look % 4]).offsetHSL(0, 0, 0.18).getHex() });
        break;
      case 'table':
        boxes.push({ x: f.x, y: 0.76, z: f.z, sx: f.hw * 2, sy: 0.07, sz: f.hd * 2, c: 0xa5713f });
        for (const [sx, sz] of QUADS) boxes.push({ x: f.x + sx * (f.hw - 0.12), y: 0.37, z: f.z + sz * (f.hd - 0.12), sx: 0.09, sy: 0.74, sz: 0.09, c: 0x7a4f28 });
        break;
      case 'chair':
        boxes.push({ x: f.x, y: 0.46, z: f.z, sx: 0.44, sy: 0.06, sz: 0.44, c: 0x9a6a3a });
        boxes.push({ x: f.x, y: 0.22, z: f.z, sx: 0.08, sy: 0.44, sz: 0.08, c: 0x6b4426 });
        part(boxes, 0.19, 0.74, 0.06, 0.52, 0.44, 0x9a6a3a);
        break;
      case 'bed':
        boxes.push({ x: f.x, y: 0.2, z: f.z, sx: f.hw * 2, sy: 0.4, sz: f.hd * 2, c: 0x8a5a2b });
        boxes.push({ x: f.x, y: 0.47, z: f.z, sx: f.hw * 2 - 0.12, sy: 0.14, sz: f.hd * 2 - 0.12, c: 0xf6f3ec });
        part(boxes, -deep * 0.17, 0.55, deep * 0.62, 0.06, wide - 0.04, BLANKETS[f.look % 4]);
        part(boxes, deep / 2 - 0.36, 0.6, 0.38, 0.12, wide * 0.72, 0xffffff);
        part(boxes, deep / 2 - 0.04, 0.55, 0.08, 1.1, wide, 0x6b4426);
        break;
      case 'counter': {
        const diner = b.kind === 'diner';
        boxes.push({ x: f.x, y: 0.44, z: f.z, sx: f.hw * 2, sy: 0.88, sz: f.hd * 2, c: diner ? 0x3fb8af : b.kind === 'shed' ? 0x8a5a2b : CABINETS[f.look % 4] });
        boxes.push({ x: f.x, y: 0.91, z: f.z, sx: f.hw * 2 + 0.04, sy: 0.06, sz: f.hd * 2 + 0.04, c: diner ? 0xdfe5ea : b.kind === 'shed' ? 0x6b4426 : 0xc9ccd1 });
        if (!diner && b.kind !== 'shed') boxes.push({ x: f.x, y: 0.94, z: f.z, sx: Math.min(0.5, f.hw * 2 - 0.2), sy: 0.02, sz: Math.min(0.5, f.hd * 2 - 0.2), c: 0x5b616b });
        break;
      }
      case 'shelf': {
        const racks = b.kind === 'warehouse';
        boxes.push({ x: f.x, y: racks ? 1.2 : 0.95, z: f.z, sx: f.hw * 2, sy: racks ? 2.4 : 1.9, sz: f.hd * 2, c: racks ? 0x4f6d8f : 0x6b4426 });
        // what's on it sticks out a little from the open side
        for (const y of racks ? [0.45, 1.25, 2.05] : [0.4, 0.95, 1.5]) part(boxes, -0.06, y, deep * 0.9, racks ? 0.55 : 0.3, wide - 0.14, racks ? shade(furnRnd, 0xc9a26b, 0.4).getHex() : BOOKS[Math.floor(furnRnd() * BOOKS.length)]);
        break;
      }
      case 'booth':
        part(boxes, 0, 0.76, 0.7, 0.06, wide - 0.3, 0xf4f1ea);
        part(boxes, 0, 0.38, 0.12, 0.74, 0.12, 0xb7bcc2);
        for (const k of [-1, 1]) {
          part(boxes, k * (deep / 2 - 0.3), 0.22, 0.56, 0.44, wide, 0xa83232);
          part(boxes, k * (deep / 2 - 0.3), 0.48, 0.5, 0.1, wide - 0.04, 0xd64545);
          part(boxes, k * (deep / 2 - 0.06), 0.78, 0.12, 0.7, wide, 0xd64545);
        }
        break;
      case 'stool':
        rounds.push({ x: f.x, y: 0.74, z: f.z, sx: 0.22, sy: 0.08, sz: 0.22, c: 0xd64545 });
        boxes.push({ x: f.x, y: 0.36, z: f.z, sx: 0.07, sy: 0.72, sz: 0.07, c: 0xb7bcc2 });
        break;
      case 'sacks':
        for (const [x, y, z, k] of [
          [-0.18, 0.24, -0.15, 1],
          [0.2, 0.24, 0.13, 0.95],
          [0.02, 0.58, 0, 0.9],
        ])
          lumps.push({ x: f.x + x, y, z: f.z + z, sx: 0.3 * k, sy: 0.25 * k, sz: 0.27 * k, c: shade(furnRnd, 0xe2d3ae, 0.3).getHex() });
        break;
      case 'millstone':
        rounds.push({ x: f.x, y: 0.16, z: f.z, sx: f.hw, sy: 0.32, sz: f.hd, c: 0x9aa0a6 });
        rounds.push({ x: f.x, y: 0.43, z: f.z, sx: f.hw * 0.86, sy: 0.22, sz: f.hd * 0.86, c: 0xb9bec3 });
        boxes.push({ x: f.x, y: 0.8, z: f.z, sx: 0.14, sy: 0.9, sz: 0.14, c: 0x6b4426 });
        break;
    }
    [boxes, rounds, lumps].forEach((list, k) => {
      for (let i = from[k]; i < list.length; i++) list[i].b = f.b;
    });
  }
  // every room's furniture stays hidden (not drawn only to be painted over) while its roof is on
  const furnished = [instance(G.box, boxes), instance(G.cyl, rounds), instance(G.lowBall, lumps)];
  const placed = furnished.map((im) => {
    im.computeBoundingSphere();
    return Array.from({ length: im.count }, (_, i) => {
      const at = new THREE.Matrix4();
      im.getMatrixAt(i, at);
      return at;
    });
  });
  const pieces: [number, number][][] = map.buildings.map(() => []);
  [boxes, rounds, lumps].forEach((list, k) => list.forEach((p, i) => p.b !== undefined && pieces[p.b].push([k, i])));
  const hidden = new THREE.Matrix4().makeScale(0, 0, 0);
  const shown = map.buildings.map(() => true);
  const showFurniture = (bi: number, on: boolean) => {
    if (shown[bi] === on || !pieces[bi].length) return;
    shown[bi] = on;
    for (const [k, i] of pieces[bi]) {
      furnished[k].setMatrixAt(i, on ? placed[k][i] : hidden);
      furnished[k].instanceMatrix.needsUpdate = true;
    }
  };
  map.buildings.forEach((b, i) => b.roof && showFurniture(i, false));

  // ground detail: tufts of grass, flowers and pebbles, merged into one mesh per 40 m square so only the squares in
  // view are drawn, and none at all from up high, where they'd only be specks
  const TILE = 40;
  const GRASS = HALF - BEACH;
  const tiles = Math.ceil((2 * GRASS) / TILE);
  const decorPos: number[][] = Array.from({ length: tiles * tiles }, () => []);
  const decorCol: number[][] = Array.from({ length: tiles * tiles }, () => []);
  const decorRnd = scatter((map.seed ^ 0x5bd1e995) >>> 0);
  const bare = (x: number, z: number) =>
    Math.abs(x) > GRASS - 0.5 ||
    Math.abs(z) > GRASS - 0.5 ||
    map.buildings.some((b) => Math.abs(x - b.x) < b.w / 2 + 0.4 && Math.abs(z - b.z) < b.d / 2 + 0.4) ||
    roadAt(map, x, z) ||
    riverDist2(map, x, z) < (RIVER_HALF + 1.4) * (RIVER_HALF + 1.4) ||
    map.ponds.some((p) => Math.hypot(x - p.x, z - p.z) < p.r + 1.3) ||
    fieldAt(map, x, z) >= 0 ||
    padAt(map, x, z) >= 0 ||
    bridgeAt(map, x, z) >= 0 ||
    map.fires.some((f) => Math.hypot(x - f.x, z - f.z) < CAMP.pit + 0.4);
  const tileOf = (x: number, z: number) => Math.min(tiles - 1, Math.floor((x + GRASS) / TILE)) + Math.min(tiles - 1, Math.floor((z + GRASS) / TILE)) * tiles;
  const rgb = (hex: number, spread: number) => {
    shade(decorRnd, hex, spread);
    return [color.r, color.g, color.b];
  };
  /** One triangle into the square at (x, z), its corners' colors given. */
  const tri = (k: number, p: number[], c0: number[], c1: number[], c2: number[]) => {
    decorPos[k].push(...p);
    decorCol[k].push(...c0, ...c1, ...c2);
  };
  // tufts of grass in clumps of a few, each three blades leaning out
  for (let i = 0; i < 1500; i++) {
    const cx = (decorRnd() * 2 - 1) * GRASS;
    const cz = (decorRnd() * 2 - 1) * GRASS;
    const n = 2 + Math.floor(decorRnd() * 4);
    for (let j = 0; j < n; j++) {
      const x = cx + (decorRnd() - 0.5) * 2.2;
      const z = cz + (decorRnd() - 0.5) * 2.2;
      if (bare(x, z)) continue;
      const k = tileOf(x, z);
      const base = rgb(0x3d7a2c, 0.6);
      const tip = rgb(decorRnd() < 0.2 ? 0xc9c65a : 0x9ccf5a, 0.6);
      const h = 0.4 + decorRnd() * 0.35;
      const a0 = decorRnd() * 6.3;
      for (let b = 0; b < 3; b++) {
        const a = a0 + b * 2.1;
        const dx = Math.sin(a);
        const dz = Math.cos(a);
        tri(k, [x - dz * 0.08, 0, z + dx * 0.08, x + dz * 0.08, 0, z - dx * 0.08, x + dx * 0.22, h * (0.8 + b * 0.12), z + dz * 0.22], base, base, tip);
      }
    }
  }
  const PETALS = [0xffffff, 0xffd23d, 0xf28ab2, 0xb07ae0, 0xff6b4a];
  for (let i = 0; i < 220; i++) {
    const cx = (decorRnd() * 2 - 1) * GRASS;
    const cz = (decorRnd() * 2 - 1) * GRASS;
    const petal = PETALS[Math.floor(decorRnd() * PETALS.length)];
    for (let j = 0; j < 6; j++) {
      const x = cx + (decorRnd() - 0.5) * 3;
      const z = cz + (decorRnd() - 0.5) * 3;
      if (bare(x, z)) continue;
      const k = tileOf(x, z);
      const stem = rgb(0x4f8a35, 0.4);
      const head = rgb(petal, 0.3);
      const mid = [1, 0.85, 0.3];
      const h = 0.26 + decorRnd() * 0.12;
      tri(k, [x - 0.02, 0, z, x + 0.02, 0, z, x, h, z], stem, stem, stem);
      const r = 0.12;
      const ring = [
        [r, 0],
        [0, r],
        [-r, 0],
        [0, -r],
      ];
      for (let q = 0; q < 4; q++) {
        const [ax, az] = ring[q];
        const [bx, bz] = ring[(q + 1) % 4];
        tri(k, [x, h + 0.05, z, x + ax, h - 0.01, z + az, x + bx, h - 0.01, z + bz], mid, head, head);
      }
    }
  }
  for (let i = 0; i < 600; i++) {
    const x = (decorRnd() * 2 - 1) * GRASS;
    const z = (decorRnd() * 2 - 1) * GRASS;
    if (bare(x, z)) continue;
    const k = tileOf(x, z);
    const r = 0.1 + decorRnd() * 0.16;
    const h = r * (0.4 + decorRnd() * 0.4);
    const a = decorRnd() * 6.3;
    const top = rgb(0xb5b9bd, 0.5);
    const side = rgb(0x8a8f95, 0.5);
    for (let q = 0; q < 4; q++) {
      const a0 = a + (q * Math.PI) / 2;
      const a1 = a0 + Math.PI / 2;
      tri(k, [x, h, z, x + Math.sin(a0) * r, 0.01, z + Math.cos(a0) * r, x + Math.sin(a1) * r, 0.01, z + Math.cos(a1) * r], top, side, side);
    }
  }
  const decor = new THREE.Group();
  const decorMat = lambert(0xffffff, { vertexColors: true, flatShading: true, side: THREE.DoubleSide });
  decorPos.forEach((p, k) => {
    if (!p.length) return;
    const g = geo(new THREE.BufferGeometry());
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(decorCol[k], 3));
    g.computeVertexNormals();
    decor.add(new THREE.Mesh(g, decorMat));
  });
  scene.add(decor);
  const roads = many(G.box, lambert(0xcdb07a), map.roads.length);
  map.roads.forEach((r, i) => {
    const len = Math.hypot(r.x1 - r.x0, r.z1 - r.z0);
    put(roads, i, (r.x0 + r.x1) / 2, 0.012, (r.z0 + r.z1) / 2, ROAD_HALF * 2, 0.012, len + ROAD_HALF, Math.atan2(r.x1 - r.x0, r.z1 - r.z0));
  });
  // lamp posts: a slim pole, a collar and a glowing bulb on top
  const poles = many(G.cyl, lambert(0x5d6670), map.lamps.length);
  const lampCaps = many(G.cyl, lambert(0x2b2d33), map.lamps.length);
  const lampHeads = many(G.ball, basic(0xfff0b0), map.lamps.length);
  map.lamps.forEach((p, i) => {
    put(poles, i, p.x, 1.5, p.z, LAMP_R * 0.8, 3, LAMP_R * 0.8);
    put(lampCaps, i, p.x, 3.05, p.z, 0.17, 0.16, 0.17);
    put(lampHeads, i, p.x, 3.32, p.z, 0.3, 0.3, 0.3);
  });
  const MAIL_COLORS = [0x2f7de1, 0xe53935, 0x3fae4a, 0xfdd835];
  const mailPosts = many(G.box, M.wood, map.mailboxes.length);
  const mailBoxes = many(G.box, lambert(0xffffff), map.mailboxes.length);
  map.mailboxes.forEach((p, i) => {
    put(mailPosts, i, p.x, 0.5, p.z, 0.12, 1, 0.12);
    put(mailBoxes, i, p.x, 1.14, p.z, 0.36, 0.34, 0.52, 0, color.setHex(MAIL_COLORS[p.look % MAIL_COLORS.length]));
  });
  const tableTops = many(G.box, lambert(0xa5713f), map.tables.length);
  const benches = many(G.box, lambert(0xa5713f), map.tables.length * 2);
  const tableLegs = many(G.box, lambert(0x7a4f28), map.tables.length * 2);
  map.tables.forEach((t, i) => {
    const ry = t.alongX ? 0 : Math.PI / 2;
    put(tableTops, i, t.x, 0.72, t.z, TABLE_HW * 2, 0.08, 0.8, ry);
    for (const [k, side] of [-1, 1].entries()) {
      const ox = t.alongX ? 0 : side * 0.62;
      const oz = t.alongX ? side * 0.62 : 0;
      put(benches, i * 2 + k, t.x + ox, 0.42, t.z + oz, TABLE_HW * 2, 0.06, 0.3, ry);
      const lx = t.alongX ? side * (TABLE_HW - 0.3) : 0;
      const lz = t.alongX ? 0 : side * (TABLE_HW - 0.3);
      put(tableLegs, i * 2 + k, t.x + lx, 0.36, t.z + lz, 0.1, 0.72, TABLE_HD * 2 - 0.1, ry);
    }
  });
  // fences: two rails along every run, a post every two meters
  const rails: { x: number; z: number; hw: number; hd: number }[] = map.yards.flatMap((y) => y.fences);
  const postSpots: { x: number; z: number }[] = [];
  for (const r of rails) {
    const alongX = r.hw > r.hd;
    const len = 2 * (alongX ? r.hw : r.hd);
    for (let s = 0; s <= len + 0.01; s += 2) {
      const u = -len / 2 + Math.min(s, len);
      postSpots.push({ x: alongX ? r.x + u : r.x, z: alongX ? r.z : r.z + u });
    }
  }
  const fenceRails = many(G.box, lambert(0xc49a5c), rails.length * 2);
  const fencePosts = many(G.box, lambert(0x8f6a3c), postSpots.length);
  rails.forEach((r, i) => {
    for (const [k, y] of [0.5, 0.95].entries()) put(fenceRails, i * 2 + k, r.x, y, r.z, r.hw * 2, 0.1, r.hd * 2);
  });
  postSpots.forEach((p, i) => put(fencePosts, i, p.x, 0.6, p.z, FENCE_T + 0.1, 1.2, FENCE_T + 0.1));
  // cars: a body, glass with a roof on it (a cab and a bed on a truck) and four wheels
  const CAR_COLORS = [0xe53935, 0x1e88e5, 0xf5f7fa, 0x43a047, 0xfdd835, 0x5e35b1];
  const carBodies = many(G.box, lambert(0xffffff), map.cars.length);
  const carCabins = many(G.box, lambert(0xffffff), map.cars.length);
  const carTops = many(G.box, lambert(0xffffff), map.cars.length);
  const wheels = many(G.cyl, M.dark, map.cars.length * 4);
  map.cars.forEach((c, i) => {
    const ry = c.alongX ? Math.PI / 2 : 0;
    const len = c.alongX ? c.hw * 2 : c.hd * 2;
    const wide = c.alongX ? c.hd * 2 : c.hw * 2;
    const paint = CAR_COLORS[c.look % CAR_COLORS.length];
    // a point `u` meters along the car from its middle (toward the nose)
    const at = (u: number) => [c.x + (c.alongX ? u : 0), c.z + (c.alongX ? 0 : u)] as const;
    if (c.truck) {
      put(carBodies, i, c.x, 0.62, c.z, wide, 0.6, len, ry, color.setHex(paint));
      // the cab at the nose, the bed behind it
      const [nx, nz] = at(len / 2 - 0.85);
      put(carCabins, i, nx, 1.45, nz, wide - 0.1, 1.05, 1.6, ry, color.setHex(paint));
      const [bx, bz] = at(-0.85);
      put(carTops, i, bx, 1.02, bz, wide - 0.08, 0.22, len - 1.9, ry, color.setHex(0x4a4e55));
    } else {
      put(carBodies, i, c.x, 0.55, c.z, wide, 0.6, len, ry, color.setHex(paint));
      put(carCabins, i, c.x, 1.08, c.z, wide - 0.2, 0.5, len * 0.55, ry, color.setHex(0x9ecbe8));
      put(carTops, i, c.x, 1.36, c.z, wide - 0.36, 0.07, len * 0.42, ry, color.setHex(paint));
    }
    for (const [k, [a, b]] of [
      [-1, -1],
      [1, -1],
      [-1, 1],
      [1, 1],
    ].entries()) {
      const ax = a * (len / 2 - 0.7);
      const bz = b * (wide / 2 - 0.08);
      dummy.position.set(c.x + (c.alongX ? ax : bz), 0.38, c.z + (c.alongX ? bz : ax));
      // axles run across the car
      dummy.rotation.set(c.alongX ? Math.PI / 2 : 0, 0, c.alongX ? 0 : Math.PI / 2);
      dummy.scale.set(0.38, 0.26, 0.38);
      dummy.updateMatrix();
      wheels.setMatrixAt(i * 4 + k, dummy.matrix);
    }
  });
  scene.add(roads, poles, lampHeads, lampCaps, mailPosts, mailBoxes, tableTops, benches, tableLegs, fenceRails, fencePosts, carBodies, carCabins, carTops, wheels);

  // campfires: a ring of stones round crossed logs, flames that flicker, and a warm glow on the ground. All instanced.
  const STONES = 8;
  const fireStones = many(G.rock, lambert(0x8d9298, { flatShading: true }), map.fires.length * STONES);
  const fireLogs = many(G.box, M.wood, map.fires.length * 3);
  const flames = many(G.pine, basic(0xffffff), map.fires.length * 3);
  const fireGlowMat = basic(0xff8a2a, { map: keep(glowTexture(THREE)), transparent: true, opacity: 0.55, depthWrite: false });
  const fireGlow = many(G.disc, fireGlowMat, map.fires.length);
  const FLAME_COLORS = [0xff6a1a, 0xffd34a, 0xff9a2a];
  map.fires.forEach((c, i) => {
    for (let k = 0; k < STONES; k++) {
      const a = (k / STONES) * Math.PI * 2 + i;
      const r = CAMP.pit + 0.05;
      dummy.position.set(c.x + Math.sin(a) * r, 0.1, c.z + Math.cos(a) * r);
      dummy.rotation.set(0, a * 3, 0);
      dummy.scale.set(0.2, 0.15, 0.17);
      dummy.updateMatrix();
      fireStones.setMatrixAt(i * STONES + k, dummy.matrix);
    }
    for (let k = 0; k < 3; k++) put(fireLogs, i * 3 + k, c.x, 0.14, c.z, 0.16, 0.16, 1.1, (k * Math.PI) / 3 + i);
    FLAME_COLORS.forEach((f, k) => flames.setColorAt(i * 3 + k, color.setHex(f)));
  });
  const placeFires = (clock: number) => {
    map.fires.forEach((c, i) => {
      for (let k = 0; k < 3; k++) {
        // a tall middle tongue and two lower ones either side, each flickering on its own beat
        const s = 0.75 + Math.abs(Math.sin(clock * (7 + k * 1.7) + i * 1.3 + k)) * 0.5;
        const h = (k === 1 ? 0.75 : 1.15) * s;
        const ox = k === 2 ? 0.14 : k === 0 ? -0.12 : 0;
        put(flames, i * 3 + k, c.x + ox, 0.2 + h / 2, c.z + (k === 0 ? 0.08 : -0.05), k === 1 ? 0.24 : 0.34, h, k === 1 ? 0.24 : 0.34, clock * (1.5 + k));
      }
      dummy.position.set(c.x, 0.04, c.z);
      dummy.rotation.set(-Math.PI / 2, 0, 0);
      dummy.scale.setScalar((CAMP.r + 0.4) * (0.94 + Math.sin(clock * 9 + i) * 0.04));
      dummy.updateMatrix();
      fireGlow.setMatrixAt(i, dummy.matrix);
    });
    flames.instanceMatrix.needsUpdate = true;
    fireGlow.instanceMatrix.needsUpdate = true;
  };
  placeFires(0);
  scene.add(fireStones, fireLogs, flames, fireGlow);

  // bounce pads: a bright disc in a dark rim, chevrons for the way it throws you, and a ring that pulses out from it
  const bounceMat = lambert(0x2ee6a6, { emissive: 0x168f62 });
  const padRingMat = basic(0x8dffdc, { transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const pads = map.pads.map((p) => {
    const group = new THREE.Group();
    group.position.set(p.x, 0, p.z);
    group.rotation.y = Math.atan2(p.dx, p.dz);
    add(group, G.cyl, M.dark, 0, 0.1, 0, PAD.r + 0.3, 0.2, PAD.r + 0.3);
    const top = add(group, G.cyl, bounceMat, 0, 0.2, 0, PAD.r + 0.05, 0.1, PAD.r + 0.05);
    // two chevrons, flat on the top, pointing +z (the way out)
    for (const at of [-0.35, 0.25])
      for (const side of [-1, 1]) {
        const bar = add(group, G.box, M.white, side * 0.22, 0.27, at, 0.14, 0.04, 0.62);
        bar.rotation.y = -side * 0.8;
      }
    const ring = add(group, G.ring, padRingMat, 0, 0.06, 0, 2, 2, 1);
    ring.rotation.x = -Math.PI / 2;
    scene.add(group);
    return { p, group, top, ring };
  });

  // the kitchen: fridges open like chests, toilets break like crates, hay bales out in the yard too
  const fridgeList = map.containers.filter((c) => c.kind === 'fridge');
  const toiletList = map.containers.filter((c) => c.kind === 'toilet');
  const hayList = map.containers.filter((c) => c.kind === 'hay');
  const fridgeBase = many(G.box, lambert(0xf4f1ea), fridgeList.length);
  const fridgeDoor = many(G.box, lambert(0xffffff), fridgeList.length);
  const fridgeHandles = many(G.box, M.metal, fridgeList.length);
  const fridgeInside = many(G.box, lambert(0xbfe3ff, { emissive: 0x1a3a55 }), fridgeList.length);
  const bowls = many(G.cyl, lambert(0xffffff), toiletList.length);
  const tanks = many(G.box, lambert(0xffffff), toiletList.length);
  const seats = many(G.band, lambert(0xe8e8ec), toiletList.length);
  const hay = many(G.box, lambert(0xffffff, { map: keep(hayTexture(THREE)) }), hayList.length);
  scene.add(fridgeBase, fridgeDoor, fridgeHandles, fridgeInside, bowls, tanks, seats, hay);
  const fridgeState = fridgeList.map(() => -1);
  const placeFridges = (force: boolean) => {
    fridgeList.forEach((c, i) => {
      const open = m.opened[c.id] ? 1 : 0;
      if (!force && fridgeState[i] === open) return;
      fridgeState[i] = open;
      // open, the front of the box is the lit inside; the door hangs on the hinge at one edge and swings wide
      put(fridgeBase, i, c.x - 0, 0.95, c.z - (open ? c.face * 0.1 : 0), FRIDGE_HW * 2, 1.9, FRIDGE_HD * 2 - (open ? 0.2 : 0));
      put(fridgeInside, i, c.x, 0.95, c.z + c.face * (FRIDGE_HD - 0.1), (FRIDGE_HW * 2 - 0.1) * open, 1.78 * open, 0.2 * open);
      const hx = c.x - FRIDGE_HW;
      const hz = c.z + c.face * (FRIDGE_HD + 0.04);
      const ry = open ? -c.face * 1.9 : 0;
      const dx = Math.cos(ry) * FRIDGE_HW;
      const dz = -Math.sin(ry) * FRIDGE_HW;
      put(fridgeDoor, i, hx + dx, 0.95, hz + dz, FRIDGE_HW * 2 - 0.02, 1.86, 0.08, ry);
      put(fridgeHandles, i, hx + dx * 1.7 - (open ? 0 : 0) + (open ? Math.sin(ry) * 0.07 : 0), 1.0, hz + dz * 1.7 + (open ? Math.cos(ry) * c.face * 0.07 : c.face * 0.07), 0.05, 0.7, 0.05, ry);
    });
    fridgeBase.instanceMatrix.needsUpdate = true;
    fridgeDoor.instanceMatrix.needsUpdate = true;
    fridgeHandles.instanceMatrix.needsUpdate = true;
    fridgeInside.instanceMatrix.needsUpdate = true;
  };
  placeFridges(true);
  const placeKitchen = (clock: number) => {
    toiletList.forEach((c, i) => {
      const gone = m.opened[c.id];
      const shake = crateShake.get(c.id) ?? -9;
      const jiggle = clock - shake < 0.18 ? Math.sin((clock - shake) * 80) * 0.05 : 0;
      const s = gone ? 0 : 1;
      put(bowls, i, c.x, 0.22, c.z, TOILET_R * 0.95 * s, 0.44 * s, TOILET_R * 0.95 * s, jiggle);
      put(tanks, i, c.x, 0.62, c.z - c.face * (TOILET_R - 0.1), (TOILET_R * 2 - 0.1) * s, 0.7 * s, 0.26 * s, jiggle);
      dummy.position.set(c.x, 0.46, c.z + c.face * 0.03);
      dummy.rotation.set(Math.PI / 2, 0, 0);
      dummy.scale.set(TOILET_R * 0.85 * s, TOILET_R * 0.85 * s, s);
      dummy.updateMatrix();
      seats.setMatrixAt(i, dummy.matrix);
      const hp = Math.max(0, m.crateHp[c.id] / TOILET_HP);
      bowls.setColorAt(i, color.setRGB(1, 0.85 + hp * 0.15, 0.85 + hp * 0.15));
    });
    bowls.instanceMatrix.needsUpdate = true;
    tanks.instanceMatrix.needsUpdate = true;
    seats.instanceMatrix.needsUpdate = true;
    if (bowls.instanceColor) bowls.instanceColor.needsUpdate = true;
    hayList.forEach((c, i) => {
      const gone = m.opened[c.id];
      const shake = crateShake.get(c.id) ?? -9;
      const jiggle = clock - shake < 0.18 ? Math.sin((clock - shake) * 80) * 0.05 : 0;
      const s = gone ? 0 : 1;
      put(hay, i, c.x, 0.6, c.z, HAY_HW * 2 * s, 1.2 * s, HAY_HD * 2 * s, jiggle);
      const hp = Math.max(0, m.crateHp[c.id] / HAY_HP);
      hay.setColorAt(i, color.setRGB(0.6 + hp * 0.4, 0.55 + hp * 0.45, 0.5 + hp * 0.5));
    });
    hay.instanceMatrix.needsUpdate = true;
    if (hay.instanceColor) hay.instanceColor.needsUpdate = true;
  };
  placeKitchen(0);

  // ---------------------------------------------------------------------------------------------------------------
  // The storm: a purple wall, a tint over everything outside it, and a white ring where it is headed.

  const stormWall = new THREE.Mesh(geo(new THREE.CylinderGeometry(1, 1, 90, 160, 1, true)), basic(0x8a4dff, { transparent: true, opacity: 0.3, side: THREE.DoubleSide, depthWrite: false }));
  stormWall.position.y = 44;
  stormWall.renderOrder = 3;
  scene.add(stormWall);
  const tint = freeRing(THREE, 160);
  geos.push(tint.geometry);
  const stormTint = new THREE.Mesh(tint.geometry, basic(0x7a3cf0, { transparent: true, opacity: 0.26, depthWrite: false, side: THREE.DoubleSide }));
  stormTint.position.y = 0.12;
  stormTint.renderOrder = 2;
  scene.add(stormTint);
  const nextRing = freeRing(THREE, 160);
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
  add(bus, G.ball, lambert(0x8a4dff), 0, 8.4, 0, 3.2, 3.7, 3.2);
  for (const [x, z] of [
    [-1.3, -3.6],
    [1.3, -3.6],
    [-1.3, 3.6],
    [1.3, 3.6],
  ]) {
    const g = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(x, 1.3, z), new THREE.Vector3(x * 0.6, 5.3, z * 0.25)]);
    geos.push(g);
    bus.add(new THREE.Line(g, mat(new THREE.LineBasicMaterial({ color: 0x333333 }))));
  }
  bus.scale.setScalar(BUS_SCALE);
  scene.add(bus);

  // ---------------------------------------------------------------------------------------------------------------
  // What eggs hold: guns (a few boxes each, with a stripe in the rarity's color), kitchen tools and throwables.
  // The muzzle points along +z.

  const barrel = (g: T.Group, material: T.Material, x: number, y: number, z: number, r: number, len: number) => {
    const o = add(g, G.cyl, material, x, y, z, r, len, r);
    o.rotation.x = Math.PI / 2;
    return o;
  };
  /** A helmet from the kitchen, upside down, its brim on y = 0: a colander, a saucepan or a stockpot by level. */
  function helmetModel(lv: number): T.Group {
    const g = new THREE.Group();
    const c = armorMat[Math.min(3, Math.max(1, lv))];
    if (lv <= 1) {
      // a colander: a bowl with a rim and two little handles, and a ring of holes round it
      add(g, G.cap, c, 0, 0, 0, 0.6, 0.5, 0.6);
      add(g, G.band, M.steel, 0, 0.02, 0, 0.6, 0.6, 0.6).rotation.x = Math.PI / 2;
      for (const side of [-1, 1]) add(g, G.box, M.steel, side * 0.66, 0.04, 0, 0.16, 0.05, 0.22);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 + 0.5;
        add(g, G.ball, M.dark, Math.sin(a) * 0.48, 0.24, Math.cos(a) * 0.48, 0.05, 0.05, 0.05);
      }
    } else if (lv === 2) {
      // a saucepan: a short pot with a long handle out the back
      add(g, G.cyl, c, 0, 0.24, 0, 0.52, 0.48, 0.52);
      add(g, G.cyl, M.dark, 0, 0.5, 0, 0.5, 0.04, 0.5);
      add(g, G.band, M.steel, 0, 0.04, 0, 0.52, 0.52, 0.52).rotation.x = Math.PI / 2;
      add(g, G.box, M.dark, 0, 0.12, -0.78, 0.12, 0.08, 0.56);
    } else {
      // a stockpot: tall, two side handles, a lid with a knob
      add(g, G.cyl, c, 0, 0.36, 0, 0.54, 0.72, 0.54);
      add(g, G.band, M.steel, 0, 0.04, 0, 0.54, 0.54, 0.54).rotation.x = Math.PI / 2;
      add(g, G.cyl, M.steel, 0, 0.74, 0, 0.58, 0.06, 0.58);
      add(g, G.ball, M.dark, 0, 0.82, 0, 0.09, 0.07, 0.09);
      for (const side of [-1, 1]) add(g, G.box, M.dark, side * 0.6, 0.42, 0, 0.14, 0.08, 0.3);
    }
    return g;
  }

  /**
   * A vest: an apron round the egg's front, its bib centered on y = 0 and facing +z, its strap ringing the neck in the
   * level's color so it shows from above. Quilted at level 2, steel plated at 3.
   */
  function vestModel(lv: number): T.Group {
    const g = new THREE.Group();
    const c = armorMat[Math.min(3, Math.max(1, lv))];
    add(g, G.apron, c, 0, 0, 0, 0.66, 0.64, 0.66);
    add(g, G.wire, c, 0, 0.4, 0, 0.58, 0.58, 0.58).rotation.x = Math.PI / 2;
    if (lv <= 1) add(g, G.box, M.dark, 0, -0.14, 0.655, 0.3, 0.16, 0.03);
    else if (lv === 2) {
      // stitched squares
      for (const y of [-0.2, 0, 0.2]) add(g, G.box, M.dark, 0, y, 0.66, 0.5, 0.02, 0.02);
      for (const x of [-0.17, 0.17]) add(g, G.box, M.dark, x, 0, 0.655, 0.02, 0.56, 0.02);
    } else {
      // steel plates
      for (const y of [-0.2, 0.02, 0.24]) add(g, G.box, M.steel, 0, y, 0.67, 0.52, 0.17, 0.03);
    }
    return g;
  }

  /** A vest on the ground: an apron laid out flat, bib, skirt, neck loop and ties, with the same marks as when worn. */
  function apronModel(lv: number): T.Group {
    const g = new THREE.Group();
    const c = armorMat[Math.min(3, Math.max(1, lv))];
    add(g, G.box, c, 0, 0.3, 0, 0.42, 0.3, 0.05);
    add(g, G.box, c, 0, -0.12, 0, 0.7, 0.56, 0.05);
    add(g, G.wire, M.dark, 0, 0.56, 0, 0.17, 0.17, 0.17);
    for (const side of [-1, 1]) add(g, G.box, M.dark, side * 0.46, 0.1, 0, 0.24, 0.04, 0.03).rotation.z = side * -0.4;
    if (lv <= 1) add(g, G.box, M.dark, 0, -0.18, 0.03, 0.32, 0.18, 0.02);
    else if (lv === 2) {
      for (const y of [-0.28, -0.06, 0.24]) add(g, G.box, M.dark, 0, y, 0.03, y > 0 ? 0.4 : 0.68, 0.02, 0.02);
      for (const x of [-0.17, 0.17]) add(g, G.box, M.dark, x, -0.12, 0.03, 0.02, 0.54, 0.02);
    } else for (const y of [-0.26, -0.04, 0.26]) add(g, G.box, M.steel, 0, y, 0.035, y > 0 ? 0.36 : 0.6, 0.17, 0.03);
    // lying back, so its front faces up at the camera
    g.rotation.x = -1.1;
    return g;
  }

  function gunModel(w: Held): HeldModel {
    const g = new THREE.Group();
    let stripe: T.Mesh | null = null;
    let spin: T.Object3D | null = null;
    switch (w) {
      case 'spatula':
        add(g, G.box, M.wood, 0, 0, 0.1, 0.06, 0.06, 0.6);
        add(g, G.box, M.spatula, 0, 0, 0.55, 0.32, 0.03, 0.34);
        break;
      case 'whisk':
        add(g, G.box, M.steel, 0, 0, 0.12, 0.06, 0.06, 0.5);
        for (let k = 0; k < 3; k++) {
          const loop = add(g, G.wire, M.steel, 0, 0, 0.58, 0.13, 0.26, 0.13);
          loop.rotation.set(Math.PI / 2, (k * Math.PI) / 3, 0);
        }
        break;
      case 'knife':
        add(g, G.box, M.dark, 0, 0, 0.05, 0.07, 0.08, 0.32);
        add(g, G.box, M.steel, 0, 0.01, 0.55, 0.03, 0.14, 0.7);
        break;
      case 'cleaver':
        add(g, G.box, M.wood, 0, 0, 0.05, 0.07, 0.08, 0.34);
        add(g, G.box, M.steel, 0, 0.09, 0.42, 0.04, 0.34, 0.42);
        break;
      case 'pan':
        add(g, G.box, M.dark, 0, 0, 0.12, 0.06, 0.05, 0.5);
        add(g, G.cyl, M.pan, 0, 0, 0.66, 0.34, 0.08, 0.34);
        break;
      case 'pin':
        barrel(g, M.tan, 0, 0, 0.45, 0.13, 0.8);
        barrel(g, M.wood, 0, 0, -0.05, 0.05, 0.24);
        barrel(g, M.wood, 0, 0, 0.95, 0.05, 0.24);
        break;
      case 'grenade':
        add(g, G.egg, M.grenade, 0, -0.1, 0.25, 0.22, 0.2, 0.22);
        add(g, G.box, M.metal, 0, 0.2, 0.25, 0.08, 0.06, 0.08);
        break;
      case 'flour':
        add(g, G.ball, M.flour, 0, 0, 0.28, 0.2, 0.22, 0.2);
        add(g, G.cyl, M.tan, 0, 0.22, 0.28, 0.06, 0.08, 0.06);
        break;
      case 'sauce':
        add(g, G.cyl, M.sauce, 0, 0, 0.28, 0.1, 0.34, 0.1);
        add(g, G.cyl, M.leaf, 0, 0.23, 0.28, 0.05, 0.12, 0.05);
        break;
      case 'impulse':
        // a blue egg with a white band round it
        add(g, G.egg, M.impulse, 0, -0.12, 0.25, 0.2, 0.2, 0.2);
        add(g, G.band, M.white, 0, 0.05, 0.25, 0.16, 0.16, 0.16).rotation.x = Math.PI / 2;
        break;
      case 'jam':
        // a jar of jam under a checked lid
        add(g, G.cyl, M.jam, 0, 0, 0.28, 0.14, 0.26, 0.14);
        add(g, G.cyl, M.cream, 0, 0.17, 0.28, 0.16, 0.07, 0.16);
        add(g, G.box, M.cream, 0, 0, 0.42, 0.14, 0.1, 0.01);
        break;
      case 'bush':
        // a tin can with a bush poking out of it
        add(g, G.cyl, M.steel, 0, -0.04, 0.28, 0.12, 0.26, 0.12);
        add(g, G.cyl, M.leaf, 0, -0.04, 0.28, 0.125, 0.1, 0.125);
        add(g, G.lowBall, M.leaf, 0, 0.18, 0.28, 0.17, 0.14, 0.17);
        break;
      case 'pistol':
        add(g, G.box, M.dark, 0, 0, 0.12, 0.12, 0.14, 0.42);
        add(g, G.box, M.dark, 0, -0.14, 0, 0.1, 0.22, 0.12);
        stripe = add(g, G.box, rarity[0], 0, 0.08, 0.12, 0.13, 0.03, 0.34);
        break;
      case 'flare':
        // a stubby orange pistol with a wide mouth, the flare showing in it
        add(g, G.box, M.flare, 0, 0, 0.1, 0.13, 0.15, 0.36);
        barrel(g, M.flare, 0, 0.01, 0.36, 0.1, 0.22);
        barrel(g, M.custard, 0, 0.01, 0.47, 0.07, 0.02);
        add(g, G.box, M.flare, 0, -0.15, -0.02, 0.1, 0.22, 0.12);
        stripe = add(g, G.box, rarity[0], 0, 0.085, 0.06, 0.135, 0.03, 0.22);
        break;
      case 'revolver':
        barrel(g, M.metal, 0, 0.04, 0.36, 0.05, 0.5);
        barrel(g, M.dark, 0, 0.0, 0.08, 0.1, 0.16);
        add(g, G.box, M.wood, 0, -0.15, -0.04, 0.1, 0.24, 0.12);
        stripe = add(g, G.box, rarity[0], 0, 0.1, 0.08, 0.06, 0.03, 0.2);
        break;
      case 'smg':
        add(g, G.box, M.dark, 0, 0, 0.18, 0.14, 0.17, 0.62);
        add(g, G.box, M.metal, 0, -0.18, 0.2, 0.08, 0.26, 0.1);
        add(g, G.box, M.dark, 0, -0.12, -0.06, 0.1, 0.2, 0.1);
        stripe = add(g, G.box, rarity[0], 0, 0.1, 0.18, 0.15, 0.03, 0.5);
        break;
      case 'micro':
        add(g, G.box, M.dark, 0, 0, 0.12, 0.13, 0.16, 0.4);
        add(g, G.box, M.metal, 0, -0.2, 0.06, 0.07, 0.3, 0.08);
        barrel(g, M.metal, 0, 0.02, 0.38, 0.035, 0.16);
        stripe = add(g, G.box, rarity[0], 0, 0.09, 0.12, 0.14, 0.03, 0.3);
        break;
      case 'hsmg':
        // chunky, with a fat green box of heavy rounds and a grip out front
        add(g, G.box, M.dark, 0, 0, 0.2, 0.17, 0.2, 0.66);
        barrel(g, M.metal, 0, 0.03, 0.6, 0.045, 0.2);
        add(g, G.box, ammoMat.heavy, 0, -0.21, 0.2, 0.1, 0.3, 0.14);
        add(g, G.box, M.dark, 0, -0.14, 0.45, 0.07, 0.18, 0.07);
        add(g, G.box, M.dark, 0, -0.12, -0.08, 0.1, 0.2, 0.1);
        stripe = add(g, G.box, rarity[0], 0, 0.115, 0.18, 0.18, 0.03, 0.5);
        break;
      case 'marksman':
        // long and tan, a scope on top and a short magazine
        add(g, G.box, M.tan, 0, 0, 0.3, 0.12, 0.15, 1.0);
        barrel(g, M.dark, 0, 0.02, 0.92, 0.035, 0.42);
        barrel(g, M.dark, 0, 0.15, 0.3, 0.05, 0.34);
        add(g, G.box, M.dark, 0, -0.15, 0.32, 0.07, 0.16, 0.12);
        stripe = add(g, G.box, rarity[0], 0, 0.085, 0.55, 0.13, 0.03, 0.34);
        break;
      case 'rifle':
        add(g, G.box, M.dark, 0, 0, 0.3, 0.12, 0.16, 1.05);
        add(g, G.box, M.metal, 0, -0.17, 0.3, 0.08, 0.24, 0.12);
        add(g, G.box, M.dark, 0, 0.14, 0.2, 0.06, 0.1, 0.3);
        stripe = add(g, G.box, rarity[0], 0, 0.09, 0.45, 0.13, 0.03, 0.5);
        break;
      case 'burst':
        add(g, G.box, M.tan, 0, 0, 0.22, 0.14, 0.2, 0.78);
        barrel(g, M.dark, 0, 0.03, 0.72, 0.04, 0.3);
        add(g, G.box, M.dark, 0, 0.16, 0.25, 0.05, 0.08, 0.5);
        add(g, G.box, M.metal, 0, -0.16, 0.0, 0.08, 0.2, 0.12);
        stripe = add(g, G.box, rarity[0], 0, 0.11, 0.35, 0.15, 0.03, 0.3);
        break;
      case 'scout':
        add(g, G.box, M.olive, 0, 0, 0.25, 0.11, 0.14, 0.9);
        barrel(g, M.metal, 0, 0.02, 0.85, 0.035, 0.4);
        barrel(g, M.dark, 0, 0.15, 0.25, 0.05, 0.3);
        stripe = add(g, G.box, rarity[0], 0, 0.08, 0.05, 0.12, 0.03, 0.3);
        break;
      case 'lmg':
        add(g, G.box, M.dark, 0, 0, 0.3, 0.16, 0.2, 1.0);
        barrel(g, M.metal, 0, 0.03, 0.95, 0.05, 0.5);
        add(g, G.box, M.olive, 0, -0.2, 0.25, 0.2, 0.22, 0.26);
        add(g, G.box, M.metal, 0, -0.2, 0.95, 0.03, 0.3, 0.03).rotation.x = 0.4;
        stripe = add(g, G.box, rarity[0], 0, 0.11, 0.35, 0.17, 0.03, 0.5);
        break;
      case 'minigun': {
        // a drum of a body, a carry handle, and six barrels that spin
        add(g, G.box, M.dark, 0, 0, 0.12, 0.26, 0.26, 0.42);
        add(g, G.box, M.metal, 0, 0.2, 0.12, 0.05, 0.1, 0.3);
        add(g, G.box, ammoMat.light, 0.2, -0.04, 0.05, 0.12, 0.2, 0.26);
        const bundle = new THREE.Group();
        bundle.position.set(0, 0, 0.62);
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2;
          barrel(bundle, M.metal, Math.cos(a) * 0.07, Math.sin(a) * 0.07, 0, 0.028, 0.62);
        }
        barrel(bundle, M.dark, 0, 0, 0.18, 0.11, 0.05);
        g.add(bundle);
        spin = bundle;
        stripe = add(g, G.box, rarity[0], 0, 0.135, 0.02, 0.27, 0.03, 0.2);
        break;
      }
      case 'shotgun':
        add(g, G.box, M.wood, 0, -0.02, 0, 0.13, 0.16, 0.45);
        barrel(g, M.dark, 0, 0.03, 0.48, 0.07, 0.75);
        stripe = add(g, G.box, rarity[0], 0, -0.06, 0.4, 0.12, 0.08, 0.28);
        break;
      case 'auto':
        add(g, G.box, M.dark, 0, 0, 0.15, 0.15, 0.18, 0.6);
        barrel(g, M.metal, 0, 0.03, 0.62, 0.06, 0.4);
        barrel(g, M.metal, 0, -0.18, 0.25, 0.14, 0.12).rotation.set(0, 0, Math.PI / 2);
        stripe = add(g, G.box, rarity[0], 0, 0.1, 0.15, 0.16, 0.03, 0.4);
        break;
      case 'double':
        add(g, G.box, M.wood, 0, -0.03, 0, 0.13, 0.15, 0.42);
        barrel(g, M.dark, -0.045, 0.04, 0.5, 0.05, 0.72);
        barrel(g, M.dark, 0.045, 0.04, 0.5, 0.05, 0.72);
        stripe = add(g, G.box, rarity[0], 0, -0.05, 0.3, 0.14, 0.06, 0.12);
        break;
      case 'sniper':
        add(g, G.box, M.dark, 0, 0, 0.2, 0.11, 0.14, 0.75);
        barrel(g, M.metal, 0, 0.02, 0.85, 0.035, 0.7);
        barrel(g, M.dark, 0, 0.16, 0.25, 0.06, 0.38);
        stripe = add(g, G.box, rarity[0], 0, 0.08, 0.05, 0.12, 0.03, 0.3);
        break;
      case 'crossbow':
        add(g, G.box, M.wood, 0, 0, 0.2, 0.1, 0.12, 0.75);
        add(g, G.box, M.dark, 0, 0.02, 0.56, 0.9, 0.05, 0.06);
        add(g, G.box, M.bolt, 0, 0.08, 0.4, 0.03, 0.03, 0.7);
        stripe = add(g, G.box, rarity[0], 0, -0.07, 0.1, 0.11, 0.04, 0.3);
        break;
      case 'launcher':
        barrel(g, M.launcher, 0, 0.05, 0.3, 0.17, 1.1);
        add(g, G.box, M.dark, 0, -0.16, 0.2, 0.08, 0.24, 0.12);
        stripe = barrel(g, rarity[0], 0, 0.05, 0.75, 0.18, 0.12);
        break;
    }
    return { group: g, stripe, spin };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Eggs.

  const eggs: EggView[] = m.fighters.map((f) => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    const skin = lambert(0xfff3df, { emissive: 0x000000 });
    add(body, G.egg, skin, 0, 0, 0, 1, 1, 1);
    const hatMat = lambert(parseInt(f.color.slice(1), 16));
    const hat = [add(body, G.cap, hatMat, 0, 1.08, 0, 0.5, 0.52, 0.5), add(body, G.band, hatMat, 0, 1.1, 0, 0.47, 0.47, 0.47), add(body, G.ball, hatMat, 0, 1.64, 0, 0.11, 0.11, 0.11)];
    hat[1].rotation.x = Math.PI / 2;
    for (const side of [-1, 1]) add(body, G.ball, M.black, side * 0.17, 1.0, 0.53, 0.065, 0.085, 0.05);
    for (const side of [-1, 1]) add(body, G.ball, M.cream, side * 0.4, 0.72, 0.42, 0.11, 0.11, 0.11);
    const hand = new THREE.Group();
    hand.position.set(0.24, 0.78, 0.48);
    body.add(hand);
    // a frying pan slung across the back stops bullets from behind
    const backPan = new THREE.Group();
    add(backPan, G.cyl, M.pan, 0, 0, 0, 0.36, 0.06, 0.36);
    add(backPan, G.box, M.dark, 0, 0, 0.48, 0.06, 0.05, 0.4);
    backPan.position.set(0, 0.9, -0.5);
    backPan.rotation.set(Math.PI / 2 - 0.25, 0, 0);
    body.add(backPan);
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
    // a cross over the head while healing; a ring while drinking shield (blue) or coffee (orange)
    const heal = new THREE.Group();
    heal.position.y = 2.15;
    const cross = [add(heal, G.box, M.green, 0, 0, 0, 0.42, 0.12, 0.12), add(heal, G.box, M.green, 0, 0, 0, 0.12, 0.42, 0.12)];
    root.add(heal);
    const ring = add(root, G.band, M.blue, 0, 0.9, 0, 0.9, 0.9, 0.9);
    ring.rotation.x = Math.PI / 2;
    const ghost = new THREE.Mesh(G.egg, M.ghost);
    ghost.scale.setScalar(1.05);
    ghost.position.y = -0.04;
    ghost.renderOrder = 20;
    body.add(ghost);
    scene.add(root);
    return { root, body, skin, hand, guns: new Map(), shadow, glider, heal, cross, ring, ghost, backPan, hat, helmet: null, helmetLv: 0, vest: null, vestLv: 0, walk: 0, swing: 0, recoil: 0, lean: 0 };
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
      case 'gun':
      case 'melee':
      case 'throw': {
        const gun = gunModel(def.w);
        if (gun.stripe && def.kind === 'gun') gun.stripe.material = rarity[def.r] ?? rarity[0];
        gun.group.scale.setScalar(def.kind === 'throw' ? 1.6 : 1.25);
        gun.group.rotation.set(0, 0, def.kind === 'throw' ? 0 : Math.PI / 2.4);
        g.add(gun.group);
        break;
      }
      case 'ammo':
        add(g, G.box, ammoMat[def.a], 0, 0, 0, 0.5, 0.32, 0.36);
        add(g, G.box, M.dark, 0, 0.17, 0, 0.52, 0.04, 0.38);
        break;
      case 'use':
        switch (def.w) {
          case 'bandage':
            add(g, G.box, M.white, 0, 0, 0, 0.5, 0.18, 0.36);
            add(g, G.box, M.red, 0, 0.1, 0, 0.3, 0.02, 0.09);
            add(g, G.box, M.red, 0, 0.1, 0, 0.09, 0.02, 0.3);
            break;
          case 'medkit':
            add(g, G.box, M.white, 0, 0, 0, 0.62, 0.42, 0.42);
            add(g, G.box, M.red, 0, 0, 0.215, 0.36, 0.11, 0.01);
            add(g, G.box, M.red, 0, 0, 0.215, 0.11, 0.3, 0.01);
            add(g, G.box, M.dark, 0, 0.27, 0, 0.24, 0.06, 0.06);
            break;
          case 'mini':
            add(g, G.ball, M.mini, 0, -0.05, 0, 0.18, 0.2, 0.18);
            add(g, G.cyl, M.white, 0, 0.18, 0, 0.06, 0.1, 0.06);
            break;
          case 'shield':
            add(g, G.cyl, M.potion, 0, 0, 0, 0.18, 0.42, 0.18);
            add(g, G.cyl, M.white, 0, 0.27, 0, 0.08, 0.14, 0.08);
            break;
          case 'coffee':
            add(g, G.cyl, M.cream, 0, 0, 0, 0.16, 0.38, 0.16);
            add(g, G.cyl, M.coffee, 0, 0.21, 0, 0.17, 0.06, 0.17);
            add(g, G.cyl, M.coffee, 0, -0.02, 0, 0.165, 0.12, 0.165);
            break;
          case 'smoothie': {
            // a pink cup with a lid and a blue straw
            add(g, G.cyl, M.smoothie, 0, 0, 0, 0.17, 0.4, 0.15);
            add(g, G.cyl, M.cream, 0, 0.22, 0, 0.19, 0.05, 0.19);
            const straw = add(g, G.cyl, M.straw, 0.05, 0.36, 0, 0.025, 0.3, 0.025);
            straw.rotation.z = -0.35;
            break;
          }
          case 'tart':
            // a golden egg tart: a crimped crust round a shining custard
            add(g, G.cyl, M.crust, 0, -0.05, 0, 0.36, 0.14, 0.36);
            add(g, G.band, M.crust, 0, 0.03, 0, 0.34, 0.34, 0.5).rotation.x = Math.PI / 2;
            add(g, G.cyl, M.custard, 0, 0.04, 0, 0.3, 0.04, 0.3);
            break;
        }
        break;
      case 'scope':
        barrel(g, M.dark, 0, 0, 0, 0.12, 0.5);
        barrel(g, rarity[Math.min(4, def.lv + 1)], 0, 0, 0.26, 0.14, 0.04);
        barrel(g, rarity[Math.min(4, def.lv + 1)], 0, 0, -0.26, 0.14, 0.04);
        break;
      case 'pack':
        add(g, G.box, rarity[Math.min(4, def.lv + 1)], 0, 0, 0, 0.5, 0.5, 0.3);
        add(g, G.cap, rarity[Math.min(4, def.lv + 1)], 0, 0.25, 0, 0.25, 0.14, 0.15);
        add(g, G.box, M.dark, 0, -0.05, 0.16, 0.36, 0.2, 0.04);
        break;
      case 'helmet': {
        const h = helmetModel(def.lv);
        h.position.y = -0.2;
        h.scale.setScalar(0.8);
        g.add(h);
        break;
      }
      case 'vest': {
        g.add(apronModel(def.lv));
        break;
      }
      case 'wood':
        for (let i = 0; i < 3; i++) add(g, G.box, M.wood, 0, i * 0.13 - 0.1, (i - 1) * 0.06, 0.7, 0.11, 0.2).rotation.y = i * 0.4;
        break;
    }
    return g;
  }
  function glowFor(def: LootDef) {
    switch (def.kind) {
      case 'gun':
        return rarityGlow[def.r] ?? rarityGlow[0];
      case 'ammo':
        return ammoGlow[def.a];
      case 'use':
        return rarityGlow[USE_GLOW[def.w]];
      case 'scope':
      case 'pack':
      case 'helmet':
      case 'vest':
        return rarityGlow[Math.min(4, def.lv + 1)];
      case 'melee':
        return rarityGlow[2];
      case 'throw':
        return rarityGlow[3];
      default:
        return rarityGlow[0];
    }
  }
  function lootView(l: LootItem): LootView {
    const group = new THREE.Group();
    group.position.set(l.x, 0, l.z);
    const glow = new THREE.Mesh(G.ring, glowFor(l.def));
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = 0.04;
    glow.scale.setScalar(l.def.kind === 'gun' || l.def.kind === 'melee' ? 0.75 : 0.5);
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

  // things thrown, and the clouds and puddles they leave
  const tossViews = new Map<Toss, T.Group>();
  const zoneViews = new Map<Zone, { group: T.Group; mat: T.MeshBasicMaterial | T.MeshLambertMaterial; flames: T.Mesh[] }>();
  const flourMat = (): T.MeshLambertMaterial => lambert(0xffffff, { emissive: 0x8a8578, transparent: true, opacity: 0.85, depthWrite: false });
  const sauceMat = (): T.MeshBasicMaterial => basic(0xd2321e, { transparent: true, opacity: 0.75, depthWrite: false });
  const flameMat = basic(0xffa53a, { transparent: true, opacity: 0.85, depthWrite: false });
  const jamMat = (): T.MeshLambertMaterial => lambert(0x9e1c48, { emissive: 0x2a0010, transparent: true, opacity: 0.85, depthWrite: false });
  const jamShine = basic(0xff8fb4, { transparent: true, opacity: 0.55, depthWrite: false });
  const grownMat = (): T.MeshLambertMaterial => lambert(0x4c9b3c, { flatShading: true, transparent: true, opacity: 1 });

  // an impulse egg's shove: a ring rushing out along the ground
  const waves: { mesh: T.Mesh; mat: T.MeshBasicMaterial; life: number; r: number }[] = [];
  for (let i = 0; i < 6; i++) {
    const wm = basic(0xbcd7ff, { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(G.ring, wm);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    waves.push({ mesh, mat: wm, life: 0, r: 1 });
  }
  let waveAt = 0;

  // flares going up: a bright ball that climbs, hangs and burns out
  const flareMat = basic(0xff4a2a);
  const flareGlow = basic(0xffb07a, { transparent: true, opacity: 0.45, depthWrite: false });
  const flares: { core: T.Mesh; glow: T.Mesh; x: number; z: number; at: number }[] = [];

  // gold beams over legendary loot, seen from anywhere
  const beamGold = basic(0xffd23d, { transparent: true, opacity: 0.3, depthWrite: false });
  const ringGold = basic(0xffd23d, { transparent: true, opacity: 0.8, depthWrite: false, side: THREE.DoubleSide });
  const goldBeams = many(G.cyl, beamGold, BEAMS);
  const goldRings = many(G.ring, ringGold, BEAMS);
  goldBeams.count = 0;
  goldRings.count = 0;
  goldBeams.renderOrder = 4;
  // they move about with the loot, so they're never culled by where they first stood
  goldBeams.frustumCulled = false;
  goldRings.frustumCulled = false;
  scene.add(goldBeams, goldRings);

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
    flour: basic(0xfaf6ec, { transparent: true, opacity: 0.8, depthWrite: false }),
    sauce: basic(0xd2321e),
    metal: lambert(0xc9d0d8),
    red: lambert(0xd8432f),
    splash: basic(0xbfe6f5, { transparent: true, opacity: 0.8, depthWrite: false }),
    jam: basic(0xa3214a),
    glass: basic(0xe6f2f7, { transparent: true, opacity: 0.7, depthWrite: false }),
    shove: basic(0x8fc4ff),
    straw: lambert(0xe2c25a),
  };
  const padFlash = basic(0x7dffd2, { transparent: true, opacity: 0.7, depthWrite: false });
  for (let i = 0; i < 320; i++) {
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
  for (let i = 0; i < 28; i++) {
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
    // wading through a pond sinks an egg to its middle
    v.root.position.set(f.x, f.y - (f.wet && f.phase === 'ground' ? 0.45 : 0), f.z);
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
    v.shadow.visible = (f.phase === 'ground' && !f.wet) || (f.phase === 'drop' && f.y < 25);
    v.shadow.position.y = 0.03 - f.y;
    v.shadow.scale.setScalar(0.85 * (1 + f.y * 0.02));
    // what it holds
    const h = held(f);
    const key = h.w;
    for (const [k, g] of v.guns) g.group.visible = k === key && f.phase === 'ground';
    let gun = v.guns.get(key);
    if (!gun && f.phase === 'ground') {
      gun = gunModel(key);
      v.hand.add(gun.group);
      v.guns.set(key, gun);
    }
    if (gun?.stripe) gun.stripe.material = rarity[h.r] ?? rarity[0];
    if (gun?.spin && ((f.kind === 'remote' ? f.show.flags & F_SPIN : f.spin > 0) || 0)) gun.spin.rotation.z += dt * (f.kind === 'remote' ? 30 : 6 + f.spin * 26);
    const melee = isMelee(key);
    v.recoil = Math.max(0, v.recoil - dt * 6);
    v.swing = Math.max(0, v.swing - dt * 5);
    v.hand.position.z = 0.48 - v.recoil * 0.18;
    v.hand.rotation.y = melee ? -Math.sin(v.swing * Math.PI) * 1.6 : 0;
    v.hand.rotation.x = melee ? -0.4 : isThrow(key) ? -0.9 + v.swing * 1.4 : (f.kind === 'remote' ? f.show.flags & F_RELOAD : f.reloadT > 0) ? 0.7 : 0;
    const pan = f.kind === 'remote' ? (f.show.flags & F_PAN) !== 0 : MELEE[f.melee].blocks === true;
    v.backPan.visible = pan && key !== 'pan' && f.phase === 'ground';
    // the armor it wears
    if (v.helmetLv !== f.helmet) {
      if (v.helmet) v.body.remove(v.helmet);
      v.helmet = f.helmet > 0 ? helmetModel(f.helmet) : null;
      if (v.helmet) {
        v.helmet.position.y = 1.1;
        v.body.add(v.helmet);
      }
      v.helmetLv = f.helmet;
      for (const o of v.hat) o.visible = f.helmet <= 0;
    }
    if (v.vestLv !== f.vest) {
      if (v.vest) v.body.remove(v.vest);
      v.vest = f.vest > 0 ? vestModel(f.vest) : null;
      if (v.vest) {
        v.vest.position.y = 0.52;
        v.body.add(v.vest);
      }
      v.vestLv = f.vest;
    }
    // flash red when hit; healing, shield and coffee show while in use
    const hit = f.hitT > 0;
    v.skin.emissive.setHex(hit ? 0xff3b30 : 0x000000);
    v.skin.emissiveIntensity = hit ? 0.55 : 0;
    const flags = f.kind === 'remote' ? f.show.flags : 0;
    const using =
      f.kind === 'remote'
        ? flags & F_HEALING
          ? 'heal'
          : flags & F_SHIELDING
            ? 'shield'
            : flags & F_DRINKING
              ? 'coffee'
              : flags & F_SMOOTHIE
                ? 'smoothie'
                : flags & F_TART
                  ? 'tart'
                  : null
        : f.using === 'bandage' || f.using === 'medkit'
          ? 'heal'
          : f.using === 'mini' || f.using === 'shield'
            ? 'shield'
            : f.using;
    // a cross while healing (gold for a tart); a ring while drinking shield, a smoothie or coffee
    v.heal.visible = using === 'heal' || using === 'tart';
    if (v.heal.visible) {
      v.heal.rotation.y = clock * 4;
      for (const c of v.cross) c.material = using === 'tart' ? M.goldCross : M.green;
    }
    v.ring.visible = using === 'shield' || using === 'coffee' || using === 'smoothie';
    if (v.ring.visible) {
      v.ring.material = using === 'coffee' ? M.orange : using === 'smoothie' ? M.pink : M.blue;
      v.ring.position.y = 0.4 + ((clock * 1.4) % 1) * 1.3;
      v.ring.scale.setScalar(0.85 - ((clock * 1.4) % 1) * 0.25);
    }
    v.ghost.visible = focus && f.phase === 'ground';
  }

  function syncTosses(m: Match, clock: number) {
    for (const [t, g] of tossViews) {
      if (!m.tosses.includes(t)) {
        scene.remove(g);
        tossViews.delete(t);
      }
    }
    for (const t of m.tosses) {
      let g = tossViews.get(t);
      if (!g) {
        g = new THREE.Group();
        // drawn big enough to see coming
        const model = gunModel(t.k).group;
        model.position.set(0, 0, -0.28 * 2.4);
        model.scale.setScalar(2.4);
        g.add(model);
        scene.add(g);
        tossViews.set(t, g);
      }
      const p = tossAt(t, m.time);
      g.position.set(p.x, p.y, p.z);
      if (!t.landed) g.rotation.set(clock * 9, clock * 5, 0);
      else {
        g.rotation.set(0, 0, 0);
        // a grenade on the ground blinks faster as it gets close
        const left = t.fuse - m.time;
        g.scale.setScalar(left < 1 && Math.sin(clock * (left < 0.5 ? 40 : 22)) > 0 ? 1.15 : 1);
      }
    }
  }

  function syncZones(m: Match, clock: number, focus: Fighter | undefined) {
    for (const [z, v] of zoneViews) {
      if (!m.zones.includes(z)) {
        scene.remove(v.group);
        zoneViews.delete(z);
      }
    }
    for (const z of m.zones) {
      let v = zoneViews.get(z);
      if (!v) {
        const group = new THREE.Group();
        group.position.set(z.x, 0, z.z);
        const flames: T.Mesh[] = [];
        let material: T.MeshBasicMaterial | T.MeshLambertMaterial;
        if (z.k === 'flour') {
          material = flourMat();
          const rnd = scatter(Math.round(z.x * 13 + z.z * 7 + z.from * 100) >>> 0);
          // soft puffs: a big one in the middle, a ring round it, and a few on top
          add(group, G.ball, material, 0, 1.6, 0, z.r * 0.62, 2.6, z.r * 0.62);
          for (let i = 0; i < 10; i++) {
            const a = (i / 10) * Math.PI * 2 + rnd() * 0.5;
            const d = z.r * (0.5 + rnd() * 0.3);
            const s = z.r * (0.3 + rnd() * 0.14);
            add(group, G.ball, material, Math.cos(a) * d, 0.9 + rnd() * 1.4, Math.sin(a) * d, s, s * 0.75, s);
          }
          for (let i = 0; i < 4; i++) {
            const a = rnd() * Math.PI * 2;
            const d = z.r * rnd() * 0.4;
            add(group, G.ball, material, Math.cos(a) * d, 2.8 + rnd(), Math.sin(a) * d, z.r * 0.28, z.r * 0.2, z.r * 0.28);
          }
        } else if (z.k === 'jam') {
          // a dark red puddle with a few blobs of fruit in it
          material = jamMat();
          const pool = add(group, G.disc, material, 0, 0.06, 0, z.r, z.r, z.r);
          pool.rotation.x = -Math.PI / 2;
          const rnd = scatter(Math.round(z.x * 11 + z.z * 5 + z.from * 100) >>> 0);
          for (let i = 0; i < 8; i++) {
            const a = rnd() * Math.PI * 2;
            const d = z.r * (0.2 + rnd() * 0.7);
            const blob = add(group, G.lowBall, material, Math.cos(a) * d, 0.08, Math.sin(a) * d, 0.25 + rnd() * 0.25, 0.12, 0.25 + rnd() * 0.25);
            blob.rotation.y = rnd() * 6;
            // a glint on the sticky top
            add(group, G.disc, jamShine, Math.cos(a) * d - 0.08, 0.15, Math.sin(a) * d - 0.08, 0.09, 0.09, 0.09).rotation.x = -Math.PI / 2;
          }
          // and the jar it came in, tipped over in the middle
          const jar = add(group, G.cyl, M.glass, 0.3, 0.2, -0.2, 0.2, 0.42, 0.2);
          jar.rotation.set(Math.PI / 2, 0, 0.6);
          add(jar, G.cyl, M.cream, 0, 0.55, 0, 1.1, 0.16, 1.1);
        } else if (z.k === 'bush') {
          // a bush springs up out of the can: a big round middle and a few clumps round it
          material = grownMat();
          add(group, G.ball, material, 0, 0.95, 0, z.r * 0.95, 1.4, z.r * 0.95);
          const rnd = scatter(Math.round(z.x * 7 + z.z * 13 + z.from * 100) >>> 0);
          for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2 + rnd();
            add(group, G.ball, material, Math.cos(a) * z.r * 0.55, 0.6 + rnd() * 0.5, Math.sin(a) * z.r * 0.55, z.r * 0.5, 0.75, z.r * 0.5);
          }
          add(group, G.cyl, M.steel, 0, 0.12, 0, 0.16, 0.24, 0.16);
        } else {
          material = sauceMat();
          const pool = add(group, G.disc, material, 0, 0.06, 0, z.r, z.r, z.r);
          pool.rotation.x = -Math.PI / 2;
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const d = z.r * (i === 0 ? 0 : 0.6);
            flames.push(add(group, G.pine, flameMat, Math.cos(a) * d, 0.5, Math.sin(a) * d, 0.35, 1, 0.35));
          }
        }
        scene.add(group);
        v = { group, mat: material, flames };
        zoneViews.set(z, v);
      }
      // in quickly, out slowly; a cloud or bush you're inside thins so you can see your way
      const life = Math.min(1, (m.time - z.from) / 0.5, (z.until - m.time) / 2);
      const inside = !!focus && Math.hypot(focus.x - z.x, focus.z - z.z) < z.r;
      if (z.k === 'bush') {
        // it grows in a moment, and shrinks away at the end
        const grow = Math.min(1, (m.time - z.from) / 0.45, Math.max(0, (z.until - m.time) / 0.8));
        v.group.scale.setScalar(0.15 + grow * 0.85);
        v.mat.opacity = inside ? 0.55 : 1;
        v.mat.depthWrite = !inside;
        continue;
      }
      v.mat.opacity = Math.max(0, life) * (z.k === 'flour' ? (inside ? 0.45 : 0.9) : z.k === 'jam' ? 0.85 : 0.75);
      v.group.scale.setScalar(z.k === 'flour' ? 0.6 + Math.min(1, (m.time - z.from) / 0.6) * 0.4 : 1);
      if (z.k === 'flour') v.group.rotation.y = (m.time - z.from) * 0.15;
      v.flames.forEach((fl, i) => {
        fl.scale.set(0.35, 0.7 + Math.abs(Math.sin(clock * 9 + i * 1.7)) * 0.9 * Math.max(0, life), 0.35);
        fl.position.y = fl.scale.y / 2 + 0.05;
      });
    }
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
        // something high up shows nearer the top of the screen than the ground under it, so look past the ground
        // (north) to keep it in the middle: all the way for the bus, most of the way for a glider, which keeps its
        // landing spot in view below it
        if (focus.phase === 'bus') {
          const p = busAt(map.bus, m.time);
          tx = p.x;
          tz = p.z - (BUS_Y + 3 * BUS_SCALE) / Math.tan(TILT);
          // a tall, narrow screen would otherwise pull far back to fit the width, leaving the bus a speck
          const aspect = width / height;
          want = aspect < 1 ? (BUS_VIEW * aspect) / Math.max(aspect, 0.8) : BUS_VIEW;
        } else {
          tx = focus.x;
          tz = focus.z - (focus.y * 0.8) / Math.tan(TILT);
          want = focus.phase === 'drop' ? DROP_VIEW + (focus.y / BUS_Y) * 20 : GROUND_VIEW + viewOf(focus);
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
      fog.far = dist + 560;

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

      // roofs lift off the building you're in, and thin while you stand at one of its doors or line up with one
      const afoot = !!focus && focus.phase === 'ground';
      const inside = afoot ? focus.inside : -1;
      const peek = afoot && inside < 0 ? peekAt(map, focus.x, focus.z) : -1;
      for (const r of roofs) {
        r.fade = damp(r.fade, r.at === inside ? 0.08 : r.at === peek ? 0.25 : 1, 10, dt);
        for (const x of r.mats) {
          x.opacity = r.fade;
          x.depthWrite = r.fade > 0.98;
        }
        r.mesh.visible = r.fade > 0.03;
        showFurniture(r.at, r.fade < 0.98);
      }
      // the river runs, the windmills turn, and the grass and flowers show once you're down among them
      riverTex.offset.y = -clock * 0.15;
      for (const t of sails) t.rotation.z = -clock * 0.6;
      decor.visible = cam.view < 34;

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
        tint.set(Math.max(0, s.r), 900);
        stormTint.visible = onLand;
        const showNext = s.next.r < s.r - 0.5 || s.shrinking;
        nextMesh.visible = showNext && s.next.r > 0.3;
        nextMesh.position.set(nx, 0.14, nz);
        nextRing.set(Math.max(0, s.next.r - 0.3), s.next.r + 0.3);
      }

      placeChests(false);
      placeCrates(clock);
      placeFridges(false);
      placeKitchen(clock);
      chestGlowMat.opacity = 0.35 + Math.sin(clock * 4) * 0.2;

      // campfires flicker (and throw the odd spark when you're close), pads pulse
      placeFires(clock);
      for (const c of map.fires) if (Math.random() < 0.08 && Math.abs(c.x - cam.x) < cam.view * 2 && Math.abs(c.z - cam.z) < cam.view * 2) burst(c.x, 1, c.z, 1, 1.2, 0.08, 0.7, [partMat.spark], -2);
      fireGlowMat.opacity = 0.5 + Math.sin(clock * 11) * 0.07 + Math.sin(clock * 23) * 0.04;
      for (const [i, pd] of pads.entries()) {
        const k = (clock * 0.8 + i * 0.3) % 1;
        pd.ring.scale.setScalar(PAD.r + 0.3 + k * 1.2);
        pd.top.position.y = 0.17 + Math.sin(clock * 3 + i) * 0.03;
      }
      padRingMat.opacity = 0.7 - ((clock * 0.8) % 1) * 0.6;

      // supply drops float down under their balloons, then sit with a beam over them until someone opens them
      for (const sp of supplies) {
        const c = sp.c;
        const coming = m.time >= c.at - SUPPLY_FALL;
        const opened = m.opened[c.id];
        sp.group.visible = coming;
        sp.beam.visible = coming && !opened;
        if (!coming) continue;
        // one a flare called only knows where it lands once it's called
        if (c.flare) {
          sp.group.position.x = c.x;
          sp.group.position.z = c.z;
          sp.beam.position.set(c.x, 40, c.z);
        }
        const u = Math.max(0, Math.min(1, (c.at - m.time) / SUPPLY_FALL));
        sp.group.position.y = u * 46;
        sp.group.rotation.y = u * 3;
        sp.balloon.visible = u > 0;
        sp.glow.visible = u === 0 && !opened;
        sp.glow.scale.setScalar(2.3 + Math.sin(clock * 4) * 0.15);
        sp.box.material = opened ? supplyOpen : supplyMat;
        sp.box.scale.y = opened ? SUPPLY_HALF * 1.2 : SUPPLY_HALF * 2;
        sp.box.position.y = opened ? SUPPLY_HALF * 0.6 : SUPPLY_HALF;
        beamMat.opacity = 0.16 + Math.sin(clock * 3) * 0.06;
      }

      // eggs (peeking in through a door shows only who the doorway lets you see)
      m.fighters.forEach((f, i) => {
        const v = eggs[i];
        if (!v) return;
        const isFocus = i === focusId;
        const walled = peek >= 0 && !!focus && f.inside === peek && !clearLine(m, focus.x, focus.z, f.x, f.z);
        syncEgg(v, f, dt, clock, isFocus, !isFocus && (concealed(m, f, focus) || walled));
      });
      syncTosses(m, clock);
      syncZones(m, clock, focus);

      // aim line and landing marker
      const me = focus && opts.aimLine ? focus : null;
      const hm = me ? held(me) : null;
      const aimGun = hm && isWeapon(hm.w) ? hm.w : null;
      const aimThrow = !!hm && isThrow(hm.w);
      aimLine.visible = !!me && me.phase === 'ground' && (!!aimGun || aimThrow);
      if (aimLine.visible && me) {
        const len = aimGun ? Math.min(WEAPONS[aimGun].range, 26) : Math.min(20, me.input.reach > 0 ? me.input.reach : 14);
        const fx = Math.sin(me.aim);
        const fz = Math.cos(me.aim);
        aimLine.position.set(me.x + fx * (0.9 + len / 2), 0.95, me.z + fz * (0.9 + len / 2));
        aimLine.rotation.set(-Math.PI / 2, 0, me.aim);
        aimLine.scale.set(aimThrow ? 0.09 : 0.05, len, 1);
      }
      landMark.visible = !!focus && focus.phase === 'drop';
      if (landMark.visible && focus) {
        landMark.position.set(focus.x, 0.1, focus.z);
        landMark.scale.setScalar(1.2 + Math.sin(clock * 6) * 0.15);
      }

      // loot in frame (with a little to spare), once it's close enough to make out (from the sky it's specks)
      const showLoot = cam.view < LOOT_VIEW;
      const lootN = dist * FRAME_N + 3;
      const lootS = dist * FRAME_S + 3;
      const lootW = dist * FRAME_W * aspect + 3;
      for (const [id, lv] of lootViews) {
        if (!m.loot.has(id)) {
          scene.remove(lv.group);
          lootViews.delete(id);
        }
      }
      for (const l of m.loot.values()) {
        const near = showLoot && Math.abs(l.x - cam.x) < lootW && l.z - cam.z > -lootN && l.z - cam.z < lootS;
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
        // a crossbow bolt is a short brown arrow; everything else a streak of light
        const bolt = b.w === 'crossbow';
        const len = bolt ? 0.9 : Math.min(2.4, b.traveled - 0.5);
        tr.visible = true;
        tr.material = bolt ? M.bolt : M.tracer;
        tr.position.set(b.x - (b.dx * len) / 2, 1.0, b.z - (b.dz * len) / 2);
        tr.rotation.set(0, Math.atan2(b.dx, b.dz), 0);
        tr.scale.set(bolt ? 0.7 : 1, bolt ? 0.7 : 1, len);
      }
      for (let i = ti; i < tracers.length; i++) tracers[i].visible = false;
      for (let i = ri; i < rockets.length; i++) rockets[i].visible = false;

      // gold beams over legendary loot, taller the farther out the camera is
      let gi = 0;
      const beamH = 9 + Math.min(14, cam.view * 0.25);
      for (const l of m.loot.values()) {
        if (gi >= BEAMS || !legendary(l.def)) continue;
        dummy.position.set(l.x, beamH / 2, l.z);
        dummy.rotation.set(0, 0, 0);
        dummy.scale.set(0.3, beamH, 0.3);
        dummy.updateMatrix();
        goldBeams.setMatrixAt(gi, dummy.matrix);
        dummy.position.set(l.x, 0.05, l.z);
        dummy.rotation.set(-Math.PI / 2, 0, 0);
        dummy.scale.setScalar(1.05 + Math.sin(clock * 3 + l.id) * 0.12);
        dummy.updateMatrix();
        goldRings.setMatrixAt(gi, dummy.matrix);
        gi++;
      }
      goldBeams.count = gi;
      goldRings.count = gi;
      goldBeams.visible = gi > 0;
      goldRings.visible = gi > 0;
      if (gi) {
        goldBeams.instanceMatrix.needsUpdate = true;
        goldRings.instanceMatrix.needsUpdate = true;
        beamGold.opacity = 0.22 + Math.sin(clock * 2.5) * 0.08;
      }

      // impulse rings rushing out, flares climbing and burning
      for (const w of waves) {
        if (!w.mesh.visible) continue;
        w.life -= dt;
        if (w.life <= 0) {
          w.mesh.visible = false;
          continue;
        }
        const u = 1 - w.life / 0.4;
        w.mesh.scale.setScalar(0.6 + u * w.r);
        w.mat.opacity = 0.85 * (1 - u);
      }
      for (let i = flares.length - 1; i >= 0; i--) {
        const fl = flares[i];
        const age = clock - fl.at;
        if (age > FLARE_UP.rise + FLARE_UP.burn) {
          scene.remove(fl.core, fl.glow);
          flares.splice(i, 1);
          continue;
        }
        const u = Math.min(1, age / FLARE_UP.rise);
        const y = 1.2 + FLARE_UP.y * (1 - (1 - u) * (1 - u));
        const fade = age > FLARE_UP.rise + FLARE_UP.burn - 1 ? FLARE_UP.rise + FLARE_UP.burn - age : 1;
        fl.core.position.set(fl.x, y, fl.z);
        fl.glow.position.set(fl.x, y, fl.z);
        fl.core.scale.setScalar(0.35 * fade);
        fl.glow.scale.setScalar((1.3 + Math.sin(clock * 30) * 0.2) * fade);
        if (Math.random() < 0.5) burst(fl.x, y - 0.3, fl.z, 1, 0.5, 0.3, 1.2, [partMat.smoke], -0.5);
      }

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
          const cls = WEAPONS[e.w].cls;
          if (v) v.recoil = 1;
          if (e.w === 'flare' && f) {
            // a flare goes straight up from the gun
            const core = new THREE.Mesh(G.ball, flareMat);
            const glow = new THREE.Mesh(G.ball, flareGlow);
            scene.add(core, glow);
            flares.push({ core, glow, x: e.x, z: e.z, at: now });
            burst(e.x, 1, e.z, 8, 3, 0.18, 0.6, [partMat.spark, partMat.smoke]);
            break;
          }
          if (f && near(f.x, f.z) && e.w !== 'launcher' && e.w !== 'crossbow') flash(f.x + Math.sin(e.a) * 1.2, 0.95, f.z + Math.cos(e.a) * 1.2, cls === 'shotgun' ? 0.32 : e.w === 'micro' ? 0.15 : 0.2, 0.05, 0, flashMat);
          if (e.f === focus) shake = Math.max(shake, cls === 'shotgun' || cls === 'sniper' || e.w === 'launcher' || e.w === 'revolver' ? 0.35 : 0.08);
          break;
        }
        case 'swing':
        case 'throw': {
          const v = eggs[e.f];
          if (v) v.swing = 1;
          break;
        }
        case 'zone':
          if (!near(e.x, e.z)) break;
          if (e.k === 'flour') burst(e.x, 1, e.z, 24, 7, 0.4, 0.8, [partMat.flour], 3);
          else if (e.k === 'bush') burst(e.x, 1, e.z, 16, 4, 0.2, 0.6, [partMat.leaf, partMat.dust]);
          else if (e.k === 'jam') burst(e.x, 0.6, e.z, 16, 4, 0.16, 0.6, [partMat.jam, partMat.glass]);
          else burst(e.x, 0.6, e.z, 18, 5, 0.18, 0.6, [partMat.sauce, partMat.fire]);
          break;
        case 'thud':
          if (!near(e.x, e.z)) break;
          if (e.what === 'egg') burst(e.x, 1, e.z, 4, 3, 0.09, 0.35, [partMat.shell]);
          else if (e.what === 'pan') {
            burst(e.x, 1, e.z, 6, 5, 0.07, 0.3, [partMat.spark, partMat.metal]);
            flash(e.x, 1, e.z, 0.25, 0.06, 0, flashMat);
          } else if (e.what === 'tree') burst(e.x, 1, e.z, 4, 3, 0.1, 0.4, [partMat.wood, partMat.leaf]);
          else if (e.what === 'rock') burst(e.x, 1, e.z, 4, 3, 0.09, 0.35, [partMat.stone, partMat.dust]);
          else if (e.what === 'barrel') burst(e.x, 1, e.z, 4, 3, 0.09, 0.35, [partMat.red, partMat.metal]);
          else if (e.what === 'car' || e.what === 'post') {
            burst(e.x, 1, e.z, 5, 4, 0.07, 0.3, [partMat.spark, partMat.metal]);
            flash(e.x, 1, e.z, 0.2, 0.05, 0, flashMat);
          } else if (e.what === 'fire') burst(e.x, 0.6, e.z, 6, 3, 0.08, 0.5, [partMat.spark, partMat.fire], 3);
          else burst(e.x, 1, e.z, 4, 3, 0.1, 0.35, [partMat.wood, partMat.dust]);
          break;
        case 'hit':
          if (near(e.x, e.z)) burst(e.x, 1, e.z, 5, 3.5, 0.1, 0.4, e.shield ? [partMat.purple, partMat.shell] : [partMat.shell, partMat.yolk]);
          break;
        case 'hurt':
          if (e.f === focus) shake = Math.max(shake, e.storm ? 0.12 : 0.35);
          break;
        case 'smash': {
          if (!near(e.x, e.z)) break;
          const kind = e.kind === 'crate' ? map.containers[e.id]?.kind : 'wall';
          burst(e.x, 1, e.z, 4, 3, 0.12, 0.4, kind === 'barrel' ? [partMat.red, partMat.metal] : kind === 'toilet' ? [partMat.shell, partMat.splash] : kind === 'hay' ? [partMat.straw] : [partMat.wood]);
          if (e.kind === 'crate') crateShake.set(e.id, now);
          break;
        }
        case 'harvest':
          burst(e.x, 1.4, e.z, 6, 3, 0.13, 0.45, [partMat.wood, partMat.leaf]);
          break;
        case 'pulse': {
          if (!near(e.x, e.z)) break;
          const w = waves[waveAt];
          waveAt = (waveAt + 1) % waves.length;
          w.mesh.position.set(e.x, 0.15, e.z);
          w.mesh.visible = true;
          w.life = 0.4;
          w.r = THROWS.impulse.radius;
          burst(e.x, 0.8, e.z, 14, 8, 0.14, 0.4, [partMat.spark, partMat.shove], 4);
          const f = m.fighters[focus];
          if (f && Math.hypot(f.x - e.x, f.z - e.z) < 12) shake = Math.max(shake, 0.4);
          break;
        }
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
          if (!c || !near(c.x, c.z)) break;
          if (c.kind === 'crate') burst(c.x, 1, c.z, 18, 6, 0.2, 0.8, [partMat.wood]);
          else if (c.kind === 'barrel') burst(c.x, 0.8, c.z, 20, 8, 0.22, 0.9, [partMat.red, partMat.metal, partMat.fire]);
          else if (c.kind === 'toilet') burst(c.x, 0.6, c.z, 18, 6, 0.16, 0.8, [partMat.shell, partMat.shell, partMat.splash]);
          else if (c.kind === 'hay') burst(c.x, 0.8, c.z, 22, 5, 0.18, 0.9, [partMat.straw], 6);
          else if (c.kind === 'fridge') burst(c.x + 0, 1.2, c.z + c.face * 0.8, 10, 3, 0.14, 0.6, [partMat.splash, partMat.shell], 4);
          else burst(c.x, 1, c.z, c.kind === 'supply' ? 22 : 12, 4, 0.2, 0.8, [partMat.spark, M.gold]);
          break;
        }
        case 'bounce': {
          const f = m.fighters[e.f];
          if (!f || !near(f.x, f.z)) break;
          burst(f.x, 0.3, f.z, 14, 5, 0.2, 0.6, [partMat.dust], 2);
          flash(f.x, 0.3, f.z, 0.8, 0.25, 8, padFlash);
          if (e.f === focus) shake = Math.max(shake, 0.3);
          break;
        }
        case 'wall':
          if (near(e.wall.x, e.wall.z)) burst(e.wall.x, 0.3, e.wall.z, 6, 2, 0.16, 0.4, [partMat.dust]);
          break;
        case 'land': {
          const f = m.fighters[e.f];
          if (f && near(f.x, f.z)) burst(f.x, 0.2, f.z, 10, 3, 0.25, 0.5, f.wet ? [partMat.splash] : [partMat.dust], 2);
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
      for (const im of instanced) im.dispose();
      gl.dispose();
    },
  };
  return view;
}
