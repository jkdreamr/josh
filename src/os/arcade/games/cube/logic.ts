// Pure 3x3 twisty cube: cubie positions and orientations as integers, face turns, undo, scramble and solve detection.
export type Axis = 0 | 1 | 2; // x, y, z
export type Vec = [number, number, number];
export type Mat = [Vec, Vec, Vec]; // rows
export type Cubie = { home: Vec; pos: Vec; rot: Mat };
export type Turn = { axis: Axis; layer: -1 | 0 | 1; dir: 1 | -1 }; // dir: +1 = positive rotation about the axis (right hand rule)
export type Face = 'U' | 'D' | 'L' | 'R' | 'F' | 'B';

export const FACES: Record<Face, { axis: Axis; layer: 1 | -1 }> = {
  R: { axis: 0, layer: 1 },
  L: { axis: 0, layer: -1 },
  U: { axis: 1, layer: 1 },
  D: { axis: 1, layer: -1 },
  F: { axis: 2, layer: 1 },
  B: { axis: 2, layer: -1 },
};

export const IDENTITY: Mat = [
  [1, 0, 0],
  [0, 1, 0],
  [0, 0, 1],
];

/** Quarter turn matrix about an axis, dir +1 is counter clockwise when looking down the positive axis. */
export function quarter(axis: Axis, dir: 1 | -1): Mat {
  const c = 0;
  const s = dir;
  if (axis === 0)
    return [
      [1, 0, 0],
      [0, c, -s],
      [0, s, c],
    ];
  if (axis === 1)
    return [
      [c, 0, s],
      [0, 1, 0],
      [-s, 0, c],
    ];
  return [
    [c, -s, 0],
    [s, c, 0],
    [0, 0, 1],
  ];
}

export const mulVec = (m: Mat, v: Vec): Vec => [
  m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
  m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
  m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
];
export const mulMat = (a: Mat, b: Mat): Mat => {
  const r: Mat = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) r[i][j] = a[i][0] * b[0][j] + a[i][1] * b[1][j] + a[i][2] * b[2][j];
  return r;
};
const sameMat = (a: Mat, b: Mat) => a.every((row, i) => row.every((v, j) => v === b[i][j]));
const sameVec = (a: Vec, b: Vec) => a[0] === b[0] && a[1] === b[1] && a[2] === b[2];

/** Face move in standard notation: clockwise as seen looking at that face. */
export function faceTurn(face: Face, prime = false): Turn {
  const f = FACES[face];
  // clockwise seen from outside the face is a negative rotation about an outward (+) axis
  const dir = (f.layer === 1 ? -1 : 1) * (prime ? -1 : 1);
  return { axis: f.axis, layer: f.layer, dir: dir as 1 | -1 };
}

export const inverse = (t: Turn): Turn => ({ ...t, dir: t.dir === 1 ? -1 : 1 });

/** Notation for a turn, including slices (M E S follow the usual L, D and F directions). */
export function notation(t: Turn): string {
  if (t.layer !== 0) {
    const face = (Object.keys(FACES) as Face[]).find((f) => FACES[f].axis === t.axis && FACES[f].layer === t.layer)!;
    const cw = faceTurn(face).dir === t.dir;
    return cw ? face : `${face}'`;
  }
  const slice = t.axis === 0 ? 'M' : t.axis === 1 ? 'E' : 'S';
  const ref = t.axis === 0 ? faceTurn('L') : t.axis === 1 ? faceTurn('D') : faceTurn('F');
  return ref.dir === t.dir ? slice : `${slice}'`;
}

export type Cube = {
  cubies: Cubie[];
  history: Turn[];
  moves: number;
  scrambled: boolean;
  /** Elapsed solve time in ms, counted from the first turn after a scramble until solved. */
  time: number;
  timing: boolean;
  solved: boolean;
};

export function create(): Cube {
  const cubies: Cubie[] = [];
  for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) if (x || y || z) cubies.push({ home: [x, y, z], pos: [x, y, z], rot: IDENTITY });
  return { cubies, history: [], moves: 0, scrambled: false, time: 0, timing: false, solved: true };
}

export const inLayer = (c: Cubie, t: Turn) => c.pos[t.axis] === t.layer;

/** Applies a quarter turn to the model (no animation). */
export function apply(cube: Cube, t: Turn, record = true) {
  const m = quarter(t.axis, t.dir);
  for (const c of cube.cubies) {
    if (!inLayer(c, t)) continue;
    c.pos = mulVec(m, c.pos);
    c.rot = mulMat(m, c.rot);
  }
  if (record) {
    cube.history.push(t);
    cube.moves++;
    if (cube.scrambled && !cube.timing && !cube.solved) cube.timing = true;
  }
  cube.solved = isSolved(cube);
  if (cube.solved && cube.timing) cube.timing = false;
}

export function undo(cube: Cube): Turn | null {
  const last = cube.history.pop();
  if (!last) return null;
  const inv = inverse(last);
  apply(cube, inv, false);
  cube.moves++;
  return inv;
}

export function isSolved(cube: Cube) {
  const rot = cube.cubies[0].rot;
  return cube.cubies.every((c) => sameMat(c.rot, rot) && sameVec(c.pos, mulVec(rot, c.home)));
}

export function tick(cube: Cube, dtMs: number) {
  if (cube.timing) cube.time += dtMs;
}

export type Rng = () => number;

/** Random state via 22 face turns that never repeat an axis back to back. Resets the timer and history. */
export function scramble(cube: Cube, n = 22, rng: Rng = Math.random): Turn[] {
  const faces = Object.keys(FACES) as Face[];
  const turns: Turn[] = [];
  let lastAxis = -1;
  for (let i = 0; i < n || cube.solved; i++) {
    let f: Face;
    do f = faces[Math.floor(rng() * faces.length)];
    while (FACES[f].axis === lastAxis);
    lastAxis = FACES[f].axis;
    const t = faceTurn(f, rng() < 0.5);
    apply(cube, t, false);
    turns.push(t);
  }
  cube.solved = false;
  cube.history = [];
  cube.moves = 0;
  cube.time = 0;
  cube.timing = false;
  cube.scrambled = true;
  return turns;
}

/** Index of the dominant component with its sign. */
export function snapAxis(v: Vec): { axis: Axis; sign: 1 | -1 } {
  let axis: Axis = 0;
  for (let i = 1; i < 3; i++) if (Math.abs(v[i]) > Math.abs(v[axis])) axis = i as Axis;
  return { axis, sign: v[axis] >= 0 ? 1 : -1 };
}

export const cross = (a: Vec, b: Vec): Vec => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/**
 * Which layer turns when you drag across a face: the rotation axis is normal x drag (snapped), the layer is
 * the touched cubie's coordinate along that axis, and the sign follows the right hand rule. Returns null for
 * a drag that is too aligned with the normal to read.
 */
export function inferTurn(normal: Vec, drag: Vec, cubiePos: Vec): Turn | null {
  const c = cross(normal, drag);
  const len = Math.hypot(c[0], c[1], c[2]);
  if (len < 1e-6) return null;
  const { axis, sign } = snapAxis(c);
  if (axis === snapAxis(normal).axis) return null;
  const layer = Math.round(cubiePos[axis]) as -1 | 0 | 1;
  return { axis, layer, dir: sign };
}

export const fmtTime = (ms: number) => {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const cs = Math.floor((ms % 1000) / 10);
  return m > 0 ? `${m}:${String(s % 60).padStart(2, '0')}.${String(cs).padStart(2, '0')}` : `${s}.${String(cs).padStart(2, '0')}`;
};
