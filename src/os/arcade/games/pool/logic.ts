// Top-down 8-ball pool: physics engine and rules. Pure module, no DOM.
// Table coords: x along the length [0, L], y along the width [0, W]; y = 0 is the "top" rail.
// Determinism: the engine only uses + - * / Math.sqrt Math.abs Math.min Math.max and comparisons,
// so the same shot replays bit-identically on any engine (online guests resimulate locally).

export const L = 2;
export const W = 1;
export const R = 0.03;
export const VMAX = 5;
export const HEAD_X = L / 4;
export const FOOT = { x: L * 0.75, y: W / 2 };
export const STEP = 1 / 600;

// Tuned physics constants (exported for tests / tuning).
export const REST_BALL = 0.95; // ball-ball restitution
export const REST_RAIL = 0.76; // cushion restitution on the normal component
export const RAIL_TAN = 0.965; // tangential keep on cushion contact
export const FRIC_A = 0.45; // rolling decel base (u/s^2)
export const FRIC_B = 0.18; // rolling decel proportional to speed
export const STOP_V = 0.004; // below this speed a ball stops dead
export const SPIN_K = 0.55; // follow/draw transfer on first contact
export const RACK_GAP = 1e-4; // tiny gap between racked balls
export const MAX_T = 25; // give up simulating after this many seconds

export type Pocket = { x: number; y: number; r: number; side: boolean };

// Corner mouths: ~2.2 ball diameters between the jaw tips. Side mouths: ~2.4.
const CORNER_M = (2.2 * 2 * R) / Math.sqrt(2); // jaw tip offset along each rail at a corner
const SIDE_H = (2.4 * 2 * R) / 2; // jaw tip half-gap along the rail at a side pocket
const CORNER_JX = 0.028; // jaw reach back toward the pocket
const CORNER_JY = 0.032; // jaw reach outward off the rail line
const SIDE_JX = 0.018;
const SIDE_JY = 0.035;

export const POCKETS: readonly Pocket[] = [
  { x: -0.008, y: -0.008, r: 0.06, side: false }, // 0 top-left corner
  { x: L / 2, y: -0.02, r: 0.055, side: true }, // 1 top-middle
  { x: L + 0.008, y: -0.008, r: 0.06, side: false }, // 2 top-right corner
  { x: -0.008, y: W + 0.008, r: 0.06, side: false }, // 3 bottom-left corner
  { x: L / 2, y: W + 0.02, r: 0.055, side: true }, // 4 bottom-middle
  { x: L + 0.008, y: W + 0.008, r: 0.06, side: false }, // 5 bottom-right corner
];

export type Seg = { ax: number; ay: number; bx: number; by: number };

// Rail segments stop at the jaw tips; jaw segments angle outward (and slightly back
// toward the pocket, so the throat is a touch narrower than the mouth).
const segs: Seg[] = [];
{
  const m = CORNER_M;
  const h = SIDE_H;
  // rails
  segs.push(
    { ax: m, ay: 0, bx: L / 2 - h, by: 0 },
    { ax: L / 2 + h, ay: 0, bx: L - m, by: 0 },
    { ax: m, ay: W, bx: L / 2 - h, by: W },
    { ax: L / 2 + h, ay: W, bx: L - m, by: W },
    { ax: 0, ay: m, bx: 0, by: W - m },
    { ax: L, ay: m, bx: L, by: W - m },
  );
  // corner jaws (top-left, top-right, bottom-left, bottom-right)
  segs.push(
    { ax: m, ay: 0, bx: m - CORNER_JX, by: -CORNER_JY },
    { ax: 0, ay: m, bx: -CORNER_JY, by: m - CORNER_JX },
    { ax: L - m, ay: 0, bx: L - m + CORNER_JX, by: -CORNER_JY },
    { ax: L, ay: m, bx: L + CORNER_JY, by: m - CORNER_JX },
    { ax: m, ay: W, bx: m - CORNER_JX, by: W + CORNER_JY },
    { ax: 0, ay: W - m, bx: -CORNER_JY, by: W - m + CORNER_JX },
    { ax: L - m, ay: W, bx: L - m + CORNER_JX, by: W + CORNER_JY },
    { ax: L, ay: W - m, bx: L + CORNER_JY, by: W - m + CORNER_JX },
  );
  // side-pocket jaws
  segs.push(
    { ax: L / 2 - h, ay: 0, bx: L / 2 - h + SIDE_JX, by: -SIDE_JY },
    { ax: L / 2 + h, ay: 0, bx: L / 2 + h - SIDE_JX, by: -SIDE_JY },
    { ax: L / 2 - h, ay: W, bx: L / 2 - h + SIDE_JX, by: W + SIDE_JY },
    { ax: L / 2 + h, ay: W, bx: L / 2 + h - SIDE_JX, by: W + SIDE_JY },
  );
}
export const CUSHIONS: readonly Seg[] = segs;

