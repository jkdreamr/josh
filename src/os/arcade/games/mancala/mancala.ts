// Kalah (mancala) rules and a minimax computer player. Pure module, no DOM.
// Board: 14 cells. 0..5 are side 0's pits (left to right from side 0's view), 6 is side 0's store,
// 7..12 are side 1's pits, 13 is side 1's store. Sowing goes counterclockwise: index + 1 mod 14.

export const PITS = 6;
export const SEEDS = 4;
export const TOTAL = 48;
export type Side = 0 | 1;
export type Board = number[];
export const STORE: readonly [6, 13] = [6, 13];
export type Level = 0 | 1 | 2;

export type Capture = { pit: number; opposite: number; seeds: number };
export type MoveResult = {
  board: Board;
  path: number[];
  last: number;
  capture: Capture | null;
  extra: boolean;
  over: boolean;
  sweep: [number, number] | null;
};
export type State = { board: Board; turn: Side; over: boolean; seq: number; ply: number };

export function newBoard(seeds = SEEDS): Board {
  const b = new Array(14).fill(seeds);
  b[STORE[0]] = 0;
  b[STORE[1]] = 0;
  return b;
}

export function newState(): State {
  return { board: newBoard(), turn: 0, over: false, seq: 0, ply: 0 };
}

export function pitsOf(side: Side): number[] {
  const start = side === 0 ? 0 : 7;
  return [start, start + 1, start + 2, start + 3, start + 4, start + 5];
}

export function ownerOf(index: number): Side {
  return index < 7 ? 0 : 1;
}

export function opposite(pit: number): number {
  return 12 - pit;
}

const other = (s: Side): Side => (s === 0 ? 1 : 0);
const isPit = (i: number) => i !== STORE[0] && i !== STORE[1];

export function legalMoves(board: Board, side: Side): number[] {
  return pitsOf(side).filter((p) => board[p] > 0);
}

const sideEmpty = (b: Board, side: Side) => pitsOf(side).every((p) => b[p] === 0);

/** Sow the seeds from `pit` for `side`. Throws on an illegal pit; never mutates `board`. */
export function sow(board: Board, side: Side, pit: number): MoveResult {
  if (!Number.isInteger(pit) || ownerOf(pit) !== side || !isPit(pit) || board[pit] <= 0) {
    throw new Error(`illegal pit ${pit} for side ${side}`);
  }
  const b = board.slice();
  const seeds = b[pit];
  b[pit] = 0;
  const path: number[] = [];
  let cur = pit;
  for (let n = 0; n < seeds; n++) {
    cur = (cur + 1) % 14;
    if (cur === STORE[other(side)]) {
      cur = (cur + 1) % 14;
    }
    b[cur] += 1;
    path.push(cur);
  }
  const last = path[path.length - 1];
  let capture: Capture | null = null;
  if (ownerOf(last) === side && isPit(last) && b[last] === 1) {
    const opp = opposite(last);
    if (b[opp] > 0) {
      capture = { pit: last, opposite: opp, seeds: b[opp] + 1 };
      b[STORE[side]] += capture.seeds;
      b[last] = 0;
      b[opp] = 0;
    }
  }
  let over = false;
  let sweep: [number, number] | null = null;
  if (sideEmpty(b, 0) || sideEmpty(b, 1)) {
    over = true;
    sweep = [0, 0];
    for (const side2 of [0, 1] as Side[]) {
      for (const p of pitsOf(side2)) {
        sweep[side2] += b[p];
        b[STORE[side2]] += b[p];
        b[p] = 0;
      }
    }
  }
  const extra = !over && last === STORE[side];
  return { board: b, path, last, capture, extra, over, sweep };
}

/** Apply a sow at `pit`; null if the game is over or the pit is illegal for the side to move. */
export function apply(state: State, pit: number): { state: State; result: MoveResult } | null {
  if (state.over) return null;
  let result: MoveResult;
  try {
    result = sow(state.board, state.turn, pit);
  } catch {
    return null;
  }
  const turn = result.extra ? state.turn : other(state.turn);
  const state2: State = {
    board: result.board,
    turn,
    over: result.over,
    seq: state.seq + 1,
    ply: state.ply + 1,
  };
  return { state: state2, result };
}

