// Paper.io rules on a fine grid. Pure module, no DOM, no allocations in the per-tick path.
//
// The arena is a disc inside an n x n grid of cells. `owner` holds who owns each cell (0 nobody, else id + 1) and
// `trail` the trail lying on it. Heads move freely (any angle, constant speed, capped turn rate); every cell a head
// walks into is processed in order along a 4-connected path, so a crossing is never skipped:
//   - leaving your land lays a trail three cells wide behind you
//   - running into someone's trail kills its owner; touching your own (older than a few cells) kills you
//   - getting back onto your land turns the trail into land and claims everything it closed off (enemy land too)
//   - heads that meet: whoever is on their own land survives, two heads out in the open both die
//   - a dead player's land goes blank; a player whose land is all taken is wiped out
// A world is either the authority (solo, the host) or a guest's copy that only predicts its own player.

export const MAX_PLAYERS = 16;
export const TICK = 1 / 60;
/** Cells per second (about four and a half head widths). */
export const SPEED = 46;
/** Fastest turn in radians per second (a U-turn in about 0.6 s, a circle under two heads across). */
export const TURN = 5.4;
/** Head (the little cube) width in cells. The grid is this fine so land edges stay smooth up close. */
export const HEAD = 10;
/** Radius of the land you start with. */
export const START_R = 26;
/** The trail is a disc brush this many cells in radius: a band 7 cells across. */
export const BRUSH = 3;
/** Your own trail laid within the last few cells never kills you (the brush reaches ahead of you). */
export const GRACE = BRUSH * 2 + 2;
/** Heads closer than this collide. */
export const HIT = 7.6;
/** Heads stay this far inside the arena wall. */
export const EDGE = 2.4;
/** Default arena radius in cells. */
export const RADIUS = 360;
const HIST = 32;

export type Kind = 'local' | 'bot' | 'remote' | 'ghost';
export type Cause = 'cut' | 'self' | 'head' | 'wiped' | 'left';

export type Player = {
  id: number;
  name: string;
  /** Palette index (colors live in the renderer). */
  color: number;
  skin: number;
  kind: Kind;
  /** Room seat for humans online, -1 otherwise. */
  seat: number;
  alive: boolean;
  /** Has been in the round at all (an unused slot never spawned). */
  joined: boolean;
  x: number;
  y: number;
  /** Heading in radians, 0 = east, +pi/2 = south (grid y grows down). */
  h: number;
  /** Position and heading one tick ago, for interpolated drawing. */
  px: number;
  py: number;
  ph: number;
  /** Where rule processing has reached (the head moves first, then drive() walks the cells up to it). */
  rx: number;
  ry: number;
  /** Keyboard turn, -1 left, 0, 1 right. */
  turn: number;
  /** Heading to steer toward (mouse, joystick, bots), NaN for none. */
  want: number;
  /** Outside your land with a trail behind you. */
  out: boolean;
  /** Cells walked since spawning: stamps trail age. */
  steps: number;
  cell: number;
  /** Cells currently stamped as this player's trail. */
  trail: Int32Array;
  trailLen: number;
  /** Bounding box of this player's land (only ever grows while alive; a safe superset). */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  kills: number;
  /** Kills since the last capture or spawn, for streak callouts. */
  streak: number;
  bornAt: number;
  diedAt: number;
  cause: Cause | null;
  killer: number;
  /** Best share of the map this life, percent. */
  peak: number;
  /** Best leaderboard place this life (1 is first). */
  bestRank: number;
  /** When a dead player may come back (respawning modes), Infinity for never. */
  respawnAt: number;
  /** Set by the guest session: the player drives itself in fixed samples instead of every tick. */
  manual: boolean;
  /** Anything a controller hangs on the player (bot minds). */
  mind: unknown;
};

export type Ev =
  | { t: 'spawn'; id: number; x: number; y: number }
  | { t: 'out'; id: number }
  | { t: 'capture'; id: number; gained: number; cells: Int32Array; x: number; y: number }
  | { t: 'die'; id: number; by: number; cause: Cause; x: number; y: number }
  | { t: 'win'; id: number };