export type Ball = { id: number; x: number; y: number; vx: number; vy: number; down: boolean };
export type Group = 'solids' | 'stripes';
export type Seat = 0 | 1;
export type Phase = 'break' | 'play' | 'over';
export type Game = {
  balls: Ball[];
  turn: Seat;
  groups: [Group | null, Group | null];
  phase: Phase;
  ballInHand: boolean;
  kitchen: boolean;
  winner: Seat | null;
  reason: string;
  foul: boolean;
  shots: number;
  seed: number;
};
export type Shot = {
  dx: number;
  dy: number;
  power: number;
  spin?: number;
  place?: { x: number; y: number };
  call?: number;
};
export type Contact = { kind: 'ball' | 'rail' | 'pocket'; a: number; b?: number; speed: number; t: number };
export type Sim = {
  balls: Ball[];
  t: number;
  acc: number;
  done: boolean;
  first: number | null;
  potted: number[];
  railAfterFirst: boolean;
  breakRails: number[];
  events: Contact[];
  cueSpin: number;
  shotDir: { x: number; y: number };
  spun: boolean; // follow/draw already applied
};
export type Trace = {
  hit: number | null;
  ghost: { x: number; y: number };
  cueDir: { x: number; y: number } | null;
  objDir: { x: number; y: number } | null;
  rail: { x: number; y: number } | null;
};

/** mulberry32-style seeded PRNG. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const mkBall = (id: number, x: number, y: number): Ball => ({ id, x, y, vx: 0, vy: 0, down: false });

/** Standard triangle at FOOT, apex toward the head. 8 centre of row 3, back corners split solid/stripe. */
export function rackBalls(seed: number): Ball[] {
  const rand = rng(seed);
  const solids = [1, 2, 3, 4, 5, 6, 7];
  const stripes = [9, 10, 11, 12, 13, 14, 15];
  const cSolid = solids.splice(Math.floor(rand() * solids.length), 1)[0];
  const cStripe = stripes.splice(Math.floor(rand() * stripes.length), 1)[0];
  const rest = [...solids, ...stripes];
  for (let i = rest.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = rest[i];
    rest[i] = rest[j];
    rest[j] = tmp;
  }
  // rows[r] = ball ids in rack row r (r+1 entries), ordered +y.
  const rows: number[][] = [[0], [0, 0], [0, 8, 0], [0, 0, 0, 0], [0, 0, 0, 0, 0]];
  const flip = rand() < 0.5;
  rows[4][0] = flip ? cSolid : cStripe;
  rows[4][4] = flip ? cStripe : cSolid;
  let ri = 0;
  for (let r = 0; r < 5; r++) {
    for (let k = 0; k <= r; k++) {
      if (rows[r][k] === 0) rows[r][k] = rest[ri++];
    }
  }
  const balls: Ball[] = [];
  for (let id = 0; id < 16; id++) balls.push(mkBall(id, 0, 0));
  const s = 2 * R + RACK_GAP;
  const rowDx = s * 0.8660254037844386; // sqrt(3)/2
  for (let r = 0; r < 5; r++) {
    for (let k = 0; k <= r; k++) {
      const id = rows[r][k];
      balls[id].x = FOOT.x + r * rowDx;
      balls[id].y = FOOT.y + (k - r / 2) * s;
    }
  }
  return balls;
}

export function newGame(seed: number, opener: Seat = 0): Game {
  const balls = rackBalls(seed);
  balls[0].x = HEAD_X * 0.6;
  balls[0].y = W / 2;
  return {
    balls,
    turn: opener,
    groups: [null, null],
    phase: 'break',
    ballInHand: true,
    kitchen: true,
    winner: null,
    reason: '',
    foul: false,
    shots: 0,
    seed,
  };
}

