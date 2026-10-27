// A racing single scull for Redwood Slough (scene.ts builds one per racer when the course is raced in shells): the
// hull with its decks, washbox, fin, bow ball and bow number, the riggers and slide, two sculls with hatchet blades, and
// the rower in a unisuit and shades on the sliding seat, rowing a real stroke: catch, drive (legs, then back, then arms),
// finish, and recovery (hands away, body over, up the slide). The fittings are one mesh and the rower, the seat and both
// sculls another, skinned, its bones posed by a little two-bone solver each frame (drawn the karts' way: see kart.ts).
import type { T } from './gl';
import { merge } from './model';
import { FINISH, STICKER, kartModel } from './kart';

type Three = typeof import('three');

/** Where things are, in the shell's own frame: +z toward the bow, +y up, the rower facing the stern (-z). */
const HULL = { bow: 3.35, stern: -3.15, beam: 0.25, sheer: 0.25 };
/** The cockpit's open stretch between the decks. */
const COCKPIT = { from: -1.4, to: 0.32 };
/** The oarlocks: out on the riggers, a little toward the stern of the seat. */
export const PIN = { x: 0.86, y: 0.52, z: -0.72 };
/** The sculls: inboard of the pin (to the end of the handle) and outboard (to the tip of the blade). */
const INBOARD = 0.88;
const OUTBOARD = 2.05;
/** The seat's travel on the slide: at the catch (front stops, toward the stern) and at the finish. */
const SLIDE = { catch: -0.68, finish: -0.08, y: 0.33 };
/** The heels in the shoes on the foot stretcher. */
const FEET = { x: 0.11, y: 0.2, z: -1.02 };
const THIGH = 0.46;
const SHIN = 0.46;
const TORSO = 0.5;
const UPPER = 0.3;
const FORE = 0.3;

/** The hull's half-width at z (fine at both ends, fullest a little aft of the middle). */
const halfBeam = (z: number) => {
  const u = z >= -0.2 ? (z + 0.2) / (HULL.bow + 0.2) : (-0.2 - z) / (-0.2 - HULL.stern);
  return HULL.beam * Math.pow(Math.max(0, 1 - Math.pow(u, 2.1)), 0.62);
};

