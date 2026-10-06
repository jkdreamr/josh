// Chess rules on a 0x88 board: move generation, make/unmake, legality, draws, SAN, FEN and perft. No DOM.

export const EMPTY = 0;
export const PAWN = 1;
export const KNIGHT = 2;
export const BISHOP = 3;
export const ROOK = 4;
export const QUEEN = 5;
export const KING = 6;
export const WHITE = 0;
export const BLACK = 8;
export type Color = 0 | 8;
export type PieceType = 1 | 2 | 3 | 4 | 5 | 6;

export const typeOf = (p: number) => p & 7;
export const colorOf = (p: number): Color => (p & 8) as Color;
export const opposite = (c: Color): Color => (c ^ 8) as Color;
export const fileOf = (sq: number) => sq & 7;
export const rankOf = (sq: number) => sq >> 4;
export const square = (file: number, rank: number) => (rank << 4) | file;
export const offBoard = (sq: number) => (sq & 0x88) !== 0;
export const squareName = (sq: number) => 'abcdefgh'[fileOf(sq)] + (rankOf(sq) + 1);
export const parseSquare = (s: string) => square(s.charCodeAt(0) - 97, Number(s[1]) - 1);

/* Move encoding: from | to << 7 | captured << 14 | promo << 18 | flags << 21 */
export const FLAG_EP = 1;
export const FLAG_CASTLE = 2;
export const FLAG_DOUBLE = 4;
export const moveFrom = (m: number) => m & 0x7f;
export const moveTo = (m: number) => (m >> 7) & 0x7f;
export const moveCaptured = (m: number) => (m >> 14) & 0xf;
export const movePromo = (m: number) => (m >> 18) & 0x7;
export const moveFlags = (m: number) => (m >> 21) & 0x7;
const encode = (from: number, to: number, captured = 0, promo = 0, flags = 0) => from | (to << 7) | (captured << 14) | (promo << 18) | (flags << 21);

export const CASTLE_WK = 1;
export const CASTLE_WQ = 2;
export const CASTLE_BK = 4;
export const CASTLE_BQ = 8;

export type Position = {
  board: Uint8Array;
  turn: Color;
  castling: number;
  /** En passant target square or -1. */
  ep: number;
  halfmove: number;
  fullmove: number;
  kings: [number, number];
};

type Undo = { castling: number; ep: number; halfmove: number };

const N = [-33, -31, -18, -14, 14, 18, 31, 33];
const K = [-17, -16, -15, -1, 1, 15, 16, 17];
const B = [-17, -15, 15, 17];
const R = [-16, -1, 1, 16];

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
const PIECE_CHARS = ' pnbrqk';

export function fromFen(fen: string): Position {
  const [placement, turn = 'w', castling = '-', ep = '-', half = '0', full = '1'] = fen.trim().split(/\s+/);
  const board = new Uint8Array(128);
  const kings: [number, number] = [-1, -1];
  let rank = 7;
  let file = 0;
  for (const ch of placement) {
    if (ch === '/') {
      rank--;
      file = 0;
    } else if (ch >= '1' && ch <= '8') file += Number(ch);
    else {
      const t = PIECE_CHARS.indexOf(ch.toLowerCase());
      if (t <= 0) throw new Error(`bad fen piece ${ch}`);
      const color: Color = ch === ch.toUpperCase() ? WHITE : BLACK;
      const sq = square(file, rank);
      board[sq] = t | color;
      if (t === KING) kings[color ? 1 : 0] = sq;
      file++;
    }
  }
  let c = 0;
  if (castling.includes('K')) c |= CASTLE_WK;
  if (castling.includes('Q')) c |= CASTLE_WQ;
  if (castling.includes('k')) c |= CASTLE_BK;
  if (castling.includes('q')) c |= CASTLE_BQ;
  return { board, turn: turn === 'b' ? BLACK : WHITE, castling: c, ep: ep === '-' ? -1 : parseSquare(ep), halfmove: Number(half), fullmove: Number(full), kings };
}

export function toFen(p: Position): string {
  let s = '';
  for (let rank = 7; rank >= 0; rank--) {
    let empty = 0;
    for (let file = 0; file < 8; file++) {
      const pc = p.board[square(file, rank)];
      if (!pc) empty++;
      else {
        if (empty) s += empty;
        empty = 0;
        const ch = PIECE_CHARS[typeOf(pc)];
        s += colorOf(pc) === WHITE ? ch.toUpperCase() : ch;
      }
    }
    if (empty) s += empty;
    if (rank) s += '/';
  }
  const c = (p.castling & CASTLE_WK ? 'K' : '') + (p.castling & CASTLE_WQ ? 'Q' : '') + (p.castling & CASTLE_BK ? 'k' : '') + (p.castling & CASTLE_BQ ? 'q' : '');
  return `${s} ${p.turn === WHITE ? 'w' : 'b'} ${c || '-'} ${p.ep >= 0 ? squareName(p.ep) : '-'} ${p.halfmove} ${p.fullmove}`;
}

