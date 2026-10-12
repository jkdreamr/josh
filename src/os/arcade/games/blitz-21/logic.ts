export type Suit = 'spades' | 'hearts' | 'diamonds' | 'clubs';
export type Card = { id: number; rank: number; suit: Suit };
export type EndReason = 'deck' | 'time' | 'busts';
export type Tally = { clears: number; fiveCards: number; blackjacks: number; streakPoints: number; bestStreak: number; placed: number };
export type State = {
  deck: Card[];
  /** Index of the card waiting to be placed. */
  next: number;
  lanes: Card[][];
  busts: number;
  streak: number;
  score: number;
  timeLeft: number;
  tally: Tally;
  over: EndReason | null;
};
export type PlayKind = 'place' | 'clear' | 'bust';
export type PlayResult = {
  kind: PlayKind;
  lane: number;
  card: Card;
  /** The column as it stood with the new card, before a clear or bust emptied it. */
  cards: Card[];
  total: number;
  points: number;
  streak: number;
  fiveCard: boolean;
  blackjack: boolean;
};
export type Breakdown = {
  clears: number;
  clearPoints: number;
  fiveCards: number;
  fivePoints: number;
  blackjacks: number;
  blackjackPoints: number;
  bestStreak: number;
  streakPoints: number;
  busts: number;
  timeBonus: number;
  cleanBonus: number;
  total: number;
};

export const LANES = 4;
export const MAX_BUSTS = 3;
export const FIVE_CARDS = 5;
export const ROUND_SECONDS = 150;
export const POINTS = { clear: 400, fiveCard: 600, blackjack: 200, streakStep: 150, perSecond: 20, cleanDeck: 1000 } as const;
export const SUITS: readonly Suit[] = ['spades', 'hearts', 'diamonds', 'clubs'];

export const isRed = (c: Card) => c.suit === 'hearts' || c.suit === 'diamonds';
export const rankLabel = (rank: number) => (rank === 1 ? 'A' : rank === 11 ? 'J' : rank === 12 ? 'Q' : rank === 13 ? 'K' : String(rank));
export const cardValue = (c: Card) => Math.min(10, c.rank);

/** Hard total counts every ace as 1; soft is the total with one ace as 11 when that stays at or under 21. */
export function laneTotal(cards: readonly Card[]): { hard: number; soft: number | null; best: number } {
  const hard = cards.reduce((n, c) => n + cardValue(c), 0);
  const soft = cards.some((c) => c.rank === 1) && hard + 10 <= 21 ? hard + 10 : null;
  return { hard, soft, best: soft ?? hard };
}

/** Small seeded generator so rounds can be replayed in tests. */
export function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function makeDeck(rng: () => number = Math.random): Card[] {
  const deck: Card[] = [];
  for (const suit of SUITS) for (let rank = 1; rank <= 13; rank++) deck.push({ id: deck.length, rank, suit });
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function createGame(rng: () => number = Math.random, deck: Card[] = makeDeck(rng)): State {
  return {
    deck,
    next: 0,
    lanes: Array.from({ length: LANES }, () => []),
    busts: 0,
    streak: 0,
    score: 0,
    timeLeft: ROUND_SECONDS,
    tally: { clears: 0, fiveCards: 0, blackjacks: 0, streakPoints: 0, bestStreak: 0, placed: 0 },
    over: null,
  };
}

export const currentCard = (s: State): Card | null => (s.over ? null : (s.deck[s.next] ?? null));
export const upcomingCard = (s: State): Card | null => (s.over ? null : (s.deck[s.next + 1] ?? null));
export const cardsLeft = (s: State) => Math.max(0, s.deck.length - s.next);

/** Bonus for the nth clear in a row: nothing for the first, then 150, 300, 450... */
export const streakBonus = (streak: number) => (streak >= 2 ? POINTS.streakStep * (streak - 1) : 0);

/** What placing a card on a column would do, without changing anything. */
export function preview(cards: readonly Card[], card: Card): PlayKind {
  const t = laneTotal([...cards, card]);
  if (t.hard > 21) return 'bust';
  if (t.best === 21 || cards.length + 1 >= FIVE_CARDS) return 'clear';
  return 'place';
}

export function play(s: State, lane: number): { state: State; result: PlayResult } | null {
  const card = currentCard(s);
  if (!card || lane < 0 || lane >= LANES || !Number.isInteger(lane)) return null;
  const cards = [...s.lanes[lane], card];
  const total = laneTotal(cards);
  const kind = preview(s.lanes[lane], card);
  const lanes = s.lanes.map((l, i) => (i === lane ? (kind === 'place' ? cards : []) : l));
  const tally = { ...s.tally, placed: s.tally.placed + 1 };
  let { busts, streak, score } = s;
  let points = 0;
  const fiveCard = kind === 'clear' && cards.length >= FIVE_CARDS;
  const blackjack = kind === 'clear' && cards.length === 2 && total.best === 21;
  if (kind === 'bust') {
    busts += 1;
    streak = 0;
  } else if (kind === 'clear') {
    streak += 1;
    const bonus = streakBonus(streak);
    points = POINTS.clear + (fiveCard ? POINTS.fiveCard : 0) + (blackjack ? POINTS.blackjack : 0) + bonus;
    tally.clears += 1;
    if (fiveCard) tally.fiveCards += 1;
    if (blackjack) tally.blackjacks += 1;
    tally.streakPoints += bonus;
    tally.bestStreak = Math.max(tally.bestStreak, streak);
  } else streak = 0;
  score += points;
  const next = s.next + 1;
  const over: EndReason | null = busts >= MAX_BUSTS ? 'busts' : next >= s.deck.length ? 'deck' : null;
  return {
    state: { ...s, lanes, busts, streak, score, next, tally, over },
    result: { kind, lane, card, cards, total: kind === 'bust' ? total.hard : total.best, points, streak, fiveCard, blackjack },
  };
}

/** Runs the round clock. The round ends when it reaches zero. */
export function tick(s: State, seconds: number): State {
  if (s.over || seconds <= 0) return s;
  const timeLeft = Math.max(0, s.timeLeft - seconds);
  return { ...s, timeLeft, over: timeLeft <= 0 ? 'time' : null };
}

/** Final score. Time left and a bust free deck only pay out when the whole deck was played. */
export function breakdown(s: State): Breakdown {
  const t = s.tally;
  const deckDone = s.over === 'deck';
  const timeBonus = deckDone ? Math.ceil(s.timeLeft) * POINTS.perSecond : 0;
  const cleanBonus = deckDone && s.busts === 0 ? POINTS.cleanDeck : 0;
  const clearPoints = t.clears * POINTS.clear;
  const fivePoints = t.fiveCards * POINTS.fiveCard;
  const blackjackPoints = t.blackjacks * POINTS.blackjack;
  return {
    clears: t.clears,
    clearPoints,
    fiveCards: t.fiveCards,
    fivePoints,
    blackjacks: t.blackjacks,
    blackjackPoints,
    bestStreak: t.bestStreak,
    streakPoints: t.streakPoints,
    busts: s.busts,
    timeBonus,
    cleanBonus,
    total: clearPoints + fivePoints + blackjackPoints + t.streakPoints + timeBonus + cleanBonus,
  };
}
