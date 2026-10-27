// Stanford's landmarks for the road courses, each one mesh of many vertex-colored parts (and one more for its lights):
// Memorial Church with its mosaic and the Quad's arcades either side, Hoover Tower, the sandstone halls with their red
// tile roofs and arcades, the Dish on its hill, and the hills themselves.
import type { T } from './gl';
import { modelKit, type ModelKit } from './model';
import { scatter } from './scenery';

type Three = typeof import('three');

export const SANDSTONE = 0xd8bd8e;
export const SANDSTONE_DARK = 0xb89c70;
export const TILE = 0xb0543a;
export const TILE_DARK = 0x8a3d2a;
const SHADE = 0x3a2c22;
const GLASS = 0x2b3a44;

/** A hip roof w across (x) and d deep (z), h high, its eaves at y = 0: a ridge along the longer side. */
export function hipRoof(THREE: Three, w: number, d: number, h: number) {
  const along = d >= w;
  const [a, b] = along ? [w / 2, d / 2] : [d / 2, w / 2];
  const ridge = Math.max(0, b - a);
  // (in the frame where the ridge runs along z)
  const v = [
    [-a, 0, -b], [a, 0, -b], [a, 0, b], [-a, 0, b],
    [0, h, -ridge], [0, h, ridge],
  ];
  const faces = [
    [0, 4, 1], [1, 4, 5], [1, 5, 2], [2, 5, 3], [3, 5, 4], [3, 4, 0],
  ];
  const pos: number[] = [];
  for (const f of faces) for (const i of f) {
    const [x, y, z] = v[i];
    if (along) pos.push(x, y, z);
    else pos.push(z, y, x);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  // (wound to face out either way round)
  if (!along) {
    const p = g.getAttribute('position');
    for (let k = 0; k < p.count; k += 3) {
      const x = p.getX(k + 1);
      const y = p.getY(k + 1);
      const z = p.getZ(k + 1);
      p.setXYZ(k + 1, p.getX(k + 2), p.getY(k + 2), p.getZ(k + 2));
      p.setXYZ(k + 2, x, y, z);
    }
  }
  g.computeVertexNormals();
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  return g;
}

/** A gable roof w across (x) and d along (z), h high at its ridge, eaves at y = 0. */
export function gableRoof(THREE: Three, w: number, d: number, h: number) {
  const g = new THREE.BufferGeometry();
  const x = w / 2;
  const z = d / 2;
  const pos = [
    // the two slopes
    -x, 0, z, x, 0, z, 0, h, z, // (gable end +z)
    x, 0, -z, -x, 0, -z, 0, h, -z, // (gable end -z)
    -x, 0, -z, -x, 0, z, 0, h, z, -x, 0, -z, 0, h, z, 0, h, -z,
    x, 0, z, x, 0, -z, 0, h, -z, x, 0, z, 0, h, -z, 0, h, z,
  ];
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array((pos.length / 3) * 2).fill(0), 2));
  g.computeVertexNormals();
  return g;
}

/**
 * A wall w wide and h high with n round-headed arches through it (each `aw` wide, its springing at `ah`), `t` thick:
 * its face in the x-y plane, centered on x, standing on y = 0.
 */
export function arcadeWall(THREE: Three, w: number, h: number, n: number, aw: number, ah: number, t: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(w / 2, h);
  s.lineTo(-w / 2, h);
  s.closePath();
  const bay = w / n;
  for (let k = 0; k < n; k++) {
    const cx = -w / 2 + bay * (k + 0.5);
    const hole = new THREE.Path();
    hole.moveTo(cx - aw / 2, 0.001);
    hole.lineTo(cx + aw / 2, 0.001);
    hole.lineTo(cx + aw / 2, ah);
    hole.absarc(cx, ah, aw / 2, 0, Math.PI, false);
    hole.lineTo(cx - aw / 2, 0.001);
    s.holes.push(hole);
  }
  const g = new THREE.ExtrudeGeometry(s, { depth: t, bevelEnabled: false, curveSegments: 8 });
  g.translate(0, 0, -t / 2);
  return g;
}

