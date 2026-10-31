// The guns, modeled like the real thing: side profiles of receivers, grips, stocks and curved magazines extruded with
// beveled edges, lathe turned barrels, muzzle devices and scopes, Picatinny rails with their teeth, M-LOK slots, a
// holographic sight you can look through. One model per gun, shared by the first person view and every soldier.
// Built in gun space: forward is -z, up is +y, the origin sits on the bore line above the trigger.
import type { Assets, AssetKey } from '../assets.ts';
import type { WeaponId } from '../weapons.ts';
import { lin, roundBox, type T, type Three } from './common.ts';
import { GUN_LOOK, type GunMat } from './gear.ts';
import { bakeModel, type Part } from './models.ts';

type Pt = [number, number] | ['q', number, number, number, number];

export type GunModel = {
  id: WeaponId;
  /** Merged geometry per material. */
  geos: Partial<Record<GunMat, T.BufferGeometry>>;
  /** Height of the sight line above the origin. */
  sight: number;
  /** Where the hands go: the firing grip and the support hand. */
  grip: [number, number, number];
  fore: [number, number, number];
  muzzle: [number, number, number];
  /** Where the butt meets the shoulder (third person hold). */
  butt: [number, number, number];
  /** The support hand holds a vertical grip (else it cups the handguard from below). */
  vertical?: boolean;
  /** A real model: its parts for the first person view, and one vertex colored geometry for other soldiers' hands. */
  real?: { fp: Part[]; lite: T.BufferGeometry | null };
};

/** Collects parts per material, in (side s, up u, forward f) coordinates. */
class Builder {
  THREE: Three;
  parts = new Map<GunMat, T.BufferGeometry[]>();
  constructor(THREE: Three) {
    this.THREE = THREE;
  }
  private push(mat: GunMat, g: T.BufferGeometry) {
    let list = this.parts.get(mat);
    if (!list) this.parts.set(mat, (list = []));
    list.push(g);
  }
  /** A rounded box: size across, up, along; center; pitch lifts the front. */
  box(mat: GunMat, w: number, h: number, l: number, s: number, u: number, f: number, pitch = 0, round = 0.25, yaw = 0) {
    const g = Math.min(w, h, l) < 0.004 ? new this.THREE.BoxGeometry(w, h, l) : roundBox(this.THREE, w, h, l, round);
    if (pitch) g.rotateX(pitch);
    if (yaw) g.rotateY(yaw);
    g.translate(s, u, -f);
    this.push(mat, g);
  }
  /** A cylinder along the bore, centered at f; r2 is the front radius. */
  tube(mat: GunMat, r: number, len: number, s: number, u: number, f: number, segs = 18, r2 = r) {
    const g = new this.THREE.CylinderGeometry(r2, r, len, segs);
    g.rotateX(-Math.PI / 2);
    g.translate(s, u, -f);
    this.push(mat, g);
  }
  /** A cylinder across (axis 's') or upright (axis 'u'). */
  post(mat: GunMat, r: number, len: number, s: number, u: number, f: number, axis: 's' | 'u', segs = 14) {
    const g = new this.THREE.CylinderGeometry(r, r, len, segs);
    if (axis === 's') g.rotateZ(Math.PI / 2);
    g.translate(s, u, -f);
    this.push(mat, g);
  }
  ball(mat: GunMat, r: number, s: number, u: number, f: number) {
    const g = new this.THREE.SphereGeometry(r, 12, 8);
    g.translate(s, u, -f);
    this.push(mat, g);
  }
  /** A side profile (points in forward, up) extruded t thick across, beveled. */
  side(mat: GunMat, pts: Pt[], t: number, s = 0, bevel = 0.002) {
    const shape = new this.THREE.Shape();
    pts.forEach((p, i) => {
      if (p[0] === 'q') shape.quadraticCurveTo(p[1], p[2], p[3], p[4]);
      else if (i === 0) shape.moveTo(p[0], p[1]);
      else shape.lineTo(p[0], p[1]);
    });
    shape.closePath();
    const b = Math.min(bevel, t * 0.3);
    const g = new this.THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0005, t - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 2, curveSegments: 10 });
    g.translate(0, 0, -(t - 2 * b) / 2);
    g.rotateY(Math.PI / 2);
    g.translate(s, 0, 0);
    this.push(mat, g);
  }
  /** A turned part: [radius, forward] pairs, around the bore line at (s, u). */
  lathe(mat: GunMat, prof: [number, number][], s: number, u: number, segs = 24) {
    const g = new this.THREE.LatheGeometry(
      prof.map(([r, f]) => new this.THREE.Vector2(r, f)),
      segs,
    );
    g.rotateX(-Math.PI / 2);
    g.translate(s, u, 0);
    this.push(mat, g);
  }
  /** Picatinny rail on top, from f0 to f1, its base resting at height u. */
  rail(mat: GunMat, f0: number, f1: number, u: number, w = 0.021) {
    this.box(mat, w, 0.006, f1 - f0, 0, u + 0.003, (f0 + f1) / 2, 0, 0.15);
    for (let f = f0 + 0.004; f < f1 - 0.004; f += 0.01) this.box(mat, w + 0.001, 0.0035, 0.0052, 0, u + 0.0075, f, 0, 0);
  }
  /** M-LOK style slots along a handguard: dark recesses on both sides and the bottom. */
  slots(f0: number, f1: number, halfW: number, uMid: number, bottom: number) {
    for (let f = f0; f < f1; f += 0.04) {
      this.box('polymer', 0.0015, 0.0085, 0.03, halfW + 0.0002, uMid, f + 0.016, 0, 0);
      this.box('polymer', 0.0015, 0.0085, 0.03, -halfW - 0.0002, uMid, f + 0.016, 0, 0);
      this.box('polymer', 0.0085, 0.0015, 0.03, 0, bottom - 0.0002, f + 0.016, 0, 0);
    }
  }
  build(): Partial<Record<GunMat, T.BufferGeometry>> {
    const out: Partial<Record<GunMat, T.BufferGeometry>> = {};
    for (const [mat, list] of this.parts) {
      const flat = list.map((g) => (g.index ? g.toNonIndexed() : g));
      const n = flat.reduce((a, g) => a + g.attributes.position.count, 0);
      const pos = new Float32Array(n * 3);
      const nor = new Float32Array(n * 3);
      let o = 0;
      for (const g of flat) {
        if (!g.attributes.normal) g.computeVertexNormals();
        pos.set(g.attributes.position.array as Float32Array, o * 3);
        nor.set(g.attributes.normal.array as Float32Array, o * 3);
        o += g.attributes.position.count;
      }
      const geo = new this.THREE.BufferGeometry();
      geo.setAttribute('position', new this.THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new this.THREE.BufferAttribute(nor, 3));
      geo.computeBoundingSphere();
      out[mat] = geo;
      for (const g of list) g.dispose();
      for (const g of flat) g.dispose();
    }
    return out;
  }
}