/** Grid changes the host forwards to guests, in order. */
export type Op =
  | { k: 'spawn'; id: number; cx: number; cy: number; h: number }
  | { k: 'cap'; id: number; runs: number[] }
  | { k: 'die'; id: number; by: number; cause: Cause };

export type World = {
  n: number;
  r: number;
  /** Arena centre in cell coordinates (n / 2). */
  c: number;
  arena: Uint8Array;
  arenaCells: number;
  owner: Uint8Array;
  trail: Uint8Array;
  trailAt: Int32Array;
  /** Cells owned, by id + 1 (index 0 counts nobody's cells inside the arena). */
  counts: Int32Array;
  players: Player[];
  time: number;
  tick: number;
  /** Applies kills, captures of others' land and wipe-outs. Guests keep a copy that only predicts their own player. */
  authority: boolean;
  events: Ev[];
  /** Dirty rectangle of owner/trail changes since the renderer last looked (x1 < x0 when clean). */
  dx0: number;
  dy0: number;
  dx1: number;
  dy1: number;
  /** Recent positions for bot perception: [id][slot][x, y], one sample every 4 ticks. */
  hist: Float32Array;
  histAt: number;
  rng: () => number;
  /** Host hook: grid ops for guests. */
  onOp: ((op: Op) => void) | null;
  // scratch
  seen: Uint32Array;
  gen: number;
  stack: Int32Array;
  runs: Int32Array;
  touched: Uint8Array;
  /** Index offsets of the trail brush (a disc). */
  brush: Int32Array;
};

export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createWorld(opts: { radius?: number; seed?: number; authority?: boolean } = {}): World {
  const r = opts.radius ?? RADIUS;
  const n = 2 * r + 8;
  const c = n / 2;
  const arena = new Uint8Array(n * n);
  let arenaCells = 0;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const dx = x + 0.5 - c;
      const dy = y + 0.5 - c;
      if (dx * dx + dy * dy < r * r) {
        arena[y * n + x] = 1;
        arenaCells++;
      }
    }
  const counts = new Int32Array(MAX_PLAYERS + 1);
  counts[0] = arenaCells;
  return {
    n,
    r,
    c,
    arena,
    arenaCells,
    owner: new Uint8Array(n * n),
    trail: new Uint8Array(n * n),
    trailAt: new Int32Array(n * n),
    counts,
    players: [],
    time: 0,
    tick: 0,
    authority: opts.authority ?? true,
    events: [],
    dx0: n,
    dy0: n,
    dx1: -1,
    dy1: -1,
    hist: new Float32Array(MAX_PLAYERS * HIST * 2),
    histAt: 0,
    rng: mulberry32(opts.seed ?? 1),
    onOp: null,
    seen: new Uint32Array(n * n),
    gen: 0,
    stack: new Int32Array(n * n),
    runs: new Int32Array(4096),
    touched: new Uint8Array(MAX_PLAYERS + 1),
    brush: brushFor(n),
  };
}

/** The trail brush as index offsets, centre first, then outward. */
function brushFor(n: number) {
  const out: [number, number][] = [];
  for (let dy = -BRUSH; dy <= BRUSH; dy++) for (let dx = -BRUSH; dx <= BRUSH; dx++) if (dx * dx + dy * dy <= BRUSH * BRUSH + 0.5) out.push([dx, dy]);
  out.sort((a, b) => a[0] * a[0] + a[1] * a[1] - (b[0] * b[0] + b[1] * b[1]));
  return Int32Array.from(out.map(([dx, dy]) => dy * n + dx));
}