/** The hull: a rounded U section from gunwale to gunwale, run out to a point at each end, with a little rocker. */
function hullGeometry(THREE: Three) {
  const STATIONS = 32;
  const AROUND = 8;
  const pos: number[] = [];
  const uv: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= STATIONS; i++) {
    const z = HULL.stern + ((HULL.bow - HULL.stern) * i) / STATIONS;
    const w = halfBeam(z);
    const zn = (z - (HULL.bow + HULL.stern) / 2) / ((HULL.bow - HULL.stern) / 2);
    const keel = 0.02 + 0.07 * zn * zn;
    const top = HULL.sheer + (z > 0 ? 0.03 * (z / HULL.bow) : 0);
    for (let j = 0; j <= AROUND; j++) {
      const a = (j / AROUND) * Math.PI;
      pos.push(-Math.cos(a) * w, top - Math.sin(a) * (top - keel), z);
      // (u along the hull from the stern to the bow, v round it from the -x gunwale under the keel to the +x one)
      uv.push(i / STATIONS, j / AROUND);
    }
  }
  for (let i = 0; i < STATIONS; i++) {
    for (let j = 0; j < AROUND; j++) {
      const a = i * (AROUND + 1) + j;
      const b = a + AROUND + 1;
      idx.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** The hull's shape again, with its texture coordinates (see hullGeometry), for a decal painted over it. */
export const hullSkin = (THREE: Three) => hullGeometry(THREE);

/** The deck's height at x across it, z along it (crowned along the middle; see deckGeometry). */
const deckTop = (x: number, z: number) => {
  const w = halfBeam(z) * 1.02;
  const top = HULL.sheer + (z > 0 ? 0.03 * (z / HULL.bow) : 0);
  return top + 0.035 * Math.min(1, w / 0.1) * Math.max(0, 1 - Math.abs(x) / w);
};

/**
 * A strip w wide lying along both decks at x0 across them (a racing stripe), from as near the bow and the stern as the
 * decks are wide enough there, just over them.
 */
export function deckStripe(THREE: Three, x0: number, w: number) {
  const pos: number[] = [];
  const idx: number[] = [];
  const N = 24;
  const edge = Math.abs(x0) + w / 2;
  // (where the deck is wide enough: halfBeam falls away toward each end)
  const reach = (from: number, to: number) => {
    let z = from;
    const step = (to - from) / 200;
    while (Math.abs(z - from) < Math.abs(to - from) && halfBeam(z + step) > edge * 1.15) z += step;
    return z;
  };
  for (const [z0, z1] of [
    [COCKPIT.to + 0.05, reach(COCKPIT.to, HULL.bow)],
    [reach(COCKPIT.from, HULL.stern), COCKPIT.from - 0.05],
  ]) {
    const base = pos.length / 3;
    for (let i = 0; i <= N; i++) {
      const z = z0 + ((z1 - z0) * i) / N;
      for (const x of [x0 - w / 2, x0 + w / 2]) pos.push(x, deckTop(x, z) + 0.005, z);
      if (i < N) {
        const a = base + 2 * i;
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A deck from z0 to z1: crowned a little along the middle, gunwale to gunwale. */
function deckGeometry(THREE: Three, z0: number, z1: number) {
  const N = 16;
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const z = z0 + ((z1 - z0) * i) / N;
    const w = halfBeam(z) * 1.02;
    const top = HULL.sheer + (z > 0 ? 0.03 * (z / HULL.bow) : 0);
    for (const [x, y] of [[-w, top], [0, top + 0.035 * Math.min(1, w / 0.1)], [w, top]]) pos.push(x, y, z);
  }
  for (let i = 0; i < N; i++) {
    const a = i * 3;
    idx.push(a, a + 3, a + 1, a + 1, a + 3, a + 4, a + 1, a + 4, a + 2, a + 2, a + 4, a + 5);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A hatchet blade: flat, asymmetric (longer on the lower edge), its root at the origin and out along +x. */
function bladeShape(THREE: Three) {
  const s = new THREE.Shape();
  s.moveTo(0, -0.025);
  s.bezierCurveTo(0.08, -0.05, 0.14, -0.105, 0.26, -0.11);
  s.bezierCurveTo(0.38, -0.115, 0.46, -0.1, 0.48, -0.03);
  s.bezierCurveTo(0.5, 0.04, 0.45, 0.085, 0.36, 0.085);
  s.bezierCurveTo(0.24, 0.085, 0.1, 0.06, 0, 0.025);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false, curveSegments: 4 });
  g.translate(0, 0, -0.007);
  return g;
}

export type Scull = {
  /** The rower, the seat and both sculls: one skinned mesh, its bones set each frame. */
  mesh: T.SkinnedMesh;
  seat: T.Object3D;
  torso: T.Object3D;
  /** The head (centred on it: the racer's hat goes on it). */
  head: T.Object3D;
  limbs: { thigh: T.Object3D; shin: T.Object3D; upper: T.Object3D; fore: T.Object3D }[];
  /** Each scull, turned on its pin and about its shaft (to feather the blade). */
  oars: T.Object3D[];
  /** Where each blade's tip is, in the shell's frame, after posing (for the splashes). */
  tips: T.Vector3[];
  /** Where the blades' painted tips, and what is in the racer's colour (the unisuit and the blades), are among the mesh's vertices (to repaint them). */
  tipRanges: [number, number][];
  suitRanges: [number, number][];
};

/** The rower's bones: the seat, the torso (from the hips), the head, and each side's thigh, shin, upper arm and forearm; the sculls. */
const BONE = { seat: 0, torso: 1, head: 2, thigh: [3, 4], shin: [5, 6], upper: [7, 8], fore: [9, 10], oar: [11, 12] };
const SKIN = 0xe0ad84;

/**
 * Builds the scull into `body` (the kart view's body group): the hull in the racer's `paint` and its decks in `deck`;
 * the riggers, the slide, the stretcher and the bow number (idx + 1) in one mesh; and the rower in a unisuit of `suit`,
 * with the sculls, their blades in `blade` (all drawn the karts' way, see kartModel).
 */
export function buildScull(THREE: Three, body: T.Group, key: object, paint: T.Material, suit: string, blade: string, idx: number, deck: T.Material = paint): Scull {
  const F = FINISH;
  const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  // the hull in the racer's paint, and its decks fore and aft
  body.add(new THREE.Mesh(hullGeometry(THREE), paint));
  body.add(new THREE.Mesh(merge(THREE, [
    { g: deckGeometry(THREE, COCKPIT.to, HULL.bow), m: M(0, 0, 0) },
    { g: deckGeometry(THREE, HULL.stern, COCKPIT.from), m: M(0, 0, 0) },
  ]), deck));
  // the fittings: a pinstripe down each deck, the bow ball and the bow number on its card, the washbox in front of the
  // cockpit, the shoes on the stretcher; the cockpit floor, the slide's rails, the stretcher, the fin under the stern
  // and the riggers (two struts and a stay from the gunwale out to each pin, the pin and its gate)
  const s = kartModel(THREE, key);
  const white = 0xf1efe8;
  const carbon = 0x24262c;
  s.box(white, [0, HULL.sheer + 0.04, (COCKPIT.to + HULL.bow) / 2 - 0.2], [0.025, 0.012, HULL.bow - COCKPIT.to - 0.5], [0, 0, 0], F.GLOSS);
  s.box(white, [0, HULL.sheer + 0.036, (COCKPIT.from + HULL.stern) / 2], [0.025, 0.012, COCKPIT.from - HULL.stern - 0.4], [0, 0, 0], F.GLOSS);
  s.ball(white, [0, HULL.sheer + 0.02, HULL.bow + 0.02], [0.06, 0.06, 0.06], [0, 0, 0], F.GLOSS);
  s.box(white, [0, HULL.sheer + 0.11, HULL.bow - 0.35], [0.11, 0.12, 0.008], [0, 0, 0], F.PLASTIC);
  s.box(carbon, [0, HULL.sheer + 0.05, HULL.bow - 0.35], [0.01, 0.06, 0.01], [0, 0, 0], F.CARBON);
  for (const r of [0, Math.PI]) s.number(idx + 1, M(0, HULL.sheer + 0.115, HULL.bow - 0.35 + (r ? -0.005 : 0.005), 1, 1, 1, 0, r, 0), 0.08, 0.1, white);
  for (const sd of [-1, 1]) {
    s.box(white, [sd * 0.1, HULL.sheer + 0.06, COCKPIT.to + 0.18], [0.02, 0.09, 0.32], [0, sd * 0.5, 0], F.GLOSS);
    s.box(0xf6f6f8, [sd * FEET.x, FEET.y + 0.05, FEET.z + 0.13], [0.1, 0.09, 0.27], [0.95, 0, 0], F.PLASTIC);
    s.box(0x2a2b30, [sd * FEET.x, FEET.y + 0.0, FEET.z + 0.16], [0.105, 0.02, 0.28], [0.95, 0, 0], F.RUBBER);
    s.box(carbon, [sd * 0.09, 0.2, -0.3], [0.025, 0.03, 1.15], [0, 0, 0], F.ALLOY);
  }
  s.box(carbon, [0, 0.1, (COCKPIT.from + COCKPIT.to) / 2], [0.3, 0.02, COCKPIT.to - COCKPIT.from], [0, 0, 0], F.CARBON);
  s.box(carbon, [0, FEET.y + 0.06, FEET.z + 0.04], [0.34, 0.26, 0.02], [0.95, 0, 0], F.CARBON);
  s.box(carbon, [0, -0.06, -2.1], [0.012, 0.16, 0.22], [0, 0, 0], F.CARBON);
  for (const sd of [-1, 1]) {
    s.tube(carbon, [sd * 0.2, HULL.sheer, PIN.z + 0.32], [sd * PIN.x, PIN.y - 0.04, PIN.z], 0.016, F.CARBON);
    s.tube(carbon, [sd * 0.2, HULL.sheer, PIN.z - 0.32], [sd * PIN.x, PIN.y - 0.04, PIN.z], 0.016, F.CARBON);
    s.tube(carbon, [sd * 0.22, HULL.sheer - 0.06, PIN.z], [sd * PIN.x, PIN.y - 0.04, PIN.z], 0.012, F.CARBON);
    s.tube(0xb9bec6, [sd * PIN.x, PIN.y - 0.08, PIN.z], [sd * PIN.x, PIN.y + 0.1, PIN.z], 0.014, F.CHROME);
    s.box(0x2a2b30, [sd * PIN.x, PIN.y + 0.02, PIN.z], [0.05, 0.09, 0.07], [0, 0, 0], F.PLASTIC);
  }
  const fit = new THREE.Mesh(s.bake(), s.mat);
  body.add(fit);
  // the rower and the sculls, each part on its bone
  const r = kartModel(THREE, key);
  const suitAt: [number, number][] = [];
  const suitPart = (fn: () => void) => {
    const from = r.verts();
    fn();
    suitAt.push([from, r.verts()]);
  };
  const c = new THREE.Color(suit).getHex();
  // the seat
  r.bone(BONE.seat);
  r.box(carbon, [0, 0, 0], [0.24, 0.05, 0.26], [0, 0, 0], F.CARBON);
  for (const sd of [-1, 1]) r.cyl6(0x8d929a, [sd * 0.09, -0.03, 0], [0.025, 0.03, 0.025], [0, 0, Math.PI / 2], F.ALLOY);
  // the torso in the unisuit (facing the stern, -z), a white stripe down each side, the Block S on the chest and
  // Stanford across the back; bare shoulders and the neck
  r.bone(BONE.torso);
  const lathe = new THREE.LatheGeometry(
    [[0.001, -0.04], [0.15, -0.03], [0.165, 0.07], [0.15, 0.19], [0.165, 0.31], [0.175, 0.39], [0.15, 0.46], [0.09, 0.5], [0.001, 0.51]].map(([x, y]) => new THREE.Vector2(x, y)),
    9,
  );
  suitPart(() => r.push(lathe, M(0, 0, 0, 1, 1, 0.74), c, F.CLOTH));
  for (const sd of [-1, 1]) {
    r.box(0xf6f6f8, [sd * 0.158, 0.22, 0], [0.025, 0.42, 0.1], [0, 0, sd * 0.05], F.CLOTH);
  }
  r.sticker(STICKER.blockS, [0, 0.32, -0.172 * 0.74 * 0.98 - 0.002], 0.08, 0.08, [0, Math.PI, 0], 0xffffff, 0.15);
  r.sticker(STICKER.stanford, [0, 0.33, 0.175 * 0.74 + 0.002], 0.22, 0.055, [0, 0, 0], 0xffffff, 0.15);
  r.cyl(SKIN, [0, 0.54, 0], [0.05, 0.12, 0.05], [0, 0, 0], F.CLOTH);
  // the head, centred on its bone, the face toward the stern: ears, nose, wraparound shades and the hair under the hat
  r.bone(BONE.head);
  r.ball(SKIN, [0, 0, 0], [0.11, 0.128, 0.118], [0, 0, 0], F.CLOTH);
  r.ball6(SKIN, [0, -0.01, -0.115], [0.022, 0.03, 0.025], [0, 0, 0], F.CLOTH);
  for (const sd of [-1, 1]) r.ball6(SKIN, [sd * 0.108, 0, 0.01], [0.022, 0.035, 0.03], [0, 0, 0], F.CLOTH);
  r.push(new THREE.SphereGeometry(1, 8, 2, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.4, Math.PI * 0.12), M(0, 0, 0, 0.116, 0.134, 0.124), 0x14161c, F.GLASS);
  r.push(new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI * 0.55), M(0, 0.008, 0.012, 0.115, 0.13, 0.122), 0x3a2a1e, F.CLOTH);
  // the legs: the unisuit down to mid-thigh, then bare legs, white socks
  for (const n of [0, 1]) {
    r.bone(BONE.thigh[n]);
    suitPart(() => r.push(new THREE.CylinderGeometry(0.068, 0.078, THIGH * 0.55, 6, 1, true), M(0, THIGH * 0.275, 0), c, F.CLOTH));
    r.push(new THREE.CylinderGeometry(0.055, 0.067, THIGH * 0.47, 6, 1, true), M(0, THIGH * 0.76, 0), SKIN, F.CLOTH);
    r.bone(BONE.shin[n]);
    r.ball6(SKIN, [0, 0, 0], [0.058, 0.058, 0.058], [0, 0, 0], F.CLOTH);
    r.push(new THREE.CylinderGeometry(0.036, 0.052, SHIN * 0.8, 6, 1, true), M(0, SHIN * 0.4, 0), SKIN, F.CLOTH);
    r.push(new THREE.CylinderGeometry(0.035, 0.037, SHIN * 0.2, 6, 1, true), M(0, SHIN * 0.9, 0), 0xf6f6f8, F.CLOTH);
  }
  // the arms, bare, the hands round the grips
  for (const n of [0, 1]) {
    r.bone(BONE.upper[n]);
    r.ball6(SKIN, [0, 0, 0], [0.055, 0.052, 0.058], [0, 0, 0], F.CLOTH);
    r.push(new THREE.CylinderGeometry(0.038, 0.047, UPPER, 6, 1, true), M(0, UPPER / 2, 0), SKIN, F.CLOTH);
    r.bone(BONE.fore[n]);
    r.ball6(SKIN, [0, 0, 0], [0.038, 0.038, 0.038], [0, 0, 0], F.CLOTH);
    r.push(new THREE.CylinderGeometry(0.03, 0.038, FORE, 6, 1, true), M(0, FORE / 2, 0), SKIN, F.CLOTH);
    r.ball6(SKIN, [0, FORE + 0.01, 0], [0.04, 0.05, 0.042], [0, 0, 0], F.CLOTH);
  }
  // the sculls: a white shaft, the black grip on the handle and the collar at the pin, the blade in the racer's colour
  // with its tip (painted in the colour of the wheels), out along +x from the pin (the left one mirrored)
  const bc = new THREE.Color(blade).getHex();
  const tipAt: [number, number][] = [];
  [-1, 1].forEach((sd, n) => {
    r.bone(BONE.oar[n]);
    r.push(new THREE.CylinderGeometry(1, 1, 1, 5, 1, true), M((sd * (OUTBOARD - INBOARD)) / 2 - sd * 0.12, 0, 0, 0.022, OUTBOARD + INBOARD - 0.5, 0.022, 0, 0, Math.PI / 2), 0xf0f0eb, F.GLOSS);
    r.cyl6(0x141518, [-sd * (INBOARD - 0.08), 0, 0], [0.027, 0.16, 0.027], [0, 0, Math.PI / 2], F.RUBBER);
    r.cyl6(0xdcdcd6, [sd * 0.04, 0, 0], [0.04, 0.06, 0.04], [0, 0, Math.PI / 2], F.PLASTIC);
    suitPart(() => r.push(bladeShape(THREE), M(sd * (OUTBOARD - 0.49), 0, 0, sd, 1, 1), bc, F.GLOSS));
    const from = r.verts();
    r.box(0xf7f7f2, [sd * (OUTBOARD - 0.03), -0.02, 0], [0.05, 0.12, 0.018], [0, 0, 0], F.GLOSS);
    tipAt.push([from, r.verts()]);
  });
  const bones = Array.from({ length: 13 }, () => new THREE.Object3D());
  const mesh = new THREE.SkinnedMesh(r.bake(true), r.mat);
  for (const b of bones) mesh.add(b);
  // (plain objects as bones: all a skeleton needs of them is their matrices)
  mesh.bind(new THREE.Skeleton(bones as unknown as T.Bone[], bones.map(() => new THREE.Matrix4())), new THREE.Matrix4());
  body.add(mesh);
  const scull: Scull = {
    mesh,
    seat: bones[BONE.seat],
    torso: bones[BONE.torso],
    head: bones[BONE.head],
    limbs: [0, 1].map((n) => ({ thigh: bones[BONE.thigh[n]], shin: bones[BONE.shin[n]], upper: bones[BONE.upper[n]], fore: bones[BONE.fore[n]] })),
    oars: BONE.oar.map((b) => bones[b]),
    tips: [new THREE.Vector3(), new THREE.Vector3()],
    tipRanges: tipAt,
    suitRanges: suitAt,
  };
  poseScull(THREE, scull, [0, 1].map(() => ({ sweep: 0, dip: 0, feather: 0 })), 0.75, 0.55, 0);
  // (culled by a generous sphere round the cockpit, whatever the pose)
  mesh.updateMatrixWorld(true);
  mesh.skeleton.update();
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  mesh.boundingSphere!.center.set(0, 0.6, -0.5);
  mesh.boundingSphere!.radius = 3.4;
  return scull;
}

/** Paints vertex ranges of a scull's mesh in `color`. */
function repaint(THREE: Three, s: Scull, ranges: [number, number][], color: string) {
  const col = s.mesh.geometry.getAttribute('color') as T.BufferAttribute;
  const c = new THREE.Color(color);
  for (const [a, b] of ranges) for (let k = a; k < b; k++) col.setXYZ(k, c.r, c.g, c.b);
  col.needsUpdate = true;
}
/** Paints the tips of a scull's blades (white to start with) in `color`. */
export const tintTips = (THREE: Three, s: Scull, color: string) => repaint(THREE, s, s.tipRanges, color);
/** The rower's unisuit and the blades in a new colour. */
export const resuit = (THREE: Three, s: Scull, color: string) => repaint(THREE, s, s.suitRanges, color);

const ease = (u: number) => u * u * (3 - 2 * u);
const clamp01 = (u: number) => Math.max(0, Math.min(1, u));

/** The stroke at phase (0 the catch, `drive` the finish): the seat along the slide and the lean of the back. */
export function strokeBody(phase: number, drive: number) {
  if (phase < drive) {
    const u = phase / drive;
    // legs first, then the back opens, then the arms draw in
    return { slide: ease(clamp01(u / 0.62)), lean: ease(clamp01((u - 0.2) / 0.7)) };
  }
  const u = (phase - drive) / (1 - drive);
  // hands away, body over, then up the slide to the next catch
  return { slide: 1 - ease(clamp01((u - 0.28) / 0.72)), lean: 1 - ease(clamp01(u / 0.4)) };
}

// scratch for the solver and the pose
type Scratch = Record<'a' | 'b' | 'c' | 'd' | 'up' | 'hip' | 'shoulder' | 'knee' | 'elbow' | 'hand' | 'sh' | 'foot' | 'pole', T.Vector3>;
let V: Scratch | null = null;
let Q: { pin: T.Quaternion; feather: T.Quaternion; e: T.Euler } | null = null;

/** Puts a bone at a, its +y pointing at b. */
function aim(bone: T.Object3D, a: T.Vector3, b: T.Vector3) {
  const v = V!;
  bone.position.copy(a);
  v.d.subVectors(b, a).normalize();
  bone.quaternion.setFromUnitVectors(v.up, v.d);
}

/**
 * Where the joint goes between two bones of lengths l1 and l2, from a to b, bent toward `pole` (out = the joint). Too far
 * apart, the limb goes straight toward b.
 */
function solve(a: T.Vector3, b: T.Vector3, l1: number, l2: number, pole: T.Vector3, out: T.Vector3) {
  const v = V!;
  v.a.subVectors(b, a);
  const d = Math.min(v.a.length(), l1 + l2 - 1e-4);
  const dir = v.a.normalize();
  const x = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - x * x));
  // (the bend: toward the pole, square to the line from a to b)
  v.b.copy(pole).addScaledVector(dir, -pole.dot(dir)).normalize();
  out.copy(a).addScaledVector(dir, x).addScaledVector(v.b, h);
}

/**
 * Poses the rower and sculls. sweep/dip/feather per oar (sweep: toward the bow at the catch; dip: the blade end up;
 * feather 0 squared to 1 flat), `slide` 0 at the catch to 1 at the finish and `lean` the same for the back; crab, a crab
 * throwing the rower back; cheer, both fists in the air (the sculls let go, trailing); rest, the hands off the handles
 * and on the knees (the sculls in along the hull).
 */
export function poseScull(THREE: Three, s: Scull, oar: { sweep: number; dip: number; feather: number }[], slide: number, lean: number, crab: number, cheer = 0, rest = 0) {
  if (!V) {
    const keys = ['a', 'b', 'c', 'd', 'up', 'hip', 'shoulder', 'knee', 'elbow', 'hand', 'sh', 'foot', 'pole'] as const;
    V = Object.fromEntries(keys.map((k) => [k, new THREE.Vector3()])) as Scratch;
    V.up.set(0, 1, 0);
    Q = { pin: new THREE.Quaternion(), feather: new THREE.Quaternion(), e: new THREE.Euler() };
  }
  const { knee, elbow, hand, sh, foot, pole } = V;
  const q = Q!;
  const hip = V.hip.set(0, SLIDE.y + 0.06, SLIDE.catch + (SLIDE.finish - SLIDE.catch) * slide);
  s.seat.position.set(0, SLIDE.y - 0.04, hip.z + 0.03);
  s.seat.quaternion.identity();
  // the back: forward over the knees at the catch, laid back at the finish (thrown back further by a crab, sat up
  // straight to cheer)
  const th = (0.42 - 0.74 * lean + 0.35 * crab) * (1 - cheer) - 0.08 * cheer;
  const shoulder = V.shoulder.set(0, hip.y + Math.cos(th) * TORSO, hip.z - Math.sin(th) * TORSO);
  s.torso.position.copy(hip);
  s.torso.quaternion.setFromEuler(q.e.set(-th, 0, 0));
  // (the head stays nearer level than the back, looking down the boat; up at the sky to cheer)
  s.head.position.set(0, shoulder.y + Math.cos(th * 0.6) * 0.17, shoulder.z - Math.sin(th * 0.6) * 0.17);
  s.head.quaternion.setFromEuler(q.e.set(-th * 0.35 + 0.25 * cheer, 0, 0));
  s.oars.forEach((pin, n) => {
    const sd = n ? 1 : -1;
    const o = oar[n];
    q.pin.setFromEuler(q.e.set(0, -sd * o.sweep, sd * o.dip));
    q.feather.setFromEuler(q.e.set(sd * o.feather * (Math.PI / 2), 0, 0));
    pin.position.set(sd * PIN.x, PIN.y, PIN.z);
    pin.quaternion.copy(q.pin).multiply(q.feather);
    // (the handle, inboard of the pin along the shaft)
    const cd = Math.cos(o.dip);
    const dirx = sd * cd * Math.cos(o.sweep);
    const diry = Math.sin(o.dip);
    const dirz = cd * Math.sin(o.sweep);
    hand.set(sd * PIN.x - dirx * (INBOARD - 0.08), PIN.y - diry * (INBOARD - 0.08), PIN.z - dirz * (INBOARD - 0.08));
    s.tips[n].set(sd * PIN.x + dirx * (OUTBOARD - 0.2), PIN.y + diry * (OUTBOARD - 0.2), PIN.z + dirz * (OUTBOARD - 0.2));
    const L = s.limbs[n];
    // legs: from the hip to the heel in the shoe, the knee up
    foot.set(sd * FEET.x, FEET.y, FEET.z);
    const h = V!.c.set(sd * 0.1, hip.y, hip.z);
    solve(h, foot, THIGH, SHIN, pole.set(sd * 0.15, 1, 0), knee);
    aim(L.thigh, h, knee);
    aim(L.shin, knee, foot);
    // arms: from the shoulder to the hand on the grip, the elbow out and down (resting, on the knee; to cheer, fists up
    // over the head)
    sh.set(sd * 0.17, shoulder.y - 0.04, shoulder.z);
    if (rest > 0) hand.lerp(V!.a.copy(knee).add(V!.b.set(sd * 0.02, 0.07, 0.04)), rest);
    if (cheer > 0) {
      V!.a.set(sd * 0.22, 0.55, -0.05).add(sh);
      hand.lerp(V!.a, cheer);
    }
    solve(sh, hand, UPPER, FORE, pole.set(sd * 1, -0.6 + cheer * 0.5, 0.6), elbow);
    // (out of reach, the hand stops short of the grip)
    const reach = V!.d.subVectors(hand, sh).length();
    if (reach > UPPER + FORE) hand.copy(sh).addScaledVector(V!.d.normalize(), UPPER + FORE);
    aim(L.upper, sh, elbow);
    aim(L.fore, elbow, hand);
  });
}

/**
 * One of an eight's crew (a Mega on the water), sat facing the stern, from the hips: a unisuit of `suit`, a cap of it
 * and shades, arms out to the handle of the oar on the `side` it rows on; and that sweep oar, out along x from its pin,
 * its blade in `blade`. Each one mesh, drawn the karts' way.
 */
export function crewGeometry(THREE: Three, key: object, suit: string, side: number) {
  const F = FINISH;
  const r = kartModel(THREE, key);
  const c = new THREE.Color(suit).getHex();
  const lathe = new THREE.LatheGeometry(
    [[0.001, -0.04], [0.15, -0.03], [0.165, 0.07], [0.15, 0.19], [0.165, 0.31], [0.175, 0.39], [0.15, 0.46], [0.09, 0.5], [0.001, 0.51]].map(([x, y]) => new THREE.Vector2(x, y)),
    10,
  );
  r.push(lathe, new THREE.Matrix4().makeScale(1, 1, 0.74), c, F.CLOTH);
  for (const sd of [-1, 1]) {
    r.box(0xf6f6f8, [sd * 0.158, 0.22, 0], [0.025, 0.42, 0.1], [0, 0, sd * 0.05], F.CLOTH);
    // (the thighs forward under the arms; the arms out to the handle, the hands together on it)
    r.tube(c, [sd * 0.1, 0, 0], [sd * 0.13, 0.12, -0.42], 0.07, F.CLOTH);
    r.tube(SKIN, [sd * 0.17, 0.44, 0], [-side * 0.06 + sd * 0.06, 0.24, -0.4], 0.042, F.CLOTH);
    r.ball6(SKIN, [-side * 0.06 + sd * 0.06, 0.24, -0.42], [0.042, 0.048, 0.042], [0, 0, 0], F.CLOTH);
  }
  r.cyl(SKIN, [0, 0.54, 0], [0.05, 0.12, 0.05], [0, 0, 0], F.CLOTH);
  r.ball(SKIN, [0, 0.67, -0.02], [0.11, 0.128, 0.118], [0, 0, 0], F.CLOTH);
  r.push(new THREE.SphereGeometry(1, 10, 3, Math.PI * 1.15, Math.PI * 0.7, Math.PI * 0.4, Math.PI * 0.12), new THREE.Matrix4().compose(new THREE.Vector3(0, 0.67, -0.02), new THREE.Quaternion(), new THREE.Vector3(0.116, 0.134, 0.124)), 0x14161c, F.GLASS);
  r.push(new THREE.SphereGeometry(1, 10, 4, 0, Math.PI * 2, 0, Math.PI * 0.45), new THREE.Matrix4().compose(new THREE.Vector3(0, 0.69, -0.02), new THREE.Quaternion(), new THREE.Vector3(0.118, 0.13, 0.124)), c, F.CLOTH);
  r.box(c, [0, 0.72, -0.15], [0.16, 0.015, 0.12], [0.2, 0, 0], F.CLOTH);
  return r.bake();
}

export function sweepGeometry(THREE: Three, key: object, blade: string, side: number) {
  const F = FINISH;
  const r = kartModel(THREE, key);
  r.tube(0xf0f0eb, [-side * 0.75, 0, 0], [side * 3.0, 0, 0], 0.025, F.GLOSS);
  r.cyl6(0x141518, [-side * 0.68, 0, 0], [0.03, 0.2, 0.03], [0, 0, Math.PI / 2], F.RUBBER);
  r.cyl6(0xdcdcd6, [0, 0, 0], [0.045, 0.07, 0.045], [0, 0, Math.PI / 2], F.PLASTIC);
  r.push(bladeShape(THREE), new THREE.Matrix4().compose(new THREE.Vector3(side * 2.95, 0, 0), new THREE.Quaternion(), new THREE.Vector3(side * 1.2, 1.3, 1)), new THREE.Color(blade).getHex(), F.GLOSS);
  return r.bake();
}
