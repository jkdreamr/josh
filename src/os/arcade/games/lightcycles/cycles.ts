// Light cycle duel rules and computer riders. Pure module, no DOM.

export type Dir = 0 | 1 | 2 | 3; // up, right, down, left
export const DX = [0, 1, 0, -1];
export const DY = [-1, 0, 1, 0];
export const opposite = (d: Dir): Dir => ((d + 2) % 4) as Dir;

export type Rider = {
  id: number;
  x: number;
  y: number;
  dir: Dir;
  next: Dir;
  alive: boolean;
  trail: number[]; // cell indices, oldest first
  cpu: boolean;
};

export type Arena = {
  w: number;
  h: number;
  /** 0 = free, otherwise rider id + 1 */
  cells: Uint8Array;
  riders: Rider[];
  tick: number;
};

export type Crash = { id: number; x: number; y: number };
export type Rng = () => number;

export const cell = (a: Arena, x: number, y: number) => y * a.w + x;
export const free = (a: Arena, x: number, y: number) => x >= 0 && y >= 0 && x < a.w && y < a.h && a.cells[y * a.w + x] === 0;

/** Riders start spread along the middle, facing the centre, evenly spaced. */
export function createArena(w: number, h: number, count: number, cpuFrom: number): Arena {
  const a: Arena = { w, h, cells: new Uint8Array(w * h), riders: [], tick: 0 };
  const spots: [number, number, Dir][] = [
    [Math.floor(w * 0.2), Math.floor(h / 2), 1],
    [Math.floor(w * 0.8), Math.floor(h / 2), 3],
    [Math.floor(w / 2), Math.floor(h * 0.2), 2],
    [Math.floor(w / 2), Math.floor(h * 0.8), 0],
  ];
  for (let i = 0; i < count; i++) {
    const [x, y, dir] = spots[i];
    a.riders.push({ id: i, x, y, dir, next: dir, alive: true, trail: [cell(a, x, y)], cpu: i >= cpuFrom });
    a.cells[cell(a, x, y)] = i + 1;
  }
  return a;
}

/** Online riders: one per seat in the room, people and bots alike, in seat order. Rider ids index this list. */
export function riderSeats(people: readonly number[], bots: readonly number[], max = 4): number[] {
  return [...new Set([...people, ...bots])].sort((a, b) => a - b).slice(0, max);
}

/**
 * Online: the seats riding this match whose player has just left the room. Only people seen in the room count (bots
 * never leave), each seat once, and never your own or the host's (seat 0): the host leaving ends the round.
 */
export function departedSeats(seats: readonly number[], self: number, known: ReadonlyMap<number, string>, announced: ReadonlySet<number>, people: readonly number[], bots: readonly number[]): number[] {
  return seats.filter((seat) => seat !== 0 && seat !== self && known.has(seat) && !announced.has(seat) && !people.includes(seat) && !bots.includes(seat));
}

/** Queue a turn. Reversing into your own trail is ignored. */
export function steer(r: Rider, d: Dir) {
  if (!r.alive || d === opposite(r.dir)) return;
  r.next = d;
}

/** Advance every living rider one cell. Head-on collisions kill both. Returns the crashes. */
export function step(a: Arena): Crash[] {
  const crashes: Crash[] = [];
  const moves = new Map<number, Rider[]>();
  for (const r of a.riders) {
    if (!r.alive) continue;
    r.dir = r.next;
    const nx = r.x + DX[r.dir];
    const ny = r.y + DY[r.dir];
    if (!free(a, nx, ny)) {
      r.alive = false;
      crashes.push({ id: r.id, x: nx, y: ny });
      continue;
    }
    const key = cell(a, nx, ny);
    const list = moves.get(key);
    if (list) list.push(r);
    else moves.set(key, [r]);
  }
  for (const [key, list] of moves) {
    const x = key % a.w;
    const y = Math.floor(key / a.w);
    if (list.length > 1) {
      for (const r of list) {
        r.alive = false;
        crashes.push({ id: r.id, x, y });
      }
      continue;
    }
    const r = list[0];
    r.x = x;
    r.y = y;
    r.trail.push(key);
    a.cells[key] = r.id + 1;
  }
  a.tick++;
  return crashes;
}

export const alive = (a: Arena) => a.riders.filter((r) => r.alive);

