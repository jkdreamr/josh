export const BLACK = 1 as const;
export const WHITE = -1 as const;
export type Color = typeof BLACK | typeof WHITE;
export type Stone = Color | 0;
export type Point = { x: number; y: number };
export type IllegalReason = 'occupied' | 'suicide' | 'ko' | 'out-of-bounds' | 'finished';
export type Phase = 'play' | 'mark' | 'counted' | 'resigned';

type Snapshot = {
  board: Stone[];
  toPlay: Color;
  captures: { black: number; white: number };
  consecutivePasses: number;
  phase: Phase;
  positions: string[];
  lastMove: Point | null;
  winner: Color | null;
};

export type GameState = Snapshot & {
  size: number;
  past: Snapshot[];
};

export type PlayResult = {
  ok: boolean;
  state: GameState;
  captured: number[];
  reason?: IllegalReason;
};

export type ScoreBreakdown = {
  blackStones: number;
  whiteStones: number;
  blackTerritory: number;
  whiteTerritory: number;
  black: number;
  white: number;
  komi: 7.5;
  winner: Color;
  margin: number;
  result: string;
};

export type Ownership = { black: number; white: number; neutral: number };

export function boardKey(board: readonly Stone[]): string {
  return board.join(',');
}

export function newGame(size = 9): GameState {
  const boardSize = Math.max(2, Math.min(19, Math.floor(size)));
  const board = Array<Stone>(boardSize * boardSize).fill(0);
  return {
    size: boardSize,
    board,
    toPlay: BLACK,
    captures: { black: 0, white: 0 },
    consecutivePasses: 0,
    phase: 'play',
    positions: [boardKey(board)],
    lastMove: null,
    winner: null,
    past: [],
  };
}

function indexOf(size: number, x: number, y: number): number {
  return y * size + x;
}

function neighbors(size: number, index: number): number[] {
  const x = index % size;
  const y = Math.floor(index / size);
  const result: number[] = [];
  if (x > 0) result.push(index - 1);
  if (x + 1 < size) result.push(index + 1);
  if (y > 0) result.push(index - size);
  if (y + 1 < size) result.push(index + size);
  return result;
}

function groupAt(board: readonly Stone[], size: number, start: number): { stones: number[]; liberties: Set<number> } {
  const color = board[start];
  const stones: number[] = [];
  const liberties = new Set<number>();
  const seen = new Set<number>([start]);
  const pending = [start];
  while (pending.length) {
    const current = pending.pop()!;
    stones.push(current);
    for (const next of neighbors(size, current)) {
      if (board[next] === 0) liberties.add(next);
      else if (board[next] === color && !seen.has(next)) {
        seen.add(next);
        pending.push(next);
      }
    }
  }
  return { stones, liberties };
}

export function groupStones(state: GameState, x: number, y: number): number[] {
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return [];
  const index = indexOf(state.size, x, y);
  return state.board[index] === 0 ? [] : groupAt(state.board, state.size, index).stones;
}

function isOwnEye(board: readonly Stone[], size: number, index: number, color: Color): boolean {
  if (board[index] !== 0) return false;
  const orthogonal = neighbors(size, index);
  if (orthogonal.some((point) => board[point] !== color)) return false;
  const x = index % size;
  const y = Math.floor(index / size);
  let opponentDiagonals = 0;
  const diagonals = [
    [x - 1, y - 1],
    [x + 1, y - 1],
    [x - 1, y + 1],
    [x + 1, y + 1],
  ];
  for (const [dx, dy] of diagonals) {
    if (dx < 0 || dy < 0 || dx >= size || dy >= size) continue;
    if (board[indexOf(size, dx, dy)] === -color) opponentDiagonals += 1;
  }
  return opponentDiagonals <= 1;
}

function tryPlace(
  board: readonly Stone[],
  size: number,
  x: number,
  y: number,
  color: Color,
  seen: ReadonlySet<string>,
): { board: Stone[]; captured: number[]; reason?: IllegalReason } {
  if (x < 0 || y < 0 || x >= size || y >= size) return { board: [...board], captured: [], reason: 'out-of-bounds' };
  const point = indexOf(size, x, y);
  if (board[point] !== 0) return { board: [...board], captured: [], reason: 'occupied' };
  const next = [...board];
  next[point] = color;
  const captured: number[] = [];
  const checked = new Set<number>();
  for (const adjacent of neighbors(size, point)) {
    if (next[adjacent] !== -color || checked.has(adjacent)) continue;
    const group = groupAt(next, size, adjacent);
    group.stones.forEach((stone) => checked.add(stone));
    if (group.liberties.size === 0) captured.push(...group.stones);
  }
  captured.forEach((stone) => { next[stone] = 0; });
  if (groupAt(next, size, point).liberties.size === 0) return { board: next, captured: [], reason: 'suicide' };
  if (seen.has(boardKey(next))) return { board: next, captured: [], reason: 'ko' };
  return { board: next, captured };
}

