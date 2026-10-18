// The Forge: riveted iron plates, bands and steam pipes on the core, furnace mouths burning behind the ledges, iron
// walkways with brass lips on the ledges, I-beam girders carrying crucibles of molten metal, meshing gears on axles
// and a flywheel turning at the circle's door.
import type { Dress, Dresser, Frame } from '../decor';
import { box, hash, hexToRgb, quad, sector, shade, tones, wedge } from '../dress';
import type { RGB, Tri } from '../dress';
import { Instancer, chainOf, flames, glows } from '../instance';
import type { Platform } from '../level';

const TAU = Math.PI * 2;
const angDiff = (a: number, b: number) => ((((a - b) % TAU) + TAU + Math.PI) % TAU) - Math.PI;

/** a quad wound so its normal agrees with dir */
function face(out: Tri, a: number[], b: number[], c: number[], d: number[], dir: number[], col: RGB, k = 1) {
  const ux = b[0] - a[0];
  const uy = b[1] - a[1];
  const uz = b[2] - a[2];
  const vx = c[0] - a[0];
  const vy = c[1] - a[1];
  const vz = c[2] - a[2];
  const nx = uy * vz - uz * vy;
  const ny = uz * vx - ux * vz;
  const nz = ux * vy - uy * vx;
  if (nx * dir[0] + ny * dir[1] + nz * dir[2] < 0) quad(out, a, d, c, b, col, k);
  else quad(out, a, b, c, d, col, k);
}

/** a triangle wound so its normal agrees with dir */
function triF(out: Tri, a: number[], b: number[], c: number[], dir: number[], col: RGB, k = 1) {
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
  const pts = nx * dir[0] + ny * dir[1] + nz * dir[2] < 0 ? [a, c, b] : [a, b, c];
  if (pts[1] !== b) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  for (const p of pts) {
    out.pos.push(p[0], p[1], p[2]);
    out.nor.push(nx, ny, nz);
    out.col.push(col[0] * k, col[1] * k, col[2] * k);
  }
}

/** a square section bar between two points, w across and h deep, with outward faces */
function bar(out: Tri, from: number[], to: number[], w: number, h: number, col: RGB, k = 1) {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const len = Math.hypot(dx, dy, dz) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const uz = dz / len;
  // the side vector: horizontal and perpendicular, or x for a vertical bar
  let sx = -uz;
  let sz = ux;
  const sl = Math.hypot(sx, sz);
  if (sl < 1e-4) {
    sx = 1;
    sz = 0;
  } else {
    sx /= sl;
    sz /= sl;
  }
  const vx = -sz * uy;
  const vy = sz * ux - sx * uz;
  const vz = sx * uy;
  const hw = w / 2;
  const hh = h / 2;
  const P = (t: number, a: number, b: number) => [from[0] + dx * t + sx * a * hw + vx * b * hh, from[1] + dy * t + vy * b * hh, from[2] + dz * t + sz * a * hw + vz * b * hh];
  const c000 = P(0, -1, -1);
  const c010 = P(0, 1, -1);
  const c001 = P(0, -1, 1);
  const c011 = P(0, 1, 1);
  const c100 = P(1, -1, -1);
  const c110 = P(1, 1, -1);
  const c101 = P(1, -1, 1);
  const c111 = P(1, 1, 1);
  face(out, c001, c011, c111, c101, [vx, vy, vz], col, k);
  face(out, c000, c010, c110, c100, [-vx, -vy, -vz], col, k * 0.7);
  face(out, c010, c011, c111, c110, [sx, 0, sz], col, k * 0.88);
  face(out, c000, c001, c101, c100, [-sx, 0, -sz], col, k * 0.88);
  face(out, c000, c010, c011, c001, [-ux, -uy, -uz], col, k * 0.8);
  face(out, c100, c110, c111, c101, [ux, uy, uz], col, k * 0.8);
}

/**
 * a spur gear lying in the xy plane, its axis along +z and its faces at +-thick / 2: a toothed body, a raised hub
 * and four raised spokes on each face
 */
