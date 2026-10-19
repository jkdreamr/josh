// three.js view of a Scramble match: the island, the eggs, the bus, the storm, loot, walls, bullets, throwables and
// effects. It reads a Match every frame and never changes it. Only classes kit/three-lib.ts exports are used.
import type { T } from './gl';
import { createGL, damp, disposeTree, type GL } from './gl';
import { BARREL_R, BEACH, BRIDGE_HALF, BUSH_R, BUS_Y, CAMP, CHEST_HD, CHEST_HW, CRATE_HALF, FENCE_T, FRIDGE_HD, FRIDGE_HW, HALF, HAY_HD, HAY_HW, LAMP_R, LOG_R, PAD, RIVER_HALF, ROAD_HALF, STASH, SUPPLY_FALL, SUPPLY_HALF, TABLE_HD, TABLE_HW, TOILET_R, WALL_T, bridgeAt, busAt, fieldAt, isStash, padAt, peekAt, riverDist2, roadAt, type Building, type BuildingKind, type Container } from './map';
import { BARREL, BUILD_START, CELL_B, CRATE_HP, DIR_X, DIR_Z, DOOR_GONE, DOOR_IN, DOOR_OPENING, DOOR_OUT, F_DRINKING, F_GHILLIE, F_HEALING, F_PAN, F_RELOAD, F_SHIELDING, F_SMOOTHIE, F_SPIN, F_STUN, F_TART, GAP, HAY_HP, LEVEL_H, TOILET_HP, clearLine, concealed, editable, gridOf, held, levelOf, makePiece, owned, pieceIn, planPiece, roofOver, shut, tossAt, viewOf, type Ev, type Fighter, type Held, type LootItem, type Match, type Plan, type Toss, type Wall, type Zone } from './logic';
import { MATS, MAT_SPECS, MELEE, RARITY_COLORS, THROWS, WEAPONS, isMelee, isThrow, isWeapon, legendary, type LootDef, type Mat, type UseId } from './items';

type Three = typeof import('three');

export type FrameOpts = {
  /** Draw the aim line from this egg's gun (the player's own egg). */
  aimLine: boolean;
  /** Pull the camera back over the whole island (before the match, behind the Start card). */
  overview: boolean;
  /** Show a blueprint of where the build key would build this (or the wall the edit key would edit). */
  preview?: Plan | 'edit' | null;
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
/** three's AdditiveBlending, by value, for things that glow. */
const ADDITIVE = 2 as T.Blending;

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
  police: { frame: 0x2b3f66, porch: 0xb7bcc2, mat: 0x2b3f66, awning: 0x2b3f66, edge: 0xffffff, trim: 0xf4f6f8 },
  bank: { frame: 0x6b4426, porch: 0xd9cfb8, mat: 0x7a1f1f, awning: 0x2f5d3a, edge: 0xffd23d, trim: 0xf1ead8 },
};
/** The stone footing along each kind's outer walls. */
const FOOTINGS: Record<BuildingKind, number> = { house: 0x8f8a80, farm: 0x7d766c, shed: 0x6e6a62, warehouse: 0x6c747c, container: 0, ruin: 0, coop: 0xb08a4a, diner: 0x9aa3a8, mill: 0x8a8378, police: 0x5b6470, bank: 0x9a8f78 };
/** What each kind's doors are painted (a house's by its look). */
const DOOR_PAINT: Partial<Record<BuildingKind, number>> = { farm: 0xf6f1e4, shed: 0x8a5a2b, diner: 0x3fb8af, police: 0x2b3f66, bank: 0x5a3a1e, coop: 0xc0392b, mill: 0x6b4426, warehouse: 0x8d9aa6 };
const HOUSE_DOORS = [0x7a4a2a, 0x3f6f9e, 0xb0473a, 0x4f8a4a];
/**
 * Little windows only for show along the outer walls of the kinds without real ones: their size, how high their
 * middle sits and how far apart. The windmill's are glass high up the tower; the Golden Coop's are barred vents.
 */
const WINDOWS: Partial<Record<BuildingKind, { w: number; h: number; y: number; gap: number; bars: boolean }>> = {
  coop: { w: 0.7, h: 0.55, y: 1.9, gap: 3, bars: true },
  mill: { w: 0.7, h: 0.9, y: 3.6, gap: 4, bars: false },
};
/**
 * Real windows (see map.ts), by kind: the height of the wall below the opening (a warehouse's sit high), and shutters
 * or not. The opening runs up to the eaves, so from above it reads as a gap along the top of the wall.
 */
const GLASS_LOOK: Partial<Record<BuildingKind, { sill: number; shutters: boolean }>> = {
  house: { sill: 1.05, shutters: true },
  farm: { sill: 1.1, shutters: true },
  shed: { sill: 1.3, shutters: false },
  diner: { sill: 0.8, shutters: false },
  warehouse: { sill: 2.7, shutters: false },
  police: { sill: 1.1, shutters: false },
  bank: { sill: 0.9, shutters: false },
};
const SHUTTERS = [0x3f6f9e, 0x4f8a4a, 0xb0473a, 0x6b4f8a, 0x2f7a7a];
/** Glow under a pickup, by how good it is (the rarity colors). */
const USE_GLOW: Record<UseId, number> = { bandage: 1, medkit: 2, mini: 2, shield: 3, coffee: 4, smoothie: 3, tart: 4 };
/** How many legendary things on the ground get a gold beam at once (there are rarely more than a handful). */
const BEAMS = 40;
/** Which way shadows fall along the ground, per meter of height (away from the sun, low in the south west). */
const SUN = { x: 0.42, z: -0.32 };
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

/** Stone blocks in rows, each a slightly different grey, with mortar between. */
function stoneTexture(THREE: Three) {
  const rnd = scatter(53);
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      g.fillStyle = '#7d8187';
      g.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 32)
        for (let x = (y / 32) % 2 ? -21 : 0; x < 128; x += 42) {
          const v = 150 + Math.floor(rnd() * 45);
          g.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
          g.fillRect(x + 2, y + 2, 38, 28);
          g.fillStyle = 'rgba(255,255,255,0.18)';
          g.fillRect(x + 2, y + 2, 38, 3);
          for (let i = 0; i < 6; i++) {
            g.fillStyle = `rgba(40,40,45,${0.08 + rnd() * 0.1})`;
            g.fillRect(x + 4 + rnd() * 30, y + 6 + rnd() * 20, 3 + rnd() * 5, 2);
          }
        }
    }),
  );
}

/** Steel plates with a seam down the middle and rivets round the edge. */
function metalTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      const grad = g.createLinearGradient(0, 0, 128, 128);
      grad.addColorStop(0, '#b9c3cc');
      grad.addColorStop(1, '#8f9aa5');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      g.fillStyle = '#5e6873';
      g.fillRect(0, 62, 128, 4);
      g.fillRect(62, 0, 4, 128);
      g.strokeStyle = '#5e6873';
      g.lineWidth = 4;
      g.strokeRect(2, 2, 124, 124);
      g.fillStyle = '#e8eef3';
      for (const v of [10, 52, 76, 118])
        for (const u of [10, 52, 76, 118]) {
          g.beginPath();
          g.arc(u, v, 2.6, 0, Math.PI * 2);
          g.fill();
        }
      g.fillStyle = 'rgba(255,255,255,0.16)';
      for (let x = 0; x < 128; x += 16) g.fillRect(x, 0, 3, 128);
    }),
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

/** Window glass: sky blue, lighter at the top, with a bright diagonal shine across it. */
function glassTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(32, 32, (g) => {
      const grad = g.createLinearGradient(0, 0, 0, 32);
      grad.addColorStop(0, '#d9f1ff');
      grad.addColorStop(1, '#6fa9cf');
      g.fillStyle = grad;
      g.fillRect(0, 0, 32, 32);
      g.fillStyle = 'rgba(255,255,255,0.7)';
      g.beginPath();
      g.moveTo(6, 32);
      g.lineTo(14, 32);
      g.lineTo(30, 0);
      g.lineTo(22, 0);
      g.closePath();
      g.fill();
    }),
  );
}

/**
 * What's left in a frame once its glass breaks: jagged slivers in the corners and along the bottom, flat in a unit
 * square facing z.
 */
