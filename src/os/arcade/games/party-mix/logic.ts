// Party Mix rules, kept pure so they run under node: which cards make a deck, in what order, who they name,
// how long each New Rule stays on, and where Back and Next lead.
import { shuffle, type Rng } from '../../kit/party-core.ts';
import { CARDS, type CardType, type Level, type Template } from './cards.ts';

export type Intensity = 'chill' | 'party' | 'wild';
export type Length = 'short' | 'normal' | 'long';
export type Kind = CardType | 'end';

/** The highest card level each intensity deals. */
export const LEVELS: Record<Intensity, Level> = { chill: 1, party: 2, wild: 3 };
/** Cards per deck, counting each New Rule and its Rule Over card. */
export const LENGTHS: Record<Length, number> = { short: 30, normal: 50, long: 80 };
/** New Rules per deck. */
export const RULES: Record<Length, number> = { short: 2, normal: 3, long: 5 };
/** How many cards a rule stays on for, at least and at most. */
export const LIFETIME: Record<Length, readonly [number, number]> = { short: [5, 7], normal: [6, 9], long: [7, 11] };
/** The share of each non-rule type in a deck. */
export const MIX: Record<Exclude<CardType, 'rule'>, number> = { challenge: 18, give: 14, everyone: 16, vote: 13, duel: 14, game: 11, wyr: 14 };
/** Types that name a player, so a deck opens on someone. */
export const OPENERS: readonly Kind[] = ['challenge', 'duel', 'give'];

/** A piece of card text: plain words, or the seat of a player whose name goes there. */
export type Part = string | { seat: number };

export type Card = {
  kind: Kind;
  level: Level;
  /** The template text, so the next deck can skip what this one dealt. */
  key: string;
  text: Part[];
  /** Would You Rather: the second option. */
  or?: Part[];
  /** Players named, in order. A Rule Over card repeats its rule's players. */
  seats: number[];
  /** New Rule and Rule Over cards: the rule's short name, where it starts and ends in the deck, and how many cards it lasts. */
  rule?: { label: Part[]; from: number; to: number; lasts: number };
};

const PLACEHOLDER = /\{p([12])\}/g;

/** How many different players a template names (0, 1 or 2). */
export function slots(t: Pick<Template, 'text' | 'or' | 'label' | 'end'>): number {
  let n = 0;
  for (const s of [t.text, t.or, t.label, t.end]) for (const m of (s ?? '').matchAll(PLACEHOLDER)) n = Math.max(n, Number(m[1]));
  return n;
}

/** Splits template text into parts, with {p1} and {p2} replaced by the given seats. */
export function fill(text: string, seats: readonly number[]): Part[] {
  const out: Part[] = [];
  let at = 0;
  for (const m of text.matchAll(PLACEHOLDER)) {
    const i = m.index ?? 0;
    if (i > at) out.push(text.slice(at, i));
    const seat = seats[Number(m[1]) - 1];
    out.push(seat === undefined ? m[0] : { seat });
    at = i + m[0].length;
  }
  if (at < text.length) out.push(text.slice(at));
  return out;
}

/** Card text with the names written in. */
export function plain(parts: readonly Part[], names: readonly string[]): string {
  return parts.map((p) => (typeof p === 'string' ? p : (names[p.seat] ?? `Player ${p.seat + 1}`))).join('');
}

/**
 * Picks players fairly: everyone is named once before anyone is named again, and whoever was just named
 * goes to the back of the next round, so nobody gets picked twice in a row.
 */
export class Picker {
  private bag: number[] = [];
  private last = -1;
  private readonly players: number;
  private readonly rng: Rng;
  readonly counts: number[];
  constructor(players: number, rng: Rng = Math.random) {
    this.players = players;
    this.rng = rng;
    this.counts = Array.from({ length: players }, () => 0);
  }
  take(not: readonly number[] = []): number {
    let i = this.bag.findIndex((s) => !not.includes(s));
    if (i < 0) {
      const fresh = shuffle(
        Array.from({ length: this.players }, (_, s) => s).filter((s) => !this.bag.includes(s)),
        this.rng,
      );
      const later = (s: number) => s === this.last || not.includes(s);
      this.bag.push(...fresh.filter((s) => !later(s)), ...fresh.filter(later));
      i = this.bag.findIndex((s) => !not.includes(s));
    }
    const seat = i < 0 ? 0 : this.bag.splice(i, 1)[0];
    this.last = seat;
    this.counts[seat]++;
    return seat;
  }
}