function gearTri(out: Tri, rPitch: number, teeth: number, thick: number, light: RGB, dark: RGB) {
  const rr = rPitch - 0.06;
  const rt = rPitch + 0.08;
  const pa = TAU / teeth;
  const ring: number[][] = [];
  for (let k = 0; k < teeth; k++) {
    const t0 = k * pa;
    ring.push([rr, t0 - pa * 0.25], [rt, t0 - pa * 0.15], [rt, t0 + pa * 0.15], [rr, t0 + pa * 0.25]);
  }
  const hz = thick / 2;
  const at = (p: number[], z: number) => [Math.cos(p[1]) * p[0], Math.sin(p[1]) * p[0], z];
  const n = ring.length;
  const centreTop = [0, 0, hz];
  const centreBot = [0, 0, -hz];
  for (let i = 0; i < n; i++) {
    const p = ring[i];
    const q = ring[(i + 1) % n];
    triF(out, centreTop, at(p, hz), at(q, hz), [0, 0, 1], light, 1);
    triF(out, centreBot, at(p, -hz), at(q, -hz), [0, 0, -1], light, 0.8);
    const m = at([(p[0] + q[0]) / 2, (p[1] + q[1]) / 2], 0);
    face(out, at(p, -hz), at(q, -hz), at(q, hz), at(p, hz), [m[0], m[1], 0], dark, 0.95);
  }
  // hub and spokes on both faces
  for (const side of [1, -1]) {
    const z0 = side * hz;
    const z1 = side * (hz + 0.05);
    const hub: number[][] = [];
    for (let i = 0; i < 8; i++) hub.push([Math.cos((i * TAU) / 8) * 0.17, Math.sin((i * TAU) / 8) * 0.17]);
    const cz = [0, 0, z1];
    for (let i = 0; i < 8; i++) {
      const p = hub[i];
      const q = hub[(i + 1) % 8];
      triF(out, cz, [p[0], p[1], z1], [q[0], q[1], z1], [0, 0, side], shade(light, 1.1), 1);
      face(out, [p[0], p[1], z0], [q[0], q[1], z0], [q[0], q[1], z1], [p[0], p[1], z1], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, 0], dark, 1);
    }
    for (let i = 0; i < 4; i++) {
      const th = (i * Math.PI) / 4;
      const c = Math.cos(th);
      const s = Math.sin(th);
      const r = rr - 0.06;
      const zm = side * (hz + 0.012);
      bar(out, [-c * r, -s * r, zm], [c * r, s * r, zm], 0.08, 0.024, shade(light, 1.05), 1);
    }
  }
}

