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

export type Rng = () => number;

// The computer player: negamax with alpha-beta, a transposition table and iterative deepening. It never misses an
// immediate win or block, never plays under a cell the other side wins on unless it has to, and solves the endgame
// exactly once the search reaches the last disc. Easy and Normal search shallowly and loosen their choice; Hard keeps
// deepening until its node budget runs out.

const WIN = 1_000_000;
const ORDER = [3, 2, 4, 1, 5, 0, 6];
const isWinScore = (v: number) => Math.abs(v) > WIN - 100;

/** Zobrist keys: two 32 bit halves per cell and player. */
const ZOB = (() => {
  let s = 0x9e3779b9;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s | 0;
  };
  const a = new Int32Array(CELLS * 3);
  const b = new Int32Array(CELLS * 3);
  for (let i = 0; i < CELLS * 3; i++) {
    a[i] = next();
    b[i] = next();
  }
  return { a, b };
})();

const TT_BITS = 18;
const TT_SIZE = 1 << TT_BITS;
const TT_MASK = TT_SIZE - 1;
const EXACT = 1;
const LOWER = 2;
const UPPER = 3;
type Table = { check: Int32Array; value: Int32Array; depth: Int8Array; flag: Int8Array; move: Int8Array };
let table: Table | null = null;
function freshTable(): Table {
  if (!table) table = { check: new Int32Array(TT_SIZE), value: new Int32Array(TT_SIZE), depth: new Int8Array(TT_SIZE), flag: new Int8Array(TT_SIZE), move: new Int8Array(TT_SIZE) };
  else table.flag.fill(0);
  return table;
}

const DIRS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1],
];

class Search {
  cells: Int8Array;
  heights = new Int8Array(COLS);
  h1 = 0;
  h2 = 0;
  nodes = 0;
  maxNodes: number;
  deadline: number;
  stopped = false;
  tt: Table;

  constructor(b: Board, maxNodes: number, ms: number) {
    this.cells = Int8Array.from(b);
    for (let c = 0; c < COLS; c++) {
      const r = dropRow(b, c);
      this.heights[c] = r < 0 ? ROWS : r;
    }
    for (let i = 0; i < CELLS; i++)
      if (b[i]) {
        this.h1 ^= ZOB.a[i * 3 + b[i]];
        this.h2 ^= ZOB.b[i * 3 + b[i]];
      }
    this.maxNodes = maxNodes;
    this.deadline = ms > 0 ? now() + ms : Infinity;
    this.tt = freshTable();
  }

  /** Would `p` complete four by playing at (col, row)? The cell itself is assumed empty. */
  winsAt(col: number, row: number, p: number): boolean {
    const cells = this.cells;
    for (const [dc, dr] of DIRS) {
      let n = 1;
      for (let c = col + dc, r = row + dr; c >= 0 && c < COLS && r >= 0 && r < ROWS && cells[r * COLS + c] === p; c += dc, r += dr) n++;
      for (let c = col - dc, r = row - dr; c >= 0 && c < COLS && r >= 0 && r < ROWS && cells[r * COLS + c] === p; c -= dc, r -= dr) n++;
      if (n >= 4) return true;
    }
    return false;
  }

  play(col: number, p: number) {
    const i = this.heights[col] * COLS + col;
    this.cells[i] = p;
    this.heights[col]++;
    this.h1 ^= ZOB.a[i * 3 + p];
    this.h2 ^= ZOB.b[i * 3 + p];
  }

  undo(col: number, p: number) {
    this.heights[col]--;
    const i = this.heights[col] * COLS + col;
    this.cells[i] = 0;
    this.h1 ^= ZOB.a[i * 3 + p];
    this.h2 ^= ZOB.b[i * 3 + p];
  }

  empties(): number {
    let n = 0;
    for (let c = 0; c < COLS; c++) n += ROWS - this.heights[c];
    return n;
  }

