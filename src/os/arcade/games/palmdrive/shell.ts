// A racing single scull for Redwood Slough (scene.ts builds one per racer when the course is raced in shells): the
// hull with its decks, washbox, fin and bow ball, the riggers and slide, two sculls with hatchet blades, and the rower in
// a unisuit on the sliding seat, rowing a real stroke: catch, drive (legs, then back, then arms), finish, and recovery
// (hands away, body over, up the slide). Static parts share a mesh per material; the rower's limbs are posed by a little
// two-bone solver each frame.
import type { T } from './gl';
import { merge } from './model';

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
  const STATIONS = 40;
  const AROUND = 10;
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
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.014, bevelEnabled: false, curveSegments: 6 });
  g.translate(0, 0, -0.007);
  return g;
}

export type Scull = {
  /** The seat (slides), the rower's parts (posed each frame) and the two sculls (each on its pin). */
  seat: T.Mesh;
  torso: T.Mesh;
  head: T.Group;
  limbs: { thigh: T.Mesh; shin: T.Mesh; upper: T.Mesh; fore: T.Mesh; hand: T.Mesh }[];
  oars: T.Group[];
  /** Each oar's own mesh, turned about the shaft to feather the blade. */
  looms: T.Mesh[];
  /** Where each blade's tip is, in the shell's frame, after posing (for the splashes). */
  tips: T.Vector3[];
  /** How many of the vertices at the end of each oar's mesh are the blade's painted tip (see tintTips). */
  tipVerts: number;
};

/** Shared by every shell in a race: the materials that do not take the racer's color. */
export function scullKit(THREE: Three) {
  return {
    white: new THREE.MeshLambertMaterial({ color: 0xf1efe8 }),
    carbon: new THREE.MeshLambertMaterial({ color: 0x24262c }),
    alloy: new THREE.MeshLambertMaterial({ color: 0xb8bec6 }),
    oar: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    limb: new THREE.CylinderGeometry(0.85, 1, 1, 8, 1),
    joint: new THREE.SphereGeometry(1, 8, 6),
  };
}
export type ScullKit = ReturnType<typeof scullKit>;

/**
 * Builds the scull into `body` (the kart view's body group) in the racer's color: `paint` (the hull and the unisuit),
 * `deck` (the decks fore and aft: the paint unless given) and `skin`. `blade` is the blade's color and `head` the group the
 * racer's hat goes on.
 */