/** A unit quad facing +z, shared by the windows. */
let pane: T.PlaneGeometry | null = null;
/** Windows down a face: dark glass in a pale frame with a sill, `n` of them across `w` at height y. */
function windows(mk: ModelKit, x0: number, z: number, w: number, n: number, y: number, ww: number, wh: number, nx: number, nz: number, lit?: number) {
  pane ??= new mk.THREE.PlaneGeometry(1, 1);
  // (the face's outward normal is along x or z: the panes turned to face it)
  const ry = Math.atan2(nx, nz);
  const along = Math.abs(nz) > 0.5;
  for (let k = 0; k < n; k++) {
    const u = -w / 2 + (w / n) * (k + 0.5);
    const x = x0 + u * nz;
    const zz = z + u * -nx;
    mk.geo(pane, 0xe8dcc4, x + nx * 0.03, y, zz + nz * 0.03, ww + 0.25, wh + 0.25, 1, 0, ry, 0);
    if (lit !== undefined && ((k * 7 + Math.round(y * 3) + Math.round(x0 * 13 + z * 7)) % 10) < 7) mk.glow(lit, x + nx * 0.05, y, zz + nz * 0.05, along ? ww : 0.02, wh, along ? 0.02 : ww);
    else mk.geo(pane, GLASS, x + nx * 0.05, y, zz + nz * 0.05, ww, wh, 1, 0, ry, 0);
    mk.box(0xcdb894, x + nx * 0.1, y - wh / 2 - 0.1, zz + nz * 0.1, along ? ww + 0.4 : 0.2, 0.1, along ? 0.2 : ww + 0.4);
  }
}

/**
 * A Stanford sandstone hall w by d, h tall: rusticated plinth, two floors of framed windows, a cornice, a red tile hip
 * roof with deep eaves, and an arcade along its front (+z) when `arcade`. Placed in mk's current frame.
 */
export function hall(THREE: Three, mk: ModelKit, w: number, d: number, h: number, arcade = true, lit?: number) {
  mk.box(SANDSTONE_DARK, 0, 0.5, 0, w + 0.3, 1, d + 0.3);
  mk.box(SANDSTONE, 0, h / 2, 0, w, h, d);
  // (the string course between the floors, and the cornice under the eaves)
  mk.box(0xe2c99c, 0, h * 0.5, 0, w + 0.2, 0.25, d + 0.2);
  mk.box(0xe8d2a8, 0, h - 0.2, 0, w + 0.5, 0.4, d + 0.5);
  const cols = Math.max(2, Math.round(w / 3.6));
  const rows = Math.max(1, Math.round(d / 3.6));
  for (const y of [h * 0.28, h * 0.74]) {
    windows(mk, 0, d / 2, w - 2, cols, y, 1.2, h * 0.22, 0, 1, lit);
    windows(mk, 0, -d / 2, w - 2, cols, y, 1.2, h * 0.22, 0, -1, lit);
    windows(mk, w / 2, 0, d - 2, rows, y, 1.2, h * 0.22, 1, 0, lit);
    windows(mk, -w / 2, 0, d - 2, rows, y, 1.2, h * 0.22, -1, 0, lit);
  }
  // the roof: tiles, its eaves out past the walls, a ridge of darker tile
  const rh = Math.min(w, d) * 0.32;
  mk.geo(hipRoof(THREE, w + 1.6, d + 1.6, rh), TILE, 0, h, 0);
  mk.box(TILE_DARK, 0, h + 0.08, 0, w + 1.7, 0.16, d + 1.7);
  if (arcade) {
    // a covered arcade along the front: round arches on square piers, a lean-to tile roof over it
    const depth = 3;
    const n = Math.max(3, Math.round(w / 3.2));
    mk.geo(arcadeWall(THREE, w, 4.2, n, (w / n) * 0.62, 2.6, 0.6), SANDSTONE, 0, 0, d / 2 + depth);
    mk.box(SHADE, 0, 1.6, d / 2 + 0.05, w - 0.4, 3.2, 0.1);
    mk.box(0xc8b088, 0, 0.06, d / 2 + depth / 2, w, 0.12, depth + 0.6);
    mk.box(TILE, 0, 4.55, d / 2 + depth / 2 + 0.2, w + 0.4, 0.2, depth + 1.2, 0.28, 0, 0);
  }
}

