// Pure rules for Void Run: tunnel generation, running, jumping, wall rotation, races and scoring. No DOM, no three.js.
//
// The tunnel is a regular polygon tube made of rows of tiles. Every zone has its own shape (a square, pentagon,
// hexagon or octagon), each side is `cols` tiles wide and every floor sits APOTHEM from the axis, so the floor you
// stand on carries straight on when the shape changes. A row stores its tiles as a bitmask around the perimeter.
// The runner stands on side `side` (never wrapped, so the camera never spins the long way) at `x` meters from that
// side's centre. Walking past a side's edge puts you on the next wall, which becomes the floor.

export const APOTHEM = 2.6;
export const ROW_L = 2;
export const MIN_SPEED = 9;
export const MAX_SPEED = 24;
export const STRAFE = 7.4;
export const STRAFE_ACC = 80;
export const JUMP_V = 6.8;
export const GRAVITY = 22;
/** Extra gravity while rising with the jump key let go, so a tap is a hop and a hold is a full jump. */
export const CUT = 1.6;
export const COYOTE = 0.09;
export const JUMP_BUFFER = 0.14;
export const FOOT_X = 0.2;
export const FOOT_Z = 0.3;
export const LAND_TOL = 0.14;
export const LOST_DEPTH = 6;
export const RESPAWN_DEPTH = 3.2;
export const START_ROWS = 14;
export const AHEAD_ROWS = 90;
export const BEHIND_ROWS = 10;
export const ZONE_ROWS = 250;
export const ZONE_FULL = 6;
export const BOOST_MULT = 1.32;
export const BOOST_TIME = 1.3;
export const CRUMBLE_DELAY = 0.32;
export const FINISH_PAD = 60;
export const LEVEL_COUNT = 30;
export const LEVELS_PER_ZONE = 5;
export const RACE_ROWS = 420;

export type Zone = { name: string; sides: number; cols: number; grav: number; crumble: number; boost: number; dark: boolean };

export const ZONES: readonly Zone[] = [
  { name: 'Launch Tube', sides: 4, cols: 5, grav: 1, crumble: 0, boost: 0.05, dark: false },
  { name: 'Teal Drift', sides: 5, cols: 4, grav: 1, crumble: 0.05, boost: 0.06, dark: false },
  { name: 'Ember Ring', sides: 6, cols: 3, grav: 1, crumble: 0.3, boost: 0.04, dark: false },
  { name: 'Low Orbit', sides: 4, cols: 5, grav: 0.62, crumble: 0.12, boost: 0.05, dark: false },
  { name: 'Dark Side', sides: 8, cols: 2, grav: 1, crumble: 0.15, boost: 0.05, dark: true },
  { name: 'Nova Core', sides: 6, cols: 3, grav: 0.85, crumble: 0.35, boost: 0.07, dark: false },
];

export const perimOf = (z: Zone) => z.sides * z.cols;
export const fullOf = (z: Zone) => (1 << perimOf(z)) - 1;
export const tileWOf = (z: Zone) => (2 * APOTHEM * Math.tan(Math.PI / z.sides)) / z.cols;
export const halfOf = (z: Zone) => APOTHEM * Math.tan(Math.PI / z.sides);
export const turnOf = (z: Zone) => (Math.PI * 2) / z.sides;
export const airTime = (z: Zone) => (2 * JUMP_V) / (GRAVITY * z.grav);

export type TrackKind = 'endless' | 'level' | 'race';
export type Track = { kind: TrackKind; seed: number; zones: number[]; zoneRows: number; finish: number; level: number };

export function endlessTrack(seed: number): Track {
  return { kind: 'endless', seed, zones: ZONES.map((_, i) => i), zoneRows: ZONE_ROWS, finish: Infinity, level: -1 };
}
export const levelZone = (i: number) => Math.min(ZONES.length - 1, Math.floor(i / LEVELS_PER_ZONE));
export const levelRows = (i: number) => 110 + (i % LEVELS_PER_ZONE) * 16 + levelZone(i) * 10;
export function levelTrack(i: number): Track {
  return { kind: 'level', seed: 1000 + i * 7919, zones: [levelZone(i)], zoneRows: Infinity, finish: levelRows(i), level: i };
}
/** A race course: three zones picked by the seed, about 840 m. */
export function raceTrack(seed: number): Track {
  const s = { seed } as State;
  const rng = rngFrom(s);
  const pool = ZONES.map((_, i) => i);
  const zones: number[] = [];
  while (zones.length < 3) zones.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
  return { kind: 'race', seed, zones, zoneRows: RACE_ROWS / 3, finish: RACE_ROWS, level: -1 };
}

