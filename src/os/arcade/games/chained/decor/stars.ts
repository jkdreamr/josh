// The Stars: floating stones with keels and pale rims, a fluted summit on the core, crystal shards riding the wind,
// and the gate at the top: a lancet arch on the rim, standing stones in the void, a bell and a column of light.
import type { Dresser, Frame } from '../decor';
import { arch, box, geometryOf, hexToRgb, quad, sector, shade, tones, tri, type RGB, type Tri } from '../dress';
import { Instancer, glows } from '../instance';
import { DIR, TAU, angDiff } from '../level';
import { windAt } from '../logic';

const PALE = hexToRgb('#cfd6ee');
const PALE_SIDE = hexToRgb('#7c86ad');
const TINTS = ['#aeb8e6', '#d2daf8', '#8f9ad0'];

/** a triangle a b c counter clockwise seen from outside, flat shaded */
function face3(out: Tri, a: number[], b: number[], c: number[], col: RGB, k = 1) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  let nx = uy * vz - uz * vy;
  let ny = uz * vx - ux * vz;
  let nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz) || 1;
  nx /= l;
  ny /= l;
  nz /= l;
  for (const p of [a, b, c]) {
    out.pos.push(p[0], p[1], p[2]);
    out.nor.push(nx, ny, nz);
    out.col.push(col[0] * k, col[1] * k, col[2] * k);
  }
}

/** a quad wound so its normal agrees with dir */
function face4(out: Tri, a: number[], b: number[], c: number[], d: number[], dir: number[], col: RGB, k = 1) {
  const n = [
    (b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]),
    (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]),
    (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]),
  ];
  if (n[0] * dir[0] + n[1] * dir[1] + n[2] * dir[2] < 0) quad(out, a, d, c, b, col, k);
  else quad(out, a, b, c, d, col, k);
}

/** a crystal: a hexagonal bipyramid a unit tall, the upper point the longer, 0.3 across */
function crystalGeo(): Tri {
  const t = tri();
  const top = [0, 0.62, 0];
  const bot = [0, -0.38, 0];
  const ring: number[][] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    ring.push([Math.cos(a) * 0.15, 0, Math.sin(a) * 0.15]);
  }
  const white: RGB = [1, 1, 1];
  for (let i = 0; i < 6; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % 6];
    face3(t, p, top, q, white, 1);
    face3(t, q, bot, p, white, 0.85);
  }
  return t;
}

/**
 * a standing stone: a slab at (x, z) facing angle a, hw wide along the tangent and ht thick, rising h from y0 and
 * tapering toward the top, which leans out by lean
 */
function slab(out: Tri, x: number, z: number, a: number, y0: number, h: number, hw: number, ht: number, lean: number, top: RGB, side: RGB) {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const P = (u: number, v: number, y: number) => [x + u * c - v * s, y, z + u * s + v * c];
  const b = [P(-ht, -hw, y0), P(ht, -hw, y0), P(ht, hw, y0), P(-ht, hw, y0)];
  const tw = hw * 0.72;
  const tt = ht * 0.8;
  const y1 = y0 + h;
  const t = [P(-tt + lean, -tw, y1), P(tt + lean, -tw, y1), P(tt + lean, tw, y1), P(-tt + lean, tw, y1)];
  face4(out, t[0], t[1], t[2], t[3], [0, 1, 0], top, 1);
  face4(out, b[0], b[1], b[2], b[3], [0, -1, 0], side, 0.55);
  face4(out, b[1], b[2], t[2], t[1], [c, 0, s], side, 1);
  face4(out, b[0], b[3], t[3], t[0], [-c, 0, -s], side, 0.8);
  face4(out, b[2], b[3], t[3], t[2], [-s, 0, c], side, 0.9);
  face4(out, b[0], b[1], t[1], t[0], [s, 0, -c], side, 0.7);
}