/** A holographic sight on a rail at height u, centered at f: hood, window frames, a pane and the dot. Returns sight height. */
function holo(b: Builder, f: number, u: number) {
  b.box('anodized', 0.032, 0.012, 0.07, 0, u + 0.006, f, 0, 0.2);
  b.box('anodized', 0.036, 0.007, 0.066, 0, u + 0.047, f, 0, 0.3);
  for (const s of [-1, 1]) b.box('anodized', 0.006, 0.04, 0.062, s * 0.0165, u + 0.028, f, 0, 0.3);
  for (const ff of [f - 0.03, f + 0.03]) {
    b.box('anodized', 0.036, 0.005, 0.005, 0, u + 0.0125, ff, 0, 0.2);
  }
  b.box('lens', 0.026, 0.028, 0.0015, 0, u + 0.028, f + 0.028, 0, 0);
  // circle and dot reticle
  b.box('dot', 0.0014, 0.0014, 0.0004, 0, u + 0.028, f + 0.0265, 0, 0);
  for (let k = 0; k < 16; k++) {
    const a = (k / 16) * Math.PI * 2;
    b.box('dot', 0.0011, 0.0011, 0.0004, Math.cos(a) * 0.0085, u + 0.028 + Math.sin(a) * 0.0085, f + 0.0265, 0, 0);
  }
  b.box('polymer', 0.008, 0.007, 0.012, 0.018, u + 0.02, f - 0.022, 0, 0.3);
  b.box('polymer', 0.008, 0.007, 0.012, 0.018, u + 0.02, f - 0.006, 0, 0.3);
  return u + 0.028;
}

/** A tube red dot. Returns the sight height. */
function reddot(b: Builder, f: number, u: number) {
  b.box('anodized', 0.026, 0.012, 0.04, 0, u + 0.006, f, 0, 0.2);
  b.lathe('anodized', [[0.012, f - 0.024], [0.0155, f - 0.024], [0.0155, f + 0.026], [0.012, f + 0.026], [0.012, f - 0.024]], 0, u + 0.03, 20);
  b.post('anodized', 0.006, 0.008, 0.016, u + 0.03, f, 's');
  b.box('lens', 0.022, 0.022, 0.001, 0, u + 0.03, f + 0.02, 0, 0);
  b.box('dot', 0.0016, 0.0016, 0.0004, 0, u + 0.03, f + 0.019, 0, 0);
  return u + 0.03;
}

