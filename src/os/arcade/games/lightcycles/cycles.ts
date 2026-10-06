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

/**
 * Pick a direction for a computer rider. Scores each of the three legal headings by
 * reachable area (so it never boxes itself in when a way out exists), straight run length,
 * and a little pressure toward the nearest opponent on harder levels. Easy riders turn at random
 * now and then and only look a short distance ahead.
 */
export function think(a: Arena, r: Rider, level: Level, rng: Rng = Math.random): Dir {
  const options: Dir[] = ([r.dir, ((r.dir + 1) % 4) as Dir, ((r.dir + 3) % 4) as Dir] as Dir[]).filter((d) => free(a, r.x + DX[d], r.y + DY[d]));
  if (options.length === 0) return r.dir;
  const areaLimit = level === 0 ? 40 : level === 1 ? 220 : 900;
  const foe = a.riders.filter((o) => o.alive && o.id !== r.id).sort((p, q) => Math.hypot(p.x - r.x, p.y - r.y) - Math.hypot(q.x - r.x, q.y - r.y))[0];
  let best = options[0];
  let bestScore = -Infinity;
  for (const d of options) {
    const nx = r.x + DX[d];
    const ny = r.y + DY[d];
    let s = reachable(a, nx, ny, areaLimit) * 3;
    s += Math.min(lookahead(a, nx, ny, d, 12), 12) * (level === 0 ? 0.5 : 1.5);
    if (d === r.dir) s += level === 0 ? 2 : 4; // keep lines clean
    if (foe && level >= 1) {
      const dist = Math.abs(foe.x - nx) + Math.abs(foe.y - ny);
      s -= dist * (level === 2 ? 0.35 : 0.15);
      // Avoid stepping into a cell the foe could also take this tick.
      if (Math.abs(foe.x + DX[foe.dir] - nx) + Math.abs(foe.y + DY[foe.dir] - ny) === 0) s -= 500;
    }
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

/** Direction from a swipe vector, or null when it is too short to count. */
export function swipeDir(dx: number, dy: number, min = 18): Dir | null {
  if (Math.hypot(dx, dy) < min) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 1 : 3;
  return dy > 0 ? 2 : 0;
}
