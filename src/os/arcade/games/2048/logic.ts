export type Grid = number[][];
export type Direction = 'left' | 'right' | 'up' | 'down';
export type Position = [number, number];
export type TileMove = { from: Position; to: Position; value: number; merged: boolean };
export type MoveResult = { grid: Grid; moved: boolean; gained: number; moves: TileMove[] };
export type SpawnResult = { grid: Grid; position: Position | null; value: number };

export function emptyGrid(): Grid {
  return Array.from({ length: 4 }, () => [0, 0, 0, 0]);
}

export function spawn(grid: Grid, rand: () => number = Math.random): SpawnResult {
  const empty: Position[] = [];
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) if (!grid[r][c]) empty.push([r, c]);
  if (!empty.length) return { grid: grid.map((row) => [...row]), position: null, value: 0 };
  const index = Math.min(empty.length - 1, Math.max(0, Math.floor(rand() * empty.length)));
  const position = empty[index];
  const value = rand() < 0.1 ? 4 : 2;
  const next = grid.map((row) => [...row]);
  next[position[0]][position[1]] = value;
  return { grid: next, position, value };
}

export function createGame(rand: () => number = Math.random): Grid {
  let grid = emptyGrid();
  grid = spawn(grid, rand).grid;
  grid = spawn(grid, rand).grid;
  return grid;
}

export function move(grid: Grid, direction: Direction): MoveResult {
  const next = emptyGrid();
  const moves: TileMove[] = [];
  let gained = 0;
  for (let line = 0; line < 4; line++) {
    const positions: Position[] = [];
    for (let offset = 0; offset < 4; offset++) {
      if (direction === 'left') positions.push([line, offset]);
      else if (direction === 'right') positions.push([line, 3 - offset]);
      else if (direction === 'up') positions.push([offset, line]);
      else positions.push([3 - offset, line]);
    }
    const packed = positions.flatMap(([r, c]) => grid[r][c] ? [{ position: [r, c] as Position, value: grid[r][c] }] : []);
    const output: { value: number; sources: { position: Position; value: number }[]; merged: boolean }[] = [];
    for (let i = 0; i < packed.length; i++) {
      const current = packed[i];
      const last = output.at(-1);
      if (last && !last.merged && last.value === current.value) {
        last.value *= 2;
        last.merged = true;
        last.sources.push(current);
        gained += last.value;
      } else output.push({ value: current.value, sources: [current], merged: false });
    }
    output.forEach((tile, index) => {
      const [tr, tc] = positions[index];
      next[tr][tc] = tile.value;
      for (const source of tile.sources) moves.push({ from: source.position, to: [tr, tc], value: source.value, merged: tile.merged });
    });
  }
  const moved = next.some((row, r) => row.some((value, c) => value !== grid[r][c]));
  return { grid: next, moved, gained, moves };
}

export function canMove(grid: Grid): boolean {
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) {
    if (!grid[r][c]) return true;
    if (c < 3 && grid[r][c] === grid[r][c + 1]) return true;
    if (r < 3 && grid[r][c] === grid[r + 1][c]) return true;
  }
  return false;
}

export type UndoState = { grid: Grid; score: number; used: boolean };

export function undo(state: UndoState, previous: { grid: Grid; score: number } | null): { state: UndoState; restored: boolean } {
  if (state.used || !previous) return { state: { ...state, used: true }, restored: false };
  return { state: { grid: previous.grid.map((row) => [...row]), score: previous.score, used: true }, restored: true };
}

export const ONLINE_SECONDS = 180;

