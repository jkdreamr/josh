// Rules for Crazy Eights: match the suit or rank on the pile, eights are wild, twos make the next player draw two
// (a two can be passed on with another two), jacks skip, queens reverse. First out wins the hand and scores the cards
// left in everyone else's hands; first to the target wins the match.

/** A card is 0 to 51: suit is floor(card / 13) (spades, hearts, diamonds, clubs), rank is card % 13 + 1 (ace is 1). */
export type Card = number;
export const SUITS = ['spades', 'hearts', 'diamonds', 'clubs'] as const;
export type SuitName = (typeof SUITS)[number];
export const TARGET = 100;

export const suitOf = (c: Card) => Math.floor(c / 13);
export const rankOf = (c: Card) => (c % 13) + 1;
export const cardOf = (suit: number, rank: number): Card => suit * 13 + rank - 1;
export const isRed = (c: Card) => suitOf(c) === 1 || suitOf(c) === 2;
export const isAction = (c: Card) => {
  const r = rankOf(c);
  return r === 8 || r === 2 || r === 11 || r === 12;
};

/** Points a card left in a hand is worth to whoever went out. */
export function cardPoints(c: Card) {
  const r = rankOf(c);
  if (r === 8) return 50;
  if (r === 2 || r === 11 || r === 12) return 20;
  if (r === 13) return 10;
  return r;
}
export const handPoints = (hand: readonly Card[]) => hand.reduce((sum, c) => sum + cardPoints(c), 0);
export const handSize = (players: number) => (players === 2 ? 7 : 5);

export type Move = { t: 'play'; card: Card; suit?: number } | { t: 'draw' } | { t: 'pass' };
export type Phase = 'play' | 'hand-over' | 'match-over';
export type Ev =
  | { k: 'deal'; n: number }
  | { k: 'play'; p: number; card: Card; suit: number }
  | { k: 'draw'; p: number; n: number; forced: boolean }
  | { k: 'pass'; p: number }
  | { k: 'skip'; p: number }
  | { k: 'reverse'; dir: 1 | -1 }
  | { k: 'reshuffle' }
  | { k: 'out'; p: number; gained: number; blocked: boolean };
export type HandResult = { winner: number; gained: number; points: number[]; hands: Card[][]; blocked: boolean };

export type State = {
  n: number;
  hands: Card[][];
  scores: number[];
  /** Draw pile, top is the last card. */
  deck: Card[];
  /** Discard pile, top is the last card. */
  pile: Card[];
  /** The suit to follow: the top card's, or the one called with an eight. */
  suit: number;
  turn: number;
  dir: 1 | -1;
  /** Cards the player to move must draw unless they pass it on with a two. */
  pending: number;
  /** The card this player just drew by choice: they may play it, or pass. */
  drew: Card | null;
  phase: Phase;
  dealer: number;
  handNo: number;
  target: number;
  /** Players in a row who could neither play nor draw; everyone stuck ends the hand. */
  stuck: number;
  /**
   * What everyone can see: a player who drew instead of following showed they had nothing of that suit, so at least
   * voidCards[p] of their cards (the ones held then, less any played since) are none of the suits in voids[p].
   */
  voids: number[];
  voidCards: number[];
  last: HandResult | null;
  winner: number | null;
  rng: number;
  /** What the last move did, for animation and sound. */
  log: Ev[];
};

export function nextRandom(seed: number): [number, number] {
  let t = (seed + 0x6d2b79f5) >>> 0;
  const next = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return [((t ^ (t >>> 14)) >>> 0) / 4294967296, next];
}

/** A random function over a mutable seed, so a state's shuffles replay exactly. */
export function randomFrom(seed: number) {
  let s = seed >>> 0;
  return () => {
    const [v, n] = nextRandom(s);
    s = n;
    return v;
  };
}