/** Memorial Church with the Quad's arcades either side: its facade faces -z, its mosaic over three arched doors. */
export function church(THREE: Three) {
  const mk = modelKit(THREE);
  // the arcades either side, red tile roofs over them
  for (const side of [-1, 1]) {
    mk.place(side * 30, 0, 8, 0);
    mk.geo(arcadeWall(THREE, 34, 7, 7, 3.0, 4.2, 1.0), SANDSTONE, 0, 0, -4.6);
    mk.box(SANDSTONE, 0, 4, 2.5, 34, 8, 5);
    mk.box(SHADE, 0, 2.7, -0.2, 33.4, 5.4, 0.2);
    mk.box(0xc8b088, 0, 0.08, -2.3, 34, 0.16, 4.6);
    mk.box(0xe8d2a8, 0, 7.15, -4.6, 34.4, 0.3, 1.2);
    mk.geo(gableRoof(THREE, 11, 34.6, 3), TILE, 0, 7.3, 0, 1, 1, 1, 0, Math.PI / 2, 0);
    mk.box(TILE_DARK, 0, 10.3, 0, 34.8, 0.25, 0.4);
  }
  mk.place();
  // the nave: sandstone walls, a clerestory of arched windows, the long tile roof
  mk.box(SANDSTONE, 0, 8, 14, 22, 16, 30);
  for (const sd of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      mk.box(0x6a4a2a, sd * 11.05, 10, 3 + k * 5.5, 0.1, 4.2, 1.6);
      mk.cyl(0x6a4a2a, sd * 11.05, 12.1, 3 + k * 5.5, 0.8, 0.1, 0.8, 0, 0, Math.PI / 2);
      mk.box(SANDSTONE_DARK, sd * 11.5, 8, 0.5 + k * 5.5, 0.9, 16, 0.9);
    }
  }
  mk.box(0xe8d2a8, 0, 16.1, 14, 22.6, 0.4, 30.6);
  mk.geo(gableRoof(THREE, 24, 31, 7.5), TILE, 0, 16.2, 14);
  mk.box(TILE_DARK, 0, 23.7, 14, 0.5, 0.3, 31);
  // the facade: a great arch framing the mosaic under the gable, three portals on their columns, and a cross on top
  mk.box(SANDSTONE, 0, 9.5, -2, 26, 19, 3);
  mk.geo(gableRoof(THREE, 27, 3.2, 6.5), SANDSTONE, 0, 19, -2);
  mk.box(0xe8d2a8, 0, 19.1, -2, 27, 0.5, 3.4);
  // (the mosaic: a gold ground, the figures in blues, reds and white under a row of arches, in its frame; a round
  // window up in the gable)
  mk.box(0xe8d2a8, 0, 13.9, -3.6, 19.2, 9.2, 0.2);
  mk.box(0xd8b04a, 0, 13.9, -3.75, 18, 8.2, 0.12);
  for (let k = -3; k <= 3; k++) {
    // (Christ in the middle in white, the others robed in muted blues, reds and greens)
    mk.box(k === 0 ? 0xf2ead8 : [0x3a5478, 0x7a3a30, 0x4a6a58][(k + 3) % 3], k * 2.35, 13.2, -3.85, k === 0 ? 1.5 : 1.0, k === 0 ? 5 : 4.2, 0.08);
    mk.box(0xf2d8b0, k * 2.35, k === 0 ? 16.1 : 15.9, -3.85, 0.5, 0.6, 0.08);
    mk.geo(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, Math.PI / 2, Math.PI), 0xb8902a, k * 2.35, 16.7, -3.85, 1.0, 0.1, 1.0, Math.PI / 2, 0, 0);
  }
  mk.box(0x2a4a8a, 0, 10.4, -3.85, 18, 0.6, 0.08);
  mk.geo(new THREE.CylinderGeometry(1, 1, 1, 24), 0xe8d2a8, 0, 21.4, -3.55, 2.2, 0.3, 2.2, Math.PI / 2, 0, 0);
  mk.geo(new THREE.CylinderGeometry(1, 1, 1, 24), 0x4a3a5a, 0, 21.4, -3.72, 1.7, 0.1, 1.7, Math.PI / 2, 0, 0);
  mk.box(0xe8d2a8, 0, 9.3, -3.7, 19, 0.5, 0.4);
  // (the three portals: deep arches, columns between them)
  for (const x of [-6.5, 0, 6.5]) {
    mk.box(SHADE, x, 3.2, -3.52, 3.6, 6.4, 0.2);
    mk.geo(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, Math.PI / 2, Math.PI), 0xe8d2a8, x, 6.4, -3.6, 2.15, 0.15, 2.15, Math.PI / 2, 0, 0);
    mk.geo(new THREE.CylinderGeometry(1, 1, 1, 16, 1, false, Math.PI / 2, Math.PI), SHADE, x, 6.4, -3.62, 1.8, 0.2, 1.8, Math.PI / 2, 0, 0);
    mk.box(0x5a3a22, x, 3.2, -3.6, 3.0, 6.0, 0.1);
  }
  for (const x of [-9.4, -3.25, 3.25, 9.4]) {
    mk.cyl(0xe8d2a8, x, 3.6, -4.0, 0.45, 7.2, 0.45);
    mk.box(0xd8c098, x, 7.4, -4.0, 1.2, 0.5, 1.2);
    mk.box(0xd8c098, x, 0.25, -4.0, 1.3, 0.5, 1.3);
  }
  mk.box(0xe8d2a8, 0, 23.4, -2, 0.35, 2.4, 0.35);
  mk.box(0xe8d2a8, 0, 23.9, -2, 1.4, 0.35, 0.35);
  // (the steps up to it)
  for (let k = 0; k < 3; k++) mk.box(0xd8c8a8, 0, 0.15 + k * 0.3, -5.5 + k * 0.6, 24 - k * 1.2, 0.3, 2);
  // the crossing: an octagonal drum with arched windows round it, the tile dome, its lantern
  mk.cyl(SANDSTONE, 0, 26, 22, 6.4, 7, 6.4);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    mk.box(0x4a3424, Math.sin(a) * 6.35, 26.2, 22 + Math.cos(a) * 6.35, 1.4, 3.6, 0.2, 0, a, 0);
  }
  mk.cyl(0xe8d2a8, 0, 29.6, 22, 6.8, 0.5, 6.8);
  mk.geo(new THREE.SphereGeometry(6.4, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), TILE, 0, 29.8, 22, 1, 0.85, 1);
  mk.cyl(SANDSTONE, 0, 36, 22, 1.1, 1.6, 1.1);
  mk.cone(TILE_DARK, 0, 37.6, 22, 1.3, 1.8, 1.3);
  mk.cyl(0xe8d2a8, 0, 39, 22, 0.08, 1.4, 0.08);
  return mk;
}

