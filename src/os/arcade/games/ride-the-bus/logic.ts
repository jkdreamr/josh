// Ride the Bus, as pure functions: the deck, the four questions, who rides, and the bus itself.
import { shuffle, type Rng } from '../../kit/party-core.ts';

export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds';
/** Suit order on the answer buttons and the 1 to 4 keys: black and red alternate. */
export const SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
export type Color = 'red' | 'black';

/** Ranks run 2 to 14; aces are high. `id` is unique within one 52 card deck. */
export type Card = { id: number; rank: number; suit: Suit };
export const ACE = 14;
export const QUESTIONS = 4;

export type Guess = Color | 'higher' | 'lower' | 'inside' | 'outside' | Suit;
/** The answers each question offers, in button order (left to right, keys 1 to 4). */
export const CHOICES: readonly (readonly Guess[])[] = [['red', 'black'], ['higher', 'lower'], ['inside', 'outside'], SUITS];

export const colorOf = (card: Card): Color => (card.suit === 'hearts' || card.suit === 'diamonds' ? 'red' : 'black');

/** No single call is worth more than this many sips. */
export const SIP_CAP = 3;
/** Wrong drinks this many, right gives this many: the question number, capped at 3, so cards one to four are 1, 2, 3, 3. */
export const sipsFor = (q: number) => Math.min(q + 1, SIP_CAP);

/** The mercy rule's choices: the rider gets off after this many bus attempts, four in a row or not. There is no "never". */
export const MERCY_TRIES = [5, 10, 15] as const;
export const MERCY_DEFAULT = 5;
const MERCY_MAX = MERCY_TRIES[MERCY_TRIES.length - 1];

/** A fresh, ordered 52 card deck. */
export function makeDeck(): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let rank = 2; rank <= ACE; rank++) deck.push({ id: deck.length, rank, suit });
  return deck;
}

/** Deals a hand of four from the top of the shoe, reshuffling a fresh deck first when fewer than four are left. */
export function dealHand(shoe: readonly Card[], rng: Rng = Math.random): { hand: Card[]; shoe: Card[]; reshuffled: boolean } {
  const reshuffled = shoe.length < QUESTIONS;
  const from = reshuffled ? shuffle(makeDeck(), rng) : shoe;
  return { hand: from.slice(0, QUESTIONS), shoe: from.slice(QUESTIONS), reshuffled };
}

export const checkColor = (card: Card, guess: Guess) => colorOf(card) === guess;

/** Higher or lower than the first card. An equal rank is wrong either way. */
export function checkHigherLower(first: Card, card: Card, guess: Guess) {
  if (guess === 'higher') return card.rank > first.rank;
  if (guess === 'lower') return card.rank < first.rank;
  return false;
}

/** Strictly between the first two cards, or strictly outside them. Landing on either edge is wrong either way. */
export function checkInsideOutside(a: Card, b: Card, card: Card, guess: Guess) {
  const lo = Math.min(a.rank, b.rank);
  const hi = Math.max(a.rank, b.rank);
  if (guess === 'inside') return card.rank > lo && card.rank < hi;
  if (guess === 'outside') return card.rank < lo || card.rank > hi;
  return false;
}

export const checkSuit = (card: Card, guess: Guess) => card.suit === guess;

/**
 * Whether card `q` landed on a rank that makes either answer wrong: the same rank as card one on higher or lower,
 * or the same rank as either edge on inside or outside.
 */
export function isEdge(hand: readonly Card[], q: number): boolean {
  const card = hand[q];
  if (!card) return false;
  if (q === 1) return card.rank === hand[0].rank;
  if (q === 2) return card.rank === hand[0].rank || card.rank === hand[1].rank;
  return false;
}