function snapshot(state: GameState): Snapshot {
  return {
    board: [...state.board],
    toPlay: state.toPlay,
    captures: { ...state.captures },
    consecutivePasses: state.consecutivePasses,
    phase: state.phase,
    positions: [...state.positions],
    lastMove: state.lastMove ? { ...state.lastMove } : null,
    winner: state.winner,
  };
}

export function play(state: GameState, x: number, y: number): PlayResult {
  if (state.phase !== 'play') return { ok: false, state, captured: [], reason: 'finished' };
  const result = tryPlace(state.board, state.size, x, y, state.toPlay, new Set(state.positions));
  if (result.reason) return { ok: false, state, captured: [], reason: result.reason };
  const nextColor = state.toPlay;
  const key = boardKey(result.board);
  return {
    ok: true,
    captured: result.captured,
    state: {
      ...state,
      board: result.board,
      toPlay: nextColor === BLACK ? WHITE : BLACK,
      captures: {
        black: state.captures.black + (nextColor === BLACK ? result.captured.length : 0),
        white: state.captures.white + (nextColor === WHITE ? result.captured.length : 0),
      },
      consecutivePasses: 0,
      positions: [...state.positions, key],
      past: [...state.past, snapshot(state)],
      lastMove: { x, y },
      winner: null,
    },
  };
}

export function pass(state: GameState): GameState {
  if (state.phase !== 'play') return state;
  const consecutivePasses = state.consecutivePasses + 1;
  return {
    ...state,
    toPlay: state.toPlay === BLACK ? WHITE : BLACK,
    consecutivePasses,
    phase: consecutivePasses >= 2 ? 'mark' : 'play',
    past: [...state.past, snapshot(state)],
    lastMove: null,
  };
}

export function resign(state: GameState): GameState {
  if (state.phase !== 'play') return state;
  return {
    ...state,
    phase: 'resigned',
    winner: state.toPlay === BLACK ? WHITE : BLACK,
    past: [...state.past, snapshot(state)],
  };
}

export function undo(state: GameState): GameState | null {
  const previous = state.past.at(-1);
  if (!previous) return null;
  return {
    ...previous,
    size: state.size,
    past: state.past.slice(0, -1),
  };
}

export function legalMoves(state: GameState): Point[] {
  if (state.phase !== 'play') return [];
  const seen = new Set(state.positions);
  const moves: Point[] = [];
  for (let y = 0; y < state.size; y += 1) {
    for (let x = 0; x < state.size; x += 1) {
      const index = indexOf(state.size, x, y);
      if (state.board[index] !== 0) continue;
      if (!tryPlace(state.board, state.size, x, y, state.toPlay, seen).reason) moves.push({ x, y });
    }
  }
  return moves;
}

function territoryOwners(board: readonly Stone[], size: number): Stone[] {
  const owners = [...board];
  const seen = new Set<number>();
  for (let start = 0; start < board.length; start += 1) {
    if (board[start] !== 0 || seen.has(start)) continue;
    const region: number[] = [];
    const boundary = new Set<Color>();
    const pending = [start];
    seen.add(start);
    while (pending.length) {
      const current = pending.pop()!;
      region.push(current);
      for (const next of neighbors(size, current)) {
        if (board[next] === 0 && !seen.has(next)) {
          seen.add(next);
          pending.push(next);
        } else if (board[next] !== 0) boundary.add(board[next] as Color);
      }
    }
    if (boundary.size === 1) region.forEach((point) => { owners[point] = [...boundary][0]; });
  }
  return owners;
}

export function score(state: GameState, deadSet: ReadonlySet<number> | readonly number[] = new Set()): ScoreBreakdown {
  const dead = deadSet instanceof Set ? deadSet : new Set(deadSet);
  const board = [...state.board];
  dead.forEach((point) => {
    if (board[point] !== 0) board[point] = 0;
  });
  const owners = territoryOwners(board, state.size);
  const blackStones = board.filter((stone) => stone === BLACK).length;
  const whiteStones = board.filter((stone) => stone === WHITE).length;
  const blackTerritory = owners.filter((owner, index) => board[index] === 0 && owner === BLACK).length;
  const whiteTerritory = owners.filter((owner, index) => board[index] === 0 && owner === WHITE).length;
  const black = blackStones + blackTerritory;
  const white = whiteStones + whiteTerritory + 7.5;
  const margin = Math.abs(black - white);
  const winner = black > white ? BLACK : WHITE;
  return {
    blackStones,
    whiteStones,
    blackTerritory,
    whiteTerritory,
    black,
    white,
    komi: 7.5,
    winner,
    margin,
    result: `${winner === BLACK ? 'B' : 'W'}+${margin.toFixed(1)}`,
  };
}