export function groupOf(id: number): Group | null {
  if (id >= 1 && id <= 7) return 'solids';
  if (id >= 9 && id <= 15) return 'stripes';
  return null;
}

export function remaining(game: Game, group: Group): number[] {
  const lo = group === 'solids' ? 1 : 9;
  const hi = group === 'solids' ? 7 : 15;
  const out: number[] = [];
  for (let id = lo; id <= hi; id++) if (!game.balls[id].down) out.push(id);
  return out;
}

/** Ids a legal first contact may be for `seat` (default the player to shoot). */
export function legalTargets(game: Game, seat: Seat = game.turn): number[] {
  if (game.phase === 'break') {
    const out: number[] = [];
    for (let id = 1; id <= 15; id++) if (!game.balls[id].down) out.push(id);
    return out;
  }
  const g = game.groups[seat];
  if (g === null) {
    const out: number[] = [];
    for (let id = 1; id <= 15; id++) if (id !== 8 && !game.balls[id].down) out.push(id);
    return out;
  }
  const rem = remaining(game, g);
  if (rem.length) return rem;
  return game.balls[8].down ? [] : [8];
}

export function canPlace(game: Game, x: number, y: number): boolean {
  if (x < R || x > L - R || y < R || y > W - R) return false;
  if (game.kitchen && x > HEAD_X) return false;
  for (const b of game.balls) {
    if (b.id === 0 || b.down) continue;
    const dx = b.x - x;
    const dy = b.y - y;
    if (dx * dx + dy * dy < 4 * R * R - 1e-12) return false;
  }
  return true;
}

/** Nearest legal placement to (x, y), searching a small square spiral. Null if none. */
export function clampPlace(game: Game, x: number, y: number): { x: number; y: number } | null {
  if (canPlace(game, x, y)) return { x, y };
  const step = R * 0.4;
  for (let ring = 1; ring <= 40; ring++) {
    const rr = ring * step;
    // square-spiral walk at radius rr
    let px = -rr;
    let py = -rr;
    for (let side = 0; side < 4; side++) {
      const nSteps = Math.max(2, Math.round((2 * rr) / step));
      for (let i = 0; i < nSteps; i++) {
        const cx = x + px;
        const cy = y + py;
        if (canPlace(game, cx, cy)) return { x: cx, y: cy };
        if (side === 0) px += (2 * rr) / nSteps;
        else if (side === 1) py += (2 * rr) / nSteps;
        else if (side === 2) px -= (2 * rr) / nSteps;
        else py -= (2 * rr) / nSteps;
      }
    }
  }
  return null;
}

const copyBalls = (balls: Ball[]): Ball[] => balls.map((b) => ({ ...b }));

export function cloneGame(g: Game): Game {
  return {
    balls: copyBalls(g.balls),
    turn: g.turn,
    groups: [g.groups[0], g.groups[1]],
    phase: g.phase,
    ballInHand: g.ballInHand,
    kitchen: g.kitchen,
    winner: g.winner,
    reason: g.reason,
    foul: g.foul,
    shots: g.shots,
    seed: g.seed,
  };
}

/** Start a simulation for a shot: copies balls, places the cue if legal, gives it velocity. */
export function startShot(game: Game, shot: Shot): Sim {
  const balls = copyBalls(game.balls);
  const cue = balls[0];
  cue.down = false;
  if (game.ballInHand && shot.place && canPlace(game, shot.place.x, shot.place.y)) {
    cue.x = shot.place.x;
    cue.y = shot.place.y;
  }
  cue.vx = 0;
  cue.vy = 0;
  let dx = shot.dx;
  let dy = shot.dy;
  const len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 1e-9) || !isFiniteLen(dx, dy)) {
    dx = 1;
    dy = 0;
  } else {
    dx /= len;
    dy /= len;
  }
  const power = Math.min(1, Math.max(0.03, shot.power));
  const speed = VMAX * power;
  cue.vx = dx * speed;
  cue.vy = dy * speed;
  const spin = shot.spin === undefined ? 0 : Math.min(1, Math.max(-1, shot.spin));
  return {
    balls,
    t: 0,
    acc: 0,
    done: false,
    first: null,
    potted: [],
    railAfterFirst: false,
    breakRails: [],
    events: [],
    cueSpin: spin,
    shotDir: { x: dx, y: dy },
    spun: false,
  };
}