/** Whether `guess` is right for question `q` (0 to 3) of a hand. */
export function isRight(hand: readonly Card[], q: number, guess: Guess): boolean {
  const card = hand[q];
  if (!card) return false;
  if (q === 0) return checkColor(card, guess);
  if (q === 1) return checkHigherLower(hand[0], card, guess);
  if (q === 2) return checkInsideOutside(hand[0], hand[1], card, guess);
  if (q === 3) return checkSuit(card, guess);
  return false;
}

/** The seat with the most sips taken. Ties are broken at random; `tied` lists everyone who shared the top. */
export function chooseRider(taken: readonly number[], rng: Rng = Math.random): { rider: number; tied: number[] } {
  if (!taken.length) return { rider: 0, tied: [0] };
  const most = Math.max(...taken);
  const tied = taken.flatMap((n, i) => (n === most ? [i] : []));
  return { rider: tied[Math.min(tied.length - 1, Math.floor(rng() * tied.length))], tied };
}

export type Phase = 'questions' | 'results' | 'bus' | 'off';
export type Verdict = { q: number; guess: Guess; right: boolean; sips: number; card: Card };

export type Game = {
  phase: Phase;
  /** How many players are at the table (at least one). */
  count: number;
  /** Whose turn it is: the current player in the questions, the rider on the bus. */
  seat: number;
  /** The four cards of the current turn or bus attempt, face down until answered. */
  hand: Card[];
  /** Cards face up in the hand, which is also the index of the question being asked. */
  shown: number;
  /** The answer to the card just flipped, until `advance` moves on. */
  verdict: Verdict | null;
  /** Right (true) or wrong for each card flipped in this hand. */
  marks: boolean[];
  /** What is left of the shared deck. */
  shoe: Card[];
  /** Sips each player drank and handed out during the questions. */
  taken: number[];
  given: number[];
  /** Seats tied for the most sips when the rider was chosen (one seat means a clear loser). */
  tied: number[];
  /** Bus attempts so far, counting the one in progress, and the sips drunk on the bus. */
  attempts: number;
  busSips: number;
  /** The rider's longest run of right answers on the bus so far (0 to 4). */
  best: number;
  /** The mercy rule: most bus attempts before the rider gets off anyway (1 to 15, never unlimited). */
  limit: number;
  /** True when the rider got off by the mercy rule instead of four in a row. */
  mercy: boolean;
  /** Hands dealt so far, handy as a key for the card row. */
  deals: number;
};

function deal(game: Game, rng: Rng): Game {
  const d = dealHand(game.shoe, rng);
  return { ...game, hand: d.hand, shoe: d.shoe, shown: 0, verdict: null, marks: [], deals: game.deals + 1 };
}

const blank = (count: number): Game => {
  const n = Math.max(1, Math.floor(count));
  return { phase: 'questions', count: n, seat: 0, hand: [], shown: 0, verdict: null, marks: [], shoe: [], taken: Array(n).fill(0), given: Array(n).fill(0), tied: [], attempts: 0, busSips: 0, best: 0, limit: MERCY_DEFAULT, mercy: false, deals: 0 };
};

/** A full game: four questions for every seat in order, starting with seat 0. Pass `shoe` to stack the deck. */
export function startGame(count: number, rng: Rng = Math.random, shoe?: readonly Card[]): Game {
  return deal({ ...blank(count), shoe: shoe ? shoe.slice() : shuffle(makeDeck(), rng) }, rng);
}

/** Straight to the bus with a chosen rider (Just the Bus). */
export function startBus(count: number, rider: number, rng: Rng = Math.random, shoe?: readonly Card[]): Game {
  const g = blank(count);
  return deal({ ...g, phase: 'bus', seat: Math.min(Math.max(0, Math.floor(rider)), g.count - 1), tied: [], attempts: 1, shoe: shoe ? shoe.slice() : shuffle(makeDeck(), rng) }, rng);
}

/** From the results to the bus: the rider gets a fresh hand and their first attempt. */
export function boardBus(game: Game, rng: Rng = Math.random): Game {
  if (game.phase !== 'results') return game;
  return deal({ ...game, phase: 'bus', attempts: 1, busSips: 0, best: 0 }, rng);
}