/**
 * Hoover Tower: the base block with its entrance, the shaft with its pilasters and slits of windows up it, the belfry's
 * open arches with their columns and balcony, the cornice and the red tile dome with its lantern. Floodlit when lit:
 * the belfry glowing, a red light on the very top. 16 m square at its foot.
 */
export function hooverTower(THREE: Three, lit = false) {
  const mk = modelKit(THREE);
  const stone = lit ? 0xe8cfa2 : SANDSTONE;
  const dark = lit ? 0x5a4630 : SHADE;
  // the base: a block with a stepped top and its entrance arch
  mk.box(SANDSTONE_DARK, 0, 0.4, 0, 16.4, 0.8, 16.4);
  mk.box(stone, 0, 6, 0, 16, 12, 16);
  mk.box(0xe8d2a8, 0, 12.2, 0, 16.6, 0.5, 16.6);
  mk.box(stone, 0, 13.2, 0, 12.5, 2, 12.5);
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const ax = Math.abs(nz) > 0.5;
    mk.box(dark, nx * 8.02, 3.2, nz * 8.02, ax ? 3.2 : 0.1, 6.4, ax ? 0.1 : 3.2);
    mk.cyl(dark, nx * 8.02, 6.4, nz * 8.02, 1.6, 0.1, 1.6, ax ? Math.PI / 2 : 0, 0, ax ? 0 : Math.PI / 2);
    windows(mk, nx * 8, nz * 8, 12, 2, 9.5, 1, 2, nx, nz);
    // (the shaft's faces: pilasters at the corners and down the middle, slit windows between them up the tower)
    for (const u of [-4.6, 0, 4.6]) mk.box(0xe2c89a, nx * 5.1 + (ax ? u : 0), 28, nz * 5.1 + (ax ? 0 : u), ax ? 0.7 : 0.35, 32, ax ? 0.35 : 0.7);
    for (const u of [-2.3, 2.3]) {
      for (let y = 16; y < 42; y += 3.2) mk.box(dark, nx * 5.03 + (ax ? u : 0), y, nz * 5.03 + (ax ? 0 : u), ax ? 0.5 : 0.08, 1.9, ax ? 0.08 : 0.5);
    }
  }
  mk.box(stone, 0, 28, 0, 10, 32, 10);
  // the belfry: a balcony on its brackets, three open arches a side with columns, the cornice over them
  mk.box(0xe8d2a8, 0, 44.3, 0, 11.4, 0.6, 11.4);
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const ax = Math.abs(nz) > 0.5;
    for (let k = -4; k <= 4; k++) mk.box(0xe8d2a8, nx * 5.6 + (ax ? k * 1.3 : 0), 45.2, nz * 5.6 + (ax ? 0 : k * 1.3), 0.15, 1.2, 0.15);
    mk.box(0xe8d2a8, nx * 5.6, 45.9, nz * 5.6, ax ? 11.2 : 0.2, 0.15, ax ? 0.2 : 11.2);
  }
  mk.box(stone, 0, 48, 0, 9.6, 7, 9.6);
  for (const [nx, nz] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
    const ax = Math.abs(nz) > 0.5;
    for (const u of [-2.9, 0, 2.9]) {
      const x = nx * 4.82 + (ax ? u : 0);
      const z = nz * 4.82 + (ax ? 0 : u);
      if (lit) mk.glow(0xffd88a, x, 47.6, z, ax ? 2 : 0.1, 4.4, ax ? 0.1 : 2);
      else mk.box(0x2a2018, x, 47.6, z, ax ? 2 : 0.1, 4.4, ax ? 0.1 : 2);
      mk.cyl(lit ? 0xffd88a : 0x2a2018, x, 49.8, z, 1, 0.1, 1, ax ? Math.PI / 2 : 0, 0, ax ? 0 : Math.PI / 2);
    }
    for (const u of [-4.4, -1.45, 1.45, 4.4]) mk.cyl(0xe8d2a8, nx * 4.95 + (ax ? u : 0), 47.5, nz * 4.95 + (ax ? 0 : u), 0.28, 5, 0.28);
  }
  mk.box(0xe8d2a8, 0, 51.6, 0, 10.8, 0.9, 10.8);
  mk.box(stone, 0, 52.4, 0, 9, 0.8, 9);
  // the dome, its ribs, and the lantern and finial on top
  mk.geo(new THREE.SphereGeometry(1, 20, 10, 0, Math.PI * 2, 0, Math.PI / 2), TILE, 0, 52.7, 0, 4.5, 5.6, 4.5);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    mk.box(TILE_DARK, Math.sin(a) * 3.3, 55.6, Math.cos(a) * 3.3, 0.2, 4, 0.2, Math.cos(a) * 0.62, 0, -Math.sin(a) * 0.62);
  }
  mk.cyl(stone, 0, 58.6, 0, 0.9, 1.6, 0.9);
  mk.cone(TILE_DARK, 0, 59.9, 0, 1, 1.2, 1);
  mk.cyl(0xd8c098, 0, 60.9, 0, 0.1, 1.4, 0.1);
  if (lit) mk.light(0xff3a2a, 0, 61.7, 0, 0.35);
  return mk;
}

