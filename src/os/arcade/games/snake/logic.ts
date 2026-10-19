export type Direction = 'up' | 'down' | 'left' | 'right';
export type Point = { x: number; y: number };

export type SnakeState = {
  cols: number;
  rows: number;
  segments: Point[];
  previous: Point[];
  direction: Direction;
  queue: Direction[];
  food: Point | null;
  score: number;
  alive: boolean;
  won: boolean;
  cause?: 'wall' | 'self';
};

const vectors: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
};

export function opposite(a: Direction, b: Direction) {
  return vectors[a].x + vectors[b].x === 0 && vectors[a].y + vectors[b].y === 0;
}

/** Every round plays on the same number of cells, laid out to match the screen, so scores compare. */
export const GRID = { long: 21, short: 13 } as const;

export function gridFor(w: number, h: number) {
  return w >= h ? { cols: GRID.long, rows: GRID.short } : { cols: GRID.short, rows: GRID.long };
}

export const MIN_SPEED = 6.5;
export const MAX_SPEED = 12.5;

/** Cells per second: brisk from the first bite, easing toward the cap instead of running away. */
export function speedForLength(length: number) {
  const grown = Math.max(0, length - 3);
  return MIN_SPEED + (MAX_SPEED - MIN_SPEED) * (1 - Math.exp(-grown / 20));
}

export type Rect = { x: number; y: number; w: number; h: number };
export type Board = { x: number; y: number; cell: number; width: number; height: number };

/**
 * Largest whole-pixel board for the grid that stays clear of the overlays along the top (score pill, toolbar).
 * Tries the band under them and the column between them, whichever gives bigger cells.
 */
export function fitBoard(w: number, h: number, cols: number, rows: number, obstacles: Rect[] = [], maxCell = 56): Board {
  const pad = h < 220 || w < 260 ? 4 : 12;
  const areas: { x0: number; x1: number; y0: number; y1: number }[] = [];
  const band = obstacles.reduce((m, r) => Math.max(m, r.y + r.h), 0);
  areas.push({ x0: pad, x1: w - pad, y0: Math.max(pad, band ? band + pad : pad), y1: h - pad });
  if (obstacles.length) {
    const left = obstacles.filter((r) => r.x + r.w / 2 < w / 2).reduce((m, r) => Math.max(m, r.x + r.w), 0);
    const right = obstacles.filter((r) => r.x + r.w / 2 >= w / 2).reduce((m, r) => Math.min(m, r.x), w);
    const x0 = left ? left + pad : pad;
    const x1 = right < w ? right - pad : w - pad;
    if (x1 > x0 && !obstacles.some((r) => r.x < x1 && r.x + r.w > x0)) areas.push({ x0, x1, y0: pad, y1: h - pad });
  }
  let best: Board | null = null;
  for (const a of areas) {
    const cell = Math.max(1, Math.min(maxCell, Math.floor(Math.min((a.x1 - a.x0) / cols, (a.y1 - a.y0) / rows))));
    if (best && cell <= best.cell) continue;
    const width = cell * cols;
    const height = cell * rows;
    const x = Math.round(Math.min(Math.max((w - width) / 2, a.x0), Math.max(a.x0, a.x1 - width)));
    const y = Math.round(Math.min(Math.max((h - height) / 2, a.y0), Math.max(a.y0, a.y1 - height)));
    best = { x, y, cell, width, height };
  }
  return best!;
}

export function createSnake(cols: number, rows: number, rng: () => number = Math.random): SnakeState {
  const width = Math.max(5, Math.floor(cols));
  const height = Math.max(5, Math.floor(rows));
  const x = Math.floor(width / 2);
  const y = Math.floor(height / 2);
  const segments = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
  const state: SnakeState = {
    cols: width,
    rows: height,
    segments,
    previous: segments.map((p) => ({ ...p })),
    direction: 'right',
    queue: [],
    food: null,
    score: 0,
    alive: true,
    won: false,
  };
  state.food = spawnFood(state, rng);
  return state;
}

export function queueDirection(state: SnakeState, next: Direction) {
  if (!state.alive || state.won || state.queue.length >= 2) return false;
  const last = state.queue.at(-1) ?? state.direction;
  if (next === last || opposite(next, last)) return false;
  state.queue.push(next);
  return true;
}

export function spawnFood(state: Pick<SnakeState, 'cols' | 'rows' | 'segments'>, rng: () => number = Math.random): Point | null {
  const occupied = new Set(state.segments.map((p) => `${p.x},${p.y}`));
  const free: Point[] = [];
  for (let y = 0; y < state.rows; y++) {
    for (let x = 0; x < state.cols; x++) {
      if (!occupied.has(`${x},${y}`)) free.push({ x, y });
    }
  }
  if (!free.length) return null;
  const index = Math.min(free.length - 1, Math.max(0, Math.floor(rng() * free.length)));
  return free[index];
}

/** True when the next step, with the next queued turn, would hit a wall or the body. */
export function wouldDie(state: SnakeState) {
  if (!state.alive || state.won) return false;
  const vector = vectors[state.queue[0] ?? state.direction];
  const head = state.segments[0];
  const next = { x: head.x + vector.x, y: head.y + vector.y };
  if (next.x < 0 || next.x >= state.cols || next.y < 0 || next.y >= state.rows) return true;
  const ate = state.food?.x === next.x && state.food?.y === next.y;
  const body = ate ? state.segments : state.segments.slice(0, -1);
  return body.some((p) => p.x === next.x && p.y === next.y);
}

/** Which way the snake will be heading once its queued turns play out. */
export function heading(state: SnakeState) {
  return state.queue.at(-1) ?? state.direction;
}

export function stepSnake(state: SnakeState, rng: () => number = Math.random) {
  if (!state.alive || state.won) return 'inactive' as const;
  if (state.queue.length) state.direction = state.queue.shift()!;
  const vector = vectors[state.direction];
  const head = state.segments[0];
  const next = { x: head.x + vector.x, y: head.y + vector.y };
  if (next.x < 0 || next.x >= state.cols || next.y < 0 || next.y >= state.rows) {
    state.alive = false;
    state.cause = 'wall';
    return 'dead' as const;
  }
  const ate = state.food?.x === next.x && state.food?.y === next.y;
  const body = ate ? state.segments : state.segments.slice(0, -1);
  if (body.some((p) => p.x === next.x && p.y === next.y)) {
    state.alive = false;
    state.cause = 'self';
    return 'dead' as const;
  }
  state.previous = state.segments.map((p) => ({ ...p }));
  state.segments.unshift(next);
  if (!ate) state.segments.pop();
  else {
    state.score += 10;
    state.food = spawnFood(state, rng);
    if (!state.food) {
      state.won = true;
      return 'won' as const;
    }
  }
  return ate ? 'ate' as const : 'moved' as const;
}
