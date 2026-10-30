// The heightfield: one square grid of heights per map, made from seeded noise. The render mesh uses the same grid and
// the same triangle split, so heightAt() matches what you see to the centimeter.
import { MAPS, type MapDef } from './maps.ts';
import { Noise2, clamp, lerp, mulberry32, smoothstep } from './noise.ts';

/** Vertices per side. */
export const T_RES = 513;
/** Meters per side. */
export const T_SIZE = 1024;
export const T_HALF = T_SIZE / 2;
/** Meters between vertices. */
export const CELL = T_SIZE / (T_RES - 1);
/** Half the side of the shaped land: past it the ground rises into mountains or falls away to sea. */
export const VISTA = 360;

export type Terrain = {
  h: Float32Array;
  /** Water line (very low when the map has none). */
  water: number;
  hasWater: boolean;
  ice: boolean;
  minH: number;
  maxH: number;
};

/** Smooth maximum: like Math.max, rounded over about sqrt(k) meters. */
const smax = (a: number, b: number, k: number) => (a + b + Math.sqrt((a - b) * (a - b) + k)) / 2;

/** 0 inside the shaped land, rising to 1 out at the edge of the terrain. */
function border(x: number, z: number) {
  const r = Math.pow(Math.pow(Math.abs(x), 6) + Math.pow(Math.abs(z), 6), 1 / 6);
  return smoothstep(VISTA - 10, VISTA + 130, r);
}

type HeightFn = (x: number, z: number) => number;

function valeFn(def: MapDef): HeightFn {
  const n = new Noise2(def.seed);
  const r = mulberry32(def.seed ^ 0x51);
  const water = def.water ?? 0;
  const lx = -150 + r() * 60;
  const lz = 90 + r() * 80;
  return (x, z) => {
    const hills = n.fbm(x / 280, z / 280, 5) * 17 + n.fbm(x / 105 + 50, z / 105, 4) * 6;
    const ridge = n.ridged(x / 430, z / 430, 4) * 30;
    let h = 9 + hills + ridge;
    const d = Math.hypot(x - lx, (z - lz) * 1.25) + n.fbm(x / 70, z / 70, 3) * 28;
    const lake = 1 - smoothstep(50, 125, d);
    h = smax(h, water + 2.2, 6);
    h = lerp(h, water - 5.5, lake);
    const b = border(x, z);
    h += b * b * (60 + n.ridged(x / 140, z / 140, 4) * 70);
    return h;
  };
}

function mesaFn(def: MapDef): HeightFn {
  const n = new Noise2(def.seed);
  const r = mulberry32(def.seed ^ 0x77);
  const ox = 60 + r() * 120;
  const oz = -200 + r() * 90;
  return (x, z) => {
    let h = 6 + n.fbm(x / 300, z / 300, 4) * 4;
    const dir = 0.6 * x + 0.8 * z;
    const dn = n.fbm(x / 210, z / 210, 3);
    const dune = Math.pow(1 - Math.abs(Math.sin(dir / 21 + dn * 3)), 2) * 3.4 * (0.45 + 0.55 * (n.fbm(x / 160 + 9, z / 160, 2) * 0.5 + 0.5));
    h += dune;
    const m = n.fbm(x / 230 + 100, z / 230, 4) + n.fbm(x / 38, z / 38, 3) * 0.035;
    h += smoothstep(0.17, 0.23, m) * 21 + smoothstep(0.4, 0.45, m) * 14;
    const cz = 120 * Math.sin(x / 170 + 1) + 40 * Math.sin(x / 63) - 30;
    const cd = Math.abs(z - cz) + n.fbm(x / 50, z / 50, 2) * 8;
    h -= (1 - smoothstep(8, 34, cd)) * 9;
    h = smax(h, 1.6, 2);
    const od = Math.hypot(x - ox, z - oz) + n.fbm(x / 30, z / 30, 2) * 6;
    h = lerp(h, -2.5, 1 - smoothstep(12, 38, od));
    const b = border(x, z);
    const cliff = 34 + n.ridged(x / 120, z / 120, 4) * 46;
    const tiers = Math.floor(cliff / 9) * 9 + smoothstep(0.6, 1, (cliff / 9) % 1) * 9;
    h += b * tiers;
    return h;
  };
}