export function addPlayer(w: World, opts: { name: string; color: number; skin?: number; kind: Kind; seat?: number; id?: number }): Player {
  const id = opts.id ?? w.players.length;
  if (id >= MAX_PLAYERS) throw new RangeError('too many players');
  const p: Player = {
    id,
    name: opts.name,
    color: opts.color,
    skin: opts.skin ?? 0,
    kind: opts.kind,
    seat: opts.seat ?? -1,
    alive: false,
    joined: false,
    x: w.c,
    y: w.c,
    h: 0,
    px: w.c,
    py: w.c,
    ph: 0,
    rx: w.c,
    ry: w.c,
    turn: 0,
    want: NaN,
    out: false,
    steps: 0,
    cell: 0,
    trail: new Int32Array(1024),
    trailLen: 0,
    minX: 0,
    minY: 0,
    maxX: -1,
    maxY: -1,
    kills: 0,
    streak: 0,
    bornAt: 0,
    diedAt: -1,
    cause: null,
    killer: -1,
    peak: 0,
    bestRank: 99,
    respawnAt: Infinity,
    manual: false,
    mind: null,
  };
  w.players[id] = p;
  return p;
}

// ---------------------------------------------------------------------------------------------------------------
// Small helpers

export const percent = (w: World, id: number) => (w.counts[id + 1] / w.arenaCells) * 100;

export function wrapAngle(a: number) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a <= -Math.PI) a += Math.PI * 2;
  return a;
}

/** Signed smallest turn from a to b. */
export const angleDiff = (b: number, a: number) => wrapAngle(b - a);

function dirty(w: World, x0: number, y0: number, x1: number, y1: number) {
  if (x0 < w.dx0) w.dx0 = x0;
  if (y0 < w.dy0) w.dy0 = y0;
  if (x1 > w.dx1) w.dx1 = x1;
  if (y1 > w.dy1) w.dy1 = y1;
}

/** Takes (and clears) the dirty rectangle, or null when nothing changed. */
export function takeDirty(w: World): { x0: number; y0: number; x1: number; y1: number } | null {
  if (w.dx1 < w.dx0) return null;
  const rect = { x0: Math.max(0, w.dx0), y0: Math.max(0, w.dy0), x1: Math.min(w.n - 1, w.dx1), y1: Math.min(w.n - 1, w.dy1) };
  w.dx0 = w.n;
  w.dy0 = w.n;
  w.dx1 = -1;
  w.dy1 = -1;
  return rect;
}

function setOwner(w: World, k: number, v: number) {
  const old = w.owner[k];
  if (old === v) return;
  w.counts[old]--;
  w.counts[v]++;
  w.owner[k] = v;
  if (old !== 0) w.touched[old] = 1;
}

function growBox(p: Player, x: number, y: number) {
  if (p.maxX < p.minX) {
    p.minX = p.maxX = x;
    p.minY = p.maxY = y;
    return;
  }
  if (x < p.minX) p.minX = x;
  if (x > p.maxX) p.maxX = x;
  if (y < p.minY) p.minY = y;
  if (y > p.maxY) p.maxY = y;
}

function pushTrail(p: Player, k: number) {
  if (p.trailLen === p.trail.length) {
    const next = new Int32Array(p.trail.length * 2);
    next.set(p.trail);
    p.trail = next;
  }
  p.trail[p.trailLen++] = k;
}

function pushRun(w: World, i: number, a: number, b: number, c: number) {
  if (i + 3 > w.runs.length) {
    const next = new Int32Array(w.runs.length * 2);
    next.set(w.runs);
    w.runs = next;
  }
  w.runs[i] = a;
  w.runs[i + 1] = b;
  w.runs[i + 2] = c;
  return i + 3;
}

// ---------------------------------------------------------------------------------------------------------------
// Spawning

