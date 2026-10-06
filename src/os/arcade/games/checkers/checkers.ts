// American checkers (English draughts) rules and a minimax computer player. Pure module, no DOM.
// Board: 64 squares, index = row * 8 + col, row 0 at the top. Play happens on the dark squares ((row + col) odd).
// Red starts at the bottom and moves up (toward row 0); black starts at the top and moves down.

export const RED = 1;
export const BLACK = 2;
export const KING = 4;
export type Color = 1 | 2;
export type Board = Uint8Array;
export type Level = 0 | 1 | 2;

export const colorOf = (p: number): Color => (p & 3) as Color;
export const isKing = (p: number) => (p & KING) !== 0;
export const other = (c: Color): Color => (c === RED ? BLACK : RED);
export const rowOf = (i: number) => i >> 3;
export const colOf = (i: number) => i & 7;
export const sq = (row: number, col: number) => row * 8 + col;
export const dark = (i: number) => ((rowOf(i) + colOf(i)) & 1) === 1;

export type Move = {
  from: number;
  to: number;
  /** Every square the piece lands on, in order (one entry for a plain move). */
  path: number[];
  /** Squares of captured pieces, in order. */
  captured: number[];
};

export function startBoard(): Board {
  const b = new Uint8Array(64);
  for (let i = 0; i < 64; i++) {
    if (!dark(i)) continue;
    if (rowOf(i) < 3) b[i] = BLACK;
    else if (rowOf(i) > 4) b[i] = RED;
  }
  return b;
}

const DIRS: [number, number][] = [
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

function dirsFor(p: number): [number, number][] {
  if (isKing(p)) return DIRS;
  return colorOf(p) === RED ? [DIRS[0], DIRS[1]] : [DIRS[2], DIRS[3]];
}

const inside = (r: number, c: number) => r >= 0 && r < 8 && c >= 0 && c < 8;
const promotes = (p: number, to: number) => !isKing(p) && (colorOf(p) === RED ? rowOf(to) === 0 : rowOf(to) === 7);

function jumpsFrom(b: Board, from: number, cur: number, p: number, path: number[], captured: number[], out: Move[]) {
  let extended = false;
  const r = rowOf(cur);
  const c = colOf(cur);
  for (const [dr, dc] of dirsFor(p)) {
    const mr = r + dr;
    const mc = c + dc;
    const lr = r + dr * 2;
    const lc = c + dc * 2;
    if (!inside(lr, lc)) continue;
    const mid = sq(mr, mc);
    const land = sq(lr, lc);
    if (!b[mid] || colorOf(b[mid]) === colorOf(p) || captured.includes(mid)) continue;
    if (b[land] && land !== from) continue;
    extended = true;
    const nextPath = [...path, land];
    const nextCap = [...captured, mid];
    // Crowning ends the turn.
    if (promotes(p, land)) out.push({ from, to: land, path: nextPath, captured: nextCap });
    else jumpsFrom(b, from, land, p, nextPath, nextCap, out);
  }
  if (!extended && captured.length) out.push({ from, to: cur, path, captured });
}

/** Legal moves for `side`. Captures are mandatory and multi-jumps must be completed. */
export function legalMoves(b: Board, side: Color): Move[] {
  const jumps: Move[] = [];
  const steps: Move[] = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p || colorOf(p) !== side) continue;
    jumpsFrom(b, i, i, p, [], [], jumps);
    if (jumps.length) continue;
    const r = rowOf(i);
    const c = colOf(i);
    for (const [dr, dc] of dirsFor(p)) {
      const nr = r + dr;
      const nc = c + dc;
      if (!inside(nr, nc)) continue;
      const to = sq(nr, nc);
      if (!b[to]) steps.push({ from: i, to, path: [to], captured: [] });
    }
  }
  return jumps.length ? jumps : steps;
}

export function applyMove(b: Board, m: Move): Board {
  const out = new Uint8Array(b);
  let p = out[m.from];
  out[m.from] = 0;
  for (const c of m.captured) out[c] = 0;
  if (promotes(p, m.to)) p |= KING;
  out[m.to] = p;
  return out;
}

export function count(b: Board, side: Color) {
  let men = 0;
  let kings = 0;
  for (let i = 0; i < 64; i++) {
    if (b[i] && colorOf(b[i]) === side) {
      if (isKing(b[i])) kings++;
      else men++;
    }
  }
  return { men, kings };
}

export type Status = 'playing' | 'red' | 'black' | 'draw';
export const DRAW_PLIES = 80;

