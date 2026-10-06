export const OMOK_SIZE = 15;
export type OmokColor = 1 | -1;
export type OmokPoint = { x: number; y: number };
export type OmokLevel = 'easy' | 'normal';

type Snapshot = {
  board: Array<OmokColor | 0>;
  toPlay: OmokColor;
  winner: OmokColor | 0 | null;
  winLine: OmokPoint[];
  lastMove: OmokPoint | null;
};

export type OmokState = Snapshot & {
  size: 15;
  past: Snapshot[];
};

export type OmokPlayResult = {
  ok: boolean;
  state: OmokState;
  reason?: 'occupied' | 'finished';
};

const DIRECTIONS: OmokPoint[] = [
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
];

function indexOf(x: number, y: number): number {
  return y * OMOK_SIZE + x;
}

function snapshot(state: OmokState): Snapshot {
  return {
    board: [...state.board],
    toPlay: state.toPlay,
    winner: state.winner,
    winLine: state.winLine.map((point) => ({ ...point })),
    lastMove: state.lastMove ? { ...state.lastMove } : null,
  };
}

export function newOmok(): OmokState {
  return {
    size: OMOK_SIZE,
    board: Array<OmokColor | 0>(OMOK_SIZE * OMOK_SIZE).fill(0),
    toPlay: 1,
    winner: null,
    winLine: [],
    lastMove: null,
    past: [],
  };
}

function winningLine(board: readonly (OmokColor | 0)[], x: number, y: number, color: OmokColor): OmokPoint[] {
  for (const direction of DIRECTIONS) {
    const before: OmokPoint[] = [];
    const after: OmokPoint[] = [];
    for (let step = 1; step < 15; step += 1) {
      const point = { x: x - direction.x * step, y: y - direction.y * step };
      if (point.x < 0 || point.y < 0 || point.x >= OMOK_SIZE || point.y >= OMOK_SIZE || board[indexOf(point.x, point.y)] !== color) break;
      before.unshift(point);
    }
    for (let step = 1; step < 15; step += 1) {
      const point = { x: x + direction.x * step, y: y + direction.y * step };
      if (point.x < 0 || point.y < 0 || point.x >= OMOK_SIZE || point.y >= OMOK_SIZE || board[indexOf(point.x, point.y)] !== color) break;
      after.push(point);
    }
    const line = [...before, { x, y }, ...after];
    if (line.length >= 5) {
      const last = before.length;
      const start = Math.max(0, Math.min(last - 4, line.length - 5));
      return line.slice(start, start + 5);
    }
  }
  return [];
}

export function playOmok(state: OmokState, x: number, y: number): OmokPlayResult {
  if (state.winner !== null) return { ok: false, state, reason: 'finished' };
  if (x < 0 || y < 0 || x >= OMOK_SIZE || y >= OMOK_SIZE || state.board[indexOf(x, y)] !== 0) {
    return { ok: false, state, reason: 'occupied' };
  }
  const board = [...state.board];
  board[indexOf(x, y)] = state.toPlay;
  const winLine = winningLine(board, x, y, state.toPlay);
  const winner = winLine.length ? state.toPlay : board.every((stone) => stone !== 0) ? 0 : null;
  const next: OmokState = {
    ...state,
    board,
    toPlay: state.toPlay === 1 ? -1 : 1,
    winner,
    winLine,
    lastMove: { x, y },
    past: [...state.past, snapshot(state)],
  };
  return { ok: true, state: next };
}

export function undoOmok(state: OmokState): OmokState | null {
  const previous = state.past[state.past.length - 1];
  if (!previous) return null;
  return {
    ...previous,
    size: OMOK_SIZE,
    past: state.past.slice(0, -1),
  };
}

