// The Red Barn's farm, each piece a model of many parts in one mesh (scenery.ts places them): the barn with its gambrel
// roof, board siding, white trim and cross-braced doors, the hayloft and the cupola; the silo; the tractor; the Aermotor
// windmill; post-and-rail paddock fences; and horses.
import type { T } from './gl';
import { modelKit, type ModelKit } from './model';

type Three = typeof import('three');

const RED = 0xa3322a;
const RED_DARK = 0x7e2620;
const TRIM = 0xf3efe4;
const SHINGLE = 0x4a4646;

/** A gambrel roof's cross-section extruded along z: w across at the eaves, the lower slopes steep, the upper shallow. */
function gambrel(THREE: Three, w: number, len: number, h: number) {
  const s = new THREE.Shape();
  const x = w / 2;
  s.moveTo(-x - 0.6, -0.2);
  s.lineTo(-x * 0.62, h * 0.62);
  s.lineTo(0, h);
  s.lineTo(x * 0.62, h * 0.62);
  s.lineTo(x + 0.6, -0.2);
  s.lineTo(x + 0.4, -0.45);
  s.lineTo(x * 0.6, h * 0.62 - 0.35);
  s.lineTo(0, h - 0.35);
  s.lineTo(-x * 0.6, h * 0.62 - 0.35);
  s.lineTo(-x - 0.4, -0.45);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  return g;
}

/** The barn's gable end (the wall up into the gambrel), w across, eaves at y = 0. */
function gableEnd(THREE: Three, w: number, h: number) {
  const s = new THREE.Shape();
  const x = w / 2;
  s.moveTo(-x, 0);
  s.lineTo(x, 0);
  s.lineTo(x * 0.62, h * 0.62);
  s.lineTo(0, h);
  s.lineTo(-x * 0.62, h * 0.62);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: false });
  g.translate(0, 0, -0.05);
  return g;
}

/**
 * The barn, its doors facing +z: 24 m long (x), 15 deep, the walls 9 high. Board siding (battens down it), white trim at
 * the corners and eaves, the great doors with their X braces, the hayloft door and its hay hood, a cupola on the ridge
 * with a weathervane, and a lean-to shed down one side.
 */