function isFiniteLen(dx: number, dy: number): boolean {
  const s = dx * dx + dy * dy;
  return s >= 0 && s < 1e30;
}

const norm = (x: number, y: number) => Math.sqrt(x * x + y * y);

function substep(sim: Sim): void {
  const balls = sim.balls;
  // move
  for (const b of balls) {
    if (b.down) continue;
    if (b.vx !== 0 || b.vy !== 0) {
      b.x += b.vx * STEP;
      b.y += b.vy * STEP;
    }
  }
  // pockets
  for (const b of balls) {
    if (b.down) continue;
    for (let pi = 0; pi < POCKETS.length; pi++) {
      const p = POCKETS[pi];
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (dx * dx + dy * dy < p.r * p.r) {
        b.down = true;
        b.vx = 0;
        b.vy = 0;
        sim.potted.push(b.id);
        sim.events.push({ kind: 'pocket', a: b.id, b: pi, speed: 0, t: sim.t });
        break;
      }
    }
  }
  // ball-ball, up to 3 relaxation passes (the tight rack needs it)
  for (let iter = 0; iter < 3; iter++) {
    let any = false;
    for (let i = 0; i < 16; i++) {
      const a = balls[i];
      if (a.down) continue;
      for (let j = i + 1; j < 16; j++) {
        const b = balls[j];
        if (b.down) continue;
        const aStill = a.vx === 0 && a.vy === 0;
        const bStill = b.vx === 0 && b.vy === 0;
        if (aStill && bStill) continue;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d2 = dx * dx + dy * dy;
        const min = 2 * R;
        if (d2 >= min * min || d2 < 1e-18) continue;
        any = true;
        const d = Math.sqrt(d2);
        const nx = dx / d;
        const ny = dy / d;
        // positional separation, half each
        const overlap = min - d;
        a.x -= (nx * overlap) / 2;
        a.y -= (ny * overlap) / 2;
        b.x += (nx * overlap) / 2;
        b.y += (ny * overlap) / 2;
        const rvx = b.vx - a.vx;
        const rvy = b.vy - a.vy;
        const vn = rvx * nx + rvy * ny;
        if (vn < 0) {
          if (i === 0 && sim.first === null) sim.first = b.id;
          else if (j === 0 && sim.first === null) sim.first = a.id;
          const cueSpeed = i === 0 ? norm(a.vx, a.vy) : j === 0 ? norm(b.vx, b.vy) : 0;
          const jimp = (-(1 + REST_BALL) * vn) / 2;
          a.vx -= jimp * nx;
          a.vy -= jimp * ny;
          b.vx += jimp * nx;
          b.vy += jimp * ny;
          sim.events.push({ kind: 'ball', a: a.id, b: b.id, speed: -vn, t: sim.t });
          // follow/draw: kick the cue along the shot line right after its first contact
          if ((i === 0 || j === 0) && sim.cueSpin !== 0 && sim.first !== null && !sim.spun) {
            sim.spun = true;
            const cue = balls[0];
            cue.vx += sim.shotDir.x * sim.cueSpin * SPIN_K * cueSpeed;
            cue.vy += sim.shotDir.y * sim.cueSpin * SPIN_K * cueSpeed;
          }
        }
      }
    }
    if (!any) break;
  }
  // cushions
  for (const b of balls) {
    if (b.down) continue;
    if (b.vx === 0 && b.vy === 0) continue;
    for (const s of CUSHIONS) {
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      const sl2 = sx * sx + sy * sy;
      let u = 0;
      if (sl2 > 1e-18) {
        u = ((b.x - s.ax) * sx + (b.y - s.ay) * sy) / sl2;
        if (u < 0) u = 0;
        else if (u > 1) u = 1;
      }
      const cx = s.ax + u * sx;
      const cy = s.ay + u * sy;
      let dx = b.x - cx;
      let dy = b.y - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      let d = Math.sqrt(d2);
      if (d < 1e-9) {
        // centre sits exactly on the rail point: push inward off the segment normal
        const inv = 1 / Math.sqrt(sl2);
        dx = -sy * inv;
        dy = sx * inv;
        d = 1;
      } else {
        dx /= d;
        dy /= d;
      }
      // push out to the rail surface
      b.x = cx + dx * R;
      b.y = cy + dy * R;
      const vn = b.vx * dx + b.vy * dy;
      if (vn < 0) {
        const vtx = b.vx - vn * dx;
        const vty = b.vy - vn * dy;
        b.vx = vtx * RAIL_TAN - vn * REST_RAIL * dx;
        b.vy = vty * RAIL_TAN - vn * REST_RAIL * dy;
        sim.events.push({ kind: 'rail', a: b.id, speed: -vn, t: sim.t });
        if (sim.first !== null) sim.railAfterFirst = true;
        if (b.id !== 0 && !sim.breakRails.includes(b.id)) sim.breakRails.push(b.id);
      }
    }
  }
  // rolling friction
  for (const b of balls) {
    if (b.down) continue;
    const sp = norm(b.vx, b.vy);
    if (sp === 0) continue;
    const next = sp - (FRIC_A + FRIC_B * sp) * STEP;
    if (next <= STOP_V) {
      b.vx = 0;
      b.vy = 0;
    } else {
      const k = next / sp;
      b.vx *= k;
      b.vy *= k;
    }
  }
  sim.t += STEP;
}

