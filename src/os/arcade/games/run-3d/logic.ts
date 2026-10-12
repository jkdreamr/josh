// Pure rules for Void Run: tunnel generation, running, jumping, wall rotation and scoring. No DOM, no three.js.
//
// The tunnel is a square tube made of rows of tiles. Each row has SIDES * COLS tiles laid around the
// perimeter, stored as a bitmask. The runner's lateral position `u` is measured in tiles around that
// perimeter and is never wrapped, so floor(u / COLS) counts how many walls you have rotated onto.

export const SIDES = 4;
export const COLS = 5;
export const PERIM = SIDES * COLS;
export const FULL = (1 << PERIM) - 1;
export const TILE_W = 1;
export const ROW_L = 2;
/** Distance from the tunnel axis to each floor. */
export const APOTHEM = (COLS * TILE_W) / 2 / Math.tan(Math.PI / SIDES);

export const MIN_SPEED = 9;
export const MAX_SPEED = 24;
export const SPEED_K = 1800;
export const STRAFE = 7.5;
export const JUMP_V = 6.6;
export const GRAVITY = 22;
export const AIR_TIME = (2 * JUMP_V) / GRAVITY;
export const COYOTE = 0.09;
export const JUMP_BUFFER = 0.14;
export const FOOT_U = 0.22;
export const FOOT_Z = 0.3;
export const LAND_TOL = 0.14;
export const LOST_DEPTH = 6;
export const START_ROWS = 14;
export const AHEAD_ROWS = 90;
export const BEHIND_ROWS = 8;
export const ZONE_LEN = 500;

export type Rng = () => number;
export type Mode = 'open' | 'gaps' | 'strip' | 'islands';
export type Input = { dir: -1 | 0 | 1; jump: boolean };
export type Events = { jumped: boolean; landed: boolean; fell: boolean; turned: boolean };

export type State = {
  u: number;
  h: number;
  vy: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  dist: number;
  speed: number;
  time: number;
  /** Row masks for rows base .. base + rows.length - 1. */
  rows: number[];
  /** Guaranteed safe tile per row, the centre of a three tile wide path. */
  paths: number[];
  base: number;
  path: number;
  shiftCool: number;
  falling: boolean;
  dead: boolean;
  final: number;
  seed: number;
  modes: Mode[];
};

