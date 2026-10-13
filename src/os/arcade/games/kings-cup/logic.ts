import { shuffle, type Rng } from '../../kit/party-core.ts';

// Kings Cup, also called Ring of Fire: 52 cards face down in a ring around a cup. Each card has a rule; the fourth
// king ends the game and whoever drew it drinks the cup. Pure, so the tests run it under plain node.

export type Suit = 'spades' | 'hearts' | 'clubs' | 'diamonds';
export const SUITS: readonly Suit[] = ['spades', 'hearts', 'clubs', 'diamonds'];
export type Card = { id: number; rank: number; suit: Suit };

export const DECK_SIZE = 52;
/** The king that ends the game. */
export const LAST_KING = 4;

export const isRed = (c: Card) => c.suit === 'hearts' || c.suit === 'diamonds';
export const rankLabel = (r: number) => (r === 1 ? 'A' : r === 11 ? 'J' : r === 12 ? 'Q' : r === 13 ? 'K' : String(r));
export const rankName = (r: number) => (r === 1 ? 'Ace' : r === 11 ? 'Jack' : r === 12 ? 'Queen' : r === 13 ? 'King' : String(r));
const SUIT_NAMES: Record<Suit, string> = { spades: 'Spades', hearts: 'Hearts', clubs: 'Clubs', diamonds: 'Diamonds' };
export const cardName = (c: Card) => `${rankName(c.rank)} of ${SUIT_NAMES[c.suit]}`;

/** A fresh, ordered deck. Ids are 0 to 51. */
export function makeDeck(): Card[] {
  return SUITS.flatMap((suit, s) => Array.from({ length: 13 }, (_, i) => ({ id: s * 13 + i, rank: i + 1, suit })));
}

// House rules ---------------------------------------------------------------------------------------------------

export type Rule = { name: string; text: string };
export const RULE_NAME_MAX = 24;
export const RULE_TEXT_MAX = 140;
/** Longest rule a jack can make. */
export const MADE_RULE_MAX = 80;

/** Index 0 is the ace, 12 the king. */
export const CLASSIC_RULES: readonly Rule[] = [
  { name: 'Waterfall', text: 'Everyone drinks, starting with you. Nobody stops until the person before them does.' },
  { name: 'You', text: 'Pick someone to drink.' },
  { name: 'Me', text: 'You drink.' },
  { name: 'Floor', text: 'Last to touch the floor drinks.' },
  { name: 'Guys', text: 'Guys drink.' },
  { name: 'Girls', text: 'Girls drink.' },
  { name: 'Heaven', text: 'Last to point up drinks.' },
  { name: 'Mate', text: 'Pick a mate. They drink whenever you do, for the rest of the game.' },
  { name: 'Rhyme', text: 'Say a word. Go around rhyming with it. First to miss drinks.' },
  { name: 'Categories', text: 'Pick a category. Go around naming things in it. First to miss drinks.' },
  { name: 'Make a Rule', text: 'Make a rule everyone follows until the game ends. Break it, drink.' },
  { name: 'Questions', text: "You're the Question Master. Anyone who answers your question drinks, until the next queen." },
  { name: 'Kings Cup', text: 'Pour some of your drink into the cup. Whoever draws the fourth king drinks it all.' },
];

/** Trims, folds whitespace, drops control characters and caps the length of typed text. */
export function tidy(raw: string, max: number): string {
  const clean = raw
    .replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return Array.from(clean).slice(0, max).join('').trim();
}

/** The rule for one rank, cleaned up. A blank or missing name falls back to the classic rule for that rank. */
function cleanRule(raw: unknown, i: number): Rule {
  const classic = CLASSIC_RULES[i];
  if (!raw || typeof raw !== 'object') return classic;
  const { name, text } = raw as { name?: unknown; text?: unknown };
  const n = typeof name === 'string' ? tidy(name, RULE_NAME_MAX) : '';
  if (!n) return classic;
  return { name: n, text: typeof text === 'string' ? tidy(text, RULE_TEXT_MAX) : '' };
}

/** Turns whatever was stored into 13 valid rules, keeping the classic rule for any rank that doesn't check out. */
export function parseRules(raw: unknown): Rule[] {
  const list = Array.isArray(raw) ? raw : [];
  return CLASSIC_RULES.map((_, i) => cleanRule(list[i], i));
}

/** The rule for a rank (1 is the ace, 13 the king). */
export const ruleFor = (rules: readonly Rule[], rank: number): Rule => rules[rank - 1] ?? CLASSIC_RULES[rank - 1];

/** A copy of the rules with one rank changed. A blank name puts the classic rule back. */
export function setRule(rules: readonly Rule[], rank: number, name: string, text: string): Rule[] {
  const out = parseRules(rules);
  if (rank < 1 || rank > 13) return out;
  out[rank - 1] = cleanRule({ name, text }, rank - 1);
  return out;
}

export const isClassic = (rule: Rule, rank: number) => {
  const c = CLASSIC_RULES[rank - 1];
  return !!c && rule.name === c.name && rule.text === c.text;
};
export const rulesEdited = (rules: readonly Rule[]) => rules.some((r, i) => !isClassic(r, i + 1));

// Mates ---------------------------------------------------------------------------------------------------------

/** Two seats that drink together. Mates chain: a mate of your mate drinks too. */
export type Pair = readonly [number, number];

