// Pure bubble-shooter logic: hex grid, aim tracing, popping, ceiling drops.
export const COLS = 10;
export const R = 20;
export const FIELD_W = COLS * 2 * R;
export const ROW_H = R * Math.sqrt(3);
export const FIELD_H = 580;
export const SHOOTER = { x: FIELD_W / 2, y: FIELD_H - 50 };
export const DEADLINE_Y = SHOOTER.y - 2.2 * R;
export const SHOT_SPEED = 1100;
export const HIT_DIST = 2 * R * 0.82;
export const MIN_ANGLE = 0.12;
export const PALETTE_SIZE = 6;

export type Pt = { x: number; y: number };
export type CellRef = { r: number; c: number };
export type Effect =
  | { type: 'fire'; color: number }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'stick'; x: number; y: number; color: number }
  | { type: 'pop'; x: number; y: number; color: number; i: number }
  | { type: 'drop'; x: number; y: number; color: number }
  | { type: 'combo'; n: number; points: number; x: number; y: number }
  | { type: 'ceiling' }
  | { type: 'level'; level: number; bonus: number }
  | { type: 'swap' }
  | { type: 'over' };
export type Shot = { points: Pt[]; seg: number; along: number; pos: Pt; color: number; target: CellRef };
export type Game = {
  grid: number[][];
  ceiling: number;
  level: number;
  colors: number;
  score: number;
  combo: number;
  bestCombo: number;
  current: number;
  next: number;
  dropEvery: number;
  shotsUntilDrop: number;
  dropInterval: number;
  dropTimer: number;
  shots: number;
  shot: Shot | null;
  levelBanner: number;
  ended: boolean;
  time: number;
  effects: Effect[];
  rng: () => number;
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rowLength(r: number): number {
  return r % 2 === 0 ? COLS : COLS - 1;
}

export function cellCenter(game: Game, r: number, c: number): Pt {
  return { x: R + 2 * R * c + (r % 2 === 1 ? R : 0), y: game.ceiling + R + r * ROW_H };
}

export function inBounds(r: number, c: number): boolean {
  return r >= 0 && c >= 0 && c < rowLength(r);
}

export function neighbors(r: number, c: number): CellRef[] {
  const odd = r % 2 === 1;
  const refs: CellRef[] = [
    { r, c: c - 1 },
    { r, c: c + 1 },
    { r: r - 1, c: odd ? c : c - 1 },
    { r: r - 1, c: odd ? c + 1 : c },
    { r: r + 1, c: odd ? c : c - 1 },
    { r: r + 1, c: odd ? c + 1 : c },
  ];
  return refs.filter((p) => inBounds(p.r, p.c));
}

export function getCell(game: Game, r: number, c: number): number {
  if (r < 0 || r >= game.grid.length || c < 0 || c >= game.grid[r].length) return -1;
  return game.grid[r][c];
}

export function clampAim(angle: number): number {
  return Math.min(Math.max(angle, MIN_ANGLE), Math.PI - MIN_ANGLE);
}

export function aimAt(from: Pt, to: Pt): number {
  const raw = Math.atan2(-(to.y - from.y), to.x - from.x);
  if (raw <= -Math.PI / 2) return Math.PI - MIN_ANGLE;
  if (raw < 0) return MIN_ANGLE;
  return clampAim(raw);
}

export function levelConfig(level: number): { rows: number; colors: number; dropEvery: number; dropInterval: number } {
  return {
    rows: Math.min(4 + level, 9),
    colors: Math.min(3 + Math.ceil(level / 2), 6),
    dropEvery: Math.max(4, 9 - level),
    dropInterval: Math.max(14, 34 - 2 * level),
  };
}

export function boardColors(game: Game): number[] {
  const set = new Set<number>();
  for (const row of game.grid) for (const v of row) if (v >= 0) set.add(v);
  return [...set].sort((a, b) => a - b);
}

export function lowestBubbleBottom(game: Game): number {
  let low = -Infinity;
  for (let r = 0; r < game.grid.length; r++)
    for (let c = 0; c < game.grid[r].length; c++)
      if (game.grid[r][c] >= 0) low = Math.max(low, cellCenter(game, r, c).y + R);
  return low;
}

function pickColor(game: Game): number {
  const on = boardColors(game);
  const n = on.length > 0 ? on.length : game.colors;
  return on.length > 0 ? on[Math.floor(game.rng() * on.length)] : Math.floor(game.rng() * n);
}

function trimGrid(game: Game): void {
  while (game.grid.length > 0 && game.grid[game.grid.length - 1].every((v) => v < 0)) game.grid.pop();
}

function startLevel(game: Game, level: number): void {
  const cfg = levelConfig(level);
  game.level = level;
  game.colors = cfg.colors;
  game.ceiling = 0;
  game.grid = [];
  for (let r = 0; r < cfg.rows; r++) {
    const row = new Array<number>(rowLength(r));
    for (let c = 0; c < row.length; c++) {
      let color = -1;
      if (game.rng() < 0.45) {
        if (c > 0) color = row[c - 1];
        else {
          const ups = neighbors(r, c).filter((p) => p.r === r - 1 && getCell(game, p.r, p.c) >= 0);
          if (ups.length > 0) {
            const pick = ups[Math.floor(game.rng() * ups.length)];
            color = getCell(game, pick.r, pick.c);
          }
        }
      }
      if (color < 0) color = Math.floor(game.rng() * game.colors);
      row[c] = color;
    }
    game.grid.push(row);
  }
  game.current = pickColor(game);
  game.next = pickColor(game);
  game.dropEvery = cfg.dropEvery;
  game.shotsUntilDrop = cfg.dropEvery;
  game.dropInterval = cfg.dropInterval;
  game.dropTimer = cfg.dropInterval;
}

export function createGame(opts?: { seed?: number; level?: number; rng?: () => number }): Game {
  const rng = opts?.rng ?? mulberry32(opts?.seed ?? ((Math.random() * 2 ** 32) >>> 0));
  const game: Game = {
    grid: [],
    ceiling: 0,
    level: opts?.level ?? 1,
    colors: 0,
    score: 0,
    combo: 0,
    bestCombo: 0,
    current: 0,
    next: 0,
    dropEvery: 0,
    shotsUntilDrop: 0,
    dropInterval: 0,
    dropTimer: 0,
    shots: 0,
    shot: null,
    levelBanner: 0,
    ended: false,
    time: 0,
    effects: [],
    rng,
  };
  startLevel(game, game.level);
  return game;
}

const WALL_LO = R;
const WALL_HI = FIELD_W - R;
const EPS = 1e-7;

export function traceAim(game: Game, angle: number): { points: Pt[]; cell: CellRef | null } {
  const a = clampAim(angle);
  const dir = { x: Math.cos(a), y: -Math.sin(a) };
  const pos = { ...SHOOTER };
  const points: Pt[] = [{ ...pos }];
  let bounces = 0;
  let hit: Pt | null = null;
  while (hit === null && bounces <= 30) {
    // earliest wall hit
    const tWall = dir.x > 0 ? (WALL_HI - pos.x) / dir.x : dir.x < 0 ? (pos.x - WALL_LO) / -dir.x : Infinity;
    // ceiling line (centers stop at ceiling + R)
    const tCeil = dir.y < 0 ? (pos.y - (game.ceiling + R)) / -dir.y : Infinity;
    // earliest circle contact with an occupied cell
    let tHit = Infinity;
    for (let r = 0; r < game.grid.length; r++) {
      for (let c = 0; c < game.grid[r].length; c++) {
        if (game.grid[r][c] < 0) continue;
        const cc = cellCenter(game, r, c);
        const ox = pos.x - cc.x;
        const oy = pos.y - cc.y;
        const b = dir.x * ox + dir.y * oy;
        const disc = b * b - (ox * ox + oy * oy - HIT_DIST * HIT_DIST);
        if (disc <= 0) continue;
        const t = -b - Math.sqrt(disc);
        if (t > EPS && t < tHit) tHit = t;
      }
    }
    const t = Math.min(tWall, tCeil, tHit);
    if (t === tWall && tWall < tCeil && tWall < tHit) {
      pos.x += dir.x * tWall;
      pos.y += dir.y * tWall;
      points.push({ ...pos });
      dir.x = -dir.x;
      bounces++;
    } else {
      pos.x += dir.x * t;
      pos.y += dir.y * t;
      hit = { ...pos };
    }
  }
  if (hit === null) hit = { ...pos };
  // pick nearest legal empty cell to the contact point
  let best: CellRef | null = null;
  let bestD = Infinity;
  for (let r = 0; r <= game.grid.length; r++) {
    for (let c = 0; c < rowLength(r); c++) {
      if (getCell(game, r, c) >= 0) continue;
      if (r !== 0 && !neighbors(r, c).some((p) => getCell(game, p.r, p.c) >= 0)) continue;
      const cc = cellCenter(game, r, c);
      const d = (cc.x - hit.x) ** 2 + (cc.y - hit.y) ** 2;
      if (d < bestD) {
        bestD = d;
        best = { r, c };
      }
    }
  }
  if (best !== null) {
    const cc = cellCenter(game, best.r, best.c);
    points.push(cc);
  } else {
    points.push(hit);
  }
  return { points, cell: best };
}

export function fire(game: Game, angle: number): boolean {
  if (game.ended || game.levelBanner > 0 || game.shot !== null) return false;
  const { points, cell } = traceAim(game, angle);
  if (cell === null) return false;
  const color = game.current;
  game.shot = { points, seg: 0, along: 0, pos: { ...SHOOTER }, color, target: cell };
  game.current = game.next;
  game.next = pickColor(game);
  game.shots++;
  game.effects.push({ type: 'fire', color });
  return true;
}

export function swap(game: Game): boolean {
  if (game.ended || game.levelBanner > 0) return false;
  const t = game.current;
  game.current = game.next;
  game.next = t;
  game.effects.push({ type: 'swap' });
  return true;
}

export function findMatches(game: Game, r: number, c: number): CellRef[] {
  const color = getCell(game, r, c);
  if (color < 0) return [];
  const seen = new Set<string>([`${r},${c}`]);
  const out: CellRef[] = [{ r, c }];
  const queue: CellRef[] = [{ r, c }];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const nb of neighbors(cur.r, cur.c)) {
      const key = `${nb.r},${nb.c}`;
      if (seen.has(key) || getCell(game, nb.r, nb.c) !== color) continue;
      seen.add(key);
      out.push(nb);
      queue.push(nb);
    }
  }
  return out;
}

