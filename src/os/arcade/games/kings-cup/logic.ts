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

/** Index 0 is the ace, 12 the king. Each one is short enough to read out in one breath. */
export const CLASSIC_RULES: readonly Rule[] = [
  { name: 'Waterfall', text: 'Everyone drinks, starting with you. You stop after a few seconds, then each person in turn.' },
  { name: 'You', text: 'Pick someone to drink.' },
  { name: 'Me', text: 'You drink.' },
  { name: 'Floor', text: 'Last to touch the floor drinks.' },
  { name: 'Guys', text: 'Guys drink.' },
  { name: 'Girls', text: 'Girls drink.' },
  { name: 'Heaven', text: 'Last to point up drinks.' },
  { name: 'Mate', text: 'Pick a mate. They drink whenever you do, until one of you gets a new one.' },
  { name: 'Rhyme', text: 'Say a word. Go around rhyming with it. First to miss drinks.' },
  { name: 'Categories', text: 'Name a category. Go around naming things in it. First to blank drinks.' },
  { name: 'Make a Rule', text: 'Make a rule that lasts all game. Anyone who breaks it drinks.' },
  { name: 'Questions', text: "You're Question Master until the next queen. Anyone who answers your question drinks." },
  { name: 'Kings Cup', text: 'Pour a splash into the cup. Whoever pulls the fourth king drinks it.' },
];

/** The king's rank. Its rule never changes: every king fills the cup, and the fourth ends the game. */
export const KING = 13;

/** Well-known rules a table can swap onto any card in the house rules. */
export const ALTERNATE_RULES: readonly Rule[] = [
  { name: 'Jive', text: 'Do a dance move. The next person repeats it and adds one. First to slip drinks.' },
  { name: 'Taller', text: 'Everyone taller than you drinks. Close calls go back to back.' },
  { name: 'Thumb Master', text: 'Thumb on the table any time, until the next one. Last to copy you drinks.' },
  { name: 'Snake Eyes', text: 'Until the next one, anyone who looks you in the eye drinks.' },
  { name: 'Social', text: 'Everyone drinks.' },
  { name: 'Never Have I Ever', text: "Say something you've never done. Everyone who has, drinks." },
  { name: 'Most Likely To', text: "Ask who's most likely to do something. Everyone points on three. Most fingers drinks." },
  { name: 'Would You Rather', text: 'Ask a would you rather. The smaller side drinks.' },
  { name: 'Thumb War', text: 'Pick someone for a thumb war. Loser drinks.' },
  { name: 'Accents', text: 'Talk in an accent until your next turn. Slip up, drink.' },
];

/** Swaps without a gender in them, offered first on the cards that have one (Guys and Girls). */
const UNGENDERED: Record<number, string> = { 5: 'Jive', 6: 'Taller' };

/**
 * 18+ swaps, offered only when the table turns on 18+ Rules. Frank, never graphic, everyone stays at swimsuit level
 * or more, and anything that brings in someone else waits for their yes.
 */
export const SPICY_RULES: readonly Rule[] = [
  { name: 'Spicy Never Have I Ever', text: "Say something spicy you've never done. Everyone who has, drinks." },
  { name: 'Body Shot', text: "Take a sip off someone's collarbone, if they say yes. No takers? Just drink." },
  { name: 'Truth or Strip a Layer', text: "Answer the table's question or lose a layer. Shoes count, and nobody goes past swimwear." },
  { name: 'Seven Minutes of Silence', text: "Sit on someone's lap for seven minutes, if they say yes. Speak and drink." },
  { name: 'Sexy Voice', text: 'Talk in your sexiest voice until your next turn. Break character, drink.' },
  { name: 'O Face', text: 'Show the table your O face for three full seconds, or drink.' },
  { name: 'Kiss or Drink', text: 'Kiss anyone on the cheek, if they say yes. No takers? Drink.' },
  { name: 'Hot Seat', text: 'Everyone asks you one spicy question. Skip one and drink.' },
  { name: 'Body Count', text: 'Everyone guesses your body count. Confirm it, deny it or drink.' },
  { name: 'Spicy Most Likely To', text: "Ask who's most likely to do something spicy. Point on three. Most fingers drinks." },
];

/** The stored 18+ Rules switch: on only when it was explicitly turned on. */
export const parseSpicy = (raw: unknown): boolean => raw === true;

const same = (a: Rule, b: Rule) => a.name === b.name && a.text === b.text;
/** True for a rule from the 18+ set, word for word. */
export const isSpicy = (rule: Rule) => SPICY_RULES.some((r) => same(r, rule));
/** The rules with every 18+ swap put back to the classic rule for its card. */
export const stripSpicy = (rules: readonly Rule[]): Rule[] => parseRules(rules).map((r, i) => (isSpicy(r) ? CLASSIC_RULES[i] : r));

/** The swaps offered for one card: its classic rule first, then ungendered ones where it fits, then the rest. */
export function swapsFor(rank: number, spicy = false): Rule[] {
  const classic = CLASSIC_RULES[rank - 1];
  if (!classic) return [];
  const first = ALTERNATE_RULES.filter((r) => r.name === UNGENDERED[rank]);
  const out = [classic, ...first, ...ALTERNATE_RULES.filter((r) => !first.includes(r)), ...(spicy ? SPICY_RULES : [])];
  return out.filter((r, i) => out.findIndex((x) => x.name === r.name) === i);
}

/**
 * Rules the game keeps track of. They follow the rule's name, not the card, so moving Mate onto a five or swapping
 * the eight for Thumb Master moves what the table shows with it.
 */
