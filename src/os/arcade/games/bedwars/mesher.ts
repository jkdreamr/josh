// Turns one 16x16x16 chunk of the world into vertex arrays: only faces that touch air or see-through blocks, with
// Minecraft-style smooth lighting baked into vertex colors (ambient occlusion from the three blocks around each
// corner, a sun direction per face, and shade under overhangs). Pure, so it runs and is tested under node.
import { AIR, ATLAS_TILES, BED_HEAD, BLOCKS, CS, GLASS, LADDER, LADDER_DIRS, SGLASS, TEAM_COUNT, TILE, WATER, bedTeam, type Pass } from './blocks.ts';
import { idx as cellIndex, type World } from './world.ts';

export type Geo = { pos: Float32Array; uv: Float32Array; col: Float32Array; idx: Uint16Array | Uint32Array; quads: number };
export type ChunkMesh = Record<Pass, Geo | null>;

/** Face brightness: a warm sun from the south east, high in the sky. 0 +x, 1 -x, 2 +y, 3 -y, 4 +z, 5 -z */
export const FACE_SHADE = [0.8, 0.6, 1, 0.5, 0.86, 0.66];
/** Corner brightness by how many of its three neighbors are solid (3 = open). */
export const AO_CURVE = [0.46, 0.64, 0.82, 1];
const SHADE_FLOOR = 0.62;

/** Corners of each face as seen from outside: bottom left, bottom right, top right, top left. */
const CORNERS: number[][][] = [
  [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]],
  [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]],
  [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]],
  [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
  [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
  [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]],
];
const NORMALS = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];
const AXIS = [0, 0, 1, 1, 2, 2];

/** sRGB brightness to linear, as a table (three.js works in linear and encodes on output). */
const LIN = new Float32Array(256);
for (let i = 0; i < 256; i++) LIN[i] = Math.pow(i / 255, 2.2);
const lin = (v: number) => LIN[Math.max(0, Math.min(255, Math.round(v * 255)))];

class Buf {
  pos = new Float32Array(4096 * 3);
  uv = new Float32Array(4096 * 2);
  col = new Float32Array(4096 * 3);
  idx = new Uint32Array(6144);
  v = 0;
  i = 0;
  reset() {
    this.v = 0;
    this.i = 0;
  }
  grow() {
    const g = <T extends Float32Array | Uint32Array>(a: T, n: number): T => {
      if (a.length >= n) return a;
      const b = new (a.constructor as { new (n: number): T })(Math.max(n, a.length * 2));
      b.set(a);
      return b;
    };
    this.pos = g(this.pos, (this.v + 4) * 3);
    this.uv = g(this.uv, (this.v + 4) * 2);
    this.col = g(this.col, (this.v + 4) * 3);
    this.idx = g(this.idx, this.i + 6);
  }
  vert(x: number, y: number, z: number, u: number, v: number, c: number, tr: number, tg: number, tb: number) {
    const p = this.v * 3;
    this.pos[p] = x;
    this.pos[p + 1] = y;
    this.pos[p + 2] = z;
    const q = this.v * 2;
    this.uv[q] = u;
    this.uv[q + 1] = v;
    this.col[p] = lin(c * tr);
    this.col[p + 1] = lin(c * tg);
    this.col[p + 2] = lin(c * tb);
    this.v++;
  }
  /** Two triangles over the last four vertices; flip picks the diagonal that keeps shading smooth. */
  quad(flip: boolean) {
    const b = this.v - 4;
    const ix = this.idx;
    let i = this.i;
    if (flip) {
      ix[i++] = b + 1;
      ix[i++] = b + 2;
      ix[i++] = b + 3;
      ix[i++] = b + 1;
      ix[i++] = b + 3;
      ix[i++] = b;
    } else {
      ix[i++] = b;
      ix[i++] = b + 1;
      ix[i++] = b + 2;
      ix[i++] = b;
      ix[i++] = b + 2;
      ix[i++] = b + 3;
    }
    this.i = i;
  }
  take(): Geo | null {
    if (!this.v) return null;
    const idx = this.v > 65535 ? this.idx.slice(0, this.i) : Uint16Array.from(this.idx.subarray(0, this.i));
    return { pos: this.pos.slice(0, this.v * 3), uv: this.uv.slice(0, this.v * 2), col: this.col.slice(0, this.v * 3), idx, quads: this.i / 6 };
  }
}

