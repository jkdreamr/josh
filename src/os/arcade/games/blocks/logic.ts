export type Piece = 'I' | 'O' | 'T' | 'S' | 'Z' | 'J' | 'L';
export type Cell = [number, number];
export type Board = (Piece | null)[][];
export type ActivePiece = { type: Piece; rotation: number; x: number; y: number };

export const WIDTH = 10;
export const HEIGHT = 40;
export const VISIBLE_ROWS = 20;
export const PIECES: Piece[] = ['I', 'O', 'T', 'S', 'Z', 'J', 'L'];

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
  lockTimer: number;
  lockResets: number;
  lowestRow: number;
  clearFlash: number;
  lockFlash: number;
  dropFlash: number;
  lastClear: number;
  clearedRows: number[];
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

function spawn(state: BlocksGame, type: Piece): boolean {
  const x = type === 'I' || type === 'O' ? 3 : 3;
  const piece = { type, rotation: 0, x, y: 18 };
  if (collides(state.board, piece)) {
    state.active = null;
    state.over = true;
    return false;
  }
  state.active = piece;
  state.lockTimer = 0;
  state.lockResets = 0;
  state.lowestRow = Math.max(...cellsFor(type).map(([, y]) => y + piece.y));
  state.canHold = true;
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
    lockTimer: 0,
    lockResets: 0,
    lowestRow: 0,
    clearFlash: 0,
    lockFlash: 0,
    dropFlash: 0,
    lastClear: 0,
    clearedRows: [],
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

export function gravitySeconds(level: number): number {
  return Math.pow(Math.max(0.01, 0.8 - (level - 1) * 0.007), level - 1);
}

function recordMovement(state: BlocksGame) {
  if (!state.active) return;
  const bottom = Math.max(...cellsFor(state.active.type, state.active.rotation).map(([, y]) => y + state.active!.y));
  if (bottom > state.lowestRow) {
    state.lowestRow = bottom;
    state.lockResets = 0;
  } else if (!collides(state.board, { ...state.active, y: state.active.y + 1 }) && state.lockTimer > 0) {
    state.lockTimer = 0;
  } else if (collides(state.board, { ...state.active, y: state.active.y + 1 }) && state.lockResets < 15) {
    state.lockTimer = 0;
    state.lockResets++;
  }
}

export function move(state: BlocksGame, dx: number, dy = 0): boolean {
  if (!state.active || state.over) return false;
  const candidate = { ...state.active, x: state.active.x + dx, y: state.active.y + dy };
  if (collides(state.board, candidate)) return false;
  state.active = candidate;
  if (dy === 0) recordMovement(state);
  else if (dy > 0) {
    const bottom = Math.max(...cellsFor(state.active.type, state.active.rotation).map(([, y]) => y + state.active!.y));
    if (bottom > state.lowestRow) {
      state.lowestRow = bottom;
      state.lockResets = 0;
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

export function rotate(state: BlocksGame, direction: 1 | -1 = 1): boolean {
  const active = state.active;
  if (!active || state.over) return false;
  const to = (active.rotation + direction + 4) % 4;
  const key = `${active.rotation}>${to}`;
  const kicks = active.type === 'O' ? [[0, 0] as Kick] : (active.type === 'I' ? I_KICKS : JLSTZ)[key];
  for (const [dx, dy] of kicks) {
    const candidate = { ...active, rotation: to, x: active.x + dx, y: active.y + dy };
    if (!collides(state.board, candidate)) {
      state.active = candidate;
      recordMovement(state);
      return true;
    }
  }
  return false;
}

function scoreClear(state: BlocksGame, count: number) {
  state.lastClear = count;
  if (!count) {
    state.backToBack = false;
    return;
  }
  const base = [0, 100, 300, 500, 800][count] * state.level;
  const points = count === 4 && state.backToBack ? Math.floor(base * 1.5) : base;
  state.score += points;
  state.backToBack = count === 4;
  state.lines += count;
  state.level = Math.floor(state.lines / 10) + 1;
  state.clearFlash = 0.24;
}

export function lock(state: BlocksGame, rand: () => number = Math.random): void {
  const active = state.active;
  if (!active || state.over) return;
  for (const [dx, dy] of cellsFor(active.type, active.rotation)) {
    const x = active.x + dx;
    const y = active.y + dy;
    if (y >= 0 && y < HEIGHT && x >= 0 && x < WIDTH) state.board[y][x] = active.type;
  }
  state.lockFlash = 0.12;
  const fullyAboveVisible = cellsFor(active.type, active.rotation).every(([, dy]) => active.y + dy < VISIBLE_ROWS);
  if (fullyAboveVisible) {
    state.active = null;
    state.over = true;
    return;
  }
  state.clearedRows = state.board.flatMap((row, index) => row.every((cell) => cell !== null) ? [index] : []);
  const kept = state.board.filter((row) => row.some((cell) => cell === null));
  const cleared = HEIGHT - kept.length;
  while (kept.length < HEIGHT) kept.unshift(Array<Piece | null>(WIDTH).fill(null));
  state.board = kept;
  scoreClear(state, cleared);
  state.active = null;
  fillQueue(state, rand);
  spawn(state, takeNext(state, rand));
}

export function hardDrop(state: BlocksGame, rand: () => number = Math.random): number {
  if (!state.active || state.over) return 0;
  let distance = 0;
  while (move(state, 0, 1)) distance++;
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
  state.canHold = false;
  if (held) {
    const piece = { type: held, rotation: 0, x: 3, y: 18 };
    if (collides(state.board, piece)) state.over = true;
    else {
      state.active = piece;
      state.lockTimer = 0;
      state.lockResets = 0;
      state.lowestRow = Math.max(...cellsFor(held).map(([, y]) => y + piece.y));
    }
  } else spawn(state, takeNext(state, rand));
  state.canHold = false;
  return true;
}

export function ghostY(state: BlocksGame): number {
  if (!state.active) return 0;
  let y = state.active.y;
  while (!collides(state.board, { ...state.active, y: y + 1 })) y++;
  return y;
}
