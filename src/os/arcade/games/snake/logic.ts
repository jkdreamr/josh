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

export function speedForLength(length: number) {
  return Math.min(16, 8 + Math.max(0, length - 3) * 0.42);
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

export function stepSnake(state: SnakeState, rng: () => number = Math.random) {
  if (!state.alive || state.won) return 'inactive' as const;
  if (state.queue.length) state.direction = state.queue.shift()!;
  const vector = vectors[state.direction];
  const head = state.segments[0];
  const next = { x: head.x + vector.x, y: head.y + vector.y };
  if (next.x < 0 || next.x >= state.cols || next.y < 0 || next.y >= state.rows) {
    state.alive = false;
    return 'dead' as const;
  }
  const ate = state.food?.x === next.x && state.food?.y === next.y;
  const body = ate ? state.segments : state.segments.slice(0, -1);
  if (body.some((p) => p.x === next.x && p.y === next.y)) {
    state.alive = false;
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