/** Round is over when at most one rider survives (or none, when the last two collide). */
export function roundOver(a: Arena) {
  return alive(a).length <= 1;
}

/** How many cells a flood fill can reach from (x, y) before hitting `limit`. Measures breathing room. */
export function reachable(a: Arena, x: number, y: number, limit: number): number {
  if (!free(a, x, y)) return 0;
  const seen = new Uint8Array(a.w * a.h);
  const stack = [cell(a, x, y)];
  seen[stack[0]] = 1;
  let n = 0;
  while (stack.length && n < limit) {
    const c = stack.pop()!;
    n++;
    const cx = c % a.w;
    const cy = Math.floor(c / a.w);
    for (let d = 0; d < 4; d++) {
      const nx = cx + DX[d];
      const ny = cy + DY[d];
      if (!free(a, nx, ny)) continue;
      const k = ny * a.w + nx;
      if (seen[k]) continue;
      seen[k] = 1;
      stack.push(k);
    }
  }
  return n;
}

/** Straight-line distance until the first wall or trail in direction d. */
export function lookahead(a: Arena, x: number, y: number, d: Dir, max = 64): number {
  let n = 0;
  while (n < max && free(a, x + DX[d] * (n + 1), y + DY[d] * (n + 1))) n++;
  return n;
}

export type Level = 0 | 1 | 2;

let distA = new Int16Array(0);
let distB = new Int16Array(0);
let bfsQueue = new Int32Array(0);

/** Breadth-first distances from the given start cells over free cells (starts count as free). -1 is unreachable. */
function distances(a: Arena, starts: readonly number[], out: Int16Array): Int16Array {
  const n = a.w * a.h;
  out.fill(-1, 0, n);
  if (bfsQueue.length < n) bfsQueue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  for (const s of starts) {
    if (out[s] !== -1) continue;
    out[s] = 0;
    bfsQueue[tail++] = s;
  }
  while (head < tail) {
    const c = bfsQueue[head++];
    const cx = c % a.w;
    const cy = (c - cx) / a.w;
    const nd = out[c] + 1;
    if (cx > 0 && a.cells[c - 1] === 0 && out[c - 1] === -1) (out[c - 1] = nd), (bfsQueue[tail++] = c - 1);
    if (cx < a.w - 1 && a.cells[c + 1] === 0 && out[c + 1] === -1) (out[c + 1] = nd), (bfsQueue[tail++] = c + 1);
    if (cy > 0 && a.cells[c - a.w] === 0 && out[c - a.w] === -1) (out[c - a.w] = nd), (bfsQueue[tail++] = c - a.w);
    if (cy < a.h - 1 && a.cells[c + a.w] === 0 && out[c + a.w] === -1) (out[c + a.w] = nd), (bfsQueue[tail++] = c + a.w);
  }
  return out;
}

/** Cells reached from `start` (excluding it) in a distance map, so 0 means boxed in. */
function roomIn(dist: Int16Array, n: number) {
  let k = 0;
  for (let i = 0; i < n; i++) if (dist[i] > 0) k++;
  return k;
}

/**
 * How good it is for rider `r` to be at cell `at` while the riders in `foes` are at their cells, all having just moved.
 * Scores the cells `r` reaches before any foe (a Voronoi split), and once nobody can reach anybody, the room left.
 */
function standing(a: Arena, r: Rider, at: number, foes: readonly number[]) {
  const n = a.w * a.h;
  if (distA.length < n) (distA = new Int16Array(n)), (distB = new Int16Array(n));
  const me = distances(a, [at], distA);
  const myRoom = roomIn(me, n);
  if (!foes.length) return { shared: false, value: myRoom, myRoom };
  const them = distances(a, foes, distB);
  let mine = 0;
  let theirs = 0;
  let shared = false;
  for (let i = 0; i < n; i++) {
    const d = me[i];
    const f = them[i];
    if (d <= 0) {
      if (f > 0) theirs++;
      continue;
    }
    if (f <= 0) mine++;
    else {
      shared = true;
      if (d < f) mine++;
      else if (d > f) theirs++;
    }
  }
  return { shared, value: mine - theirs, myRoom };
}

