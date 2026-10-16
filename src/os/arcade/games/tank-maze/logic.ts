// Tank Maze rules: maze generation, tank physics, shells, pickups, rounds. Pure module, no DOM.
// Units are maze cells: one cell is 1x1, (0,0) is the top-left corner.

export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// -----------------------------------------------------------------------------------------------------------------
// Maze

/** Wall thickness in cells. */
export const WALL_T = 0.1;

export type Maze = {
  cols: number;
  rows: number;
  /** Vertical walls: v[y * (cols + 1) + x] is the wall on the left edge of cell (x, y). x in 0..cols. */
  v: boolean[];
  /** Horizontal walls: h[y * cols + x] is the wall on the top edge of cell (x, y). y in 0..rows. */
  h: boolean[];
  /** Wall rectangles [x, y, w, h] for collision and drawing, collinear runs merged. */
  rects: number[][];
};

const vAt = (m: Maze, x: number, y: number) => m.v[y * (m.cols + 1) + x];
const hAt = (m: Maze, x: number, y: number) => m.h[y * m.cols + x];

/** True if a circle at (x, y) with radius r can be in cell space: not inside a wall rect. */
export function circleFree(m: Maze, x: number, y: number, r: number): boolean {
  for (const rc of m.rects) {
    const cx = Math.max(rc[0], Math.min(x, rc[0] + rc[2]));
    const cy = Math.max(rc[1], Math.min(y, rc[1] + rc[3]));
    if ((x - cx) * (x - cx) + (y - cy) * (y - cy) < r * r) return false;
  }
  return true;
}

/** Push a circle out of every wall rect it overlaps (min penetration axis). Mutates p. */
export function pushOut(m: Maze, p: { x: number; y: number }, r: number) {
  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    for (const rc of m.rects) {
      const cx = Math.max(rc[0], Math.min(p.x, rc[0] + rc[2]));
      const cy = Math.max(rc[1], Math.min(p.y, rc[1] + rc[3]));
      let dx = p.x - cx;
      let dy = p.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= r * r) continue;
      if (d2 > 1e-9) {
        const d = Math.sqrt(d2);
        p.x += (dx / d) * (r - d);
        p.y += (dy / d) * (r - d);
      } else {
        // Center inside the rect: push out along the smallest exit.
        const lx = Math.min(p.x - rc[0], rc[0] + rc[2] - p.x);
        const ly = Math.min(p.y - rc[1], rc[1] + rc[3] - p.y);
        if (lx < ly) p.x += (p.x - rc[0] < rc[0] + rc[2] - p.x ? -(lx + r) : lx + r);
        else p.y += (p.y - rc[1] < rc[1] + rc[3] - p.y ? -(ly + r) : ly + r);
      }
      moved = true;
    }
    if (!moved) break;
  }
}

/**
 * Perfect maze by iterative recursive backtracker, then ~25% of remaining interior walls are removed
 * (seeded) to make loops. Outer walls are never removed. Deterministic per seed.
 */