  /** Static score for `p`, the side to move: open windows, plus threats weighted by the odd/even rule. */
  eval(p: number): number {
    const cells = this.cells;
    const heights = this.heights;
    let score = 0;
    const q = 3 - p;
    for (const line of LINES) {
      let a = 0;
      let b = 0;
      let gap = -1;
      for (let k = 0; k < 4; k++) {
        const v = cells[line[k]];
        if (v === p) a++;
        else if (v === q) b++;
        else gap = line[k];
      }
      if (a && b) continue;
      if (a === 3 || b === 3) {
        // A threat. One on a row its owner can claim by parity (odd rows for the first player, even for the second)
        // is worth far more than one the other side can simply wait out.
        const owner = a === 3 ? p : q;
        const r = Math.floor(gap / COLS);
        const c = gap % COLS;
        const firstPlayerRow = r % 2 === 0;
        const ownerFirst = (owner === 1) === firstPlayerRow;
        let w = ownerFirst ? 90 : 35;
        if (r > heights[c] + 1) w += 10;
        score += owner === p ? w : -w;
      } else if (a) score += WINDOW_SCORE[a];
      else if (b) score -= WINDOW_SCORE[b];
    }
    for (let r = 0; r < ROWS; r++)
      for (let c = 1; c < COLS - 1; c++) {
        const v = cells[r * COLS + c];
        if (v === p) score += CENTRE_BONUS[c];
        else if (v === q) score -= CENTRE_BONUS[c];
      }
    return score;
  }

  /** Windows through `cell` that `p` (who just played there) now holds three of with the fourth empty. */
  newThreats(cell: number, p: number): number {
    const cells = this.cells;
    let n = 0;
    for (const li of LINES_AT[cell]) {
      const line = LINES[li];
      let mine = 0;
      let empty = 0;
      for (let k = 0; k < 4; k++) {
        const v = cells[line[k]];
        if (v === p) mine++;
        else if (v === 0) empty++;
      }
      if (mine === 3 && empty === 1) n++;
    }
    return n;
  }

  negamax(depth: number, alpha: number, beta: number, p: number, ply: number): number {
    if ((++this.nodes & 1023) === 0 && (this.nodes > this.maxNodes || now() > this.deadline)) this.stopped = true;
    if (this.stopped) return 0;
    const heights = this.heights;
    const q = 3 - p;
    let playable = 0;
    for (let c = 0; c < COLS; c++) {
      if (heights[c] >= ROWS) continue;
      playable++;
      if (this.winsAt(c, heights[c], p)) return WIN - ply;
    }
    if (!playable) return 0;
    let forced = -1;
    for (let c = 0; c < COLS; c++) {
      if (heights[c] >= ROWS || !this.winsAt(c, heights[c], q)) continue;
      if (forced >= 0) return -(WIN - ply - 1);
      forced = c;
    }
    // Moves that don't put a disc right under a cell the other side wins on.
    const moves: number[] = [];
    if (forced >= 0) {
      if (heights[forced] + 1 < ROWS && this.winsAt(forced, heights[forced] + 1, q)) return -(WIN - ply - 2);
      moves.push(forced);
    } else {
      for (const c of ORDER) {
        const h = heights[c];
        if (h >= ROWS) continue;
        if (h + 1 < ROWS && this.winsAt(c, h + 1, q)) continue;
        moves.push(c);
      }
      if (!moves.length) return -(WIN - ply - 2);
    }
    if (depth <= 0) return this.eval(p);
    // The best result still possible: winning on the move after next.
    const ceiling = WIN - ply - 2;
    if (beta > ceiling) {
      beta = ceiling;
      if (alpha >= beta) return beta;
    }

    const tt = this.tt;
    const slot = this.h1 & TT_MASK;
    let ttMove = -1;
    if (tt.flag[slot] && tt.check[slot] === this.h2) {
      ttMove = tt.move[slot];
      if (tt.depth[slot] >= depth) {
        const v = tt.value[slot];
        const f = tt.flag[slot];
        if (f === EXACT) return v;
        if (f === LOWER && v >= beta) return v;
        if (f === UPPER && v <= alpha) return v;
      }
    }

    if (moves.length > 1) {
      if (depth >= 3) {
        const keys = moves.map((c, k) => {
          const cell = heights[c] * COLS + c;
          this.cells[cell] = p;
          const t = this.newThreats(cell, p);
          this.cells[cell] = 0;
          return (c === ttMove ? 1000 : 0) + t * 10 + (moves.length - k);
        });
        const idxs = moves.map((_, k) => k).sort((x, y) => keys[y] - keys[x]);
        const sorted = idxs.map((k) => moves[k]);
        moves.length = 0;
        moves.push(...sorted);
      } else if (ttMove >= 0) {
        const k = moves.indexOf(ttMove);
        if (k > 0) {
          moves.splice(k, 1);
          moves.unshift(ttMove);
        }
      }
    }

    const alpha0 = alpha;
    let best = -Infinity;
    let bestMove = moves[0];
    for (const c of moves) {
      this.play(c, p);
      const v = -this.negamax(depth - 1, -beta, -alpha, q, ply + 1);
      this.undo(c, p);
      if (this.stopped) return 0;
      if (v > best) {
        best = v;
        bestMove = c;
      }
      if (v > alpha) alpha = v;
      if (alpha >= beta) break;
    }
    const keep = !tt.flag[slot] || tt.check[slot] !== this.h2 || tt.depth[slot] <= depth;
    if (keep) {
      tt.check[slot] = this.h2;
      tt.value[slot] = best;
      tt.depth[slot] = depth;
      tt.move[slot] = bestMove;
      tt.flag[slot] = best <= alpha0 ? UPPER : best >= beta ? LOWER : EXACT;
    }
    return best;
  }