const allStopped = (sim: Sim) => {
  for (const b of sim.balls) if (!b.down && (b.vx !== 0 || b.vy !== 0)) return false;
  return true;
};

export function stepSim(sim: Sim, dt: number): void {
  if (sim.done) return;
  sim.acc += dt;
  while (sim.acc >= STEP - 1e-15) {
    sim.acc -= STEP;
    substep(sim);
    if (allStopped(sim) || sim.t > MAX_T) {
      for (const b of sim.balls) {
        b.vx = 0;
        b.vy = 0;
      }
      sim.done = true;
      return;
    }
  }
}

export function runSim(sim: Sim): Sim {
  let guard = 0;
  while (!sim.done && guard++ < 40000) stepSim(sim, 1 / 30);
  sim.done = true;
  for (const b of sim.balls) {
    b.vx = 0;
    b.vy = 0;
  }
  return sim;
}

function freeSpotNear(balls: Ball[], x: number, y: number): { x: number; y: number } {
  // walk toward the foot rail (+x), then back toward the head if we run out of room
  const occupied = (cx: number, cy: number) => {
    if (cx < R || cx > L - R || cy < R || cy > W - R) return true;
    for (const b of balls) {
      if (b.down) continue;
      const dx = b.x - cx;
      const dy = b.y - cy;
      if (dx * dx + dy * dy < 4 * R * R) return true;
    }
    return false;
  };
  let cx = x;
  while (occupied(cx, y) && cx < L - R) cx += R * 0.5;
  if (cx > L - R) {
    cx = x;
    while (occupied(cx, y) && cx > R) cx -= R * 0.5;
  }
  if (occupied(cx, y)) {
    // last resort: scan a coarse grid
    for (let gy = R; gy <= W - R; gy += R) {
      for (let gx = R; gx <= L - R; gx += R) {
        if (!occupied(gx, gy)) return { x: gx, y: gy };
      }
    }
  }
  return { x: cx, y };
}