/**
 * The Dish: the 150-foot radio telescope, its reflector a paraboloid of white panels on a back structure, four feed legs
 * to the feed at its focus, on the yoke of its alt-az mount, on a concrete pedestal. Its bowl is about 46 m across;
 * `tilt` raises it from the horizon (radians).
 */
export function dishTelescope(THREE: Three, mk: ModelKit, tilt = 0.75, panels = 0xf2f1ec) {
  const R = 23;
  const depth = 6.5;
  // the pedestal and the turntable
  mk.cyl(0xc9c3b6, 0, 3, 0, 5, 6, 5);
  mk.cyl(0xb9b4a8, 0, 6.4, 0, 6.5, 0.8, 6.5);
  // the yoke: two A-frames up to the elevation bearings
  for (const sd of [-1, 1]) {
    for (const lz of [-1, 1]) mk.box(0xdcdad4, sd * 7.5, 13.5, lz * 3.2, 1.2, 14, 1.2, lz * 0.22, 0, 0);
    mk.box(0xdcdad4, sd * 7.5, 20.4, 0, 1.6, 1.6, 2.2);
    mk.box(0xbfbcb4, sd * 4, 7.2, 0, 8, 1, 7.5);
  }
  // the reflector: a paraboloid (lathed), its rim, and the back structure's ribs behind it
  const prof: T.Vector2[] = [];
  for (let k = 0; k <= 14; k++) {
    const r = (k / 14) * R;
    prof.push(new THREE.Vector2(Math.max(0.01, r), (r * r) / (R * R) * depth));
  }
  const bowl = new THREE.LatheGeometry(prof, 36);
  // (tipped up about the elevation axis, x, through the bearings)
  const tiltM = new THREE.Matrix4().makeRotationX(-Math.PI / 2 + tilt);
  const place = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(tiltM).add(new THREE.Vector3(0, 21, 0));
  mk.geo(bowl, panels, 0, 21, 0, 1, 1, 1, -Math.PI / 2 + tilt, 0, 0);
  // (and its inside, the face it turns to the sky: the same surface wound the other way, a hair in front)
  const inner = bowl.clone();
  const ix = inner.index!;
  for (let k = 0; k < ix.count; k += 3) {
    const a0 = ix.getX(k + 1);
    ix.setX(k + 1, ix.getX(k + 2));
    ix.setX(k + 2, a0);
  }
  inner.computeVertexNormals();
  mk.geo(inner, panels, 0, 21.02, 0, 1, 1, 1, -Math.PI / 2 + tilt, 0, 0);
  // (the panel seams: rings and spokes in grey, just proud of the surface)
  for (const rr of [8, 15.5, 22.8]) {
    const c = place(0, (rr * rr) / (R * R) * depth + 0.08, 0);
    mk.geo(new THREE.TorusGeometry(rr, 0.12, 4, 40), 0xb8b8b4, c.x, c.y, c.z, 1, 1, 1, tilt, 0, 0);
  }
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    const p0 = place(Math.cos(a) * 2, -0.6, Math.sin(a) * 2);
    const p1 = place(Math.cos(a) * R, depth - 2, Math.sin(a) * R);
    const mid = p0.clone().add(p1).multiplyScalar(0.5);
    const len = p0.distanceTo(p1);
    const dir = p1.clone().sub(p0).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const e = new THREE.Euler().setFromQuaternion(q);
    mk.box(0x9a9a96, mid.x, mid.y, mid.z, 0.5, len, 0.9, e.x, e.y, e.z);
  }
  // the feed legs from the rim to the feed at the focus
  const focus = place(0, (R * R) / (4 * depth) * 0.75, 0);
  for (let k = 0; k < 4; k++) {
    const a = (k / 4) * Math.PI * 2 + Math.PI / 4;
    const p0 = place(Math.cos(a) * R * 0.86, depth * 0.74, Math.sin(a) * R * 0.86);
    const mid = p0.clone().add(focus).multiplyScalar(0.5);
    const len = p0.distanceTo(focus);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), focus.clone().sub(p0).normalize());
    const e = new THREE.Euler().setFromQuaternion(q);
    mk.cyl(0xe8e6e0, mid.x, mid.y, mid.z, 0.3, len, 0.3, e.x, e.y, e.z);
  }
  mk.cyl(0xdcdad4, focus.x, focus.y, focus.z, 1.4, 2.4, 1.4, tilt - Math.PI / 2, 0, 0);
}

