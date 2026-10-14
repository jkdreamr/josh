// The voxel world: one byte per block, which blocks players placed, dirty chunks for the mesher, and the edits
// since the map was generated (so a late joiner only needs the difference). Pure, so it runs under node.
import { AIR, BLOCKS, CS, CX, CY, CZ, LEAVES, SX, SY, SZ, blockBox, isPlayerBlock } from './blocks.ts';

export const idx = (x: number, y: number, z: number) => (y * SZ + z) * SX + x;
export const inBounds = (x: number, y: number, z: number) => x >= 0 && y >= 0 && z >= 0 && x < SX && y < SY && z < SZ;
export const chunkKey = (cx: number, cy: number, cz: number) => (cy * CZ + cz) * CX + cx;
/** Blocks that shade everything under them (sunlight comes straight down). */
export const castsShade = (id: number) => id !== AIR && (BLOCKS[id].opaque || id === LEAVES);

export class World {
  readonly blocks = new Uint8Array(SX * SY * SZ);
  /** Blocks a player placed: the only ones that may be broken (beds aside). */
  readonly placed = new Set<number>();
  /** Every change since generation, index to block id. */
  readonly edits = new Map<number, number>();
  /** Chunks whose mesh is out of date. */
  readonly dirty = new Set<number>();
  /** Highest shade-casting block in each column (x + z * SX), -1 when open to the sky. */
  readonly top = new Int16Array(SX * SZ).fill(-1);
  /** Which way each team's bed points (0..3 as LADDER_DIRS), for its pillow. */
  bedDir: number[] = [];
  /** True while the map is being generated: changes are not edits. */
  generating = false;
  /** Bumps on every change, so callers can tell the world moved under them. */
  version = 0;

  get(x: number, y: number, z: number): number {
    x = Math.floor(x);
    y = Math.floor(y);
    z = Math.floor(z);
    if (!inBounds(x, y, z)) return AIR;
    return this.blocks[idx(x, y, z)];
  }

  /** Sets a block. placed marks it as breakable by players. */
  set(x: number, y: number, z: number, id: number, placed = false) {
    if (!inBounds(x, y, z)) return false;
    const i = idx(x, y, z);
    if (this.blocks[i] === id && placed === this.placed.has(i)) return false;
    this.blocks[i] = id;
    if (placed && id !== AIR) this.placed.add(i);
    else this.placed.delete(i);
    if (!this.generating) {
      this.edits.set(i, id);
      this.markDirty(x, y, z);
      this.updateTop(x, y, z, id);
    }
    this.version++;
    return true;
  }

  /** Recomputes every column's shade height (after generating the map). */
  computeTops() {
    for (let z = 0; z < SZ; z++)
      for (let x = 0; x < SX; x++) {
        let t = -1;
        for (let y = SY - 1; y >= 0; y--)
          if (castsShade(this.blocks[idx(x, y, z)])) {
            t = y;
            break;
          }
        this.top[x + z * SX] = t;
      }
  }

  /** Keeps a column's shade height current; when it moves, the chunks it shades (and their neighbors) remesh. */
  private updateTop(x: number, y: number, z: number, id: number) {
    const c = x + z * SX;
    const old = this.top[c];
    let next = old;
    if (castsShade(id)) next = Math.max(old, y);
    else if (y === old) {
      next = -1;
      for (let yy = y - 1; yy >= 0; yy--)
        if (castsShade(this.blocks[idx(x, yy, z)])) {
          next = yy;
          break;
        }
    }
    if (next === old) return;
    this.top[c] = next;
    const lo = Math.max(0, Math.min(old, next));
    const hi = Math.max(old, next);
    for (let cy = Math.floor(lo / CS); cy <= Math.floor(hi / CS); cy++)
      for (let ox = -1; ox <= 1; ox++)
        for (let oz = -1; oz <= 1; oz++) {
          const cx = Math.floor((x + ox) / CS);
          const cz = Math.floor((z + oz) / CS);
          if (cx < 0 || cz < 0 || cx >= CX || cz >= CZ || cy >= CY) continue;
          this.dirty.add(chunkKey(cx, cy, cz));
        }
  }

  /** 1 when a cell sees the sky straight up, else 0. */
  lit(x: number, y: number, z: number) {
    if (x < 0 || z < 0 || x >= SX || z >= SZ) return 1;
    return y > this.top[x + z * SX] ? 1 : 0;
  }

  isPlaced(x: number, y: number, z: number) {
    return inBounds(x, y, z) && this.placed.has(idx(x, y, z));
  }

  /** Marks the chunk holding a block dirty, and its neighbors when the block sits on their edge (faces and shading). */
  markDirty(x: number, y: number, z: number) {
    const cx = Math.floor(x / CS);
    const cy = Math.floor(y / CS);
    const cz = Math.floor(z / CS);
    const lx = x - cx * CS;
    const ly = y - cy * CS;
    const lz = z - cz * CS;
    const xs = lx === 0 ? [-1, 0] : lx === CS - 1 ? [0, 1] : [0];
    const ys = ly === 0 ? [-1, 0] : ly === CS - 1 ? [0, 1] : [0];
    const zs = lz === 0 ? [-1, 0] : lz === CS - 1 ? [0, 1] : [0];
    for (const ox of xs)
      for (const oy of ys)
        for (const oz of zs) {
          const nx = cx + ox;
          const ny = cy + oy;
          const nz = cz + oz;
          if (nx < 0 || ny < 0 || nz < 0 || nx >= CX || ny >= CY || nz >= CZ) continue;
          this.dirty.add(chunkKey(nx, ny, nz));
        }
  }

