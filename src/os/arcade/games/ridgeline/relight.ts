// A royale's dusk has a low sun, so the terrain's baked light (world.ts bakeLight) is baked again for it: how much of
// the sun each terrain vertex sees past the hills (channel 0) and the far shadows of trees, buildings and rocks
// (channel 2), done exactly as bakeLight does them (a test holds the two together: the world's own sun gives back the
// world's own light). The occlusion and bare ground channels stay as they are. A generator, so the renderer can spread
// the work over a few frames instead of stalling one.
import { clamp, smoothstep } from './noise.ts';
import { CELL, T_HALF, T_RES, heightAt } from './terrain.ts';
import { crownOf, type Rect3, type World } from './world.ts';

const toI = (x: number) => (x + T_HALF) / CELL;
/** Multiplies a channel of the baked light inside a box of texels by f(x, z) (1 leaves it). */
function stamp(out: Uint8Array, ch: number, x0: number, z0: number, x1: number, z1: number, f: (x: number, z: number) => number) {
  const i0 = Math.max(0, Math.floor(toI(x0)));
  const i1 = Math.min(T_RES - 1, Math.ceil(toI(x1)));
  const j0 = Math.max(0, Math.floor(toI(z0)));
  const j1 = Math.min(T_RES - 1, Math.ceil(toI(z1)));
  for (let j = j0; j <= j1; j++)
    for (let i = i0; i <= i1; i++) {
      const v = f(-T_HALF + i * CELL, -T_HALF + j * CELL);
      if (v >= 1) continue;
      const k = (j * T_RES + i) * 4 + ch;
      out[k] = Math.round(out[k] * clamp(v, 0, 1));
    }
}

/** The sun's direction flattened (dx, dz), its slope and its elevation. */
function sunParts(sun: [number, number, number]) {
  const [sx, sy, sz] = sun;
  const hl = Math.hypot(sx, sz) || 1;
  const tanEl = sy / hl;
  return { dx: sx / hl, dz: sz / hl, tanEl, el: Math.atan(tanEl) };
}

/** Channel 0: the highest horizon toward the sun against the sun's height, softened into a penumbra, then blurred. */
function* sunPass(w: World, sun: [number, number, number], out: Uint8Array): Generator<void, void> {
  const t = w.terrain;
  const { dx, dz, tanEl, el } = sunParts(sun);
  const pen = 0.055;
  for (let j = 0; j < T_RES; j++) {
    for (let i = 0; i < T_RES; i++) {
      const x = -T_HALF + i * CELL;
      const z = -T_HALF + j * CELL;
      const h0 = t.h[j * T_RES + i] + 0.3;
      let maxT = -1;
      for (let d = 5; d < 420; d *= 1.14) {
        const hh = heightAt(t, x + dx * d, z + dz * d);
        const tt = (hh - h0) / d;
        if (tt > maxT) maxT = tt;
        if (h0 + d * (maxT > tanEl ? maxT : tanEl) > t.maxH + 2) break;
      }
      const vis = smoothstep(-pen, pen, el - Math.atan(maxT));
      out[(j * T_RES + i) * 4] = Math.round(vis * 255);
    }
    yield;
  }
  const src = new Uint8Array(T_RES * T_RES);
  for (let k = 0; k < src.length; k++) src[k] = out[k * 4];
  for (let j = 1; j < T_RES - 1; j++) {
    for (let i = 1; i < T_RES - 1; i++) {
      let sum = 0;
      for (let b = -1; b <= 1; b++) for (let a = -1; a <= 1; a++) sum += src[(j + b) * T_RES + i + a] * (a === 0 && b === 0 ? 4 : a === 0 || b === 0 ? 2 : 1);
      out[(j * T_RES + i) * 4] = Math.round(sum / 16);
    }
    if ((j & 63) === 63) yield;
  }
}

/** Channel 2 (from 255 everywhere): trees, buildings and rocks throwing soft shadows away from the sun. */
function* shadePass(w: World, blocks: Rect3[], sun: [number, number, number], out: Uint8Array): Generator<void, void> {
  const { dx, dz, tanEl, el } = sunParts(sun);
  const lenK = Math.min(4, 1 / Math.max(0.2, Math.sin(el)));
  let n = 0;
  for (const tr of w.trees) {
    const [cr0, ch0] = crownOf(tr.kind);
    const cr = cr0 * tr.s;
    const off = (ch0 * tr.s) / Math.max(0.15, tanEl);
    const cx = tr.x - dx * Math.min(off, 60);
    const cz = tr.z - dz * Math.min(off, 60);
    const ra = cr * lenK;
    const ext = Math.max(ra, cr) + 1;
    const dark = tr.kind === 'shrub' || tr.kind === 'cactus' || tr.kind === 'deadtree' ? 0.35 : 0.62;
    stamp(out, 2, cx - ext, cz - ext, cx + ext, cz + ext, (x, z) => {
      const px = x - cx;
      const pz = z - cz;
      const along = (px * dx + pz * dz) / ra;
      const perp = (px * -dz + pz * dx) / cr;
      return 1 - dark * (1 - smoothstep(0.55, 1.05, Math.hypot(along, perp)));
    });
    if ((++n & 127) === 0) yield;
  }
  for (const b of blocks) {
    const hgt = b.y1 - b.y0;
    const off = Math.min(80, hgt / Math.max(0.15, tanEl));
    const ex0 = Math.min(b.x0, b.x0 - dx * off) - 1;
    const ex1 = Math.max(b.x1, b.x1 - dx * off) + 1;
    const ez0 = Math.min(b.z0, b.z0 - dz * off) - 1;
    const ez1 = Math.max(b.z1, b.z1 - dz * off) + 1;
    stamp(out, 2, ex0, ez0, ex1, ez1, (x, z) => {
      let best = 99;
      for (let s = 0; s <= 1; s += 0.125) {
        const px = x + dx * off * s;
        const pz = z + dz * off * s;
        const ox = Math.max(b.x0 - px, 0, px - b.x1);
        const oz = Math.max(b.z0 - pz, 0, pz - b.z1);
        best = Math.min(best, Math.hypot(ox, oz));
      }
      return 1 - 0.72 * (1 - smoothstep(0, 1.6, best));
    });
    if ((++n & 31) === 0) yield;
  }
  for (const rk of w.rockList) {
    const rr = rk.s;
    const off = (rr * 0.5) / Math.max(0.15, tanEl);
    const cx = rk.x - dx * off;
    const cz = rk.z - dz * off;
    const ext = rr * lenK + 1;
    stamp(out, 2, cx - ext, cz - ext, cx + ext, cz + ext, (x, z) => {
      const px = x - cx;
      const pz = z - cz;
      const along = (px * dx + pz * dz) / (rr * lenK * 0.8);
      const perp = (px * -dz + pz * dx) / rr;
      return 1 - 0.6 * (1 - smoothstep(0.5, 1, Math.hypot(along, perp)));
    });
    if ((++n & 127) === 0) yield;
  }
}

/** The world's baked light for another sun; returns a new array (the world's own stays as it is). */
export function* relight(w: World, sun: [number, number, number]): Generator<void, Uint8Array> {
  const out = w.light.slice();
  yield* sunPass(w, sun, out);
  for (let k = 2; k < out.length; k += 4) out[k] = 255;
  yield* shadePass(w, w.shade, sun, out);
  return out;
}