export function findFloating(game: Game): CellRef[] {
  const anchored = new Set<string>();
  const queue: CellRef[] = [];
  if (game.grid.length > 0)
    for (let c = 0; c < game.grid[0].length; c++)
      if (game.grid[0][c] >= 0) {
        anchored.add(`0,${c}`);
        queue.push({ r: 0, c });
      }
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const nb of neighbors(cur.r, cur.c)) {
      const key = `${nb.r},${nb.c}`;
      if (anchored.has(key) || getCell(game, nb.r, nb.c) < 0) continue;
      anchored.add(key);
      queue.push(nb);
    }
  }
  const out: CellRef[] = [];
  for (let r = 0; r < game.grid.length; r++)
    for (let c = 0; c < game.grid[r].length; c++)
      if (game.grid[r][c] >= 0 && !anchored.has(`${r},${c}`)) out.push({ r, c });
  return out;
}

function settle(game: Game): void {
  const shot = game.shot!;
  const { r, c } = shot.target;
  while (game.grid.length <= r) game.grid.push(new Array<number>(rowLength(game.grid.length)).fill(-1));
  game.grid[r][c] = shot.color;
  const placed = cellCenter(game, r, c);
  game.shot = null;
  game.effects.push({ type: 'stick', x: placed.x, y: placed.y, color: shot.color });
  const group = findMatches(game, r, c);
  if (group.length >= 3) {
    const sorted = [...group].sort((u, v) => {
      const a = cellCenter(game, u.r, u.c);
      const b = cellCenter(game, v.r, v.c);
      return (a.x - placed.x) ** 2 + (a.y - placed.y) ** 2 - ((b.x - placed.x) ** 2 + (b.y - placed.y) ** 2);
    });
    sorted.forEach((cell, i) => {
      const cc = cellCenter(game, cell.r, cell.c);
      const col = game.grid[cell.r][cell.c];
      game.grid[cell.r][cell.c] = -1;
      game.effects.push({ type: 'pop', x: cc.x, y: cc.y, color: col, i });
    });
    const floating = findFloating(game);
    for (const cell of floating) {
      const cc = cellCenter(game, cell.r, cell.c);
      const col = game.grid[cell.r][cell.c];
      game.grid[cell.r][cell.c] = -1;
      game.effects.push({ type: 'drop', x: cc.x, y: cc.y, color: col });
    }
    game.combo += 1;
    game.bestCombo = Math.max(game.bestCombo, game.combo);
    const n = sorted.length;
    const d = floating.length;
    const points = (10 * n + 25 * d * Math.ceil(d / 4)) * game.combo;
    game.score += points;
    game.effects.push({ type: 'combo', n: game.combo, points, x: placed.x, y: placed.y });
  } else {
    game.combo = 0;
    game.shotsUntilDrop -= 1;
    if (game.shotsUntilDrop <= 0) lowerCeiling(game);
  }
  trimGrid(game);
  if (game.grid.length === 0) {
    const bonus = 500 * game.level;
    game.score += bonus;
    game.effects.push({ type: 'level', level: game.level, bonus });
    game.levelBanner = 1.6;
    return;
  }
  const on = boardColors(game);
  if (!on.includes(game.current)) game.current = pickColor(game);
  if (!on.includes(game.next)) game.next = pickColor(game);
  if (lowestBubbleBottom(game) > DEADLINE_Y) {
    game.ended = true;
    game.effects.push({ type: 'over' });
  }
}