/** A rifle scope: eyepiece, tube, turrets, objective bell, lenses, rings. Returns the sight height. */
function scope(b: Builder, f0: number, f1: number, u: number, bell: number, tube = 0.015) {
  const axis = u + bell + 0.006;
  const mid = (f0 + f1) / 2;
  b.lathe(
    'anodized',
    [
      [0.001, f0],
      [bell * 0.82, f0],
      [bell * 0.85, f0 + 0.05],
      [tube, f0 + 0.085],
      [tube, f1 - 0.1],
      [bell, f1 - 0.03],
      [bell, f1],
      [0.001, f1],
    ],
    0,
    axis,
    26,
  );
  b.post('anodized', 0.011, 0.024, 0, axis + tube + 0.009, mid, 'u', 16);
  b.post('anodized', 0.011, 0.024, tube + 0.009, axis, mid, 's', 16);
  b.post('anodized', 0.008, 0.016, -tube - 0.006, axis, mid + 0.012, 's', 14);
  b.lathe('glass', [[0.001, f1 + 0.0006], [bell * 0.88, f1 + 0.0006]], 0, axis, 24);
  b.lathe('glass', [[0.001, f0 - 0.0006], [bell * 0.78, f0 - 0.0006]], 0, axis, 24);
  for (const f of [mid - 0.045, mid + 0.04]) {
    b.lathe('anodized', [[tube + 0.0005, f - 0.009], [tube + 0.004, f - 0.009], [tube + 0.004, f + 0.009], [tube + 0.0005, f + 0.009]], 0, axis, 20);
    b.box('anodized', 0.022, axis - tube - u, 0.018, 0, (u + axis - tube) / 2, f, 0, 0.15);
  }
  return axis;
}

function kestrel(b: Builder): Omit<GunModel, 'id' | 'geos'> {
  // upper receiver, ejection port, forward assist, charging handle
  b.box('anodized', 0.026, 0.044, 0.25, 0, 0.007, 0);
  b.box('polymer', 0.0016, 0.015, 0.066, 0.0136, 0.007, 0.02, 0, 0);
  b.tube('anodized', 0.0068, 0.03, 0.0165, 0.017, -0.075);
  b.box('anodized', 0.034, 0.008, 0.02, 0, 0.027, -0.13, 0, 0.3);
  // lower receiver with the magwell flare
  b.side('anodized', [[-0.13, -0.015], [0.1, -0.015], [0.1, -0.03], [0.09, -0.035], [0.087, -0.072], [0.094, -0.079], [0.024, -0.079], [0.028, -0.035], [-0.1, -0.035], [-0.132, -0.026]], 0.025);
  // trigger guard and trigger
  b.box('anodized', 0.012, 0.0045, 0.072, 0, -0.062, -0.022, 0, 0.2);
  b.box('anodized', 0.012, 0.026, 0.005, 0, -0.049, 0.012, 0, 0.2);
  b.box('steel', 0.004, 0.022, 0.006, 0, -0.047, -0.016, -0.35, 0);
  // pistol grip
  b.side('fde', [[-0.03, -0.034], [-0.064, -0.034], [-0.101, -0.124], [-0.093, -0.134], [-0.066, -0.131], ['q', -0.05, -0.08, -0.03, -0.05]], 0.027, 0, 0.004);
  // curved magazine with a base plate
  b.side('fde', [[0.03, -0.03], ['q', 0.034, -0.13, 0.054, -0.207], [0.114, -0.198], ['q', 0.103, -0.12, 0.09, -0.03]], 0.0235, 0, 0.003);
  b.box('polymer', 0.029, 0.012, 0.066, 0, -0.208, 0.084, 0.16, 0.3);
  for (const u of [-0.07, -0.11, -0.15]) b.box('fde', 0.025, 0.004, 0.044, 0, u, 0.062 + (u + 0.07) * -0.18, 0.12, 0.3);
  // buffer tube and stock with butt pad
  b.tube('anodized', 0.0145, 0.21, 0, 0.004, -0.23);
  b.side('fde', [[-0.17, 0.03], [-0.33, 0.036], [-0.334, -0.076], [-0.312, -0.082], ['q', -0.27, -0.035, -0.19, -0.024], [-0.17, -0.02]], 0.037, 0, 0.005);
  b.box('rubber', 0.039, 0.115, 0.014, 0, -0.02, -0.34, 0, 0.3);
  // free float handguard with slots, top rail, flip-up sights folded
  b.box('anodized', 0.043, 0.047, 0.32, 0, 0.006, 0.29, 0, 0.4);
  b.slots(0.16, 0.42, 0.0215, 0.004, -0.0175);
  b.rail('anodized', -0.124, 0.448, 0.029);
  b.box('anodized', 0.018, 0.009, 0.026, 0, 0.041, 0.42, 0, 0.2);
  b.box('anodized', 0.018, 0.009, 0.026, 0, 0.041, -0.1, 0, 0.2);
  // angled foregrip
  b.side('polymer', [[0.29, -0.017], [0.37, -0.017], [0.345, -0.05], [0.3, -0.05]], 0.022, 0, 0.004);
  // barrel and a three port brake
  b.tube('steel', 0.0085, 0.17, 0, 0, 0.535);
  b.lathe('steel', [[0.001, 0.615], [0.0118, 0.615], [0.0118, 0.666], [0.009, 0.672], [0.001, 0.672]], 0, 0);
  for (const f of [0.628, 0.641, 0.654]) {
    b.box('polymer', 0.025, 0.0035, 0.006, 0, 0.007, f, 0, 0);
    b.box('polymer', 0.025, 0.0035, 0.006, 0, -0.007, f, 0, 0);
  }
  const sight = holo(b, 0.02, 0.0355);
  return { sight, grip: [0, -0.085, 0.07], fore: [0, -0.04, -0.33], muzzle: [0, 0, -0.68], butt: [0, -0.02, 0.34] };
}