export function createMaze(cols: number, rows: number, seed: number): Maze {
  const rng = mulberry32(seed);
  const v = new Array<boolean>((cols + 1) * rows).fill(true);
  const h = new Array<boolean>((rows + 1) * cols).fill(true);
  const m: Maze = { cols, rows, v, h, rects: [] };

  // Recursive backtracker over cells.
  const seen = new Uint8Array(cols * rows);
  const stack = [0];
  seen[0] = 1;
  const DX = [1, 0, -1, 0];
  const DY = [0, 1, 0, -1];
  while (stack.length) {
    const c = stack[stack.length - 1];
    const cx = c % cols;
    const cy = (c / cols) | 0;
    const opts: number[] = [];
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (nx >= 0 && ny >= 0 && nx < cols && ny < rows && !seen[ny * cols + nx]) opts.push(d);
    }
    if (!opts.length) {
      stack.pop();
      continue;
    }
    const d = opts[(rng() * opts.length) | 0];
    const nx = cx + DX[d];
    const ny = cy + DY[d];
    if (d === 0) v[cy * (cols + 1) + nx] = false;
    else if (d === 2) v[cy * (cols + 1) + cx] = false;
    else if (d === 1) h[ny * cols + cx] = false;
    else h[cy * cols + cx] = false;
    seen[ny * cols + nx] = 1;
    stack.push(ny * cols + nx);
  }

  // Open loops: remove some interior walls that still stand.
  const interiorV: number[] = [];
  const interiorH: number[] = [];
  for (let y = 0; y < rows; y++) for (let x = 1; x < cols; x++) if (v[y * (cols + 1) + x]) interiorV.push(y * (cols + 1) + x);
  for (let y = 1; y < rows; y++) for (let x = 0; x < cols; x++) if (h[y * cols + x]) interiorH.push(y * cols + x);
  const remove = (list: number[], arr: boolean[], want: number) => {
    for (let i = list.length - 1; i > 0; i--) {
      const j = (rng() * (i + 1)) | 0;
      const t = list[i];
      list[i] = list[j];
      list[j] = t;
    }
    for (let i = 0; i < Math.min(want, list.length); i++) arr[list[i]] = false;
  };
  remove(interiorV, v, Math.round(interiorV.length * 0.25));
  remove(interiorH, h, Math.round(interiorH.length * 0.25));

  // Merge wall edges into rectangles: vertical runs along x edges, horizontal runs along y edges.
  const T = WALL_T / 2;
  for (let x = 0; x <= cols; x++) {
    let y0 = -1;
    for (let y = 0; y <= rows; y++) {
      const on = y < rows && v[y * (cols + 1) + x];
      if (on && y0 < 0) y0 = y;
      if (!on && y0 >= 0) {
        m.rects.push([x - T, y0 - T, WALL_T, y - y0 + WALL_T]);
        y0 = -1;
      }
    }
  }
  for (let y = 0; y <= rows; y++) {
    let x0 = -1;
    for (let x = 0; x <= cols; x++) {
      const on = x < cols && h[y * cols + x];
      if (on && x0 < 0) x0 = x;
      if (!on && x0 >= 0) {
        m.rects.push([x0 - T, y - T, x - x0 + WALL_T, WALL_T]);
        x0 = -1;
      }
    }
  }
  return m;
}

/** BFS distance field from a set of start cells. dist[y*cols+x], -1 unreachable (never, the maze is connected). */
export function bfs(m: Maze, starts: number[]): Int32Array {
  const dist = new Int32Array(m.cols * m.rows).fill(-1);
  const queue: number[] = [];
  for (const s of starts) {
    dist[s] = 0;
    queue.push(s);
  }
  for (let i = 0; i < queue.length; i++) {
    const c = queue[i];
    const cx = c % m.cols;
    const cy = (c / m.cols) | 0;
    const d = dist[c];
    if (cx > 0 && !vAt(m, cx, cy) && dist[c - 1] < 0) {
      dist[c - 1] = d + 1;
      queue.push(c - 1);
    }
    if (cx < m.cols - 1 && !vAt(m, cx + 1, cy) && dist[c + 1] < 0) {
      dist[c + 1] = d + 1;
      queue.push(c + 1);
    }
    if (cy > 0 && !hAt(m, cx, cy) && dist[c - m.cols] < 0) {
      dist[c - m.cols] = d + 1;
      queue.push(c - m.cols);
    }
    if (cy < m.rows - 1 && !hAt(m, cx, cy + 1) && dist[c + m.cols] < 0) {
      dist[c + m.cols] = d + 1;
      queue.push(c + m.cols);
    }
  }
  return dist;
}

export const cellOf = (m: Maze, x: number, y: number) => Math.min(m.rows - 1, Math.max(0, Math.floor(y))) * m.cols + Math.min(m.cols - 1, Math.max(0, Math.floor(x)));

// -----------------------------------------------------------------------------------------------------------------
// Entities

export type Special = 'laser' | 'triple' | 'mine';
export type Phase = 'ready' | 'play' | 'settle' | 'done';

export type TankInput = { turn: -1 | 0 | 1; move: -1 | 0 | 1; fire: boolean };
export const noInput: TankInput = { turn: 0, move: 0, fire: false };

export type Tank = {
  id: number;
  x: number;
  y: number;
  a: number;
  alive: boolean;
  special: Special | null;
  /** Triple shots still owed. */
  fans: number;
  cooldown: number;
  /** Distance driven (for tread animation / net flags). */
  tread: number;
  recoil: number;
};

export type Shell = {
  id: number;
  owner: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  /** Shells fired in the same volley share a nonzero group so they cannot annihilate each other. */
  volley: number;
};

export type Pickup = { kind: Special; cx: number; cy: number; x: number; y: number; born: number };

