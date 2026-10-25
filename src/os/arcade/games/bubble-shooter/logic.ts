// Pure bubble-shooter logic: hex grid, aim tracing, popping, special bubbles, ceiling pressure.
import { LEVELS, type LevelDef } from './levels.ts';

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
export const PALETTE_SIZE = 8;

/** Cell values: -1 empty, 0..7 colors, ICE + color frozen, then the specials. */
export const EMPTY = -1;
export const ICE = 10;
export const STONE = 30;
export const BOMB = 31;
/** Only ever in the launcher: takes the color that pops the most where it lands. */
export const RAINBOW = 32;
export const BLAST_R = 2 * R * 1.05;

export const isColor = (v: number) => v >= 0 && v < PALETTE_SIZE;
export const isIce = (v: number) => v >= ICE && v < ICE + PALETTE_SIZE;
/** The color a cell matches as, or -1 for empty, stone and bomb. */
export const hue = (v: number) => (isColor(v) ? v : isIce(v) ? v - ICE : -1);

export type Mode = 'levels' | 'endless';
export type Outcome = 'clear' | 'line' | 'shots';
export type Pt = { x: number; y: number };
export type CellRef = { r: number; c: number };
export type Effect =
  | { type: 'fire'; color: number }
  | { type: 'bounce'; x: number; y: number }
  | { type: 'stick'; x: number; y: number; color: number }
  | { type: 'pop'; x: number; y: number; color: number; i: number }
  | { type: 'drop'; x: number; y: number; color: number }
  | { type: 'combo'; n: number; points: number; x: number; y: number }
  | { type: 'blast'; x: number; y: number }
  | { type: 'thaw'; x: number; y: number; color: number }
  | { type: 'rainbow' }
  | { type: 'ceiling' }
  | { type: 'wave'; bonus: number }
  | { type: 'clear'; stars: number; bonus: number }
  | { type: 'swap' }
  | { type: 'over' };
