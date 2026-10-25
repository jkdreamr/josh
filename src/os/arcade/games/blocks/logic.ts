export type Piece = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type Cell = [number, number];
export type Board = (Piece | null)[][];
export type ActivePiece = { type: Piece; rotation: number; x: number; y: number };
export type Spin = 'none' | 'mini' | 'full';
/** What the last lock did, for the score toasts and the clear animation. */
export type LockEvent = {
  lines: number;
  spin: Spin;
  backToBack: boolean;
  combo: number;
  perfect: boolean;
  points: number;
  levelUp: boolean;
  /** Board rows that cleared, before the stack fell. */
  rows: number[];
  /** The pieces in each cleared row, for particles. */
  cells: (Piece | null)[][];
  /** For each row after the clear, how many rows it fell. */
  shift: number[];
};

export const WIDTH = 10;
export const HEIGHT = 40;
export const VISIBLE_ROWS = 20;
export const PIECES: Piece[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];
export const LOCK_DELAY = 0.5;
export const LOCK_RESETS = 15;
const SPAWN_Y = 18;

const spawnCells: Record<Piece, Cell[]> = {
  I: [[0, 1], [1, 1], [2, 1], [3, 1]],
  O: [[1, 1], [2, 1], [1, 2], [2, 2]],
  T: [[1, 0], [0, 1], [1, 1], [2, 1]],
  S: [[1, 0], [2, 0], [0, 1], [1, 1]],
  Z: [[0, 0], [1, 0], [1, 1], [2, 1]],
  J: [[0, 0], [0, 1], [1, 1], [2, 1]],
  L: [[2, 0], [0, 1], [1, 1], [2, 1]],
};

const rotateCells = (cells: Cell[], turns: number, size: number): Cell[] => {
  let result = cells.map(([x, y]) => [x, y] as Cell);
  for (let i = 0; i < turns; i++) result = result.map(([x, y]) => [size - 1 - y, x]);
  return result;
};

export function cellsFor(type: Piece, rotation = 0): Cell[] {
  if (type === 'O') return spawnCells.O.map(([x, y]) => [x, y]);
  return rotateCells(spawnCells[type], ((rotation % 4) + 4) % 4, type === 'I' ? 4 : 3);
}

export function createBoard(): Board {
  return Array.from({ length: HEIGHT }, () => Array<Piece | null>(WIDTH).fill(null));
}

export function createBag(rand: () => number = Math.random): Piece[] {
  const bag = [...PIECES];
  for (let i = bag.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.max(0, Math.floor(rand() * (i + 1))));
    [bag[i], bag[j]] = [bag[j], bag[i]];
  }
  return bag;
}

/** A small seeded generator, so every player in an online race gets the same pieces. */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type BlocksGame = {
  board: Board;
  active: ActivePiece | null;
  hold: Piece | null;
  canHold: boolean;
  bag: Piece[];
  next: Piece[];
  score: number;
  lines: number;
  level: number;
  over: boolean;
  backToBack: boolean;
  /** Clears in a row, -1 when the last piece cleared nothing. */
  combo: number;
  /** Set by a T rotation that ended in a slot, cleared by any later move. */
  spin: Spin;
  gravity: number;
  lockTimer: number;
  lockResets: number;
  lowestRow: number;
  pieces: number;
  clearFlash: number;
  lockFlash: number;
  dropFlash: number;
  lastClear: number;
  clearedRows: number[];
  lastLocked: Cell[];
  event: LockEvent | null;
  /** Bumps on every lock, so the view can react to each one once. */
  seq: number;
};

function drawBag(state: BlocksGame, rand: () => number): Piece {
  if (!state.bag.length) state.bag = createBag(rand);
  return state.bag.shift()!;
}

function fillQueue(state: BlocksGame, rand: () => number) {
  while (state.next.length < 5) state.next.push(drawBag(state, rand));
}