export type Mine = { owner: number; x: number; y: number; age: number };

export type Beam = { owner: number; pts: number[]; t: number };

export type GameEvent =
  | { k: 'fire'; id: number }
  | { k: 'bounce'; x: number; y: number }
  | { k: 'kill'; id: number; by: number; x: number; y: number }
  | { k: 'pickup'; id: number; kind: Special }
  | { k: 'laser'; id: number; pts: number[] }
  | { k: 'mine'; id: number }
  | { k: 'boom'; x: number; y: number };

export type World = {
  maze: Maze;
  seed: number;
  round: number;
  target: number;
  tanks: Tank[];
  shells: Shell[];
  pickups: Pickup[];
  mines: Mine[];
  beams: Beam[];
  scores: number[];
  phase: Phase;
  phaseT: number;
  time: number;
  pickupT: number;
  nextShell: number;
  rng: Rng;
  events: GameEvent[];
  /** Set when the match ends: winning tank id or -1 for a drawn final round. */
  winner: number;
};

export const TANK_R = 0.26;
export const FWD = 1.9;
export const REV = 1.3;
export const TURN = 3.8;
export const SHELL_SPEED = 3.2;
export const SHELL_R = 0.07;
export const SHELL_LIFE = 9;
export const MAX_SHELLS = 5;
export const FIRE_CD = 0.18;
export const IMMUNE = 0.12;
export const MINE_ARM = 1;
export const MINE_R = 0.3;
export const MINE_BLAST = 0.7;
export const MINE_LIFE = 30;
export const LASER_LEN = 20;
export const LASER_BOUNCES = 5;
export const MAX_PICKUPS = 2;
export const PICKUP_EVERY = 7;

const wrapA = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Spawn cells spread far apart: greedy picks maximizing the min BFS distance to tanks already placed. */
export function pickSpawns(m: Maze, count: number, rng: Rng): { cx: number; cy: number }[] {
  const n = m.cols * m.rows;
  const order = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = (rng() * (i + 1)) | 0;
    [order[i], order[j]] = [order[j], order[i]];
  }
  const chosen: number[] = [order[0]];
  while (chosen.length < count) {
    const dist = bfs(m, chosen);
    let best = order[0];
    let bestD = -1;
    for (const c of order) {
      if (chosen.includes(c)) continue;
      const d = dist[c];
      if (d > bestD) {
        bestD = d;
        best = c;
      }
    }
    chosen.push(best);
  }
  return chosen.map((c) => ({ cx: c % m.cols, cy: (c / m.cols) | 0 }));
}

/** Start a round on a fresh (or given) maze: place tanks, clear projectiles. */
export function spawnRound(w: World, seed: number, dims?: { cols: number; rows: number }) {
  w.seed = seed;
  w.maze = createMaze(dims?.cols ?? w.maze.cols, dims?.rows ?? w.maze.rows, seed);
  w.rng = mulberry32(seed ^ 0xa53a9d01);
  const spots = pickSpawns(w.maze, w.tanks.length, w.rng);
  for (const t of w.tanks) {
    const s = spots[t.id];
    t.x = s.cx + 0.5;
    t.y = s.cy + 0.5;
    t.a = w.rng() * Math.PI * 2;
    t.alive = true;
    t.special = null;
    t.fans = 0;
    t.cooldown = 0;
    t.tread = 0;
    t.recoil = 0;
  }
  w.shells = [];
  w.mines = [];
  w.beams = [];
  w.pickups = [];
  w.pickupT = PICKUP_EVERY * (0.6 + w.rng() * 0.8);
  w.phase = 'ready';
  w.phaseT = 1.2;
  w.winner = -1;
}

export function createWorld(opts: { cols: number; rows: number; seed: number; count: number; target: number }): World {
  const maze = createMaze(opts.cols, opts.rows, opts.seed);
  const w: World = {
    maze,
    seed: opts.seed,
    round: 1,
    target: opts.target,
    tanks: Array.from({ length: opts.count }, (_, i) => ({ id: i, x: 0, y: 0, a: 0, alive: true, special: null, fans: 0, cooldown: 0, tread: 0, recoil: 0 })),
    shells: [],
    pickups: [],
    mines: [],
    beams: [],
    scores: new Array(opts.count).fill(0),
    phase: 'ready',
    phaseT: 1.2,
    time: 0,
    pickupT: PICKUP_EVERY,
    nextShell: 1,
    rng: mulberry32(opts.seed ^ 0xa53a9d01),
    events: [],
    winner: -1,
  };
  spawnRound(w, opts.seed);
  w.round = 1;
  return w;
}