/** Exported for tests: the Voronoi split after this rider steps to (x, y) and the others stay put. */
export function territory(a: Arena, r: Rider, x: number, y: number) {
  const at = cell(a, x, y);
  const foes = a.riders.filter((o) => o.alive && o.id !== r.id).map((o) => cell(a, o.x, o.y));
  const was = a.cells[at];
  a.cells[at] = r.id + 1;
  const s = standing(a, r, at, foes);
  a.cells[at] = was;
  return s;
}

/** Walls (or trails) touching a cell, out of 4. Hugging them packs a sealed-off region tightly. */
function snug(a: Arena, x: number, y: number) {
  let n = 0;
  for (let d = 0; d < 4; d++) if (!free(a, x + DX[d], y + DY[d])) n++;
  return n;
}

/** True when a living foe could move into (x, y) this same tick. */
function contested(a: Arena, r: Rider, x: number, y: number) {
  return a.riders.some((o) => o.alive && o.id !== r.id && Math.abs(o.x - x) + Math.abs(o.y - y) === 1 && !(o.x + DX[opposite(o.dir)] === x && o.y + DY[opposite(o.dir)] === y));
}

/**
 * Pick a direction for a computer rider.
 * Easy looks a short way ahead, turns at random now and then and sometimes misses a closing gap.
 * Normal keeps to the roomier side with a flood fill and drifts toward the nearest rider.
 * Hard plays for territory: it heads for the cells it can reach before anyone else, cuts riders off,
 * and once it is sealed in alone it hugs the walls to fill its space.
 */