export const startPosition = () => fromFen(START_FEN);

export function clonePosition(p: Position): Position {
  return { ...p, board: new Uint8Array(p.board), kings: [p.kings[0], p.kings[1]] };
}

/** Position identity for repetition checks (placement, side, castling, en passant). */
export function positionKey(p: Position): string {
  let s = '';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) s += String.fromCharCode(48 + p.board[square(f, r)]);
  return `${s}${p.turn}${p.castling}${p.ep}`;
}

/** Is `sq` attacked by any piece of color `by`? */
export function attacked(p: Position, sq: number, by: Color): boolean {
  const b = p.board;
  const pawnDir = by === WHITE ? -16 : 16;
  for (const d of [pawnDir - 1, pawnDir + 1]) {
    const s = sq + d;
    if (!offBoard(s) && b[s] === (PAWN | by)) return true;
  }
  for (const d of N) {
    const s = sq + d;
    if (!offBoard(s) && b[s] === (KNIGHT | by)) return true;
  }
  for (const d of K) {
    const s = sq + d;
    if (!offBoard(s) && b[s] === (KING | by)) return true;
  }
  for (const d of B) {
    let s = sq + d;
    while (!offBoard(s)) {
      const pc = b[s];
      if (pc) {
        if (colorOf(pc) === by && (typeOf(pc) === BISHOP || typeOf(pc) === QUEEN)) return true;
        break;
      }
      s += d;
    }
  }
  for (const d of R) {
    let s = sq + d;
    while (!offBoard(s)) {
      const pc = b[s];
      if (pc) {
        if (colorOf(pc) === by && (typeOf(pc) === ROOK || typeOf(pc) === QUEEN)) return true;
        break;
      }
      s += d;
    }
  }
  return false;
}

export const inCheck = (p: Position, color: Color = p.turn) => attacked(p, p.kings[color ? 1 : 0], opposite(color));