export const dressForge: Dresser = (d: Dress) => {
  const { THREE, geo, mats, group, rng, statics, coreR } = d;
  const plats = d.platforms;
  const iron = tones(d.palette, 'iron');
  const ironDark = shade(iron.side, 0.8);
  const steelTop = hexToRgb('#7a808c');
  const steelSide = hexToRgb('#545a66');
  const brass = hexToRgb('#b8893a');
  const brassDark = hexToRgb('#7a5a26');
  const grateTop = hexToRgb('#33373f');
  const grateSide = hexToRgb('#1f2228');
  const rustTop = hexToRgb('#5a3620');
  const plateBase = hexToRgb('#1a1d23');
  const rust = hexToRgb('#4a2c1a');
  const soot = hexToRgb('#12100e');
  const ledgeBand = 2.2;

  // the instanced pieces: one draw call each
  const rivets = new Instancer(THREE, geo.box, mats.darkIron, 1100);
  const rods = new Instancer(THREE, geo.rod, d.flat('#6a707c'), 64);
  const rings = new Instancer(THREE, geo.ring, mats.iron, 40);
  const links = new Instancer(THREE, geo.link, mats.chain, 160);
  const hotMat = d.basic('#ff8a2a', { transparent: true, alphaMap: geo.soft });
  const hot = new Instancer(THREE, geo.disc, hotMat, 24);
  const crucibles = new Instancer(THREE, geo.cone, mats.darkIron, 8);
  const gearGeo = d.track((() => {
    const t: Tri = { pos: [], nor: [], col: [] };
    gearTri(t, 0.6, 12, 0.12, iron.top, iron.side);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(t.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(t.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(t.col, 3));
    return g;
  })());
  const gears = new Instancer(THREE, gearGeo, d.flat('#ffffff', { vertexColors: true }), 16);
  const fire = flames(d, 40);
  const glow = glows(d, '#ff9a3a', 0.22, 48);

  // a point proud of the wall at an angle, shifted along the tangent
  const pt = (a: number, y: number, out: number, tan = 0): number[] => {
    const r = coreR(y) + out;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return [c * r - s * tan, y, s * r + c * tan];
  };
  const topOf = (p: Platform) => p.y + (p.kind === 'lift' ? p.amp : 0);
  const lowOf = (p: Platform) => p.y - p.h - (p.kind === 'lift' ? p.amp : 0);
  const near = d.level.platforms.filter((p) => p.kind !== 'floor' && p.y > 36 && p.y < 64);
  // a ledge slab, or the air just over one, meets the wall at this angle and height
  const slabAt = (a: number, y: number) => near.some((q) => Math.abs(angDiff(a, q.a)) < q.span + 0.05 && y > lowOf(q) - 0.25 && y < topOf(q) + 0.4);
  // the souls' room over a ledge where it meets the wall
  const wallBusy = (a: number, y: number) => near.some((q) => Math.abs(angDiff(a, q.a)) < q.span + 0.05 && y > lowOf(q) - 0.25 && y < topOf(q) + ledgeBand + 0.1);
  const rivet = (a: number, y: number, out: number, tan = 0, size = 0.05) => {
    const p = pt(a, y, out, tan);
    rivets.push(p[0], p[1], p[2], [0, -a, 0], size);
  };
  const mouths: { a: number; y: number }[] = [];
  const clear: number[] = [];
  // per crucible: instance, x, y, z, phase
  const cruc: number[] = [];

  // ---------------------------------------------------------------------------------------------------------------
  // the ledges: an iron walkway with a brass lip on the outer rim, corbels under, a sleeve under every lift

  for (const p of plats) {
    const a0 = p.a - p.span;
    const a1 = p.a + p.span;
    if (p.kind === 'lift') {
      // a fixed sleeve the piston runs in, held off the wall by two brackets
      const rm = (p.r0 + p.r1) / 2;
      const h = 2 * p.amp + 0.9;
      const yTop = p.y - p.amp - 0.25;
      const ym = yTop - h / 2;
      const x = Math.cos(p.a) * rm;
      const z = Math.sin(p.a) * rm;
      rods.push(x, ym, z, [0, 0, 0], [0.44, h, 0.44]);
      rings.push(x, yTop, z, [Math.PI / 2, 0, 0], 0.5);
      for (const dy of [0.3, 1.3]) {
        const yb = yTop - dy;
        bar(statics, pt(p.a, yb, -0.05), [Math.cos(p.a) * (rm - 0.3), yb, Math.sin(p.a) * (rm - 0.3)], 0.12, 0.12, ironDark, 1);
        box(statics, ...(pt(p.a, yb, 0.02) as [number, number, number]), 0.02, 0.14, 0.14, -p.a, iron.side, iron.side);
      }
      continue;
    }
    // the walkway band: iron grating, rust on every third segment, a brass lip at the rim
    sector(statics, a0, a1, p.r1 - 0.95, p.r1 - 0.1, p.y - 0.01, p.y + 0.03, grateTop, grateSide, { inner: false, topOf: (i) => (i % 3 === 1 ? rustTop : grateTop) });
    sector(statics, a0, a1, p.r1 - 0.1, p.r1 + 0.012, p.y - 0.02, p.y + 0.07, brass, brassDark, { inner: false });
    const arc = 2 * p.span * p.r1;
    const nR = Math.max(3, Math.round(arc / 0.45));
    for (let i = 0; i <= nR; i++) {
      const a = a0 + ((a1 - a0) * (i + 0.5)) / (nR + 1);
      for (const r of [p.r1 - 0.22, p.r1 - 0.85]) {
        rivets.push(Math.cos(a) * r, p.y + 0.052, Math.sin(a) * r, [0, -a, 0], 0.05);
      }
    }
    // corbels from the wall to the outer third of the slab
    const nC = p.span > 0.55 ? 3 : p.span > 0.3 ? 2 : 1;
    for (let i = 0; i < nC; i++) {
      const a = nC === 1 ? p.a : a0 + ((a1 - a0) * (i + 0.5)) / nC;
      wedge(statics, a, coreR(p.y) - 0.05, p.r1 - 0.35, p.y - p.h + 0.01, 0.18, 1.1, ironDark);
    }
    if (p.kind === 'spring') {
      // a base plate under the coil
      const rm = (p.r0 + p.r1) / 2;
      rods.push(Math.cos(p.a) * rm, p.y + 0.025, Math.sin(p.a) * rm, [0, 0, 0], [0.62, 0.05, 0.62]);
    }
  }

  // ---------------------------------------------------------------------------------------------------------------
  // the pieces: a furnace mouth in the wall behind a ledge, an I-beam girder above it, a pair of gears, the flywheel

  const addMouth = (a: number, y: number, ledgeTop: number) => {
    const my = y;
    mouths.push({ a, y: my });
    const h = pt(a, my, 0.012);
    glow.add(h[0], h[1], h[2], a, 0.95, false);
    const m = pt(a, my, 0.03);
    hot.push(m[0], m[1], m[2], [0, Math.PI / 2 - a, 0], 0.42);
    const f = pt(a, my, 0.05);
    rings.push(f[0], f[1], f[2], [0, Math.PI / 2 - a, 0], 0.46);
    for (const off of [-0.2, 0, 0.2]) {
      const hl = off === 0 ? 0.4 : 0.36;
      bar(statics, pt(a, my - hl, 0.06, off), pt(a, my + hl, 0.06, off), 0.04, 0.04, grateSide, 1);
    }
    for (const off of [-0.13, 0.13]) {
      const b = pt(a, my - 0.36, 0.1, off);
      fire.add(b[0], b[1], b[2], 0.75);
    }
    // soot above the mouth and a pool of light on the ledge in front of it
    sector(statics, a - 0.28, a + 0.28, coreR(my) + 0.004, coreR(my) + 0.012, my + 0.42, my + 1.05, soot, soot, { inner: false, segs: 3 });
    const pr = coreR(ledgeTop) + 0.95;
    glow.add(Math.cos(a) * pr, ledgeTop + 0.02, Math.sin(a) * pr, 0, 0.85, true);
  };

  const addGirder = (p: Platform, top: number) => {
    const ga = p.a + (rng() - 0.5) * p.span * 0.8;
    const yb = top + 3.6 + rng() * 0.4;
    const L = p.r1 + 0.5 - coreR(yb) + rng() * 0.5;
    const web = shade(iron.side, 0.95);
    bar(statics, pt(ga, yb, -0.05), pt(ga, yb, L), 0.05, 0.2, web, 1);
    bar(statics, pt(ga, yb + 0.11, -0.05), pt(ga, yb + 0.11, L), 0.2, 0.035, iron.top, 1);
    bar(statics, pt(ga, yb - 0.11, -0.05), pt(ga, yb - 0.11, L), 0.2, 0.035, iron.side, 1);
    // the root plate with its rivets, and a brace down to the wall
    box(statics, ...(pt(ga, yb, 0.03) as [number, number, number]), 0.03, 0.3, 0.3, -ga, iron.top, iron.side);
    for (const sy of [-1, 1]) for (const sz of [-1, 1]) rivet(ga, yb + sy * 0.22, 0.065, sz * 0.22, 0.05);
    bar(statics, pt(ga, yb - 0.12, L * 0.62), pt(ga, yb - 1.3, 0.01), 0.07, 0.07, web, 1);
    box(statics, ...(pt(ga, yb - 1.3, 0.02) as [number, number, number]), 0.02, 0.16, 0.16, -ga, iron.top, iron.side);
    clear.push(ga);
    // what hangs from the tip: a crucible of molten metal, or a bare chain and shackle
    const tip = pt(ga, yb - 0.12, L - 0.18);
    rings.push(tip[0], tip[1] - 0.06, tip[2], [0, -ga, 0], 0.12);
    const len = 0.9 + rng() * 0.4;
    const end: [number, number, number] = [tip[0], tip[1] - 0.14 - len, tip[2]];
    chainOf(links, [tip[0], tip[1] - 0.14, tip[2]], end, 0.2);
    if (rng() < 0.65) {
      const i = crucibles.push(end[0], end[1] - 0.225, end[2], [Math.PI, 0, 0], [0.32, 0.45, 0.32]);
      cruc.push(i, end[0], end[1] - 0.225, end[2], rng() * TAU);
      hot.push(end[0], end[1] - 0.02, end[2], [-Math.PI / 2, 0, 0], 0.26);
      fire.add(end[0], end[1] - 0.03, end[2], 0.5);
    } else {
      rings.push(end[0], end[1] - 0.1, end[2], [0, -ga + Math.PI / 2, 0], 0.16);
    }
  };

  // per gear: x, y, z, yaw, scale, speed, phase
  const gearAt: number[] = [];
  const addGear = (a: number, y: number, out: number, scale: number, speed: number) => {
    const p = pt(a, y, out);
    gearAt.push(p[0], p[1], p[2], Math.PI / 2 - a, scale, speed, rng() * TAU);
    gears.push(p[0], p[1], p[2], [0, Math.PI / 2 - a, 0], scale);
  };
  const addAxle = (a: number, y: number, out: number, radius: number) => {
    const p = pt(a, y, out / 2);
    rods.push(p[0], p[1], p[2], [0, -a, -Math.PI / 2], [radius, out, radius]);
  };
  const addGearPair = (p: Platform, top: number, side: number) => {
    const ga = p.a + side * p.span * 0.3;
    const gy = top + 3.05;
    addAxle(ga, gy, 0.5, 0.06);
    addGear(ga, gy, 0.42, 1, 0.6);
    // the small one meshes up and to one side
    const psi = 0.7;
    const rg = coreR(gy) + 0.42;
    const sa = ga + (side * 0.96 * Math.cos(psi)) / rg;
    const sy = gy + 0.96 * Math.sin(psi);
    addAxle(sa, sy, 0.5, 0.05);
    addGear(sa, sy, 0.42, 0.6, -1.0);
    clear.push(ga, sa);
  };

  let fly: { cx: number; cy: number; cz: number; tx: number; tz: number; bx: number; by: number; bz: number; rod: number; speed: number; phase: number } | null = null;
  const addFlywheel = (p: Platform, top: number) => {
    const a = p.a;
    const y = top + 4.15;
    addAxle(a, y, 0.6, 0.1);
    addGear(a, y, 0.42, 2.4, 0.25);
    const c = pt(a, y, 0.62);
    const ba = a + 0.34;
    const b = pt(ba, top + 2.5, 0.62);
    const bb = pt(ba, top + 2.5, 0.3);
    rods.push(bb[0], bb[1], bb[2], [0, -ba, -Math.PI / 2], [0.12, 0.6, 0.12]);
    const rod = rods.push(c[0], c[1], c[2], [0, 0, 0], [0.05, 1, 0.05]);
    fly = { cx: c[0], cy: c[1], cz: c[2], tx: -Math.sin(a), tz: Math.cos(a), bx: b[0], by: b[1], bz: b[2], rod, speed: 0.25, phase: gearAt[gearAt.length - 1] };
    clear.push(a, ba);
  };

  let girders = 0;
  plats.forEach((p, i) => {
    const top = topOf(p);
    const prev = plats[i - 1];
    const overheadOk = p.kind !== 'spring' && (!prev || prev.kind !== 'spring');
    const mouthOff = Math.max(0, p.span - 0.3);
    if (p.kind === 'checkpoint') {
      // the door of the circle: a mouth each side of the beacon and the flywheel above
      for (const s of [-1, 1]) addMouth(p.a + s * mouthOff, top + 1.05, top);
      if (overheadOk) addFlywheel(p, top);
      return;
    }
    if (p.kind === 'lift') {
      if (overheadOk && rng() < 0.8) {
        addGirder(p, top);
        girders++;
      }
      return;
    }
    const side = rng() < 0.5 ? -1 : 1;
    const wantGirder = overheadOk && i % 2 === 1 && girders < 3;
    if (wantGirder) {
      addGirder(p, top);
      girders++;
      if (rng() < 0.5) addMouth(p.a - side * mouthOff * 0.9, top + 1.05, top);
    } else {
      addMouth(p.a + side * mouthOff * (0.6 + rng() * 0.4), top + 1.05, top);
      if (overheadOk && rng() < 0.75) addGearPair(p, top, -side);
    }
  });

  // ---------------------------------------------------------------------------------------------------------------
  // the wall: riveted plates in a brick bond, three bands, steam pipes with flanges and elbows

  const y0 = d.zone.from;
  const y1 = d.zone.to;
  const rowH = 1.4;
  const rows = Math.floor((y1 - y0) / rowH);
  const cols = 24;
  const colA = TAU / cols;
  const sooty = (a: number, y: number) => mouths.some((m) => Math.abs(angDiff(a, m.a)) * coreR(y) < 1.3 && Math.abs(y - m.y) < 1.6);
  for (let row = 0; row < rows; row++) {
    const py0 = y0 + 0.2 + row * rowH;
    const py1 = py0 + rowH - 0.05;
    const shift = (row % 2) * colA * 0.5;
    for (let col = 0; col < cols; col++) {
      if (hash(col, row + 40) < 0.16) continue;
      const a0 = col * colA + shift + 0.012;
      const a1 = a0 + colA - 0.024;
      const am = (a0 + a1) / 2;
      const ym = (py0 + py1) / 2;
      let c = shade(plateBase, 0.7 + hash(col + 7, row) * 0.4);
      if (hash(col, row + 11) < 0.28) c = [c[0] * 0.55 + rust[0] * 0.45, c[1] * 0.55 + rust[1] * 0.45, c[2] * 0.55 + rust[2] * 0.45];
      if (sooty(am, ym)) c = shade(c, 0.55);
      const proud = hash(col + 3, row + 5) > 0.5 ? 0.024 : 0.014;
      const side: RGB = [c[0] / 0.9, c[1] / 0.9, c[2] / 0.9];
      sector(statics, a0, a1, coreR(ym) + 0.002, coreR(ym) + proud, py0, py1, shade(c, 1.1), side, { inner: false, segs: 2 });
      if (d.lite) continue;
      for (const [fa, fy] of [
        [a0 + 0.03, py0 + 0.1],
        [a1 - 0.03, py0 + 0.1],
        [a0 + 0.03, py1 - 0.1],
        [a1 - 0.03, py1 - 0.1],
      ]) {
        if (slabAt(fa, fy)) continue;
        rivet(fa, fy, proud + 0.012, 0, 0.045);
      }
    }
  }
  // bands at heights no ledge meets
  for (const want of [43.6, 50, 56.4]) {
    let yb = -1;
    for (const dy of [0, 0.5, -0.5, 1, -1, 1.5, -1.5, 2, -2]) {
      const y = want + dy;
      if (!near.some((q) => y + 0.22 > lowOf(q) - 0.3 && y < topOf(q) + 0.45)) {
        yb = y;
        break;
      }
    }
    if (yb < 0) continue;
    sector(statics, 0, TAU, coreR(yb) + 0.002, coreR(yb) + 0.09, yb, yb + 0.22, iron.top, iron.side, { inner: false, segs: 48 });
    for (let i = 0; i < 24; i++) rivet((i + 0.5) * colA, yb + 0.11, 0.1, 0, 0.06);
  }
  // pipes: vertical runs clear of the mouths and gears, flanges where no ledge meets the wall, an elbow at the top
  const pipes: { a: number; y0: number; y1: number }[] = [];
  for (let n = 0; n < 3; n++) {
    let pa = -1;
    for (let tries = 0; tries < 12 && pa < 0; tries++) {
      const cand = rng() * TAU;
      const free = mouths.every((m) => Math.abs(angDiff(cand, m.a)) > 0.32) && clear.every((c) => Math.abs(angDiff(cand, c)) > 0.4) && pipes.every((q) => Math.abs(angDiff(cand, q.a)) > 0.5);
      if (free) pa = cand;
    }
    if (pa < 0) continue;
    const yLo = y0 + 0.3 + rng() * 1.5;
    let yHi = y1 - 1.5 - rng() * 1.5;
    for (let k = 0; k < 6 && wallBusy(pa, yHi); k++) yHi -= 0.7;
    const mid = pt(pa, (yLo + yHi) / 2, 0.05);
    rods.push(mid[0], mid[1], mid[2], [0, 0, 0], [0.045, yHi - yLo, 0.045]);
    for (let y = yLo + 1.2; y < yHi - 0.6; y += 2.6) {
      if (wallBusy(pa, y)) continue;
      const f = pt(pa, y, 0.05);
      rods.push(f[0], f[1], f[2], [0, 0, 0], [0.065, 0.07, 0.065]);
    }
    // the elbow: a stub along the tangent ending in a flange
    const e = pt(pa, yHi, 0.05, 0.22);
    rods.push(e[0], e[1], e[2], [0, -(pa + Math.PI / 2), -Math.PI / 2], [0.045, 0.44, 0.045]);
    const ef = pt(pa, yHi, 0.05, 0.44);
    rods.push(ef[0], ef[1], ef[2], [0, -(pa + Math.PI / 2), -Math.PI / 2], [0.065, 0.06, 0.065]);
    pipes.push({ a: pa, y0: yLo, y1: yHi });
  }
  // horizontal runs between neighbouring pipes, merged into the statics
  for (let i = 0; i + 1 < pipes.length; i++) {
    const A = pipes[i];
    const B = pipes[i + 1];
    const dA = angDiff(B.a, A.a);
    const a0 = dA > 0 ? A.a : B.a;
    const a1 = a0 + Math.abs(dA);
    const lo = Math.max(A.y0, B.y0) + 0.8;
    const hi = Math.min(A.y1, B.y1) - 0.8;
    let hy = -1;
    for (let tries = 0; tries < 10 && hy < 0; tries++) {
      const y = lo + rng() * Math.max(0.1, hi - lo);
      let ok = true;
      for (let a = a0; a <= a1; a += 0.1) if (slabAt(a, y)) ok = false;
      if (ok) hy = y;
    }
    if (hy < 0) continue;
    sector(statics, a0, a1, coreR(hy) + 0.02, coreR(hy) + 0.1, hy - 0.04, hy + 0.04, steelTop, steelSide, { inner: false });
  }

  rivets.finish();
  rods.finish();
  rings.finish();
  links.finish();
  hot.finish();
  crucibles.finish();
  gears.finish();
  fire.finish();
  glow.finish();
  group.add(rivets.mesh, rods.mesh, rings.mesh, links.mesh, hot.mesh, crucibles.mesh, gears.mesh);

  // ---------------------------------------------------------------------------------------------------------------
  // per frame: the gears turn, the flywheel drives its rod, the crucibles swing round, the mouths flicker

  const rotG: [number, number, number] = [0, 0, 0];
  const rotC: [number, number, number] = [Math.PI, 0, 0];
  const scC: [number, number, number] = [0.32, 0.45, 0.32];
  const scR: [number, number, number] = [0.05, 1, 0.05];
  const nG = gearAt.length / 7;
  d.animate((f: Frame) => {
    const t = f.clock;
    for (let i = 0; i < nG; i++) {
      const o = i * 7;
      rotG[1] = gearAt[o + 3];
      rotG[2] = gearAt[o + 5] * t + gearAt[o + 6];
      gears.set(i, gearAt[o], gearAt[o + 1], gearAt[o + 2], rotG, gearAt[o + 4]);
    }
    for (let i = 0; i + 4 < cruc.length; i += 5) {
      rotC[1] = t * 0.35 + cruc[i + 4];
      crucibles.set(cruc[i], cruc[i + 1], cruc[i + 2], cruc[i + 3], rotC, scC);
    }
    if (fly) {
      // the crank pin runs round the wheel, the rod reaches from it to the boss
      const ph = fly.speed * t + fly.phase;
      const pr = 1.0;
      const px = fly.cx - fly.tx * pr * Math.cos(ph);
      const py = fly.cy + pr * Math.sin(ph);
      const pz = fly.cz - fly.tz * pr * Math.cos(ph);
      const dx = px - fly.bx;
      const dy = py - fly.by;
      const dz = pz - fly.bz;
      const len = Math.hypot(dx, dy, dz) || 1;
      rods.v.set(dx / len, dy / len, dz / len);
      rods.q.setFromUnitVectors(rods.v2.set(0, 1, 0), rods.v);
      scR[1] = len;
      rods.set(fly.rod, (px + fly.bx) / 2, (py + fly.by) / 2, (pz + fly.bz) / 2, rods.q, scR);
    }
    const k = 0.5 + Math.sin(t * 9) * 0.3 + Math.sin(t * 23) * 0.2;
    hotMat.color.setRGB(1, 0.42 + k * 0.3, 0.08 + k * 0.2);
  });
};