export function redBarn(THREE: Three, mk: ModelKit) {
  const W = 24;
  const D = 15;
  const H = 9;
  mk.box(0x8a8478, 0, 0.3, 0, W + 0.4, 0.6, D + 0.4);
  mk.box(RED, 0, H / 2, 0, W, H, D);
  // (battens down the siding)
  for (let x = -W / 2 + 0.6; x < W / 2; x += 0.6) for (const sz of [-1, 1]) mk.box(RED_DARK, x, H / 2, sz * (D / 2 + 0.02), 0.07, H - 0.2, 0.05);
  for (let z = -D / 2 + 0.6; z < D / 2; z += 0.6) for (const sx of [-1, 1]) mk.box(RED_DARK, sx * (W / 2 + 0.02), H / 2, z, 0.05, H - 0.2, 0.07);
  // (the gambrel roof over the length of it, the gable ends under it, its eaves trim)
  mk.geo(gambrel(THREE, D, W + 0.8, 6.4), SHINGLE, 0, H, 0, 1, 1, 1, 0, Math.PI / 2, 0);
  for (const sx of [-1, 1]) {
    mk.geo(gableEnd(THREE, D, 6.2), RED, sx * (W / 2), H, 0, 1, 1, 1, 0, sx * Math.PI / 2, 0);
    for (let z = -D / 2 + 0.6; z < D / 2; z += 0.6) {
      const top = Math.abs(z) < D * 0.31 ? 6.2 - (Math.abs(z) / (D * 0.31)) * 2.36 : 3.84 * (1 - (Math.abs(z) - D * 0.31) / (D / 2 - D * 0.31));
      if (top > 0.2) mk.box(RED_DARK, sx * (W / 2 + 0.03), H + top / 2, z, 0.05, top, 0.07);
    }
  }
  for (const [x, z] of [[-W / 2, D / 2], [W / 2, D / 2], [-W / 2, -D / 2], [W / 2, -D / 2]]) mk.box(TRIM, x, H / 2, z, 0.5, H, 0.5);
  mk.box(TRIM, 0, H - 0.15, D / 2 + 0.05, W + 0.4, 0.3, 0.12);
  mk.box(TRIM, 0, H - 0.15, -D / 2 - 0.05, W + 0.4, 0.3, 0.12);
  // the great doors: white frames, red panels, an X of bracing on each leaf, the track over them
  for (const sz of [-1, 1]) {
    const z = sz * (D / 2 + 0.08);
    mk.box(0x55524c, 0, 6.9, z, 9.6, 0.2, 0.2);
    for (const sd of [-1, 1]) {
      const cx = sd * 2;
      mk.box(TRIM, cx, 3.2, z, 4, 6.4, 0.12);
      mk.box(RED, cx, 3.2, z + sz * 0.04, 3.4, 5.8, 0.1);
      for (const lean of [-1, 1]) mk.box(TRIM, cx, 3.2, z + sz * 0.08, 0.3, 6.5, 0.08, 0, 0, lean * 0.53);
      mk.box(TRIM, cx, 3.2, z + sz * 0.08, 3.4, 0.3, 0.08);
    }
    // (the hayloft door above, open on the dark, and the hay hood over it with its pulley)
    mk.box(TRIM, 0, H + 1.6, z, 3.4, 2.8, 0.12);
    mk.box(0x1e1a16, 0, H + 1.6, z + sz * 0.04, 2.8, 2.3, 0.1);
    mk.box(0xd8b450, 0, H + 0.7, z + sz * 0.02, 2.6, 0.5, 0.1);
    mk.box(SHINGLE, 0, H + 3.6, sz * (D / 2 + 1.2), 3.8, 0.15, 2.6, sz * 0.35, 0, 0);
    mk.box(0x55524c, 0, H + 3.3, sz * (D / 2 + 2.2), 0.12, 0.6, 0.12);
    // (windows either side of the doors)
    for (const wx of [-8, 8]) {
      mk.box(TRIM, wx, 4.5, z, 1.6, 1.8, 0.1);
      mk.box(0x2c3a44, wx, 4.5, z + sz * 0.03, 1.3, 1.5, 0.1);
      mk.box(TRIM, wx, 4.5, z + sz * 0.06, 0.1, 1.5, 0.08);
    }
  }
  // the cupola on the ridge, its louvres, its roof and the weathervane
  mk.box(TRIM, 0, H + 7.2, 0, 2.4, 2.2, 2.4);
  for (const [nx, nz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) for (let k = 0; k < 4; k++) mk.box(0x8a8478, nx * 1.22, H + 6.6 + k * 0.35, nz * 1.22, nx ? 0.05 : 1.6, 0.08, nz ? 0.05 : 1.6);
  mk.cone(SHINGLE, 0, H + 9.0, 0, 2.1, 1.6, 2.1, 0, Math.PI / 4, 0);
  mk.cyl(0x2a2a2a, 0, H + 10.4, 0, 0.05, 1.6, 0.05);
  mk.box(0x2a2a2a, 0, H + 10.9, 0, 1.4, 0.06, 0.06);
  mk.box(0x2a2a2a, 0.5, H + 11.1, 0, 0.5, 0.35, 0.03);
  for (const [x, z] of [[0.6, 0], [-0.6, 0], [0, 0.6], [0, -0.6]]) mk.box(0x2a2a2a, x, H + 10.55, z, Math.abs(x) * 1.6 + 0.04, 0.04, Math.abs(z) * 1.6 + 0.04);
  // the lean-to shed down the back end, under a shallow roof
  mk.box(RED, -W / 2 - 3, 2.4, 0, 6, 4.8, D - 2);
  mk.box(SHINGLE, -W / 2 - 3, 5.0, 0, 6.6, 0.15, D - 1.4, 0, 0, 0.18);
  mk.box(0x1e1a16, -W / 2 - 6.02, 1.8, 0, 0.05, 3.2, 4);
}

/** A silo 6.4 m across and 18 tall: concrete staves with steel hoops, a domed cap, the chute down its side. */
export function silo(mk: ModelKit, x: number, z: number) {
  mk.place(x, 0, z, 0);
  mk.cyl(0xa9b4b8, 0, 9, 0, 3.2, 18, 3.2);
  for (let y = 1.2; y < 18; y += 1.4) mk.cyl(0x7f8a8e, 0, y, 0, 3.24, 0.1, 3.24);
  mk.ball(0xc9d2d4, 0, 18, 0, 3.3, 2.4, 3.3);
  mk.cyl(0x8a9498, 0, 20.6, 0, 0.4, 0.6, 0.4);
  mk.box(0xa3322a, 0, 10, 3.35, 1, 17, 0.6);
  mk.box(0x55524c, 0, 9, -3.3, 0.5, 18, 0.12);
  for (let y = 0.5; y < 18; y += 0.45) mk.box(0x55524c, 0, y, -3.36, 0.5, 0.05, 0.05);
  mk.place();
}

/** A green tractor: hood, cab with glass and its roof, exhaust stack, big yellow-hubbed back wheels, the front ones. */
export function tractor(mk: ModelKit, x: number, z: number, ry: number) {
  const green = 0x2f7a3a;
  const yellow = 0xf2c230;
  mk.place(x, 0, z, ry);
  mk.box(green, 0, 1.35, 0.7, 1.2, 1.1, 2.6);
  mk.box(0x23602e, 0, 1.92, 0.7, 1.24, 0.08, 2.64);
  for (let k = 0; k < 6; k++) mk.box(0x1a1a1a, 0, 1.2, 2.01 - k * 0.0, 0.9, 0.06, 0.02);
  mk.box(0x1a1a1a, 0, 1.25, 2.02, 0.95, 0.7, 0.04);
  mk.box(yellow, 0, 0.75, 0.8, 1.0, 0.5, 2.4);
  mk.box(green, 0, 1.4, -0.95, 1.9, 0.6, 1.6);
  mk.box(0x2c3a44, 0, 2.55, -0.95, 1.7, 1.5, 1.4);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) mk.box(green, sx * 0.85, 2.55, -0.95 + sz * 0.68, 0.08, 1.5, 0.08);
  mk.box(green, 0, 3.38, -0.95, 1.95, 0.14, 1.75);
  mk.cyl(0x1a1a1a, 0.4, 2.6, 1.6, 0.07, 1.6, 0.07);
  mk.box(0x1a1a1a, 0, 1.8, -0.95, 0.5, 0.1, 0.3);
  for (const sx of [-1, 1]) {
    mk.cyl(0x1b1b1d, sx * 1.15, 1.5, -1.0, 1.5, 0.6, 1.5, 0, 0, Math.PI / 2);
    mk.cyl(yellow, sx * 1.16, 1.5, -1.0, 0.85, 0.64, 0.85, 0, 0, Math.PI / 2);
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2;
      mk.box(0x2a2a2c, sx * 1.15, 1.5 + Math.cos(a) * 1.45, -1.0 + Math.sin(a) * 1.45, 0.62, 0.18, 0.3, a, 0, 0);
    }
    mk.box(green, sx * 1.15, 3.05, -1.0, 0.7, 0.12, 1.6);
    mk.cyl(0x1b1b1d, sx * 0.85, 0.72, 1.6, 0.72, 0.38, 0.72, 0, 0, Math.PI / 2);
    mk.cyl(yellow, sx * 0.86, 0.72, 1.6, 0.38, 0.4, 0.38, 0, 0, Math.PI / 2);
  }
  mk.place();
}

