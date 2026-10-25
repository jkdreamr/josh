// The Pit: torchlit basalt over lava. Iron sconces with light pools and soot on the core, broken ledge rims on
// corbels, swaying chains with weights, skulls on spikes, vent grilles glowing from inside, iron bands round the
// shaft and a cracked, lava lit floor rim. Everything static is merged; the rest is six instanced draws.
import type { Dress, Dresser, Frame } from '../decor';
import { box, hexToRgb, sector, shade, tangentFrame, wedge, type RGB, type Tri } from '../dress';
import { Instancer, flames } from '../instance';
import { DIR, R_FLOOR, TAU, angDiff, type Platform } from '../level';

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const HOT: RGB = [1, 0.42, 0.16];
const IRON: RGB = [0.17, 0.18, 0.21];
const DARK_IRON: RGB = [0.1, 0.11, 0.13];
const SOOT: RGB = [0.07, 0.035, 0.03];
const BONE: RGB = hexToRgb('#cbbfa6');

/** A piece that hangs off a chain anchor and sways with it. */
type Hung = { inst: Instancer; idx: number; dy: number; ry: number; sx: number; sy: number; sz: number };
type Chain = { ax: number; ay: number; az: number; tx: number; tz: number; seed: number; pieces: Hung[] };

export const dressPit: Dresser = (d: Dress) => {
  const { THREE, geo, mats, group, rng, statics, coreR, palette } = d;
  const light = hexToRgb(palette.stone[0]);
  const dark = hexToRgb(palette.stone[1]);
  const platforms = d.platforms;
  const all: Platform[] = [d.level.floor, ...platforms];

  // nothing solid may sit on the core where a ledge meets it, from its top to head height
  const clear = (a: number, y0: number, y1: number) => {
    for (const q of all) {
      if (Math.abs(angDiff(a, q.a)) > q.span + 0.12) continue;
      if (y1 > q.y - q.h - 0.25 && y0 < q.y + 2.25) return false;
    }
    return true;
  };

  // a box on the core wall: `out` proud of the surface, `t` along the tangent, half sizes radial, up, tangential
  const wallBox = (out: Tri, a: number, y: number, o: number, t: number, sx: number, sy: number, sz: number, colour: RGB, topK = 1) => {
    const f = tangentFrame(a);
    const r = coreR(y) + o;
    box(out, f.out[0] * r + f.tan[0] * t, y, f.out[2] * r + f.tan[2] * t, sx, sy, sz, -a, shade(colour, topK), colour);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // the instanced pools: flames, one additive glow pool (wall light, vents, cracks), chain links, rings and balls

  const fire = flames(d, 64);
  const glowMat = d.basic('#ffffff', { transparent: true, opacity: 0.8, depthWrite: false, alphaMap: geo.soft });
  const glow = new Instancer(THREE, geo.disc, glowMat, 220);
  const links = new Instancer(THREE, geo.link, mats.chain, 420);
  const rings = new Instancer(THREE, geo.ring, mats.darkIron, 48);
  const balls = new Instancer(THREE, geo.ball, d.flat('#ffffff'), 160);
  group.add(glow.mesh, links.mesh, rings.mesh, balls.mesh);
  const rot: [number, number, number] = [0, 0, 0];
  const sc: [number, number, number] = [1, 1, 1];
  /** a light pool standing on the core wall, facing out */
  const wallGlow = (a: number, y: number, radius: number, colour: RGB, o = 0.02) => {
    const r = coreR(y) + o;
    rot[0] = 0;
    rot[1] = -a + Math.PI / 2;
    rot[2] = 0;
    glow.push(Math.cos(a) * r, y, Math.sin(a) * r, rot, radius, colour);
  };

  // ---------------------------------------------------------------------------------------------------------------
  // the pieces

  /** an iron sconce: strap and arm on the wall, a collar, a wooden stick, the flame, soot above and light around */
  const torch = (a: number, y: number) => {
    wallBox(statics, a, y + 0.02, 0.035, 0, 0.03, 0.17, 0.035, IRON, 0.9);
    wallBox(statics, a, y + 0.1, 0.22, 0, 0.21, 0.036, 0.036, IRON, 0.9);
    wallBox(statics, a, y + 0.14, 0.42, 0, 0.09, 0.05, 0.09, DARK_IRON, 0.9);
    wallBox(statics, a, y + 0.38, 0.42, 0, 0.04, 0.26, 0.04, hexToRgb('#4a2e1c'), 0.8);
    wallBox(statics, a, y + 1.85, 0.012, 0, 0.006, 0.55, 0.12, SOOT);
    const r = coreR(y) + 0.42;
    fire.add(Math.cos(a) * r, y + 0.6, Math.sin(a) * r, 1.25);
    // a wide faint pool and a hot centre behind the flame
    wallGlow(a, y + 0.8, 1.1, [1, 0.5, 0.2]);
    wallGlow(a, y + 0.85, 0.5, [1, 0.72, 0.35], 0.03);
  };

  /** a grille in the wall with heat behind it */
  const vent = (a: number, y: number) => {
    wallBox(statics, a, y, 0.006, 0, 0.004, 0.22, 0.3, [0.05, 0.02, 0.015]);
    wallGlow(a, y, 0.3, [1, 0.36, 0.1], 0.014);
    for (const t of [-0.15, 0, 0.15]) wallBox(statics, a, y, 0.035, t, 0.02, 0.2, 0.025, DARK_IRON);
    wallBox(statics, a, y + 0.21, 0.035, 0, 0.022, 0.025, 0.32, IRON, 0.9);
    wallBox(statics, a, y - 0.21, 0.035, 0, 0.022, 0.025, 0.32, IRON, 0.9);
  };

  /** a skull on an iron spike bracketed off the wall, facing out */
  const skullSpike = (a: number, y: number) => {
    wallBox(statics, a, y, 0.16, 0, 0.16, 0.022, 0.022, IRON, 0.9);
    wallBox(statics, a, y + 0.14, 0.3, 0, 0.018, 0.16, 0.018, IRON, 0.9);
    const f = tangentFrame(a);
    const r = coreR(y) + 0.3;
    const cx = f.out[0] * r;
    const cz = f.out[2] * r;
    const cy = y + 0.3;
    rot[0] = 0;
    rot[1] = -a;
    rot[2] = 0;
    sc[0] = 0.17;
    sc[1] = 0.14;
    sc[2] = 0.16;
    balls.push(cx, cy, cz, rot, sc, BONE);
    // the jaw, and two dark sockets looking out
    box(statics, cx + f.out[0] * 0.04, cy - 0.09, cz + f.out[2] * 0.04, 0.065, 0.03, 0.055, -a, BONE, shade(BONE, 0.85));
    for (const s of [-0.045, 0.045]) balls.push(cx + f.out[0] * 0.13 + f.tan[0] * s, cy + 0.01, cz + f.out[2] * 0.13 + f.tan[2] * s, rot, 0.035, SOOT);
  };

  /** a chain from an iron plate, links at 0.2 m pitch, a weight at the end; returns the record its sway needs */
  const chains: Chain[] = [];
  const hang = (a: number, top: number, len: number, kind: number) => {
    const f = tangentFrame(a);
    const o = 0.22;
    const r = coreR(top) + o;
    const ax = f.out[0] * r;
    const az = f.out[2] * r;
    wallBox(statics, a, top + 0.02, 0.03, 0, 0.03, 0.16, 0.16, IRON, 0.9);
    const pieces: Hung[] = [];
    rot[0] = 0;
    rot[2] = 0;
    // the eye on the plate
    rot[1] = -a;
    pieces.push({ inst: rings, idx: rings.push(ax, top - 0.02, az, rot, 0.13), dy: 0.02, ry: -a, sx: 0.13, sy: 0.13, sz: 0.13 });
    const n = Math.max(3, Math.round(len / 0.2));
    for (let i = 0; i < n; i++) {
      const dy = 0.15 + i * 0.2;
      const ry = -a + (i % 2) * Math.PI * 0.5;
      rot[1] = ry;
      pieces.push({ inst: links, idx: links.push(ax, top - dy, az, rot, 1), dy, ry, sx: 1, sy: 1, sz: 1 });
    }
    const end = 0.15 + n * 0.2;
    if (kind === 0) {
      // an iron ball
      rot[1] = -a;
      pieces.push({ inst: balls, idx: balls.push(ax, top - end - 0.14, az, rot, 0.17, DARK_IRON), dy: end + 0.14, ry: -a, sx: 0.17, sy: 0.17, sz: 0.17 });
    } else if (kind === 1) {
      // a cage: two crossed rings with a skull inside
      for (const ry of [-a, -a + Math.PI / 2]) {
        rot[1] = ry;
        pieces.push({ inst: rings, idx: rings.push(ax, top - end - 0.22, az, rot, 0.22), dy: end + 0.22, ry, sx: 0.22, sy: 0.22, sz: 0.22 });
      }
      rot[1] = -a;
      sc[0] = 0.12;
      sc[1] = 0.1;
      sc[2] = 0.11;
      pieces.push({ inst: balls, idx: balls.push(ax, top - end - 0.24, az, rot, sc, BONE), dy: end + 0.24, ry: -a, sx: 0.12, sy: 0.1, sz: 0.11 });
    } else {
      // a shackle
      rot[1] = -a + Math.PI / 2;
      pieces.push({ inst: rings, idx: rings.push(ax, top - end - 0.12, az, rot, 0.12), dy: end + 0.12, ry: -a + Math.PI / 2, sx: 0.12, sy: 0.12, sz: 0.12 });
    }
    chains.push({ ax, ay: top, az, tx: f.tan[0], tz: f.tan[2], seed: rng() * TAU, pieces });
  };

  // ---------------------------------------------------------------------------------------------------------------
  // the ledges: a rough undercut rim below the edge, lit from below, corbels against the core and an ash band

  const rimSide = mix(dark, HOT, 0.12);
  const rimBottom = mix(shade(dark, 0.7), HOT, 0.4);
  const ash = shade(light, 0.7);
  for (const p of platforms) {
    const a0 = p.a - p.span;
    const a1 = p.a + p.span;
    const y0 = p.y - p.h;
    const segs = Math.max(3, Math.ceil(((a1 - a0) * p.r1) / 0.55));
    sector(statics, a0, a1, p.r1 - 0.05, p.r1 + 0.16, y0 - 0.14, p.y - 0.035, shade(light, 0.9), rimSide, { inner: false, segs, rough: rng, undercut: 0.3, bottomBand: rimBottom });
    sector(statics, a0 + 0.015, a1 - 0.015, p.r0 + 0.02, p.r0 + 0.45, p.y, p.y + 0.012, ash, ash, { inner: false, segs: Math.max(2, segs >> 1) });
    const width = p.span * 2 * p.r1;
    const spots = width > 4.4 ? [-0.62, 0, 0.62] : [-0.6, 0.6];
    for (const k of spots) {
      const w = 0.42 + rng() * 0.16;
      const deep = Math.min(p.r1 - 0.4, p.r0 + 0.95 + rng() * 0.3);
      wedge(statics, p.a + p.span * k, coreR(y0) - 0.08, deep, y0 + 0.01, w, 0.8 + rng() * 0.3, shade(dark, 0.85));
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the wall: a torch over every ledge's leading edge (a pair on checkpoints), vents, skulls and chains between

  let chainTurn = 0;
  for (let i = 0; i < platforms.length; i++) {
    const p = platforms[i];
    const lead = p.a + DIR * p.span * 0.58;
    const trail = p.a - DIR * p.span * 0.55;
    const place = (fn: (a: number, y: number) => void, a: number, lift: number, h: number) => {
      for (const extra of [0, 0.35, 0.7]) {
        const y = p.y + lift + extra;
        if (clear(a, y - 0.05, y + h)) {
          fn(a, y);
          return true;
        }
      }
      return false;
    };
    if (p.kind === 'checkpoint') {
      place(torch, p.a + DIR * p.span * 0.7, 2.35, 1.2);
      place(torch, p.a - DIR * p.span * 0.7, 2.35, 1.2);
      place(skullSpike, p.a, 2.45, 0.55);
    } else {
      place(torch, lead, 2.3 + rng() * 0.2, 1.2);
      const r = rng();
      if (r < 0.4) place(vent, trail, 2.55, 0.3);
      else if (r < 0.7) place(skullSpike, trail, 2.5, 0.55);
    }
    // a chain over the ledge's back half every third ledge, hung high enough to clear heads
    if (i % 3 === 1) {
      const a = p.a - DIR * p.span * 0.15;
      const len = 1.6 + rng() * 1.2;
      const top = p.y + 2.5 + len + 0.5;
      if (clear(a, p.y + 2.3, top + 0.2)) hang(a, top, len, chainTurn++ % 3);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // iron bands round the shaft with rivets, and hot seams low on the wall

  for (const y of [6.2, 12.4, 18.6]) {
    const r0 = coreR(y) - 0.02;
    sector(statics, 0, TAU, r0, r0 + 0.075, y - 0.1, y + 0.1, shade(IRON, 0.8), IRON, { inner: false, segs: 48 });
    for (let k = 0; k < 14; k++) {
      const a = (k / 14) * TAU + (y % 1);
      wallBox(statics, a, y, 0.085, 0, 0.02, 0.035, 0.035, shade(IRON, 1.15));
    }
  }
  for (let k = 0; k < 10; k++) {
    const a = rng() * TAU;
    const y = 0.6 + rng() * 5;
    const r = coreR(y) + 0.015;
    rot[0] = 0;
    rot[1] = -a + Math.PI / 2;
    rot[2] = rng() * 0.6 - 0.3;
    sc[0] = 0.08 + rng() * 0.08;
    sc[1] = 0.7 + rng() * 0.9;
    sc[2] = 1;
    glow.push(Math.cos(a) * r, y, Math.sin(a) * r, rot, sc, [1, 0.4, 0.12]);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the floor: flagstone joints, glowing cracks toward the rim, a broken rim and a lava lit cliff

  const fy = d.level.floor.y;
  const joint = shade(dark, 0.55);
  for (let k = 0; k < 44; k++) {
    const a = (k / 44) * TAU + (rng() - 0.5) * 0.04;
    const rIn = 5.6 + rng() * 0.3;
    const rOut = 13.4 - rng() * 0.3;
    const rm = (rIn + rOut) / 2;
    box(statics, Math.cos(a) * rm, fy + 0.008, Math.sin(a) * rm, (rOut - rIn) / 2, 0.006, 0.025, -a, joint, joint);
  }
  for (const r of [5.6, 8.2, 10.8, 13.4]) sector(statics, 0, TAU, r - 0.025, r + 0.025, fy, fy + 0.009, joint, joint, { inner: false, segs: 64 });
  for (let k = 0; k < 14; k++) {
    const a = rng() * TAU;
    const r = 8.6 + rng() * 4.6;
    rot[0] = -Math.PI / 2;
    rot[1] = 0;
    rot[2] = rng() * TAU;
    sc[0] = 0.5 + rng() * 0.8;
    sc[1] = 0.05 + rng() * 0.04;
    sc[2] = 1;
    glow.push(Math.cos(a) * r, fy + 0.014, Math.sin(a) * r, rot, sc, [1, 0.42, 0.14]);
  }
  sector(statics, 0, TAU, R_FLOOR - 0.02, R_FLOOR + 0.26, fy - 0.42, fy - 0.03, shade(light, 0.85), rimSide, { inner: false, segs: 80, rough: rng, undercut: 0.18, bottomBand: rimBottom });
  sector(statics, 0, TAU, R_FLOOR + 0.02, R_FLOOR + 0.07, fy - 1.2, fy - 0.6, mix(dark, HOT, 0.55), mix(dark, HOT, 0.55), { inner: false, segs: 80 });
  for (let k = 0; k < 20; k++) {
    const a = (k / 20) * TAU + rng() * 0.1;
    const r = R_FLOOR + 0.1;
    rot[0] = 0;
    rot[1] = -a + Math.PI / 2;
    rot[2] = 0;
    glow.push(Math.cos(a) * r, fy - 0.85, Math.sin(a) * r, rot, 1.1, [1, 0.38, 0.12]);
  }

  fire.finish();
  glow.finish();
  links.finish();
  rings.finish();
  balls.finish();

  // ---------------------------------------------------------------------------------------------------------------
  // per frame: the chains sway a little, the heat behind the grilles and in the cracks breathes

  const swayRot: [number, number, number] = [0, 0, 0];
  const swaySc: [number, number, number] = [1, 1, 1];
  d.animate((f: Frame) => {
    const t = f.clock;
    for (const c of chains) {
      const th = Math.sin(t * 0.7 + c.seed) * 0.04 + Math.sin(t * 1.9 + c.seed * 2) * 0.008;
      const s = Math.sin(th);
      const k = Math.cos(th);
      for (const h of c.pieces) {
        swayRot[1] = h.ry;
        swaySc[0] = h.sx;
        swaySc[1] = h.sy;
        swaySc[2] = h.sz;
        h.inst.set(h.idx, c.ax + c.tx * h.dy * s, c.ay - h.dy * k, c.az + c.tz * h.dy * s, swayRot, swaySc);
      }
    }
    glowMat.opacity = 0.82 + Math.sin(t * 2.3) * 0.06 + Math.sin(t * 5.1) * 0.04;
  });
};