function lancer(b: Builder): Omit<GunModel, 'id' | 'geos'> {
  b.box('anodized', 0.03, 0.05, 0.3, 0, 0.008, 0);
  b.box('polymer', 0.0016, 0.017, 0.08, 0.0156, 0.008, 0.02, 0, 0);
  b.side('anodized', [[-0.15, -0.017], [0.12, -0.017], [0.12, -0.034], [0.108, -0.04], [0.104, -0.084], [0.112, -0.091], [0.03, -0.091], [0.034, -0.04], [-0.12, -0.04], [-0.152, -0.03]], 0.028);
  b.box('anodized', 0.013, 0.0045, 0.075, 0, -0.068, -0.024, 0, 0.2);
  b.box('steel', 0.004, 0.022, 0.006, 0, -0.052, -0.018, -0.35, 0);
  b.side('polymer', [[-0.036, -0.038], [-0.07, -0.038], [-0.106, -0.13], [-0.098, -0.14], [-0.07, -0.137], ['q', -0.054, -0.085, -0.036, -0.055]], 0.028, 0, 0.004);
  // straight 20 round magazine
  b.side('polymer', [[0.036, -0.035], [0.042, -0.19], [0.112, -0.19], [0.106, -0.035]], 0.026, 0, 0.003);
  b.box('polymer', 0.031, 0.012, 0.076, 0, -0.194, 0.077, 0, 0.3);
  // precision stock with cheek riser
  b.tube('anodized', 0.016, 0.16, 0, 0.004, -0.23);
  b.side('od', [[-0.19, 0.04], [-0.36, 0.044], [-0.362, -0.085], [-0.33, -0.09], ['q', -0.28, -0.05, -0.2, -0.03], [-0.19, -0.02]], 0.04, 0, 0.005);
  b.box('od', 0.03, 0.02, 0.12, 0, 0.052, -0.28, 0, 0.4);
  b.box('rubber', 0.042, 0.13, 0.014, 0, -0.022, -0.368, 0, 0.3);
  b.box('anodized', 0.047, 0.05, 0.4, 0, 0.007, 0.35, 0, 0.4);
  b.slots(0.18, 0.52, 0.0235, 0.005, -0.0185);
  b.rail('anodized', -0.15, 0.55, 0.033);
  // folded bipod under the handguard
  b.box('anodized', 0.03, 0.014, 0.03, 0, -0.024, 0.5, 0, 0.3);
  for (const s of [-1, 1]) b.tube('anodized', 0.0045, 0.17, s * 0.009, -0.03, 0.42);
  b.tube('steel', 0.0095, 0.27, 0, 0, 0.685, 18, 0.008);
  b.lathe('steel', [[0.001, 0.82], [0.012, 0.82], [0.012, 0.872], [0.001, 0.872]], 0, 0);
  for (const f of [0.832, 0.846, 0.86]) b.box('polymer', 0.0255, 0.004, 0.006, 0, 0.007, f, 0, 0);
  const sight = scope(b, -0.13, 0.17, 0.0395, 0.021);
  return { sight, grip: [0, -0.09, 0.075], fore: [0, -0.014, -0.36], muzzle: [0, 0, -0.88], butt: [0, -0.022, 0.37] };
}