export function score(board: Board): [number, number] {
  return [board[STORE[0]], board[STORE[1]]];
}

export function winner(board: Board): Side | null {
  const [a, b] = score(board);
  return a === b ? null : a > b ? 0 : 1;
}

// --- AI ---

type Rng = () => number;

// Final board after sweeping both sides' remaining seeds into their own stores.
function terminalScore(b: Board): number | null {
  if (!sideEmpty(b, 0) && !sideEmpty(b, 1)) return null;
  const s = [b[STORE[0]], b[STORE[1]]];
  for (const side of [0, 1] as Side[]) for (const p of pitsOf(side)) s[side] += b[p];
  return s[0] - s[1];
}

const pitSeeds = (b: Board, side: Side) => pitsOf(side).reduce((s, p) => s + b[p], 0);

function evalBoard(b: Board, me: Side, material: boolean): number {
  const diff = b[STORE[me]] - b[STORE[other(me)]];
  if (!material) return diff;
  return diff + 0.25 * (pitSeeds(b, me) - pitSeeds(b, other(me)));
}

const BIG = 1e6;

// Move ordering for hard search: extra turns first, then captures (by size), then the rest.
function orderMoves(b: Board, side: Side, moves: number[], first: number | null): number[] {
  const scored = moves.map((pit) => {
    const r = sow(b, side, pit);
    return { pit, rank: r.extra ? 2 : r.capture ? 1 : 0 };
  });
  scored.sort((x, y) => y.rank - x.rank);
  const out = scored.map((s) => s.pit);
  if (first !== null && out.includes(first)) {
    out.splice(out.indexOf(first), 1);
    out.unshift(first);
  }
  return out;
}

type SearchCtx = { me: Side; material: boolean; nodes: number; deadline: number; now: () => number; aborted: boolean };

function search(ctx: SearchCtx, b: Board, side: Side, depth: number, alpha: number, beta: number, ply: number): number {
  if ((ctx.nodes++ & 511) === 0 && ctx.now() > ctx.deadline) ctx.aborted = true;
  if (ctx.aborted) return 0;
  const term = terminalScore(b);
  if (term !== null) {
    const myDiff = ctx.me === 0 ? term : -term;
    return BIG * myDiff - Math.sign(myDiff) * ply;
  }
  if (depth <= 0) return evalBoard(b, ctx.me, ctx.material);
  const maximizing = side === ctx.me;
  let best = maximizing ? -Infinity : Infinity;
  for (const pit of legalMoves(b, side)) {
    const r = sow(b, side, pit);
    const next = r.extra ? side : other(side);
    const v = search(ctx, r.board, next, depth - 1, alpha, beta, ply + 1);
    if (ctx.aborted) return 0;
    if (maximizing) {
      if (v > best) best = v;
      if (v > alpha) alpha = v;
    } else {
      if (v < best) best = v;
      if (v < beta) beta = v;
    }
    if (alpha >= beta) break;
  }
  return best;
}

const defaultNow = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function pickBest(moves: number[], values: number[], rng: Rng): number {
  let bestV = -Infinity;
  let best: number[] = [];
  for (let i = 0; i < moves.length; i++) {
    if (values[i] > bestV) {
      bestV = values[i];
      best = [moves[i]];
    } else if (values[i] === bestV) {
      best.push(moves[i]);
    }
  }
  return best[Math.floor(rng() * best.length)];
}

/**
 * Best pit to sow for `side`. -1 when there is no legal move.
 * Easy: half the time random, else one-ply greedy on store difference.
 * Normal: alpha-beta to depth 4 on store difference.
 * Hard: iterative deepening within `budgetMs`, evaluating store + pit material.
 */