/** Apply 8-ball rules to a finished simulation. Returns a new game; never mutates the input. */
export function resolve(game: Game, shot: Shot, sim: Sim): Game {
  const g = cloneGame(game);
  g.balls = copyBalls(sim.balls);
  g.shots = game.shots + 1;
  g.kitchen = false;
  g.ballInHand = false;
  g.foul = false;
  g.reason = '';
  const me = game.turn;
  const opp: Seat = me === 0 ? 1 : 0;
  const scratch = sim.potted.includes(0);
  const pottedObj = sim.potted.filter((id) => id !== 0);
  const potted8 = pottedObj.includes(8);
  const wasBreak = game.phase === 'break';
  if (wasBreak) g.phase = 'play';

  // pocket index the 8 went into (if any)
  let eightPocket = -1;
  for (const e of sim.events) if (e.kind === 'pocket' && e.a === 8 && e.b !== undefined) eightPocket = e.b;

  let foul: string | null = null;
  if (scratch) foul = 'scratch';
  else if (sim.first === null) foul = 'missed everything';
  else if (!wasBreak && !legalTargets(game, me).includes(sim.first)) foul = 'hit the wrong ball first';
  else if (pottedObj.length === 0 && !sim.railAfterFirst) foul = 'no rail after contact';
  else if (wasBreak && pottedObj.length === 0 && sim.breakRails.length < 4) foul = 'weak break';

  // respot the 8 if it went down on the break
  if (wasBreak && potted8) {
    const spot = freeSpotNear(g.balls, FOOT.x, FOOT.y);
    const eight = g.balls[8];
    eight.down = false;
    eight.x = spot.x;
    eight.y = spot.y;
    eight.vx = 0;
    eight.vy = 0;
  }

  const on8 =
    !wasBreak && game.groups[me] !== null && remaining(game, game.groups[me] as Group).length === 0;

  // the 8 decides games
  if (potted8 && !wasBreak) {
    g.winner = opp;
    g.phase = 'over';
    if (!on8) g.reason = 'sank the 8 early';
    else if (foul === 'scratch') g.reason = 'scratched on the 8';
    else if (foul !== null) g.reason = foul;
    else if (shot.call !== undefined && eightPocket !== shot.call) g.reason = 'wrong pocket for the 8';
    else {
      g.winner = me;
      g.reason = 'cleared the table';
    }
    g.foul = foul !== null;
    g.turn = opp;
    respawnCue(g);
    return g;
  }

  // group assignment: first object ball potted on a legal shot while the table is open
  let assigned: Group | null = null;
  const openAfter = g.groups[me] === null;
  if (openAfter && !foul && pottedObj.length) {
    const firstNonEight = pottedObj.find((id) => id !== 8);
    if (firstNonEight !== undefined) {
      assigned = groupOf(firstNonEight);
      if (assigned) {
        g.groups[me] = assigned;
        g.groups[opp] = assigned === 'solids' ? 'stripes' : 'solids';
      }
    }
  }

  // does the shooter keep the table?
  let keeps = false;
  if (!foul && pottedObj.length) {
    const grp = g.groups[me];
    if (grp === null) keeps = pottedObj.some((id) => id !== 8); // still open somehow
    else keeps = pottedObj.some((id) => groupOf(id) === grp || (assigned !== null && id === pottedObj[0]));
  }

  if (foul !== null) {
    g.foul = true;
    g.reason = foul;
    g.turn = opp;
    g.ballInHand = true;
  } else {
    if (!keeps) g.turn = opp;
    if (wasBreak) g.reason = pottedObj.length ? 'break' : '';
    else if (pottedObj.length) g.reason = keeps ? 'potted' : 'potted, turn passes';
  }
  respawnCue(g);
  return g;
}

function respawnCue(g: Game): void {
  const cue = g.balls[0];
  if (!cue.down) return;
  cue.down = false;
  cue.vx = 0;
  cue.vy = 0;
  const spot = clampPlace(g, HEAD_X * 0.6, W / 2) ?? freeSpotNear(g.balls, HEAD_X * 0.6, W / 2);
  cue.x = spot.x;
  cue.y = spot.y;
}

export function play(game: Game, shot: Shot): Game {
  return resolve(game, shot, runSim(startShot(game, shot)));
}