/** Every template an intensity can deal to this many players. */
export function eligible(intensity: Intensity, players: number, cards: readonly Template[] = CARDS): Template[] {
  return cards.filter((c) => c.level <= LEVELS[intensity] && (c.min ?? 2) <= players && slots(c) <= players);
}

/** Splits `total` over the weights, never giving a type more than it has. */
export function quotas<K extends string>(total: number, weights: Record<K, number>, have: Record<K, number>): Record<K, number> {
  const keys = (Object.keys(weights) as K[]).filter((k) => weights[k] > 0 && have[k] > 0);
  const out = Object.fromEntries((Object.keys(weights) as K[]).map((k) => [k, 0])) as Record<K, number>;
  let left = Math.min(total, keys.reduce((n, k) => n + have[k], 0));
  while (left > 0) {
    const open = keys.filter((k) => out[k] < have[k]);
    const sum = open.reduce((n, k) => n + weights[k], 0);
    const share = open.map((k) => ({ k, exact: (left * weights[k]) / sum }));
    let given = 0;
    for (const { k, exact } of share) {
      const n = Math.min(Math.floor(exact), have[k] - out[k]);
      out[k] += n;
      given += n;
    }
    // Hand out what rounding left over, largest remainder first.
    if (given === 0)
      for (const { k } of share.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)))) {
        if (given === left) break;
        if (out[k] < have[k]) {
          out[k]++;
          given++;
        }
      }
    left -= given;
  }
  return out;
}

/** True when some kind shows up three times in a row. */
export function hasTriple(kinds: readonly Kind[]): boolean {
  return kinds.some((k, i) => i >= 2 && k === kinds[i - 1] && k === kinds[i - 2]);
}

/**
 * Shuffles cards so no kind comes up three times in a row, opening on a card that names someone when it can.
 * Exported for tests; works on anything with a `kind`.
 */
export function arrange<T extends { kind: Kind }>(cards: readonly T[], rng: Rng = Math.random): T[] {
  const left = shuffle(cards, rng);
  const out: T[] = [];
  while (left.length) {
    const n = out.length;
    const prev = n ? out[n - 1].kind : null;
    const blocked = n >= 2 && out[n - 1].kind === out[n - 2].kind ? out[n - 1].kind : null;
    let i = n === 0 ? left.findIndex((c) => OPENERS.includes(c.kind)) : -1;
    // Rather a change of kind every card; two in a row only when the pile runs out of others.
    if (i < 0) i = left.findIndex((c) => c.kind !== prev);
    if (i < 0) i = left.findIndex((c) => c.kind !== blocked);
    if (i < 0) i = 0;
    out.push(left.splice(i, 1)[0]);
  }
  // A pile that ends on one kind can still leave a triple: swap the odd one out with a card further up.
  // `bad(p)`: a triple runs through position p.
  const bad = (p: number) => [p, p + 1, p + 2].some((j) => j >= 2 && j < out.length && out[j].kind === out[j - 1].kind && out[j].kind === out[j - 2].kind);
  for (let i = 2; i < out.length; i++) {
    if (out[i].kind !== out[i - 1].kind || out[i].kind !== out[i - 2].kind) continue;
    for (let j = 1; j < out.length; j++) {
      if (out[j].kind === out[i].kind) continue;
      [out[i], out[j]] = [out[j], out[i]];
      if (!bad(i) && !bad(j)) break;
      [out[i], out[j]] = [out[j], out[i]];
    }
  }
  return out;
}

export type DeckOptions = {
  players: number;
  intensity: Intensity;
  length: Length;
  rng?: Rng;
  /** Template texts from the last deck. They are dealt again only when nothing fresh is left. */
  avoid?: ReadonlySet<string>;
  cards?: readonly Template[];
};