function longbow(b: Builder): Omit<GunModel, 'id' | 'geos'> {
  // round receiver and bolt with its handle and knob
  b.tube('steel', 0.019, 0.27, 0, 0.004, 0.0);
  b.tube('anodized', 0.012, 0.06, 0, 0.004, -0.16);
  b.post('steel', 0.004, 0.05, 0.03, 0.002, -0.07, 's');
  b.ball('polymer', 0.009, 0.056, 0.0, -0.07);
  // chassis: forend, grip, skeleton stock with cheek piece
  b.box('od', 0.054, 0.05, 0.4, 0, -0.012, 0.3, 0, 0.35);
  b.box('od', 0.05, 0.04, 0.3, 0, -0.022, 0.0, 0, 0.35);
  b.side('od', [[-0.04, -0.04], [-0.075, -0.04], [-0.11, -0.13], [-0.1, -0.142], [-0.07, -0.139], ['q', -0.056, -0.09, -0.04, -0.06]], 0.03, 0, 0.004);
  b.side('od', [[-0.14, 0.012], [-0.45, 0.03], [-0.452, -0.1], [-0.42, -0.106], [-0.38, -0.06], [-0.24, -0.055], [-0.2, -0.03], [-0.14, -0.035]], 0.042, 0, 0.005);
  b.box('od', 0.032, 0.024, 0.14, 0, 0.046, -0.3, 0, 0.4);
  b.box('rubber', 0.044, 0.14, 0.016, 0, -0.036, -0.458, 0, 0.3);
  b.box('anodized', 0.012, 0.0045, 0.07, 0, -0.07, -0.02, 0, 0.2);
  b.box('steel', 0.004, 0.022, 0.006, 0, -0.054, -0.018, -0.35, 0);
  // 5 round box magazine
  b.box('polymer', 0.03, 0.07, 0.085, 0, -0.065, 0.075, 0, 0.25);
  // heavy barrel with a big brake
  b.tube('steel', 0.0125, 0.5, 0, 0.004, 0.75, 20, 0.011);
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    b.box('polymer', 0.002, 0.002, 0.26, Math.cos(a) * 0.0122, 0.004 + Math.sin(a) * 0.0122, 0.66, 0, 0);
  }
  b.lathe('steel', [[0.001, 1.0], [0.017, 1.0], [0.017, 1.07], [0.014, 1.078], [0.001, 1.078]], 0, 0.004);
  for (const f of [1.015, 1.032, 1.049]) b.box('polymer', 0.035, 0.005, 0.009, 0, 0.012, f, 0, 0);
  b.rail('anodized', -0.11, 0.2, 0.022);
  for (const s of [-1, 1]) b.tube('anodized', 0.005, 0.2, s * 0.012, -0.042, 0.42);
  const sight = scope(b, -0.15, 0.24, 0.028, 0.029, 0.017);
  return { sight, grip: [0, -0.09, 0.09], fore: [0, -0.03, -0.32], muzzle: [0, 0.004, -1.08], butt: [0, -0.03, 0.46] };
}

function hornet(b: Builder): Omit<GunModel, 'id' | 'geos'> {
  b.box('anodized', 0.03, 0.05, 0.3, 0, 0.004, 0.03);
  b.box('polymer', 0.0016, 0.015, 0.05, 0.0156, 0.006, 0.05, 0, 0);
  b.side('polymer', [[-0.12, -0.02], [0.13, -0.02], [0.13, -0.035], [0.075, -0.04], [0.074, -0.075], [0.022, -0.075], [0.024, -0.04], [-0.12, -0.032]], 0.03);
  b.side('polymer', [[-0.025, -0.036], [-0.06, -0.036], [-0.095, -0.122], [-0.087, -0.132], [-0.062, -0.129], ['q', -0.045, -0.08, -0.025, -0.05]], 0.028, 0, 0.004);
  b.box('polymer', 0.012, 0.0045, 0.065, 0, -0.06, -0.012, 0, 0.2);
  b.box('steel', 0.004, 0.02, 0.006, 0, -0.045, -0.01, -0.35, 0);
  // slight curve 9 mm magazine
  b.side('polymer', [[0.027, -0.04], ['q', 0.03, -0.12, 0.04, -0.2], [0.086, -0.196], ['q', 0.077, -0.12, 0.07, -0.04]], 0.022, 0, 0.003);
  b.box('polymer', 0.026, 0.01, 0.052, 0, -0.2, 0.063, 0.1, 0.3);
  // handguard, suppressor
  b.box('anodized', 0.036, 0.04, 0.16, 0, 0.002, 0.26, 0, 0.4);
  b.slots(0.2, 0.32, 0.0185, 0.001, -0.0185);
  b.rail('anodized', -0.11, 0.33, 0.029, 0.02);
  b.tube('anodized', 0.0175, 0.17, 0, 0.002, 0.43, 22);
  b.lathe('anodized', [[0.001, 0.515], [0.0175, 0.515], [0.014, 0.52], [0.001, 0.52]], 0, 0.002);
  // folding stock rods and butt plate
  for (const s of [-1, 1]) b.tube('anodized', 0.0045, 0.24, s * 0.012, -0.006, -0.24);
  b.box('rubber', 0.032, 0.09, 0.014, 0, -0.02, -0.365, 0, 0.3);
  const sight = reddot(b, 0.01, 0.0355);
  return { sight, grip: [0, -0.08, 0.06], fore: [0, -0.012, -0.25], muzzle: [0, 0.002, -0.52], butt: [0, -0.02, 0.36] };
}