export type RuleKind = 'mate' | 'make' | RoleKind;
/** Rules someone holds until the next card with the same rule. */
export type RoleKind = 'questions' | 'thumb' | 'snake';
export const ROLE_TITLES: Record<RoleKind, string> = { questions: 'Question Master', thumb: 'Thumb Master', snake: 'Snake Eyes' };
const KIND_NAMES: Record<RuleKind, readonly string[]> = {
  mate: ['mate', 'mates', 'pick a mate', 'drinking buddy'],
  make: ['make a rule', 'rule', 'rules', 'new rule', 'rule maker'],
  questions: ['questions', 'question master', 'question'],
  thumb: ['thumb master', 'thumbs', 'thumb'],
  snake: ['snake eyes'],
};
const squash = (s: string) =>
  s
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N} ]/gu, '')
    .replace(/\s+/g, ' ')
    .trim();

/** What the game tracks for a rule, from its name. Null for rules that are over once they're read out. */
export function ruleKind(rule: Rule | undefined): RuleKind | null {
  if (!rule) return null;
  const n = squash(rule.name);
  for (const kind of Object.keys(KIND_NAMES) as RuleKind[]) if (KIND_NAMES[kind].includes(n)) return kind;
  return null;
}
export const isRole = (kind: RuleKind | null): kind is RoleKind => kind === 'questions' || kind === 'thumb' || kind === 'snake';

/** The first rank (1 to 13) whose rule is of this kind, or null. */
export function rankOfKind(rules: readonly Rule[], kind: RuleKind): number | null {
  const i = rules.findIndex((r) => ruleKind(r) === kind);
  return i < 0 ? null : i + 1;
}

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
  if (!raw || typeof raw !== 'object' || i === KING - 1) return classic;
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

/** A copy of the rules with one rank changed. A blank name puts the classic rule back. The king can't change. */
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

/** Two seats that drink together. Mates come in pairs: nobody has more than one. */
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

/** The seat paired with `seat`, or null. */
export const mateOf = (pairs: readonly Pair[], seat: number): number | null => {
  const p = pairs.find(([x, y]) => x === seat || y === seat);
  return p ? (p[0] === seat ? p[1] : p[0]) : null;
};

/**
 * Pairs two seats. Mates come in pairs, so anyone who already had a mate loses them to the new pair (otherwise mates
 * chain until half the table drinks on every card). Picking yourself or your own mate changes nothing.
 */
export function addMate(pairs: readonly Pair[], a: number, b: number): Pair[] {
  if (a === b || a < 0 || b < 0 || mateOf(pairs, a) === b) return pairs.slice();
  return [...pairs.filter(([x, y]) => x !== a && y !== a && x !== b && y !== b), [Math.min(a, b), Math.max(a, b)]];
}

// The game ------------------------------------------------------------------------------------------------------

export type Role = { kind: RoleKind; seat: number | null; card: Card };

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
  /** Who holds each role (Question Master and the like), in the order they first came up. Seat is null without names. */
  roles: Role[];
  /** Who drew each king, in order (null without names). */
  kingSeats: (number | null)[];
  mates: Pair[];
  /** Rules the table made (Make a Rule), in order. */
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
    roles: [],
    kingSeats: [],
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

/** The roles with `kind` handed to whoever drew `card`: a new holder takes over the same spot in the list. */
function handRole(roles: readonly Role[], role: Role): Role[] {
  const i = roles.findIndex((r) => r.kind === role.kind);
  return i < 0 ? [...roles, role] : roles.map((r, k) => (k === i ? role : r));
}

/**
 * Draws the card in `slot`, or the next one clockwise when that slot is empty or not given. `rules` decide which
 * cards hand out a role (the classic rules make the queen the Question Master).
 * Returns null once the game is over or the ring is empty.
 */
export function draw(g: Game, slot?: number, rules: readonly Rule[] = CLASSIC_RULES): { game: Game; drawn: Drawn } | null {
  if (g.over) return null;
  const i = slot !== undefined && g.ring[slot] ? slot : nextSlot(g);
  const card = i >= 0 ? g.ring[i] : null;
  if (!card) return null;
  const ring = g.ring.slice();
  ring[i] = null;
  const seat = g.seats > 0 ? g.turn : null;
  const kings = g.kings + (card.rank === 13 ? 1 : 0);
  const last = card.rank === 13 && kings >= LAST_KING;
  const kind = ruleKind(ruleFor(rules, card.rank));
  const game: Game = {
    ...g,
    ring,
    drawn: [...g.drawn, card],
    kings,
    last: i,
    turn: nextSeat(g.turn, g.seats),
    roles: isRole(kind) ? handRole(g.roles, { kind, seat, card }) : g.roles,
    kingSeats: card.rank === 13 ? [...g.kingSeats, seat] : g.kingSeats,
    over: last || ring.every((c) => !c),
  };
  return { game, drawn: { card, slot: i, seat, kings, last } };
}

/** Adds a rule the table made. Blank rules are ignored. */
export function makeRule(g: Game, raw: string): Game {
  const text = tidy(raw, MADE_RULE_MAX);
  return text ? { ...g, made: [...g.made, text] } : g;
}

export function dropRule(g: Game, index: number): Game {
  return index >= 0 && index < g.made.length ? { ...g, made: g.made.filter((_, i) => i !== index) } : g;
}

/** How full the cup is, 0 to 1. */
export const cupLevel = (kings: number) => Math.max(0, Math.min(1, kings / LAST_KING));

/** 'second', 'fifth', '12th', '21st'. */
export function nth(n: number): string {
  const words = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth'];
  if (n >= 1 && n <= words.length) return words[n - 1];
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? 'th' : ['th', 'st', 'nd', 'rd'][n % 10] ?? 'th';
  return `${n}${suffix}`;
}