/** Gives a player a fresh round blob of land at cell (cx, cy) and puts the head in the middle. */
export function spawnAt(w: World, p: Player, cx: number, cy: number, h = 0) {
  const { n, owner } = w;
  w.touched.fill(0);
  p.alive = true;
  p.joined = true;
  p.out = false;
  p.steps = 0;
  p.trailLen = 0;
  p.x = p.px = p.rx = cx + 0.5;
  p.y = p.py = p.ry = cy + 0.5;
  p.h = p.ph = h;
  p.want = NaN;
  p.turn = 0;
  p.cell = cy * n + cx;
  p.bornAt = w.time;
  p.diedAt = -1;
  p.cause = null;
  p.killer = -1;
  p.streak = 0;
  p.peak = 0;
  p.bestRank = 99;
  p.respawnAt = Infinity;
  p.minX = p.minY = 0;
  p.maxX = p.maxY = -1;
  const v = p.id + 1;
  const R = START_R;
  for (let y = cy - R; y <= cy + R; y++) {
    if (y < 0 || y >= n) continue;
    for (let x = cx - R; x <= cx + R; x++) {
      if (x < 0 || x >= n) continue;
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > R * R + R * 0.6) continue;
      const k = y * n + x;
      if (!w.arena[k]) continue;
      setOwner(w, k, v);
      growBox(p, x, y);
    }
  }
  if (owner[p.cell] !== v && w.arena[p.cell]) setOwner(w, p.cell, v);
  dirty(w, cx - R, cy - R, cx + R, cy + R);
  for (let s = 0; s < HIST; s++) recordAt(w, p.id, s, p.x, p.y);
  p.peak = percent(w, p.id);
  w.events.push({ t: 'spawn', id: p.id, x: p.x, y: p.y });
  w.onOp?.({ k: 'spawn', id: p.id, cx, cy, h: Math.round(h * 1000) / 1000 });
  if (w.authority) wipeCheck(w, p.id);
}

/**
 * A good place to start: mostly blank ground away from other heads. Returns cell coordinates, or null when the map
 * is too full (bots then wait for room).
 */