function mauler(b: Builder): Omit<GunModel, 'id' | 'geos'> {
  b.box('anodized', 0.034, 0.058, 0.21, 0, -0.008, 0.0);
  b.box('polymer', 0.0016, 0.02, 0.06, 0.0172, 0.0, 0.02, 0, 0);
  // shell carrier on the left with four shells
  b.box('polymer', 0.008, 0.05, 0.07, -0.021, -0.006, -0.02, 0, 0.3);
  for (let k = 0; k < 4; k++) {
    b.post('wood', 0.0104, 0.056, -0.027, 0.002, -0.052 + k * 0.022, 'u', 12);
    b.post('fde', 0.0108, 0.012, -0.027, -0.03, -0.052 + k * 0.022, 'u', 12);
  }
  b.tube('steel', 0.0112, 0.5, 0, 0.009, 0.35);
  b.tube('anodized', 0.012, 0.41, 0, -0.024, 0.3);
  b.lathe('anodized', [[0.001, 0.505], [0.0125, 0.505], [0.012, 0.515], [0.001, 0.515]], 0, -0.024);
  // ribbed pump
  b.box('polymer', 0.042, 0.042, 0.16, 0, -0.02, 0.25, 0, 0.4);
  for (let f = 0.185; f < 0.32; f += 0.016) b.box('polymer', 0.044, 0.044, 0.005, 0, -0.02, f, 0, 0.3);
  b.ball('steel', 0.0035, 0, 0.022, 0.59);
  b.box('anodized', 0.016, 0.01, 0.016, 0, 0.026, -0.08, 0, 0.3);
  b.box('anodized', 0.012, 0.0045, 0.07, 0, -0.068, -0.02, 0, 0.2);
  b.box('steel', 0.004, 0.022, 0.006, 0, -0.052, -0.016, -0.35, 0);
  b.side('polymer', [[-0.1, 0.02], [-0.42, 0.012], [-0.424, -0.12], [-0.395, -0.126], ['q', -0.24, -0.075, -0.15, -0.065], [-0.1, -0.035]], 0.038, 0, 0.005);
  b.box('rubber', 0.04, 0.135, 0.016, 0, -0.052, -0.43, 0, 0.3);
  return { sight: 0.025, grip: [0, -0.055, 0.12], fore: [0, -0.035, -0.25], muzzle: [0, 0.009, -0.6], butt: [0, -0.045, 0.42] };
}

function wren(b: Builder): Omit<GunModel, 'id' | 'geos'> {
  // slide with rear and front serrations, sights, barrel hood
  b.box('anodized', 0.0255, 0.03, 0.186, 0, 0.012, 0.035, 0, 0.18);
  for (let f = -0.045; f < -0.02; f += 0.0045) for (const s of [-1, 1]) b.box('polymer', 0.0012, 0.022, 0.0016, s * 0.0129, 0.012, f, 0, 0);
  b.box('steel', 0.0035, 0.006, 0.004, 0, 0.03, 0.12, 0, 0);
  for (const s of [-1, 1]) b.box('steel', 0.006, 0.006, 0.005, s * 0.0045, 0.03, -0.05, 0, 0);
  b.tube('steel', 0.006, 0.006, 0, 0.012, 0.129);
  b.box('polymer', 0.022, 0.012, 0.018, 0, 0.005, -0.04, 0, 0);
  // frame with an accessory rail and a squared trigger guard
  b.side('polymer', [[-0.06, -0.003], [0.124, -0.003], [0.124, -0.018], [0.04, -0.022], [0.02, -0.04], [-0.01, -0.04], [-0.06, -0.016]], 0.027);
  b.box('polymer', 0.012, 0.005, 0.055, 0, -0.045, 0.008, 0, 0.2);
  b.box('polymer', 0.012, 0.024, 0.006, 0, -0.033, 0.036, 0, 0.2);
  b.box('steel', 0.004, 0.018, 0.005, 0, -0.03, 0.004, -0.2, 0);
  b.side('polymer', [[-0.012, -0.018], [-0.06, -0.016], [-0.077, -0.118], [-0.071, -0.126], [-0.04, -0.126], ['q', -0.03, -0.07, -0.012, -0.04]], 0.029, 0, 0.004);
  b.box('polymer', 0.031, 0.009, 0.042, 0, -0.127, -0.056, 0.2, 0.3);
  return { sight: 0.033, grip: [0, -0.07, 0.045], fore: [0, -0.075, 0.04], muzzle: [0, 0.012, -0.13], butt: [0, -0.07, 0.05] };
}