function shuffleWith(s: State, cards: Card[]) {
  for (let i = cards.length - 1; i > 0; i--) {
    const [v, n] = nextRandom(s.rng);
    s.rng = n;
    const j = Math.floor(v * (i + 1));
    [cards[i], cards[j]] = [cards[j], cards[i]];
  }
  return cards;
}

export function clone(s: State): State {
  return {
    ...s,
    hands: s.hands.map((h) => h.slice()),
    scores: s.scores.slice(),
    deck: s.deck.slice(),
    pile: s.pile.slice(),
    voids: s.voids.slice(),
    voidCards: s.voidCards.slice(),
    log: [],
  };
}

export function newMatch(players: number, seed: number, target = TARGET): State {
  const n = Math.max(2, Math.min(4, Math.floor(players)));
  const s: State = {
    n,
    hands: [],
    scores: Array(n).fill(0),
    deck: [],
    pile: [],
    suit: 0,
    turn: 0,
    dir: 1,
    pending: 0,
    drew: null,
    phase: 'play',
    dealer: 0,
    handNo: 0,
    target,
    stuck: 0,
    voids: [],
    voidCards: [],
    last: null,
    winner: null,
    rng: seed >>> 0,
    log: [],
  };
  const [v, next] = nextRandom(s.rng);
  s.rng = next;
  s.dealer = Math.floor(v * n);
  deal(s);
  return s;
}

function deal(s: State) {
  s.handNo++;
  s.deck = shuffleWith(s, Array.from({ length: 52 }, (_, i) => i));
  s.hands = Array.from({ length: s.n }, () => []);
  const size = handSize(s.n);
  for (let k = 0; k < size; k++) for (let i = 1; i <= s.n; i++) s.hands[(s.dealer + i) % s.n].push(s.deck.pop()!);
  // The starter is never an action card: those go back into the middle of the pile.
  let starter = s.deck.pop()!;
  while (isAction(starter)) {
    s.deck.splice(Math.floor(s.deck.length / 2), 0, starter);
    starter = s.deck.pop()!;
  }
  s.pile = [starter];
  s.suit = suitOf(starter);
  s.dir = 1;
  s.turn = (s.dealer + 1) % s.n;
  s.pending = 0;
  s.drew = null;
  s.stuck = 0;
  s.voids = Array(s.n).fill(0);
  s.voidCards = Array(s.n).fill(0);
  s.last = null;
  s.phase = 'play';
  s.log.push({ k: 'deal', n: size });
}

export const top = (s: Pick<State, 'pile'>) => s.pile[s.pile.length - 1];
export const step = (s: Pick<State, 'n' | 'dir'>, from: number, by = 1) => (((from + s.dir * by) % s.n) + s.n) % s.n;

export function canPlay(s: Pick<State, 'pile' | 'suit' | 'pending'>, c: Card) {
  if (s.pending > 0) return rankOf(c) === 2;
  const r = rankOf(c);
  return r === 8 || suitOf(c) === s.suit || r === rankOf(top(s));
}

/** Cards that can still be drawn: the pile, or the discards under the top card once it runs out. */
export const drawable = (s: Pick<State, 'deck' | 'pile'>) => s.deck.length + s.pile.length - 1;

const playsFor = (card: Card): Move[] => (rankOf(card) === 8 ? [0, 1, 2, 3].map((suit) => ({ t: 'play', card, suit })) : [{ t: 'play', card }]);

export function legalMoves(s: State, p: number): Move[] {
  if (s.phase !== 'play' || s.turn !== p) return [];
  if (s.pending > 0) {
    const moves = s.hands[p].filter((c) => rankOf(c) === 2).map((card): Move => ({ t: 'play', card }));
    moves.push({ t: 'draw' });
    return moves;
  }
  if (s.drew !== null) return [...(canPlay(s, s.drew) ? playsFor(s.drew) : []), { t: 'pass' }];
  const moves = s.hands[p].filter((c) => canPlay(s, c)).flatMap(playsFor);
  if (drawable(s) > 0) moves.push({ t: 'draw' });
  else if (!moves.length) moves.push({ t: 'pass' });
  return moves;
}