function directionalScore(board: readonly (OmokColor | 0)[], x: number, y: number, color: OmokColor, dx: number, dy: number): number {
  let before = 0;
  let after = 0;
  let openEnds = 0;
  for (let step = 1; step < 15; step += 1) {
    const px = x - dx * step;
    const py = y - dy * step;
    if (px < 0 || py < 0 || px >= OMOK_SIZE || py >= OMOK_SIZE) break;
    const stone = board[indexOf(px, py)];
    if (stone !== color) {
      if (stone === 0) openEnds += 1;
      break;
    }
    before += 1;
  }
  for (let step = 1; step < 15; step += 1) {
    const px = x + dx * step;
    const py = y + dy * step;
    if (px < 0 || py < 0 || px >= OMOK_SIZE || py >= OMOK_SIZE) break;
    const stone = board[indexOf(px, py)];
    if (stone !== color) {
      if (stone === 0) openEnds += 1;
      break;
    }
    after += 1;
  }
  const run = before + 1 + after;
  if (run >= 5) return 1_000_000;
  if (run === 4) return openEnds === 2 ? 100_000 : 10_000;
  if (run === 3) return openEnds === 2 ? 5_000 : 500;
  if (run === 2) return openEnds === 2 ? 200 : 50;
  return 0;
}

function scoreAt(board: readonly (OmokColor | 0)[], x: number, y: number, color: OmokColor): number {
  if (board[indexOf(x, y)] !== 0) return 0;
  const next = [...board];
  next[indexOf(x, y)] = color;
  return DIRECTIONS.reduce((score, direction) => score + directionalScore(next, x, y, color, direction.x, direction.y), 0);
}

function candidatePoints(board: readonly (OmokColor | 0)[]): OmokPoint[] {
  const points = new Map<number, OmokPoint>();
  for (let y = 0; y < OMOK_SIZE; y += 1) {
    for (let x = 0; x < OMOK_SIZE; x += 1) {
      if (board[indexOf(x, y)] === 0) continue;
      for (let dy = -2; dy <= 2; dy += 1) {
        for (let dx = -2; dx <= 2; dx += 1) {
          const px = x + dx;
          const py = y + dy;
          if (px < 0 || py < 0 || px >= OMOK_SIZE || py >= OMOK_SIZE || board[indexOf(px, py)] !== 0) continue;
          points.set(indexOf(px, py), { x: px, y: py });
        }
      }
    }
  }
  if (!points.size && board.some((stone) => stone !== 0)) return [];
  if (!points.size) return [{ x: 7, y: 7 }];
  return [...points.values()];
}

function chooseBest(points: OmokPoint[], score: (point: OmokPoint) => number): OmokPoint | null {
  if (!points.length) return null;
  let bestScore = -Infinity;
  let best: OmokPoint[] = [];
  for (const point of points) {
    const value = score(point);
    if (value > bestScore) {
      bestScore = value;
      best = [point];
    } else if (value === bestScore) {
      best.push(point);
    }
  }
  return best[Math.floor(Math.random() * best.length)] ?? null;
}

export function omokAiMove(state: OmokState, level: OmokLevel = 'normal'): OmokPoint | null {
  if (state.winner !== null) return null;
  const candidates = candidatePoints(state.board);
  const stoneCount = state.board.filter((stone) => stone !== 0).length;
  if (stoneCount === 0) return { x: 7, y: 7 };
  if (stoneCount === 1) return chooseBest(candidates, (point) => -((point.x - 7) ** 2 + (point.y - 7) ** 2));
  const attack = (point: OmokPoint) => scoreAt(state.board, point.x, point.y, state.toPlay);
  const defense = (point: OmokPoint) => scoreAt(state.board, point.x, point.y, state.toPlay === 1 ? -1 : 1);

  const winningMove = chooseBest(candidates.filter((point) => attack(point) >= 1_000_000), attack);
  if (winningMove) return winningMove;

  const blockWin = chooseBest(candidates.filter((point) => defense(point) >= 1_000_000), attack);
  if (blockWin) return blockWin;

  const openFour = chooseBest(candidates.filter((point) => attack(point) >= 100_000), attack);
  if (openFour) return openFour;

  const threats = candidates.filter((point) => defense(point) >= 5_000);
  const canMissOpenThree = level === 'easy' && threats.length > 0 && Math.random() < 0.35;
  if (threats.length && !canMissOpenThree) return chooseBest(threats, (point) => defense(point));

  return chooseBest(candidates, (point) => 1.1 * attack(point) + defense(point) + (level === 'easy' ? Math.random() * 4_000 : 0));
}