/**
 * An Aermotor windmill: a four-legged galvanized lattice tower 15 m tall, its platform, the many-bladed fan facing the
 * wind and the tail vane behind it. The fan is returned to turn.
 */
export function windmill(THREE: Three, x: number, z: number, ry: number, mats: { vc: T.Material; lit: T.Material }) {
  const mk = modelKit(THREE);
  const steel = 0x9aa0a6;
  mk.place(x, 0, z, ry);
  for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) mk.box(steel, a * 0.9, 7.4, b * 0.9, 0.12, 15, 0.12, -b * 0.11, 0, a * 0.11);
  for (let y = 1.5; y < 14.5; y += 2.6) {
    const w = 1.95 - (y / 15) * 1.6;
    for (const sd of [-1, 1]) {
      mk.box(steel, 0, y, sd * w, w * 2, 0.06, 0.06);
      mk.box(steel, sd * w, y, 0, 0.06, 0.06, w * 2);
      mk.box(steel, 0, y + 1.3, sd * w, 0.04, 2.8, 0.04, 0, 0, 0.75 * sd);
    }
  }
  mk.box(0x6a5a48, 0, 14.7, 0, 1.6, 0.1, 1.6);
  mk.box(0x55585c, 0, 15.3, 0.1, 0.5, 0.6, 1.0);
  // (the tail vane, its arm back from the head)
  mk.box(steel, 0, 15.3, -1.6, 0.06, 0.06, 2.6);
  mk.box(0xd8d4c8, 0, 15.5, -3.0, 0.04, 1.4, 1.8);
  mk.place();
  const tower = mk.build(mats.vc, mats.lit);
  const fanKit = modelKit(THREE);
  for (let k = 0; k < 18; k++) {
    const a = (k / 18) * Math.PI * 2;
    fanKit.box(0xc8ccd0, Math.cos(a) * 1.45, Math.sin(a) * 1.45, 0, 0.32, 1.9, 0.03, 0, 0.35, a - Math.PI / 2);
  }
  fanKit.cyl(steel, 0, 0, 0, 2.4, 0.04, 2.4, Math.PI / 2, 0, 0);
  fanKit.cyl(steel, 0, 0, 0, 0.6, 0.05, 0.6, Math.PI / 2, 0, 0);
  fanKit.cyl(0x55585c, 0, 0, 0, 0.18, 0.4, 0.18, Math.PI / 2, 0, 0);
  const fan = fanKit.build(mats.vc, mats.lit);
  const hub = new THREE.Group();
  hub.position.set(x + Math.sin(ry) * 0.8, 15.3, z + Math.cos(ry) * 0.8);
  hub.rotation.y = ry;
  hub.add(fan);
  return { tower, hub, fan };
}