export function isLegal(s: State, p: number, m: Move) {
  return legalMoves(s, p).some((x) => x.t === m.t && (x.t !== 'play' || (m.t === 'play' && x.card === m.card && (x.suit ?? -1) === (m.suit ?? -1))));
}

function drawOne(s: State): Card | null {
  if (!s.deck.length) {
    if (s.pile.length <= 1) return null;
    const keep = s.pile.pop()!;
    s.deck = shuffleWith(s, s.pile);
    s.pile = [keep];
    s.log.push({ k: 'reshuffle' });
  }
  return s.deck.pop() ?? null;
}

function endHand(s: State, winner: number, blocked: boolean) {
  const points = s.hands.map(handPoints);
  const gained = points.reduce((sum, p, i) => (i === winner ? sum : sum + p), 0);
  s.scores[winner] += gained;
  s.last = { winner, gained, points, hands: s.hands.map((h) => h.slice()), blocked };
  s.drew = null;
  s.pending = 0;
  s.log.push({ k: 'out', p: winner, gained, blocked });
  if (s.scores[winner] >= s.target) {
    s.phase = 'match-over';
    s.winner = winner;
  } else s.phase = 'hand-over';
}

/** Applies a move in place. Returns false (and changes nothing) when it isn't legal. */
export function applyMut(s: State, p: number, m: Move): boolean {
  if (!isLegal(s, p, m)) return false;
  const hand = s.hands[p];
  if (m.t === 'play') {
    hand.splice(hand.indexOf(m.card), 1);
    s.pile.push(m.card);
    const r = rankOf(m.card);
    s.suit = r === 8 ? m.suit! : suitOf(m.card);
    s.drew = null;
    s.stuck = 0;
    s.voidCards[p] = Math.max(0, s.voidCards[p] - 1);
    s.log.push({ k: 'play', p, card: m.card, suit: s.suit });
    if (!hand.length) {
      endHand(s, p, false);
      return true;
    }
    if (r === 2) {
      s.pending += 2;
      s.turn = step(s, p);
    } else if (r === 11 || (r === 12 && s.n === 2)) {
      const skipped = step(s, p);
      s.log.push({ k: 'skip', p: skipped });
      s.turn = step(s, p, 2);
    } else if (r === 12) {
      s.dir = s.dir === 1 ? -1 : 1;
      s.log.push({ k: 'reverse', dir: s.dir });
      s.turn = step(s, p);
    } else s.turn = step(s, p);
    return true;
  }
  if (m.t === 'draw') {
    if (s.pending > 0) {
      let n = 0;
      for (; n < s.pending; n++) {
        const c = drawOne(s);
        if (c === null) break;
        hand.push(c);
      }
      s.pending = 0;
      s.log.push({ k: 'draw', p, n, forced: true });
      s.turn = step(s, p);
      return true;
    }
    s.voids[p] |= 1 << s.suit;
    s.voidCards[p] = Math.max(s.voidCards[p], hand.length);
    const c = drawOne(s)!;
    hand.push(c);
    s.log.push({ k: 'draw', p, n: 1, forced: false });
    s.stuck = 0;
    if (canPlay(s, c)) s.drew = c;
    else {
      s.log.push({ k: 'pass', p });
      s.turn = step(s, p);
    }
    return true;
  }
  // pass
  const stuck = s.drew === null;
  s.drew = null;
  s.log.push({ k: 'pass', p });
  if (stuck) {
    s.stuck++;
    if (s.stuck >= s.n) {
      // Nobody can move: the lightest hand wins it.
      const points = s.hands.map(handPoints);
      let best = 0;
      for (let i = 1; i < s.n; i++) if (points[i] < points[best]) best = i;
      endHand(s, best, true);
      return true;
    }
  }
  s.turn = step(s, p);
  return true;
}

