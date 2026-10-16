// Computer players. Every level decides from observe(): its own hand and the table, never anyone else's cards.
import {
  applyMut,
  cardPoints,
  clone,
  handPoints,
  legalMoves,
  rankOf,
  step,
  suitOf,
  viewMoves,
  type Card,
  type Move,
  type State,
  type View,
} from './logic.ts';

export type Level = 0 | 1 | 2;
export type Rand = () => number;
type Table = Pick<State, 'n' | 'dir' | 'pile' | 'suit' | 'pending'> & { counts: readonly number[] };

/** The suit with the most cards (ties go to the heavier suit), ignoring eights. */
export function bestSuit(hand: readonly Card[], skip: Card = -1): number {
  const count = [0, 0, 0, 0];
  const weight = [0, 0, 0, 0];
  for (const c of hand) {
    if (c === skip || rankOf(c) === 8) continue;
    count[suitOf(c)]++;
    weight[suitOf(c)] += cardPoints(c);
  }
  let best = 0;
  for (let s = 1; s < 4; s++) if (count[s] > count[best] || (count[s] === count[best] && weight[s] > weight[best])) best = s;
  return best;
}

/** How much a sensible player likes a play: shed points, keep a suit going, hold eights back, hit a player close to out. */
function playScore(t: Table, me: number, hand: readonly Card[], m: Extract<Move, { t: 'play' }>, hasOther: boolean): number {
  const left = hand.length - 1;
  if (left === 0) return 1000;
  const r = rankOf(m.card);
  const suit = r === 8 ? m.suit! : suitOf(m.card);
  let follow = 0;
  for (const c of hand) if (c !== m.card && suitOf(c) === suit && rankOf(c) !== 8) follow++;
  let score = follow * 6 + cardPoints(m.card) * 0.25;
  const next = step(t, me);
  const nextLow = t.counts[next] <= 2;
  if (r === 8) score += hasOther ? -40 + (left <= 1 ? 45 : 0) : 0;
  else if (r === 2) score += 8 + (nextLow ? 25 : 0);
  else if (r === 11 || (r === 12 && t.n === 2)) score += 4 + (nextLow ? 20 : 0);
  else if (r === 12) score += (nextLow ? 15 : 0) - (t.counts[step(t, me, -1)] <= 2 ? 15 : 0);
  return score;
}

function greedy(t: Table, me: number, hand: readonly Card[], moves: Move[], rand: Rand): Move {
  const plays = moves.filter((m): m is Extract<Move, { t: 'play' }> => m.t === 'play');
  if (!plays.length) return moves.find((m) => m.t === 'draw') ?? moves[0];
  const hasOther = plays.some((m) => rankOf(m.card) !== 8);
  let best = plays[0];
  let bestScore = -Infinity;
  for (const m of plays) {
    if (rankOf(m.card) === 8 && m.suit !== bestSuit(hand, m.card)) continue;
    const score = playScore(t, me, hand, m, hasOther) + rand() * 0.5;
    if (score > bestScore) {
      bestScore = score;
      best = m;
    }
  }
  // Holding a card just drawn: an eight is worth keeping while the hand is still big.
  const pass = moves.find((m) => m.t === 'pass');
  if (pass && rankOf(best.card) === 8 && hand.length > 3) return pass;
  return best;
}

function easy(moves: Move[], rand: Rand): Move {
  const plays = moves.filter((m) => m.t === 'play');
  if (!plays.length) return moves.find((m) => m.t === 'draw') ?? moves[0];
  // Plays whatever fits, eights first in line like any card, and calls a random suit.
  const cards = [...new Set(plays.map((m) => (m as { card: Card }).card))];
  const card = cards[Math.floor(rand() * cards.length)];
  return rankOf(card) === 8 ? { t: 'play', card, suit: Math.floor(rand() * 4) } : { t: 'play', card };

}

