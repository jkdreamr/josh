// The Dish's hills (scenery.ts places them): the smaller antennas about the hills, Holstein cattle grazing, and the
// rolling golden knolls themselves, smooth and patched with darker grass.
import type { T } from './gl';
import type { ModelKit } from './model';
import { dishTelescope, hill } from './landmarks';

type Three = typeof import('three');

/** A Holstein standing or grazing: a deep body with black patches on white, its legs, udder, tail and head. */
export function holstein(mk: ModelKit, x: number, z: number, ry: number, grazing: boolean, seed: number) {
  mk.place(x, 0, z, ry);
  const W = 0xf4f2ec;
  const B = 0x1d1d22;
  mk.ball(W, 0, 1.3, 0, 0.55, 0.58, 1.1);
  mk.box(W, 0, 1.22, 0, 0.95, 0.75, 1.7);
  // (its patches, different on each)
  for (let k = 0; k < 5; k++) {
    const a = seed * 1.7 + k * 2.3;
    const side = k % 2 ? 1 : -1;
    mk.ball(B, side * 0.49, 1.3 + Math.sin(a) * 0.2, Math.cos(a * 1.3) * 0.7, 0.08, 0.28 + (k % 3) * 0.06, 0.3 + ((k * 7) % 3) * 0.08);
  }
  mk.ball(B, 0, 1.6, Math.sin(seed) * 0.4, 0.35, 0.08, 0.38);
  for (const [lx, lz] of [[-0.3, 0.72], [0.3, 0.72], [-0.3, -0.72], [0.3, -0.72]] as const) {
    mk.box(W, lx, 0.5, lz, 0.2, 0.9, 0.22);
    mk.box(0x2a2420, lx, 0.06, lz, 0.22, 0.13, 0.24);
  }
  mk.ball(0xf0a3a8, 0, 0.78, -0.45, 0.24, 0.16, 0.28);
  mk.box(W, 0, 1.15, -1.12, 0.07, 0.95, 0.07, -0.15, 0, 0);
  mk.ball(B, 0, 0.66, -1.2, 0.07, 0.14, 0.07);
  const [hy, hz, hr] = grazing ? [0.55, 1.45, 1.1] : [1.55, 1.3, 0.2];
  mk.box(W, 0, (hy + 1.35) / 2, (hz + 0.95) / 2, 0.38, Math.abs(1.35 - hy) + 0.35, 0.45, grazing ? 0.6 : -0.3, 0, 0);
  mk.box(B, 0, hy, hz, 0.5, 0.5, 0.62, hr, 0, 0);
  mk.box(0xf0a3a8, 0, hy - (grazing ? 0.3 : 0.12), hz + (grazing ? 0.12 : 0.36), 0.44, 0.28, 0.22, hr, 0, 0);
  for (const sd of [-1, 1]) {
    mk.box(B, sd * 0.36, hy + 0.15, hz - 0.1, 0.26, 0.08, 0.14);
    mk.cone(0xeee3c4, sd * 0.2, hy + 0.35, hz - 0.15, 0.06, 0.22, 0.06, 0, 0, -sd * 0.5);
  }
  mk.place();
}

/** The knolls: a smooth mound, golden, patched darker green and dun, one unit across and high (scaled per knoll). */
export function knollGeometry(THREE: Three) {
  return hill(THREE, 0, 0, 1, 1, [0xc9ae66, 0xa8924e, 0x7a7a3c], 11, 0.03, 12);
}

/** Smaller dishes about the hills: each the big Dish's model, smaller, on its own pad. */
export function smallDishes(THREE: Three, scene: T.Scene, spots: { x: number; z: number; ry: number }[], mats: { vc: T.Material; lit: T.Material }, kit: (THREE: Three) => ModelKit) {
  for (const s of spots) {
    const mk = kit(THREE);
    mk.box(0xc9c3b6, 0, 0.15, 0, 34, 0.3, 34);
    dishTelescope(THREE, mk, 0.9);
    const g = mk.build(mats.vc, mats.lit);
    g.scale.setScalar(0.24);
    g.position.set(s.x, 0, s.z);
    g.rotation.y = s.ry;
    scene.add(g);
  }
}