/**
 * A smooth hill, r across and h high, its grass golden with darker patches and oaks in its folds: one mesh, vertex
 * colored. Sits on the ground at (x, z).
 */
export function hill(THREE: Three, x: number, z: number, r: number, h: number, colors: [number, number, number] = [0xc8ad68, 0xa8924e, 0x5a6a34], seed = 3, sink = 0.5, rings = 28) {
  const N = rings;
  const g = new THREE.CircleGeometry(1, 48, 0, Math.PI * 2);
  // (a disc subdivided into rings, raised into a mound)
  const pos: number[] = [];
  const idx: number[] = [];
  const col: number[] = [];
  const rnd = scatter(seed);
  const ph = [rnd() * 6, rnd() * 6, rnd() * 6];
  const [ca, cb, cc] = colors.map((c) => new THREE.Color(c));
  const tmp = new THREE.Color();
  const A = Math.max(20, Math.round(rings * 1.4));
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    for (let j = 0; j < A; j++) {
      const a = (j / A) * Math.PI * 2;
      const wob = 1 + 0.12 * Math.sin(a * 3 + ph[0]) + 0.06 * Math.sin(a * 7 + ph[1]);
      const rr = u * r * wob;
      const y = h * Math.exp(-((u * 2.1) ** 2)) * (1 + 0.1 * Math.sin(a * 5 + ph[2]) * u) - sink;
      pos.push(x + Math.cos(a) * rr, y, z + Math.sin(a) * rr);
      const n = 0.5 + 0.5 * Math.sin(a * 6 + u * 9 + ph[1]) * Math.sin(u * 13 + ph[0]);
      tmp.copy(ca).lerp(cb, n);
      if (n > 0.78 && u > 0.2) tmp.lerp(cc, 0.75);
      col.push(tmp.r, tmp.g, tmp.b);
    }
  }
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < A; j++) {
      const a = i * A + j;
      const b = i * A + ((j + 1) % A);
      idx.push(a, b + A, a + A, a, b, b + A);
    }
  }
  g.dispose();
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  out.setIndex(idx);
  out.computeVertexNormals();
  return out;
}

export function vcMats(THREE: Three) {
  return { vc: new THREE.MeshLambertMaterial({ vertexColors: true }), lit: new THREE.MeshBasicMaterial({ vertexColors: true }) };
}

/**
 * Bakes a static group of plain-colored meshes (no textures) into one mesh with their colors as vertex colors, in the
 * group's parent's space, so a parked bike or a statue costs one draw rather than dozens. Meshes it cannot bake (with a
 * texture, or not Lambert or Basic) are moved over as they are. The group is left empty.
 */
export function bake(THREE: Three, root: T.Object3D, mats: { vc: T.Material; lit: T.Material }) {
  root.updateMatrixWorld(true);
  const inv = new THREE.Matrix4().copy(root.parent ? root.parent.matrixWorld : new THREE.Matrix4()).invert();
  const out = new THREE.Group();
  const lit: { g: T.BufferGeometry; m: T.Matrix4; color: [number, number, number] }[] = [];
  const solid: { g: T.BufferGeometry; m: T.Matrix4; color: [number, number, number] }[] = [];
  const keep: T.Mesh[] = [];
  root.traverse((o) => {
    const m = o as T.Mesh;
    if (!m.isMesh || (m as T.InstancedMesh).isInstancedMesh || !m.visible) return;
    const mat = m.material as T.MeshLambertMaterial & T.MeshBasicMaterial;
    if (Array.isArray(m.material) || mat.map || mat.transparent || !(mat.isMeshLambertMaterial || mat.isMeshBasicMaterial)) {
      keep.push(m);
      return;
    }
    const c = mat.color.clone();
    if (mat.isMeshLambertMaterial && mat.emissive) c.add(mat.emissive.clone().multiplyScalar(0.6));
    (mat.isMeshBasicMaterial ? lit : solid).push({ g: m.geometry, m: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), color: [c.r, c.g, c.b] });
  });
  if (solid.length) out.add(new THREE.Mesh(mergeColored(THREE, solid), mats.vc));
  if (lit.length) out.add(new THREE.Mesh(mergeColored(THREE, lit), mats.lit));
  for (const m of keep) {
    const w = new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld);
    m.removeFromParent();
    w.decompose(m.position, m.quaternion, m.scale);
    out.add(m);
  }
  return out;
}