export function collides(board: Board, piece: ActivePiece): boolean {
  return cellsFor(piece.type, piece.rotation).some(([dx, dy]) => {
    const x = piece.x + dx;
    const y = piece.y + dy;
    return x < 0 || x >= WIDTH || y >= HEIGHT || (y >= 0 && board[y][x] !== null);
  });
}

const bottomOf = (piece: ActivePiece) => Math.max(...cellsFor(piece.type, piece.rotation).map(([, y]) => y + piece.y));

/** Puts a piece in just above the well and, when there is room, drops it one row so it shows at once. */
function spawn(state: BlocksGame, type: Piece): boolean {
  const piece = { type, rotation: 0, x: 3, y: SPAWN_Y };
  if (collides(state.board, piece)) {
    state.active = null;
    state.over = true;
    return false;
  }
  if (!collides(state.board, { ...piece, y: piece.y + 1 })) piece.y++;
  state.active = piece;
  state.gravity = 0;
  state.lockTimer = 0;
  state.lockResets = 0;
  state.lowestRow = bottomOf(piece);
  state.canHold = true;
  state.spin = 'none';
  return true;
}

export function spawnPiece(state: BlocksGame, type: Piece): boolean {
  return spawn(state, type);
}

export function createGame(rand: () => number = Math.random): BlocksGame {
  const state: BlocksGame = {
    board: createBoard(),
    active: null,
    hold: null,
    canHold: true,
    bag: [],
    next: [],
    score: 0,
    lines: 0,
    level: 1,
    over: false,
    backToBack: false,
    combo: -1,
    spin: 'none',
    gravity: 0,
    lockTimer: 0,
    lockResets: 0,
    lowestRow: 0,
    pieces: 0,
    clearFlash: 0,
    lockFlash: 0,
    dropFlash: 0,
    lastClear: 0,
    clearedRows: [],
    lastLocked: [],
    event: null,
    seq: 0,
  };
  fillQueue(state, rand);
  spawn(state, takeNext(state, rand));
  return state;
}

function takeNext(state: BlocksGame, rand: () => number): Piece {
  const piece = state.next.shift()!;
  fillQueue(state, rand);
  return piece;
}

/** Seconds per row at a level: one second at level 1, close to instant by level 20. */
export function gravitySeconds(level: number): number {
  return Math.pow(Math.max(0.01, 0.8 - (level - 1) * 0.007), level - 1);
}

export function grounded(state: BlocksGame): boolean {
  return !!state.active && collides(state.board, { ...state.active, y: state.active.y + 1 });
}

/** Moving or turning a piece that sits on the stack restarts its lock delay, up to LOCK_RESETS times per row. */
function recordMovement(state: BlocksGame) {
  if (!state.active) return;
  const bottom = bottomOf(state.active);
  if (bottom > state.lowestRow) {
    state.lowestRow = bottom;
    state.lockResets = 0;
    state.lockTimer = 0;
  } else if (state.lockTimer > 0 && state.lockResets < LOCK_RESETS) {
    state.lockTimer = 0;
    state.lockResets++;
  }
}

export function move(state: BlocksGame, dx: number, dy = 0): boolean {
  if (!state.active || state.over) return false;
  const candidate = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
  if (collides(state.board, candidate)) return false;
  state.active = candidate;
  state.spin = 'none';
  if (dy === 0) recordMovement(state);
  else if (dy > 0) {
    const bottom = bottomOf(state.active);
    if (bottom > state.lowestRow) {
      state.lowestRow = bottom;
      state.lockResets = 0;
      state.lockTimer = 0;
    }
  }
  return true;
}