/** Small deterministic generator (mulberry32) so a seed always builds the same tunnel. */
export function rngFrom(s: State): Rng {
  return () => {
    s.seed = (s.seed + 0x6d2b79f5) | 0;
    let t = s.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const mod = (n: number, m: number) => ((n % m) + m) % m;
export const speedAt = (dist: number) => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * (1 - Math.exp(-dist / SPEED_K));
export const difficulty = (dist: number) => Math.min(1, Math.max(0, dist / 3000));
/** Widest full gap (in rows) a jump clears at the speed you will be running there, with a safety margin. */
export const maxGapRows = (dist: number) => Math.max(1, Math.floor((speedAt(dist) * AIR_TIME - 1.2) / ROW_L));
/** Gap width allowed at this distance: starts at one row and widens with speed. */
export const gapCap = (dist: number) => Math.min(maxGapRows(dist), 1 + Math.floor(dist / 450));
/** Solid rows needed after a gap so an edge jump never overshoots the landing run. */
export const runAfter = (gap: number, dist: number) =>
  Math.max(3, Math.ceil((speedAt(dist) * (AIR_TIME + COYOTE) + 0.6 - gap * ROW_L) / ROW_L) + 1);

export const sideOf = (u: number) => Math.floor(u / COLS);
export const rowOf = (dist: number) => Math.floor(dist / ROW_L);
export const tileBit = (i: number) => 1 << mod(i, PERIM);
export const hasTile = (mask: number, i: number) => (mask & tileBit(i)) !== 0;
export const score = (s: State) => (s.falling ? s.final : Math.floor(s.dist));
export const zoneOf = (dist: number) => Math.floor(dist / ZONE_LEN);

function bandMask(path: number) {
  return tileBit(path - 1) | tileBit(path) | tileBit(path + 1);
}
function sideMask(side: number) {
  let m = 0;
  for (let c = 0; c < COLS; c++) m |= tileBit(mod(side, SIDES) * COLS + c);
  return m;
}
const union = (a: number, b: number) => a | b;
function holes(rng: Rng, density: number) {
  let m = 0;
  for (let i = 0; i < PERIM; i++) if (rng() >= density) m |= 1 << i;
  return m;
}

function push(s: State, mask: number) {
  s.rows.push(mask);
  s.paths.push(mod(s.path, PERIM));
}
const nextRow = (s: State) => s.base + s.rows.length;

/** Move the safe path one tile at most every other row, slow enough to follow at top speed. */
function drift(s: State, rng: Rng, chance: number, dir: -1 | 0 | 1 = 0) {
  if (s.shiftCool > 0) {
    s.shiftCool--;
    return;
  }
  if (rng() >= chance) return;
  s.path += dir || (rng() < 0.5 ? -1 : 1);
  s.shiftCool = 1;
}

function segOpen(s: State, rng: Rng, density: number, chance: number) {
  const len = 8 + Math.floor(rng() * 7);
  for (let i = 0; i < len; i++) {
    drift(s, rng, chance);
    push(s, union(holes(rng, density), bandMask(s.path)));
  }
}

function segGaps(s: State, rng: Rng) {
  const count = 2 + Math.floor(rng() * 3);
  const solid = () => union(holes(rng, 0.05), bandMask(s.path));
  for (let i = 0; i < 3; i++) push(s, solid());
  for (let k = 0; k < count; k++) {
    const dist = nextRow(s) * ROW_L;
    const gap = 1 + Math.floor(rng() * gapCap(dist));
    for (let i = 0; i < gap; i++) push(s, 0);
    const run = runAfter(gap, dist);
    for (let i = 0; i < run; i++) push(s, solid());
  }
}

/** A lone floor that keeps sliding one way, so you have to rotate onto the next wall. */
function segStrip(s: State, rng: Rng, d: number) {
  const len = 12 + Math.floor(rng() * 8);
  const dir: -1 | 1 = rng() < 0.5 ? -1 : 1;
  const debris = 0.85 - 0.1 * d;
  for (let i = 0; i < len; i++) {
    drift(s, rng, 0.75, dir);
    push(s, union(union(sideMask(sideOf(s.path)), bandMask(s.path)), holes(rng, debris)));
  }
}

function segIslands(s: State, rng: Rng, d: number) {
  const len = 10 + Math.floor(rng() * 6);
  for (let i = 0; i < len; i++) {
    drift(s, rng, 0.35);
    push(s, union(holes(rng, 0.35 + 0.3 * d), bandMask(s.path)));
  }
}

export function pickMode(rng: Rng, d: number): Mode {
  const w: [Mode, number][] = [
    ['open', 3 - 2 * d],
    ['gaps', 2 + d],
    ['strip', 1 + d],
    ['islands', 1 + d],
  ];
  let r = rng() * w.reduce((a, [, x]) => a + x, 0);
  for (const [m, x] of w) {
    r -= x;
    if (r < 0) return m;
  }
  return 'open';
}

/** Appends one segment of tunnel. */
export function generate(s: State, rng: Rng = rngFrom(s)) {
  if (nextRow(s) < START_ROWS) {
    while (nextRow(s) < START_ROWS) push(s, FULL);
    return;
  }
  const d = difficulty(nextRow(s) * ROW_L);
  const mode = s.modes.length === 0 ? 'open' : pickMode(rng, d);
  s.modes.push(mode);
  if (mode === 'open') segOpen(s, rng, 0.06 + 0.22 * d, 0.15);
  else if (mode === 'gaps') segGaps(s, rng);
  else if (mode === 'strip') segStrip(s, rng, d);
  else segIslands(s, rng, d);
}

/** Keeps rows generated ahead of the runner and drops the ones far behind. */
export function ensureRows(s: State, rng: Rng = rngFrom(s)) {
  const row = rowOf(s.dist);
  while (nextRow(s) < row + AHEAD_ROWS) generate(s, rng);
  const drop = row - BEHIND_ROWS - s.base;
  if (drop > 0) {
    s.rows.splice(0, drop);
    s.paths.splice(0, drop);
    s.base += drop;
  }
}

export function create(seed = (Math.random() * 2 ** 31) | 0): State {
  const s: State = {
    u: Math.floor(COLS / 2) + 0.5,
    h: 0,
    vy: 0,
    grounded: true,
    coyote: 0,
    buffer: 0,
    dist: 0,
    speed: MIN_SPEED,
    time: 0,
    rows: [],
    paths: [],
    base: 0,
    path: Math.floor(COLS / 2),
    shiftCool: 0,
    falling: false,
    dead: false,
    final: 0,
    seed,
    modes: [],
  };
  ensureRows(s);
  return s;
}

export function maskAt(s: State, row: number) {
  const i = row - s.base;
  if (i < 0) return FULL;
  return i < s.rows.length ? s.rows[i] : FULL;
}
export const tileAt = (s: State, row: number, tile: number) => hasTile(maskAt(s, row), tile);

/** Is there a tile under any corner of the runner's feet at (u, dist)? */
export function supported(s: State, u = s.u, dist = s.dist) {
  for (const du of [-FOOT_U, FOOT_U])
    for (const dz of [-FOOT_Z, FOOT_Z]) {
      const z = dist + dz;
      if (z < 0) return true;
      if (tileAt(s, rowOf(z), Math.floor(u + du))) return true;
    }
  return false;
}

export function step(s: State, dt: number, input: Input, rng: Rng = rngFrom(s)): Events {
  const ev: Events = { jumped: false, landed: false, fell: false, turned: false };
  if (s.dead) return ev;
  s.time += dt;
  s.speed = speedAt(s.dist);
  s.dist += s.speed * dt;
  if (!s.falling) {
    const side = sideOf(s.u);
    s.u += input.dir * STRAFE * dt;
    if (sideOf(s.u) !== side) ev.turned = true;
  }
  ensureRows(s, rng);

  if (input.jump) s.buffer = JUMP_BUFFER;
  else s.buffer = Math.max(0, s.buffer - dt);

  if (s.grounded && !supported(s)) {
    s.grounded = false;
    s.coyote = COYOTE;
    s.vy = 0;
  }
  if (!s.falling && s.buffer > 0 && (s.grounded || s.coyote > 0)) {
    s.vy = JUMP_V;
    s.grounded = false;
    s.coyote = 0;
    s.buffer = 0;
    ev.jumped = true;
  }
  if (!s.grounded) {
    s.coyote = Math.max(0, s.coyote - dt);
    const before = s.h;
    s.vy -= GRAVITY * dt;
    s.h += s.vy * dt;
    if (!s.falling && s.h <= 0) {
      if (before >= -LAND_TOL && s.vy <= 0 && supported(s)) {
        s.h = 0;
        s.vy = 0;
        s.grounded = true;
        ev.landed = before > 0;
      } else if (s.h < -LAND_TOL && s.coyote <= 0) {
        s.falling = true;
        s.final = Math.floor(s.dist);
        ev.fell = true;
      }
    }
    if (s.falling && s.h < -LOST_DEPTH) s.dead = true;
  }
  return ev;
}