function bulwark(b: Builder): Omit<GunModel, 'id' | 'geos'> {
  b.box('steel', 0.027, 0.032, 0.21, 0, 0.013, 0.04, 0, 0.15);
  for (let f = -0.055; f < -0.025; f += 0.005) for (const s of [-1, 1]) b.box('polymer', 0.001, 0.024, 0.0018, s * 0.0136, 0.013, f, 0, 0);
  b.box('steel', 0.004, 0.007, 0.006, 0, 0.032, 0.135, 0, 0);
  for (const s of [-1, 1]) b.box('steel', 0.006, 0.007, 0.006, s * 0.0045, 0.032, -0.056, 0, 0);
  b.tube('steel', 0.0068, 0.008, 0, 0.012, 0.146);
  b.side('steel', [[-0.075, -0.003], [0.14, -0.003], [0.14, -0.017], [0.045, -0.02], ['q', 0.035, -0.05, 0.0, -0.045], [-0.075, -0.012]], 0.026);
  b.box('steel', 0.008, 0.012, 0.016, 0, 0.012, -0.072, -0.4, 0.2);
  b.side('steel', [[-0.012, -0.016], [-0.064, -0.012], [-0.082, -0.125], [-0.074, -0.134], [-0.044, -0.134], ['q', -0.033, -0.08, -0.012, -0.04]], 0.026, 0, 0.003);
  for (const s of [-1, 1]) b.side('wood', [[-0.02, -0.03], [-0.062, -0.026], [-0.076, -0.115], [-0.046, -0.12], ['q', -0.036, -0.075, -0.02, -0.045]], 0.004, s * 0.0145, 0.0015);
  b.box('steel', 0.004, 0.018, 0.005, 0, -0.03, 0.005, -0.2, 0);
  return { sight: 0.0355, grip: [0, -0.075, 0.05], fore: [0, -0.08, 0.045], muzzle: [0, 0.012, -0.15], butt: [0, -0.075, 0.055] };
}

const BUILDERS: Record<WeaponId, (b: Builder) => Omit<GunModel, 'id' | 'geos'>> = { wren, bulwark, hornet, mauler, kestrel, lancer, longbow };

type V3 = [number, number, number];
/**
 * The real guns: which model files, and the points on them in the file's own coordinates (the bake leaves them centered,
 * forward -z): the origin on the bore line above the trigger, the sight line height above it, the hand points (the grip
 * point is the center of the firing hand round the grip, the fore point sits under the handguard's axis), the muzzle and
 * the butt. An optic is added where the real gun has none. The "-b" models are the other side's version of a gun.
 */
type RealSpec = { fp?: AssetKey; lite: AssetKey; origin: V3; sight: number; grip: V3; fore: V3; muzzle: V3; butt: V3; optic?: (b: Builder) => number };
const REAL: Partial<Record<string, RealSpec>> = {
  wren: { fp: 'xd', lite: 'xd-lite', origin: [0, 0.049, -0.005], sight: 0.028, grip: [0, -0.035, 0.05], fore: [0, -0.04, 0.045], muzzle: [0, 0.049, -0.09], butt: [0, -0.06, 0.08] },
  'wren-b': { lite: 'beretta-lite', origin: [0, 0.042, -0.01], sight: 0.028, grip: [0, -0.035, 0.04], fore: [0, -0.04, 0.035], muzzle: [0, 0.042, -0.085], butt: [0, -0.06, 0.07] },
  bulwark: { fp: 'deagle', lite: 'deagle-lite', origin: [0, 0.055, 0], sight: 0.022, grip: [0, -0.035, 0.065], fore: [0, -0.04, 0.06], muzzle: [0, 0.059, -0.135], butt: [0, -0.07, 0.1] },
  hornet: { fp: 'mp5', lite: 'mp5-lite', origin: [0, 0.05, 0], sight: 0.072, grip: [0, -0.045, 0.06], fore: [0, 0.025, -0.2], muzzle: [0, 0.053, -0.34], butt: [0, 0.02, 0.34] },
  kestrel: { fp: 'm4', lite: 'm4-lite', origin: [0, 0.09, 0.05], sight: 0, grip: [0, -0.025, 0.135], fore: [0, 0.071, -0.17], muzzle: [0, 0.09, -0.42], butt: [0, 0.04, 0.42], optic: (b) => holo(b, 0, 0.034) },
  'kestrel-b': { lite: 'ak-lite', origin: [0, 0.075, 0.08], sight: 0.04, grip: [0, -0.025, 0.165], fore: [0, 0.058, -0.17], muzzle: [0, 0.075, -0.44], butt: [0, 0.05, 0.44] },
  lancer: { fp: 'm4', lite: 'm4-lite', origin: [0, 0.09, 0.05], sight: 0, grip: [0, -0.025, 0.135], fore: [0, 0.071, -0.17], muzzle: [0, 0.09, -0.42], butt: [0, 0.04, 0.42], optic: (b) => scope(b, -0.12, 0.16, 0.034, 0.021) },
  longbow: { fp: 'awp', lite: 'awp-lite', origin: [0, 0.06, 0.28], sight: 0.048, grip: [0, -0.04, 0.37], fore: [0, 0.023, 0.1], muzzle: [0, 0.06, -0.6], butt: [0, 0, 0.6] },
};

const cache = new WeakMap<Three, Map<string, GunModel>>();
const realSrc = new WeakMap<Three, Assets>();