function jaggedGlass(THREE: Three) {
  const tris = [
    [-0.5, -0.5, -0.12, -0.5, -0.5, 0.18],
    [-0.12, -0.5, 0.1, -0.5, -0.02, -0.32],
    [0.1, -0.5, 0.5, -0.5, 0.5, -0.1],
    [0.5, 0.5, 0.22, 0.5, 0.5, 0.02],
    [-0.5, 0.5, -0.34, 0.5, -0.5, 0.28],
    [-0.5, 0.18, -0.5, 0.0, -0.36, 0.06],
  ];
  const pos: number[] = [];
  for (const [ax, ay, bx, by, cx, cy] of tris) pos.push(ax, ay, 0, bx, by, 0, cx, cy, 0);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
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

/** A sign: a board (a diner's red) with its name across it (in cream). */
function signTexture(THREE: Three, text: string, board = '#d64545', ink = '#fff6d6') {
  return texture(
    THREE,
    canvas(512, 128, (g) => {
      g.fillStyle = board;
      g.fillRect(0, 0, 512, 128);
      g.strokeStyle = ink;
      g.lineWidth = 8;
      g.strokeRect(10, 10, 492, 108);
      g.fillStyle = ink;
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

/**
 * Square bands round the island: band k runs from `rings[k]` to `rings[k + 1]` meters out past `half`, at the heights
 * and in the colors given for each ring. The sea's shallows and the beach's slope into it.
 */
function squareBands(THREE: Three, half: number, rings: { d: number; y: number; c: number }[]) {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const corner = [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ];
  const at = (k: number, i: number) => {
    const r = rings[k];
    const s = half + r.d;
    c.setHex(r.c);
    return { p: [corner[i % 4][0] * s, r.y, corner[i % 4][1] * s], c: [c.r, c.g, c.b] };
  };
  for (let k = 0; k + 1 < rings.length; k++)
    for (let i = 0; i < 4; i++) {
      // a trapezoid along one side, wound to face up
      const a = at(k, i);
      const b = at(k, i + 1);
      const A = at(k + 1, i);
      const B = at(k + 1, i + 1);
      for (const v of [a, b, A, b, B, A]) {
        pos.push(...v.p);
        col.push(...v.c);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  // texture coordinates 0 to 1 across the island, so the sand's texture lines up with itself everywhere
  const uv: number[] = [];
  for (let i = 0; i < pos.length; i += 3) uv.push(pos[i] / (2 * HALF) + 0.5, 0.5 - pos[i + 2] / (2 * HALF));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

/** A closed loop round a square `s` from the middle (starting and ending mid side), for ribbons that ring the island. */
const squareLoop = (s: number) => [
  { x: 0, z: -s },
  { x: s, z: -s },
  { x: s, z: s },
  { x: -s, z: s },
  { x: -s, z: -s },
  { x: 0, z: -s },
];

/** Surf: white along u = 0 (the shore side) breaking up into lace toward u = 1, v along the shore. */
function foamTexture(THREE: Three) {
  const rnd = scatter(53);
  const tex = texture(
    THREE,
    canvas(64, 256, (g) => {
      for (let y = 0; y < 256; y += 2) {
        const reach = 18 + Math.sin(y * 0.09) * 6 + Math.sin(y * 0.23 + 1) * 4 + rnd() * 5;
        const grad = g.createLinearGradient(0, 0, reach + 14, 0);
        grad.addColorStop(0, 'rgba(255,255,255,0.95)');
        grad.addColorStop(reach / (reach + 14), 'rgba(255,255,255,0.75)');
        grad.addColorStop(1, 'rgba(255,255,255,0)');
        g.fillStyle = grad;
        g.fillRect(0, y, reach + 14, 2);
      }
      // bubbles of lace past the line
      for (let i = 0; i < 160; i++) {
        g.fillStyle = `rgba(255,255,255,${0.25 + rnd() * 0.45})`;
        g.beginPath();
        g.arc(14 + rnd() * 40, rnd() * 256, 0.8 + rnd() * 1.8, 0, Math.PI * 2);
        g.fill();
      }
    }),
  );
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** The grass's ragged edge over the sand: green from u = 0, giving out in tufts by u = 1. */
function grassEdgeTexture(THREE: Three) {
  const rnd = scatter(59);
  const tex = texture(
    THREE,
    canvas(32, 128, (g) => {
      for (let y = 0; y < 128; y++) {
        const reach = 8 + Math.abs(Math.sin(y * 0.31)) * 10 + Math.sin(y * 0.11 + 2) * 4 + rnd() * 6;
        g.fillStyle = '#6dab4f';
        g.fillRect(0, y, reach, 1);
        g.fillStyle = 'rgba(40,90,30,0.35)';
        g.fillRect(Math.max(0, reach - 2), y, 2, 1);
      }
    }),
  );
  tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

/** Smooth value noise in 0..1 on a grid `cell` meters across, the same everywhere for a seed. */
function valueNoise(seed: number, cell: number) {
  const hash = (i: number, j: number) => {
    let h = (Math.imul(i, 374761393) + Math.imul(j, 668265263) + Math.imul(seed, 2147483647)) | 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  };
  return (x: number, z: number) => {
    const fx = x / cell;
    const fz = z / cell;
    const i = Math.floor(fx);
    const j = Math.floor(fz);
    const u = fx - i;
    const v = fz - j;
    const su = u * u * (3 - 2 * u);
    const sv = v * v * (3 - 2 * v);
    const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * su;
    const b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * su;
    return a + (b - a) * sv;
  };
}

/** A line moved `d` to its left (negative: to its right), point by point. */
function offsetLine(pts: { x: number; z: number }[], d: number) {
  const n = pts.length;
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    const l = Math.hypot(b.x - a.x, b.z - a.z) || 1;
    return { x: p.x - ((b.z - a.z) / l) * d, z: p.z + ((b.x - a.x) / l) * d };
  });
}

/** Still water: pale over the shallows round the edge, deep blue in the middle, with glints of light. */
function pondTexture(THREE: Three) {
  const rnd = scatter(67);
  return texture(
    THREE,
    canvas(128, 128, (g) => {
      const grad = g.createRadialGradient(64, 64, 4, 64, 64, 64);
      grad.addColorStop(0, '#2f86bd');
      grad.addColorStop(0.6, '#3fa6d4');
      grad.addColorStop(0.9, '#7fd2e8');
      grad.addColorStop(1, '#a8e6ef');
      g.fillStyle = grad;
      g.fillRect(0, 0, 128, 128);
      for (let i = 0; i < 26; i++) {
        g.fillStyle = `rgba(255,255,255,${0.2 + rnd() * 0.35})`;
        g.fillRect(20 + rnd() * 88, 20 + rnd() * 88, 3 + rnd() * 7, 1.2);
      }
    }),
  );
}

/** A shelf's worth of book spines, all sorts of colors and heights, for the bookshelves. */
function booksTexture(THREE: Three) {
  const rnd = scatter(71);
  const SPINES = ['#c0392b', '#2e86de', '#27ae60', '#f2c94c', '#8e44ad', '#e67e22', '#f4f1ea', '#5d4037', '#16a085'];
  return texture(
    THREE,
    canvas(128, 32, (g) => {
      g.fillStyle = '#3a2412';
      g.fillRect(0, 0, 128, 32);
      for (let x = 0; x < 128; ) {
        const w = 5 + Math.floor(rnd() * 6);
        const h = 20 + Math.floor(rnd() * 12);
        g.fillStyle = SPINES[Math.floor(rnd() * SPINES.length)];
        g.fillRect(x, 32 - h, w - 1, h);
        g.fillStyle = 'rgba(255,255,255,0.35)';
        g.fillRect(x + 1, 32 - h + 4, w - 3, 2);
        x += w;
      }
    }),
  );
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

/** A burst of light: a hot middle, a long spike along v and a short one across, for muzzle flashes and sparks. */
function starTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(64, 64, (g) => {
      const grad = g.createRadialGradient(32, 32, 0, 32, 32, 30);
      grad.addColorStop(0, 'rgba(255,255,255,1)');
      grad.addColorStop(0.25, 'rgba(255,240,200,0.8)');
      grad.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = grad;
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = 'rgba(255,255,255,0.9)';
      for (const [w, h] of [
        [5, 62],
        [3, 30],
      ]) {
        g.beginPath();
        g.moveTo(32, 32 - h / 2);
        g.lineTo(32 + w / 2, 32);
        g.lineTo(32, 32 + h / 2);
        g.lineTo(32 - w / 2, 32);
        g.closePath();
        g.fill();
        g.beginPath();
        g.moveTo(32 - h / 2, 32);
        g.lineTo(32, 32 + w / 4);
        g.lineTo(32 + h / 2, 32);
        g.lineTo(32, 32 - w / 4);
        g.closePath();
        g.fill();
      }
    }),
  );
}

/** A streak of light, clear at the tail (v = 1) and hot at the head (v = 0), soft at its sides. */
function tracerTexture(THREE: Three) {
  return texture(
    THREE,
    canvas(16, 64, (g) => {
      const img = g.createImageData(16, 64);
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 16; x++) {
          const i = (y * 16 + x) * 4;
          const along = y / 63;
          const across = 1 - Math.abs((x + 0.5) / 8 - 1);
          const core = Math.pow(across, 3);
          img.data[i] = 255;
          img.data[i + 1] = Math.round(230 + 25 * core);
          img.data[i + 2] = Math.round(150 + 105 * core);
          img.data[i + 3] = Math.round(Math.pow(along, 1.6) * Math.pow(across, 1.5) * 255);
        }
      g.putImageData(img, 0, 0);
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

/**
 * A soft edged square of shade, darkest in the middle (stretched to fit whatever it lies under). As a strip (along a
 * wall), it fades across v only, darkest along the middle line and falling off fast, like the shade where a wall meets
 * the ground.
 */
function softSquareTexture(THREE: Three, strip = false) {
  return texture(
    THREE,
    canvas(64, 64, (g) => {
      const img = g.createImageData(64, 64);
      const edge = (t: number) => {
        const k = Math.min(1, Math.min(t, 1 - t) / 0.32);
        return k * k * (3 - 2 * k);
      };
      for (let y = 0; y < 64; y++)
        for (let x = 0; x < 64; x++) {
          const i = (y * 64 + x) * 4;
          const u = (x + 0.5) / 64;
          const v = (y + 0.5) / 64;
          const across = 1 - Math.abs(2 * v - 1);
          img.data[i] = img.data[i + 1] = img.data[i + 2] = 255;
          img.data[i + 3] = Math.round((strip ? across * across * Math.min(1, Math.min(u, 1 - u) / 0.04) : edge(u) * edge(v)) * 255);
        }
      g.putImageData(img, 0, 0);
    }),
  );
}

/**
 * Cracks round an egg's shell, in white for the material to tint: the first few drawn solid, the rest half see
 * through, so an alpha test of 0.7 shows the first and 0.3 shows them all. Drawn round its middle, below the hat.
 */
function crackTexture(THREE: Three) {
  const rnd = scatter(61);
  return texture(
    THREE,
    canvas(256, 128, (g) => {
      g.lineCap = 'round';
      g.lineJoin = 'round';
      const crack = (u: number, v: number, len: number, alpha: number, width: number) => {
        g.strokeStyle = `rgba(255,255,255,${alpha})`;
        g.lineWidth = width;
        g.beginPath();
        let x = u * 256;
        let y = v;
        g.moveTo(x, y);
        const dir = rnd() > 0.5 ? 1 : -1;
        for (let i = 0; i < len; i++) {
          x += dir * (6 + rnd() * 8);
          y += (i % 2 ? -1 : 1) * (3 + rnd() * 6);
          g.lineTo(x, y);
          // a short branch off some corners
          if (rnd() < 0.3) {
            g.moveTo(x, y);
            g.lineTo(x + dir * (3 + rnd() * 5), y + (rnd() - 0.5) * 12);
            g.moveTo(x, y);
          }
        }
        g.stroke();
      };
      for (const [u, v] of [
        [0.06, 66],
        [0.4, 74],
        [0.72, 62],
      ])
        crack(u, v, 7, 1, 3);
      for (const [u, v] of [
        [0.22, 84],
        [0.55, 58],
        [0.88, 80],
        [0.32, 60],
        [0.66, 88],
      ])
        crack(u, v, 6, 0.5, 2.4);
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

/** Pieces in one material, each moved by its matrix, merged into one geometry: one draw call for them all. */
function mergeParts(THREE: Three, parts: { g: T.BufferGeometry; m: T.Matrix4 }[]) {
  let count = 0;
  for (const p of parts) count += p.g.index ? p.g.index.count : (p.g.attributes.position as T.BufferAttribute).count;
  const pos = new Float32Array(count * 3);
  const nor = new Float32Array(count * 3);
  const uv = new Float32Array(count * 2);
  let at = 0;
  for (const p of parts) {
    const g = p.g.clone().applyMatrix4(p.m);
    const P = g.attributes.position as T.BufferAttribute;
    const N = g.attributes.normal as T.BufferAttribute;
    const U = g.attributes.uv as T.BufferAttribute | undefined;
    const n = g.index ? g.index.count : P.count;
    for (let k = 0; k < n; k++) {
      const i = g.index ? g.index.getX(k) : k;
      pos[at * 3] = P.getX(i);
      pos[at * 3 + 1] = P.getY(i);
      pos[at * 3 + 2] = P.getZ(i);
      nor[at * 3] = N.getX(i);
      nor[at * 3 + 1] = N.getY(i);
      nor[at * 3 + 2] = N.getZ(i);
      if (U) {
        uv[at * 2] = U.getX(i);
        uv[at * 2 + 1] = U.getY(i);
      }
      at++;
    }
    g.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
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

/** A bit thrown by an effect: where it is, how it moves, how long it has left, and which kind of mesh draws it in what color. */
type Particle = { x: number; y: number; z: number; rx: number; rz: number; vx: number; vy: number; vz: number; life: number; max: number; spin: number; grav: number; size: number; kind: number; color: T.Color };

/** A model for something in hand: the group, and a minigun's barrels that spin. */
type HeldModel = { group: T.Group; spin: T.Object3D | null };

/**
 * Stand-ins (placed, never drawn) for what every egg has, which is drawn instanced across all of them: its shell (with
 * its hands and party hat, which sit as it does), its face, its cracks, and its glider.
 */
type EggSlots = { shell: T.Object3D; face: T.Object3D; crack: T.Object3D };

type EggView = {
  root: T.Group;
  body: T.Group;
  slots: EggSlots;
  hand: T.Group;
  /** What it has held, by weapon and rarity. */
  guns: Map<string, HeldModel>;
  shadow: T.Object3D;
  glider: T.Group;
  heal: T.Group;
  /** The two bars of the cross over the head while healing (gold for a golden egg tart). */
  cross: T.Mesh[];
  ring: T.Mesh;
  ghost: T.Mesh;
  backPan: T.Group;
  /** The helmet and vest it wears (a helmet takes the party hat's place), rebuilt when the level changes. */
  helmet: T.Group | null;
  helmetLv: number;
  vest: T.Group | null;
  vestLv: number;
  walk: number;
  swing: number;
  recoil: number;
  lean: number;
  /** How cracked it shows (0 whole, 1 a few, 2 many). */
  cracked: number;
  /** A shield's shimmer round the egg when a hit lands on it, fading from 1. */
  bubble: T.Mesh;
  bubbleMat: T.ShaderMaterial;
  shimmer: number;
  /** Squash (below 0) and stretch, sprung back to 0, and how fast it's moving. */
  sq: number;
  sqV: number;
  /** Meters walked since the last puff of dust, and seconds since the last ripple when wading. */
  step: number;
  ripple: number;
};

type LootView = { group: T.Group; model: T.Object3D; spin: number };

export function buildView(THREE: Three, host: HTMLElement, m: Match): View | null {
  const gl = createGL(THREE, host);
  if (!gl) return null;
  const map = m.map;
  const scene = new THREE.Scene();
  const water = 0x2380c0;
  scene.background = new THREE.Color(water);
  scene.fog = new THREE.Fog(water, 160, 520);
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 1200);
  // a warm afternoon sun from the south west, and a cool sky filling the shade, so lit and shaded sides read apart
  scene.add(new THREE.HemisphereLight(0xd6ebff, 0x6f8748, 1.2));
  const sun = new THREE.DirectionalLight(0xffe0b0, 1.6);
  sun.position.set(SUN.x * -100, 100, SUN.z * -100);
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
    mirv: lambert(0xc0392b, { emissive: 0x2a0500 }),
    stun: lambert(0x9fb8d6, { emissive: 0x10263a }),
  };
  const rarity = RARITY_COLORS.map((c) => lambert(parseInt(c.slice(1), 16), { emissive: parseInt(c.slice(1), 16), emissiveIntensity: 0.25 }));
  // armor in its level's color (uncommon, rare, epic), two-sided for the open curve of an apron
  const armorMat = [0, 1, 2, 3].map((lv) => lambert(parseInt(RARITY_COLORS[Math.min(4, lv + 1)].slice(1), 16), { emissive: parseInt(RARITY_COLORS[Math.min(4, lv + 1)].slice(1), 16), emissiveIntensity: 0.2, side: THREE.DoubleSide }));
  const rarityGlow = RARITY_COLORS.map((c) => basic(parseInt(c.slice(1), 16), { transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide }));
  const ammoMat = Object.fromEntries(Object.entries(AMMO_COLORS).map(([k, c]) => [k, lambert(c)])) as Record<keyof typeof AMMO_COLORS, T.MeshLambertMaterial>;
  const ammoGlow = Object.fromEntries(Object.entries(AMMO_COLORS).map(([k, c]) => [k, basic(c, { transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide })])) as Record<keyof typeof AMMO_COLORS, T.MeshBasicMaterial>;

  /**
   * Leaves and grass sway in the wind, in the vertex shader (nothing moves on the CPU): each point leans by how far it
   * stands above `base` (in the model's own units), a tree at a time for instanced meshes, a spot at a time otherwise.
   */
  const wind = { value: 0 };
  const sway = <X extends T.Material>(x: X, base: number, amount: number) => {
    x.onBeforeCompile = (shader) => {
      shader.uniforms.uWind = wind;
      shader.uniforms.uSwayBase = { value: base };
      shader.uniforms.uSway = { value: amount };
      shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;\nuniform float uSwayBase;\nuniform float uSway;').replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec2 swayAt = vec2(instanceMatrix[3].x, instanceMatrix[3].z);
        #else
          vec2 swayAt = position.xz;
        #endif
        float swayK = max(0.0, position.y - uSwayBase) * uSway;
        float gust = sin(uWind * 1.3 + swayAt.x * 0.21 + swayAt.y * 0.17);
        transformed.x += (sin(uWind * 1.9 + swayAt.x * 0.37 + swayAt.y * 0.29) * 0.6 + gust * 0.5) * swayK;
        transformed.z += sin(uWind * 1.6 + swayAt.y * 0.41 - swayAt.x * 0.23) * 0.45 * swayK;`,
      );
    };
    return x;
  };

  const add = (parent: T.Object3D, g: T.BufferGeometry, material: T.Material, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const o = new THREE.Mesh(g, material);
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    parent.add(o);
    return o;
  };
  /**
   * A model built of many little meshes (what's in hand, helmets, vests, loot, the bus) merged into as few meshes as it
   * can, worked out once for each `key` and shared: plain colored parts become one mesh colored by vertex (a glowing
   * part keeps some of its glow in its color), and the rest (glass, glows, textures) one mesh a material. What's in
   * `keep` (barrels that spin) stays as it is. `double` draws the plain parts two-sided.
   */
  const baked = new Map<string, { g: T.BufferGeometry; m: T.Material }[]>();
  const partsMat = lambert(0xffffff, { vertexColors: true });
  const partsMatDouble = lambert(0xffffff, { vertexColors: true, side: THREE.DoubleSide });
  const relative = new THREE.Matrix4();
  function bake<X extends T.Object3D>(key: string, root: X, keep: (T.Object3D | null)[] = [], double = false): X {
    root.updateMatrixWorld(true);
    relative.copy(root.matrixWorld).invert();
    const kept = (o: T.Object3D) => {
      for (let p: T.Object3D | null = o; p && p !== root; p = p.parent) if (keep.includes(p)) return true;
      return false;
    };
    const meshes: T.Mesh[] = [];
    root.traverse((o) => {
      if ((o as T.Mesh).isMesh && !kept(o)) meshes.push(o as T.Mesh);
    });
    let parts = baked.get(key);
    if (!parts) {
      const c = new THREE.Color();
      const glow = new THREE.Color();
      const plain = new Map<T.Material, RoofPart[]>();
      const by = new Map<T.Material, { g: T.BufferGeometry; m: T.Matrix4 }[]>();
      for (const o of meshes) {
        const x = o.material as T.MeshLambertMaterial;
        const m = new THREE.Matrix4().multiplyMatrices(relative, o.matrixWorld);
        if (x.isMeshLambertMaterial && !x.transparent && !x.map && !x.vertexColors && !Object.prototype.hasOwnProperty.call(x, 'onBeforeCompile')) {
          const into = double || x.side === THREE.DoubleSide ? partsMatDouble : partsMat;
          c.copy(x.color);
          if (x.emissive) c.add(glow.copy(x.emissive).multiplyScalar(x.emissiveIntensity));
          const list = plain.get(into) ?? [];
          list.push({ g: o.geometry.clone().applyMatrix4(m), c: c.getHex() });
          plain.set(into, list);
        } else {
          const list = by.get(x) ?? [];
          list.push({ g: o.geometry, m });
          by.set(x, list);
        }
      }
      parts = [...[...plain].map(([m, list]) => ({ g: geo(mergeRoof(THREE, list, 1, true)), m })), ...[...by].map(([m, list]) => ({ g: geo(mergeParts(THREE, list)), m }))];
      baked.set(key, parts);
    }
    for (const o of meshes) o.parent?.remove(o);
    for (const p of parts) root.add(new THREE.Mesh(p.g, p.m));
    return root;
  }

  // ---------------------------------------------------------------------------------------------------------------
  // The island.

  // the sea: turquoise over the shallows, deepening to blue away from the island, under the far haze
  const sea = new THREE.Mesh(geo(new THREE.PlaneGeometry(2400, 2400)), basic(water));
  sea.rotation.x = -Math.PI / 2;
  sea.position.y = -0.74;
  scene.add(sea);
  const shallows = squareBands(THREE, HALF, [
    { d: 0, y: -0.7, c: 0x9aeee6 },
    { d: 6, y: -0.7, c: 0x6edbe2 },
    { d: 16, y: -0.7, c: 0x48c2de },
    { d: 34, y: -0.7, c: 0x33a8d6 },
    { d: 70, y: -0.7, c: 0x2895cc },
    { d: 140, y: -0.7, c: 0x2488c4 },
    { d: 900, y: -0.7, c: water },
  ]);
  scene.add(new THREE.Mesh(geo(shallows), basic(0xffffff, { vertexColors: true })));
  // the beach: a ring of sand round the grass (not a slab under it, which would fight the grass for the same depth
  // from far up), running down into the water, darker where it's wet
  const sandTex = keep(sandTexture(THREE));
  const beach = squareBands(THREE, HALF - BEACH, [
    { d: 0, y: 0, c: 0xffffff },
    { d: BEACH, y: 0, c: 0xffffff },
    { d: BEACH + 2.2, y: -0.45, c: 0xf2e4c2 },
    { d: BEACH + 3.4, y: -0.72, c: 0xc9b48c },
    { d: BEACH + 6, y: -1.3, c: 0xa8987a },
  ]);
  scene.add(new THREE.Mesh(geo(beach), lambert(0xfff3dc, { map: sandTex, vertexColors: true })));
  // surf along the waterline, and a wave line that rolls in to meet it
  const foamTex = keep(foamTexture(THREE));
  const surfMat = basic(0xffffff, { map: foamTex, transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const surf = new THREE.Mesh(geo(ribbon(THREE, squareLoop(HALF + 3.05), 1.4, -0.69, 26)), surfMat);
  const waveTex = keep(foamTex.clone());
  // wrapping round, so what shows behind the rolling line is the foam's clear far side
  waveTex.wrapS = THREE.RepeatWrapping;
  const waveMat = basic(0xffffff, { map: waveTex, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide });
  const wave = new THREE.Mesh(geo(ribbon(THREE, squareLoop(HALF + 6), 3, -0.695, 34)), waveMat);
  surf.renderOrder = 1;
  wave.renderOrder = 1;
  scene.add(surf, wave);
  // the grass, in big soft patches of lusher and drier green, darker under the trees
  const GRASS_HALF = HALF - BEACH;
  const grassGeo = new THREE.PlaneGeometry(2 * GRASS_HALF, 2 * GRASS_HALF, 64, 64);
  {
    const p = grassGeo.attributes.position as T.BufferAttribute;
    const cols = new Float32Array(p.count * 3);
    const big = valueNoise(map.seed, 34);
    const small = valueNoise(map.seed + 7, 11);
    const dry = valueNoise(map.seed + 13, 52);
    // trees by 10 m square, for the shade under them
    const grid = new Map<number, { x: number; z: number }[]>();
    const key = (x: number, z: number) => Math.floor(x / 10) * 4096 + Math.floor(z / 10);
    for (const t of map.trees) {
      const k = key(t.x, t.z);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k)!.push(t);
    }
    for (let i = 0; i < p.count; i++) {
      // the plane lies in x, y before it's turned flat: its y is the island's -z
      const x = p.getX(i);
      const z = -p.getY(i);
      const n = big(x, z) * 0.65 + small(x, z) * 0.35;
      let shadeK = 0;
      for (let gx = -1; gx <= 1; gx++)
        for (let gz = -1; gz <= 1; gz++)
          for (const t of grid.get(key(x + gx * 10, z + gz * 10)) ?? []) {
            const d2 = (t.x - x) * (t.x - x) + (t.z - z) * (t.z - z);
            if (d2 < 49) shadeK += 1 - d2 / 49;
          }
      const lush = Math.min(1, shadeK * 0.5);
      const d = Math.max(0, dry(x, z) - 0.55) * 2.2;
      const l = 0.84 + n * 0.3 - lush * 0.18;
      cols[i * 3] = l * (1 + d * 0.16) * (1 - lush * 0.08);
      cols[i * 3 + 1] = l * (1 + d * 0.03);
      cols[i * 3 + 2] = l * (1 - d * 0.22) * (1 - lush * 0.04);
    }
    grassGeo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  }
  const grass = new THREE.Mesh(geo(grassGeo), lambert(0xffffff, { map: keep(grassTexture(THREE)), vertexColors: true }));
  grass.rotation.x = -Math.PI / 2;
  grass.position.y = 0.005;
  scene.add(grass);
  // its ragged edge over the sand
  const lip = new THREE.Mesh(geo(ribbon(THREE, squareLoop(GRASS_HALF + 0.55), 0.55, 0.007, 4)), lambert(0xffffff, { map: keep(grassEdgeTexture(THREE)), transparent: true, depthWrite: false, side: THREE.DoubleSide }));
  scene.add(lip);

  // ponds: a sandy rim, the water (pale in the shallows, deep in the middle), a lapping white edge, and a few lily
  // pads, some in flower
  const pondWater = lambert(0xffffff, { map: keep(pondTexture(THREE)), transparent: true, opacity: 0.92, emissive: 0x0b3a52 });
  const rimMat = lambert(0xd8c690);
  const padMat = lambert(0x4f9a3c);
  const bloomMat = lambert(0xff9cc8, { emissive: 0x3a1020 });
  const lapMat = basic(0xffffff, { transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide });
  const lapGeo = geo(new THREE.RingGeometry(0.93, 1, 64));
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
    const lap = new THREE.Mesh(lapGeo, lapMat);
    lap.rotation.x = -Math.PI / 2;
    lap.position.set(p.x, 0.036, p.z);
    lap.scale.setScalar(p.r);
    scene.add(lap);
    const rnd = scatter(Math.round(p.x * 31 + p.z * 7) >>> 0);
    for (let i = 0; i < 4; i++) {
      const a = rnd() * Math.PI * 2;
      const d = p.r * (0.3 + rnd() * 0.55);
      const pad = new THREE.Mesh(G.disc, padMat);
      pad.rotation.x = -Math.PI / 2;
      pad.position.set(p.x + Math.cos(a) * d, 0.05, p.z + Math.sin(a) * d);
      pad.scale.setScalar(0.45 + rnd() * 0.3);
      scene.add(pad);
      if (i % 2 === 0) add(scene, G.lowBall, bloomMat, pad.position.x + 0.1, 0.12, pad.position.z - 0.05, 0.16, 0.12, 0.16);
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
  const stalks = many(G.stalk, sway(lambert(0xffffff, { flatShading: true }), -1.15, 0.05), stalkSpots.length);
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
  // white water along both banks, drifting downstream with the river (the far bank's strip runs backward, so its
  // foam faces the shore too)
  const riverFoam: T.Texture[] = [];
  if (riverLine.length > 1)
    for (const side of [1, -1]) {
      const line = offsetLine(riverLine, side * (RIVER_HALF - 0.3));
      if (side < 0) line.reverse();
      const t = keep(foamTexture(THREE));
      riverFoam.push(t);
      const strip = new THREE.Mesh(geo(ribbon(THREE, line, 0.55, 0.037, 7)), basic(0xffffff, { map: t, transparent: true, opacity: 0.55, depthWrite: false, side: THREE.DoubleSide }));
      strip.renderOrder = 1;
      scene.add(strip);
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
      case 'police':
        return color.setHex(0xc9d6e6);
      case 'bank':
        return color.setHex(0xe8dcc0);
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
      case 'police':
        return 0x2b3f66;
      case 'bank':
        return 0x4f7d5c;
      default:
        return ROOF_COLORS[b.look % ROOF_COLORS.length];
    }
  };
  const darker = (hex: number, k: number) => color.setHex(hex).multiplyScalar(k).getHex();
  // a window's wall below the opening is a wall piece too
  const wallCount = map.buildings.reduce((n, b) => n + b.walls.length + b.windows.length, 0);
  const buildingWalls = many(G.box, lambert(0xffffff), wallCount);
  const wallRnd = scatter(17);
  const doorRnd = scatter(31);
  let wi = 0;
  const roofs: { mesh: T.Mesh; mats: (T.MeshLambertMaterial | T.MeshBasicMaterial)[]; fade: number; at: number }[] = [];
  const sails: T.Mesh[] = [];
  // the police station's light bar
  const beacons: { mat: T.MeshBasicMaterial; k: number }[] = [];
  // door frames, porches, mats, paving and container doors, all one instanced mesh; lamps another
  const bits: { x: number; y: number; z: number; sx: number; sy: number; sz: number; ry: number; c: number }[] = [];
  // wall caps, footings, window frames, sills and shutters (one instanced mesh), and the glass (another); the glass in
  // the windows that break is its own
  const trims: Part[] = [];
  const panes: Part[] = [];
  const glassParts: (Part & { ry: number })[] = [];
  const lamps: { x: number; y: number; z: number; sx: number; sz: number }[] = [];
  map.buildings.forEach((b, bi) => {
    const floorMat =
      b.kind === 'container'
        ? hold
        : b.kind === 'warehouse' || b.kind === 'police'
          ? concrete
          : b.kind === 'ruin'
            ? dirt
            : (() => {
                const tex = keep((b.kind === 'diner' || b.kind === 'bank' ? checks : floorTex).clone());
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
    const dress = DRESS[b.kind];
    for (const w of b.walls) {
      dummy.position.set(w.x, b.h / 2, w.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(w.hw * 2, b.h, w.hd * 2);
      dummy.updateMatrix();
      buildingWalls.setMatrixAt(wi, dummy.matrix);
      const wc = wallColor(b, wallRnd).getHex();
      buildingWalls.setColorAt(wi, color.setHex(wc));
      wi++;
      // a cap along the top of every wall, a shade darker, so the rooms read from above with the roof off
      trims.push({ x: w.x, y: b.h + 0.04, z: w.z, sx: w.hw * 2 + 0.06, sy: 0.1, sz: w.hd * 2 + 0.06, c: darker(wc, 0.82) });
      if (b.kind === 'container') continue;
      // the outside of the outer walls: a stone footing, and windows with sills (shutters on houses and farms)
      const alongX = w.hw >= w.hd;
      const off = alongX ? w.z - b.z : w.x - b.x;
      if (Math.abs(off) < (alongX ? b.d : b.w) / 2 - WALL_T / 2 - 0.05) continue;
      const out = Math.sign(off);
      const len = 2 * (alongX ? w.hw : w.hd);
      /** A box `u` along the wall from its middle and `o` out from its outer face, `sl` long and `so` deep. */
      const face = (list: Part[], u: number, y: number, o: number, sl: number, sy: number, so: number, c: number) =>
        list.push({ x: w.x + (alongX ? u : out * (WALL_T / 2 + o)), y, z: w.z + (alongX ? out * (WALL_T / 2 + o) : u), sx: alongX ? sl : so, sy, sz: alongX ? so : sl, c });
      face(trims, 0, 0.17, 0, len + 0.04, 0.34, 0.12, b.kind === 'ruin' ? darker(wc, 0.8) : FOOTINGS[b.kind]);
      const win = WINDOWS[b.kind];
      if (!win || len < win.w + 1.4) continue;
      const n = Math.max(1, Math.floor((len - 0.8) / win.gap));
      for (let k = 0; k < n; k++) {
        const u = (k - (n - 1) / 2) * ((len - 0.4) / n);
        const y = Math.min(b.h - win.h / 2 - 0.4, win.y);
        face(trims, u, y, 0.02, win.w + 0.2, win.h + 0.2, 0.06, dress.trim === dress.frame ? 0xf6f1e4 : dress.trim);
        face(trims, u, y - win.h / 2 - 0.12, 0.06, win.w + 0.36, 0.1, 0.14, dress.trim === dress.frame ? 0xe0d8c4 : darker(dress.trim, 0.85));
        if (!win.bars) face(panes, u, y, 0.06, win.w, win.h, 0.04, 0xffffff);
        else {
          // a dark vent behind three gold bars
          face(trims, u, y, 0.05, win.w, win.h, 0.04, 0x3a2a12);
          for (const t of [-1, 0, 1]) face(trims, u + t * (win.w / 4), y, 0.08, 0.06, win.h, 0.05, dress.edge === 0xffffff ? 0xd9a441 : dress.edge);
        }
      }
    }
    // the real windows: wall below the opening, a sill along it, posts either side, a bar across the middle, a lintel
    // under the eaves, shutters on houses and farms, and the glass (which breaks, leaving the frame)
    const look = GLASS_LOOK[b.kind];
    for (const p of b.windows) {
      if (!look) break;
      const alongX = p.hw > p.hd;
      const len = 2 * (alongX ? p.hw : p.hd);
      const top = b.h - 0.12;
      const mid = (look.sill + top) / 2;
      const frame = dress.trim === dress.frame ? 0xf6f1e4 : dress.trim;
      const wc = wallColor(b, wallRnd).getHex();
      dummy.position.set(p.x, look.sill / 2, p.z);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(p.hw * 2, look.sill, p.hd * 2);
      dummy.updateMatrix();
      buildingWalls.setMatrixAt(wi, dummy.matrix);
      buildingWalls.setColorAt(wi, color.setHex(wc));
      wi++;
      /** A box `u` along the window from its middle and `o` out from the middle of the wall, `sl` long and `so` deep. */
      const at = (u: number, y: number, o: number, sl: number, sy: number, so: number, c: number) =>
        trims.push({ x: p.x + (alongX ? u : p.ox * o), y, z: p.z + (alongX ? p.oz * o : u), sx: alongX ? sl : so, sy, sz: alongX ? so : sl, c });
      at(0, look.sill + 0.04, 0, len + 0.12, 0.08, WALL_T + 0.16, frame);
      at(0, top + 0.06, 0, len + 0.08, 0.12, WALL_T * 0.7, frame);
      for (const k of [-1, 1]) at(k * (len / 2 - 0.05), mid, 0, 0.1, top - look.sill, WALL_T * 0.7, frame);
      at(0, mid, 0, len - 0.1, 0.07, 0.09, frame);
      if (len >= 2) at(0, mid, 0, 0.07, top - look.sill, 0.09, frame);
      if (look.shutters)
        for (const k of [-1, 1]) at(k * (len / 2 + 0.24), mid + 0.1, WALL_T / 2 + 0.03, 0.4, Math.min(1.4, top - look.sill), 0.05, SHUTTERS[b.look % SHUTTERS.length]);
      // and a footing along it like the rest of the wall
      at(0, 0.17, WALL_T / 2, len + 0.04, 0.34, 0.12, FOOTINGS[b.kind]);
      glassParts[p.i] = { x: p.x, y: mid, z: p.z, sx: len - 0.08, sy: top - look.sill - 0.04, sz: 0.05, ry: alongX ? 0 : Math.PI / 2, c: 0xffffff };
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
      // a bank's front door stands between stone pillars under a lintel
      if (b.kind === 'bank' && b.rooms.length && Math.sign(b.rooms[0].z - b.z) === d.oz) {
        for (const k of [-1, 1]) {
          put(WALL_T / 2 + 0.35, k * (half + 0.75), b.h / 2, 0.5, 0.5, b.h, 0xf1ead8);
          put(WALL_T / 2 + 0.35, k * (half + 0.75), 0.15, 0.7, 0.7, 0.3, 0xd9cfb8);
        }
        put(WALL_T / 2 + 0.35, 0, b.h - 0.1, 0.7, d.w + 2.6, 0.35, 0xf1ead8);
      }
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
        if (b.kind === 'house' || b.kind === 'farm') {
          // a brick chimney through the back slope, with a cap
          const along = (alongX ? W : D) * (b.look % 2 ? 0.28 : -0.28);
          const across = -(alongX ? D : W) * 0.2;
          const h = rise * 0.6 + 0.9;
          const [cx, cz] = alongX ? [along, across] : [across, along];
          piece(new THREE.BoxGeometry(0.7, h, 0.7), cx, 0.2 + h / 2, cz, 0xa4553a);
          piece(new THREE.BoxGeometry(0.86, 0.14, 0.86), cx, 0.2 + h, cz, 0x5a5550);
        }
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
    const mats: (T.MeshLambertMaterial | T.MeshBasicMaterial)[] = [roofMat];
    if (special) {
      // a golden egg on top, so the Golden Coop stands out from anywhere (it lifts away with the roof)
      const eggMat = lambert(0xffc83d, { emissive: 0x6a4a00, transparent: true, opacity: 1 });
      const egg = new THREE.Mesh(G.egg, eggMat);
      egg.position.set(0, top - 0.3, 0);
      egg.scale.set(1.6, 1.5, 1.6);
      roof.add(egg);
      mats.push(eggMat);
    }
    if (b.kind === 'police') {
      // a light bar on the ridge that flashes red and blue
      for (const [k, c] of [
        [-1, 0xff3030],
        [1, 0x3a7bff],
      ] as const) {
        const lightMat = basic(c, { transparent: true, opacity: 1 });
        const light = new THREE.Mesh(G.box, lightMat);
        light.position.set(alongX ? k * 0.45 : 0, top + 0.18, alongX ? 0 : k * 0.45);
        light.scale.set(alongX ? 0.8 : 0.4, 0.3, alongX ? 0.4 : 0.8);
        roof.add(light);
        mats.push(lightMat);
        beacons.push({ mat: lightMat, k });
      }
    }
    if (b.kind === 'diner' || b.kind === 'police' || b.kind === 'bank') {
      // the sign along the ridge, readable from the south, and again from the north
      const name = b.kind === 'police' ? 'Police' : b.kind === 'bank' ? 'Bank' : (map.places.find((p) => Math.hypot(p.x - b.x, p.z - b.z) < p.r)?.name ?? 'Diner');
      const tex = b.kind === 'police' ? signTexture(THREE, name, '#2b3f66', '#ffffff') : b.kind === 'bank' ? signTexture(THREE, name, '#2f5d3a', '#ffd23d') : signTexture(THREE, name);
      const signMat = lambert(0xffffff, { map: keep(tex), transparent: true, opacity: 1, side: THREE.DoubleSide, emissive: 0x330000 });
      const sign = new THREE.Mesh(G.plane, signMat);
      sign.position.set(0, top + (b.kind === 'police' ? 1.4 : 1.1), 0);
      sign.scale.set(b.kind === 'diner' ? 8 : 5.5, b.kind === 'diner' ? 2 : 1.4, 1);
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
  // a jail cell's bars: rods close together between a rail along the floor, one halfway up and one up top
  const barRods: Part[] = [];
  const barRails: Part[] = [];
  for (const b of map.buildings)
    for (const w of b.bars) {
      const alongX = w.hw >= w.hd;
      const len = 2 * (alongX ? w.hw : w.hd);
      const h = b.h - 0.15;
      for (let u = -len / 2 + 0.08; u <= len / 2 - 0.05; u += 0.24) barRods.push({ x: w.x + (alongX ? u : 0), y: h / 2, z: w.z + (alongX ? 0 : u), sx: 0.05, sy: h, sz: 0.05, c: 0x5b616b });
      for (const y of [0.06, h * 0.55, h - 0.04]) barRails.push({ x: w.x, y, z: w.z, sx: alongX ? len : 0.1, sy: 0.08, sz: alongX ? 0.1 : len, c: 0x3a3e44 });
    }
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
  const trimMesh = many(G.box, lambert(0xffffff), trims.length);
  trims.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(p.sx, p.sy, p.sz);
    dummy.updateMatrix();
    trimMesh.setMatrixAt(i, dummy.matrix);
    trimMesh.setColorAt(i, color.setHex(p.c));
  });
  // glass catches the sky: pale blue with a bright diagonal shine
  const paneMesh = many(G.box, lambert(0xffffff, { map: keep(glassTexture(THREE)), emissive: 0x1d3a52 }), panes.length);
  panes.forEach((p, i) => {
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(p.sx, p.sy, p.sz);
    dummy.updateMatrix();
    paneMesh.setMatrixAt(i, dummy.matrix);
  });
  scene.add(trimMesh, paneMesh);
  // the glass in the windows that break, a little see-through with a shine across it, and the jagged bits a broken
  // pane leaves in its frame
  const windowGlass = many(G.box, lambert(0xffffff, { map: keep(glassTexture(THREE)), emissive: 0x1d3a52, transparent: true, opacity: 0.62, depthWrite: false }), glassParts.length);
  const glassEdges = many(geo(jaggedGlass(THREE)), lambert(0xd9f1ff, { emissive: 0x24445e, transparent: true, opacity: 0.7, depthWrite: false, side: THREE.DoubleSide }), glassParts.length);
  const glassShown = map.windows.map(() => true);
  const placeGlass = (i: number, whole: boolean) => {
    const p = glassParts[i];
    dummy.position.set(p.x, p.y, p.z);
    dummy.rotation.set(0, p.ry, 0);
    dummy.scale.set(whole ? p.sx : 0, whole ? p.sy : 0, whole ? p.sz : 0);
    dummy.updateMatrix();
    windowGlass.setMatrixAt(i, dummy.matrix);
    dummy.scale.set(whole ? 0 : p.sx, whole ? 0 : p.sy, 1);
    dummy.updateMatrix();
    glassEdges.setMatrixAt(i, dummy.matrix);
  };
  glassParts.forEach((_, i) => placeGlass(i, true));
  windowGlass.renderOrder = 2;
  glassEdges.renderOrder = 2;
  scene.add(windowGlass, glassEdges);
  /** Shows each window's glass whole or broken, as the match has it (news of a break comes as an event too, for the shards). */
  const placeWindows = () => {
    let changed = false;
    for (let i = 0; i < glassShown.length; i++) {
      const whole = !m.broken[i];
      if (whole === glassShown[i] || !glassParts[i]) continue;
      glassShown[i] = whole;
      placeGlass(i, whole);
      changed = true;
    }
    if (!changed) return;
    windowGlass.instanceMatrix.needsUpdate = true;
    glassEdges.instanceMatrix.needsUpdate = true;
  };

  // doors: a pair of leaves in each doorway, hinged at its sides, that swing open (out or in) and shut, a knob on each;
  // a jail cell's is one barred leaf, a bank vault's one round steel door with a wheel. Each eases to where the match
  // has it (`swing`, -1 in to 1 out), and only what moved goes up to the GPU.
  const slabs = map.slabs;
  const plain = slabs.filter((s) => !s.bars && !s.vault);
  const leaves = many(G.box, lambert(0xffffff), plain.length * 2);
  const knobs = many(G.box, lambert(0xd9b45a, { emissive: 0x3a2a00 }), plain.length * 2);
  const leafOf = new Map(plain.map((s, k) => [s.i, k]));
  const swing = slabs.map(() => 0);
  const shownSwing = slabs.map(() => NaN);
  /** The way along a doorway's wall, and its width. */
  const acrossOf = (s: { ox: number; oz: number }) => ({ ax: Math.abs(s.oz), az: Math.abs(s.ox) });
  const widthOf = (s: { ox: number; oz: number; hw: number; hd: number }) => 2 * (s.ox ? s.hd : s.hw);
  const doorH = (s: { b: number }) => Math.min(map.buildings[s.b].h - 0.35, 2.4);
  plain.forEach((s, k) => {
    const b = map.buildings[s.b];
    const c = color.setHex(b.kind === 'house' ? HOUSE_DOORS[b.look % HOUSE_DOORS.length] : (DOOR_PAINT[b.kind] ?? 0x7a4a2a));
    for (const j of [0, 1]) leaves.setColorAt(k * 2 + j, c);
  });
  /** Puts the leaves of door `i` at its swing (gone: nowhere). */
  const placeLeaves = (i: number, gone: boolean) => {
    const s = slabs[i];
    const k = leafOf.get(i);
    if (k === undefined) return;
    const { ax, az } = acrossOf(s);
    const w = widthOf(s);
    const len = w / 2 - 0.04;
    const h = doorH(s);
    const a = (Math.abs(swing[i]) * Math.PI) / 2;
    const sgn = swing[i] >= 0 ? 1 : -1;
    [-1, 1].forEach((side, j) => {
      // from the hinge at this side, toward the middle when shut, out (or in) when open
      const hx = s.x + ax * side * (w / 2);
      const hz = s.z + az * side * (w / 2);
      const dx = -ax * side * Math.cos(a) + s.ox * sgn * Math.sin(a);
      const dz = -az * side * Math.cos(a) + s.oz * sgn * Math.sin(a);
      dummy.position.set(hx + (dx * len) / 2, h / 2 + 0.03, hz + (dz * len) / 2);
      dummy.rotation.set(0, Math.atan2(dx, dz), 0);
      dummy.scale.set(gone ? 0 : 0.09, gone ? 0 : h, gone ? 0 : len);
      dummy.updateMatrix();
      leaves.setMatrixAt(k * 2 + j, dummy.matrix);
      dummy.position.set(hx + dx * (len - 0.16), 1.0, hz + dz * (len - 0.16));
      dummy.scale.set(gone ? 0 : 0.24, gone ? 0 : 0.08, gone ? 0 : 0.08);
      dummy.updateMatrix();
      knobs.setMatrixAt(k * 2 + j, dummy.matrix);
    });
  };
  plain.forEach((s) => placeLeaves(s.i, false));
  scene.add(leaves, knobs);
  /**
   * A door that swings on one hinge, as a group turned about it: its leaf runs from the hinge (at the doorway's +side
   * end) along the group's -x to the far side, and faces the group's z.
   */
  const hinged = slabs
    .filter((s) => s.bars || s.vault)
    .map((s) => {
      const { ax, az } = acrossOf(s);
      const w = widthOf(s);
      const h = doorH(s);
      const root = new THREE.Group();
      root.position.set(s.x + ax * (w / 2), 0, s.z + az * (w / 2));
      // turned so the group's x runs along the wall toward the hinge side, and opening swings it toward the way out
      const base = Math.atan2(-az, ax);
      const out = Math.sign(Math.sin(base) * s.ox + Math.cos(base) * s.oz) || 1;
      const leaf = new THREE.Group();
      const parts: RoofPart[] = [];
      const box = (x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number) => {
        const g = new THREE.BoxGeometry(sx, sy, sz);
        g.translate(x, y, z);
        parts.push({ g, c });
      };
      let wheel: T.Mesh | null = null;
      let light: T.Mesh | null = null;
      if (s.bars) {
        // a frame of flat bars round rods, and a lock plate
        const L = w - 0.06;
        for (const y of [0.08, h / 2, h - 0.06]) box(-L / 2, y, 0, L, 0.08, 0.06, 0x3a3e44);
        for (const x of [-0.04, -L + 0.04]) box(x, h / 2, 0, 0.08, h, 0.07, 0x3a3e44);
        for (let x = -0.24; x > -L + 0.12; x -= 0.2) box(x, h / 2, 0, 0.045, h - 0.1, 0.045, 0x5b616b);
        box(-L + 0.18, 1.05, 0.02, 0.18, 0.26, 0.09, 0x2b2d33);
      } else {
        // a thick steel slab, bolted, with a wheel in the middle that spins as it opens
        const L = w - 0.04;
        box(-L / 2, h / 2 + 0.1, 0, L, h + 0.2, 0.32, 0x8d969f);
        box(-L / 2, h / 2 + 0.1, 0.17, L - 0.3, h - 0.2, 0.04, 0xb7bec5);
        for (const [x, y] of [
          [-0.25, 0.3],
          [-0.25, h - 0.1],
          [-L + 0.25, 0.3],
          [-L + 0.25, h - 0.1],
        ])
          box(x, y, 0.2, 0.12, 0.12, 0.08, 0x5b616b);
        for (const y of [0.6, h / 2 + 0.1, h - 0.4]) box(-0.06, y, 0.1, 0.18, 0.3, 0.44, 0x5b616b);
        const wg = mergeRoof(
          THREE,
          [
            { g: new THREE.TorusGeometry(0.42, 0.06, 6, 20), c: 0xd9b45a },
            { g: new THREE.BoxGeometry(0.84, 0.07, 0.07), c: 0xd9b45a },
            { g: new THREE.BoxGeometry(0.07, 0.84, 0.07), c: 0xd9b45a },
            { g: new THREE.CylinderGeometry(0.11, 0.11, 0.12, 10).rotateX(Math.PI / 2), c: 0x8a6a2a },
          ],
          1,
          true,
        );
        wheel = new THREE.Mesh(geo(wg), partsMat);
        wheel.position.set(-L / 2, h / 2 + 0.1, 0.26);
        leaf.add(wheel);
        // a warning lamp over the doorway, lit while it grinds open
        light = new THREE.Mesh(G.box, basic(0xff4a2a, { transparent: true, opacity: 0 }));
        light.position.set(s.x + s.ox * (WALL_T / 2 + 0.06), map.buildings[s.b].h - 0.35, s.z + s.oz * (WALL_T / 2 + 0.06));
        light.scale.set(0.5, 0.22, 0.5);
        scene.add(light);
      }
      leaf.add(new THREE.Mesh(geo(mergeRoof(THREE, parts, 1, true)), partsMat));
      root.add(leaf);
      root.rotation.y = base;
      scene.add(root);
      return { s, root, base, out, wheel, light };
    });
  /** Eases every door toward the match's word, and moves what moved. */
  const placeDoors = (dt: number, clock: number) => {
    let moved = false;
    for (const s of slabs) {
      const st = m.doors[s.i];
      const want = st === DOOR_OUT ? 1 : st === DOOR_IN ? -1 : 0;
      // a heavy vault door swings slowly; the rest snap round
      swing[s.i] = s.vault ? damp(swing[s.i], want, 1.6, dt) : damp(swing[s.i], want, 12, dt);
      if (Math.abs(swing[s.i] - want) < 0.002) swing[s.i] = want;
      const key = st === DOOR_GONE ? 9 : swing[s.i];
      if (key === shownSwing[s.i]) continue;
      shownSwing[s.i] = key;
      if (leafOf.has(s.i)) {
        placeLeaves(s.i, st === DOOR_GONE);
        moved = true;
      }
    }
    if (moved) {
      leaves.instanceMatrix.needsUpdate = true;
      knobs.instanceMatrix.needsUpdate = true;
    }
    for (const d of hinged) {
      const st = m.doors[d.s.i];
      d.root.visible = st !== DOOR_GONE;
      const opening = st === DOOR_OPENING;
      // grinding open: the wheel spins and the slab shudders
      d.root.rotation.y = d.base + d.out * swing[d.s.i] * (d.s.vault ? 1.75 : Math.PI / 2) + (opening ? Math.sin(clock * 40) * 0.004 : 0);
      if (d.wheel && opening) d.wheel.rotation.z = clock * 2.4;
      if (d.light) (d.light.material as T.MeshBasicMaterial).opacity = opening ? (Math.sin(clock * 9) > 0 ? 1 : 0.25) : 0;
    }
  };

  // trees: oaks (a trunk and two round crowns), pines (two cones), birches (a white trunk with dark marks and a pale
  // narrow crown) and fruit trees (one round crown hung with fruit)
  const treeRnd = scatter(3);
  const count = (k: string) => map.trees.filter((t) => t.kind === k).length;
  const trunks = many(geo(new THREE.CylinderGeometry(0.32, 0.48, 1, 7)), lambert(0xffffff), map.trees.length);
  const crowns = many(G.lowBall, sway(lambert(0xffffff, { flatShading: true }), -0.6, 0.05), count('oak') * 2 + count('birch') * 2 + count('fruit'));
  const cones = many(G.pine, sway(lambert(0xffffff, { flatShading: true }), -0.5, 0.07), count('pine') * 2);
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
  const bushes = many(geo(new THREE.SphereGeometry(1, 9, 7)), sway(lambert(0xffffff, { flatShading: true }), -0.4, 0.035), map.bushes.length);
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
  /** A balloon in two colors of stripe, top to bottom. */
  const stripedBall = (a: number, b: number) => {
    const g = new THREE.SphereGeometry(1, 16, 12).toNonIndexed();
    const p = g.attributes.position as T.BufferAttribute;
    const cols = new Float32Array(p.count * 3);
    const ca = new THREE.Color(a);
    const cb = new THREE.Color(b);
    for (let i = 0; i < p.count; i += 3) {
      // the stripe each triangle falls in, by the angle round to its middle
      const x = p.getX(i) + p.getX(i + 1) + p.getX(i + 2);
      const z = p.getZ(i) + p.getZ(i + 1) + p.getZ(i + 2);
      const c = Math.floor(((Math.atan2(z, x) + Math.PI) / (Math.PI * 2)) * 16) % 2 ? cb : ca;
      for (let k = 0; k < 3; k++) cols.set([c.r, c.g, c.b], (i + k) * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return geo(g);
  };
  const stripes = lambert(0xffffff, { vertexColors: true });
  const supplyBalloon = stripedBall(0xff5a5a, 0xfff3e6);
  const supplies = [...map.drops, ...map.flares].map((id) => {
    const c = map.containers[id];
    const group = new THREE.Group();
    const box = add(group, G.box, supplyMat, 0, SUPPLY_HALF, 0, SUPPLY_HALF * 2, SUPPLY_HALF * 2, SUPPLY_HALF * 2);
    const balloon = new THREE.Group();
    add(balloon, supplyBalloon, stripes, 0, 6, 0, 1.7, 2, 1.7);
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
      case 'bench': {
        // a plank on two legs, and a board behind it against the wall
        boxes.push({ x: f.x, y: 0.42, z: f.z, sx: f.hw * 2, sy: 0.07, sz: f.hd * 2, c: 0x8a5a2b });
        const ux = wx ? 0 : 1;
        const uz = wx ? 1 : 0;
        for (const k of [-1, 1]) boxes.push({ x: f.x + ux * k * (wide / 2 - 0.15), y: 0.2, z: f.z + uz * k * (wide / 2 - 0.15), sx: wx ? deep * 0.8 : 0.08, sy: 0.4, sz: wx ? 0.08 : deep * 0.8, c: 0x5a3e24 });
        part(boxes, deep / 2 - 0.04, 0.75, 0.06, 0.5, wide, 0x8a5a2b);
        break;
      }
      case 'desk':
        // a desk with drawers down one side, papers and a lamp on it
        boxes.push({ x: f.x, y: 0.75, z: f.z, sx: f.hw * 2, sy: 0.06, sz: f.hd * 2, c: 0x6b4426 });
        boxes.push({ x: f.x - f.hw * 0.6, y: 0.37, z: f.z, sx: f.hw * 0.7, sy: 0.72, sz: f.hd * 2 - 0.06, c: 0x5a3e24 });
        boxes.push({ x: f.x + f.hw - 0.08, y: 0.37, z: f.z, sx: 0.08, sy: 0.72, sz: f.hd * 2 - 0.06, c: 0x5a3e24 });
        boxes.push({ x: f.x + 0.2, y: 0.79, z: f.z, sx: 0.5, sy: 0.02, sz: 0.36, c: 0xf6f3ec });
        boxes.push({ x: f.x - f.hw + 0.3, y: 0.95, z: f.z - f.hd * 0.4, sx: 0.08, sy: 0.34, sz: 0.08, c: 0x2b2d33 });
        boxes.push({ x: f.x - f.hw + 0.3, y: 1.12, z: f.z - f.hd * 0.4, sx: 0.24, sy: 0.1, sz: 0.24, c: 0x3fb84a });
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
  const decorMat = sway(lambert(0xffffff, { vertexColors: true, flatShading: true, side: THREE.DoubleSide }), 0.05, 0.16);
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
  const lampHeads = many(G.lowBall, basic(0xfff0b0), map.lamps.length);
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

  // a jail cell's bars
  instance(G.box, barRods);
  instance(G.box, barRails);

  // furniture that opens (chests of drawers, bookshelves, lockers, safes and deposit boxes), each a few boxes in one
  // instanced mesh, `SLOTS` a piece, put back together the open way once it opens; a bookshelf's rows of books another
  const stashes = map.containers.filter((c) => isStash(c.kind));
  const SLOTS = 10;
  const stashBits = many(G.box, lambert(0xffffff), stashes.length * SLOTS);
  const shelves = stashes.filter((c) => c.kind === 'books');
  const bookRows = many(G.box, lambert(0xffffff, { map: keep(booksTexture(THREE)) }), shelves.length * 4);
  const rowOf = new Map(shelves.map((c, k) => [c.id, k]));
  const LOCKER_PAINT: Partial<Record<BuildingKind, number>> = { police: 0x5f7a99, warehouse: 0x7f8c97, shed: 0x6a8f5a };
  const stashState = stashes.map(() => -1);
  /** Lays out one piece of stash furniture, open or not. */
  const placeStash = (c: Container, k: number, open: boolean) => {
    // `u` along the wall it stands against, `v` out from its middle toward its front
    const gx = c.ax ? 0 : 1;
    const gz = c.ax ? 1 : 0;
    const fx = c.ax ? c.face : 0;
    const fz = c.ax ? 0 : c.face;
    let n = 0;
    const box = (u: number, v: number, y: number, su: number, sy: number, sv: number, hex: number) => {
      dummy.position.set(c.x + gx * u + fx * v, y, c.z + gz * u + fz * v);
      dummy.rotation.set(0, 0, 0);
      dummy.scale.set(gx * su + Math.abs(fx) * sv, sy, gz * su + Math.abs(fz) * sv);
      dummy.updateMatrix();
      stashBits.setMatrixAt(k * SLOTS + n, dummy.matrix);
      stashBits.setColorAt(k * SLOTS + n++, color.setHex(hex));
    };
    const { along: a, deep: d } = STASH[c.kind as keyof typeof STASH];
    const b = map.buildings.find((x) => Math.abs(c.x - x.x) < x.w / 2 && Math.abs(c.z - x.z) < x.d / 2);
    switch (c.kind) {
      case 'drawer': {
        // three drawers in a wooden chest, the top one pulled out once it's been gone through
        const wood = [0x9a6a3a, 0x7a4f28, 0xb98250, 0x6b4426][(b?.look ?? 0) % 4];
        box(0, 0, 0.45, a * 2, 0.9, d * 2, wood);
        box(0, 0, 0.92, a * 2 + 0.04, 0.04, d * 2 + 0.04, darker(wood, 0.75));
        for (const [j, y] of [0.2, 0.47, 0.74].entries()) {
          const out = open && j === 2 ? 0.38 : 0;
          box(0, d + 0.01 + out, y, a * 2 - 0.1, 0.22, 0.03, darker(wood, 1.15));
          box(0, d + 0.04 + out, y, 0.14, 0.05, 0.04, 0xd9b45a);
        }
        if (open) box(0, d - 0.15 + 0.38 / 2, 0.71, a * 2 - 0.14, 0.18, 0.4, darker(wood, 0.6));
        break;
      }
      case 'books': {
        // a back, two sides and five shelves, the books on them (some knocked off once it's been searched)
        box(0, -d + 0.03, 1.0, a * 2, 2, 0.06, 0x5a3e24);
        for (const s of [-1, 1]) box(s * (a - 0.03), 0, 1.0, 0.06, 2, d * 2, 0x6b4426);
        for (const y of [0.06, 0.5, 0.95, 1.4, 1.95]) box(0, 0, y, a * 2, 0.05, d * 2, 0x6b4426);
        const r = rowOf.get(c.id) ?? 0;
        [0.28, 0.72, 1.17, 1.62].forEach((y, j) => {
          const gone = open && (j === 1 || j === 2);
          dummy.position.set(c.x + fx * 0.01, y, c.z + fz * 0.01);
          dummy.rotation.set(0, c.ax ? Math.PI / 2 : 0, 0);
          dummy.scale.set(gone ? 0 : a * 2 - 0.14, gone ? 0 : 0.36, gone ? 0 : d * 2 - 0.08);
          dummy.updateMatrix();
          bookRows.setMatrixAt(r * 4 + j, dummy.matrix);
        });
        break;
      }
      case 'locker': {
        // a tall steel locker with vents and a handle; open, its door stands out square from the hinge
        const paint = (b && LOCKER_PAINT[b.kind]) ?? 0x7f8c97;
        box(0, 0, 0.95, a * 2, 1.9, d * 2, paint);
        if (open) {
          box(0, d - 0.01, 0.95, a * 2 - 0.08, 1.78, 0.02, 0x2b2d33);
          box(-a + 0.02, d + a, 0.95, 0.03, 1.8, a * 2 - 0.04, darker(paint, 1.12));
        } else {
          box(0, d + 0.01, 0.95, a * 2 - 0.06, 1.8, 0.03, darker(paint, 1.12));
          for (const y of [1.62, 1.52, 1.42]) box(0, d + 0.03, y, a * 1.2, 0.03, 0.02, 0x2b2d33);
          box(a - 0.1, d + 0.04, 1.0, 0.04, 0.16, 0.04, 0xd9dde2);
        }
        break;
      }
      case 'safe': {
        // a squat steel safe with a gold dial; open, its door swings out square and there's a gleam inside
        box(0, 0, 0.5, a * 2, 1, d * 2, 0x3a3e44);
        if (open) {
          box(0, d - 0.01, 0.5, a * 2 - 0.14, 0.82, 0.02, 0x15161a);
          box(0, d - 0.25, 0.3, a * 1.2, 0.14, 0.3, 0xffd23d);
          box(-a + 0.03, d + a - 0.05, 0.5, 0.06, 0.86, a * 2 - 0.1, 0x5b616b);
        } else {
          box(0, d + 0.02, 0.5, a * 2 - 0.12, 0.86, 0.04, 0x5b616b);
          box(0.12, d + 0.05, 0.62, 0.16, 0.16, 0.04, 0xffd23d);
          box(-0.16, d + 0.06, 0.5, 0.06, 0.24, 0.06, 0xd9dde2);
        }
        break;
      }
      case 'deposit': {
        // a wall of little brass doors; one stands open once it's been gone through
        box(0, 0, 0.8, a * 2, 1.6, d * 2, 0xb8a26a);
        for (const y of [0.4, 0.8, 1.2]) box(0, d + 0.01, y, a * 2 - 0.04, 0.03, 0.02, 0x7a6a3a);
        for (const u of [-a / 3, a / 3]) box(u, d + 0.01, 0.8, 0.03, 1.56, 0.02, 0x7a6a3a);
        if (open) {
          box(a * 0.66, d + 0.012, 1.0, a * 0.6, 0.36, 0.02, 0x2b2d33);
          box(a - 0.02, d + a * 0.3, 1.0, 0.03, 0.36, a * 0.6, 0xd9c48a);
        }
        break;
      }
    }
    // the slots it doesn't use stay empty
    dummy.scale.set(0, 0, 0);
    dummy.updateMatrix();
    while (n < SLOTS) stashBits.setMatrixAt(k * SLOTS + n++, dummy.matrix);
  };
  const placeStashes = (force: boolean) => {
    let changed = false;
    stashes.forEach((c, k) => {
      const open = m.opened[c.id] ? 1 : 0;
      if (!force && stashState[k] === open) return;
      stashState[k] = open;
      placeStash(c, k, open === 1);
      changed = true;
    });
    if (!changed) return;
    stashBits.instanceMatrix.needsUpdate = true;
    if (stashBits.instanceColor) stashBits.instanceColor.needsUpdate = true;
    bookRows.instanceMatrix.needsUpdate = true;
  };
  placeStashes(true);
  scene.add(stashBits, bookRows);

  // ---------------------------------------------------------------------------------------------------------------
  // Contact shadows: soft dark pools under everything that stands on the ground, nudged away from the sun so they all
  // fall the same way, and along both sides of every wall (shade where walls meet the floor). Two instanced meshes,
  // round and square; a crate's or barrel's goes when it breaks.

  type Shade = { x: number; z: number; sx: number; sz: number; ry: number; id: number };
  const roundShades: Shade[] = [];
  const squareShades: Shade[] = [];
  const wallShades: Shade[] = [];
  const shadeRound = (x: number, z: number, r: number, up: number, id = -1) => roundShades.push({ x: x + SUN.x * up, z: z + SUN.z * up, sx: r * 2, sz: r * 2, ry: 0, id });
  const shadeBox = (x: number, z: number, hw: number, hd: number, up: number, edge: number, id = -1, ry = 0) => squareShades.push({ x: x + SUN.x * up, z: z + SUN.z * up, sx: hw * 2 + edge * 2, sz: hd * 2 + edge * 2, ry, id });
  for (const t of map.trees) shadeRound(t.x, t.z, t.kind === 'pine' ? 1.9 : t.kind === 'birch' ? 1.5 : 2.1, 1.4);
  for (const b of map.bushes) shadeRound(b.x, b.z, BUSH_R * 1.25, 0.5);
  for (const r of map.rocks) shadeRound(r.x, r.z, r.r * 1.35, r.r * 0.5);
  for (const s of map.stumps) shadeRound(s.x, s.z, s.r * 1.5, 0.2);
  for (const c of map.fires) shadeRound(c.x, c.z, CAMP.pit + 0.5, 0);
  for (const p of map.lamps) shadeRound(p.x, p.z, 0.45, 0.2);
  // a wall's strip runs its length (texture u), soft across it
  for (const b of map.buildings)
    for (const w of b.walls) {
      const alongX = w.hw >= w.hd;
      wallShades.push({ x: w.x + SUN.x * 0.45, z: w.z + SUN.z * 0.45, sx: 2 * (alongX ? w.hw : w.hd) + 0.3, sz: 2 * (alongX ? w.hd : w.hw) + 2.4, ry: alongX ? 0 : Math.PI / 2, id: -1 });
    }
  // a window's wall and frame throw their shade too
  for (const p of map.windows) {
    const alongX = p.hw > p.hd;
    wallShades.push({ x: p.x + SUN.x * 0.45, z: p.z + SUN.z * 0.45, sx: 2 * (alongX ? p.hw : p.hd) + 0.3, sz: 2 * (alongX ? p.hd : p.hw) + 2.4, ry: alongX ? 0 : Math.PI / 2, id: -1 });
  }
  for (const c of map.cars) shadeBox(c.x, c.z, c.hw, c.hd, 0.5, 0.8);
  for (const l of map.logs) shadeBox(l.x, l.z, l.hw, l.hd, 0.2, 0.3);
  for (const t of map.tables) shadeBox(t.x, t.z, t.alongX ? TABLE_HW : TABLE_HD, t.alongX ? TABLE_HD : TABLE_HW, 0.4, 0.25);
  for (const c of map.containers) {
    if (c.kind === 'crate') shadeBox(c.x, c.z, CRATE_HALF, CRATE_HALF, 0.5, 0.5, c.id);
    else if (c.kind === 'hay') shadeBox(c.x, c.z, HAY_HW, HAY_HD, 0.4, 0.3, c.id);
    else if (c.kind === 'chest') shadeBox(c.x, c.z, CHEST_HW, CHEST_HD, 0.3, 0.25);
    else if (c.kind === 'barrel') shadeRound(c.x, c.z, BARREL_R * 1.5, 0.4, c.id);
  }
  const shadeMat = (t: T.Texture, opacity: number) => basic(0x10182a, { map: t, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const roundShade = many(G.plane, shadeMat(blob, 0.85), roundShades.length);
  const squareShade = many(G.plane, shadeMat(keep(softSquareTexture(THREE)), 0.5), squareShades.length);
  const wallShade = many(G.plane, shadeMat(keep(softSquareTexture(THREE, true)), 0.5), wallShades.length);
  const placeShade = (im: T.InstancedMesh, s: Shade, i: number, on: boolean) => {
    dummy.position.set(s.x, 0.028, s.z);
    dummy.rotation.set(-Math.PI / 2, 0, s.ry);
    dummy.scale.set(on ? s.sx : 0, on ? s.sz : 0, 1);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
  };
  roundShades.forEach((s, i) => placeShade(roundShade, s, i, true));
  squareShades.forEach((s, i) => placeShade(squareShade, s, i, true));
  wallShades.forEach((s, i) => placeShade(wallShade, s, i, true));
  roundShade.renderOrder = 1;
  squareShade.renderOrder = 1;
  wallShade.renderOrder = 1;
  scene.add(roundShade, squareShade, wallShade);
  /** The shadows of things that break, and whether each is drawn. */
  const breakable = [
    ...roundShades.map((s, i) => ({ s, i, im: roundShade, on: true })),
    ...squareShades.map((s, i) => ({ s, i, im: squareShade, on: true })),
  ].filter((x) => x.s.id >= 0);
  const placeShades = () => {
    for (const b of breakable) {
      const on = !m.opened[b.s.id];
      if (on === b.on) continue;
      b.on = on;
      placeShade(b.im, b.s, b.i, on);
      b.im.instanceMatrix.needsUpdate = true;
    }
  };

  // ---------------------------------------------------------------------------------------------------------------
  // The storm: a purple wall, a tint over everything outside it, and a white ring where it is headed.

  // the wall is a curtain of swirling purple, thickest and glowing pink where it meets the ground, thinning upward
  const stormUniforms = { uTime: wind, uR: { value: 100 } };
  const stormWall = new THREE.Mesh(
    geo(new THREE.CylinderGeometry(1, 1, 90, 160, 1, true)),
    mat(
      new THREE.ShaderMaterial({
        uniforms: stormUniforms,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        vertexShader: `
          varying vec2 vUv;
          varying float vY;
          void main() {
            vUv = uv;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vY = wp.y;
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: `
          uniform float uTime;
          uniform float uR;
          varying vec2 vUv;
          varying float vY;
          void main() {
            // meters round the wall, so the swirls keep their size as it shrinks
            float s = vUv.x * uR * 6.2832;
            float h = clamp(vY / 46.0, 0.0, 1.0);
            float a1 = sin(s * 0.55 + vY * 0.32 - uTime * 1.7) * 0.5 + 0.5;
            float a2 = sin(s * 0.21 - vY * 0.18 + uTime * 0.8) * 0.5 + 0.5;
            float a3 = sin(s * 1.3 + vY * 0.9 - uTime * 3.1) * 0.5 + 0.5;
            float swirl = a1 * 0.5 + a2 * 0.35 + a3 * 0.15;
            float foot = 1.0 - smoothstep(0.0, 3.0, vY);
            vec3 deep = vec3(0.36, 0.16, 0.86);
            vec3 light = vec3(0.70, 0.46, 1.0);
            vec3 glow = vec3(1.0, 0.55, 0.95);
            vec3 col = mix(deep, light, swirl) ;
            col = mix(col, glow, foot * 0.75);
            float a = (0.24 + swirl * 0.36) * pow(1.0 - h, 1.2) + foot * 0.4;
            gl_FragColor = vec4(col, a);
          }`,
      }),
    ),
  );
  stormWall.position.y = 44;
  stormWall.renderOrder = 3;
  scene.add(stormWall);
  // a bright seam along the ground where the storm begins
  const seam = freeRing(THREE, 160);
  geos.push(seam.geometry);
  const seamMesh = new THREE.Mesh(seam.geometry, basic(0xe9a6ff, { transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide }));
  seamMesh.position.y = 0.13;
  seamMesh.renderOrder = 2;
  scene.add(seamMesh);
  const tint = freeRing(THREE, 160);
  geos.push(tint.geometry);
  const stormTint = new THREE.Mesh(tint.geometry, basic(0x7a3cf0, { transparent: true, opacity: 0.36, depthWrite: false, side: THREE.DoubleSide }));
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
  // a yellow band round it, a windshield and headlights up front
  add(bus, G.box, lambert(0xffc83d), 0, -0.55, 0, 3.04, 0.26, 8.04);
  add(bus, G.box, M.dark, 0, 0.35, 4.01, 2.5, 0.85, 0.06);
  for (const side of [-1, 1]) add(bus, G.box, lambert(0xfff6c8, { emissive: 0x7a6a30 }), side * 1.05, -0.75, 4.02, 0.4, 0.26, 0.06);
  const busBalloon = add(bus, stripedBall(0x8a4dff, 0xf4ecff), stripes, 0, 8.4, 0, 3.2, 3.7, 3.2);
  bake('bus', bus, [busBalloon]);
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
    return bake(`helmet:${lv}`, g, [], true);
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
    return bake(`vest:${lv}`, g, [], true);
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
    return bake(`apron:${lv}`, g, [], true);
  }

  /** What's in hand, a gun's stripe in rarity `r`'s color (baked in, so a model for each rarity). */
  function gunModel(w: Held, r = 0): HeldModel {
    const g = new THREE.Group();
    const tint = rarity[r] ?? rarity[0];
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
      case 'mirv':
        // a red canister with a black band and three bomblets clipped round its top
        add(g, G.cyl, M.mirv, 0, -0.04, 0.26, 0.12, 0.3, 0.12);
        add(g, G.cyl, M.dark, 0, -0.02, 0.26, 0.125, 0.06, 0.125);
        for (let k = 0; k < 3; k++) add(g, G.ball, M.grenade, Math.cos(k * 2.1) * 0.08, 0.15, 0.26 + Math.sin(k * 2.1) * 0.08, 0.055, 0.055, 0.055);
        add(g, G.box, M.metal, 0, 0.2, 0.26, 0.05, 0.05, 0.05);
        break;
      case 'stun':
        // a pale blue can with white bands and a ring pull
        add(g, G.cyl, M.stun, 0, 0, 0.26, 0.1, 0.32, 0.1);
        for (const y of [-0.1, 0.1]) add(g, G.cyl, M.white, 0, y, 0.26, 0.105, 0.04, 0.105);
        add(g, G.box, M.metal, 0, 0.19, 0.26, 0.05, 0.06, 0.05);
        add(g, G.wire, M.steel, 0.06, 0.21, 0.26, 0.06, 0.06, 0.06);
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
        add(g, G.box, tint, 0, 0.08, 0.12, 0.13, 0.03, 0.34);
        break;
      case 'flare':
        // a stubby orange pistol with a wide mouth, the flare showing in it
        add(g, G.box, M.flare, 0, 0, 0.1, 0.13, 0.15, 0.36);
        barrel(g, M.flare, 0, 0.01, 0.36, 0.1, 0.22);
        barrel(g, M.custard, 0, 0.01, 0.47, 0.07, 0.02);
        add(g, G.box, M.flare, 0, -0.15, -0.02, 0.1, 0.22, 0.12);
        add(g, G.box, tint, 0, 0.085, 0.06, 0.135, 0.03, 0.22);
        break;
      case 'revolver':
        barrel(g, M.metal, 0, 0.04, 0.36, 0.05, 0.5);
        barrel(g, M.dark, 0, 0.0, 0.08, 0.1, 0.16);
        add(g, G.box, M.wood, 0, -0.15, -0.04, 0.1, 0.24, 0.12);
        add(g, G.box, tint, 0, 0.1, 0.08, 0.06, 0.03, 0.2);
        break;
      case 'smg':
        add(g, G.box, M.dark, 0, 0, 0.18, 0.14, 0.17, 0.62);
        add(g, G.box, M.metal, 0, -0.18, 0.2, 0.08, 0.26, 0.1);
        add(g, G.box, M.dark, 0, -0.12, -0.06, 0.1, 0.2, 0.1);
        add(g, G.box, tint, 0, 0.1, 0.18, 0.15, 0.03, 0.5);
        break;
      case 'micro':
        add(g, G.box, M.dark, 0, 0, 0.12, 0.13, 0.16, 0.4);
        add(g, G.box, M.metal, 0, -0.2, 0.06, 0.07, 0.3, 0.08);
        barrel(g, M.metal, 0, 0.02, 0.38, 0.035, 0.16);
        add(g, G.box, tint, 0, 0.09, 0.12, 0.14, 0.03, 0.3);
        break;
      case 'hsmg':
        // chunky, with a fat green box of heavy rounds and a grip out front
        add(g, G.box, M.dark, 0, 0, 0.2, 0.17, 0.2, 0.66);
        barrel(g, M.metal, 0, 0.03, 0.6, 0.045, 0.2);
        add(g, G.box, ammoMat.heavy, 0, -0.21, 0.2, 0.1, 0.3, 0.14);
        add(g, G.box, M.dark, 0, -0.14, 0.45, 0.07, 0.18, 0.07);
        add(g, G.box, M.dark, 0, -0.12, -0.08, 0.1, 0.2, 0.1);
        add(g, G.box, tint, 0, 0.115, 0.18, 0.18, 0.03, 0.5);
        break;
      case 'marksman':
        // long and tan, a scope on top and a short magazine
        add(g, G.box, M.tan, 0, 0, 0.3, 0.12, 0.15, 1.0);
        barrel(g, M.dark, 0, 0.02, 0.92, 0.035, 0.42);
        barrel(g, M.dark, 0, 0.15, 0.3, 0.05, 0.34);
        add(g, G.box, M.dark, 0, -0.15, 0.32, 0.07, 0.16, 0.12);
        add(g, G.box, tint, 0, 0.085, 0.55, 0.13, 0.03, 0.34);
        break;
      case 'rifle':
        add(g, G.box, M.dark, 0, 0, 0.3, 0.12, 0.16, 1.05);
        add(g, G.box, M.metal, 0, -0.17, 0.3, 0.08, 0.24, 0.12);
        add(g, G.box, M.dark, 0, 0.14, 0.2, 0.06, 0.1, 0.3);
        add(g, G.box, tint, 0, 0.09, 0.45, 0.13, 0.03, 0.5);
        break;
      case 'burst':
        add(g, G.box, M.tan, 0, 0, 0.22, 0.14, 0.2, 0.78);
        barrel(g, M.dark, 0, 0.03, 0.72, 0.04, 0.3);
        add(g, G.box, M.dark, 0, 0.16, 0.25, 0.05, 0.08, 0.5);
        add(g, G.box, M.metal, 0, -0.16, 0.0, 0.08, 0.2, 0.12);
        add(g, G.box, tint, 0, 0.11, 0.35, 0.15, 0.03, 0.3);
        break;
      case 'scout':
        add(g, G.box, M.olive, 0, 0, 0.25, 0.11, 0.14, 0.9);
        barrel(g, M.metal, 0, 0.02, 0.85, 0.035, 0.4);
        barrel(g, M.dark, 0, 0.15, 0.25, 0.05, 0.3);
        add(g, G.box, tint, 0, 0.08, 0.05, 0.12, 0.03, 0.3);
        break;
      case 'lmg':
        add(g, G.box, M.dark, 0, 0, 0.3, 0.16, 0.2, 1.0);
        barrel(g, M.metal, 0, 0.03, 0.95, 0.05, 0.5);
        add(g, G.box, M.olive, 0, -0.2, 0.25, 0.2, 0.22, 0.26);
        add(g, G.box, M.metal, 0, -0.2, 0.95, 0.03, 0.3, 0.03).rotation.x = 0.4;
        add(g, G.box, tint, 0, 0.11, 0.35, 0.17, 0.03, 0.5);
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
        add(g, G.box, tint, 0, 0.135, 0.02, 0.27, 0.03, 0.2);
        break;
      }
      case 'shotgun':
        add(g, G.box, M.wood, 0, -0.02, 0, 0.13, 0.16, 0.45);
        barrel(g, M.dark, 0, 0.03, 0.48, 0.07, 0.75);
        add(g, G.box, tint, 0, -0.06, 0.4, 0.12, 0.08, 0.28);
        break;
      case 'auto':
        add(g, G.box, M.dark, 0, 0, 0.15, 0.15, 0.18, 0.6);
        barrel(g, M.metal, 0, 0.03, 0.62, 0.06, 0.4);
        barrel(g, M.metal, 0, -0.18, 0.25, 0.14, 0.12).rotation.set(0, 0, Math.PI / 2);
        add(g, G.box, tint, 0, 0.1, 0.15, 0.16, 0.03, 0.4);
        break;
      case 'double':
        add(g, G.box, M.wood, 0, -0.03, 0, 0.13, 0.15, 0.42);
        barrel(g, M.dark, -0.045, 0.04, 0.5, 0.05, 0.72);
        barrel(g, M.dark, 0.045, 0.04, 0.5, 0.05, 0.72);
        add(g, G.box, tint, 0, -0.05, 0.3, 0.14, 0.06, 0.12);
        break;
      case 'sniper':
        add(g, G.box, M.dark, 0, 0, 0.2, 0.11, 0.14, 0.75);
        barrel(g, M.metal, 0, 0.02, 0.85, 0.035, 0.7);
        barrel(g, M.dark, 0, 0.16, 0.25, 0.06, 0.38);
        add(g, G.box, tint, 0, 0.08, 0.05, 0.12, 0.03, 0.3);
        break;
      case 'crossbow':
        add(g, G.box, M.wood, 0, 0, 0.2, 0.1, 0.12, 0.75);
        add(g, G.box, M.dark, 0, 0.02, 0.56, 0.9, 0.05, 0.06);
        add(g, G.box, M.bolt, 0, 0.08, 0.4, 0.03, 0.03, 0.7);
        add(g, G.box, tint, 0, -0.07, 0.1, 0.11, 0.04, 0.3);
        break;
      case 'launcher':
        barrel(g, M.launcher, 0, 0.05, 0.3, 0.17, 1.1);
        add(g, G.box, M.dark, 0, -0.16, 0.2, 0.08, 0.24, 0.12);
        barrel(g, tint, 0, 0.05, 0.75, 0.18, 0.12);
        break;
    }
    return { group: bake(`held:${w}:${isWeapon(w) ? r : 0}`, g, [spin]), spin };
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Tiles. What never changes once the island is built (trees, rocks, bushes, walls, roads, fences, furniture and the
  // rest) is split into tiles of the island, each its own instanced mesh, so only the tiles in view are drawn. What
  // changes as the match goes on (crates break, chests and fridges open, fires flicker, furniture shows as a roof
  // lifts, shadows go with what breaks) stays as it is.

  const moving = new Set<T.InstancedMesh>([windowGlass, glassEdges, crates, chestBase, chestLid, chestGlow, barrels, barrelBands, flames, fireGlow, fridgeBase, fridgeDoor, fridgeHandles, fridgeInside, bowls, tanks, seats, hay, roundShade, squareShade, leaves, knobs, stashBits, bookRows, ...furnished]);
  const SPAN = 120;
  for (const im of [...instanced]) {
    if (moving.has(im) || !im.parent || !im.visible || im.count < 16) continue;
    const tiles = new Map<number, number[]>();
    for (let i = 0; i < im.count; i++) {
      im.getMatrixAt(i, relative);
      const k = Math.floor((relative.elements[12] + HALF + 60) / SPAN) * 100 + Math.floor((relative.elements[14] + HALF + 60) / SPAN);
      const list = tiles.get(k);
      if (list) list.push(i);
      else tiles.set(k, [i]);
    }
    if (tiles.size < 2) continue;
    for (const ids of tiles.values()) {
      const t = many(im.geometry, im.material as T.Material, ids.length);
      ids.forEach((i, j) => {
        im.getMatrixAt(i, relative);
        t.setMatrixAt(j, relative);
        if (im.instanceColor) t.setColorAt(j, im.getColorAt(i, color));
      });
      t.position.copy(im.position);
      t.quaternion.copy(im.quaternion);
      t.scale.copy(im.scale);
      t.renderOrder = im.renderOrder;
      t.computeBoundingSphere();
      im.parent.add(t);
    }
    im.removeFromParent();
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Eggs.

  // What every egg has, drawn instanced: a draw call a part however many eggs there are (see EggSlots). The face (eyes
  // with whites, pupils and a glint, and rosy cheeks, around the eyes' middle so it can blink and squint), both hands
  // and the party hat (cap, band and bobble) are each merged into one geometry.
  const shaped = (g: T.BufferGeometry, x: number, y: number, z: number, sx: number, sy: number, sz: number, c: number, rx = 0): RoofPart => {
    g.scale(sx, sy, sz);
    if (rx) g.rotateX(rx);
    g.translate(x, y, z);
    return { g, c };
  };
  const faceParts: RoofPart[] = [];
  for (const side of [-1, 1]) {
    faceParts.push(shaped(new THREE.SphereGeometry(1, 10, 8), side * 0.17, 0, 0.5, 0.125, 0.145, 0.06, 0xffffff));
    faceParts.push(shaped(new THREE.SphereGeometry(1, 8, 6), side * 0.175, -0.014, 0.548, 0.074, 0.092, 0.04, 0x17181d));
    faceParts.push(shaped(new THREE.SphereGeometry(1, 6, 4), side * 0.15, 0.03, 0.588, 0.026, 0.026, 0.012, 0xffffff));
    faceParts.push(shaped(new THREE.SphereGeometry(1, 8, 4), side * 0.3, -0.19, 0.455, 0.075, 0.045, 0.03, 0xff9c8f));
  }
  const faceGeo = geo(mergeRoof(THREE, faceParts, 1, true));
  const handGeo = geo(mergeRoof(THREE, [-1, 1].map((side) => shaped(new THREE.SphereGeometry(1, 10, 8), side * 0.4, 0.72, 0.42, 0.11, 0.11, 0.11, 0xffffff)), 1, true));
  const hatGeo = geo(
    mergeRoof(THREE, [shaped(new THREE.SphereGeometry(1, 18, 8, 0, Math.PI * 2, 0, Math.PI / 2), 0, 1.08, 0, 0.5, 0.52, 0.5, 0xffffff), shaped(new THREE.TorusGeometry(1, 0.12, 6, 24), 0, 1.1, 0, 0.47, 0.47, 0.47, 0xffffff, Math.PI / 2), shaped(new THREE.SphereGeometry(1, 8, 6), 0, 1.64, 0, 0.11, 0.11, 0.11, 0xffffff)], 1, true),
  );
  // a glider canopy in the egg's color with white panels between, the white ones and the knob on top their own mesh
  const canopyBase = new THREE.ConeGeometry(1, 1, 12, 1, true).toNonIndexed();
  canopyBase.computeVertexNormals();
  const panels = [new THREE.BufferGeometry(), new THREE.BufferGeometry()];
  {
    const P = canopyBase.attributes.position.array as Float32Array;
    const Nn = canopyBase.attributes.normal.array as Float32Array;
    // three points a triangle, two triangles a panel, every other panel white
    for (const [k, g] of panels.entries()) {
      const pos: number[] = [];
      const nor: number[] = [];
      for (let t = 0; t * 9 < P.length; t++) {
        if (Math.floor(t / 2) % 2 !== k) continue;
        for (let j = t * 9; j < t * 9 + 9; j++) {
          pos.push(P[j]);
          nor.push(Nn[j]);
        }
      }
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
      g.scale(1.9, 0.9, 1.9);
      g.translate(0, 2.9, 0);
    }
  }
  canopyBase.dispose();
  const canopyGeo = geo(mergeRoof(THREE, [{ g: panels[0], c: 0xffffff }], 1, true));
  const panelGeo = geo(mergeRoof(THREE, [{ g: panels[1], c: 0xffffff }, shaped(new THREE.SphereGeometry(1, 12, 9), 0, 3.35, 0, 0.22, 0.22, 0.22, 0xffffff)], 1, true));
  // cracks spread over a hurt egg: the light ones below two thirds health, all of them below a third
  const crackTex = keep(crackTexture(THREE));
  /** A glossy shell: a little shine, and a warm rim of light round the edge so eggs stand off the ground. */
  const shell = (color: number) => {
    const x = mat(new THREE.MeshPhongMaterial({ color, specular: 0x3a3530, shininess: 42 }));
    x.onBeforeCompile = (shader) => {
      shader.uniforms.uRim = { value: new THREE.Color(0xfff2d8).multiplyScalar(0.42) };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uRim;')
        .replace('#include <opaque_fragment>', 'float rimK = 1.0 - max(dot(normal, normalize(vViewPosition)), 0.0);\noutgoingLight += uRim * rimK * rimK * rimK;\n#include <opaque_fragment>');
    };
    return x;
  };
  const gliderMat = lambert(0xffffff, { side: THREE.DoubleSide });
  const N = m.fighters.length;
  // a ghillie suit: tufts of leaves and grass all over the shell (clear of the face), in one geometry
  const ghillieParts: RoofPart[] = [];
  {
    const rnd = scatter(83);
    const LEAVES = [0x4c7a2c, 0x5f8f35, 0x3d6624, 0x7a9a3a, 0x6b7f3a];
    for (let i = 0; i < 34; i++) {
      const y = 0.2 + rnd() * 1.3;
      const a = rnd() * Math.PI * 2;
      // not over the eyes and cheeks
      if (y > 0.7 && y < 1.25 && Math.min(a, Math.PI * 2 - a) < 0.75) continue;
      const t = y / 0.8 - 1;
      const r = 0.6 * (1 - 0.13 * t) * Math.sqrt(Math.max(0, 1 - t * t)) + 0.03;
      const s = 0.11 + rnd() * 0.08;
      ghillieParts.push(shaped(new THREE.SphereGeometry(1, 5, 4), Math.sin(a) * r, y, Math.cos(a) * r, s * 1.3, s, s * 1.3, LEAVES[i % LEAVES.length]));
    }
    // and a mop of it on top, standing up
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ghillieParts.push(shaped(new THREE.ConeGeometry(0.07, 0.4, 4), Math.sin(a) * 0.18, 1.62, Math.cos(a) * 0.18, 1, 1, 1, LEAVES[(i + 2) % LEAVES.length]));
    }
  }
  const ghillieGeo = geo(mergeRoof(THREE, ghillieParts, 1, true));
  // stars going round a dazed egg's head
  const dizzyGeo = geo(
    mergeRoof(
      THREE,
      [0, 1, 2].map((k) => {
        const a = (k / 3) * Math.PI * 2;
        return shaped(new THREE.IcosahedronGeometry(1, 0), Math.sin(a) * 0.42, 0, Math.cos(a) * 0.42, 0.09, 0.12, 0.09, 0xffe066);
      }),
      1,
      true,
    ),
  );
  const eggBits = {
    shell: many(G.egg, shell(0xffffff), N),
    ghillie: many(ghillieGeo, lambert(0xffffff, { vertexColors: true, flatShading: true }), N),
    dizzy: many(dizzyGeo, basic(0xffffff, { vertexColors: true }), N),
    hands: many(handGeo, M.cream, N),
    face: many(faceGeo, lambert(0xffffff, { vertexColors: true, emissive: 0x202020 }), N),
    hat: many(hatGeo, lambert(0xffffff), N),
    crackLight: many(G.egg, lambert(0x6b4a2a, { map: crackTex, alphaTest: 0.7 }), N),
    crackHeavy: many(G.egg, lambert(0x5a3a1e, { map: crackTex, alphaTest: 0.3 }), N),
    shadow: many(G.disc, M.shadow, N),
    canopy: many(canopyGeo, gliderMat, N),
    panels: many(panelGeo, gliderMat, N),
  };
  for (const im of Object.values(eggBits)) {
    // they move every frame, so there's no box round them to cull by
    im.frustumCulled = false;
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    scene.add(im);
  }
  const SKIN = new THREE.Color(0xfff3df);
  const HIT = new THREE.Color(0xff8a7a);
  const hatColors = m.fighters.map((f) => new THREE.Color(f.color));
  // colors from the start, so each mesh is set up for them before it is first drawn
  for (let i = 0; i < N; i++) for (const im of [eggBits.shell, eggBits.hat, eggBits.canopy]) im.setColorAt(i, hatColors[i]);
  const slot = (parent: T.Object3D, x: number, y: number, z: number, sx: number, sy: number, sz: number) => {
    const o = new THREE.Object3D();
    o.position.set(x, y, z);
    o.scale.set(sx, sy, sz);
    parent.add(o);
    return o;
  };
  const stringGeo = geo(
    new THREE.BufferGeometry().setFromPoints(
      // the four strings in one line: down one, across inside the egg, up the next, across under the canopy, and so on
      [
        [-1, 0],
        [0, 1],
        [1, 0],
        [0, -1],
      ].flatMap(([x, z], k) => {
        const top = new THREE.Vector3(x * 1.8, 2.5, z * 1.8);
        const low = new THREE.Vector3(x * 0.22, 1.3, z * 0.22);
        return k % 2 ? [low, top] : [top, low];
      }),
    ),
  );
  const stringMat = mat(new THREE.LineBasicMaterial({ color: 0x444444 }));
  const bubbleShader = {
    vertexShader: `
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vN = normalize(normalMatrix * normal);
        vV = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform float uA;
      uniform float uTime;
      varying vec3 vN;
      varying vec3 vV;
      void main() {
        float f = 1.0 - abs(dot(normalize(vN), normalize(vV)));
        float ripple = sin(f * 18.0 - uTime * 9.0) * 0.5 + 0.5;
        vec3 col = mix(vec3(0.35, 0.7, 1.0), vec3(0.92, 0.98, 1.0), f);
        gl_FragColor = vec4(col, (0.08 + f * f * 0.85 + ripple * 0.1) * uA);
      }`,
  };

  const eggs: EggView[] = m.fighters.map(() => {
    const root = new THREE.Group();
    const body = new THREE.Group();
    root.add(body);
    // a little glider for the drop
    const glider = new THREE.Group();
    glider.add(new THREE.Line(stringGeo, stringMat));
    root.add(glider);
    const slots: EggSlots = {
      shell: slot(body, 0, 0, 0, 1, 1, 1),
      face: slot(body, 0, 1.0, 0, 1, 1, 1),
      crack: slot(body, 0, -0.008, 0, 1.012, 1.008, 1.012),
    };
    const bubbleMat = mat(new THREE.ShaderMaterial({ ...bubbleShader, uniforms: { uA: { value: 0 }, uTime: wind }, transparent: true, depthWrite: false }));
    const bubble = add(root, G.ball, bubbleMat, 0, 0.85, 0, 1.05, 1.2, 1.05);
    bubble.visible = false;
    const hand = new THREE.Group();
    hand.position.set(0.24, 0.78, 0.48);
    body.add(hand);
    // a frying pan slung across the back stops bullets from behind
    const backPan = new THREE.Group();
    add(backPan, G.cyl, M.pan, 0, 0, 0, 0.36, 0.06, 0.36);
    add(backPan, G.box, M.dark, 0, 0, 0.48, 0.06, 0.05, 0.4);
    bake('backPan', backPan);
    backPan.position.set(0, 0.9, -0.5);
    backPan.rotation.set(Math.PI / 2 - 0.25, 0, 0);
    body.add(backPan);
    const shadow = new THREE.Object3D();
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.03;
    shadow.scale.setScalar(0.85);
    root.add(shadow);
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
    return { root, body, slots, hand, guns: new Map(), shadow, glider, heal, cross, ring, ghost, backPan, helmet: null, helmetLv: 0, vest: null, vestLv: 0, walk: 0, swing: 0, recoil: 0, lean: 0, cracked: 0, bubble, bubbleMat, shimmer: 0, sq: 0, sqV: 0, step: 0, ripple: 0 };
  });

  /**
   * How many eggs are drawn this frame, with their party hats, shadows and gliders: only the eggs in view go in, packed
   * at the front, so eggs out of sight cost nothing.
   */
  const drawn = { eggs: 0, hats: 0, light: 0, heavy: 0, shadows: 0, gliders: 0, ghillies: 0, dazed: 0 };
  /**
   * Puts an egg's instanced parts where its stand-ins are, once its group has been moved: its ghillie suit if it wears
   * one (`worn`), and stars round its head while it's dazed.
   */
  function placeEgg(v: EggView, hit: boolean, hat: T.Color, worn: boolean, dazed: boolean, clock: number) {
    v.root.updateMatrixWorld(true);
    const s = v.slots;
    const k = drawn.eggs++;
    if (worn) eggBits.ghillie.setMatrixAt(drawn.ghillies++, s.shell.matrixWorld);
    if (dazed) {
      dummy.position.set(v.root.position.x, v.root.position.y + 2.05 + Math.sin(clock * 6) * 0.05, v.root.position.z);
      dummy.rotation.set(0, clock * 5, 0);
      dummy.scale.setScalar(1);
      dummy.updateMatrix();
      eggBits.dizzy.setMatrixAt(drawn.dazed++, dummy.matrix);
    }
    eggBits.shell.setMatrixAt(k, s.shell.matrixWorld);
    eggBits.shell.setColorAt(k, hit ? HIT : SKIN);
    eggBits.hands.setMatrixAt(k, s.shell.matrixWorld);
    eggBits.face.setMatrixAt(k, s.face.matrixWorld);
    if (v.cracked > 1) eggBits.crackHeavy.setMatrixAt(drawn.heavy++, s.crack.matrixWorld);
    else if (v.cracked > 0) eggBits.crackLight.setMatrixAt(drawn.light++, s.crack.matrixWorld);
    if (v.helmetLv <= 0) {
      const h = drawn.hats++;
      eggBits.hat.setMatrixAt(h, s.shell.matrixWorld);
      eggBits.hat.setColorAt(h, hat);
    }
    if (v.shadow.visible) eggBits.shadow.setMatrixAt(drawn.shadows++, v.shadow.matrixWorld);
    if (v.glider.visible) {
      const g = drawn.gliders++;
      eggBits.canopy.setMatrixAt(g, v.glider.matrixWorld);
      eggBits.canopy.setColorAt(g, hat);
      eggBits.panels.setMatrixAt(g, v.glider.matrixWorld);
    }
  }

  // the kill leader's crown: a gold band with five points, a red stone in each
  const kingCrown = new THREE.Group();
  {
    const parts: RoofPart[] = [shaped(new THREE.CylinderGeometry(0.3, 0.27, 0.16, 14, 1, true), 0, 0, 0, 1, 1, 1, 0xffc83d)];
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2;
      parts.push(shaped(new THREE.ConeGeometry(0.07, 0.22, 4), Math.sin(a) * 0.27, 0.18, Math.cos(a) * 0.27, 1, 1, 1, 0xffd23d));
      parts.push(shaped(new THREE.SphereGeometry(1, 6, 4), Math.sin(a) * 0.29, 0.01, Math.cos(a) * 0.29, 0.045, 0.045, 0.045, 0xe53935));
    }
    const g = geo(mergeRoof(THREE, parts, 1, true));
    kingCrown.add(new THREE.Mesh(g, lambert(0xffffff, { vertexColors: true, emissive: 0x4a3200, side: THREE.DoubleSide })));
    // big enough to pick out across the screen
    kingCrown.scale.setScalar(1.45);
  }
  let kingOn = -1;

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
  /** What a piece of loot looks like, as a key: the same key, the same model. */
  const lootKey = (def: LootDef) => [def.kind, 'w' in def ? def.w : '', 'r' in def ? def.r : '', 'a' in def ? def.a : '', 'lv' in def ? def.lv : ''].join(':');
  function lootModel(def: LootDef): T.Object3D {
    const g = new THREE.Group();
    switch (def.kind) {
      case 'gun':
      case 'melee':
      case 'throw': {
        const gun = gunModel(def.w, def.kind === 'gun' ? def.r : 0);
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
      case 'stone':
        for (let i = 0; i < 3; i++) add(g, G.box, partMat.stone, (i - 1) * 0.22, -0.08 + (i === 1 ? 0.18 : 0), 0, 0.26, 0.2, 0.3).rotation.y = i * 0.5;
        break;
      case 'metal':
        for (let i = 0; i < 2; i++) add(g, G.box, M.steel, 0, i * 0.08 - 0.06, 0, 0.62, 0.05, 0.42).rotation.y = i * 0.6;
        break;
      case 'ghillie':
        // a bundle of leafy netting tied up with twine
        for (const [x, y, z, s] of [
          [0, 0, 0, 0.3],
          [0.2, 0.06, 0.05, 0.2],
          [-0.18, 0.05, -0.05, 0.22],
          [0.03, 0.2, 0.02, 0.18],
        ])
          add(g, G.lowBall, M.leaf, x, y, z, s * 1.25, s * 0.8, s);
        add(g, G.band, M.tan, 0, 0.02, 0, 0.31, 0.31, 0.5).rotation.x = Math.PI / 2;
        break;
    }
    return bake(lootKey(def), g);
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
      case 'ghillie':
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

  // Built pieces (walls, ramps, floors and roofs) in wood, stone or metal: boxes in one instanced mesh a material (and
  // the roofs in one more), a soft shade on the ground under each that falls farther off the higher it is, and a pale
  // blue blueprint of what's still building up (and of where the build key would build next).
  const matLook: Record<Mat, { tex: T.Texture; trim: number; bits: T.Material[] }> = {
    wood: { tex: keep(planksTexture(THREE, '#c58b4c', '#8c5a2c', [1, 1])), trim: 0x7a4a22, bits: [] },
    stone: { tex: keep(stoneTexture(THREE)), trim: 0x6f747b, bits: [] },
    metal: { tex: keep(metalTexture(THREE)), trim: 0x4a5560, bits: [] },
  };
  const BUILT_MAX = 3000;
  const builtBoxes = Object.fromEntries(MATS.map((k) => [k, many(G.box, lambert(0xffffff, { map: matLook[k].tex }), BUILT_MAX)])) as Record<Mat, T.InstancedMesh>;
  const roofGeo = geo(new THREE.ConeGeometry(CELL_B * 0.74, 1.4, 4, 1).rotateY(Math.PI / 4).translate(0, 0.7, 0));
  const builtRoofs = Object.fromEntries(MATS.map((k) => [k, many(roofGeo, lambert(0xffffff, { map: matLook[k].tex }), 400)])) as Record<Mat, T.InstancedMesh>;
  const printMat = basic(0x7fd4ff, { transparent: true, opacity: 0.3, depthWrite: false });
  const printBad = basic(0xff6b6b, { transparent: true, opacity: 0.3, depthWrite: false });
  const printBoxes = many(G.box, printMat, 600);
  const printRoofs = many(roofGeo, printMat, 60);
  const planBoxes = many(G.box, printMat, 40);
  const planBad = many(G.box, printBad, 40);
  const planRoofs = many(roofGeo, printMat, 4);
  const editMark = many(G.box, basic(0xffd75e, { transparent: true, opacity: 0.55, depthWrite: false }), 4);
  const builtShade = many(G.plane, basic(0x10182a, { map: keep(softSquareTexture(THREE)), transparent: true, opacity: 0.4, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 }), BUILT_MAX / 2);
  builtShade.renderOrder = 1;
  for (const im of [...Object.values(builtBoxes), ...Object.values(builtRoofs), printBoxes, printRoofs, planBoxes, planBad, planRoofs, editMark, builtShade]) {
    im.setColorAt(0, color.setHex(0xffffff));
    im.count = 0;
    im.frustumCulled = false;
    scene.add(im);
  }
  for (const im of [printBoxes, printRoofs, planBoxes, planBad, planRoofs, editMark]) im.renderOrder = 5;
  const ramp = { len: Math.hypot(CELL_B, LEVEL_H), tilt: Math.atan2(LEVEL_H, CELL_B) };
  /** Counts of what's drawn so far this frame, by instanced mesh. */
  const drawnAt = new Map<T.InstancedMesh, number>();
  /** One box (or roof) in an instanced mesh, turned `ry` about the up axis, then tilted `rx`. */
  const part = (im: T.InstancedMesh, x: number, y: number, z: number, sx: number, sy: number, sz: number, ry: number, rx: number, c: number) => {
    const i = drawnAt.get(im) ?? 0;
    if (i >= im.instanceMatrix.count) return;
    drawnAt.set(im, i + 1);
    dummy.position.set(x, y, z);
    dummy.rotation.set(rx, ry, 0, 'YXZ');
    dummy.scale.set(sx, sy, sz);
    dummy.updateMatrix();
    im.setMatrixAt(i, dummy.matrix);
    im.setColorAt(i, color.setHex(c));
  };
  /** A piece's color: its material's, paler blue the less it has built up, darker the more it has been hit. */
  const pieceTint = (w: Wall, built: number) => {
    const full = w.max * (BUILD_START + (1 - BUILD_START) * built);
    const hurt = 1 - Math.max(0, Math.min(1, w.hp / Math.max(1, full)));
    return color.setHex(0xffffff).lerp(tmpColor.setHex(0x6b5048), hurt * 0.55).lerp(tmpColor.setHex(0x8fdcff), (1 - built) * 0.65).getHex();
  };
  const tmpColor = new THREE.Color();
  /**
   * Draws a piece into `boxes` and `roofs` (a built one's own, or a blueprint's): a wall with its doorway or window
   * cut out, a floor on four posts with a dark rim round its edge, a ramp with steps across it, a roof. `grow` is how
   * far a wall stands up (0..1), `hide` leaves out a floor or roof over our own egg (just its rim stays).
   */
  function drawPiece(w: Wall, boxes: T.InstancedMesh, roofs: T.InstancedMesh, c: number, trim: number, grow: number, hide: boolean) {
    const y0 = w.lv * LEVEL_H;
    if (w.k === 'wall') {
      const h = LEVEL_H * grow;
      const full = !w.parts || w.e === 0;
      if (full) part(boxes, w.x, y0 + h / 2, w.z, CELL_B + 0.08, h, 0.3, w.a, 0, c);
      else {
        for (const p of w.parts!) part(boxes, p.x, y0 + h / 2, p.z, p.hw * 2 + 0.04, h, 0.3, w.a, 0, c);
        // a doorway leaves a lintel over the gap; a window, a sill below it too
        part(boxes, w.x, y0 + 2.45, w.z, GAP * 2, LEVEL_H - 2.3, 0.3, w.a, 0, c);
        if (w.e === 2) part(boxes, w.x, y0 + 0.55, w.z, GAP * 2, 1.1, 0.3, w.a, 0, c);
      }
      // a darker cap along the top, so the line of it reads from above; it breaks over a doorway or window
      if (grow < 1) return;
      if (full) part(boxes, w.x, y0 + LEVEL_H + 0.05, w.z, CELL_B + 0.14, 0.12, 0.38, w.a, 0, trim);
      else for (const p of w.parts!) part(boxes, p.x, y0 + LEVEL_H + 0.05, p.z, p.hw * 2 + 0.1, 0.12, 0.38, w.a, 0, trim);
      return;
    }
    if (w.k === 'floor') {
      if (!hide) part(boxes, w.x, y0 - 0.13, w.z, CELL_B, 0.26, CELL_B, 0, 0, c);
      part(boxes, w.x, y0 - 0.32, w.z, CELL_B + 0.16, 0.14, CELL_B + 0.16, 0, 0, trim);
      for (const [sx, sz] of QUADS) part(boxes, w.x + sx * (CELL_B / 2 - 0.2), (y0 - 0.38) / 2, w.z + sz * (CELL_B / 2 - 0.2), 0.22, y0 - 0.38, 0.22, 0, 0, trim);
      return;
    }
    if (w.k === 'ramp') {
      const dx = DIR_X[w.dir];
      const dz = DIR_Z[w.dir];
      const ux = dx * Math.cos(ramp.tilt);
      const uy = Math.sin(ramp.tilt);
      const uz = dz * Math.cos(ramp.tilt);
      const cy = y0 + LEVEL_H / 2;
      part(boxes, w.x, cy, w.z, CELL_B, 0.26, ramp.len, w.a, -ramp.tilt, c);
      // steps across it, the way up plain from above
      for (let i = 0; i < 5; i++) {
        const t = ramp.len * ((i + 0.5) / 5 - 0.5);
        part(boxes, w.x + ux * t - dx * uy * 0.15, cy + uy * t + Math.cos(ramp.tilt) * 0.15, w.z + uz * t - dz * uy * 0.15, CELL_B - 0.3, 0.07, 0.16, w.a, -ramp.tilt, trim);
      }
      return;
    }
    if (!hide) part(roofs, w.x, y0, w.z, 1, 0.3 + 0.7 * grow, 1, 0, 0, c);
    part(boxes, w.x, y0 + 0.04, w.z, CELL_B + 0.1, 0.08, CELL_B + 0.1, 0, 0, trim);
  }
  /** Its shade on the ground: under it, nudged away from the sun the higher it stands. */
  function shadePiece(w: Wall) {
    const up = w.lv * LEVEL_H + (w.k === 'wall' || w.k === 'ramp' ? LEVEL_H / 2 : w.k === 'roof' ? 0.7 : 0);
    const i = drawnAt.get(builtShade) ?? 0;
    if (i >= builtShade.instanceMatrix.count) return;
    drawnAt.set(builtShade, i + 1);
    const long = w.k === 'wall' ? CELL_B + 0.6 : CELL_B + 0.8;
    const wide = w.k === 'wall' ? 1.6 : CELL_B + 0.8;
    dummy.position.set(w.x + SUN.x * up, 0.03, w.z + SUN.z * up);
    dummy.rotation.set(-Math.PI / 2, 0, w.k === 'wall' ? -w.a : 0);
    dummy.scale.set(long, wide, 1);
    dummy.updateMatrix();
    builtShade.setMatrixAt(i, dummy.matrix);
    builtShade.setColorAt(i, color.setHex(0xffffff));
  }
  /** Where pieces were last seen, to know where to burst when one breaks. */
  const builtSeen = new Map<number, Wall>();

  // bullets and rockets
  const tracers: T.Mesh[] = [];
  const tracerGeo = geo(new THREE.BoxGeometry(0.08, 0.08, 1));
  // a bullet is a glowing streak laid flat along its path (a crossbow bolt stays a little brown stick)
  const streakGeo = geo(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2));
  const streakMat = basic(0xffffff, { map: keep(tracerTexture(THREE)), transparent: true, depthWrite: false, blending: ADDITIVE, side: THREE.DoubleSide });
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
    ember: basic(0xffa040, { blending: ADDITIVE, transparent: true, depthWrite: false }),
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
    shine: basic(0xffffff),
    shove: basic(0x8fc4ff),
    straw: lambert(0xe2c25a),
    paper: lambert(0xf6f3ec),
  };
  const stunFlash = basic(0xffffff, { transparent: true, opacity: 0.95, depthWrite: false });
  const padFlash = basic(0x7dffd2, { transparent: true, opacity: 0.7, depthWrite: false });
  // the bits are drawn as three instanced meshes, whatever material they were thrown with: lit chips (shell, wood,
  // leaves), see-through wisps (dust, flour, spray) and bright sparks (fire, sauce)
  const PARTS = 320;
  const chipMeshes = [lambert(0xffffff), basic(0xffffff, { transparent: true, opacity: 0.68, depthWrite: false }), basic(0xffffff)].map((x) => {
    const im = many(G.box, x, PARTS);
    im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    im.setColorAt(0, color.setHex(0xffffff));
    im.count = 0;
    im.frustumCulled = false;
    scene.add(im);
    return im;
  });
  for (let i = 0; i < PARTS; i++) parts.push({ x: 0, y: 0, z: 0, rx: 0, rz: 0, vx: 0, vy: 0, vz: 0, life: 0, max: 1, spin: 0, grav: 0, size: 0.1, kind: 0, color: new THREE.Color() });
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
      const x0 = material[i % material.length] as T.MeshLambertMaterial;
      p.kind = x0.isMeshLambertMaterial ? 0 : x0.transparent && x0.blending !== ADDITIVE ? 1 : 2;
      p.color.copy(x0.color);
      if (x0.isMeshLambertMaterial) p.color.add(color.copy(x0.emissive).multiplyScalar(x0.emissiveIntensity));
      p.x = x;
      p.y = y;
      p.z = z;
      p.rx = 0;
      p.rz = 0;
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

  // soft puffs that swell and fade as they drift: dust from feet and landings, smoke from blasts, flares and fires
  type Puff = { mesh: T.Mesh; mat: T.MeshLambertMaterial; life: number; max: number; vx: number; vy: number; vz: number; size: number; grow: number; alpha: number };
  const puffs: Puff[] = [];
  for (let i = 0; i < 56; i++) {
    const pm = lambert(0xffffff, { transparent: true, opacity: 0, depthWrite: false, emissive: 0x2a2a2a });
    const mesh = new THREE.Mesh(G.ball, pm);
    mesh.visible = false;
    scene.add(mesh);
    puffs.push({ mesh, mat: pm, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 1, grow: 1, alpha: 1 });
  }
  let puffAt = 0;
  const puff = (x: number, y: number, z: number, size: number, life: number, hex: number, alpha: number, vx = 0, vy = 0.6, vz = 0, grow = 1.6) => {
    const p = puffs[puffAt];
    puffAt = (puffAt + 1) % puffs.length;
    p.mesh.position.set(x, y, z);
    p.mesh.rotation.set(Math.random() * 3, Math.random() * 3, 0);
    p.mesh.scale.setScalar(size * 0.4);
    p.mesh.visible = true;
    p.mat.color.setHex(hex);
    p.mat.opacity = alpha;
    Object.assign(p, { life, max: life, vx, vy, vz, size, grow, alpha });
  };
  /** A ring of dust kicked out along the ground (a landing, a bounce, a blast). */
  const dustRing = (x: number, z: number, n: number, r: number, size: number, hex: number, alpha: number, speed: number) => {
    const a0 = Math.random() * 6.3;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      puff(x + Math.sin(a) * r, 0.25, z + Math.cos(a) * r, size, 0.55 + Math.random() * 0.25, hex, alpha, Math.sin(a) * speed, 0.35, Math.cos(a) * speed, 1.4);
    }
  };

  // rings spreading over water where an egg wades or splashes down, and the shockwave of a blast
  const rippleMats: T.MeshBasicMaterial[] = [];
  const ripples: { mesh: T.Mesh; life: number; max: number; r: number }[] = [];
  for (let i = 0; i < 18; i++) {
    const rm = basic(0xffffff, { transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide });
    rippleMats.push(rm);
    const mesh = new THREE.Mesh(G.ring, rm);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    scene.add(mesh);
    ripples.push({ mesh, life: 0, max: 1, r: 1 });
  }
  let rippleAt = 0;
  const ripple = (x: number, y: number, z: number, r: number, life: number, hex = 0xffffff) => {
    const i = rippleAt;
    rippleAt = (rippleAt + 1) % ripples.length;
    const rp = ripples[i];
    rp.mesh.position.set(x, y, z);
    rp.mesh.scale.setScalar(0.2);
    rp.mesh.visible = true;
    rippleMats[i].color.setHex(hex);
    Object.assign(rp, { life, max: life, r });
  };

  // muzzle flashes and hit sparks: a bright star laid flat, glowing over whatever is under it
  const starMat = basic(0xffe9a8, { map: keep(starTexture(THREE)), transparent: true, depthWrite: false, blending: ADDITIVE });
  const sparkMat = basic(0xffffff, { map: starMat.map, transparent: true, depthWrite: false, blending: ADDITIVE });
  const stars: { mesh: T.Mesh; life: number; max: number; size: number }[] = [];
  for (let i = 0; i < 20; i++) {
    const mesh = new THREE.Mesh(G.plane, starMat);
    mesh.visible = false;
    mesh.renderOrder = 6;
    scene.add(mesh);
    stars.push({ mesh, life: 0, max: 1, size: 1 });
  }
  let starAt = 0;
  const star = (x: number, y: number, z: number, a: number, len: number, wide: number, life: number, material: T.Material) => {
    const s = stars[starAt];
    starAt = (starAt + 1) % stars.length;
    s.mesh.material = material;
    s.mesh.position.set(x, y, z);
    // laid flat, its length along `a`
    s.mesh.rotation.set(-Math.PI / 2, a, 0, 'YXZ');
    s.mesh.scale.set(wide, len, 1);
    s.size = 1;
    s.mesh.visible = true;
    s.life = life;
    s.max = life;
  };

  // scorch marks where things blew up, the oldest cleared for the newest
  const scorchMat = basic(0x1a1410, { map: blob, transparent: true, opacity: 0.8, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -2 });
  const scorches: T.Mesh[] = [];
  for (let i = 0; i < 8; i++) {
    const mesh = new THREE.Mesh(G.plane, scorchMat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.visible = false;
    mesh.renderOrder = 1;
    scene.add(mesh);
    scorches.push(mesh);
  }
  let scorchAt = 0;

  let shake = 0;
  let now = 0;
  const fog = scene.fog as T.Fog;
  const cam = { x: 0, z: 0, view: OVERVIEW, ready: false };
  const vec = new THREE.Vector3();
  const vec2 = new THREE.Vector3();

  function syncEgg(v: EggView, f: Fighter, dt: number, clock: number, focus: boolean, hidden: boolean) {
    const shown = f.phase !== 'out' && f.phase !== 'bus' && !hidden;
    v.root.visible = shown;
    if (!shown) return false;
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
    // squash on landing and stretch on a bounce, sprung back (in small steps, so a slow frame can't fling it), and a
    // little give in every step
    for (let k = 0, step = Math.min(dt, 0.05) / 2; k < 2; k++) {
      v.sqV += (-260 * v.sq - 16 * v.sqV) * step;
      v.sq = Math.max(-0.35, Math.min(0.35, v.sq + v.sqV * step));
    }
    const give = f.phase === 'ground' && speed > 0.4 ? Math.sin(v.walk * 2) * 0.035 : 0;
    const sq = v.sq + give;
    v.body.scale.set(1 - sq * 0.5, 1 + sq, 1 - sq * 0.5);
    const close = Math.abs(f.x - cam.x) < cam.view * 1.6 && Math.abs(f.z - cam.z) < cam.view * 1.6;
    if (f.phase === 'ground' && close) {
      if (f.wet) {
        // rings spread round an egg wading, quicker the faster it goes
        v.ripple += dt * (0.8 + speed * 0.5);
        if (v.ripple > 1) {
          v.ripple = 0;
          ripple(f.x, 0.07, f.z, 1.6 + speed * 0.12, 1.1, 0xe6f7ff);
        }
      } else if (speed > 2) {
        // a puff of dust every few steps
        v.step += speed * dt;
        if (v.step > 2.2) {
          v.step = 0;
          puff(f.x - mx * 0.4 + (Math.random() - 0.5) * 0.3, 0.12, f.z - mz * 0.4, 0.32, 0.45, roadAt(map, f.x, f.z) ? 0xe2cfa0 : 0xd8e0b8, 0.55, -mx * 0.4, 0.5, -mz * 0.4, 1.3);
        }
      }
    }
    // blinks now and then, squints when hit
    const blink = (clock * 0.9 + f.id * 0.37) % 3.7 < 0.1;
    v.slots.face.scale.set(1, f.hitT > 0 ? 0.35 : blink ? 0.12 : 1, 1);
    // cracks by health, and bits of shell fly off as they spread
    const cracked = f.phase !== 'ground' ? 0 : f.hp < 34 ? 2 : f.hp < 67 ? 1 : 0;
    if (cracked !== v.cracked) {
      if (cracked > v.cracked && close) burst(f.x, 1.1, f.z, 5, 2.5, 0.09, 0.5, [partMat.shell]);
      v.cracked = cracked;
    }
    // a shield's shimmer where a hit landed on it
    v.shimmer = Math.max(0, v.shimmer - dt * 2.4);
    v.bubble.visible = v.shimmer > 0;
    if (v.bubble.visible) {
      v.bubbleMat.uniforms.uA.value = v.shimmer;
      v.bubble.scale.set(1.05 + (1 - v.shimmer) * 0.15, 1.2 + (1 - v.shimmer) * 0.15, 1.05 + (1 - v.shimmer) * 0.15);
    }
    v.glider.visible = f.phase === 'drop';
    v.shadow.visible = (f.phase === 'ground' && !f.wet) || (f.phase === 'drop' && f.y < 25);
    // on the ground or on whatever it stands on; gliding, on the ground far below
    v.shadow.position.y = f.phase === 'ground' ? 0.03 : 0.03 - f.y;
    v.shadow.scale.setScalar(0.85 * (1 + (f.phase === 'ground' ? 0 : f.y * 0.02)));
    // an egg up on something built is drawn a little bigger, so the high ground reads from above
    v.root.scale.setScalar(f.phase === 'ground' ? 1 + levelOf(f.y) * 0.1 : 1);
    // what it holds
    const h = held(f);
    const key = h.w;
    const look = `${key}:${h.r}`;
    for (const [k, g] of v.guns) g.group.visible = k === look && f.phase === 'ground';
    let gun = v.guns.get(look);
    if (!gun && f.phase === 'ground') {
      gun = gunModel(key, h.r);
      v.hand.add(gun.group);
      v.guns.set(look, gun);
    }
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
    // healing, shield and coffee show while in use
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
    return true;
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
        if (t.small) {
          // a MIRV's bomblet: a little red ball
          add(g, G.ball, M.mirv, 0, 0, 0, 0.2, 0.2, 0.2);
        } else {
          // drawn big enough to see coming
          const model = gunModel(t.k).group;
          model.position.set(0, 0, -0.28 * 2.4);
          model.scale.setScalar(2.4);
          g.add(model);
        }
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
        group.position.set(z.x, z.y, z.z);
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
      const peek = afoot && inside < 0 ? peekAt(map, focus.x, focus.z, (i) => shut(m, i)) : -1;
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
      wind.value = clock;
      riverFoam.forEach((t, k) => (t.offset.y = (k ? 1 : -1) * clock * 0.2));
      lapMat.opacity = 0.42 + Math.sin(clock * 1.3) * 0.18;
      // the surf drifts along the shore, and a wave rolls in every few seconds and fades on the sand
      foamTex.offset.y = clock * 0.012;
      const roll = (clock / 4.5) % 1;
      waveTex.offset.x = -0.85 * (1 - roll);
      waveMat.opacity = Math.sin(roll * Math.PI) * 0.6;
      surfMat.opacity = 0.7 + Math.sin(clock * 0.9) * 0.12;
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
        stormUniforms.uR.value = Math.max(0.05, s.r);
        stormTint.position.set(s.x, 0.12, s.z);
        tint.set(Math.max(0, s.r), 900);
        stormTint.visible = onLand;
        seamMesh.visible = onLand && s.r > 0.5;
        seamMesh.position.set(s.x, 0.13, s.z);
        seam.set(Math.max(0, s.r - 0.35), s.r + 0.25);
        const showNext = s.next.r < s.r - 0.5 || s.shrinking;
        nextMesh.visible = showNext && s.next.r > 0.3;
        nextMesh.position.set(nx, 0.14, nz);
        nextRing.set(Math.max(0, s.next.r - 0.3), s.next.r + 0.3);
      }

      placeChests(false);
      placeCrates(clock);
      placeWindows();
      placeFridges(false);
      placeKitchen(clock);
      placeShades();
      placeDoors(dt, clock);
      placeStashes(false);
      for (const bc of beacons) bc.mat.color.setHex(Math.sin(clock * 9) * bc.k > 0 ? (bc.k < 0 ? 0xff3030 : 0x3a7bff) : bc.k < 0 ? 0x5a1414 : 0x14285a);
      chestGlowMat.opacity = 0.35 + Math.sin(clock * 4) * 0.2;

      // campfires flicker (and throw the odd spark when you're close), pads pulse
      placeFires(clock);
      for (const c of map.fires) {
        if (Math.abs(c.x - cam.x) > cam.view * 2 || Math.abs(c.z - cam.z) > cam.view * 2) continue;
        // embers float up, and a thin smoke curls away
        if (Math.random() < 0.14) burst(c.x + (Math.random() - 0.5) * 0.4, 0.9, c.z + (Math.random() - 0.5) * 0.4, 1, 1, 0.07, 1, [partMat.ember], -2.2);
        if (Math.random() < 0.035) puff(c.x, 1.4, c.z, 0.38, 2.4, 0xa8a8a8, 0.22, 0.25, 0.9, -0.1, 2.4);
      }
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

      // eggs in view (peeking in through a door shows only who the doorway lets you see); one up high shows nearer the
      // top of the screen than the ground under it
      const eggN = dist * FRAME_N + 6;
      const eggS = dist * FRAME_S + 6;
      const eggW = dist * FRAME_W * aspect + 6;
      drawn.eggs = drawn.hats = drawn.light = drawn.heavy = drawn.shadows = drawn.gliders = 0;
      m.fighters.forEach((f, i) => {
        const v = eggs[i];
        if (!v) return;
        const isFocus = i === focusId;
        const inView = Math.abs(f.x - cam.x) < eggW && f.z - cam.z > -eggN - f.y && f.z - cam.z < eggS;
        const walled = inView && peek >= 0 && !!focus && f.inside === peek && !clearLine(m, focus.x, focus.z, f.x, f.z);
        // flash red when hit
        const dazed = f.kind === 'remote' ? (f.show.flags & F_STUN) !== 0 : f.stunT > 0;
        if (syncEgg(v, f, dt, clock, isFocus, !isFocus && (!inView || concealed(m, f, focus) || walled))) placeEgg(v, f.hitT > 0, hatColors[i], f.ghillie || (f.kind === 'remote' && (f.show.flags & F_GHILLIE) !== 0), dazed && f.phase === 'ground', clock);
      });
      eggBits.ghillie.count = drawn.ghillies;
      eggBits.dizzy.count = drawn.dazed;
      // the kill leader's crown, on its head (shown wherever its egg is)
      const king = m.leader >= 0 && m.fighters[m.leader]?.phase === 'ground' ? m.leader : -1;
      if (king !== kingOn) {
        kingCrown.removeFromParent();
        if (king >= 0) eggs[king].body.add(kingCrown);
        kingOn = king;
      }
      if (king >= 0) {
        kingCrown.position.y = (eggs[king].helmetLv > 0 ? 2.12 : 1.98) + Math.sin(clock * 3) * 0.05;
        kingCrown.rotation.y = clock * 1.2;
      }
      eggBits.shell.count = eggBits.hands.count = eggBits.face.count = drawn.eggs;
      eggBits.hat.count = drawn.hats;
      eggBits.crackLight.count = drawn.light;
      eggBits.crackHeavy.count = drawn.heavy;
      eggBits.shadow.count = drawn.shadows;
      eggBits.canopy.count = eggBits.panels.count = drawn.gliders;
      for (const im of Object.values(eggBits)) {
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
      }
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
        aimLine.position.set(me.x + fx * (0.9 + len / 2), me.y + 0.95, me.z + fz * (0.9 + len / 2));
        aimLine.rotation.set(-Math.PI / 2, 0, me.aim);
        aimLine.scale.set(aimThrow ? 0.09 : 0.05, len, 1);
      }
      landMark.visible = !!focus && focus.phase === 'drop';
      if (landMark.visible && focus) {
        landMark.position.set(focus.x, 0.1, focus.z);
        landMark.scale.setScalar(1.2 + Math.sin(clock * 6) * 0.15);
      }

      // loot in frame (with a little to spare), once it's close enough to make out (from the sky it's specks, and from
      // the bus too, which a tall screen frames narrower); on foot always, however far a scope or high ground looks
      const showLoot = (cam.view < LOOT_VIEW || focus?.phase === 'ground') && focus?.phase !== 'bus';
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

      // built pieces in frame (a wall stands up as it builds, under a blueprint of all of it), the build key's
      // blueprint, and a burst of bits where one breaks
      for (const [id, w] of builtSeen) {
        if (m.walls.has(id)) continue;
        builtSeen.delete(id);
        if (Math.abs(w.x - cam.x) < cam.view * 2 && Math.abs(w.z - cam.z) < cam.view * 2) burst(w.x, w.lv * LEVEL_H + 1.2, w.z, 14, 5, 0.18, 0.7, [w.mat === 'wood' ? partMat.wood : w.mat === 'stone' ? partMat.stone : partMat.metal]);
      }
      drawnAt.clear();
      const pieceN = dist * FRAME_N + 12;
      const pieceS = dist * FRAME_S + 6;
      const pieceW = dist * FRAME_W * aspect + 6;
      const overhead = afoot ? roofOver(m, focus.x, focus.z, focus.y) : -1;
      for (const w of m.walls.values()) {
        if (!builtSeen.has(w.id)) builtSeen.set(w.id, w);
        if (Math.abs(w.x - cam.x) > pieceW || w.z - cam.z < -pieceN || w.z - cam.z > pieceS) continue;
        const built = w.left > 0 ? Math.max(0, 1 - w.left / MAT_SPECS[w.mat].time) : 1;
        // a floor or roof over our own egg's head lifts off, as a building's roof does
        const over = w.id === overhead || (afoot && w.k === 'floor' && w.cx === gridOf(focus.x) && w.cz === gridOf(focus.z) && w.lv * LEVEL_H > focus.y + 1);
        drawPiece(w, builtBoxes[w.mat], builtRoofs[w.mat], pieceTint(w, built), matLook[w.mat].trim, w.k === 'wall' ? 0.15 + 0.85 * built : built, over);
        if (built < 1) drawPiece(w, printBoxes, printRoofs, 0xffffff, 0xffffff, 1, over);
        shadePiece(w);
      }
      if (opts.preview && afoot && opts.aimLine && owned(focus)) {
        if (opts.preview === 'edit') {
          const w = editable(m, focus);
          if (w) part(editMark, w.x, w.lv * LEVEL_H + LEVEL_H / 2, w.z, CELL_B + 0.2, LEVEL_H + 0.2, 0.42, w.a, 0, 0xffffff);
        } else
          for (const s of planPiece(m, focus, opts.preview)) {
            const w = makePiece(-1, focus.id, s.k, 'wood', s.cx, s.cz, s.lv, s.dir, 1, 0);
            drawPiece(w, pieceIn(m, s) ? planBad : planBoxes, planRoofs, 0xffffff, 0xffffff, 1, false);
          }
      }
      for (const im of [...Object.values(builtBoxes), ...Object.values(builtRoofs), printBoxes, printRoofs, planBoxes, planBad, planRoofs, editMark, builtShade]) {
        im.count = drawnAt.get(im) ?? 0;
        if (!im.count) continue;
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) im.instanceColor.needsUpdate = true;
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
          r.position.set(b.x, 0.9 + b.lv * LEVEL_H, b.z);
          // the egg's long axis (+y) laid along the flight
          r.rotation.set(Math.PI / 2, Math.atan2(b.dx, b.dz), 0, 'YXZ');
          r.scale.setScalar(0.3);
          if (Math.random() < 0.5) puff(b.x - b.dx * 0.5, 0.9, b.z - b.dz * 0.5, 0.32, 0.8, 0xdcdcdc, 0.55, 0, 0.3, 0, 1.7);
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
        const len = bolt ? 0.9 : Math.min(3.2, (b.traveled - 0.5) * 1.3);
        tr.visible = true;
        tr.geometry = bolt ? tracerGeo : streakGeo;
        tr.material = bolt ? M.bolt : streakMat;
        tr.renderOrder = bolt ? 0 : 6;
        // a shot aimed up at high ground climbs to it over its first few meters
        tr.position.set(b.x - (b.dx * len) / 2, 1.0 + (b.from + (b.lv - b.from) * Math.min(1, b.traveled / 14)) * LEVEL_H, b.z - (b.dz * len) / 2);
        tr.rotation.set(0, Math.atan2(b.dx, b.dz), 0);
        tr.scale.set(bolt ? 0.7 : 0.34, bolt ? 0.7 : 1, len);
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
        if (Math.random() < 0.4) puff(fl.x, y - 0.3, fl.z, 0.45, 1.6, 0xffc4ae, 0.45, 0, -0.3, 0, 2);
      }

      // effects
      const chipCount = [0, 0, 0];
      for (const p of parts) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) continue;
        p.vy -= p.grav * dt;
        p.x += p.vx * dt;
        p.y = Math.max(0.05, p.y + p.vy * dt);
        p.z += p.vz * dt;
        p.rx += p.spin * dt;
        p.rz += p.spin * 0.7 * dt;
        dummy.position.set(p.x, p.y, p.z);
        dummy.rotation.set(p.rx, 0, p.rz);
        dummy.scale.setScalar(p.size * Math.min(1, (p.life / p.max) * 2));
        dummy.updateMatrix();
        const im = chipMeshes[p.kind];
        im.setMatrixAt(chipCount[p.kind], dummy.matrix);
        im.setColorAt(chipCount[p.kind]++, p.color);
      }
      chipMeshes.forEach((im, k) => {
        const n = chipCount[k];
        im.count = n;
        im.visible = n > 0;
        if (!n) return;
        // only the bits in use go up to the GPU
        im.instanceMatrix.clearUpdateRanges();
        im.instanceMatrix.addUpdateRange(0, n * 16);
        im.instanceMatrix.needsUpdate = true;
        if (im.instanceColor) {
          im.instanceColor.clearUpdateRanges();
          im.instanceColor.addUpdateRange(0, n * 3);
          im.instanceColor.needsUpdate = true;
        }
      });
      for (const f of flashes) {
        if (!f.mesh.visible) continue;
        f.life -= dt;
        if (f.life <= 0) {
          f.mesh.visible = false;
          continue;
        }
        f.mesh.scale.multiplyScalar(1 + f.grow * dt);
      }
      for (const p of puffs) {
        if (!p.mesh.visible) continue;
        p.life -= dt;
        if (p.life <= 0) {
          p.mesh.visible = false;
          continue;
        }
        const u = 1 - p.life / p.max;
        // swells fast, then drifts and thins
        p.mesh.scale.setScalar(p.size * (0.4 + (1 - (1 - u) * (1 - u)) * p.grow));
        p.mat.opacity = p.alpha * (1 - u) * (1 - u);
        p.mesh.position.x += p.vx * dt;
        p.mesh.position.y += p.vy * dt;
        p.mesh.position.z += p.vz * dt;
        p.vx *= 1 - dt * 3;
        p.vz *= 1 - dt * 3;
      }
      ripples.forEach((rp, i) => {
        if (!rp.mesh.visible) return;
        rp.life -= dt;
        if (rp.life <= 0) {
          rp.mesh.visible = false;
          return;
        }
        const u = 1 - rp.life / rp.max;
        rp.mesh.scale.setScalar(0.2 + (1 - (1 - u) * (1 - u)) * rp.r);
        rippleMats[i].opacity = 0.75 * (1 - u);
      });
      for (const s of stars) {
        if (!s.mesh.visible) continue;
        s.life -= dt;
        if (s.life <= 0) s.mesh.visible = false;
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
          if (f && near(f.x, f.z) && e.w !== 'launcher' && e.w !== 'crossbow') {
            flash(f.x + Math.sin(e.a) * 1.2, f.y + 0.95, f.z + Math.cos(e.a) * 1.2, cls === 'shotgun' ? 0.32 : e.w === 'micro' ? 0.15 : 0.2, 0.05, 0, flashMat);
            // and a star of light out of the muzzle, bigger for the big guns
            const [len, wide] = cls === 'shotgun' ? [1.5, 1] : cls === 'sniper' ? [1.7, 0.75] : e.w === 'micro' || e.w === 'pistol' ? [0.75, 0.5] : [1.05, 0.62];
            star(f.x + Math.sin(e.a) * (1.15 + len * 0.3), f.y + 0.97, f.z + Math.cos(e.a) * (1.15 + len * 0.3), e.a, len, wide, 0.055, starMat);
          } else if (f && near(f.x, f.z) && e.w === 'launcher') puff(f.x - Math.sin(e.a) * 0.6, 1, f.z - Math.cos(e.a) * 0.6, 0.6, 0.7, 0xd8d8d8, 0.6, -Math.sin(e.a) * 2, 0.4, -Math.cos(e.a) * 2, 2);
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
          else if (e.what === 'window') burst(e.x, 1.2, e.z, 4, 3, 0.07, 0.35, [partMat.glass, partMat.spark]);
          else burst(e.x, 1, e.z, 4, 3, 0.1, 0.35, [partMat.wood, partMat.dust]);
          break;
        case 'hit': {
          if (!near(e.x, e.z)) break;
          const y = m.fighters[e.to]?.y ?? 0;
          burst(e.x, y + 1, e.z, 5, 3.5, 0.1, 0.4, e.shield ? [partMat.purple, partMat.shell] : [partMat.shell, partMat.yolk]);
          star(e.x, y + 1.05, e.z, Math.random() * 3, 0.75, 0.75, 0.07, sparkMat);
          const v = eggs[e.to];
          if (v && e.shield) v.shimmer = 1;
          break;
        }
        case 'hurt':
          if (e.f === focus) shake = Math.max(shake, e.storm ? 0.12 : 0.35);
          break;
        case 'smash': {
          if (!near(e.x, e.z)) break;
          const kind = e.kind === 'crate' ? map.containers[e.id]?.kind : 'wall';
          const piece = e.kind === 'wall' ? m.walls.get(e.id) : undefined;
          const bits = piece?.mat === 'stone' ? [partMat.stone, partMat.dust] : piece?.mat === 'metal' ? [partMat.spark, partMat.metal] : [partMat.wood];
          burst(e.x, (piece ? piece.lv * LEVEL_H + (piece.k === 'floor' ? -0.2 : 1) : 1), e.z, 4, 3, 0.12, 0.4, kind === 'barrel' ? [partMat.red, partMat.metal] : kind === 'toilet' ? [partMat.shell, partMat.splash] : kind === 'hay' ? [partMat.straw] : bits);
          if (e.kind === 'crate') crateShake.set(e.id, now);
          break;
        }
        case 'harvest':
          burst(e.x, 1.4, e.z, 6, 3, 0.13, 0.45, e.mat === 'stone' ? [partMat.stone, partMat.dust] : e.mat === 'metal' ? [partMat.spark, partMat.metal] : [partMat.wood, partMat.leaf]);
          break;
        case 'door': {
          // a puff of dust as it swings; splinters everywhere when it comes off its hinges
          const s = map.slabs[e.i];
          if (!s || !near(s.x, s.z)) break;
          if (e.s === DOOR_GONE) {
            burst(s.x, 1.2, s.z, 22, 6, 0.2, 0.9, [partMat.wood, partMat.wood, partMat.dust]);
            puff(s.x, 1, s.z, 1, 0.8, 0xc9b38a, 0.5);
          } else puff(s.x + s.ox * 0.4, 0.3, s.z + s.oz * 0.4, 0.5, 0.5, 0xd9cfae, 0.35);
          break;
        }
        case 'stun': {
          // a blinding white flash, a ring of light along the ground and sparks
          if (!near(e.x, e.z)) break;
          flash(e.x, 1.2, e.z, 1.6, 0.3, 14, stunFlash);
          ripple(e.x, 0.2, e.z, THROWS.stun.radius, 0.5, 0xffffff);
          burst(e.x, 1, e.z, 18, 9, 0.12, 0.5, [partMat.spark, partMat.shine], 3);
          break;
        }
        case 'leader': {
          const f = m.fighters[e.f];
          if (f && near(f.x, f.z)) burst(f.x, 2.2, f.z, 14, 3, 0.12, 0.8, [M.gold, partMat.spark], 4);
          break;
        }
        case 'glass': {
          // the pane shatters: shards burst both ways out of the frame and glint as they fall
          const p = map.windows[e.i];
          const g = glassParts[e.i];
          if (!p || !g || !near(p.x, p.z)) break;
          const alongX = p.hw > p.hd;
          const len = 2 * (alongX ? p.hw : p.hd);
          for (let k = 0; k < 3; k++) {
            const u = (k - 1) * len * 0.3;
            burst(p.x + (alongX ? u : 0), g.y, p.z + (alongX ? 0 : u), 6, 4.5, 0.11, 0.8, [partMat.glass, partMat.glass, partMat.shine]);
          }
          flash(p.x, g.y, p.z, 0.35, 0.08, 0, flashMat);
          break;
        }
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
        case 'boom': {
          // up on something built, or down on the ground
          const y = e.y ?? 0;
          if (e.r !== undefined) {
            // a small one, a MIRV's bomblet: a quick pop of fire and smoke
            flash(e.x, y + 0.8, e.z, 0.5 * (e.r / 3), 0.22, 7, boomMat);
            burst(e.x, y + 0.8, e.z, 7, 6, 0.16, 0.5, [partMat.fire, partMat.spark]);
            if (near(e.x, e.z)) {
              puff(e.x, y + 0.8, e.z, 0.7, 0.9, 0xb4b4b8, 0.5, 0, 1.2, 0, 1.6);
              dustRing(e.x, e.z, 5, 0.8, 0.45, 0xc9b38a, 0.5, 4);
            }
            const f = m.fighters[focus];
            if (f && Math.hypot(f.x - e.x, f.z - e.z) < 12) shake = Math.max(shake, 0.35);
            break;
          }
          flash(e.x, y + 1, e.z, 1.2, 0.35, 9, boomMat);
          burst(e.x, y + 1, e.z, 16, 9, 0.24, 0.8, [partMat.fire, partMat.spark]);
          if (near(e.x, e.z)) {
            // a fireball that rolls up into smoke, a shockwave along the ground, and a scorch left behind
            for (let i = 0; i < 4; i++) puff(e.x + (Math.random() - 0.5) * 1.2, y + 0.8 + Math.random(), e.z + (Math.random() - 0.5) * 1.2, 0.8, 0.3, i % 2 ? 0xffc35a : 0xff8a3a, 0.8, 0, 2.5, 0, 1.4);
            for (let i = 0; i < 7; i++) {
              const a = (i / 7) * Math.PI * 2;
              puff(e.x + Math.sin(a) * 1.2, y + 1 + Math.random() * 1.5, e.z + Math.cos(a) * 1.2, 1.1, 1.5 + Math.random() * 0.8, i % 3 ? 0xa4a4a8 : 0xc4c4c8, 0.55, Math.sin(a) * 1.5, 1.4 + Math.random(), Math.cos(a) * 1.5, 1.8);
            }
          }
          if (near(e.x, e.z) && y < 0.5) {
            ripple(e.x, 0.2, e.z, 8, 0.45, 0xffd9a0);
            dustRing(e.x, e.z, 8, 1.5, 0.7, 0xc9b38a, 0.6, 7);
            const sc = scorches[scorchAt];
            scorchAt = (scorchAt + 1) % scorches.length;
            sc.position.set(e.x, 0.029, e.z);
            sc.scale.setScalar(3.6 + Math.random());
            sc.rotation.z = Math.random() * 6;
            sc.visible = true;
          }
          const f = m.fighters[focus];
          if (f && Math.hypot(f.x - e.x, f.z - e.z) < 25) shake = Math.max(shake, 1.1);
          break;
        }
        case 'opened': {
          const c = map.containers[e.c];
          if (!c || !near(c.x, c.z)) break;
          if (c.kind === 'crate') burst(c.x, 1, c.z, 18, 6, 0.2, 0.8, [partMat.wood]);
          else if (c.kind === 'barrel') burst(c.x, 0.8, c.z, 20, 8, 0.22, 0.9, [partMat.red, partMat.metal, partMat.fire]);
          else if (c.kind === 'toilet') burst(c.x, 0.6, c.z, 18, 6, 0.16, 0.8, [partMat.shell, partMat.shell, partMat.splash]);
          else if (c.kind === 'hay') burst(c.x, 0.8, c.z, 22, 5, 0.18, 0.9, [partMat.straw], 6);
          else if (c.kind === 'fridge') burst(c.x + 0, 1.2, c.z + c.face * 0.8, 10, 3, 0.14, 0.6, [partMat.splash, partMat.shell], 4);
          else if (c.kind === 'drawer') burst(c.x, 0.8, c.z, 8, 3, 0.12, 0.5, [partMat.wood, partMat.dust]);
          else if (c.kind === 'books') burst(c.x, 1.2, c.z, 16, 3, 0.13, 0.7, [partMat.red, partMat.paper, partMat.leaf], 6);
          else if (c.kind === 'locker') burst(c.x, 1.2, c.z, 6, 3, 0.08, 0.4, [partMat.metal, partMat.spark]);
          else if (c.kind === 'safe' || c.kind === 'deposit') burst(c.x, 0.8, c.z, 16, 3, 0.12, 0.7, [M.gold, partMat.spark, partMat.metal], 4);
          else burst(c.x, 1, c.z, c.kind === 'supply' ? 22 : 12, 4, 0.2, 0.8, [partMat.spark, M.gold]);
          break;
        }
        case 'bounce': {
          const f = m.fighters[e.f];
          const v = eggs[e.f];
          if (v) v.sqV = 7;
          if (!f || !near(f.x, f.z)) break;
          burst(f.x, 0.3, f.z, 10, 5, 0.2, 0.6, [partMat.dust], 2);
          dustRing(f.x, f.z, 8, 1.3, 0.55, 0xbff5e2, 0.6, 5);
          flash(f.x, 0.3, f.z, 0.8, 0.25, 8, padFlash);
          if (e.f === focus) shake = Math.max(shake, 0.3);
          break;
        }
        case 'wall':
          if (near(e.wall.x, e.wall.z)) burst(e.wall.x, e.wall.lv * LEVEL_H + 0.3, e.wall.z, 6, 2, 0.16, 0.4, [partMat.dust]);
          break;
        case 'land': {
          const f = m.fighters[e.f];
          const v = eggs[e.f];
          // a thump: squashed flat for a moment, and dust (or spray) thrown out round it
          if (v) v.sqV = -6.5;
          if (!f || !near(f.x, f.z)) break;
          if (f.wet) {
            burst(f.x, 0.3, f.z, 14, 4, 0.18, 0.6, [partMat.splash], 6);
            ripple(f.x, 0.07, f.z, 3.2, 0.9, 0xe6f7ff);
            ripple(f.x, 0.07, f.z, 1.8, 0.7, 0xe6f7ff);
          } else dustRing(f.x, f.z, 9, 0.7, 0.55, 0xd9cfae, 0.65, 3.2);
          break;
        }
        case 'out': {
          const f = m.fighters[e.f];
          if (!f) break;
          // the egg cracks: shell flies, a yolk stays behind
          burst(f.x, 1, f.z, 26, 6, 0.2, 1, [partMat.shell, partMat.shell, partMat.yolk]);
          if (near(f.x, f.z)) {
            star(f.x, 1, f.z, 0, 2.4, 2.4, 0.12, sparkMat);
            dustRing(f.x, f.z, 7, 0.8, 0.6, 0xfff3df, 0.7, 3.5);
          }
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
