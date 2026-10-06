// Alpha-beta search with piece-square tables and quiescence. Pure: runs in a Web Worker or under node.
import {
  BISHOP, KING, KNIGHT, PAWN, QUEEN, ROOK, WHITE,
  colorOf, fileOf, inCheck, legalMoves, makeMove, moveCaptured, movePromo, offBoard, positionKey, rankOf, typeOf, unmakeMove,
  type Color, type Position,
} from './engine.ts';

export type Level = 0 | 1 | 2;

const VALUE = [0, 100, 320, 330, 500, 900, 20000];
const MATE = 100000;

// Tables are written from white's point of view with rank 8 on the first row.
const PST: Record<number, number[]> = {
  [PAWN]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    50, 50, 50, 50, 50, 50, 50, 50,
    10, 10, 20, 30, 30, 20, 10, 10,
    5, 5, 10, 25, 25, 10, 5, 5,
    0, 0, 0, 20, 20, 0, 0, 0,
    5, -5, -10, 0, 0, -10, -5, 5,
    5, 10, 10, -20, -20, 10, 10, 5,
    0, 0, 0, 0, 0, 0, 0, 0,
  ],
  [KNIGHT]: [
    -50, -40, -30, -30, -30, -30, -40, -50,
    -40, -20, 0, 0, 0, 0, -20, -40,
    -30, 0, 10, 15, 15, 10, 0, -30,
    -30, 5, 15, 20, 20, 15, 5, -30,
    -30, 0, 15, 20, 20, 15, 0, -30,
    -30, 5, 10, 15, 15, 10, 5, -30,
    -40, -20, 0, 5, 5, 0, -20, -40,
    -50, -40, -30, -30, -30, -30, -40, -50,
  ],
  [BISHOP]: [
    -20, -10, -10, -10, -10, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 10, 10, 5, 0, -10,
    -10, 5, 5, 10, 10, 5, 5, -10,
    -10, 0, 10, 10, 10, 10, 0, -10,
    -10, 10, 10, 10, 10, 10, 10, -10,
    -10, 5, 0, 0, 0, 0, 5, -10,
    -20, -10, -10, -10, -10, -10, -10, -20,
  ],
  [ROOK]: [
    0, 0, 0, 0, 0, 0, 0, 0,
    5, 10, 10, 10, 10, 10, 10, 5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    -5, 0, 0, 0, 0, 0, 0, -5,
    0, 0, 0, 5, 5, 0, 0, 0,
  ],
  [QUEEN]: [
    -20, -10, -10, -5, -5, -10, -10, -20,
    -10, 0, 0, 0, 0, 0, 0, -10,
    -10, 0, 5, 5, 5, 5, 0, -10,
    -5, 0, 5, 5, 5, 5, 0, -5,
    0, 0, 5, 5, 5, 5, 0, -5,
    -10, 5, 5, 5, 5, 5, 0, -10,
    -10, 0, 5, 0, 0, 0, 0, -10,
    -20, -10, -10, -5, -5, -10, -10, -20,
  ],
};
const KING_MID = [
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -30, -40, -40, -50, -50, -40, -40, -30,
  -20, -30, -30, -40, -40, -30, -30, -20,
  -10, -20, -20, -20, -20, -20, -20, -10,
  20, 20, 0, 0, 0, 0, 20, 20,
  20, 30, 10, 0, 0, 10, 30, 20,
];
const KING_END = [
  -50, -40, -30, -20, -20, -30, -40, -50,
  -30, -20, -10, 0, 0, -10, -20, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 30, 40, 40, 30, -10, -30,
  -30, -10, 20, 30, 30, 20, -10, -30,
  -30, -30, 0, 0, 0, 0, -30, -30,
  -50, -30, -30, -30, -30, -30, -30, -50,
];

const tableIndex = (sq: number, color: Color) => (color === WHITE ? (7 - rankOf(sq)) * 8 : rankOf(sq) * 8) + fileOf(sq);

/** Static evaluation from the side to move's point of view, in centipawns. */
export function evaluate(p: Position): number {
  let score = 0;
  let nonPawnMaterial = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (offBoard(sq)) {
      sq += 7;
      continue;
    }
    const pc = p.board[sq];
    if (!pc) continue;
    const t = typeOf(pc);
    if (t !== PAWN && t !== KING) nonPawnMaterial += VALUE[t];
  }
  const endgame = nonPawnMaterial <= 2600;
  for (let sq = 0; sq < 128; sq++) {
    if (offBoard(sq)) {
      sq += 7;
      continue;
    }
    const pc = p.board[sq];
    if (!pc) continue;
    const t = typeOf(pc);
    const c = colorOf(pc);
    const table = t === KING ? (endgame ? KING_END : KING_MID) : PST[t];
    const v = VALUE[t] + table[tableIndex(sq, c)];
    score += c === WHITE ? v : -v;
  }
  return p.turn === WHITE ? score : -score;
}