/** Pseudo-legal moves for the side to move (may leave the king in check). */
export function pseudoMoves(p: Position, capturesOnly = false): number[] {
  const out: number[] = [];
  const b = p.board;
  const us = p.turn;
  const them = opposite(us);
  const push = (from: number, to: number, flags = 0) => {
    out.push(encode(from, to, b[to], 0, flags));
  };
  for (let sq = 0; sq < 128; sq++) {
    if (offBoard(sq)) {
      sq += 7;
      continue;
    }
    const pc = b[sq];
    if (!pc || colorOf(pc) !== us) continue;
    const t = typeOf(pc);
    if (t === PAWN) {
      const dir = us === WHITE ? 16 : -16;
      const startRank = us === WHITE ? 1 : 6;
      const promoRank = us === WHITE ? 7 : 0;
      const fwd = sq + dir;
      if (!offBoard(fwd) && !b[fwd]) {
        if (rankOf(fwd) === promoRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push(encode(sq, fwd, 0, pr));
        else if (!capturesOnly) {
          push(sq, fwd);
          if (rankOf(sq) === startRank && !b[fwd + dir]) push(sq, fwd + dir, FLAG_DOUBLE);
        }
      }
      for (const side of [-1, 1]) {
        const to = fwd + side;
        if (offBoard(to)) continue;
        const target = b[to];
        if (target && colorOf(target) === them) {
          if (rankOf(to) === promoRank) for (const pr of [QUEEN, ROOK, BISHOP, KNIGHT]) out.push(encode(sq, to, target, pr));
          else push(sq, to);
        } else if (to === p.ep) out.push(encode(sq, to, PAWN | them, 0, FLAG_EP));
      }
    } else if (t === KNIGHT || t === KING) {
      for (const d of t === KNIGHT ? N : K) {
        const to = sq + d;
        if (offBoard(to)) continue;
        const target = b[to];
        if (!target) {
          if (!capturesOnly) push(sq, to);
        } else if (colorOf(target) === them) push(sq, to);
      }
      if (t === KING && !capturesOnly) {
        const home = us === WHITE ? 0x04 : 0x74;
        if (sq === home && !attacked(p, sq, them)) {
          const kBit = us === WHITE ? CASTLE_WK : CASTLE_BK;
          const qBit = us === WHITE ? CASTLE_WQ : CASTLE_BQ;
          if (p.castling & kBit && !b[sq + 1] && !b[sq + 2] && b[sq + 3] === (ROOK | us) && !attacked(p, sq + 1, them)) push(sq, sq + 2, FLAG_CASTLE);
          if (p.castling & qBit && !b[sq - 1] && !b[sq - 2] && !b[sq - 3] && b[sq - 4] === (ROOK | us) && !attacked(p, sq - 1, them)) push(sq, sq - 2, FLAG_CASTLE);
        }
      }
    } else {
      const dirs = t === BISHOP ? B : t === ROOK ? R : K;
      for (const d of dirs) {
        let to = sq + d;
        while (!offBoard(to)) {
          const target = b[to];
          if (!target) {
            if (!capturesOnly) push(sq, to);
          } else {
            if (colorOf(target) === them) push(sq, to);
            break;
          }
          to += d;
        }
      }
    }
  }
  return out;
}

const CASTLE_MASK = new Uint8Array(128).fill(15);
CASTLE_MASK[0x00] = 15 & ~CASTLE_WQ;
CASTLE_MASK[0x07] = 15 & ~CASTLE_WK;
CASTLE_MASK[0x04] = 15 & ~(CASTLE_WK | CASTLE_WQ);
CASTLE_MASK[0x70] = 15 & ~CASTLE_BQ;
CASTLE_MASK[0x77] = 15 & ~CASTLE_BK;
CASTLE_MASK[0x74] = 15 & ~(CASTLE_BK | CASTLE_BQ);

export function makeMove(p: Position, m: number): Undo {
  const undo: Undo = { castling: p.castling, ep: p.ep, halfmove: p.halfmove };
  const b = p.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const promo = movePromo(m);
  const pc = b[from];
  const us = p.turn;
  const captured = moveCaptured(m);
  p.halfmove = captured || typeOf(pc) === PAWN ? 0 : p.halfmove + 1;
  p.ep = -1;
  if (flags & FLAG_EP) b[to + (us === WHITE ? -16 : 16)] = EMPTY;
  b[from] = EMPTY;
  b[to] = promo ? promo | us : pc;
  if (typeOf(pc) === KING) {
    p.kings[us ? 1 : 0] = to;
    if (flags & FLAG_CASTLE) {
      if (to > from) {
        b[to - 1] = b[from + 3];
        b[from + 3] = EMPTY;
      } else {
        b[to + 1] = b[from - 4];
        b[from - 4] = EMPTY;
      }
    }
  }
  if (flags & FLAG_DOUBLE) p.ep = (from + to) >> 1;
  p.castling &= CASTLE_MASK[from] & CASTLE_MASK[to];
  if (us === BLACK) p.fullmove++;
  p.turn = opposite(us);
  return undo;
}

export function unmakeMove(p: Position, m: number, undo: Undo) {
  const b = p.board;
  const from = moveFrom(m);
  const to = moveTo(m);
  const flags = moveFlags(m);
  const promo = movePromo(m);
  const captured = moveCaptured(m);
  p.turn = opposite(p.turn);
  const us = p.turn;
  if (us === BLACK) p.fullmove--;
  const pc = promo ? PAWN | us : b[to];
  b[from] = pc;
  b[to] = flags & FLAG_EP ? EMPTY : captured;
  if (flags & FLAG_EP) b[to + (us === WHITE ? -16 : 16)] = PAWN | opposite(us);
  if (typeOf(pc) === KING) {
    p.kings[us ? 1 : 0] = from;
    if (flags & FLAG_CASTLE) {
      if (to > from) {
        b[from + 3] = b[to - 1];
        b[to - 1] = EMPTY;
      } else {
        b[from - 4] = b[to + 1];
        b[to + 1] = EMPTY;
      }
    }
  }
  p.castling = undo.castling;
  p.ep = undo.ep;
  p.halfmove = undo.halfmove;
}

/** Fully legal moves for the side to move. */
export function legalMoves(p: Position, capturesOnly = false): number[] {
  const out: number[] = [];
  const us = p.turn;
  for (const m of pseudoMoves(p, capturesOnly)) {
    const u = makeMove(p, m);
    if (!attacked(p, p.kings[us ? 1 : 0], opposite(us))) out.push(m);
    unmakeMove(p, m, u);
  }
  return out;
}

export function perft(p: Position, depth: number): number {
  if (depth === 0) return 1;
  const moves = legalMoves(p);
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) {
    const u = makeMove(p, m);
    n += perft(p, depth - 1);
    unmakeMove(p, m, u);
  }
  return n;
}

export type Status = 'playing' | 'checkmate' | 'stalemate' | 'repetition' | 'fifty' | 'insufficient';