type Kick = [number, number];
const JLSTZ: Record<string, Kick[]> = {
  '0>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '1>0': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '1>2': [[0, 0], [1, 0], [1, 1], [0, -2], [1, -2]],
  '2>1': [[0, 0], [-1, 0], [-1, -1], [0, 2], [-1, 2]],
  '2>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
  '3>2': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '3>0': [[0, 0], [-1, 0], [-1, 1], [0, -2], [-1, -2]],
  '0>3': [[0, 0], [1, 0], [1, -1], [0, 2], [1, 2]],
};
const I_KICKS: Record<string, Kick[]> = {
  '0>1': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '1>0': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '1>2': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
  '2>1': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '2>3': [[0, 0], [2, 0], [-1, 0], [2, -1], [-1, 2]],
  '3>2': [[0, 0], [-2, 0], [1, 0], [-2, 1], [1, -2]],
  '3>0': [[0, 0], [1, 0], [-2, 0], [1, 2], [-2, -1]],
  '0>3': [[0, 0], [-1, 0], [2, 0], [-1, -2], [2, 1]],
};

const filled = (board: Board, x: number, y: number) => x < 0 || x >= WIDTH || y >= HEIGHT || (y >= 0 && board[y][x] !== null);

/** Three corner rule: three of the four squares around the T's center are taken. Both in front of its point makes it a full spin. */
export function spinKind(board: Board, piece: ActivePiece, kick: number): Spin {
  if (piece.type !== 'T') return 'none';
  const cx = piece.x + 1;
  const cy = piece.y + 1;
  const corners = [[cx - 1, cy - 1], [cx + 1, cy - 1], [cx + 1, cy + 1], [cx - 1, cy + 1]].map(([x, y]) => filled(board, x, y));
  if (corners.filter(Boolean).length < 3) return 'none';
  const front = [[0, 1], [1, 2], [2, 3], [3, 0]][((piece.rotation % 4) + 4) % 4];
  return front.every((i) => corners[i]) || kick === 4 ? 'full' : 'mini';
}

export function rotate(state: BlocksGame, direction: 1 | -1 = 1): boolean {
  const active = state.active;
  if (!active || state.over) return false;
  const to = (active.rotation + direction + 4) % 4;
  const key = `${active.rotation}>${to}`;
  const kicks = active.type === 'O' ? [[0, 0] as Kick] : (active.type === 'I' ? I_KICKS : JLSTZ)[key];
  for (let i = 0; i < kicks.length; i++) {
    const [dx, dy] = kicks[i];
    const candidate = { ...active, rotation: to, x: active.x + dx, y: active.y + dy };
    if (!collides(state.board, candidate)) {
      state.active = candidate;
      recordMovement(state);
      state.spin = spinKind(state.board, candidate, i);
      return true;
    }
  }
  return false;
}

const LINE_POINTS = [0, 100, 300, 500, 800];
const SPIN_POINTS = [400, 800, 1200, 1600];
const MINI_POINTS = [100, 200, 400, 400];
const PERFECT_POINTS = [0, 800, 1200, 1800, 2000];

/** Scores a lock: lines (and T-spins) times the level, half again for back to back hard clears, plus combo and perfect clear bonuses. */
function scoreLock(state: BlocksGame, lines: number, spin: Spin, perfect: boolean): { points: number; backToBack: boolean } {
  const level = state.level;
  const base = spin === 'full' ? SPIN_POINTS[lines] : spin === 'mini' ? MINI_POINTS[lines] : LINE_POINTS[lines];
  const hard = lines > 0 && (lines === 4 || spin !== 'none');
  const backToBack = hard && state.backToBack;
  let points = base * level;
  if (backToBack) points = Math.floor(points * 1.5);
  if (lines > 0) {
    state.combo++;
    if (state.combo > 0) points += 50 * state.combo * level;
    if (perfect) points += PERFECT_POINTS[lines] * level;
    state.backToBack = hard;
  } else state.combo = -1;
  state.score += points;
  return { points, backToBack };
}