/** The state after a move, or null when it isn't legal. The input is left untouched. */
export function apply(s: State, p: number, m: Move): State | null {
  const next = clone(s);
  return applyMut(next, p, m) ? next : null;
}

export function nextHand(s: State): State {
  if (s.phase !== 'hand-over') return s;
  const next = clone(s);
  next.dealer = (next.dealer + 1) % next.n;
  deal(next);
  return next;
}

/** Everything player p may know: their own hand and what's on the table. Bots decide from this alone. */
export type View = {
  n: number;
  me: number;
  hand: Card[];
  counts: number[];
  scores: number[];
  pile: Card[];
  deckCount: number;
  suit: number;
  turn: number;
  dir: 1 | -1;
  pending: number;
  /** The card p just drew (only for p), or -1 when someone else is holding a card they drew. */
  drew: Card | null;
  phase: Phase;
  dealer: number;
  handNo: number;
  target: number;
  stuck: number;
  voids: number[];
  voidCards: number[];
  last: HandResult | null;
  winner: number | null;
};

export function observe(s: State, p: number): View {
  return {
    n: s.n,
    me: p,
    hand: s.hands[p].slice(),
    counts: s.hands.map((h) => h.length),
    scores: s.scores.slice(),
    pile: s.pile.slice(),
    deckCount: s.deck.length,
    suit: s.suit,
    turn: s.turn,
    dir: s.dir,
    pending: s.pending,
    drew: s.drew === null ? null : s.turn === p ? s.drew : -1,
    phase: s.phase,
    dealer: s.dealer,
    handNo: s.handNo,
    target: s.target,
    stuck: s.stuck,
    voids: s.voids.slice(),
    voidCards: s.voidCards.slice(),
    last: s.phase === 'play' ? null : s.last,
    winner: s.winner,
  };
}

/** Moves p could make from what they can see (the same list legalMoves gives on the full state). */
export function viewMoves(v: View): Move[] {
  if (v.phase !== 'play' || v.turn !== v.me) return [];
  if (v.pending > 0) return [...v.hand.filter((c) => rankOf(c) === 2).map((card): Move => ({ t: 'play', card })), { t: 'draw' }];
  if (v.drew !== null && v.drew >= 0) return [...(canPlay(v, v.drew) ? playsFor(v.drew) : []), { t: 'pass' }];
  const moves = v.hand.filter((c) => canPlay(v, c)).flatMap(playsFor);
  if (v.deckCount + v.pile.length - 1 > 0) moves.push({ t: 'draw' });
  else if (!moves.length) moves.push({ t: 'pass' });
  return moves;
}

/** Checks a move's shape from the network before it's judged against the rules. */
export function parseMove(d: unknown): Move | null {
  if (!d || typeof d !== 'object') return null;
  const m = d as { t?: unknown; card?: unknown; suit?: unknown };
  if (m.t === 'draw' || m.t === 'pass') return { t: m.t };
  if (m.t !== 'play' || !Number.isInteger(m.card) || (m.card as number) < 0 || (m.card as number) > 51) return null;
  if (m.suit === undefined) return { t: 'play', card: m.card as number };
  if (!Number.isInteger(m.suit) || (m.suit as number) < 0 || (m.suit as number) > 3) return null;
  return { t: 'play', card: m.card as number, suit: m.suit as number };
}

const RANK_LABELS = ['', 'A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const RANK_NAMES = ['', 'Ace', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Jack', 'Queen', 'King'];
export const rankLabel = (c: Card) => RANK_LABELS[rankOf(c)];
export const suitLabel = (suit: number) => ['Spades', 'Hearts', 'Diamonds', 'Clubs'][suit];
export const cardName = (c: Card) => `${RANK_NAMES[rankOf(c)]} of ${suitLabel(suitOf(c))}`;