function lowerCeiling(game: Game): void {
  game.ceiling += ROW_H;
  game.shotsUntilDrop = game.dropEvery;
  game.dropTimer = game.dropInterval;
  game.effects.push({ type: 'ceiling' });
  if (lowestBubbleBottom(game) > DEADLINE_Y) {
    game.ended = true;
    game.effects.push({ type: 'over' });
  }
}

export function step(game: Game, dt: number): void {
  if (game.ended) return;
  game.time += dt;
  if (game.levelBanner > 0) {
    game.levelBanner -= dt;
    if (game.levelBanner <= 0) {
      game.levelBanner = 0;
      startLevel(game, game.level + 1);
    }
    return;
  }
  const shot = game.shot;
  if (shot !== null) {
    let rem = SHOT_SPEED * dt;
    while (rem > 0 && game.shot !== null) {
      const a = shot.points[shot.seg];
      const b = shot.points[shot.seg + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const left = segLen - shot.along;
      if (rem < left) {
        shot.along += rem;
        const t = shot.along / segLen;
        shot.pos = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        rem = 0;
      } else {
        rem -= left;
        shot.pos = { ...b };
        shot.seg += 1;
        shot.along = 0;
        if (shot.seg >= shot.points.length - 1) {
          settle(game);
        } else {
          game.effects.push({ type: 'bounce', x: b.x, y: b.y });
        }
      }
    }
  } else {
    game.dropTimer -= dt;
    if (game.dropTimer <= 0) lowerCeiling(game);
  }
}