// -----------------------------------------------------------------------------------------------------------------
// Shooting / rays

export type Trace = {
  /** Polyline points, start included. */
  pts: number[];
  /** Tank id the ray reaches first, or -1. */
  hit: number;
  len: number;
};

/** Ray vs wall rect (slab test, padded by shell radius). Returns entry t and the axis of the face hit. */
const rayRect = (x: number, y: number, dx: number, dy: number, rc: number[]): { t: number; ax: 0 | 1 } | null => {
  let t0 = -Infinity;
  let t1 = Infinity;
  let ax: 0 | 1 = 0;
  const pad = SHELL_R;
  for (const a of [0, 1] as const) {
    const o = a ? y : x;
    const d = a ? dy : dx;
    const lo = rc[a] - pad;
    const hi = rc[a] + rc[a + 2] + pad;
    if (Math.abs(d) < 1e-9) {
      if (o < lo || o > hi) return null;
      continue;
    }
    let ta = (lo - o) / d;
    let tb = (hi - o) / d;
    if (ta > tb) [ta, tb] = [tb, ta];
    if (ta > t0) {
      t0 = ta;
      ax = a;
    }
    t1 = Math.min(t1, tb);
    if (t0 > t1) return null;
  }
  if (t1 < 0 || t0 < 0) return null;
  return { t: t0, ax };
};

const rayTank = (x: number, y: number, dx: number, dy: number, t: Tank, max: number, minT = 0): number => {
  const ox = t.x - x;
  const oy = t.y - y;
  const proj = ox * dx + oy * dy;
  if (proj < 0 || proj > max) return Infinity;
  const d2 = ox * ox + oy * oy - proj * proj;
  const r = TANK_R + 0.02;
  if (d2 > r * r) return Infinity;
  const hit = Math.max(0, proj - Math.sqrt(r * r - d2));
  return hit >= minT ? hit : Infinity;
};

/**
 * Walk a ray through the maze with reflections. Returns the polyline and the first living tank hit,
 * or -1 when it runs out of length or bounces. Segment count = bounces + 1.
 */
export function traceShot(w: World, x: number, y: number, angle: number, maxBounces: number, maxLen = LASER_LEN, selfId = -1): Trace {
  const pts = [x, y];
  let dx = Math.cos(angle);
  let dy = Math.sin(angle);
  let left = maxLen;
  let hit = -1;
  for (let b = 0; b <= maxBounces && left > 0; b++) {
    let tw = left;
    let ax: 0 | 1 = -1 as unknown as 0 | 1;
    for (const rc of w.maze.rects) {
      const r = rayRect(x, y, dx, dy, rc);
      if (r && r.t < tw) {
        tw = r.t;
        ax = r.ax;
      }
    }
    let tt = Infinity;
    let tid = -1;
    for (const t of w.tanks) {
      if (!t.alive) continue;
      // the shooter is safe only while the ray is still leaving its muzzle (first segment)
      const minT = t.id === selfId ? (b === 0 ? TANK_R + 0.15 : 0) : 0;
      const d = rayTank(x, y, dx, dy, t, tw, minT);
      if (d < tt) {
        tt = d;
        tid = t.id;
      }
    }
    if (tid >= 0) {
      pts.push(x + dx * tt, y + dy * tt);
      hit = tid;
      return { pts, hit, len: maxLen - left + tt };
    }
    x += dx * tw;
    y += dy * tw;
    left -= tw;
    pts.push(x, y);
    if (ax === 0) dx = -dx;
    else dy = -dy;
    // nudge off the surface so the same rect doesn't re-hit
    x += dx * 1e-4;
    y += dy * 1e-4;
  }
  return { pts, hit, len: maxLen - left };
}

// -----------------------------------------------------------------------------------------------------------------
// Simulation

