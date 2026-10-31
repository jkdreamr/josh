// Moving bodies through the world (ground, ice, water, walls, crates, trunks and rocks) and casting rays for bullets
// and sight lines. Colliders come from the world's grid.
import { T_HALF, floorAt, normalAt, rayTerrain } from './terrain.ts';
import { ARENA, KIND, K_BOX, K_ROCK, K_TRUNK, type Surface, type World } from './world.ts';

export const RADIUS = 0.36;
export const STAND_H = 1.8;
export const CROUCH_H = 1.25;
export const STEP_UP = 0.5;
export const GRAVITY = 20;
/** Water deeper than this is swum, not waded. */
export const SWIM_DEPTH = 1.15;

export type Body = { x: number; y: number; z: number; vx: number; vy: number; vz: number; onGround: boolean; height: number; swim: boolean };

type Stamps = { box: Uint32Array; trunk: Uint32Array; rock: Uint32Array; q: number };
const stampMap = new WeakMap<World, Stamps>();
function stamps(w: World) {
  let s = stampMap.get(w);
  if (!s) {
    s = { box: new Uint32Array(w.boxes.length), trunk: new Uint32Array(w.trunks.length), rock: new Uint32Array(w.rocks.length), q: 0 };
    stampMap.set(w, s);
  }
  s.q = (s.q + 1) >>> 0 || 1;
  return s;
}

/** Calls fn once for every collider whose cell overlaps the rectangle. */
export function forEachNear(w: World, x0: number, z0: number, x1: number, z1: number, fn: (kind: number, i: number) => void) {
  const g = w.grid;
  const st = stamps(w);
  const q = st.q;
  const i0 = Math.max(0, Math.floor((x0 + T_HALF) / g.size));
  const i1 = Math.min(g.n - 1, Math.floor((x1 + T_HALF) / g.size));
  const j0 = Math.max(0, Math.floor((z0 + T_HALF) / g.size));
  const j1 = Math.min(g.n - 1, Math.floor((z1 + T_HALF) / g.size));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const c = j * g.n + i;
      for (let k = g.start[c]; k < g.start[c + 1]; k++) {
        const id = g.items[k];
        const kind = (id / KIND) | 0;
        const idx = id - kind * KIND;
        const arr = kind === K_BOX ? st.box : kind === K_TRUNK ? st.trunk : st.rock;
        if (arr[idx] === q) continue;
        arr[idx] = q;
        fn(kind, idx);
      }
    }
}

/** Height of the top of a rock collider at a horizontal distance. */
const rockTop = (r: number, cy: number, d: number) => cy + Math.sqrt(Math.max(0, r * r - d * d)) * 0.92;

/** The highest surface under (x, z) that a body standing at y can be on: ground, ice, a box top or a rock. */
export function groundAt(w: World, x: number, z: number, y: number) {
  let g = floorAt(w.terrain, x, z);
  const reach = y + STEP_UP + 0.01;
  const e = 0.12;
  forEachNear(w, x - 1, z - 1, x + 1, z + 1, (kind, i) => {
    if (kind === K_BOX) {
      const b = w.boxes[i];
      if (x >= b.x0 - e && x <= b.x1 + e && z >= b.z0 - e && z <= b.z1 + e && b.y1 <= reach && b.y1 > g) g = b.y1;
    } else if (kind === K_ROCK) {
      const r = w.rocks[i];
      const d = Math.hypot(x - r.x, z - r.z);
      if (d < r.r) {
        const top = rockTop(r.r, r.y, d);
        if (top <= reach && top > g) g = top;
      }
    }
  });
  return g;
}