function playout(boardStart: readonly Stone[], size: number, colorStart: Color, positionHistory: readonly string[]): Stone[] {
  const board = [...boardStart];
  const seen = new Set(positionHistory);
  let color = colorStart;
  let passes = 0;
  const moveLimit = size * size * 2;
  for (let move = 0; move < moveLimit && passes < 2; move += 1) {
    let selected: Stone[] | null = null;
    const offset = Math.floor(Math.random() * board.length);
    for (let scan = 0; scan < board.length; scan += 1) {
      const point = (offset + scan) % board.length;
      if (board[point] !== 0 || isOwnEye(board, size, point, color)) continue;
      const x = point % size;
      const y = Math.floor(point / size);
      const result = tryPlace(board, size, x, y, color, seen);
      if (!result.reason) {
        selected = result.board;
        break;
      }
    }
    if (!selected) {
      passes += 1;
      color = color === BLACK ? WHITE : BLACK;
      continue;
    }
    for (let point = 0; point < board.length; point += 1) board[point] = selected[point];
    seen.add(boardKey(board));
    color = color === BLACK ? WHITE : BLACK;
    passes = 0;
  }
  return board;
}

export function ownership(state: GameState, n = 400): Ownership[] {
  const counts = Array.from({ length: state.board.length }, () => ({ black: 0, white: 0, neutral: 0 }));
  const playouts = Math.max(1, Math.floor(n));
  for (let simulation = 0; simulation < playouts; simulation += 1) {
    const board = playout(state.board, state.size, state.toPlay, state.positions);
    const owners = territoryOwners(board, state.size);
    owners.forEach((owner, point) => {
      if (owner === BLACK) counts[point].black += 1;
      else if (owner === WHITE) counts[point].white += 1;
      else counts[point].neutral += 1;
    });
  }
  return counts.map((count) => ({
    black: count.black / playouts,
    white: count.white / playouts,
    neutral: count.neutral / playouts,
  }));
}

function heuristic(state: GameState, point: Point): number {
  const result = tryPlace(state.board, state.size, point.x, point.y, state.toPlay, new Set(state.positions));
  if (result.reason) return -Infinity;
  let value = result.captured.length * 4;
  const index = indexOf(state.size, point.x, point.y);
  for (const adjacent of neighbors(state.size, index)) {
    if (state.board[adjacent] === state.toPlay) value += 0.2;
    else if (state.board[adjacent] === -state.toPlay) value += 0.1;
  }
  const center = (state.size - 1) / 2;
  value -= (Math.abs(point.x - center) + Math.abs(point.y - center)) * 0.01;
  return value;
}

export function aiMove(state: GameState, budgetMs = 700): Point | null {
  const candidates = legalMoves(state).filter((point) => !isOwnEye(state.board, state.size, indexOf(state.size, point.x, point.y), state.toPlay));
  if (!candidates.length) return null;
  const start = performance.now();
  const budget = Math.max(1, budgetMs);
  const wins = Array<number>(candidates.length).fill(0);
  const visits = Array<number>(candidates.length).fill(0);
  const moveLimit = state.size * state.size * 2;
  let iteration = 0;
  while (performance.now() - start < budget) {
    const candidateIndex = iteration % candidates.length;
    const candidate = candidates[candidateIndex];
    const nextBoard = tryPlace(state.board, state.size, candidate.x, candidate.y, state.toPlay, new Set(state.positions)).board;
    const history = [...state.positions, boardKey(nextBoard)];
    const finalBoard = playout(nextBoard, state.size, state.toPlay === BLACK ? WHITE : BLACK, history);
    const finalScore = score({ ...state, board: finalBoard, positions: history });
    const margin = (finalScore.black - finalScore.white) * state.toPlay;
    wins[candidateIndex] += margin > 0 ? 1 : margin === 0 ? 0.5 : 0;
    visits[candidateIndex] += 1;
    iteration += 1;
  }
  let best = 0;
  let bestRate = -Infinity;
  for (let index = 0; index < candidates.length; index += 1) {
    const rate = visits[index] ? wins[index] / visits[index] : 0.5 + heuristic(state, candidates[index]) * 1e-4;
    if (rate > bestRate) {
      bestRate = rate;
      best = index;
    }
  }
  return candidates[best] ?? candidates[0];
}