export function buildScull(THREE: Three, body: T.Group, kit: ScullKit, paint: T.Material, skin: T.Material, blade: string, deck: T.Material = paint): Scull {
  const M = (x: number, y: number, z: number, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(sx, sy, sz));
  const box = new THREE.BoxGeometry(1, 1, 1);
  const cyl = new THREE.CylinderGeometry(1, 1, 1, 8);
  const ball = new THREE.SphereGeometry(1, 10, 8);
  // the hull in the racer's paint, and its decks fore and aft
  body.add(new THREE.Mesh(hullGeometry(THREE), paint));
  const decks = new THREE.Mesh(merge(THREE, [
    { g: deckGeometry(THREE, COCKPIT.to, HULL.bow), m: M(0, 0, 0) },
    { g: deckGeometry(THREE, HULL.stern, COCKPIT.from), m: M(0, 0, 0) },
  ]), deck);
  body.add(decks);
  // the white parts: a pinstripe down each deck, the bow ball, the washbox in front of the cockpit, and the shoes
  const white = merge(THREE, [
    { g: box, m: M(0, HULL.sheer + 0.04, (COCKPIT.to + HULL.bow) / 2 - 0.2, 0.025, 0.012, HULL.bow - COCKPIT.to - 0.5) },
    { g: box, m: M(0, HULL.sheer + 0.036, (COCKPIT.from + HULL.stern) / 2, 0.025, 0.012, COCKPIT.from - HULL.stern - 0.4) },
    { g: ball, m: M(0, HULL.sheer + 0.02, HULL.bow + 0.02, 0.06, 0.06, 0.06) },
    // (the washbox: a low V of a breakwater pointing to the bow)
    ...[-1, 1].map((sd) => ({ g: box, m: M(sd * 0.1, HULL.sheer + 0.06, COCKPIT.to + 0.18, 0.02, 0.09, 0.32, 0, sd * 0.5, 0) })),
    // (the heels' shoes on the stretcher)
    ...[-1, 1].map((sd) => ({ g: box, m: M(sd * FEET.x, FEET.y + 0.05, FEET.z + 0.13, 0.1, 0.09, 0.27, 0.95, 0, 0) })),
  ]);
  body.add(new THREE.Mesh(white, kit.white));
  // the dark parts: the cockpit floor, the slide's rails, the foot stretcher, the fin under the stern, and the riggers
  // (two struts and a stay from the gunwale out to each pin, and the pin itself)
  const dark: { g: T.BufferGeometry; m: T.Matrix4 }[] = [
    { g: box, m: M(0, 0.1, (COCKPIT.from + COCKPIT.to) / 2, 0.3, 0.02, COCKPIT.to - COCKPIT.from) },
    ...[-1, 1].map((sd) => ({ g: box, m: M(sd * 0.09, 0.2, -0.3, 0.025, 0.03, 1.15) })),
    { g: box, m: M(0, FEET.y + 0.06, FEET.z + 0.04, 0.34, 0.26, 0.02, 0.95, 0, 0) },
    { g: box, m: M(0, -0.06, -2.1, 0.012, 0.16, 0.22) },
  ];
  const strut = (ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number) => {
    const a = new THREE.Vector3(ax, ay, az);
    const b = new THREE.Vector3(bx, by, bz);
    const d = b.clone().sub(a);
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
    dark.push({ g: cyl, m: new THREE.Matrix4().compose(a.add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, d.length(), r)) });
  };
  for (const sd of [-1, 1]) {
    strut(sd * 0.2, HULL.sheer, PIN.z + 0.32, sd * PIN.x, PIN.y - 0.04, PIN.z, 0.016);
    strut(sd * 0.2, HULL.sheer, PIN.z - 0.32, sd * PIN.x, PIN.y - 0.04, PIN.z, 0.016);
    strut(sd * 0.22, HULL.sheer - 0.06, PIN.z, sd * PIN.x, PIN.y - 0.04, PIN.z, 0.012);
    strut(sd * PIN.x, PIN.y - 0.08, PIN.z, sd * PIN.x, PIN.y + 0.1, PIN.z, 0.014);
  }
  body.add(new THREE.Mesh(merge(THREE, dark), kit.carbon));
  // the seat, on the slide
  const seat = new THREE.Mesh(box, kit.carbon);
  seat.scale.set(0.24, 0.05, 0.26);
  body.add(seat);
  // the rower: a unisuit in the racer's color, bare arms and calves
  const part = (g: T.BufferGeometry, m: T.Material) => {
    const o = new THREE.Mesh(g, m);
    body.add(o);
    return o;
  };
  const torso = part(ball, paint);
  const head = new THREE.Group();
  const face = new THREE.Mesh(ball, skin);
  face.scale.set(0.12, 0.135, 0.12);
  head.add(face);
  body.add(head);
  const limbs = [-1, 1].map(() => ({ thigh: part(kit.limb, paint), shin: part(kit.limb, skin), upper: part(kit.limb, skin), fore: part(kit.limb, skin), hand: part(kit.joint, skin) }));
  // the sculls: a white shaft, a black grip on the handle and a collar at the pin, the blade in the racer's color with a
  // white tip; each in one mesh, laid out along +x from the pin (a left one mirrored)
  const c = new THREE.Color(blade);
  const bc: [number, number, number] = [c.r, c.g, c.b];
  const oars: T.Group[] = [];
  const looms: T.Mesh[] = [];
  // (the tip is the last part of each oar's mesh: a box, unindexed)
  const tipVerts = box.index ? box.index.count : box.getAttribute('position').count;
  for (const sd of [-1, 1]) {
    const loom = merge(THREE, [
      { g: cyl, m: M(sd * (OUTBOARD - INBOARD) / 2 - sd * 0.12, 0, 0, 0.022, OUTBOARD + INBOARD - 0.5, 0.022, 0, 0, Math.PI / 2), color: [0.94, 0.94, 0.92] },
      { g: cyl, m: M(-sd * (INBOARD - 0.08), 0, 0, 0.026, 0.16, 0.026, 0, 0, Math.PI / 2), color: [0.08, 0.08, 0.09] },
      { g: cyl, m: M(sd * 0.04, 0, 0, 0.04, 0.06, 0.04, 0, 0, Math.PI / 2), color: [0.85, 0.85, 0.82] },
      { g: bladeShape(THREE), m: M(sd * (OUTBOARD - 0.49), 0, 0, sd, 1, 1), color: bc },
      { g: box, m: M(sd * (OUTBOARD - 0.03), -0.02, 0, 0.05, 0.12, 0.018), color: [0.97, 0.97, 0.95] },
    ]);
    const mesh = new THREE.Mesh(loom, kit.oar);
    const pin = new THREE.Group();
    pin.position.set(sd * PIN.x, PIN.y, PIN.z);
    pin.add(mesh);
    body.add(pin);
    oars.push(pin);
    looms.push(mesh);
  }
  box.dispose();
  cyl.dispose();
  ball.dispose();
  return { seat, torso, head, limbs, oars, looms, tips: [new THREE.Vector3(), new THREE.Vector3()], tipVerts };
}