const fireShell = (w: World, t: Tank) => {
  // Barrel tip: if it sits inside a wall, spawn from the center instead (no shooting through walls).
  let x = t.x + Math.cos(t.a) * (TANK_R + 0.1);
  let y = t.y + Math.sin(t.a) * (TANK_R + 0.1);
  if (!circleFree(w.maze, x, y, SHELL_R)) {
    x = t.x;
    y = t.y;
  }
  const spread = t.fans > 0 ? [-0.18, 0, 0.18] : [0];
  const cap = t.fans > 0 ? 8 : MAX_SHELLS;
  const volley = spread.length > 1 ? w.nextShell : 0;
  for (const off of spread) {
    if (w.shells.filter((s) => s.owner === t.id).length >= cap) break;
    const a = t.a + off;
    w.shells.push({ id: w.nextShell++, owner: t.id, x, y, vx: Math.cos(a) * SHELL_SPEED, vy: Math.sin(a) * SHELL_SPEED, age: 0, volley });
  }
  if (t.fans > 0) t.fans--;
  t.cooldown = FIRE_CD;
  t.recoil = 1;
  w.events.push({ k: 'fire', id: t.id });
};

const killTank = (w: World, t: Tank, by: number) => {
  if (!t.alive) return;
  t.alive = false;
  w.events.push({ k: 'kill', id: t.id, by, x: t.x, y: t.y });
};

/** Move a shell with substeps so it never tunnels through thin walls. */
const moveShell = (w: World, s: Shell, dt: number) => {
  let left = dt;
  while (left > 0) {
    const h = Math.min(left, 0.05 / SHELL_SPEED);
    left -= h;
    s.x += s.vx * h;
    s.y += s.vy * h;
    for (const rc of w.maze.rects) {
      const cx = Math.max(rc[0], Math.min(s.x, rc[0] + rc[2]));
      const cy = Math.max(rc[1], Math.min(s.y, rc[1] + rc[3]));
      const dx = s.x - cx;
      const dy = s.y - cy;
      if (dx * dx + dy * dy >= SHELL_R * SHELL_R) continue;
      // Reflect on the axis of least penetration; corners pick the smaller overlap.
      const px = dx !== 0 ? SHELL_R - Math.abs(dx) : Infinity;
      const py = dy !== 0 ? SHELL_R - Math.abs(dy) : Infinity;
      if (px < py) {
        s.vx = -s.vx;
        s.x += s.vx * h * 2;
      } else {
        s.vy = -s.vy;
        s.y += s.vy * h * 2;
      }
      w.events.push({ k: 'bounce', x: s.x, y: s.y });
      break;
    }
  }
};

const applyInput = (w: World, t: Tank, input: TankInput, dt: number) => {
  if (!t.alive) return;
  t.cooldown = Math.max(0, t.cooldown - dt);
  t.recoil = Math.max(0, t.recoil - dt * 6);
  t.a = wrapA(t.a + input.turn * TURN * dt);
  if (input.move !== 0) {
    const sp = input.move > 0 ? FWD : REV;
    t.x += Math.cos(t.a) * sp * input.move * dt;
    t.y += Math.sin(t.a) * sp * input.move * dt;
    t.tread += sp * dt;
    pushOut(w.maze, t, TANK_R);
    t.x = Math.max(TANK_R, Math.min(w.maze.cols - TANK_R, t.x));
    t.y = Math.max(TANK_R, Math.min(w.maze.rows - TANK_R, t.y));
  }
  if (input.fire && t.cooldown <= 0) {
    if (t.special === 'laser') {
      const tr = traceShot(w, t.x, t.y, t.a, LASER_BOUNCES, LASER_LEN, t.id);
      t.special = null;
      t.cooldown = FIRE_CD;
      t.recoil = 1;
      w.beams.push({ owner: t.id, pts: tr.pts, t: 0.35 });
      w.events.push({ k: 'laser', id: t.id, pts: tr.pts });
      if (tr.hit >= 0) {
        const victim = w.tanks[tr.hit];
        // The owner is safe only while the beam is still on its first segment (pts = 4 numbers).
        if (victim && !(victim.id === t.id && tr.pts.length <= 4)) killTank(w, victim, t.id);
      }
    } else if (t.special === 'mine') {
      t.special = null;
      t.cooldown = FIRE_CD;
      const x = t.x - Math.cos(t.a) * (TANK_R + 0.18);
      const y = t.y - Math.sin(t.a) * (TANK_R + 0.18);
      w.mines.push({ owner: t.id, x: circleFree(w.maze, x, y, 0.08) ? x : t.x, y: circleFree(w.maze, x, y, 0.08) ? y : t.y, age: 0 });
      w.events.push({ k: 'mine', id: t.id });
    } else {
      if (t.special === 'triple') {
        t.fans = 3;
        t.special = null;
      }
      fireShell(w, t);
    }
  }
};