export function insufficientMaterial(p: Position): boolean {
  let minors = 0;
  let bishopsOnLight = 0;
  let bishopsOnDark = 0;
  for (let sq = 0; sq < 128; sq++) {
    if (offBoard(sq)) {
      sq += 7;
      continue;
    }
    const t = typeOf(p.board[sq]);
    if (!t || t === KING) continue;
    if (t === PAWN || t === ROOK || t === QUEEN) return false;
    minors++;
    if (t === BISHOP) {
      if ((fileOf(sq) + rankOf(sq)) & 1) bishopsOnLight++;
      else bishopsOnDark++;
    }
  }
  if (minors <= 1) return true;
  // Only bishops, all on the same color.
  return minors === bishopsOnLight + bishopsOnDark && (bishopsOnLight === 0 || bishopsOnDark === 0);
}

/** Game status from the current position, legal moves and the list of position keys seen so far (including this one). */
export function statusOf(p: Position, legal: number[], keys: string[]): Status {
  if (legal.length === 0) return inCheck(p) ? 'checkmate' : 'stalemate';
  if (p.halfmove >= 100) return 'fifty';
  if (insufficientMaterial(p)) return 'insufficient';
  const key = keys[keys.length - 1];
  let n = 0;
  for (const k of keys) if (k === key) n++;
  if (n >= 3) return 'repetition';
  return 'playing';
}

/** Standard algebraic notation for a legal move in position p (before the move is played). */
export function toSan(p: Position, m: number, legal: number[] = legalMoves(p)): string {
  const from = moveFrom(m);
  const to = moveTo(m);
  const pc = p.board[from];
  const t = typeOf(pc);
  const flags = moveFlags(m);
  let s: string;
  if (flags & FLAG_CASTLE) s = to > from ? 'O-O' : 'O-O-O';
  else {
    const capture = moveCaptured(m) !== 0;
    if (t === PAWN) s = (capture ? 'abcdefgh'[fileOf(from)] + 'x' : '') + squareName(to);
    else {
      let dis = '';
      const others = legal.filter((o) => o !== m && moveTo(o) === to && p.board[moveFrom(o)] === pc);
      if (others.length) {
        const sameFile = others.some((o) => fileOf(moveFrom(o)) === fileOf(from));
        const sameRank = others.some((o) => rankOf(moveFrom(o)) === rankOf(from));
        if (!sameFile) dis = 'abcdefgh'[fileOf(from)];
        else if (!sameRank) dis = String(rankOf(from) + 1);
        else dis = squareName(from);
      }
      s = PIECE_CHARS[t].toUpperCase() + dis + (capture ? 'x' : '') + squareName(to);
    }
    const promo = movePromo(m);
    if (promo) s += '=' + PIECE_CHARS[promo].toUpperCase();
  }
  const u = makeMove(p, m);
  const check = inCheck(p);
  const mate = check && legalMoves(p).length === 0;
  unmakeMove(p, m, u);
  return s + (mate ? '#' : check ? '+' : '');
}

/** Find a legal move by squares (and promotion piece when needed). */
export function findMove(legal: number[], from: number, to: number, promo = 0): number | undefined {
  return legal.find((m) => moveFrom(m) === from && moveTo(m) === to && movePromo(m) === promo);
}

export const isPromotion = (legal: number[], from: number, to: number) => legal.some((m) => moveFrom(m) === from && moveTo(m) === to && movePromo(m));

/* A playable game: position plus history for repetition and the move list. */
export type Played = { move: number; san: string; fen: string };
export type Game = {
  pos: Position;
  legal: number[];
  keys: string[];
  history: Played[];
  status: Status;
};

export function newGame(fen = START_FEN): Game {
  const pos = fromFen(fen);
  const legal = legalMoves(pos);
  const keys = [positionKey(pos)];
  return { pos, legal, keys, history: [], status: statusOf(pos, legal, keys) };
}

/** Plays a legal move and returns a new game object (the old one is left untouched). */
export function play(g: Game, m: number): Game {
  const pos = clonePosition(g.pos);
  const san = toSan(pos, m, g.legal);
  makeMove(pos, m);
  const legal = legalMoves(pos);
  const keys = [...g.keys, positionKey(pos)];
  return { pos, legal, keys, history: [...g.history, { move: m, san, fen: toFen(pos) }], status: statusOf(pos, legal, keys) };
}

/** Squares of all pieces as [square, piece] pairs. */
export function pieces(p: Position): [number, number][] {
  const out: [number, number][] = [];
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) if (p.board[square(f, r)]) out.push([square(f, r), p.board[square(f, r)]]);
  return out;
}