function frostFn(def: MapDef): HeightFn {
  const n = new Noise2(def.seed);
  const r = mulberry32(def.seed ^ 0x33);
  const water = def.water ?? 0;
  const lx = -40 + r() * 80;
  const lz = -60 + r() * 60;
  return (x, z) => {
    const dc = Math.hypot(x, z) + n.fbm(x / 200, z / 200, 2) * 90;
    let h = 14 + n.fbm(x / 260, z / 260, 4) * 10 + n.fbm(x / 90, z / 90, 3) * 4;
    h += n.ridged(x / 170 + 40, z / 170, 4) * 26 * smoothstep(40, 200, dc);
    h += n.ridged(x / 230, z / 230, 5) * 90 * smoothstep(170, 430, dc);
    const d = Math.hypot((x - lx) * 1.1, z - lz) + n.fbm(x / 60, z / 60, 3) * 24;
    const lake = 1 - smoothstep(45, 105, d);
    h = smax(h, water + 1.6, 4);
    h = lerp(h, water - 3.5, lake);
    const b = border(x, z);
    h += b * (70 + n.ridged(x / 110, z / 110, 4) * 80);
    return h;
  };
}

function islesFn(def: MapDef): HeightFn {
  const n = new Noise2(def.seed);
  const r = mulberry32(def.seed ^ 0x99);
  const isl: { x: number; z: number; r: number }[] = [{ x: -15 + r() * 30, z: -15 + r() * 30, r: 205 }];
  const count = 6;
  const a0 = r() * Math.PI * 2;
  for (let i = 0; i < count; i++) {
    const a = a0 + (i / count) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const d = 290 + r() * 60;
    isl.push({ x: Math.cos(a) * d, z: Math.sin(a) * d, r: 60 + r() * 34 });
  }
  const bars: [number, number, number, number][] = [];
  for (let i = 1; i <= count; i++) {
    const a = isl[i];
    const b = isl[(i % count) + 1];
    bars.push([a.x, a.z, b.x, b.z]);
    if (i % 2 === 1) bars.push([a.x, a.z, isl[0].x, isl[0].z]);
  }
  const segDist = (x: number, z: number, s: [number, number, number, number]) => {
    const vx = s[2] - s[0];
    const vz = s[3] - s[1];
    const t = clamp(((x - s[0]) * vx + (z - s[1]) * vz) / (vx * vx + vz * vz), 0, 1);
    return Math.hypot(x - s[0] - vx * t, z - s[1] - vz * t);
  };
  return (x, z) => {
    let mask = 0;
    for (const i of isl) {
      const d = Math.hypot(x - i.x, z - i.z) / i.r;
      mask += Math.exp(-d * d * 1.6);
    }
    mask += n.fbm(x / 120, z / 120, 4) * 0.28;
    let h = (mask - 0.42) * 30 + n.fbm(x / 60, z / 60, 3) * 2.5 * clamp(mask, 0, 1);
    if (h > 0) h += n.ridged(x / 150, z / 150, 4) * 16 * smoothstep(0.6, 1.3, mask);
    h = Math.max(h, -13 + n.fbm(x / 80, z / 80, 2) * 3);
    let bar = 0;
    for (const s of bars) bar = Math.max(bar, 1 - smoothstep(5, 24, segDist(x, z, s) + n.fbm(x / 40, z / 40, 2) * 6));
    if (bar > 0) h = Math.max(h, lerp(h, -0.45, bar));
    const b = border(x, z);
    h = lerp(h, -22, b);
    return h;
  };
}

const FNS: Record<MapDef['id'], (def: MapDef) => HeightFn> = { vale: valeFn, mesa: mesaFn, frost: frostFn, isles: islesFn };

export function generateTerrain(def: MapDef): Terrain {
  const fn = FNS[def.id](def);
  const h = new Float32Array(T_RES * T_RES);
  let minH = Infinity;
  let maxH = -Infinity;
  for (let j = 0; j < T_RES; j++) {
    const z = -T_HALF + j * CELL;
    for (let i = 0; i < T_RES; i++) {
      const v = fn(-T_HALF + i * CELL, z);
      h[j * T_RES + i] = v;
      if (v < minH) minH = v;
      if (v > maxH) maxH = v;
    }
  }
  return { h, water: def.water ?? -1000, hasWater: def.water !== null, ice: def.ice, minH, maxH };
}

export const mapDef = (id: MapDef['id']) => MAPS[id];