/** Tanks push each other apart. */
const bumpTanks = (w: World) => {
  const ts = w.tanks;
  for (let i = 0; i < ts.length; i++) {
    if (!ts[i].alive) continue;
    for (let j = i + 1; j < ts.length; j++) {
      if (!ts[j].alive) continue;
      const dx = ts[j].x - ts[i].x;
      const dy = ts[j].y - ts[i].y;
      const d2 = dx * dx + dy * dy;
      const min = TANK_R * 2;
      if (d2 >= min * min || d2 < 1e-9) continue;
      const d = Math.sqrt(d2);
      const push = (min - d) / 2;
      const nx = dx / d;
      const ny = dy / d;
      ts[i].x -= nx * push;
      ts[i].y -= ny * push;
      ts[j].x += nx * push;
      ts[j].y += ny * push;
      pushOut(w.maze, ts[i], TANK_R);
      pushOut(w.maze, ts[j], TANK_R);
    }
  }
};

const freeCell = (w: World, rng: Rng): number => {
  const n = w.maze.cols * w.maze.rows;
  for (let tries = 0; tries < 60; tries++) {
    const c = (rng() * n) | 0;
    const cx = c % w.maze.cols;
    const cy = (c / w.maze.cols) | 0;
    let ok = true;
    for (const t of w.tanks) {
      if (t.alive && Math.hypot(t.x - (cx + 0.5), t.y - (cy + 0.5)) < 2.2) {
        ok = false;
        break;
      }
    }
    if (ok && !w.pickups.some((p) => p.cx === cx && p.cy === cy)) return c;
  }
  return -1;
};

const KINDS: Special[] = ['laser', 'triple', 'mine'];

/**
 * Advance the whole world by dt (seconds). Drives phases: 'ready' countdown (input ignored),
 * 'play', 'settle' (shells still fly; a last-tank death here makes the round a draw), then
 * awards the point and either starts the next round or ends the match (phase 'done', winner set).
 * Events for the step land in w.events (cleared at the top of each call).
 */
