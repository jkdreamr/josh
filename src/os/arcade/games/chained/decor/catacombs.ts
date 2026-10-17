// The Catacombs: an ossuary wall of framed niches and skulls, heavy corbelled slabs with broken rims, mortar courses
// on the core, cold green grave candles, a lancet doorway behind the beacon and wisps that surface and dissolve.
import type { Dresser, Frame } from '../decor';
import { box, hash, quad, sector, shade, tones, wedge, type RGB } from '../dress';
import { Instancer, glows } from '../instance';
import { DIR, TAU, ZONES } from '../level';

const PI2 = Math.PI / 2;

export const dressCatacombs: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, statics, coreR } = d;
  const stone = tones(d.palette, 'stone');
  const bone = tones(d.palette, 'bone');
  const mortar: RGB = shade(stone.side, 0.55);
  const nicheBack: RGB = shade(stone.side, 0.3);
  const frameTop: RGB = shade(stone.top, 0.92);
  const frameSide: RGB = shade(stone.side, 1.15);
  const zone = ZONES[d.zi];

  // a block set on the core wall at angle a, w along the arc, h tall and `depth` proud, sunk a centimetre in
  const wallBlock = (a: number, y: number, w: number, h: number, depth: number, top: RGB, side: RGB) => {
    const r = coreR(y) + depth / 2 - 0.01;
    box(statics, Math.cos(a) * r, y, Math.sin(a) * r, w / 2, h / 2, depth / 2, PI2 - a, top, side);
  };
  // a flat patch on the wall, proud by `out`, facing outward
  const wallPatch = (a: number, y: number, w: number, h: number, out: number, colour: RGB) => {
    const r = coreR(y) + out;
    const ha = w / 2 / r;
    const segs = Math.max(1, Math.ceil(w / 0.3));
    for (let i = 0; i < segs; i++) {
      const a0 = a - ha + (2 * ha * i) / segs;
      const a1 = a - ha + (2 * ha * (i + 1)) / segs;
      const P = (aa: number, yy: number) => [Math.cos(aa) * r, yy, Math.sin(aa) * r];
      quad(statics, P(a0, y - h / 2), P(a0, y + h / 2), P(a1, y + h / 2), P(a1, y - h / 2), colour);
    }
  };

  // the shared pools: skulls, sockets, crossed bones, candles, green flames, light pools and wisps
  const skulls = new Instancer(THREE, geo.ball, mats.bone, 160);
  const sockets = new Instancer(THREE, geo.ball, mats.darkIron, 320);
  const bones = new Instancer(THREE, geo.rod, mats.bone, 160);
  const candles = new Instancer(THREE, geo.rod, d.flat('#e9e2cf'), 64);
  const flameOuter = new Instancer(THREE, geo.cone, d.basic('#8fe3a0'), 64);
  const flameInner = new Instancer(THREE, geo.cone, d.basic('#e6fff0'), 64);
  const pools = glows(d, d.palette.glow, 0.13, 96);
  const wispMat = d.basic('#bfeccb', { transparent: true, opacity: 0.55, depthWrite: false });
  const WISPS = d.lite ? 6 : 12;
  const wisps = new Instancer(THREE, geo.ball, wispMat, WISPS * 4);
  group.add(skulls.mesh, sockets.mesh, bones.mesh, candles.mesh, flameOuter.mesh, flameInner.mesh, wisps.mesh);

  const flameAt: number[] = [];
  const addFlame = (x: number, y: number, z: number, s: number) => {
    const i = flameOuter.push(x, y + 0.1 * s, z, [0, 0, 0], [0.07 * s, 0.2 * s, 0.07 * s]);
    flameInner.push(x, y + 0.07 * s, z, [0, 0, 0], [0.035 * s, 0.11 * s, 0.035 * s]);
    if (i >= 0) flameAt.push(x, y, z, s, rng() * 10);
  };

  // a skull set in the wall at angle a: `out` is how far its centre sits proud of the core, `rz` its depth radius
  const skullAt = (a: number, y: number, out: number, rz: number, tilt = 0) => {
    const r = coreR(y) + out;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    skulls.push(x, y, z, [0, PI2 - a, tilt], [0.13, 0.12, rz]);
    // eye sockets, a little forward and apart along the tangent
    const fr = coreR(y) + out + rz * 0.72;
    const ta = 0.045 / fr;
    for (const s of [-1, 1]) sockets.push(Math.cos(a + s * ta) * fr, y + 0.02, Math.sin(a + s * ta) * fr, [0, 0, 0], 0.028);
  };
  // crossed long bones under a skull, lying against the wall
  const crossedBones = (a: number, y: number, out: number) => {
    const r = coreR(y) + out;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    for (const s of [-1, 1]) bones.push(x, y, z, [0, PI2 - a, s * 0.6], [0.022, 0.36, 0.022]);
  };
  // a niche: a dark back, a lintel, a sill and two jambs, with a skull in it; `deep` niches stand out from the wall
  const niche = (a: number, y: number, deep: boolean, withBones: boolean) => {
    const w = 0.5;
    const h = deep ? 0.7 : 0.6;
    const depth = deep ? 0.16 : 0.09;
    wallPatch(a, y, w, h, 0.015, nicheBack);
    const jamb = 0.09;
    const ja = (w / 2 - jamb / 2) / coreR(y);
    // the flush row is older and dirtier than the deep one
    const ft = deep ? frameTop : shade(frameTop, 0.8);
    const fs = deep ? frameSide : shade(frameSide, 0.8);
    wallBlock(a, y + h / 2 + 0.05, w + 2 * jamb + 0.06, 0.1, depth, ft, fs);
    wallBlock(a, y - h / 2 - 0.04, w + 2 * jamb, 0.08, depth * 0.8, ft, fs);
    wallBlock(a - ja - jamb / coreR(y), y, jamb, h, depth * 0.85, ft, fs);
    wallBlock(a + ja + jamb / coreR(y), y, jamb, h, depth * 0.85, ft, fs);
    if (deep) {
      skullAt(a, y + 0.04, 0.08, 0.13, (rng() - 0.5) * 0.3);
      if (withBones) crossedBones(a, y - 0.2, 0.1);
    } else {
      // flush with the wall: half sunk, nothing more than a tenth of a metre proud
      skullAt(a, y + 0.02, -0.005, 0.1, (rng() - 0.5) * 0.2);
      if (withBones) crossedBones(a, y - 0.2, 0.03);
    }
  };
  // a candle on a lintel, with its flame and a glow standing against the wall and one pooled on the ledge below
  const candle = (a: number, y: number, out: number, ledgeY: number, ledgeR: number) => {
    const r = coreR(y) + out;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const hgt = 0.14 + rng() * 0.12;
    candles.push(x, y + hgt / 2, z, [0, 0, 0], [0.03, hgt, 0.03]);
    addFlame(x, y + hgt, z, 1.3 + rng() * 0.4);
    pools.add(Math.cos(a) * (coreR(y) + 0.03), y + hgt + 0.1, Math.sin(a) * (coreR(y) + 0.03), a, 0.42, false);
    pools.add(Math.cos(a) * (ledgeR + 0.5), ledgeY + 0.015, Math.sin(a) * (ledgeR + 0.5), 0, 1.1, true);
  };

  // mortar courses: thin dark rings around the core every 1.6 m through the circle
  for (let y = zone.from + 0.8; y < zone.to; y += 1.6) {
    const r = coreR(y);
    sector(statics, 0, TAU, r - 0.02, r + 0.03, y, y + 0.06, mortar, mortar, { inner: false, segs: 48 });
  }

  // the ledges
  let k = 0;
  for (const p of d.platforms) {
    k++;
    const a0 = p.a - p.span;
    const a1 = p.a + p.span;
    const y0 = p.y - p.h;
    const wide = p.r1 - p.r0 > 3.2 || p.span * 2 * p.r1 > 4.6;
    if (p.kind !== 'crumble') {
      // a ragged collar round the rim a few centimetres below the top, and a heavy rough underbelly
      sector(statics, a0 + 0.02, a1 - 0.02, p.r1 - 0.06, p.r1 + 0.2, y0 - 0.1, p.y - 0.035, shade(stone.top, 0.9), stone.side, { inner: false, rough: rng, undercut: 0.22 });
      sector(statics, a0 + 0.08, a1 - 0.08, p.r0 + 0.25, p.r1 - 0.55, y0 - 0.32, y0 + 0.01, stone.side, shade(stone.side, 0.95), { inner: false, rough: rng, undercut: 0.3, bottomBand: stone.bottom });
      // corbels carrying the slab from the wall
      const nCorb = wide ? 3 : 2;
      for (let i = 0; i < nCorb; i++) {
        const ca = a0 + ((i + 0.5) / nCorb) * (a1 - a0) + (rng() - 0.5) * 0.04;
        wedge(statics, ca, coreR(y0) - 0.08, p.r0 + 0.85 + rng() * 0.3, y0 + 0.01, 0.42 + rng() * 0.1, 0.55 + rng() * 0.2, stone.dark);
      }
      // a worn walkway along the wall and the odd dark stain, both flat
      sector(statics, a0 + 0.05, a1 - 0.05, p.r0 + 0.12, p.r0 + 0.95, p.y, p.y + 0.008, shade(stone.top, 0.86), stone.side, { inner: false, segs: 4 });
      if (rng() < 0.5) {
        const sa = p.a + (rng() - 0.5) * p.span;
        const sr = p.r0 + 1.1 + rng() * (p.r1 - p.r0 - 1.8);
        sector(statics, sa - 0.1, sa + 0.1, sr - 0.35, sr + 0.35, p.y, p.y + 0.006, shade(stone.top, 0.78), stone.side, { inner: false, segs: 3, rough: rng });
      }
      // bone slivers lying near the wall on the wide ledges
      if (wide) {
        const n = 3 + Math.floor(rng() * 3);
        for (let i = 0; i < n; i++) {
          const ba = p.a + (rng() - 0.5) * p.span * 1.4;
          const br = p.r0 + 0.35 + rng() * 0.6;
          box(statics, Math.cos(ba) * br, p.y + 0.015, Math.sin(ba) * br, 0.015, 0.015, 0.14 + rng() * 0.1, rng() * Math.PI, bone.top, bone.side);
        }
      }
    }

    // the ossuary rows on the wall above each ledge: a flush row inside the band and a deep row above it
    const arc = (a1 - a0) * coreR(p.y);
    const n = Math.max(1, Math.round(arc / 0.75));
    for (let i = 0; i < n; i++) {
      const na = a0 + ((i + 0.5) / n) * (a1 - a0);
      if (hash(k, i) < 0.8) niche(na, p.y + 1.25, false, hash(k, i + 7) < 0.5);
      const deepRow = hash(k, i + 13) < 0.85;
      if (deepRow) {
        const ya = p.y + 2.6 + (i % 2) * 0.12;
        niche(na, ya, true, hash(k, i + 29) < 0.6);
        if (hash(k, i + 41) < 0.5) candle(na, ya + 0.4, 0.08, p.y, p.r0);
      }
    }

    if (p.kind === 'checkpoint') {
      // the door of the circle: a dark lancet opening behind the beacon, stepped voussoirs and a row of skulls above
      const ya = p.y;
      wallPatch(p.a, ya + 1.0, 1.5, 2.0, 0.015, nicheBack);
      const steps = 7;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const w = 1.5 * (1 - t * t * 0.95) + 0.3;
        const hh = 1.9 + t * 0.6;
        const ha = (w / 2 + 0.11) / coreR(ya + hh);
        wallBlock(p.a - ha, ya + hh, 0.22, 0.14, 0.1, frameTop, frameSide);
        wallBlock(p.a + ha, ya + hh, 0.22, 0.14, 0.1, frameTop, frameSide);
      }
      wallBlock(p.a, ya + 2.54, 0.34, 0.14, 0.1, frameTop, frameSide);
      for (let i = 0; i < 2; i++) {
        const s = i === 0 ? -1 : 1;
        wallBlock(p.a + (s * 0.9) / coreR(ya), ya + 0.95, 0.2, 1.9, 0.1, frameTop, frameSide);
      }
      for (let i = -2; i <= 2; i++) skullAt(p.a + (i * 0.42) / coreR(ya), ya + 2.95, 0.14, 0.14, (hash(k, i) - 0.5) * 0.4);
      candle(p.a - 0.95 / coreR(ya), ya + 2.1, 0.12, p.y, p.r0);
      candle(p.a + 0.95 / coreR(ya), ya + 2.1, 0.12, p.y, p.r0);
    }
  }

  // wisps: a head and a short tail drifting along the arc at a soul's eye line, surfacing and dissolving
  const wisp: { a: number; r: number; y: number; dir: number; seed: number; i0: number }[] = [];
  for (let w = 0; w < WISPS; w++) {
    const p = d.platforms[Math.floor(rng() * d.platforms.length)];
    const i0 = wisps.push(0, -100, 0, [0, 0, 0], 0.1);
    wisps.push(0, -100, 0, [0, 0, 0], 0.07);
    wisps.push(0, -100, 0, [0, 0, 0], 0.05);
    wisps.push(0, -100, 0, [0, 0, 0], 0.03);
    wisp.push({ a: p.a + (rng() - 0.5) * p.span, r: p.r1 + 0.5 + rng() * 0.6, y: p.y + 0.8 + rng() * 0.6, dir: rng() < 0.5 ? DIR : -DIR, seed: rng() * 10, i0 });
  }
  skulls.finish();
  sockets.finish();
  bones.finish();
  candles.finish();
  flameOuter.finish();
  flameInner.finish();
  pools.finish();
  wisps.finish();

  const rot: [number, number, number] = [0, 0, 0];
  const sc: [number, number, number] = [1, 1, 1];
  const tailD = [0, 0.12, 0.22, 0.3];
  const tailS = [0.1, 0.07, 0.05, 0.03];
  d.animate((f: Frame) => {
    const t = f.clock;
    for (let i = 0; i < flameAt.length; i += 5) {
      const x = flameAt[i];
      const y = flameAt[i + 1];
      const z = flameAt[i + 2];
      const s = flameAt[i + 3];
      const seed = flameAt[i + 4];
      const kk = 1 + Math.sin(t * 11 + seed) * 0.18 + Math.sin(t * 23 + seed * 2) * 0.1;
      rot[2] = Math.sin(t * 7 + seed) * 0.12;
      const j = i / 5;
      sc[0] = 0.07 * s;
      sc[1] = 0.2 * s * kk;
      sc[2] = 0.07 * s;
      flameOuter.set(j, x, y + 0.1 * s * kk, z, rot, sc);
      sc[0] = 0.035 * s;
      sc[1] = 0.11 * s * kk;
      sc[2] = 0.035 * s;
      flameInner.set(j, x, y + 0.07 * s * kk, z, rot, sc);
    }
    rot[2] = 0;
    for (const w of wisp) {
      // a 7 s cycle: surface, drift, dissolve; scale carries the fade since the material is shared
      const ph = ((t * 0.9 + w.seed * 7) % 7) / 7;
      const vis = Math.sin(ph * Math.PI);
      const a = w.a + w.dir * 0.12 * ph * 7 * 0.5;
      const y = w.y + Math.sin(t * 1.3 + w.seed) * 0.25;
      for (let n = 0; n < 4; n++) {
        const aa = a - w.dir * (tailD[n] / w.r);
        const s = tailS[n] * vis;
        wisps.set(w.i0 + n, Math.cos(aa) * w.r, y - tailD[n] * 0.3, Math.sin(aa) * w.r, rot, s > 0.001 ? s : 0.001);
      }
    }
  });
};