function mergeColored(THREE: Three, parts: { g: T.BufferGeometry; m: T.Matrix4; color: [number, number, number] }[]) {
  const pos: number[] = [];
  const nrm: number[] = [];
  const col: number[] = [];
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const part of parts) {
    const g = part.g.index ? part.g.toNonIndexed() : part.g;
    const p = g.getAttribute('position');
    let n = g.getAttribute('normal');
    if (!n) {
      g.computeVertexNormals();
      n = g.getAttribute('normal');
    }
    nm.copy(part.m).invert().transpose();
    // (a mirrored part is wound the other way round)
    const flip = part.m.determinant() < 0;
    for (let k = 0; k < p.count; k++) {
      const kk = flip ? k - (k % 3) + [0, 2, 1][k % 3] : k;
      v.fromBufferAttribute(p, kk).applyMatrix4(part.m);
      pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, kk).transformDirection(nm);
      nrm.push(v.x, v.y, v.z);
      col.push(...part.color);
    }
    if (g !== part.g) g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/**
 * Bakes the plain-colored parts of a group that moves as a whole (a car, a bus) into a mesh or two in the group's own
 * space, leaving alone what animates by itself (`moving`, and everything under it) and what cannot be baked (textured,
 * see-through, sprites). Parts glowing with an emissive keep it: one mesh per emissive color.
 */
export function bakeInPlace(THREE: Three, g: T.Object3D, moving: T.Object3D[] = []) {
  g.updateMatrixWorld(true);
  const inv = g.matrixWorld.clone().invert();
  const skip = new Set(moving);
  const groups = new Map<string, { basic: boolean; emissive: number; parts: { g: T.BufferGeometry; m: T.Matrix4; color: [number, number, number] }[] }>();
  const gone: T.Mesh[] = [];
  const walk = (o: T.Object3D) => {
    if (skip.has(o)) return;
    const m = o as T.Mesh;
    if (m.isMesh && !(m as T.InstancedMesh).isInstancedMesh && m.visible) {
      const mat = m.material as T.MeshLambertMaterial & T.MeshBasicMaterial;
      if (!m.children.length && !Array.isArray(m.material) && !mat.map && !mat.transparent && (mat.isMeshLambertMaterial || mat.isMeshBasicMaterial)) {
        const emissive = mat.isMeshLambertMaterial && mat.emissive ? mat.emissive.getHex() : 0;
        const key = `${mat.isMeshBasicMaterial ? 'b' : 'l'}${emissive}`;
        let grp = groups.get(key);
        if (!grp) groups.set(key, (grp = { basic: !!mat.isMeshBasicMaterial, emissive, parts: [] }));
        grp.parts.push({ g: m.geometry, m: new THREE.Matrix4().multiplyMatrices(inv, m.matrixWorld), color: [mat.color.r, mat.color.g, mat.color.b] });
        gone.push(m);
      }
    }
    for (const c of [...o.children]) walk(c);
  };
  walk(g);
  for (const m of gone) m.removeFromParent();
  for (const grp of groups.values()) {
    const mat = grp.basic ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, emissive: grp.emissive });
    g.add(new THREE.Mesh(mergeColored(THREE, grp.parts), mat));
  }
  return g;
}

/**
 * Static batching: everything plain-colored added to the scene since `before` (a snapshot of its children) that does not
 * move (not under anything in `moving`) is baked into a few meshes per 120 m cell, keeping emissive glow; textured,
 * see-through and instanced meshes are left as they are. Many small pieces of scenery, a handful of draws.
 */