/** Pushes a body out of walls, trunks and rocks sideways, and stops it at ceilings. */
function pushOut(w: World, b: Body) {
  const R = RADIUS;
  const feet = b.y + STEP_UP;
  const head = b.y + b.height;
  forEachNear(w, b.x - R - 0.2, b.z - R - 0.2, b.x + R + 0.2, b.z + R + 0.2, (kind, i) => {
    if (kind === K_BOX) {
      const o = w.boxes[i];
      if (o.y1 <= feet || o.y0 >= head) return;
      const inside = b.x > o.x0 && b.x < o.x1 && b.z > o.z0 && b.z < o.z1;
      // a box above the knees and below the head while we stand under it is a ceiling
      if (inside && o.y0 > b.y + 0.4) {
        b.y = Math.min(b.y, o.y0 - b.height);
        if (b.vy > 0) b.vy = 0;
        return;
      }
      const cx = Math.min(o.x1, Math.max(o.x0, b.x));
      const cz = Math.min(o.z1, Math.max(o.z0, b.z));
      let dx = b.x - cx;
      let dz = b.z - cz;
      const d2 = dx * dx + dz * dz;
      if (d2 >= R * R) return;
      let nx: number;
      let nz: number;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        nx = dx / d;
        nz = dz / d;
        b.x += nx * (R - d);
        b.z += nz * (R - d);
      } else {
        // the center is inside: leave by the nearest side
        const l = b.x - o.x0;
        const r = o.x1 - b.x;
        const f = b.z - o.z0;
        const k = o.z1 - b.z;
        const m = Math.min(l, r, f, k);
        nx = m === l ? -1 : m === r ? 1 : 0;
        nz = nx !== 0 ? 0 : m === f ? -1 : 1;
        if (nx < 0) b.x = o.x0 - R;
        else if (nx > 0) b.x = o.x1 + R;
        else if (nz < 0) b.z = o.z0 - R;
        else b.z = o.z1 + R;
        dx = nx;
        dz = nz;
      }
      const vn = b.vx * nx + b.vz * nz;
      if (vn < 0) {
        b.vx -= vn * nx;
        b.vz -= vn * nz;
      }
    } else if (kind === K_TRUNK) {
      const t = w.trunks[i];
      if (t.y1 <= feet || t.y0 >= head) return;
      circle(b, t.x, t.z, t.r + R);
    } else {
      const r = w.rocks[i];
      const d = Math.hypot(b.x - r.x, b.z - r.z);
      if (d >= r.r + R) return;
      if (rockTop(r.r, r.y, Math.max(0, d - R * 0.5)) <= feet) return;
      if (r.y - r.r >= head) return;
      circle(b, r.x, r.z, r.r * 0.9 + R);
    }
  });
}

function circle(b: Body, cx: number, cz: number, rr: number) {
  const dx = b.x - cx;
  const dz = b.z - cz;
  const d = Math.hypot(dx, dz);
  if (d >= rr) return;
  const nx = d > 1e-6 ? dx / d : 1;
  const nz = d > 1e-6 ? dz / d : 0;
  b.x = cx + nx * rr;
  b.z = cz + nz * rr;
  const vn = b.vx * nx + b.vz * nz;
  if (vn < 0) {
    b.vx -= vn * nx;
    b.vz -= vn * nz;
  }
}

const tmpN = { x: 0, y: 1, z: 0 };