/** Side to move with no legal moves loses. 40 moves each (80 plies) without a capture or a man moving is a draw. */
export function statusOf(_b: Board, side: Color, legal: number, quietPlies: number): Status {
  if (legal === 0) return side === RED ? 'black' : 'red';
  if (quietPlies >= DRAW_PLIES) return 'draw';
  return 'playing';
}

export type Game = {
  board: Board;
  turn: Color;
  legal: Move[];
  status: Status;
  quietPlies: number;
  history: Move[];
};

export function newGame(): Game {
  const board = startBoard();
  const legal = legalMoves(board, RED);
  return { board, turn: RED, legal, status: statusOf(board, RED, legal.length, 0), quietPlies: 0, history: [] };
}

export function play(g: Game, m: Move): Game {
  const piece = g.board[m.from];
  const board = applyMove(g.board, m);
  const turn = other(g.turn);
  const legal = legalMoves(board, turn);
  const quiet = m.captured.length === 0 && isKing(piece) ? g.quietPlies + 1 : 0;
  return { board, turn, legal, status: statusOf(board, turn, legal.length, quiet), quietPlies: quiet, history: [...g.history, m] };
}

/** Find the legal move from a square, optionally through an exact destination. */
export function movesFrom(legal: Move[], from: number) {
  return legal.filter((m) => m.from === from);
}

// Evaluation: material, advancement for men, back-rank guards, and a little centre and mobility.
const MAN = 100;
const KING_V = 165;
function evaluate(b: Board, me: Color): number {
  let s = 0;
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const c = colorOf(p);
    const sign = c === me ? 1 : -1;
    const r = rowOf(i);
    const col = colOf(i);
    let v: number;
    if (isKing(p)) v = KING_V;
    else {
      const adv = c === RED ? 7 - r : r;
      v = MAN + adv * 4;
      if ((c === RED && r === 7) || (c === BLACK && r === 0)) v += 6;
    }
    if (col === 0 || col === 7) v -= 3;
    else if (col >= 2 && col <= 5 && r >= 2 && r <= 5) v += 3;
    s += sign * v;
  }
  return s;
}

const WIN = 100000;

function search(b: Board, side: Color, me: Color, depth: number, alpha: number, beta: number, ply: number): number {
  const moves = legalMoves(b, side);
  if (moves.length === 0) return side === me ? -(WIN - ply) : WIN - ply;
  // Forced single capture sequences do not count toward depth, so tactics resolve fully.
  if (depth <= 0 && !(moves.length === 1 && moves[0].captured.length)) return evaluate(b, me);
  if (moves.length > 1) moves.sort((x, y) => y.captured.length - x.captured.length);
  const maximizing = side === me;
  let best = maximizing ? -Infinity : Infinity;
  for (const m of moves) {
    const v = search(applyMove(b, m), other(side), me, depth - 1, alpha, beta, ply + 1);
    if (maximizing) {
      best = Math.max(best, v);
      alpha = Math.max(alpha, v);
    } else {
      best = Math.min(best, v);
      beta = Math.min(beta, v);
    }
    if (alpha >= beta) break;
  }
  return best;
}

const DEPTH: Record<Level, number> = { 0: 2, 1: 5, 2: 8 };
export type Rng = () => number;

/** Best move for the side to move. Easy mode occasionally plays a random legal move. */
export function bestMove(b: Board, side: Color, level: Level, rng: Rng = Math.random): Move | null {
  const moves = legalMoves(b, side);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  if (level === 0 && rng() < 0.25) return moves[Math.floor(rng() * moves.length)];
  moves.sort((x, y) => y.captured.length - x.captured.length);
  let best = moves[0];
  let bestV = -Infinity;
  let alpha = -Infinity;
  for (const m of moves) {
    const v = search(applyMove(b, m), other(side), side, DEPTH[level] - 1, alpha, Infinity, 1);
    if (v > bestV || (v === bestV && rng() < 0.5)) {
      bestV = v;
      best = m;
    }
    alpha = Math.max(alpha, v);
  }
  return best;
}

/** Parse a picture of the board, top row first: '.' empty, 'r'/'R' red man/king, 'b'/'B' black man/king. */
export function parse(rows: string[]): Board {
  const b = new Uint8Array(64);
  rows.forEach((line, r) => {
    for (let c = 0; c < 8; c++) {
      const ch = line[c];
      b[sq(r, c)] = ch === 'r' ? RED : ch === 'R' ? RED | KING : ch === 'b' ? BLACK : ch === 'B' ? BLACK | KING : 0;
    }
  });
  return b;
}
