// The Cathedral: lancets of broken coloured glass set into the core over every ledge, round windows on the open wall,
// pilasters and string courses up the shaft, cornices and corbels under the ledges, candles in iron sconces beside
// the glass and votives along the rims, and tinted light pooling on the stone below each window.
import type { Dresser, Frame } from '../decor';
import { arch, geometryOf, hexToRgb, mixHex, quad, sector, shade, tones, tri, wedge, type RGB } from '../dress';
import type { T } from '../gl';
import { flames, glows, Instancer } from '../instance';
import { angDiff, R_CORE, R_REF } from '../level';

const TAU = Math.PI * 2;
/** the glass hexes, warm first so a window tends to a key colour */
const GLASS = ['#d33b3b', '#2f5fd8', '#e2b437', '#3fae6a', '#8a3fd1'];
const WARM = '#ffcf6a';

type Window = { a: number; y0: number; y1: number; half: number };

export const dressCathedral: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, statics, coreR, zone } = d;
  const st = tones(d.palette, 'stone');
  const pil = hexToRgb(mixHex(d.palette.core, d.palette.stone[0], 0.3));
  const pilSide = shade(pil, 0.8);
  const yLo = zone.from;
  const yHi = zone.to;

  // a point on the core at an angle, a height and that much proud of the wall
  const P = (a: number, y: number, out = 0): number[] => {
    const r = coreR(y) + out;
    return [Math.cos(a) * r, y, Math.sin(a) * r];
  };

  // where a piece on the core would sit in a soul's way: any ledge's angular reach, from its underside to 2.3 m over its top
  const bandFree = (a: number, y0: number, y1: number, halfW = 0) => {
    for (const p of d.level.platforms) {
      if (p.kind === 'floor') continue;
      if (y1 < p.y - p.h - 0.1 || y0 > p.y + 2.3) continue;
      const ext = p.span + (p.kind === 'swing' ? p.amp : 0) + halfW / R_CORE + 0.08;
      if (Math.abs(angDiff(a, p.a)) < ext) return false;
    }
    return true;
  };

  // ---------------------------------------------------------------------------------------------------------------
  // the pools of light and the candles, all instanced

  const pools = glows(d, '#ffffff', 0.3, 128);
  const fire = flames(d, 160);
  const rods = new Instancer(THREE, geo.rod, mats.bone, 160);
  const boxes = new Instancer(THREE, geo.box, mats.iron, 48);
  group.add(rods.mesh, boxes.mesh);
  const BONE: RGB = [0.85, 0.81, 0.72];
  const IRON: RGB = [0.17, 0.18, 0.21];

  // a pool of tinted light lying on stone, long axis radial
  const pool = (a: number, r: number, y: number, long: number, short: number, colour: RGB) => {
    pools.push(Math.cos(a) * r, y, Math.sin(a) * r, [-Math.PI / 2, 0, -a], [long, short, 1], colour);
  };
  // a candle standing on something at (x, y, z)
  const candle = (x: number, y: number, z: number, h: number, w: number, lean = 0, scale = 0.55) => {
    rods.push(x, y + h / 2, z, [lean, 0, lean * 0.6], [w, h, w], BONE);
    fire.add(x, y + h, z, scale);
  };
  // an iron bracket out from the wall with a tray and a candle on it, beside a window
  const sconce = (a: number, y: number) => {
    const arm = P(a, y, 0.16);
    boxes.push(arm[0], arm[1], arm[2], [0, -a, 0], [0.34, 0.05, 0.05]);
    const tray = P(a, y + 0.04, 0.3);
    rods.push(tray[0], tray[1], tray[2], [0, 0, 0], [0.13, 0.03, 0.13], IRON);
    const h = 0.22 + rng() * 0.14;
    candle(tray[0], tray[1] + 0.015, tray[2], h, 0.045, 0, 0.7);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // the glass: one unlit vertex coloured mesh for the panes, another for the beams of light they throw

  const glass = tri();
  const beams = tri();
  const windows: Window[] = [];
  const pieceColour = (key: RGB): RGB => {
    const other = rng() < 0.62 ? key : hexToRgb(GLASS[Math.floor(rng() * GLASS.length)]);
    return shade(other, 0.7 + rng() * 0.4);
  };
  // a flat polygon of glass fanned from its first corner, pulled in a little so dark leading shows between panes
  const pane = (pts: number[][], colour: RGB, toA: (u: number, y: number) => number[]) => {
    let cu = 0;
    let cy = 0;
    for (const q of pts) {
      cu += q[0] / pts.length;
      cy += q[1] / pts.length;
    }
    const inset = 0.022;
    const p3 = pts.map(([u, y]) => {
      const du = cu - u;
      const dy = cy - y;
      const l = Math.hypot(du, dy) || 1;
      return toA(u + (du / l) * inset, y + (dy / l) * inset);
    });
    for (let i = 1; i < p3.length - 1; i++) {
      for (const v of [p3[0], p3[i], p3[i + 1]]) {
        glass.pos.push(v[0], v[1], v[2]);
        glass.nor.push(0, 1, 0);
        glass.col.push(colour[0], colour[1], colour[2]);
      }
    }
  };

  /** a lancet of broken glass with a stone surround: (a, ySill) is the middle of the sill, w wide and h to the apex */
  const lancet = (a: number, ySill: number, w: number, h: number, key: RGB, deep: boolean) => {
    const rG = coreR(ySill) + 0.05;
    const ha = w * 0.8;
    const hs = h - ha;
    const Rarc = (w * w * 0.25 + ha * ha) / w;
    const dArc = Rarc - w / 2;
    const prof = (u: number) => hs + Math.sqrt(Math.max(0, Rarc * Rarc - (Math.abs(u) + dArc) ** 2));
    const toA = (u: number, y: number) => [Math.cos(a + u / rG) * rG, ySill + y, Math.sin(a + u / rG) * rG];
    // three lights between two lead lines, three courses below the springing, each boundary a little off
    const us = [-w / 2, -w / 6 + (rng() - 0.5) * 0.1, w / 6 + (rng() - 0.5) * 0.1, w / 2];
    const ys: number[][] = [];
    for (let c = 0; c < 4; c++) ys.push([0, hs * (0.33 + (rng() - 0.5) * 0.12), hs * (0.66 + (rng() - 0.5) * 0.12), hs]);
    const pieces: number[][][] = [];
    for (let i = 0; i < 3; i++) {
      for (let k = 0; k < 3; k++) pieces.push([[us[i], ys[i][k]], [us[i + 1], ys[i + 1][k]], [us[i + 1], ys[i + 1][k + 1]], [us[i], ys[i][k + 1]]]);
      // the top light follows the arch
      const u0 = us[i];
      const u1 = us[i + 1];
      const top: number[][] = [[u0, hs], [u1, hs]];
      for (let s = 4; s >= 0; s--) {
        const u = u0 + ((u1 - u0) * s) / 4;
        top.push([u, prof(u)]);
      }
      pieces.push(top);
    }
    // one pane fallen out, two when the window is wide
    const gone = new Set<number>([Math.floor(rng() * pieces.length)]);
    if (w > 1 && rng() < 0.5) gone.add(Math.floor(rng() * pieces.length));
    pieces.forEach((pts, i) => {
      if (!gone.has(i)) pane(pts, pieceColour(key), toA);
    });
    // the surround: jambs and a sill kept flat against the wall, the pointed head deeper where no soul passes
    const rOut = coreR(ySill);
    const half = (w / 2 + 0.15) / rOut;
    const jw = 0.15 / rOut;
    for (const s of [-1, 1]) {
      const a0 = a + s * half;
      const a1 = a + s * (half - jw);
      sector(statics, Math.min(a0, a1), Math.max(a0, a1), R_CORE - 0.2, rOut + 0.09, ySill - 0.1, ySill + hs, st.top, st.side, { inner: false, segs: 1 });
    }
    sector(statics, a - half - 0.06 / rOut, a + half + 0.06 / rOut, R_CORE - 0.2, rOut + 0.1, ySill - 0.16, ySill - 0.02, st.lip, st.side, { inner: false, segs: 3 });
    const sec = deep ? 0.16 : 0.1;
    const feet = P(a, ySill + hs, deep ? 0.1 : 0.04);
    arch(statics, feet[0], feet[1], feet[2], -a - Math.PI / 2, w + 0.16, ha + 0.08, sec, 6, st.top);
    windows.push({ a, y0: ySill - 0.2, y1: ySill + h + 0.2, half: half + 0.05 / rOut });
    return rG;
  };

  /** a round window of glass wedges with a flat stone ring */
  const oculus = (a: number, y: number, rho: number, key: RGB) => {
    const rG = coreR(y) + 0.05;
    const toA = (u: number, yy: number) => [Math.cos(a + u / rG) * rG, y + yy, Math.sin(a + u / rG) * rG];
    const n = 8;
    const gone = Math.floor(rng() * n);
    const tilt = rng() * TAU;
    for (let i = 0; i < n; i++) {
      if (i === gone) continue;
      const t0 = tilt + (i * TAU) / n;
      const t1 = tilt + ((i + 1) * TAU) / n;
      const tm = (t0 + t1) / 2;
      pane([[0, 0], [Math.cos(t0) * rho, Math.sin(t0) * rho], [Math.cos(tm) * rho, Math.sin(tm) * rho], [Math.cos(t1) * rho, Math.sin(t1) * rho]], pieceColour(key), toA);
    }
    // the ring: a flat band of stone round the glass
    const rR = coreR(y) + 0.09;
    const ringAt = (t: number, rr: number) => [Math.cos(a + (Math.cos(t) * rr) / rR) * rR, y + Math.sin(t) * rr, Math.sin(a + (Math.cos(t) * rr) / rR) * rR];
    const back = (t: number, rr: number) => [Math.cos(a + (Math.cos(t) * rr) / rR) * (rR - 0.1), y + Math.sin(t) * rr, Math.sin(a + (Math.cos(t) * rr) / rR) * (rR - 0.1)];
    const segs = 12;
    for (let i = 0; i < segs; i++) {
      const t0 = (i * TAU) / segs;
      const t1 = ((i + 1) * TAU) / segs;
      // the face, then the outer rim so the ring has an edge
      quad(statics, ringAt(t0, rho + 0.02), ringAt(t0, rho + 0.14), ringAt(t1, rho + 0.14), ringAt(t1, rho + 0.02), st.top, 0.95);
      quad(statics, ringAt(t0, rho + 0.14), back(t0, rho + 0.14), back(t1, rho + 0.14), ringAt(t1, rho + 0.14), st.side, 0.85);
    }
    windows.push({ a, y0: y - rho - 0.2, y1: y + rho + 0.2, half: (rho + 0.2) / rR });
  };

  // a beam of tinted light from the sill of a window down to the ledge below it, and the pool it lands in
  const light = (a: number, ySill: number, w: number, rG: number, pY: number, r0: number, key: RGB) => {
    const rP = r0 + 1.15;
    pool(a, rP, pY + 0.015, 1.1, 0.75, shade(key, 0.7));
    if (d.lite) return;
    const top = shade(key, 0.9);
    const bot = shade(key, 0.15);
    const wa = (w / 2) / rG;
    const pa = (w / 2 + 0.4) / rP;
    const rb = r0 + 2.1;
    const A = [Math.cos(a - wa) * (rG + 0.02), ySill, Math.sin(a - wa) * (rG + 0.02)];
    const B = [Math.cos(a + wa) * (rG + 0.02), ySill, Math.sin(a + wa) * (rG + 0.02)];
    const C = [Math.cos(a + pa) * rb, pY + 0.03, Math.sin(a + pa) * rb];
    const D = [Math.cos(a - pa) * rb, pY + 0.03, Math.sin(a - pa) * rb];
    quad(beams, A, B, C, D, [top, top, bot, bot]);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // the ledges: a window over each, a cornice with corbels round the fixed ones, votives along the rims

  for (const p of d.platforms) {
    const width = p.span * 2 * R_REF;
    const fixed = p.kind === 'stone' || p.kind === 'checkpoint';
    const wide = width >= 4.8;
    const rMid = coreR(p.y);
    if (p.kind !== 'crumble') {
      // the glass: a tall lancet, flanked by two shorter ones over a wide ledge
      const key = hexToRgb(GLASS[Math.floor(rng() * GLASS.length)]);
      const ySill = p.y + 1.3;
      const deep = bandFree(p.a, p.y + 2.3, p.y + 4.3, 0.8);
      const rG = lancet(p.a, ySill, wide ? 1.2 : 1.0, wide ? 2.9 : 2.5, key, deep);
      light(p.a, ySill, wide ? 1.2 : 1.0, rG, p.y, p.r0, key);
      if (wide) {
        for (const s of [-1, 1]) {
          const sa = p.a + (s * 1.45) / rMid;
          const k2 = hexToRgb(GLASS[Math.floor(rng() * GLASS.length)]);
          lancet(sa, ySill + 0.1, 0.76, 2.0, k2, deep);
          light(sa, ySill + 0.1, 0.76, rG, p.y, p.r0, k2);
        }
      }
      // candles in sconces either side of the glass, above head height
      const off = (wide ? 2.25 : 0.95) / rMid;
      for (const s of [-1, 1]) {
        const sa = p.a + s * off;
        if (bandFree(sa, p.y + 2.5, p.y + 3.1, 0.3)) sconce(sa, p.y + 2.6);
      }
    }
    if (!fixed) continue;
    // a cornice overhanging the rim, corbels under it and a border of paving on top
    const a0 = p.a - p.span;
    const a1 = p.a + p.span;
    const yc = p.y - 0.22;
    sector(statics, a0, a1, p.r1 - 0.32, p.r1 + 0.16, yc, p.y + 0.03, st.lip, shade(st.side, 0.95), { inner: false, cornerShade: 0.85 });
    const n = Math.max(2, Math.round((p.span * 2 * p.r1) / 1.25));
    for (let i = 0; i <= n; i++) {
      const wa = a0 + ((a1 - a0) * i) / n + (i === 0 ? 0.18 / p.r1 : i === n ? -0.18 / p.r1 : 0);
      wedge(statics, wa, p.r1 - 0.3, p.r1 + 0.12, yc, 0.26, 0.42, st.dark);
    }
    // paving: alternating courses of stone across the walkable top, flat
    const pave = (i: number) => shade(st.top, i % 2 ? 0.93 : 1.02);
    sector(statics, a0 + 0.04 / p.r1, a1 - 0.04 / p.r1, p.r0 + 0.06, p.r1 - 0.36, p.y, p.y + 0.02, st.top, st.side, { inner: false, topOf: pave, segs: Math.max(3, Math.round((p.span * 2 * p.r1) / 0.55)) });
    // votives in a cluster at each end of the rim
    if (!d.lite) {
      for (const s of [-1, 1]) {
        const base = p.a + s * (p.span - 0.45 / p.r1);
        const k = 2 + Math.floor(rng() * 3);
        for (let i = 0; i < k; i++) {
          const ca = base - s * (i * 0.17 + rng() * 0.06) / p.r1;
          const cr = p.r1 - 0.08 + rng() * 0.14;
          candle(Math.cos(ca) * cr, p.y + 0.03, Math.sin(ca) * cr, 0.1 + rng() * 0.16, 0.04 + rng() * 0.02, (rng() - 0.5) * 0.08, 0.4);
        }
        pool(base - s * 0.2 / p.r1, p.r1 - 0.15, p.y + 0.045, 0.45, 0.4, shade(hexToRgb(WARM), 0.8));
      }
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the open wall: round windows where nothing passes, then the storey lines and the pilasters between the glass

  const inWindow = (a: number, y0: number, y1: number, half: number) => windows.some((w) => y1 > w.y0 && y0 < w.y1 && Math.abs(angDiff(a, w.a)) < w.half + half);
  const PIL = 8;
  const pilA = (i: number) => (i * TAU) / PIL + 0.21;
  const nearPil = (a: number, half: number) => {
    for (let i = 0; i < PIL; i++) if (Math.abs(angDiff(a, pilA(i))) < half + 0.16 / R_CORE) return true;
    return false;
  };
  let placed = 0;
  for (let tries = 0; tries < 160 && placed < (d.lite ? 5 : 9); tries++) {
    const a = rng() * TAU;
    const y = yLo + 2.2 + rng() * (yHi - yLo - 4.4);
    const rho = 0.36 + rng() * 0.16;
    const half = (rho + 0.25) / R_CORE;
    if (!bandFree(a, y - rho - 0.3, y + rho + 0.3, rho + 0.3) || inWindow(a, y - rho - 0.5, y + rho + 0.5, half) || nearPil(a, half)) continue;
    oculus(a, y, rho, hexToRgb(GLASS[Math.floor(rng() * GLASS.length)]));
    placed++;
  }

  // string courses: thin rings at the circle's foot, its head and two storeys between
  const course = (y: number, h: number, out: number) => sector(statics, 0, TAU, R_CORE - 0.2, coreR(y) + out, y, y + h, st.lip, shade(st.side, 0.9), { inner: false, segs: 64 });
  course(yLo + 0.1, 0.22, 0.09);
  course(yLo + 6.7, 0.14, 0.08);
  course(yLo + 13.3, 0.14, 0.08);
  course(yHi - 0.4, 0.26, 0.09);
  // pilasters: flat ribs up the wall that stop for the windows, with a capital under the top course where free
  for (let i = 0; i < PIL; i++) {
    const a = pilA(i);
    const hw = 0.13;
    const cuts = windows.filter((w) => Math.abs(angDiff(a, w.a)) < w.half + hw / R_CORE).sort((u, v) => u.y0 - v.y0);
    let y = yLo + 0.32;
    const top = yHi - 0.4;
    const rib = (y0: number, y1: number) => {
      if (y1 - y0 < 0.3) return;
      const r = coreR((y0 + y1) / 2);
      sector(statics, a - hw / r, a + hw / r, R_CORE - 0.2, r + 0.085, y0, y1, pil, pilSide, { inner: false, segs: 1 });
    };
    for (const w of cuts) {
      rib(y, Math.min(top, w.y0));
      y = Math.max(y, w.y1);
    }
    rib(y, top);
    if (y < top - 0.6 && bandFree(a, top - 0.5, top, 0.3)) {
      const r = coreR(top);
      sector(statics, a - (hw + 0.07) / r, a + (hw + 0.07) / r, R_CORE - 0.2, r + 0.22, top - 0.34, top, st.lip, pilSide, { inner: false, segs: 1, undercut: 0.1 });
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the meshes

  const glassMesh = new THREE.Mesh(d.track(geometryOf(THREE, glass)), d.basic('#ffffff', { vertexColors: true, side: THREE.DoubleSide }));
  group.add(glassMesh);
  let beamMat: T.MeshBasicMaterial | null = null;
  if (beams.pos.length) {
    beamMat = d.basic('#ffffff', { vertexColors: true, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    group.add(new THREE.Mesh(d.track(geometryOf(THREE, beams)), beamMat));
  }
  pools.finish();
  fire.finish();
  rods.finish();
  boxes.finish();

  // the light through the glass breathes a little
  d.animate((f: Frame) => {
    if (beamMat) beamMat.opacity = 0.15 + Math.sin(f.clock * 0.45) * 0.035;
  });
};