export function step(w: World, inputs: TankInput[], dt = 1 / 60) {
  w.events = [];
  if (w.phase === 'done') return;
  w.time += dt;

  if (w.phase === 'ready') {
    w.phaseT -= dt;
    if (w.phaseT <= 0) {
      w.phase = 'play';
      w.phaseT = 0;
    }
    return;
  }

  // --- tanks ---
  if (w.phase === 'play') {
    for (const t of w.tanks) applyInput(w, t, inputs[t.id] ?? noInput, dt);
    bumpTanks(w);
  }

  // --- shells ---
  for (const s of w.shells) {
    s.age += dt;
    moveShell(w, s, dt);
    if (s.age > SHELL_LIFE) s.age = Infinity;
  }
  // tank hits
  for (const s of w.shells) {
    if (s.age === Infinity) continue;
    for (const t of w.tanks) {
      if (!t.alive) continue;
      if (s.owner === t.id && s.age < IMMUNE) continue;
      const dx = t.x - s.x;
      const dy = t.y - s.y;
      if (dx * dx + dy * dy < (TANK_R + SHELL_R) * (TANK_R + SHELL_R)) {
        killTank(w, t, s.owner);
        s.age = Infinity;
        break;
      }
    }
  }
  // shells annihilate each other
  for (let i = 0; i < w.shells.length; i++) {
    const a = w.shells[i];
    if (a.age === Infinity) continue;
    for (let j = i + 1; j < w.shells.length; j++) {
      const b = w.shells[j];
      if (b.age === Infinity) continue;
      if (a.volley !== 0 && a.volley === b.volley) continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy < (SHELL_R * 2) * (SHELL_R * 2)) {
        a.age = Infinity;
        b.age = Infinity;
        w.events.push({ k: 'boom', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
        break;
      }
    }
  }
  w.shells = w.shells.filter((s) => s.age !== Infinity);

  // --- mines ---
  for (const mine of w.mines) {
    mine.age += dt;
    if (mine.age < MINE_ARM || mine.age > MINE_LIFE) continue;
    for (const t of w.tanks) {
      if (!t.alive) continue;
      const dx = t.x - mine.x;
      const dy = t.y - mine.y;
      if (dx * dx + dy * dy < MINE_R * MINE_R) {
        mine.age = Infinity;
        w.events.push({ k: 'boom', x: mine.x, y: mine.y });
        for (const v of w.tanks) {
          if (!v.alive) continue;
          const ddx = v.x - mine.x;
          const ddy = v.y - mine.y;
          if (ddx * ddx + ddy * ddy < MINE_BLAST * MINE_BLAST) killTank(w, v, mine.owner);
        }
        break;
      }
    }
  }
  w.mines = w.mines.filter((m) => m.age <= MINE_LIFE);

  // --- beams fade ---
  for (const b of w.beams) b.t -= dt;
  w.beams = w.beams.filter((b) => b.t > 0);

  // --- pickups ---
  if (w.phase === 'play') {
    w.pickupT -= dt;
    if (w.pickupT <= 0 && w.pickups.length < MAX_PICKUPS) {
      w.pickupT = PICKUP_EVERY * (0.7 + w.rng() * 0.6);
      const c = freeCell(w, w.rng);
      if (c >= 0) {
        const cx = c % w.maze.cols;
        const cy = (c / w.maze.cols) | 0;
        w.pickups.push({ kind: KINDS[(w.rng() * 3) | 0], cx, cy, x: cx + 0.5, y: cy + 0.5, born: w.time });
      }
    }
    for (const t of w.tanks) {
      if (!t.alive) continue;
      const i = w.pickups.findIndex((p) => Math.hypot(p.x - t.x, p.y - t.y) < TANK_R + 0.16);
      if (i >= 0) {
        const p = w.pickups.splice(i, 1)[0];
        t.special = p.kind;
        t.fans = 0;
        w.events.push({ k: 'pickup', id: t.id, kind: p.kind });
      }
    }
  }

  // --- round bookkeeping ---
  if (w.phase === 'play') {
    const left = w.tanks.filter((t) => t.alive);
    if (left.length <= 1) {
      w.phase = 'settle';
      w.phaseT = 2.2;
      w.winner = left.length === 1 ? left[0].id : -1;
    }
  } else if (w.phase === 'settle') {
    w.phaseT -= dt;
    const left = w.tanks.filter((t) => t.alive);
    if (left.length === 0) w.winner = -1; // the last tank went down during the settle window
    if (w.phaseT <= 0) {
      if (w.winner >= 0) w.scores[w.winner]++;
      if (w.winner >= 0 && w.scores[w.winner] >= w.target) {
        w.phase = 'done';
      } else {
        w.round++;
        spawnRound(w, w.seed + w.round * 0x9e3779b9);
      }
    }
  }
}

/** Predict where a point moving with a shell would be after `secs`, bouncing off walls. Cheap helper for bots. */
export function predictShell(w: World, s: Shell, secs: number): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  const g = { x: s.x, y: s.y, vx: s.vx, vy: s.vy };
  const h = 0.05;
  for (let t = 0; t < secs; t += h) {
    g.x += g.vx * h;
    g.y += g.vy * h;
    for (const rc of w.maze.rects) {
      const cx = Math.max(rc[0], Math.min(g.x, rc[0] + rc[2]));
      const cy = Math.max(rc[1], Math.min(g.y, rc[1] + rc[3]));
      const dx = g.x - cx;
      const dy = g.y - cy;
      if (dx * dx + dy * dy < SHELL_R * SHELL_R) {
        const px = dx !== 0 ? SHELL_R - Math.abs(dx) : Infinity;
        const py = dy !== 0 ? SHELL_R - Math.abs(dy) : Infinity;
        if (px < py) {
          g.vx = -g.vx;
          g.x += g.vx * h;
        } else {
          g.vy = -g.vy;
          g.y += g.vy * h;
        }
        break;
      }
    }
    pts.push({ x: g.x, y: g.y });
  }
  return pts;
}

/** Region the shell's control pill occupies at the top right of the stage (canvas CSS px). */
const TOOLBAR = { w: 176, h: 50 };

/**
 * Fit the maze inside a board rect (canvas CSS px): pads the board 8px on every side, then
 * letterboxes the maze inside. When the fitted maze would slide under the top-right control pill,
 * it refits either against a narrower region (right edge kept clear of the pill) or a lower one
 * (below the pill), whichever leaves the bigger cells. w is the full canvas width.
 */