/** Deals the cards p can't see into the other hands and the draw pile, keeping to the suits players showed they lack. */
export function sampleWorld(v: View, rand: Rand): State {
  const known = new Set<Card>([...v.hand, ...v.pile]);
  let pool: Card[] = [];
  for (let c = 0; c < 52; c++) if (!known.has(c)) pool.push(c);
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const hands: Card[][] = Array.from({ length: v.n }, (_, i) => (i === v.me ? v.hand.slice() : []));
  for (let q = 0; q < v.n; q++) {
    if (q === v.me || !v.voids[q]) continue;
    const want = Math.min(v.voidCards[q], v.counts[q]);
    const rest: Card[] = [];
    for (const c of pool) {
      if (hands[q].length < want && !(v.voids[q] & (1 << suitOf(c))) && rankOf(c) !== 8) hands[q].push(c);
      else rest.push(c);
    }
    pool = rest;
  }
  for (let q = 0; q < v.n; q++) {
    if (q === v.me) continue;
    while (hands[q].length < v.counts[q] && pool.length) hands[q].push(pool.pop()!);
  }
  return {
    n: v.n,
    hands,
    scores: v.scores.slice(),
    deck: pool,
    pile: v.pile.slice(),
    suit: v.suit,
    turn: v.turn,
    dir: v.dir,
    pending: v.pending,
    drew: v.drew !== null && v.drew >= 0 ? v.drew : null,
    phase: 'play',
    dealer: v.dealer,
    handNo: v.handNo,
    target: v.target,
    stuck: v.stuck,
    voids: v.voids.slice(),
    voidCards: v.voidCards.slice(),
    last: null,
    winner: null,
    rng: Math.floor(rand() * 4294967296),
    log: [],
  };
}

const tableOf = (s: State): Table => ({ n: s.n, dir: s.dir, pile: s.pile, suit: s.suit, pending: s.pending, counts: s.hands.map((h) => h.length) });

/** Plays a sampled hand out with every seat playing sensibly, and scores how it went for `me`. */
function rollout(s: State, me: number, rand: Rand, plies = 160): number {
  for (let i = 0; i < plies && s.phase === 'play'; i++) {
    const p = s.turn;
    const moves = legalMoves(s, p);
    applyMut(s, p, greedy(tableOf(s), p, s.hands[p], moves, rand));
  }
  if (s.phase === 'play') {
    let others = 0;
    for (let q = 0; q < s.n; q++) if (q !== me) others += s.hands[q].length;
    return ((others / (s.n - 1) - s.hands[me].length) / 10) - handPoints(s.hands[me]) / 400;
  }
  const r = s.last!;
  if (r.winner === me) return 1 + r.gained / 100 + (s.phase === 'match-over' ? 1 : 0);
  return -0.5 - r.points[me] / 100 - (s.phase === 'match-over' ? 1 : 0);
}

export type SearchOptions = { worlds?: number; ms?: number; now?: () => number };

/**
 * Hard: tries every move against many deals of the cards it can't see (remembering what's been played and what
 * suits the others showed they lack), plays each one out, and keeps the move that did best on average.
 */
function search(v: View, moves: Move[], rand: Rand, { worlds = 256, ms = Infinity, now = () => Date.now() }: SearchOptions): Move {
  const win = moves.find((m) => m.t === 'play' && v.hand.length === 1);
  if (win) return win;
  const start = now();
  const totals = moves.map(() => 0);
  let done = 0;
  for (; done < worlds; done++) {
    if (done >= 8 && now() - start > ms) break;
    const world = sampleWorld(v, rand);
    const seed = Math.floor(rand() * 4294967296);
    moves.forEach((m, i) => {
      const s = clone(world);
      s.rng = seed;
      if (!applyMut(s, v.me, m)) {
        totals[i] -= 100;
        return;
      }
      totals[i] += rollout(s, v.me, rand);
    });
  }
  const greedyPick = greedy(v, v.me, v.hand, moves, () => 0);
  let best = 0;
  for (let i = 1; i < moves.length; i++) {
    const tie = Math.abs(totals[i] - totals[best]) < 1e-9 && sameMove(moves[i], greedyPick);
    if (totals[i] > totals[best] + 1e-9 || tie) best = i;
  }
  return moves[best];
}

const sameMove = (a: Move, b: Move) => a.t === b.t && (a.t !== 'play' || (b.t === 'play' && a.card === b.card && a.suit === b.suit));

/** A legal move for the player whose view this is. */
export function decide(v: View, level: Level, rand: Rand, opts: SearchOptions = {}): Move {
  const moves = viewMoves(v);
  if (moves.length <= 1) return moves[0] ?? { t: 'pass' };
  if (level === 0) return easy(moves, rand);
  if (level === 1) return greedy(v, v.me, v.hand, moves, rand);
  return search(v, moves, rand, opts);
}