export function findSpawn(w: World, rng: () => number = w.rng, minFree = 0.75): { cx: number; cy: number; h: number } | null {
  const { n, owner, c } = w;
  const reach = w.r - START_R - 12;
  let best: { cx: number; cy: number; h: number } | null = null;
  let bestScore = -Infinity;
  for (let tries = 0; tries < 48; tries++) {
    const a = rng() * Math.PI * 2;
    const d = Math.sqrt(rng()) * reach;
    const cx = Math.floor(c + Math.cos(a) * d);
    const cy = Math.floor(c + Math.sin(a) * d);
    let free = 0;
    let total = 0;
    for (let ring = 0; ring <= 2; ring++) {
      const rr = (START_R + 6) * (ring / 2);
      const m = ring === 0 ? 1 : 12;
      for (let i = 0; i < m; i++) {
        const sx = Math.floor(cx + Math.cos((i / m) * Math.PI * 2) * rr);
        const sy = Math.floor(cy + Math.sin((i / m) * Math.PI * 2) * rr);
        total++;
        const k = sy * n + sx;
        if (sx >= 0 && sy >= 0 && sx < n && sy < n && w.arena[k] && owner[k] === 0 && w.trail[k] === 0) free++;
      }
    }
    const share = free / total;
    if (share < minFree) continue;
    let near = 800;
    for (const q of w.players) {
      if (!q || !q.alive) continue;
      near = Math.min(near, Math.hypot(q.x - cx, q.y - cy));
    }
    const score = share * 60 + Math.min(near, 180) / 2;
    if (score > bestScore) {
      bestScore = score;
      best = { cx, cy, h: Math.atan2(c - cy, c - cx) + (rng() - 0.5) * 1.2 };
    }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------------------------
// Movement

/** Turns toward `want` (or by the keyboard) and moves the head one step; the wall of the arena stops it. */
export function advance(w: World, p: Player, dt: number, speed = SPEED) {
  p.px = p.x;
  p.py = p.y;
  p.ph = p.h;
  const maxTurn = TURN * dt;
  if (p.want === p.want) {
    const d = angleDiff(p.want, p.h);
    p.h = wrapAngle(p.h + (d > maxTurn ? maxTurn : d < -maxTurn ? -maxTurn : d));
  } else if (p.turn !== 0) p.h = wrapAngle(p.h + p.turn * maxTurn);
  let nx = p.x + Math.cos(p.h) * speed * dt;
  let ny = p.y + Math.sin(p.h) * speed * dt;
  const ox = nx - w.c;
  const oy = ny - w.c;
  const lim = w.r - EDGE;
  const d2 = ox * ox + oy * oy;
  if (d2 > lim * lim) {
    const s = lim / Math.sqrt(d2);
    nx = w.c + ox * s;
    ny = w.c + oy * s;
  }
  p.x = nx;
  p.y = ny;
}

/**
 * Walks the head from where rules last left off to (x, y), entering each cell on the way in a 4-connected order.
 * Every rule (trails, kills, captures) happens in enter().
 */
export function drive(w: World, p: Player, x: number, y: number) {
  const x0 = p.rx;
  const y0 = p.ry;
  p.rx = x;
  p.ry = y;
  if (!p.alive) return;
  const n = w.n;
  let cx = Math.floor(x0);
  let cy = Math.floor(y0);
  const ex = Math.floor(x);
  const ey = Math.floor(y);
  if (cx === ex && cy === ey) return;
  const dx = x - x0;
  const dy = y - y0;
  const sx = dx > 0 ? 1 : -1;
  const sy = dy > 0 ? 1 : -1;
  const tdx = dx !== 0 ? Math.abs(1 / dx) : Infinity;
  const tdy = dy !== 0 ? Math.abs(1 / dy) : Infinity;
  let tmx = dx > 0 ? (cx + 1 - x0) * tdx : dx < 0 ? (x0 - cx) * tdx : Infinity;
  let tmy = dy > 0 ? (cy + 1 - y0) * tdy : dy < 0 ? (y0 - cy) * tdy : Infinity;
  let guard = 0;
  while ((cx !== ex || cy !== ey) && guard++ < 2048) {
    if (tmx < tmy) {
      cx += sx;
      tmx += tdx;
    } else {
      cy += sy;
      tmy += tdy;
    }
    if (cx < 0 || cy < 0 || cx >= n || cy >= n) break;
    enter(w, p, cy * n + cx, cx, cy);
    if (!p.alive) return;
  }
}

function enter(w: World, p: Player, k: number, x: number, y: number) {
  p.steps++;
  p.cell = k;
  const me = p.id + 1;
  const t = w.trail[k];
  if (t !== 0) {
    if (t !== me) {
      const q = w.players[t - 1];
      if (w.authority && q && q.alive) kill(w, q, p.id, 'cut');
    } else if (w.trailAt[k] < p.steps - GRACE) {
      if (p.kind !== 'ghost') {
        kill(w, p, -1, 'self');
        return;
      }
    }
  }
  if (p.kind === 'ghost') {
    // guests draw other players' trails from where they are seen, nothing else
    if (p.out && w.owner[k] !== me) stamp(w, p, k, x, y);
    return;
  }
  if (w.owner[k] === me) {
    if (p.out) capture(w, p);
  } else {
    if (!p.out) {
      p.out = true;
      w.events.push({ t: 'out', id: p.id });
    }
    stamp(w, p, k, x, y);
  }
}

/** Lays trail with the disc brush around a cell, never over land of your own or another trail. */
function stamp(w: World, p: Player, k: number, x: number, y: number) {
  const me = p.id + 1;
  const { trail, owner, arena, trailAt, brush } = w;
  for (let i = 0; i < brush.length; i++) {
    const kk = k + brush[i];
    if (!arena[kk] || owner[kk] === me || trail[kk] !== 0) continue;
    trail[kk] = me;
    trailAt[kk] = p.steps;
    pushTrail(p, kk);
  }
  dirty(w, x - BRUSH, y - BRUSH, x + BRUSH, y + BRUSH);
}

/** Marks a ghost (a guest's view of someone else) as out or home; its drawn trail follows. */
export function setGhostOut(w: World, p: Player, out: boolean) {
  if (p.out === out) return;
  p.out = out;
  if (!out) clearTrail(w, p);
}

export function clearTrail(w: World, p: Player) {
  const me = p.id + 1;
  const n = w.n;
  for (let i = 0; i < p.trailLen; i++) {
    const k = p.trail[i];
    if (w.trail[k] !== me) continue;
    w.trail[k] = 0;
    const y = (k / n) | 0;
    const x = k - y * n;
    dirty(w, x, y, x, y);
  }
  p.trailLen = 0;
}

// ---------------------------------------------------------------------------------------------------------------
// Capture

/**
 * Back on your land: the trail becomes land, then everything the land now closes off is claimed. A scanline flood
 * fill from the edge of your bounding box finds what is still connected to the outside; the rest is yours.
 */
export function capture(w: World, p: Player) {
  const { n, owner, trail, arena, seen } = w;
  const me = p.id + 1;
  const before = w.counts[me];
  w.touched.fill(0);
  const g1 = ++w.gen;
  // 1. the trail becomes land
  for (let i = 0; i < p.trailLen; i++) {
    const k = p.trail[i];
    if (trail[k] !== me) continue;
    trail[k] = 0;
    setOwner(w, k, me);
    seen[k] = g1;
    const y = (k / n) | 0;
    growBox(p, k - y * n, y);
  }
  const trailCells = p.trail.slice(0, p.trailLen);
  p.trailLen = 0;
  p.out = false;
  p.streak = 0;
  // 2. flood the outside from the box border
  const x0 = Math.max(0, p.minX - 1);
  const y0 = Math.max(0, p.minY - 1);
  const x1 = Math.min(n - 1, p.maxX + 1);
  const y1 = Math.min(n - 1, p.maxY + 1);
  const g2 = ++w.gen;
  fillOutside(w, me, x0, y0, x1, y1, g2);
  // 3. claim the rest, recording changed runs row by row
  let ri = 0;
  for (let y = y0; y <= y1; y++) {
    let start = -1;
    for (let x = x0; x <= x1 + 1; x++) {
      let changed = false;
      if (x <= x1) {
        const k = y * n + x;
        if (seen[k] === g1) changed = true;
        else if (seen[k] !== g2 && owner[k] !== me && arena[k]) {
          setOwner(w, k, me);
          growBox(p, x, y);
          changed = true;
        }
      }
      if (changed && start < 0) start = x;
      else if (!changed && start >= 0) {
        ri = pushRun(w, ri, y, start, x - start);
        start = -1;
      }
    }
  }
  dirty(w, x0, y0, x1, y1);
  const gained = w.counts[me] - before;
  w.events.push({ t: 'capture', id: p.id, gained, cells: trailCells, x: p.x, y: p.y });
  if (w.onOp) w.onOp({ k: 'cap', id: p.id, runs: Array.from(w.runs.subarray(0, ri)) });
  if (w.authority) wipeCheck(w, p.id);
  const pc = percent(w, p.id);
  if (pc > p.peak) p.peak = pc;
  if (w.counts[me] >= w.arenaCells) w.events.push({ t: 'win', id: p.id });
}

function fillOutside(w: World, me: number, x0: number, y0: number, x1: number, y1: number, g: number) {
  const { n, owner, seen, stack } = w;
  let sp = 0;
  const seed = (k: number) => {
    if (seen[k] !== g && owner[k] !== me) stack[sp++] = k;
  };
  for (let x = x0; x <= x1; x++) {
    seed(y0 * n + x);
    seed(y1 * n + x);
  }
  for (let y = y0 + 1; y < y1; y++) {
    seed(y * n + x0);
    seed(y * n + x1);
  }
  while (sp > 0) {
    const k = stack[--sp];
    if (seen[k] === g) continue;
    const y = (k / n) | 0;
    const row = y * n;
    const x = k - row;
    let l = x;
    while (l > x0 && seen[row + l - 1] !== g && owner[row + l - 1] !== me) l--;
    let r = x;
    while (r < x1 && seen[row + r + 1] !== g && owner[row + r + 1] !== me) r++;
    for (let xx = l; xx <= r; xx++) seen[row + xx] = g;
    for (let dy = -1; dy <= 1; dy += 2) {
      const ny = y + dy;
      if (ny < y0 || ny > y1) continue;
      const nrow = ny * n;
      let span = false;
      for (let xx = l; xx <= r; xx++) {
        const kk = nrow + xx;
        const open = seen[kk] !== g && owner[kk] !== me;
        if (open && !span) {
          stack[sp++] = kk;
          span = true;
        } else if (!open) span = false;
      }
    }
  }
}

/** Anyone whose land was just taken down to nothing is out. */
function wipeCheck(w: World, by: number) {
  for (let v = 1; v <= MAX_PLAYERS; v++) {
    if (!w.touched[v]) continue;
    w.touched[v] = 0;
    const q = w.players[v - 1];
    if (q && q.alive && w.counts[v] <= 0) kill(w, q, by, 'wiped');
  }
}

// ---------------------------------------------------------------------------------------------------------------
// Death

/** Kills a player: their trail and all their land vanish. `by` is the killer's id or -1. */
export function kill(w: World, p: Player, by: number, cause: Cause) {
  if (!p.alive) return;
  p.alive = false;
  p.out = false;
  p.diedAt = w.time;
  p.cause = cause;
  p.killer = by;
  clearTrail(w, p);
  clearLand(w, p);
  if (by >= 0 && by !== p.id) {
    const k = w.players[by];
    if (k) {
      k.kills++;
      k.streak++;
    }
  }
  w.events.push({ t: 'die', id: p.id, by, cause, x: p.x, y: p.y });
  w.onOp?.({ k: 'die', id: p.id, by, cause });
}

function clearLand(w: World, p: Player) {
  const { n, owner } = w;
  const me = p.id + 1;
  if (w.counts[me] > 0) {
    // the box is a superset; scan it (or the whole grid if it was never set)
    const x0 = p.maxX < p.minX ? 0 : Math.max(0, p.minX);
    const y0 = p.maxX < p.minX ? 0 : Math.max(0, p.minY);
    const x1 = p.maxX < p.minX ? n - 1 : Math.min(n - 1, p.maxX);
    const y1 = p.maxX < p.minX ? n - 1 : Math.min(n - 1, p.maxY);
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const k = y * n + x;
        if (owner[k] === me) {
          owner[k] = 0;
          w.counts[me]--;
          w.counts[0]++;
        }
      }
    // anything left outside the box (should not happen) goes too
    if (w.counts[me] > 0)
      for (let k = 0; k < n * n; k++)
        if (owner[k] === me) {
          owner[k] = 0;
          w.counts[me]--;
          w.counts[0]++;
        }
    dirty(w, x0, y0, x1, y1);
  }
  p.minX = p.minY = 0;
  p.maxX = p.maxY = -1;
}

/** Heads that meet: whoever is safe on their own land wins; two heads out in the open both die. */
export function headOn(w: World) {
  const ps = w.players;
  for (let i = 0; i < ps.length; i++) {
    const a = ps[i];
    if (!a || !a.alive || a.kind === 'ghost') continue;
    for (let j = i + 1; j < ps.length; j++) {
      const b = ps[j];
      if (!b || !b.alive || b.kind === 'ghost') continue;
      const dx = a.x - b.x;
      const dy = a.y - b.y;
      if (dx * dx + dy * dy > HIT * HIT) continue;
      const aSafe = !a.out;
      const bSafe = !b.out;
      if (aSafe && bSafe) continue;
      if (aSafe) kill(w, b, a.id, 'head');
      else if (bSafe) kill(w, a, b.id, 'head');
      else {
        kill(w, a, b.id, 'head');
        kill(w, b, a.id, 'head');
      }
    }
  }
}

// ---------------------------------------------------------------------------------------------------------------
// The tick

function recordAt(w: World, id: number, slot: number, x: number, y: number) {
  const i = (id * HIST + slot) * 2;
  w.hist[i] = x;
  w.hist[i + 1] = y;
}

/** Where player `id` was about `ago` seconds back (bots see the world a little late). */
export function seenAt(w: World, id: number, ago: number): [number, number] {
  const back = Math.min(HIST - 1, Math.max(0, Math.round(ago * 15)));
  const slot = (w.histAt - back + HIST * 2) % HIST;
  const i = (id * HIST + slot) * 2;
  return [w.hist[i], w.hist[i + 1]];
}

/**
 * One fixed tick for the players this world moves itself (local and bot heads that are not driven manually), then
 * head-on collisions. Remote heads move when their reports arrive (driveTo).
 */
export function step(w: World, speedOf?: (p: Player) => number) {
  w.time += TICK;
  w.tick++;
  const ps = w.players;
  const m = ps.length;
  const first = m ? w.tick % m : 0;
  for (let j = 0; j < m; j++) {
    const p = ps[(first + j) % m];
    if (!p || !p.alive) continue;
    if (p.kind === 'local' || p.kind === 'bot') {
      advance(w, p, TICK, speedOf ? speedOf(p) : SPEED);
      if (!p.manual) drive(w, p, p.x, p.y);
    } else {
      p.px = p.x;
      p.py = p.y;
      p.ph = p.h;
    }
  }
  if (w.authority) headOn(w);
  if (w.tick % 4 === 0) {
    w.histAt = (w.histAt + 1) % HIST;
    for (const p of ps) if (p) recordAt(w, p.id, w.histAt, p.x, p.y);
  }
  for (const p of ps) {
    if (!p || !p.alive) continue;
    const pc = percent(w, p.id);
    if (pc > p.peak) p.peak = pc;
  }
}

/** Moves a remotely driven head (the host's copy of a guest) to a reported spot, applying every rule on the way. */
export function driveTo(w: World, p: Player, x: number, y: number, h: number) {
  if (!p.alive) return;
  p.x = x;
  p.y = y;
  p.h = h;
  drive(w, p, x, y);
}

/** Living players by land, biggest first (ties by id). */
export function ranking(w: World, out: number[] = []): number[] {
  out.length = 0;
  for (const p of w.players) if (p && p.alive) out.push(p.id);
  out.sort((a, b) => w.counts[b + 1] - w.counts[a + 1] || a - b);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------
// Guest side: the host's ops applied to a copy

/** Sets every cell in the runs (row, first x, length triples) to player `id`. */
export function applyRuns(w: World, id: number, runs: ArrayLike<number>) {
  const { n } = w;
  const v = id + 1;
  const p = w.players[id];
  for (let i = 0; i + 2 < runs.length; i += 3) {
    const y = runs[i];
    const x0 = runs[i + 1];
    const len = runs[i + 2];
    if (y < 0 || y >= n || x0 < 0 || len <= 0 || x0 + len > n) continue;
    for (let x = x0; x < x0 + len; x++) {
      const k = y * n + x;
      if (!w.arena[k]) continue;
      setOwner(w, k, v);
      if (w.trail[k] === v) w.trail[k] = 0;
    }
    if (p) {
      growBox(p, x0, y);
      growBox(p, x0 + len - 1, y);
    }
    dirty(w, x0, y, x0 + len - 1, y);
  }
  w.touched.fill(0);
}

/** A guest learns that a player died: same effect as kill() without deciding anything. */
export function applyDeath(w: World, id: number, by: number, cause: Cause) {
  const p = w.players[id];
  if (!p) return;
  if (!p.alive) {
    // still make sure nothing of theirs is left on the board
    clearTrail(w, p);
    clearLand(w, p);
    return;
  }
  kill(w, p, by, cause);
}

/** Replaces the whole owner grid (a full resync) and recounts. */
export function loadOwners(w: World, owners: Uint8Array) {
  w.owner.set(owners.subarray(0, w.owner.length));
  w.counts.fill(0);
  for (let k = 0; k < w.owner.length; k++) {
    if (!w.arena[k]) {
      w.owner[k] = 0;
      continue;
    }
    w.counts[w.owner[k]]++;
  }
  for (const p of w.players) {
    if (!p) continue;
    p.minX = p.minY = 0;
    p.maxX = p.maxY = -1;
  }
  const { n } = w;
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const v = w.owner[y * n + x];
      if (v) {
        const p = w.players[v - 1];
        if (p) growBox(p, x, y);
      }
    }
  dirty(w, 0, 0, n - 1, n - 1);
}

/** FNV-1a over the owner grid: host and guests compare it to notice drift. */
export function ownerHash(w: World) {
  let h = 0x811c9dc5;
  const o = w.owner;
  for (let k = 0; k < o.length; k++) {
    if (o[k] === 0) continue;
    h ^= o[k] + k * 31;
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