/** Builds a full deck: a mix of types at the chosen intensity, New Rules with their Rule Over cards, and names filled in. */
export function buildDeck({ players, intensity, length, rng = Math.random, avoid, cards = CARDS }: DeckOptions): Card[] {
  const top = LEVELS[intensity];
  // Lower goes first: cards at the chosen intensity come up more often, cards from the last deck wait their turn.
  const rank = (list: Template[]) =>
    list
      .map((t) => ({ t, k: rng() * (top > 1 && t.level === top ? 0.6 : 1) + (avoid?.has(t.text) ? 1 : 0) }))
      .sort((a, b) => a.k - b.k)
      .map((x) => x.t);
  const pool = eligible(intensity, players, cards);
  const of = (type: CardType) => rank(pool.filter((t) => t.type === type));
  const rules = of('rule').slice(0, RULES[length]);
  const types = Object.keys(MIX) as (keyof typeof MIX)[];
  const piles = Object.fromEntries(types.map((t) => [t, of(t)])) as Record<keyof typeof MIX, Template[]>;
  const want = quotas(
    LENGTHS[length] - rules.length * 2,
    MIX,
    Object.fromEntries(types.map((t) => [t, piles[t].length])) as Record<keyof typeof MIX, number>,
  );
  const body = arrange(
    types.flatMap((t) => piles[t].slice(0, want[t]).map((tpl) => ({ kind: tpl.type as Kind, tpl }))),
    rng,
  );
  const total = body.length + rules.length * 2;

  // Each rule starts a little way into its own stretch of the deck and ends before the next stretch begins.
  const [shortest, longest] = LIFETIME[length];
  const starts = new Map<number, number>();
  const ends = new Map<number, number>();
  const spans: { from: number; to: number }[] = [];
  rules.forEach((_, r) => {
    const lo = Math.floor((r * total) / rules.length);
    const hi = Math.floor(((r + 1) * total) / rules.length);
    const from = lo + 2 + Math.floor(rng() * Math.max(1, Math.floor((hi - lo) / 5)));
    const lasts = Math.max(1, Math.min(shortest + Math.floor(rng() * (longest - shortest + 1)), hi - from - 3));
    starts.set(from, r);
    ends.set(from + lasts + 1, r);
    spans.push({ from, to: from + lasts + 1 });
  });

  const pick = new Picker(players, rng);
  const ruleSeats: number[][] = [];
  const deck: Card[] = [];
  let next = 0;
  for (let i = 0; i < total; i++) {
    const r = starts.get(i) ?? ends.get(i);
    const isStart = starts.has(i);
    const tpl = r === undefined ? body[next++].tpl : rules[r];
    const seats: number[] = [];
    if (r === undefined || isStart) for (let s = 0; s < slots(tpl); s++) seats.push(pick.take(seats));
    else seats.push(...ruleSeats[r]);
    if (r !== undefined && isStart) ruleSeats[r] = seats;
    const card: Card = { kind: r === undefined || isStart ? tpl.type : 'end', level: tpl.level, key: tpl.text, text: fill(r !== undefined && !isStart ? (tpl.end ?? '') : tpl.text, seats), seats };
    if (tpl.or) card.or = fill(tpl.or, seats);
    if (r !== undefined) card.rule = { label: fill(tpl.label ?? '', seats), from: spans[r].from, to: spans[r].to, lasts: spans[r].to - spans[r].from - 1 };
    deck.push(card);
  }
  return deck;
}

/** Rules in force while card `at` is showing: started before it, and their Rule Over card is still to come. */
export function activeRules(deck: readonly Card[], at: number): Card[] {
  return deck.filter((c, i) => c.kind === 'rule' && c.rule && i === c.rule.from && c.rule.from < at && at < c.rule.to);
}

/**
 * Where Next (+1) and Back (-1) lead from a spot in the deck. Spots run 0 to deck length,
 * where the length itself is the end screen. Back from the first card stays put.
 */
export function step(at: number, dir: 1 | -1, total: number): number {
  return Math.max(0, Math.min(total, at + dir));
}

export type Stats = {
  cards: number;
  duels: number;
  rules: number;
  /** Times each seat was named (a Rule Over card doesn't count again). */
  named: number[];
  most: { seats: number[]; times: number };
  least: { seats: number[]; times: number };
};

/** A few numbers for the end screen. */
export function stats(deck: readonly Card[], players: number): Stats {
  const named = Array.from({ length: players }, () => 0);
  for (const c of deck) if (c.kind !== 'end') for (const s of new Set(c.seats)) if (s < players) named[s]++;
  const hi = Math.max(0, ...named);
  const lo = Math.min(...named);
  const seatsAt = (n: number) => named.flatMap((v, s) => (v === n ? [s] : []));
  return {
    cards: deck.length,
    duels: deck.filter((c) => c.kind === 'duel').length,
    rules: deck.filter((c) => c.kind === 'rule').length,
    named,
    most: { seats: seatsAt(hi), times: hi },
    least: { seats: seatsAt(lo), times: lo },
  };
}