  /** Exact scores (within the depth) for every column, or null for full ones. */
  rootScores(p: number, depth: number, cols: number[]): (number | null)[] {
    const out: (number | null)[] = new Array(COLS).fill(null);
    for (const c of cols) {
      this.play(c, p);
      const v = this.winsAt(c, this.heights[c] - 1, p) ? WIN : -this.negamax(depth - 1, -Infinity, Infinity, 3 - p, 1);
      this.undo(c, p);
      if (this.stopped) return out;
      out[c] = v;
    }
    return out;
  }

  /** Iterative deepening from the root. Returns the best column of the deepest finished pass. */
  deepen(p: number, cols: number[], maxDepth: number): { col: number; score: number; depth: number } {
    let order = cols.slice();
    let result = { col: order[0], score: 0, depth: 0 };
    for (let depth = 1; depth <= maxDepth; depth++) {
      let alpha = -Infinity;
      let bestC = order[0];
      let bestV = -Infinity;
      const scored: [number, number][] = [];
      for (const c of order) {
        this.play(c, p);
        const v = this.winsAt(c, this.heights[c] - 1, p) ? WIN : -this.negamax(depth - 1, -Infinity, -alpha, 3 - p, 1);
        this.undo(c, p);
        if (this.stopped) break;
        scored.push([c, v]);
        if (v > bestV) {
          bestV = v;
          bestC = c;
        }
        if (v > alpha) alpha = v;
      }
      if (this.stopped) {
        // A pass cut short still counts if its first (previous best) move came back worse than something else.
        if (scored.length > 1 && bestC !== order[0]) result = { col: bestC, score: bestV, depth: depth - 1 };
        break;
      }
      result = { col: bestC, score: bestV, depth };
      if (isWinScore(bestV)) break;
      order = [bestC, ...order.filter((c) => c !== bestC)];
    }
    return result;
  }
}

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export type SearchOptions = { maxNodes?: number; ms?: number };

/** How each level plays: search depth, node budget and how loosely it picks among good moves. */
const LEVELS: Record<Level, { depth: number; nodes: number; slack: number; random: number }> = {
  0: { depth: 2, nodes: 20_000, slack: 40, random: 0.3 },
  1: { depth: 6, nodes: 250_000, slack: 6, random: 0 },
  2: { depth: 42, nodes: 500_000, slack: 0, random: 0 },
};

/** Best column for `me`. Easy plays a loose, occasionally random game; Normal looks six moves ahead; Hard searches as
 *  deep as its budget allows and plays perfectly once it can see to the end of the game. */
export function bestCol(b: Board, me: Player, level: Level, rng: Rng = Math.random, opts: SearchOptions = {}): number {
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
  if (cols.length === 1) return cols[0];
  const spec = LEVELS[level];
  if (rng() < spec.random) return cols[Math.floor(rng() * cols.length)];
  const s = new Search(b, opts.maxNodes ?? spec.nodes, opts.ms ?? 0);
  if (level === 2) {
    if (s.empties() === CELLS) return 3;
    return s.deepen(me, cols, s.empties()).col;
  }
  const scores = s.rootScores(me, spec.depth, cols);
  let bestV = -Infinity;
  for (const c of cols) if (scores[c] !== null && scores[c]! > bestV) bestV = scores[c]!;
  if (bestV === -Infinity) return cols[0];
  // Anything close to the best, but never a move that loses by force when the best one doesn't.
  const near = cols.filter((c) => {
    const v = scores[c];
    if (v === null) return false;
    if (v === bestV) return true;
    if (isWinScore(bestV) || (isWinScore(v) && v < 0)) return false;
    return v >= bestV - spec.slack;
  });
  return near[Math.floor(rng() * near.length)] ?? cols[0];
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
