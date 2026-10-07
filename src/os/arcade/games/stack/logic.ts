// Pure rules for Stack: slabs, slicing, perfect combos and difficulty. No DOM, no three.js.
export type Axis = 'x' | 'z';
export type Slab = { x: number; z: number; w: number; d: number };

export const BASE = 3;
export const HEIGHT = 0.5;
export const PERFECT_TOL = 0.14;
export const MIN_SIZE = 0.05;
export const RANGE = 2.6;
export const GROW = 0.3;
export const STREAK_TO_GROW = 3;

export type PlaceResult = { kind: 'miss'; cuts: Slab[] } | { kind: 'perfect'; slab: Slab; cuts: Slab[] } | { kind: 'cut'; slab: Slab; cuts: Slab[] };

/** Where a moving slab lands on the slab below along one axis: a perfect snap, a slice, or a complete miss. */
export function place(moving: Slab, below: Slab, axis: Axis, tol = PERFECT_TOL): PlaceResult {
  const m = axis === 'x' ? moving.x : moving.z;
  const b = axis === 'x' ? below.x : below.z;
  const sm = axis === 'x' ? moving.w : moving.d;
  const sb = axis === 'x' ? below.w : below.d;
  const lo = Math.max(m - sm / 2, b - sb / 2);
  const hi = Math.min(m + sm / 2, b + sb / 2);
  if (hi - lo <= MIN_SIZE) return { kind: 'miss', cuts: [moving] };
  if (Math.abs(m - b) <= tol) {
    return { kind: 'perfect', slab: axis === 'x' ? { ...moving, x: b } : { ...moving, z: b }, cuts: [] };
  }
  const cuts: Slab[] = [];
  const left = lo - (m - sm / 2);
  const right = m + sm / 2 - hi;
  if (left > MIN_SIZE) cuts.push(axis === 'x' ? { ...moving, x: lo - left / 2, w: left } : { ...moving, z: lo - left / 2, d: left });
  if (right > MIN_SIZE) cuts.push(axis === 'x' ? { ...moving, x: hi + right / 2, w: right } : { ...moving, z: hi + right / 2, d: right });
  const slab = axis === 'x' ? { ...moving, x: (lo + hi) / 2, w: hi - lo } : { ...moving, z: (lo + hi) / 2, d: hi - lo };
  return { kind: 'cut', slab, cuts };
}

export type State = {
  stack: Slab[];
  moving: Slab;
  axis: Axis;
  dir: 1 | -1;
  pos: number;
  speed: number;
  streak: number;
  score: number;
  over: boolean;
};

export const speedFor = (score: number) => Math.min(6.5, 2.6 + score * 0.08);

function spawn(stack: Slab[], axis: Axis, grow: boolean): Slab {
  const top = stack[stack.length - 1];
  const slab = { ...top };
  if (grow) {
    if (axis === 'x') slab.w = Math.min(BASE, slab.w + GROW);
    else slab.d = Math.min(BASE, slab.d + GROW);
  }
  if (axis === 'x') slab.x = -RANGE;
  else slab.z = -RANGE;
  return slab;
}

export function create(): State {
  const stack = [{ x: 0, z: 0, w: BASE, d: BASE }];
  return { stack, moving: spawn(stack, 'x', false), axis: 'x', dir: 1, pos: -RANGE, speed: speedFor(0), streak: 0, score: 0, over: false };
}

/** Advance the moving slab; it bounces between -RANGE and +RANGE. */
export function step(s: State, dt: number) {
  if (s.over) return;
  s.pos += s.dir * s.speed * dt;
  if (s.pos > RANGE) {
    s.pos = RANGE - (s.pos - RANGE);
    s.dir = -1;
  } else if (s.pos < -RANGE) {
    s.pos = -RANGE + (-RANGE - s.pos);
    s.dir = 1;
  }
  if (s.axis === 'x') s.moving.x = s.pos;
  else s.moving.z = s.pos;
}

export type DropOutcome = { result: PlaceResult; level: number; grew: boolean };

/** Drop the moving slab: slice or snap it, update score and streak, and queue the next one. */
export function drop(s: State): DropOutcome {
  const below = s.stack[s.stack.length - 1];
  const result = place(s.moving, below, s.axis);
  const level = s.stack.length;
  if (result.kind === 'miss') {
    s.over = true;
    return { result, level, grew: false };
  }
  s.stack.push(result.slab);
  s.score += 1;
  s.streak = result.kind === 'perfect' ? s.streak + 1 : 0;
  const grew = s.streak >= STREAK_TO_GROW;
  s.axis = s.axis === 'x' ? 'z' : 'x';
  s.dir = s.score % 2 ? -1 : 1;
  s.pos = s.dir === 1 ? -RANGE : RANGE;
  s.speed = speedFor(s.score);
  s.moving = spawn(s.stack, s.axis, grew);
  if (s.axis === 'x') s.moving.x = s.pos;
  else s.moving.z = s.pos;
  return { result, level, grew };
}

/** Top of the tower in world units. */
export const towerTop = (s: State) => s.stack.length * HEIGHT;

/** Hue for a level: a slow walk around the wheel so neighbors blend. */
export const hueFor = (level: number, seed = 0) => (seed + level * 6) % 360;