/** A white post-and-rail fence round a w by d rectangle at (x, z), turned ry, its posts every 3 m. */
export function paddockFence(mk: ModelKit, x: number, z: number, w: number, d: number, ry: number) {
  mk.place(x, 0, z, ry);
  for (const [len, px, pz, along] of [[w, 0, d / 2, true], [w, 0, -d / 2, true], [d, w / 2, 0, false], [d, -w / 2, 0, false]] as const) {
    for (const y of [0.55, 1.1]) mk.box(TRIM, px, y, pz, along ? len : 0.08, 0.14, along ? 0.08 : len);
    for (let k = -len / 2; k <= len / 2 + 0.01; k += 3) mk.box(0xe8e2d4, along ? px + k : px, 0.67, along ? pz : pz + k, 0.18, 1.35, 0.18);
  }
  mk.place();
}

/**
 * A horse, grazing or with its head up: a barrel of a body, a deep chest and rounded rump, legs with their joints and dark
 * hooves, the neck arched to the head, the mane and the tail; `coat` and `mane` are colors, `blaze` a white face.
 */
export function horse(mk: ModelKit, x: number, z: number, ry: number, coat: number, mane: number, grazing: boolean, blaze: boolean) {
  mk.place(x, 0, z, ry);
  mk.ball(coat, 0, 1.45, 0, 0.42, 0.45, 0.95);
  mk.ball(coat, 0, 1.5, 0.62, 0.4, 0.46, 0.42);
  mk.ball(coat, 0, 1.52, -0.65, 0.42, 0.45, 0.42);
  for (const [lx, lz, front] of [[-0.22, 0.68, 1], [0.22, 0.68, 1], [-0.22, -0.7, 0], [0.22, -0.7, 0]] as const) {
    mk.cyl(coat, lx, 1.12, lz, 0.11, 0.6, 0.12);
    mk.cyl(coat, lx, 0.55, lz + (front ? 0 : -0.04), 0.065, 0.75, 0.065, front ? 0 : 0.08, 0, 0);
    mk.ball(coat, lx, 0.85, lz, 0.08, 0.08, 0.08);
    mk.cyl(0x2a2420, lx, 0.1, lz, 0.075, 0.2, 0.08);
  }
  // (the neck and head: down to the grass, or up and looking about)
  const [ny, nz, na, hy, hz, ha] = grazing ? [1.25, 1.0, 1.9, 0.62, 1.32, 2.6] : [1.95, 0.95, 0.55, 2.35, 1.3, 1.9];
  mk.cyl(coat, 0, ny, nz, 0.2, 1.0, 0.26, na, 0, 0);
  mk.cyl(coat, 0, hy, hz, 0.12, 0.65, 0.17, ha, 0, 0);
  mk.ball(coat, 0, hy + (grazing ? 0.16 : 0.2), hz - 0.18, 0.15, 0.16, 0.17);
  if (blaze) mk.box(0xf2efe8, 0, hy + (grazing ? -0.05 : 0.02), hz + (grazing ? 0.1 : 0.1), 0.07, 0.4, 0.08, ha, 0, 0);
  for (const sx of [-1, 1]) mk.cone(coat, sx * 0.08, hy + (grazing ? 0.3 : 0.42), hz - 0.3, 0.04, 0.16, 0.04);
  mk.box(mane, 0, ny + 0.12, nz - 0.18, 0.08, 1.0, 0.12, na, 0, 0);
  mk.cyl(mane, 0, 1.25, -1.15, 0.09, 0.85, 0.12, -0.3, 0, 0);
  mk.place();
}