  markAllDirty() {
    for (let i = 0; i < CX * CY * CZ; i++) this.dirty.add(i);
  }

  /** True when a box (min/max corners) overlaps any solid block's collision box. */
  boxHitsBlocks(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number) {
    for (let y = Math.floor(y0); y < Math.ceil(y1); y++)
      for (let z = Math.floor(z0); z < Math.ceil(z1); z++)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const b = blockBox(this.get(x, y, z));
          if (!b) continue;
          if (x + b[0] < x1 && x + b[3] > x0 && y + b[1] < y1 && y + b[4] > y0 && z + b[2] < z1 && z + b[5] > z0) return true;
        }
    return false;
  }

  /** Collision boxes (world space, 6 numbers each) of blocks touching a region, written into out. Returns the count. */
  collectBoxes(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, out: number[]) {
    out.length = 0;
    for (let y = Math.floor(y0) - 1; y < Math.ceil(y1); y++)
      for (let z = Math.floor(z0); z < Math.ceil(z1); z++)
        for (let x = Math.floor(x0); x < Math.ceil(x1); x++) {
          const b = blockBox(this.get(x, y, z));
          if (!b) continue;
          out.push(x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]);
        }
    return out.length / 6;
  }
}

export type RayHit = { x: number; y: number; z: number; face: number; dist: number; id: number };

/**
 * Walks the grid from an eye point along a unit direction (Amanatides and Woo) and returns the first pickable block
 * within reach, with the face it was hit on. Partial blocks (beds, ladders) are tested against their real box.
 */
export function raycast(world: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, reach: number): RayHit | null {
  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);
  const stepX = dx > 0 ? 1 : -1;
  const stepY = dy > 0 ? 1 : -1;
  const stepZ = dz > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  const tdz = dz !== 0 ? Math.abs(1 / dz) : Infinity;
  let tmx = dx !== 0 ? (dx > 0 ? x + 1 - ox : ox - x) * tdx : Infinity;
  let tmy = dy !== 0 ? (dy > 0 ? y + 1 - oy : oy - y) * tdy : Infinity;
  let tmz = dz !== 0 ? (dz > 0 ? z + 1 - oz : oz - z) * tdz : Infinity;
  let face = -1;
  let t = 0;
  for (let i = 0; i < 64 && t <= reach; i++) {
    const id = world.get(x, y, z);
    if (id !== AIR && BLOCKS[id].pickable) {
      const box = blockBox(id) ?? [0, 0, 0, 1, 1, 1];
      const full = box[0] === 0 && box[1] === 0 && box[2] === 0 && box[3] === 1 && box[4] === 1 && box[5] === 1;
      if (full && face >= 0) return { x, y, z, face, dist: t, id };
      const hit = rayBox(ox, oy, oz, dx, dy, dz, x + box[0], y + box[1], z + box[2], x + box[3], y + box[4], z + box[5]);
      if (hit && hit.t <= reach) return { x, y, z, face: hit.face, dist: hit.t, id };
    }
    if (tmx < tmy && tmx < tmz) {
      x += stepX;
      t = tmx;
      tmx += tdx;
      face = stepX > 0 ? 1 : 0;
    } else if (tmy < tmz) {
      y += stepY;
      t = tmy;
      tmy += tdy;
      face = stepY > 0 ? 3 : 2;
    } else {
      z += stepZ;
      t = tmz;
      tmz += tdz;
      face = stepZ > 0 ? 5 : 4;
    }
  }
  return null;
}

/** Ray against a box: entry distance and the face (as FACE_DIRS) it enters, or null. */
export function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): { t: number; face: number } | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  let face = -1;
  const axes: [number, number, number, number, number, number][] = [
    [ox, dx, x0, x1, 1, 0],
    [oy, dy, y0, y1, 3, 2],
    [oz, dz, z0, z1, 5, 4],
  ];
  for (const [o, d, lo, hi, fLo, fHi] of axes) {
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let t0 = (lo - o) / d;
    let t1 = (hi - o) / d;
    let f = fLo;
    if (t0 > t1) {
      const s = t0;
      t0 = t1;
      t1 = s;
      f = fHi;
    }
    if (t0 > tmin) {
      tmin = t0;
      face = f;
    }
    tmax = Math.min(tmax, t1);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return { t: Math.max(0, tmin), face: tmin < 0 ? -1 : face };
}

/** Is a placed block (or a bed) breakable? Map blocks never are. */
export function canBreak(world: World, x: number, y: number, z: number): boolean {
  const id = world.get(x, y, z);
  if (id === AIR) return false;
  if (BLOCKS[id].shape === 'bed') return true;
  return isPlayerBlock(id) && world.isPlaced(x, y, z);
}

/** Line of sight between two points: no opaque or solid full block in between (glass counts as clear). */
export function clearLine(world: World, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return true;
  const steps = Math.ceil(len * 4);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const id = world.get(ax + dx * t, ay + dy * t, az + dz * t);
    if (id !== AIR && BLOCKS[id].opaque) return false;
  }
  return true;
}