const bufs: Record<Pass, Buf> = { opaque: new Buf(), cutout: new Buf(), glass: new Buf() };
const EPS = 1 / 4096;

/** Atlas coordinates of a tile: u0, v0, u1, v1 (v up, the canvas top row is v = 1). */
export function tileUV(tile: number): [number, number, number, number] {
  const tx = tile % ATLAS_TILES;
  const ty = Math.floor(tile / ATLAS_TILES);
  return [tx / ATLAS_TILES + EPS, 1 - (ty + 1) / ATLAS_TILES + EPS, (tx + 1) / ATLAS_TILES - EPS, 1 - ty / ATLAS_TILES - EPS];
}

const occludes = (id: number) => id !== AIR && BLOCKS[id].opaque;

/** Does the face of block `id` toward neighbor `n` show? */
function faceVisible(id: number, n: number) {
  if (n === AIR) return true;
  const nb = BLOCKS[n];
  if (nb.opaque) return false;
  const b = BLOCKS[id];
  // glass and water hide their faces against their own kind
  if (b.pass === 'glass' && (n === id || (id >= SGLASS && id < SGLASS + TEAM_COUNT && n >= SGLASS && n < SGLASS + TEAM_COUNT))) return false;
  if (id === GLASS && n === GLASS) return false;
  return true;
}

/**
 * Builds the vertex arrays for chunk (cx, cy, cz). Positions are relative to the chunk's corner so the mesh can sit at
 * (cx * 16, cy * 16, cz * 16).
 */
export function meshChunk(world: World, cx: number, cy: number, cz: number): ChunkMesh {
  for (const p of ['opaque', 'cutout', 'glass'] as Pass[]) bufs[p].reset();
  const x0 = cx * CS;
  const y0 = cy * CS;
  const z0 = cz * CS;
  const blocks = world.blocks;
  for (let ly = 0; ly < CS; ly++) {
    const y = y0 + ly;
    for (let lz = 0; lz < CS; lz++) {
      const z = z0 + lz;
      const row = cellIndex(x0, y, z);
      for (let lx = 0; lx < CS; lx++) {
        const x = x0 + lx;
        const id = blocks[row + lx];
        if (id === AIR) continue;
        const b = BLOCKS[id];
        const buf = bufs[b.pass];
        if (b.shape === 'cube') cube(world, buf, id, x, y, z, lx, ly, lz);
        else if (b.shape === 'cross') cross(world, buf, id, x, y, z, lx, ly, lz);
        else if (b.shape === 'bed') bed(world, buf, id, x, y, z, lx, ly, lz);
        else if (b.shape === 'ladder') ladder(world, buf, id, x, y, z, lx, ly, lz);
        else if (b.shape === 'liquid') liquid(world, buf, id, x, y, z, lx, ly, lz);
      }
    }
  }
  return { opaque: bufs.opaque.take(), cutout: bufs.cutout.take(), glass: bufs.glass.take() };
}

/** Results of cornerLight, kept in module scope so meshing allocates nothing per corner. */
let cAo = 3;
let cSky = 1;
const o1 = [0, 0, 0];
const o2 = [0, 0, 0];

/** Smooth light at one corner of a face: AO from the three neighbors in front of it, and sky shade from the same four cells. */
function cornerLight(world: World, f: number, x: number, y: number, z: number, c: number[]) {
  const n = NORMALS[f];
  const px = x + n[0];
  const py = y + n[1];
  const pz = z + n[2];
  const ax = AXIS[f];
  // tangent axes
  const t1 = ax === 0 ? 1 : 0;
  const t2 = ax === 2 ? 1 : 2;
  o1[0] = o1[1] = o1[2] = 0;
  o2[0] = o2[1] = o2[2] = 0;
  o1[t1] = c[t1] ? 1 : -1;
  o2[t2] = c[t2] ? 1 : -1;
  const a = occludes(world.get(px + o1[0], py + o1[1], pz + o1[2])) ? 1 : 0;
  const b = occludes(world.get(px + o2[0], py + o2[1], pz + o2[2])) ? 1 : 0;
  const d = occludes(world.get(px + o1[0] + o2[0], py + o1[1] + o2[1], pz + o1[2] + o2[2])) ? 1 : 0;
  cAo = a && b ? 0 : 3 - (a + b + d);
  cSky =
    (world.lit(px, py, pz) + world.lit(px + o1[0], py + o1[1], pz + o1[2]) + world.lit(px + o2[0], py + o2[1], pz + o2[2]) + world.lit(px + o1[0] + o2[0], py + o1[1] + o2[1], pz + o1[2] + o2[2])) / 4;
}