/** Paints the tips of a scull's blades (white to start with) in `color`. */
export function tintTips(THREE: Three, s: Scull, color: string) {
  const c = new THREE.Color(color);
  for (const loom of s.looms) {
    const col = loom.geometry.getAttribute('color') as T.BufferAttribute;
    for (let k = col.count - s.tipVerts; k < col.count; k++) col.setXYZ(k, c.r, c.g, c.b);
    col.needsUpdate = true;
  }
}

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

/** Lays a limb (a tapered cylinder) from a to b, `r` thick. */
function bone(m: T.Mesh, a: T.Vector3, b: T.Vector3, r: number) {
  const v = V!;
  v.d.subVectors(b, a);
  const len = v.d.length();
  m.position.addVectors(a, b).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(v.up, v.d.divideScalar(len || 1));
  m.scale.set(r, len, r);
}

/**
 * Where the joint between two bones of lengths l1 and l2 goes, from a to b, bent toward `pole` (out = the joint). Too far
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
 * feather 0 squared to 1 flat), `slide` 0 at the catch to 1 at the finish and `lean` the same for the back.
 */
export function poseScull(THREE: Three, s: Scull, oar: { sweep: number; dip: number; feather: number }[], slide: number, lean: number, crab: number) {
  if (!V) {
    const keys = ['a', 'b', 'c', 'd', 'up', 'hip', 'shoulder', 'knee', 'elbow', 'hand', 'sh', 'foot', 'pole'] as const;
    V = Object.fromEntries(keys.map((k) => [k, new THREE.Vector3()])) as Scratch;
    V.up.set(0, 1, 0);
  }
  const { knee, elbow, hand, sh, foot, pole } = V;
  const hip = V.hip.set(0, SLIDE.y + 0.06, SLIDE.catch + (SLIDE.finish - SLIDE.catch) * slide);
  s.seat.position.set(0, SLIDE.y - 0.04, hip.z + 0.03);
  // the back: forward over the knees at the catch, laid back at the finish (thrown back further by a crab)
  const th = 0.42 - 0.74 * lean + 0.35 * crab;
  const shoulder = V.shoulder.set(0, hip.y + Math.cos(th) * TORSO, hip.z - Math.sin(th) * TORSO);
  s.torso.position.set(0, hip.y + Math.cos(th) * TORSO * 0.52, hip.z - Math.sin(th) * TORSO * 0.52);
  s.torso.rotation.set(-th, 0, 0);
  s.torso.scale.set(0.17, 0.3, 0.12);
  s.head.position.set(0, shoulder.y + Math.cos(th * 0.6) * 0.17, shoulder.z - Math.sin(th * 0.6) * 0.17);
  s.head.rotation.set(-th * 0.4, 0, 0);
  s.oars.forEach((pin, n) => {
    const sd = n ? 1 : -1;
    const o = oar[n];
    pin.rotation.set(0, -sd * o.sweep, sd * o.dip);
    s.looms[n].rotation.x = sd * o.feather * (Math.PI / 2);
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
    bone(L.thigh, h, knee, 0.075);
    bone(L.shin, knee, foot, 0.055);
    // arms: from the shoulder to the hand on the grip, the elbow out and down
    sh.set(sd * 0.17, shoulder.y - 0.04, shoulder.z);
    solve(sh, hand, UPPER, FORE, pole.set(sd * 1, -0.6, 0.6), elbow);
    // (out of reach, the hand stops short of the grip)
    const reach = V!.d.subVectors(hand, sh).length();
    if (reach > UPPER + FORE) hand.copy(sh).addScaledVector(V!.d.normalize(), UPPER + FORE);
    bone(L.upper, sh, elbow, 0.05);
    bone(L.fore, elbow, hand, 0.042);
    L.hand.position.copy(hand);
    L.hand.scale.setScalar(0.045);
  });
}