/** Height of the ground at a point, on the same triangles the mesh draws. */
export function heightAt(t: Terrain, x: number, z: number) {
  let gx = (x + T_HALF) / CELL;
  let gz = (z + T_HALF) / CELL;
  gx = gx < 0 ? 0 : gx > T_RES - 1.001 ? T_RES - 1.001 : gx;
  gz = gz < 0 ? 0 : gz > T_RES - 1.001 ? T_RES - 1.001 : gz;
  const i = gx | 0;
  const j = gz | 0;
  const fx = gx - i;
  const fz = gz - j;
  const k = j * T_RES + i;
  const h = t.h;
  if (fx + fz <= 1) {
    const a = h[k];
    return a + (h[k + 1] - a) * fx + (h[k + T_RES] - a) * fz;
  }
  const d = h[k + T_RES + 1];
  return d + (h[k + T_RES] - d) * (1 - fx) + (h[k + 1] - d) * (1 - fz);
}

/** Smooth ground normal (y up) from central differences over a meter. */
export function normalAt(t: Terrain, x: number, z: number, out: { x: number; y: number; z: number } = { x: 0, y: 1, z: 0 }) {
  const e = CELL;
  const dx = heightAt(t, x + e, z) - heightAt(t, x - e, z);
  const dz = heightAt(t, x, z + e) - heightAt(t, x, z - e);
  const l = Math.hypot(dx, 2 * e, dz);
  out.x = -dx / l;
  out.y = (2 * e) / l;
  out.z = -dz / l;
  return out;
}

/** Ground or ice, whichever is higher, for things that walk. */
export function floorAt(t: Terrain, x: number, z: number) {
  const g = heightAt(t, x, z);
  return t.ice && g < t.water ? t.water : g;
}

/** Distance along a ray to the ground, or -1 when it misses within max. Direction must be unit length. */
export function rayTerrain(t: Terrain, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, max: number) {
  let prev = 0;
  let clear = oy - heightAt(t, ox, oz);
  if (clear < 0) return 0;
  let s = 0;
  while (s < max) {
    s = Math.min(max, s + clamp(clear * 0.35, 0.3, 10));
    const c = oy + dy * s - heightAt(t, ox + dx * s, oz + dz * s);
    if (c < 0) {
      let a = prev;
      let b = s;
      for (let k = 0; k < 7; k++) {
        const m = (a + b) / 2;
        if (oy + dy * m - heightAt(t, ox + dx * m, oz + dz * m) < 0) b = m;
        else a = m;
      }
      return b;
    }
    prev = s;
    clear = c;
    if (dy > 0 && oy + dy * s > t.maxH + 1) return -1;
  }
  return -1;
}

/**
 * Levels the ground under a rectangle (centered at x, z with half sizes hx, hz) to height y, blending back to the
 * natural ground over `margin` meters around it.
 */
export function flattenRect(t: Terrain, x: number, z: number, hx: number, hz: number, y: number, margin: number) {
  const i0 = Math.max(0, Math.floor((x - hx - margin + T_HALF) / CELL));
  const i1 = Math.min(T_RES - 1, Math.ceil((x + hx + margin + T_HALF) / CELL));
  const j0 = Math.max(0, Math.floor((z - hz - margin + T_HALF) / CELL));
  const j1 = Math.min(T_RES - 1, Math.ceil((z + hz + margin + T_HALF) / CELL));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const px = -T_HALF + i * CELL;
      const pz = -T_HALF + j * CELL;
      const ox = Math.max(0, Math.abs(px - x) - hx);
      const oz = Math.max(0, Math.abs(pz - z) - hz);
      const d = Math.hypot(ox, oz);
      const w = 1 - smoothstep(0, margin, d);
      if (w <= 0) continue;
      const k = j * T_RES + i;
      t.h[k] = lerp(t.h[k], y, w);
    }
}

/** Mean ground height over a rectangle. */
export function meanHeight(t: Terrain, x: number, z: number, hx: number, hz: number) {
  let s = 0;
  let n = 0;
  for (let a = -1; a <= 1; a += 0.5)
    for (let b = -1; b <= 1; b += 0.5) {
      s += heightAt(t, x + a * hx, z + b * hz);
      n++;
    }
  return s / n;
}

/** Slope at a point, 0 flat to 1 vertical. */
export function slopeAt(t: Terrain, x: number, z: number) {
  return 1 - normalAt(t, x, z).y;
}