export const levelName = (i: number) => `${ZONES[levelZone(i)].name} ${(i % LEVELS_PER_ZONE) + 1}`;
export const mod = (n: number, m: number) => ((n % m) + m) % m;
export const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
export const rowOf = (dist: number) => Math.floor(dist / ROW_L);
export const zoneIndexAt = (t: Track, row: number) => t.zones[Math.floor(Math.max(0, row) / t.zoneRows) % t.zones.length];
export const zoneAt = (t: Track, row: number) => ZONES[zoneIndexAt(t, row)];
const frac = (t: Track, dist: number) => (Number.isFinite(t.finish) ? clamp01(dist / (t.finish * ROW_L)) : 0);

/** 0..1 how fast the tunnel runs here. */
export function paceAt(t: Track, dist: number) {
  if (t.kind === 'endless') return 1 - Math.exp(-dist / 1800);
  if (t.kind === 'level') return 0.06 + 0.5 * (t.level / (LEVEL_COUNT - 1)) + 0.08 * frac(t, dist);
  return 0.22 + 0.3 * frac(t, dist);
}
/** 0..1 how mean the tunnel gets here. */
export function diffAt(t: Track, dist: number) {
  if (t.kind === 'endless') return Math.min(1, dist / 3000);
  if (t.kind === 'level') return 0.08 + 0.88 * (t.level / (LEVEL_COUNT - 1));
  return 0.25 + 0.45 * frac(t, dist);
}
export const speedAt = (t: Track, dist: number) => MIN_SPEED + (MAX_SPEED - MIN_SPEED) * paceAt(t, dist);
/** Widest full gap (in rows) a held jump clears at this speed, with a safety margin. */
export const maxGapRows = (t: Track, dist: number, z: Zone) => Math.max(1, Math.floor((speedAt(t, dist) * airTime(z) - 1.4) / ROW_L));
export const gapCap = (t: Track, dist: number, z: Zone) => Math.min(maxGapRows(t, dist, z), 1 + Math.floor(diffAt(t, dist) * 4));
/** Solid rows after a gap so even a boosted edge jump lands on tiles. */
export const runAfter = (t: Track, gap: number, dist: number, z: Zone) =>
  Math.max(3, Math.ceil((speedAt(t, dist) * BOOST_MULT * (airTime(z) + COYOTE) + 0.6 - gap * ROW_L) / ROW_L) + 1);

export type Rng = () => number;
export type Mode = 'open' | 'gaps' | 'strip' | 'islands';
export type Input = { dir: -1 | 0 | 1; jump: boolean; hold?: boolean };
export type Events = { jumped: boolean; landed: boolean; fell: boolean; turned: boolean; zone: boolean; boosted: boolean; cell: boolean; respawned: boolean; finished: boolean; go: boolean; dropped: { row: number; tile: number }[] };
export type Cell = { row: number; tile: number; h: number; got: boolean };
export type Crack = { row: number; tile: number; t: number };

export type State = {
  track: Track;
  side: number;
  x: number;
  vx: number;
  h: number;
  vy: number;
  grounded: boolean;
  coyote: number;
  buffer: number;
  dist: number;
  speed: number;
  time: number;
  /** Seconds left on the countdown before the run starts. */
  hold: number;
  boost: number;
  zi: number;
  rows: number[];
  crumb: number[];
  boosts: number[];
  gone: number[];
  zones: number[];
  paths: number[];
  base: number;
  path: number;
  pathZone: number;
  shiftCool: number;
  cellRows: number[];
  cells: Cell[];
  cracks: Crack[];
  falling: boolean;
  dead: boolean;
  finished: boolean;
  finishT: number;
  final: number;
  safeDist: number;
  respawn: boolean;
  respawns: number;
  blink: number;
  seed: number;
  modes: Mode[];
};