export function think(a: Arena, r: Rider, level: Level, rng: Rng = Math.random): Dir {
  const options: Dir[] = ([r.dir, ((r.dir + 1) % 4) as Dir, ((r.dir + 3) % 4) as Dir] as Dir[]).filter((d) => free(a, r.x + DX[d], r.y + DY[d]));
  if (options.length === 0) return r.dir;
  if (options.length === 1) return options[0];
  if (level === 2) return thinkHard(a, r, options, rng);
  const areaLimit = level === 0 ? 40 : 260;
  const foe = a.riders.filter((o) => o.alive && o.id !== r.id).sort((p, q) => Math.hypot(p.x - r.x, p.y - r.y) - Math.hypot(q.x - r.x, q.y - r.y))[0];
  let best = options[0];
  let bestScore = -Infinity;
  for (const d of options) {
    const nx = r.x + DX[d];
    const ny = r.y + DY[d];
    let s = reachable(a, nx, ny, areaLimit) * 3;
    s += Math.min(lookahead(a, nx, ny, d, 12), 12) * (level === 0 ? 0.5 : 1.5);
    if (d === r.dir) s += level === 0 ? 2 : 4; // keep lines clean
    if (foe && level === 1) {
      const dist = Math.abs(foe.x - nx) + Math.abs(foe.y - ny);
      s -= dist * 0.15;
    }
    if (level === 1 && contested(a, r, nx, ny)) s -= 500;
    s += rng() * (level === 0 ? 6 : 1.5);
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  if (level === 0 && rng() < 0.06) {
    const safe = options.filter((d) => d !== best);
    if (safe.length) return safe[Math.floor(rng() * safe.length)];
  }
  return best;
}

/** Moves a rider could make next, as cells (dead ends included as -1 when it has none). */
function nextCells(a: Arena, o: Rider): number[] {
  const out: number[] = [];
  for (const d of [o.dir, (o.dir + 1) % 4, (o.dir + 3) % 4]) {
    const x = o.x + DX[d];
    const y = o.y + DY[d];
    if (free(a, x, y)) out.push(cell(a, x, y));
  }
  return out;
}

/** Best room a rider can keep two moves from now, so it never steps into a pocket that a single move would seal. */
function room2(a: Arena, x: number, y: number, dir: Dir, id: number) {
  const at = cell(a, x, y);
  a.cells[at] = id + 1;
  let best = 0;
  for (const d of [dir, (dir + 1) % 4, (dir + 3) % 4] as Dir[]) {
    const nx = x + DX[d];
    const ny = y + DY[d];
    if (!free(a, nx, ny)) continue;
    best = Math.max(best, 1 + reachable(a, nx, ny, a.w * a.h));
  }
  a.cells[at] = 0;
  return best;
}

const DEAD = -100000;

function thinkHard(a: Arena, r: Rider, options: Dir[], rng: Rng): Dir {
  const others = a.riders.filter((o) => o.alive && o.id !== r.id);
  // The nearest rider gets to answer each move (simultaneous moves, worst case for us); the rest hold still.
  const near = others.slice().sort((p, q) => Math.abs(p.x - r.x) + Math.abs(p.y - r.y) - (Math.abs(q.x - r.x) + Math.abs(q.y - r.y)))[0];
  const rest = others.filter((o) => o !== near).map((o) => cell(a, o.x, o.y));
  const close = near && Math.abs(near.x - r.x) + Math.abs(near.y - r.y) <= 12;
  // Alone already? Then it is all about filling the pocket.
  const alone = !others.length || !territory(a, r, r.x, r.y).shared;
  let best = options[0];
  let bestScore = -Infinity;
  for (const d of options) {
    const nx = r.x + DX[d];
    const ny = r.y + DY[d];
    const at = cell(a, nx, ny);
    let s: number;
    if (alone) {
      s = room2(a, nx, ny, d, r.id) * 10 + snug(a, nx, ny) * 3;
    } else {
      const replies = near && close ? nextCells(a, near) : [];
      a.cells[at] = r.id + 1;
      let worst = Infinity;
      if (!replies.length) {
        const st = standing(a, r, at, near ? [cell(a, near.x, near.y), ...rest] : rest);
        worst = st.myRoom === 0 ? DEAD : st.shared ? st.value * 4 + Math.min(st.myRoom, 40) : (st.value > 0 ? 3000 : -3000) + st.value * 10;
        if (near && !close && st.myRoom > 0 && contested(a, r, nx, ny)) worst -= 2000;
      } else {
        for (const reply of replies) {
          let v: number;
          if (reply === at) v = DEAD / 2; // head on, both go down
          else {
            a.cells[reply] = near.id + 1;
            const st = standing(a, r, at, [reply, ...rest]);
            a.cells[reply] = 0;
            if (st.myRoom === 0) v = DEAD;
            else if (st.shared) v = st.value * 4 + Math.min(st.myRoom, 40);
            else v = (st.value > 0 ? 3000 : -3000) + st.value * 10;
          }
          worst = Math.min(worst, v);
        }
      }
      a.cells[at] = 0;
      // Never trade room to live for territory.
      const room = room2(a, nx, ny, d, r.id);
      if (room < 8) worst -= (8 - room) * 400;
      s = worst;
    }
    if (d === r.dir) s += 1.5;
    s += rng() * 0.5;
    if (s > bestScore) {
      bestScore = s;
      best = d;
    }
  }
  return best;
}

/** Direction from a swipe vector, or null when it is too short to count. */
export function swipeDir(dx: number, dy: number, min = 18): Dir | null {
  if (Math.hypot(dx, dy) < min) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}

/**
 * Grid for an arena box of w x h CSS px: square cells, about `cells` of them whatever the shape,
 * so a wide strip gets a long thin arena instead of a small square in the middle.
 */
export function fitGrid(w: number, h: number, cells = 1150) {
  const aspect = Math.max(0.2, Math.min(6, w / Math.max(1, h)));
  let cols = Math.round(Math.sqrt(cells * aspect));
  cols = Math.max(14, Math.min(84, cols));
  let rows = Math.round(cols / aspect);
  rows = Math.max(10, Math.min(72, rows));
  return { cols, rows };
}

/**
 * A tap or click turns the rider toward it: riding sideways, a tap above or below; riding up or down, a tap left or right.
 * (dx, dy) is the tap minus the rider's head, in px. Taps almost in line with the heading do nothing.
 */
export function tapDir(dir: Dir, dx: number, dy: number, dead = 6): Dir | null {
  if (dir === 1 || dir === 3) return Math.abs(dy) < dead ? null : dy < 0 ? 0 : 2;
  return Math.abs(dx) < dead ? null : dx < 0 ? 3 : 1;
}

/** 1 / the scale of a phone or iPad frame (rounded up so 11px text never lands at 10.99), or 1 when unscaled. */
export function frameUnit(screenWidth: number, layoutWidth: number) {
  if (!(screenWidth > 0) || !(layoutWidth > 0)) return 1;
  const k = screenWidth / layoutWidth;
  return k > 0.2 && k < 0.99 ? Math.min(2, Math.ceil(100 / k) / 100) : 1;
}
