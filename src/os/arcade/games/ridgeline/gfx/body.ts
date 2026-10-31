// A soldier: one skinned body (a skeleton of twenty bones under a continuous mesh lofted from anatomical cross
// sections, so cloth bends at the joints instead of breaking into parts) wearing a modern kit bound rigidly to its
// bones: plate carrier with mag, admin and radio pouches and a hydration carrier, battle belt and drop leg holster,
// knee pads, boots, gloves with knuckle armor, a high cut helmet with rails, NVG shroud, headset and ballistic glasses
// over a balaclava. The whole soldier is one draw per material. Posing: legs by a walk cycle, spine and head along the
// aim, and the arms by two bone IK onto the gun's grip and handguard.
import { roundBox, lin, type T, type Three } from './common.ts';
import { KIND, type Outfit } from './gear.ts';
import type { GunModel } from './guns.ts';

type V3 = [number, number, number];

export const BONE = { root: 0, hips: 1, spine: 2, chest: 3, neck: 4, head: 5, clavR: 6, armR: 7, foreR: 8, handR: 9, clavL: 10, armL: 11, foreL: 12, handL: 13, thighR: 14, shinR: 15, footR: 16, thighL: 17, shinL: 18, footL: 19 } as const;
const PARENT = [-1, 0, 1, 2, 3, 4, 3, 6, 7, 8, 3, 10, 11, 12, 1, 14, 15, 1, 17, 18];
/** Joint positions in the bind pose (meters; +x is the soldier's right, forward is -z). */
const JOINT: V3[] = [
  [0, 0, 0],
  [0, 0.98, 0],
  [0, 1.1, 0],
  [0, 1.3, 0],
  [0, 1.5, -0.005],
  [0, 1.585, -0.005],
  [0.04, 1.44, 0],
  [0.19, 1.445, 0],
  [0.215, 1.165, 0.01],
  [0.225, 0.905, -0.005],
  [-0.04, 1.44, 0],
  [-0.19, 1.445, 0],
  [-0.215, 1.165, 0.01],
  [-0.225, 0.905, -0.005],
  [0.1, 0.935, 0],
  [0.105, 0.51, 0],
  [0.1, 0.085, 0.02],
  [-0.1, 0.935, 0],
  [-0.105, 0.51, 0],
  [-0.1, 0.085, 0.02],
];

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/** Accumulates triangles for one material, with skinning, color and surface kind per vertex. */
class Acc {
  pos: number[] = [];
  nor: number[] = [];
  col: number[] = [];
  kind: number[] = [];
  si: number[] = [];
  sw: number[] = [];
  /** Adds a geometry (positions already in the bind pose) with a color, a kind and a skinning rule. */
  add(g: T.BufferGeometry, color: number, kind: number, skin: (x: number, y: number, z: number) => [number, number, number]) {
    if (!g.attributes.normal) g.computeVertexNormals();
    const flat = g.index ? g.toNonIndexed() : g;
    const p = flat.attributes.position;
    const n = flat.attributes.normal;
    const c = lin(color);
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i);
      const y = p.getY(i);
      const z = p.getZ(i);
      this.pos.push(x, y, z);
      this.nor.push(n.getX(i), n.getY(i), n.getZ(i));
      this.col.push(c[0], c[1], c[2]);
      this.kind.push(kind);
      const [b0, b1, w1] = skin(x, y, z);
      this.si.push(b0, b1, 0, 0);
      this.sw.push(1 - w1, w1, 0, 0);
    }
    if (flat !== g) flat.dispose();
    g.dispose();
  }
}

const rigid = (b: number) => (): [number, number, number] => [b, b, 0];

type Ring = { y: number; x: number; z: number; w: number; f: number; k: number };

/**
 * A loft of horizontal cross sections (rounded superellipses: half width w, front depth f, back depth k, centered at
 * x, z) from bottom to top, with caps.
 */