const lights = [0, 0, 0, 0];
const aos = [0, 0, 0, 0];
const us = [0, 0, 0, 0];
const vs = [0, 0, 0, 0];

function emitFace(world: World, buf: Buf, f: number, x: number, y: number, z: number, lx: number, ly: number, lz: number, tile: number, tint: number[], box?: number[], uvRot = 0, flat = false) {
  if (buf.pos.length < (buf.v + 4) * 3 || buf.idx.length < buf.i + 6) buf.grow();
  const cs = CORNERS[f];
  const [u0, v0, u1, v1] = tileUV(tile);
  for (let k = 0; k < 4; k++) {
    if (flat) {
      aos[k] = 3;
      lights[k] = FACE_SHADE[f] * (SHADE_FLOOR + (1 - SHADE_FLOOR) * world.lit(x, y + 1, z));
      continue;
    }
    cornerLight(world, f, x, y, z, cs[k]);
    aos[k] = cAo;
    lights[k] = FACE_SHADE[f] * AO_CURVE[cAo] * (SHADE_FLOOR + (1 - SHADE_FLOOR) * cSky);
  }
  // uv corners in face order: bl, br, tr, tl
  us[0] = u0;
  us[1] = u1;
  us[2] = u1;
  us[3] = u0;
  vs[0] = v0;
  vs[1] = v0;
  vs[2] = v1;
  vs[3] = v1;
  for (let k = 0; k < 4; k++) {
    const c = cs[k];
    let cxv = c[0];
    let cyv = c[1];
    let czv = c[2];
    let uu = us[(k + uvRot) % 4];
    let vv = vs[(k + uvRot) % 4];
    if (box) {
      cxv = box[c[0] * 3];
      cyv = box[1 + c[1] * 3];
      czv = box[2 + c[2] * 3];
      // crop the side textures of short blocks from the bottom up
      if (f !== 2 && f !== 3 && c[1] === 1) vv = v0 + (v1 - v0) * box[4];
    }
    buf.vert(lx + cxv, ly + cyv, lz + czv, uu, vv, lights[k], tint[0], tint[1], tint[2]);
  }
  buf.quad(aos[0] + aos[2] < aos[1] + aos[3]);
}

const WHITE = [1, 1, 1];

function cube(world: World, buf: Buf, id: number, x: number, y: number, z: number, lx: number, ly: number, lz: number) {
  const b = BLOCKS[id];
  for (let f = 0; f < 6; f++) {
    const n = NORMALS[f];
    const nb = world.get(x + n[0], y + n[1], z + n[2]);
    if (!faceVisible(id, nb)) continue;
    const tile = f === 2 ? b.tex[0] : f === 3 ? b.tex[1] : b.tex[2];
    emitFace(world, buf, f, x, y, z, lx, ly, lz, tile, WHITE);
  }
}

function cross(world: World, buf: Buf, id: number, x: number, y: number, z: number, lx: number, ly: number, lz: number) {
  const [u0, v0, u1, v1] = tileUV(BLOCKS[id].tex[2]);
  const light = 0.9 * (SHADE_FLOOR + (1 - SHADE_FLOOR) * world.lit(x, y, z));
  const quads = [
    [0.15, 0.15, 0.85, 0.85],
    [0.15, 0.85, 0.85, 0.15],
  ];
  for (const [ax, az, bx, bz] of quads)
    for (const back of [false, true]) {
      if (buf.pos.length < (buf.v + 4) * 3 || buf.idx.length < buf.i + 6) buf.grow();
      const p = back ? [bx, bz, ax, az] : [ax, az, bx, bz];
      buf.vert(lx + p[0], ly, lz + p[1], back ? u1 : u0, v0, light, 1, 1, 1);
      buf.vert(lx + p[2], ly, lz + p[3], back ? u0 : u1, v0, light, 1, 1, 1);
      buf.vert(lx + p[2], ly + 0.9, lz + p[3], back ? u0 : u1, v1, light, 1, 1, 1);
      buf.vert(lx + p[0], ly + 0.9, lz + p[1], back ? u1 : u0, v1, light, 1, 1, 1);
      buf.quad(false);
    }
}