/** Geometric aim ray for the cue ball: first ball hit (ghost + directions) else first cushion point. */
export function traceAim(game: Game, from: { x: number; y: number }, dx: number, dy: number): Trace {
  let len = Math.sqrt(dx * dx + dy * dy);
  if (!(len > 1e-9)) {
    dx = 1;
    dy = 0;
    len = 1;
  }
  dx /= len;
  dy /= len;
  let bestT = Infinity;
  let hitBall: Ball | null = null;
  for (const b of game.balls) {
    if (b.down || b.id === 0) continue;
    const ox = b.x - from.x;
    const oy = b.y - from.y;
    const tc = ox * dx + oy * dy;
    if (tc <= 0) continue;
    const d2 = ox * ox + oy * oy - tc * tc;
    const min = 2 * R;
    if (d2 >= min * min) continue;
    const t = tc - Math.sqrt(min * min - d2);
    if (t > 0 && t < bestT) {
      bestT = t;
      hitBall = b;
    }
  }
  let railT = Infinity;
  let railPt: { x: number; y: number } | null = null;
  for (const s of CUSHIONS) {
    const sx = s.bx - s.ax;
    const sy = s.by - s.ay;
    const den = dx * sy - dy * sx;
    if (Math.abs(den) < 1e-12) continue;
    const qx = s.ax - from.x;
    const qy = s.ay - from.y;
    const t = (qx * sy - qy * sx) / den;
    const u = (qx * dy - qy * dx) / den;
    if (t > 0 && u >= -0.02 && u <= 1.02 && t < railT) {
      railT = t;
      railPt = { x: from.x + dx * t, y: from.y + dy * t };
    }
  }
  if (hitBall && bestT <= railT) {
    const gx = from.x + dx * bestT;
    const gy = from.y + dy * bestT;
    let ox = hitBall.x - gx;
    let oy = hitBall.y - gy;
    const ol = norm(ox, oy) || 1;
    ox /= ol;
    oy /= ol;
    // cue deflects along the tangent (what's left of the aim dir after the normal part)
    const along = dx * ox + dy * oy;
    let tx = dx - along * ox;
    let ty = dy - along * oy;
    const tl = norm(tx, ty);
    const cueDir = tl > 0.05 ? { x: tx / tl, y: ty / tl } : null;
    return { hit: hitBall.id, ghost: { x: gx, y: gy }, cueDir, objDir: { x: ox, y: oy }, rail: null };
  }
  if (railPt) {
    return {
      hit: null,
      ghost: { x: from.x + dx * (railT - R), y: from.y + dy * (railT - R) },
      cueDir: null,
      objDir: null,
      rail: railPt,
    };
  }
  return { hit: null, ghost: { x: from.x + dx * L * 2, y: from.y + dy * L * 2 }, cueDir: null, objDir: null, rail: null };
}

/** Pocket index the ray from `ballId` along `dir` points at best (within ~12 degrees), else null. */
export function pocketFor(game: Game, ballId: number, dir: { x: number; y: number }): number | null {
  const b = game.balls[ballId];
  if (!b || b.down) return null;
  const dl = norm(dir.x, dir.y);
  if (dl < 1e-9) return null;
  const dx = dir.x / dl;
  const dy = dir.y / dl;
  let best = -1;
  let bestDot = 0.978; // ~cos(12deg)
  for (let i = 0; i < POCKETS.length; i++) {
    const p = POCKETS[i];
    const px = p.x - b.x;
    const py = p.y - b.y;
    const pl = norm(px, py);
    if (pl < 1e-9) continue;
    const dot = (px * dx + py * dy) / pl;
    if (dot > bestDot) {
      bestDot = dot;
      best = i;
    }
  }
  return best >= 0 ? best : null;
}

export function validGame(x: unknown): x is Game {
  if (typeof x !== 'object' || x === null) return false;
  const g = x as Game;
  if (!Array.isArray(g.balls) || g.balls.length !== 16) return false;
  for (let i = 0; i < 16; i++) {
    const b = g.balls[i] as Ball;
    if (typeof b !== 'object' || b === null) return false;
    if (b.id !== i) return false;
    if (!Number.isFinite(b.x) || !Number.isFinite(b.y) || !Number.isFinite(b.vx) || !Number.isFinite(b.vy)) return false;
    if (typeof b.down !== 'boolean') return false;
  }
  if (g.turn !== 0 && g.turn !== 1) return false;
  if (!Array.isArray(g.groups) || g.groups.length !== 2) return false;
  for (const gr of g.groups) if (gr !== null && gr !== 'solids' && gr !== 'stripes') return false;
  if (g.phase !== 'break' && g.phase !== 'play' && g.phase !== 'over') return false;
  if (typeof g.ballInHand !== 'boolean' || typeof g.kitchen !== 'boolean' || typeof g.foul !== 'boolean') return false;
  if (g.winner !== null && g.winner !== 0 && g.winner !== 1) return false;
  if (typeof g.reason !== 'string') return false;
  if (!Number.isFinite(g.shots) || !Number.isFinite(g.seed)) return false;
  return true;
}