/** Groups of seats linked by mate pairs (two or more each), in the order they first appeared. */
export function mateGroups(pairs: readonly Pair[]): number[][] {
  const parent = new Map<number, number>();
  const find = (x: number): number => {
    let r = x;
    while (parent.has(r) && parent.get(r) !== r) r = parent.get(r)!;
    return r;
  };
  const order: number[] = [];
  for (const [a, b] of pairs) {
    for (const s of [a, b])
      if (!parent.has(s)) {
        parent.set(s, s);
        order.push(s);
      }
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(rb, ra);
  }
  const groups = new Map<number, number[]>();
  for (const s of order) {
    const r = find(s);
    groups.set(r, [...(groups.get(r) ?? []), s]);
  }
  return [...groups.values()].filter((g) => g.length > 1).map((g) => g.sort((x, y) => x - y));
}

/** Everyone who drinks when `seat` drinks, not counting `seat`. */
export function matesOf(pairs: readonly Pair[], seat: number): number[] {
  return mateGroups(pairs).find((g) => g.includes(seat))?.filter((s) => s !== seat) ?? [];
}

/** Links two seats. Picking yourself or someone already in your group changes nothing. */
export function addMate(pairs: readonly Pair[], a: number, b: number): Pair[] {
  if (a === b || a < 0 || b < 0 || matesOf(pairs, a).includes(b)) return pairs.slice();
  return [...pairs, [Math.min(a, b), Math.max(a, b)]];
}

// The game ------------------------------------------------------------------------------------------------------

export type Game = {
  /** The cards around the cup, slot 0 at the top, going clockwise. Null once drawn. */
  ring: (Card | null)[];
  /** Every card drawn so far, in order. */
  drawn: Card[];
  kings: number;
  /** Slot of the last card drawn, -1 before the first draw. */
  last: number;
  /** How many named players are seated (0 plays without names). */
  seats: number;
  /** The seat that draws next. */
  turn: number;
  /** Whoever drew the most recent queen (seat is null without names). */
  master: { seat: number | null; card: Card } | null;
  mates: Pair[];
  /** Rules made with jacks. */
  made: string[];
  over: boolean;
};

/** A freshly shuffled ring. `first` is the seat that draws first. */
export function newGame(seats: number, rng: Rng = Math.random, first = 0): Game {
  const n = Math.max(0, Math.floor(seats));
  return {
    ring: shuffle(makeDeck(), rng),
    drawn: [],
    kings: 0,
    last: -1,
    seats: n,
    turn: n > 0 ? ((Math.floor(first) % n) + n) % n : 0,
    master: null,
    mates: [],
    made: [],
    over: false,
  };
}

export const cardsLeft = (g: Game) => g.ring.reduce((n, c) => n + (c ? 1 : 0), 0);

/** The seat after `seat`, going around the table. */
export const nextSeat = (seat: number, seats: number) => (seats > 0 ? (seat + 1) % seats : 0);

/** Angle of a ring slot in degrees, 0 at the top and growing clockwise. */
export const slotAngle = (slot: number, slots = DECK_SIZE) => (slot * 360) / slots;

/** The next card still in the ring, going clockwise from the last one drawn. -1 when the ring is empty. */
export function nextSlot(g: Game): number {
  const n = g.ring.length;
  for (let k = 1; k <= n; k++) {
    const i = (g.last + k + n) % n;
    if (g.ring[i]) return i;
  }
  return -1;
}

/** The card still in the ring closest to an angle (degrees, 0 at the top, clockwise). -1 when the ring is empty. */
export function nearestSlot(g: Game, angle: number): number {
  let best = -1;
  let gap = Infinity;
  g.ring.forEach((c, i) => {
    if (!c) return;
    const d = Math.abs((((slotAngle(i, g.ring.length) - angle) % 360) + 540) % 360 - 180);
    if (d < gap - 1e-9) {
      gap = d;
      best = i;
    }
  });
  return best;
}

export type Drawn = {
  card: Card;
  slot: number;
  /** Who drew it, or null without names. */
  seat: number | null;
  /** Kings drawn so far, this one included. */
  kings: number;
  /** True for the fourth king: drink the cup. */
  last: boolean;
};

/**
 * Draws the card in `slot`, or the next one clockwise when that slot is empty or not given.
 * Returns null once the game is over or the ring is empty.
 */
export function draw(g: Game, slot?: number): { game: Game; drawn: Drawn } | null {
  if (g.over) return null;
  const i = slot !== undefined && g.ring[slot] ? slot : nextSlot(g);
  const card = i >= 0 ? g.ring[i] : null;
  if (!card) return null;
  const ring = g.ring.slice();
  ring[i] = null;
  const seat = g.seats > 0 ? g.turn : null;
  const kings = g.kings + (card.rank === 13 ? 1 : 0);
  const last = card.rank === 13 && kings >= LAST_KING;
  const game: Game = {
    ...g,
    ring,
    drawn: [...g.drawn, card],
    kings,
    last: i,
    turn: nextSeat(g.turn, g.seats),
    master: card.rank === 12 ? { seat, card } : g.master,
    over: last || ring.every((c) => !c),
  };
  return { game, drawn: { card, slot: i, seat, kings, last } };
}

/** Adds a rule made with a jack. Blank rules are ignored. */
export function makeRule(g: Game, raw: string): Game {
  const text = tidy(raw, MADE_RULE_MAX);
  return text ? { ...g, made: [...g.made, text] } : g;
}

export function dropRule(g: Game, index: number): Game {
  return index >= 0 && index < g.made.length ? { ...g, made: g.made.filter((_, i) => i !== index) } : g;
}

/** How full the cup is, 0 to 1. */
export const cupLevel = (kings: number) => Math.max(0, Math.min(1, kings / LAST_KING));