export type Shot = { points: Pt[]; seg: number; along: number; pos: Pt; color: number; target: CellRef };
export type Game = {
  mode: Mode;
  grid: number[][];
  /** 0 or 1: flips each time endless pushes a new row in on top, so row 0 can be short. */
  parity: number;
  ceiling: number;
  /** Campaign: the level number. Endless: the difficulty tier. */
  level: number;
  def: LevelDef | null;
  colors: number;
  score: number;
  combo: number;
  bestCombo: number;
  current: number;
  next: number;
  /** Shots that drop the ceiling (0: off). Every shot counts. */
  dropEvery: number;
  shotsUntilDrop: number;
  /** Seconds between timed drops (0: off). */
  dropInterval: number;
  dropTimer: number;
  /** Infinity in endless. */
  shotsLeft: number;
  shots: number;
  /** Endless rows pushed in so far. */
  pushed: number;
  shot: Shot | null;
  ended: boolean;
  outcome: Outcome | null;
  stars: number;
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

export function rowLength(r: number, parity = 0): number {
  return (r + parity) % 2 === 0 ? COLS : COLS - 1;
}

export function cellCenter(game: Game, r: number, c: number): Pt {
  return { x: R + 2 * R * c + ((r + game.parity) % 2 === 1 ? R : 0), y: game.ceiling + R + r * ROW_H };
}

export function inBounds(r: number, c: number, parity = 0): boolean {
  return r >= 0 && c >= 0 && c < rowLength(r, parity);
}

export function neighbors(r: number, c: number, parity = 0): CellRef[] {
  const odd = (r + parity) % 2 === 1;
  const refs: CellRef[] = [
    { r, c: c - 1 },
    { r, c: c + 1 },
    { r: r - 1, c: odd ? c : c - 1 },
    { r: r - 1, c: odd ? c + 1 : c },
    { r: r + 1, c: odd ? c : c - 1 },
    { r: r + 1, c: odd ? c + 1 : c },
  ];
  return refs.filter((p) => inBounds(p.r, p.c, parity));
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

/** Endless difficulty by tier: more colors, faster rows, more specials. */
export function levelConfig(level: number): { rows: number; colors: number; dropEvery: number; dropInterval: number; specials: number } {
  const k = Math.max(0, level - 1);
  return {
    rows: 6,
    colors: Math.min(4 + Math.floor((k + 1) / 2), PALETTE_SIZE),
    dropEvery: Math.max(2, 6 - Math.floor(k / 2)),
    dropInterval: Math.max(5, 12 - k),
    specials: Math.min(0.16, 0.03 * k),
  };
}

/** Rows endless pushes in before the tier goes up. */
export const ROWS_PER_TIER = 4;

/** Colors you can still match, frozen ones included. */
export function boardColors(game: Game): number[] {
  const set = new Set<number>();
  for (const row of game.grid) for (const v of row) if (hue(v) >= 0) set.add(hue(v));
  return [...set].sort((a, b) => a - b);
}

export function lowestBubbleBottom(game: Game): number {
  let low = -Infinity;
  for (let r = 0; r < game.grid.length; r++)
    for (let c = 0; c < game.grid[r].length; c++)
      if (game.grid[r][c] >= 0) low = Math.max(low, cellCenter(game, r, c).y + R);
  return low;
}

export function starsFor(def: LevelDef, shotsLeft: number): number {
  return shotsLeft >= def.stars[1] ? 3 : shotsLeft >= def.stars[0] ? 2 : 1;
}

const TOKENS = 'roygbpck';

/** Parses a level map into grid rows. Throws on a malformed row so tests catch typos. */
export function parseMap(map: readonly string[]): number[][] {
  return map.map((line, r) => {
    const cells = line.trim().split(/\s+/).map((t) => {
      if (t === '.') return EMPTY;
      if (t === '#') return STONE;
      if (t === '*') return BOMB;
      const i = TOKENS.indexOf(t.toLowerCase());
      if (i < 0 || t.length !== 1) throw new Error(`Bad token "${t}" in row ${r}`);
      return t === t.toLowerCase() ? i : ICE + i;
    });
    if (cells.length !== rowLength(r)) throw new Error(`Row ${r} has ${cells.length} cells, wants ${rowLength(r)}`);
    return cells;
  });
}

function pickColor(game: Game): number {
  const on = boardColors(game);
  return on.length > 0 ? on[Math.floor(game.rng() * on.length)] : Math.floor(game.rng() * Math.max(1, game.colors));
}

function trimGrid(game: Game): void {
  while (game.grid.length > 0 && game.grid[game.grid.length - 1].every((v) => v < 0)) game.grid.pop();
}

function makeRow(game: Game, r: number, above: number[] | null, specials: boolean): number[] {
  const cfg = levelConfig(game.level);
  const row = new Array<number>(rowLength(r, game.parity));
  for (let c = 0; c < row.length; c++) {
    let color = -1;
    if (game.rng() < 0.45) {
      if (c > 0 && isColor(row[c - 1])) color = row[c - 1];
      else if (above) {
        const ups = above.filter((v) => isColor(v));
        if (ups.length > 0) color = ups[Math.floor(game.rng() * ups.length)];
      }
    }
    if (color < 0) color = Math.floor(game.rng() * game.colors);
    if (specials && game.rng() < cfg.specials) {
      const roll = game.rng();
      color = roll < 0.45 ? ICE + color : roll < 0.75 || game.level < 4 ? BOMB : STONE;
    }
    row[c] = color;
  }
  return row;
}

function startEndless(game: Game): void {
  const cfg = levelConfig(game.level);
  game.def = null;
  game.colors = cfg.colors;
  game.ceiling = 0;
  game.parity = 0;
  game.grid = [];
  for (let r = 0; r < cfg.rows; r++) game.grid.push(makeRow(game, r, game.grid[r - 1] ?? null, false));
  game.shotsLeft = Infinity;
  game.dropEvery = cfg.dropEvery;
  game.shotsUntilDrop = cfg.dropEvery;
  game.dropInterval = cfg.dropInterval;
  game.dropTimer = cfg.dropInterval;
}

function startCampaign(game: Game): void {
  game.level = Math.min(Math.max(1, Math.round(game.level)), LEVELS.length);
  const def = LEVELS[game.level - 1];
  game.def = def;
  game.parity = 0;
  game.ceiling = 0;
  game.grid = parseMap(def.map);
  game.colors = boardColors(game).length;
  game.shotsLeft = def.shots;
  game.dropEvery = def.drop;
  game.shotsUntilDrop = def.drop;
  game.dropInterval = def.time;
  game.dropTimer = def.time;
}

export function createGame(opts?: { seed?: number; level?: number; rng?: () => number; mode?: Mode }): Game {
  const rng = opts?.rng ?? mulberry32(opts?.seed ?? ((Math.random() * 2 ** 32) >>> 0));
  const game: Game = {
    mode: opts?.mode ?? 'endless',
    grid: [],
    parity: 0,
    ceiling: 0,
    level: opts?.level ?? 1,
    def: null,
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
    shotsLeft: Infinity,
    shots: 0,
    pushed: 0,
    shot: null,
    ended: false,
    outcome: null,
    stars: 0,
    time: 0,
    effects: [],
    rng,
  };
  if (game.mode === 'levels') startCampaign(game);
  else startEndless(game);
  game.current = pickColor(game);
  game.next = pickColor(game);
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
    for (let c = 0; c < rowLength(r, game.parity); c++) {
      if (getCell(game, r, c) >= 0) continue;
      if (r !== 0 && !neighbors(r, c, game.parity).some((p) => getCell(game, p.r, p.c) >= 0)) continue;
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

export function canShoot(game: Game): boolean {
  return !game.ended && game.shot === null && game.shotsLeft > 0;
}

export function fire(game: Game, angle: number): boolean {
  if (!canShoot(game)) return false;
  const { points, cell } = traceAim(game, angle);
  if (cell === null) return false;
  const color = game.current;
  game.shot = { points, seg: 0, along: 0, pos: { ...SHOOTER }, color, target: cell };
  game.current = game.next;
  game.next = pickColor(game);
  game.shots++;
  game.shotsLeft--;
  game.effects.push({ type: 'fire', color });
  return true;
}

/** Swapping needs a next bubble to swap with, so the last shot can't. */
export function swap(game: Game): boolean {
  if (game.ended || game.shotsLeft < 2) return false;
  const t = game.current;
  game.current = game.next;
  game.next = t;
  game.effects.push({ type: 'swap' });
  return true;
}

export function findMatches(game: Game, r: number, c: number): CellRef[] {
  const color = getCell(game, r, c);
  if (!isColor(color)) return [];
  const seen = new Set<string>([`${r},${c}`]);
  const out: CellRef[] = [{ r, c }];
  const queue: CellRef[] = [{ r, c }];
  while (queue.length > 0) {
    const cur = queue.pop()!;
    for (const nb of neighbors(cur.r, cur.c, game.parity)) {
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
    for (const nb of neighbors(cur.r, cur.c, game.parity)) {
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

/** The color a rainbow bubble turns into at (r, c): whichever neighbor color makes the biggest group. */
export function rainbowColor(game: Game, r: number, c: number): number {
  const prev = getCell(game, r, c);
  let best = -1;
  let bestN = 0;
  for (const nb of neighbors(r, c, game.parity)) {
    const v = getCell(game, nb.r, nb.c);
    if (!isColor(v) || v === best) continue;
    game.grid[r][c] = v;
    const n = findMatches(game, r, c).length;
    if (n > bestN) {
      bestN = n;
      best = v;
    }
  }
  game.grid[r][c] = prev;
  return best >= 0 ? best : pickColor(game);
}

function thaw(game: Game, cell: CellRef): void {
  const v = getCell(game, cell.r, cell.c);
  if (!isIce(v)) return;
  game.grid[cell.r][cell.c] = v - ICE;
  const cc = cellCenter(game, cell.r, cell.c);
  game.effects.push({ type: 'thaw', x: cc.x, y: cc.y, color: v - ICE });
}

function remove(game: Game, cell: CellRef, kind: 'pop' | 'drop', i = 0): void {
  const v = game.grid[cell.r][cell.c];
  const cc = cellCenter(game, cell.r, cell.c);
  game.grid[cell.r][cell.c] = EMPTY;
  if (kind === 'pop') game.effects.push({ type: 'pop', x: cc.x, y: cc.y, color: v, i });
  else game.effects.push({ type: 'drop', x: cc.x, y: cc.y, color: v });
}

/** Sets off every bomb in the queue, chaining into bombs caught in a blast. Returns how many cells it cleared. */
function detonate(game: Game, bombs: CellRef[]): number {
  let cleared = 0;
  while (bombs.length > 0) {
    const b = bombs.shift()!;
    if (getCell(game, b.r, b.c) !== BOMB) continue;
    const at = cellCenter(game, b.r, b.c);
    game.effects.push({ type: 'blast', x: at.x, y: at.y });
    const hit: { cell: CellRef; d: number }[] = [];
    for (let r = 0; r < game.grid.length; r++)
      for (let c = 0; c < game.grid[r].length; c++) {
        if (game.grid[r][c] < 0) continue;
        const cc = cellCenter(game, r, c);
        const d = Math.hypot(cc.x - at.x, cc.y - at.y);
        if (d <= BLAST_R) hit.push({ cell: { r, c }, d });
      }
    hit.sort((u, v) => u.d - v.d);
    hit.forEach(({ cell }, i) => {
      const v = game.grid[cell.r][cell.c];
      if (v === BOMB && (cell.r !== b.r || cell.c !== b.c)) {
        bombs.push(cell);
        return;
      }
      remove(game, cell, 'pop', i);
      cleared++;
    });
  }
  return cleared;
}

function settle(game: Game): void {
  const shot = game.shot!;
  const { r, c } = shot.target;
  const p = game.parity;
  while (game.grid.length <= r) game.grid.push(new Array<number>(rowLength(game.grid.length, p)).fill(EMPTY));
  const touching = neighbors(r, c, p);
  for (const nb of touching) thaw(game, nb);
  const color = shot.color === RAINBOW ? rainbowColor(game, r, c) : shot.color;
  game.grid[r][c] = color;
  const placed = cellCenter(game, r, c);
  game.shot = null;
  game.effects.push({ type: 'stick', x: placed.x, y: placed.y, color });

  const bombs = touching.filter((nb) => getCell(game, nb.r, nb.c) === BOMB);
  const group = findMatches(game, r, c);
  let popped = 0;
  if (group.length >= 3) {
    const sorted = [...group].sort((u, v) => {
      const a = cellCenter(game, u.r, u.c);
      const b = cellCenter(game, v.r, v.c);
      return (a.x - placed.x) ** 2 + (a.y - placed.y) ** 2 - ((b.x - placed.x) ** 2 + (b.y - placed.y) ** 2);
    });
    sorted.forEach((cell, i) => remove(game, cell, 'pop', i));
    popped = sorted.length;
    for (const cell of sorted)
      for (const nb of neighbors(cell.r, cell.c, p)) {
        const v = getCell(game, nb.r, nb.c);
        if (v === BOMB) bombs.push(nb);
        else if (isIce(v)) thaw(game, nb);
      }
  }
  popped += detonate(game, bombs);

  if (popped > 0) {
    const floating = findFloating(game);
    for (const cell of floating) remove(game, cell, 'drop');
    game.combo += 1;
    game.bestCombo = Math.max(game.bestCombo, game.combo);
    const d = floating.length;
    const points = (10 * popped + 25 * d * Math.ceil(d / 4)) * game.combo;
    game.score += points;
    game.effects.push({ type: 'combo', n: game.combo, points, x: placed.x, y: placed.y });
    if ((d >= 8 || game.combo % 4 === 0) && game.current !== RAINBOW && game.next !== RAINBOW && game.shotsLeft > 0) {
      game.next = RAINBOW;
      game.effects.push({ type: 'rainbow' });
    }
  } else {
    game.combo = 0;
  }
  trimGrid(game);

  if (boardColors(game).length === 0) {
    // stones and bombs left with nothing to match fall away
    for (let rr = 0; rr < game.grid.length; rr++) for (let cc = 0; cc < game.grid[rr].length; cc++) if (game.grid[rr][cc] >= 0) remove(game, { r: rr, c: cc }, 'drop');
    game.grid = [];
    if (game.mode === 'levels') {
      finishLevel(game);
      return;
    }
    const bonus = 1000 * game.level;
    game.score += bonus;
    game.effects.push({ type: 'wave', bonus });
    for (let k = 0; k < 5; k++) pushRow(game, false);
  } else if (game.dropEvery > 0) {
    game.shotsUntilDrop -= 1;
    if (game.shotsUntilDrop <= 0) pressure(game);
  }
  if (game.ended) return;

  if (game.current !== RAINBOW && !boardColors(game).includes(game.current)) game.current = pickColor(game);
  if (game.next !== RAINBOW && !boardColors(game).includes(game.next)) game.next = pickColor(game);
  if (checkLine(game)) return;
  if (game.shotsLeft <= 0) end(game, 'shots');
}

function finishLevel(game: Game): void {
  const def = game.def!;
  const stars = starsFor(def, game.shotsLeft);
  const bonus = 1000 + 150 * game.shotsLeft;
  game.score += bonus;
  game.stars = stars;
  game.effects.push({ type: 'clear', stars, bonus });
  game.ended = true;
  game.outcome = 'clear';
}

function end(game: Game, outcome: Outcome): void {
  game.ended = true;
  game.outcome = outcome;
  game.effects.push({ type: 'over' });
}

function checkLine(game: Game): boolean {
  if (lowestBubbleBottom(game) <= DEADLINE_Y) return false;
  end(game, 'line');
  return true;
}

/** Endless: a fresh row slides in on top and pushes the whole board down. */
function pushRow(game: Game, count = true): void {
  game.parity ^= 1;
  game.grid.unshift(makeRow(game, 0, null, game.level > 1));
  if (!count) return;
  game.pushed++;
  const tier = 1 + Math.floor(game.pushed / ROWS_PER_TIER);
  if (tier !== game.level) {
    game.level = tier;
    const cfg = levelConfig(tier);
    game.colors = cfg.colors;
    game.dropEvery = cfg.dropEvery;
    game.dropInterval = cfg.dropInterval;
  }
}

function pressure(game: Game): void {
  if (game.mode === 'endless') pushRow(game);
  else game.ceiling += ROW_H;
  game.shotsUntilDrop = game.dropEvery;
  game.dropTimer = game.dropInterval;
  game.effects.push({ type: 'ceiling' });
  checkLine(game);
}

export function step(game: Game, dt: number): void {
  if (game.ended) return;
  game.time += dt;
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
  } else if (game.dropInterval > 0) {
    game.dropTimer -= dt;
    if (game.dropTimer <= 0) pressure(game);
  }
}