export function batchStatic(THREE: Three, scene: T.Scene, before: Set<T.Object3D>, moving: T.Object3D[]) {
  scene.updateMatrixWorld(true);
  const skip = new Set(moving);
  const CELL = 120;
  const cells = new Map<string, { basic: boolean; emissive: number; parts: { g: T.BufferGeometry; m: T.Matrix4; color: [number, number, number] }[] }>();
  const gone: T.Mesh[] = [];
  const box = new THREE.Box3();
  const mid = new THREE.Vector3();
  const walk = (o: T.Object3D) => {
    if (skip.has(o) || !o.visible) return;
    const m = o as T.Mesh;
    if (m.isMesh && !(m as T.InstancedMesh).isInstancedMesh && !m.children.length) {
      const mat = m.material as T.MeshLambertMaterial & T.MeshBasicMaterial;
      if (!Array.isArray(m.material) && !mat.map && !mat.transparent && !mat.vertexColors && mat.side !== THREE.DoubleSide && (mat.isMeshLambertMaterial || mat.isMeshBasicMaterial) && !m.userData.flat) {
        box.setFromObject(m).getCenter(mid);
        const emissive = mat.isMeshLambertMaterial && mat.emissive ? mat.emissive.getHex() : 0;
        const key = `${Math.floor(mid.x / CELL)},${Math.floor(mid.z / CELL)},${mat.isMeshBasicMaterial ? 'b' : 'l'}${emissive}`;
        let grp = cells.get(key);
        if (!grp) cells.set(key, (grp = { basic: !!mat.isMeshBasicMaterial, emissive, parts: [] }));
        grp.parts.push({ g: m.geometry, m: m.matrixWorld.clone(), color: [mat.color.r, mat.color.g, mat.color.b] });
        gone.push(m);
      }
    }
    for (const c of [...o.children]) walk(c);
  };
  for (const o of [...scene.children]) if (!before.has(o)) walk(o);
  for (const m of gone) m.removeFromParent();
  const mats = new Map<string, T.Material>();
  for (const grp of cells.values()) {
    const key = `${grp.basic}${grp.emissive}`;
    let mat = mats.get(key);
    if (!mat) mats.set(key, (mat = grp.basic ? new THREE.MeshBasicMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ vertexColors: true, emissive: grp.emissive })));
    scene.add(new THREE.Mesh(mergeColored(THREE, grp.parts), mat));
  }
}

/**
 * Meshes that never move and share a material merged into one mesh each (keeping their texture coordinates, so a map
 * still lays as it did): the decals on the ground, net panels and the like that batchStatic leaves alone because they are
 * textured, see-through or two-sided. Each merged mesh sits at its parts' middle, so it still sorts among the other
 * see-through things about where they did. Parts in a different draw order stay apart.
 */
export function mergeAlike(THREE: Three, scene: T.Scene, meshes: T.Mesh[]) {
  scene.updateMatrixWorld(true);
  const groups = new Map<string, { mat: T.Material; order: number; parts: T.Mesh[] }>();
  for (const m of meshes) {
    if (Array.isArray(m.material) || !m.geometry.getAttribute('uv') || !m.geometry.getAttribute('normal')) continue;
    const key = `${m.material.uuid} ${m.renderOrder}`;
    let grp = groups.get(key);
    if (!grp) groups.set(key, (grp = { mat: m.material, order: m.renderOrder, parts: [] }));
    grp.parts.push(m);
  }
  const v = new THREE.Vector3();
  const nm = new THREE.Matrix4();
  for (const { mat, order, parts } of groups.values()) {
    if (parts.length < 2) continue;
    const pos: number[] = [];
    const nrm: number[] = [];
    const uv: number[] = [];
    const idx: number[] = [];
    for (const m of parts) {
      const g = m.geometry;
      const p = g.getAttribute('position');
      const n = g.getAttribute('normal');
      const u = g.getAttribute('uv');
      const base = pos.length / 3;
      nm.copy(m.matrixWorld).invert().transpose();
      for (let k = 0; k < p.count; k++) {
        v.fromBufferAttribute(p, k).applyMatrix4(m.matrixWorld);
        pos.push(v.x, v.y, v.z);
        v.fromBufferAttribute(n, k).transformDirection(nm);
        nrm.push(v.x, v.y, v.z);
        uv.push(u.getX(k), u.getY(k));
      }
      // (a mirrored part is wound the other way round)
      const flip = m.matrixWorld.determinant() < 0;
      const tri = g.index ? Array.from(g.index.array as ArrayLike<number>) : Array.from({ length: p.count }, (_, k) => k);
      for (let k = 0; k + 2 < tri.length; k += 3) {
        if (flip) idx.push(base + tri[k], base + tri[k + 2], base + tri[k + 1]);
        else idx.push(base + tri[k], base + tri[k + 1], base + tri[k + 2]);
      }
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    out.setIndex(idx);
    out.computeBoundingBox();
    const mid = out.boundingBox!.getCenter(new THREE.Vector3());
    out.translate(-mid.x, -mid.y, -mid.z);
    const merged = new THREE.Mesh(out, mat);
    merged.position.copy(mid);
    merged.renderOrder = order;
    scene.add(merged);
    // (before the first frame: nothing of the parts was ever on the GPU)
    for (const m of parts) m.removeFromParent();
  }
}