/** mulberry32 over the state's seed, so a seed always builds the same tunnel. */
export function rngFrom(s: { seed: number }): Rng {
  return () => {
    s.seed = (s.seed + 0x6d2b79f5) | 0;
    let t = s.seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const bit = (z: Zone, i: number) => 1 << mod(i, perimOf(z));
export const hasBit = (mask: number, z: Zone, i: number) => (mask & bit(z, i)) !== 0;
const band = (z: Zone, p: number) => bit(z, p - 1) | bit(z, p) | bit(z, p + 1);
function sideMask(z: Zone, side: number) {
  let m = 0;
  for (let c = 0; c < z.cols; c++) m |= bit(z, mod(side, z.sides) * z.cols + c);
  return m;
}
function random(z: Zone, rng: Rng, keep: number) {
  let m = 0;
  for (let i = 0; i < perimOf(z); i++) if (rng() < keep) m |= 1 << i;
  return m;
}

const nextRow = (s: State) => s.base + s.rows.length;

/** Maps a tile index on one shape to the closest tile on another, by angle. */
function remapTile(from: Zone, to: Zone, tile: number) {
  const side = Math.floor(mod(tile, perimOf(from)) / from.cols);
  const ns = Math.round((side * turnOf(from)) / turnOf(to));
  return mod(ns, to.sides) * to.cols + Math.floor(to.cols / 2);
}

function push(s: State, mask: number, extra: { crumb?: number; boost?: number } = {}) {
  const row = nextRow(s);
  const zi = zoneIndexAt(s.track, row);
  const z = ZONES[zi];
  if (zi !== s.pathZone) {
    s.path = remapTile(ZONES[s.pathZone], z, s.path);
    s.pathZone = zi;
  }
  const full = fullOf(z);
  const finish = s.track.finish;
  let m = mask & full;
  let crumb = (extra.crumb ?? 0) & m;
  let boost = (extra.boost ?? 0) & m;
  if (row >= finish) {
    m = row < finish + FINISH_PAD ? full : 0;
    crumb = 0;
    boost = 0;
  }
  s.rows.push(m);
  s.crumb.push(crumb);
  s.boosts.push(boost);
  s.gone.push(0);
  s.zones.push(zi);
  s.paths.push(mod(s.path, perimOf(z)));
  if (s.cellRows.length && row >= s.cellRows[0] && row < finish && hasBit(m, z, s.path) && !hasBit(crumb, z, s.path)) {
    const k = 3 - s.cellRows.length;
    s.cellRows.shift();
    const high = k === 2 || (k === 1 && diffAt(s.track, row * ROW_L) > 0.3);
    s.cells.push({ row, tile: mod(s.path, perimOf(z)), h: high ? 0.95 : 0.35, got: false });
  }
}

/** Moves the safe path one tile at most every other row, slow enough to follow at top speed. */
function drift(s: State, rng: Rng, chance: number, dir: -1 | 0 | 1 = 0) {
  if (s.shiftCool > 0) {
    s.shiftCool--;
    return;
  }
  if (rng() >= chance) return;
  s.path += dir || (rng() < 0.5 ? -1 : 1);
  s.shiftCool = 1;
}

function crumbles(s: State, z: Zone, rng: Rng, d: number) {
  return z.crumble > 0 ? random(z, rng, z.crumble * (0.4 + 0.6 * d)) : 0;
}
function boostAt(s: State, z: Zone, rng: Rng) {
  return rng() < z.boost ? bit(z, s.path + (rng() < 0.5 ? -1 : 1) * (rng() < 0.5 ? 1 : 0)) : 0;
}

function segOpen(s: State, rng: Rng, z: Zone, d: number) {
  const len = 8 + Math.floor(rng() * 7);
  for (let i = 0; i < len; i++) {
    drift(s, rng, 0.15);
    push(s, random(z, rng, 0.94 - 0.24 * d) | band(z, s.path), { crumb: crumbles(s, z, rng, d), boost: boostAt(s, z, rng) });
  }
}

function segGaps(s: State, rng: Rng, z: Zone, d: number) {
  const count = 2 + Math.floor(rng() * 3);
  const solid = () => push(s, random(z, rng, 0.95 - 0.1 * d) | band(z, s.path));
  for (let i = 0; i < 3; i++) solid();
  for (let k = 0; k < count; k++) {
    const dist = nextRow(s) * ROW_L;
    const gap = 1 + Math.floor(rng() * gapCap(s.track, dist, z));
    for (let i = 0; i < gap; i++) push(s, 0);
    const run = runAfter(s.track, gap, dist, z);
    for (let i = 0; i < run; i++) solid();
  }
}

/** A lone floor that keeps sliding one way, so you have to roll onto the next wall. */
function segStrip(s: State, rng: Rng, z: Zone, d: number) {
  const len = 12 + Math.floor(rng() * 8);
  const dir: -1 | 1 = rng() < 0.5 ? -1 : 1;
  for (let i = 0; i < len; i++) {
    drift(s, rng, 0.75, dir);
    const side = Math.floor(mod(s.path, perimOf(z)) / z.cols);
    push(s, sideMask(z, side) | band(z, s.path) | random(z, rng, 0.15 + 0.1 * (1 - d)), { crumb: crumbles(s, z, rng, d) });
  }
}

function segIslands(s: State, rng: Rng, z: Zone, d: number) {
  const len = 10 + Math.floor(rng() * 6);
  for (let i = 0; i < len; i++) {
    drift(s, rng, 0.35);
    push(s, random(z, rng, 0.65 - 0.3 * d) | band(z, s.path), { crumb: crumbles(s, z, rng, d), boost: boostAt(s, z, rng) });
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

/** Appends one segment of tunnel. Zones open with a few full rows, and the rows before a new zone stay calm. */
export function generate(s: State, rng: Rng = rngFrom(s)) {
  const row = nextRow(s);
  const t = s.track;
  const z = zoneAt(t, row);
  if (row < START_ROWS) {
    while (nextRow(s) < START_ROWS) push(s, fullOf(z));
    return;
  }
  if (row >= t.finish) {
    push(s, 0);
    return;
  }
  const inZone = row % t.zoneRows;
  if (Number.isFinite(t.zoneRows) && inZone < ZONE_FULL) {
    while (nextRow(s) % t.zoneRows < ZONE_FULL) push(s, fullOf(zoneAt(t, nextRow(s))));
    return;
  }
  const left = Math.min(Number.isFinite(t.zoneRows) ? t.zoneRows - inZone : Infinity, t.finish - row);
  const d = diffAt(t, row * ROW_L);
  if (left < 48) {
    for (let i = 0; i < left; i++) push(s, i >= left - 3 ? fullOf(z) : random(z, rng, 0.9) | band(z, s.path));
    return;
  }
  const mode = s.modes.length === 0 ? 'open' : pickMode(rng, d);
  s.modes.push(mode);
  if (mode === 'open') segOpen(s, rng, z, d);
  else if (mode === 'gaps') segGaps(s, rng, z, d);
  else if (mode === 'strip') segStrip(s, rng, z, d);
  else segIslands(s, rng, z, d);
}

/** Keeps rows generated ahead of the runner and drops the ones far behind. */
export function ensureRows(s: State, rng: Rng = rngFrom(s)) {
  const row = rowOf(s.dist);
  while (nextRow(s) < row + AHEAD_ROWS) generate(s, rng);
  const drop = row - BEHIND_ROWS - s.base;
  if (drop > 0) {
    for (const a of [s.rows, s.crumb, s.boosts, s.gone, s.zones, s.paths]) a.splice(0, drop);
    s.base += drop;
  }
}

export function create(track: Track = endlessTrack((Math.random() * 2 ** 31) | 0), opts: { respawn?: boolean; hold?: number } = {}): State {
  const z0 = zoneIndexAt(track, 0);
  const z = ZONES[z0];
  const fin = track.finish;
  const s: State = {
    track,
    side: 0,
    x: 0,
    vx: 0,
    h: 0,
    vy: 0,
    grounded: true,
    coyote: 0,
    buffer: 0,
    dist: 0,
    speed: speedAt(track, 0),
    time: 0,
    hold: opts.hold ?? 0,
    boost: 0,
    zi: z0,
    rows: [],
    crumb: [],
    boosts: [],
    gone: [],
    zones: [],
    paths: [],
    base: 0,
    path: Math.floor(z.cols / 2),
    pathZone: z0,
    shiftCool: 0,
    cellRows: track.kind === 'level' ? [0.3, 0.58, 0.86].map((f) => Math.floor(fin * f)) : [],
    cells: [],
    cracks: [],
    falling: false,
    dead: false,
    finished: false,
    finishT: 0,
    final: 0,
    safeDist: 0,
    respawn: !!opts.respawn,
    respawns: 0,
    blink: 0,
    seed: track.seed,
    modes: [],
  };
  // the centre tile of the bottom floor
  s.x = -halfOf(z) + (Math.floor(z.cols / 2) + 0.5) * tileWOf(z);
  ensureRows(s);
  return s;
}

/** Tiles you can stand on in a row: its tiles minus the ones that crumbled away. */
export function maskAt(s: State, row: number) {
  const i = row - s.base;
  if (i < 0) return fullOf(zoneAt(s.track, row));
  if (i >= s.rows.length) return fullOf(zoneAt(s.track, row));
  return s.rows[i] & ~s.gone[i];
}
const arr = (s: State, a: number[], row: number) => {
  const i = row - s.base;
  return i >= 0 && i < a.length ? a[i] : 0;
};
export const crumbAt = (s: State, row: number) => arr(s, s.crumb, row);
export const boostMaskAt = (s: State, row: number) => arr(s, s.boosts, row);
export const pathAt = (s: State, row: number) => arr(s, s.paths, row);

/** Tile index under a lateral position on a zone. */
export function tileAt(z: Zone, side: number, x: number) {
  const c = Math.min(z.cols - 1, Math.max(0, Math.floor((x + halfOf(z)) / tileWOf(z))));
  return mod(side, z.sides) * z.cols + c;
}
/** Folds an x that ran past a side's edge onto the neighbouring side. */
export function fold(z: Zone, side: number, x: number): [number, number] {
  const half = halfOf(z);
  while (x > half) {
    side++;
    x -= 2 * half;
  }
  while (x < -half) {
    side--;
    x += 2 * half;
  }
  return [side, x];
}

/** Is there a tile under any corner of the runner's feet? */
export function supported(s: State, side = s.side, x = s.x, dist = s.dist) {
  const z = ZONES[s.zi];
  for (const dx of [-FOOT_X, FOOT_X])
    for (const dz of [-FOOT_Z, FOOT_Z]) {
      const d = dist + dz;
      if (d < 0) return true;
      const row = rowOf(d);
      if (zoneIndexAt(s.track, row) !== s.zi) return true;
      const [sd, xx] = fold(z, side, x + dx);
      if (hasBit(maskAt(s, row), z, tileAt(z, sd, xx))) return true;
    }
  return false;
}

/** Puts the runner back on the safe path a little behind where it last stood, and rebuilds crumbled tiles from there. */
function respawn(s: State) {
  let row = Math.max(0, rowOf(s.safeDist) - 1);
  while (row > s.base && pathAt(s, row) !== undefined && arr(s, s.rows, row) === 0) row--;
  for (let i = Math.max(0, row - s.base); i < s.gone.length; i++) s.gone[i] = 0;
  s.cracks.length = 0;
  const zi = zoneIndexAt(s.track, row);
  const z = ZONES[zi];
  const p = pathAt(s, row);
  const target = Math.floor(p / z.cols);
  let side = s.side;
  if (zi !== s.zi) side = Math.round((s.side * turnOf(ZONES[s.zi])) / turnOf(z));
  side += mod(target - side + Math.floor(z.sides / 2), z.sides) - Math.floor(z.sides / 2);
  s.zi = zi;
  s.side = side;
  s.x = -halfOf(z) + ((p % z.cols) + 0.5) * tileWOf(z);
  s.vx = 0;
  s.dist = (row + 0.5) * ROW_L;
  s.safeDist = s.dist;
  s.h = 0;
  s.vy = 0;
  s.grounded = true;
  s.falling = false;
  s.blink = 1.2;
  s.respawns++;
}

const noEvents = (): Events => ({ jumped: false, landed: false, fell: false, turned: false, zone: false, boosted: false, cell: false, respawned: false, finished: false, go: false, dropped: [] });

export function step(s: State, dt: number, input: Input, rng: Rng = rngFrom(s)): Events {
  const ev = noEvents();
  if (s.dead) return ev;
  if (s.hold > 0) {
    s.hold -= dt;
    if (s.hold <= 0) {
      s.hold = 0;
      ev.go = true;
    }
    return ev;
  }
  s.time += dt;
  s.blink = Math.max(0, s.blink - dt);
  s.boost = Math.max(0, s.boost - dt);
  const target = s.finished ? 0 : speedAt(s.track, s.dist) * (s.boost > 0 ? BOOST_MULT : 1);
  s.speed += (target - s.speed) * (1 - Math.exp(-(s.finished ? 2.5 : 6) * dt));
  s.dist += s.speed * dt;

  // a new zone: keep the floor under you, on the side closest in angle
  const zi = zoneIndexAt(s.track, rowOf(s.dist));
  if (zi !== s.zi) {
    const from = ZONES[s.zi];
    const to = ZONES[zi];
    s.side = Math.round((s.side * turnOf(from)) / turnOf(to));
    const half = halfOf(to) - 0.01;
    s.x = Math.max(-half, Math.min(half, s.x));
    s.zi = zi;
    ev.zone = true;
  }
  const z = ZONES[s.zi];

  if (!s.falling && !s.finished) {
    const want = input.dir * STRAFE;
    const dv = want - s.vx;
    s.vx += Math.sign(dv) * Math.min(Math.abs(dv), STRAFE_ACC * dt);
    const side = s.side;
    [s.side, s.x] = fold(z, s.side, s.x + s.vx * dt);
    if (s.side !== side) ev.turned = true;
  } else s.vx *= Math.exp(-6 * dt);
  ensureRows(s, rng);

  if (input.jump) s.buffer = JUMP_BUFFER;
  else s.buffer = Math.max(0, s.buffer - dt);

  if (s.grounded && !supported(s)) {
    s.grounded = false;
    s.coyote = COYOTE;
    s.vy = 0;
  }
  if (!s.falling && !s.finished && s.buffer > 0 && (s.grounded || s.coyote > 0)) {
    s.vy = JUMP_V;
    s.grounded = false;
    s.coyote = 0;
    s.buffer = 0;
    ev.jumped = true;
  }
  const g = GRAVITY * z.grav;
  if (!s.grounded) {
    s.coyote = Math.max(0, s.coyote - dt);
    const before = s.h;
    s.vy -= g * dt * (s.vy > 0 && input.hold === false ? 1 + CUT : 1);
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
    if (s.falling && s.respawn && s.h < -RESPAWN_DEPTH) {
      respawn(s);
      ev.respawned = true;
    } else if (s.falling && s.h < -LOST_DEPTH) s.dead = true;
  }

  if (s.grounded) {
    const row = rowOf(s.dist);
    const tile = tileAt(z, s.side, s.x);
    if (hasBit(maskAt(s, row), z, tile) && !hasBit(crumbAt(s, row), z, tile)) s.safeDist = s.dist;
    if (hasBit(boostMaskAt(s, row), z, tile)) {
      if (s.boost < BOOST_TIME - 0.3) ev.boosted = true;
      s.boost = BOOST_TIME;
    }
    // crumbling tiles start to go the moment a foot touches them
    for (const dx of [-FOOT_X, FOOT_X])
      for (const dz of [-FOOT_Z, FOOT_Z]) {
        const r = rowOf(s.dist + dz);
        if (zoneIndexAt(s.track, r) !== s.zi) continue;
        const [sd, xx] = fold(z, s.side, s.x + dx);
        const t = tileAt(z, sd, xx);
        if (hasBit(crumbAt(s, r), z, t) && hasBit(maskAt(s, r), z, t) && !s.cracks.some((c) => c.row === r && c.tile === t)) s.cracks.push({ row: r, tile: t, t: CRUMBLE_DELAY });
      }
  }
  for (let i = s.cracks.length - 1; i >= 0; i--) {
    const c = s.cracks[i];
    c.t -= dt;
    if (c.t > 0) continue;
    s.cracks.splice(i, 1);
    const k = c.row - s.base;
    if (k < 0 || k >= s.gone.length) continue;
    s.gone[k] |= 1 << c.tile;
    ev.dropped.push({ row: c.row, tile: c.tile });
  }

  if (!s.falling) {
    const row = rowOf(s.dist);
    const tile = tileAt(z, s.side, s.x);
    for (const c of s.cells) {
      if (c.got || c.row !== row || c.tile !== tile || Math.abs(s.h - c.h) > 0.7) continue;
      c.got = true;
      ev.cell = true;
    }
  }
  if (!s.falling && !s.finished && s.dist >= s.track.finish * ROW_L) {
    s.finished = true;
    s.finishT = s.time;
    ev.finished = true;
  }
  return ev;
}

export const score = (s: State) => (s.falling && !s.respawn ? s.final : Math.floor(s.dist));
export const progress = (s: State) => (Number.isFinite(s.track.finish) ? clamp01(s.dist / (s.track.finish * ROW_L)) : 0);
export const cellsGot = (s: State) => s.cells.reduce((n, c) => n + (c.got ? 1 : 0), 0);

// ---------------------------------------------------------------------------------------------------------------
// Computer runners: follow the safe path a row ahead, jump at the edge. Lower skill now and then jumps late.

export type BotMind = { skill: number; gapRow: number; lead: number; rng: Rng };
export function botMind(skill: number, seed: number): BotMind {
  const s = { seed };
  return { skill, gapRow: -1, lead: 0.75, rng: rngFrom(s) };
}

export function botInput(s: State, mind?: BotMind): Input {
  const z = ZONES[s.zi];
  const P = perimOf(z);
  let ahead = rowOf(s.dist + ROW_L * 0.9 + s.speed * 0.06);
  for (let k = 0; k < 6 && zoneIndexAt(s.track, ahead) === s.zi && maskAt(s, ahead) === 0; k++) ahead++;
  let path = pathAt(s, ahead);
  if (zoneIndexAt(s.track, ahead) !== s.zi) path = tileAt(z, s.side, s.x);
  const here = mod(s.side, z.sides) * z.cols + (s.x + halfOf(z)) / tileWOf(z);
  const diff = mod(path + 0.5 - here + P / 2, P) - P / 2;
  const dir = Math.abs(diff) > 0.18 ? (Math.sign(diff) as -1 | 1) : 0;
  const row = rowOf(s.dist);
  const tile = tileAt(z, s.side, s.x);
  let lead = 0.75;
  if (mind) {
    const gapRow = rowOf(s.dist + 3);
    if (gapRow !== mind.gapRow) {
      mind.gapRow = gapRow;
      mind.lead = mind.rng() < (1 - mind.skill) * 0.12 ? 0.05 : 0.75;
    }
    lead = mind.lead;
  }
  const edge = rowOf(s.dist + lead);
  const jump = s.grounded && edge !== row && zoneIndexAt(s.track, edge) === s.zi && !hasBit(maskAt(s, edge), z, tile);
  return { dir, jump, hold: true };
}

// ---------------------------------------------------------------------------------------------------------------
// Race results.

export type Finisher = { seat: number; ms: number; dist: number };
/** Finishers by time, then everyone else by how far they got. */
export function finishOrder(list: Finisher[]): Finisher[] {
  return [...list].sort((a, b) => (a.ms >= 0 && b.ms >= 0 ? a.ms - b.ms : a.ms >= 0 ? -1 : b.ms >= 0 ? 1 : b.dist - a.dist));
}

export function fmtTime(ms: number) {
  const t = Math.max(0, Math.round(ms / 100)) / 10;
  const m = Math.floor(t / 60);
  const sec = (t - m * 60).toFixed(1);
  return m > 0 ? `${m}:${sec.padStart(4, '0')}` : `${sec}s`;
}

export const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`;

/** The Game Over line for an online race: who won and how, your result, and the people in the room. */
export function raceDetail(order: Finisher[], me: number, nameOf: (seat: number) => string, people: string[]): string {
  const w = order[0];
  const parts: string[] = [];
  const how = (f: Finisher) => (f.ms >= 0 ? fmtTime(f.ms) : `${Math.floor(f.dist)} m`);
  if (w && w.seat === me) parts.push(`You won in ${how(w)}.`);
  else if (w) parts.push(`${nameOf(w.seat)} won in ${how(w)}.`);
  const k = order.findIndex((f) => f.seat === me);
  if (k > 0) parts.push(order[k].ms >= 0 ? `You took ${how(order[k])}, ${ordinal(k + 1)}.` : `You made it ${how(order[k])}, ${ordinal(k + 1)}.`);
  const others = people.filter((p) => p !== 'You');
  const count = people.length;
  const all = ['You', ...others];
  parts.push(count <= 1 ? 'Just you here.' : `${count} people here: ${all.slice(0, -1).join(', ')} and ${all[all.length - 1]}.`);
  return parts.join(' ');
}