export function chooseMove(
  board: Board,
  side: Side,
  level: Level,
  opts: { rng?: Rng; budgetMs?: number; maxDepth?: number; now?: () => number } = {},
): number {
  const rng = opts.rng ?? Math.random;
  const now = opts.now ?? defaultNow;
  const moves = legalMoves(board, side);
  if (moves.length === 0) return -1;
  if (moves.length === 1) return moves[0];

  if (level === 0) {
    if (rng() < 0.5) return moves[Math.floor(rng() * moves.length)];
    const values = moves.map((pit) => {
      const r = sow(board, side, pit);
      return r.board[STORE[side]] - r.board[STORE[other(side)]];
    });
    return pickBest(moves, values, rng);
  }

  if (level === 1) {
    const ctx: SearchCtx = { me: side, material: false, nodes: 0, deadline: Infinity, now, aborted: false };
    const values = moves.map((pit) => {
      const r = sow(board, side, pit);
      return search(ctx, r.board, r.extra ? side : other(side), 3, -Infinity, Infinity, 1);
    });
    return pickBest(moves, values, rng);
  }

  const maxDepth = opts.maxDepth ?? 24;
  const budgetMs = opts.budgetMs ?? 700;
  const deadline = now() + budgetMs;
  let best = moves[0];
  let prevBest: number | null = null;
  for (let depth = 1; depth <= maxDepth; depth++) {
    const ctx: SearchCtx = { me: side, material: true, nodes: 0, deadline, now, aborted: false };
    const ordered = orderMoves(board, side, moves.slice(), prevBest);
    let iterBest = ordered[0];
    let iterV = -Infinity;
    let alpha = -Infinity;
    for (const pit of ordered) {
      const r = sow(board, side, pit);
      const next = r.extra ? side : other(side);
      let v = search(ctx, r.board, next, depth - 1, alpha, Infinity, 1);
      if (ctx.aborted) break;
      // A value returned at the alpha bound may be a fail-low clip rather than a
      // true tie; re-search with a full window before allowing a tie-break.
      if (v === iterV && iterV > -Infinity) {
        v = search(ctx, r.board, next, depth - 1, -Infinity, Infinity, 1);
        if (ctx.aborted) break;
      }
      if (v > iterV || (v === iterV && rng() < 0.5)) {
        iterV = v;
        iterBest = pit;
      }
      if (v > alpha) alpha = v;
    }
    if (ctx.aborted) break;
    best = iterBest;
    prevBest = iterBest;
    if (iterV >= BIG / 2) break; // forced win found
    if (now() > deadline) break;
  }
  return best;
}

// --- Network packets (host-authoritative online play) ---

export type Packet =
  | { t: 'hello' }
  | { t: 'pick'; seq: number; pit: number }
  | { t: 'sync'; state: State }
  | { t: 'move'; seq: number; pit: number; state: State };

const int = (x: unknown) => Number.isInteger(x);
const validPit = (x: unknown) => int(x) && (x as number) >= 0 && (x as number) <= 12 && x !== STORE[0] && x !== STORE[1];

function validState(s: unknown): s is State {
  if (typeof s !== 'object' || s === null) return false;
  const st = s as Record<string, unknown>;
  if (st.turn !== 0 && st.turn !== 1) return false;
  if (typeof st.over !== 'boolean') return false;
  if (!int(st.seq) || (st.seq as number) < 0 || !int(st.ply) || (st.ply as number) < 0) return false;
  const b = st.board;
  if (!Array.isArray(b) || b.length !== 14) return false;
  let sum = 0;
  for (const v of b) {
    if (!int(v) || v < 0) return false;
    sum += v;
  }
  return sum === TOTAL;
}

/** Strict packet validation; anything malformed returns null. */
export function parsePacket(d: unknown): Packet | null {
  if (typeof d !== 'object' || d === null) return null;
  const p = d as Record<string, unknown>;
  switch (p.t) {
    case 'hello':
      return { t: 'hello' };
    case 'pick':
      if (!int(p.seq) || (p.seq as number) < 0 || !validPit(p.pit)) return null;
      return { t: 'pick', seq: p.seq as number, pit: p.pit as number };
    case 'sync':
      if (!validState(p.state)) return null;
      return { t: 'sync', state: p.state as State };
    case 'move':
      if (!int(p.seq) || (p.seq as number) < 0 || !validPit(p.pit) || !validState(p.state)) return null;
      return { t: 'move', seq: p.seq as number, pit: p.pit as number, state: p.state as State };
    default:
      return null;
  }
}
