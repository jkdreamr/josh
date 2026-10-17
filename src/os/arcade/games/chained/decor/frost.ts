// The Frozen Lake: glazed ice ledges with frost rims and cracks, snow capped rock, an icicle fringe under every
// ledge, dripping ice shelves and crystal clusters on the core, ice layers in the wall and a cold pulse of light.
import type { Dresser, Frame } from '../decor';
import { hash, hexToRgb, quad, sector, shade, tones, wedge } from '../dress';
import { glows, Instancer } from '../instance';

const TAU = Math.PI * 2;
const STATIC = new Set(['stone', 'ice', 'checkpoint', 'spring', 'goal']);

export const dressFrost: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, statics, coreR } = d;
  const ice = tones(d.palette, 'ice');
  const glaze = hexToRgb('#a6daf2');
  const glazeSide = hexToRgb('#4f88ad');
  const sheen = hexToRgb('#e4f6ff');
  const rime = hexToRgb('#f1f9ff');
  const crack = hexToRgb('#447ea3');
  const rock = hexToRgb('#93adbd');
  const rockSide = hexToRgb('#51697a');
  const snow = hexToRgb('#f3f9ff');
  const platforms = d.platforms.filter((p) => STATIC.has(p.kind));
  // only for sectors wider than the 0.14 m rim jitter: on a thin band the outer rim could cross the inner radius
  const rough = () => rng();

  // the one instanced cone for every icicle and crystal in the circle
  const cones = new Instancer(THREE, geo.cone, mats.ice, 520);
  const hang: [number, number, number] = [Math.PI, 0, 0];
  const icicle = (x: number, y: number, z: number, s: number) => {
    const w = 0.045 + s * 0.045;
    cones.push(x, y + 0.04 - s / 2, z, hang, [w, s, w]);
  };
  const up = new THREE.Vector3(0, 1, 0);
  const dir = new THREE.Vector3();
  // a crystal growing out of the core at an angle, tilted up a little, its base sunk in the wall
  const crystal = (a: number, y: number, len: number, rad: number, tilt: number) => {
    dir.set(Math.cos(a), tilt, Math.sin(a)).normalize();
    cones.q.setFromUnitVectors(up, dir);
    const r = coreR(y) - 0.05;
    const h = len / 2;
    cones.push(Math.cos(a) * r + dir.x * h, y + dir.y * h, Math.sin(a) * r + dir.z * h, cones.q, [rad, len, rad]);
  };

  // is a point on the core clear of every ledge's landing band
  const clear = (a: number, y: number) => {
    for (const p of d.platforms) {
      const da = Math.abs(((((a - p.a) % TAU) + TAU + Math.PI) % TAU) - Math.PI);
      if (da < p.span + 0.25 && y > p.y - p.h - 0.4 && y < p.y + 2.3 + p.amp) return false;
    }
    return true;
  };

  // ledges: ice gets a glaze, a frost rim and cracks; rock gets a snow cap and corbels; both get an icy collar
  for (const p of platforms) {
    const a0 = p.a - p.span;
    const a1 = p.a + p.span;
    const y0 = p.y - p.h;
    if (p.kind === 'ice') {
      sector(statics, a0 + 0.1 * p.span, a1 - 0.1 * p.span, p.r0 + 0.3, p.r1 - 0.35, p.y, p.y + 0.015, sheen, glaze, { inner: false });
      sector(statics, a0, a1, p.r1 - 0.16, p.r1 + 0.01, p.y, p.y + 0.02, rime, glazeSide, { inner: false });
      sector(statics, a0 - 0.01, a0 + 0.12 / p.r1, p.r0, p.r1, p.y, p.y + 0.02, rime, glazeSide, { inner: false });
      sector(statics, a1 - 0.12 / p.r1, a1 + 0.01, p.r0, p.r1, p.y, p.y + 0.02, rime, glazeSide, { inner: false });
      const n = 2 + Math.floor(rng() * 3);
      for (let i = 0; i < n; i++) {
        const ca = p.a + (rng() - 0.5) * p.span * 1.5;
        const cr = p.r0 + 0.5 + rng() * (p.r1 - p.r0 - 1);
        const yaw = rng() * Math.PI;
        const len = 0.5 + rng() * 0.9;
        const cx = Math.cos(ca) * cr;
        const cz = Math.sin(ca) * cr;
        const dx = Math.cos(yaw) * len * 0.5;
        const dz = Math.sin(yaw) * len * 0.5;
        const wx = -Math.sin(yaw) * 0.0125;
        const wz = Math.cos(yaw) * 0.0125;
        const yy = p.y + 0.022;
        quad(statics, [cx - dx - wx, yy, cz - dz - wz], [cx + dx - wx, yy, cz + dz - wz], [cx + dx + wx, yy, cz + dz + wz], [cx - dx + wx, yy, cz - dz + wz], crack);
      }
    } else {
      // snow cap with a stepped drift
      sector(statics, a0 + 0.06 * p.span, a1 - 0.06 * p.span, p.r0 + 0.12, p.r1 - 0.14, p.y, p.y + 0.07, snow, shade(snow, 0.82), { inner: false, rough, cornerShade: 0.9 });
      const off = (rng() - 0.5) * p.span * 0.6;
      sector(statics, p.a + off - p.span * 0.5, p.a + off + p.span * 0.5, p.r0 + 0.5, p.r1 - 0.8, p.y + 0.07, p.y + 0.095, snow, shade(snow, 0.85), { inner: false, rough });
      // frozen rock corbels under the slab
      const k = p.span * p.r1 > 1.6 ? 2 : 1;
      for (let i = 0; i < k; i++) {
        const wa = k === 1 ? p.a : p.a + (i - 0.5) * p.span * 1.1;
        wedge(statics, wa, p.r0 - 0.02, p.r1 - 0.45, y0 + 0.01, 0.5, 0.8 + rng() * 0.4, rockSide);
      }
      // a darker rock band under the snow so the slab reads as stone
      sector(statics, a0, a1, p.r1 - 0.02, p.r1 + 0.04, y0 + 0.1, p.y - 0.05, rock, rockSide, { inner: false });
    }
    // an ice collar frozen over the outer rim, leaning in under the slab
    sector(statics, a0, a1, p.r1 - 0.08, p.r1 + 0.1, y0 - 0.2, y0 + 0.25, ice.top, ice.side, { inner: false, undercut: 0.22 });
    // the icicle fringe: long and short along the outer rim, two under the inner edge, one under each end
    const n = 5 + Math.round(p.span * p.r1 * 1.5);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const ia = a0 + 0.05 + (a1 - a0 - 0.1) * t + (rng() - 0.5) * 0.06;
      const s = i % 2 === 0 ? 0.7 + rng() * 0.6 : 0.25 + rng() * 0.25;
      icicle(Math.cos(ia) * (p.r1 - 0.3), y0, Math.sin(ia) * (p.r1 - 0.3), s);
    }
    for (let i = 0; i < 2; i++) {
      const ia = p.a + (rng() - 0.5) * p.span * 1.2;
      icicle(Math.cos(ia) * (p.r0 + 0.35), y0, Math.sin(ia) * (p.r0 + 0.35), 0.3 + rng() * 0.4);
    }
    const rm = (p.r0 + p.r1) / 2;
    icicle(Math.cos(a0 + 0.04) * rm, y0, Math.sin(a0 + 0.04) * rm, 0.4 + rng() * 0.5);
    icicle(Math.cos(a1 - 0.04) * rm, y0, Math.sin(a1 - 0.04) * rm, 0.4 + rng() * 0.5);
  }

  // cold light: pale pools on the ice shelves, pulsing slowly
  const pools = glows(d, '#bfeaff', 0.28, 64);
  const poolAt: number[] = [];
  const poolRot: [number, number, number] = [-Math.PI / 2, 0, 0];

  // crystal clusters and ice shelves on the core between the ledges
  const cluster = (a: number, y: number) => {
    const k = 0.8 + rng() * 0.4;
    crystal(a, y, 1.1 * k, 0.13, 0.3 + (rng() - 0.5) * 0.5);
    crystal(a + 0.09, y + 0.08, 0.7 * k, 0.1, 0.6 + (rng() - 0.5) * 0.4);
    crystal(a - 0.07, y - 0.06, 0.45 * k, 0.07, 0.05 + (rng() - 0.5) * 0.4);
  };
  const shelf = (a: number, y: number) => {
    const half = 0.12 + rng() * 0.13;
    const r1 = coreR(y) + 0.4;
    sector(statics, a - half, a + half, coreR(y) - 0.08, r1, y - 0.08, y, hexToRgb('#d6edf9'), hexToRgb('#7fb0cc'), { inner: false, rough, undercut: 0.08 });
    // a cold pool of light on the shelf, breathing slowly
    const rad = 0.22 + rng() * 0.1;
    const i = pools.add(Math.cos(a) * (r1 - 0.26), y + 0.01, Math.sin(a) * (r1 - 0.26), 0, rad);
    if (i >= 0) poolAt.push(Math.cos(a) * (r1 - 0.26), y + 0.01, Math.sin(a) * (r1 - 0.26), rng() * 6, rad);
    const n = 3 + Math.floor(rng() * 3);
    for (let i = 0; i < n; i++) {
      const ia = a - half + 0.04 + (2 * half - 0.08) * (n === 1 ? 0.5 : i / (n - 1));
      icicle(Math.cos(ia) * (r1 - 0.14), y - 0.08, Math.sin(ia) * (r1 - 0.14), 0.3 + rng() * 0.6);
    }
  };
  for (const p of d.platforms) {
    if (rng() < 0.75) {
      const ca = p.a + (rng() - 0.5) * p.span * 1.5;
      const cy = p.y + 2.5 + rng() * 1.5;
      if (clear(ca, cy)) cluster(ca, cy);
    }
    const sa = p.a + p.span * (0.6 + rng() * 0.6) * (rng() < 0.5 ? 1 : -1);
    const sy = p.y + 2.6 + rng() * 1.5;
    if (clear(sa, sy)) (rng() < 0.5 ? shelf : cluster)(sa, sy);
  }

  // ice layers in the wall: thin pale rings at the circle's heights, each a little proud, with a frosted seam
  for (let i = 0; i < 7; i++) {
    const y = d.zone.from + 1.4 + i * 2.6 + hash(i, 3) * 0.8;
    const k = 0.9 + hash(i, 7) * 0.2;
    const r = coreR(y);
    sector(statics, 0, TAU, r - 0.02, r + 0.05 + hash(i, 11) * 0.03, y, y + 0.1 + hash(i, 5) * 0.08, shade(ice.top, k), shade(ice.side, k), { inner: false, segs: 48 });
  }

  cones.finish();
  pools.finish();
  group.add(cones.mesh);
  d.animate((f: Frame) => {
    for (let i = 0; i < poolAt.length / 5; i++) {
      const j = i * 5;
      const s = poolAt[j + 4] * (0.85 + Math.sin(f.clock * 1.3 + poolAt[j + 3]) * 0.15);
      pools.set(i, poolAt[j], poolAt[j + 1], poolAt[j + 2], poolRot, s);
    }
  });
};
