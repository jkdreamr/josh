// Connect Four rules and a minimax computer player. Pure module, no DOM.

export const COLS = 7;
export const ROWS = 6;
export const CELLS = COLS * ROWS;

export type Cell = 0 | 1 | 2;
export type Player = 1 | 2;
export type Board = Cell[];
export type Level = 0 | 1 | 2;

export const idx = (col: number, row: number) => row * COLS + col;
export const colOf = (i: number) => i % COLS;
export const rowOf = (i: number) => Math.floor(i / COLS);
export const other = (p: Player): Player => (p === 1 ? 2 : 1);

export function createBoard(): Board {
  return new Array<Cell>(CELLS).fill(0);
}

/** Every 4-in-a-row window on the board, as cell indices. */
export const LINES: number[][] = (() => {
  const out: number[][] = [];
  const dirs = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1],
  ];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dc, dr] of dirs) {
        const ec = c + dc * 3;
        const er = r + dr * 3;
        if (ec < 0 || ec >= COLS || er < 0 || er >= ROWS) continue;
        out.push([0, 1, 2, 3].map((k) => idx(c + dc * k, r + dr * k)));
      }
  return out;
})();

const LINES_AT: number[][] = (() => {
  const at: number[][] = Array.from({ length: CELLS }, () => []);
  LINES.forEach((line, li) => line.forEach((i) => at[i].push(li)));
  return at;
})();

/** Lowest empty row in a column, or -1 when full. */
export function dropRow(b: Board, col: number): number {
  if (col < 0 || col >= COLS) return -1;
  for (let r = 0; r < ROWS; r++) if (b[idx(col, r)] === 0) return r;
  return -1;
}

export function legalCols(b: Board): number[] {
  const out: number[] = [];
  for (let c = 0; c < COLS; c++) if (b[idx(c, ROWS - 1)] === 0) out.push(c);
  return out;
}

/** Returns a new board with the disc placed, and the row it landed on. */
export function drop(b: Board, col: number, p: Player): { board: Board; row: number } | null {
  const row = dropRow(b, col);
  if (row < 0) return null;
  const board = b.slice();
  board[idx(col, row)] = p;
  return { board, row };
}

/** The winning window through `cell` (the last move), or null. */
export function winLine(b: Board, cell: number): number[] | null {
  const p = b[cell];
  if (!p) return null;
  for (const li of LINES_AT[cell]) {
    const line = LINES[li];
    if (b[line[0]] === p && b[line[1]] === p && b[line[2]] === p && b[line[3]] === p) return line;
  }
  return null;
}

/** Any winning window on the board (used when the last move is unknown). */
export function findWin(b: Board): { player: Player; line: number[] } | null {
  for (const line of LINES) {
    const p = b[line[0]];
    if (p && b[line[1]] === p && b[line[2]] === p && b[line[3]] === p) return { player: p, line };
  }
  return null;
}

export const isFull = (b: Board) => legalCols(b).length === 0;

// Scoring: windows that one side can still complete, weighted by how full they are,
// plus a small bonus for centre control.
const WINDOW_SCORE = [0, 1, 6, 40];
const CENTRE_BONUS = [0, 1, 2, 4, 2, 1, 0];

export function evaluate(b: Board, me: Player): number {
  let score = 0;
  const you = other(me);
  for (const line of LINES) {
    let mine = 0;
    let theirs = 0;
    for (const i of line) {
      if (b[i] === me) mine++;
      else if (b[i] === you) theirs++;
    }
    if (mine && theirs) continue;
    if (mine) score += WINDOW_SCORE[mine];
    else if (theirs) score -= WINDOW_SCORE[theirs];
  }
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++) {
      const v = b[idx(c, r)];
      if (v === me) score += CENTRE_BONUS[c];
      else if (v === you) score -= CENTRE_BONUS[c];
    }
  return score;
}

const WIN = 100000;
const ORDER = [3, 2, 4, 1, 5, 0, 6];

function search(b: Board, p: Player, depth: number, alpha: number, beta: number, me: Player, ply: number): number {
  const cols = ORDER.filter((c) => b[idx(c, ROWS - 1)] === 0);
  if (cols.length === 0) return 0;
  if (depth === 0) return evaluate(b, me);
  let best = -Infinity;
  for (const c of cols) {
    const d = drop(b, c, p)!;
    const cell = idx(c, d.row);
    let v: number;
    if (winLine(d.board, cell)) v = (p === me ? 1 : -1) * (WIN - ply);
    else v = search(d.board, other(p), depth - 1, alpha, beta, me, ply + 1);
    if (p === me) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best === -Infinity ? Infinity : best, v);
      beta = Math.min(beta, v);
    }
    if (alpha >= beta) break;
  }
  return best;
}

export type Rng = () => number;

const DEPTH: Record<Level, number> = { 0: 2, 1: 5, 2: 8 };

/** Best column for `me`. Easy plays a loose, occasionally random game; hard searches 8 plies. */
export function bestCol(b: Board, me: Player, level: Level, rng: Rng = Math.random): number {
  const cols = ORDER.filter((c) => b[idx(c, ROWS - 1)] === 0);
  if (cols.length === 0) return -1;
  // Always take a win, always block a loss. Even easy mode does this, so it never feels broken.
  for (const c of cols) {
    const d = drop(b, c, me)!;
    if (winLine(d.board, idx(c, d.row))) return c;
  }
  const you = other(me);
  for (const c of cols) {
    const d = drop(b, c, you)!;
    if (winLine(d.board, idx(c, d.row))) return c;
  }
  if (level === 0 && rng() < 0.3) return cols[Math.floor(rng() * cols.length)];
  let bestC = cols[0];
  let bestV = -Infinity;
  let alpha = -Infinity;
  for (const c of cols) {
    const d = drop(b, c, me)!;
    const v = search(d.board, you, DEPTH[level] - 1, alpha, Infinity, me, 1);
    if (v > bestV || (v === bestV && rng() < 0.5)) {
      bestV = v;
      bestC = c;
    }
    alpha = Math.max(alpha, v);
  }
  return bestC;
}

/** Parse a picture of the board, top row first, with '.', 'r' (player 1) and 'y' (player 2). Handy for tests. */
export function parse(rows: string[]): Board {
  const b = createBoard();
  rows.forEach((line, i) => {
    const r = ROWS - 1 - i;
    for (let c = 0; c < COLS; c++) {
      const ch = line[c];
      b[idx(c, r)] = ch === 'r' ? 1 : ch === 'y' ? 2 : 0;
    }
  });
  return b;
}