/**
 * Sets the mercy rule: after `limit` bus attempts the rider gets off anyway. Kept between 1 and 15; anything that
 * isn't a positive number (an old "off" setting stored as 0, say) means the default, never an endless bus.
 */
export function withMercy(game: Game, limit: number): Game {
  const n = Math.floor(limit);
  return { ...game, limit: n > 0 ? Math.min(n, MERCY_MAX) : MERCY_DEFAULT };
}

/** Answers the current question: flips the card and settles the sips. Ignored while a verdict is showing. */
export function answer(game: Game, guess: Guess): Game {
  if ((game.phase !== 'questions' && game.phase !== 'bus') || game.verdict || game.shown >= QUESTIONS) return game;
  const q = game.shown;
  if (!CHOICES[q].includes(guess)) return game;
  const right = isRight(game.hand, q, guess);
  const sips = sipsFor(q);
  const verdict: Verdict = { q, guess, right, sips, card: game.hand[q] };
  const next: Game = { ...game, shown: q + 1, verdict, marks: [...game.marks, right] };
  if (game.phase === 'bus') return right ? { ...next, best: Math.max(game.best, q + 1) } : { ...next, busSips: game.busSips + sips };
  const bump = (list: number[]) => list.map((n, i) => (i === game.seat ? n + sips : n));
  return right ? { ...next, given: bump(game.given) } : { ...next, taken: bump(game.taken) };
}

/** What `advance` will do next, so the screen can label its button. */
export function upcoming(game: Game): 'card' | 'player' | 'results' | 'retry' | 'mercy' | 'off' | null {
  if (!game.verdict) return null;
  if (game.phase === 'questions') return game.shown < QUESTIONS ? 'card' : game.seat + 1 < game.count ? 'player' : 'results';
  if (game.phase === 'bus') {
    if (game.verdict.right) return game.shown < QUESTIONS ? 'card' : 'off';
    return game.attempts >= game.limit ? 'mercy' : 'retry';
  }
  return null;
}

/**
 * Moves on from a verdict. In the questions: the next card, the next player's hand, or the results with a rider.
 * On the bus: the next card, a fresh hand from question 1 after a miss, or off the bus after four in a row
 * (or after the mercy rule's last attempt).
 */
export function advance(game: Game, rng: Rng = Math.random): Game {
  switch (upcoming(game)) {
    case 'card':
      return { ...game, verdict: null };
    case 'player':
      return deal({ ...game, seat: game.seat + 1 }, rng);
    case 'results': {
      const { rider, tied } = chooseRider(game.taken, rng);
      return { ...game, phase: 'results', seat: rider, tied, verdict: null };
    }
    case 'retry':
      return deal({ ...game, attempts: game.attempts + 1 }, rng);
    case 'off':
      return { ...game, phase: 'off', verdict: null };
    case 'mercy':
      return { ...game, phase: 'off', verdict: null, mercy: true };
    default:
      return game;
  }
}

const RANK_NAMES: Record<number, string> = { 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
const SUIT_NAMES: Record<Suit, string> = { spades: 'Spades', hearts: 'Hearts', clubs: 'Clubs', diamonds: 'Diamonds' };
export const rankLabel = (rank: number) => (rank > 10 ? 'JQKA'[rank - 11] : String(rank));
export const rankName = (rank: number) => RANK_NAMES[rank] ?? String(rank);
/** '7s', 'Queens', 'Aces'. */
export const rankPlural = (rank: number) => (RANK_NAMES[rank] ? `${RANK_NAMES[rank]}s` : `${rank}s`);
export const suitName = (suit: Suit) => SUIT_NAMES[suit];
export const cardName = (card: Card) => `${rankName(card.rank)} of ${SUIT_NAMES[card.suit]}`;
