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

// Computer player: iterative deepening negamax with alpha-beta, a transposition table and capture extension
// (a position with a jump pending is never scored, since the jump is forced). The evaluation counts material,
// prefers trades when ahead, keeps the back rank, and in the endgame drives kings at what is left instead of shuffling.
const MAN = 100;
const KING_V = 145;
const WIN = 100000;
const DOUBLE_CORNERS = new Set([sq(0, 1), sq(1, 0), sq(7, 6), sq(6, 7)]);
const BACK_GUARD: Record<Color, number[]> = { [RED]: [sq(7, 2), sq(7, 6)], [BLACK]: [sq(0, 1), sq(0, 5)] };

/** Static score from `me`'s side. */
export function evaluate(b: Board, me: Color): number {
  let mat = 0;
  let pos = 0;
  let mine = 0;
  let theirs = 0;
  let theirMen = 0;
  let myMen = 0;
  const kingsAt: number[] = [];
  const enemyKingsAt: number[] = [];
  const enemyAt: number[] = [];
  const myAt: number[] = [];
  for (let i = 0; i < 64; i++) {
    const p = b[i];
    if (!p) continue;
    const c = colorOf(p);
    const sign = c === me ? 1 : -1;
    const r = rowOf(i);
    const col = colOf(i);
    if (c === me) {
      mine++;
      myAt.push(i);
    } else {
      theirs++;
      enemyAt.push(i);
    }
    if (isKing(p)) {
      mat += sign * KING_V;
      // Kings belong in the middle, not on the rim.
      pos += sign * (6 - (Math.abs(3.5 - r) + Math.abs(3.5 - col))) * 3;
      if (c === me) kingsAt.push(i);
      else enemyKingsAt.push(i);
    } else {
      mat += sign * MAN;
      if (c === me) myMen++;
      else theirMen++;
      const adv = c === RED ? 7 - r : r;
      pos += sign * (adv * adv * 0.6);
      if (col >= 2 && col <= 5 && r >= 2 && r <= 5) pos += sign * 4;
      if (col === 0 || col === 7) pos -= sign * 2;
    }
  }
  for (const c of [RED, BLACK] as Color[]) {
    const sign = c === me ? 1 : -1;
    for (const g of BACK_GUARD[c]) if (b[g] && b[g] === c) pos += sign * 7;
  }
  // Trade down when ahead: the same lead is worth more with fewer pieces on the board.
  const total = mine + theirs;
  if (mat !== 0 && total) mat += Math.round((mat * 6) / total);
  // Endgame: the side ahead walks its kings at what is left and keeps the loser out of the double corners.
  if (total <= 10 && mine && theirs && Math.abs(mat) > 40) {
    const lead = mat > 0 ? 1 : -1;
    const strongKings = lead > 0 ? kingsAt : enemyKingsAt;
    const weak = lead > 0 ? enemyAt : myAt;
    for (const k of strongKings) {
      let near = 99;
      for (const e of weak) near = Math.min(near, Math.max(Math.abs(rowOf(k) - rowOf(e)), Math.abs(colOf(k) - colOf(e))));
      pos -= lead * near * 6;
    }
    for (const e of weak) if (DOUBLE_CORNERS.has(e)) pos -= lead * 10;
    if (!myMen && !theirMen) pos += lead * 20;
  }
  return mat + pos;
}

// 32-bit Zobrist keys from a fixed seed, so a search is repeatable.
const ZOBRIST = (() => {
  let s = 0x9e3779b9;
  const next = () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return s >>> 0;
  };
  const keys = new Uint32Array(64 * 8 + 1);
  for (let i = 0; i < keys.length; i++) keys[i] = next();
  return keys;
})();
function hashOf(b: Board, side: Color) {
  let h = side === RED ? ZOBRIST[64 * 8] : 0;
  for (let i = 0; i < 64; i++) if (b[i]) h ^= ZOBRIST[i * 8 + b[i]];
  return h >>> 0;
}

type Entry = { depth: number; score: number; flag: 0 | 1 | 2; best: number };
const EXACT = 0;
const LOWER = 1;
const UPPER = 2;
const MAX_PLY = 64;
class Timeout extends Error {}
type Search = { deadline: number; nodes: number; tt: Map<number, Entry>; now: () => number };