/** Moves a body by its velocity for dt seconds: gravity, ground, slopes, water and every collider. */
export function stepBody(w: World, b: Body, dt: number, bound = w.arena) {
  const t = w.terrain;
  const speed = Math.hypot(b.vx, b.vy, b.vz);
  const n = Math.min(10, Math.max(1, Math.ceil((speed * dt) / 0.12)));
  const h = dt / n;
  for (let s = 0; s < n; s++) {
    const wasGround = b.onGround;
    b.vy -= GRAVITY * h;
    b.x += b.vx * h;
    b.z += b.vz * h;
    pushOut(w, b);
    if (b.x < -bound) (b.x = -bound), b.vx < 0 && (b.vx = 0);
    if (b.x > bound) (b.x = bound), b.vx > 0 && (b.vx = 0);
    if (b.z < -bound) (b.z = -bound), b.vz < 0 && (b.vz = 0);
    if (b.z > bound) (b.z = bound), b.vz > 0 && (b.vz = 0);
    b.y += b.vy * h;
    const g = groundAt(w, b.x, b.z, Math.max(b.y, b.y - b.vy * h));
    const terrainFloor = floorAt(t, b.x, b.z);
    b.swim = t.hasWater && !t.ice && terrainFloor < t.water - SWIM_DEPTH && g <= terrainFloor + 0.01;
    if (b.swim) {
      const surf = t.water - SWIM_DEPTH - 0.1;
      if (b.y <= surf) {
        b.y = surf;
        if (b.vy < 0) b.vy = 0;
        b.onGround = true;
      } else b.onGround = b.y - surf < 0.05;
      continue;
    }
    if (b.y <= g) {
      b.y = g;
      if (b.vy < 0) b.vy = 0;
      b.onGround = true;
    } else if (wasGround && b.vy <= 0 && b.y - g < 0.45) {
      // keep to the ground walking downhill or down a step
      b.y = g;
      b.vy = 0;
      b.onGround = true;
    } else b.onGround = false;
    // too steep to stand on: slide down it
    if (b.onGround && g <= terrainFloor + 0.01) {
      normalAt(t, b.x, b.z, tmpN);
      if (tmpN.y < 0.62) {
        b.onGround = false;
        b.vx += tmpN.x * 30 * h;
        b.vz += tmpN.z * 30 * h;
        b.vy = Math.min(b.vy, -2);
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// rays

export type HitKind = 'none' | 'terrain' | 'water' | 'box' | 'trunk' | 'rock';
export type Hit = { t: number; kind: HitKind; nx: number; ny: number; nz: number; s: Surface; i: number };
export const newHit = (): Hit => ({ t: 0, kind: 'none', nx: 0, ny: 1, nz: 0, s: 'dirt', i: -1 });

/** Slab test along one axis; narrows [lo, hi] on `span` and returns false once it is empty. */
const span = { t0: 0, t1: 0, axis: -1, sign: 0 };
function slab(o: number, d: number, a: number, b: number, axis: number) {
  if (Math.abs(d) < 1e-9) return o >= a && o <= b;
  const inv = 1 / d;
  let ta = (a - o) * inv;
  let tb = (b - o) * inv;
  let s = -1;
  if (ta > tb) {
    const tmp = ta;
    ta = tb;
    tb = tmp;
    s = 1;
  }
  if (ta > span.t0) {
    span.t0 = ta;
    span.axis = axis;
    span.sign = s;
  }
  if (tb < span.t1) span.t1 = tb;
  return span.t0 <= span.t1;
}

function rayBox(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, b: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }, max: number, out: Hit) {
  span.t0 = 0;
  span.t1 = max;
  span.axis = -1;
  span.sign = 0;
  if (!slab(ox, dx, b.x0, b.x1, 0) || !slab(oy, dy, b.y0, b.y1, 1) || !slab(oz, dz, b.z0, b.z1, 2)) return false;
  if (span.axis < 0) return false; // started inside
  out.t = span.t0;
  out.nx = span.axis === 0 ? span.sign : 0;
  out.ny = span.axis === 1 ? span.sign : 0;
  out.nz = span.axis === 2 ? span.sign : 0;
  return true;
}

/** Ray against an upright cylinder. */
function rayCyl(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cz: number, r: number, y0: number, y1: number, max: number, out: Hit) {
  const px = ox - cx;
  const pz = oz - cz;
  const a = dx * dx + dz * dz;
  if (a < 1e-10) return false;
  const b = px * dx + pz * dz;
  const c = px * px + pz * pz - r * r;
  const disc = b * b - a * c;
  if (disc < 0) return false;
  const t = (-b - Math.sqrt(disc)) / a;
  if (t < 0 || t > max) return false;
  const y = oy + dy * t;
  if (y < y0 || y > y1) return false;
  out.t = t;
  out.nx = (px + dx * t) / r;
  out.ny = 0;
  out.nz = (pz + dz * t) / r;
  return true;
}

export function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number, max: number) {
  const px = ox - cx;
  const py = oy - cy;
  const pz = oz - cz;
  const b = px * dx + py * dy + pz * dz;
  const c = px * px + py * py + pz * pz - r * r;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= max ? t : -1;
}

const scratch = newHit();

/** First thing a ray hits within max meters (direction must be unit length). */
export function rayWorld(w: World, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number, out: Hit = newHit()): Hit {
  out.kind = 'none';
  out.t = max;
  out.i = -1;
  const g = w.grid;
  const st = stamps(w);
  const q = st.q;
  const test = (c: number) => {
    for (let k = g.start[c]; k < g.start[c + 1]; k++) {
      const id = g.items[k];
      const kind = (id / KIND) | 0;
      const idx = id - kind * KIND;
      const arr = kind === K_BOX ? st.box : kind === K_TRUNK ? st.trunk : st.rock;
      if (arr[idx] === q) continue;
      arr[idx] = q;
      if (kind === K_BOX) {
        const b = w.boxes[idx];
        if (rayBox(ox, oy, oz, dx, dy, dz, b, out.t, scratch) && scratch.t < out.t) {
          out.t = scratch.t;
          out.kind = 'box';
          out.nx = scratch.nx;
          out.ny = scratch.ny;
          out.nz = scratch.nz;
          out.s = b.s;
          out.i = idx;
        }
      } else if (kind === K_TRUNK) {
        const tr = w.trunks[idx];
        if (rayCyl(ox, oy, oz, dx, dy, dz, tr.x, tr.z, tr.r, tr.y0, tr.y1, out.t, scratch) && scratch.t < out.t) {
          out.t = scratch.t;
          out.kind = 'trunk';
          out.nx = scratch.nx;
          out.ny = 0;
          out.nz = scratch.nz;
          out.s = 'wood';
          out.i = idx;
        }
      } else {
        const r = w.rocks[idx];
        const tt = raySphere(ox, oy, oz, dx, dy, dz, r.x, r.y, r.z, r.r, out.t);
        if (tt >= 0 && tt < out.t) {
          out.t = tt;
          out.kind = 'rock';
          const hx = ox + dx * tt - r.x;
          const hy = oy + dy * tt - r.y;
          const hz = oz + dz * tt - r.z;
          const l = Math.hypot(hx, hy, hz) || 1;
          out.nx = hx / l;
          out.ny = hy / l;
          out.nz = hz / l;
          out.s = 'stone';
          out.i = idx;
        }
      }
    }
  };
  // walk the grid cells under the ray (2D DDA), stopping once a cell starts beyond the best hit
  const size = g.size;
  let ci = Math.floor((ox + T_HALF) / size);
  let cj = Math.floor((oz + T_HALF) / size);
  const hd = Math.hypot(dx, dz);
  if (hd < 1e-6) {
    if (ci >= 0 && cj >= 0 && ci < g.n && cj < g.n) test(cj * g.n + ci);
  } else {
    const si = dx > 0 ? 1 : -1;
    const sj = dz > 0 ? 1 : -1;
    const tdi = Math.abs(dx) > 1e-9 ? size / Math.abs(dx) : Infinity;
    const tdj = Math.abs(dz) > 1e-9 ? size / Math.abs(dz) : Infinity;
    let tmi = Math.abs(dx) > 1e-9 ? ((ci + (dx > 0 ? 1 : 0)) * size - T_HALF - ox) / dx : Infinity;
    let tmj = Math.abs(dz) > 1e-9 ? ((cj + (dz > 0 ? 1 : 0)) * size - T_HALF - oz) / dz : Infinity;
    let tEnter = 0;
    for (let guard = 0; guard < 600; guard++) {
      if (ci >= 0 && cj >= 0 && ci < g.n && cj < g.n) test(cj * g.n + ci);
      else if ((ci < 0 && si < 0) || (cj < 0 && sj < 0) || (ci >= g.n && si > 0) || (cj >= g.n && sj > 0)) break;
      if (tmi < tmj) {
        tEnter = tmi;
        tmi += tdi;
        ci += si;
      } else {
        tEnter = tmj;
        tmj += tdj;
        cj += sj;
      }
      if (tEnter > out.t || tEnter > max) break;
    }
  }
  const tt = rayTerrain(w.terrain, ox, oy, oz, dx, dy, dz, out.t);
  if (tt >= 0 && tt < out.t) {
    out.t = tt;
    out.kind = 'terrain';
    normalAt(w.terrain, ox + dx * tt, oz + dz * tt, tmpN);
    out.nx = tmpN.x;
    out.ny = tmpN.y;
    out.nz = tmpN.z;
    const y = oy + dy * tt;
    const def = w.def;
    out.s = def.ground.snowCover > 0.5 ? 'snow' : def.ground.sandAmt > 0.3 || (w.terrain.hasWater && y < w.terrain.water + def.ground.sandLine) ? 'sand' : 'dirt';
    out.i = -1;
  }
  const t = w.terrain;
  if (t.hasWater && dy < 0 && oy > t.water) {
    const tw = (t.water - oy) / dy;
    if (tw < out.t) {
      out.t = tw;
      out.kind = 'water';
      out.nx = 0;
      out.ny = 1;
      out.nz = 0;
      out.s = t.ice ? 'snow' : 'water';
      out.i = -1;
    }
  }
  return out;
}

const losHit = newHit();
/** True when nothing solid lies between two points. */
export function clearLine(w: World, ax: number, ay: number, az: number, bx: number, by: number, bz: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const dz = bz - az;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-4) return true;
  rayWorld(w, ax, ay, az, dx / d, dy / d, dz / d, d - 0.05, losHit);
  return losHit.kind === 'none';
}

/** True when a body could stand at (x, z) near height y without being inside something. */
export function blockedAt(w: World, x: number, z: number, y: number, r = RADIUS) {
  let hit = false;
  forEachNear(w, x - r, z - r, x + r, z + r, (kind, i) => {
    if (hit) return;
    if (kind === K_BOX) {
      const o = w.boxes[i];
      if (o.y1 <= y + STEP_UP || o.y0 >= y + STAND_H) return;
      const cx = Math.min(o.x1, Math.max(o.x0, x));
      const cz = Math.min(o.z1, Math.max(o.z0, z));
      if ((x - cx) ** 2 + (z - cz) ** 2 < r * r) hit = true;
    } else if (kind === K_TRUNK) {
      const t = w.trunks[i];
      if (t.y1 > y + STEP_UP && Math.hypot(x - t.x, z - t.z) < t.r + r) hit = true;
    } else {
      const k = w.rocks[i];
      const d = Math.hypot(x - k.x, z - k.z);
      if (d < k.r * 0.9 + r && rockTop(k.r, k.y, Math.max(0, d - r)) > y + STEP_UP) hit = true;
    }
  });
  return hit;
}