/** Small seeded generator, so everyone in an online round gets the same tiles from the same moves. */
export function seeded(seed: number): () => number {
  let t = seed >>> 0;
  return () => {
    t = (t + 0x6d2b79f5) >>> 0;
    let x = Math.imul(t ^ (t >>> 15), t | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

export const randomSeed = () => (Math.random() * 4294967296) >>> 0;

export function bestTile(grid: Grid): number {
  return Math.max(0, ...grid.flat());
}

export function isGrid(v: unknown): v is Grid {
  return Array.isArray(v) && v.length === 4 && v.every((row) => Array.isArray(row) && row.length === 4 && row.every((n) => Number.isInteger(n) && n >= 0 && n <= 1 << 20 && (n === 0 || (n & (n - 1)) === 0) && n !== 1));
}

export type Saved = { grid: Grid; score: number; won: boolean; undoUsed: boolean; previous: { grid: Grid; score: number } | null };

/** A game in progress from localStorage, or null when it is missing, finished or not ours. */
export function parseSave(raw: string | null): Saved | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as Partial<Saved>;
    if (!isGrid(v.grid) || !Number.isInteger(v.score) || (v.score as number) < 0 || !canMove(v.grid) || !v.grid.flat().some(Boolean)) return null;
    const previous = v.previous && isGrid(v.previous.grid) && Number.isInteger(v.previous.score) ? { grid: v.previous.grid, score: v.previous.score } : null;
    return { grid: v.grid, score: v.score as number, won: !!v.won, undoUsed: !!v.undoUsed, previous: v.undoUsed ? null : previous };
  } catch {
    return null;
  }
}

/** Seed packets: the host deals, guests ask until they have it. */
export function parseSeed(d: unknown): number | null {
  const m = d as { t?: unknown; seed?: unknown } | null;
  return m && m.t === '2048-seed' && Number.isInteger(m.seed) && (m.seed as number) >= 0 && (m.seed as number) < 4294967296 ? (m.seed as number) : null;
}
export const isSeedRequest = (d: unknown) => (d as { t?: unknown } | null)?.t === '2048-seed?';

export type Rect = { x: number; y: number; w: number; h: number };
export type Layout = { mode: 'row' | 'column'; board: Rect; hud: Rect };

/**
 * Where the board and the score panel go. `ctrl` is the shell's control pill and `status` the online badge
 * (top center), both kept clear. The panel sits above the board when that leaves the bigger board, otherwise
 * beside it on the left. `u` scales the panel for the framed iPad.
 */
export function layout(w: number, h: number, ctrl: Rect | null, status: Rect | null, u = 1): Layout {
  const pad = 10;
  const max = 600;
  const ctrlBottom = ctrl ? ctrl.y + ctrl.h : 44;
  const ctrlLeft = ctrl ? ctrl.x : w - 200;
  const statusBottom = status ? status.y + status.h : 0;
  // panel above: one row of stats and Undo
  const rowH = 50 * u;
  const rowTop = Math.max(ctrlBottom, statusBottom) + 8;
  const rowSize = Math.max(0, Math.min(w - pad * 2, h - rowTop - rowH - 10 - pad, max));
  // panel beside: a column on the left
  const colW = 104 * u;
  const left = pad + colW + 12;
  const beside = Math.max(0, Math.min(h - pad * 2 - (status ? statusBottom : 0), ctrlLeft - 8 - left, max));
  const below = Math.max(0, Math.min(h - Math.max(ctrlBottom + 8, statusBottom + 6) - pad, w - pad - left, max));
  const colSize = Math.max(beside, below);
  if (rowSize >= colSize || w < 300) {
    const size = Math.floor(rowSize);
    const groupH = rowH + 10 + size;
    const top = Math.max(rowTop, Math.min((h - groupH) / 2, h - pad - groupH));
    const x = Math.round((w - size) / 2);
    const hudW = Math.max(size, Math.min(w - pad * 2, 260 * u));
    return { mode: 'row', hud: { x: Math.round((w - hudW) / 2), y: Math.round(top), w: hudW, h: rowH }, board: { x, y: Math.round(top + rowH + 10), w: size, h: size } };
  }
  const size = Math.floor(colSize);
  let x: number;
  let y: number;
  if (beside >= below) {
    const top = pad + (status ? statusBottom : 0);
    x = left + Math.max(0, (ctrlLeft - 8 - left - size) / 2);
    y = top + Math.max(0, (h - pad - top - size) / 2);
  } else {
    const top = Math.max(ctrlBottom + 8, statusBottom + 6);
    x = left + Math.max(0, (w - pad - left - size) / 2);
    y = top + Math.max(0, (h - pad - top - size) / 2);
  }
  const hudH = Math.min(size, 150 * u);
  return { mode: 'column', board: { x: Math.round(x), y: Math.round(y), w: size, h: size }, hud: { x: Math.max(pad, Math.round(x - 12 - colW)), y: Math.round(y + (size - hudH) / 2), w: colW, h: hudH } };
}

/** Merge chime: climbs a pentatonic scale as the tiles grow. */
export function mergePitch(value: number): number {
  const n = Math.max(1, Math.round(Math.log2(value)) - 1);
  const steps = [0, 2, 4, 7, 9];
  const semi = 12 * Math.floor((n - 1) / 5) + steps[(n - 1) % 5];
  return 330 * Math.pow(2, semi / 12);
}

/** Frame scale fix for the iPad and iPhone frames: the inverse of how much they shrink the game, rounded up. */
export function frameUnit(screenWidth: number, layoutWidth: number): number {
  if (!(screenWidth > 0) || !(layoutWidth > 0)) return 1;
  const k = screenWidth / layoutWidth;
  return k > 0.3 && k < 0.99 ? Math.min(1.8, Math.ceil(100 / k) / 100) : 1;
}