const moveKey = (m: Move) => m.from * 64 + m.to + m.captured.length * 4096;

function negamax(b: Board, side: Color, depth: number, alpha: number, beta: number, ply: number, s: Search): number {
  if ((++s.nodes & 1023) === 0 && s.now() > s.deadline) throw new Timeout();
  const moves = legalMoves(b, side);
  if (moves.length === 0) return -(WIN - ply);
  const jumping = moves[0].captured.length > 0;
  // Never stop with a capture pending: it would be scored before the forced trade happens.
  if ((depth <= 0 && !jumping) || ply >= MAX_PLY) return evaluate(b, side);
  const key = hashOf(b, side);
  const hit = s.tt.get(key);
  if (hit && hit.depth >= depth && ply > 0) {
    if (hit.flag === EXACT) return hit.score;
    if (hit.flag === LOWER && hit.score >= beta) return hit.score;
    if (hit.flag === UPPER && hit.score <= alpha) return hit.score;
  }
  if (moves.length > 1) {
    const best = hit?.best ?? -1;
    moves.sort((x, y) => (moveKey(y) === best ? 1 : 0) - (moveKey(x) === best ? 1 : 0) || y.captured.length - x.captured.length);
  }
  // A single forced reply costs no depth.
  const next = moves.length === 1 ? depth : depth - 1;
  const alpha0 = alpha;
  let bestV = -Infinity;
  let bestK = -1;
  for (const m of moves) {
    const v = -negamax(applyMove(b, m), other(side), next, -beta, -alpha, ply + 1, s);
    if (v > bestV) {
      bestV = v;
      bestK = moveKey(m);
    }
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  if (s.tt.size > 400_000) s.tt.clear();
  s.tt.set(key, { depth, score: bestV, flag: bestV <= alpha0 ? UPPER : bestV >= beta ? LOWER : EXACT, best: bestK });
  return bestV;
}

/** How far each level looks, and how long it may think (ms). Easy also misplays on purpose. */
export const LEVELS: Record<Level, { depth: number; timeMs: number; slip: number }> = {
  0: { depth: 2, timeMs: 200, slip: 0.25 },
  1: { depth: 4, timeMs: 400, slip: 0 },
  2: { depth: 30, timeMs: 900, slip: 0 },
};
export type Rng = () => number;
export type SearchOptions = { timeMs?: number; maxDepth?: number };

const clock = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** Best move for the side to move. Easy sometimes plays a random legal move; ties are broken at random. */
export function bestMove(b: Board, side: Color, level: Level, rng: Rng = Math.random, opts: SearchOptions = {}): Move | null {
  const moves = legalMoves(b, side);
  if (moves.length === 0) return null;
  if (moves.length === 1) return moves[0];
  const spec = LEVELS[level];
  if (spec.slip && rng() < spec.slip) return moves[Math.floor(rng() * moves.length)];
  // Shuffle first so equal moves vary from game to game.
  for (let i = moves.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [moves[i], moves[j]] = [moves[j], moves[i]];
  }
  const s: Search = { deadline: clock() + (opts.timeMs ?? spec.timeMs), nodes: 0, tt: new Map(), now: clock };
  const maxDepth = opts.maxDepth ?? spec.depth;
  let order = moves;
  let best = moves[0];
  for (let depth = 1; depth <= maxDepth; depth++) {
    const scored: { m: Move; v: number }[] = [];
    let alpha = -Infinity;
    try {
      for (const m of order) {
        // Each root move gets a window just above the best so far; a fail-low is enough to rank it below.
        const v = -negamax(applyMove(b, m), other(side), depth - 1, -Infinity, -alpha, 1, s);
        scored.push({ m, v });
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      // Keep the deeper answer if this iteration already found something better than the last best.
      const lead = scored.reduce<{ m: Move; v: number } | null>((a, x) => (!a || x.v > a.v ? x : a), null);
      if (lead && lead.m !== best && scored[0]?.m === best && lead.v > scored[0].v) best = lead.m;
      break;
    }
    scored.sort((x, y) => y.v - x.v);
    order = scored.map((x) => x.m);
    best = order[0];
    // A forced win found: no need to look further.
    if (Math.abs(scored[0].v) > WIN - MAX_PLY * 2) break;
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