export const dressStars: Dresser = (d) => {
  const { THREE, geo, mats, group, rng, statics, lite } = d;
  const st = tones(d.palette, 'stone');
  const goal = d.level.goal;
  const belly = shade(st.side, 0.62);
  const ribCol = shade(st.side, 1.3);
  const crownCol = shade(st.top, 1.08);

  // whether a solid thing at this angle and height, reaching out to rOut, would sit where souls walk or stand
  const blocked = (a: number, y: number, rOut: number, skipGoal = false) =>
    d.level.platforms.some((p) => {
      if (p.kind === 'floor' || (skipGoal && p.kind === 'goal')) return false;
      return Math.abs(angDiff(a, p.a)) < p.span + 0.4 && y > p.y - p.h - 0.3 && y < p.y + 2.4 && rOut > p.r0 - 0.4;
    });

  // ---------------------------------------------------------------------------------------------------------------
  // the ledges: a cut keel under each floating stone, a pale rim along every jumpable edge, fragments trailing below
  for (const p of d.platforms) {
    const a0 = p.a - p.span;
    const a1 = p.a + p.span;
    const w = a1 - a0;
    const y0 = p.y - p.h;
    if (p.kind === 'goal') {
      // the summit is a capital on the pillar: two deep steps under it
      sector(statics, a0 + 0.1 * w, a1 - 0.1 * w, p.r0 + 0.3, p.r1 - 0.5, y0 - 0.6, y0, PALE_SIDE, PALE_SIDE, { inner: false, undercut: 0.18, bottomBand: shade(PALE_SIDE, 0.7) });
      sector(statics, a0 + 0.25 * w, a1 - 0.25 * w, p.r0 + 0.3, p.r1 - 1.3, y0 - 1.15, y0 - 0.6, shade(PALE_SIDE, 0.85), shade(PALE_SIDE, 0.85), { inner: false, undercut: 0.3, bottomBand: shade(PALE_SIDE, 0.62) });
      // a pale lip on the rim
      sector(statics, a0, a1, p.r1 - 0.16, p.r1, p.y, p.y + 0.05, shade(PALE, 1.08), PALE, { inner: false });
      continue;
    }
    // the keel: two inset steps, leaning in, so the stone reads as a hull from below
    sector(statics, a0 + 0.12 * w, a1 - 0.12 * w, p.r0 + 0.35, p.r1 - 0.45, y0 - 0.5, y0, st.side, shade(st.side, 0.9), { inner: true, undercut: 0.12, bottomBand: belly });
    sector(statics, a0 + 0.3 * w, a1 - 0.3 * w, p.r0 + 0.8, p.r1 - 1.0, y0 - 0.95, y0 - 0.5, st.side, shade(st.side, 0.75), { inner: true, undercut: 0.2, bottomBand: shade(belly, 0.85) });
    // the lip: a 4 cm pale band along the outer rim and across both ends
    const ea = 0.14 / ((p.r0 + p.r1) / 2);
    sector(statics, a0, a1, p.r1 - 0.14, p.r1, p.y, p.y + 0.04, st.lip, st.lip, { inner: false });
    sector(statics, a0, a0 + ea, p.r0, p.r1 - 0.14, p.y, p.y + 0.04, st.lip, st.lip, { inner: false, segs: 1 });
    sector(statics, a1 - ea, a1, p.r0, p.r1 - 0.14, p.y, p.y + 0.04, st.lip, st.lip, { inner: false, segs: 1 });
    if (p.kind === 'checkpoint') {
      // a raised walkway round the beacon
      sector(statics, a0 + 0.1 * w, a1 - 0.1 * w, p.r0 + 0.2, p.r0 + 1.4, p.y, p.y + 0.06, shade(st.top, 1.06), st.side, { inner: false });
    }
    // fragments: broken pieces of the stone drifting below it
    const n = 2 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const fa = a0 + 0.15 * w + rng() * 0.7 * w;
      const fr = p.r0 + 0.4 + rng() * (p.r1 - p.r0 - 0.8);
      const fy = y0 - 1.3 - rng() * 1.4;
      const hs = 0.1 + rng() * 0.18;
      if (blocked(fa, fy, fr + hs)) continue;
      box(statics, Math.cos(fa) * fr, fy, Math.sin(fa) * fr, hs, hs * (0.5 + rng() * 0.5), hs * (0.8 + rng() * 0.8), rng() * TAU, st.top, st.side);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the core: fourteen ribs up the summit, three cornice rings between them, a flared crown under the goal
  const RIBS = 14;
  const yLo = d.zone.from + 0.4;
  const yHi = goal.y - goal.h - 0.75;
  for (let i = 0; i < RIBS; i++) {
    const a = (i / RIBS) * TAU;
    const r = d.coreR((yLo + yHi) / 2) + 0.045;
    box(statics, Math.cos(a) * r, (yLo + yHi) / 2, Math.sin(a) * r, 0.045, (yHi - yLo) / 2, 0.09, -a, ribCol, ribCol);
  }
  for (const cy of [103.6, 109.8, 115.9]) {
    const cr = d.coreR(cy);
    // kept under 0.3 m proud so it never meets a soul hugging a ledge's inner edge
    sector(statics, 0, TAU, cr, cr + 0.26, cy, cy + 0.22, st.top, st.side, { inner: false, segs: 48, bottomBand: belly });
    sector(statics, 0, TAU, cr, cr + 0.14, cy - 0.12, cy, st.side, shade(st.side, 0.8), { inner: false, segs: 48, bottomBand: belly });
  }
  {
    // the crown: a flared ring under the goal, broken where the last ledge's walk runs through it
    const gy0 = goal.y - goal.h;
    const cr = d.coreR(gy0);
    const segs = 48;
    let run = -1;
    const flush = (end: number) => {
      if (run < 0) return;
      const a0 = (run / segs) * TAU;
      const a1 = (end / segs) * TAU;
      sector(statics, a0, a1, cr, cr + 1.05, gy0 - 0.7, gy0, crownCol, PALE_SIDE, { inner: false, segs: end - run, undercut: 0.55, bottomBand: shade(PALE_SIDE, 0.65) });
      run = -1;
    };
    for (let i = 0; i < segs; i++) {
      const a = ((i + 0.5) / segs) * TAU;
      if (blocked(a, gy0 - 0.35, cr + 1.05, true)) flush(i);
      else if (run < 0) run = i;
    }
    flush(segs);
    // a thin fillet above the crown, hugging the wall
    sector(statics, 0, TAU, cr, cr + 0.09, gy0 - 1.0, gy0 - 0.7, PALE_SIDE, shade(PALE_SIDE, 0.8), { inner: false, segs: 48 });
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the gate: a lancet arch standing on the goal's rim with the sky behind it, standing stones floating beyond the
  // edge, a bell under the apex and a column of light reaching up out of the circle
  const ga = goal.a;
  const gr = goal.r1 + 0.45;
  const gx = Math.cos(ga) * gr;
  const gz = Math.sin(ga) * gr;
  const yaw = Math.atan2(-Math.cos(ga), -Math.sin(ga));
  const ARCH_W = 4.0;
  const PIER_H = 2.3;
  const ARCH_H = 1.9;
  {
    const tx = -Math.sin(ga);
    const tz = Math.cos(ga);
    for (const side of [-1, 1]) {
      const px = gx + tx * side * (ARCH_W / 2);
      const pz = gz + tz * side * (ARCH_W / 2);
      // piers: a plinth, the shaft and a small capital
      box(statics, px, goal.y - 0.3, pz, 0.3, 0.3, 0.3, -ga, PALE, PALE_SIDE);
      box(statics, px, goal.y + PIER_H / 2, pz, 0.17, PIER_H / 2, 0.17, -ga, PALE, PALE_SIDE);
      box(statics, px, goal.y + PIER_H + 0.08, pz, 0.26, 0.08, 0.26, -ga, shade(PALE, 1.05), PALE_SIDE);
    }
    arch(statics, gx, goal.y + PIER_H + 0.16, gz, yaw, ARCH_W, ARCH_H, 0.3, 7, PALE);
    // the threshold: a hull under the gate, from under the rim out past the piers, well below the walk
    const tr = (goal.r1 - 0.3 + gr + 0.45) / 2;
    box(statics, Math.cos(ga) * tr, goal.y - 0.85, Math.sin(ga) * tr, (gr + 0.45 - (goal.r1 - 0.3)) / 2, 0.25, ARCH_W / 2 + 0.5, -ga, PALE_SIDE, PALE_SIDE);
    // a finial at the apex
    box(statics, gx, goal.y + PIER_H + 0.16 + ARCH_H + 0.3, gz, 0.1, 0.3, 0.1, -ga, shade(PALE, 1.1), PALE_SIDE);
    // the standing stones: seven slabs in an arc in the void beyond the rim, tallest at the gate
    const N = 7;
    for (let i = 0; i < N; i++) {
      const t = (i / (N - 1)) * 2 - 1;
      if (Math.abs(t) < 0.2) continue;
      const sa = ga + t * goal.span * 0.78;
      const sr = goal.r1 + 1.3 + Math.abs(t) * 0.6;
      const h = 2.0 + (1 - Math.abs(t)) * 1.2 + rng() * 0.3;
      const yb = goal.y - 0.9 + rng() * 0.5;
      slab(statics, Math.cos(sa) * sr, Math.sin(sa) * sr, sa, yb, h, 0.26 + rng() * 0.08, 0.14, 0.12 + rng() * 0.08, PALE, PALE_SIDE);
    }
  }
  const bell = new THREE.Group();
  {
    const cup = new THREE.Mesh(geo.cone, mats.gold);
    cup.scale.set(0.5, 0.75, 0.5);
    cup.position.y = -0.82;
    const lip = new THREE.Mesh(geo.ring, mats.gold);
    lip.rotation.x = Math.PI / 2;
    lip.scale.setScalar(0.46);
    lip.position.y = -1.18;
    bell.add(cup, lip);
    bell.position.set(gx, goal.y + PIER_H + 0.16 + ARCH_H - 0.1, gz);
    group.add(bell);
  }
  // the bell swings across the gate, about the radial through the apex
  const bellAxis = new THREE.Vector3(Math.cos(ga), 0, Math.sin(ga));
  const beamMat = d.basic('#eef2ff', { transparent: true, opacity: 0.16, fog: false, depthWrite: false });
  const haloMat = d.basic('#eef2ff', { transparent: true, opacity: 0.05, fog: false, depthWrite: false });
  const beam = new THREE.Mesh(geo.rod, beamMat);
  beam.scale.set(0.45, 70, 0.45);
  beam.position.set(gx, goal.y + 35, gz);
  const beamHalo = new THREE.Mesh(geo.rod, haloMat);
  beamHalo.scale.set(1.3, 70, 1.3);
  beamHalo.position.copy(beam.position);
  beam.visible = beamHalo.visible = false;
  group.add(beam, beamHalo);

  // ---------------------------------------------------------------------------------------------------------------
  // the crystals: one instanced bipyramid for the shards that orbit each ledge, the slow boulders further out and
  // the lamps set into the core between the ribs, with a halo stood on the wall behind each lamp
  const cgeo = d.track(geometryOf(THREE, crystalGeo()));
  const perLedge = lite ? 1 : 2;
  const maxCrystals = d.platforms.length * (perLedge + 1) + 4 + 2 * RIBS;
  const crystals = new Instancer(THREE, cgeo, d.flat('#9aa4cc', { emissive: '#1a2250' }), maxCrystals);
  group.add(crystals.mesh);
  // per orbiting crystal: base angle, radius, height, bob seed, orbit speed factor, tumble rate, tilt
  const orb: number[] = [];
  const orbIdx: number[] = [];
  const addOrbiter = (a: number, r: number, y: number, w: number, h: number, speed: number, tint: string) => {
    const i = crystals.push(Math.cos(a) * r, y, Math.sin(a) * r, [0, 0, 0], [w, h, w], tint);
    if (i < 0) return;
    orbIdx.push(i);
    orb.push(a, r, y, rng() * 10, speed, 0.1 + rng() * 0.3, (rng() - 0.5) * 0.5, w, h);
  };
  for (const p of d.platforms) {
    const n = p.kind === 'goal' ? perLedge + 1 : perLedge + (rng() < 0.5 ? 1 : 0);
    for (let i = 0; i < n; i++) {
      const a = p.a + (rng() - 0.5) * p.span * 2.4;
      // orbits stay outside every ledge's reach, and above the goal's walk
      const r = 8.3 + rng() * 3.2;
      const y = p.kind === 'goal' ? p.y + 2.6 + rng() * 2.6 : p.y - 1 + rng() * 4;
      addOrbiter(a, r, y, 0.38 + rng() * 0.3, 0.9 + rng() * 0.8, 0.7 + rng() * 0.6, TINTS[Math.floor(rng() * 3)]);
    }
  }
  // the boulders: four big slow ones for size contrast
  for (let i = 0; i < 4; i++) {
    const a = rng() * TAU;
    addOrbiter(a, 10.5 + rng() * 2.5, d.zone.from + 2 + i * 4.2 + rng() * 2, 1.0 + rng() * 0.4, 1.5 + rng() * 0.7, 0.3 + rng() * 0.2, TINTS[i % 3]);
  }
  // the lamps: crystals set into the wall between the ribs where no ledge's walk runs
  const halo = glows(d, '#c8d2ff', 0.14, 2 * RIBS + 2);
  const lampIdx: number[] = [];
  const lampRot: number[] = [];
  const lampSeed: number[] = [];
  const lampBase: number[] = [];
  let lamps = 0;
  for (let k = 0; k < RIBS * 3 && lamps < (lite ? RIBS : RIBS * 2); k++) {
    const rib = Math.floor(rng() * RIBS);
    const a = ((rib + 0.5) / RIBS) * TAU;
    const y = d.zone.from + 1.5 + rng() * (goal.y - d.zone.from - 4.5);
    if (blocked(a, y, d.coreR(y) + 0.6)) continue;
    // no two lamps within two metres of each other on the same gap
    let near = false;
    for (let j = 0; j < lampBase.length; j += 4) if (Math.abs(angDiff(lampBase[j], a)) < 0.05 && Math.abs(lampBase[j + 1] - y) < 2.2) near = true;
    if (near) continue;
    const r = d.coreR(y) + 0.03;
    const s = 0.8 + rng() * 0.5;
    crystals.push(Math.cos(a) * r, y, Math.sin(a) * r, [0, -a, -0.35], [s, s * 1.6, s], '#e4eaff');
    const hi = halo.add(Math.cos(a) * (r - 0.01), y + 0.1, Math.sin(a) * (r - 0.01), a, 0.55 + s * 0.2, false);
    if (hi >= 0) {
      lampIdx.push(hi);
      lampRot.push(-a + Math.PI / 2);
      lampSeed.push(rng() * 10);
      lampBase.push(a, y, r - 0.01, 0.55 + s * 0.2);
    }
    lamps++;
  }
  // a pool of light on the goal under the gate
  halo.add(Math.cos(ga) * (goal.r1 - 1.5), goal.y + 0.1, Math.sin(ga) * (goal.r1 - 1.5), 0, 1.6, true);
  crystals.finish();
  halo.finish();

  // ---------------------------------------------------------------------------------------------------------------
  // per frame: the crystals orbit and tumble, faster downwind in a gust; the lamps twinkle; the beam breathes and
  // flares on the win; the bell swings once the climb is won and stirs in the wind
  let drift = 0;
  let bellSwing = 0;
  let rang = false;
  let winGlow = 0;
  const rot: [number, number, number] = [0, 0, 0];
  const sc: [number, number, number] = [1, 1, 1];
  const lrot: [number, number, number] = [0, 0, 0];
  d.animate((f: Frame) => {
    const w = windAt(f.g.time);
    const gust = w.dir * DIR * w.strength;
    drift += f.dt * (0.03 + gust * 0.14);
    for (let k = 0; k < orbIdx.length; k++) {
      const o = k * 9;
      const a = orb[o] + drift * orb[o + 4];
      const y = orb[o + 2] + Math.sin(f.clock * 0.5 + orb[o + 3]) * 0.4;
      rot[0] = orb[o + 6] * 0.5;
      rot[1] = orb[o + 3] + f.clock * orb[o + 5];
      rot[2] = orb[o + 6] * 0.6 + gust * 0.3;
      sc[0] = orb[o + 7];
      sc[1] = orb[o + 8];
      sc[2] = orb[o + 7];
      crystals.set(orbIdx[k], Math.cos(a) * orb[o + 1], y, Math.sin(a) * orb[o + 1], rot, sc);
    }
    for (let k = 0; k < lampIdx.length; k++) {
      const b = k * 4;
      const tw = 1 + 0.25 * Math.sin(f.clock * (1.8 + (k % 4) * 0.5) + lampSeed[k]);
      lrot[1] = lampRot[k];
      halo.set(lampIdx[k], Math.cos(lampBase[b]) * lampBase[b + 2], lampBase[b + 1] + 0.1, Math.sin(lampBase[b]) * lampBase[b + 2], lrot, lampBase[b + 3] * tw);
    }
    if (f.won && !rang) {
      rang = true;
      bellSwing = 1;
      winGlow = 2;
    }
    const near = f.camY > 90;
    beam.visible = beamHalo.visible = near;
    if (near) {
      winGlow = Math.max(0, winGlow - f.dt);
      const breathe = 0.16 + Math.sin(f.clock * 1.2) * 0.04;
      beamMat.opacity = winGlow > 0 ? 0.5 : breathe;
      haloMat.opacity = winGlow > 0 ? 0.14 : 0.05;
    }
    if (bellSwing > 0) bellSwing = Math.max(0, bellSwing - f.dt * 0.25);
    bell.quaternion.setFromAxisAngle(bellAxis, Math.sin(f.clock * 6) * 0.5 * bellSwing + Math.sin(f.clock * 2.2) * 0.1 * w.strength);
  });
};