export function fitBoard(
  board: { x: number; y: number; w: number; h: number },
  cols: number,
  rows: number,
  w: number,
): { cell: number; ox: number; oy: number } {
  const pad = 8;
  const b = { x: board.x + pad, y: board.y + pad, w: Math.max(0, board.w - pad * 2), h: Math.max(0, board.h - pad * 2) };
  const rx = w - TOOLBAR.w;
  const fit = (x: number, y: number, bw: number, bh: number) => {
    const cell = Math.min(bw / cols, bh / rows);
    return { cell, ox: x + (bw - cell * cols) / 2, oy: y + (bh - cell * rows) / 2 };
  };
  const overlaps = (f: { cell: number; ox: number; oy: number }) =>
    f.ox + f.cell * cols > rx && f.ox < w && f.oy + f.cell * rows > 0 && f.oy < TOOLBAR.h;
  const base = fit(b.x, b.y, b.w, b.h);
  if (!overlaps(base) || base.cell <= 0) return base;
  // (a) keep the maze left of the pill; (b) drop it below the pill.
  const narrow = fit(b.x, b.y, Math.max(0, rx - pad - b.x), b.h);
  const low = fit(b.x, TOOLBAR.h, b.w, Math.max(0, b.y + b.h - TOOLBAR.h));
  return narrow.cell >= low.cell ? narrow : low;
}

export type TouchZone = { x: number; y: number; w: number; h: number; flip: boolean };

/**
 * Stage layout in canvas CSS px: the HUD band, the board the maze letterboxes into, and one
 * touch zone per human (max 2). Zones always sit beside or above/below the board, never over it:
 * 1P gets a bottom band, portrait 2P splits top/bottom (the top player's zone renders flipped),
 * and landscape 2P gets slim side columns flanking the board.
 */
export function touchLayout(
  w: number,
  h: number,
  humans: number,
  touch: boolean,
): { hud: number; board: { x: number; y: number; w: number; h: number }; zones: TouchZone[]; portrait: boolean } {
  const hud = h < 200 ? 26 : 34;
  const touchN = touch ? Math.min(humans, 2) : 0;
  const portrait = h > w;
  let board = { x: 0, y: hud, w, h: h - hud };
  const zones: TouchZone[] = [];
  if (touchN === 1) {
    const band = Math.min(h * 0.3, 190);
    board = { x: 0, y: hud, w, h: h - hud - band };
    zones.push({ x: 0, y: h - band, w: w * 0.62, h: band, flip: false });
  } else if (touchN === 2 && portrait) {
    const band = Math.min(h * 0.24, 170);
    board = { x: 0, y: hud + band, w, h: h - hud - band * 2 };
    zones.push({ x: 0, y: h - band, w, h: band, flip: false });
    zones.push({ x: 0, y: hud, w, h: band, flip: true });
  } else if (touchN === 2) {
    const side = Math.round(Math.min(w * 0.24, 210));
    board = { x: side, y: hud, w: w - 2 * side, h: h - hud };
    zones.push({ x: 0, y: hud, w: side, h: h - hud, flip: false });
    zones.push({ x: w - side, y: hud, w: side, h: h - hud, flip: false });
  }
  return { hud, board, zones, portrait };
}

/** A client point in the canvas's logical pixels, for a canvas drawn at `size` but shown at `rect`'s size. */
export function toCanvas(clientX: number, clientY: number, rect: { left: number; top: number; width: number; height: number }, size: { w: number; h: number }) {
  return {
    x: ((clientX - rect.left) * size.w) / (rect.width || size.w),
    y: ((clientY - rect.top) * size.h) / (rect.height || size.h),
  };
}

/**
 * Touch stick -> TankInput. The stick is a desired heading plus magnitude (0..1): the tank turns
 * toward it and drives when roughly aligned; a stick pointed almost behind reverses instead of U-turning.
 */
export function stickInput(tankAngle: number, stickAngle: number, magnitude: number): TankInput {
  if (magnitude < 0.3) return { turn: 0, move: 0, fire: false };
  const err = wrapA(stickAngle - tankAngle);
  if (Math.abs(err) > 2.4) {
    return { turn: err > 0 ? -1 : 1, move: -1, fire: false };
  }
  const move = Math.abs(err) < 0.7 ? 1 : 0;
  const turn = Math.abs(err) < 0.12 ? 0 : err > 0 ? 1 : -1;
  return { turn, move, fire: false } as TankInput;
}