function loft(THREE: Three, rings: Ring[], segs: number, power = 2.4) {
  const pos: number[] = [];
  const idx: number[] = [];
  const e = 2 / power;
  for (const r of rings)
    for (let s = 0; s <= segs; s++) {
      const a = (s / segs) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const px = Math.sign(c) * Math.pow(Math.abs(c), e) * r.w;
      const pz = Math.sign(sn) * Math.pow(Math.abs(sn), e) * (sn > 0 ? r.k : r.f);
      pos.push(r.x + px, r.y, r.z + pz);
    }
  const row = segs + 1;
  for (let i = 0; i < rings.length - 1; i++)
    for (let s = 0; s < segs; s++) {
      const a = i * row + s;
      const b = a + row;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  // caps: a fan at each end
  const capAt = (ring: number, flip: boolean) => {
    const r = rings[ring];
    const ci = pos.length / 3;
    pos.push(r.x, r.y, r.z);
    for (let s = 0; s < segs; s++) {
      const a = ring * row + s;
      if (flip) idx.push(ci, a + 1, a);
      else idx.push(ci, a, a + 1);
    }
  };
  capAt(0, false);
  capAt(rings.length - 1, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const at = (g: T.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => {
  if (rx) g.rotateX(rx);
  if (ry) g.rotateY(ry);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return g;
};

/** Torso weights by height: hips, spine, chest, then the neck. */
function torsoSkin(_x: number, y: number): [number, number, number] {
  if (y < 1.06) return [BONE.hips, BONE.spine, smooth(1.0, 1.06, y) * 0.5];
  if (y < 1.25) return [BONE.hips, BONE.spine, 0.5 + smooth(1.06, 1.16, y) * 0.5];
  if (y < 1.45) return [BONE.spine, BONE.chest, smooth(1.22, 1.36, y)];
  return [BONE.chest, BONE.neck, smooth(1.46, 1.54, y)];
}

/** Builds the bind pose geometry of one outfit. Shared by every soldier wearing it. */
export function soldierGeometry(THREE: Three, o: Outfit) {
  const cloth = new Acc();
  const hard = new Acc();
  const glass = new Acc();
  const U = KIND.uniform;
  const W = KIND.webbing;
  const K = KIND.knit;
  const C = KIND.cover;

  // torso (combat shirt over the plates is mostly hidden; the sleeves and collar show)
  const torso: Ring[] = [
    [0.84, 0.15, 0.095, 0.11],
    [0.9, 0.17, 0.1, 0.12],
    [0.98, 0.172, 0.1, 0.12],
    [1.06, 0.158, 0.095, 0.105],
    [1.14, 0.16, 0.1, 0.105],
    [1.22, 0.17, 0.11, 0.11],
    [1.3, 0.18, 0.118, 0.114],
    [1.38, 0.19, 0.112, 0.108],
    [1.43, 0.176, 0.095, 0.1],
    [1.47, 0.13, 0.072, 0.08],
    [1.5, 0.066, 0.056, 0.06],
  ].map(([y, w, f, k]) => ({ y, x: 0, z: -0.004, w, f, k }));
  cloth.add(loft(THREE, torso, 22), 0xffffff, U, torsoSkin);

  // neck and head under the balaclava, with a nose and brow
  const head: Ring[] = [
    [1.48, 0.07, 0.066, 0.07],
    [1.57, 0.066, 0.068, 0.072],
    [1.62, 0.078, 0.086, 0.082],
    [1.66, 0.084, 0.1, 0.09],
    [1.7, 0.089, 0.104, 0.098],
    [1.74, 0.091, 0.1, 0.1],
    [1.78, 0.084, 0.086, 0.093],
    [1.81, 0.062, 0.058, 0.068],
    [1.83, 0.02, 0.02, 0.025],
  ].map(([y, w, f, k]) => ({ y, x: 0, z: 0.004, w, f, k }));
  const headSkin = (_x: number, y: number): [number, number, number] => (y < 1.55 ? [BONE.chest, BONE.neck, smooth(1.47, 1.53, y)] : [BONE.neck, BONE.head, smooth(1.56, 1.62, y)]);
  cloth.add(loft(THREE, head, 20, 2.1), o.balaclava, K, headSkin);
  cloth.add(at(roundBox(THREE, 0.03, 0.04, 0.03, 0.4, 2), 0, 1.69, -0.102), o.balaclava, K, rigid(BONE.head));
  // a neck gaiter bunched over the collar
  const gaiter: Ring[] = [
    { y: 1.46, x: 0, z: 0, w: 0.088, f: 0.082, k: 0.088 },
    { y: 1.51, x: 0, z: 0, w: 0.084, f: 0.08, k: 0.084 },
    { y: 1.55, x: 0, z: 0.002, w: 0.076, f: 0.076, k: 0.078 },
  ];
  cloth.add(loft(THREE, gaiter, 18, 2), o.balaclava, K, (_x, y) => [BONE.chest, BONE.neck, smooth(1.47, 1.55, y)]);

  // arms: deltoid, biceps, elbow, forearm, cuff
  for (const side of [1, -1]) {
    const arm = side > 0 ? BONE.armR : BONE.armL;
    const fore = side > 0 ? BONE.foreR : BONE.foreL;
    const sh = JOINT[arm];
    const el = JOINT[fore];
    const wr = JOINT[side > 0 ? BONE.handR : BONE.handL];
    const cAt = (y: number): [number, number] => {
      if (y >= sh[1]) return [side * 0.175, 0];
      if (y >= el[1]) {
        const t = (sh[1] - y) / (sh[1] - el[1]);
        return [sh[0] + (el[0] - sh[0]) * t, sh[2] + (el[2] - sh[2]) * t];
      }
      const t = (el[1] - y) / (el[1] - wr[1]);
      return [el[0] + (wr[0] - el[0]) * t, el[2] + (wr[2] - el[2]) * t];
    };
    const rings: Ring[] = [
      [0.93, 0.038],
      [0.97, 0.042],
      [1.04, 0.048],
      [1.12, 0.051],
      [1.165, 0.048],
      [1.2, 0.053],
      [1.28, 0.059],
      [1.36, 0.064],
      [1.42, 0.069],
      [1.47, 0.062],
    ].map(([y, r]) => {
      const [x, z] = cAt(y);
      return { y, x, z, w: r, f: r * 0.95, k: r * 0.95 };
    });
    const skin = (_x: number, y: number): [number, number, number] => {
      if (y > 1.36) return [BONE.chest, arm, smooth(1.48, 1.38, y)];
      if (y > 1.13) return [arm, fore, smooth(1.2, 1.13, y)];
      return [arm, fore, 1];
    };
    cloth.add(loft(THREE, rings, 16, 2), 0xffffff, U, skin);
    // elbow pad-free sleeve has a pocket on the upper arm
    cloth.add(at(roundBox(THREE, 0.018, 0.075, 0.07, 0.3, 2), sh[0] + side * 0.058, 1.33, 0.0), 0xffffff, U, rigid(arm));
  }

  // legs: combat pants with cargo pockets
  for (const side of [1, -1]) {
    const thigh = side > 0 ? BONE.thighR : BONE.thighL;
    const shin = side > 0 ? BONE.shinR : BONE.shinL;
    const rings: Ring[] = [
      [0.18, 0.052, 0.055, 0.058],
      [0.26, 0.056, 0.06, 0.064],
      [0.36, 0.066, 0.07, 0.074],
      [0.45, 0.066, 0.07, 0.072],
      [0.52, 0.064, 0.068, 0.068],
      [0.6, 0.07, 0.074, 0.075],
      [0.7, 0.08, 0.084, 0.086],
      [0.8, 0.088, 0.092, 0.096],
      [0.9, 0.094, 0.098, 0.104],
      [0.98, 0.094, 0.1, 0.106],
    ].map(([y, w, f, k]) => ({ y, x: side * (0.1 + (y > 0.51 ? 0 : 0.003)), z: 0, w, f, k }));
    const skin = (_x: number, y: number): [number, number, number] => {
      if (y > 0.84) return [BONE.hips, thigh, smooth(0.97, 0.85, y)];
      if (y > 0.46) return [thigh, shin, smooth(0.56, 0.47, y)];
      return [thigh, shin, 1];
    };
    cloth.add(loft(THREE, rings, 16, 2.1), 0xffffff, U, skin);
    cloth.add(at(roundBox(THREE, 0.03, 0.12, 0.11, 0.3, 2), side * 0.178, 0.72, 0.0), 0xffffff, U, rigid(thigh));
    // knee pads
    hard.add(at(roundBox(THREE, 0.1, 0.12, 0.045, 0.35, 2), side * 0.104, 0.5, -0.058, -0.05), o.pads, 0, rigid(shin));
    cloth.add(at(roundBox(THREE, 0.124, 0.022, 0.13, 0.3, 2), side * 0.104, 0.45, -0.005), o.gear, W, rigid(shin));
    // boots: shaft on the shin, foot and sole on the foot
    const foot = side > 0 ? BONE.footR : BONE.footL;
    const ax = side * 0.1;
    hard.add(at(new THREE.CylinderGeometry(0.056, 0.058, 0.17, 14), ax, 0.15, 0.012), o.boots, 0, rigid(shin));
    hard.add(at(roundBox(THREE, 0.102, 0.075, 0.26, 0.35, 2), ax, 0.045, -0.045), o.boots, 0, rigid(foot));
    hard.add(at(roundBox(THREE, 0.108, 0.024, 0.275, 0.3, 2), ax, 0.012, -0.046), 0x1a1918, 0, rigid(foot));
    hard.add(at(roundBox(THREE, 0.09, 0.03, 0.06, 0.4, 2), ax, 0.04, -0.17), o.boots, 0, rigid(foot));
  }

  // battle belt with pouches and a drop leg holster on the right thigh
  const belt: Ring[] = [
    { y: 0.955, x: 0, z: -0.004, w: 0.192, f: 0.118, k: 0.138 },
    { y: 1.005, x: 0, z: -0.004, w: 0.19, f: 0.116, k: 0.136 },
  ];
  cloth.add(loft(THREE, belt, 24), o.gear, W, rigid(BONE.hips));
  for (const [x, z, w] of [
    [-0.12, -0.12, 0.05],
    [-0.065, -0.135, 0.05],
  ])
    cloth.add(at(roundBox(THREE, w, 0.085, 0.04, 0.3, 2), x, 0.98, z), o.gear, W, rigid(BONE.hips));
  cloth.add(at(roundBox(THREE, 0.14, 0.09, 0.06, 0.3, 2), 0, 0.975, 0.16), o.gear, W, rigid(BONE.hips));
  cloth.add(at(roundBox(THREE, 0.07, 0.11, 0.06, 0.3, 2), -0.17, 0.95, 0.08), o.gear, W, rigid(BONE.hips));
  hard.add(at(roundBox(THREE, 0.045, 0.17, 0.09, 0.3, 2), 0.185, 0.8, 0.0, 0.08), 0x16171a, 0, rigid(BONE.thighR));
  hard.add(at(roundBox(THREE, 0.03, 0.07, 0.03, 0.3, 2), 0.188, 0.915, 0.022, -0.25), 0x1c1d20, 0, rigid(BONE.thighR));
  cloth.add(at(roundBox(THREE, 0.186, 0.03, 0.2, 0.2, 2), 0.1, 0.74, 0.0), o.gear, W, rigid(BONE.thighR));

  // plate carrier: front and back plates, cummerbund, shoulder straps
  const chest = rigid(BONE.chest);
  cloth.add(at(roundBox(THREE, 0.3, 0.33, 0.055, 0.3, 2), 0, 1.265, -0.148, 0.05), o.gear, W, chest);
  cloth.add(at(roundBox(THREE, 0.31, 0.36, 0.05, 0.3, 2), 0, 1.275, 0.145, -0.04), o.gear, W, chest);
  for (const s of [1, -1]) {
    cloth.add(at(roundBox(THREE, 0.05, 0.19, 0.27, 0.3, 2), s * 0.178, 1.2, -0.004), o.gear, W, chest);
    cloth.add(at(roundBox(THREE, 0.075, 0.032, 0.3, 0.3, 2), s * 0.1, 1.452, -0.002, 0, 0, s * -0.22), o.gear, W, chest);
  }
  // triple rifle mag pouch with the mags' base plates showing, an admin pouch and a patch above
  for (let i = -1; i <= 1; i++) {
    cloth.add(at(roundBox(THREE, 0.072, 0.11, 0.05, 0.3, 2), i * 0.078, 1.172, -0.195), o.gear, W, chest);
    hard.add(at(roundBox(THREE, 0.06, 0.03, 0.026, 0.3, 2), i * 0.078, 1.238, -0.196), 0x1d1e20, 0, chest);
  }
  cloth.add(at(roundBox(THREE, 0.2, 0.08, 0.032, 0.3, 2), 0, 1.33, -0.188), o.gear, W, chest);
  hard.add(at(roundBox(THREE, 0.08, 0.048, 0.006, 0.3, 2), 0, 1.342, -0.205), 0x3a3c3e, 0, chest);
  // radio pouch and whip antenna on the left, a tourniquet on the right strap
  cloth.add(at(roundBox(THREE, 0.06, 0.14, 0.075, 0.3, 2), -0.205, 1.25, 0.06), o.gear, W, chest);
  hard.add(at(roundBox(THREE, 0.05, 0.04, 0.06, 0.3, 2), -0.205, 1.335, 0.06), 0x161719, 0, chest);
  hard.add(at(new THREE.CylinderGeometry(0.0035, 0.005, 0.42, 6), -0.212, 1.56, 0.075, -0.12), 0x111214, 0, chest);
  hard.add(at(roundBox(THREE, 0.032, 0.1, 0.032, 0.35, 2), 0.11, 1.4, -0.135, 0.3), 0x1e1e20, 0, chest);
  // hydration carrier on the back
  cloth.add(at(roundBox(THREE, 0.24, 0.32, 0.06, 0.35, 2), 0, 1.265, 0.198), o.gear, W, chest);

  // gloves: palm, curled fingers, knuckle armor, cuff
  for (const side of [1, -1]) {
    const hand = rigid(side > 0 ? BONE.handR : BONE.handL);
    const wr = JOINT[side > 0 ? BONE.handR : BONE.handL];
    cloth.add(at(new THREE.CylinderGeometry(0.043, 0.04, 0.05, 12), wr[0], wr[1] + 0.005, wr[2]), o.gloves, K, hand);
    hard.add(at(roundBox(THREE, 0.034, 0.095, 0.085, 0.35, 2), wr[0], wr[1] - 0.07, wr[2] - 0.006), o.gloves, 0, hand);
    hard.add(at(roundBox(THREE, 0.04, 0.05, 0.08, 0.4, 2), wr[0] - side * 0.012, wr[1] - 0.135, wr[2] - 0.012, 0, 0, side * 0.5), o.gloves, 0, hand);
    hard.add(at(roundBox(THREE, 0.012, 0.03, 0.074, 0.35, 2), wr[0] + side * 0.02, wr[1] - 0.1, wr[2] - 0.006), o.knuckles, 0, hand);
    hard.add(at(roundBox(THREE, 0.024, 0.055, 0.026, 0.4, 2), wr[0] - side * 0.006, wr[1] - 0.075, wr[2] - 0.05, 0.4), o.gloves, 0, hand);
  }

  // helmet: shell (or its fabric cover), rails, shroud, counterweight, headset, glasses
  const helm = rigid(BONE.head);
  const shell = new THREE.SphereGeometry(0.128, 26, 12, 0, Math.PI * 2, 0, Math.PI * 0.5);
  shell.scale(1.02, 0.9, 1.1);
  shell.translate(0, 1.742, 0.006);
  if (o.cover) cloth.add(shell, 0xffffff, C, helm);
  else hard.add(shell, o.helmet, 0, helm);
  const rim = new THREE.CylinderGeometry(0.131, 0.133, 0.014, 26, 1, true);
  rim.scale(1.02, 1, 1.1);
  hard.add(at(rim, 0, 1.746, 0.006), o.cover ? 0x2e2f2c : o.helmet, 0, helm);
  for (const s of [1, -1]) {
    hard.add(at(roundBox(THREE, 0.012, 0.022, 0.13, 0.3, 2), s * 0.128, 1.754, 0.006), 0x1a1b1d, 0, helm);
    // ear cups and the boom mic on the right
    hard.add(at(new THREE.CylinderGeometry(0.04, 0.043, 0.036, 16), s * 0.104, 1.7, 0.012, 0, 0, Math.PI / 2), 0x1c1d1f, 0, helm);
  }
  hard.add(at(new THREE.CylinderGeometry(0.004, 0.004, 0.11, 6), 0.075, 1.665, -0.07, 1.2, 0.5), 0x111213, 0, helm);
  hard.add(at(roundBox(THREE, 0.046, 0.036, 0.022, 0.35, 2), 0, 1.81, -0.136, -0.3), 0x18191b, 0, helm);
  cloth.add(at(roundBox(THREE, 0.085, 0.045, 0.03, 0.35, 2), 0, 1.74, 0.142), o.gear, W, helm);
  cloth.add(at(roundBox(THREE, 0.07, 0.04, 0.008, 0.3, 2), 0, 1.862, 0.02, -0.1), o.gear, W, helm);
  const lens = new THREE.CylinderGeometry(0.104, 0.1, 0.034, 20, 1, true, Math.PI - 1.15, 2.3);
  lens.scale(1, 1, 1.08);
  glass.add(at(lens, 0, 1.722, 0.006), 0xffffff, 0, helm);
  hard.add(at(new THREE.CylinderGeometry(0.106, 0.106, 0.006, 20, 1, true, Math.PI - 1.2, 2.4).scale(1, 1, 1.08), 0, 1.741, 0.006), 0x111214, 0, helm);

  // one geometry, three groups: cloth, hard kit, glass
  const g = new THREE.BufferGeometry();
  const all = [cloth, hard, glass];
  const cat = (key: 'pos' | 'nor' | 'col' | 'kind' | 'si' | 'sw') => all.flatMap((a) => a[key]);
  g.setAttribute('position', new THREE.Float32BufferAttribute(cat('pos'), 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(cat('nor'), 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cat('col'), 3));
  g.setAttribute('aKind', new THREE.Float32BufferAttribute(cat('kind'), 1));
  g.setAttribute('skinIndex', new THREE.BufferAttribute(new Uint16Array(cat('si')), 4));
  g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(cat('sw'), 4));
  let start = 0;
  all.forEach((a, i) => {
    const n = a.pos.length / 3;
    if (n) g.addGroup(start, n, i);
    start += n;
  });
  g.computeBoundingSphere();
  return g;
}

/**
 * How a body is built and holds a gun: its joints in the bind pose, where a long gun's butt and a pistol's grip sit
 * (chest space), how far the shoulders turn behind a long gun (positive brings the left shoulder forward), the rest roll
 * of the thighs and arms (positive spreads them), and the turns that take each bind pose hand onto a firing grip, under
 * a handguard and round the firing hand on a pistol (quaternions).
 */
export type Build = {
  joints: V3[];
  butt: V3;
  pistol: V3;
  twist: number;
  splay: number;
  armRest: number;
  /** Where the wrist goes relative to the grip, the handguard and (support hand) a pistol's grip, in gun space. */
  gripAt: V3;
  foreAt: V3;
  cupAt: V3;
  grip?: [number, number, number, number];
  fore?: [number, number, number, number];
  cup?: [number, number, number, number];
};

/** The lofted soldier: hands modeled round a grip already. */
export const LOFT_BUILD: Build = { joints: JOINT, butt: [0.115, 0.16, -0.05], pistol: [0.03, 0.17, -0.44], twist: 0, splay: 0.03, armRest: 0.12, gripAt: [0.024, 0.02, 0], foreAt: [-0.022, 0.015, 0], cupAt: [-0.03, 0.015, 0] };

/** Quaternion turning the frame (a, b, a x b) onto (a2, b2, a2 x b2): a hand's finger and palm directions. */
function turn(a: V3, b: V3, a2: V3, b2: V3): [number, number, number, number] {
  const n = (v: V3): V3 => {
    const l = Math.hypot(v[0], v[1], v[2]);
    return [v[0] / l, v[1] / l, v[2] / l];
  };
  const cross = (u: V3, v: V3): V3 => [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
  const fr = (x: V3, y: V3) => {
    const u = n(x);
    const c = n(cross(u, y));
    return [u, cross(c, u), c];
  };
  const [u0, v0, w0] = fr(a, b);
  const [u1, v1, w1] = fr(a2, b2);
  // R = F1 * F0^T, then to a quaternion
  const m = [0, 1, 2].map((r) => [0, 1, 2].map((c) => u1[r] * u0[c] + v1[r] * v0[c] + w1[r] * w0[c]));
  const tr = m[0][0] + m[1][1] + m[2][2];
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    return [(m[2][1] - m[1][2]) / s, (m[0][2] - m[2][0]) / s, (m[1][0] - m[0][1]) / s, s / 4];
  }
  if (m[0][0] > m[1][1] && m[0][0] > m[2][2]) {
    const s = Math.sqrt(1 + m[0][0] - m[1][1] - m[2][2]) * 2;
    return [s / 4, (m[0][1] + m[1][0]) / s, (m[0][2] + m[2][0]) / s, (m[2][1] - m[1][2]) / s];
  }
  if (m[1][1] > m[2][2]) {
    const s = Math.sqrt(1 + m[1][1] - m[0][0] - m[2][2]) * 2;
    return [(m[0][1] + m[1][0]) / s, s / 4, (m[1][2] + m[2][1]) / s, (m[0][2] - m[2][0]) / s];
  }
  const s = Math.sqrt(1 + m[2][2] - m[0][0] - m[1][1]) * 2;
  return [(m[0][2] + m[2][0]) / s, (m[1][2] + m[2][1]) / s, s / 4, (m[1][0] - m[0][1]) / s];
}

/**
 * The real soldier model (models/soldier.glb), skinned to these joints by the bake: it stands in a loose A pose, arms
 * hanging out from a bulky plate carrier, fingers down and palms in.
 */
export const SOLDIER_BUILD: Build = {
  joints: [
    [0, 0, 0],
    [0, 0.95, 0.01],
    [0, 1.12, 0],
    [0, 1.32, -0.01],
    [0, 1.52, -0.04],
    [0, 1.6, -0.08],
    [0.07, 1.44, 0],
    [0.25, 1.42, 0.03],
    [0.39, 1.17, 0.06],
    [0.445, 0.93, -0.06],
    [-0.07, 1.44, 0],
    [-0.25, 1.42, 0.03],
    [-0.39, 1.17, 0.06],
    [-0.445, 0.93, -0.06],
    [0.11, 0.93, 0.01],
    [0.245, 0.54, -0.05],
    [0.33, 0.12, 0.05],
    [-0.11, 0.93, 0.01],
    [-0.245, 0.54, -0.05],
    [-0.33, 0.12, 0.05],
  ],
  butt: [0.16, 0.12, -0.17],
  pistol: [0.03, 0.13, -0.5],
  twist: 0.5,
  splay: -0.13,
  armRest: -0.2,
  gripAt: [0.03, 0.035, 0.065],
  foreAt: [-0.045, -0.035, 0.06],
  cupAt: [-0.035, 0, 0.07],
  // firing hand: fingers from hanging down to forward along the grip, palm still facing in
  grip: turn([0, -0.9, -0.4], [-1, 0, 0], [0, -0.35, -0.94], [-1, 0, 0]),
  // support hand: palm up under the handguard, fingers forward and across
  fore: turn([0, -0.9, -0.4], [1, 0, 0], [0.55, 0.1, -0.83], [0, 1, 0]),
  // support hand on a pistol: wrapped round the firing hand from the left
  cup: turn([0, -0.9, -0.4], [1, 0, 0], [0.35, -0.45, -0.82], [1, 0.2, 0]),
};

/** A skeleton in the bind pose. */
export function skeleton(THREE: Three, joints: V3[] = JOINT) {
  const bones = joints.map(() => new THREE.Bone());
  bones.forEach((b, i) => {
    const p = PARENT[i];
    const j = joints[i];
    const pj = p >= 0 ? joints[p] : [0, 0, 0];
    b.position.set(j[0] - pj[0], j[1] - pj[1], j[2] - pj[2]);
    if (p >= 0) bones[p].add(b);
  });
  return { bones, skeleton: new THREE.Skeleton(bones) };
}

export type Pose = {
  pitch: number;
  crouch: number;
  /** 0 standing to 1 at a run. */
  speed: number;
  phase: number;
  air: boolean;
  dead: boolean;
  /** Gun in hand, or none. */
  gun: GunModel | null;
  pistol: boolean;
};

/** Poses one soldier's bones (the gun group, a child of the chest bone, is placed too). */
export function makePoser(THREE: Three, build: Build = LOFT_BUILD) {
  const JOINT = build.joints;
  const v = () => new THREE.Vector3();
  const q = () => new THREE.Quaternion();
  const S = v();
  const E = v();
  const Tt = v();
  const dir = v();
  const pole = v();
  const tmp = v();
  const qa = q();
  const qb = q();
  const qc = q();
  const qGun = q();
  const xAxis = new THREE.Vector3(1, 0, 0);
  const bindUpper = [BONE.armR, BONE.armL].map((a, i) => {
    const s = JOINT[a];
    const e = JOINT[i === 0 ? BONE.foreR : BONE.foreL];
    return new THREE.Vector3(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
  });
  const bindFore = [BONE.foreR, BONE.foreL].map((a, i) => {
    const s = JOINT[a];
    const e = JOINT[i === 0 ? BONE.handR : BONE.handL];
    return new THREE.Vector3(e[0] - s[0], e[1] - s[1], e[2] - s[2]);
  });
  const L1 = bindUpper.map((b) => b.length());
  const L2 = bindFore.map((b) => b.length());
  bindUpper.forEach((b) => b.normalize());
  bindFore.forEach((b) => b.normalize());
  // shoulders in chest space (the clavicles keep their bind rotation)
  const shoulder = [BONE.armR, BONE.armL].map((a) => new THREE.Vector3(JOINT[a][0] - JOINT[BONE.chest][0], JOINT[a][1] - JOINT[BONE.chest][1], JOINT[a][2] - JOINT[BONE.chest][2]));
  /** Two bone IK in chest space: upper arm and forearm reach T, the elbow bends toward the pole. */
  const reach = (bones: T.Bone[], side: number, target: T.Vector3, poleDir: T.Vector3, hand: T.Quaternion) => {
    const i = side > 0 ? 0 : 1;
    const up = bones[side > 0 ? BONE.armR : BONE.armL];
    const fore = bones[side > 0 ? BONE.foreR : BONE.foreL];
    const hb = bones[side > 0 ? BONE.handR : BONE.handL];
    S.copy(shoulder[i]);
    dir.copy(target).sub(S);
    let d = dir.length();
    const a1 = L1[i];
    const a2 = L2[i];
    d = Math.min(a1 + a2 - 0.002, Math.max(Math.abs(a1 - a2) + 0.002, d));
    dir.normalize();
    const cos = (a1 * a1 + d * d - a2 * a2) / (2 * a1 * d);
    const ang = Math.acos(Math.min(1, Math.max(-1, cos)));
    pole.copy(poleDir).addScaledVector(dir, -poleDir.dot(dir)).normalize();
    E.copy(S)
      .addScaledVector(dir, Math.cos(ang) * a1)
      .addScaledVector(pole, Math.sin(ang) * a1);
    tmp.copy(E).sub(S).normalize();
    qa.setFromUnitVectors(bindUpper[i], tmp);
    up.quaternion.copy(qa);
    Tt.copy(S).addScaledVector(dir, d);
    tmp.copy(Tt).sub(E).normalize().applyQuaternion(qb.copy(qa).invert());
    fore.quaternion.setFromUnitVectors(bindFore[i], tmp);
    // the hand takes the gun's orientation, expressed under its arm
    qc.copy(qa).multiply(fore.quaternion).invert();
    hb.quaternion.copy(qc).multiply(hand);
  };
  const poleR = new THREE.Vector3(0.75, -0.9, 0.35);
  const poleL = new THREE.Vector3(-0.8, -1, 0.2);
  const target = v();
  const handQ = q();
  const qYaw = q();
  const yAxis = new THREE.Vector3(0, 1, 0);
  const offset = (o?: [number, number, number, number]) => (o ? new THREE.Quaternion(o[0], o[1], o[2], o[3]) : new THREE.Quaternion());
  const gripQ = offset(build.grip);
  const foreQ = offset(build.fore);
  const cupQ = offset(build.cup);
  const hipY = JOINT[BONE.hips];
  return (bones: T.Bone[], gunGroup: T.Object3D | null, p: Pose) => {
    for (const b of bones) b.quaternion.identity();
    const hipsB = bones[BONE.hips];
    hipsB.position.set(hipY[0], hipY[1], hipY[2]);
    if (p.dead) {
      // limp: arms out, knees a little bent
      bones[BONE.armR].rotation.set(0.3, 0, 1.1 + build.armRest - 0.12);
      bones[BONE.armL].rotation.set(0.3, 0, -1.1 - build.armRest + 0.12);
      bones[BONE.foreR].rotation.set(0.4, 0, 0);
      bones[BONE.foreL].rotation.set(0.2, 0, 0);
      bones[BONE.thighR].rotation.set(0.1, 0, 0.12 + build.splay);
      bones[BONE.thighL].rotation.set(-0.05, 0, -0.1 - build.splay);
      bones[BONE.shinR].rotation.set(-0.3, 0, 0);
      bones[BONE.shinL].rotation.set(-0.15, 0, 0);
      bones[BONE.head].rotation.set(0.3, 0.4, 0);
      if (gunGroup) gunGroup.visible = false;
      return;
    }
    const sp = p.speed;
    const ph = p.phase * 2.2;
    const air = p.air ? 1 : 0;
    const bob = Math.abs(Math.sin(ph)) * 0.04 * sp * (1 - p.crouch * 0.5);
    hipsB.position.y += -p.crouch * 0.33 - air * 0.06 + bob;
    const hipLean = -0.08 * sp - p.crouch * 0.32;
    hipsB.rotation.x = hipLean;
    bones[BONE.hips].rotation.y = Math.sin(ph) * 0.06 * sp;
    const spineX = p.pitch * 0.25 + p.crouch * 0.2;
    const chestX = p.pitch * 0.15;
    // behind a long gun the shoulders blade (left one forward), the head turns back to the aim
    const twist = p.gun && !p.pistol ? build.twist : 0;
    bones[BONE.spine].rotation.x = spineX;
    bones[BONE.spine].rotation.y = -Math.sin(ph) * 0.05 * sp - twist * 0.5;
    bones[BONE.chest].rotation.x = chestX;
    bones[BONE.chest].rotation.y = -twist * 0.5;
    const bodyPitch = hipLean + spineX + chestX;
    bones[BONE.neck].rotation.set((p.pitch - bodyPitch) * 0.45, twist * 0.45, 0);
    bones[BONE.head].rotation.set((p.pitch - bodyPitch) * 0.55, twist * 0.55, 0);
    // legs: a walk cycle, bent for a crouch, tucked in the air
    for (const side of [1, -1]) {
      const s = Math.sin(ph + (side > 0 ? 0 : Math.PI));
      const swing = s * 0.55 * sp + p.crouch * 1.05 + air * 0.4 - hipLean;
      const knee = Math.max(0, -Math.cos(ph + (side > 0 ? 0 : Math.PI))) * 0.95 * sp + p.crouch * 1.85 + air * 0.75;
      bones[side > 0 ? BONE.thighR : BONE.thighL].rotation.set(swing, 0, side * build.splay);
      bones[side > 0 ? BONE.shinR : BONE.shinL].rotation.x = -knee;
      bones[side > 0 ? BONE.footR : BONE.footL].rotation.x = knee - swing - hipLean * 0.5;
    }
    if (!gunGroup || !p.gun) {
      bones[BONE.armR].rotation.set(0.15, 0, build.armRest);
      bones[BONE.armL].rotation.set(0.15, 0, -build.armRest);
      return;
    }
    // the gun shouldered (or held out, for a pistol) along the aim, then both hands onto it
    const g = p.gun;
    gunGroup.visible = true;
    const gunPitch = p.pitch - bodyPitch;
    qGun.setFromAxisAngle(xAxis, gunPitch);
    if (twist) qGun.premultiply(qYaw.setFromAxisAngle(yAxis, twist));
    gunGroup.quaternion.copy(qGun);
    if (p.pistol) {
      target.set(build.pistol[0], build.pistol[1], build.pistol[2]);
      tmp.set(g.grip[0], g.grip[1], g.grip[2]).applyQuaternion(qGun);
    } else {
      target.set(build.butt[0], build.butt[1], build.butt[2]);
      tmp.set(g.butt[0], g.butt[1], g.butt[2]).applyQuaternion(qGun);
    }
    gunGroup.position.copy(target).sub(tmp);
    const a = build.gripAt;
    handQ.copy(qGun).multiply(gripQ);
    target.set(g.grip[0] + a[0], g.grip[1] + a[1], g.grip[2] + a[2]).applyQuaternion(qGun).add(gunGroup.position);
    reach(bones, 1, target, poleR, handQ);
    const f = p.pistol ? build.cupAt : build.foreAt;
    const at = p.pistol ? g.grip : g.fore;
    handQ.copy(qGun).multiply(p.pistol ? cupQ : foreQ);
    target.set(at[0] + f[0], at[1] + f[1], at[2] + f[2]).applyQuaternion(qGun).add(gunGroup.position);
    reach(bones, -1, target, poleL, handQ);
  };
}