const BED_BOX = [0, 0, 0, 1, 0.5625, 1];

function bed(world: World, buf: Buf, id: number, x: number, y: number, z: number, lx: number, ly: number, lz: number) {
  const b = BLOCKS[id];
  const dir = world.bedDir[bedTeam(id)] ?? 0;
  // texture "up" on the top face is -z; rotate so the pillow end faces the bed's direction
  const rot = [3, 1, 2, 0][dir];
  const head = id >= BED_HEAD && id < BED_HEAD + TEAM_COUNT;
  for (let f = 0; f < 6; f++) {
    const n = NORMALS[f];
    const nb = world.get(x + n[0], y + n[1], z + n[2]);
    if (f !== 2 && occludes(nb)) continue;
    let tile = f === 2 ? b.tex[0] : f === 3 ? b.tex[1] : b.tex[2];
    // the end of the bed (head or foot board) along its length
    const along = LADDER_DIRS[dir];
    if (f !== 2 && f !== 3 && ((n[0] !== 0 && n[0] === along[0] * (head ? 1 : -1)) || (n[2] !== 0 && n[2] === along[1] * (head ? 1 : -1)))) tile = TILE.bed_end;
    emitFace(world, buf, f, x, y, z, lx, ly, lz, tile, WHITE, BED_BOX, f === 2 ? rot : 0);
  }
}

function ladder(world: World, buf: Buf, id: number, x: number, y: number, z: number, lx: number, ly: number, lz: number) {
  const [dx, dz] = LADDER_DIRS[id - LADDER];
  const [u0, v0, u1, v1] = tileUV(TILE.ladder);
  const light = 0.85 * (SHADE_FLOOR + (1 - SHADE_FLOOR) * world.lit(x - dx, y, z - dz));
  const off = 1 / 16;
  // the quad sits just off the wall it hangs on
  let pts: number[][];
  if (dx === 1) pts = [[1 - off, 0, 0], [1 - off, 0, 1], [1 - off, 1, 1], [1 - off, 1, 0]];
  else if (dx === -1) pts = [[off, 0, 1], [off, 0, 0], [off, 1, 0], [off, 1, 1]];
  else if (dz === 1) pts = [[1, 0, 1 - off], [0, 0, 1 - off], [0, 1, 1 - off], [1, 1, 1 - off]];
  else pts = [[0, 0, off], [1, 0, off], [1, 1, off], [0, 1, off]];
  const uvs = [
    [u0, v0],
    [u1, v0],
    [u1, v1],
    [u0, v1],
  ];
  for (const back of [false, true]) {
    if (buf.pos.length < (buf.v + 4) * 3 || buf.idx.length < buf.i + 6) buf.grow();
    const order = back ? [1, 0, 3, 2] : [0, 1, 2, 3];
    for (const k of order) buf.vert(lx + pts[k][0], ly + pts[k][1], lz + pts[k][2], uvs[k][0], uvs[k][1], light, 1, 1, 1);
    buf.quad(false);
  }
}

const WATER_BOX = [0, 0, 0, 1, 0.875, 1];

function liquid(world: World, buf: Buf, id: number, x: number, y: number, z: number, lx: number, ly: number, lz: number) {
  const above = world.get(x, y + 1, z) === WATER;
  for (let f = 0; f < 6; f++) {
    const n = NORMALS[f];
    const nb = world.get(x + n[0], y + n[1], z + n[2]);
    if (!faceVisible(id, nb)) continue;
    emitFace(world, buf, f, x, y, z, lx, ly, lz, TILE.water, WHITE, above ? undefined : WATER_BOX, 0, true);
  }
}