const orderScore = (p: Position, m: number) => {
  const cap = moveCaptured(m);
  const promo = movePromo(m);
  let s = 0;
  if (cap) s += 10 * VALUE[typeOf(cap)] - VALUE[typeOf(p.board[m & 0x7f])] + 1000;
  if (promo) s += VALUE[promo];
  return s;
};

class Timeout extends Error {}

type Search = { nodes: number; deadline: number; check: () => void };

function quiesce(p: Position, alpha: number, beta: number, s: Search, ply: number): number {
  s.nodes++;
  if ((s.nodes & 2047) === 0) s.check();
  const stand = evaluate(p);
  if (stand >= beta) return beta;
  if (stand > alpha) alpha = stand;
  if (ply > 24) return alpha;
  const moves = legalMoves(p, true).sort((a, b) => orderScore(p, b) - orderScore(p, a));
  for (const m of moves) {
    const u = makeMove(p, m);
    const v = -quiesce(p, -beta, -alpha, s, ply + 1);
    unmakeMove(p, m, u);
    if (v >= beta) return beta;
    if (v > alpha) alpha = v;
  }
  return alpha;
}

function negamax(p: Position, depth: number, alpha: number, beta: number, s: Search, ply: number): number {
  s.nodes++;
  if ((s.nodes & 2047) === 0) s.check();
  const moves = legalMoves(p);
  if (moves.length === 0) return inCheck(p) ? -MATE + ply : 0;
  if (p.halfmove >= 100) return 0;
  if (depth <= 0) return quiesce(p, alpha, beta, s, ply);
  moves.sort((a, b) => orderScore(p, b) - orderScore(p, a));
  let best = -Infinity;
  for (const m of moves) {
    const u = makeMove(p, m);
    const v = -negamax(p, depth - 1, -beta, -alpha, s, ply + 1);
    unmakeMove(p, m, u);
    if (v > best) best = v;
    if (v > alpha) alpha = v;
    if (alpha >= beta) break;
  }
  return best;
}

const LEVELS: { depth: number; ms: number; noise: number }[] = [
  { depth: 2, ms: 200, noise: 90 },
  { depth: 3, ms: 700, noise: 0 },
  { depth: 5, ms: 1800, noise: 0 },
];

export type Thinking = { move: number; score: number; depth: number; nodes: number };

/**
 * Best move for the side to move. `keys` are the position keys seen so far (for repetition awareness).
 * Iterative deepening until the level's depth or time budget; always returns a legal move when one exists.
 */
export function bestMove(p: Position, level: Level, keys: string[] = [], rng: () => number = Math.random, now: () => number = () => Date.now()): Thinking | null {
  const cfg = LEVELS[level];
  const root = legalMoves(p);
  if (root.length === 0) return null;
  const start = now();
  const s: Search = {
    nodes: 0,
    deadline: start + cfg.ms,
    check: () => {
      if (now() > s.deadline) throw new Timeout();
    },
  };
  const seen = new Map<string, number>();
  for (const k of keys) seen.set(k, (seen.get(k) ?? 0) + 1);
  const repeats = (m: number) => {
    const u = makeMove(p, m);
    const n = seen.get(positionKey(p)) ?? 0;
    unmakeMove(p, m, u);
    return n >= 2;
  };
  let order = [...root].sort((a, b) => orderScore(p, b) - orderScore(p, a));
  let result: Thinking = { move: order[0], score: 0, depth: 0, nodes: 0 };
  for (let depth = 1; depth <= cfg.depth; depth++) {
    const scores = new Map<number, number>();
    let alpha = -Infinity;
    try {
      for (const m of order) {
        let v: number;
        if (repeats(m)) v = 0;
        else {
          const u = makeMove(p, m);
          v = -negamax(p, depth - 1, -Infinity, -alpha, s, 1);
          unmakeMove(p, m, u);
        }
        scores.set(m, v);
        if (v > alpha) alpha = v;
      }
    } catch (e) {
      if (!(e instanceof Timeout)) throw e;
      break;
    }
    order = [...order].sort((a, b) => scores.get(b)! - scores.get(a)!);
    result = { move: order[0], score: scores.get(order[0])!, depth, nodes: s.nodes };
    if (depth === cfg.depth && cfg.noise) {
      const noisy = order.map((m) => ({ m, v: scores.get(m)! + (rng() * 2 - 1) * cfg.noise }));
      noisy.sort((a, b) => b.v - a.v);
      result = { ...result, move: noisy[0].m, score: scores.get(noisy[0].m)! };
    }
    if (Math.abs(result.score) >= MATE - 100) break;
  }
  return result;
}

export const isMateScore = (v: number) => Math.abs(v) >= MATE - 100;