/** Uses the loaded real models for every gun that has one (the procedural ones stay for the rest). */
export function installRealGuns(THREE: Three, assets: Assets) {
  disposeGuns(THREE);
  realSrc.set(THREE, assets);
}

const sub = (a: V3, o: V3): V3 => [a[0] - o[0], a[1] - o[1], a[2] - o[2]];

function realModel(THREE: Three, id: WeaponId, spec: RealSpec, assets: Assets): GunModel | null {
  const liteSrc = assets[spec.lite];
  const fpSrc = spec.fp ? assets[spec.fp] : undefined;
  if (!liteSrc && !fpSrc) return null;
  const o = spec.origin;
  const shift = new THREE.Matrix4().makeTranslation(-o[0], -o[1], -o[2]);
  const fp = fpSrc ? bakeModel(THREE, fpSrc, shift).parts : [];
  const liteParts = liteSrc ? bakeModel(THREE, liteSrc, shift).parts : [];
  for (const p of liteParts.slice(1)) p.geo.dispose();
  const b = new Builder(THREE);
  const sight = spec.optic ? spec.optic(b) : spec.sight;
  return {
    id,
    geos: b.build(),
    sight,
    grip: sub(spec.grip, o),
    fore: sub(spec.fore, o),
    muzzle: sub(spec.muzzle, o),
    butt: sub(spec.butt, o),
    real: { fp, lite: liteParts[0]?.geo ?? null },
  };
}

/** The model for a gun (side 1 carries the other side's version where there is one), built once per three.js instance. */
export function gunModel(THREE: Three, id: WeaponId, side = 0): GunModel {
  let byId = cache.get(THREE);
  if (!byId) cache.set(THREE, (byId = new Map()));
  const assets = realSrc.get(THREE);
  const key = side && REAL[`${id}-b`] && assets?.[REAL[`${id}-b`]!.lite] ? `${id}-b` : id;
  let m = byId.get(key);
  if (!m) {
    const spec = REAL[key];
    m = (spec && assets && realModel(THREE, id, spec, assets)) || undefined;
    if (!m) {
      const b = new Builder(THREE);
      const meta = BUILDERS[id](b);
      m = { id, geos: b.build(), ...meta, vertical: id === 'kestrel' };
    }
    byId.set(key, m);
  }
  return m;
}

/** A group of meshes for a gun with the given materials. */
export function gunMesh(THREE: Three, model: GunModel, mats: Record<GunMat, T.Material>, shadows: boolean) {
  const g = new THREE.Group();
  for (const [mat, geo] of Object.entries(model.geos) as [GunMat, T.BufferGeometry][]) {
    const mesh = new THREE.Mesh(geo, mats[mat]);
    mesh.castShadow = shadows && mat !== 'lens' && mat !== 'dot';
    mesh.receiveShadow = false;
    if (mat === 'lens') mesh.renderOrder = 4;
    g.add(mesh);
  }
  for (const p of model.real?.fp ?? []) {
    const mesh = new THREE.Mesh(p.geo, p.mat);
    mesh.castShadow = shadows;
    g.add(mesh);
  }
  return g;
}

const liteCache = new WeakMap<GunModel, T.BufferGeometry>();

/**
 * One geometry with the materials baked into vertex colors (glass and the dot left out), for guns in other
 * soldiers' hands: a single draw call each, which is all a gun across the field needs.
 */
export function gunLiteGeometry(THREE: Three, model: GunModel) {
  if (model.real?.lite) return model.real.lite;
  let g = liteCache.get(model);
  if (g) return g;
  const parts = (Object.entries(model.geos) as [GunMat, T.BufferGeometry][]).filter(([m]) => m !== 'lens' && m !== 'dot' && m !== 'glass');
  const n = parts.reduce((s, [, x]) => s + x.attributes.position.count, 0);
  const pos = new Float32Array(n * 3);
  const nor = new Float32Array(n * 3);
  const col = new Float32Array(n * 3);
  let o = 0;
  for (const [m, x] of parts) {
    const c = lin(GUN_LOOK[m].color, m === 'steel' || m === 'anodized' ? 1.6 : 1);
    const cnt = x.attributes.position.count;
    pos.set(x.attributes.position.array as Float32Array, o * 3);
    nor.set(x.attributes.normal.array as Float32Array, o * 3);
    for (let i = 0; i < cnt; i++) col.set(c, (o + i) * 3);
    o += cnt;
  }
  g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeBoundingSphere();
  liteCache.set(model, g);
  return g;
}

/** Frees every cached gun geometry for a three.js instance. */
export function disposeGuns(THREE: Three) {
  const byId = cache.get(THREE);
  if (!byId) return;
  for (const m of byId.values()) {
    for (const g of Object.values(m.geos)) g?.dispose();
    for (const p of m.real?.fp ?? []) p.geo.dispose();
    m.real?.lite?.dispose();
    liteCache.get(m)?.dispose();
    liteCache.delete(m);
  }
  cache.delete(THREE);
}