export function lock(state: BlocksGame, rand: () => number = Math.random): void {
  const active = state.active;
  if (!active || state.over) return;
  const spin = active.type === 'T' ? state.spin : 'none';
  state.lastLocked = cellsFor(active.type, active.rotation).map(([dx, dy]): Cell => [active.x + dx, active.y + dy]);
  for (const [x, y] of state.lastLocked) {
    if (y >= 0 && y < HEIGHT && x >= 0 && x < WIDTH) state.board[y][x] = active.type;
  }
  state.pieces++;
  state.seq++;
  state.lockFlash = 0.12;
  if (state.lastLocked.every(([, y]) => y < HEIGHT - VISIBLE_ROWS)) {
    state.active = null;
    state.over = true;
    state.event = null;
    return;
  }
  const rows = state.board.flatMap((row, index) => row.every((cell) => cell !== null) ? [index] : []);
  const cells = rows.map((r) => [...state.board[r]]);
  const kept = state.board.filter((row) => row.some((cell) => cell === null));
  const shift: number[] = [];
  const lines = rows.length;
  for (let r = 0; r < HEIGHT; r++) shift.push(0);
  let fell = 0;
  for (let r = HEIGHT - 1, n = HEIGHT - 1; r >= 0; r--) {
    if (rows.includes(r)) fell++;
    else shift[n--] = fell;
  }
  while (kept.length < HEIGHT) kept.unshift(Array<Piece | null>(WIDTH).fill(null));
  state.board = kept;
  const perfect = lines > 0 && state.board.every((row) => row.every((cell) => cell === null));
  const before = state.level;
  const { points, backToBack } = scoreLock(state, lines, spin, perfect);
  state.lines += lines;
  state.level = Math.floor(state.lines / 10) + 1;
  state.lastClear = lines;
  state.clearedRows = rows;
  if (lines) state.clearFlash = 0.28;
  state.event = { lines, spin, backToBack, combo: lines ? state.combo : -1, perfect, points, levelUp: state.level > before, rows, cells, shift };
  state.active = null;
  fillQueue(state, rand);
  spawn(state, takeNext(state, rand));
}

/**
 * Advances gravity and the lock delay. Soft drop falls 20 times faster (never slower than gravity) and scores a
 * point a row. Returns true when the piece locked.
 */
export function step(state: BlocksGame, dt: number, soft = false, rand: () => number = Math.random): boolean {
  if (!state.active || state.over) return false;
  const fall = gravitySeconds(state.level);
  const interval = soft ? Math.min(fall, Math.max(1 / 40, fall / 20)) : fall;
  state.gravity += dt;
  while (state.gravity >= interval && state.active) {
    if (!move(state, 0, 1)) {
      state.gravity = Math.min(state.gravity, interval);
      break;
    }
    state.gravity -= interval;
    if (soft) state.score++;
  }
  if (!grounded(state)) {
    state.lockTimer = 0;
    return false;
  }
  state.lockTimer += dt;
  if (state.lockTimer < LOCK_DELAY) return false;
  lock(state, rand);
  return true;
}

export function hardDrop(state: BlocksGame, rand: () => number = Math.random): number {
  if (!state.active || state.over) return 0;
  let distance = 0;
  const spin = state.spin;
  while (move(state, 0, 1)) distance++;
  if (!distance) state.spin = spin;
  state.score += distance * 2;
  state.dropFlash = 0.14;
  lock(state, rand);
  return distance;
}

export function holdPiece(state: BlocksGame, rand: () => number = Math.random): boolean {
  if (!state.active || !state.canHold || state.over) return false;
  const current = state.active.type;
  const held = state.hold;
  state.hold = current;
  state.active = null;
  spawn(state, held ?? takeNext(state, rand));
  state.canHold = false;
  return true;
}

export function ghostY(state: BlocksGame): number {
  if (!state.active) return 0;
  let y = state.active.y;
  while (!collides(state.board, { ...state.active, y: y + 1 })) y++;
  return y;
}

/** The highest taken row, or HEIGHT on an empty board. */
export function stackTop(board: Board): number {
  const row = board.findIndex((r) => r.some((cell) => cell !== null));
  return row < 0 ? HEIGHT : row;
}
